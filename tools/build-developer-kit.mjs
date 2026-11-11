import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const revision = "570884aa82a18bdee2d4d58c18265098164238ba";
const version = "0.1.0";
const args = process.argv.slice(2);
assert.ok(args.length === 2 && args[0] === "--themes-directory",
  "Usage: npm run kit:build -- --themes-directory <existing-themes-checkout>");
const companion = resolve(args[1]);
const npmCli = process.env.npm_execpath;
assert.ok(npmCli, "Run through npm run kit:build.");
const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
assert.equal(head, revision, "Kit must use the authorized engine revision.");
execFileSync("git", ["diff", "--exit-code", revision, "--",
  "packages/protocol", "packages/theme-sdk", "packages/engine", "packages/local-preview"],
{ cwd: root, stdio: "inherit" });
const companionRequire = createRequire(join(companion, "package.json"));
const { zipSync } = companionRequire("fflate");
const staging = await mkdtemp(join(tmpdir(), "multiplayer-kit-build-"));
const outputDirectory = join(root, "var", "developer-kit");
const archiveName = `multiplayer-game-developer-kit-${version}-${revision.slice(0, 12)}.zip`;
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
function npm(args, cwd = root) {
  return execFileSync(process.execPath, [npmCli, ...args], { cwd, encoding: "utf8", stdio: "pipe" });
}
async function copy(source, destination) {
  await cp(join(root, source), join(staging, destination), { recursive: true });
}
async function stripMapReferences(path) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const file = join(path, entry.name);
    if (entry.isDirectory()) await stripMapReferences(file);
    else if (entry.name.endsWith(".js")) {
      const source = await readFile(file, "utf8");
      await writeFile(file, source.replace(/^\/\/# sourceMappingURL=.*\r?\n?/gm, ""));
    }
  }
}
try {
  for (const workspace of ["protocol", "theme-sdk", "engine", "local-preview"]) {
    console.log(`Building ${workspace}`);
    process.stdout.write(npm(["run", "build", "--workspace", `@multiplayer-game/${workspace}`]));
  }
  await mkdir(join(staging, "packages"));
  await mkdir(join(staging, "tools"));
  await mkdir(join(staging, "sample", "scripts"), { recursive: true });
  const packages = [];
  const packageInputs = await mkdtemp(join(tmpdir(), "multiplayer-kit-packages-"));
  try {
    for (const directory of [
      join(root, "packages", "protocol"), join(root, "packages", "theme-sdk"),
      join(root, "packages", "local-preview"), join(root, "node_modules", "zod"),
      dirname(companionRequire.resolve("fflate/package.json"))
    ]) {
      let packageDirectory = directory;
      if (directory.startsWith(join(root, "packages"))) {
        const metadata = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
        packageDirectory = join(packageInputs, metadata.name.split("/").at(-1));
        await mkdir(packageDirectory);
        await cp(join(directory, "package.json"), join(packageDirectory, "package.json"));
        await cp(join(directory, "dist"), join(packageDirectory, "dist"), {
          recursive: true, filter: source => !source.endsWith(".map")
        });
        await stripMapReferences(join(packageDirectory, "dist"));
      }
      const [packed] = JSON.parse(npm(["pack", "--ignore-scripts", "--json",
        "--pack-destination", join(staging, "packages")], packageDirectory));
      assert.ok(packed?.filename, `No npm artifact for ${directory}`);
      if (packed.name.startsWith("@multiplayer-game/")) {
        assert.ok(packed.files.every(file => file.path === "package.json" ||
          (file.path.startsWith("dist/") && !file.path.endsWith(".map"))),
        `Unexpected source/nonpublic file in ${packed.name}`);
      }
      packages.push({ name: packed.name, version: packed.version, file: `packages/${packed.filename}` });
    }
  } finally {
    await rm(packageInputs, { recursive: true, force: true });
  }
  for (const file of [".gitignore", "index.html", "vite.config.js", "README.md", "theme.json"]) {
    await copy(join("examples", "local-preview", file), join("sample", file));
  }
  await mkdir(join(staging, "sample", "src"));
  for (const file of ["game.js", "main.js", "map.js", "settings.js", "skin.js"]) {
    await copy(join("examples", "local-preview", "src", file), join("sample", "src", file));
  }
  for (const file of ["verify.mjs", "browser-smoke.mjs"]) {
    await copy(join("examples", "local-preview", "scripts", file), join("sample", "scripts", file));
  }
  const tools = [];
  await mkdir(join(staging, "sample", ".kit-tools"));
  for (const file of ["theme_export.mjs", "theme_credits.py"]) {
    const source = await readFile(join(companion, "tools", file));
    const committed = execFileSync("git", ["show", `HEAD:tools/${file}`], { cwd: companion });
    assert.equal(source.toString("utf8").replaceAll("\r\n", "\n"),
      committed.toString("utf8").replaceAll("\r\n", "\n"),
      `Companion ${file} has uncommitted changes; stop for review.`);
    await writeFile(join(staging, "sample", ".kit-tools", file), source);
    tools.push({ path: `sample/.kit-tools/${file}`, sha256: sha256(source) });
  }
  await copy(join("tools", "developer-kit-checksums.mjs"), join("tools", "checksums.mjs"));
  await copy(join("docs", "developer-kit.md"), "README.md");
  await copy(join("docs", "developer-kit-api.md"), "API.md");
  const manifest = JSON.parse(await readFile(join(root, "examples", "local-preview", "package.json"), "utf8"));
  for (const dependency of packages) {
    manifest.dependencies[dependency.name] = `file:../${dependency.file}`;
  }
  manifest.scripts.credits = "python .kit-tools/theme_credits.py .";
  manifest.scripts["theme:export"] = "node .kit-tools/theme_export.mjs .";
  await writeFile(join(staging, "sample", "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(npm(["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"],
    join(staging, "sample")));
  const companionRevision = execFileSync("git", ["rev-parse", "HEAD"],
    { cwd: companion, encoding: "utf8" }).trim();
  await writeFile(join(staging, "kit.json"), `${JSON.stringify({
    name: "multiplayer-game-developer-kit", version, engineRevision: revision,
    packages, companion: { repository: "scottzastrow/multiplayer-game-themes", revision: companionRevision, tools },
    dependencies: "Bundled engine public packages, zod and fflate; registry access required for lockfile-pinned Vite tooling.",
    exclusions: ["backend source", "secrets", "deployment files", "engine checkout", "node_modules"],
    credits: { project: "Local Preview Sample", author: "Scott Zastrow", confirmation: "Explicit owner confirmation; new projects must confirm their own credits." }
  }, null, 2)}\n`);
  const entries = Object.create(null);
  async function collect(directory, prefix = "") {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      assert.ok(!entry.isSymbolicLink(), `Unexpected symlink: ${entry.name}`);
      const path = `${prefix}${entry.name}`;
      if (entry.isDirectory()) await collect(join(directory, entry.name), `${path}/`);
      else entries[path] = await readFile(join(directory, entry.name));
    }
  }
  await collect(staging);
  entries.SHA256SUMS = Buffer.from(Object.keys(entries).sort()
    .map(path => `${sha256(entries[path])}  ${path}\n`).join(""));
  const archive = zipSync(entries, { level: 6, mtime: new Date(1980, 0, 1) });
  await mkdir(outputDirectory, { recursive: true });
  const output = join(outputDirectory, archiveName);
  await writeFile(output, archive, { flag: "wx" });
  await writeFile(`${output}.sha256`, `${sha256(archive)}  ${archiveName}\n`, { flag: "wx" });
  console.log(`Developer Kit: ${output}\nSHA-256: ${sha256(archive)}`);
} finally {
  await rm(staging, { recursive: true, force: true });
}
