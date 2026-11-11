import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { generateMap } from "@multiplayer-game/default-theme";
import { WorldGeometry } from "@multiplayer-game/engine";
import { seedWaitingRoom } from "./npc-spawns.mjs";

export async function verifyFixedArenaMinimal({
  playerPage, observer, creator, cdp, evaluate, waitFor, click, clickSessionButton,
  state, own, aim, moveKeys, delay, browser, origin
}) {
  assert.equal(new URL(origin).hostname, "127.0.0.1", "disposable loopback server only");
  const databasePath = process.env.BROWSER_TEST_DATABASE_PATH;
  assert.ok(databasePath, "provide the disposable browser-test database path");
  const seed = 42;
  const map = generateMap(seed, "fixed").map;
  const geometry = new WorldGeometry(map.definition.bounds, [...map.obstacles]);
  const obstacle = map.obstacles.find(rect => rect.x === 384 && rect.y === 384);
  assert.ok(obstacle, "the added northwest terrain tile is present");
  let sessionId;
  let primaryError;

  console.log(JSON.stringify({
    progress: "minimal-fixed-room", status: "starting", seed, players: 1, spectators: 1
  }));
  try {
    await evaluate(playerPage, `document.querySelector('[name=setting-mapMode]').value = 'fixed';
      document.querySelector('[name=setting-mapMode]').dispatchEvent(new Event('change'));
      document.querySelector('[name=setting-maxPlayers]').value = '1';
      document.querySelector('[name=setting-initialNpcsPerPlayer]').value = '1';
      document.querySelector('[name=setting-baseNpcHealth]').value = '100000';
      document.querySelector('[name=setting-npcMovementSpeed]').value = '0';
      document.querySelector('[name=setting-npcDetectionRange]').value = '0';
      document.querySelector('[name=setting-maxLevels]').value = '1'`);
    await click(playerPage, "Create session");
    sessionId = await seedWaitingRoom({ alice: playerPage, creator, evaluate, origin }, seed);
    const settings = await evaluate(playerPage, `(async () => {
      const response = await fetch(${JSON.stringify(`/api/v1/sessions/${sessionId}`)});
      if (!response.ok) throw new Error('Cannot read disposable room settings');
      return (await response.json()).settings;
    })()`);
    assert.deepEqual({
      mapMode: settings.mapMode,
      maxPlayers: settings.maxPlayers,
      initialNpcsPerPlayer: settings.initialNpcsPerPlayer,
      baseNpcHealth: settings.baseNpcHealth,
      npcMovementSpeed: settings.npcMovementSpeed,
      npcDetectionRange: settings.npcDetectionRange,
      maxLevels: settings.maxLevels
    }, {
      mapMode: "fixed",
      maxPlayers: 1,
      initialNpcsPerPlayer: 1,
      baseNpcHealth: 100000,
      npcMovementSpeed: 0,
      npcDetectionRange: 0,
      maxLevels: 1
    });
    await clickSessionButton(playerPage, creator, "Start Session");
    await waitFor(playerPage, "window.__probe.snapshot !== null && document.querySelector('canvas')");
    await click(observer, "Refresh sessions");
    await clickSessionButton(observer, creator, "Spectate");
    await waitFor(observer, "document.querySelector('[aria-label=\"Followable players\"]') !== null");
    await click(observer, `Follow ${creator}`);
    const playerState = await state(playerPage);
    const accountId = own(playerState).accountId;
    await waitFor(observer,
      `window.__probe.snapshot?.spectatorView?.targetAccountId === ${JSON.stringify(accountId)}`);
    assert.equal(playerState.snapshot.players.length, 1, "the room has one player");
    assert.deepEqual(playerState.snapshot.map.obstacles, map.obstacles);
    console.log(JSON.stringify({
      progress: "minimal-fixed-room", status: "complete", sessionId,
      rosterSize: playerState.snapshot.players.length, spectatorFollowing: true
    }));

    const headings = [];
    for (let index = 0; index < 8; index += 1) {
      const degrees = index * 45;
      const facing = { x: Math.cos(degrees * Math.PI / 180), y: Math.sin(degrees * Math.PI / 180) };
      console.log(JSON.stringify({ progress: "minimal-radar-heading", status: "starting", degrees }));
      await aim(playerPage, facing.x * 150, facing.y * 150);
      for (const [role, page] of [["player", playerPage], ["spectator", observer]]) {
        await waitFor(page, `(() => {
          const snapshot = window.__probe.snapshot;
          const target = snapshot?.players.find(item => item.accountId === snapshot.viewerAccountId);
          return target && Math.hypot(target.facing.x - ${facing.x},
            target.facing.y - ${facing.y}) < 0.01;
        })()`);
        await cdp("Page.bringToFront", {}, page.session);
        await delay(120);
        const view = await state(page);
        const color = view.colors[own(view).accountId];
        const body = view.arcs.find(arc =>
          arc.r === 4 && arc.x === view.width - 84 && arc.y === 84 && arc.color === color);
        const nose = view.arcs.find(arc => arc.r === 2 && arc.color === color &&
          Math.hypot(arc.x - body?.x, arc.y - body?.y) < 6);
        assert.ok(body && nose, `${role} radar has the player's body and nose at ${degrees} degrees`);
        assert.ok(Math.abs(nose.x - body.x - facing.x * 4.5) < 0.05);
        assert.ok(Math.abs(nose.y - body.y - facing.y * 4.5) < 0.05);
        assert.ok(Math.hypot(nose.x - body.x, nose.y - body.y) < body.r + nose.r,
          `${role} nose overlaps its radar body at ${degrees} degrees`);
        headings.push({ role, degrees, attached: true });
      }
    }

    const before = own(await state(playerPage)).position;
    console.log(JSON.stringify({
      progress: "minimal-terrain-block", status: "starting", obstacle, before
    }));
    assert.deepEqual(before, map.definition.spawns.find(spawn => spawn.kind === "player").position);
    await moveKeys(playerPage, ["ArrowRight", "ArrowDown"], 1800);
    const atTerrain = own(await state(playerPage)).position;
    console.log(JSON.stringify({
      progress: "minimal-terrain-block", status: "at-terrain", before, atTerrain, obstacle
    }));
    assert.ok(Math.hypot(atTerrain.x - before.x, atTerrain.y - before.y) > 60,
      "the player moves toward the added terrain");
    assert.ok(atTerrain.x < obstacle.x && atTerrain.y < obstacle.y,
      "terrain blocks diagonal movement before the tile");
    assert.ok(geometry.isCircleWalkable(atTerrain, 14));
    await moveKeys(playerPage, ["ArrowRight", "ArrowDown"], 500);
    const after = own(await state(playerPage)).position;
    assert.ok(Math.hypot(after.x - atTerrain.x, after.y - atTerrain.y) < 1,
      "the player remains blocked while input continues against the tile");
    assert.ok((await state(playerPage)).actions.some(input =>
      input.payload.action.moveX > 0 && input.payload.action.moveY > 0),
    "the browser sent diagonal movement intent");
    assert.deepEqual((await state(observer)).snapshot.map.obstacles, map.obstacles);
    assert.equal((await state(observer)).actions.length, 0,
      "the spectator sends no gameplay input");
    console.log(JSON.stringify({
      progress: "minimal-terrain-block", status: "complete",
      before, atTerrain, after, obstacle, walkable: true, blocked: true
    }));
    console.log(JSON.stringify({
      browser, seed, mode: "fixed", sessionId, players: 1, spectators: 1,
      radarHeadings: headings, movementBlockedByAddedTerrain: true
    }, null, 2));
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    if (sessionId) {
      try {
        const status = await evaluate(playerPage, `(async () => (await fetch(
          ${JSON.stringify(`/api/v1/sessions/${sessionId}/leave`)},
          {method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status)()`);
        assert.equal(status, 204, "leave the disposable room after verification");
        console.log(JSON.stringify({ progress: "minimal-fixed-room-cleanup", status: "complete", sessionId }));
      } catch (error) {
        console.error(`Disposable room cleanup failed: ${error.message}`);
        if (!primaryError) throw error;
      }
    }
  }
}
