import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { seedWaitingRoom } from "./npc-spawns.mjs";
import { BoundedNavigation, WorldGeometry } from "@multiplayer-game/engine";

export async function verifyNpcRanged({
  playerPage, creator, cdp, evaluate, waitFor, click, clickSessionButton,
  state, delay, browser, origin
}) {
  const directory = process.env.BROWSER_TEST_ARTIFACT_DIR;
  assert.ok(directory, "supply an artifact directory");
  mkdirSync(directory, { recursive: true });
  const { windowId } = await cdp("Browser.getWindowForTarget", { targetId: playerPage.target });
  await cdp("Browser.setWindowBounds", { windowId,
    bounds: { width: 1440, height: 900, windowState: "normal" } });
  await evaluate(playerPage, `(() => {
    window.__rangedTrace = [];
    window.__npcPaint = [];
    const Native = window.WebSocket;
    window.WebSocket = class extends Native {
      constructor(...args) {
        super(...args);
        this.addEventListener('message', event => {
          const message = JSON.parse(event.data);
          if (message.type === 'server.snapshot') {
            window.__rangedTrace.push({ at: performance.now(), snapshot: message.payload });
          }
        });
      }
    };
    const rect = CanvasRenderingContext2D.prototype.fillRect;
    CanvasRenderingContext2D.prototype.fillRect = function(x,y,w,h) {
      if (this.fillStyle === '#101824') window.__npcPaint = [];
      if (this.fillStyle === '#ed6b61' || this.fillStyle === '#ffb5ad') {
        const m = this.getTransform();
        window.__npcPaint.push({
          color:this.fillStyle, x:(m.a*(x+w/2)+m.c*(y+h/2)+m.e)/devicePixelRatio,
          y:(m.b*(x+w/2)+m.d*(y+h/2)+m.f)/devicePixelRatio,
          w,h, angle:Math.atan2(m.b,m.a)
        });
      }
      return rect.call(this,x,y,w,h);
    };
  })()`);
  // Only select Fixed; retain every gameplay default and ordinary wave placement.
  await evaluate(playerPage, `document.querySelector('[name=setting-mapMode]').value='fixed';
    document.querySelector('[name=setting-mapMode]').dispatchEvent(new Event('change'))`);
  await click(playerPage, "Create session");
  const sessionId = await seedWaitingRoom({ alice: playerPage, creator, evaluate, origin }, 42);
  const settings = await evaluate(playerPage, `(async () =>
    (await (await fetch('/api/v1/sessions/${sessionId}')).json()).settings)()`);
  assert.equal(settings.npcMovementSpeed, 67.5);
  assert.equal(settings.npcDetectionRange, 512);
  assert.equal(settings.initialNpcsPerPlayer, 10);
  assert.equal(settings.baseNpcHealth, 50);
  assert.equal(settings.noKillTimeoutSeconds, 60);
  await clickSessionButton(playerPage, creator, "Start Session");
  await cdp("Page.bringToFront", {}, playerPage.session);
  await waitFor(playerPage, "window.__probe.firstActiveSnapshot && document.querySelector('canvas')");
  const screenshots = [];
  const viewport = await evaluate(playerPage, `({
    innerWidth,innerHeight,outerWidth,outerHeight,devicePixelRatio,
    canvas: {width:document.querySelector('canvas').getBoundingClientRect().width,
      height:document.querySelector('canvas').getBoundingClientRect().height}
  })`);
  const capture = async name => {
    const image = await cdp("Page.captureScreenshot", { format: "png" }, playerPage.session);
    const path = join(directory, `${name}.png`);
    writeFileSync(path, Buffer.from(image.data, "base64"));
    screenshots.push(path);
  };
  const visible = (npc, view) => {
    const player = view.snapshot.players.find(p => p.accountId === view.snapshot.viewerAccountId);
    const x = npc.position.x - player.position.x + view.width / 2;
    const y = npc.position.y - player.position.y + view.height / 2;
    return x > 16 && x < view.width - 16 && y > 16 && y < view.height - 16;
  };
  let firstVisible, firstFire, turn, visibleInterior, sameNpcFired;
  let previous;
  const started = Date.now();
  while (Date.now() - started < 30_000) {
    const view = await state(playerPage);
    const npcs = view.snapshot.entities.filter(e => e.state.kind === "npc");
    const shots = view.snapshot.entities.filter(e => e.typeId === "projectile.npc");
    const interior = npcs.find(npc => !npc.state.targetId && visible(npc, view) &&
      Math.min(npc.position.x, npc.position.y, 2048-npc.position.x, 2048-npc.position.y) >= 512);
    if (!visibleInterior && interior) {
      visibleInterior = { tick:view.snapshot.tick, npc:interior,
        paint:await evaluate(playerPage,"window.__npcPaint") };
      await capture("visible-interior-explore");
    }
    if (!firstVisible && npcs.some(npc => visible(npc, view))) {
      firstVisible = { tick: view.snapshot.tick, paint: await evaluate(playerPage, "window.__npcPaint") };
      await capture("first-visible-interior-roaming");
    }
    if (!firstFire && shots.some(shot => visible(shot, view))) {
      firstFire = { tick: view.snapshot.tick, shots,
        paint: await evaluate(playerPage, "window.__npcPaint") };
      await capture("npc-firing-square-projectile");
    }
    if (previous && !turn) {
      for (const npc of npcs.filter(npc => visible(npc, view))) {
        const old = previous.entities.find(e => e.id === npc.id);
        if (old?.state.facing && npc.state.facing &&
          Math.hypot(npc.position.x-old.position.x,npc.position.y-old.position.y) < 0.001 &&
          Math.hypot(npc.state.facing.x-old.state.facing.x,
            npc.state.facing.y-old.state.facing.y) > 0.05) {
          turn = { id: npc.id, before: old, after: npc, tick: view.snapshot.tick };
          await capture("npc-rotating-in-place");
          break;
        }
      }
    }
    if (turn && !sameNpcFired) {
      const shot = shots.find(shot => shot.state.ownerNpcId === turn.id && visible(shot, view));
      if (shot) {
        sameNpcFired = { tick:view.snapshot.tick, shot };
        await capture("same-npc-firing-after-turn");
      }
    }
    previous = view.snapshot;
    await delay(40);
  }
  await capture("ordinary-match-30-seconds");
  const idleEndedAt = Date.now();
  // Walk using real keyboard events and ordinary navigation, never entity staging.
  const navigationView = await state(playerPage);
  const nav = new BoundedNavigation(new WorldGeometry(
    { width:2048, height:2048 }, navigationView.snapshot.map.obstacles
  ), { cellSize:32, agentRadius:14, maxNodesPerSearch:4096 });
  const keys = new Map([
    ["ArrowLeft", { key:"ArrowLeft",code:"ArrowLeft",windowsVirtualKeyCode:37 }],
    ["ArrowUp", { key:"ArrowUp",code:"ArrowUp",windowsVirtualKeyCode:38 }],
    ["ArrowRight", { key:"ArrowRight",code:"ArrowRight",windowsVirtualKeyCode:39 }],
    ["ArrowDown", { key:"ArrowDown",code:"ArrowDown",windowsVirtualKeyCode:40 }]
  ]);
  const held = new Set();
  const setKeys = async wanted => {
    for (const [name, params] of keys) {
      if (held.has(name) === wanted.includes(name)) continue;
      await cdp("Input.dispatchKeyEvent", {
        type:wanted.includes(name) ? "keyDown" : "keyUp", ...params
      }, playerPage.session);
      if (wanted.includes(name)) held.add(name);
      else held.delete(name);
    }
  };
  let contact;
  const contactStarted = Date.now();
  try {
    while (Date.now() - contactStarted < 20_000 && !contact) {
      const view = await state(playerPage);
      const player = view.snapshot.players.find(p => p.accountId === view.snapshot.viewerAccountId);
      if (!player.alive) { await setKeys([]); await delay(100); continue; }
      const enemies = view.snapshot.entities.filter(e => e.state.kind === "npc")
        .sort((a,b) => Number(Boolean(b.state.targetId))-Number(Boolean(a.state.targetId)) ||
          Math.hypot(a.position.x-player.position.x,a.position.y-player.position.y) -
          Math.hypot(b.position.x-player.position.x,b.position.y-player.position.y));
      const enemy = enemies[0];
      if (!enemy) break;
      const range = Math.hypot(enemy.position.x-player.position.x,enemy.position.y-player.position.y);
      if (range <= 22) {
        await setKeys([]);
        const tick = view.snapshot.tick;
        const health = player.health;
        await delay(75);
        const after = await state(playerPage);
        const nextPlayer = after.snapshot.players.find(p => p.accountId === player.accountId);
        contact = { npcId:enemy.id, tick, nextTick:after.snapshot.tick,
          distance:range, healthBefore:health, healthAfter:nextPlayer.health };
        await capture("ordinary-keyboard-contact-no-damage");
        break;
      }
      let result;
      nav.requestPath(player.position, enemy.position, path => { result=path; });
      for (let i=0;i<8 && !result;i++) nav.processTick();
      const point = result?.status === "found"
        ? result.path.find(p => Math.hypot(p.x-player.position.x,p.y-player.position.y) > 12)
          ?? enemy.position
        : enemy.position;
      const dx=point.x-player.position.x, dy=point.y-player.position.y;
      await setKeys([
        ...(Math.abs(dx)>6 ? [dx>0 ? "ArrowRight":"ArrowLeft"]:[]),
        ...(Math.abs(dy)>6 ? [dy>0 ? "ArrowDown":"ArrowUp"]:[])
      ]);
      await delay(60);
    }
  } finally { await setKeys([]); }
  const trace = await evaluate(playerPage, "window.__rangedTrace");
  const active = trace.filter(row => row.snapshot.phase === "active");
  assert.ok(active.length > 200);
  const first = active[0].snapshot;
  let firstEncounterTick, maxEngaged = 0, interiorRoaming = 0;
  const speedWindows = [];
  for (let i = 0; i < active.length; i++) {
    const snapshot = active[i].snapshot;
    const npcs = snapshot.entities.filter(e => e.state.kind === "npc");
    const count = npcs.filter(e => Boolean(e.state.targetId)).length;
    maxEngaged = Math.max(maxEngaged, count);
    if (count && firstEncounterTick === undefined) firstEncounterTick = snapshot.tick;
    interiorRoaming += npcs.filter(e => !e.state.targetId &&
      Math.min(e.position.x,e.position.y,2048-e.position.x,2048-e.position.y) >= 512).length;
    const end = active.findIndex((row, j) => j > i && row.snapshot.tick === snapshot.tick + 30);
    if (end < 0) continue;
    for (const npc of npcs.filter(npc => !npc.state.targetId)) {
      let travel = 0;
      let last = npc;
      let eligible = true;
      for (let j = i + 1; j <= end; j++) {
        const next = active[j].snapshot.entities.find(e => e.id === npc.id);
        if (!next || next.state.targetId) { eligible = false; break; }
        travel += Math.hypot(next.position.x-last.position.x,next.position.y-last.position.y);
        last = next;
      }
      if (eligible && Math.abs(travel - 33.75) < 1e-6) {
        speedWindows.push({ id:npc.id, startTick:snapshot.tick,
          endTick:active[end].snapshot.tick, seconds:1, travel });
      }
    }
  }
  const report = {
    browser, requestedWindow: { width:1440, height:900 }, viewport, sessionId, seed:42, settings,
    stagedEntities:false, snapshots:active.length, ticks:[first.tick,active.at(-1).snapshot.tick],
    idleWallSeconds:(idleEndedAt-started)/1000,
    firstEncounterSeconds:firstEncounterTick === undefined ? null : firstEncounterTick/30,
    noKillTimeoutSeconds:60, maxEngaged, interiorRoamingSamples:interiorRoaming,
    measuredClearSpeed:speedWindows[0] ?? null, firstVisible, firstFire, turn, visibleInterior, sameNpcFired,
    browserContact:contact ?? "untested: keyboard approach did not reach contact within 20 seconds",
    screenshots
  };
  writeFileSync(join(directory, "report.json"), JSON.stringify(report,null,2));
  writeFileSync(join(directory, "trace.json"), JSON.stringify(trace));
  const colors=["#e6194b","#3cb44b","#4363d8","#f58231","#911eb4","#42d4f4"];
  const firstNpcs=first.entities.filter(e=>e.state.kind==="npc");
  const routes=firstNpcs.map((npc,index)=>{
    const points=active.map(row=>row.snapshot.entities.find(e=>e.id===npc.id)?.position)
      .filter(Boolean).map(p=>`${p.x},${p.y}`).join(" ");
    return `<polyline points="${points}" fill="none" stroke="${colors[index%colors.length]}" stroke-width="4"/>`;
  }).join("");
  const obstacles=first.map.obstacles.map(r=>
    `<rect x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" fill="#bbb"/>`).join("");
  writeFileSync(join(directory,"ordinary-track-map.svg"),
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2048 2048"><rect width="2048" height="2048" fill="white"/>${obstacles}<rect x="512" y="512" width="1024" height="1024" fill="none" stroke="#222" stroke-dasharray="16"/>${routes}</svg>`);
  console.log(JSON.stringify(report,null,2));
  assert.ok(firstEncounterTick < 1800, "encounter before the 60-second timeout");
  assert.equal(maxEngaged, 2);
  assert.ok(interiorRoaming > 0);
  assert.ok(visibleInterior, "an exploring interior NPC is visible on the world canvas");
  assert.ok(speedWindows.length > 0, "actual snapshots measure 33.75 units across 30 ticks");
  assert.ok(firstVisible && firstFire && turn, "visible roaming, turning and firing");
  assert.ok(sameNpcFired, "the observed rotating NPC also fires on screen");
  assert.ok(firstFire.paint.some(item => item.color === "#ffb5ad" && item.w === 6 && item.h === 6));
  if (contact) assert.equal(contact.healthAfter,contact.healthBefore,"contact causes no damage");
}
