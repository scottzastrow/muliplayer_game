import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

export async function verifyLevelTransitions({ newWindow, signIn, evaluate, click,
  clickSessionButton, waitFor, cdp, delay, state, aim, version }) {
  const player = await newWindow();
  const observer = await newWindow();
  const username = `Wave_${Date.now().toString(36)}`;
  await signIn(player, username, randomUUID());
  await signIn(observer, `Watch_${Date.now().toString(36)}`, randomUUID());
  const defaults = await evaluate(player, `Object.fromEntries(
    [...document.querySelectorAll('[name^="setting-"]')].map(input =>
      [input.name.slice(8), input.value]))`);
  assert.equal(defaults.initialNpcsPerPlayer, "10");
  assert.equal(defaults.npcPopulationGrowthPercent, "20");
  assert.equal(defaults.baseNpcHealth, "50");
  assert.equal(defaults.maxLevels, "5");
  await click(player, "Create session");
  const id = await evaluate(player, `(async () =>
    (await (await fetch('/api/v1/sessions')).json()).sessions
      .find(room => room.creator === ${JSON.stringify(username)}).id)()`);
  try {
    await clickSessionButton(player, username, "Start Session");
    await waitFor(player, "window.__probe.snapshot?.startingNpcCount === 10");
    await click(observer, "Refresh sessions");
    await clickSessionButton(observer, username, "Spectate");
    await click(observer, `Follow ${username}`);
    await waitFor(observer, "window.__probe.snapshot?.viewerRole === 'spectator'");
    const first = await state(player);
    assert.equal(first.snapshot.livingNpcCount, 10);
    assert.equal(first.snapshot.entities.filter(entity => entity.state.kind === "npc").length, 10);
    const hud = page => evaluate(page, `({
      count: document.querySelector('.default-enemy-count').textContent,
      visible: !document.querySelector('.default-level-summary').hidden,
      summary: document.querySelector('.default-level-summary').textContent,
      rows: [...document.querySelector('[aria-label="Running standings"] tbody').rows]
        .map(row => [...row.cells].map(cell => cell.textContent))
    })`);
    assert.equal((await hud(player)).count, "Level 1 \u00b7 10 of 10 enemies remaining");
    await evaluate(player, `window.__waveTrace = [];
      const Native = window.__probe;
      setInterval(() => {
        const s = Native.snapshot;
        const row = {tick:s.tick, level:s.level, phase:s.phase,
          living:s.livingNpcCount, starting:s.startingNpcCount,
          deadline:s.intermissionEndsAtTick};
        if (window.__waveTrace.at(-1)?.tick !== s.tick) window.__waveTrace.push(row);
      }, 10)`);
    await aim(player, 128, 0);
    const bounds = await evaluate(player, `(() => {
      const r = document.querySelector('canvas').getBoundingClientRect();
      return {x:r.left+r.width/2+128, y:r.top+r.height/2};
    })()`);
    await cdp("Input.dispatchMouseEvent", {
      type: "mousePressed", button: "left", buttons: 1, clickCount: 1, ...bounds
    }, player.session);
    await waitFor(player, "window.__probe.snapshot.livingNpcCount === 7", 30000);
    for (const page of [player, observer]) {
      await waitFor(page, "window.__probe.snapshot.livingNpcCount === 7");
      await evaluate(page, `(() => {
        const input = document.querySelector('[name="radar-enemy"]');
        input.checked = false; input.dispatchEvent(new Event('change'));
      })()`);
      await delay(50);
      assert.equal((await hud(page)).count, "Level 1 \u00b7 7 of 10 enemies remaining");
    }
    await waitFor(player, "window.__probe.snapshot.phase === 'intermission'", 30000);
    await cdp("Input.dispatchMouseEvent", {
      type: "mouseReleased", button: "left", buttons: 0, clickCount: 1, ...bounds
    }, player.session);
    await waitFor(observer, "window.__probe.snapshot.phase === 'intermission'");
    for (const page of [player, observer]) {
      await waitFor(page, "!document.querySelector('.default-level-summary').hidden");
      const summary = await hud(page);
      assert.ok(summary.visible);
      assert.ok(summary.summary.includes("Level 1 Complete"));
      assert.ok(summary.summary.includes("Points earned this level: 1000"));
      assert.match(summary.summary, /Level 2 starts in [1-5]\u2026/);
      assert.deepEqual(summary.rows, [["1", username, "1000", "1000", "10", "0"]]);
    }
    await waitFor(player, "window.__probe.snapshot.level === 2");
    await waitFor(observer, "window.__probe.snapshot.level === 2");
    const second = await state(player);
    assert.equal(second.snapshot.startingNpcCount, 12);
    assert.equal(second.snapshot.livingNpcCount, 12);
    assert.equal(second.snapshot.entities.filter(entity => entity.state.kind === "npc").length, 12);
    assert.equal(second.snapshot.levelStandings[0].levelPoints, 0);
    for (const page of [player, observer]) {
      assert.equal((await hud(page)).count, "Level 2 \u00b7 12 of 12 enemies remaining");
      assert.equal((await hud(page)).visible, false);
    }
    const trace = await evaluate(player, "window.__waveTrace");
    const intermission = trace.filter(row => row.phase === "intermission");
    assert.ok(intermission.length > 50);
    assert.ok(intermission.every(row => row.level === 1 && row.living === 0 && row.starting === 10));
    const next = trace.find(row => row.level === 2);
    assert.ok(next.tick >= intermission[0].deadline);
    assert.ok(trace.filter(row => row.level === 1 && row.phase === "active")
      .every((row, index, rows) => index === 0 || row.living <= rows[index - 1].living));
    console.log(JSON.stringify({ browser: version.Browser, wave1: 10, wave2: 12,
      wave1ObservedCounts: [...new Set(trace.filter(row => row.level === 1).map(row => row.living))],
      intermissionFirstTick: intermission[0].tick, deadline: intermission[0].deadline,
      wave2FirstTick: next.tick, pointsEarned: 1000,
      playerAndSpectatorSummary: true, radarFilteredCount: true,
      fixture: "Default settings; one NPC at a time staged in a clear lane; real mouse combat."
    }, null, 2));
  } finally {
    const status = await evaluate(player, `(async () => (await fetch(
      '/api/v1/sessions/${id}/leave', {method:'POST',
        headers:{'content-type':'application/json'}, body:'{}'})).status)()`);
    assert.equal(status, 204);
  }
}
