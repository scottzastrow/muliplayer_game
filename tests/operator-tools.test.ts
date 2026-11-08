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

const creditedDefinition = {
  ...defaultThemeDefinition,
  project: "Reviewed code fixture",
  author: "Engine test team"
};

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
      await createAccount(database, "Player", "player-secure-password", "keyboard-mouse");

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
      await createAccount(database, "Existing", "player-secure-password", "keyboard-mouse");
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
      creditedDefinition,
      "default@1.0.0",
      "default@1.0.0"
    );
    expect(registration.revision.definition.id).toBe("default");
    expect(() =>
      registerReviewedThemeCode(creditedDefinition, "unreviewed@1.0.0", "default@1.0.0")
    ).toThrow("not registered in the reviewed build");
    expect(() =>
      registerReviewedThemeCode(
        { ...creditedDefinition, id: "invalid id" },
        "default@1.0.0",
        "default@1.0.0"
      )
    ).toThrow();
  });

  it.each(["project", "author"] as const)("requires nonblank %s on reviewed-code import", (field) => {
    for (const value of [undefined, "", " \t\r\n\u00a0", null, 42]) {
      const manifest: Record<string, unknown> = { ...creditedDefinition };
      if (value === undefined) delete manifest[field];
      else manifest[field] = value;
      expect(() => registerReviewedThemeCode(manifest, "default@1.0.0", "default@1.0.0"))
        .toThrow(`${field === "project" ? "Project" : "Author"} (${field})`);
    }
  });

  it("accepts a person or team, optional Course and unchanged runtime definition", () => {
    for (const author of ["Public author", "Public theme team"]) {
      const registration = registerReviewedThemeCode(
        { ...creditedDefinition, author, course: "Optional course" },
        "default@1.0.0", "default@1.0.0"
      );
      expect(registration.revision.definition).toEqual(defaultThemeDefinition);
      expect(registration.manifest).toMatchObject({
        project: creditedDefinition.project, author, course: "Optional course"
      });
    }
  });
});
