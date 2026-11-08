import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import type { AppConfig } from "./config.js";
import { HttpError, toSafeHttpError } from "./errors.js";
import type { SqliteDatabase } from "./storage/database.js";
import { registerAuthRoutes } from "./auth/routes.js";
import { registerLobbyRoutes } from "./lobby/routes.js";
import { LobbyRegistry } from "./lobby/registry.js";
import { RealtimeTransport, type RealtimeOptions } from "./transport/socket.js";
import { createThemeLoader } from "./themes/builtins.js";
import { registerThemeRoutes } from "./themes/routes.js";
import { SessionLifecycle } from "./runtime/session-lifecycle.js";
import { registerMetricsRoute, RuntimeMetrics } from "./runtime/metrics.js";

export interface ReadinessState {
  ready: boolean;
}

export function createApp(
  config: AppConfig,
  database: SqliteDatabase,
  readiness: ReadinessState = { ready: false },
  realtimeOptions: RealtimeOptions = {}
){
  const app = Fastify({
    genReqId: () => randomUUID(),
    logger: {
      level: config.nodeEnv === "test" ? "silent" : "info",
      redact: {
        paths: [
          "req.headers.cookie",
          "req.headers.authorization",
          'res.headers["set-cookie"]'
        ],
        censor: "[REDACTED]"
      }
    }
  });

  app.addHook("onRequest", async (request, reply) => {
    reply.header("x-request-id", request.id);
  });

  app.setErrorHandler((error, request, reply) => {
    const safeError = toSafeHttpError(error, request.id);
    if (safeError.statusCode >= 500) {
      request.log.error(
        { errorType: error instanceof Error ? error.name : "UnknownError", requestId: request.id },
        "Request failed"
      );
    }
    reply.code(safeError.statusCode).send(safeError.response);
  });

  app.setNotFoundHandler((request, reply) => {
    const safeError = toSafeHttpError(new HttpError(404, "NOT_FOUND", "Resource not found."), request.id);
    reply.code(safeError.statusCode).send({
      error: safeError.response.error
    });
  });

  app.get("/health/live", async () => ({ status: "ok" }));
  app.get("/health/ready", async (request, reply) => {
    if (!readiness.ready) {
      reply.code(503);
      return { status: "not_ready" };
    }

    try {
      database.prepare("SELECT 1").get();
      return { status: "ok" };
    } catch (error) {
      request.log.warn(
        { errorType: error instanceof Error ? error.name : "UnknownError" },
        "Readiness database check failed"
      );
      reply.code(503);
      return { status: "not_ready" };
    }
  });

  const themes = createThemeLoader();
  const metrics = new RuntimeMetrics();
  let realtime: RealtimeTransport | undefined;
  const lobby: LobbyRegistry = new LobbyRegistry(database, Date.now, themes, (sessionId) =>
    new Map([...lifecycle.playerLives(sessionId)].map(([accountId, life]) => [
      accountId, { connected: realtime?.isPlayerConnected(sessionId, accountId) ?? false, life }
    ]))
  );
  const auth = registerAuthRoutes(app, database, config);
  registerMetricsRoute(app, auth, metrics);
  app.addContentTypeParser(
    "application/zip",
    { parseAs: "buffer" },
    (_request, body, done) => done(null, body)
  );
  registerThemeRoutes(app, database, config, auth, themes);
  const lifecycle: SessionLifecycle = new SessionLifecycle(
    database,
    lobby,
    themes,
    (sessionId, tick, moduleStateSchemaVersion, snapshotForAccount) =>
      realtime?.publishSnapshot(sessionId, tick, moduleStateSchemaVersion, snapshotForAccount),
    (error, sessionId) =>
      app.log.error(
        { err: error, sessionId },
        "Session lifecycle failed"
      ),
    (sessionId, tick) => realtime?.publishResult(sessionId, tick, "finished"),
    metrics,
    (sessionId) => realtime?.publishFailure(sessionId)
  );
  registerLobbyRoutes(app, database, config, lobby, auth,
    async (sessionId) => {
      await lifecycle.start(sessionId);
      realtime?.activateSession(sessionId);
    },
    (sessionId, accountId) => realtime?.leaveMember(sessionId, accountId)
  );
  realtime = new RealtimeTransport(app.server, database, config, lobby, {
    ...realtimeOptions,
    metrics,
    onPlayerPresence: (sessionId, accountId, presence) =>
      lifecycle.setPlayerPresence(sessionId, accountId, presence),
    onPlayerInput: (input) => {
      if (!lifecycle.applyInput(input)) {
        return false;
      }
      realtimeOptions.onPlayerInput?.(input);
      return true;
    }
  });
  metrics.setTransport((sessionId) => realtime!.metricsCounts(sessionId));
  app.addHook("preClose", async () => {
    try {
      lifecycle.close();
    } finally {
      try {
        realtime?.close();
      } finally {
        metrics.close();
      }
    }
  });
  app.addHook("onClose", async () => {
    readiness.ready = false;
    database.close();
  });

  return app;
}
