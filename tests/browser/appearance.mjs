import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export async function verifyAppearance({
  newWindow, signIn, evaluate, click, clickSessionButton, waitFor, cdp, delay, state,
  browser, origin
}) {
  const artifacts = process.env.BROWSER_TEST_ARTIFACT_DIR;
  assert.ok(artifacts, "Set BROWSER_TEST_ARTIFACT_DIR to retain visual evidence.");
  mkdirSync(artifacts, { recursive: true });
  const report = { browser, origin, views: [], checks: [] };
  const player = await newWindow();
  const spectator = await newWindow();
  const suffix = Date.now().toString(36);
  const creator = `Appear_${suffix}`;
  const observer = `Look_${suffix}`;
  const setSystem = (page, appearance) => cdp("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-color-scheme", value: appearance }]
  }, page.session);
  const key = async (page, key) => {
    await cdp("Input.dispatchKeyEvent", { type: "keyDown", key, code: key }, page.session);
    await cdp("Input.dispatchKeyEvent", { type: "keyUp", key, code: key }, page.session);
  };
  const screenshot = async (page, name, fullPage = false) => {
    const clip = fullPage ? await evaluate(page, `({
      x: 0, y: 0, width: document.documentElement.clientWidth,
      height: document.documentElement.scrollHeight, scale: 1
    })`) : undefined;
    const image = await cdp("Page.captureScreenshot", {
      format: "png", ...(clip ? { captureBeyondViewport: true, clip } : {})
    }, page.session);
    const file = join(artifacts, `${name}.png`);
    writeFileSync(file, Buffer.from(image.data, "base64"));
    return file;
  };
  const choose = async (page, appearance) => {
    await cdp("Page.bringToFront", {}, page.session);
    await key(page, "Tab");
    await evaluate(page, "document.querySelector('#frontend-appearance').focus()");
    await key(page, appearance === "light" ? "End" : "Home");
    await key(page, appearance === "light" ? "Home" : "End");
    await waitFor(page, `document.documentElement.dataset.appearance === '${appearance}' &&
      localStorage.getItem('frontend-appearance') === '${appearance}'`);
    assert.equal(await evaluate(page, "document.querySelector('#frontend-appearance').matches(':focus-visible')"), true);
  };
  const capture = async (page, view, appearance) => {
    await choose(page, appearance);
    await delay(120);
    const metrics = await evaluate(page, `(() => {
      const color = value => {
        const parts = value.match(/[\\d.]+/g).map(Number);
        return parts.slice(0, 3);
      };
      const luminance = rgb => rgb.map(v => v / 255).map(v =>
        v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
        .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
      const contrast = (a, b) => {
        const x = luminance(color(a)), y = luminance(color(b));
        return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
      };
      const background = node => {
        for (let current = node; current; current = current.parentElement) {
          const bg = getComputedStyle(current).backgroundColor;
          if (bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg;
        }
        return getComputedStyle(document.body).backgroundColor;
      };
      const visible = node => node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden';
      const text = [...document.querySelectorAll('h1,h2,h3,p,label,legend,th,td,caption,summary,button,input:not([type=radio]):not([type=checkbox]),select')]
        .filter(node => visible(node) && !node.disabled)
        .map(node => ({ element: node.tagName, text: node.textContent?.trim().slice(0, 60),
          ratio: contrast(getComputedStyle(node).color, background(node)) }));
      const boundaries = [...document.querySelectorAll('input:not([type=radio]):not([type=checkbox]),select,button')]
        .filter(node => visible(node) && !node.disabled &&
          getComputedStyle(node).borderTopColor !== 'rgba(0, 0, 0, 0)')
        .map(node => ({ element: node.tagName, ratio:
          contrast(getComputedStyle(node).borderTopColor, background(node.parentElement)) }));
      const select = document.querySelector('#frontend-appearance');
      const focus = getComputedStyle(select);
      const rect = select.getBoundingClientRect();
      return { appearance: document.documentElement.dataset.appearance,
        body: getComputedStyle(document.body).backgroundColor,
        text, boundaries, focus: { width: focus.outlineWidth, style: focus.outlineStyle,
          ratio: contrast(focus.outlineColor, background(select.parentElement)) },
        switchVisible: rect.top >= 0 && rect.bottom <= innerHeight && rect.right <= innerWidth,
        scroll: { height: document.documentElement.scrollHeight, viewport: innerHeight },
        canvas: document.querySelector('canvas') && {
          width: document.querySelector('canvas').getBoundingClientRect().width,
          height: document.querySelector('canvas').getBoundingClientRect().height },
        hud: document.querySelector('.game-hud')?.getBoundingClientRect().height };
    })()`);
    for (const item of metrics.text) assert.ok(item.ratio >= 4.5, `${view}/${appearance}: text ${JSON.stringify(item)}`);
    for (const item of metrics.boundaries) assert.ok(item.ratio >= 3, `${view}/${appearance}: boundary ${JSON.stringify(item)}`);
    assert.ok(parseFloat(metrics.focus.width) >= 2, "focus outline remains at least 2 CSS pixels after device-pixel rounding");
    assert.equal(metrics.focus.style, "solid");
    assert.ok(metrics.focus.ratio >= 3);
    assert.equal(metrics.switchVisible, true);
    if (metrics.canvas) assert.equal(metrics.scroll.height, metrics.scroll.viewport, "match has no page scroll");
    const file = await screenshot(page, `${view}-${appearance}`, view === "lobby");
    report.views.push({ view, ...metrics, screenshot: file });
  };
  const checkFocus = async (page, selectors) => {
    await key(page, "Tab");
    for (const selector of selectors) {
      const result = await evaluate(page, `(() => {
        const node = document.querySelector(${JSON.stringify(selector)});
        node.focus();
        const style = getComputedStyle(node);
        return { visible: node.matches(':focus-visible'), width: parseFloat(style.outlineWidth),
          style: style.outlineStyle, color: style.outlineColor };
      })()`);
      assert.equal(result.visible, true, `${selector} has keyboard-visible focus`);
      assert.ok(result.width >= 2 && result.style === "solid", `${selector} has a visible outline`);
      if (selector === "canvas") assert.equal(result.color, "rgb(154, 194, 255)");
    }
  };
  await setSystem(player, "dark");
  await evaluate(player, "localStorage.removeItem('frontend-appearance')");
  await cdp("Page.reload", {}, player.session);
  await waitFor(player, "document.querySelector('.auth-form') && document.documentElement.dataset.appearance === 'dark'");
  assert.equal(await evaluate(player, "localStorage.getItem('frontend-appearance')"), null);
  await setSystem(player, "light");
  await waitFor(player, "document.documentElement.dataset.appearance === 'light'");
  report.checks.push("First visit follows system dark/light without storing a choice.");
  for (const appearance of ["light", "dark"]) {
    await capture(player, "login", appearance);
    await checkFocus(player, ["#username", "#password", 'button[type="submit"]', ".link-button"]);
  }
  report.checks.push("Login inputs, primary and secondary buttons show keyboard-visible focus in both appearances.");
  await setSystem(player, "light");
  await cdp("Page.reload", {}, player.session);
  await waitFor(player, "document.querySelector('.auth-form') && document.documentElement.dataset.appearance === 'dark'");
  report.checks.push("Explicit Dark survives reload against a Light system preference.");
  await signIn(player, creator, randomUUID());
  await signIn(spectator, observer, randomUUID());
  for (const appearance of ["light", "dark"]) await capture(player, "lobby", appearance);
  await evaluate(player, `document.querySelector('[name=setting-initialNpcsPerPlayer]').value = '1';
    document.querySelector('[name=setting-baseNpcHealth]').value = '1';
    document.querySelector('[name=setting-npcMovementSpeed]').value = '0';
    document.querySelector('[name=setting-npcDetectionRange]').value = '0';
    document.querySelector('[name=setting-maxLevels]').value = '2'`);
  await click(player, "Create session");
  await clickSessionButton(player, creator, "Start Session");
  await waitFor(player, "window.__probe.snapshot?.phase === 'active' && document.querySelector('canvas')");
  await click(spectator, "Refresh sessions");
  await clickSessionButton(spectator, creator, "Spectate");
  await waitFor(spectator, "document.querySelector('[aria-label=\"Followable players\"]')");
  for (const appearance of ["light", "dark"]) await capture(spectator, "spectator-roster", appearance);
  await click(spectator, `Follow ${creator}`);
  await waitFor(spectator, "window.__probe.snapshot?.viewerRole === 'spectator' && document.querySelector('canvas')");

  for (const [page, role] of [[player, "player"], [spectator, "spectator"]]) {
    const arena = [];
    for (const appearance of ["light", "dark"]) {
      await evaluate(page, "document.querySelector('.game-controls details').open = true");
      await capture(page, role, appearance);
      const drawn = await state(page);
      arena.push({
        colors: drawn.colors, fillStyles: [...drawn.fillStyles].sort(),
        terrain: drawn.terrain, boundaries: drawn.boundaries,
        packs: drawn.snapshot.entities.filter(e => e.state.kind === "pickup").map(e => ({ id: e.id, position: e.position })),
        healthBlue: drawn.strokes.some(stroke => stroke.color === "#4db8ff")
      });
      assert.ok(drawn.fillStyles.includes("#101824"), "arena background stays theme-owned");
      assert.ok(drawn.fillStyles.includes("#ed6b61"), "enemy color is preserved");
      assert.equal(drawn.actions.filter(action => action.payload?.action?.fire).length, 0, "appearance emits no fire intent");
      await checkFocus(page, ["canvas", ".game-hud > button", ".game-controls summary", '[name="radar-pickup"]']);
    }
    assert.deepEqual(arena[0], arena[1], `${role}: arena colors/terrain/packs remain unchanged across appearance`);
    report.checks.push(`${role}: identical arena palette/terrain/pickups; controls remain available.`);
  }
  const { verifyHealthRadarMotion } = await import("./health-radar.mjs");
  for (const page of [player, spectator]) {
    for (const appearance of ["light", "dark"]) {
      await choose(page, appearance);
      report.checks.push(await verifyHealthRadarMotion(page, { evaluate, delay }));
    }
    await cdp("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "reduce" }]
    }, page.session);
    report.checks.push(await verifyHealthRadarMotion(page, { evaluate, delay }, true));
    await cdp("Emulation.setEmulatedMedia", { features: [] }, page.session);
  }
  for (const appearance of ["light", "dark"]) {
    await choose(player, appearance);
    const before = await evaluate(player, `window.__probe.snapshot.players.find(p =>
      p.accountId === window.__probe.snapshot.viewerAccountId).position`);
    await evaluate(player, "document.querySelector('canvas').focus()");
    await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowDown", code: "ArrowDown" }, player.session);
    await delay(120);
    await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowDown", code: "ArrowDown" }, player.session);
    await delay(120);
    const after = await evaluate(player, `window.__probe.snapshot.players.find(p =>
      p.accountId === window.__probe.snapshot.viewerAccountId).position`);
    assert.ok(Math.hypot(after.x - before.x, after.y - before.y) > 0, "keyboard gameplay still moves the player");
  }
  report.checks.push("Actual ArrowDown movement works in both appearances; appearance changes never send fire intent.");
  // The existing staged-wave server places one real NPC in the normal firing lane.
  await cdp("Page.bringToFront", {}, player.session);
  const point = await evaluate(player, `(() => {
    const rect = document.querySelector('canvas').getBoundingClientRect();
    document.querySelector('canvas').focus();
    const own = window.__probe.snapshot.players.find(p => p.accountId === window.__probe.snapshot.viewerAccountId);
    const npc = window.__probe.snapshot.entities.find(e => e.state.kind === 'npc');
    return {x: rect.left + rect.width / 2 + npc.position.x - own.position.x,
      y: rect.top + rect.height / 2 + npc.position.y - own.position.y};
  })()`);
  await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", ...point }, player.session);
  await cdp("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...point }, player.session);
  await delay(150);
  await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...point }, player.session);
  await waitFor(player, "window.__probe.snapshot?.phase === 'intermission'");
  for (const [page, role] of [[player, "player"], [spectator, "spectator"]]) {
    await waitFor(page, "document.querySelector('[aria-label=\"Running standings\"]')?.getClientRects().length > 0");
    for (const appearance of ["light", "dark"]) await capture(page, `${role}-standings`, appearance);
  }
  // End through the host API, then inspect the ordinary saved-results renderer.
  await evaluate(player, `(async () => {
    const sessions = (await (await fetch('/api/v1/sessions')).json()).sessions;
    const id = sessions.find(s => s.creator === '${creator}').id;
    const response = await fetch('/api/v1/sessions/' + id + '/end',
      {method:'POST', headers:{'content-type':'application/json'}, body:'{}'});
    if (!response.ok) throw new Error('Unable to end appearance fixture');
  })()`);
  for (const [page, role] of [[player, "player"], [spectator, "spectator"]]) {
    await waitFor(page, "document.querySelector('[aria-label=\"Final standings\"]')");
    for (const appearance of ["light", "dark"]) await capture(page, `${role}-results`, appearance);
    await click(page, "Back to lobby");
    await waitFor(page, "document.querySelector('.app-header #frontend-appearance')");
  }
  report.checks.push("Running and saved final standings verified for both roles; selector restored on returning to lobby.");
  for (const appearance of ["light", "dark"]) {
    await choose(player, appearance);
    await evaluate(player, `(() => {
      const dialog = document.createElement('dialog');
      dialog.id = 'appearance-dialog-fixture';
      dialog.setAttribute('aria-labelledby', 'appearance-dialog-title');
      dialog.innerHTML = '<h2 id="appearance-dialog-title">Dialog surface</h2><p>Frontend dialog tokens, not a replacement for browser confirmation.</p><button type="button">Close</button>';
      document.body.append(dialog);
      dialog.showModal();
    })()`);
    await checkFocus(player, ['#appearance-dialog-fixture button']);
    const colors = await evaluate(player, `(() => {
      const dialog = getComputedStyle(document.querySelector('dialog'));
      const form = getComputedStyle(document.querySelector('#app form'));
      return {background: dialog.backgroundColor === form.backgroundColor,
        text: dialog.color === form.color, border: dialog.borderTopColor === form.borderTopColor};
    })()`);
    assert.deepEqual(colors, { background: true, text: true, border: true });
    await screenshot(player, `dialog-fixture-${appearance}`);
    await evaluate(player, "document.querySelector('#appearance-dialog-fixture').close(); document.querySelector('#appearance-dialog-fixture').remove()");
  }
  report.checks.push("HTML dialog fixture uses the same surface/text/border tokens; native window.confirm remains browser-managed.");
  writeFileSync(join(artifacts, "appearance.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ browser, views: report.views.map(v => ({
    view: v.view, appearance: v.appearance, minText: Math.min(...v.text.map(t => t.ratio)),
    minBoundary: Math.min(...v.boundaries.map(t => t.ratio)), focus: v.focus.ratio,
    canvas: v.canvas, hud: v.hud
  })), checks: report.checks }, null, 2));
}
