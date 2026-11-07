import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const origin = process.env.BROWSER_TEST_ORIGIN ?? "http://127.0.0.1:5174";
const debugUrl = process.env.BROWSER_DEBUG_URL ?? "http://127.0.0.1:9223";
const version = await (await fetch(`${debugUrl}/json/version`)).json();
const socket = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
let nextId = 0;
const pending = new Map();
socket.addEventListener("close", () => {
  for (const request of pending.values()) {
    clearTimeout(request.timeout);
    request.reject(new Error("The browser debug connection closed."));
  }
  pending.clear();
});
socket.addEventListener("message", ({ data }) => {
  const message = JSON.parse(data);
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  clearTimeout(request.timeout);
  if (message.error) request.reject(new Error(message.error.message));
  else request.resolve(message.result);
});
function cdp(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    if (socket.readyState !== WebSocket.OPEN) {
      reject(new Error(`Browser disconnected before ${method}.`));
      return;
    }
    const id = ++nextId;
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP timeout: ${method}`));
    }, 10000);
    pending.set(id, { resolve, reject, timeout });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function evaluate(page, expression) {
  const result = await cdp("Runtime.evaluate", {
    expression, returnByValue: true, awaitPromise: true
  }, page.session);
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? "Browser evaluation failed.");
  }
  return result.result.value;
}
async function waitFor(page, expression) {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (await evaluate(page, expression)) return;
    await delay(100);
  }
  const status = await evaluate(page, "document.querySelector('#status')?.textContent");
  throw new Error(`Browser condition timed out: ${expression}; status: ${status}`);
}
async function click(page, label) {
  await waitFor(page, `[...document.querySelectorAll('button')].some(b => b.textContent === ${JSON.stringify(label)} && !b.disabled)`);
  await evaluate(page, `[...document.querySelectorAll('button')].find(b => b.textContent === ${JSON.stringify(label)}).click()`);
  if (label === "Refresh sessions") {
    await waitFor(page, "[...document.querySelectorAll('button')].some(b => b.textContent === 'Refresh sessions' && !b.disabled)");
  }
}
async function clickSessionButton(page, creator, label) {
  const selector = `[...document.querySelectorAll('tbody tr')].find(row =>
    row.children[1]?.textContent === ${JSON.stringify(creator)})`;
  await waitFor(page, `${selector} !== undefined`);
  await evaluate(page, `[...(${selector}).querySelectorAll('button')].find(button =>
    button.textContent === ${JSON.stringify(label)} && !button.disabled).click()`);
}
const probe = `(() => {
  window.__probe = { snapshot: null, actions: [] };
  const NativeSocket = window.WebSocket;
  window.WebSocket = class extends NativeSocket {
    constructor(...args) {
      super(...args);
      this.addEventListener('message', event => {
        const message = JSON.parse(event.data);
        if (message.type === 'server.snapshot') window.__probe.snapshot = message.payload;
      });
    }
    send(data) {
      const message = JSON.parse(data);
      if (message.type === 'client.input') {
        window.__probe.actions.push(message);
        if (window.__probe.actions.length > 40) window.__probe.actions.shift();
      }
      return super.send(data);
    }
  };
  const nativeRect = CanvasRenderingContext2D.prototype.fillRect;
  CanvasRenderingContext2D.prototype.fillRect = function(x, y, w, h) {
    if (this.fillStyle === '#101824') {
      this.canvas.__draw = { arcs: [], squares: [] };
    }
    if (this.fillStyle === '#ed6b61') this.canvas.__draw?.squares.push({ x, y, w, h });
    return nativeRect.call(this, x, y, w, h);
  };
  const nativeArc = CanvasRenderingContext2D.prototype.arc;
  CanvasRenderingContext2D.prototype.arc = function(x, y, r, ...args) {
    this.canvas.__draw?.arcs.push({ x, y, r, color: this.fillStyle });
    return nativeArc.call(this, x, y, r, ...args);
  };
})();`;

const contexts = [];
async function newWindow() {
  const { browserContextId } = await cdp("Target.createBrowserContext");
  contexts.push(browserContextId);
  const { targetId } = await cdp("Target.createTarget", {
    url: "about:blank", browserContextId, newWindow: true, background: false
  });
  const { sessionId } = await cdp("Target.attachToTarget", { targetId, flatten: true });
  const page = { session: sessionId, target: targetId };
  await cdp("Page.enable", {}, sessionId);
  await cdp("Runtime.enable", {}, sessionId);
  await cdp("Page.addScriptToEvaluateOnNewDocument", { source: probe }, sessionId);
  await cdp("Page.navigate", { url: origin }, sessionId);
  await waitFor(page, "document.querySelector('.auth-form') !== null");
  return page;
}
async function signIn(page, username, password) {
  await click(page, "Need an account? Register");
  await evaluate(page, `document.querySelector('[name=username]').value = ${JSON.stringify(username)};
    document.querySelector('[name=password]').value = ${JSON.stringify(password)}`);
  await click(page, "Register");
  await waitFor(page, "document.querySelector('#status').textContent.includes('Account created')");
  await evaluate(page, `document.querySelector('[name=password]').value = ${JSON.stringify(password)}`);
  await click(page, "Sign in");
  await waitFor(page, "document.querySelector('[aria-label=\"Active sessions\"]') !== null");
}
async function state(page) {
  return evaluate(page, `(() => {
    const canvas = document.querySelector('canvas');
    return {
      snapshot: window.__probe.snapshot, actions: window.__probe.actions,
      arcs: canvas.__draw?.arcs ?? [], squares: canvas.__draw?.squares ?? [],
      width: canvas.getBoundingClientRect().width, height: canvas.getBoundingClientRect().height,
      pixelWidth: canvas.width, pixelHeight: canvas.height,
      points: document.querySelector('.default-points').textContent,
      health: document.querySelector('.default-health').textContent,
      status: document.querySelector('#status').textContent,
      pointsFont: parseFloat(getComputedStyle(document.querySelector('.default-points')).fontSize),
      healthFont: parseFloat(getComputedStyle(document.querySelector('.default-health')).fontSize)
    };
  })()`);
}
const own = (view) => view.snapshot.players.find(p => p.accountId === view.snapshot.viewerAccountId);
function centered(view) {
  const dot = view.arcs.find(item => item.color === "#58d6ff");
  assert.ok(dot, "own player dot is rendered");
  assert.ok(Math.abs(dot.x - view.width / 2) < 0.1,
    `own dot centered horizontally (${dot.x} versus ${view.width / 2})`);
  assert.ok(Math.abs(dot.y - view.height / 2) < 0.1,
    `own dot centered vertically (${dot.y} versus ${view.height / 2})`);
  assert.ok(view.pointsFont > view.healthFont, "points are visually dominant");
  assert.equal(view.points, `Points: ${own(view).points}`);
  assert.equal(view.health, `Health: ${own(view).health}`);
}
async function move(page, code, ms) {
  await cdp("Page.bringToFront", {}, page.session);
  await evaluate(page, "document.querySelector('canvas').focus()");
  const key = { KeyW: "w", KeyA: "a", KeyS: "s", KeyD: "d" }[code];
  await cdp("Input.dispatchKeyEvent", { type: "keyDown", key, code }, page.session);
  await delay(ms);
  await cdp("Input.dispatchKeyEvent", { type: "keyUp", key, code }, page.session);
  await delay(200);
}

try {
  const alice = await newWindow();
  const bob = await newWindow();
  const aliceWindow = await cdp("Browser.getWindowForTarget", { targetId: alice.target });
  const bobWindow = await cdp("Browser.getWindowForTarget", { targetId: bob.target });
  assert.notEqual(aliceWindow.windowId, bobWindow.windowId, "distinct actual browser windows");
  for (const window of [aliceWindow, bobWindow]) {
    await cdp("Browser.setWindowBounds", { windowId: window.windowId,
      bounds: { width: 1000, height: 900, windowState: "normal" } });
  }
  const suffix = Date.now().toString(36);
  const password = randomUUID();
  const creator = `ViewA_${suffix}`;
  await signIn(alice, creator, password);
  await signIn(bob, `ViewB_${suffix}`, password);
  await evaluate(alice, `document.querySelector('[name=setting-initialNpcsPerPlayer]').value = '1';
    document.querySelector('[name=setting-baseNpcHealth]').value = '100000';
    document.querySelector('[name=setting-maxLevels]').value = '1'`);
  await click(alice, "Create session");
  await waitFor(alice, "document.querySelector('tbody details') !== null");
  await click(bob, "Refresh sessions");
  await clickSessionButton(bob, creator, "Join");
  await waitFor(bob, "document.querySelector('#status').textContent.startsWith('Joined')");
  await click(alice, "Refresh sessions");
  await evaluate(alice, `[...document.querySelectorAll('tbody tr')].find(row =>
    row.children[1]?.textContent === ${JSON.stringify(creator)}).querySelector('details').open = true`);
  await click(alice, "Start session");
  await waitFor(alice, "window.__probe.snapshot !== null");
  await click(bob, "Refresh sessions");
  await clickSessionButton(bob, creator, "Play");
  await waitFor(bob, "window.__probe.snapshot !== null");
  await delay(200);
  const startA = await state(alice);
  const startB = await state(bob);
  assert.notEqual(startA.snapshot.viewerAccountId, startB.snapshot.viewerAccountId, "separate authenticated identities");
  centered(startA);
  centered(startB);
  assert.ok(!startA.arcs.some(item => item.color === "#f7db76"), "off-viewport Bob is not rendered");
  assert.ok(!startB.arcs.some(item => item.color === "#f7db76"), "off-viewport Alice is not rendered");
  await move(bob, "KeyW", 1400);
  const movedB = await state(bob);
  const stationaryA = await state(alice);
  assert.ok(own(movedB).position.y < own(startB).position.y - 100, "Bob moves using his keyboard intent");
  assert.deepEqual(own(stationaryA).position, own(startA).position, "Bob cannot move Alice");
  await move(alice, "KeyD", 450);
  const movedA = await state(alice);
  const stoppedB = await state(bob);
  assert.ok(own(movedA).position.x > own(startA).position.x + 30, "Alice moves independently");
  assert.deepEqual(own(stoppedB).position, own(movedB).position, "Alice cannot move Bob");
  centered(movedA);
  centered(stoppedB);
  assert.ok(movedA.arcs.some(item => item.color === "#f7db76"), "Alice renders nearby Bob");
  assert.ok(stoppedB.arcs.some(item => item.color === "#f7db76"), "Bob renders nearby Alice");
  const peerA = movedA.snapshot.players.find(p => p.accountId === stoppedB.snapshot.viewerAccountId);
  assert.deepEqual(peerA.position, own(stoppedB).position, "shared authoritative nearby position");
  const inputs = [...movedA.actions, ...stoppedB.actions];
  assert.ok(inputs.length > 0);
  for (const input of inputs) {
    assert.equal(input.v, 1);
    assert.equal(input.type, "client.input");
    assert.equal(input.payload.action.type, "combat");
    assert.deepEqual(Object.keys(input.payload.action).sort(),
      ["aimX", "aimY", "fire", "moveX", "moveY", "type"]);
  }
  await cdp("Browser.setWindowBounds", { windowId: aliceWindow.windowId,
    bounds: { width: 800, height: 740 } });
  await delay(300);
  const resized = await state(alice);
  assert.notEqual(resized.width, movedA.width);
  centered(resized);
  assert.equal(resized.pixelWidth, Math.round(resized.width * await evaluate(alice, "devicePixelRatio")));
  assert.equal(resized.status, "");
  await cdp("Page.bringToFront", {}, alice.session);
  await evaluate(alice, "document.querySelector('canvas').focus()");
  const canvasBounds = await evaluate(alice, `(() => {
    const bounds = document.querySelector('canvas').getBoundingClientRect();
    return { x: bounds.left + bounds.width / 2 + 80, y: bounds.top + bounds.height / 2 };
  })()`);
  await cdp("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1,
    ...canvasBounds }, alice.session);
  await delay(300);
  assert.ok((await state(alice)).actions.some(input => input.payload.action.fire), "mouse sends firing intent");
  await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1,
    ...canvasBounds }, alice.session);
  await delay(150);
  assert.equal((await state(alice)).actions.at(-1).payload.action.fire, false, "release stops firing");
  const fixtureChecks = await evaluate(alice, `(async () => {
    const { mountSkinHost } = await import('/src/skin-host.ts');
    const { defaultSkinFactory } = await import('/@id/@multiplayer-game/default-theme');
    const fixture = structuredClone(window.__probe.snapshot);
    const root = document.createElement('div');
    document.body.append(root);
    const actions = [];
    const errors = [];
    const target = fixture.players.find(p => p.accountId === fixture.viewerAccountId);
    const mounted = mountSkinHost(root, defaultSkinFactory, {
      target: { accountId: target.accountId, username: 'Fixture' },
      dispatchInput: input => actions.push(input),
      navigate: () => {},
      onError: error => errors.push(error.message)
    });
    fixture.entities = [
      { id: 'player:fixture', radius: 14, position: target.position,
        state: { kind: 'player', accountId: target.accountId, deaths: target.deaths } },
      { id: 'npc:fixture', radius: 8,
        position: { x: target.position.x + 60, y: target.position.y },
        state: { kind: 'npc', health: 100 } }
    ];
    fixture.tick += 2;
    mounted.handleSnapshot(fixture, 4);
    const canvas = root.querySelector('canvas');
    canvas.focus();
    canvas.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD', bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 120));
    const square = canvas.__draw.squares[0];
    const dot = canvas.__draw.arcs.find(item => item.color === '#58d6ff');
    const moved = actions.some(action => action.moveX === 1);
    const cameraOwn = mounted.host.cameraAnchor.x === target.position.x;
    let compatibilityRejected = false;
    try { mounted.handleSnapshot(fixture, 3); } catch { compatibilityRejected = true; }
    fixture.tick += 2;
    fixture.players.find(p => p.accountId === target.accountId).alive = false;
    fixture.players.find(p => p.accountId === target.accountId).health = 0;
    fixture.players.find(p => p.accountId === target.accountId).respawnAtTick = fixture.tick + 150;
    fixture.entities = fixture.entities.filter(item => item.state.kind !== 'player');
    mounted.handleSnapshot(fixture, 4);
    await new Promise(resolve => setTimeout(resolve, 120));
    const deadState = root.querySelector('.default-life').textContent;
    const neutral = actions.at(-1).moveX === 0 && actions.at(-1).fire === false;
    mounted.dispose();
    const actionCount = actions.length;
    canvas.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD', bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 120));
    const clean = root.querySelector('canvas') === null && mounted.host.cameraAnchor === undefined &&
      actions.length === actionCount;
    root.remove();
    return { square, dot, moved, cameraOwn, compatibilityRejected, deadState, neutral, clean, errors };
  })()`);
  assert.equal(fixtureChecks.square.w, fixtureChecks.square.h, "NPCs render as squares");
  assert.equal(fixtureChecks.dot.r, 14, "players render as dots");
  assert.ok(fixtureChecks.moved && fixtureChecks.cameraOwn);
  assert.ok(fixtureChecks.compatibilityRejected && fixtureChecks.neutral && fixtureChecks.clean);
  assert.equal(fixtureChecks.deadState, "Respawning in 5s");
  assert.deepEqual(fixtureChecks.errors, []);
  const boundedControls = await evaluate(alice, `(async () => {
    const { connectRealtime } = await import('/src/connection.ts');
    const events = new EventTarget();
    const sent = [];
    let closed;
    const socket = {
      readyState: WebSocket.OPEN, bufferedAmount: 0,
      addEventListener: events.addEventListener.bind(events),
      send: data => sent.push(JSON.parse(data)),
      close: (code, reason) => { closed = { code, reason }; }
    };
    const client = connectRealtime({
      sessionId: ${JSON.stringify(randomUUID())},
      createWebSocket: () => socket, onMessage: () => {}
    });
    const action = { type: 'combat', moveX: 1, moveY: 0, aimX: 50, aimY: 50, fire: false };
    client.sendAction(action);
    client.sendAction(action);
    socket.bufferedAmount = 16 * 1024;
    const stalled = client.sendAction(action);
    return { sequences: sent.map(item => item.payload.sequence), count: sent.length, stalled, closed };
  })()`);
  assert.deepEqual(boundedControls.sequences, [0, 1]);
  assert.equal(boundedControls.count, 2, "stalled controls are not queued");
  assert.equal(boundedControls.stalled, false);
  assert.equal(boundedControls.closed.code, 1013);
  console.log(JSON.stringify({
    browser: version.Browser, windows: 2,
    independentMovement: true, nearbyVisibility: true, centeredCameras: true,
    actionEnvelope: true, mouseFireAndRelease: true, pointsAndHealth: true, viewportResize: true,
    fixtureShapesAndDeathHud: true, skinDisposalAndCompatibility: true, boundedOutgoingControls: true
  }, null, 2));
} finally {
  for (const browserContextId of contexts) {
    try {
      await cdp("Target.disposeBrowserContext", { browserContextId });
    } catch (error) {
      console.error(`Browser context cleanup failed: ${error.message}`);
    }
  }
  socket.close();
}
