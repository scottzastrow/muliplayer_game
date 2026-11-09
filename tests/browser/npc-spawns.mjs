import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { writeFileSync } from "node:fs";
import { generateMap, DEFAULT_MAP_MODE } from "@multiplayer-game/default-theme";

export async function seedWaitingRoom({ alice, creator, evaluate, origin }, seed) {
  assert.equal(new URL(origin).hostname, "127.0.0.1", "disposable local server only");
  const databasePath = process.env.BROWSER_TEST_DATABASE_PATH;
  assert.ok(databasePath, "supply the disposable database path");
  const sessionId = await evaluate(alice, `(async () => {
    const response = await fetch('/api/v1/sessions');
    if (!response.ok) throw new Error('Cannot read local sessions');
    const {sessions} = await response.json();
    return sessions.filter(session => session.creator === ${JSON.stringify(creator)}).at(-1)?.id;
  })()`);
  assert.ok(sessionId);
  const db = new DatabaseSync(databasePath);
  try {
    assert.equal(db.prepare("UPDATE matches SET seed = ? WHERE id = ? AND state = 'waiting'")
      .run(seed, sessionId).changes, 1);
    assert.equal(db.prepare("SELECT seed FROM matches WHERE id = ?").get(sessionId).seed, seed);
  } finally { db.close(); }
  return sessionId;
}

export async function verifyNpcSpawns({
  alice, creator, cdp, evaluate, waitFor, click, clickSessionButton,
  state, delay, browser, origin
}) {
  const seed = 42;
  const expected = generateMap(seed, DEFAULT_MAP_MODE);
  assert.equal(expected.source, DEFAULT_MAP_MODE === "fixed" ? "fixed" : "generated");
  // Keep the actual lobby defaults: placement is the only gameplay change.
  await click(alice, "Create session");
  const sessionId = await seedWaitingRoom({ alice, creator, evaluate, origin }, seed);
  const settings = await evaluate(alice, `(async () => {
    const response = await fetch(${JSON.stringify(`/api/v1/sessions/${sessionId}`)});
    if (!response.ok) throw new Error('Cannot read local room settings');
    return (await response.json()).settings;
  })()`);
  assert.equal(settings.initialNpcsPerPlayer, 10);
  assert.equal(settings.baseNpcHealth, 50);
  assert.equal(settings.npcMovementSpeed, 67.5);
  assert.equal(settings.npcDetectionRange, 512);
  await clickSessionButton(alice, creator, "Start Session");
  await cdp("Page.bringToFront", {}, alice.session);
  await waitFor(alice, "window.__probe.snapshot !== null && document.querySelector('canvas') !== null");
  await delay(200);
  const view = await state(alice);
  const enemies = view.snapshot.entities.filter(entity => entity.state.kind === "npc");
  assert.equal(enemies.length, 10, "unchanged one-player default NPC count");
  assert.deepEqual(view.snapshot.map.obstacles, expected.map.obstacles, "unchanged selected terrain");
  assert.ok(enemies.every(entity => entity.state.health === 50), "default NPC health");
  const zones = new Set(enemies.map(entity =>
    `${Math.floor(entity.position.x / 512)},${Math.floor(entity.position.y / 512)}`));
  const quadrants = new Set(enemies.map(entity =>
    `${Math.floor(entity.position.x / 1024)},${Math.floor(entity.position.y / 1024)}`));
  assert.ok(zones.size >= 8, "enemies start across several arena zones");
  assert.equal(quadrants.size, 4, "enemies start in all four arena quadrants");
  const markers = view.snapshot.radar.markers.filter(marker => marker.category === "enemy");
  assert.deepEqual(markers.map(marker => marker.id), enemies.map(entity => entity.id));
  assert.deepEqual(markers.map(marker => marker.position), enemies.map(entity => entity.position));
  const radarX = view.width - 84;
  const dots = view.arcs.filter(arc => arc.r === 3 && arc.color === "#ed6b61" &&
    Math.hypot(arc.x - radarX, arc.y - 84) <= 72);
  assert.equal(dots.length, 10, "Chrome actually renders all NPC radar dots, including rim markers");
  assert.ok(view.fillTexts.some(label => label.text === "Enemies remaining: 10"));
  const screenshot = process.env.BROWSER_TEST_SCREENSHOT;
  if (screenshot) {
    const image = await cdp("Page.captureScreenshot", { format: "png" }, alice.session);
    writeFileSync(screenshot, Buffer.from(image.data, "base64"));
  }
  console.log(JSON.stringify({
    browser, mode: DEFAULT_MAP_MODE, seed, npcCount: enemies.length,
    zones: zones.size, quadrants: quadrants.size, renderedRadarDots: dots.length,
    positions: enemies.map(entity => entity.position),
    settings: {
      initialNpcsPerPlayer: settings.initialNpcsPerPlayer, npcMovementSpeed: settings.npcMovementSpeed,
      npcDetectionRange: settings.npcDetectionRange, baseNpcHealth: settings.baseNpcHealth
    },
    screenshot: screenshot ?? null
  }, null, 2));
  assert.equal(await evaluate(alice, `(async () => (await fetch(
    ${JSON.stringify(`/api/v1/sessions/${sessionId}/leave`)},
    {method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status)()`), 204);
}
