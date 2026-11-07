import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { createAccount, verifyCredentials } from "../apps/server/src/auth/accounts.js";
import { openDatabase, runMigrations } from "../apps/server/src/storage/database.js";
import { bootstrapOperator, readPasswordFromStdin } from "../tools/operator.js";
import { defaultThemeDefinition } from "@multiplayer-game/default-theme";
import { registerReviewedThemeCode } from "../tools/install-theme-code.js";

let temporaryDirectory: string | undefined;

afterEach(() => {
  if (temporaryDirectory) {
    rmSync(temporaryDirectory, { recursive: true, force: true });
    temporaryDirectory = undefined;
  }
});

function createTestDatabase() {
  temporaryDirectory = mkdtempSync(join(tmpdir(), "multiplayer-game-operator-"));
  const database = openDatabase(join(temporaryDirectory, "test.sqlite"));
  runMigrations(database);
  return database;
}

describe("local operator and reviewed theme-code tools", () => {
  it("creates only the first operator and keeps public registration player-only", async () => {
    const database = createTestDatabase();
    try {
      await bootstrapOperator(database, "Owner", "correct-horse-battery");
      await expect(
        bootstrapOperator(database, "Second", "another-secure-password")
      ).rejects.toThrow("An operator account already exists");
      await createAccount(database, "Player", "player-secure-password");

      expect(
        database.prepare("SELECT username, role FROM accounts ORDER BY username").all()
      ).toEqual([
        { username: "Owner", role: "operator" },
        { username: "Player", role: "player" }
      ]);
      expect(await verifyCredentials(database, "owner", "correct-horse-battery")).toMatchObject({
        username: "Owner",
        role: "operator"
      });
    } finally {
      database.close();
    }
  });

  it("rejects username collisions and reads a password without command-line arguments", async () => {
    const database = createTestDatabase();
    try {
      await createAccount(database, "Existing", "player-secure-password");
      await expect(
        bootstrapOperator(database, "Existing", "operator-secure-password")
      ).rejects.toThrow("That username is already in use");
    } finally {
      database.close();
    }

    const input = Readable.from([Buffer.from("operator-secret-password\r\n")]);
    await expect(readPasswordFromStdin(input)).resolves.toBe("operator-secret-password");
  });

  it("registers only code present in the reviewed build and validates manifest metadata", () => {
    const registration = registerReviewedThemeCode(
      defaultThemeDefinition,
      "default@1.0.0",
      "default@1.0.0"
    );
    expect(registration.revision.definition.id).toBe("default");
    expect(() =>
      registerReviewedThemeCode(defaultThemeDefinition, "unreviewed@1.0.0", "default@1.0.0")
    ).toThrow("not registered in the reviewed build");
    expect(() =>
      registerReviewedThemeCode(
        { ...defaultThemeDefinition, id: "invalid id" },
        "default@1.0.0",
        "default@1.0.0"
      )
    ).toThrow();
  });
});
