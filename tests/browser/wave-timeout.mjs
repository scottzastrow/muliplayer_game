import assert from "node:assert/strict";

export async function verifyWaveTimeout({
  alice, bob, creator, evaluate, waitFor, click, clickSessionButton, delay, browser
}) {
  await evaluate(alice, `document.querySelector('[name=setting-initialNpcsPerPlayer]').value = '1';
    document.querySelector('[name=setting-baseNpcHealth]').value = '100000';
    document.querySelector('[name=setting-maxLevels]').value = '2'`);
  await click(alice, "Create session");
  await waitFor(alice, "document.querySelector('tbody details') !== null");
  await evaluate(alice, "document.querySelector('tbody details').open = true");
  await click(alice, "Start session");
  await waitFor(alice, "window.__probe.snapshot?.phase === 'active'");
  const matchId = await evaluate(alice, `(async () => {
    const { sessions } = await (await fetch('/api/v1/sessions')).json();
    return sessions.find(session => session.creator === ${JSON.stringify(creator)}).id;
  })()`);

  await click(bob, "Refresh sessions");
  await clickSessionButton(bob, creator, "Spectate");
  await waitFor(bob, "document.querySelector('[aria-label=\"Followable players\"]') !== null");
  await click(bob, `Follow ${creator}`);
  await waitFor(bob, "window.__probe.snapshot?.viewerRole === 'spectator'");

  const initial = await evaluate(alice, `(() => {
    const snapshot = window.__probe.snapshot;
    return { seconds: snapshot.waveRemainingSeconds,
      hud: document.querySelector('.default-wave-time')?.textContent,
      viewer: snapshot.viewerAccountId };
  })()`);
  const observerInitial = await evaluate(bob, `(() => {
    const snapshot = window.__probe.snapshot;
    return { seconds: snapshot.waveRemainingSeconds,
      hud: document.querySelector('.default-wave-time')?.textContent,
      viewer: snapshot.viewerAccountId };
  })()`);
  assert.ok(Number.isFinite(initial.seconds) && initial.seconds > 0 && initial.seconds <= 126,
    "player receives the authoritative starting wave countdown");
  assert.equal(initial.hud, `Wave time remaining: ${Math.ceil(initial.seconds)}s`);
  assert.ok(Number.isFinite(observerInitial.seconds) && observerInitial.seconds > 0,
    "spectator receives the selected player's authoritative wave countdown");
  assert.equal(observerInitial.viewer, initial.viewer);
  assert.equal(observerInitial.hud, `Wave time remaining: ${Math.ceil(observerInitial.seconds)}s`);

  await delay(2200);
  const later = await evaluate(alice, `(() => ({
    seconds: window.__probe.snapshot.waveRemainingSeconds,
    hud: document.querySelector('.default-wave-time')?.textContent
  }))()`);
  const observerLater = await evaluate(bob, `(() => ({
    seconds: window.__probe.snapshot.waveRemainingSeconds,
    hud: document.querySelector('.default-wave-time')?.textContent
  }))()`);
  assert.ok(later.seconds < initial.seconds, "player wave countdown decreases in the browser");
  assert.ok(observerLater.seconds < observerInitial.seconds,
    "spectator wave countdown decreases in the browser");
  assert.equal(later.hud, `Wave time remaining: ${Math.ceil(later.seconds)}s`);
  assert.equal(observerLater.hud, `Wave time remaining: ${Math.ceil(observerLater.seconds)}s`);

  let finished = false;
  for (let attempt = 0; attempt < Math.ceil((initial.seconds + 15) * 2); attempt++) {
    finished = await evaluate(alice,
      "document.querySelector('[aria-label=\"Final standings\"]') !== null");
    if (finished) break;
    await delay(500);
  }
  assert.ok(finished, "wave timeout navigates the player to saved standings");
  await waitFor(bob, "document.querySelector('[aria-label=\"Final standings\"]') !== null");

  const result = await evaluate(alice, `(async () => {
    const response = await fetch('/api/v1/matches/${matchId}/results');
    if (!response.ok) throw new Error('Saved timeout result returned ' + response.status);
    return (await response.json()).result;
  })()`);
  assert.equal(result.status, "finished");
  assert.equal(result.finalLevel, 1, "timeout saves the reached level, below maxLevels");
  assert.equal(result.settings.maxLevels, 2);
  assert.equal(result.standings.length, 1);
  assert.equal(result.standings[0].rank, 1);
  const standings = await evaluate(alice,
    "document.querySelector('[aria-label=\"Final standings\"]').textContent");
  assert.ok(standings.includes(result.standings[0].username));
  assert.equal(await evaluate(bob,
    "document.querySelector('[aria-label=\"Final standings\"]').textContent"), standings);
  assert.equal(await evaluate(alice, "location.hash"), `#results/${matchId}`);
  assert.equal(await evaluate(bob, "location.hash"), `#results/${matchId}`);

  await click(alice, "Reload saved result");
  await waitFor(alice, "document.querySelector('[aria-label=\"Final standings\"]') !== null");
  assert.equal(await evaluate(alice,
    "document.querySelector('[aria-label=\"Final standings\"]').textContent"), standings);
  console.log(JSON.stringify({
    browser, players: 1, spectators: 1, initialWaveSeconds: initial.seconds,
    playerCountdownDecreased: true, spectatorCountdownDecreased: true,
    timeoutFinalLevel: result.finalLevel, maxLevels: result.settings.maxLevels,
    savedStandingsDisplayedForPlayerAndSpectator: true,
    savedResultReload: true, matchId, standings: result.standings
  }, null, 2));
}
