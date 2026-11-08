import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  calculateThemeAssetHash,
  calculateThemePackageDigest,
  createThemeAssetHash,
  MAX_THEME_ARCHIVE_BYTES,
  MAX_THEME_ARCHIVE_ENTRIES,
  MAX_THEME_EXTRACTED_BYTES,
  MAX_THEME_IMAGE_EDGE,
  MAX_THEME_IMAGE_PIXELS,
  MAX_THEME_MANIFEST_BYTES,
  MAX_THEME_PATH_BYTES,
  ThemeCreditsSchema,
  ThemePackageManifestSchema,
  runtimeThemeDefinition,
  validateThemePackageAssets
} from "@multiplayer-game/theme-sdk/package";
import {
  defaultModuleFactory, defaultSkinFactory, defaultThemeDefinition
} from "@multiplayer-game/default-theme";
import { validateAndInstallThemePackage } from "../apps/server/src/themes/packages.js";
import { openDatabase, runMigrations } from "../apps/server/src/storage/database.js";
import { png } from "./helpers/theme-archive.js";

describe("public Node theme package contract", () => {
  it.each(["project", "author"] as const)("preserves exact %s errors and credit bytes", (field) => {
    const credits = { project: "  Public project  ", author: "Public team", course: "" };
    for (const value of [undefined, "", " \t\r\n\u00a0", null, 42]) {
      const result = ThemeCreditsSchema.safeParse({ ...credits, [field]: value });
      expect(result.success).toBe(false);
      if (result.success) throw new Error("Invalid credit unexpectedly passed.");
      expect(result.error.issues).toEqual([expect.objectContaining({
        path: [field],
        message: `${field === "project" ? "Project" : "Author"} (${field}) is required and must be a nonblank string.`
      })]);
    }
    expect(ThemeCreditsSchema.parse(credits)).toEqual(credits);
  });

  it("retains canonical digest semantics and raw/streamed asset SHA-256", () => {
    const canonical = '{"assets":{"optional":{},"required":{"logo":{"path":"logo.png","sha256":"abc"}}},"author":"Team","project":" Project "}';
    const manifest = {
      project: " Project ", author: "Team", assetsDigest: "ignored",
      assets: { required: { logo: { sha256: "abc", path: "logo.png" } }, optional: {} }
    };
    const expected = createHash("sha256").update(canonical, "utf8").digest("hex");
    expect(calculateThemePackageDigest(manifest)).toBe(expected);
    expect(calculateThemePackageDigest({ ...manifest, assetsDigest: "another value" })).toBe(expected);
    expect(calculateThemePackageDigest({ ...manifest, project: "Project" })).not.toBe(expected);
    const bytes = png();
    const streamHash = createThemeAssetHash().update(bytes.subarray(0, 10)).update(bytes.subarray(10));
    expect(calculateThemeAssetHash(bytes)).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(streamHash.digest("hex")).toBe(calculateThemeAssetHash(bytes));
    expect(calculateThemePackageDigest({ items: [{ z: 1, a: 2 }, "é"] }))
      .toBe(createHash("sha256").update('{"items":[{"a":2,"z":1},"é"]}', "utf8").digest("hex"));
    expect(calculateThemePackageDigest({ items: ["é", { z: 1, a: 2 }] }))
      .not.toBe(calculateThemePackageDigest({ items: [{ z: 1, a: 2 }, "é"] }));
  });

  it("preserves strict manifest validation and inherited module/skin refinements", () => {
    const manifest = {
      ...defaultThemeDefinition, project: "Public project", author: "Public team",
      assets: { required: {}, optional: {} }
    };
    expect(ThemePackageManifestSchema.parse(manifest)).toEqual(manifest);
    for (const input of [
      { ...manifest, unknown: true },
      { ...manifest, course: 42 },
      { ...manifest, skin: { ...manifest.skin, acceptedModuleId: "different" } },
      { ...manifest, skin: { ...manifest.skin, acceptedStateSchemaVersions: [99] } },
      { ...manifest, assets: { required: {} } },
      { ...manifest, assets: { required: { "Invalid ID": { path: "x.png", sha256: "0".repeat(64) } }, optional: {} } },
      { ...manifest, assets: { required: { logo: { path: "", sha256: "0".repeat(64) } }, optional: {} } },
      { ...manifest, assets: { required: { logo: { path: "x".repeat(513), sha256: "0".repeat(64) } }, optional: {} } },
      { ...manifest, assets: { required: { logo: { path: "x.png", sha256: "A".repeat(64) } }, optional: {} } }
    ]) {
      expect(ThemePackageManifestSchema.safeParse(input).success).toBe(false);
    }
  });

  it("exports the unchanged importer budgets and no Node dependency from the browser root", () => {
    expect([
      MAX_THEME_ARCHIVE_BYTES, MAX_THEME_EXTRACTED_BYTES, MAX_THEME_ARCHIVE_ENTRIES,
      MAX_THEME_IMAGE_EDGE, MAX_THEME_IMAGE_PIXELS, MAX_THEME_MANIFEST_BYTES, MAX_THEME_PATH_BYTES
    ]).toEqual([10 * 1024 * 1024, 40 * 1024 * 1024, 256, 4096, 32_000_000, 256 * 1024, 512]);
    const visited = new Set<string>();
    function checkBrowserModule(path: string): void {
      if (visited.has(path)) return;
      visited.add(path);
      const source = readFileSync(path, "utf8");
      expect(source).not.toMatch(/(?:from\s*|import\s*\()\s*["']node:/);
      expect(source).not.toContain("./package.js");
      for (const match of source.matchAll(/(?:from\s*|import\s*\()\s*["'](\.[^"']+)["']/g)) {
        checkBrowserModule(resolve(dirname(path), match[1]!));
      }
    }
    checkBrowserModule(resolve("packages", "theme-sdk", "dist", "index.js"));
    checkBrowserModule(resolve("packages", "protocol", "dist", "index.js"));
    const metadata = JSON.parse(readFileSync(resolve("packages", "theme-sdk", "package.json"), "utf8"));
    expect(metadata.exports["./package"]).toEqual({
      node: { types: "./dist/package.d.ts", import: "./dist/package.js" }
    });
  });

  it("shares asset mapping validation including missing optional files and duplicate declarations", () => {
    const sha256 = calculateThemeAssetHash(png());
    const manifest = ThemePackageManifestSchema.parse({
      ...defaultThemeDefinition, project: "Public project", author: "Public team",
      assets: {
        required: { logo: { path: "images/logo.png", sha256 } },
        optional: { alternate: { path: "images/alternate.png", sha256 } }
      }
    });
    const files = new Map([["images/logo.png", { sha256 }]]);
    expect(() => validateThemePackageAssets(manifest, files)).not.toThrow();
    expect(() => validateThemePackageAssets(manifest, new Map())).toThrow("missing");
    expect(() => validateThemePackageAssets(manifest,
      new Map([["images/logo.png", { sha256: "0".repeat(64) }]]))).toThrow("declared SHA-256");
    expect(() => validateThemePackageAssets(manifest,
      new Map([...files, ["images/undeclared.png", { sha256 }]]))).toThrow("undeclared");
    expect(() => validateThemePackageAssets({
      ...manifest, assets: { ...manifest.assets, optional: { logo: { path: "other.png", sha256 } } }
    }, files)).toThrow("Theme asset ID logo is declared more than once");
    expect(() => validateThemePackageAssets({
      ...manifest, assets: { ...manifest.assets, optional: { alternate: { path: "IMAGES/LOGO.PNG", sha256 } } }
    }, files)).toThrow("declared more than once or reserved");
    expect(() => validateThemePackageAssets({
      ...manifest, assets: { required: { logo: { path: "theme.json", sha256 } }, optional: {} }
    }, files)).toThrow("reserved");
  });

  it("imports the exact ZIP built by an isolated npm-packed public API consumer", async () => {
    const root = resolve(".");
    const directory = mkdtempSync(join(tmpdir(), "multiplayer-public-package-"));
    const database = openDatabase(join(directory, "test.sqlite"));
    try {
      runMigrations(database);
      const dependencies: Record<string, string> = {};
      for (const path of [
        join("packages", "protocol"), join("packages", "theme-sdk"), join("node_modules", "zod")
      ]) {
        const packageDirectory = resolve(root, path);
        const metadata = JSON.parse(readFileSync(join(packageDirectory, "package.json"), "utf8")) as {
          name: string;
        };
        const output = runNpm(["pack", "--ignore-scripts", "--json", "--pack-destination", directory],
          packageDirectory);
        const packed = JSON.parse(output) as Array<{ filename: string }>;
        if (!packed[0]) throw new Error(`npm pack produced no artifact for ${metadata.name}.`);
        dependencies[metadata.name] = `file:./${packed[0].filename}`;
      }
      writeFileSync(join(directory, "package.json"), JSON.stringify({
        private: true, type: "module", dependencies
      }));
      runNpm(["install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund",
        "--package-lock=false"], directory);
      copyFileSync(join(root, "tests", "fixtures", "public-theme-package.mjs"),
        join(directory, "public-theme-package.mjs"));
      copyFileSync(join(root, "tests", "helpers", "theme-archive.ts"), join(directory, "theme-archive.ts"));
      writeFileSync(join(directory, "definition.json"), JSON.stringify(defaultThemeDefinition));
      execFileSync(process.execPath, ["public-theme-package.mjs"],
        { cwd: directory, encoding: "utf8", timeout: 10_000 });

      const archivePath = join(directory, "theme.zip");
      const exactZip = readFileSync(archivePath);
      const manifest = ThemePackageManifestSchema.parse(
        JSON.parse(readFileSync(join(directory, "expected.json"), "utf8"))
      );
      const installed = await validateAndInstallThemePackage(
        database, archivePath, join(directory, "assets"),
        new Map([[`${defaultModuleFactory.metadata.id}@${defaultModuleFactory.metadata.version}`,
          defaultModuleFactory.metadata]]),
        new Map([[`${defaultSkinFactory.metadata.id}@${defaultSkinFactory.metadata.version}`,
          defaultSkinFactory.metadata]])
      );
      expect(readFileSync(archivePath)).toEqual(exactZip);
      expect(readFileSync(join(installed.assetRoot, "theme.json")))
        .toEqual(readFileSync(join(directory, "expected.json")));
      expect(manifest).toMatchObject({
        project: "  Public package project  ", author: "Public fixture team", course: "Optional course"
      });
      for (const [id, expectedBytes] of [["logo", png()], ["alternate", png(2, 1)]] as const) {
        const mapping = manifest.assets.required[id] ?? manifest.assets.optional[id];
        if (!mapping) throw new Error(`Missing fixture mapping ${id}.`);
        const installedBytes = readFileSync(join(installed.assetRoot, ...mapping.path.split("/")));
        expect(installedBytes).toEqual(expectedBytes);
        expect(createHash("sha256").update(installedBytes).digest("hex")).toBe(mapping.sha256);
      }
      expect(existsSync(join(installed.assetRoot, "images", "absent.png"))).toBe(false);
      expect(installed.revision.packageDigest).toBe(calculateThemePackageDigest(manifest));
      expect(installed.revision.definition.assetsDigest).toBe(manifest.assetsDigest);
      expect(database.prepare(
        "SELECT digest, asset_root FROM theme_revisions WHERE theme_id = ? AND version = ?"
      ).get(manifest.id, manifest.version)).toEqual({
        digest: manifest.assetsDigest, asset_root: installed.assetRoot
      });
      const { assets: _assets, ...definition } = manifest;
      expect(installed.revision.definition).toEqual(runtimeThemeDefinition(definition));
      for (const field of ["project", "author", "course", "assets"]) {
        expect(installed.revision.definition).not.toHaveProperty(field);
      }
    } finally {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  }, 60_000);
});

function runNpm(args: readonly string[], cwd: string): string {
  const npmCli = process.env.npm_execpath;
  if (!npmCli) throw new Error("Run the packaged public API test through npm test to locate npm's CLI.");
  return execFileSync(process.execPath, [npmCli, ...args], {
    cwd, encoding: "utf8", timeout: 30_000
  });
}
