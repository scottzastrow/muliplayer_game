import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const inventory = await readFile(join(root, "SHA256SUMS"), "utf8");
const expectedPaths = new Set();
for (const line of inventory.trimEnd().split("\n")) {
  const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
  assert.ok(match, `Invalid checksum line: ${line}`);
  const [, expected, path] = match;
  assert.ok(!expectedPaths.has(path), `Duplicate checksum path: ${path}`);
  expectedPaths.add(path);
  const absolute = resolve(root, ...path.split("/"));
  const contained = relative(root, absolute);
  assert.ok(contained && !contained.startsWith(`..${sep}`) && contained !== "..");
  assert.equal(createHash("sha256").update(await readFile(absolute)).digest("hex"), expected,
    `Checksum mismatch: ${path}`);
}
async function files(directory, prefix = "") {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = `${prefix}${entry.name}`;
    assert.ok(!entry.isSymbolicLink(), `Unexpected symlink: ${path}`);
    if (entry.isDirectory()) result.push(...await files(join(directory, entry.name), `${path}/`));
    else result.push(path);
  }
  return result;
}
assert.deepEqual((await files(root)).filter(path => path !== "SHA256SUMS").sort(),
  [...expectedPaths].sort(), "The extracted file inventory differs from the kit.");
console.log(`Verified ${expectedPaths.size} distributed file checksums.`);
