import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_GAME_SETTINGS } from "@multiplayer-game/protocol";
import { createApp } from "../../apps/server/src/app.js";
import { readConfig } from "../../apps/server/src/config.js";
import { openDatabase, runMigrations } from "../../apps/server/src/storage/database.js";

const ORIGIN = "https://fixture.example.test";
const BASE_HEADERS = { origin: ORIGIN, "content-type": "application/json" };
const database = openDatabase(":memory:");
runMigrations(database);
const app = createApp(
  readConfig({ NODE_ENV: "test", PUBLIC_ORIGIN: ORIGIN }),
  database,
  { ready: true }
);

describe("fixture theme session integration", () => {
  afterEach(async () => {
    await app.close();
  });

  it("runs the fixture and Dots and Squares in distinct pinned sessions", async () => {
    const cookie = await registerLogin();
    const sessions: Array<{ id: string; revision: string }> = [];
    for (const revision of ["default@1.0.0", "fixture@1.0.0"]) {
      const created = await app.inject({
        method: "POST",
        url: "/api/v1/sessions",
        headers: { ...BASE_HEADERS, cookie },
        payload: {
          settings: {
            ...DEFAULT_GAME_SETTINGS,
            maxPlayers: 1,
            maxSpectators: 0,
            initialNpcsPerPlayer: 1,
            npcPopulationGrowthPercent: 0,
            maxLevels: 1,
            themeRevision: revision
          }
        }
      });
      expect(created.statusCode).toBe(201);
      const sessionId = created.json().session.id as string;
      const started = await app.inject({
        method: "POST",
        url: `/api/v1/sessions/${sessionId}/start`,
        headers: { ...BASE_HEADERS, cookie },
        payload: { expectedRevision: 0 }
      });
      expect(started.statusCode).toBe(200);
      expect(started.json().session.status).toBe("running");

      const row = database.prepare(
        "SELECT state, settings_json, theme_digest FROM matches WHERE id = ?"
      ).get(sessionId) as {
        state: string;
        settings_json: string;
        theme_digest: string;
      } | undefined;
      if (!row) throw new Error(`Started session ${sessionId} was not persisted.`);
      expect(row.state).toBe("running");
      expect(JSON.parse(row.settings_json)).toMatchObject({ themeRevision: revision });
      expect(row.theme_digest).toMatch(/^[a-f0-9]{64}$/);
      sessions.push({ id: sessionId, revision });
    }

    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(sessions.map(({ id }) =>
      (database.prepare("SELECT state FROM matches WHERE id = ?").get(id) as { state: string }).state
    )).toEqual(["running", "running"]);
    expect(sessions.map(({ revision }) => revision)).toEqual([
      "default@1.0.0",
      "fixture@1.0.0"
    ]);
  });

  async function registerLogin(): Promise<string> {
    const registration = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      headers: BASE_HEADERS,
      payload: { username: "FixtureOperator", password: "correct horse battery staple 123" }
    });
    expect(registration.statusCode).toBe(201);
    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: BASE_HEADERS,
      payload: { username: "FixtureOperator", password: "correct horse battery staple 123" }
    });
    expect(login.statusCode).toBe(200);
    const header = login.headers["set-cookie"];
    const value = Array.isArray(header) ? header[0] : header;
    if (typeof value !== "string") {
      throw new Error("Login response did not set a session cookie.");
    }
    return value.split(";", 1)[0]!;
  }
});
