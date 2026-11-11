import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createLocalGame } from "@multiplayer-game/local-preview";
import { sampleMap } from "../src/map.js";
import { sampleSettings } from "../src/settings.js";

const sourcePath = new URL("../src/game.js", import.meta.url);
const originalSource = await readFile(sourcePath, "utf8");
const editedSource = originalSource.replace("const SPEED_MULTIPLIER = 1;", "const SPEED_MULTIPLIER = 2;");
assert.notEqual(editedSource, originalSource, "the sample's documented edit point exists");
const editedPath = join(dirname(fileURLToPath(sourcePath)), `.game-edited-${process.pid}.mjs`);

async function movedDistance(moduleFactory) {
  const accountId = "smoke-player";
  const game = await createLocalGame({
    moduleFactory,
    settings: sampleSettings,
    map: sampleMap,
    seed: 42,
    roster: [{ accountId, username: "Smoke Player", joinedOrder: 0 }],
    viewer: { accountId, role: "player" }
  });
  try {
    const before = game.snapshot.players.find(player => player.accountId === accountId).position.x;
    assert.equal(game.sendInput(accountId, { type: "move", x: 1, y: 0 }), true);
    game.step();
    const after = game.snapshot.players.find(player => player.accountId === accountId).position.x;
    assert.equal(game.sendInput(accountId, { type: "not-an-action" }), false);
    return after - before;
  } finally {
    game.dispose();
  }
}

try {
  await writeFile(editedPath, editedSource);
  const original = await import(sourcePath.href);
  const edited = await import(pathToFileURL(editedPath).href);
  const originalDistance = await movedDistance(original.sampleGameModule);
  const editedDistance = await movedDistance(edited.sampleGameModule);
  assert.equal(originalDistance, 4);
  assert.equal(editedDistance, 8);
  console.log(`Clean-install smoke passed: sample edit changed one-step movement ${originalDistance} -> ${editedDistance}.`);
} finally {
  await rm(editedPath, { force: true });
}
