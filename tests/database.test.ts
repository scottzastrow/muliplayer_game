import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_MIGRATIONS_DIRECTORY,
  openDatabase,
  reconcileInterruptedMatches,
  runMigrations
} from "../apps/server/src/storage/database.js";

const expectedMigrations = [
"001-initial.sql",
"002-lobby-settings.sql",
"003-match-display-name.sql",
"004-default-theme-display-name.sql",
"005-single-operator.sql",
"006-fixture-theme.sql",
"007-account-control-mode.sql",
"008-match-completion-reason.sql",
"009-first-person-controls.sql",
"010-game-controller-controls.sql",
];

let temporaryDirectory: string | undefined;

afterEach(() => {
  if (temporaryDirectory) {
    rmSync(temporaryDirectory, { recursive: true, force: true });
    temporaryDirectory = undefined;
  }
});

describe("SQLite migrations and restart reconciliation", () => {
  it("preserves existing control choices when adding Game Controller", () => {
    const database = openDatabase(":memory:");
    try {
      for (const name of expectedMigrations.slice(0, -2)) {
        database.exec(readFileSync(join(DEFAULT_MIGRATIONS_DIRECTORY, name), "utf8"));
      }
      const modes = ["keyboard-only", "keyboard-mouse", null];
      const insert = database.prepare(
        `INSERT INTO accounts
         (id, username, normalized_username, password_hash, password_salt, role, created_at, control_mode)
         VALUES (?, ?, ?, 'test-hash', 'test-salt', 'player', 'now', ?)`
      );
      modes.forEach((mode, index) => insert.run(`p${index}`, `user${index}`, `user${index}`, mode));
      database.exec(readFileSync(join(DEFAULT_MIGRATIONS_DIRECTORY, expectedMigrations.at(-2)!), "utf8"));
      insert.run("p3", "user3", "user3", "first-person");
      database.exec(readFileSync(join(DEFAULT_MIGRATIONS_DIRECTORY, expectedMigrations.at(-1)!), "utf8"));
      expect(database.prepare("SELECT control_mode FROM accounts ORDER BY id").all())
        .toEqual([...modes, "first-person"].map(control_mode => ({ control_mode })));
      expect(() => database.prepare("UPDATE accounts SET control_mode = 'first-person'").run())
        .not.toThrow();
      expect(() => database.prepare("UPDATE accounts SET control_mode = 'game-controller'").run())
        .not.toThrow();
      expect(() => database.prepare("UPDATE accounts SET control_mode = 'gamepad'").run()).toThrow();
      expect(database.pragma("foreign_key_check")).toEqual([]);
    } finally { database.close(); }
  });

  it("enables WAL/foreign keys and applies migrations once", () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), "multiplayer-game-db-"));
    const database = openDatabase(join(temporaryDirectory, "test.sqlite"));
    try {
      expect(database.pragma("journal_mode", { simple: true })).toBe("wal");
      expect(database.pragma("foreign_keys", { simple: true })).toBe(1);

      const registeredMigrations = readdirSync(DEFAULT_MIGRATIONS_DIRECTORY)
        .filter((name) => /^\d{3,}-[a-z0-9-]+\.sql$/i.test(name))
        .sort(
          (left, right) =>
            Number(left.slice(0, left.indexOf("-"))) -
            Number(right.slice(0, right.indexOf("-")))
        );
      expect(registeredMigrations).toEqual(expectedMigrations);

      runMigrations(database);
      runMigrations(database);
      expect(
        database
          .prepare(
            "SELECT name, COUNT(*) AS count FROM schema_migrations GROUP BY name ORDER BY name"
          )
          .all()
      ).toEqual(
        expectedMigrations.map((name) => ({ name, count: 1 }))
      );

      expect(() =>
        database
          .prepare(
            `INSERT INTO auth_sessions(token_digest, account_id, created_at, expires_at)
             VALUES ('digest', 'missing-account', 'now', 'later')`
          )
          .run()
      ).toThrow();
    } finally {
      database.close();
    }
  });

  it("marks waiting and running matches interrupted and creates one durable result", () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), "multiplayer-game-db-"));
    const database = openDatabase(join(temporaryDirectory, "test.sqlite"));
    try {
      runMigrations(database);
      database
        .prepare(
          `INSERT INTO accounts
           (id, username, normalized_username, password_hash, password_salt, role, created_at)
           VALUES (?, ?, ?, ?, ?, 'player', ?)`
        )
        .run("account-1", "Alice", "alice", "not-a-real-hash", "test-salt", "2026-11-06T00:00:00Z");
      const addMatch = database.prepare(
        `INSERT INTO matches
         (id, creator_account_id, state, settings_json, theme_digest, seed, current_level, created_at)
         VALUES (?, 'account-1', ?, '{}', ?, 10, 2, '2026-11-06T00:00:00Z')`
      );
      addMatch.run("waiting-match", "waiting", "a".repeat(64));
      addMatch.run("running-match", "running", "b".repeat(64));
      addMatch.run("finished-match", "finished", "c".repeat(64));

      expect(reconcileInterruptedMatches(database, "2026-11-06T01:00:00Z")).toBe(2);
      expect(reconcileInterruptedMatches(database, "2026-11-06T02:00:00Z")).toBe(0);
      expect(
        database
          .prepare("SELECT state FROM matches WHERE id = 'running-match'")
          .get()
      ).toEqual({ state: "interrupted" });
      expect(
        database
          .prepare("SELECT status, final_level, standings_json FROM match_results WHERE match_id = ?")
          .get("running-match")
      ).toEqual({ status: "interrupted", final_level: 2, standings_json: "[]" });
      expect(
        (database.prepare("SELECT COUNT(*) AS count FROM match_results").get() as { count: number })
          .count
      ).toBe(2);
    } finally {
      database.close();
    }
  });
});
