import { createHash } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync
} from "node:fs";
import { open } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createInflateRaw } from "node:zlib";
import { z } from "zod";
import {
  isThemeCompatible,
  validateThemeRevision,
  type ModuleMetadata,
  type SkinFactoryMetadata,
  type ThemeDefinition,
  type ThemePackageRevision
} from "@multiplayer-game/theme-sdk";
import type { SqliteDatabase } from "../storage/database.js";
import { runtimeThemeDefinition, ThemeImportDefinitionSchema } from "./credits.js";

export const MAX_THEME_ARCHIVE_BYTES = 10 * 1024 * 1024;
export const MAX_THEME_EXTRACTED_BYTES = 40 * 1024 * 1024;
export const MAX_THEME_ARCHIVE_ENTRIES = 256;
export const MAX_THEME_IMAGE_EDGE = 4096;
export const MAX_THEME_IMAGE_PIXELS = 32_000_000;
const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_PATH_BYTES = 512;
const ENGINE_API_MAJOR = 1;

const AssetDeclarationSchema = z.object({
  path: z.string().min(1).max(MAX_PATH_BYTES),
  sha256: z.string().regex(/^[a-f0-9]{64}$/)
}).strict();
const PackageAssetsSchema = z.object({
  required: z.record(z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/), AssetDeclarationSchema),
  optional: z.record(z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/), AssetDeclarationSchema)
}).strict();

export const ThemePackageManifestSchema = ThemeImportDefinitionSchema.safeExtend({
  assets: PackageAssetsSchema
}).strict();

export type ThemePackageManifest = z.infer<typeof ThemePackageManifestSchema>;
export type RegisteredThemeModules = ReadonlyMap<string, ModuleMetadata>;
export type RegisteredThemeRenderers = ReadonlyMap<string, SkinFactoryMetadata>;

export interface ThemePackageInstallResult {
  readonly revision: ThemePackageRevision;
  readonly assetRoot: string;
}

interface ZipEntry {
  readonly path: string;
  readonly directory: boolean;
  readonly flags: number;
  readonly method: number;
  readonly crc32: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localOffset: number;
  readonly dataOffset: number;
  readonly dataEnd: number;
  readonly recordEnd: number;
}

interface ParsedZip {
  readonly entries: readonly ZipEntry[];
  readonly directoryOffset: number;
}

interface ExtractedFile {
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = (crc & 1) === 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return crc >>> 0;
});

function updateCrc32(crc: number, bytes: Uint8Array): number {
  let current = crc;
  for (const byte of bytes) {
    current = CRC_TABLE[(current ^ byte) & 0xff]! ^ (current >>> 8);
  }
  return current >>> 0;
}

function readUInt16(buffer: Buffer, offset: number): number {
  if (offset < 0 || offset + 2 > buffer.length) throw new Error("Malformed ZIP structure.");
  return buffer.readUInt16LE(offset);
}

function readUInt32(buffer: Buffer, offset: number): number {
  if (offset < 0 || offset + 4 > buffer.length) throw new Error("Malformed ZIP structure.");
  return buffer.readUInt32LE(offset);
}

async function readAt(
  file: Awaited<ReturnType<typeof open>>,
  offset: number,
  length: number,
  fileSize: number
): Promise<Buffer> {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) ||
      offset < 0 || length < 0 || offset + length > fileSize) {
    throw new Error("ZIP entry points outside the archive.");
  }
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await file.read(buffer, 0, length, offset);
  if (bytesRead !== length) throw new Error("ZIP archive ended unexpectedly.");
  return buffer;
}

function decodeZipPath(bytes: Buffer, flags: number): string {
  if ((flags & 0x0800) === 0 && bytes.some((byte) => byte > 0x7f)) {
    throw new Error("ZIP entry names must use UTF-8 encoding.");
  }
  let value: string;
  try {
    value = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("ZIP entry name is not valid UTF-8.");
  }
  const normalized = value.replace(/\/$/, "");
  const segments = normalized.split("/");
  if (
    bytes.length === 0 ||
    bytes.length > MAX_PATH_BYTES ||
    value.includes("\\") ||
    value.includes("\0") ||
    /[\u0000-\u001f\u007f]/.test(value) ||
    value.startsWith("/") ||
    /^[a-zA-Z]:/.test(value) ||
    segments.some((segment) => segment === "" || segment === "." || segment === "..") ||
    isAbsolute(value)
  ) {
    throw new Error(`Unsafe ZIP entry path: ${JSON.stringify(value)}.`);
  }
  return normalized;
}

function validateExtraFields(extra: Buffer): void {
  let offset = 0;
  while (offset < extra.length) {
    if (offset + 4 > extra.length) throw new Error("Malformed ZIP extra field.");
    const id = readUInt16(extra, offset);
    const size = readUInt16(extra, offset + 2);
    offset += 4;
    if (offset + size > extra.length) throw new Error("Malformed ZIP extra field.");
    if (id === 0x0001 || id === 0x7075 || id === 0x6375) {
      throw new Error("ZIP64 and Unicode path override fields are not supported.");
    }
    offset += size;
  }
}

async function parseZip(filePath: string, fileSize: number): Promise<ParsedZip> {
  const file = await open(filePath, "r");
  try {
    const tailLength = Math.min(fileSize, 65_557);
    const tailOffset = fileSize - tailLength;
    const tail = await readAt(file, tailOffset, tailLength, fileSize);
    let eocdOffset = -1;
    for (let offset = tail.length - 22; offset >= 0; offset -= 1) {
      if (readUInt32(tail, offset) !== 0x06054b50) continue;
      const commentLength = readUInt16(tail, offset + 20);
      if (offset + 22 + commentLength === tail.length) {
        eocdOffset = offset;
        break;
      }
    }
    if (eocdOffset < 0) throw new Error("ZIP end-of-central-directory record is missing.");

    const diskNumber = readUInt16(tail, eocdOffset + 4);
    const directoryDisk = readUInt16(tail, eocdOffset + 6);
    const diskEntries = readUInt16(tail, eocdOffset + 8);
    const entryCount = readUInt16(tail, eocdOffset + 10);
    const directorySize = readUInt32(tail, eocdOffset + 12);
    const directoryOffset = readUInt32(tail, eocdOffset + 16);
    if (
      diskNumber !== 0 ||
      directoryDisk !== 0 ||
      diskEntries !== entryCount ||
      entryCount === 0xffff ||
      directorySize === 0xffffffff ||
      directoryOffset === 0xffffffff
    ) {
      throw new Error("Multi-disk and ZIP64 archives are not supported.");
    }
    if (entryCount > MAX_THEME_ARCHIVE_ENTRIES) {
      throw new Error(`ZIP archive exceeds the ${MAX_THEME_ARCHIVE_ENTRIES}-entry limit.`);
    }
    const absoluteEocdOffset = tailOffset + eocdOffset;
    if (directoryOffset + directorySize !== absoluteEocdOffset) {
      throw new Error("ZIP central directory bounds are invalid.");
    }
    const directory = await readAt(file, directoryOffset, directorySize, fileSize);
    const entries: ZipEntry[] = [];
    const names = new Set<string>();
    let offset = 0;
    for (let index = 0; index < entryCount; index += 1) {
      if (readUInt32(directory, offset) !== 0x02014b50) {
        throw new Error("Malformed ZIP central directory entry.");
      }
      const madeBy = readUInt16(directory, offset + 4);
      const flags = readUInt16(directory, offset + 8);
      const method = readUInt16(directory, offset + 10);
      const crc32 = readUInt32(directory, offset + 16);
      const compressedSize = readUInt32(directory, offset + 20);
      const uncompressedSize = readUInt32(directory, offset + 24);
      const nameLength = readUInt16(directory, offset + 28);
      const extraLength = readUInt16(directory, offset + 30);
      const commentLength = readUInt16(directory, offset + 32);
      const startDisk = readUInt16(directory, offset + 34);
      const externalAttributes = readUInt32(directory, offset + 38);
      const localOffset = readUInt32(directory, offset + 42);
      const recordLength = 46 + nameLength + extraLength + commentLength;
      if (offset + recordLength > directory.length) throw new Error("Truncated ZIP directory entry.");
      if (
        startDisk !== 0 ||
        compressedSize === 0xffffffff ||
        uncompressedSize === 0xffffffff ||
        localOffset === 0xffffffff
      ) {
        throw new Error("Multi-disk and ZIP64 entries are not supported.");
      }
      const allowedFlags = 0x0006 | 0x0008 | 0x0800;
      if ((flags & ~allowedFlags) !== 0 || (flags & 1) !== 0 || (flags & 0x0040) !== 0) {
        throw new Error("Encrypted or unsupported ZIP entry flags are not allowed.");
      }
      if (method !== 0 && method !== 8) throw new Error("ZIP supports only stored or deflate entries.");
      const nameBytes = directory.subarray(offset + 46, offset + 46 + nameLength);
      const path = decodeZipPath(nameBytes, flags);
      const isDirectory = directory.subarray(offset + 46, offset + 46 + nameLength)
        .at(-1) === 0x2f;
      const key = path.toLocaleLowerCase("en-US");
      if (names.has(key)) throw new Error(`ZIP contains duplicate or case-colliding path ${path}.`);
      names.add(key);
      validateExtraFields(directory.subarray(offset + 46 + nameLength, offset + 46 + nameLength + extraLength));

      const hostSystem = madeBy >>> 8;
      const unixMode = externalAttributes >>> 16;
      const unixType = unixMode & 0xf000;
      if (hostSystem === 3 && unixType !== 0 && unixType !== (isDirectory ? 0x4000 : 0x8000)) {
        throw new Error(`ZIP entry ${path} is not a regular file or directory.`);
      }
      if (isDirectory && (uncompressedSize !== 0 || compressedSize !== 0)) {
        throw new Error(`ZIP directory entry ${path} contains data.`);
      }

      const localHeader = await readAt(file, localOffset, 30, fileSize);
      if (readUInt32(localHeader, 0) !== 0x04034b50) throw new Error("Malformed ZIP local header.");
      const localFlags = readUInt16(localHeader, 6);
      const localMethod = readUInt16(localHeader, 8);
      const localCrc = readUInt32(localHeader, 14);
      const localCompressedSize = readUInt32(localHeader, 18);
      const localUncompressedSize = readUInt32(localHeader, 22);
      const localNameLength = readUInt16(localHeader, 26);
      const localExtraLength = readUInt16(localHeader, 28);
      const localName = await readAt(file, localOffset + 30, localNameLength, fileSize);
      const localExtra = await readAt(
        file,
        localOffset + 30 + localNameLength,
        localExtraLength,
        fileSize
      );
      validateExtraFields(localExtra);
      if (
        !localName.equals(nameBytes) ||
        localFlags !== flags ||
        localMethod !== method ||
        ((flags & 0x0008) === 0 &&
          (localCrc !== crc32 ||
            localCompressedSize !== compressedSize ||
            localUncompressedSize !== uncompressedSize))
      ) {
        throw new Error(`ZIP local and central metadata disagree for ${path}.`);
      }
      const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
      const dataEnd = dataOffset + compressedSize;
      if (!Number.isSafeInteger(dataEnd) || dataOffset < 0 || dataEnd > directoryOffset) {
        throw new Error(`ZIP entry ${path} overlaps the central directory or exceeds the archive.`);
      }
      let recordEnd = dataEnd;
      if ((flags & 0x0008) !== 0) {
        const firstWord = await readAt(file, dataEnd, 4, directoryOffset);
        const hasSignature = readUInt32(firstWord, 0) === 0x08074b50;
        const unsignedDescriptor = await readAt(file, dataEnd, 12, directoryOffset);
        const unsignedMatches =
          readUInt32(unsignedDescriptor, 0) === crc32 &&
          readUInt32(unsignedDescriptor, 4) === compressedSize &&
          readUInt32(unsignedDescriptor, 8) === uncompressedSize;
        const descriptorLength = hasSignature && !unsignedMatches ? 16 : 12;
        const descriptor = descriptorLength === 16
          ? await readAt(file, dataEnd, 16, directoryOffset)
          : unsignedDescriptor;
        const descriptorOffset = descriptorLength === 16 ? 4 : 0;
        const fields = descriptor.subarray(descriptorOffset);
        if (readUInt32(fields, 0) !== crc32 ||
            readUInt32(fields, 4) !== compressedSize ||
            readUInt32(fields, 8) !== uncompressedSize) {
          throw new Error(`ZIP data descriptor is invalid for ${path}.`);
        }
        recordEnd = dataEnd + descriptorLength;
      }
      entries.push({
        path,
        directory: isDirectory,
        flags,
        method,
        crc32,
        compressedSize,
        uncompressedSize,
        localOffset,
        dataOffset,
        dataEnd,
        recordEnd
      });
      offset += recordLength;
    }
    if (offset !== directory.length) throw new Error("ZIP central directory has trailing records.");

    const ranges = [...entries].sort((a, b) => a.localOffset - b.localOffset);
    for (let index = 1; index < ranges.length; index += 1) {
      if (ranges[index - 1]!.recordEnd > ranges[index]!.localOffset) {
        throw new Error("ZIP local entries overlap.");
      }
    }
    return { entries, directoryOffset };
  } finally {
    await file.close();
  }
}

async function extractEntry(
  archivePath: string,
  entry: ZipEntry,
  targetPath: string,
  remainingBytes: number
): Promise<ExtractedFile> {
  mkdirSync(dirname(targetPath), { recursive: true });
  const hash = createHash("sha256");
  let byteCount = 0;
  let crc = 0xffffffff;
  const validate = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      byteCount += chunk.length;
      if (byteCount > entry.uncompressedSize || byteCount > remainingBytes) {
        callback(new Error(`ZIP entry ${entry.path} exceeds its declared or package size limit.`));
        return;
      }
      hash.update(chunk);
      crc = updateCrc32(crc, chunk);
      callback(null, chunk);
    }
  });
  const source = entry.compressedSize === 0
    ? Readable.from([])
    : createReadStream(archivePath, {
      start: entry.dataOffset,
      end: entry.dataEnd - 1
    });
  if (entry.method === 8) {
    await pipeline(source, createInflateRaw(), validate, createWriteStream(targetPath, { flags: "wx" }));
  } else {
    await pipeline(source, validate, createWriteStream(targetPath, { flags: "wx" }));
  }
  const finalCrc = (crc ^ 0xffffffff) >>> 0;
  if (byteCount !== entry.uncompressedSize || finalCrc !== entry.crc32) {
    throw new Error(`ZIP entry ${entry.path} failed size or CRC validation.`);
  }
  return { path: entry.path, sha256: hash.digest("hex"), bytes: byteCount };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error("Theme package metadata is not JSON serializable.");
  return serialized;
}

export function calculateThemePackageDigest(
  manifest: Readonly<Record<string, unknown>>
): string {
  const content = Object.fromEntries(
    Object.entries(manifest).filter(([key]) => key !== "assetsDigest")
  );
  return createHash("sha256").update(canonicalJson(content), "utf8").digest("hex");
}

function validatePng(path: string, bytes: Buffer): { readonly width: number; readonly height: number } {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (bytes.length < 45 || !bytes.subarray(0, 8).equals(signature)) {
    throw new Error(`Asset ${path} is not a valid PNG image.`);
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let seenHeader = false;
  let seenData = false;
  let seenEnd = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const typeOffset = offset + 4;
    const end = typeOffset + 4 + length;
    if (!Number.isSafeInteger(end) || end + 4 > bytes.length) {
      throw new Error(`Asset ${path} has a truncated PNG chunk.`);
    }
    const type = bytes.toString("ascii", typeOffset, typeOffset + 4);
    const expectedCrc = bytes.readUInt32BE(end);
    const actualCrc = (updateCrc32(
      updateCrc32(0xffffffff, bytes.subarray(typeOffset, typeOffset + 4)),
      bytes.subarray(typeOffset + 4, end)
    ) ^ 0xffffffff) >>> 0;
    if (expectedCrc !== actualCrc) throw new Error(`Asset ${path} has a PNG chunk checksum error.`);
    if (!seenHeader) {
      if (type !== "IHDR" || length !== 13) throw new Error(`Asset ${path} has an invalid PNG header.`);
      width = bytes.readUInt32BE(typeOffset + 4);
      height = bytes.readUInt32BE(typeOffset + 8);
      const bitDepth = bytes[typeOffset + 12]!;
      const colorType = bytes[typeOffset + 13]!;
      const validDepths: Readonly<Record<number, readonly number[]>> = {
        0: [1, 2, 4, 8, 16],
        2: [8, 16],
        3: [1, 2, 4, 8],
        4: [8, 16],
        6: [8, 16]
      };
      if (!validDepths[colorType]?.includes(bitDepth) ||
        bytes[typeOffset + 14] !== 0 ||
        bytes[typeOffset + 15] !== 0 ||
        bytes[typeOffset + 16] !== 0) {
        throw new Error(`Asset ${path} has unsupported PNG encoding parameters.`);
      }
      seenHeader = true;
    } else if (type === "IHDR") {
      throw new Error(`Asset ${path} contains multiple PNG headers.`);
    }
    if (type === "IDAT") seenData = true;
    if (type === "IEND") {
      if (length !== 0 || !seenData) throw new Error(`Asset ${path} has an invalid PNG end chunk.`);
      seenEnd = true;
      offset = end + 4;
      break;
    }
    offset = end + 4;
  }
  if (!seenHeader || !seenEnd || offset !== bytes.length) {
    throw new Error(`Asset ${path} is an incomplete PNG image.`);
  }
  return { width, height };
}

function validateAssetFormat(path: string, bytes: Buffer): {
  readonly width?: number;
  readonly height?: number;
} {
  const extension = extname(path);
  if (extension === ".png") return validatePng(path, bytes);
  if (extension === ".jpg" || extension === ".jpeg") {
    if (bytes.length < 4 || bytes.readUInt16BE(0) !== 0xffd8) {
      throw new Error(`Asset ${path} is not a valid JPEG image.`);
    }
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset] !== 0xff) throw new Error(`Asset ${path} has malformed JPEG markers.`);
      const marker = bytes[offset + 1]!;
      offset += 2;
      if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 ||
        (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) break;
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]
        .includes(marker)) {
        if (length < 7) break;
        return {
          height: bytes.readUInt16BE(offset + 3),
          width: bytes.readUInt16BE(offset + 5)
        };
      }
      offset += length;
    }
    throw new Error(`Asset ${path} has no supported JPEG frame header.`);
  }
  if (extension === ".webp") {
    if (bytes.length < 30 ||
      bytes.toString("ascii", 0, 4) !== "RIFF" ||
      bytes.toString("ascii", 8, 12) !== "WEBP") {
      throw new Error(`Asset ${path} is not a valid WebP image.`);
    }
    const chunk = bytes.toString("ascii", 12, 16);
    if (chunk === "VP8X") {
      return {
        width: 1 + bytes.readUIntLE(24, 3),
        height: 1 + bytes.readUIntLE(27, 3)
      };
    }
    if (chunk === "VP8 " && bytes.length >= 30 && bytes[23] === 0x9d &&
      bytes[24] === 0x01 && bytes[25] === 0x2a) {
      return {
        width: bytes.readUInt16LE(26) & 0x3fff,
        height: bytes.readUInt16LE(28) & 0x3fff
      };
    }
    if (chunk === "VP8L" && bytes[20] === 0x2f) {
      const bits = bytes.readUInt32LE(21);
      return {
        width: (bits & 0x3fff) + 1,
        height: ((bits >>> 14) & 0x3fff) + 1
      };
    }
    throw new Error(`Asset ${path} has an unsupported WebP image chunk.`);
  }
  if (extension === ".woff2") {
    if (bytes.length < 48 || bytes.toString("ascii", 0, 4) !== "wOF2" ||
      bytes.readUInt32BE(8) !== bytes.length) {
      throw new Error(`Asset ${path} is not a valid WOFF2 font.`);
    }
    return {};
  }
  if (extension === ".ogg") {
    if (bytes.length < 27 || bytes.toString("ascii", 0, 4) !== "OggS" || bytes[4] !== 0) {
      throw new Error(`Asset ${path} is not a valid OGG stream.`);
    }
    return {};
  }
  if (extension === ".mp3") {
    const hasId3 = bytes.length >= 10 && bytes.toString("ascii", 0, 3) === "ID3";
    const hasFrame = bytes.length >= 2 && bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0;
    if (!hasId3 && !hasFrame) throw new Error(`Asset ${path} is not a valid MP3 stream.`);
    return {};
  }
  if (extension === ".wav") {
    if (bytes.length < 12 ||
      bytes.toString("ascii", 0, 4) !== "RIFF" ||
      bytes.toString("ascii", 8, 12) !== "WAVE") {
      throw new Error(`Asset ${path} is not a valid WAV stream.`);
    }
    return {};
  }
  throw new Error(`Asset type ${extension || "(none)"} is not allowed in theme packages.`);
}

function validateImageBounds(path: string, format: { width?: number; height?: number }): number {
  if (format.width === undefined || format.height === undefined) return 0;
  if (
    !Number.isSafeInteger(format.width) ||
    !Number.isSafeInteger(format.height) ||
    format.width < 1 ||
    format.height < 1 ||
    format.width > MAX_THEME_IMAGE_EDGE ||
    format.height > MAX_THEME_IMAGE_EDGE
  ) {
    throw new Error(`Image ${path} exceeds the ${MAX_THEME_IMAGE_EDGE}px edge limit.`);
  }
  const pixels = format.width * format.height;
  if (!Number.isSafeInteger(pixels)) throw new Error(`Image ${path} has invalid dimensions.`);
  return pixels;
}

function validateCodeReferences(
  manifest: ThemePackageManifest,
  modules: RegisteredThemeModules,
  renderers: RegisteredThemeRenderers
): ThemePackageRevision {
  const moduleKey = `${manifest.module.id}@${manifest.module.version}`;
  const rendererKey = `${manifest.skin.rendererId}@${manifest.skin.version}`;
  const module = modules.get(moduleKey);
  const renderer = renderers.get(rendererKey);
  if (!module) throw new Error(`Game module ${moduleKey} is not registered.`);
  if (!renderer) throw new Error(`Skin renderer ${rendererKey} is not registered.`);
  if (
    !isThemeCompatible(manifest, ENGINE_API_MAJOR) ||
    module.id !== manifest.module.id ||
    module.version !== manifest.module.version ||
    module.stateSchemaVersion !== manifest.module.stateSchemaVersion ||
    renderer.id !== manifest.skin.rendererId ||
    renderer.version !== manifest.skin.version ||
    renderer.acceptedModuleId !== module.id ||
    !renderer.acceptedStateSchemaVersions.includes(module.stateSchemaVersion)
  ) {
    throw new Error("Theme manifest does not match the registered module and renderer versions.");
  }
  const { assets: _assets, ...importDefinition } = manifest;
  const definition = runtimeThemeDefinition(importDefinition);
  const revision: ThemePackageRevision = {
    definition,
    packageDigest: manifest.assetsDigest,
    installedModule: module,
    installedRenderer: renderer
  };
  validateThemeRevision(revision);
  return revision;
}

function validateManifestFiles(
  manifest: ThemePackageManifest,
  files: ReadonlyMap<string, ExtractedFile>
): void {
  const declared = new Set<string>(["theme.json"]);
  const mappings = [
    ...Object.values(manifest.assets.required),
    ...Object.values(manifest.assets.optional)
  ];
  const mappingPaths = new Set<string>();
  const assetIds = new Set<string>();
  for (const id of [
    ...Object.keys(manifest.assets.required),
    ...Object.keys(manifest.assets.optional)
  ]) {
    if (assetIds.has(id)) throw new Error(`Theme asset ID ${id} is declared more than once.`);
    assetIds.add(id);
  }
  for (const mapping of mappings) {
    const key = mapping.path.toLocaleLowerCase("en-US");
    if (mapping.path === "theme.json" || mappingPaths.has(key)) {
      throw new Error(`Theme asset path ${mapping.path} is declared more than once or reserved.`);
    }
    mappingPaths.add(key);
    const file = files.get(mapping.path);
    if (!file) {
      if (Object.values(manifest.assets.optional).includes(mapping)) continue;
      throw new Error(`Required theme asset ${mapping.path} is missing.`);
    }
    if (file.sha256 !== mapping.sha256) {
      throw new Error(`Theme asset ${mapping.path} does not match its declared SHA-256 hash.`);
    }
    declared.add(mapping.path);
  }
  for (const path of files.keys()) {
    if (path !== "theme.json" && !declared.has(path)) {
      throw new Error(`Theme package contains undeclared asset ${path}.`);
    }
  }
}

function assertSafeRelativePath(root: string, entryPath: string): string {
  const target = resolve(root, ...entryPath.split("/"));
  const pathFromRoot = relative(root, target);
  if (
    pathFromRoot === "" ||
    pathFromRoot === ".." ||
    pathFromRoot.startsWith(`..${sep}`) ||
    isAbsolute(pathFromRoot)
  ) {
    throw new Error(`Unsafe extraction path ${entryPath}.`);
  }
  return target;
}

export async function validateAndInstallThemePackage(
  database: SqliteDatabase,
  archivePath: string,
  assetDirectory: string,
  registeredModules: RegisteredThemeModules,
  registeredRenderers: RegisteredThemeRenderers
): Promise<ThemePackageInstallResult> {
  const archiveStat = lstatSync(archivePath);
  if (!archiveStat.isFile() || archiveStat.isSymbolicLink()) {
    throw new Error("Theme package must be a regular, non-symlink ZIP file.");
  }
  if (archiveStat.size < 22 || archiveStat.size > MAX_THEME_ARCHIVE_BYTES) {
    throw new Error(`Theme ZIP must be between 22 bytes and ${MAX_THEME_ARCHIVE_BYTES} bytes.`);
  }

  const archivePathResolved = resolve(archivePath);
  const archive = await open(archivePathResolved, "r");
  const archiveSize = (await archive.stat()).size;
  await archive.close();
  if (archiveSize !== archiveStat.size || archiveSize > MAX_THEME_ARCHIVE_BYTES) {
    throw new Error("Theme ZIP changed while it was being opened or exceeds its size limit.");
  }

  const parsed = await parseZip(archivePathResolved, archiveSize);
  let declaredTotal = 0;
  for (const entry of parsed.entries) {
    if (!entry.directory) {
      declaredTotal += entry.uncompressedSize;
      if (!Number.isSafeInteger(declaredTotal) || declaredTotal > MAX_THEME_EXTRACTED_BYTES) {
        throw new Error(`Theme ZIP exceeds the ${MAX_THEME_EXTRACTED_BYTES}-byte extracted limit.`);
      }
    }
  }
  if (!parsed.entries.some((entry) => entry.path === "theme.json" && !entry.directory)) {
    throw new Error("Theme ZIP must contain a root theme.json manifest.");
  }

  const resolvedAssetDirectory = resolve(assetDirectory);
  const stagingParent = dirname(resolvedAssetDirectory);
  mkdirSync(stagingParent, { recursive: true });
  const stagingDirectory = mkdtempSync(resolve(stagingParent, ".theme-staging-"));
  let promotedDirectory: string | undefined;
  try {
    let extractedTotal = 0;
    const files = new Map<string, ExtractedFile>();
    let imagePixels = 0;
    for (const entry of parsed.entries) {
      if (entry.directory) continue;
      const destination = assertSafeRelativePath(stagingDirectory, entry.path);
      const extracted = await extractEntry(
        archivePathResolved,
        entry,
        destination,
        MAX_THEME_EXTRACTED_BYTES - extractedTotal
      );
      extractedTotal += extracted.bytes;
      if (entry.path !== "theme.json") {
        const format = validateAssetFormat(entry.path, readFileSync(destination));
        imagePixels += validateImageBounds(entry.path, format);
        if (imagePixels > MAX_THEME_IMAGE_PIXELS) {
          throw new Error(`Theme images exceed the ${MAX_THEME_IMAGE_PIXELS}-pixel decoded limit.`);
        }
      } else if (extracted.bytes > MAX_MANIFEST_BYTES) {
        throw new Error(`theme.json exceeds the ${MAX_MANIFEST_BYTES}-byte manifest limit.`);
      }
      files.set(entry.path, extracted);
    }

    let manifestInput: unknown;
    try {
      manifestInput = JSON.parse(readFileSync(resolve(stagingDirectory, "theme.json"), "utf8"));
    } catch (error) {
      throw new Error("Theme package has an invalid JSON manifest.", { cause: error });
    }
    const manifest = ThemePackageManifestSchema.parse(manifestInput);
    validateManifestFiles(manifest, files);
    const normalizedManifest: ThemePackageManifest = {
      ...manifest,
      assets: {
        required: manifest.assets.required,
        optional: manifest.assets.optional
      }
    };
    const digest = calculateThemePackageDigest(normalizedManifest);
    if (digest !== normalizedManifest.assetsDigest) {
      throw new Error("Theme package digest does not match its canonical manifest and asset hashes.");
    }
    const revision = validateCodeReferences(
      normalizedManifest,
      registeredModules,
      registeredRenderers
    );

    mkdirSync(resolvedAssetDirectory, { recursive: true });
    const targetDirectory = resolve(resolvedAssetDirectory, digest);
    if (existsSync(targetDirectory)) {
      throw new Error(`Theme package digest ${digest} is already installed.`);
    }
    const insert = database.prepare(
      `INSERT INTO theme_revisions
       (theme_id, version, name, module_id, module_version, renderer_id, renderer_version,
        engine_api_major, digest, asset_root, enabled, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
    );
    try {
      database.transaction(() => {
        renameSync(stagingDirectory, targetDirectory);
        promotedDirectory = targetDirectory;
        insert.run(
          normalizedManifest.id,
          normalizedManifest.version,
          normalizedManifest.name,
          normalizedManifest.module.id,
          normalizedManifest.module.version,
          normalizedManifest.skin.rendererId,
          normalizedManifest.skin.version,
          normalizedManifest.engineApiMajor,
          digest,
          targetDirectory,
          new Date().toISOString()
        );
      })();
    } catch (error) {
      if (promotedDirectory) {
        rmSync(promotedDirectory, { recursive: true, force: true });
        promotedDirectory = undefined;
      }
      throw error;
    }
    return Object.freeze({ revision, assetRoot: targetDirectory });
  } finally {
    if (existsSync(stagingDirectory)) {
      rmSync(stagingDirectory, { recursive: true, force: true });
    }
  }
}
