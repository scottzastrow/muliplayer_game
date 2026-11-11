import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
assert.ok(args.length === 2 && args[0] === "--archive",
  "Usage: npm run kit:verify -- --archive <developer-kit.zip>");
const archive = resolve(args[1]);
const npmCli = process.env.npm_execpath;
assert.ok(npmCli, "Run through npm run kit:verify.");
const temporary = await mkdtemp(join(tmpdir(), "multiplayer-kit-verify-"));
const extracted = join(temporary, "unpacked");
const sample = join(extracted, "sample");
const processes = [];
let gameSource;
function npm(args, cwd = sample) {
  execFileSync(process.execPath, [npmCli, ...args], { cwd, stdio: "inherit", timeout: 120_000 });
}
async function unusedPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}
function start(command, args, options = {}) {
  const process = spawn(command, args, { stdio: "ignore", ...options });
  let failure;
  process.once("error", error => { failure = error; });
  processes.push(process);
  return () => {
    if (failure) throw failure;
    assert.equal(process.exitCode, null, `${command} exited before becoming responsive.`);
  };
}
async function waitFor(url, check) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    check();
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Owned verification service did not respond: ${url}`);
}
try {
  const expected = (await readFile(`${archive}.sha256`, "utf8")).split("  ")[0];
  assert.equal(createHash("sha256").update(await readFile(archive)).digest("hex"), expected);
  const quote = value => `'${value.replaceAll("'", "''")}'`;
  execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
    `Expand-Archive -LiteralPath ${quote(archive)} -DestinationPath ${quote(extracted)} -ErrorAction Stop`],
  { stdio: "inherit" });
  execFileSync(process.execPath, [join(extracted, "tools", "checksums.mjs")], { stdio: "inherit" });
  const kit = JSON.parse(await readFile(join(extracted, "kit.json"), "utf8"));
  assert.equal(kit.engineRevision, "570884aa82a18bdee2d4d58c18265098164238ba");
  assert.deepEqual(kit.packages.map(pkg => pkg.name).sort(), [
    "@multiplayer-game/local-preview", "@multiplayer-game/protocol",
    "@multiplayer-game/theme-sdk", "fflate", "zod"
  ]);
  npm(["ci", "--no-audit", "--no-fund"]);
  await assert.rejects(access(join(sample, "node_modules", "@multiplayer-game", "engine")));
  const runtime = await readFile(join(sample, "node_modules", "@multiplayer-game", "local-preview", "dist", "index.js"), "utf8");
  assert.ok(!/apps\/(?:server|client)\/src|@multiplayer-game\/engine/.test(runtime));
  const creditedFiles = ["theme.json", "index.html", "vite.config.js",
    ...["game", "main", "map", "settings", "skin"].map(name => join("src", `${name}.js`))];
  const beforeCredits = await Promise.all(creditedFiles.map(file => readFile(join(sample, file))));
  execFileSync(process.execPath, [npmCli, "run", "credits"], {
    cwd: sample, stdio: ["pipe", "inherit", "inherit"], input: `${"\n".repeat(10)}yes\n`,
    timeout: 30_000
  });
  assert.deepEqual(await Promise.all(creditedFiles.map(file => readFile(join(sample, file)))), beforeCredits,
    "Reconfirming the owner's supplied sample credits must preserve source attribution and headers.");
  npm(["run", "verify"]);
  gameSource = await readFile(join(sample, "src", "game.js"), "utf8");
  const edited = gameSource.replace("const SPEED_MULTIPLIER = 1;", "const SPEED_MULTIPLIER = 2;");
  assert.notEqual(gameSource, edited);
  await writeFile(join(sample, "src", "game.js"), edited);
  npm(["run", "build"]);
  const port = await unusedPort();
  const debugPort = await unusedPort();
  const origin = `http://127.0.0.1:${port}`;
  const debugUrl = `http://127.0.0.1:${debugPort}`;
  const vite = start(process.execPath, [join(sample, "node_modules", "vite", "bin", "vite.js"),
    "--host", "127.0.0.1", "--port", String(port), "--strictPort"], { cwd: sample });
  await waitFor(origin, vite);
  const chrome = process.env.CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  await access(chrome);
  const browser = start(chrome, ["--headless=new", "--disable-gpu", "--no-first-run",
    "--no-default-browser-check", `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${join(temporary, "chrome-profile")}`, "about:blank"]);
  await waitFor(`${debugUrl}/json/version`, browser);
  execFileSync(process.execPath, [join(sample, "scripts", "browser-smoke.mjs")], {
    cwd: sample, stdio: "inherit", timeout: 30_000,
    env: { ...process.env, BROWSER_TEST_ORIGIN: origin, BROWSER_DEBUG_URL: debugUrl,
      SAMPLE_EXPECTED_STEP: "8" }
  });
  for (const field of ["project", "author"]) {
    const manifestPath = join(sample, "theme.json");
    const original = await readFile(manifestPath, "utf8");
    try {
      const invalid = JSON.parse(original);
      invalid[field] = " \t ";
      await writeFile(manifestPath, JSON.stringify(invalid));
      const result = spawnSync(process.execPath, [npmCli, "run", "theme:export", "--",
        "--output", `invalid-${field}.zip`], { cwd: sample, encoding: "utf8" });
      if (result.error) throw result.error;
      assert.notEqual(result.status, 0);
      assert.ok(`${result.stdout}\n${result.stderr}`.includes(
        `${field === "project" ? "Project" : "Author"} (${field}) is required and must be a nonblank string.`));
      await assert.rejects(access(join(sample, `invalid-${field}.zip`)));
    } finally {
      await writeFile(manifestPath, original);
    }
  }
  const manifestBefore = await readFile(join(sample, "theme.json"));
  npm(["run", "theme:export", "--", "--output", "theme-assets.zip"]);
  assert.deepEqual(await readFile(join(sample, "theme.json")), manifestBefore);
  const state = join(temporary, "disposable-import-state");
  await mkdir(state);
  execFileSync(process.execPath, ["--import", "tsx",
    join(root, "tools", "verify-developer-kit-import.mjs"), sample, state],
  { cwd: root, stdio: "inherit", timeout: 30_000 });
  console.log("PASS: unpacked kit install, source edit, playable browser preview, existing exporter and real disposable importer.");
} finally {
  for (const process of processes.reverse()) {
    if (process.exitCode === null && process.pid) {
      execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
        `function Stop-OwnedTree([int]$parentId) {
          Get-CimInstance Win32_Process -Filter "ParentProcessId = $parentId" |
            ForEach-Object { Stop-OwnedTree $_.ProcessId }
          if (Get-Process -Id $parentId -ErrorAction SilentlyContinue) {
            Stop-Process -Id $parentId -Force -ErrorAction Stop
          }
        }; Stop-OwnedTree ${process.pid}`], { stdio: "inherit" });
    }
  }
  if (gameSource) await writeFile(join(sample, "src", "game.js"), gameSource);
  await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
