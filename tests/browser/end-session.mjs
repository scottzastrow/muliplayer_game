import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";

export async function verifyEndSession({ newWindow, signIn, evaluate, click,
  clickSessionButton, waitFor, cdp, waitForDialog, version }) {
  const host = await newWindow();
  const player = await newWindow();
  const observer = await newWindow();
  const suffix = Date.now().toString(36);
  const username = `EndHost_${suffix}`;
  const playerName = `EndPlayer_${suffix}`;
  await signIn(host, username, randomUUID());
  await signIn(player, playerName, randomUUID());
  await signIn(observer, `EndWatch_${suffix}`, randomUUID());
  await click(host, "Create session");
  const id = await evaluate(host, `(async () =>
    (await (await fetch('/api/v1/sessions')).json()).sessions
      .find(room => room.creator === ${JSON.stringify(username)}).id)()`);
  const endButtons = page => evaluate(page,
    `[...document.querySelectorAll('button')].filter(b => b.textContent === 'End Session').length`);
  let replacementId;
  try {
    assert.equal(await endButtons(host), 0, "waiting matches have no End Session button");
    await click(player, "Refresh sessions");
    await clickSessionButton(player, username, "Join");
    await clickSessionButton(host, username, "Start Session");
    await waitFor(host, "window.__probe.snapshot?.phase === 'active'");
    await click(host, "Back to lobby");
    await waitFor(host, "[...document.querySelectorAll('button')].some(b => b.textContent === 'End Session')");
    await evaluate(host, `[...document.querySelectorAll('button')]
      .find(b => b.textContent === 'End Session').scrollIntoView({block:'center'})`);
    const placement = await evaluate(host, `(() => {
      const button = [...document.querySelectorAll('button')].find(b => b.textContent === 'End Session');
      return {cell:button.parentElement.tagName, previous:button.previousElementSibling.textContent};
    })()`);
    assert.deepEqual(placement, { cell: "TD", previous: "Running" });
    await click(player, "Refresh sessions");
    assert.equal(await endButtons(player), 0, "non-host participants have no end control");
    const denied = await evaluate(player, `(async () => (await fetch(
      '/api/v1/sessions/${id}/end', {method:'POST',
        headers:{'content-type':'application/json'}, body:'{}'})).status)()`);
    assert.equal(denied, 403);
    await clickSessionButton(player, username, "Play");
    await waitFor(player, "window.__probe.snapshot?.phase === 'active'");
    await click(observer, "Refresh sessions");
    assert.equal(await endButtons(observer), 0, "spectators have no end control");
    await clickSessionButton(observer, username, "Spectate");
    await click(observer, `Follow ${playerName}`);
    await waitFor(observer, "window.__probe.snapshot?.viewerRole === 'spectator'");
    if (process.env.BROWSER_TEST_SCREENSHOT) {
      const screenshot = await cdp("Page.captureScreenshot", { format: "png" }, host.session);
      writeFileSync(process.env.BROWSER_TEST_SCREENSHOT, Buffer.from(screenshot.data, "base64"));
    }
    const cancelClick = clickSessionButton(host, username, "End Session");
    const dialog = await waitForDialog(host);
    assert.equal(dialog.type, "confirm");
    assert.ok(dialog.message.includes("Current standings"));
    await cdp("Page.handleJavaScriptDialog", { accept: false }, host.session);
    await cancelClick;
    assert.equal(await endButtons(host), 1);
    assert.equal(await evaluate(host, `(async () =>
      (await (await fetch('/api/v1/sessions/${id}')).json()).session.status)()`), "running");
    const endClick = clickSessionButton(host, username, "End Session");
    await waitForDialog(host);
    await cdp("Page.handleJavaScriptDialog", { accept: true }, host.session);
    await endClick;
    await waitFor(host, "document.querySelector('#status').textContent === 'Session ended. Final results saved.'");
    assert.equal(await endButtons(host), 0, "finished room is removed from the lobby");
    const rows = page => evaluate(page,
      `[...document.querySelector('[aria-label="Final standings"] tbody').rows]
        .map(row => [...row.cells].map(cell => cell.textContent))`);
    for (const page of [player, observer]) {
      await waitFor(page, "document.querySelector('[aria-label=\"Final standings\"]') !== null");
    }
    const standings = await rows(player);
    assert.equal(standings.length, 2);
    assert.deepEqual(await rows(observer), standings);
    for (const page of [player, observer]) {
      await click(page, "Reload saved result");
      await waitFor(page, "document.querySelector('#status').textContent === 'Saved result loaded.'");
      assert.deepEqual(await rows(page), standings);
      await cdp("Page.reload", {}, page.session);
      await waitFor(page, "document.querySelector('[aria-label=\"Final standings\"]') !== null");
      assert.deepEqual(await rows(page), standings);
    }
    const original = await evaluate(host, `(async () =>
      (await (await fetch('/api/v1/matches/${id}/results')).json()).result)()`);
    const result = await evaluate(host, `(async () =>
      (await (await fetch('/api/v1/sessions/${id}/end', {method:'POST',
        headers:{'content-type':'application/json'},body:'{}'})).json()).result)()`);
    assert.equal(result.finalLevel, 1);
    assert.equal(result.status, "finished");
    assert.deepEqual(result, original);
    await click(host, "Create session");
    replacementId = await evaluate(host, `(async () =>
      (await (await fetch('/api/v1/sessions')).json()).sessions
        .find(room => room.creator === ${JSON.stringify(username)}).id)()`);
    console.log(JSON.stringify({ browser: version.Browser, matchId: id,
      hostOnlyButtonBesideRunningStatus: true, confirmationCancelAndAccept: true,
      nonHostHttpStatus: denied, playerAndSpectatorFinalResults: true,
      savedReloadAndPageRefresh: true, finalLevel: result.finalLevel,
      retryReturnsSameResult: true, replacementRoomCreated: true, standings }, null, 2));
  } finally {
    for (const roomId of [id, replacementId].filter(Boolean)) {
      const status = await evaluate(host, `(async () => (await fetch(
        '/api/v1/sessions/${roomId}/leave', {method:'POST',
          headers:{'content-type':'application/json'},body:'{}'})).status)()`);
      assert.equal(status, 204);
    }
  }
}
