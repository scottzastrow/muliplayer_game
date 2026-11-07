import { describe, expect, it, vi } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { WebSocket } from "ws";
import { z } from "zod";
import { DEFAULT_GAME_SETTINGS } from "@multiplayer-game/protocol";
import { createApp } from "../../apps/server/src/app.js";
import { readConfig } from "../../apps/server/src/config.js";
import { createAccount, verifyCredentials } from "../../apps/server/src/auth/accounts.js";
import { LobbyRegistry } from "../../apps/server/src/lobby/registry.js";
import { SessionLifecycle } from "../../apps/server/src/runtime/session-lifecycle.js";
import { RuntimeMetrics } from "../../apps/server/src/runtime/metrics.js";
import { createThemeLoader } from "../../apps/server/src/themes/builtins.js";
import {
  openDatabase, reconcileInterruptedMatches, runMigrations
} from "../../apps/server/src/storage/database.js";
import { finalizeMatchResult, getMatchResult } from "../../apps/server/src/storage/results.js";
import {
  BoundedMessageSender, MAX_BUFFERED_OUTGOING_BYTES
} from "../../apps/server/src/transport/socket.js";

const ORIGIN = "http://operations.example.test";
const config = readConfig({ NODE_ENV: "test", PUBLIC_ORIGIN: ORIGIN });
const headers = { origin: ORIGIN, "content-type": "application/json" };
const password = "synthetic operations password 123";
const settings = {
  ...DEFAULT_GAME_SETTINGS, maxPlayers: 1, maxSpectators: 1,
  initialNpcsPerPlayer: 2, baseNpcHealth: 100000, maxLevels: 1
};

describe("local operations", () => {
  it("reopens durable accounts/results and reconciles stale waiting/running metadata exactly once", async () => {
    const temporary = mkdtempSync(join(tmpdir(), "multiplayer-operations-restart-"));
    const path = join(temporary, "game.sqlite");
    let database = openDatabase(path);
    let app: ReturnType<typeof createApp> | undefined;
    try {
      runMigrations(database);
      const account = await createAccount(database, "DurableOperatorTest", password);
      const lobby = new LobbyRegistry(database, Date.now, createThemeLoader());
      const finished = lobby.create(account, { settings }).summary.id;
      lobby.start(account, finished, { expectedRevision: 0 });
      expect(finalizeMatchResult(database, {
        matchId: finished, status: "finished", finalLevel: 1,
        standings: [{ accountId: account.id, points: 123, kills: 2, deaths: 1 }]
      })).toBe(true);
      const original = getMatchResult(database, finished);
      const waiting = lobby.create(account, { settings }).summary.id;
      const running = lobby.create(account, { settings }).summary.id;
      lobby.start(account, running, { expectedRevision: 0 });
      // Stale persisted metadata models a crash, without graceful lifecycle finalization.
      database.close();
      database = openDatabase(path);
      runMigrations(database);
      expect(reconcileInterruptedMatches(database)).toBe(2);
      expect(reconcileInterruptedMatches(database)).toBe(0);
      expect(await verifyCredentials(database, account.username, password)).toEqual(account);
      expect(await verifyCredentials(database, account.username, "wrong password")).toBeUndefined();
      expect(getMatchResult(database, finished)).toEqual(original);
      for (const id of [waiting, running]) {
        expect(getMatchResult(database, id)).toMatchObject({
          matchId: id, status: "interrupted", finalLevel: 1, standings: []
        });
        expect(database.prepare("SELECT COUNT(*) AS count FROM match_results WHERE match_id = ?").get(id))
          .toEqual({ count: 1 });
      }
      database.close();
      database = openDatabase(path);
      runMigrations(database);
      expect(reconcileInterruptedMatches(database)).toBe(0);
      expect(getMatchResult(database, finished)).toEqual(original);
      app = createApp(config, database, { ready: true });
      const cookie = await login(app, account.username);
      const result = await app.inject({ url: `/api/v1/matches/${finished}/results`, headers: { cookie } });
      expect(result.statusCode).toBe(200);
      expect(result.json().result).toMatchObject({
        matchId: finished, status: "finished",
        standings: [{ username: account.username, points: 123, kills: 2, deaths: 1 }]
      });
      expect((await app.inject({ url: "/api/v1/sessions", headers: { cookie } })).json().sessions)
        .toEqual([]);
      expect(database.pragma("integrity_check", { simple: true })).toBe("ok");
      expect(database.pragma("foreign_key_check")).toEqual([]);
    } finally {
      if (app) await app.close();
      else if (database.open) database.close();
      rmSync(temporary, { recursive: true, force: true });
    }
  });

  it("isolates a module step exception, saves one failure, releases its metrics and keeps the other runner active", async () => {
    const database = openDatabase(":memory:");
    runMigrations(database);
    const themes = createThemeLoader();
    const lobby = new LobbyRegistry(database, Date.now, themes);
    const metrics = new RuntimeMetrics();
    const errors: unknown[] = [];
    const snapshots = new Map<string, number>();
    const lifecycle = new SessionLifecycle(database, lobby, themes,
      (id, tick) => snapshots.set(id, tick), (error) => errors.push(error), undefined, metrics);
    const failure = new Error("Synthetic module step failure");
    const create = themes.createModuleInstance.bind(themes);
    const disposals: ReturnType<typeof vi.spyOn>[] = [];
    let count = 0;
    const factory = vi.spyOn(themes, "createModuleInstance").mockImplementation((...args) => {
      const module = create(...args);
      disposals.push(vi.spyOn(module, "dispose"));
      if (count++ === 0) vi.spyOn(module, "step").mockImplementation(() => { throw failure; });
      return module;
    });
    try {
      const first = await createAccount(database, "FailureRoomPlayer", password);
      const second = await createAccount(database, "HealthyRoomPlayer", password);
      const failed = lobby.create(first, { settings }).summary.id;
      const healthy = lobby.create(second, { settings }).summary.id;
      for (const [account, id] of [[first, failed], [second, healthy]] as const) {
        lobby.start(account, id, { expectedRevision: 0 });
        await lifecycle.start(id);
        lobby.reconnect.attach(id, account.id);
        lifecycle.setPlayerPresence(id, account.id, "connected");
      }
      await waitUntil(() => getMatchResult(database, failed)?.status === "failed" &&
        (snapshots.get(healthy) ?? 0) >= 4);
      const tick = snapshots.get(healthy)!;
      await waitUntil(() => (snapshots.get(healthy) ?? 0) > tick);
      expect(errors).toEqual([failure]);
      expect(getMatchResult(database, failed)).toMatchObject({ status: "failed", standings: [] });
      expect(database.prepare("SELECT COUNT(*) AS count FROM match_results WHERE match_id = ?").get(failed))
        .toEqual({ count: 1 });
      expect(lobby.getSummary(healthy, second.id)?.status).toBe("running");
      expect(disposals[0]).toHaveBeenCalledTimes(1);
      expect(disposals[1]).not.toHaveBeenCalled();
      expect(lobby.create(first, { settings }).summary.status).toBe("waiting");
      lifecycle.close();
      lifecycle.close();
      expect(disposals[0]).toHaveBeenCalledTimes(1);
      expect(disposals[1]).toHaveBeenCalledTimes(1);
      expect(getMatchResult(database, healthy)?.status).toBe("interrupted");
    } finally {
      lifecycle.close();
      factory.mockRestore();
      metrics.close();
      database.close();
    }
  });

  it("bounds thousands of pending snapshots and rejects reliable overflow without affecting a healthy sender", () => {
    const slow = outgoingSocket();
    const healthy = outgoingSocket();
    const limit = MAX_BUFFERED_OUTGOING_BYTES;
    slow.bufferedAmount = Math.floor(limit * .8);
    const events: string[] = [];
    const sender = new BoundedMessageSender(slow, limit, (event) => events.push(event));
    const other = new BoundedMessageSender(healthy, limit);
    for (let tick = 1; tick <= 2000; tick++) {
      expect(sender.send({ v: 1, type: "server.snapshot", tick, payload: { tick } })).toBe(true);
      expect(sender.bufferedBytes).toBeLessThanOrEqual(limit);
    }
    expect(slow.sent).toHaveLength(0);
    expect(events.filter((event) => event === "droppedSnapshots")).toHaveLength(1999);
    slow.bufferedAmount = 0;
    sender.flushSnapshot();
    expect(slow.sent).toHaveLength(1);
    expect(JSON.parse(slow.sent[0]!).tick).toBe(2000);
    slow.bufferedAmount = limit - 1;
    expect(sender.send({ v: 1, type: "server.event", payload: { required: true } })).toBe(false);
    expect(slow.closeCode).toBe(1013);
    expect(events.filter((event) => event === "slowConsumers")).toHaveLength(1);
    expect(other.send({ v: 1, type: "server.event", payload: { healthy: true } })).toBe(true);
    expect(healthy.closeCode).toBeUndefined();
    expect(healthy.sent).toHaveLength(1);
    expect(sender.send({ v: 1, type: "server.event", payload: { data: "x".repeat(limit) } })).toBe(false);
  });

  it("closes real sockets and SQLite, persists interrupted results, and can reopen after shutdown", async () => {
    const temporary = mkdtempSync(join(tmpdir(), "multiplayer-operations-shutdown-"));
    const path = join(temporary, "game.sqlite");
    const database = openDatabase(path);
    runMigrations(database);
    const readiness = { ready: true };
    const app = createApp(config, database, readiness, { heartbeatIntervalMs: 25 });
    let socket: WebSocket | undefined;
    try {
      const account = await createAccount(database, "ShutdownPlayer", password);
      const cookie = await login(app, account.username);
      const created = await app.inject({ method: "POST", url: "/api/v1/sessions",
        headers: { ...headers, cookie }, payload: { settings } });
      expect(created.statusCode).toBe(201);
      const id = z.string().parse(created.json().session.id);
      expect((await app.inject({ method: "POST", url: `/api/v1/sessions/${id}/start`,
        headers: { ...headers, cookie }, payload: { expectedRevision: 0 } })).statusCode).toBe(200);
      const target = await app.listen({ host: "127.0.0.1", port: 0 });
      expect((await app.inject({ url: "/health/ready" })).statusCode).toBe(200);
      const client = new WebSocket(`${target.replace(/^http/, "ws")}/ws?sessionId=${id}`,
        { headers: { origin: ORIGIN, cookie } });
      socket = client;
      const snapshot = new Promise<void>((resolveSnapshot, reject) => {
        const timeout = setTimeout(() => reject(new Error("No shutdown fixture snapshot.")), 2000);
        client.on("message", (data) => {
          if (JSON.parse(data.toString()).type === "server.snapshot") {
            clearTimeout(timeout);
            resolveSnapshot();
          }
        });
        client.once("error", (error) => { clearTimeout(timeout); reject(error); });
      });
      await snapshot;
      const closed = new Promise<void>((resolveClose) => client.once("close", () => resolveClose()));
      readiness.ready = false;
      expect((await app.inject({ url: "/health/ready" })).statusCode).toBe(503);
      await app.close();
      await closed;
      expect(client.readyState).toBe(WebSocket.CLOSED);
      expect(database.open).toBe(false);
      expect(readiness.ready).toBe(false);
      const reopened = openDatabase(path);
      try {
        runMigrations(reopened);
        expect(reconcileInterruptedMatches(reopened)).toBe(0);
        expect(getMatchResult(reopened, id)).toMatchObject({ status: "interrupted", standings: [] });
        expect(await verifyCredentials(reopened, account.username, password)).toEqual(account);
        expect(reopened.prepare("SELECT COUNT(*) AS count FROM match_results WHERE match_id = ?").get(id))
          .toEqual({ count: 1 });
      } finally { reopened.close(); }
    } finally {
      socket?.terminate();
      await app.close();
      rmSync(temporary, { recursive: true, force: true });
    }
  });

  it("executes the actual load CLI once against a disposable loopback server", async () => {
    const temporary = mkdtempSync(join(tmpdir(), "multiplayer-operations-smoke-"));
    const database = openDatabase(":memory:");
    runMigrations(database);
    const app = createApp(config, database, { ready: true });
    try {
      const target = await app.listen({ host: "127.0.0.1", port: 0 });
      expect((await fetch(`${target}/health/ready`)).status).toBe(200);
      const workload = join(temporary, "workload.json");
      const output = join(temporary, "report.json");
      writeFileSync(workload, JSON.stringify({
        target, origin: ORIGIN, seed: 41, playersPerRoom: 1, spectatorsPerRoom: 1,
        registrationIntervalMs: 0, warmupSeconds: .2,
        steps: [{ rooms: 1, seconds: .3 }, { rooms: 2, seconds: .3 }], soakSeconds: .3,
        settings
      }));
      let result: { stdout: string; stderr: string };
      try {
        result = await promisify(execFile)(process.execPath, [
          "--import", "tsx", resolve("tools", "load", "index.ts"),
          "--authorized", "--config", workload, "--output", output
        ], { cwd: process.cwd(), timeout: 15_000 });
      } catch (error) {
        throw new Error(`Load CLI failed: ${String(error)}`, { cause: error });
      }
      expect(result.stderr).toBe("");
      const report = z.object({
        status: z.literal("completed"), failures: z.array(z.string()).length(0),
        cleanupFailures: z.array(z.string()).length(0),
        rooms: z.array(z.object({ id: z.string() })).length(2),
        phases: z.array(z.object({
          name: z.string(), clients: z.array(z.object({
            snapshots: z.number().positive(), bytesIn: z.number().positive(),
            role: z.enum(["player", "spectator"]), movingActions: z.number(),
            firingActions: z.number(), rtt: z.object({ samples: z.number() })
          }))
        })).length(5)
      }).parse(JSON.parse(readFileSync(output, "utf8")));
      expect(new Set(report.rooms.map((room) => room.id)).size).toBe(2);
      const step = report.phases.find((phase) => phase.name === "step-2");
      if (!step) throw new Error("Smoke report has no second measured step.");
      expect(step.clients).toHaveLength(4);
      for (const client of step.clients.filter((value) => value.role === "player")) {
        expect(client.movingActions).toBeGreaterThan(0);
        expect(client.firingActions).toBeGreaterThan(0);
      }
      expect(report.phases.some((phase) => phase.clients.some((client) => client.rtt.samples > 0)))
        .toBe(true);
      expect(database.prepare("SELECT COUNT(*) AS count FROM auth_sessions WHERE revoked_at IS NULL").get())
        .toEqual({ count: 0 });
    } finally {
      await app.close();
      rmSync(temporary, { recursive: true, force: true });
    }
  }, 20_000);
});

async function login(app: ReturnType<typeof createApp>, username: string): Promise<string> {
  const response = await app.inject({ method: "POST", url: "/api/v1/auth/login",
    headers, payload: { username, password } });
  expect(response.statusCode).toBe(200);
  const header = response.headers["set-cookie"];
  const cookie = Array.isArray(header) ? header[0] : header;
  if (!cookie) throw new Error("Operations login returned no cookie.");
  return cookie.split(";", 1)[0]!;
}

async function waitUntil(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 2000;
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error("Operations condition timed out.");
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
}

function outgoingSocket() {
  return {
    readyState: Number(WebSocket.OPEN), bufferedAmount: 0, sent: [] as string[],
    closeCode: undefined as number | undefined,
    send(data: string) { this.sent.push(data); this.bufferedAmount += Buffer.byteLength(data) + 10; },
    close(code?: number) { this.closeCode = code; this.readyState = WebSocket.CLOSED; }
  };
}
