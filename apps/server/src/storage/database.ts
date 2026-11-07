import Database from "better-sqlite3";
import { readdirSync, readFileSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

export type SqliteDatabase = InstanceType<typeof Database>;

export const DEFAULT_MIGRATIONS_DIRECTORY = resolve(
  process.cwd(),
  "apps/server/src/storage/migrations"
);

export function openDatabase(path: string): SqliteDatabase {
  if (path !== ":memory:") {
    const absolutePath = isAbsolute(path) ? path : resolve(process.cwd(), path);
    mkdirSync(dirname(absolutePath), { recursive: true });
    path = absolutePath;
  }

  const database = new Database(path);
  database.pragma("foreign_keys = ON");
  database.pragma("busy_timeout = 5000");
  database.pragma("journal_mode = WAL");
  return database;
}

export function runMigrations(
  database: SqliteDatabase,
  migrationsDirectory = DEFAULT_MIGRATIONS_DIRECTORY
): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `);

  const migrations = readdirSync(migrationsDirectory)
    .filter((name) => /^\d{3,}-[a-z0-9-]+\.sql$/i.test(name))
    .map((name) => {
      const version = Number(name.slice(0, name.indexOf("-")));
      return { name, version, path: resolve(migrationsDirectory, name) };
    })
    .sort((left, right) => left.version - right.version);

  if (migrations.length === 0) {
    throw new Error("No database migrations were found.");
  }

  const seenVersions = new Set<number>();
  for (const migration of migrations) {
    if (seenVersions.has(migration.version)) {
      throw new Error(`Duplicate database migration version ${migration.version}.`);
    }
    seenVersions.add(migration.version);

    const applied = database
      .prepare("SELECT name FROM schema_migrations WHERE version = ?")
      .get(migration.version) as { name: string } | undefined;
    if (applied) {
      if (applied.name !== migration.name) {
        throw new Error(`Applied database migration ${migration.version} has a different name.`);
      }
      continue;
    }

    const sql = readFileSync(migration.path, "utf8");
    database.transaction(() => {
      database.exec(sql);
      database
        .prepare("INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)")
        .run(migration.version, migration.name, new Date().toISOString());
    })();
  }
}

export function reconcileInterruptedMatches(
  database: SqliteDatabase,
  endedAt = new Date().toISOString()
): number {
  return database.transaction(() => {
    const interrupted = database
      .prepare(
        `SELECT id, current_level, settings_json, theme_digest
         FROM matches
         WHERE state IN ('waiting', 'running')`
      )
      .all() as Array<{
      id: string;
      current_level: number;
      settings_json: string;
      theme_digest: string;
    }>;

    const insertResult = database.prepare(
      `INSERT OR IGNORE INTO match_results
       (match_id, status, final_level, standings_json, settings_summary_json, theme_digest, finalized_at)
       VALUES (?, 'interrupted', ?, '[]', ?, ?, ?)`
    );
    const markInterrupted = database.prepare(
      `UPDATE matches SET state = 'interrupted', ended_at = ?
       WHERE id = ? AND state IN ('waiting', 'running')`
    );

    for (const match of interrupted) {
      insertResult.run(
        match.id,
        match.current_level,
        match.settings_json,
        match.theme_digest,
        endedAt
      );
      markInterrupted.run(endedAt, match.id);
    }

    return interrupted.length;
  })();
}
