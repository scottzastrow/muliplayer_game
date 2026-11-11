import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { hashPassword, validatePassword, validateUsername } from "../apps/server/src/auth/accounts.js";
import { readConfig } from "../apps/server/src/config.js";
import {
  openDatabase,
  runMigrations,
  type SqliteDatabase
} from "../apps/server/src/storage/database.js";

const MAX_PASSWORD_BYTES = 512;

export async function bootstrapOperator(
  database: SqliteDatabase,
  usernameInput: unknown,
  passwordInput: unknown
): Promise<void> {
  const username = validateUsername(usernameInput);
  const password = validatePassword(passwordInput);
  const credential = await hashPassword(password);

  try {
    const result = database.transaction(() =>
      database.prepare(
        `INSERT INTO accounts
         (id, username, normalized_username, password_hash, password_salt, role, created_at)
         SELECT ?, ?, ?, ?, ?, 'operator', ?
         WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE role = 'operator')`
      ).run(
        randomUUID(),
        username,
        username.toLowerCase(),
        credential.passwordHash,
        credential.passwordSalt,
        new Date().toISOString()
      )
    )();
    if (result.changes !== 1) {
      throw new Error("An operator account already exists; bootstrap is disabled.");
    }
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "SQLITE_CONSTRAINT_UNIQUE"
    ) {
      const operatorExists = database
        .prepare("SELECT 1 AS found FROM accounts WHERE role = 'operator'")
        .get();
      if (operatorExists) {
        throw new Error("An operator account already exists; bootstrap is disabled.");
      }
      throw new Error("That username is already in use.");
    }
    throw error;
  }
}

export async function readPasswordFromStdin(
  input: NodeJS.ReadableStream = process.stdin
): Promise<string> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of input) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    totalBytes += buffer.length;
    if (totalBytes > MAX_PASSWORD_BYTES) {
      throw new Error("Password input exceeds the supported length.");
    }
    chunks.push(buffer);
  }
  const password = Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
  return validatePassword(password);
}

async function main(args: readonly string[]): Promise<void> {
  if (
    args.length !== 3 ||
    args[0] !== "bootstrap" ||
    args[2] !== "--password-stdin"
  ) {
    throw new Error("Usage: operator bootstrap <username> --password-stdin");
  }

  const password = await readPasswordFromStdin();
  const database = openDatabase(readConfig().databasePath);
  try {
    runMigrations(database);
    await bootstrapOperator(database, args[1], password);
    console.log(`Created operator account ${args[1]}.`);
  } finally {
    database.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Operator bootstrap failed.");
    process.exitCode = 1;
  });
}
