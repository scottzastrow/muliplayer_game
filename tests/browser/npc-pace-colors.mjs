import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BoundedNavigation, WorldGeometry } from "@multiplayer-game/engine";
import { seedWaitingRoom } from "./npc-spawns.mjs";

export async function verifyNpcPaceColors({
  alice, bob, observer, creator, bobName, cdp, evaluate, waitFor, click,
  clickSessionButton, state, own, delay, browser, origin
}) {
  const directory = process.env.BROWSER_TEST_ARTIFACT_DIR;
  assert.ok(directory, "supply an artifact directory");
  assert.equal(new URL(origin).hostname, "127.0.0.1");
  mkdirSync(directory, { recursive: true });
  const report = { browser, seed: 42, stagedEntities: false, roles: [], screenshots: [] };
  const save = () => writeFileSync(join(directory, "report.json"), JSON.stringify(report, null, 2));
  const capture = async (page, name) => {
    const image = await cdp("Page.captureScreenshot", { format: "png" }, page.session);
    const path = join(directory, `${name}.png`);
    writeFileSync(path, Buffer.from(image.data, "base64"));
    report.screenshots.push(path);
  };
  for (const page of [alice, bob, observer]) {
    const { windowId } = await cdp("Browser.getWindowForTarget", { targetId: page.target });
    await cdp("Browser.setWindowBounds", { windowId,
      bounds: { width: 1440, height: 900, windowState: "normal" } });
    await evaluate(page, `(() => {
      window.__paceTrace = [];
      const Native = window.WebSocket;
      window.WebSocket = class extends Native {
        constructor(...args) {
          super(...args);
          this.addEventListener('message', event => {
            const message = JSON.parse(event.data);
            if (message.type === 'server.snapshot') {
              window.__paceTrace.push({ at:performance.now(), snapshot:message.payload });
            }
          });
        }
      };
    })()`);
  }
  const follow = async (name, id) => {
    if (await evaluate(observer, `[...document.querySelectorAll('button')]
      .some(b => b.textContent === 'Back to Players')`)) await click(observer, "Back to Players");
    await click(observer, `Follow ${name}`);
    await waitFor(observer, `window.__probe.snapshot?.spectatorView?.targetAccountId === ${JSON.stringify(id)}`);
  };
  const colorCheck = async (page, role) => {
    await cdp("Page.bringToFront", {}, page.session);
    await delay(120);
    const view = await state(page);
    assert.equal(view.snapshot.players.length, 2);
    const colors = Object.values(view.colors);
    assert.equal(new Set(colors).size, 2);
    assert.ok(!colors.includes("#ed6b61"));
    const worldPlayers = colors.map(color => {
      const body = view.arcs.find(arc => arc.r === 14 && arc.color === color);
      assert.ok(body && body.x > 14 && body.x < view.width - 14 &&
        body.y > 14 && body.y < view.height - 14, `${role}: both player bodies are visible`);
      return body;
    });
    const radarPlayers = colors.map(color => {
      const dot = view.arcs.find(arc => [3, 4].includes(arc.r) && arc.color === color &&
        Math.hypot(arc.x - (view.width - 84), arc.y - 84) < 72);
      assert.ok(dot, `${role}: both distinct player colors are on radar`);
      return dot;
    });
    const bodies = view.squares.filter(rect => rect.w === 16 && rect.h === 16 &&
      rect.centerX > 20 && rect.centerX < view.width - 170 &&
      rect.centerY > 20 && rect.centerY < view.height - 20);
    const fronts = bodies.map(body => view.squares.find(rect => rect.w === 6 && rect.h === 6 &&
      Math.abs(rect.centerX - body.centerX - Math.cos(body.angle) * 11) < 0.01 &&
      Math.abs(rect.centerY - body.centerY - Math.sin(body.angle) * 11) < 0.01));
    assert.ok(bodies.length && fronts.every(Boolean), `${role}: attached same-color NPC squares are visible`);
    assert.ok(bodies.every(rect => rect.color === "#ed6b61") &&
      fronts.every(rect => rect.color === "#ed6b61"));
    const enemyRadar = view.arcs.filter(arc => arc.r === 3 && arc.color === "#ed6b61" &&
      Math.hypot(arc.x - (view.width - 84), arc.y - 84) < 72);
    assert.equal(enemyRadar.length, view.snapshot.entities.filter(e => e.state.kind === "npc").length);
    const pixels = await evaluate(page, `(() => {
      const canvas = document.querySelector('canvas'), context = canvas.getContext('2d');
      const sample = point => [...context.getImageData(
        Math.floor(point.x * devicePixelRatio), Math.floor(point.y * devicePixelRatio), 1, 1).data];
      return ${JSON.stringify([...worldPlayers, ...radarPlayers,
        ...bodies.slice(0, 1).map(rect => ({ x: rect.centerX, y: rect.centerY })),
        ...fronts.slice(0, 1).map(rect => ({ x: rect.centerX, y: rect.centerY })),
        ...enemyRadar.slice(0, 1)])}.map(sample);
    })()`);
    assert.ok(pixels.every(pixel => pixel[3] === 255));
    for (let index = 0; index < colors.length; index++) {
      const rgb = colors[index].match(/^#([0-9a-f]{6})$/)?.[1];
      assert.ok(rgb, "Chrome canonicalizes player colors to RGB");
      const expected = [0, 2, 4].map(offset => parseInt(rgb.slice(offset, offset + 2), 16));
      assert.deepEqual(pixels[index].slice(0, 3), expected, "actual distinct player body pixel");
      assert.deepEqual(pixels[index + 2].slice(0, 3), expected, "actual distinct player radar pixel");
    }
    assert.deepEqual(pixels[4].slice(0, 3), [237, 107, 97], "actual NPC body pixel");
    assert.deepEqual(pixels[5].slice(0, 3), [237, 107, 97], "actual attached square pixel");
    assert.deepEqual(pixels[6].slice(0, 3), [237, 107, 97], "actual enemy radar pixel");
    await capture(page, role);
    report.roles.push({ role, tick: view.snapshot.tick, colors: view.colors, worldPlayers,
      radarPlayers, enemyBodies: bodies.length, enemyRadar: enemyRadar.length, pixels,
      viewport: { width: view.width, height: view.height }, reservedEnemyColor: "#ed6b61" });
    save();
  };
  try {
    await evaluate(alice, `document.querySelector('[name=setting-mapMode]').value='fixed';
      document.querySelector('[name=setting-mapMode]').dispatchEvent(new Event('change'))`);
    await click(alice, "Create session");
    report.sessionId = await seedWaitingRoom({ alice, creator, evaluate, origin }, 42);
    await click(bob, "Refresh sessions");
    await clickSessionButton(bob, creator, "Join");
    await click(alice, "Refresh sessions");
    await clickSessionButton(alice, creator, "Start Session");
    await click(bob, "Refresh sessions");
    await clickSessionButton(bob, creator, "Play");
    await waitFor(alice, "window.__probe.snapshot && document.querySelector('canvas')");
    await waitFor(bob, "window.__probe.snapshot && document.querySelector('canvas')");
    await click(observer, "Refresh sessions");
    await clickSessionButton(observer, creator, "Spectate");
    const initial = await state(alice);
    const aliceId = own(initial).accountId, bobId = own(await state(bob)).accountId;
    const initialColors = initial.colors;
    report.settings = await evaluate(alice, `(async () =>
      (await (await fetch('/api/v1/sessions/${report.sessionId}')).json()).settings)()`);
    assert.equal(report.settings.npcMovementSpeed, 67.5);
    assert.equal(report.settings.npcDetectionRange, 512);
    assert.equal(report.settings.initialNpcsPerPlayer, 5);
    assert.equal(initial.snapshot.entities.filter(entity => entity.state.kind === "npc").length, 10,
      "two-player default match starts with ten NPCs");
    assert.equal(report.settings.noKillTimeoutSeconds, 360);
    const navigation = new BoundedNavigation(new WorldGeometry(
      { width: 2048, height: 2048 }, initial.snapshot.map.obstacles
    ), { cellSize: 32, agentRadius: 14, maxNodesPerSearch: 4096 });
    const moveTo = async (page, goal) => {
      const held = new Set();
      const keys = [
        ["ArrowLeft", 37], ["ArrowUp", 38], ["ArrowRight", 39], ["ArrowDown", 40]
      ];
      const setKeys = async wanted => {
        for (const [key, windowsVirtualKeyCode] of keys) {
          if (held.has(key) === wanted.includes(key)) continue;
          await cdp("Input.dispatchKeyEvent", {
            type: wanted.includes(key) ? "keyDown" : "keyUp", key, code: key, windowsVirtualKeyCode
          }, page.session);
          if (wanted.includes(key)) held.add(key); else held.delete(key);
        }
      };
      await evaluate(page, "document.querySelector('canvas').focus()");
      const started = Date.now();
      let path = [], nextPoint = 0, lastPosition, lastProgress = Date.now();
      try {
        while (Date.now() - started < 22_000) {
          const player = own(await state(page));
          if (!player.alive) {
            path = [];
            await setKeys([]);
            await delay(100);
            continue;
          }
          if (Math.hypot(player.position.x - goal.x, player.position.y - goal.y) < 16) return;
          if (!lastPosition || Math.hypot(player.position.x - lastPosition.x,
            player.position.y - lastPosition.y) > 1) lastProgress = Date.now();
          lastPosition = player.position;
          if (!path.length || Date.now() - lastProgress > 1000) {
            let result;
            navigation.requestPath(player.position, goal, route => { result = route; });
            for (let i = 0; i < 16 && !result; i++) navigation.processTick();
            assert.equal(result?.status, "found", "ordinary keyboard rendezvous route");
            path = result.path;
            nextPoint = 0;
            lastProgress = Date.now();
          }
          while (nextPoint < path.length && Math.hypot(
            path[nextPoint].x - player.position.x, path[nextPoint].y - player.position.y) < 14) nextPoint++;
          const point = path[nextPoint] ?? goal;
          const dx = point.x - player.position.x, dy = point.y - player.position.y;
          await setKeys([
            ...(Math.abs(dx) > 2 ? [dx > 0 ? "ArrowRight" : "ArrowLeft"] : []),
            ...(Math.abs(dy) > 2 ? [dy > 0 ? "ArrowDown" : "ArrowUp"] : [])
          ]);
          await delay(60);
        }
        throw new Error("Keyboard rendezvous did not finish in 22 seconds.");
      } finally { await setKeys([]); }
    };
    await Promise.all([
      moveTo(alice, { x: 272, y: 432 }), moveTo(bob, { x: 272, y: 624 })
    ]);
    await colorCheck(alice, "player-a");
    await colorCheck(bob, "player-b");
    await follow(creator, aliceId);
    await colorCheck(observer, "spectator-follow-a");
    await follow(bobName, bobId);
    await colorCheck(observer, "spectator-follow-b");
    const previousByPage = new Map();
    const started = Date.now();
    while (Date.now() - started < 12_000) {
      for (const [page, role] of [[alice, "player-a"], [bob, "player-b"]]) {
        const view = await state(page);
        const previous = previousByPage.get(page);
        const target = own(view);
        if (previous && target.alive) {
          for (const npc of view.snapshot.entities.filter(e => e.state.kind === "npc")) {
            const old = previous.entities.find(e => e.id === npc.id);
            const shot = view.snapshot.entities.find(e =>
              e.state.ownerNpcId === npc.id && e.state.kind === "projectile");
            if (!old || !shot || npc.state.targetId !== `player:${target.accountId}` ||
              Math.hypot(npc.position.x - old.position.x, npc.position.y - old.position.y) > 1e-6) continue;
            const range = Math.hypot(npc.position.x - target.position.x, npc.position.y - target.position.y);
            const x = npc.position.x - target.position.x + view.width / 2;
            const y = npc.position.y - target.position.y + view.height / 2;
            const shotX = shot.position.x - target.position.x + view.width / 2;
            const shotY = shot.position.y - target.position.y + view.height / 2;
            if (range < 96 || range > 384 || x < 20 || x > view.width - 20 ||
              y < 20 || y > view.height - 20 || shotX < 6 || shotX > view.width - 6 ||
              shotY < 6 || shotY > view.height - 6) continue;
            report.visibleStopAndFire = {
              role, targetAccountId: target.accountId,
              npcId: npc.id, ticks: [previous.tick, view.snapshot.tick],
              position: npc.position, range, combinedRadii: npc.radius + 14, facing: npc.state.facing, shot
            };
            await cdp("Page.bringToFront", {}, page.session);
            await capture(page, "npc-stopped-firing-outside-overlap");
            break;
          }
        }
        previousByPage.set(page, view.snapshot);
        if (report.visibleStopAndFire) break;
      }
      if (report.visibleStopAndFire) break;
      await delay(60);
    }
    assert.ok(report.visibleStopAndFire, "an NPC visibly stops and fires without running through the player");
    await delay(1500);
    await moveTo(alice, { x: 272, y: 560 });
    await delay(1500);
    const bobTrace = await evaluate(bob, "window.__paceTrace");
    writeFileSync(join(directory, "player-b-trace.json"), JSON.stringify(bobTrace));
    await cdp("Page.reload", {}, bob.session);
    await delay(250);
    await waitFor(bob, "document.querySelector('[aria-label=\"Active sessions\"]')");
    await clickSessionButton(bob, creator, "Rejoin");
    await waitFor(bob, "window.__probe.snapshot && document.querySelector('canvas')");
    assert.deepEqual((await state(bob)).colors, initialColors, "rejoin retains both original player colors");
    report.rejoinColorsStable = true;
    const trace = await evaluate(alice, "window.__paceTrace");
    writeFileSync(join(directory, "trace.json"), JSON.stringify(trace));
    const snapshots = trace.map(row => row.snapshot);
    const stopped = report.visibleStopAndFire;
    const stoppedSnapshots = stopped.role === "player-b" ? bobTrace.map(row => row.snapshot) : snapshots;
    const stoppedRows = stoppedSnapshots.filter(snapshot => {
      const npc = snapshot.entities.find(e => e.id === stopped.npcId);
      const player = snapshot.players.find(p => p.accountId === stopped.targetAccountId);
      return npc?.state.targetId === `player:${stopped.targetAccountId}` && player.alive &&
        Math.hypot(npc.position.x - stopped.position.x, npc.position.y - stopped.position.y) < 1e-6 &&
        Math.hypot(npc.position.x - player.position.x, npc.position.y - player.position.y) >= 96;
    });
    const run = stoppedRows;
    let end = run.findIndex(snapshot => snapshot.tick === stopped.ticks[1]);
    assert.ok(end >= 0);
    let start = end;
    while (start > 0 && run[start].tick - run[start - 1].tick === 2) start--;
    while (end + 1 < run.length && run[end + 1].tick - run[end].tick === 2) end++;
    const stationary = run.slice(start, end + 1);
    const shotTicks = [...new Set(stationary.flatMap(snapshot =>
      snapshot.entities.filter(e => e.state.ownerNpcId === stopped.npcId)
        .map(e => e.state.expiresAtTick - 60)))].filter(tick => tick >= stationary[0].tick).sort((a,b) => a-b);
    report.stationaryFire = {
      npcId: stopped.npcId, ticks: [stationary[0].tick, stationary.at(-1).tick],
      seconds: (stationary.at(-1).tick - stationary[0].tick) / 30, shotTicks
    };
    assert.ok(report.stationaryFire.seconds >= 1, "NPC remains stopped outside overlap for at least one second");
    for (let i = 1; i < shotTicks.length; i++) {
      assert.ok(shotTicks[i] - shotTicks[i - 1] >= 30, "browser shots respect cooldown");
    }
    const speedWindow = (targeted, expected) => {
      for (let i = 0; i < snapshots.length; i++) {
        const first = snapshots[i];
        const end = snapshots.findIndex((s, j) => j > i && s.tick === first.tick + 30);
        if (end < 0) continue;
        for (const npc of first.entities.filter(e => e.state.kind === "npc")) {
          let last = npc, travel = 0, eligible = true;
          for (let j = i + 1; j <= end; j++) {
            const next = snapshots[j].entities.find(e => e.id === npc.id);
            if (!next || Boolean(last.state.targetId) !== targeted ||
              Boolean(next.state.targetId) !== targeted || (targeted && next.state.readyToFire)) {
              eligible = false; break;
            }
            travel += Math.hypot(next.position.x - last.position.x, next.position.y - last.position.y);
            last = next;
          }
          if (eligible && Math.abs(travel - expected) < 1e-6) return {
            npcId: npc.id, ticks: [first.tick, snapshots[end].tick], seconds: 1, travel
          };
        }
      }
      return null;
    };
    report.exploreSpeed = speedWindow(false, 33.75);
    report.approachSpeed = speedWindow(true, 67.5);
    assert.ok(report.exploreSpeed, "clear-route Explore speed is 33.75");
    assert.ok(report.approachSpeed, "separate clear-route approach speed is 67.5");
    report.maxAttackersPerPlayer = 0;
    for (const snapshot of snapshots) {
      for (const id of [aliceId, bobId]) {
        const count = snapshot.entities.filter(e => e.state.kind === "npc" &&
          e.state.targetId === `player:${id}`).length;
        report.maxAttackersPerPlayer = Math.max(report.maxAttackersPerPlayer, count);
        assert.ok(count <= 2);
      }
    }
    report.ticks = [snapshots[0].tick, snapshots.at(-1).tick];
    report.passed = true;
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    report.error = error.message;
    for (const [page, role] of [[alice, "player-a"], [bob, "player-b"], [observer, "spectator"]]) {
      await capture(page, `failure-${role}`);
      writeFileSync(join(directory, `failure-${role}-trace.json`),
        JSON.stringify(await evaluate(page, "window.__paceTrace") ??
          { unavailable: "This document has no trace, for example after reloading to rejoin." }));
    }
    throw error;
  } finally { save(); }
}
