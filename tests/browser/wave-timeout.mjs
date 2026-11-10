import assert from "node:assert/strict";

export async function verifyWaveTimeout({
  alice, bob, creator, evaluate, waitFor, click, clickSessionButton, delay, browser
}) {
  await evaluate(alice, `document.querySelector('[name=setting-initialNpcsPerPlayer]').value = '1';
    document.querySelector('[name=setting-baseNpcHealth]').value = '100000';
    document.querySelector('[name=setting-noKillTimeoutSeconds]').value = '8';
    document.querySelector('[name=setting-maxLevels]').value = '2'`);
  await click(alice, "Create session");
  await clickSessionButton(alice, creator, "Start Session");
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
  assert.equal(initial.seconds, undefined, "no timer in the player snapshot");
  assert.equal(initial.hud, undefined, "no timer in the player HUD");
  assert.equal(observerInitial.seconds, undefined, "no timer in the spectator snapshot");
  assert.equal(observerInitial.viewer, initial.viewer);
  assert.equal(observerInitial.hud, undefined, "no timer in the spectator HUD");
  for (const page of [alice, bob]) {
    await waitFor(page, "document.querySelector('.default-points')?.textContent === 'Score: 0'");
    assert.match(await evaluate(page, "document.querySelector('.game-hud').textContent"),
      /Score: 0.*Health: \d+/);
  }

  await delay(2200);
  const later = await evaluate(alice, `(() => ({
    seconds: window.__probe.snapshot.waveRemainingSeconds,
    hud: document.querySelector('.default-wave-time')?.textContent
  }))()`);
  const observerLater = await evaluate(bob, `(() => ({
    seconds: window.__probe.snapshot.waveRemainingSeconds,
    hud: document.querySelector('.default-wave-time')?.textContent
  }))()`);
  assert.equal(later.seconds, undefined);
  assert.equal(observerLater.seconds, undefined);
  assert.equal(later.hud, undefined);
  assert.equal(observerLater.hud, undefined);

  let finished = false;
  for (let attempt = 0; attempt < 46; attempt++) {
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
  assert.equal(result.completionReason, "wave-timeout");
  assert.equal(result.finalLevel, 1, "timeout saves the reached level, below maxLevels");
  assert.equal(result.settings.maxLevels, 2);
  assert.equal(result.standings.length, 1);
  assert.equal(result.standings[0].rank, 1);
  const standings = await evaluate(alice,
    "document.querySelector('[aria-label=\"Final standings\"]').textContent");
  assert.ok(standings.includes(result.standings[0].username));
  assert.equal(await evaluate(bob,
    "document.querySelector('[aria-label=\"Final standings\"]').textContent"), standings);
  for (const page of [alice, bob]) {
    assert.ok(await evaluate(page,
      "document.body.textContent.includes('Wave ended: no kills for a while.')"));
  }
  assert.equal(await evaluate(alice, "location.hash"), `#results/${matchId}`);
  assert.equal(await evaluate(bob, "location.hash"), `#results/${matchId}`);

  await click(alice, "Reload saved result");
  await waitFor(alice, "document.querySelector('[aria-label=\"Final standings\"]') !== null");
  assert.equal(await evaluate(alice,
    "document.querySelector('[aria-label=\"Final standings\"]').textContent"), standings);
  assert.ok(await evaluate(alice,
    "document.body.textContent.includes('Wave ended: no kills for a while.')"));
  console.log(JSON.stringify({
    browser, players: 1, spectators: 1, configuredNoKillSeconds: 8,
    timerHiddenForBothRoles: true, timeoutMessageAndReload: true,
    timeoutFinalLevel: result.finalLevel, maxLevels: result.settings.maxLevels,
    savedStandingsDisplayedForPlayerAndSpectator: true,
    savedResultReload: true, matchId, standings: result.standings
  }, null, 2));
}
