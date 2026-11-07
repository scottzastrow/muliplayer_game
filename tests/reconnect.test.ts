import { describe, expect, it } from "vitest";
import { ReconnectRegistry } from "../apps/server/src/lobby/reconnect.js";
import { DEFAULT_GAME_SETTINGS } from "@multiplayer-game/protocol";
import { LobbyRegistry } from "../apps/server/src/lobby/registry.js";
import { SessionLifecycle } from "../apps/server/src/runtime/session-lifecycle.js";
import { createThemeLoader } from "../apps/server/src/themes/builtins.js";
import { openDatabase, runMigrations } from "../apps/server/src/storage/database.js";

describe("account-bound reconnect reservations", () => {
  it("expires at sixty seconds without extending deadlines through repeated admission", () => {
    let now = 0;
    const registry = new ReconnectRegistry(() => now);
    registry.start("room", ["alice", "bob"]);
    const connection = registry.attach("room", "alice");
    registry.detach("room", "alice", connection);
    now = 59_999;
    registry.rejoin("room", "alice");
    registry.rejoin("room", "alice");
    expect(registry.canUpgrade("room", "alice")).toBe(true);
    expect(registry.eligible("other", "alice")).toBe(false);
    expect(() => registry.rejoin("room", "outsider")).toThrow();
    now = 60_000;
    expect(registry.expire("room")).toEqual(["alice", "bob"]);
    expect(() => registry.rejoin("room", "alice")).toThrow();
    expect(registry.abandoned("room")).toBe(true);
  });
  it("ignores stale closes, forfeits explicit leave and keeps an empty deadline despite spectators", () => {
    let now = 0;
    const registry = new ReconnectRegistry(() => now);
    registry.start("room", ["alice"]);
    const old = registry.attach("room", "alice");
    const current = registry.attach("room", "alice");
    expect(registry.detach("room", "alice", old)).toBe(false);
    expect(registry.connected("room", "alice")).toBe(true);
    now = 10;
    registry.detach("room", "alice", current);
    expect(registry.canUpgrade("room", "alice")).toBe(false);
    registry.rejoin("room", "alice");
    registry.attach("room", "alice");
    registry.forfeit("room", "alice");
    expect(() => registry.rejoin("room", "alice")).toThrow();
    now = 60_010;
    expect(registry.abandoned("room")).toBe(true);
  });

  it("abandons an empty running room after sixty seconds even with an observer and releases its runner and slot", async () => {
    let now = 0;
    const database = openDatabase(":memory:");
    runMigrations(database);
    for (const id of ["owner", "observer"]) {
      database.prepare(`INSERT INTO accounts
        (id, username, normalized_username, password_hash, password_salt, created_at)
        VALUES (?, ?, ?, 'unused-test-hash', 'unused-test-salt', ?)`)
        .run(id, id, id, new Date(0).toISOString());
    }
    const themes = createThemeLoader();
    const lobby = new LobbyRegistry(database, () => now, themes);
    const errors: unknown[] = [];
    const lifecycle = new SessionLifecycle(database, lobby, themes, () => {}, error => errors.push(error));
    try {
      const account = { id: "owner", username: "owner", role: "player" as const };
      const { summary } = lobby.create(account, { settings: DEFAULT_GAME_SETTINGS });
      lobby.start(account, summary.id, { expectedRevision: 0 });
      await lifecycle.start(summary.id);
      lobby.spectators.admit(summary.id, "observer");
      expect(lobby.getSummary(summary.id, "owner")?.spectatorCount).toBe(1);
      now = 59_999;
      await new Promise(resolve => setTimeout(resolve, 70));
      expect(lobby.getSummary(summary.id, "owner")?.status).toBe("running");
      now = 60_000;
      await new Promise(resolve => setTimeout(resolve, 70));
      expect(lobby.getSummary(summary.id, "owner")).toMatchObject({ status: "abandoned", spectatorCount: 0 });
      expect(lobby.list("owner")).toHaveLength(0);
      expect(lifecycle.playerLives(summary.id).size).toBe(0);
      expect(lobby.reconnect.eligible(summary.id, "owner")).toBe(false);
      expect(database.prepare("SELECT COUNT(*) AS count FROM match_participants WHERE match_id = ?").get(summary.id))
        .toEqual({ count: 1 });
      expect(errors).toEqual([]);
    } finally {
      lifecycle.close();
      database.close();
    }
  });
});
