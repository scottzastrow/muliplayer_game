import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import type { PublicAccount } from "@multiplayer-game/protocol";
import { serializePublicAccount } from "@multiplayer-game/protocol";
import type { SqliteDatabase } from "../storage/database.js";
import { HttpError } from "../errors.js";

const SCRYPT_OPTIONS = Object.freeze({ N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
const HASH_BYTES = 64;

function deriveKey(password: string, salt: Buffer, keyLength: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keyLength, SCRYPT_OPTIONS, (error, derivedKey) => {
      if (error) {
        reject(error);
      } else {
        resolve(derivedKey);
      }
    });
  });
}

interface AccountRow {
  id: string;
  username: string;
  normalized_username: string;
  password_hash: string;
  password_salt: string;
  role: "player" | "operator";
}

export interface AuthenticatedAccount {
  readonly id: string;
  readonly username: string;
  readonly role: "player" | "operator";
}

export async function hashPassword(password: string): Promise<{
  passwordHash: string;
  passwordSalt: string;
}> {
  const salt = randomBytes(16);
  const derived = await deriveKey(password, salt, HASH_BYTES);
  return { passwordHash: derived.toString("hex"), passwordSalt: salt.toString("hex") };
}

export async function createAccount(
  database: SqliteDatabase,
  usernameInput: unknown,
  passwordInput: unknown
): Promise<PublicAccount> {
  const username = validateUsername(usernameInput);
  const password = validatePassword(passwordInput);
  const credential = await hashPassword(password);
  const id = randomUUID();

  try {
    database
      .prepare(
        `INSERT INTO accounts
         (id, username, normalized_username, password_hash, password_salt, role, created_at)
         VALUES (?, ?, ?, ?, ?, 'player', ?)`
      )
      .run(
        id,
        username,
        username.toLowerCase(),
        credential.passwordHash,
        credential.passwordSalt,
        new Date().toISOString()
      );
  } catch (error) {
    if (isUniqueConstraint(error)) {
      throw new HttpError(409, "USERNAME_TAKEN", "That username is already in use.");
    }
    throw error;
  }

  return serializePublicAccount({ id, username, role: "player" });
}

export function validateUsername(input: unknown): string {
  if (typeof input !== "string" || !/^[A-Za-z0-9_]{3,24}$/.test(input)) {
    throw new HttpError(
      400,
      "BAD_REQUEST",
      "Username must be 3–24 ASCII letters, digits, or underscores."
    );
  }
  return input;
}

export function validatePassword(input: unknown): string {
  if (typeof input !== "string" || input.length < 9 || input.length > 128) {
    throw new HttpError(400, "BAD_REQUEST", "Password must be 9–128 characters long.");
  }
  return input;
}

export async function verifyCredentials(
  database: SqliteDatabase,
  usernameInput: unknown,
  passwordInput: unknown
): Promise<AuthenticatedAccount | undefined> {
  let username: string;
  try {
    username = validateUsername(usernameInput);
  } catch {
    username = "";
  }

  const password = typeof passwordInput === "string" ? passwordInput.slice(0, 128) : "";
  const row = database
    .prepare(
      `SELECT id, username, normalized_username, password_hash, password_salt, role
       FROM accounts WHERE normalized_username = ?`
    )
    .get(username.toLowerCase()) as AccountRow | undefined;

  if (!row) {
    await hashPassword(password);
    return undefined;
  }

  let storedHash: Buffer;
  let salt: Buffer;
  try {
    storedHash = Buffer.from(row.password_hash, "hex");
    salt = Buffer.from(row.password_salt, "hex");
    if (storedHash.length !== HASH_BYTES || salt.length !== 16) {
      throw new Error("Stored credential has invalid encoding.");
    }
  } catch {
    throw new Error("Stored account credential is invalid.");
  }

  const supplied = await deriveKey(password, salt, HASH_BYTES);
  if (!timingSafeEqual(storedHash, supplied)) {
    return undefined;
  }

  return Object.freeze({ id: row.id, username: row.username, role: row.role });
}

export function getPublicAccount(
  database: SqliteDatabase,
  accountId: string
): PublicAccount | undefined {
  const row = database
    .prepare("SELECT id, username, role FROM accounts WHERE id = ?")
    .get(accountId) as { id: string; username: string; role: "player" | "operator" } | undefined;
  return row ? serializePublicAccount(row) : undefined;
}

function isUniqueConstraint(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code.startsWith("SQLITE_CONSTRAINT_UNIQUE")
  );
}
