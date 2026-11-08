import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { DEFAULT_GAME_SETTINGS, MatchResultSchema } from "@multiplayer-game/protocol";
import { createApp } from "../../apps/server/src/app.js";
import { readConfig } from "../../apps/server/src/config.js";
import { issueSession } from "../../apps/server/src/auth/sessions.js";
import { LobbyRegistry } from "../../apps/server/src/lobby/registry.js";
import { SessionLifecycle } from "../../apps/server/src/runtime/session-lifecycle.js";
import { createThemeLoader } from "../../apps/server/src/themes/builtins.js";
import { openDatabase, runMigrations } from "../../apps/server/src/storage/database.js";
import { getMatchResult } from "../../apps/server/src/storage/results.js";

describe("wave timeout finalization", () => {
  it.each([false, true])("saves standings and releases once on timeout (duplicate completion: %s)", async duplicate => {
    const database = openDatabase(":memory:");
    runMigrations(database);
    const account = { id: randomUUID(), username: "TimeoutPlayer", role: "player" as const };
    database.prepare(
      `INSERT INTO accounts
       (id, username, normalized_username, password_hash, password_salt, role, created_at)
       VALUES (?, ?, ?, 'test-hash', 'test-salt', 'player', '2026-11-07T00:00:00Z')`
    ).run(account.id, account.username, account.username.toLowerCase());
    let now = 0;
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const clock = vi.spyOn(performance, "now").mockImplementation(() => now);
    const themes = createThemeLoader();
    const lobby = new LobbyRegistry(database, () => now, themes);
    const publishResult = vi.fn();
    const reportError = vi.fn();
    const publishSnapshot = vi.fn();
    const lifecycle = new SessionLifecycle(
      database, lobby, themes, publishSnapshot, reportError, publishResult
    );
    const create = themes.createModuleInstance.bind(themes);
    const disposed = vi.fn();
    const requests = vi.fn();
    const factory = vi.spyOn(themes, "createModuleInstance").mockImplementation(
      (revision, context, settings, roster, seed, digest) => {
        const module = create(revision, {
          ...context,
          requestCompletion: request => {
            requests(request);
            context.requestCompletion(request);
            if (duplicate) context.requestCompletion(request);
          }
        }, settings, roster, seed, digest);
        const initialize = module.initialize.bind(module);
        module.initialize = async () => {
          await initialize();
          context.entities.update(`player:${account.id}`, entity => ({
            ...entity, state: { ...entity.state, points: 275, kills: 3, deaths: 2 }
          }));
        };
        const dispose = module.dispose.bind(module);
        module.dispose = () => { disposed(); dispose(); };
        return module;
      }
    );
    const finalize = vi.spyOn(lobby, "finalizeFinishedMatch");
    let app: ReturnType<typeof createApp> | undefined;
    try {
      const settings = { ...DEFAULT_GAME_SETTINGS, maxPlayers: 1, initialNpcsPerPlayer: 1, maxLevels: 2 };
      const id = lobby.create(account, { settings }).summary.id;
      lobby.start(account, id, { expectedRevision: 0 });
      await lifecycle.start(id);
      lobby.reconnect.attach(id, account.id);
      lifecycle.setPlayerPresence(id, account.id, "connected");

      now = 125_960;
      vi.advanceTimersByTime(34);
      expect(getMatchResult(database, id)).toBeUndefined();
      now = 126_000;
      vi.advanceTimersByTime(34);
      expect(getMatchResult(database, id)).toMatchObject({
        status: "finished", finalLevel: 1,
        standings: [{ accountId: account.id, points: 275, kills: 3, deaths: 2, rank: 1 }]
      });
      expect(requests).toHaveBeenCalledExactlyOnceWith({ kind: "match", reason: "wave-timeout" });
      expect(finalize).toHaveBeenCalledTimes(1);
      expect(disposed).toHaveBeenCalledTimes(1);
      expect(publishResult).toHaveBeenCalledTimes(1);
      expect(publishResult.mock.calls[0]?.[0]).toBe(id);
      expect(publishSnapshot).toHaveBeenCalled();
      const saved = getMatchResult(database, id);
      now = 133_000;
      vi.advanceTimersByTime(1000);
      expect(getMatchResult(database, id)).toEqual(saved);
      expect(database.prepare("SELECT COUNT(*) AS count FROM match_results WHERE match_id = ?").get(id))
        .toEqual({ count: 1 });
      expect(finalize).toHaveBeenCalledTimes(1);
      expect(publishResult).toHaveBeenCalledTimes(1);
      expect(disposed).toHaveBeenCalledTimes(1);
      expect(reportError).not.toHaveBeenCalled();
      expect(database.prepare("SELECT COUNT(*) AS count FROM matches WHERE state IN ('waiting', 'running')").get())
        .toEqual({ count: 0 });
      expect(lobby.reconnect.connected(id, account.id)).toBe(false);
      expect(lobby.create(account, { settings }).summary.status).toBe("waiting");
      app = createApp(
        readConfig({ NODE_ENV: "test", PUBLIC_ORIGIN: "https://game.example.test" }),
        database, { ready: true }
      );
      const { token } = issueSession(database, account.id);
      const response = await app.inject({
        url: `/api/v1/matches/${id}/results`, headers: { cookie: `mp_session=${token}` }
      });
      expect(response.statusCode).toBe(200);
      expect(MatchResultSchema.parse(response.json().result)).toEqual(saved);
      expect((await app.inject({
        url: `/api/v1/matches/${id}/results`, headers: { cookie: `mp_session=${token}` }
      })).json()).toEqual(response.json());
    } finally {
      lifecycle.close();
      if (app) await app.close();
      finalize.mockRestore();
      factory.mockRestore();
      clock.mockRestore();
      vi.useRealTimers();
      if (database.open) database.close();
    }
  });
});
