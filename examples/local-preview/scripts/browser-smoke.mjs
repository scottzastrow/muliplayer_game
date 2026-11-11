import assert from "node:assert/strict";

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
const exceptions = [];
socket.addEventListener("message", ({ data }) => {
  const message = JSON.parse(data);
  if (message.method === "Runtime.exceptionThrown") {
    exceptions.push(message.params.exceptionDetails.exception?.description ?? "Browser exception");
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
    const id = ++nextId;
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP timeout: ${method}`));
    }, 10_000);
    pending.set(id, { resolve, reject, timeout });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}

async function evaluate(sessionId, expression) {
  const response = await cdp("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  }, sessionId);
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description ?? "Browser evaluation failed.");
  }
  return response.result.value;
}

async function waitFor(sessionId, expression) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await evaluate(sessionId, expression)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("The browser did not reach the expected local-preview state.");
}

function readXExpression() {
  return `Number(document.querySelector('[data-testid="sample-world"]')?.textContent.match(/Position ([\\d.]+)/)?.[1])`;
}

let targetId;
let sessionId;
try {
  const target = await cdp("Target.createTarget", { url: origin });
  targetId = target.targetId;
  ({ sessionId } = await cdp("Target.attachToTarget", { targetId, flatten: true }));
  await cdp("Page.enable", {}, sessionId);
  await cdp("Runtime.enable", {}, sessionId);
  await waitFor(sessionId, `document.querySelector("#preview-status")?.textContent.includes("running")`);
  assert.equal(
    await evaluate(sessionId, `document.querySelector('[role="img"]')?.getAttribute("aria-label") === "One Wall game map"`),
    true,
    "the selected map renders in the sample skin"
  );
  const initialX = await evaluate(sessionId, readXExpression());
  await evaluate(sessionId, `[...document.querySelectorAll("button")].find(button => button.textContent === "Move east").click()`);
  await waitFor(sessionId, `${readXExpression()} > ${initialX}`);
  const movedX = await evaluate(sessionId, readXExpression());
  assert.ok(movedX > initialX, `module input moved the rendered player (${initialX} -> ${movedX})`);
  assert.ok(movedX <= 104, `player remains on the west side of the configured wall (${movedX})`);
  assert.ok(await evaluate(sessionId, `document.querySelector('[data-testid="sample-player"]')?.style.left`));
  await evaluate(sessionId, `[...document.querySelectorAll("button")].find(button => button.textContent === "Stop").click()`);
  const stoppedX = await evaluate(sessionId, readXExpression());
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(await evaluate(sessionId, readXExpression()), stoppedX, "stop input ends movement");
  assert.equal(await evaluate(sessionId, `document.querySelector('[data-testid="sample-hud"]')?.textContent.includes("points")`), true);
  assert.deepEqual(exceptions, []);
  console.log(`Browser preview passed: rendered movement ${initialX} -> ${movedX}, stop input and HUD output verified.`);
} finally {
  if (targetId) await cdp("Target.closeTarget", { targetId }).catch(() => {});
  socket.close();
}
