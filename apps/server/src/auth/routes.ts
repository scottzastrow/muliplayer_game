import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AppConfig } from "../config.js";
import { HttpError } from "../errors.js";
import type { SqliteDatabase } from "../storage/database.js";
import {
  createAccount,
  getPublicAccount,
  updateControlMode,
  verifyCredentials
} from "./accounts.js";
import { FixedWindowRateLimiter } from "./rate-limit.js";
import {
  authenticateSession,
  readSessionCookie,
  rotateSession,
  revokeSession,
  sessionCookie
} from "./sessions.js";

export interface AuthContext {
  readonly database: SqliteDatabase;
  readonly authenticatedMutationLimiter: FixedWindowRateLimiter;
}

export function registerAuthRoutes(
  app: FastifyInstance,
  database: SqliteDatabase,
  config: AppConfig
): AuthContext {
  const registerLimiter = new FixedWindowRateLimiter(5, 60_000);
  const loginIpLimiter = new FixedWindowRateLimiter(10, 60_000);
  const loginUsernameLimiter = new FixedWindowRateLimiter(10, 60_000);
  const authenticatedMutationLimiter = new FixedWindowRateLimiter(60, 60_000);
  const context = { database, authenticatedMutationLimiter };
  app.post(
    "/api/v1/auth/register",
    { bodyLimit: 4 * 1024 },
    async (request, reply) => {
      requireJson(request);
      requireSameOrigin(request, config);
      registerLimiter.consume(request.ip);
      const body = parseRegistration(request.body);
      const account = await createAccount(
        database, body.username, body.password, body.controlMode
      );
      reply.code(201);
      return { account };
    }
  );

  app.post(
    "/api/v1/auth/login",
    { bodyLimit: 4 * 1024 },
    async (request, reply) => {
      requireJson(request);
      requireSameOrigin(request, config);
      const body = parseCredentials(request.body);
      loginIpLimiter.consume(request.ip);
      const usernameKey =
        typeof body.username === "string" ? body.username.toLowerCase().slice(0, 256) : "";
      loginUsernameLimiter.consume(usernameKey);
      const account = await verifyCredentials(database, body.username, body.password);
      if (!account) {
        throw new HttpError(401, "UNAUTHENTICATED", "Username or password is incorrect.");
      }

      const oldToken = readSessionCookie(request.headers.cookie);
      const session = rotateSession(database, oldToken, account.id);
      reply.header(
        "set-cookie",
        sessionCookie(session.token, new URL(config.publicOrigin).protocol === "https:")
      );
      return { account: getPublicAccount(database, account.id) };
    }
  );

  app.post("/api/v1/auth/logout", async (request, reply) => {
    requireSameOrigin(request, config);
    const token = readSessionCookie(request.headers.cookie);
    if (token) {
      revokeSession(database, token);
    }
    reply.header(
      "set-cookie",
      sessionCookie("", new URL(config.publicOrigin).protocol === "https:", true)
    );
    reply.code(204);
  });

  app.get("/api/v1/me", async (request) => {
    const account = authenticateRequest(database, request);
    return { account: getPublicAccount(database, account.id) };
  });

  app.patch("/api/v1/me/control-mode", async (request) => {
    requireJson(request);
    requireSameOrigin(request, config);
    const account = requireAccount(context, request);
    const body = parseControlMode(request.body);
    return { account: updateControlMode(database, account.id, body.controlMode) };
  });

  return context;
}

export function requireAccount(
  context: AuthContext,
  request: FastifyRequest
): ReturnType<typeof authenticateSession> {
  const account = authenticateRequest(context.database, request);
  context.authenticatedMutationLimiter.consume(account.id);
  return account;
}

export function authenticateRequest(
  database: SqliteDatabase,
  request: FastifyRequest
): ReturnType<typeof authenticateSession> {
  return authenticateSession(database, readSessionCookie(request.headers.cookie));
}

export function requireJson(request: FastifyRequest): void {
  if (request.headers["content-type"]?.split(";")[0] !== "application/json") {
    throw new HttpError(400, "BAD_REQUEST", "Content-Type must be application/json.");
  }
}

export function requireSameOrigin(request: FastifyRequest, config: AppConfig): void {
  const origin = request.headers.origin;
  if (typeof origin !== "string" || origin !== config.publicOrigin) {
    throw new HttpError(403, "FORBIDDEN", "This request must come from the configured origin.");
  }
}

function parseCredentials(input: unknown): { username: unknown; password: unknown } {
  if (
    typeof input !== "object" ||
    input === null ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => key !== "username" && key !== "password") ||
    !("username" in input) ||
    !("password" in input)
  ) {
    throw new HttpError(400, "BAD_REQUEST", "Request body is invalid.");
  }
  const credentials = input as Record<string, unknown>;
  return {
    username: credentials.username,
    password: credentials.password
  };
}

function parseRegistration(input: unknown): {
  username: unknown;
  password: unknown;
  controlMode: unknown;
} {
  if (
    typeof input !== "object" ||
    input === null ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !["username", "password", "controlMode"].includes(key)) ||
    !("username" in input) ||
    !("password" in input) ||
    !("controlMode" in input)
  ) {
    throw new HttpError(400, "BAD_REQUEST", "Registration details are invalid.");
  }
  const registration = input as Record<string, unknown>;
  return {
    username: registration.username,
    password: registration.password,
    controlMode: registration.controlMode
  };
}

function parseControlMode(input: unknown): { controlMode: unknown } {
  if (
    typeof input !== "object" ||
    input === null ||
    Array.isArray(input) ||
    Object.keys(input).length !== 1 ||
    !("controlMode" in input)
  ) {
    throw new HttpError(400, "BAD_REQUEST", "Control mode update is invalid.");
  }
  return { controlMode: (input as Record<string, unknown>).controlMode };
}
