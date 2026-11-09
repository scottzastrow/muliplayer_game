import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket, type RawData } from "ws";
import { z } from "zod";
import { DEFAULT_GAME_SETTINGS } from "@multiplayer-game/protocol";
import { WorldGeometry } from "@multiplayer-game/engine";
import { PROJECTILE_RADIUS } from "@multiplayer-game/default-theme";
import { createApp } from "../../apps/server/src/app.js";
import { readConfig } from "../../apps/server/src/config.js";
import { ThemeLoader } from "../../apps/server/src/themes/builtins.js";
import {
  getMatchResult
} from "../../apps/server/src/storage/results.js";
import { openDatabase, runMigrations } from "../../apps/server/src/storage/database.js";

const ORIGIN = "https://game.example.test";
const BASE_HEADERS = { origin: ORIGIN, "content-type": "application/json" };

describe("session simulation lifecycle", () => {
  const database = openDatabase(":memory:");
  runMigrations(database);
  const app = createApp(
    readConfig({ NODE_ENV: "test", PUBLIC_ORIGIN: ORIGIN }),
    database,
    { ready: true }
  );
  const sockets = new Set<WebSocket>();
  let baseUrl: string;

  afterEach(async () => {
    for (const socket of sockets) {
      socket.terminate();
    }
    sockets.clear();
    await app.close();
    vi.restoreAllMocks();
  });

  it(
    "starts the isolated module, routes actions, completes levels, saves results and releases the slot",
    async () => {
      const createModule = ThemeLoader.prototype.createModuleInstance;
      vi.spyOn(ThemeLoader.prototype, "createModuleInstance").mockImplementation(function (
        this: ThemeLoader, ...args
      ) {
        const module = createModule.apply(this, args);
        const context = args[1];
        const placedNpcs = new Set<string>();
        // Stage each wave once without replacing terrain, combat or progression.
        const placeEncounter = () => {
          if (module.state.phase !== "active") return;
          const npcs = context.entities.values().filter(entity => entity.state.kind === "npc");
          expect(npcs).toHaveLength(1);
          const npc = npcs[0]!;
          if (placedNpcs.has(npc.id)) return;
          const position = { x: 400, y: 272 };
          expect(context.geometry.isWalkable(position.x, position.y, npc.radius)).toBe(true);
          context.entities.update(npc.id, entity => ({ ...entity, position }));
          placedNpcs.add(npc.id);
        };
        const initialize = module.initialize.bind(module);
        module.initialize = async () => {
          await initialize();
          placeEncounter();
        };
        const step = module.step.bind(module);
        module.step = (dt, tick) => {
          step(dt, tick);
          placeEncounter();
        };
        return module;
      });
      const cookie = await registerLogin("LifecyclePlayer");
      const created = await app.inject({
        method: "POST",
        url: "/api/v1/sessions",
        headers: { ...BASE_HEADERS, cookie },
        payload: {
          settings: {
            ...DEFAULT_GAME_SETTINGS,
            maxPlayers: 1,
            maxSpectators: 1,
            initialNpcsPerPlayer: 1,
            npcPopulationGrowthPercent: 0,
            baseNpcHealth: 1,
            npcHealthGrowthPercent: 0,
            npcMovementSpeed: 0,
            maxLevels: 2
          }
        }
      });
      expect(created.statusCode).toBe(201);
      const sessionId = created.json().session.id as string;
      expect((await app.inject({
        url: `/api/v1/matches/${sessionId}/results`, headers: { cookie }
      })).statusCode).toBe(404);
      const started = await app.inject({
        method: "POST",
        url: `/api/v1/sessions/${sessionId}/start`,
        headers: { ...BASE_HEADERS, cookie },
        payload: { expectedRevision: 0 }
      });
      expect(started.statusCode).toBe(200);
      const observerCookie = await registerLogin("LifecycleObserver");
      const admitted = await app.inject({
        method: "POST",
        url: `/api/v1/sessions/${sessionId}/spectate`,
        headers: { ...BASE_HEADERS, cookie: observerCookie },
        payload: {}
      });
      expect(admitted.statusCode).toBe(200);
      expect(admitted.json().session).toMatchObject({ playerCount: 1, spectatorCount: 1 });
      baseUrl = await app.listen({ host: "127.0.0.1", port: 0 });

      const socket = await connect(cookie, sessionId);
      expect(await nextMessageOfType(socket, "server.hello")).toMatchObject({
        sessionId,
        payload: { sessionState: "running" }
      });
      const firstSnapshot = await nextSnapshot(socket);
      expect(firstSnapshot).toMatchObject({
        protocolVersion: 1,
        moduleStateSchemaVersion: 4,
        level: 1,
        phase: "active"
      });
      socket.send(JSON.stringify(inputMessage(0, aimAtStationaryNpc(firstSnapshot))));

      await nextSnapshot(socket, snapshot => snapshot.phase === "intermission", 2_500);
      expect(database.prepare("SELECT current_level FROM matches WHERE id = ?").get(sessionId))
        .toEqual({ current_level: 1 });
      await waitUntil(
        () =>
          (
            database.prepare("SELECT current_level FROM matches WHERE id = ?").get(sessionId) as
              | { current_level: number }
              | undefined
          )?.current_level === 2,
        7_000
      );
      const secondLevel = await nextSnapshot(
        socket,
        (snapshot) => snapshot.level === 2 && snapshot.phase === "active",
        7_000
      );
      expect(secondLevel.acceptedInputs).toBe(1);
      expect(secondLevel.players).toEqual([
        expect.objectContaining({ points: 100, kills: 1 })
      ]);
      socket.send(JSON.stringify(inputMessage(1, aimAtStationaryNpc(secondLevel))));

      await waitUntil(
        () =>
          (
            database.prepare("SELECT state FROM matches WHERE id = ?").get(sessionId) as
              | { state: string }
              | undefined
          )?.state === "finished",
        2_500
      );

      expect(getMatchResult(database, sessionId)).toMatchObject({
        status: "finished",
        finalLevel: 2,
        standings: [
          { accountId: expect.any(String), username: "LifecyclePlayer", points: 200, kills: 2, rank: 1 }
        ]
      });
      const terminal = await nextMessageOfType(socket, "server.lifecycle");
      expect(terminal).toMatchObject({
        sessionId,
        payload: { status: "finished", resultId: sessionId }
      });
      const saved = await app.inject({
        url: `/api/v1/matches/${sessionId}/results`, headers: { cookie }
      });
      expect(saved.statusCode).toBe(200);
      const finishedSummary = await app.inject({
        url: `/api/v1/sessions/${sessionId}`, headers: { cookie: observerCookie }
      });
      expect(finishedSummary.json().session).toMatchObject({ status: "finished", spectatorCount: 0 });
      expect(saved.json().result).toMatchObject({
        matchId: sessionId, status: "finished", finalLevel: 2,
        standings: [{ username: "LifecyclePlayer", rank: 1, points: 200, kills: 2 }]
      });
      expect((await app.inject({
        url: `/api/v1/matches/${sessionId}/results`, headers: { cookie }
      })).json()).toEqual(saved.json());
      expect((await app.inject({
        url: `/api/v1/matches/${sessionId}/results`
      })).statusCode).toBe(401);
      expect((await app.inject({
        url: "/api/v1/matches/not-an-id/results", headers: { cookie }
      })).statusCode).toBe(404);
      expect(
        (
          database
            .prepare("SELECT COUNT(*) AS count FROM matches WHERE state IN ('waiting', 'running')")
            .get() as { count: number }
        ).count
      ).toBe(0);
      expect(
        (
          database
            .prepare("SELECT COUNT(*) AS count FROM match_results WHERE match_id = ?")
            .get(sessionId) as { count: number }
        ).count
      ).toBe(1);

      const replacement = await app.inject({
        method: "POST",
        url: "/api/v1/sessions",
        headers: { ...BASE_HEADERS, cookie },
        payload: { settings: DEFAULT_GAME_SETTINGS }
      });
      expect(replacement.statusCode).toBe(201);
    },
    15_000
  );

  async function registerLogin(username: string): Promise<string> {
    const registration = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      headers: BASE_HEADERS,
      payload: { username, password: "correct horse battery staple 123", controlMode: "keyboard-mouse" }
    });
    expect(registration.statusCode).toBe(201);
    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: BASE_HEADERS,
      payload: { username, password: "correct horse battery staple 123" }
    });
    expect(login.statusCode).toBe(200);
    const header = login.headers["set-cookie"];
    const value = Array.isArray(header) ? header[0] : header;
    if (typeof value !== "string") {
      throw new Error("Login response did not set a session cookie.");
    }
    return value.split(";", 1)[0]!;
  }

  function connect(cookie: string, sessionId: string): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(
        `${baseUrl.replace(/^http/, "ws")}/ws?sessionId=${sessionId}`,
        { headers: { cookie, origin: ORIGIN } }
      );
      socket.on("message", (data: RawData) => {
        messages.get(socket)?.push(JSON.parse(data.toString()) as Record<string, unknown>);
        const waiter = waiters.get(socket)?.shift();
        if (waiter) {
          clearTimeout(waiter.timeout);
          waiter.resolve(messages.get(socket)!.shift()!);
        }
      });
      socket.once("open", () => resolve(socket));
      socket.once("error", reject);
      socket.once("close", () => sockets.delete(socket));
      sockets.add(socket);
      messages.set(socket, []);
      waiters.set(socket, []);
    });
  }

  async function nextMessageOfType(
    socket: WebSocket,
    type: string
  ): Promise<Record<string, unknown>> {
    const deadline = Date.now() + 1_000;
    while (Date.now() < deadline) {
      const message = await nextMessage(socket);
      if (message.type === type) {
        return message;
      }
    }
    throw new Error(`Timed out waiting for ${type}.`);
  }

  async function nextSnapshot(
    socket: WebSocket,
    predicate: (snapshot: Record<string, unknown>) => boolean = () => true,
    timeoutMs = 1_000
  ): Promise<Record<string, unknown>> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const message = await nextMessageOfType(socket, "server.snapshot");
      const payload = message.payload as Record<string, unknown>;
      if (
        typeof message.tick === "number" &&
        predicate(payload)
      ) {
        return payload;
      }
    }
    throw new Error("Timed out waiting for a matching game snapshot.");
  }

  function nextMessage(socket: WebSocket): Promise<Record<string, unknown>> {
    const queued = messages.get(socket)?.shift();
    if (queued) {
      return Promise.resolve(queued);
    }
    return new Promise((resolve, reject) => {
      const waiter = {
        resolve,
        timeout: setTimeout(() => {
          const current = waiters.get(socket);
          if (current) {
            const index = current.indexOf(waiter);
            if (index >= 0) current.splice(index, 1);
          }
          reject(new Error("Timed out waiting for a WebSocket message."));
        }, 1_000)
      };
      waiters.get(socket)?.push(waiter);
    });
  }
});

const messages = new WeakMap<WebSocket, Array<Record<string, unknown>>>();
const waiters = new WeakMap<
  WebSocket,
  Array<{
    readonly resolve: (message: Record<string, unknown>) => void;
    readonly timeout: NodeJS.Timeout;
  }>
>();

function inputMessage(sequence: number, aim: { readonly x: number; readonly y: number }) {
  return {
    v: 1,
    type: "client.input",
    payload: {
      sequence,
      action: {
        type: "combat",
        moveX: 0,
        moveY: 0,
        aimX: aim.x,
        aimY: aim.y,
        fire: true
      }
    }
  };
}

function aimAtStationaryNpc(snapshot: Record<string, unknown>): { x: number; y: number } {
  const { entities, map } = z.object({
    entities: z.array(z.object({
      typeId: z.string(),
      position: z.object({ x: z.number().finite(), y: z.number().finite() })
    })),
    map: z.object({
      width: z.number().positive(),
      height: z.number().positive(),
      obstacles: z.array(z.object({
        x: z.number(), y: z.number(), width: z.number(), height: z.number()
      }))
    })
  }).parse(snapshot);
  const player = entities.find(entity => entity.typeId === "player");
  const npcs = entities.filter(entity => entity.typeId === "npc");
  expect(player?.position).toEqual({ x: 272, y: 272 });
  expect(npcs).toHaveLength(1);
  const npc = npcs[0]!;
  expect(npc.position).toEqual({ x: 400, y: 272 });
  const geometry = new WorldGeometry(map, map.obstacles);
  for (let x = 272; x <= 400; x += 1) {
    expect(geometry.isCircleWalkable({ x, y: 272 }, PROJECTILE_RADIUS)).toBe(true);
  }
  return npc.position;
}

async function waitUntil(condition: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() >= deadline) {
      throw new Error("Condition was not satisfied before timeout.");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
