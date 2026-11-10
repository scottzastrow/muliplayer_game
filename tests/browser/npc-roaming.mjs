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
  mkdirSync(artifacts, { recursive: true });
  let sessionId;
  try {
    // Fit the unmodified arena in view: ordinary follow-camera windows hide distant roamers.
    await cdp("Emulation.setDeviceMetricsOverride", {
      width: 4096, height: 4096, deviceScaleFactor: 0.5, mobile: false
    }, playerPage.session);
    await evaluate(playerPage, `document.querySelector('[name=setting-mapMode]').value = 'fixed';
      document.querySelector('[name=setting-mapMode]').dispatchEvent(new Event('change'));
      window.__npcFrames = [];
      const timer = setInterval(() => {
        const snapshot = window.__probe.snapshot;
        if (!snapshot || window.__npcFrames.at(-1)?.tick === snapshot.tick) return;
        window.__npcFrames.push(structuredClone(snapshot));
        if (window.__npcFrames.length >= 100) clearInterval(timer);
      }, 10);`);
    await click(playerPage, "Create session");
    sessionId = await seedWaitingRoom({
      alice: playerPage, creator, evaluate, origin
    }, 42);
    const settings = await evaluate(playerPage, `(async () =>
      (await (await fetch('/api/v1/sessions/${sessionId}')).json()).settings)()`);
    assert.equal(settings.npcMovementSpeed, 67.5);
    assert.equal(settings.npcDetectionRange, 512);
    assert.equal(settings.initialNpcsPerPlayer, 10);
    assert.equal(settings.baseNpcHealth, 50);
    await clickSessionButton(playerPage, creator, "Start Session");
    await cdp("Page.bringToFront", {}, playerPage.session);
    await waitFor(playerPage, "window.__probe.snapshot && document.querySelector('canvas')");
    const firstView = await state(playerPage);
    const capture = async name => {
      const image = await cdp("Page.captureScreenshot", { format: "png" }, playerPage.session);
      writeFileSync(join(artifacts, `${name}.png`), Buffer.from(image.data, "base64"));
    };
    await capture("wave-start");
    await delay(3_000);
    const lastView = await state(playerPage);
    await capture("wave-plus-three-seconds");
    const frames = await evaluate(playerPage, "window.__npcFrames");
    const first = frames[0];
    const last = frames.at(-1);
    const player = own(firstView);
    assert.deepEqual(own(lastView).position, player.position, "player stayed still");
    assert.equal(lastView.actions.some(input => input.payload?.action?.fire), false);
    const enemies = first.entities.filter(entity => entity.state.kind === "npc");
    const movements = enemies.map(npc => {
      const positions = frames.map(frame => frame.entities.find(entity => entity.id === npc.id)?.position)
        .filter(Boolean);
      const outsideThroughout = positions.every((position, index) => {
        const players = frames[index].players.filter(item => item.alive);
        return players.every(item => Math.hypot(
          position.x - item.position.x, position.y - item.position.y
        ) > settings.npcDetectionRange);
      });
      return {
        id: npc.id, outsideThroughout, from: npc.position,
        to: positions.at(-1),
        firstMovingTick: frames.find(frame => {
          const current = frame.entities.find(entity => entity.id === npc.id);
          return current && Math.hypot(current.position.x - npc.position.x,
            current.position.y - npc.position.y) > 0.1;
        })?.tick ?? null,
        distance: Math.hypot(positions.at(-1).x - npc.position.x,
          positions.at(-1).y - npc.position.y)
      };
    });
    const roaming = movements.filter(npc => npc.outsideThroughout);
    const painted = [];
    for (const [label, view] of [["start", firstView], ["end", lastView]]) {
      const camera = own(view).position;
      for (const npc of view.snapshot.entities.filter(entity => entity.state.kind === "npc")) {
        const x = npc.position.x - camera.x + view.width / 2;
        const y = npc.position.y - camera.y + view.height / 2;
        const square = view.squares.find(rect =>
          Math.hypot(rect.x + rect.w / 2 - x, rect.y + rect.h / 2 - y) < 6);
        assert.ok(square, `${label}: ${npc.id} is actually drawn in the world viewport`);
        painted.push({ label, id: npc.id, x: square.x, y: square.y });
      }
    }
    for (const npc of roaming) {
      const start = painted.find(square => square.label === "start" && square.id === npc.id);
      const end = painted.find(square => square.label === "end" && square.id === npc.id);
      npc.worldPaintDistance = Math.hypot(end.x - start.x, end.y - start.y);
      assert.ok(npc.worldPaintDistance > 10, `${npc.id}: visible world-square movement`);
      const project = position => {
        const dx = position.x - player.position.x;
        const dy = position.y - player.position.y;
        const scale = 67 / Math.max(512, Math.hypot(dx, dy));
        return { x: dx * scale, y: dy * scale };
      };
      const from = project(npc.from);
      const to = project(npc.to);
      npc.projectedRadarDistance = Math.hypot(to.x - from.x, to.y - from.y);
    }
    const pixels = await evaluate(playerPage, `(() => {
      const canvas = document.querySelector('canvas');
      const context = canvas.getContext('2d');
      const scale = canvas.width / canvas.getBoundingClientRect().width;
      return canvas.__draw.squares.every(square => {
        const pixel = context.getImageData(
          Math.floor((square.x + square.w / 2) * scale),
          Math.floor((square.y + square.h / 2) * scale), 1, 1).data;
        return pixel[0] === 237 && pixel[1] === 107 && pixel[2] === 97 && pixel[3] === 255;
      });
    })()`);
    assert.ok(pixels, "world NPC squares contain actual opaque NPC-color pixels");
    const report = {
      browser, sessionId, settings, firstTick: first.tick, lastTick: last.tick,
      playerPosition: player.position, movements, painted, npcPixels: pixels,
      firstWorldSquares: firstView.squares.length, lastWorldSquares: lastView.squares.length,
      viewport: { width: lastView.width, height: lastView.height },
      artifacts, conditions: "Fixed seed 42, default tuning, idle player, no entity staging; enlarged 4096x4096 CSS viewport at 0.5 device scale to expose distant NPCs"
    };
    writeFileSync(join(artifacts, "roaming.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    assert.ok(roaming.length >= 6, "several NPCs remain outside detection throughout");
    assert.ok(roaming.every(npc => npc.distance > 10),
      "every out-of-range NPC visibly travels from wave start");
    assert.ok(roaming.every(npc => npc.firstMovingTick <= first.tick + 9),
      "all out-of-range NPCs begin moving within the first few snapshots");
  } finally {
    if (sessionId) {
      assert.equal(await evaluate(playerPage, `(async () => (await fetch(
        '/api/v1/sessions/${sessionId}/leave',
        {method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status)()`), 204);
    }
  }
}
