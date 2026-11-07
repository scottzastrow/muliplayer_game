import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import { DEFAULT_GAME_SETTINGS } from "@multiplayer-game/protocol";
import { createApp } from "../../apps/server/src/app.js";
import { readConfig } from "../../apps/server/src/config.js";
import { openDatabase, runMigrations } from "../../apps/server/src/storage/database.js";
import { SpectatorRegistry } from "../../apps/server/src/lobby/spectators.js";

const ORIGIN = "https://game.example.test";
const HEADERS = { origin: ORIGIN, "content-type": "application/json" };

describe("spectator admission and targets", () => {
  let database: ReturnType<typeof openDatabase>;
  let app: ReturnType<typeof createApp>;
  let baseUrl: string;
  const sockets = new Set<WebSocket>();
  let owner: { id: string; cookie: string };
  let observer: { id: string; cookie: string };
  let rival: { id: string; cookie: string };

  beforeEach(async () => {
    database = openDatabase(":memory:");
    runMigrations(database);
    app = createApp(readConfig({ NODE_ENV: "test", PUBLIC_ORIGIN: ORIGIN }), database, { ready: true });
    owner = await account("SpectateOwner");
    observer = await account("SpectateObserver");
    rival = await account("SpectateRival");
    baseUrl = await app.listen({ host: "127.0.0.1", port: 0 });
  });

  afterEach(async () => {
    for (const socket of sockets) socket.terminate();
    sockets.clear();
    await app.close();
  });

  it("atomically reserves the last slot, repeats admission without duplication and releases on leave", async () => {
    const id = await session(1);
    const results = await Promise.all([spectate(id, observer.cookie), spectate(id, rival.cookie)]);
    expect(results.map(result => result.statusCode).sort()).toEqual([200, 409]);
    const winner = results[0]!.statusCode === 200 ? observer : rival;
    const loser = winner === observer ? rival : observer;
    expect(results.find(result => result.statusCode === 409)!.json().error.code).toBe("SPECTATOR_CAPACITY");
    expect((await spectate(id, winner.cookie)).statusCode).toBe(200);
    expect((await summary(id, loser.cookie)).spectatorCount).toBe(1);
    expect((await summary(id, loser.cookie)).canSpectate).toBe(false);
    for (let retry = 0; retry < 2; retry++) {
      expect((await mutation(id, "leave", winner.cookie)).statusCode).toBe(204);
    }
    expect((await summary(id, loser.cookie)).spectatorCount).toBe(0);
    expect((await spectate(id, loser.cookie)).statusCode).toBe(200);
  });

  it("rejects zero capacity, nonrunning games, player role conflicts, unauthenticated and cross-origin requests", async () => {
    const waiting = await session(1, false);
    expect((await spectate(waiting, observer.cookie)).statusCode).toBe(409);
    const id = await session(0);
    const disabled = await spectate(id, observer.cookie);
    expect(disabled.statusCode).toBe(409);
    expect(disabled.json().error.code).toBe("SPECTATOR_CAPACITY");
    expect((await summary(id, observer.cookie)).canSpectate).toBe(false);
    expect((await spectate(id, owner.cookie)).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: `/api/v1/sessions/${id}/spectate`,
      headers: HEADERS, payload: {} })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: `/api/v1/sessions/${id}/spectate`,
      headers: { ...HEADERS, origin: "https://other.test", cookie: observer.cookie }, payload: {} })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: `/api/v1/sessions/${id}/spectate`,
      headers: { ...HEADERS, cookie: observer.cookie }, payload: { targetAccountId: owner.id } })).statusCode).toBe(400);
    expect((await spectate(randomUUID(), observer.cookie)).statusCode).toBe(404);
  });

  it("lists authoritative player life/connectivity, validates targets and never adds a player or NPC", async () => {
    const id = await session(2);
    expect((await players(id, observer.cookie)).statusCode).toBe(403);
    const player = await connect(owner.cookie, id);
    await player.next("server.hello");
    const before = await player.next("server.snapshot");
    const admitted = await spectate(id, observer.cookie);
    expect(admitted.statusCode).toBe(200);
    expect(admitted.json()).toMatchObject({
      spectator: { accountId: observer.id, targetAccountId: null },
      players: [{ accountId: owner.id, username: "SpectateOwner", connected: true, life: "alive", followable: true }]
    });
    const spectator = await connect(observer.cookie, id);
    expect(await spectator.next("server.hello")).toMatchObject({ payload: { role: "spectator" } });
    spectator.socket.send(JSON.stringify({ v: 1, type: "client.spectate.target", payload: { targetAccountId: owner.id } }));
    expect(await spectator.next("server.spectate.target")).toMatchObject({ payload: { targetAccountId: owner.id } });
    const observed = await spectator.next("server.snapshot");
    expect(observed.payload).toMatchObject({
      viewerAccountId: owner.id, viewerRole: "spectator",
      spectatorView: { targetAccountId: owner.id, cameraAnchor: { x: 272, y: 272 },
        hud: { points: 0, health: 100 }, death: { alive: true, remainingSeconds: 0 } }
    });
    spectator.socket.send(JSON.stringify({ v: 1, type: "client.spectate.target", payload: { targetAccountId: rival.id } }));
    expect(await spectator.next("server.error")).toMatchObject({ payload: { code: "FORBIDDEN", fatal: false } });
    expect((await players(id, observer.cookie)).json().spectator.targetAccountId).toBe(owner.id);
    spectator.socket.send(JSON.stringify({ v: 1, type: "client.spectate.target", payload: { targetAccountId: "invalid" } }));
    expect(await spectator.next("server.error")).toMatchObject({ payload: { code: "BAD_REQUEST" } });
    player.socket.send(JSON.stringify({ v: 1, type: "client.spectate.target", payload: { targetAccountId: owner.id } }));
    expect(await player.next("server.error")).toMatchObject({ payload: { code: "FORBIDDEN" } });
    spectator.socket.send(JSON.stringify({ v: 1, type: "client.input", payload: {
      sequence: 0, action: { type: "combat", moveX: 1, moveY: 0, aimX: 0, aimY: 0, fire: true }
    } }));
    expect(await spectator.next("server.error")).toMatchObject({ payload: { code: "FORBIDDEN" } });
    const after = await player.next("server.snapshot");
    expect(before.payload.players).toHaveLength(1);
    expect((before.payload.entities as Array<{ state: { kind: string } }>).filter(entity => entity.state.kind === "npc"))
      .toHaveLength(2);
    expect(after.payload.players).toHaveLength(1);
    expect((after.payload.entities as Array<{ state: { kind: string } }>).filter(entity => entity.state.kind === "npc"))
      .toHaveLength(2);
    expect(database.prepare("SELECT COUNT(*) AS count FROM match_participants WHERE match_id = ?").get(id))
      .toEqual({ count: 1 });
    expect((await summary(id, observer.cookie)).playerCount).toBe(1);
  });

  it("rejects cross-session and disconnected targets, and frees disconnected spectator slots", async () => {
    const id = await session(1);
    const otherId = await session(1, true, rival.cookie);
    const foreign = await connect(rival.cookie, otherId);
    await foreign.next("server.hello");
    await spectate(id, observer.cookie);
    const spectator = await connect(observer.cookie, id);
    await spectator.next("server.hello");
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(spectator.drain("server.snapshot")).toHaveLength(0);
    for (const target of [rival.id, owner.id]) {
      spectator.socket.send(JSON.stringify({ v: 1, type: "client.spectate.target", payload: { targetAccountId: target } }));
      expect(await spectator.next("server.error")).toMatchObject({ payload: { code: "FORBIDDEN" } });
    }
    expect((await players(id, observer.cookie)).json().players).toMatchObject([
      { accountId: owner.id, connected: false, followable: false, life: "alive" }
    ]);
    spectator.socket.close();
    await waitUntil(async () => (await summary(id, rival.cookie)).spectatorCount === 0);
    expect((await spectate(id, rival.cookie)).statusCode).toBe(200);
  });

  it("keeps replacement spectator membership after stale socket close, and closes it on explicit leave", async () => {
    const id = await session(1);
    await spectate(id, observer.cookie);
    const old = await connect(observer.cookie, id);
    await old.next("server.hello");
    const current = await connect(observer.cookie, id);
    await current.next("server.hello");
    await waitUntil(async () => old.socket.readyState === WebSocket.CLOSED);
    expect((await summary(id, rival.cookie)).spectatorCount).toBe(1);
    expect((await mutation(id, "leave", observer.cookie)).statusCode).toBe(204);
    await waitUntil(async () => current.socket.readyState === WebSocket.CLOSED);
    expect((await summary(id, rival.cookie)).spectatorCount).toBe(0);
    expect((await spectate(id, observer.cookie)).statusCode).toBe(200);
    await new Promise(resolve => setTimeout(resolve, 30));
    expect((await summary(id, rival.cookie)).spectatorCount).toBe(1);
  });

  it("rejects a departed player even when their old socket remains open", async () => {
    const id = await session(1, false);
    expect((await mutation(id, "join", rival.cookie)).statusCode).toBe(200);
    expect((await mutation(id, "start", owner.cookie, { expectedRevision: 0 })).statusCode).toBe(200);
    const player = await connect(owner.cookie, id);
    await player.next("server.hello");
    await spectate(id, observer.cookie);
    const spectator = await connect(observer.cookie, id);
    await spectator.next("server.hello");
    spectator.socket.send(JSON.stringify({ v: 1, type: "client.spectate.target", payload: { targetAccountId: owner.id } }));
    await spectator.next("server.spectate.target");
    expect((await mutation(id, "leave", owner.cookie)).statusCode).toBe(204);
    const unavailable = await spectator.next("server.spectate.target");
    expect(unavailable.payload).toMatchObject({ targetAccountId: null, reason: "target-unavailable", players: [] });
    expect((await players(id, observer.cookie)).json().spectator.targetAccountId).toBeNull();
    spectator.drain("server.snapshot");
    await new Promise(resolve => setTimeout(resolve, 150));
    expect(spectator.drain("server.snapshot")).toHaveLength(0);
    expect(spectator.drain("server.spectate.target")).toHaveLength(0);
    spectator.socket.send(JSON.stringify({ v: 1, type: "client.spectate.target", payload: { targetAccountId: owner.id } }));
    expect(await spectator.next("server.error")).toMatchObject({ payload: { code: "FORBIDDEN" } });
    const view = (await players(id, observer.cookie)).json();
    expect(view.players.filter((entry: { life: string }) => entry.life !== "unavailable")
      .map((entry: { accountId: string }) => entry.accountId)).toEqual([rival.id]);
    expect(view.spectator.targetAccountId).toBeNull();
  });

  it("clears a disconnected target, reports the remaining followable players and permits switching", async () => {
    const id = await session(1, false);
    await mutation(id, "join", rival.cookie);
    await mutation(id, "start", owner.cookie, { expectedRevision: 0 });
    const first = await connect(owner.cookie, id);
    const second = await connect(rival.cookie, id);
    await first.next("server.hello");
    await second.next("server.hello");
    await spectate(id, observer.cookie);
    const spectator = await connect(observer.cookie, id);
    await spectator.next("server.hello");
    spectator.socket.send(JSON.stringify({ v: 1, type: "client.spectate.target", payload: { targetAccountId: owner.id } }));
    await spectator.next("server.spectate.target");
    await spectator.next("server.snapshot");
    first.socket.close();
    await waitUntil(async () => first.socket.readyState === WebSocket.CLOSED);
    expect((await players(id, observer.cookie)).json().spectator.targetAccountId).toBeNull();
    const unavailable = await spectator.next("server.spectate.target");
    expect(unavailable.payload).toMatchObject({ targetAccountId: null, reason: "target-unavailable",
      players: [{ accountId: rival.id, connected: true, followable: true }] });
    expect((unavailable.payload.players as unknown[])).toHaveLength(1);
    spectator.drain("server.snapshot");
    await new Promise(resolve => setTimeout(resolve, 150));
    expect(spectator.drain("server.snapshot")).toHaveLength(0);
    spectator.socket.send(JSON.stringify({ v: 1, type: "client.spectate.target", payload: { targetAccountId: rival.id } }));
    await spectator.next("server.spectate.target");
    const switched = await spectator.next("server.snapshot", message => message.payload.viewerAccountId === rival.id);
    expect(switched.payload).toMatchObject({ viewerRole: "spectator",
      spectatorView: { targetAccountId: rival.id, cameraAnchor: { x: 272, y: 784 } } });
  });

  it("allows connected dead targets and clears admission state when the session ends", async () => {
    const id = await session(1);
    const broken = new SpectatorRegistry(database, () => {
      throw new Error("Player-state provider failed.");
    });
    expect(() => broken.admit(id, observer.id)).toThrow("Player-state provider failed.");
    expect(broken.count(id)).toBe(0);
    const registry = new SpectatorRegistry(database, () => new Map([
      [owner.id, { connected: true, life: "dead" }]
    ]));
    registry.admit(id, observer.id);
    expect(registry.selectTarget(id, observer.id, owner.id)).toBe(owner.id);
    expect(registry.players(id, observer.id)).toMatchObject([{ life: "dead", followable: true }]);
    registry.releaseSession(id);
    expect(registry.count(id)).toBe(0);
    await spectate(id, observer.cookie);
    await mutation(id, "leave", owner.cookie);
    expect((await summary(id, observer.cookie)).spectatorCount).toBe(1);
    expect((await players(id, observer.cookie)).json().players).toMatchObject([{ life: "unavailable", followable: false }]);
  });

  async function account(username: string) {
    const registered = await app.inject({ method: "POST", url: "/api/v1/auth/register",
      headers: HEADERS, payload: { username, password: "correct horse battery staple 123" } });
    expect(registered.statusCode).toBe(201);
    const login = await app.inject({ method: "POST", url: "/api/v1/auth/login",
      headers: HEADERS, payload: { username, password: "correct horse battery staple 123" } });
    expect(login.statusCode).toBe(200);
    return { id: registered.json().account.id as string, cookie: String(login.headers["set-cookie"]).split(";")[0]! };
  }
  async function session(cap: number, start = true, cookie = owner.cookie) {
    const created = await app.inject({ method: "POST", url: "/api/v1/sessions",
      headers: { ...HEADERS, cookie }, payload: { settings: { ...DEFAULT_GAME_SETTINGS,
        initialNpcsPerPlayer: 2, maxSpectators: cap, baseNpcHealth: 100_000 } } });
    expect(created.statusCode).toBe(201);
    const id = created.json().session.id as string;
    if (start) expect((await mutation(id, "start", cookie, { expectedRevision: 0 })).statusCode).toBe(200);
    return id;
  }
  function mutation(id: string, action: string, cookie: string, payload = {}) {
    return app.inject({ method: "POST", url: `/api/v1/sessions/${id}/${action}`,
      headers: { ...HEADERS, cookie }, payload });
  }
  function spectate(id: string, cookie: string) { return mutation(id, "spectate", cookie); }
  function players(id: string, cookie: string) {
    return app.inject({ url: `/api/v1/sessions/${id}/players`, headers: { cookie } });
  }
  async function summary(id: string, cookie: string) {
    return (await app.inject({ url: `/api/v1/sessions/${id}`, headers: { cookie } })).json().session;
  }
  async function connect(cookie: string, id: string) {
    const socket = new WebSocket(`${baseUrl.replace("http", "ws")}/ws?sessionId=${id}`, {
      headers: { cookie, origin: ORIGIN }
    });
    sockets.add(socket);
    const messages: Array<{ type: string; payload: Record<string, unknown> }> = [];
    socket.on("message", data => messages.push(JSON.parse(data.toString())));
    await new Promise<void>((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
    return { socket, drain(type: string) {
      const selected = messages.filter(message => message.type === type);
      for (let index = messages.length - 1; index >= 0; index--) {
        if (messages[index]!.type === type) messages.splice(index, 1);
      }
      return selected;
    }, async next(type: string,
      predicate: (message: { type: string; payload: Record<string, unknown> }) => boolean = () => true) {
      await waitUntil(async () => messages.some(message => message.type === type && predicate(message)));
      return messages.splice(messages.findIndex(message => message.type === type && predicate(message)), 1)[0]!;
    } };
  }
});

async function waitUntil(condition: () => Promise<boolean>) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await condition()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error("Spectator integration condition timed out.");
}
