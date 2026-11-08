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
  const selector = `[...document.querySelectorAll('tbody tr')].filter(row =>
    row.children[1]?.textContent === ${JSON.stringify(creator)} &&
    [...row.querySelectorAll('button')].some(button =>
      button.textContent === ${JSON.stringify(label)} && !button.disabled)).at(-1)`;
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
        if (message.type === 'server.spectate.target') window.__probe.target = message.payload;
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

async function shootUntil(page, level, remaining) {
  await cdp("Page.bringToFront", {}, page.session);
  await evaluate(page, "document.querySelector('canvas').focus()");
  let pressed = false;
  let target;
  try {
    for (let attempt = 0; attempt < 120; attempt++) {
      const aim = await evaluate(page, `(() => {
        const snapshot = window.__probe.snapshot;
        const npcs = snapshot.entities.filter(item => item.state.kind === 'npc');
        if (snapshot.level === ${level} && (npcs.length <= ${remaining} || snapshot.phase !== 'active')) {
          return { complete: true };
        }
        const player = snapshot.players.find(item => item.accountId === snapshot.viewerAccountId);
        const npc = npcs.sort((a,b) =>
          Math.hypot(a.position.x-player.position.x,a.position.y-player.position.y) -
          Math.hypot(b.position.x-player.position.x,b.position.y-player.position.y))[0];
        const bounds = document.querySelector('canvas').getBoundingClientRect();
        const dx = npc.position.x - player.position.x;
        const dy = npc.position.y - player.position.y;
        const scale = Math.min(1, (bounds.width/2-20)/Math.max(1,Math.abs(dx)),
          (bounds.height/2-20)/Math.max(1,Math.abs(dy)));
        return { x: bounds.left+bounds.width/2+dx*scale, y: bounds.top+bounds.height/2+dy*scale };
      })()`);
      if (aim.complete) return;
      target = aim;
      await cdp("Input.dispatchMouseEvent", {
        type: pressed ? "mouseMoved" : "mousePressed", button: "left",
        buttons: 1, clickCount: 1, ...target
      }, page.session);
      pressed = true;
      await delay(100);
    }
    throw new Error(`Timed out firing in level ${level} toward ${remaining} remaining NPCs.`);
  } finally {
    if (pressed) await cdp("Input.dispatchMouseEvent", {
      type: "mouseReleased", button: "left", buttons: 0, clickCount: 1, ...target
    }, page.session);
  }
}

try {
  const alice = await newWindow();
  const bob = await newWindow();
  const observer = await newWindow();
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
  await signIn(observer, `Watch_${suffix}`, password);
  if (process.argv.includes("--wave-timeout")) {
    const { verifyWaveTimeout } = await import("./wave-timeout.mjs");
    await verifyWaveTimeout({
      alice, bob, creator, cdp, evaluate, waitFor, click, clickSessionButton, delay, browser: version.Browser
    });
  } else if (process.argv.includes("--reconnect")) {
    const { verifyReconnect } = await import("./reconnect.mjs");
    await verifyReconnect({ alice, bob, observer, creator, bobName: `ViewB_${suffix}`,
      cdp, evaluate, waitFor, click, clickSessionButton, state, own, move, shootUntil, delay,
      browser: version.Browser });
  } else {
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
  await clickSessionButton(bob, creator, "Rejoin");
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
  await click(observer, "Refresh sessions");
  await clickSessionButton(observer, creator, "Spectate");
  await waitFor(observer, "document.querySelector('[aria-label=\"Followable players\"]') !== null");
  await click(observer, `Follow ${creator}`);
  await waitFor(observer, "window.__probe.snapshot?.viewerRole === 'spectator'");
  const spectatorA = await state(observer);
  assert.equal(spectatorA.snapshot.viewerAccountId, (await state(alice)).snapshot.viewerAccountId);
  assert.deepEqual(spectatorA.snapshot.spectatorView.cameraAnchor, own(spectatorA).position);
  centered(spectatorA);
  await move(observer, "KeyD", 300);
  assert.equal((await state(observer)).actions.length, 0, "spectator skin sends no gameplay actions");
  const spectatorFixture = await evaluate(observer, `(async () => {
    const { mountSkinHost } = await import('/src/skin-host.ts');
    const { defaultSkinFactory } = await import('/@id/@multiplayer-game/default-theme');
    const snapshot = structuredClone(window.__probe.snapshot);
    const root = document.createElement('div');
    document.body.append(root);
    let inputs = 0;
    const mounted = mountSkinHost(root, defaultSkinFactory, {
      target: {accountId:snapshot.viewerAccountId, username:${JSON.stringify(creator)}},
      dispatchInput: () => inputs++, navigate: () => {}, onError: error => {throw error;}
    });
    const target = snapshot.players.find(player => player.accountId === snapshot.viewerAccountId);
    target.alive = false; target.health = 0; target.respawnAtTick = snapshot.tick + 150;
    snapshot.entities = snapshot.entities.filter(entity => entity.state.accountId !== target.accountId);
    snapshot.spectatorView.death = {alive:false,remainingSeconds:5,respawnAtTick:target.respawnAtTick,respawnBlocked:false};
    snapshot.spectatorView.hud = {points:target.points,health:0};
    mounted.handleSnapshot(snapshot,4);
    await new Promise(resolve => setTimeout(resolve,100));
    const countdown = root.querySelector('.default-life').textContent;
    const health = root.querySelector('.default-health').textContent;
    snapshot.tick++;
    snapshot.spectatorView.death = {alive:true,remainingSeconds:0};
    snapshot.spectatorView.hud.health = 100;
    snapshot.spectatorView.cameraAnchor = {x:800,y:600};
    target.alive = true; target.health = 100; target.position = {x:800,y:600};
    mounted.handleSnapshot(snapshot,4);
    await new Promise(resolve => setTimeout(resolve,100));
    const returned = root.querySelector('.default-health').textContent;
    const camera = mounted.host.cameraAnchor;
    mounted.dispose(); root.remove();
    return {countdown,health,returned,camera,inputs};
  })()`);
  assert.deepEqual(spectatorFixture, {countdown:"Respawning in 5s",health:"Health: 0",
    returned:"Health: 100",camera:{x:800,y:600},inputs:0});
  await click(observer, "Back to Players");
  await waitFor(observer, "document.querySelector('[aria-label=\"Followable players\"]') !== null");
  await click(observer, `Follow ViewB_${suffix}`);
  await waitFor(observer, `window.__probe.snapshot?.viewerAccountId === ${JSON.stringify((await state(bob)).snapshot.viewerAccountId)}`);
  await delay(100);
  centered(await state(observer));
  await click(bob, "Back to lobby");
  await waitFor(observer, "document.querySelector('[aria-label=\"Followable players\"]') !== null");
  assert.ok((await evaluate(observer, "document.querySelector('#status').textContent")).includes("no longer available"));
  await click(observer, `Follow ${creator}`);
  await waitFor(observer, "document.querySelector('canvas') !== null");
  await click(observer, "Back to lobby");
  await waitFor(observer, "document.querySelector('[aria-label=\"Active sessions\"]') !== null");
  const released = await evaluate(observer, `(async () => {
    const {sessions}=await(await fetch('/api/v1/sessions')).json();
    return sessions.find(session => session.creator === ${JSON.stringify(creator)}).spectatorCount;
  })()`);
  assert.equal(released,0);
  await click(bob, "Refresh sessions");
  await clickSessionButton(bob, creator, "Rejoin");
  await waitFor(bob, "document.querySelector('canvas') !== null");
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
  await click(alice, "Back to lobby");
  await click(bob, "Back to lobby");
  await waitFor(alice, "document.querySelector('[aria-label=\"Active sessions\"]') !== null");
  await evaluate(alice, `document.querySelector('[name=setting-initialNpcsPerPlayer]').value = '1';
    document.querySelector('[name=setting-baseNpcHealth]').value = '1';
    document.querySelector('[name=setting-maxLevels]').value = '2';
    document.querySelector('[name=setting-npcPopulationGrowthPercent]').value = '0';
    document.querySelector('[name=setting-npcHealthGrowthPercent]').value = '0';
    window.__probe.snapshot = null`);
  await click(alice, "Create session");
  await waitFor(alice, "document.querySelector('tbody details') !== null");
  const matchId = await evaluate(alice, `(async () => {
    const {sessions} = await (await fetch('/api/v1/sessions')).json();
    return sessions.find(session => session.creator === ${JSON.stringify(creator)} && session.status === 'waiting').id;
  })()`);
  await click(bob, "Refresh sessions");
  await clickSessionButton(bob, creator, "Join");
  await waitFor(bob, "document.querySelector('#status').textContent.startsWith('Joined')");
  await evaluate(alice, "document.querySelector('tbody details').open = true");
  await click(alice, "Start session");
  await waitFor(alice, "window.__probe.snapshot !== null");
  await evaluate(bob, "window.__probe.snapshot = null");
  await click(bob, "Refresh sessions");
  await clickSessionButton(bob, creator, "Play");
  await waitFor(bob, "window.__probe.snapshot !== null");
  await click(observer, "Refresh sessions");
  await clickSessionButton(observer, creator, "Spectate");
  await waitFor(observer, "document.querySelector('[aria-label=\"Followable players\"]') !== null");
  await click(observer, `Follow ${creator}`);
  await waitFor(observer, "document.querySelector('canvas') !== null");
  const capacityBefore = await evaluate(alice, `(async () => {
    const {settings} = await (await fetch('/api/v1/sessions/' + ${JSON.stringify(matchId)})).json();
    for (let i=0;i<3;i++) {
      const response = await fetch('/api/v1/sessions', {method:'POST',
        headers:{'content-type':'application/json'}, body:JSON.stringify({settings,requestId:crypto.randomUUID()})});
      if (!response.ok) throw new Error('Unable to reserve test capacity: '+response.status);
    }
    const sessions = (await (await fetch('/api/v1/sessions')).json()).sessions;
    const overflow = await fetch('/api/v1/sessions',{method:'POST',
      headers:{'content-type':'application/json'},body:JSON.stringify({settings})});
    return {count:sessions.length,overflow:overflow.status,code:(await overflow.json()).error.code};
  })()`);
  assert.deepEqual(capacityBefore, { count: 5, overflow: 409, code: "SESSION_CAPACITY" });
  await shootUntil(alice, 1, 1);
  await shootUntil(bob, 1, 0);
  await waitFor(alice, "window.__probe.snapshot.level === 2 && window.__probe.snapshot.phase === 'active'");
  await shootUntil(alice, 2, 0);
  await waitFor(alice, "document.querySelector('[aria-label=\"Final standings\"]') !== null");
  await waitFor(bob, "document.querySelector('[aria-label=\"Final standings\"]') !== null");
  await waitFor(observer, "document.querySelector('[aria-label=\"Final standings\"]') !== null");
  const resultHash = await evaluate(alice, "location.hash");
  assert.match(resultHash, /^#results\/[0-9a-f-]{36}$/);
  const standings = await evaluate(alice, "document.querySelector('[aria-label=\"Final standings\"]').textContent");
  const tableRows = await evaluate(alice, "[...document.querySelectorAll('[aria-label=\"Final standings\"] tbody tr')].map(row => [...row.children].map(cell => cell.textContent))");
  assert.equal(tableRows.length, 2);
  assert.equal(tableRows.reduce((sum,row) => sum+Number(row[2]),0),400);
  assert.equal(tableRows.reduce((sum,row) => sum+Number(row[3]),0),4);
  assert.ok(tableRows.every(row => Number(row[2]) > 0), "both players earned points");
  assert.equal(await evaluate(bob, "document.querySelector('[aria-label=\"Final standings\"]').textContent"), standings);
  assert.equal(await evaluate(bob, "location.hash"), resultHash);
  assert.equal(await evaluate(observer, "document.querySelector('[aria-label=\"Final standings\"]').textContent"), standings);
  await click(alice, "Reload saved result");
  await waitFor(alice, "document.querySelector('[aria-label=\"Final standings\"]') !== null");
  assert.equal(await evaluate(alice, "document.querySelector('[aria-label=\"Final standings\"]').textContent"), standings);
  await cdp("Page.reload", {}, bob.session);
  await waitFor(bob, "document.querySelector('[aria-label=\"Final standings\"]') !== null");
  assert.equal(await evaluate(bob, "document.querySelector('[aria-label=\"Final standings\"]').textContent"), standings);
  await cdp("Page.reload", {}, alice.session);
  await waitFor(alice, "document.querySelector('[aria-label=\"Final standings\"]') !== null");
  assert.equal(await evaluate(alice, "location.hash"), resultHash);
  assert.equal(await evaluate(alice, "document.querySelector('[aria-label=\"Final standings\"]').textContent"), standings);
  const savedResult = await evaluate(alice, `(async () => {
    const response = await fetch('/api/v1/matches/' + location.hash.split('/')[1] + '/results');
    return (await response.json()).result;
  })()`);
  assert.equal(savedResult.matchId, matchId);
  assert.equal(savedResult.finalLevel, 2);
  const capacityAfter = await evaluate(alice, `(async () => {
    const sessions = (await (await fetch('/api/v1/sessions')).json()).sessions;
    const {settings} = await (await fetch('/api/v1/sessions/' + sessions[0].id)).json();
    const response = await fetch('/api/v1/sessions',{method:'POST',
      headers:{'content-type':'application/json'},body:JSON.stringify({settings})});
    const next = (await (await fetch('/api/v1/sessions')).json()).sessions;
    return {before:sessions.length,absent:!sessions.some(item => item.id === ${JSON.stringify(matchId)}),
      replacement:response.status,after:next.length};
  })()`);
  assert.deepEqual(capacityAfter, {before:4,absent:true,replacement:201,after:5});
  const resultFixtures = await evaluate(alice, `(async () => {
    const { mountSkinHost } = await import('/src/skin-host.ts');
    const { createDefaultResultsSkin } = await import('/@id/@multiplayer-game/default-theme');
    const result = ${JSON.stringify(savedResult)};
    result.standings = [
      { accountId: result.standings[0].accountId, username: 'Alpha', rank: 1,
        points: 300, kills: 3, deaths: 1 },
      { accountId: '00000000-0000-4000-8000-000000000009', username: 'beta', rank: 2,
        points: 300, kills: 2, deaths: 0 }
    ];
    const root = document.createElement('div');
    document.body.append(root);
    let reloaded = 0;
    let navigated;
    const mounted = mountSkinHost(root, createDefaultResultsSkin(result, () => reloaded++), {
      target: { accountId: result.standings[0].accountId, username: 'Alpha' },
      dispatchInput: () => { throw new Error('Results dispatched input.'); },
      navigate: action => { navigated = action; },
      onError: error => { throw error; }
    });
    const rows = [...root.querySelectorAll('tbody tr')].map(row => [...row.children].map(cell => cell.textContent));
    const buttons = [...root.querySelectorAll('button')];
    buttons.find(button => button.textContent === 'Reload saved result').click();
    buttons.find(button => button.textContent === 'Back to lobby').click();
    mounted.dispose();
    for (const button of buttons) button.click();
    const disposed = root.querySelector('table') === null && reloaded === 1;
    root.remove();
    return { rows, reloaded, navigated, disposed };
  })()`);
  assert.deepEqual(resultFixtures.rows, [
    ["1", "Alpha", "300", "3", "1"], ["2", "beta", "300", "2", "0"]
  ]);
  assert.equal(resultFixtures.navigated, "lobby");
  assert.ok(resultFixtures.disposed);
  await evaluate(alice, "location.hash = '#results/00000000-0000-4000-8000-000000000099'");
  await waitFor(alice, "document.querySelector('#status').getAttribute('role') === 'alert'");
  assert.equal(await evaluate(alice, "document.querySelector('#status').textContent"), "Saved match result not found.");
  await click(alice, "Reload saved result");
  await waitFor(alice, "document.querySelector('#status').getAttribute('role') === 'alert'");
  await click(alice, "Back to lobby");
  await waitFor(alice, "document.querySelector('[aria-label=\"Active sessions\"]') !== null");
  assert.equal(await evaluate(alice, "location.hash"), "");
  assert.equal(await evaluate(alice, "document.querySelector('canvas')"), null);
  const failedConnectionNavigation = await evaluate(alice, `(async () => {
    const { mountGame } = await import('/src/game.ts');
    const root = document.createElement('div');
    const status = document.createElement('p');
    document.body.append(root, status);
    let navigated;
    const dispose = mountGame(root, status, {
      id: ${JSON.stringify(savedResult.standings[0].accountId)},
      username: ${JSON.stringify(creator)}, role: 'player'
    }, '00000000-0000-4000-8000-000000000099', action => { navigated = action; });
    for (let attempt = 0; attempt < 40 && status.getAttribute('role') !== 'alert'; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    const failed = status.getAttribute('role') === 'alert';
    root.querySelector('button').click();
    dispose();
    root.remove();
    status.remove();
    return { failed, navigated };
  })()`);
  assert.ok(failedConnectionNavigation.failed);
  assert.equal(failedConnectionNavigation.navigated, "lobby");
  console.log(JSON.stringify({
    browser: version.Browser,     windows: 3,
    spectatorJoinSwitchLeave: true, spectatorTargetUnavailable: true,
    spectatorNoGameplayInput: true, spectatorSavedStandings: true,
    spectatorDeathRespawnFixture: true,
    independentMovement: true, nearbyVisibility: true, centeredCameras: true,
    actionEnvelope: true, mouseFireAndRelease: true, pointsAndHealth: true, viewportResize: true,
    fixtureShapesAndDeathHud: true, skinDisposalAndCompatibility: true, boundedOutgoingControls: true,
    savedResultHandoff: true, resultReloadAndPageRefresh: true,
    resultTableAndDisposal: true, missingResultRetry: true, backToLobby: true,
    failedConnectionLobbyNavigation: true,
    twoPlayerTwoLevelCompletion: true, sharedStandingsAfterBothRefreshes: true,
    fullCapacitySlotRelease: true, matchId, finalStandings: tableRows
  }, null, 2));
  }
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
