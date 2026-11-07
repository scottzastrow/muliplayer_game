import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import type { AppConfig } from "./config.js";
import { HttpError, toSafeHttpError } from "./errors.js";
import type { SqliteDatabase } from "./storage/database.js";
import { registerAuthRoutes } from "./auth/routes.js";
import { registerLobbyRoutes } from "./lobby/routes.js";
import { LobbyRegistry } from "./lobby/registry.js";
import { RealtimeTransport, type RealtimeOptions } from "./transport/socket.js";

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

  const lobby = new LobbyRegistry(database);
  const auth = registerAuthRoutes(app, database, config);
  registerLobbyRoutes(app, database, config, lobby, auth);
  const realtime = new RealtimeTransport(app.server, database, config, lobby, realtimeOptions);
  app.addHook("preClose", async () => {
    realtime.close();
  });
  app.addHook("onClose", async () => {
    readiness.ready = false;
    database.close();
  });

  return app;
}
