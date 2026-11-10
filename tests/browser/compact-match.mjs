import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

async function capture(page, name, cdp) {
  const directory = process.env.BROWSER_TEST_ARTIFACT_DIR;
  assert.ok(directory, "provide an artifact directory for layout screenshots");
  mkdirSync(directory, { recursive: true });
  const image = await cdp("Page.captureScreenshot", { format: "png" }, page.session);
  writeFileSync(join(directory, `${name}.png`), Buffer.from(image.data, "base64"));
}

async function layout(page, evaluate) {
  return evaluate(page, `(() => {
    const rect = element => {
      const {x,y,width,height,bottom,right} = element.getBoundingClientRect();
      return {x,y,width,height,bottom,right};
    };
    const visible = element => element && !element.hidden &&
      getComputedStyle(element).display !== 'none' && element.getBoundingClientRect().height > 0;
    const bar = document.querySelector('.game-hud');
    const canvas = document.querySelector('canvas');
    return {
      viewport: {width:innerWidth,height:innerHeight},
      document: {width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight},
      headings: [...document.querySelectorAll('h1,h2')].filter(visible).map(node => node.textContent),
      bar: rect(bar), canvas: rect(canvas),
      stats: [...bar.children].filter(visible).map(node => ({text:node.textContent,...rect(node)})),
      timerVisible: visible(document.querySelector('.default-wave-time')),
      duplicateCount: document.querySelectorAll('.default-enemy-count').length,
      lifeVisible: visible(document.querySelector('.default-life')),
      radar: canvas.__draw?.arcs.some(arc => arc.r === 72 &&
        arc.x === canvas.getBoundingClientRect().width - 84 && arc.y === 84),
      summaryVisible: visible(document.querySelector('.default-level-summary')),
      summaryRows: document.querySelector('[aria-label="Running standings"] tbody').rows.length,
      spectatorActions: window.__probe.actions.length
    };
  })()`);
}

function assertFits(view) {
  assert.ok(view.document.width <= view.viewport.width, "no horizontal page scrolling");
  assert.ok(view.document.height <= view.viewport.height, "no vertical page scrolling");
  assert.ok(Math.abs(view.canvas.right - view.viewport.width) <= 1, "arena fills browser width");
  assert.ok(Math.abs(view.canvas.bottom - view.viewport.height) <= 1, "arena reaches browser bottom");
  assert.ok(Math.abs(view.canvas.y - view.bar.bottom) <= 1, "no space between bar and arena");
  assert.ok(view.radar, "radar remains overlaid inside the arena");
  assert.equal(view.duplicateCount, 0);
}

export async function verifyCompactLayout({ player, observer, cdp, evaluate, waitFor, delay }) {
  for (const [width, height] of [[1366, 768], [1440, 900], [1920, 1080]]) {
    for (const [role, page] of [["player", player], ["spectator", observer]]) {
      const { windowId } = await cdp("Browser.getWindowForTarget", { targetId: page.target });
      await cdp("Browser.setWindowBounds", {
        windowId, bounds: { width, height, windowState: "normal" }
      });
      await cdp("Page.bringToFront", {}, page.session);
      await waitFor(page, "document.querySelector('.default-points')?.textContent.startsWith('Score:')");
      await delay(150);
      const view = await layout(page, evaluate);
      assertFits(view);
      assert.deepEqual(view.headings, []);
      assert.ok(view.bar.height <= 48, "one slim top bar");
      assert.ok(view.canvas.height >= view.viewport.height - 48, "arena fills remaining height");
      assert.deepEqual(view.stats.slice(0, 3).map(stat => stat.text), [
        "Back to lobby", "Score: 0", "Health: 150 / 150"
      ]);
      assert.equal(view.stats.length, 3);
      assert.ok(view.stats.every(stat => stat.y >= view.bar.y && stat.bottom <= view.bar.bottom));
      assert.equal(Boolean(view.timerVisible), false);
      assert.equal(await evaluate(page,
        "'waveRemainingSeconds' in window.__probe.snapshot"), false);
      assert.equal(view.lifeVisible, false);
      if (role === "spectator") assert.equal(view.spectatorActions, 0);
      await capture(page, `${width}x${height}-${role}`, cdp);
      await evaluate(page, "document.querySelector('.game-controls summary').click()");
      assert.equal(await evaluate(page, `(() => {
        const filter = document.querySelector('[name="radar-enemy"]');
        const rect = filter.getBoundingClientRect();
        return rect.width > 0 && rect.bottom <= innerHeight;
      })()`), true, "radar filters are reachable in the expanded overlay");
      assertFits(await layout(page, evaluate));
      await evaluate(page, "document.querySelector('.game-controls summary').click()");
      console.log(JSON.stringify({ check: "compact-active-layout", role, window: { width, height }, ...view }));
    }
  }
}

export async function captureCompactIntermission({ page, role, cdp, evaluate }) {
  await cdp("Page.bringToFront", {}, page.session);
  const view = await layout(page, evaluate);
  assertFits(view);
  assert.equal(Boolean(view.timerVisible), false);
  assert.equal(view.summaryVisible, true);
  assert.equal(view.summaryRows, 1);
  assert.ok(view.stats[0].bottom < view.stats.at(-1).y, "Back to lobby stays above standings");
  await capture(page, `intermission-${role}`, cdp);
  console.log(JSON.stringify({ check: "compact-intermission-layout", role, ...view }));
}
