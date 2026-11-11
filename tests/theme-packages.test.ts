import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createThemeZip as createZip, png } from "./helpers/theme-archive.js";
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
    project: "Package validation fixture",
    author: "Engine test team",
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
    registryBefore: database.prepare("SELECT * FROM theme_revisions ORDER BY theme_id, version").all(),
    modules,
    renderers,
    archivePath: join(temporaryDirectory, "theme.zip"),
    assetDirectory: join(temporaryDirectory, "var", "themes")
  };
}

describe("theme package validation and installation", () => {
  it.each(["project", "author"] as const)(
    "rejects missing, blank and non-string %s without changing installed themes",
    async (field) => {
      const state = fixture();
      try {
        for (const value of [undefined, "", " \t\r\n\u00a0", null, 42]) {
          const files = packageFiles();
          if (value === undefined) delete files.manifest[field];
          else files.manifest[field] = value;
          files.manifest.assetsDigest = calculateThemePackageDigest(files.manifest);
          files.entries[0]!.bytes = Buffer.from(JSON.stringify(files.manifest));
          writeFileSync(state.archivePath, createZip(files.entries));
          await expect(validateAndInstallThemePackage(
            state.database, state.archivePath, state.assetDirectory, state.modules, state.renderers
          )).rejects.toThrow(`${field === "project" ? "Project" : "Author"} (${field})`);
          expect(state.database.prepare("SELECT * FROM theme_revisions ORDER BY theme_id, version").all())
            .toEqual(state.registryBefore);
          expect(existsSync(state.assetDirectory)).toBe(false);
        }
      } finally {
        state.database.close();
      }
    }
  );

  it("identifies both missing credit fields", async () => {
    const state = fixture();
    const files = packageFiles();
    delete files.manifest.project;
    delete files.manifest.author;
    files.manifest.assetsDigest = calculateThemePackageDigest(files.manifest);
    files.entries[0]!.bytes = Buffer.from(JSON.stringify(files.manifest));
    writeFileSync(state.archivePath, createZip(files.entries));
    try {
      await expect(validateAndInstallThemePackage(
        state.database, state.archivePath, state.assetDirectory, state.modules, state.renderers
      )).rejects.toThrow(/Project \(project\)[\s\S]*Author \(author\)/);
    } finally {
      state.database.close();
    }
  });

  it("preserves credited manifest bytes and digest without requiring a runtime migration", async () => {
    const state = fixture();
    const files = packageFiles();
    files.manifest.project = "  Test project  ";
    files.manifest.author = "  Public theme team  ";
    files.manifest.course = "Optional course";
    files.manifest.assetsDigest = calculateThemePackageDigest(files.manifest);
    files.entries[0]!.bytes = Buffer.from(JSON.stringify(files.manifest));
    writeFileSync(state.archivePath, createZip(files.entries));
    try {
      const installed = await validateAndInstallThemePackage(
        state.database, state.archivePath, state.assetDirectory, state.modules, state.renderers
      );
      expect(readFileSync(join(installed.assetRoot, "theme.json"))).toEqual(files.entries[0]!.bytes);
      expect(installed.revision.packageDigest).toBe(files.manifest.assetsDigest);
      expect(installed.revision.definition).not.toHaveProperty("project");
      expect(installed.revision.definition).not.toHaveProperty("author");
      expect(installed.revision.definition).not.toHaveProperty("course");
    } finally {
      state.database.close();
    }
  });

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

      expect(state.database.prepare("SELECT * FROM theme_revisions ORDER BY theme_id, version").all())
        .toEqual(state.registryBefore);
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

      expect(state.database.prepare("SELECT * FROM theme_revisions ORDER BY theme_id, version").all())
        .toEqual(state.registryBefore);
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
      expect(state.database.prepare("SELECT * FROM theme_revisions ORDER BY theme_id, version").all())
        .toEqual(state.registryBefore);
      expect(existsSync(state.assetDirectory)).toBe(true);
      expect(
        (await import("node:fs")).readdirSync(state.assetDirectory)
      ).toEqual([]);
    } finally {
      state.database.close();
    }
  });
});
