import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BLUE = "#4db8ff";
const RADAR = { inset: 84, radius: 72 };

// Records every bright-blue radar arc together with alpha and the active circular clip.
const recorder = `(() => {
  if (window.__healthRec) return;
  const rec = window.__healthRec = { frames: [], current: null, recording: false };
  const proto = CanvasRenderingContext2D.prototype;
  const wrap = (name, before) => {
    const native = proto[name];
    proto[name] = function(...args) { before.apply(this, args); return native.apply(this, args); };
  };
  wrap('fillRect', function() {
    if (this.fillStyle !== '#101824' || !rec.recording) return;
    rec.current = { blue: [], clips: [], legacy: 0, width: this.canvas.getBoundingClientRect().width };
    rec.frames.push(rec.current);
  });
  wrap('save', function() { (this.__clipStack ??= []).push(this.__clip ?? null); });
  wrap('restore', function() { this.__clip = (this.__clipStack ??= []).pop() ?? null; });
  wrap('beginPath', function() { this.__arcs = []; });
  wrap('arc', function(x, y, r) { (this.__arcs ??= []).push({ x, y, r }); });
  wrap('clip', function() {
    const arc = this.__arcs?.at(-1);
    this.__clip = arc ? { ...arc } : { path: true };
    rec.current?.clips.push(this.__clip);
  });
  for (const mode of ['fill', 'stroke']) {
    wrap(mode, function() {
      if (!rec.current) return;
      const color = mode === 'fill' ? this.fillStyle : this.strokeStyle;
      if (color === '#0088ff') rec.current.legacy += 1;
      const arc = this.__arcs?.at(-1);
      if (color !== '${BLUE}' || !arc) return;
      rec.current.blue.push({ mode, ...arc, alpha: this.globalAlpha, clip: this.__clip });
    });
  }
})()`;

async function record(page, evaluate, delay, ms) {
  await evaluate(page, recorder);
  await evaluate(page, "window.__healthRec.frames = []; window.__healthRec.recording = true");
  await delay(ms);
  return evaluate(page, `(() => {
    const rec = window.__healthRec;
    rec.recording = false; rec.current = null;
    const markers = window.__probe.snapshot.radar.markers;
    const health = new Set(window.__probe.snapshot.entities.filter(entity =>
      entity.state.kind === 'pickup' && entity.state.pickupType === 'health').map(entity => entity.id));
    return { frames: rec.frames.filter(frame => frame.blue.length > 0 || frame.clips.length > 0),
      healthMarkers: markers.filter(marker => health.has(marker.id)).length,
      role: window.__probe.snapshot.viewerRole };
  })()`);
}

function analyse(label, capture, expected, reduced) {
  const { frames } = capture;
  assert.ok(frames.length >= 20, `${label}: Chrome rendered radar frames (${frames.length})`);
  assert.equal(capture.healthMarkers, expected, `${label}: radar receives every health pack`);
  const ringRadii = new Set();
  const alphas = [];
  for (const frame of frames) {
    const center = { x: frame.width - RADAR.inset, y: RADAR.inset, r: RADAR.radius };
    const inside = frame.blue.filter(item => Math.hypot(item.x - center.x, item.y - center.y) <= center.r + 0.01);
    assert.equal(inside.length, frame.blue.length, `${label}: blue markers stay on the radar`);
    for (const item of frame.blue) {
      assert.deepEqual(item.clip, center, `${label}: every blue draw is clipped to the radar circle`);
    }
    const centers = frame.blue.filter(item => item.mode === "fill" && item.r === 4 && item.alpha === 1);
    assert.equal(centers.length, expected, `${label}: one opaque center dot per pack in every frame`);
    assert.equal(frame.legacy, 0, `${label}: legacy #0088ff marker is gone`);
    if (reduced) {
      const halos = frame.blue.filter(item => Math.abs(item.r - 10) < 1e-6);
      assert.equal(halos.filter(item => item.mode === "fill" && Math.abs(item.alpha - 0.3) < 1e-6).length,
        expected, `${label}: static halo fill`);
      assert.equal(halos.filter(item => item.mode === "stroke" && Math.abs(item.alpha - 0.8) < 1e-6).length,
        expected, `${label}: static halo outline`);
      assert.equal(frame.blue.length, expected * 3, `${label}: no animated ring under reduced motion`);
    } else {
      const rings = frame.blue.filter(item => item.mode === "stroke");
      assert.equal(rings.length, expected, `${label}: one pulse ring per pack`);
      for (const ring of rings) {
        assert.ok(ring.r >= 4 && ring.r <= 14, `${label}: ring radius ${ring.r} within 4-14`);
        assert.ok(Math.abs(ring.alpha - (1 - (ring.r - 4) / 10)) < 1e-3,
          `${label}: ring fades as it expands (r ${ring.r}, alpha ${ring.alpha})`);
        ringRadii.add(Math.round(ring.r * 10) / 10);
        alphas.push(ring.alpha);
      }
    }
  }
  if (!reduced) {
    const radii = [...ringRadii];
    assert.ok(radii.length >= 8, `${label}: ring radius animates (${radii.length} distinct)`);
    assert.ok(Math.min(...radii) < 6.5 && Math.max(...radii) > 11.5,
      `${label}: ring expands across the pulse (${Math.min(...radii)}-${Math.max(...radii)})`);
  }
  return {
    frames: frames.length, centersPerFrame: expected,
    ringRadius: reduced ? null : { min: Math.min(...ringRadii), max: Math.max(...ringRadii),
      distinct: ringRadii.size },
    ringAlpha: reduced ? null : { min: Math.min(...alphas), max: Math.max(...alphas) },
    halo: reduced ? { radius: 10, fillAlpha: 0.3, strokeAlpha: 0.8 } : null
  };
}

export async function verifyHealthRadarMotion(page, { evaluate, delay }, reduced = false) {
  const motion = await record(page, evaluate, delay, 1300);
  const result = analyse(`${motion.role} appearance radar`, motion, motion.healthMarkers, reduced);
  assert.ok(motion.healthMarkers > 0, "appearance fixture contains health markers");
  return { role: motion.role, ...result };
}

export async function verifyHealthRadar({
  alice, bob, observer, creator, observerName, cdp, evaluate, waitFor, click,
  clickSessionButton, delay, browser, origin
}) {
  const artifacts = process.env.BROWSER_TEST_ARTIFACT_DIR;
  if (artifacts) mkdirSync(artifacts, { recursive: true });
  const report = { browser, views: [] };
  const capture = async (page, name) => {
    if (!artifacts) return null;
    const image = await cdp("Page.captureScreenshot", { format: "png" }, page.session);
    const file = join(artifacts, `${name}.png`);
    writeFileSync(file, Buffer.from(image.data, "base64"));
    return file;
  };
  const settingsOf = (page, sessionId) => evaluate(page, `(async () =>
    (await (await fetch('/api/v1/sessions/${sessionId}')).json()).settings)()`);
  const sessionIdOf = (page, name) => evaluate(page, `(async () =>
    (await (await fetch('/api/v1/sessions')).json()).sessions
      .filter(session => session.creator === ${JSON.stringify(name)}).at(-1).id)()`);
  const packCount = (page) => evaluate(page, `window.__probe.snapshot.entities.filter(entity =>
    entity.state.kind === 'pickup' && entity.state.pickupType === 'health').length`);

  // One player: 3 packs on the player radar, animated and reduced motion.
  await click(observer, "Create session");
  const soloId = await sessionIdOf(observer, observerName);
  const soloSettings = await settingsOf(observer, soloId);
  assert.equal(soloSettings.healthPacksPerPlayerPerWave, 3, "default packs per player per wave");
  await clickSessionButton(observer, observerName, "Start Session");
  await cdp("Page.bringToFront", {}, observer.session);
  await waitFor(observer, "window.__probe.snapshot?.phase === 'active' && document.querySelector('canvas')");
  await delay(300);
  assert.equal(await packCount(observer), 3, "one player gets 3 health packs");
  const soloPacks = await evaluate(observer, `window.__probe.snapshot.entities.filter(entity =>
    entity.state.kind === 'pickup' && entity.state.pickupType === 'health').map(entity => entity.position)`);
  report.onePlayer = { sessionId: soloId, mapMode: soloSettings.mapMode, packs: soloPacks };
  const soloMotion = await record(observer, evaluate, delay, 1500);
  report.views.push({ view: "player-1p", reducedMotion: false,
    ...analyse("1-player view", soloMotion, 3, false), screenshot: await capture(observer, "health-radar-player-1p") });
  await cdp("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }]
  }, observer.session);
  const soloReduced = await record(observer, evaluate, delay, 800);
  report.views.push({ view: "player-1p", reducedMotion: true,
    ...analyse("1-player reduced", soloReduced, 3, true),
    screenshot: await capture(observer, "health-radar-player-1p-reduced") });
  await cdp("Emulation.setEmulatedMedia", { features: [] }, observer.session);
  assert.equal(await evaluate(observer, `(async () => (await fetch('/api/v1/sessions/${soloId}/leave',
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status)()`), 204);
  await cdp("Page.navigate", { url: origin }, observer.session);
  await waitFor(observer, "document.querySelector('[aria-label=\"Active sessions\"]') !== null");

  // Two players: 6 packs, player and spectator radars use the same treatment.
  await click(alice, "Create session");
  const pairId = await sessionIdOf(alice, creator);
  await click(bob, "Refresh sessions");
  await clickSessionButton(bob, creator, "Join");
  await waitFor(bob, "document.querySelector('#status').textContent.startsWith('Joined')");
  await click(alice, "Refresh sessions");
  await clickSessionButton(alice, creator, "Start Session");
  await click(bob, "Refresh sessions");
  await clickSessionButton(bob, creator, "Rejoin");
  await waitFor(alice, "window.__probe.snapshot?.phase === 'active' && document.querySelector('canvas')");
  await waitFor(bob, "window.__probe.snapshot !== null && document.querySelector('canvas')");
  await click(observer, "Refresh sessions");
  await clickSessionButton(observer, creator, "Spectate");
  await waitFor(observer, "document.querySelector('[aria-label=\"Followable players\"]') !== null");
  await click(observer, `Follow ${creator}`);
  await waitFor(observer, "window.__probe.snapshot?.viewerRole === 'spectator' && document.querySelector('canvas')");
  await delay(300);
  assert.equal(await packCount(alice), 6, "two players get 6 health packs");
  report.twoPlayers = { sessionId: pairId, packs: await evaluate(alice, `window.__probe.snapshot.entities
    .filter(entity => entity.state.kind === 'pickup' && entity.state.pickupType === 'health')
    .map(entity => ({ id: entity.id, position: entity.position }))`) };
  for (const [page, view] of [[alice, "player-2p"], [observer, "spectator-2p"]]) {
    await cdp("Page.bringToFront", {}, page.session);
    await delay(200);
    const motion = await record(page, evaluate, delay, 1500);
    assert.equal(motion.role, view.startsWith("spectator") ? "spectator" : "player");
    report.views.push({ view, reducedMotion: false, ...analyse(view, motion, 6, false),
      screenshot: await capture(page, `health-radar-${view}`) });
    await cdp("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "reduce" }]
    }, page.session);
    const reduced = await record(page, evaluate, delay, 800);
    report.views.push({ view, reducedMotion: true, ...analyse(`${view} reduced`, reduced, 6, true),
      screenshot: await capture(page, `health-radar-${view}-reduced`) });
    await cdp("Emulation.setEmulatedMedia", { features: [] }, page.session);
  }
  if (artifacts) writeFileSync(join(artifacts, "health-radar.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  for (const page of [alice, bob]) {
    await evaluate(page, `fetch('/api/v1/sessions/${pairId}/leave', { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: '{}' }).then(response => response.status)`);
  }
}
