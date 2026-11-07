import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../config.js";
import { HttpError } from "../errors.js";
import type { SqliteDatabase } from "../storage/database.js";
import {
  authenticateRequest,
  requireAccount,
  requireJson,
  requireSameOrigin,
  type AuthContext
} from "../auth/routes.js";
import { LobbyRegistry } from "./registry.js";
import { MatchResultSchema } from "@multiplayer-game/protocol";
import { getMatchResult } from "../storage/results.js";

export function registerLobbyRoutes(
  app: FastifyInstance,
  database: SqliteDatabase,
  config: AppConfig,
  registry: LobbyRegistry,
  authContext: AuthContext,
  startSession: (sessionId: string) => Promise<void>,
  closeSpectator: (sessionId: string, accountId: string) => void
): void {
  app.get<{ Params: { id: string } }>("/api/v1/matches/:id/results", async (request) => {
    authenticateRequest(database, request);
    const result = getMatchResult(database, parseId(request.params.id));
    if (!result) throw new HttpError(404, "NOT_FOUND", "Saved match result not found.");
    return { result: MatchResultSchema.parse(result) };
  });

  app.get("/api/v1/sessions", async (request) => {
    const account = authenticateRequest(database, request);
    return { sessions: registry.list(account.id) };
  });

  app.get<{ Params: { id: string } }>("/api/v1/sessions/:id", async (request) => {
    const account = authenticateRequest(database, request);
    const sessionId = parseId(request.params.id);
    const summary = registry.getSummary(sessionId, account.id);
    if (!summary) {
      throw new HttpError(404, "NOT_FOUND", "Session not found.");
    }
    return { session: summary, settings: registry.getSettings(sessionId) };
  });

  app.post(
    "/api/v1/sessions",
    { bodyLimit: 16 * 1024 },
    async (request, reply) => {
      requireJson(request);
      requireSameOrigin(request, config);
      const account = requireAccount(authContext, request);
      const created = registry.create(account, request.body);
      reply.code(created.created ? 201 : 200);
      return { session: created.summary, settings: created.settings };
    }
  );

  app.post<{ Params: { id: string } }>(
    "/api/v1/sessions/:id/join",
    async (request) => {
      requireJson(request);
      requireSameOrigin(request, config);
      const account = requireAccount(authContext, request);
      requireEmptyBody(request.body);
      return { session: registry.join(account, parseId(request.params.id)) };
    }
  );

  app.patch<{ Params: { id: string } }>(
    "/api/v1/sessions/:id/settings",
    { bodyLimit: 16 * 1024 },
    async (request) => {
      requireJson(request);
      requireSameOrigin(request, config);
      const account = requireAccount(authContext, request);
      const result = registry.updateSettings(account, parseId(request.params.id), request.body);
      return { session: result.summary, settings: result.settings };
    }
  );

  app.post<{ Params: { id: string } }>(
    "/api/v1/sessions/:id/start",
    async (request) => {
      requireJson(request);
      requireSameOrigin(request, config);
      const account = requireAccount(authContext, request);
      const sessionId = parseId(request.params.id);
      const result = registry.start(account, sessionId, request.body);
      await startSession(sessionId);
      return { session: result.summary, settings: result.settings };
    }
  );

  app.post<{ Params: { id: string } }>(
    "/api/v1/sessions/:id/spectate",
    async (request) => {
      requireJson(request);
      requireSameOrigin(request, config);
      const account = requireAccount(authContext, request);
      requireEmptyBody(request.body);
      const sessionId = parseId(request.params.id);
      const view = registry.spectators.admit(sessionId, account.id);
      return { session: registry.getSummary(sessionId, account.id), ...view };
    }
  );

  app.get<{ Params: { id: string } }>("/api/v1/sessions/:id/players", async (request) => {
    const account = authenticateRequest(database, request);
    return registry.spectators.view(parseId(request.params.id), account.id);
  });

  app.post<{ Params: { id: string } }>(
    "/api/v1/sessions/:id/leave",
    async (request, reply) => {
      requireJson(request);
      requireSameOrigin(request, config);
      const account = requireAccount(authContext, request);
      requireEmptyBody(request.body);
      const sessionId = parseId(request.params.id);
      registry.leave(account, sessionId);
      closeSpectator(sessionId, account.id);
      reply.code(204);
    }
  );
}

function parseId(input: string): string {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input)
  ) {
    throw new HttpError(404, "NOT_FOUND", "Session not found.");
  }
  return input;
}

function requireEmptyBody(input: unknown): void {
  if (
    input !== undefined &&
    input !== null &&
    (typeof input !== "object" || Array.isArray(input) || Object.keys(input).length !== 0)
  ) {
    throw new HttpError(400, "BAD_REQUEST", "Request body must be empty.");
  }
}
