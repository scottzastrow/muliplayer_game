import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_GAME_SETTINGS } from "@multiplayer-game/protocol";
import { createApp } from "../../apps/server/src/app.js";
import { readConfig } from "../../apps/server/src/config.js";
import { createThemeLoader } from "../../apps/server/src/themes/builtins.js";
import { ThemeRegistry } from "../../apps/server/src/themes/registry.js";
import { openDatabase, runMigrations } from "../../apps/server/src/storage/database.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ORIGIN = "https://game.example.test";
const BASE_HEADERS = { origin: ORIGIN, "content-type": "application/json" };
const PASSWORD = "correct horse battery staple 123";

describe("operator theme management API", () => {
  let database: ReturnType<typeof openDatabase>;
  let app: Awaited<ReturnType<typeof createApp>>;
  let temporaryDirectory: string;

  beforeEach(() => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), "multiplayer-theme-admin-"));
    database = openDatabase(":memory:");
    runMigrations(database);
    app = createApp(
      readConfig({
        NODE_ENV: "test",
        PUBLIC_ORIGIN: ORIGIN,
        DATABASE_PATH: join(temporaryDirectory, "game.sqlite")
      }),
      database,
      { ready: true }
    );
  });

  afterEach(async () => {
    await app.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  it("restricts upload and toggles, rejects invalid uploads atomically, and preserves active pins", async () => {
    const playerCookie = await registerLogin("ThemePlayer");
    const operatorRegistration = await register("ThemeOperator");
    database.prepare("UPDATE accounts SET role = 'operator' WHERE id = ?")
      .run(operatorRegistration.id);
    const operatorCookie = await login("ThemeOperator");

    expect((await app.inject({
      url: "/api/v1/admin/themes",
      headers: { cookie: playerCookie }
    })).statusCode).toBe(403);

    const playerUpload = await app.inject({
      method: "POST",
      url: "/api/v1/admin/themes/upload",
      headers: { origin: ORIGIN, "content-type": "application/zip", cookie: playerCookie },
      payload: Buffer.alloc(32, 0)
    });
    expect(playerUpload.statusCode).toBe(403);
    const playerToggle = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/themes/default/1.0.0",
      headers: { ...BASE_HEADERS, cookie: playerCookie },
      payload: { enabled: false }
    });
    expect(playerToggle.statusCode).toBe(403);

    const session = await app.inject({
      method: "POST",
      url: "/api/v1/sessions",
      headers: { ...BASE_HEADERS, cookie: playerCookie },
      payload: { settings: DEFAULT_GAME_SETTINGS }
    });
    expect(session.statusCode).toBe(201);
    const sessionId = session.json().session.id as string;
    const originalPin = database.prepare(
      "SELECT theme_digest FROM matches WHERE id = ?"
    ).get(sessionId) as { theme_digest: string };
    const started = await app.inject({
      method: "POST",
      url: `/api/v1/sessions/${sessionId}/start`,
      headers: { ...BASE_HEADERS, cookie: playerCookie },
      payload: { expectedRevision: 0 }
    });
    expect(started.statusCode).toBe(200);

    const beforeUpload = database.prepare("SELECT COUNT(*) AS count FROM theme_revisions").get();
    const invalidUpload = await app.inject({
      method: "POST",
      url: "/api/v1/admin/themes/upload",
      headers: { origin: ORIGIN, "content-type": "application/zip", cookie: operatorCookie },
      payload: Buffer.alloc(32, 0)
    });
    expect(invalidUpload.statusCode).toBe(422);
    expect(database.prepare("SELECT COUNT(*) AS count FROM theme_revisions").get())
      .toEqual(beforeUpload);

    const themes = await app.inject({
      url: "/api/v1/admin/themes",
      headers: { cookie: operatorCookie }
    });
    expect(themes.statusCode).toBe(200);
    expect(themes.json().themes).toContainEqual(expect.objectContaining({
      id: "default",
      version: "1.0.0",
      enabled: true
    }));

    const disabled = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/themes/default/1.0.0",
      headers: { ...BASE_HEADERS, cookie: operatorCookie },
      payload: { enabled: false }
    });
    expect(disabled.statusCode).toBe(200);
    expect(disabled.json().theme.enabled).toBe(false);

    const pinned = new ThemeRegistry(database, createThemeLoader())
      .getPinned("default@1.0.0", originalPin.theme_digest);
    expect(pinned.digest).toBe(originalPin.theme_digest);
    expect((await app.inject({
      url: `/api/v1/sessions/${sessionId}`,
      headers: { cookie: playerCookie }
    })).json().session.status).toBe("running");

    const newSession = await app.inject({
      method: "POST",
      url: "/api/v1/sessions",
      headers: { ...BASE_HEADERS, cookie: playerCookie },
      payload: { settings: DEFAULT_GAME_SETTINGS }
    });
    expect(newSession.statusCode).toBe(422);
    expect(newSession.json().error.code).toBe("INCOMPATIBLE_THEME");

    const enabled = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/themes/default/1.0.0",
      headers: { ...BASE_HEADERS, cookie: operatorCookie },
      payload: { enabled: true }
    });
    expect(enabled.statusCode).toBe(200);
    expect(enabled.json().theme.enabled).toBe(true);
  });

  async function register(username: string): Promise<{ id: string }> {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      headers: BASE_HEADERS,
      payload: { username, password: PASSWORD, controlMode: "keyboard-mouse" }
    });
    expect(response.statusCode).toBe(201);
    return response.json().account as { id: string };
  }

  async function registerLogin(username: string): Promise<string> {
    await register(username);
    return login(username);
  }

  async function login(username: string): Promise<string> {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: BASE_HEADERS,
      payload: { username, password: PASSWORD }
    });
    expect(response.statusCode).toBe(200);
    const setCookie = response.headers["set-cookie"];
    const cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie)?.split(";", 1)[0];
    if (!cookie) throw new Error("Login response did not set a session cookie.");
    return cookie;
  }
});
