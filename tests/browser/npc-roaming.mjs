import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { seedWaitingRoom } from "./npc-spawns.mjs";

export async function verifyNpcRoaming({
  playerPage, creator, cdp, evaluate, waitFor, click, clickSessionButton,
  state, own, delay, browser, origin
}) {
  const artifacts = process.env.BROWSER_TEST_ARTIFACT_DIR;
  assert.ok(artifacts, "provide a directory for actual browser evidence");
  const seed = Number(process.env.BROWSER_TEST_SEED ?? 12);
  assert.ok(Number.isSafeInteger(seed), "provide a safe integer match seed");
  mkdirSync(artifacts, { recursive: true });
  let sessionId;
  const frameRecorder = `window.__startNpcFrames = () => {
        window.__npcFrames = [];
        window.__npcFrameTimer = setInterval(() => {
          const snapshot = window.__probe.snapshot;
          if (!snapshot || window.__npcFrames.at(-1)?.snapshot.tick === snapshot.tick) return;
          const canvas = document.querySelector('canvas');
          window.__npcFrames.push({
            elapsedMs: performance.now(), snapshot: structuredClone(snapshot),
            squares: structuredClone(canvas?.__draw?.squares ?? []),
            renderedTick: canvas?.__draw?.snapshotTick
          });
          if (window.__npcFrames.length >= 2000) clearInterval(window.__npcFrameTimer);
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
    assert.equal(settings.initialNpcsPerPlayer, 10);
    assert.equal(settings.baseNpcHealth, 50);
    assert.equal(settings.maxLevels, 5);
    await clickSessionButton(playerPage, creator, "Start Session");
    await cdp("Page.bringToFront", {}, playerPage.session);
    const capture = async name => {
      const image = await cdp("Page.captureScreenshot", { format: "png" }, playerPage.session);
      writeFileSync(join(artifacts, `${name}.png`), Buffer.from(image.data, "base64"));
    };
    // No mouse event reaches the arena: entry focus alone must make movement keys work.
    const entry = await keyboardWithoutClick("entry");
    await capture("wave-start");
    const firstView = await state(playerPage);
    await delay(500);
    await evaluate(playerPage, "window.__startNpcFrames()");
    await delay(30_000);
    await waitFor(playerPage, `window.__npcFrames.at(-1).snapshot.tick -
      window.__npcFrames[0].snapshot.tick >= 900`, 5_000);
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
      const windows = [0, 0, 0, 0, 0, 0];
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
        windows[Math.min(5, Math.floor((current.tick - first.tick - 1) / 150))] += travel;
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
      elapsedMs: frames.at(-1).elapsedMs - frames[0].elapsedMs, samples: frames.length,
      playerPosition: ownAt(first).position, playerHealthAtEnd: ownAt(last)?.health, playerDeaths,
      focus: { entry, canvasFocusedBeforeTab: tab, afterTab, rejoin },
      idle: { maxInRange: idle.maxInRange, ticksWithFourInRange: idle.ticksWithFourInRange, movements },
      center: { playerPosition: own(centerView).position, samples: centerFrames.length,
        maxInRange: center.maxInRange, ticksWithFourInRange: center.ticksWithFourInRange,
        movements: center.movements },
      viewport: { width: lastView.width, height: lastView.height },
      conditions: "Local server, Fixed, default tuning, idle player for 30 s after a no-click keyboard check, no entity staging; normal 1920x1080 browser window, no device metrics override"
    };
    writeFileSync(join(artifacts, "roaming.json"), JSON.stringify(report, null, 2));
    writeFileSync(join(artifacts, "frames.json"), JSON.stringify(frames));
    console.log(JSON.stringify({ ...report, movements: undefined }, null, 2));
    const table = rows => rows.map(({ from, to, travelPerFiveSeconds, survivedTicks, ...row }) => row);
    console.log("Idle 30-second observation"); console.table(table(movements));
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
    assert.ok(movements.filter(npc => npc.exploringTicks >= 850).length >= 6,
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
