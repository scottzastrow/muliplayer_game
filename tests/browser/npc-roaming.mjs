import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generateMap } from "@multiplayer-game/default-theme";
import { MAP_CELL_SIZE } from "@multiplayer-game/theme-sdk";
import { seedWaitingRoom } from "./npc-spawns.mjs";

const trackColors = [
  "#e63946", "#457b9d", "#2a9d8f", "#f4a261", "#8e5ea2",
  "#1d70a2", "#d1495b", "#6a994e", "#c77dff", "#e76f51"
];

function classifyBand(position, bounds) {
  const ratio = Math.min(position.x, position.y, bounds.width - position.x,
    bounds.height - position.y) / Math.min(bounds.width, bounds.height);
  return ratio < 0.1 ? "outer" : ratio < 0.25 ? "middle" : "interior";
}

function spawnCellCenter(position) {
  const coordinate = value =>
    (Math.round(value / MAP_CELL_SIZE - 0.5) + 0.5) * MAP_CELL_SIZE;
  return { x: coordinate(position.x), y: coordinate(position.y) };
}

function createTrackMap(seed, tracks, counts, outerToInteriorIds, bounds) {
  const map = generateMap(seed, "fixed").map;
  const width = 1_240;
  const height = 1_000;
  const mapSize = 800;
  const scale = mapSize / Math.max(bounds.width, bounds.height);
  const mapWidth = bounds.width * scale;
  const mapHeight = bounds.height * scale;
  const mapX = 56;
  const mapY = 112;
  const x = value => mapX + value * scale;
  const y = value => mapY + value * scale;
  const rect = (left, top, rectWidth, rectHeight, fill, opacity = 1) =>
    `<rect x="${left}" y="${top}" width="${rectWidth}" height="${rectHeight}" fill="${fill}" opacity="${opacity}"/>`;
  const paths = tracks.map(track => {
    const points = [track.spawn, ...track.samples].map(point =>
      `${x(point.x).toFixed(1)},${y(point.y).toFixed(1)}`).join(" ");
    const end = track.samples.at(-1) ?? track.spawn;
    return `<polyline points="${points}" fill="none" stroke="${track.color}" stroke-width="2.2" stroke-opacity=".88" stroke-linecap="round" stroke-linejoin="round"/>` +
      `<circle cx="${x(track.spawn.x)}" cy="${y(track.spawn.y)}" r="6" fill="${track.color}" stroke="#fff" stroke-width="2"/>` +
      `<text x="${x(track.spawn.x) + 8}" y="${y(track.spawn.y) - 7}" class="number">${track.index + 1}</text>` +
      `<circle cx="${x(end.x)}" cy="${y(end.y)}" r="4" fill="#fff" stroke="${track.color}" stroke-width="2"/>`;
  }).join("");
  const obstacles = map.obstacles.map(obstacle =>
    rect(x(obstacle.x), y(obstacle.y), obstacle.width * scale, obstacle.height * scale,
      "#17212b", 0.9)).join("");
  const legend = tracks.map(track => {
    const startText = `${track.index + 1}. ${track.id.replace(/^npc:/, "")} (${track.initialBand})`;
    return `<line x1="932" y1="${155 + track.index * 29}" x2="960" y2="${155 + track.index * 29}" stroke="${track.color}" stroke-width="4"/>` +
      `<text x="970" y="${160 + track.index * 29}" class="label">${startText}</text>`;
  }).join("");
  const outer = Math.min(bounds.width, bounds.height) * 0.1;
  const inner = Math.min(bounds.width, bounds.height) * 0.25;
  const countsText = `Spawns: ${counts.outer} outer / ${counts.middle} middle / ${counts.interior} interior`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <style>text{font-family:Arial,sans-serif;fill:#17212b}.title{font-size:24px;font-weight:700}.label{font-size:13px}.number{font-size:12px;font-weight:700;paint-order:stroke;stroke:#fff;stroke-width:3px}.small{font-size:14px}</style>
    <rect width="100%" height="100%" fill="#f3f5f7"/>
    <text x="56" y="42" class="title">Fixed NPC spawn positions and 30-second tracks (seed ${seed})</text>
    <text x="56" y="70" class="small">${countsText}; outer-to-interior: ${outerToInteriorIds.length}/${counts.outer}</text>
    ${rect(mapX, mapY, mapWidth, mapHeight, "#e9a1a1", 0.72)}
    ${rect(x(outer), y(outer), (bounds.width - 2 * outer) * scale,
      (bounds.height - 2 * outer) * scale, "#f3d28b", 0.82)}
    ${rect(x(inner), y(inner), (bounds.width - 2 * inner) * scale,
      (bounds.height - 2 * inner) * scale, "#a9d6ad", 0.86)}
    ${obstacles}
    <rect x="${x(outer)}" y="${y(outer)}" width="${(bounds.width - 2 * outer) * scale}" height="${(bounds.height - 2 * outer) * scale}" fill="none" stroke="#af3d3d" stroke-dasharray="6 4"/>
    <rect x="${x(inner)}" y="${y(inner)}" width="${(bounds.width - 2 * inner) * scale}" height="${(bounds.height - 2 * inner) * scale}" fill="none" stroke="#38834a" stroke-dasharray="6 4"/>
    ${paths}
    <rect x="${mapX}" y="${mapY}" width="${mapWidth}" height="${mapHeight}" fill="none" stroke="#253443" stroke-width="2"/>
    <text x="900" y="116" class="small">NPC tracks and spawn bands</text>
    ${legend}
    <text x="900" y="480" class="small">Band definitions: edge distance / shorter map side</text>
    <text x="900" y="505" class="small">Outer &lt;10%; middle 10%–&lt;25%; interior ≥25%</text>
    <text x="900" y="550" class="small">Dashed outlines: 10% and 25% thresholds</text>
    <text x="900" y="575" class="small">Filled circles: spawn; white circles: final sample</text>
  </svg>`;
}

export async function verifyNpcRoaming({
  playerPage, creator, newWindow, cdp, evaluate, waitFor, click, clickSessionButton,
  state, own, delay, browser, origin, routeOnly = false
}) {
  const artifacts = process.env.BROWSER_TEST_ARTIFACT_DIR;
  assert.ok(artifacts, "provide a directory for actual browser evidence");
  const seed = Number(process.env.BROWSER_TEST_SEED ?? 12);
  assert.ok(Number.isSafeInteger(seed), "provide a safe integer match seed");
  const idleSeconds = Number(process.env.BROWSER_TEST_NPC_IDLE_SECONDS ?? 30);
  assert.ok(Number.isSafeInteger(idleSeconds) && idleSeconds >= 30 && idleSeconds <= 60,
    "provide an idle observation from 30 to 60 seconds");
  mkdirSync(artifacts, { recursive: true });
  let sessionId;
  const frameRecorder = `window.__startNpcFrames = () => {
        window.__npcFrames = [];
        window.__npcFrameTimer = setInterval(() => {
          const snapshot = window.__probe.snapshot;
          if (!snapshot || snapshot.phase !== 'active' ||
              !snapshot.entities?.some(entity => entity.state.kind === 'npc') ||
              window.__npcFrames.at(-1)?.snapshot.tick === snapshot.tick) return;
          const canvas = document.querySelector('canvas');
          window.__npcFrames.push({
            elapsedMs: performance.now(), snapshot: structuredClone(snapshot),
            squares: structuredClone(canvas?.__draw?.squares ?? []),
            renderedTick: canvas?.__draw?.snapshotTick
          });
          if (window.__npcFrames.length >= 2400) clearInterval(window.__npcFrameTimer);
        }, 10);
      };`;

  async function keyboardWithoutClick(label) {
    await waitFor(playerPage, `window.__probe.snapshot?.viewerRole === 'player' &&
      document.querySelector('canvas') !== null`, 15_000);
    const mountedAt = await evaluate(playerPage, "performance.now()");
    await waitFor(playerPage, "document.activeElement === document.querySelector('canvas')", 3_000)
      .catch(() => undefined);
    const canvasFocused = await evaluate(playerPage,
      "document.activeElement === document.querySelector('canvas')");
    const focusedAfterMs = (await evaluate(playerPage, "performance.now()")) - mountedAt;
    // A player rejoining while dead keeps focus and is tested after the respawn delay.
    const aliveAtEntry = own(await state(playerPage)).health > 0;
    await waitFor(playerPage, `window.__probe.snapshot.players.find(item =>
      item.accountId === window.__probe.snapshot.viewerAccountId)?.health > 0 &&
      window.__probe.snapshot.phase === 'active'`, 8_000).catch(() => undefined);
    const before = await state(playerPage);
    const self = own(before);
    if (self.health <= 0) {
      return { label, canvasFocused, focusedAfterMs, aliveAtEntry, alive: false, moved: 0 };
    }
    const stillFocused = await evaluate(playerPage,
      "document.activeElement === document.querySelector('canvas')");
    // The harness account uses keyboard-mouse controls, where arrows move the player.
    const [code, keyCode] = self.position.x < before.snapshot.map.width / 2
      ? ["ArrowRight", 39] : ["ArrowLeft", 37];
    await cdp("Input.dispatchKeyEvent", { type: "rawKeyDown", key: code, code,
      windowsVirtualKeyCode: keyCode }, playerPage.session);
    await delay(400);
    await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: code, code,
      windowsVirtualKeyCode: keyCode }, playerPage.session);
    await delay(250);
    const after = own(await state(playerPage));
    return { label, canvasFocused, focusedAfterMs: Number(focusedAfterMs.toFixed(0)), aliveAtEntry,
      stillFocused, alive: true, key: code,
      moved: Number(Math.hypot(after.position.x - self.position.x,
        after.position.y - self.position.y).toFixed(2)) };
  }
  try {
    const { windowId } = await cdp("Browser.getWindowForTarget", {
      targetId: playerPage.target
    });
    await cdp("Browser.setWindowBounds", {
      windowId, bounds: { width: 1920, height: 1080, windowState: "normal" }
    });
    await evaluate(playerPage, `document.querySelector('[name=setting-mapMode]').value = 'fixed';
      document.querySelector('[name=setting-mapMode]').dispatchEvent(new Event('change'));
      ${frameRecorder}`);
    await click(playerPage, "Create session");
    sessionId = await seedWaitingRoom({
      alice: playerPage, creator, evaluate, origin
    }, seed);
    const settings = await evaluate(playerPage, `(async () =>
      (await (await fetch('/api/v1/sessions/${sessionId}')).json()).settings)()`);
    assert.equal(settings.npcMovementSpeed, 67.5);
    assert.equal(settings.npcDetectionRange, 512);
    assert.equal(settings.initialNpcsPerPlayer, 5);
    assert.equal(settings.baseNpcHealth, 50);
    assert.equal(settings.maxLevels, 5);
    if (routeOnly) await evaluate(playerPage, "window.__startNpcFrames()");
    await clickSessionButton(playerPage, creator, "Start Session");
    await cdp("Page.bringToFront", {}, playerPage.session);
    const capture = async name => {
      const image = await cdp("Page.captureScreenshot", { format: "png" }, playerPage.session);
      writeFileSync(join(artifacts, `${name}.png`), Buffer.from(image.data, "base64"));
    };
    // No mouse event reaches the arena: entry focus alone must make movement keys work.
    const entry = routeOnly
      ? { label: "idle-observation", noArenaInput: true }
      : await keyboardWithoutClick("entry");
    if (routeOnly) {
      await waitFor(playerPage, `window.__probe.snapshot?.viewerRole === 'player' &&
        document.querySelector('canvas') !== null`, 15_000);
      await cdp("Page.bringToFront", {}, playerPage.session);
      await evaluate(playerPage, "document.querySelector('canvas').focus()");
      for (const [key, code, windowsVirtualKeyCode] of [
        ["ArrowUp", "ArrowUp", 38], ["ArrowDown", "ArrowDown", 40],
        ["ArrowLeft", "ArrowLeft", 37], ["ArrowRight", "ArrowRight", 39],
        ["w", "KeyW", 87], ["a", "KeyA", 65], ["s", "KeyS", 83], ["d", "KeyD", 68]
      ]) {
        await cdp("Input.dispatchKeyEvent", {
          type: "keyUp", key, code, windowsVirtualKeyCode
        }, playerPage.session);
      }
      await delay(250);
      const beforeIdle = own(await state(playerPage)).position;
      await delay(250);
      assert.deepEqual(own(await state(playerPage)).position, beforeIdle,
        "player is stationary before the idle trace starts");
    }
    await capture("wave-start");
    const firstView = await state(playerPage);
    if (!routeOnly) {
      await delay(500);
      await evaluate(playerPage, "window.__startNpcFrames()");
    }
    await waitFor(playerPage, `window.__npcFrames.at(-1).snapshot.tick -
      window.__npcFrames[0].snapshot.tick >= ${idleSeconds * 30}`, idleSeconds * 1000 + 5_000);
    const lastView = await state(playerPage);
    await capture("wave-plus-thirty-seconds");
    const frames = await evaluate(playerPage, `(() => {
      clearInterval(window.__npcFrameTimer);
      return window.__npcFrames;
    })()`);
    const first = frames[0].snapshot;
    const last = frames.at(-1).snapshot;
    const player = own(firstView);
    const ownAt = snapshot => snapshot.players.find(item => item.accountId === player.accountId);
    // The idle player may be killed by pursuers and respawn; otherwise its position never changes.
    const playerTrace = frames.map(({ snapshot }) => ({ tick: snapshot.tick, ...ownAt(snapshot) }));
    const playerDeaths = playerTrace.filter((item, index) =>
      index > 0 && item.health <= 0 && playerTrace[index - 1].health > 0).length;
    const inputMoves = playerTrace.filter((item, index) => index > 0 &&
      item.health > 0 && playerTrace[index - 1].health > 0 &&
      (item.position.x !== playerTrace[index - 1].position.x ||
        item.position.y !== playerTrace[index - 1].position.y));
    assert.deepEqual(inputMoves, [], "player stayed idle for the observation");
    const fullStep = settings.npcMovementSpeed / 30;
    const contact = player.radius ?? 14;
    const analyze = (frames, view) => {
    const first = frames[0].snapshot;
    const enemies = first.entities.filter(entity => entity.state.kind === "npc");
    const inRangeCounts = frames.map(({ snapshot }) => snapshot.entities.filter(entity =>
      entity.state.kind === "npc" && snapshot.players.some(item => item.health > 0 &&
        Math.hypot(entity.position.x - item.position.x, entity.position.y - item.position.y) <=
          settings.npcDetectionRange)).length);
    const movements = enemies.map(npc => {
      const samples = frames.flatMap(({ snapshot, squares }) => {
        const position = snapshot.entities.find(entity => entity.id === npc.id)?.position;
        return position ? [{ tick: snapshot.tick, position, players: snapshot.players, squares }] : [];
      });
      let distance = 0; let stationaryTicks = 0; let longestStationaryTicks = 0;
      let pursuingTicks = 0; let exploringTicks = 0; let inRangeTicks = 0;
      let inRangeExploringTicks = 0; let inRangeExploringDistance = 0; let farthest = 0;
      const windows = Array(Math.ceil(idleSeconds / 5)).fill(0);
      for (let index = 1; index < samples.length; index++) {
        const previous = samples[index - 1]; const current = samples[index];
        const ticks = current.tick - previous.tick;
        const travel = Math.hypot(current.position.x - previous.position.x,
          current.position.y - previous.position.y);
        const nearest = Math.min(...current.players.filter(item => item.health > 0).map(item =>
          Math.hypot(current.position.x - item.position.x, current.position.y - item.position.y)));
        const inRange = nearest <= settings.npcDetectionRange;
        // Pursuit moves at configured speed; Explore moves at half speed.
        const pursuing = travel >= ticks * fullStep * 0.9 ||
          (inRange && travel === 0 && nearest <= npc.radius + contact + 2);
        if (inRange) inRangeTicks += ticks;
        if (pursuing) { pursuingTicks += ticks; stationaryTicks = 0; continue; }
        exploringTicks += ticks;
        current.exploring = true;
        distance += travel;
        windows[Math.min(windows.length - 1,
          Math.floor((current.tick - first.tick - 1) / 150))] += travel;
        if (inRange) { inRangeExploringTicks += ticks; inRangeExploringDistance += travel; }
        stationaryTicks = travel === 0 ? stationaryTicks + ticks : 0;
        longestStationaryTicks = Math.max(longestStationaryTicks, stationaryTicks);
        farthest = Math.max(farthest, Math.hypot(current.position.x - samples[0].position.x,
          current.position.y - samples[0].position.y));
      }
      // Painted squares are located relative to this viewer's camera on each sample.
      const painted = samples.flatMap(sample => {
        const self = sample.players.find(item => item.accountId === player.accountId);
        if (!sample.exploring || !self || self.health <= 0) return [];
        const x = sample.position.x - self.position.x + view.width / 2;
        const y = sample.position.y - self.position.y + view.height / 2;
        if (x < npc.radius || y < npc.radius ||
            x > view.width - npc.radius || y > view.height - npc.radius) return [];
        const square = sample.squares.find(rect =>
          Math.hypot(rect.x + rect.w / 2 - x, rect.y + rect.h / 2 - y) < 6);
        return square ? [{ tick: sample.tick, x: square.x, y: square.y }] : [];
      });
      let paintedTravel = 0;
      for (let index = 1; index < painted.length; index++) {
        paintedTravel += Math.hypot(painted[index].x - painted[index - 1].x,
          painted[index].y - painted[index - 1].y);
      }
      return {
        id: npc.id, survivedTicks: samples.at(-1).tick - samples[0].tick,
        from: samples[0].position, to: samples.at(-1).position,
        distanceExploring: Number(distance.toFixed(2)),
        longestStationarySeconds: Number((longestStationaryTicks / 30).toFixed(3)),
        farthestFromStart: Number(farthest.toFixed(2)),
        exploringTicks, pursuingTicks, inRangeTicks, inRangeExploringTicks,
        inRangeExploringDistance: Number(inRangeExploringDistance.toFixed(2)),
        travelPerFiveSeconds: windows.map(value => Number(value.toFixed(2))),
        paintedExploringSamples: painted.length,
        paintedExploringTravel: Number(paintedTravel.toFixed(2))
      };
    });
    return { movements, maxInRange: Math.max(...inRangeCounts),
      ticksWithFourInRange: inRangeCounts.filter(count => count >= 4).length };
    };
    const idle = analyze(frames, firstView);
    const movements = idle.movements;
    if (routeOnly) {
      const spawnSnapshot = await evaluate(playerPage, "window.__probe.firstActiveSnapshot");
      assert.ok(spawnSnapshot, "captured the first active server snapshot");
      const bounds = { width: spawnSnapshot.map.width, height: spawnSnapshot.map.height };
      const spawnNpcs = spawnSnapshot.entities.filter(entity => entity.state.kind === "npc");
      assert.equal(spawnNpcs.length, settings.initialNpcsPerPlayer,
        "all initial NPCs came from the ordinary wave spawn");
      const spawnBands = { outer: 0, middle: 0, interior: 0 };
      const tracks = spawnNpcs.map((npc, index) => {
        const spawn = spawnCellCenter(npc.position);
        const initialBand = classifyBand(spawn, bounds);
        spawnBands[initialBand] += 1;
        const samples = frames.flatMap(({ snapshot }) => {
          const position = snapshot.entities.find(entity => entity.id === npc.id)?.position;
          return position ? [position] : [];
        });
        const movedToInterior = initialBand === "outer" &&
          samples.some(position => classifyBand(position, bounds) === "interior");
        return {
          id: npc.id, index, color: trackColors[index % trackColors.length],
          spawn, initialBand, samples, movedToInterior
        };
      });
      assert.deepEqual(spawnBands, { outer: 1, middle: 2, interior: 2 },
        "the ordinary Fixed wave meets the target spawn-band mix");
      const outerToInteriorIds = tracks.filter(track => track.movedToInterior)
        .map(track => track.id);
      const trackRows = tracks.map(track => ({
        id: track.id, spawn: track.spawn, initialBand: track.initialBand,
        firstSample: track.samples[0], lastSample: track.samples.at(-1),
        movedToInterior: track.movedToInterior
      }));
      const mapSvg = createTrackMap(
        seed, tracks, spawnBands, outerToInteriorIds, bounds
      );
      writeFileSync(join(artifacts, "npc-spawn-tracks.svg"), mapSvg);
      const report = {
        browser, sessionId, seed, settings, firstTick: first.tick, lastTick: last.tick,
        idleSeconds,
        elapsedMs: frames.at(-1).elapsedMs - frames[0].elapsedMs, samples: frames.length,
        playerPosition: ownAt(first).position, playerHealthAtEnd: ownAt(last)?.health,
        playerDeaths, playerInputMoves: inputMoves.length, focus: null,
        spawnSnapshotTick: spawnSnapshot.tick, spawnBands,
        spawnPositionSource: "first active authoritative snapshot, snapped to Fixed 32-unit spawn-cell centers",
        interiorSpawns: spawnBands.interior,
        outerToInteriorCount: outerToInteriorIds.length,
        outerToInteriorIds, npcTracks: trackRows,
        mapArtifacts: ["npc-spawn-tracks.svg", "npc-spawn-tracks.png"],
        idle: { maxInRange: idle.maxInRange,
          ticksWithFourInRange: idle.ticksWithFourInRange, movements },
        center: null, viewport: { width: lastView.width, height: lastView.height },
        conditions: `Local server, Fixed, default tuning, idle player for ${idleSeconds} s with no arena keyboard events or entity staging; normal 1920x1080 browser window, no device metrics override`
      };
      writeFileSync(join(artifacts, "roaming.json"), JSON.stringify(report, null, 2));
      writeFileSync(join(artifacts, "frames.json"), JSON.stringify(frames.map(({ elapsedMs, snapshot }) => ({
        elapsedMs,
        tick: snapshot.tick,
        players: snapshot.players.map(({ accountId, health, position }) =>
          ({ accountId, health, position })),
        npcs: snapshot.entities.filter(entity => entity.state.kind === "npc")
          .map(({ id, position }) => ({ id, position }))
      }))));
      console.log(JSON.stringify({ ...report, movements: undefined }, null, 2));
      console.log(`Idle ${idleSeconds}-second observation`);
      console.table(movements.map(({ from, to, travelPerFiveSeconds, survivedTicks, ...row }) => row));
      for (const npc of movements) {
        if (npc.exploringTicks < 150) continue;
        assert.ok(npc.longestStationarySeconds <= 1, `${npc.id} never idles more than one second`);
        assert.ok(npc.distanceExploring >= npc.exploringTicks * fullStep * 0.5 * 0.6,
          `${npc.id} keeps exploring at half speed`);
      }
      assert.ok(movements.filter(npc =>
        npc.exploringTicks >= idleSeconds * 30 * 0.9).length >= 6,
      "most NPCs explore for the full observation");
      assert.ok(movements.some(npc => npc.paintedExploringTravel > 60),
        "an exploring NPC is visibly moving in the rendered arena");
      const mapPage = await newWindow();
      await cdp("Emulation.setDeviceMetricsOverride", {
        width: 1240, height: 1000, deviceScaleFactor: 1, mobile: false
      }, mapPage.session);
      await cdp("Page.navigate", {
        url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(mapSvg)}`
      }, mapPage.session);
      await waitFor(mapPage, "document.documentElement?.tagName?.toLowerCase() === 'svg'", 5_000);
      const mapImage = await cdp("Page.captureScreenshot", { format: "png" }, mapPage.session);
      writeFileSync(join(artifacts, "npc-spawn-tracks.png"), Buffer.from(mapImage.data, "base64"));
      return;
    }
    const tab = await evaluate(playerPage, "document.activeElement === document.querySelector('canvas')");
    await cdp("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Tab", code: "Tab",
      windowsVirtualKeyCode: 9 }, playerPage.session);
    await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab",
      windowsVirtualKeyCode: 9 }, playerPage.session);
    await delay(500);
    const afterTab = await evaluate(playerPage, `(() => ({
      canvasFocused: document.activeElement === document.querySelector('canvas'),
      active: document.activeElement?.tagName + ':' + (document.activeElement?.textContent ?? '').slice(0, 40)
    }))()`);
    await cdp("Page.reload", {}, playerPage.session);
    await waitFor(playerPage, `[...document.querySelectorAll('tbody tr')].some(row =>
      row.children[1]?.textContent === ${JSON.stringify(creator)} &&
      [...row.querySelectorAll('button')].some(button => button.textContent === 'Rejoin'))`, 15_000);
    await clickSessionButton(playerPage, creator, "Rejoin");
    await cdp("Page.bringToFront", {}, playerPage.session);
    const rejoin = await keyboardWithoutClick("rejoin");
    // Second phase: walk toward the arena center so several exploring NPCs come within detection,
    // then stay idle while the two pursuit slots are held and the others keep exploring.
    const keys = [["ArrowRight", 39], ["ArrowDown", 40]];
    for (const [code, keyCode] of keys) {
      await cdp("Input.dispatchKeyEvent", { type: "rawKeyDown", key: code, code,
        windowsVirtualKeyCode: keyCode }, playerPage.session);
    }
    await waitFor(playerPage, `(() => { const s = window.__probe.snapshot;
      const p = s.players.find(item => item.accountId === s.viewerAccountId);
      return p.health <= 0 || Math.hypot(p.position.x - s.map.width / 2, p.position.y - s.map.height / 2) < 160 ||
        (p.position.x > s.map.width / 2 && p.position.y > s.map.height / 2); })()`, 12_000)
      .catch(() => undefined);
    for (const [code, keyCode] of keys) {
      await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: code, code,
        windowsVirtualKeyCode: keyCode }, playerPage.session);
    }
    await delay(500);
    const centerView = await state(playerPage);
    await evaluate(playerPage, `${frameRecorder}; window.__startNpcFrames()`);
    await delay(15_000);
    const centerFrames = await evaluate(playerPage, `(() => {
      clearInterval(window.__npcFrameTimer);
      return window.__npcFrames;
    })()`);
    await capture("center-plus-fifteen-seconds");
    const center = analyze(centerFrames, centerView);
    const report = {
      browser, sessionId, seed, settings, firstTick: first.tick, lastTick: last.tick,
      idleSeconds,
      elapsedMs: frames.at(-1).elapsedMs - frames[0].elapsedMs, samples: frames.length,
      playerPosition: ownAt(first).position, playerHealthAtEnd: ownAt(last)?.health, playerDeaths,
      focus: { entry, canvasFocusedBeforeTab: tab, afterTab, rejoin },
      idle: { maxInRange: idle.maxInRange, ticksWithFourInRange: idle.ticksWithFourInRange, movements },
      center: { playerPosition: own(centerView).position, samples: centerFrames.length,
        maxInRange: center.maxInRange, ticksWithFourInRange: center.ticksWithFourInRange,
        movements: center.movements },
      viewport: { width: lastView.width, height: lastView.height },
      conditions: `Local server, Fixed, default tuning, idle player for ${idleSeconds} s after a no-click keyboard check, no entity staging; normal 1920x1080 browser window, no device metrics override`
    };
    writeFileSync(join(artifacts, "roaming.json"), JSON.stringify(report, null, 2));
    writeFileSync(join(artifacts, "frames.json"), JSON.stringify(frames));
    console.log(JSON.stringify({ ...report, movements: undefined }, null, 2));
    const table = rows => rows.map(({ from, to, travelPerFiveSeconds, survivedTicks, ...row }) => row);
    console.log(`Idle ${idleSeconds}-second observation`); console.table(table(movements));
    console.log("Center 15-second observation", { maxInRange: center.maxInRange,
      ticksWithFourInRange: center.ticksWithFourInRange });
    console.table(table(center.movements));
    assert.equal(entry.canvasFocused, true, "the arena is focused on match entry");
    assert.ok(entry.moved > 0, "movement keys work on entry without clicking");
    assert.equal(afterTab.canvasFocused, false, "Tab moves focus out of the arena");
    assert.equal(rejoin.canvasFocused, true, "the arena is focused on rejoin");
    assert.ok(rejoin.alive && rejoin.moved > 0, "movement keys work on rejoin without clicking");
    for (const npc of movements) {
      if (npc.exploringTicks < 150) continue;
      assert.ok(npc.longestStationarySeconds <= 1, `${npc.id} never idles more than one second`);
      assert.ok(npc.distanceExploring >= npc.exploringTicks * fullStep * 0.5 * 0.6,
        `${npc.id} keeps exploring at half speed`);
    }
    assert.ok(movements.filter(npc =>
      npc.exploringTicks >= idleSeconds * 30 * 0.9).length >= 6,
      "most NPCs explore for the full observation");
    const centerExplorersInRange = center.movements.filter(npc => npc.inRangeExploringTicks >= 30);
    for (const npc of centerExplorersInRange) {
      assert.ok(npc.inRangeExploringDistance >= npc.inRangeExploringTicks * fullStep * 0.5 * 0.5,
        `${npc.id} keeps exploring inside detection range without a pursuit slot`);
      assert.ok(npc.longestStationarySeconds <= 1, `${npc.id} does not idle inside detection range`);
    }
    assert.ok([...movements, ...center.movements].some(npc => npc.paintedExploringTravel > 60),
      "an exploring NPC is visibly moving in the rendered arena");
  } finally {
    await evaluate(playerPage, "clearInterval(window.__npcFrameTimer)");
    if (sessionId) {
      assert.equal(await evaluate(playerPage, `(async () => (await fetch(
        '/api/v1/sessions/${sessionId}/leave',
        {method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status)()`), 204);
    }
  }
}
