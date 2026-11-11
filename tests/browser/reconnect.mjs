import assert from "node:assert/strict";

export async function verifyReconnect({
  alice, bob, observer, creator, bobName, cdp, evaluate, waitFor, click,
  clickSessionButton, state, own, shootUntil
}) {
  async function step(name, run) {
    console.log(`[reconnect] ${name}`);
    try {
      return await run();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`[reconnect] ${name} failed: ${message}`, { cause: error });
    }
  }

  await step("creating and starting the shared match", async () => {
    await evaluate(alice, `document.querySelector('[name=setting-initialNpcsPerPlayer]').value = '2';
      document.querySelector('[name=setting-baseNpcHealth]').value = '1';
      document.querySelector('[name=setting-maxLevels]').value = '5'`);
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
  });

  const aliceStart = await state(alice);
  const aliceAccountId = aliceStart.snapshot.viewerAccountId;

  await step("earning a score to preserve", async () => {
    await shootUntil(alice, 1, 3);
    const scored = own(await state(alice));
    assert.ok(scored.points > 0, "Alice earns points before disconnecting");
  });
  const savedPoints = own(await state(alice)).points;

  await step("spectator follows Alice", async () => {
    await click(observer, "Refresh sessions");
    await clickSessionButton(observer, creator, "Spectate");
    await waitFor(observer, "document.querySelector('[aria-label=\"Followable players\"]') !== null");
    await click(observer, `Follow ${creator}`);
    await waitFor(observer, "window.__probe.snapshot?.viewerRole === 'spectator'");
    const view = await state(observer);
    assert.equal(view.snapshot.viewerAccountId, aliceAccountId);
    assert.deepEqual(view.snapshot.spectatorView.hud, {
      points: savedPoints,
      health: own(view).health
    });
  });

  await step("disconnecting Alice and observing target loss", async () => {
    await cdp("Page.reload", {}, alice.session);
    await waitFor(alice, "document.querySelector('[aria-label=\"Active sessions\"]') !== null");
    await waitFor(alice, `[...document.querySelectorAll('tbody tr')].some(row =>
      row.children[1]?.textContent === ${JSON.stringify(creator)} &&
      [...row.querySelectorAll('button')].some(button => button.textContent === 'Rejoin'))`);
    await waitFor(observer, "window.__probe.target?.reason === 'target-unavailable'");
    const targetLoss = await evaluate(observer, "window.__probe.target");
    assert.equal(targetLoss.targetAccountId, null);
    assert.ok(!targetLoss.players.some(player => player.accountId === aliceAccountId),
      "disconnected Alice is no longer followable");
  });

  await step("switching the observer to Bob", async () => {
    await click(observer, `Follow ${bobName}`);
    await waitFor(observer, `window.__probe.snapshot?.viewerAccountId === ${
      JSON.stringify((await state(bob)).snapshot.viewerAccountId)}`);
    const view = await state(observer);
    assert.equal(view.snapshot.viewerRole, "spectator");
    assert.ok(view.snapshot.spectatorView);
  });

  await step("rejoining with Alice's original score and identity", async () => {
    await click(alice, "Refresh sessions");
    await clickSessionButton(alice, creator, "Rejoin");
    await waitFor(alice, `window.__probe.snapshot?.viewerAccountId === ${JSON.stringify(aliceAccountId)}`);
    const returned = await state(alice);
    assert.equal(own(returned).points, savedPoints);
    assert.equal(returned.snapshot.players.filter(player => player.accountId === aliceAccountId).length, 1,
      "rejoin restores one player record");
  });

  await step("replacing Alice's socket without duplicating membership", async () => {
    const duplicate = await evaluate(alice, `(async () => {
      const {sessions} = await (await fetch('/api/v1/sessions')).json();
      const session = sessions.find(item => item.creator === ${JSON.stringify(creator)});
      if (!session) throw new Error('The active match is missing.');
      const admission = await fetch('/api/v1/sessions/' + session.id + '/rejoin', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}'
      });
      if (!admission.ok) throw new Error('Duplicate socket rejoin admission failed: ' + admission.status);
      window.__duplicateMessages = [];
      const url = new URL('/ws', location.href);
      url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      url.searchParams.set('sessionId', session.id);
      const socket = new WebSocket(url);
      window.__duplicateSocket = socket;
      const hello = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Duplicate socket hello timed out.')), 8000);
        socket.addEventListener('message', event => {
          const message = JSON.parse(event.data);
          window.__duplicateMessages.push(message);
          if (message.type === 'server.hello') {
            clearTimeout(timer);
            resolve(message);
          }
        });
        socket.addEventListener('error', () => {
          clearTimeout(timer);
          reject(new Error('Duplicate socket failed to connect.'));
        }, { once: true });
      });
      return { hello, sessionId: session.id };
    })()`);
    assert.equal(duplicate.hello.payload.role, "player");
    await waitFor(alice, "window.__duplicateMessages.some(message => message.type === 'server.snapshot')");
    const duplicateSnapshot = await evaluate(alice,
      "window.__duplicateMessages.find(message => message.type === 'server.snapshot').payload");
    assert.equal(duplicateSnapshot.viewerAccountId, aliceAccountId);
    assert.equal(duplicateSnapshot.players.filter(player => player.accountId === aliceAccountId).length, 1);
    assert.equal(new Set(duplicateSnapshot.players.map(player => player.accountId)).size,
      duplicateSnapshot.players.length, "each participant appears once after socket replacement");

    const counts = await evaluate(alice, `(async () => {
      const response = await fetch('/api/v1/sessions/${duplicate.sessionId}');
      return (await response.json()).session;
    })()`);
    assert.equal(counts.playerCount, 2);
    assert.equal(counts.spectatorCount, 1);
  });
}
