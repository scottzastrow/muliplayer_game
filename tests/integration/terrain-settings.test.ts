import { describe, expect, it } from "vitest";
import { DEFAULT_GAME_SETTINGS, type TerrainDensitySchedule } from "@multiplayer-game/protocol";
import { createApp } from "../../apps/server/src/app.js";
import { readConfig } from "../../apps/server/src/config.js";
import { openDatabase, runMigrations } from "../../apps/server/src/storage/database.js";

describe("saved terrain settings", () => {
  it("round-trips both schedules, rejects changed level counts and preserves legacy settings", async () => {
    const database = openDatabase(":memory:");
    runMigrations(database);
    const origin = "https://game.example.test";
    const headers = { origin, "content-type": "application/json" };
    const app = createApp(readConfig({ NODE_ENV: "test", PUBLIC_ORIGIN: origin }), database, { ready: true });
    try {
      const registered = await app.inject({ method: "POST", url: "/api/v1/auth/register", headers,
        payload: { username: "TerrainHost", password: "a secure terrain test password", controlMode: "keyboard-only" } });
      expect(registered.statusCode).toBe(201);
      const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", headers,
        payload: { username: "TerrainHost", password: "a secure terrain test password" } });
      expect(login.statusCode).toBe(200);
      const cookies = login.headers["set-cookie"];
      const cookie = (Array.isArray(cookies) ? cookies[0] : cookies)!.split(";")[0]!;
      const authorized = { ...headers, cookie };
      const schedules: TerrainDensitySchedule[] = [
        { mode: "incremental", startingDensity: 3, increasePerLevel: 0 },
        { mode: "per-level", densities: [0, 3, 10] }
      ];
      for (const terrainDensity of schedules) {
        const settings = { ...DEFAULT_GAME_SETTINGS, mapMode: "simple-generated", maxLevels: 3, terrainDensity };
        const created = await app.inject({ method: "POST", url: "/api/v1/sessions", headers: authorized,
          payload: { settings } });
        expect(created.statusCode).toBe(201);
        const id = created.json().session.id as string;
        const read = await app.inject({ url: `/api/v1/sessions/${id}`, headers: authorized });
        expect(read.json().settings).toEqual(settings);
        const stored = database.prepare("SELECT settings_json FROM matches WHERE id = ?").get(id) as { settings_json: string };
        expect(JSON.parse(stored.settings_json)).toEqual(settings);
        if (terrainDensity.mode === "per-level") {
          const rejected = await app.inject({ method: "PATCH", url: `/api/v1/sessions/${id}/settings`,
            headers: authorized, payload: { settings: { ...settings, maxLevels: 4 }, expectedRevision: 0 } });
          expect(rejected.statusCode).toBe(422);
          expect(JSON.stringify(rejected.json())).toContain("one density per configured level");
          expect(database.prepare("SELECT settings_json FROM matches WHERE id = ?").get(id)).toEqual(stored);
        }
      }
      const legacy = await app.inject({ method: "POST", url: "/api/v1/sessions", headers: authorized,
        payload: { settings: { ...DEFAULT_GAME_SETTINGS, baseNpcHealth: 100 } } });
      expect(legacy.statusCode).toBe(201);
      const legacyId = legacy.json().session.id as string;
      const read = await app.inject({ url: `/api/v1/sessions/${legacyId}`, headers: authorized });
      expect(read.json().settings).toEqual({ ...DEFAULT_GAME_SETTINGS, baseNpcHealth: 100 });
      const explicitNoSchedule = await app.inject({ method: "POST", url: "/api/v1/sessions", headers: authorized,
        payload: { settings: { ...DEFAULT_GAME_SETTINGS, mapMode: "simple-generated" } } });
      expect(explicitNoSchedule.statusCode).toBe(201);
      expect((await app.inject({ url: `/api/v1/sessions/${explicitNoSchedule.json().session.id}`,
        headers: authorized })).json().settings).not.toHaveProperty("terrainDensity");
    } finally {
      await app.close();
    }
  });
});
