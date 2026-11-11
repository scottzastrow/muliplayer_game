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
const dialogs = new Map();
socket.addEventListener("close", () => {
  for (const request of pending.values()) {
    clearTimeout(request.timeout);
    request.reject(new Error("The browser debug connection closed."));
  }
  pending.clear();
});
socket.addEventListener("message", ({ data }) => {
  const message = JSON.parse(data);
  if (message.method === "Page.javascriptDialogOpening") {
    dialogs.set(message.sessionId, message.params);
  }
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
async function waitForDialog(page) {
  for (let attempt = 0; attempt < 80; attempt++) {
    const dialog = dialogs.get(page.session);
    if (dialog) {
      dialogs.delete(page.session);
      return dialog;
    }
    await delay(100);
  }
  throw new Error("Timed out waiting for the browser confirmation dialog.");
}
async function evaluate(page, expression) {
  const result = await cdp("Runtime.evaluate", {
    expression, returnByValue: true, awaitPromise: true
  }, page.session);
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? "Browser evaluation failed.");
  }
  return result.result.value;
}
async function waitFor(page, expression, timeoutMs = 8000) {
  for (let attempt = 0; attempt < Math.ceil(timeoutMs / 100); attempt++) {
    if (await evaluate(page, expression)) return;
    await delay(100);
  }
  const status = await evaluate(page, "document.querySelector('#status')?.textContent");
  throw new Error(`Browser condition timed out: ${expression}; status: ${status}`);
}
async function reloadStandings(page) {
  const documentId = await evaluate(page, "window.__probe.documentId");
  await cdp("Page.reload", {}, page.session);
  await waitFor(page, `window.__probe?.documentId !== undefined &&
    window.__probe.documentId !== ${JSON.stringify(documentId)} &&
    document.querySelector('[aria-label="Final standings"]') !== null`);
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
  window.__probe = {
    documentId: crypto.randomUUID(), snapshot: null, firstActiveSnapshot: null, actions: []
  };
  const NativeSocket = window.WebSocket;
  window.WebSocket = class extends NativeSocket {
    constructor(...args) {
      super(...args);
      this.addEventListener('message', event => {
        const message = JSON.parse(event.data);
        if (message.type === 'server.snapshot') {
          window.__probe.snapshot = message.payload;
          if (!window.__probe.firstActiveSnapshot && message.payload.phase === 'active' &&
              message.payload.entities?.some(entity => entity.state.kind === 'npc')) {
            window.__probe.firstActiveSnapshot = structuredClone(message.payload);
          }
          if (window.__heldShots) {
            for (const entity of message.payload.entities) {
              if (entity.state.kind === 'projectile' &&
                  !window.__heldShots.some(shot => shot.id === entity.id)) {
                window.__heldShots.push(entity);
                if (window.__heldShots.length > 40) window.__heldShots.shift();
              }
            }
          }
        }
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
    if (!this.canvas.__draw) {
      this.canvas.__draw = {
        snapshotTick: window.__probe.snapshot?.tick,
        arcs: [], squares: [], terrain: [], boundaries: [], pickups: [],
        fillStyles: [], strokes: [], fillTexts: [], radarTerrain: [], diamonds: []
      };
    }
    if (this.fillStyle === '#101824') {
      this.canvas.__draw = {
        snapshotTick: window.__probe.snapshot?.tick,
        arcs: [], squares: [], terrain: [], boundaries: [], pickups: [],
        fillStyles: [], strokes: [], fillTexts: [], radarTerrain: [], diamonds: []
      };
    }
    if (this.canvas.__draw && !this.canvas.__draw.fillStyles.includes(this.fillStyle)) {
      this.canvas.__draw.fillStyles.push(this.fillStyle);
    }
    if (this.fillStyle === '#ed6b61') {
      const m = this.getTransform();
      const centerX = (m.a*(x+w/2)+m.c*(y+h/2)+m.e)/devicePixelRatio;
      const centerY = (m.b*(x+w/2)+m.d*(y+h/2)+m.f)/devicePixelRatio;
      this.canvas.__draw?.squares.push({
        x:centerX-w/2, y:centerY-h/2, centerX, centerY,
        angle:Math.atan2(m.b,m.a), w, h, color:this.fillStyle
      });
    }
    if (this.fillStyle === '#2b3d51' || this.fillStyle === '#2d4155') {
      this.canvas.__draw?.terrain.push({ x, y, w, h, color: this.fillStyle });
    }
    if (this.fillStyle === '#718395') {
      this.canvas.__draw?.boundaries.push({ x, y, w, h, color: this.fillStyle });
    }
    if (this.fillStyle === '#344a60' && w !== 2) {
      this.canvas.__draw?.radarTerrain.push({x,y,w,h});
    }
    return nativeRect.call(this, x, y, w, h);
  };
  const nativeStrokeRect = CanvasRenderingContext2D.prototype.strokeRect;
  CanvasRenderingContext2D.prototype.strokeRect = function(x, y, w, h) {
    if (this.strokeStyle === '#3b5168' || this.strokeStyle === '#c0cad3') {
      this.canvas.__draw?.strokes.push({ x, y, w, h, color: this.strokeStyle });
    }
    return nativeStrokeRect.call(this, x, y, w, h);
  };
  const nativeFill = CanvasRenderingContext2D.prototype.fill;
  CanvasRenderingContext2D.prototype.fill = function(...args) {
    if (this.fillStyle === '#ffa64d') {
      this.canvas.__draw?.pickups.push({ color: this.fillStyle });
    }
    if (this.fillStyle === '#ffa64d' && this.__path?.length === 4) {
      this.canvas.__draw?.diamonds.push(this.__path.map(point => ({...point})));
    }
    return nativeFill.apply(this, args);
  };
  const nativeBeginPath = CanvasRenderingContext2D.prototype.beginPath;
  CanvasRenderingContext2D.prototype.beginPath = function(...args) {
    this.__path = [];
    return nativeBeginPath.apply(this,args);
  };
  for (const method of ['moveTo','lineTo']) {
    const native = CanvasRenderingContext2D.prototype[method];
    CanvasRenderingContext2D.prototype[method] = function(x,y) {
      this.__path?.push({x,y});
      return native.call(this,x,y);
    };
  }
  const nativeArc = CanvasRenderingContext2D.prototype.arc;
  CanvasRenderingContext2D.prototype.arc = function(x, y, r, ...args) {
    this.canvas.__draw?.arcs.push({ x, y, r, color: this.fillStyle });
    return nativeArc.call(this, x, y, r, ...args);
  };
  const nativeFillText = CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText = function(text, x, y, ...args) {
    this.canvas.__draw?.fillTexts.push({ text, x, y, color: this.fillStyle });
    return nativeFillText.call(this, text, x, y, ...args);
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
  await cdp("Emulation.setFocusEmulationEnabled", { enabled: true }, sessionId);
  await cdp("Page.setWebLifecycleState", { state: "active" }, sessionId);
  await cdp("Page.addScriptToEvaluateOnNewDocument", { source: probe }, sessionId);
  await cdp("Page.navigate", { url: origin }, sessionId);
  await waitFor(page, "document.querySelector('.auth-form') !== null");
  return page;
}
async function signIn(page, username, password, controlMode = "keyboard-mouse") {
  await click(page, "Need an account? Register");
  await evaluate(page, `document.querySelector('[name=username]').value = ${JSON.stringify(username)};
    document.querySelector('[name=password]').value = ${JSON.stringify(password)};
    document.querySelector('[name=controlMode][value=${controlMode}]').checked = true`);
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
      renderedTick: canvas.__draw?.snapshotTick,
      arcs: canvas.__draw?.arcs ?? [], squares: canvas.__draw?.squares ?? [],
      terrain: canvas.__draw?.terrain ?? [], boundaries: canvas.__draw?.boundaries ?? [],
      pickups: canvas.__draw?.pickups ?? [],
      fillStyles: canvas.__draw?.fillStyles ?? [],
      strokes: canvas.__draw?.strokes ?? [],
      fillTexts: canvas.__draw?.fillTexts ?? [],
      radarTerrain: canvas.__draw?.radarTerrain ?? [],
      diamonds: canvas.__draw?.diamonds ?? [],
      canvasCount: document.querySelectorAll('canvas').length,
      colors: Object.fromEntries(window.__probe.snapshot.players.map(player => {
        const context = document.createElement('canvas').getContext('2d');
        context.fillStyle = player.color;
        return [player.accountId, context.fillStyle];
      })),
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
async function toggleRadarFilter(page, category, checked) {
  const sentInput = await evaluate(page, `(() => {
    const before = window.__probe.actions.length;
    const input = document.querySelector('[name="radar-${category}"]');
    input.checked = ${checked};
    input.dispatchEvent(new Event('change',{bubbles:true}));
    return window.__probe.actions.length !== before;
  })()`);
  assert.equal(sentInput, false, "filter changes do not dispatch gameplay input");
  await delay(100);
}
function radarCategoryCounts(view) {
  const x = view.width - 84;
  const inside = point => Math.hypot(point.x - x, point.y - 84) <= 72;
  const friendColors = view.snapshot.players.filter(player =>
    player.accountId !== view.snapshot.viewerAccountId).map(player => view.colors[player.accountId]);
  return {
    player: view.arcs.filter(arc => arc.r === 3 && inside(arc) && friendColors.includes(arc.color)).length,
    enemy: view.arcs.filter(arc => arc.r === 3 && inside(arc) && arc.color === "#ed6b61").length,
    pickup: view.diamonds.filter(path => inside(path[0]) &&
      Math.max(...path.map(point => point.x)) - Math.min(...path.map(point => point.x)) === 6).length,
    terrain: view.radarTerrain.length
  };
}
async function verifyRadarFilters(page) {
  const filters = await evaluate(page, `[...document.querySelectorAll('[aria-label="Radar filters"] input')]
    .map(input => ({name:input.name,checked:input.checked}))`);
  assert.deepEqual(filters, ["player","enemy","pickup","terrain"].map(category =>
    ({name:"radar-"+category,checked:true})));
  const before = await state(page);
  const markers = before.snapshot.radar.markers.map(marker => marker.id);
  const counts = radarCategoryCounts(before);
  for (const count of Object.values(counts)) assert.ok(count > 0, "each default category is rendered");
  for (const category of ["player","enemy","pickup","terrain"]) {
    await toggleRadarFilter(page, category, false);
    const hidden = await state(page);
    const visible = radarCategoryCounts(hidden);
    assert.equal(visible[category], 0, `${category} filter hides only its radar category`);
    for (const other of Object.keys(visible)) {
      if (other !== category) assert.ok(visible[other] > 0, `${other} remains visible`);
    }
    assert.deepEqual(hidden.snapshot.radar.markers.map(marker => marker.id), markers,
      "filtering does not alter authorized server markers");
    assert.ok(hidden.arcs.some(arc => arc.x === hidden.width - 84 && arc.y === 84 && arc.r === 4),
      "own dot stays centered with every filter");
    assert.ok(hidden.arcs.some(arc => arc.r === 2 &&
      Math.abs(Math.hypot(arc.x - (hidden.width - 84),arc.y - 84) - 4.5) < 0.1),
    "facing stays centered with every filter");
    assert.ok(hidden.fillTexts.some(label => label.text === `Enemies remaining: ${counts.enemy}`),
      "enemy count is independent of NPC visibility");
    await toggleRadarFilter(page, category, true);
  }
  return counts;
}
function centered(view) {
  const player = own(view);
  const playerColor = view.colors[player.accountId];
  const livingNpcs = view.snapshot.entities.filter(item =>
    item.state.kind === "npc" && item.state.health > 0);
  assert.deepEqual(view.snapshot.radar?.categories, ["player", "enemy", "pickup", "terrain"],
    "the default module selects all four authorized categories");
  assert.deepEqual(view.snapshot.radar?.markers.filter(item => item.category === "enemy").map(item => item.id),
    livingNpcs.map(item => item.id), "the viewer receives each living NPC marker");
  const radarX = view.width - 84;
  assert.ok(view.arcs.some(item => Math.abs(item.x - radarX) < 1 &&
    item.y === 84 && item.r === 72), "the skin places the radar in the upper-right");
  assert.ok(view.arcs.some(item => Math.abs(item.x - radarX) < 1 && item.y === 84 && item.r === 4 &&
    item.color === playerColor), "the radar centers on the selected player");
  assert.ok(view.fillTexts.some(item => item.text ===
    `Enemies remaining: ${livingNpcs.length}` &&
    Math.abs(item.x - radarX) < 1 && item.y === 164),
  "the living enemy count is displayed below the radar");
  const dot = view.arcs.find(item => item.color === playerColor && item.r === 14);
  assert.ok(dot, `own player dot is rendered (${JSON.stringify({
    accountId: player.accountId,
    color: player.color,
    normalizedColor: playerColor,
    viewerAccountId: view.snapshot.viewerAccountId,
    selectedTargetId: view.snapshot.spectatorView?.targetAccountId,
    cameraAnchor: view.snapshot.spectatorView?.cameraAnchor,
    viewport: { width: view.width, height: view.height, canvasCount: view.canvasCount },
    players: view.snapshot.players.map(item => ({
      accountId: item.accountId, color: item.color, position: item.position,
      alive: item.alive, health: item.health
    })),
    entities: view.snapshot.entities.map(item => ({
      kind: item.state.kind, accountId: item.state.accountId, color: item.state.color,
      position: item.position,
      screen: { x: item.position.x - (view.snapshot.spectatorView?.cameraAnchor.x ?? player.position.x)
          + view.width / 2,
        y: item.position.y - (view.snapshot.spectatorView?.cameraAnchor.y ?? player.position.y)
          + view.height / 2 }
    })),
    arcs: view.arcs
  })})`);
  assert.ok(Math.abs(dot.x - view.width / 2) < 0.1,
    `own dot centered horizontally (${dot.x} versus ${view.width / 2})`);
  assert.ok(Math.abs(dot.y - view.height / 2) < 0.1,
    `own dot centered vertically (${dot.y} versus ${view.height / 2})`);
  assert.equal(view.pointsFont, view.healthFont, "stats share a compact type size");
  assert.equal(view.points, `Score: ${own(view).points}`);
  assert.equal(view.health, `Health: ${own(view).health} / ${view.snapshot.playerMaxHealth ?? 100}`);
  const facing = player.facing ?? { x: 1, y: 0 };
  const expectedFacingDot = { x: dot.x + facing.x * 16, y: dot.y + facing.y * 16 };
  assert.ok(view.arcs.some(item => item.color === playerColor && item.r === 3 &&
    Math.hypot(item.x - expectedFacingDot.x, item.y - expectedFacingDot.y) < 1.25),
  `same-color facing dot follows player aim (${JSON.stringify({
    facing: player.facing, expectedFacingDot, arcs: view.arcs
  })})`);
}
async function move(page, code, ms) {
  await moveKeys(page, [code], ms);
}
async function moveKeys(page, codes, ms) {
  await cdp("Page.bringToFront", {}, page.session);
  await evaluate(page, "document.querySelector('canvas').focus()");
  for (const code of codes) {
    const key = ({ KeyW: "w", KeyA: "a", KeyS: "s", KeyD: "d" })[code] ?? code;
    await cdp("Input.dispatchKeyEvent", { type: "keyDown", key, code }, page.session);
  }
  await delay(ms);
  for (const code of codes) {
    const key = ({ KeyW: "w", KeyA: "a", KeyS: "s", KeyD: "d" })[code] ?? code;
    await cdp("Input.dispatchKeyEvent", { type: "keyUp", key, code }, page.session);
  }
  await delay(200);
}
async function aim(page, horizontal, vertical) {
  await cdp("Page.bringToFront", {}, page.session);
  await evaluate(page, "document.querySelector('canvas').focus()");
  const point = await evaluate(page, `(() => {
    const bounds = document.querySelector('canvas').getBoundingClientRect();
    return { x: bounds.left + bounds.width / 2 + ${horizontal},
      y: bounds.top + bounds.height / 2 + ${vertical} };
  })()`);
  await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", buttons: 0, ...point }, page.session);
  await delay(350);
}
async function verifyHeldControls() {
  const results = [];
  for (const mode of ["keyboard-mouse", "keyboard-only", "first-person"]) {
    const page = await newWindow();
    const username = `Held_${mode === "keyboard-mouse" ? "M" : "K"}_${Date.now().toString(36)}`;
    await signIn(page, username, randomUUID(), mode);
    await evaluate(page, `document.querySelector('[name=setting-initialNpcsPerPlayer]').value = '1';
        document.querySelector('[name=setting-baseNpcHealth]').value = '100000';
        document.querySelector('[name=setting-npcMovementSpeed]').value = '0';
        document.querySelector('[name=setting-npcDetectionRange]').value = '0';
        document.querySelector('[name=setting-maxLevels]').value = '1'`);
    await click(page, "Create session");
    const sessionId = await evaluate(page, `(async () =>
        (await (await fetch('/api/v1/sessions')).json()).sessions
          .find(session => session.creator === ${JSON.stringify(username)}).id)()`);
    try {
      await clickSessionButton(page, username, "Start Session");
      await waitFor(page, "window.__probe.snapshot !== null");
      await cdp("Page.bringToFront", {}, page.session);
      await evaluate(page, `document.querySelector('canvas').focus();
        window.__heldRepeats = 0;
        document.querySelector('canvas').addEventListener('keydown', event => {
          if (event.repeat) window.__heldRepeats++;
        })`);
      const down = mode !== "keyboard-mouse" ? "KeyS" : "ArrowDown";
      const key = (code, type = "keyDown", autoRepeat = false) => cdp("Input.dispatchKeyEvent", {
        type, code, key: ({ KeyS: "s", Space: " " })[code] ?? code, autoRepeat
      }, page.session);
      for (const turn of mode !== "keyboard-mouse" ? ["ArrowLeft", "ArrowRight"] : ["mouse"]) {
        await key(down);
        await waitFor(page, `window.__probe.snapshot.players.find(p =>
          p.accountId === window.__probe.snapshot.viewerAccountId).facing.y > 0.99`);
        if (turn === "mouse") await aim(page, -300, 0);
        else {
          await key(turn);
          await waitFor(page, `Math.abs(window.__probe.snapshot.players.find(p =>
            p.accountId === window.__probe.snapshot.viewerAccountId).facing.x) > 0.9`);
          await key(turn, "keyUp");
          await delay(150);
        }
        await evaluate(page, "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
        const before = await state(page);
        const facing = own(before).facing;
        const displayedFacing = view => {
          const color = view.colors[own(view).accountId];
          const body = view.arcs.find(arc => arc.r === 14 && arc.color === color);
          const dot = view.arcs.find(arc => arc.r === 3 && arc.color === color &&
            Math.abs(Math.hypot(arc.x - body.x, arc.y - body.y) - 16) < 0.1);
          assert.ok(dot, "own facing dot is rendered");
          return { x: (dot.x - body.x) / 16, y: (dot.y - body.y) / 16 };
        };
        const localFacing = displayedFacing(before);
        const existingShots = new Set(before.snapshot.entities.filter(entity =>
          entity.state.kind === "projectile").map(entity => entity.id));
        assert.ok(turn === "mouse" ? facing.x < -0.99
          : turn === "ArrowLeft" ? facing.x > 0.9 : facing.x < -0.9,
          `${mode} independent aim/rotation overrides the initial downward facing`);
        const bounds = await evaluate(page, `(() => {
          const r = document.querySelector('canvas').getBoundingClientRect();
          return { x: r.left + r.width / 2 - 300, y: r.top + r.height / 2 };
        })()`);
        await evaluate(page, "window.__probe.actions = []; window.__heldShots = []");
        if (mode !== "keyboard-mouse") await key("Space");
        else await cdp("Input.dispatchMouseEvent", {
          type: "mousePressed", button: "left", buttons: 1, clickCount: 1, ...bounds
        }, page.session);
        for (let repeat = 0;repeat < 4;repeat++) {
          await key(down, "keyDown", true);
          await delay(60);
        }
        const held = await state(page);
        assert.ok(own(held).position.y > own(before).position.y + 20,
          `${mode} keeps moving down while firing after repeats`);
        const travelX = own(held).position.x - own(before).position.x;
        const travelY = own(held).position.y - own(before).position.y;
        const travelAngle = Math.atan2(travelY, travelX);
        const facingAngle = Math.atan2(facing.y, facing.x);
        const towardFacing = Math.atan2(Math.sin(facingAngle - Math.PI / 2),
          Math.cos(facingAngle - Math.PI / 2));
        const expectedTravel = Math.PI / 2 + towardFacing * 0.40;
        assert.ok(Math.abs(Math.atan2(Math.sin(travelAngle - expectedTravel),
          Math.cos(travelAngle - expectedTravel))) < 0.15,
          `${mode} applies 40% steering without accumulating rotation`);
        assert.ok(turn === "mouse"
          ? own(held).facing.x < -0.99 && Math.abs(own(held).facing.y) < 0.15
          : Math.hypot(displayedFacing(held).x - localFacing.x,
            displayedFacing(held).y - localFacing.y) < 0.01,
          `${mode} auto-repeat preserves independent facing: ${JSON.stringify({
            turn, before: facing, after: own(held).facing, actions: held.actions
          })}`);
        const firing = held.actions.filter(input => input.payload.action.fire);
        assert.ok(turn === "mouse" || Math.hypot(own(held).facing.x - localFacing.x,
          own(held).facing.y - localFacing.y) < 0.35, "server facing follows the rotated heading");
        assert.ok(firing.length >= 3, `${mode} sends sustained firing intent`);
        for (const { payload: { action } } of firing) {
          assert.equal(action.moveX, 0);
          assert.equal(action.moveY, 1);
        }
        const observedShots = await evaluate(page, "window.__heldShots");
        const shots = observedShots.filter(entity =>
          entity.state.kind === "projectile" && entity.state.ownerAccountId === own(held).accountId &&
          !existingShots.has(entity.id));
        assert.ok(shots.length > 0, `${mode} creates authoritative projectiles`);
        for (const shot of shots) {
          const velocity = shot.state.velocity;
          const speed = Math.hypot(velocity.x, velocity.y);
          // Mouse aim uses an interpolated camera; each shot starts at the server's newer position.
          assert.ok(turn === "mouse"
            ? velocity.x / speed < -0.97 && Math.abs(velocity.y / speed) < 0.25
            : Math.hypot(velocity.x / speed - localFacing.x, velocity.y / speed - localFacing.y) < 0.35,
            `${mode} projectiles follow aim rather than downward movement: ${JSON.stringify({
              facing, velocity, currentFacing: own(held).facing,
              inputs: firing.map(input => input.payload.action)
            })}`);
        }
        if (mode !== "keyboard-mouse") await key("Space", "keyUp");
        else await cdp("Input.dispatchMouseEvent", {
          type: "mouseReleased", button: "left", buttons: 0, clickCount: 1, ...bounds
        }, page.session);
        await key(down, "keyUp");
        await delay(150);
        await evaluate(page, "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
        const released = await state(page);
        assert.equal(released.actions.at(-1).payload.action.moveY, 0);
        assert.equal(released.actions.at(-1).payload.action.fire, false);
        assert.ok(turn === "mouse" ? own(released).facing.x < -0.99
          : Math.hypot(displayedFacing(released).x - localFacing.x,
            displayedFacing(released).y - localFacing.y) < 0.01,
          `release preserves facing: ${JSON.stringify({
            mode, turn, localFacing, displayed: displayedFacing(released),
            serverFacing: own(released).facing
          })}`);
        results.push({
          mode, turn, repeats: 4, facing,
          downwardDisplacement: own(held).position.y - own(before).position.y,
          firingInputs: firing.length, projectiles: shots.length
        });
      }
      assert.equal(await evaluate(page, "window.__heldRepeats"), mode !== "keyboard-mouse" ? 8 : 4);
    } finally {
      const leave = await evaluate(page, `(async () => {
        return (await fetch('/api/v1/sessions/${sessionId}/leave', {
          method: 'POST', headers: {'content-type':'application/json'}, body:'{}'
        })).status;
      })()`);
      assert.equal(leave, 204);
    }
  }
  console.log(JSON.stringify({ browser: version.Browser, heldControls: results }, null, 2));
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
    const failed = await state(page);
    throw new Error(`Timed out firing in level ${level} toward ${remaining} remaining NPCs: ${
      JSON.stringify({
        phase: failed.snapshot.phase,
        player: own(failed),
        npcs: failed.snapshot.entities.filter(item => item.state.kind === "npc")
          .map(item => ({ position: item.position, health: item.state.health })),
        actions: failed.actions.slice(-5)
      })}`);
  } finally {
    if (pressed) await cdp("Input.dispatchMouseEvent", {
      type: "mouseReleased", button: "left", buttons: 0, clickCount: 1, ...target
    }, page.session);
  }
}

function pointHitsObstacle(point, radius, obstacle) {
  const x = Math.max(obstacle.x, Math.min(point.x, obstacle.x + obstacle.width));
  const y = Math.max(obstacle.y, Math.min(point.y, obstacle.y + obstacle.height));
  return Math.hypot(point.x - x, point.y - y) < radius;
}

function segmentHitsObstacles(from, to, obstacles, radius = 0) {
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const steps = Math.max(1, Math.ceil(distance / 4));
  for (let index = 0; index <= steps; index += 1) {
    const fraction = index / steps;
    const point = {
      x: from.x + (to.x - from.x) * fraction,
      y: from.y + (to.y - from.y) * fraction
    };
    if (obstacles.some(obstacle => pointHitsObstacle(point, radius, obstacle))) return true;
  }
  return false;
}

async function observeNpcMovement(page, duration, trace) {
  const deadline = Date.now() + duration;
  while (Date.now() < deadline) {
    const current = await state(page);
    const npc = current.snapshot.entities.find(entity => entity.state.kind === "npc");
    if (npc) trace.push(npc.position);
    await delay(100);
  }
}

async function moveAndSample(page, code, duration, playerTrace, npcTrace) {
  await cdp("Page.bringToFront", {}, page.session);
  await evaluate(page, "document.querySelector('canvas').focus()");
  const codes = Array.isArray(code) ? code : [code];
  for (const item of codes) {
    const key = ({ KeyW: "w", KeyA: "a", KeyS: "s", KeyD: "d" })[item] ?? item;
    await cdp("Input.dispatchKeyEvent", { type: "keyDown", key, code: item }, page.session);
  }
  try {
    const deadline = Date.now() + duration;
    while (Date.now() < deadline) {
      const current = await state(page);
      const player = own(current);
      const npc = current.snapshot.entities.find(entity => entity.state.kind === "npc");
      if (player) playerTrace.push(player.position);
      if (npc) npcTrace.push(npc.position);
      await delay(100);
    }
  } finally {
    for (const item of codes) {
      const key = ({ KeyW: "w", KeyA: "a", KeyS: "s", KeyD: "d" })[item] ?? item;
      await cdp("Input.dispatchKeyEvent", { type: "keyUp", key, code: item }, page.session);
    }
  }
  await delay(200);
  const current = await state(page);
  playerTrace.push(own(current).position);
  const npc = current.snapshot.entities.find(entity => entity.state.kind === "npc");
  if (npc) npcTrace.push(npc.position);
}

async function fireWhileAiming(page, targetForView, duration, npcTrace) {
  await cdp("Page.bringToFront", {}, page.session);
  await evaluate(page, "document.querySelector('canvas').focus()");
  let pressed = false;
  let point;
  try {
    const deadline = Date.now() + duration;
    while (Date.now() < deadline) {
      const current = await state(page);
      const player = own(current);
      const target = targetForView(current);
      if (!player || !target) throw new Error("The browser encounter lost its player or NPC.");
      const npc = current.snapshot.entities.find(entity => entity.state.kind === "npc");
      if (npc) npcTrace.push(npc.position);
      const bounds = await evaluate(page, `(() => {
        const rect = document.querySelector('canvas').getBoundingClientRect();
        return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
      })()`);
      const dx = target.x - player.position.x;
      const dy = target.y - player.position.y;
      const scale = Math.min(1, (bounds.width / 2 - 20) / Math.max(1, Math.abs(dx)),
        (bounds.height / 2 - 20) / Math.max(1, Math.abs(dy)));
      point = {
        x: bounds.left + bounds.width / 2 + dx * scale,
        y: bounds.top + bounds.height / 2 + dy * scale
      };
      await cdp("Input.dispatchMouseEvent", {
        type: pressed ? "mouseMoved" : "mousePressed",
        button: "left",
        buttons: 1,
        clickCount: 1,
        ...point
      }, page.session);
      pressed = true;
      await delay(100);
    }
  } finally {
    if (pressed) await cdp("Input.dispatchMouseEvent", {
      type: "mouseReleased", button: "left", buttons: 0, clickCount: 1, ...point
    }, page.session);
  }
}

try {
  if (process.argv.includes("--appearance")) {
    const { verifyAppearance } = await import("./appearance.mjs");
    await verifyAppearance({ newWindow, signIn, evaluate, click, clickSessionButton,
      waitFor, cdp, delay, state, browser: version.Browser, origin });
  } else if (process.argv.includes("--npc-pace-colors")) {
    const alice = await newWindow();
    const bob = await newWindow();
    const observer = await newWindow();
    const suffix = Date.now().toString(36);
    const creator = `PaceA_${suffix}`;
    const bobName = `PaceB_${suffix}`;
    const password = randomUUID();
    await signIn(alice, creator, password);
    await signIn(bob, bobName, password);
    await signIn(observer, `PaceWatch_${suffix}`, password);
    const { verifyNpcPaceColors } = await import("./npc-pace-colors.mjs");
    await verifyNpcPaceColors({ alice, bob, observer, creator, bobName,
      cdp, evaluate, waitFor, click, clickSessionButton, state, own, delay,
      browser: version.Browser, origin });
  } else if (process.argv.includes("--npc-ranged")) {
    const playerPage = await newWindow();
    const creator = `Ranged_${Date.now().toString(36)}`;
    await signIn(playerPage, creator, randomUUID());
    const { verifyNpcRanged } = await import("./npc-ranged.mjs");
    await verifyNpcRanged({ playerPage, creator, cdp, evaluate, waitFor, click,
      clickSessionButton, state, delay, browser: version.Browser, origin });
  } else if (process.argv.includes("--npc-roaming") || process.argv.includes("--npc-explore-routes")) {
    const playerPage = await newWindow();
    const creator = `Roam_${Date.now().toString(36)}`;
    await signIn(playerPage, creator, randomUUID());
    const { verifyNpcRoaming } = await import("./npc-roaming.mjs");
    await verifyNpcRoaming({
      playerPage, creator, newWindow, cdp, evaluate, waitFor, click, clickSessionButton,
      state, own, delay, browser: version.Browser, origin,
      routeOnly: process.argv.includes("--npc-explore-routes")
    });
  } else if (process.argv.includes("--fixed-arena-minimal")) {
    const playerPage = await newWindow();
    const observer = await newWindow();
    const suffix = Date.now().toString(36);
    const password = randomUUID();
    const creator = `Fixed_${suffix}`;
    await signIn(playerPage, creator, password);
    await signIn(observer, `Watch_${suffix}`, password);
    const { verifyFixedArenaMinimal } = await import("./fixed-arena-minimal.mjs");
    await verifyFixedArenaMinimal({
      playerPage, observer, creator, cdp, evaluate, waitFor, click, clickSessionButton,
      state, own, aim, moveKeys, delay, browser: version.Browser, origin
    });
  } else if (process.argv.includes("--end-session")) {
    const { verifyEndSession } = await import("./end-session.mjs");
    await verifyEndSession({ newWindow, signIn, evaluate, click, clickSessionButton,
      waitFor, cdp, waitForDialog, version });
  } else if (process.argv.includes("--level-transitions") || process.argv.includes("--compact-match")) {
    const { verifyLevelTransitions } = await import("./level-transitions.mjs");
    await verifyLevelTransitions({ newWindow, signIn, evaluate, click, clickSessionButton,
      waitFor, cdp, delay, state, aim, version });
  } else if (process.argv.includes("--held-controls")) {
    await verifyHeldControls();
  } else {
  const alice = await newWindow();
  const bob = await newWindow();
  const observer = await newWindow();
  const aliceWindow = await cdp("Browser.getWindowForTarget", { targetId: alice.target });
  const bobWindow = await cdp("Browser.getWindowForTarget", { targetId: bob.target });
  const observerWindow = await cdp("Browser.getWindowForTarget", { targetId: observer.target });
  assert.notEqual(aliceWindow.windowId, bobWindow.windowId, "distinct actual browser windows");
  for (const window of [aliceWindow, bobWindow, observerWindow]) {
    await cdp("Browser.setWindowBounds", { windowId: window.windowId,
      bounds: { width: 1000, height: 900, windowState: "normal" } });
  }
  const suffix = Date.now().toString(36);
  const password = randomUUID();
  const creator = `ViewA_${suffix}`;
  const bobName = `ViewB_${suffix}`;
  await signIn(alice, creator, password, "keyboard-mouse");
  await signIn(bob, bobName, password, "keyboard-only");
  await signIn(observer, `Watch_${suffix}`, password);
  await evaluate(observer, `(() => {
    const nativeFetch = window.fetch.bind(window);
    let provideLegacyAccount = true;
    window.fetch = async (input, init) => {
      const response = await nativeFetch(input, init);
      const url = input instanceof Request ? input.url : String(input);
      if (provideLegacyAccount && url.endsWith('/api/v1/auth/login')) {
        provideLegacyAccount = false;
        const body = await response.clone().json();
        body.account.controlMode = null;
        return new Response(JSON.stringify(body), {
          status: response.status, headers: { 'content-type': 'application/json' }
        });
      }
      return response;
    };
  })()`);
  await click(observer, "Sign out");
  await waitFor(observer, "document.querySelector('.auth-form') !== null");
  await evaluate(observer, `document.querySelector('[name=username]').value = ${JSON.stringify(`Watch_${suffix}`)};
    document.querySelector('[name=password]').value = ${JSON.stringify(password)}`);
  await click(observer, "Sign in");
  await waitFor(observer, "document.querySelector('.auth-form h2')?.textContent === 'Choose your controls'");
  assert.equal(await evaluate(observer,
    "document.querySelectorAll('input[name=controlMode]').length"), 3);
  assert.equal(await evaluate(observer,
    "document.querySelector('input[name=controlMode]:checked')"), null);
  await evaluate(observer, `document.querySelector('[name=controlMode][value=keyboard-only]').checked = true;
    document.querySelector('.auth-form').requestSubmit()`);
  await waitFor(observer, "document.querySelector('[aria-label=\"Active sessions\"]') !== null");
  assert.equal(await evaluate(observer, `(async () =>
    (await (await fetch('/api/v1/me')).json()).account.controlMode)()`),
  "keyboard-only", "legacy sign-in choice is saved to the account");
  await click(observer, "Sign out");
  await waitFor(observer, "document.querySelector('.auth-form') !== null");
  await evaluate(observer, `document.querySelector('[name=username]').value = ${JSON.stringify(`Watch_${suffix}`)};
    document.querySelector('[name=password]').value = ${JSON.stringify(password)}`);
  await click(observer, "Sign in");
  await waitFor(observer, "document.querySelector('[aria-label=\"Active sessions\"]') !== null");
  assert.equal(await evaluate(observer, `(async () =>
    (await (await fetch('/api/v1/me')).json()).account.controlMode)()`),
  "keyboard-only", "selected control mode persists after signing out and back in");
  const selectedModes = await evaluate(alice, `(async () => {
    const own = await (await fetch('/api/v1/me')).json();
    return own.account.controlMode;
  })()`);
  assert.equal(selectedModes, "keyboard-mouse", "signup choice is saved to the account");
  await evaluate(observer, `document.querySelector('[name=controlMode][value=keyboard-only]').checked = true;
    document.querySelector('[name=controlMode]').closest('form').requestSubmit()`);
  await waitFor(observer, "document.querySelector('#status').textContent === 'Controls updated.'");
  const changedMode = await evaluate(observer, `(async () =>
    (await (await fetch('/api/v1/me')).json()).account.controlMode)()`);
  assert.equal(changedMode, "keyboard-only", "lobby control changes persist to the account");
  await evaluate(observer, `document.querySelector('[name=controlMode][value=keyboard-mouse]').checked = true;
    document.querySelector('[name=controlMode]').closest('form').requestSubmit()`);
  await waitFor(observer, "document.querySelector('#status').textContent === 'Controls updated.'");
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
  } else if (process.argv.includes("--health-radar")) {
    const { verifyHealthRadar } = await import("./health-radar.mjs");
    await verifyHealthRadar({
      alice, bob, observer, creator, observerName: `Watch_${suffix}`, cdp, evaluate, waitFor,
      click, clickSessionButton, delay, browser: version.Browser, origin
    });
  } else if (process.argv.includes("--npc-spawns")) {
    const { verifyNpcSpawns } = await import("./npc-spawns.mjs");
    await verifyNpcSpawns({
      alice, creator, cdp, evaluate, waitFor, click, clickSessionButton,
      state, delay, browser: version.Browser, origin
    });
  } else if (process.argv.includes("--simple-generated")) {
    const { verifySimpleGenerated } = await import("./simple-generated.mjs");
    await verifySimpleGenerated({
      alice, creator, cdp, evaluate, waitFor, click, clickSessionButton,
      state, own, aim, moveAndSample, delay, browser: version.Browser, origin
    });
  } else if (process.argv.includes("--arena-obstacles")) {
    await evaluate(alice, `document.querySelector('[name=setting-maxPlayers]').value = '1';
      document.querySelector('[name=setting-initialNpcsPerPlayer]').value = '1';
      document.querySelector('[name=setting-baseNpcHealth]').value = '100000';
      document.querySelector('[name=setting-maxLevels]').value = '1'`);
    await click(alice, "Create session");
    const { seedWaitingRoom } = await import("./npc-spawns.mjs");
    await seedWaitingRoom({ alice, creator, evaluate, origin }, 4315);
    await clickSessionButton(alice, creator, "Start Session");
    await cdp("Page.bringToFront", {}, alice.session);
    await waitFor(alice, "window.__probe.snapshot !== null");
    await waitFor(alice, "document.querySelector('canvas') !== null");
    await delay(200);
    let initial = await state(alice);
    for (let attempt = 0; attempt < 20 && initial.renderedTick !== initial.snapshot.tick; attempt++) {
      await delay(16);
      initial = await state(alice);
    }
    assert.equal(initial.renderedTick, initial.snapshot.tick, "compare the rendered snapshot, not a newer message");
    const arena = initial.snapshot.map;
    const playerAtStart = own(initial).position;
    const npcAtStart = initial.snapshot.entities.find(entity => entity.state.kind === "npc");
    assert.equal(arena.obstacles.length, 641, "47 distributed solid clusters are in the map");
    assert.deepEqual(playerAtStart, { x: 272, y: 272 });
    assert.ok(Math.hypot(npcAtStart.position.x - 464, npcAtStart.position.y - 656) < 60,
      `Seed 4315 places the NPC near the northwest encounter (${JSON.stringify(npcAtStart.position)})`);
    assert.ok(segmentHitsObstacles(playerAtStart, npcAtStart.position, arena.obstacles, 3),
      "the player and NPC start across a solid cluster with no direct shot");
    const radarMarker = initial.arcs.find(item => item.color === "#ed6b61" && item.r === 3);
    assert.ok(radarMarker, "the NPC radar marker is visible over obstructing terrain");
    const radarDelta = {
      x: npcAtStart.position.x - playerAtStart.x,
      y: npcAtStart.position.y - playerAtStart.y
    };
    const radarDistance = Math.hypot(radarDelta.x, radarDelta.y);
    const radarOffset = Math.min(67, radarDistance / 512 * 67);
    centered(initial);
    assert.ok(Math.hypot(radarMarker.x - (initial.width - 84 + radarDelta.x / radarDistance * radarOffset),
      radarMarker.y - (84 + radarDelta.y / radarDistance * radarOffset)) < 0.1,
    "the radar plots the NPC at its north-up relative position despite the wall");

    const playerDot = initial.arcs.find(item => item.r === 14);
    assert.ok(playerDot, "the player's rendered dot is available as a camera anchor");
    const camera = {
      x: playerAtStart.x + initial.width / 2 - playerDot.x,
      y: playerAtStart.y + initial.height / 2 - playerDot.y
    };
    const visibleTiles = arena.obstacles.map(obstacle => ({
      x: obstacle.x - camera.x + initial.width / 2,
      y: obstacle.y - camera.y + initial.height / 2,
      w: obstacle.width,
      h: obstacle.height
    })).filter(tile => tile.x + tile.w > 0 && tile.y + tile.h > 0 &&
      tile.x < initial.width && tile.y < initial.height);
    assert.ok(visibleTiles.length > 0);
    for (const tile of visibleTiles) {
      assert.ok(initial.terrain.some(rendered =>
        Math.abs(rendered.x - tile.x) < 0.1 && Math.abs(rendered.y - tile.y) < 0.1 &&
        rendered.w === tile.w && rendered.h === tile.h),
      `rendered collision tile matches map geometry (${JSON.stringify(tile)})`);
    }

    const npcTrace = [npcAtStart.position];
    const npcHealthAtStart = npcAtStart.state.health;
    await fireWhileAiming(alice, () => npcAtStart.position, 800, npcTrace);
    await delay(250);
    let afterBlockedShots = await state(alice);
    // The seeded encounter is farther away; allow collision travel, not lifetime expiry.
    for (let attempt = 0; attempt < 8 &&
      afterBlockedShots.snapshot.entities.some(entity => entity.state.kind === "projectile"); attempt++) {
      await delay(30);
      afterBlockedShots = await state(alice);
    }
    const npcAfterBlockedShots = afterBlockedShots.snapshot.entities
      .find(entity => entity.state.kind === "npc");
    assert.equal(npcAfterBlockedShots.state.health, npcHealthAtStart,
      "shots stop at the obstacle instead of damaging the NPC");
    assert.equal(afterBlockedShots.snapshot.entities
      .filter(entity => entity.state.kind === "projectile").length, 0,
    "blocked projectiles are removed at the same obstacle geometry");

    await observeNpcMovement(alice, 1600, npcTrace);
    const npcAfterNavigation = await state(alice);
    const routedNpc = npcAfterNavigation.snapshot.entities.find(entity => entity.state.kind === "npc");
    assert.ok(routedNpc, "the NPC remains alive while routing");
    assert.ok(Math.hypot(routedNpc.position.x - npcAtStart.position.x,
      routedNpc.position.y - npcAtStart.position.y) > 60,
    "the attracted NPC advances toward the player");
    assert.ok(npcTrace.some(position => Math.abs(position.x - position.y) > 24),
      "the NPC deviates from the blocked diagonal to route around the cluster");
    assert.ok(npcTrace.every(position =>
      arena.obstacles.every(obstacle => !pointHitsObstacle(position, 8, obstacle))),
    "the NPC remains outside every solid collision tile");

    const playerTrace = [playerAtStart];
    await aim(alice, 256, 256);
    await moveAndSample(alice, ["ArrowDown", "ArrowRight"], 900, playerTrace, npcTrace);
    const blockedMove = await state(alice);
    const playerAtBlock = own(blockedMove).position;
    assert.ok(playerAtBlock.x < 384 || playerAtBlock.y < 384,
      "direct movement stops on the original side of the cluster");
    assert.ok(playerTrace.every(position =>
      arena.obstacles.every(obstacle => !pointHitsObstacle(position, 14, obstacle))),
    "the player never walks through a collision tile");

    if (own(blockedMove).position.y > 350) {
      await aim(alice, 0, -140);
      await moveAndSample(alice, "ArrowUp",
        Math.ceil((own(blockedMove).position.y - 340) / 180 * 1000) + 120,
        playerTrace, npcTrace);
    }
    const northRoute = await state(alice);
    assert.ok(own(northRoute).position.y < 370 && own(northRoute).position.x < 384,
      "the player reaches the open route above the cluster");
    await aim(alice, 140, 0);
    await moveAndSample(alice, "ArrowRight",
      Math.ceil((510 - own(northRoute).position.x) / 180 * 1000) + 120,
      playerTrace, npcTrace);
    const aroundCluster = await state(alice);
    const playerAfterRoute = own(aroundCluster).position;
    assert.ok(playerAfterRoute.x > 494 && playerAfterRoute.y < 370,
      "the player can move around the cluster through the open northern route");
    assert.ok(playerTrace.every(position =>
      arena.obstacles.every(obstacle => !pointHitsObstacle(position, 14, obstacle))),
    "movement around the cluster remains collision-safe");

    const npcBeforeOpenShot = aroundCluster.snapshot.entities
      .find(entity => entity.state.kind === "npc");
    assert.ok(npcBeforeOpenShot);
    assert.ok(!segmentHitsObstacles(playerAfterRoute, npcBeforeOpenShot.position,
      arena.obstacles, 3), "the routed position provides an open firing angle");
    await fireWhileAiming(alice, current => {
      const currentPlayer = own(current);
      return current.snapshot.entities.filter(entity => entity.state.kind === "npc")
        .sort((left, right) =>
          Math.hypot(left.position.x - currentPlayer.position.x,
            left.position.y - currentPlayer.position.y) -
          Math.hypot(right.position.x - currentPlayer.position.x,
            right.position.y - currentPlayer.position.y))[0]?.position;
    }, 1400, npcTrace);
    await delay(250);
    const afterOpenShot = await state(alice);
    const npcAfterOpenShot = afterOpenShot.snapshot.entities.find(entity => entity.state.kind === "npc");
    assert.ok(npcAfterOpenShot);
    assert.ok(npcAfterOpenShot.state.health < npcBeforeOpenShot.state.health,
      "a shot from the open angle damages the NPC");
    assert.ok(npcTrace.every(position =>
      arena.obstacles.every(obstacle => !pointHitsObstacle(position, 8, obstacle))),
    "NPC navigation never crosses the map's collision geometry");
    console.log(JSON.stringify({
      browser: version.Browser,
      arena: "Tile Cluster Arena",
      arenaId: "dots-and-squares-tile-arena-v1",
      seedIndependentGeometry: true,
      encounterSeed: 4315,
      playerStart: playerAtStart,
      npcStart: npcAtStart.position,
      blockedShotNpcHealth: npcAfterBlockedShots.state.health,
      blockedMovementStop: playerAtBlock,
      openRoutePosition: playerAfterRoute,
      npcRouteEnd: routedNpc.position,
      openAngleNpcHealth: {
        before: npcBeforeOpenShot.state.health,
        after: npcAfterOpenShot.state.health
      }
    }, null, 2));
  } else {
  await evaluate(observer, `document.querySelector('[name=setting-maxPlayers]').value = '1';
    document.querySelector('[name=setting-initialNpcsPerPlayer]').value = '1';
    document.querySelector('[name=setting-baseNpcHealth]').value = '100000';
    document.querySelector('[name=setting-maxLevels]').value = '1'`);
  await evaluate(observer, `document.querySelector('[name=controlMode][value=keyboard-only]').checked = true;
    document.querySelector('[name=controlMode]').closest('form').requestSubmit()`);
  await waitFor(observer, `(async () =>
    (await (await fetch('/api/v1/me')).json()).account.controlMode === 'keyboard-only')()`);
  await click(observer, "Create session");
  await waitFor(observer, `[...document.querySelectorAll('tbody tr')].some(row =>
    row.children[1]?.textContent === ${JSON.stringify(`Watch_${suffix}`)} &&
    row.children[3]?.children[0]?.textContent === 'Registering')`);
  const soloRow = await evaluate(observer, `(() => {
    const row = [...document.querySelectorAll('tbody tr')].find(row =>
      row.children[1]?.textContent === ${JSON.stringify(`Watch_${suffix}`)});
    return { status: row?.children[3]?.children[0]?.textContent,
      action: row?.children[3]?.children[1]?.textContent };
  })()`);
  assert.equal(soloRow.status, "Registering");
  assert.equal(soloRow.action, "Start Session",
    "host Start Session follows Registering in the room row");
  await clickSessionButton(observer, `Watch_${suffix}`, "Start Session");
  await cdp("Page.bringToFront", {}, observer.session);
  await waitFor(observer, "window.__probe.snapshot !== null");
  await waitFor(observer, "document.querySelector('canvas') !== null");
  await delay(100);
  const soloRenderInfo = await evaluate(observer, `(() => {
    const canvas = document.querySelector('canvas');
    return {draw: canvas?.__draw, status: document.querySelector('#status')?.textContent,
      role: window.__probe.snapshot?.viewerRole, canvasCount: document.querySelectorAll('canvas').length,
      visible: document.visibilityState, focused: document.hasFocus(),
      size: canvas ? {width: canvas.width, height: canvas.height} : null,
      styles: canvas?.getContext('2d')?.fillStyle};
  })()`);
  assert.ok(soloRenderInfo.draw,
    `one-player canvas rendered (${JSON.stringify(soloRenderInfo)})`);
  const soloView = await state(observer);
  assert.equal(soloView.snapshot.players.length, 1, "the repro room has one player");
  const spreadPickup = soloView.snapshot.entities.find(entity =>
    entity.state.kind === "pickup" && entity.state.pickupType === "spread");
  assert.ok(spreadPickup, "one-player room contains the spread pickup");
  assert.ok(soloView.terrain.length > 0,
    `Chrome renders textured square terrain tiles (${JSON.stringify(soloView.fillStyles)})`);
  assert.ok(soloView.fillStyles.includes("#344a60"), "terrain tiles have subtle patterns");
  assert.ok(soloView.strokes.some(stroke => stroke.color === "#3b5168"),
    "terrain tile seams are visible");
  assert.ok(soloView.strokes.some(stroke => stroke.color === "#c0cad3"),
    "solid cluster tiles retain a legible outer outline");
  const pickupFixture = await evaluate(observer, `(async () => {
    const { mountSkinHost } = await import('/src/skin-host.ts');
    const { defaultSkinFactory } = await import('/@id/@multiplayer-game/default-theme');
    const snapshot = structuredClone(window.__probe.snapshot);
    const target = snapshot.players.find(player => player.accountId === snapshot.viewerAccountId);
    const pickup = snapshot.entities.find(entity =>
      entity.state.kind === 'pickup' && entity.state.pickupType === 'spread');
    if (!target || !pickup) throw new Error('One-player spread pickup fixture is incomplete.');
    pickup.position = { x: target.position.x + 48, y: target.position.y };
    const root = document.createElement('div');
    document.body.append(root);
    const mounted = mountSkinHost(root, defaultSkinFactory, {
      target: { accountId: target.accountId, username: 'Fixture' },
      dispatchInput: () => {}, navigate: () => {}, onError: error => { throw error; }
    });
    mounted.handleSnapshot(snapshot, 4);
    await new Promise(resolve => setTimeout(resolve, 100));
    const canvas = root.querySelector('canvas');
    const result = { pickups: canvas.__draw.pickups, arcs: canvas.__draw.arcs };
    mounted.dispose(); root.remove();
    return result;
  })()`);
  assert.ok(pickupFixture.pickups.some(item => item.color === "#ffa64d"),
    `the orange spread pickup is drawn as a distinct diamond, not a player circle: ${
      JSON.stringify(pickupFixture)}`);
  assert.ok(!pickupFixture.arcs.some(item => item.color === "#ffa64d"),
    "the spread pickup is not rendered as an orange circle");
  const soloSessionId = await evaluate(observer, `(async () =>
    (await (await fetch('/api/v1/sessions')).json()).sessions
      .find(session => session.creator === ${JSON.stringify(`Watch_${suffix}`)}).id)()`);
  const soloLeaveStatus = await evaluate(observer, `(async () => (await fetch(
    '/api/v1/sessions/${soloSessionId}/leave',
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }
  )).status)()`);
  assert.equal(soloLeaveStatus, 204, "the one-player repro room is released");
  await cdp("Page.navigate", { url: origin }, observer.session);
  await waitFor(observer, "document.querySelector('[aria-label=\"Active sessions\"]') !== null");

  await evaluate(alice, `document.querySelector('[name=setting-initialNpcsPerPlayer]').value = '1';
    document.querySelector('[name=setting-baseNpcHealth]').value = '100000';
    document.querySelector('[name=setting-maxLevels]').value = '1'`);
  await click(alice, "Create session");
  await waitFor(alice, "document.querySelector('tbody details') !== null");
  const hostRow = await evaluate(alice, `(() => {
    const row = [...document.querySelectorAll('tbody tr')].find(row =>
      row.children[1]?.textContent === ${JSON.stringify(creator)});
    return { status: row?.children[3]?.children[0]?.textContent,
      action: row?.children[3]?.children[1]?.textContent };
  })()`);
  assert.equal(hostRow.status, "Registering");
  assert.equal(hostRow.action, "Start Session",
    "host can start from immediately after the Registering status");
  await click(bob, "Refresh sessions");
  assert.equal(await evaluate(bob, `[...document.querySelectorAll('tbody tr')].find(row =>
    row.children[1]?.textContent === ${JSON.stringify(creator)}).querySelectorAll('button')
      .length`), 2, "non-host sees Join and Spectate but no Start Session");
  await clickSessionButton(bob, creator, "Join");
  await waitFor(bob, "document.querySelector('#status').textContent.startsWith('Joined')");
  await click(alice, "Refresh sessions");
  await clickSessionButton(alice, creator, "Start Session");
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
  await verifyRadarFilters(alice);
  const colorA = startA.colors[own(startA).accountId];
  const colorB = startB.colors[own(startB).accountId];
  assert.notEqual(colorA, colorB, "players in a room have distinct colors");
  assert.notEqual(colorA, "#ed6b61");
  assert.notEqual(colorB, "#ed6b61");
  assert.ok(startA.squares.length > 0 && startA.squares.every(square =>
    square.color === "#ed6b61"), "all NPC squares use the shared NPC color");
  assert.ok(!startA.arcs.some(item => item.color === colorB && item.r === 14), "off-viewport Bob's world avatar is not rendered");
  assert.ok(!startB.arcs.some(item => item.color === colorA && item.r === 14), "off-viewport Alice's world avatar is not rendered");
  await toggleRadarFilter(alice, "enemy", false);
  await cdp("Browser.setWindowBounds", { windowId: aliceWindow.windowId,
    bounds: { width: 800, height: 740 } });
  await delay(300);
  const resized = await state(alice);
  assert.notEqual(resized.width, startA.width);
  centered(resized);
  assert.equal(radarCategoryCounts(resized).enemy, 0, "NPC filtering survives resize");
  assert.equal(await evaluate(alice, "document.querySelector('[name=\"radar-enemy\"]').checked"), false);
  await toggleRadarFilter(alice, "enemy", true);
  assert.equal(resized.pixelWidth, Math.round(resized.width * await evaluate(alice, "devicePixelRatio")));
  assert.equal(resized.status, "");
  const beforeAim = own(resized);
  await aim(alice, 0, -70);
  const aimedWhileStill = await state(alice);
  assert.deepEqual(own(aimedWhileStill).position, beforeAim.position,
    "mouse aim does not move a standing player");
  assert.notDeepEqual(own(aimedWhileStill).facing, beforeAim.facing,
    "mouse aim updates facing while the player stands still");
  centered(aimedWhileStill);
  await aim(alice, 80, 0);
  const aimedRight = own(await state(alice));
  assert.ok(aimedRight.facing.x > 0.99 && Math.abs(aimedRight.facing.y) < 0.01,
    "mouse aim can restore screen-right facing for movement tests");
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

  const alicePositionBeforeWASD = own(await state(alice)).position;
  await move(alice, "KeyD", 300);
  assert.deepEqual(own(await state(alice)).position, alicePositionBeforeWASD,
    "keyboard + mouse mode ignores WASD");
  const alicePositionBeforeForward = own(await state(alice)).position;
  assert.deepEqual(own(startA).facing, { x: 1, y: 0 }, "Alice starts facing screen-right");
  await move(alice, "ArrowUp", 450);
  const aliceForward = await state(alice);
  assert.ok(own(aliceForward).position.y < alicePositionBeforeForward.y - 30,
    "keyboard + mouse Up moves screen-up");
  assert.ok(Math.abs(own(aliceForward).position.x - alicePositionBeforeForward.x) < 3,
    "keyboard + mouse Up does not move sideways");
  assert.ok(aliceForward.actions.some(input => input.payload.action.moveY < -0.99 &&
    Math.abs(input.payload.action.moveX) < 0.01),
  "keyboard + mouse input uses screen directions");
  await moveKeys(alice, ["ArrowUp", "ArrowRight"], 350);
  const diagonalA = await state(alice);
  const diagonalMouseInput = diagonalA.actions.find(input => input.payload.action.moveX !== 0 &&
    input.payload.action.moveY !== 0);
  assert.ok(diagonalMouseInput, "keyboard + mouse diagonal movement is sent");
  assert.ok(Math.abs(Math.hypot(diagonalMouseInput.payload.action.moveX,
    diagonalMouseInput.payload.action.moveY) - 1) < 0.01,
  "keyboard + mouse diagonal movement remains normalized");
  const beforeStrafe = own(diagonalA).position;
  await move(alice, "ArrowRight", 450);
  const strafedA = await state(alice);
  assert.ok(own(strafedA).position.x > beforeStrafe.x + 30,
    "keyboard + mouse Right moves screen-right");
  centered(strafedA);

  await click(observer, "Refresh sessions");
  await clickSessionButton(observer, creator, "Spectate");
  await waitFor(observer, "document.querySelector('[aria-label=\"Followable players\"]') !== null");
  await click(observer, `Follow ${bobName}`);
  await waitFor(observer, "window.__probe.snapshot?.viewerRole === 'spectator'");
  await delay(200);
  const spectatorA = await state(observer);
  const bobAtSpectate = await state(bob);
  assert.equal(spectatorA.snapshot.viewerAccountId, bobAtSpectate.snapshot.viewerAccountId);
  assert.deepEqual(spectatorA.snapshot.radar.markers.map(item => item.id),
    bobAtSpectate.snapshot.radar.markers.map(item => item.id),
    "the spectator radar follows the selected player's module view");
  const spectatorPeerB = spectatorA.snapshot.players.find(
    player => player.accountId === own(bobAtSpectate).accountId);
  assert.equal(spectatorPeerB.color, own(bobAtSpectate).color,
    "spectator snapshots preserve the player's color");
  assert.deepEqual(spectatorPeerB.facing, own(bobAtSpectate).facing,
    "spectator snapshots preserve the player's facing");
  assert.deepEqual(spectatorA.snapshot.spectatorView.cameraAnchor, own(spectatorA).position);
  centered(spectatorA);
  await verifyRadarFilters(observer);
  await toggleRadarFilter(observer, "enemy", false);
  assert.ok(radarCategoryCounts(await state(bob)).enemy > 0,
    "the spectator's NPC filter does not alter the followed player's display");
  assert.equal(await evaluate(bob, "document.querySelector('[name=\"radar-enemy\"]').checked"), true);
  const observerWindow = await cdp("Browser.getWindowForTarget", { targetId: observer.target });
  await cdp("Browser.setWindowBounds", { windowId: observerWindow.windowId,
    bounds: { width: 860, height: 780 } });
  await delay(200);
  const spectatorResized = await state(observer);
  centered(spectatorResized);
  assert.equal(radarCategoryCounts(spectatorResized).enemy, 0);
  assert.equal(spectatorResized.snapshot.viewerAccountId, bobAtSpectate.snapshot.viewerAccountId);
  await toggleRadarFilter(observer, "enemy", true);
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
      target: {accountId:snapshot.viewerAccountId, username:${JSON.stringify(bobName)}},
      dispatchInput: () => inputs++, navigate: () => {}, onError: error => {throw error;}
    });
    const target = snapshot.players.find(player => player.accountId === snapshot.viewerAccountId);
    const playerEntity = snapshot.entities.find(entity => entity.state.accountId === target.accountId);
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
    snapshot.spectatorView.hud.health = snapshot.playerMaxHealth ?? 100;
    snapshot.spectatorView.cameraAnchor = {x:800,y:600};
    target.alive = true; target.health = snapshot.playerMaxHealth ?? 100; target.position = {x:800,y:600};
    if (!playerEntity || !target.color || !target.facing) throw new Error('Respawn fixture lacks player presentation data.');
    snapshot.entities.push({...playerEntity, position: target.position});
    mounted.handleSnapshot(snapshot,4);
    await new Promise(resolve => setTimeout(resolve,100));
    const returned = root.querySelector('.default-health').textContent;
    const camera = mounted.host.cameraAnchor;
    const canvas = root.querySelector('canvas');
    const colorContext = document.createElement('canvas').getContext('2d');
    colorContext.fillStyle = target.color;
    const playerColor = colorContext.fillStyle;
    const body = canvas.__draw.arcs.find(item => item.r === 14 && item.color === playerColor);
    const facing = canvas.__draw.arcs.find(item => item.r === 3 && item.color === playerColor &&
      Math.abs(item.x - (body?.x + target.facing.x * 16)) < 0.1 &&
      Math.abs(item.y - (body?.y + target.facing.y * 16)) < 0.1);
    mounted.dispose(); root.remove();
    return {countdown,health,returned,camera,inputs,sharedRespawnColor: Boolean(body && facing)};
  })()`);
  assert.deepEqual(spectatorFixture, {countdown:"Respawning in 5s",health:"Health: 0 / 200",
    returned:"Health: 200 / 200",camera:{x:800,y:600},inputs:0,sharedRespawnColor:true});

  assert.deepEqual(own(startB).facing, { x: 1, y: 0 }, "Bob starts facing screen-right");
  await move(bob, "KeyW", 1400);
  let movedB = await state(bob);
  assert.ok(own(movedB).position.y < own(startB).position.y - 100,
    "keyboard-only W moves screen-up");
  assert.ok(Math.abs(own(movedB).position.x - own(startB).position.x) < 3,
    "keyboard-only W does not move sideways");
  assert.ok(movedB.actions.some(input => input.payload.action.moveY < -0.99 &&
    Math.abs(input.payload.action.moveX) < 0.01), "keyboard-only input uses screen directions");
  await moveKeys(bob, ["KeyW", "KeyD"], 350);
  movedB = await state(bob);
  const diagonal = movedB.actions.find(input => input.payload.action.moveX !== 0 &&
    input.payload.action.moveY !== 0);
  assert.ok(diagonal, "keyboard-only diagonal movement is sent");
  assert.ok(Math.abs(Math.hypot(diagonal.payload.action.moveX, diagonal.payload.action.moveY) - 1) < 0.01,
    "keyboard-only diagonal movement remains normalized");
  const stationaryA = await state(alice);
  assert.ok(own(movedB).position.y < own(startB).position.y - 100,
    "Bob moves using his keyboard intent");
  const bobFacingBefore = own(movedB).facing;
  const bobPositionBeforeTurn = own(movedB).position;
  await move(bob, "ArrowRight", 450);
  const bobTurnedRight = await state(bob);
  assert.deepEqual(own(bobTurnedRight).position, bobPositionBeforeTurn,
    "keyboard-only right arrow turns in place");
  assert.notDeepEqual(own(bobTurnedRight).facing, bobFacingBefore,
    "keyboard-only right arrow changes facing");
  await move(bob, "ArrowLeft", 300);
  const bobTurnedLeft = await state(bob);
  assert.notDeepEqual(own(bobTurnedLeft).facing, own(bobTurnedRight).facing,
    "keyboard-only left arrow changes facing in the opposite direction");
  await move(bob, "Space", 250);
  assert.ok((await state(bob)).actions.some(input => input.payload.action.fire),
    "keyboard-only Space sends firing intent");

  const alicePositionBeforeBob = own(await state(alice)).position;
  for (let attempt = 0; attempt < 8; attempt++) {
    const alicePosition = own(await state(alice)).position;
    const bobPosition = own(await state(bob)).position;
    const dx = alicePosition.x - bobPosition.x;
    const dy = alicePosition.y - bobPosition.y;
    if (Math.hypot(dx, dy) < 280) break;
    const keys = [];
    if (Math.abs(dx) > 30) keys.push(dx > 0 ? "KeyD" : "KeyA");
    if (Math.abs(dy) > 30) keys.push(dy > 0 ? "KeyS" : "KeyW");
    await moveKeys(bob, keys, 450);
  }
  const bobNearby = await state(bob);
  assert.ok(Math.hypot(
    own(bobNearby).position.x - own(await state(alice)).position.x,
    own(bobNearby).position.y - own(await state(alice)).position.y
  ) < 300, "keyboard-only movement can approach another player");

  const movedA = await state(alice);
  const stoppedB = await state(bob);
  assert.ok(own(movedA).position.x > own(startA).position.x + 30, "Alice moves independently");
  assert.deepEqual(own(stationaryA).position, alicePositionBeforeBob, "Bob cannot move Alice");
  assert.deepEqual(own(stoppedB).position, own(bobNearby).position, "Alice cannot move Bob");
  centered(stoppedB);
  const peerA = movedA.snapshot.players.find(p => p.accountId === stoppedB.snapshot.viewerAccountId);
  assert.deepEqual(peerA.position, own(stoppedB).position, "shared authoritative nearby position");
  assert.equal(peerA.color, own(stoppedB).color, "player color is consistent across views");
  assert.deepEqual(peerA.facing, own(stoppedB).facing, "player facing is consistent across views");
  const inputs = [...movedA.actions, ...stoppedB.actions];
  assert.ok(inputs.length > 0);
  for (const input of inputs) {
    assert.equal(input.v, 1);
    assert.equal(input.type, "client.input");
    assert.equal(input.payload.action.type, "combat");
    assert.deepEqual(Object.keys(input.payload.action).sort(),
      ["aimX", "aimY", "fire", "moveX", "moveY", "type"]);
  }
  const fixtureChecks = await evaluate(bob, `(async () => {
    const { mountSkinHost } = await import('/src/skin-host.ts');
    const { defaultSkinFactory } = await import('/@id/@multiplayer-game/default-theme');
    const fixture = structuredClone(window.__probe.snapshot);
    const root = document.createElement('div');
    document.body.append(root);
    const actions = [];
    const errors = [];
    const target = fixture.players.find(p => p.accountId === fixture.viewerAccountId);
    const colorContext = document.createElement('canvas').getContext('2d');
    colorContext.fillStyle = target.color;
    const targetColor = colorContext.fillStyle;
    const mounted = mountSkinHost(root, defaultSkinFactory, {
      target: { accountId: target.accountId, username: 'Fixture' },
      controlMode: 'keyboard-only',
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
    const dot = canvas.__draw.arcs.find(item => item.color === targetColor && item.r === 14);
    const moved = actions.some(action =>
      Math.abs(action.moveX - 1) < 0.02 && Math.abs(action.moveY) < 0.02);
    const cameraOwn = Math.abs(mounted.host.cameraAnchor.x - target.position.x) < 0.1;
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
  const radarClip = await evaluate(bob, `(async () => {
    const { drawRadar } = await import('/@id/@multiplayer-game/theme-sdk');
    const canvas = document.createElement('canvas');
    canvas.width = 180; canvas.height = 180;
    const context = canvas.getContext('2d');
    context.fillStyle = '#123456';
    context.fillRect(0,0,180,180);
    drawRadar(context, {categories:['geometry'],markers:[
      {id:'wall',category:'geometry',position:{x:100,y:0},footprint:{width:120,height:60}}
    ]}, {x:80,y:80,radius:60,range:100,center:{x:0,y:0},
      markerColors:{geometry:'#344a60'},markerShapes:{geometry:'footprint'}});
    const pixel = (x,y) => [...context.getImageData(x,y,1,1).data];
    return {inside:pixel(130,85),outside:pixel(150,85)};
  })()`);
  assert.deepEqual(radarClip.inside, [52,74,96,255], "collision footprint fills the circle interior");
  assert.deepEqual(radarClip.outside, [18,52,86,255], "terrain is clipped at the actual circular Canvas boundary");
  await click(observer, "Back to Players");
  await waitFor(observer, "document.querySelector('[aria-label=\"Followable players\"]') !== null");
  await click(observer, `Follow ${bobName}`);
  await waitFor(observer, `window.__probe.snapshot?.viewerAccountId === ${JSON.stringify((await state(bob)).snapshot.viewerAccountId)}`);
  await delay(100);
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
  await waitFor(bob, "document.querySelector('[aria-label=\"Active sessions\"]') !== null");
  await evaluate(bob, `document.querySelector('[name=controlMode][value=keyboard-mouse]').checked = true;
    document.querySelector('[name=controlMode]').closest('form').requestSubmit()`);
  await waitFor(bob, "document.querySelector('#status').textContent === 'Controls updated.'");
  assert.equal(await evaluate(bob, `(async () =>
    (await (await fetch('/api/v1/me')).json()).account.controlMode)()`),
  "keyboard-mouse", "keyboard-only account can change to mouse controls in the lobby");
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
  await clickSessionButton(alice, creator, "Start Session");
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
    let sessions = (await (await fetch('/api/v1/sessions')).json()).sessions;
    if (sessions.length > 5) throw new Error('Session count exceeds configured capacity.');
    for (let i=sessions.length;i<5;i++) {
      const response = await fetch('/api/v1/sessions', {method:'POST',
        headers:{'content-type':'application/json'}, body:JSON.stringify({settings,requestId:crypto.randomUUID()})});
      if (!response.ok) throw new Error('Unable to reserve test capacity: '+response.status);
      sessions = (await (await fetch('/api/v1/sessions')).json()).sessions;
    }
    const overflow = await fetch('/api/v1/sessions',{method:'POST',
      headers:{'content-type':'application/json'},body:JSON.stringify({settings})});
    return {count:sessions.length,overflow:overflow.status,code:(await overflow.json()).error.code};
  })()`);
  assert.deepEqual(capacityBefore, { count: 5, overflow: 409, code: "SESSION_CAPACITY" });
  await aim(alice, 256, 256);
  await moveKeys(alice, ["ArrowDown", "ArrowRight"], 850);
  const approach = own(await state(alice)).position;
  if (approach.y > 350) {
    await aim(alice, 0, -140);
    await move(alice, "ArrowUp", Math.ceil((approach.y - 340) / 180 * 1000) + 120);
  }
  const northRoute = own(await state(alice)).position;
  await aim(alice, 140, 0);
  await move(alice, "ArrowRight", Math.ceil((510 - northRoute.x) / 180 * 1000) + 120);
  await shootUntil(alice, 1, 1);
  const bobStart = own(await state(bob)).position;
  await aim(bob, 140, 0);
  await move(bob, "ArrowRight", Math.ceil((780 - bobStart.x) / 180 * 1000) + 120);
  const bobEast = own(await state(bob)).position;
  await aim(bob, 0, 140);
  await move(bob, "ArrowDown", Math.ceil((1100 - bobEast.y) / 180 * 1000) + 120);
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
  await reloadStandings(bob);
  assert.equal(await evaluate(bob, "document.querySelector('[aria-label=\"Final standings\"]').textContent"), standings);
  await reloadStandings(alice);
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
      username: ${JSON.stringify(creator)}, role: 'player', controlMode: 'keyboard-mouse'
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
    legacyAccountPromptAndReloginPersistence: true,
    signupControlModePersistenceAndLobbyChanges: true,
    keyboardOnlyWASDArrowsAndSpace: true,
    keyboardMouseArrowsAimAndClick: true,
    distinctPlayerColorsAndSpectatorFacing: true,
    stationaryMouseAimFacingDot: true,
    spectatorJoinSwitchLeave: true, spectatorTargetUnavailable: true,
    spectatorNoGameplayInput: true, spectatorSavedStandings: true,
    spectatorDeathRespawnFixture: true,
    independentMovement: true, nearbyVisibility: true, centeredCameras: true,
    actionEnvelope: true, mouseFireAndRelease: true, pointsAndHealth: true, viewportResize: true,
    fourIndependentRadarFilters: true, assignedPlayerRadarColors: true,
    spectatorLocalRadarFiltersAndResize: true, radarTerrainCircularClipping: true,
    fixtureShapesAndDeathHud: true, skinDisposalAndCompatibility: true, boundedOutgoingControls: true,
    savedResultHandoff: true, resultReloadAndPageRefresh: true,
    resultTableAndDisposal: true, missingResultRetry: true, backToLobby: true,
    failedConnectionLobbyNavigation: true,
    twoPlayerTwoLevelCompletion: true, sharedStandingsAfterBothRefreshes: true,
    fullCapacitySlotRelease: true, matchId, finalStandings: tableRows
  }, null, 2));
  }
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
