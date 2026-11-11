import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { validateAndInstallThemePackage } from "../apps/server/src/themes/packages.ts";
import { openDatabase, runMigrations } from "../apps/server/src/storage/database.ts";
import { calculateThemePackageDigest } from "@multiplayer-game/theme-sdk/package";

const [sample, state] = process.argv.slice(2).map(path => resolve(path));
assert.ok(sample && state, "Provide the unpacked sample and disposable state directories.");
const { sampleGameModule } = await import(pathToFileURL(join(sample, "src", "game.js")).href);
const { sampleSkinFactory } = await import(pathToFileURL(join(sample, "src", "skin.js")).href);
const archive = join(sample, "theme-assets.zip");
const before = await readFile(archive);
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const database = openDatabase(join(state, "import.sqlite"));
try {
  runMigrations(database);
  const modules = new Map([[`${sampleGameModule.metadata.id}@${sampleGameModule.metadata.version}`,
    sampleGameModule.metadata]]);
  const renderers = new Map([[`${sampleSkinFactory.metadata.id}@${sampleSkinFactory.metadata.version}`,
    sampleSkinFactory.metadata]]);
  const beforeCount = database.prepare("SELECT COUNT(*) AS count FROM theme_revisions").get().count;
  await assert.rejects(validateAndInstallThemePackage(database, archive,
    join(state, "assets"), new Map(), new Map()), /registered|installed/i);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM theme_revisions").get().count, beforeCount,
    "Unregistered code must not install a revision.");
  const installed = await validateAndInstallThemePackage(database, archive,
    join(state, "assets"), modules, renderers);
  assert.deepEqual(await readFile(archive), before, "Importer must not change the exact exported ZIP.");
  const manifest = JSON.parse(await readFile(join(installed.assetRoot, "theme.json"), "utf8"));
  const source = JSON.parse(await readFile(join(sample, "theme.json"), "utf8"));
  for (const key of ["project", "author", "course"]) assert.equal(manifest[key], source[key]);
  assert.equal(manifest.assetsDigest, calculateThemePackageDigest(manifest));
  assert.equal(installed.revision.packageDigest, manifest.assetsDigest);
  assert.deepEqual((await readdir(installed.assetRoot)).sort(), ["theme.json"],
    "The sample's asset package contains no executable project files.");
  assert.deepEqual(database.prepare(
    "SELECT digest, asset_root FROM theme_revisions WHERE theme_id = ? AND version = ?"
  ).get(manifest.id, manifest.version), {
    digest: manifest.assetsDigest, asset_root: installed.assetRoot
  });
  assert.equal((await readdir(state)).some(path => path.startsWith(".theme-staging-")), false);
  console.log(`Real importer passed: exact asset ZIP SHA-256 ${hash(before)}; credits, digest and registry match.`);
  console.log("Unregistered code rejection passed; sample metadata registration was test-only.");
} finally {
  database.close();
}
