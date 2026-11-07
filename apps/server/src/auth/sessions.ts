import { createHash, randomBytes } from "node:crypto";
import { HttpError } from "../errors.js";
import type { SqliteDatabase } from "../storage/database.js";
import type { AuthenticatedAccount } from "./accounts.js";

export const SESSION_COOKIE_NAME = "mp_session";
export const SESSION_LIFETIME_SECONDS = 7 * 24 * 60 * 60;

interface SessionAccountRow {
  id: string;
  username: string;
  role: "player" | "operator";
}

export interface IssuedSession {
  readonly token: string;
  readonly expiresAt: string;
}

export function digestSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function issueSession(
  database: SqliteDatabase,
  accountId: string,
  now = new Date()
): IssuedSession {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + SESSION_LIFETIME_SECONDS * 1_000).toISOString();
  database
    .prepare(
      `INSERT INTO auth_sessions(token_digest, account_id, created_at, expires_at)
       VALUES (?, ?, ?, ?)`
    )
    .run(digestSessionToken(token), accountId, now.toISOString(), expiresAt);
  return Object.freeze({ token, expiresAt });
}

export function rotateSession(
  database: SqliteDatabase,
  oldToken: string | undefined,
  accountId: string,
  now = new Date()
): IssuedSession {
  return database.transaction(() => {
    if (oldToken) {
      revokeSession(database, oldToken, now);
    }
    return issueSession(database, accountId, now);
  })();
}

export function revokeSession(database: SqliteDatabase, token: string, now = new Date()): void {
  database
    .prepare(
      `UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, ?)
       WHERE token_digest = ?`
    )
    .run(now.toISOString(), digestSessionToken(token));
}

export function authenticateSession(
  database: SqliteDatabase,
  token: string | undefined,
  now = new Date()
): AuthenticatedAccount {
  if (!token || token.length > 128) {
    throw new HttpError(401, "UNAUTHENTICATED", "Authentication is required.");
  }
  const row = database
    .prepare(
      `SELECT a.id, a.username, a.role
       FROM auth_sessions s
       JOIN accounts a ON a.id = s.account_id
       WHERE s.token_digest = ? AND s.revoked_at IS NULL AND s.expires_at > ?`
    )
    .get(digestSessionToken(token), now.toISOString()) as SessionAccountRow | undefined;

  if (!row) {
    throw new HttpError(401, "UNAUTHENTICATED", "Authentication is required.");
  }
  return Object.freeze({ id: row.id, username: row.username, role: row.role });
}

export function readSessionCookie(cookieHeader: string | undefined): string | undefined {
  if (!cookieHeader || cookieHeader.length > 8_192) {
    return undefined;
  }

  const found: string[] = [];
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== SESSION_COOKIE_NAME) {
      continue;
    }
    const value = part.slice(separator + 1).trim();
    if (!/^[A-Za-z0-9_-]{40,64}$/.test(value)) {
      return undefined;
    }
    found.push(value);
  }
  return found.length === 1 ? found[0] : undefined;
}

export function sessionCookie(token: string, secure: boolean, clear = false): string {
  const fields = [
    `${SESSION_COOKIE_NAME}=${clear ? "" : token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax"
  ];
  if (secure) {
    fields.push("Secure");
  }
  if (clear) {
    fields.push("Max-Age=0");
  } else {
    fields.push(`Max-Age=${SESSION_LIFETIME_SECONDS}`);
  }
  return fields.join("; ");
}
