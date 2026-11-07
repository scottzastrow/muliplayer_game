import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateRawSync, deflateSync } from "node:zlib";
import {
  defaultModuleFactory,
  defaultSkinFactory,
  defaultThemeDefinition
} from "@multiplayer-game/default-theme";
import {
  calculateThemePackageDigest,
  MAX_THEME_ARCHIVE_ENTRIES,
  validateAndInstallThemePackage
} from "../apps/server/src/themes/packages.js";
import { openDatabase, runMigrations } from "../apps/server/src/storage/database.js";

let temporaryDirectory: string | undefined;

afterEach(() => {
  if (temporaryDirectory) {
    rmSync(temporaryDirectory, { recursive: true, force: true });
    temporaryDirectory = undefined;
  }
});

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) !== 0 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createZip(
  entries: readonly { path: string; bytes: Buffer }[],
  options: { readonly deflate?: boolean; readonly descriptor?: boolean } = {}
): Buffer {
  const localRecords: Buffer[] = [];
  const centralRecords: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.path, "utf8");
    const checksum = crc32(entry.bytes);
    const compressed = options.deflate ? deflateRawSync(entry.bytes) : entry.bytes;
    const flags = 0x0800 | (options.descriptor ? 0x0008 : 0);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(options.deflate ? 8 : 0, 8);
    local.writeUInt32LE(options.descriptor ? 0 : checksum, 14);
    local.writeUInt32LE(options.descriptor ? 0 : compressed.length, 18);
    local.writeUInt32LE(options.descriptor ? 0 : entry.bytes.length, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    localRecords.push(local, compressed);
    if (options.descriptor) {
      const descriptor = Buffer.alloc(16);
      descriptor.writeUInt32LE(0x08074b50, 0);
      descriptor.writeUInt32LE(checksum, 4);
      descriptor.writeUInt32LE(compressed.length, 8);
      descriptor.writeUInt32LE(entry.bytes.length, 12);
      localRecords.push(descriptor);
    }

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(options.deflate ? 8 : 0, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.bytes.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(0x81a40000, 38);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    centralRecords.push(central);
    offset += local.length + compressed.length + (options.descriptor ? 16 : 0);
  }
  const directory = Buffer.concat(centralRecords);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localRecords, directory, end]);
}

function png(width = 1, height = 1): Buffer {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  function chunk(type: string, data: Buffer): Buffer {
    const typeBytes = Buffer.from(type, "ascii");
    const result = Buffer.alloc(12 + data.length);
    result.writeUInt32BE(data.length, 0);
    typeBytes.copy(result, 4);
    data.copy(result, 8);
    result.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 8 + data.length);
    return result;
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const scanlines = Buffer.alloc(height * (width * 4 + 1));
  return Buffer.concat([
    signature,
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(scanlines)),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

function packageFiles(options: {
  readonly path?: string;
  readonly asset?: Buffer;
  readonly declaredHash?: string;
  readonly themeId?: string;
  readonly version?: string;
} = {}): { readonly entries: { path: string; bytes: Buffer }[]; readonly manifest: Record<string, unknown> } {
  const assetPath = options.path ?? "images/logo.png";
  const asset = options.asset ?? png();
  const digest = options.declaredHash ??
    createHash("sha256").update(asset).digest("hex");
  const assets = assetPath === "images/logo.png"
    ? { required: { logo: { path: assetPath, sha256: digest } }, optional: {} }
    : { required: { logo: { path: assetPath, sha256: digest } }, optional: {} };
  const manifest: Record<string, unknown> = {
    ...defaultThemeDefinition,
    id: options.themeId ?? "test-theme",
    name: "Test Theme",
    version: options.version ?? "1.0.0",
    assets
  };
  manifest.assetsDigest = calculateThemePackageDigest(manifest);
  const entries = [
    { path: "theme.json", bytes: Buffer.from(JSON.stringify(manifest), "utf8") },
    { path: assetPath, bytes: asset }
  ];
  return { entries, manifest };
}

function fixture() {
  temporaryDirectory = mkdtempSync(join(tmpdir(), "multiplayer-game-theme-package-"));
  const database = openDatabase(join(temporaryDirectory, "test.sqlite"));
  runMigrations(database);
  const modules = new Map([
    [`${defaultModuleFactory.metadata.id}@${defaultModuleFactory.metadata.version}`, defaultModuleFactory.metadata]
  ]);
  const renderers = new Map([
    [`${defaultSkinFactory.metadata.id}@${defaultSkinFactory.metadata.version}`, defaultSkinFactory.metadata]
  ]);
  return {
    database,
    modules,
    renderers,
    archivePath: join(temporaryDirectory, "theme.zip"),
    assetDirectory: join(temporaryDirectory, "var", "themes")
  };
}

describe("theme package validation and installation", () => {
  it("streams a valid ZIP asset, checks its manifest hash and registers atomically", async () => {
    const state = fixture();
    const files = packageFiles();
    writeFileSync(state.archivePath, createZip(files.entries, { deflate: true, descriptor: true }));
    try {
      const installed = await validateAndInstallThemePackage(
        state.database,
        state.archivePath,
        state.assetDirectory,
        state.modules,
        state.renderers
      );
      expect(installed.revision.definition.id).toBe("test-theme");
      expect(installed.assetRoot).toContain(installed.revision.packageDigest);
      expect(readFileSync(join(installed.assetRoot, "images", "logo.png"))).toEqual(png());
      expect(state.database.prepare(
        "SELECT theme_id, version, digest, asset_root FROM theme_revisions WHERE theme_id = ?"
      ).get("test-theme")).toEqual({
        theme_id: "test-theme",
        version: "1.0.0",
        digest: installed.revision.packageDigest,
        asset_root: installed.assetRoot
      });
    } finally {
      state.database.close();
    }
  });

  it("rejects executable files, unsafe paths and unregistered code without changing the registry", async () => {
    const state = fixture();
    try {
      const executable = packageFiles({ path: "scripts/module.js", asset: Buffer.from("export default 1;") });
      writeFileSync(state.archivePath, createZip(executable.entries));
      await expect(validateAndInstallThemePackage(
        state.database, state.archivePath, state.assetDirectory, state.modules, state.renderers
      )).rejects.toThrow("not allowed");

      writeFileSync(state.archivePath, createZip([
        { path: "../escape.txt", bytes: Buffer.from("no") }
      ]));
      await expect(validateAndInstallThemePackage(
        state.database, state.archivePath, state.assetDirectory, state.modules, state.renderers
      )).rejects.toThrow("Unsafe ZIP entry path");

      const unknownCode = packageFiles();
      const manifest = JSON.parse(unknownCode.entries[0]!.bytes.toString("utf8")) as Record<string, unknown>;
      manifest.module = { id: "unregistered", version: "1.0.0", stateSchemaVersion: 4 };
      manifest.skin = {
        rendererId: "default",
        version: "1.0.0",
        acceptedModuleId: "unregistered",
        acceptedStateSchemaVersions: [4]
      };
      manifest.assetsDigest = calculateThemePackageDigest(manifest);
      unknownCode.entries[0]!.bytes = Buffer.from(JSON.stringify(manifest));
      writeFileSync(state.archivePath, createZip(unknownCode.entries));
      await expect(validateAndInstallThemePackage(
        state.database, state.archivePath, state.assetDirectory, state.modules, state.renderers
      )).rejects.toThrow("Game module unregistered@1.0.0 is not registered");

      expect(state.database.prepare("SELECT COUNT(*) AS count FROM theme_revisions").get())
        .toEqual({ count: 1 });
      expect(existsSync(state.assetDirectory)).toBe(false);
    } finally {
      state.database.close();
    }
  });

  it("rejects bad asset hashes, image bounds, CRC errors and overfull archives", async () => {
    const state = fixture();
    try {
      const badHash = packageFiles({ declaredHash: "0".repeat(64) });
      writeFileSync(state.archivePath, createZip(badHash.entries));
      await expect(validateAndInstallThemePackage(
        state.database, state.archivePath, state.assetDirectory, state.modules, state.renderers
      )).rejects.toThrow("does not match its declared SHA-256");

      const largeImage = packageFiles({ asset: png(4097, 1) });
      writeFileSync(state.archivePath, createZip(largeImage.entries));
      await expect(validateAndInstallThemePackage(
        state.database, state.archivePath, state.assetDirectory, state.modules, state.renderers
      )).rejects.toThrow("exceeds the 4096px edge limit");

      const valid = packageFiles();
      const corrupt = createZip(valid.entries);
      const corruptionByte = corrupt[35];
      if (corruptionByte === undefined) throw new Error("ZIP fixture is missing the corruption byte.");
      corrupt[35] = corruptionByte ^ 0xff;
      writeFileSync(state.archivePath, corrupt);
      await expect(validateAndInstallThemePackage(
        state.database, state.archivePath, state.assetDirectory, state.modules, state.renderers
      )).rejects.toThrow();

      const tooManyEntries = createZip(Array.from(
        { length: MAX_THEME_ARCHIVE_ENTRIES + 1 },
        (_, index) => ({ path: `empty-${index}.png`, bytes: Buffer.alloc(0) })
      ));
      writeFileSync(state.archivePath, tooManyEntries);
      await expect(validateAndInstallThemePackage(
        state.database, state.archivePath, state.assetDirectory, state.modules, state.renderers
      )).rejects.toThrow("entry limit");

      expect(state.database.prepare("SELECT COUNT(*) AS count FROM theme_revisions").get())
        .toEqual({ count: 1 });
    } finally {
      state.database.close();
    }
  });

  it("removes a promoted content directory when database registration conflicts", async () => {
    const state = fixture();
    const files = packageFiles({
      themeId: "default",
      version: "1.0.0"
    });
    writeFileSync(state.archivePath, createZip(files.entries));
    try {
      await expect(validateAndInstallThemePackage(
        state.database,
        state.archivePath,
        state.assetDirectory,
        state.modules,
        state.renderers
      )).rejects.toThrow();
      expect(state.database.prepare("SELECT COUNT(*) AS count FROM theme_revisions").get())
        .toEqual({ count: 1 });
      expect(existsSync(state.assetDirectory)).toBe(true);
      expect(
        (await import("node:fs")).readdirSync(state.assetDirectory)
      ).toEqual([]);
    } finally {
      state.database.close();
    }
  });
});
