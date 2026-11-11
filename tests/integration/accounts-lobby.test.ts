import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { DEFAULT_GAME_SETTINGS, validateMatchCapacity } from "@multiplayer-game/protocol";
import { createApp } from "../../apps/server/src/app.js";
import { readConfig } from "../../apps/server/src/config.js";
import { openDatabase, runMigrations } from "../../apps/server/src/storage/database.js";
import { verifyCredentials } from "../../apps/server/src/auth/accounts.js";
import { authenticateSession } from "../../apps/server/src/auth/sessions.js";

const ORIGIN = "https://game.example.test";
const BASE_HEADERS = { origin: ORIGIN, "content-type": "application/json" };

describe("accounts and lobby integration", () => {
  let database: ReturnType<typeof openDatabase>;
  let app: Awaited<ReturnType<typeof createApp>>;

  beforeEach(() => {
    database = openDatabase(":memory:");
    runMigrations(database);
    app = createApp(
      readConfig({ NODE_ENV: "test", PUBLIC_ORIGIN: ORIGIN }),
      database,
      { ready: true }
    );
  });

  afterEach(async () => {
    await app.close();
  });

  it("requires 9–128 characters at signup and allows a 9-character password to log in", async () => {
    const tooShort = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      headers: BASE_HEADERS,
      payload: {
        username: "ShortPass",
        password: "12345678",
        controlMode: "keyboard-only"
      }
    });
    expect(tooShort.statusCode).toBe(400);
    expect(tooShort.json().error.message).toBe("Password must be 9–128 characters long.");

    const validRegistration = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      headers: BASE_HEADERS,
      payload: { username: "NineChars", password: "123456789", controlMode: "keyboard-mouse" }
    });
    expect(validRegistration.statusCode).toBe(201);
    expect((await login("NineChars", "123456789")).statusCode).toBe(200);

    const maximumLength = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      headers: BASE_HEADERS,
      payload: { username: "MaxPass128", password: "a".repeat(128), controlMode: "keyboard-mouse" }
    });
    expect(maximumLength.statusCode).toBe(201);

    const tooLong = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      headers: BASE_HEADERS,
      payload: { username: "LongPass", password: "a".repeat(129) }
    });
    expect(tooLong.statusCode).toBe(400);
  });

  it("uses generic login failures, normalized unique usernames, non-public credentials, rotation and logout", async () => {
    const account = await register("Pilot_One");
    expect(Object.keys(account)).toEqual(["id", "username", "role", "controlMode"]);
    expect(account.controlMode).toBe("keyboard-mouse");
    expect(account).not.toHaveProperty("passwordHash");
    expect(account).not.toHaveProperty("passwordSalt");

    const duplicate = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      headers: BASE_HEADERS,
      payload: { username: "pilot_one", password: "a secure password 123", controlMode: "keyboard-only" }
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe("USERNAME_TAKEN");

    const forgedRole = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      headers: BASE_HEADERS,
      payload: {
        username: "PilotTwo", password: "a secure password 123",
        controlMode: "keyboard-mouse", role: "operator"
      }
    });
    expect(forgedRole.statusCode).toBe(400);

    const wrongPassword = await login("Pilot_One", "wrong password value");
    const unknownUser = await login("UnknownUser", "wrong password value");
    expect(wrongPassword.statusCode).toBe(401);
    expect(unknownUser.statusCode).toBe(401);
    expect(wrongPassword.json().error.message).toBe(unknownUser.json().error.message);

    const firstLogin = await login("PILOT_ONE", "correct horse battery staple 123");
    expect(firstLogin.statusCode).toBe(200);
    const firstCookie = cookieFrom(firstLogin);
    expect(firstLogin.headers["set-cookie"]).toContain("HttpOnly");
    expect(firstLogin.headers["set-cookie"]).toContain("SameSite=Lax");
    expect(firstLogin.headers["set-cookie"]).toContain("Secure");
    const rawToken = firstCookie.slice(firstCookie.indexOf("=") + 1);
    const storedDigest = database
      .prepare("SELECT token_digest FROM auth_sessions WHERE account_id = ?")
      .get(account.id) as { token_digest: string };
    expect(storedDigest.token_digest).toBe(
      createHash("sha256").update(rawToken, "utf8").digest("hex")
    );
    expect(storedDigest.token_digest).not.toContain(rawToken);

    const rotated = await login("Pilot_One", "correct horse battery staple 123", firstCookie);
    const secondCookie = cookieFrom(rotated);
    expect(
      (await app.inject({ url: "/api/v1/me", headers: { cookie: firstCookie } })).statusCode
    ).toBe(401);
    expect(
      (await app.inject({ url: "/api/v1/me", headers: { cookie: secondCookie } })).statusCode
    ).toBe(200);

    const logout = await app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: { origin: ORIGIN, cookie: secondCookie }
    });
    expect(logout.statusCode).toBe(204);
    expect(logout.headers["set-cookie"]).toContain("Max-Age=0");
    expect(
      (await app.inject({ url: "/api/v1/me", headers: { cookie: secondCookie } })).statusCode
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/auth/login",
          headers: { "content-type": "application/json" },
          payload: { username: "Pilot_One", password: "correct horse battery staple 123" }
        })
      ).statusCode
    ).toBe(403);
  });

  it("enforces creator permissions, player capacity, settings revisions and frozen starts", async () => {
    const creator = await registerLogin("Creator");
    const member = await registerLogin("Member");
    const other = await registerLogin("Other");
    const created = await createSession(creator.cookie, {
      ...DEFAULT_GAME_SETTINGS,
      maxPlayers: 2
    });
    const sessionId = created.json().session.id as string;
    const storedSettings = database
      .prepare("SELECT settings_json FROM matches WHERE id = ?")
      .get(sessionId) as { settings_json: string };
    expect(JSON.parse(storedSettings.settings_json)).toEqual({
      ...DEFAULT_GAME_SETTINGS,
      maxPlayers: 2
    });
    expect(() => validateMatchCapacity(JSON.parse(storedSettings.settings_json), 2)).not.toThrow();

    const forbiddenSettings = await patchSettings(member.cookie, sessionId, 0, DEFAULT_GAME_SETTINGS);
    const forbiddenStart = await startSession(member.cookie, sessionId, 0);
    expect(forbiddenSettings.statusCode).toBe(403);
    expect(forbiddenStart.statusCode).toBe(403);

    const joinAttempts = await Promise.all([
      callJoin(member.cookie, sessionId),
      callJoin(other.cookie, sessionId)
    ]);
    expect(joinAttempts.map((response) => [response.statusCode, response.json()])).toEqual(
      expect.arrayContaining([
        [200, expect.any(Object)],
        [409, expect.any(Object)]
      ])
    );
    expect(joinAttempts.filter((response) => response.statusCode === 200)).toHaveLength(1);
    expect(joinAttempts.filter((response) => response.statusCode === 409)).toHaveLength(1);
    expect(joinAttempts.find((response) => response.statusCode === 409)?.json().error.code).toBe(
      "PLAYER_CAPACITY"
    );

    const invalidSettings = await patchSettings(creator.cookie, sessionId, 0, {
      ...DEFAULT_GAME_SETTINGS,
      maxPlayers: 0
    });
    expect(invalidSettings.statusCode).toBe(422);

    const updatedSettings = await patchSettings(creator.cookie, sessionId, 0, {
      ...DEFAULT_GAME_SETTINGS,
      maxPlayers: 2,
      maxLevels: 2
    });
    expect(updatedSettings.statusCode).toBe(200);
    expect(updatedSettings.json().session.settingsRevision).toBe(1);
    expect((await startSession(creator.cookie, sessionId, 0)).statusCode).toBe(409);

    const starts = await Promise.all([
      startSession(creator.cookie, sessionId, 1),
      startSession(creator.cookie, sessionId, 1)
    ]);
    expect(starts.filter((response) => response.statusCode === 200)).toHaveLength(1);
    expect(starts.filter((response) => response.statusCode === 409)).toHaveLength(1);
    expect(
      (await patchSettings(creator.cookie, sessionId, 1, DEFAULT_GAME_SETTINGS)).statusCode
    ).toBe(409);
  });

  it("loads legacy NPC settings, saves host updates, rejects invalid values and freezes on start", async () => {
    const creator = await registerLogin("NpcSettingsHost");
    const { npcMovementSpeed: _speed, npcDetectionRange: _range, ...legacySettings } =
      DEFAULT_GAME_SETTINGS;
    const created = await createSession(creator.cookie, legacySettings);
    expect(created.statusCode).toBe(201);
    const id = created.json().session.id as string;
    database.prepare("UPDATE matches SET settings_json = ? WHERE id = ?")
      .run(JSON.stringify(legacySettings), id);
    const read = () => app.inject({
      url: `/api/v1/sessions/${id}`, headers: { cookie: creator.cookie }
    });
    expect((await read()).json().settings.npcMovementSpeed).toBe(67.5);
    expect((await read()).json().settings.npcDetectionRange).toBe(512);
    for (const npcMovementSpeed of [-1, 181, "90", null]) {
      const response = await patchSettings(creator.cookie, id, 0, {
        ...legacySettings, npcMovementSpeed
      });
      expect(response.statusCode).toBe(422);
      expect(response.json().error.code).toBe("INVALID_SETTINGS");
      expect((await read()).json().settings.npcMovementSpeed).toBe(67.5);
      expect((await read()).json().settings.npcDetectionRange).toBe(512);
      expect((await read()).json().session.settingsRevision).toBe(0);
    }
    for (const npcDetectionRange of [-1, 701, "512", null]) {
      const response = await patchSettings(creator.cookie, id, 0, {
        ...legacySettings, npcDetectionRange
      });
      expect(response.statusCode).toBe(422);
      expect(response.json().error.code).toBe("INVALID_SETTINGS");
      expect((await read()).json().settings.npcDetectionRange).toBe(512);
      expect((await read()).json().session.settingsRevision).toBe(0);
    }
    for (const [expectedRevision, [npcMovementSpeed, npcDetectionRange]] of [
      [33.75, 0], [180, 700], [0, 320]
    ].entries()) {
      const update = await patchSettings(creator.cookie, id, expectedRevision, {
        ...legacySettings, npcMovementSpeed, npcDetectionRange
      });
      expect(update.statusCode).toBe(200);
      expect((await read()).json().settings.npcMovementSpeed).toBe(npcMovementSpeed);
      expect((await read()).json().settings.npcDetectionRange).toBe(npcDetectionRange);
    }
    expect((await startSession(creator.cookie, id, 3)).statusCode).toBe(200);
    expect((await patchSettings(creator.cookie, id, 3, {
      ...legacySettings, npcMovementSpeed: 90, npcDetectionRange: 400
    })).statusCode).toBe(409);
    expect((await read()).json().settings.npcMovementSpeed).toBe(0);
    expect((await read()).json().settings.npcDetectionRange).toBe(320);
  });

  it("retains saved 100-HP rooms while new default rooms use 50 HP", async () => {
    const creator = await registerLogin("HealthSettingsHost");
    const savedSettings = { ...DEFAULT_GAME_SETTINGS, baseNpcHealth: 100 };
    const created = await createSession(creator.cookie, savedSettings);
    expect(created.statusCode).toBe(201);
    const id = created.json().session.id as string;
    const savedJson = JSON.stringify(savedSettings);
    database.prepare("UPDATE matches SET settings_json = ? WHERE id = ?").run(savedJson, id);
    const read = await app.inject({
      url: `/api/v1/sessions/${id}`, headers: { cookie: creator.cookie }
    });
    expect(read.statusCode).toBe(200);
    expect(read.json().settings.baseNpcHealth).toBe(100);
    expect((await startSession(creator.cookie, id, 0)).statusCode).toBe(200);
    expect(database.prepare("SELECT settings_json FROM matches WHERE id = ?").get(id))
      .toEqual({ settings_json: savedJson });
    const fresh = await createSession(creator.cookie, DEFAULT_GAME_SETTINGS);
    expect(fresh.statusCode).toBe(201);
    const freshId = fresh.json().session.id as string;
    expect((await app.inject({
      url: `/api/v1/sessions/${freshId}`, headers: { cookie: creator.cookie }
    })).json().settings.baseNpcHealth).toBe(50);
  });

  it("admits exactly five concurrently-created active sessions and rejects overflow", async () => {
    const creator = await registerLogin("RoomMaker");
    const attempts = await Promise.all(
      Array.from({ length: 9 }, (_, index) =>
        createSession(creator.cookie, DEFAULT_GAME_SETTINGS, `parallel-create-${index}`)
      )
    );
    expect(attempts.filter((response) => response.statusCode === 201)).toHaveLength(5);
    expect(
      attempts
        .filter((response) => response.statusCode === 409)
        .every((response) => response.json().error.code === "SESSION_CAPACITY")
    ).toBe(true);

    const sessions = await app.inject({
      url: "/api/v1/sessions",
      headers: { cookie: creator.cookie }
    });
    expect(sessions.json().sessions).toHaveLength(5);

    const currentCount = database
      .prepare("SELECT COUNT(*) AS count FROM matches WHERE state IN ('waiting', 'running')")
      .get() as { count: number };
    expect(currentCount.count).toBe(5);
  });

  it("uses the default theme display name and reports registering/running lobby states", async () => {
    const creator = await registerLogin("ThemeCreator");
    const joiner = await registerLogin("ThemeJoiner");
    const observer = await registerLogin("ThemeObserver");
    const settings = { ...DEFAULT_GAME_SETTINGS, maxPlayers: 2 };
    const created = await createSession(creator.cookie, settings);
    expect(created.statusCode).toBe(201);
    const sessionId = created.json().session.id as string;

    const registeringList = await app.inject({
      url: "/api/v1/sessions",
      headers: { cookie: joiner.cookie }
    });
    expect(registeringList.json().sessions[0]).toMatchObject({
      creator: "ThemeCreator",
      status: "waiting",
      themeName: "Dots and Squares",
      canJoin: true,
      canPlay: false,
      playerCount: 1,
      maxPlayers: settings.maxPlayers
    });

    expect((await callJoin(joiner.cookie, sessionId)).statusCode).toBe(200);
    const fullList = await app.inject({
      url: "/api/v1/sessions",
      headers: { cookie: observer.cookie }
    });
    expect(fullList.json().sessions[0]).toMatchObject({
      status: "waiting",
      playerCount: settings.maxPlayers,
      maxPlayers: settings.maxPlayers,
      canJoin: false
    });

    expect((await startSession(creator.cookie, sessionId, 0)).statusCode).toBe(200);
    const runningList = await app.inject({
      url: "/api/v1/sessions",
      headers: { cookie: observer.cookie }
    });
    expect(runningList.json().sessions[0]).toMatchObject({
      status: "running",
      themeName: "Dots and Squares",
      canJoin: false,
      canPlay: false
    });
    for (const cookie of [creator.cookie, joiner.cookie]) {
      const participantList = await app.inject({
        url: "/api/v1/sessions", headers: { cookie }
      });
      expect(participantList.json().sessions[0]).toMatchObject({ canPlay: true, canJoin: false });
    }
  });

  it("blocks disabled revisions for new sessions and start, but keeps a started match pinned", async () => {
    const creator = await registerLogin("DisabledTheme");
    const settings = { ...DEFAULT_GAME_SETTINGS };
    const created = await createSession(creator.cookie, settings);
    expect(created.statusCode).toBe(201);
    const sessionId = created.json().session.id as string;
    const pin = database.prepare(
      "SELECT theme_digest FROM matches WHERE id = ?"
    ).get(sessionId) as { theme_digest: string };

    database.prepare(
      "UPDATE theme_revisions SET enabled = 0 WHERE theme_id = 'default' AND version = '1.0.0'"
    ).run();
    const unavailable = await createSession(creator.cookie, settings);
    expect(unavailable.statusCode).toBe(422);
    expect(unavailable.json().error.code).toBe("INCOMPATIBLE_THEME");
    expect((await patchSettings(creator.cookie, sessionId, 0, settings)).statusCode).toBe(422);
    const blockedStart = await startSession(creator.cookie, sessionId, 0);
    expect(blockedStart.statusCode).toBe(422);
    expect((database.prepare("SELECT state FROM matches WHERE id = ?").get(sessionId) as
      { state: string }).state).toBe("waiting");

    database.prepare(
      "UPDATE theme_revisions SET enabled = 1 WHERE theme_id = 'default' AND version = '1.0.0'"
    ).run();
    expect((await startSession(creator.cookie, sessionId, 0)).statusCode).toBe(200);
    database.prepare(
      "UPDATE theme_revisions SET enabled = 0 WHERE theme_id = 'default' AND version = '1.0.0'"
    ).run();

    const active = await app.inject({
      url: `/api/v1/sessions/${sessionId}`,
      headers: { cookie: creator.cookie }
    });
    expect(active.statusCode).toBe(200);
    expect(active.json().session.status).toBe("running");
    expect((database.prepare("SELECT theme_digest FROM matches WHERE id = ?").get(sessionId) as
      { theme_digest: string }).theme_digest).toBe(pin.theme_digest);
  });

  it("releases a waiting slot when its only player leaves and validates idempotent creates", async () => {
    const creator = await registerLogin("SoloCreator");
    const first = await createSession(creator.cookie, DEFAULT_GAME_SETTINGS, "dedupe-key");
    const repeated = await createSession(creator.cookie, DEFAULT_GAME_SETTINGS, "dedupe-key");
    expect(first.statusCode).toBe(201);
    expect(repeated.statusCode).toBe(200);
    expect(repeated.json().session.id).toBe(first.json().session.id);

    const sessionId = first.json().session.id as string;
    const leave = await app.inject({
      method: "POST",
      url: `/api/v1/sessions/${sessionId}/leave`,
      headers: { ...BASE_HEADERS, cookie: creator.cookie },
      payload: {}
    });
    expect(leave.statusCode).toBe(204);
    expect(
      (database.prepare("SELECT state FROM matches WHERE id = ?").get(sessionId) as { state: string })
        .state
    ).toBe("abandoned");
    const result = await app.inject({
      url: `/api/v1/matches/${sessionId}/results`, headers: { cookie: creator.cookie }
    });
    expect(result.statusCode).toBe(200);
    expect(result.json().result).toMatchObject({
      matchId: sessionId, status: "abandoned", standings: []
    });
    expect((await createSession(creator.cookie, DEFAULT_GAME_SETTINGS, "after-release")).statusCode).toBe(
      201
    );
  });

  it("requires a signup control choice and saves legacy accounts across sign-out and sign-in", async () => {
    const missingChoice = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      headers: BASE_HEADERS,
      payload: { username: "NoControl", password: "correct horse battery staple 123" }
    });
    expect(missingChoice.statusCode).toBe(400);

    const account = await register("LegacyChoice", "keyboard-only");
    expect(account.controlMode).toBe("keyboard-only");
    database.prepare("UPDATE accounts SET control_mode = NULL WHERE id = ?").run(account.id);

    const loginResponse = await login("LegacyChoice", "correct horse battery staple 123");
    const cookie = cookieFrom(loginResponse);
    expect(loginResponse.statusCode).toBe(200);
    const me = await app.inject({ url: "/api/v1/me", headers: { cookie } });
    expect(me.json().account.controlMode).toBeNull();

    const saved = await app.inject({
      method: "PATCH",
      url: "/api/v1/me/control-mode",
      headers: { ...BASE_HEADERS, cookie },
      payload: { controlMode: "keyboard-mouse" }
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().account.controlMode).toBe("keyboard-mouse");
    expect(
      (database.prepare("SELECT control_mode FROM accounts WHERE id = ?").get(account.id) as
        { control_mode: string }).control_mode
    ).toBe("keyboard-mouse");

    const logout = await app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: { origin: ORIGIN, cookie }
    });
    expect(logout.statusCode).toBe(204);
    const secondLogin = await login("LegacyChoice", "correct horse battery staple 123");
    expect(secondLogin.statusCode).toBe(200);
    expect(secondLogin.json().account.controlMode).toBe("keyboard-mouse");
    const secondCookie = cookieFrom(secondLogin);
    const afterSignIn = await app.inject({
      url: "/api/v1/me",
      headers: { cookie: secondCookie }
    });
    expect(afterSignIn.json().account.controlMode).toBe("keyboard-mouse");

    const savedController = await app.inject({
      method: "PATCH",
      url: "/api/v1/me/control-mode",
      headers: { ...BASE_HEADERS, cookie: secondCookie },
      payload: { controlMode: "game-controller" }
    });
    expect(savedController.statusCode).toBe(200);
    expect(savedController.json().account.controlMode).toBe("game-controller");
    expect((await login("LegacyChoice", "correct horse battery staple 123"))
      .json().account.controlMode).toBe("game-controller");
    const controllerSignup = await register("ControllerSignup", "game-controller");
    expect(controllerSignup.controlMode).toBe("game-controller");
    expect((await login("ControllerSignup", "correct horse battery staple 123"))
      .json().account.controlMode).toBe("game-controller");

    const invalid = await app.inject({
      method: "PATCH",
      url: "/api/v1/me/control-mode",
      headers: { ...BASE_HEADERS, cookie: secondCookie },
      payload: { controlMode: "game-pad" }
    });
    expect(invalid.statusCode).toBe(400);
  });

  it("canonicalizes legacy First-Person requests at signup and preference updates", async () => {
    const account = await register("FirstPerson", "first-person");
    const storedMode = () => (database.prepare("SELECT control_mode FROM accounts WHERE id = ?")
      .get(account.id) as { control_mode: string }).control_mode;
    expect(account.controlMode).toBe("keyboard-only");
    expect(storedMode()).toBe("keyboard-only");
    const signedIn = await login("FirstPerson", "correct horse battery staple 123");
    expect(signedIn.json().account.controlMode).toBe("keyboard-only");
    const cookie = cookieFrom(signedIn);
    for (const controlMode of ["keyboard-only", "keyboard-mouse", "game-controller", "first-person"]) {
      const expected = controlMode === "first-person" ? "keyboard-only" : controlMode;
      const saved = await app.inject({
        method: "PATCH", url: "/api/v1/me/control-mode",
        headers: { ...BASE_HEADERS, cookie }, payload: { controlMode }
      });
      expect(saved.statusCode).toBe(200);
      expect(saved.json().account.controlMode).toBe(expected);
      expect(storedMode()).toBe(expected);
      const me = await app.inject({ url: "/api/v1/me", headers: { cookie } });
      expect(me.json().account.controlMode).toBe(expected);
    }
    const signedInAgain = await login("FirstPerson", "correct horse battery staple 123");
    expect(signedInAgain.json().account.controlMode).toBe("keyboard-only");
  });

  it("reads legacy saved First-Person as Keyboard Only without rewriting until an update", async () => {
    const account = await register("LegacyFirstPerson");
    database.prepare("UPDATE accounts SET control_mode = 'first-person' WHERE id = ?").run(account.id);
    const password = "correct horse battery staple 123";
    expect((await verifyCredentials(database, "LegacyFirstPerson", password))?.controlMode)
      .toBe("keyboard-only");
    const signedIn = await login("LegacyFirstPerson", password);
    expect(signedIn.statusCode).toBe(200);
    expect(signedIn.json().account.controlMode).toBe("keyboard-only");
    const cookie = cookieFrom(signedIn);
    const token = cookie.slice(cookie.indexOf("=") + 1);
    expect(authenticateSession(database, token).controlMode).toBe("keyboard-only");
    const me = await app.inject({ url: "/api/v1/me", headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json().account.controlMode).toBe("keyboard-only");
    const storedMode = () => (database.prepare("SELECT control_mode FROM accounts WHERE id = ?")
      .get(account.id) as { control_mode: string }).control_mode;
    expect(storedMode()).toBe("first-person");

    const saved = await app.inject({
      method: "PATCH", url: "/api/v1/me/control-mode",
      headers: { ...BASE_HEADERS, cookie },
      payload: { controlMode: me.json().account.controlMode }
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().account.controlMode).toBe("keyboard-only");
    expect(storedMode()).toBe("keyboard-only");
    expect((await login("LegacyFirstPerson", password)).json().account.controlMode)
      .toBe("keyboard-only");
  });

  async function register(
    username: string,
    controlMode: "keyboard-only" | "keyboard-mouse" | "game-controller" | "first-person" = "keyboard-mouse"
  ): Promise<Record<string, unknown>> {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      headers: BASE_HEADERS,
      payload: { username, password: "correct horse battery staple 123", controlMode }
    });
    expect(response.statusCode).toBe(201);
    return response.json().account as Record<string, unknown>;
  }

  async function login(username: string, password: string, cookie?: string) {
    return app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: {
        ...BASE_HEADERS,
        ...(cookie ? { cookie } : {})
      },
      payload: { username, password }
    });
  }

  async function registerLogin(username: string): Promise<{ cookie: string }> {
    await register(username);
    const response = await login(username, "correct horse battery staple 123");
    expect(response.statusCode).toBe(200);
    return { cookie: cookieFrom(response) };
  }

  async function createSession(cookie: string, settings: unknown, requestId: string = crypto.randomUUID()) {
    return app.inject({
      method: "POST",
      url: "/api/v1/sessions",
      headers: { ...BASE_HEADERS, cookie },
      payload: { settings, requestId }
    });
  }

  async function patchSettings(
    cookie: string,
    sessionId: string,
    expectedRevision: number,
    settings: unknown
  ) {
    return app.inject({
      method: "PATCH",
      url: `/api/v1/sessions/${sessionId}/settings`,
      headers: { ...BASE_HEADERS, cookie },
      payload: { settings, expectedRevision }
    });
  }

  async function startSession(cookie: string, sessionId: string, expectedRevision: number) {
    return app.inject({
      method: "POST",
      url: `/api/v1/sessions/${sessionId}/start`,
      headers: { ...BASE_HEADERS, cookie },
      payload: { expectedRevision }
    });
  }

  async function callJoin(cookie: string, sessionId: string) {
    return app.inject({
      method: "POST",
      url: `/api/v1/sessions/${sessionId}/join`,
      headers: { ...BASE_HEADERS, cookie },
      payload: {}
    });
  }
});

function cookieFrom(response: { headers: Record<string, number | string | string[] | undefined> }): string {
  const setCookie = response.headers["set-cookie"];
  const first = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (typeof first !== "string") {
    throw new Error("Login response did not set a session cookie.");
  }
  return first.split(";", 1)[0]!;
}
