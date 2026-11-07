import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../apps/server/src/storage/database.js";
import { createApp } from "../apps/server/src/app.js";
import { ConfigurationError, readConfig } from "../apps/server/src/config.js";
import { HttpError, toSafeHttpError } from "../apps/server/src/errors.js";

describe("server startup foundation", () => {
  let database: ReturnType<typeof openDatabase> | undefined;
  let app: Awaited<ReturnType<typeof createApp>> | undefined;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
    if (database?.open) {
      database.close();
    }
    database = undefined;
  });

  it("loads defaults and validates local application configuration", () => {
    expect(readConfig({}).publicOrigin).toBe("http://localhost:5173");
    expect(
      readConfig({
        NODE_ENV: "production",
        HOST: "0.0.0.0",
        PORT: "443",
        PUBLIC_ORIGIN: "https://game.example.com",
        DATABASE_PATH: "/var/lib/multiplayer/game.sqlite"
      })
    ).toMatchObject({ nodeEnv: "production", port: 443 });

    expect(() => readConfig({ PORT: "secret-value" })).toThrow(ConfigurationError);
    try {
      readConfig({ PORT: "secret-value" });
    } catch (error) {
      expect((error as Error).message).not.toContain("secret-value");
    }
    expect(() => readConfig({ PUBLIC_ORIGIN: "https://user:pass@example.com/path" })).toThrow(
      ConfigurationError
    );
  });

  it("returns safe errors without exposing unexpected exception messages", () => {
    const expected = toSafeHttpError(new HttpError(409, "SESSION_CAPACITY", "No room available."), "req-1");
    expect(expected).toMatchObject({
      statusCode: 409,
      response: { error: { code: "SESSION_CAPACITY", requestId: "req-1" } }
    });

    const unexpected = toSafeHttpError(new Error("password=do-not-log"), "req-2");
    expect(unexpected.statusCode).toBe(500);
    expect(JSON.stringify(unexpected.response)).not.toContain("do-not-log");
  });

  it("exposes liveness/readiness and structured request IDs", async () => {
    database = openDatabase(":memory:");
    const readiness = { ready: false };
    app = createApp(readConfig({ NODE_ENV: "test" }), database, readiness);

    const live = await app.inject("/health/live");
    expect(live.statusCode).toBe(200);
    expect(live.json()).toEqual({ status: "ok" });
    expect(live.headers["x-request-id"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );

    const notReady = await app.inject("/health/ready");
    expect(notReady.statusCode).toBe(503);
    readiness.ready = true;
    const ready = await app.inject("/health/ready");
    expect(ready.statusCode).toBe(200);

    const missing = await app.inject("/not-found");
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.requestId).toBe(missing.headers["x-request-id"]);

    await app.close();
    app = undefined;
    expect(readiness.ready).toBe(false);
    expect(database.open).toBe(false);
    database = undefined;
  });
});
