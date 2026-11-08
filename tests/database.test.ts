import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
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
];

let temporaryDirectory: string | undefined;

afterEach(() => {
  if (temporaryDirectory) {
    rmSync(temporaryDirectory, { recursive: true, force: true });
    temporaryDirectory = undefined;
  }
});

describe("SQLite migrations and restart reconciliation", () => {
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
