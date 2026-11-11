import { describe, expect, it } from "vitest";
import { DEFAULT_GAME_SETTINGS } from "@multiplayer-game/protocol";
import { createApp } from "../../apps/server/src/app.js";
import { readConfig } from "../../apps/server/src/config.js";
import { openDatabase, runMigrations } from "../../apps/server/src/storage/database.js";
import { runLoad } from "../../tools/load/index.js";

describe("external protocol load harness", () => {
  it("uses real HTTP and sockets for stepped independent players and a spectator", async () => {
    const database = openDatabase(":memory:");
    runMigrations(database);
    const origin = "http://load.example.test";
    const app = createApp(readConfig({ NODE_ENV: "test", PUBLIC_ORIGIN: origin }), database, { ready: true });
    try {
      const target = await app.listen({ host: "127.0.0.1", port: 0 });
      const report = await runLoad({
        target, origin, seed: 42, playersPerRoom: 1, spectatorsPerRoom: 1,
        registrationIntervalMs: 0, warmupSeconds: .1,
        steps: [{ rooms: 1, seconds: .25 }, { rooms: 2, seconds: .25 }], soakSeconds: .15,
        settings: {
          ...DEFAULT_GAME_SETTINGS, maxPlayers: 1, maxSpectators: 1,
          initialNpcsPerPlayer: 2, baseNpcHealth: 100000, maxLevels: 1
        }
      });
      expect(report.failures).toEqual([]);
      expect(report.cleanupFailures).toEqual([]);
      expect(report.status).toBe("completed");
      expect(report.rooms).toHaveLength(2);
      expect(new Set(report.rooms.map(({ id }) => id)).size).toBe(2);
      expect(report.phases.map(({ name }) => name)).toEqual([
        "warmup-1", "step-1", "warmup-2", "step-2", "soak"
      ]);
      const step = report.phases.find(({ name }) => name === "step-2");
      if (!step) throw new Error("Missing measured step.");
      expect(step.clients).toHaveLength(4);
      for (const room of report.rooms) {
        expect(room.mapFingerprint).toMatch(/^[a-f0-9]{64}$/);
        expect(room.pinnedTheme?.revision).toBe("default@1.0.0");
      }
      for (const client of step.clients) {
        expect(client.bytesIn).toBeGreaterThan(0);
        expect(client.snapshots).toBeGreaterThan(0);
        if (client.role === "player") {
          expect(client.movingActions).toBeGreaterThan(0);
          expect(client.firingActions).toBeGreaterThan(0);
        } else expect(client.actions).toBe(0);
      }
      expect(report.phases.some((phase) => phase.clients.some((client) => client.rtt.samples > 0))).toBe(true);
      expect(JSON.stringify(report)).not.toMatch(/password|cookie|Load_[a-f0-9]+/);
      expect(database.prepare("SELECT COUNT(*) AS count FROM auth_sessions WHERE revoked_at IS NULL").get())
        .toEqual({ count: 0 });
    } finally { await app.close(); }
  }, 15_000);

  it("reports HTTP failures instead of success-shaped results", async () => {
    const database = openDatabase(":memory:");
    runMigrations(database);
    const app = createApp(readConfig({ NODE_ENV: "test", PUBLIC_ORIGIN: "https://allowed.example.test" }),
      database, { ready: true });
    try {
      const target = await app.listen({ host: "127.0.0.1", port: 0 });
      const report = await runLoad({
        target, seed: 1, playersPerRoom: 1, spectatorsPerRoom: 0, registrationIntervalMs: 0,
        warmupSeconds: 0, steps: [{ rooms: 1, seconds: .1 }], soakSeconds: 0,
        settings: DEFAULT_GAME_SETTINGS
      });
      expect(report.status).toBe("failed");
      expect(report.failures).toEqual([
        "/auth/register: HTTP 403 FORBIDDEN: This request must come from the configured origin."
      ]);
      expect(report.rooms).toEqual([]);
    } finally { await app.close(); }
  });
});
