import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { access, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temporaryDirectory = await mkdtemp(join(tmpdir(), "multiplayer-local-preview-"));
const archiveDirectory = join(temporaryDirectory, "packages");
const sampleDirectory = join(temporaryDirectory, "external-sample");
const sampleSource = join(root, "examples", "local-preview");
const generatedSampleDist = join(sampleSource, "dist");
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("Run this verifier through `npm run theme:preview:verify`.");
const keepTemporaryDirectory = process.argv.includes("--keep");

function runNpm(args, cwd = root) {
  execFileSync(process.execPath, [npmCli, ...args], {
    cwd,
    stdio: "inherit"
  });
}

async function pack(packageDirectory) {
  const output = execFileSync(process.execPath, [npmCli,
    "pack",
    "--json",
    "--pack-destination",
    archiveDirectory,
    join(root, packageDirectory)
  ], { cwd: root, encoding: "utf8" });
  const [result] = JSON.parse(output);
  if (!result?.filename) throw new Error(`npm pack returned no filename for ${packageDirectory}.`);
  return join(archiveDirectory, result.filename);
}

try {
  await mkdir(archiveDirectory);
  await cp(sampleSource, sampleDirectory, {
    recursive: true,
    filter: source => source !== generatedSampleDist &&
      !source.startsWith(`${generatedSampleDist}${sep}`)
  });
  for (const workspace of [
    "@multiplayer-game/protocol",
    "@multiplayer-game/theme-sdk",
    "@multiplayer-game/engine",
    "@multiplayer-game/local-preview"
  ]) {
    runNpm(["run", "build", "--workspace", workspace]);
  }
  const archives = await Promise.all([
    pack("packages/protocol"),
    pack("packages/theme-sdk"),
    pack("packages/local-preview")
  ]);
  const sampleManifestPath = join(sampleDirectory, "package.json");
  const sampleManifest = JSON.parse(await readFile(sampleManifestPath, "utf8"));
  const archiveDependency = archive => {
    const relativePath = relative(sampleDirectory, archive).split(sep).join("/");
    return `file:${relativePath}`;
  };
  sampleManifest.dependencies["@multiplayer-game/protocol"] = archiveDependency(archives[0]);
  sampleManifest.dependencies["@multiplayer-game/theme-sdk"] = archiveDependency(archives[1]);
  sampleManifest.dependencies["@multiplayer-game/local-preview"] = archiveDependency(archives[2]);
  await writeFile(sampleManifestPath, `${JSON.stringify(sampleManifest, null, 2)}\n`);
  runNpm(["install", "--no-audit", "--no-fund"], sampleDirectory);
  const installedRuntime = join(sampleDirectory, "node_modules", "@multiplayer-game", "local-preview");
  const runtimeCode = await readFile(join(installedRuntime, "dist", "index.js"), "utf8");
  const runtimeTypes = await readFile(join(installedRuntime, "dist", "index.d.ts"), "utf8");
  assert.ok(!runtimeCode.includes("@multiplayer-game/engine"));
  assert.ok(!runtimeTypes.includes("@multiplayer-game/engine"));
  assert.ok(!runtimeCode.includes("apps/client/src"));
  assert.ok(!runtimeCode.includes("apps/server/src"));
  const enginePackageInstalled = await access(
    join(sampleDirectory, "node_modules", "@multiplayer-game", "engine")
  ).then(() => true, () => false);
  assert.equal(enginePackageInstalled, false, "the external sample must not install the engine workspace package");
  runNpm(["run", "verify"], sampleDirectory);
  runNpm(["run", "build"], sampleDirectory);
  console.log("External sample passed from built npm packages in a clean folder without an engine checkout.");
} finally {
  if (keepTemporaryDirectory) {
    console.log(`Kept external sample at ${sampleDirectory}`);
  } else {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}
