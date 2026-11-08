import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { writeFileSync } from "node:fs";
import { generateMap, DEFAULT_MAP_MODE } from "@multiplayer-game/default-theme";

export async function verifySimpleGenerated({
  alice, creator, cdp, evaluate, waitFor, click, clickSessionButton,
  state, own, aim, moveAndSample, delay, browser, origin
}) {
  assert.equal(new URL(origin).hostname, "127.0.0.1", "local browser only");
  assert.equal(DEFAULT_MAP_MODE, "simple-generated", "use the documented developer constant");
  const databasePath = process.env.BROWSER_TEST_DATABASE_PATH;
  assert.ok(databasePath, "supply the disposable server database path");
  const seed = 42;
  const generated = generateMap(seed, "simple-generated");
  const fixed = generateMap(seed, "fixed");
  assert.equal(generated.source, "generated", "do not mistake fallback for a generated playtest");
  assert.notDeepEqual(generated.map.obstacles, fixed.map.obstacles);

  await evaluate(alice, `document.querySelector('[name=setting-maxPlayers]').value = '1';
    document.querySelector('[name=setting-initialNpcsPerPlayer]').value = '1';
    document.querySelector('[name=setting-baseNpcHealth]').value = '100000';
    document.querySelector('[name=setting-npcMovementSpeed]').value = '0';
    document.querySelector('[name=setting-npcDetectionRange]').value = '0';
    document.querySelector('[name=setting-maxLevels]').value = '1'`);
  await click(alice, "Create session");
  const sessionId = await evaluate(alice, `(async () => {
    const response = await fetch('/api/v1/sessions');
    if (!response.ok) throw new Error('Cannot read local sessions');
    const {sessions} = await response.json();
    return sessions.filter(session => session.creator === ${JSON.stringify(creator)}).at(-1)?.id;
  })()`);
  assert.ok(sessionId, "find the disposable waiting room");
  const db = new DatabaseSync(databasePath);
  try {
    const update = db.prepare("UPDATE matches SET seed = ? WHERE id = ? AND state = 'waiting'")
      .run(seed, sessionId);
    assert.equal(update.changes, 1, "only reseed this disposable, not-yet-started match");
    assert.equal(db.prepare("SELECT seed FROM matches WHERE id = ?").get(sessionId).seed, seed);
  } finally {
    db.close();
  }
  await clickSessionButton(alice, creator, "Start Session");
  await cdp("Page.bringToFront", {}, alice.session);
  await waitFor(alice, "window.__probe.snapshot !== null && document.querySelector('canvas') !== null");
  await delay(250);
  const initial = await state(alice);
  assert.deepEqual(initial.snapshot.map.obstacles, generated.map.obstacles,
    "the real server selected the exact seeded layout");
  assert.deepEqual(own(initial).position, {x: 272, y: 272});
  assert.ok(generated.map.isWalkable(own(initial).position, 14 + 64), "spawn has clear margin");
  const obstacle = generated.map.obstacles[0];
  assert.deepEqual(obstacle, {x: 544, y: 448, width: 32, height: 32});

  function verifyPresentation(view) {
    const player = own(view);
    const dot = view.arcs.find(arc => arc.r === 14 && arc.color === view.colors[player.accountId]);
    assert.ok(dot);
    const camera = {
      x: player.position.x + view.width / 2 - dot.x,
      y: player.position.y + view.height / 2 - dot.y
    };
    const x = obstacle.x - camera.x + view.width / 2;
    const y = obstacle.y - camera.y + view.height / 2;
    assert.ok(x >= 0 && y >= 0 && x + 32 < view.width && y + 32 < view.height,
      "tested obstacle is actually in the viewport");
    assert.ok(view.terrain.some(tile => Math.abs(tile.x - x) < 0.2 &&
      Math.abs(tile.y - y) < 0.2 && tile.w === 32 && tile.h === 32),
    "visible world obstacle uses authoritative coordinates");
    const marker = view.snapshot.radar.markers.find(marker =>
      marker.category === "terrain" && marker.position.x === 560 && marker.position.y === 464);
    assert.ok(marker);
    assert.deepEqual(marker.footprint, {width:32, height:32});
    const scale = 67 / 512;
    const radarX = view.width - 84 + (obstacle.x - camera.x) * scale;
    const radarY = 84 + (obstacle.y - camera.y) * scale;
    assert.ok(view.radarTerrain.some(tile => Math.abs(tile.x - radarX) < 0.2 &&
      Math.abs(tile.y - radarY) < 0.2 && Math.abs(tile.w - 32 * scale) < 0.01),
    "the same obstacle is drawn at its north-up radar footprint");
  }
  const playerTrace = [own(initial).position];
  const npcTrace = [];
  const travelDiagnostics = [];
  await aim(alice, 0, 300);
  const assumedAim = await state(alice);
  await moveAndSample(alice, "ArrowUp", 120, playerTrace, npcTrace);
  const assumedMovement = await state(alice);
  const directionDiagnostic = {
    canvas: {width:assumedAim.width, height:assumedAim.height},
    assumedPointerOffset: {x:0, y:300},
    facing: own(assumedAim).facing,
    movement: assumedMovement.actions.findLast(message =>
      Math.hypot(message.payload.action.moveX, message.payload.action.moveY) > 0)?.payload.action,
    from: own(assumedAim).position,
    to: own(assumedMovement).position
  };
  console.log("Initial facing-relative approach:", JSON.stringify(directionDiagnostic));

  async function aimInside(horizontal, vertical) {
    const view = await state(alice);
    const scale = Math.min(1, (view.width / 2 - 20) / Math.max(1, Math.abs(horizontal)),
      (view.height / 2 - 20) / Math.max(1, Math.abs(vertical)));
    assert.ok(scale > 0, "canvas has room for an in-bounds aim target");
    await aim(alice, horizontal * scale, vertical * scale);
    const facing = own(await state(alice)).facing;
    const length = Math.hypot(horizontal, vertical);
    assert.ok(facing && Math.hypot(facing.x - horizontal / length,
      facing.y - vertical / length) < 0.05,
    `authoritative facing matches requested direction: ${JSON.stringify(facing)}`);
  }
  function verifyClearRoute(from, to) {
    assert.ok(from.x === to.x || from.y === to.y, "diagnose axis-aligned travel legs");
    const bounds = {
      left: Math.min(from.x, to.x), right: Math.max(from.x, to.x),
      top: Math.min(from.y, to.y), bottom: Math.max(from.y, to.y)
    };
    const obstacles = generated.map.obstacles.map(rect => {
      const distance = Math.hypot(
        Math.max(rect.x - bounds.right, bounds.left - rect.x - rect.width, 0),
        Math.max(rect.y - bounds.bottom, bounds.top - rect.y - rect.height, 0)
      );
      return {
        left: rect.x, right: rect.x + rect.width,
        top: rect.y, bottom: rect.y + rect.height, clearance: distance
      };
    });
    const route = {
      from, to, radius: 14,
      minimumObstacleClearance: Math.min(...obstacles.map(rect => rect.clearance)),
      nearbyObstacleBounds: obstacles.filter(rect => rect.clearance <= 14 + 64),
      blockingObstacleBounds: obstacles.filter(rect => rect.clearance < 14)
    };
    console.log("Player-radius route:", JSON.stringify(route));
    assert.equal(route.blockingObstacleBounds.length, 0,
      `full swept player radius is clear: ${JSON.stringify(route)}`);
    const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y)));
    assert.ok(Array.from({length:steps + 1}, (_, index) => ({
      x: from.x + (to.x - from.x) * index / steps,
      y: from.y + (to.y - from.y) * index / steps
    })).every(position => generated.map.isWalkable(position, 14)),
    `seed-42 player-radius route is clear: ${JSON.stringify({from,to})}`);
    return route;
  }
  async function travelTo(axis, target) {
    const start = await state(alice);
    const before = own(start).position;
    const delta = target - before[axis];
    const route = verifyClearRoute(before, {...before, [axis]:target});
    await aimInside(axis === "x" ? Math.sign(delta) * 300 : 0,
      axis === "y" ? Math.sign(delta) * 300 : 0);
    const aimed = await state(alice);
    const sequence = aimed.actions.at(-1)?.payload.sequence ?? -1;
    await moveAndSample(alice, "ArrowUp", Math.abs(delta) / 180 * 1000, playerTrace, npcTrace);
    const end = await state(alice);
    const after = own(end).position;
    const inputs = end.actions.filter(message => message.payload.sequence > sequence &&
      Math.hypot(message.payload.action.moveX, message.payload.action.moveY) > 0);
    const diagnostic = {
      axis, target, start: before, end: after, plannedTarget: route.to,
      authoritativeFacing: {start:own(aimed).facing, end:own(end).facing},
      actualMovementVector: {x:after.x - before.x, y:after.y - before.y},
      movementInputs: inputs.map(message => ({
        sequence: message.payload.sequence,
        vector: {x:message.payload.action.moveX, y:message.payload.action.moveY},
        aim: {x:message.payload.action.aimX, y:message.payload.action.aimY}
      })),
      route
    };
    travelDiagnostics.push(diagnostic);
    console.log("Travel leg:", JSON.stringify(diagnostic));
    assert.ok(Math.abs(after[axis] - target) < 20,
      `reach open ${axis} approach: ${JSON.stringify(diagnostic)}`);
  }
  await travelTo("y", 400);
  await travelTo("x", 430);
  verifyPresentation(await state(alice));

  async function sampleShot() {
    await aimInside(300, 0);
    await evaluate(alice, "document.querySelector('canvas').focus()");
    const view = await state(alice);
    const point = await evaluate(alice, `(() => {
      const rect = document.querySelector('canvas').getBoundingClientRect();
      return {x:rect.x + rect.width / 2 + Math.min(300, rect.width / 2 - 20),
        y:rect.y + rect.height / 2};
    })()`);
    const trace = [];
    await cdp("Input.dispatchMouseEvent", {
      type:"mousePressed", button:"left", buttons:1, clickCount:1, ...point
    }, alice.session);
    try {
      const deadline = Date.now() + 110;
      while (Date.now() < deadline) {
        trace.push((await state(alice)).snapshot);
        await delay(20);
      }
    } finally {
      await cdp("Input.dispatchMouseEvent", {
        type:"mouseReleased", button:"left", buttons:0, clickCount:1, ...point
      }, alice.session);
    }
    const deadline = Date.now() + 550;
    while (Date.now() < deadline) {
      trace.push((await state(alice)).snapshot);
      await delay(20);
    }
    const shots = trace.flatMap(snapshot => snapshot.entities.filter(entity =>
      entity.state.kind === "projectile"));
    assert.ok(shots.length > 0, "real input produced observed authoritative shots");
    return {start:own(view).position, shots, final:trace.at(-1)};
  }
  const openShot = await sampleShot();
  assert.ok(openShot.shots.some(shot => shot.position.x > obstacle.x + obstacle.width + 100),
    "control shot travels past the obstacle's x coordinate in the clear northern lane");
  await delay(2100);
  await travelTo("y", 464);
  const approach = await state(alice);
  verifyPresentation(approach);
  const blockedShot = await sampleShot();
  assert.ok(blockedShot.shots.every(shot => shot.position.x <= obstacle.x + 3),
    "shots aimed into the visible obstacle never emerge through its east face");
  assert.equal(blockedShot.final.entities.filter(entity => entity.state.kind === "projectile").length, 0,
    "wall removes shots well before their two-second lifetime");

  await aimInside(300, 0);
  await moveAndSample(alice, "ArrowUp", 1200, playerTrace, npcTrace);
  const blocked = await state(alice);
  const stop = own(blocked).position;
  assert.ok(stop.x <= obstacle.x - 14 + 0.2 && stop.x >= obstacle.x - 20,
    "player radius stops at the visible obstacle's west face");
  assert.ok(stop.y > obstacle.y && stop.y < obstacle.y + obstacle.height);
  const firstStop = {...stop};
  await moveAndSample(alice, "ArrowUp", 600, playerTrace, npcTrace);
  const held = await state(alice);
  assert.ok(Math.hypot(own(held).position.x - firstStop.x, own(held).position.y - firstStop.y) < 0.2,
    "continued movement remains blocked");
  assert.ok(playerTrace.every(position => generated.map.isWalkable(position, 14)),
    "all observed travel stays out of solid tiles");
  verifyPresentation(held);
  await travelTo("y", 400);
  await travelTo("x", 704);
  await travelTo("y", 464);
  const around = await state(alice);
  assert.ok(own(around).position.x > 640 + 14 &&
    own(around).position.y > obstacle.y &&
    own(around).position.y < obstacle.y + obstacle.height,
  "walk around the entire northwest cluster and return beyond its east face");
  assert.ok(playerTrace.every(position => generated.map.isWalkable(position, 14)),
    "the blocked approach and walk-around remain clear at player radius");
  verifyPresentation(around);
  if (process.env.BROWSER_TEST_SCREENSHOT) {
    const capture = await cdp("Page.captureScreenshot", {format:"png"}, alice.session);
    writeFileSync(process.env.BROWSER_TEST_SCREENSHOT, Buffer.from(capture.data, "base64"));
  }
  console.log(JSON.stringify({
    browser, seed, source:generated.source, attempts:generated.attempts, sessionId,
    playerStart:own(initial).position, obstacle, shotApproach:blockedShot.start,
    openShotMaxX:Math.max(...openShot.shots.map(shot => shot.position.x)),
    blockedShotMaxX:Math.max(...blockedShot.shots.map(shot => shot.position.x)),
    blockedMovementStop:own(held).position,
    directionDiagnostic, travelDiagnostics, walkedAroundTo:own(around).position,
    worldAndRadarMatch:true, allSampledPositionsClear:true, walkedAround:true
  }, null, 2));
}
