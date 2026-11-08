import { createHash, type Hash } from "node:crypto";
import { z } from "zod";
import { ThemeDefinitionSchema, type ThemeDefinition } from "./index.js";

export const MAX_THEME_ARCHIVE_BYTES = 10 * 1024 * 1024;
export const MAX_THEME_EXTRACTED_BYTES = 40 * 1024 * 1024;
export const MAX_THEME_ARCHIVE_ENTRIES = 256;
export const MAX_THEME_IMAGE_EDGE = 4096;
export const MAX_THEME_IMAGE_PIXELS = 32_000_000;
export const MAX_THEME_MANIFEST_BYTES = 256 * 1024;
export const MAX_THEME_PATH_BYTES = 512;

function requiredCredit(label: string, field: string) {
  const message = `${label} (${field}) is required and must be a nonblank string.`;
  return z.string({ error: message }).refine((value) => value.trim().length > 0, { message });
}

export const ThemeCreditsSchema = z.object({
  project: requiredCredit("Project", "project"),
  author: requiredCredit("Author", "author"),
  course: z.string().optional()
}).strict();

export const ThemeImportDefinitionSchema = ThemeDefinitionSchema.safeExtend(ThemeCreditsSchema.shape);
export type ThemeImportDefinition = z.infer<typeof ThemeImportDefinitionSchema>;

export const AssetDeclarationSchema = z.object({
  path: z.string().min(1).max(MAX_THEME_PATH_BYTES),
  sha256: z.string().regex(/^[a-f0-9]{64}$/)
}).strict();

export const PackageAssetsSchema = z.object({
  required: z.record(z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/), AssetDeclarationSchema),
  optional: z.record(z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/), AssetDeclarationSchema)
}).strict();

export const ThemePackageManifestSchema = ThemeImportDefinitionSchema.safeExtend({
  assets: PackageAssetsSchema
}).strict();

export type ThemePackageManifest = z.infer<typeof ThemePackageManifestSchema>;
export type AssetDeclaration = z.infer<typeof AssetDeclarationSchema>;
export type PackageAssets = z.infer<typeof PackageAssetsSchema>;

export function runtimeThemeDefinition(manifest: ThemeImportDefinition): ThemeDefinition {
  const { project: _project, author: _author, course: _course, ...definition } = manifest;
  return definition;
}

export function createThemeAssetHash(): Hash {
  return createHash("sha256");
}

export function calculateThemeAssetHash(bytes: Uint8Array): string {
  return createThemeAssetHash().update(bytes).digest("hex");
}

export function validateThemePackageAssets(
  manifest: ThemePackageManifest,
  files: ReadonlyMap<string, Readonly<{ sha256: string }>>
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
