import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_GAME_SETTINGS } from "@multiplayer-game/protocol";
import { createApp } from "../../apps/server/src/app.js";
import { readConfig } from "../../apps/server/src/config.js";
import { issueSession } from "../../apps/server/src/auth/sessions.js";
import { LobbyRegistry } from "../../apps/server/src/lobby/registry.js";
import { ThemeLoader } from "../../apps/server/src/themes/builtins.js";
import { openDatabase, runMigrations } from "../../apps/server/src/storage/database.js";

const ORIGIN = "https://game.example.test";

describe("host-ended sessions", () => {
  it.each(["host-first", "completion-first", "intermission", "level-two"] as const)(
    "authorizes, saves current standings and finalizes once (%s)", async order => {
      const directory = mkdtempSync(join(tmpdir(), "end-session-"));
      const databasePath = join(directory, "game.sqlite");
      const database = openDatabase(databasePath);
      runMigrations(database);
      const credentials = (username: string, role = "player") => {
        const id = randomUUID();
        database.prepare(`INSERT INTO accounts
          (id, username, normalized_username, password_hash, password_salt, role, created_at)
          VALUES (?, ?, ?, 'test-hash', 'test-salt', ?, '2026-11-08T00:00:00Z')`)
          .run(id, username, username.toLowerCase(), role);
        return { id, cookie: `mp_session=${issueSession(database, id).token}` };
      };
      const host = credentials("EndHost");
      const member = credentials("EndMember");
      const observer = credentials("EndObserver");
      const outsider = credentials("EndOutsider");
      const operator = credentials("EndOperator", "operator");
      let now = 0;
      let complete = false;
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
      vi.spyOn(performance, "now").mockImplementation(() => now);
      const original = ThemeLoader.prototype.createModuleInstance;
      const disposed = vi.fn();
      vi.spyOn(ThemeLoader.prototype, "createModuleInstance").mockImplementation(function (
        this: ThemeLoader, ...args
      ) {
        const module = original.apply(this, args);
        const context = args[1];
        const initialize = module.initialize.bind(module);
        module.initialize = async () => {
          await initialize();
          context.entities.update(`player:${host.id}`, entity => ({
            ...entity, state: { ...entity.state, points: 275, kills: 3, deaths: 2 }
          }));
        };
        const step = module.step.bind(module);
        module.step = (dt, tick) => {
          if (complete || order === "intermission" ||
            (order === "level-two" && module.state.level === 1)) {
            for (const entity of context.entities.values()) {
              if (entity.state.kind === "npc") context.entities.remove(entity.id);
            }
          }
          step(dt, tick);
        };
        const dispose = module.dispose.bind(module);
        module.dispose = () => { disposed(); dispose(); };
        return module;
      });
      const finalize = vi.spyOn(LobbyRegistry.prototype, "finalizeFinishedMatch");
      const app = createApp(readConfig({ NODE_ENV: "test", PUBLIC_ORIGIN: ORIGIN }),
        database, { ready: true });
      const post = (url: string, cookie?: string, payload: unknown = {}, origin = ORIGIN) =>
        app.inject({ method: "POST", url,
          headers: { "content-type": "application/json", origin, ...(cookie ? { cookie } : {}) },
          payload });
      try {
        const created = await post("/api/v1/sessions", host.cookie, { settings: {
          ...DEFAULT_GAME_SETTINGS, maxPlayers: 2, maxSpectators: 1,
          initialNpcsPerPlayer: 1, npcMovementSpeed: 0,
          maxLevels: order === "intermission" || order === "level-two" ? 2 : 1
        } });
        expect(created.statusCode).toBe(201);
        const id = created.json().session.id as string;
        const endUrl = `/api/v1/sessions/${id}/end`;
        expect((await post(endUrl, host.cookie)).statusCode).toBe(409);
        expect((await post(`/api/v1/sessions/${id}/join`, member.cookie)).statusCode).toBe(200);
        expect((await post(`/api/v1/sessions/${id}/start`, host.cookie,
          { expectedRevision: 0 })).statusCode).toBe(200);
        expect((await post(`/api/v1/sessions/${id}/spectate`, observer.cookie)).statusCode).toBe(200);
        expect((await post(endUrl)).statusCode).toBe(401);
        expect((await post(endUrl, host.cookie, {}, "https://untrusted.example")).statusCode).toBe(403);
        expect((await post(endUrl, host.cookie, { finalLevel: 10 })).statusCode).toBe(400);
        for (const account of [member, observer, outsider, operator]) {
          const denied = await post(endUrl, account.cookie);
          expect(denied.statusCode).toBe(403);
          expect(denied.json().error.code).toBe("FORBIDDEN");
        }
        expect(finalize).not.toHaveBeenCalled();
        if (order === "completion-first" || order === "intermission" || order === "level-two") {
          complete = order === "completion-first";
          now = 100;
          vi.advanceTimersByTime(100);
          expect(database.prepare("SELECT state, current_level FROM matches WHERE id = ?").get(id))
            .toEqual({ state: order === "completion-first" ? "finished" : "running", current_level: 1 });
          if (order === "level-two") {
            for (let tick = 0; tick < 155; tick++) {
              now += 34;
              vi.advanceTimersByTime(34);
            }
            expect(database.prepare("SELECT state, current_level FROM matches WHERE id = ?").get(id))
              .toEqual({ state: "running", current_level: 2 });
          }
        } else {
          complete = true;
        }
        const responses = await Promise.all([post(endUrl, host.cookie), post(endUrl, host.cookie)]);
        expect(responses.map(response => response.statusCode)).toEqual([200, 200]);
        const saved = responses[0]!.json();
        expect(saved).toEqual(responses[1]!.json());
        expect(saved.result).toMatchObject({
          matchId: id, status: "finished", finalLevel: order === "level-two" ? 2 : 1,
          standings: [
            { accountId: host.id, points: 275, kills: 3, deaths: 2, rank: 1 },
            { accountId: member.id, points: 0, kills: 0, deaths: 0, rank: 2 }
          ]
        });
        now = 10_000;
        vi.advanceTimersByTime(10_000);
        expect(finalize).toHaveBeenCalledTimes(1);
        expect(disposed).toHaveBeenCalledTimes(1);
        expect(database.prepare("SELECT COUNT(*) AS count FROM match_results WHERE match_id = ?").get(id))
          .toEqual({ count: 1 });
        expect((await post(endUrl, outsider.cookie)).statusCode).toBe(403);
        for (const account of [host, member, observer]) {
          expect((await app.inject({ url: `/api/v1/matches/${id}/results`,
            headers: { cookie: account.cookie } })).json()).toEqual(saved);
        }
        expect((await app.inject({ url: "/api/v1/sessions",
          headers: { cookie: host.cookie } })).json().sessions).toEqual([]);
        expect((await app.inject({ url: `/api/v1/sessions/${id}`,
          headers: { cookie: host.cookie } })).json().session.spectatorCount).toBe(0);
        expect((await post("/api/v1/sessions", host.cookie,
          { settings: DEFAULT_GAME_SETTINGS })).statusCode).toBe(201);
        await app.close();
        const reloadedDatabase = openDatabase(databasePath);
        runMigrations(reloadedDatabase);
        const reloadedApp = createApp(
          readConfig({ NODE_ENV: "test", PUBLIC_ORIGIN: ORIGIN }), reloadedDatabase, { ready: true });
        try {
          expect((await reloadedApp.inject({ url: `/api/v1/matches/${id}/results`,
            headers: { cookie: host.cookie } })).json()).toEqual(saved);
        } finally {
          await reloadedApp.close();
        }
      } finally {
        await app.close();
        vi.restoreAllMocks();
        vi.useRealTimers();
        if (database.open) database.close();
        rmSync(directory, { recursive: true, force: true });
      }
    }
  );
});
