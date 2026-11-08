import { describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { DEFAULT_GAME_SETTINGS } from "@multiplayer-game/protocol";
import { createApp } from "../../apps/server/src/app.js";
import { readConfig } from "../../apps/server/src/config.js";
import { openDatabase, runMigrations } from "../../apps/server/src/storage/database.js";
import type { RuntimeMetrics } from "../../apps/server/src/runtime/metrics.js";

type MetricsSnapshot = ReturnType<RuntimeMetrics["snapshot"]>;
const ORIGIN = "https://metrics.example.test";
const HEADERS = { origin: ORIGIN, "content-type": "application/json" };

describe("operator metrics API", () => {
  it("rejects normal accounts and exports measured runner/transport/host state without secrets", async () => {
    const database = openDatabase(":memory:");
    runMigrations(database);
    const app = createApp(readConfig({ NODE_ENV: "test", PUBLIC_ORIGIN: ORIGIN }),
      database, { ready: true }, { heartbeatIntervalMs: 20 });
    let socket: WebSocket | undefined;
    try {
      const playerCookie = await registerLogin("MetricsPlayer", false);
      const cookie = await registerLogin("MetricsOperator", true);
      expect((await app.inject({ url: "/api/v1/admin/metrics" })).statusCode).toBe(401);
      expect((await app.inject({
        url: "/api/v1/admin/metrics", headers: { cookie: playerCookie }
      })).statusCode).toBe(403);
      const created = await app.inject({
        method: "POST", url: "/api/v1/sessions", headers: { ...HEADERS, cookie },
        payload: {
          settings: { ...DEFAULT_GAME_SETTINGS, maxPlayers: 1, initialNpcsPerPlayer: 2, maxLevels: 1 }
        }
      });
      expect(created.statusCode).toBe(201);
      const id = created.json().session.id as string;
      expect((await app.inject({
        method: "POST", url: `/api/v1/sessions/${id}/start`, headers: { ...HEADERS, cookie },
        payload: { expectedRevision: 0 }
      })).statusCode).toBe(200);
      const address = await app.listen({ host: "127.0.0.1", port: 0 });
      socket = new WebSocket(`${address.replace("http:", "ws:")}/ws?sessionId=${id}`, {
        headers: { origin: ORIGIN, cookie }
      });
      await new Promise<void>((resolve, reject) => {
        socket!.once("open", resolve); socket!.once("error", reject);
      });
      socket.send(JSON.stringify({ v: 1, type: "client.ping", payload: { nonce: "metrics-probe" } }));
      await new Promise((resolve) => setTimeout(resolve, 180));
      const response = await app.inject({ url: "/api/v1/admin/metrics", headers: { cookie } });
      expect(response.statusCode).toBe(200);
      expect(response.headers["cache-control"]).toBe("no-store");
      const exported = response.json<MetricsSnapshot>();
      expect(exported.sessions).toHaveLength(1);
      const session = exported.sessions[0];
      if (!session) throw new Error("Metrics export has no active session.");
      expect(session.id).toBe(id);
      expect(session.entities).toBeGreaterThan(0);
      expect(session.simulation.count).toBeGreaterThan(0);
      expect(session.snapshot.count).toBeGreaterThan(0);
      expect(session.rtt.count).toBeGreaterThan(0);
      expect(session.bytesIn).toBeGreaterThan(0);
      expect(session.bytesOut).toBeGreaterThan(0);
      expect(session.players).toBe(1);
      expect(exported.host.connections).toBe(1);
      expect(exported.host.rssBytes).toBeGreaterThan(0);
      expect(exported.host.cpuUserMs + exported.host.cpuSystemMs).toBeGreaterThan(0);
      expect(exported.host.eventLoopDelay.samples).toBeGreaterThan(0);
      expect(JSON.stringify(exported)).not.toMatch(/MetricsOperator|MetricsPlayer|password|token|cookie/i);
      socket.terminate();
      await new Promise((resolve) => setTimeout(resolve, 30));
      const after = (await app.inject({ url: "/api/v1/admin/metrics", headers: { cookie } }))
        .json<MetricsSnapshot>();
      expect(after.host.connections).toBe(0);
      expect(after.host.disconnects).toBeGreaterThan(0);
    } finally {
      socket?.terminate();
      await app.close();
    }

    async function registerLogin(username: string, operator: boolean): Promise<string> {
      const password = "test-only metrics password 123";
      const registered = await app.inject({
        method: "POST", url: "/api/v1/auth/register", headers: HEADERS,
        payload: { username, password, controlMode: "keyboard-mouse" }
      });
      expect(registered.statusCode).toBe(201);
      if (operator) database.prepare("UPDATE accounts SET role = 'operator' WHERE id = ?")
        .run(registered.json().account.id);
      const login = await app.inject({
        method: "POST", url: "/api/v1/auth/login", headers: HEADERS, payload: { username, password }
      });
      expect(login.statusCode).toBe(200);
      const header = login.headers["set-cookie"];
      const cookie = (Array.isArray(header) ? header[0] : header)?.split(";", 1)[0];
      if (!cookie) throw new Error("Login did not set a cookie.");
      return cookie;
    }
  });
});
