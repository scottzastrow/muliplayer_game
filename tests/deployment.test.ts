import { describe, expect, it } from "vitest";
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync, cpSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { openDatabase, type SqliteDatabase } from "../apps/server/src/storage/database.js";
import { readConfig } from "../apps/server/src/config.js";

const service = readFileSync("deploy\\game.service", "utf8");
const nginx = readFileSync("deploy\\nginx.conf", "utf8");
const runbook = readFileSync("deploy\\README.md", "utf8");
const hosting = readFileSync("docs\\hosting.md", "utf8");

describe("deployment examples", () => {
  it("runs compiled Node with private systemd state and the documented production environment", () => {
    const entries = new Map<string, string>();
    let section = "";
    for (const line of service.split(/\r?\n/)) {
      if (!line.trim() || line.startsWith("#")) continue;
      if (line.startsWith("[")) { section = line.slice(1, -1); continue; }
      const separator = line.indexOf("=");
      expect(separator).toBeGreaterThan(0);
      const key = `${section}.${line.slice(0, separator)}`;
      expect(entries.has(key)).toBe(false);
      entries.set(key, line.slice(separator + 1));
    }
    expect(entries.get("Service.EnvironmentFile")).toBe("/etc/multiplayer-game/game.env");
    expect(entries.get("Service.WorkingDirectory")).toBe("/opt/multiplayer-game/current");
    expect(entries.get("Service.ExecStart")).toBe("/usr/bin/node apps/server/dist/main.js");
    expect(entries.get("Service.ExecStart")).not.toContain("--env-file");
    expect(entries.get("Service.User")).toBe("multiplayer-game");
    expect(entries.get("Service.Group")).toBe("multiplayer-game");
    expect(entries.get("Service.StateDirectory")).toBe("multiplayer-game");
    expect(entries.get("Service.StateDirectoryMode")).toBe("0700");
    expect(entries.get("Service.UMask")).toBe("0077");
    expect(entries.get("Service.ProtectSystem")).toBe("strict");
    expect(entries.get("Service.ProtectHome")).toBe("true");
    expect(entries.get("Service.NoNewPrivileges")).toBe("true");
    expect(entries.get("Service.ReadWritePaths")).toBe("/var/lib/multiplayer-game");
    expect(entries.get("Service.Restart")).toBe("on-failure");
    expect(entries.get("Service.KillSignal")).toBe("SIGTERM");
    expect(entries.get("Service.TimeoutStopSec")).toBe("60");
    expect(entries.get("Unit.StartLimitBurst")).toBe("5");
    const environmentBlock = /```dotenv\r?\n([\s\S]*?)```/.exec(runbook)?.[1];
    if (!environmentBlock) throw new Error("Runbook has no production environment example.");
    const environment = Object.fromEntries(environmentBlock.trim().split(/\r?\n/)
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1)];
      }));
    expect(readConfig(environment)).toEqual({
      nodeEnv: "production", host: "127.0.0.1", port: 8082,
      publicOrigin: "https://multiplayer-game.vergotek.com",
      databasePath: "/var/lib/multiplayer-game/game.sqlite"
    });
    expect(runbook).toContain("apps/server/src/storage/migrations/*.sql");
    expect(readFileSync("apps/server/src/storage/database.ts", "utf8"))
      .toContain('"apps/server/src/storage/migrations"');
    expect(existsSync(resolve("apps", "server", "src", "main.ts"))).toBe(true);
  });

  it("preserves the documented TLS baseline and forwards exact API/WS paths without forging Origin", () => {
    expect(hosting).toContain("multiplayer-game.vergotek.com");
    expect(hosting).toContain("/etc/letsencrypt/live/multiplayer-game.vergotek.com/");
    expect(nginx).toContain("server_name multiplayer-game.vergotek.com;");
    expect(nginx).toContain("ssl_certificate /etc/letsencrypt/live/multiplayer-game.vergotek.com/fullchain.pem;");
    expect(nginx).toContain("ssl_certificate_key /etc/letsencrypt/live/multiplayer-game.vergotek.com/privkey.pem;");
    expect(nginx).toContain("include /etc/letsencrypt/options-ssl-nginx.conf;");
    expect(nginx).toContain("ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;");
    expect(nginx).toContain("root /opt/multiplayer-game/current/dist/client;");
    expect(nginx).not.toMatch(/alias\s+\/var\/lib|root\s+\/opt\/multiplayer-game\/current;/);
    expect(nginx).toContain("client_max_body_size 10m;");
    expect(nginx.match(/proxy_pass http:\/\/127\.0\.0\.1:8082;/g)).toHaveLength(3);
    const ws = /location = \/ws \{([\s\S]*?)\n    \}/.exec(nginx)?.[1];
    const api = /location \/api\/ \{([\s\S]*?)\n    \}/.exec(nginx)?.[1];
    if (!ws || !api) throw new Error("Nginx example is missing API or WebSocket location.");
    for (const block of [ws, api]) {
      expect(block).toContain("proxy_http_version 1.1;");
      expect(block).toContain("proxy_set_header Origin $http_origin;");
      expect(block).toContain("proxy_cache off;");
      expect(block).toContain("proxy_buffering off;");
      expect(block).toContain("access_log off;");
      expect(block).not.toContain("proxy_set_header Cookie");
    }
    expect(ws).toContain("proxy_set_header Upgrade $http_upgrade;");
    expect(ws).toContain("proxy_set_header Connection $multiplayer_game_connection_upgrade;");
    expect(ws).toContain("proxy_read_timeout 75s;");
    expect(nginx).toContain("map $http_upgrade $multiplayer_game_connection_upgrade");
    expect(nginx).toContain("return 301 https://multiplayer-game.vergotek.com$request_uri;");
    expect(nginx).toContain("location ^~ /.well-known/acme-challenge/");
    const uncommented = nginx.replace(/#[^\r\n]*/g, "");
    let depth = 0;
    for (const character of uncommented) {
      if (character === "{") depth++;
      if (character === "}") depth--;
      expect(depth).toBeGreaterThanOrEqual(0);
    }
    expect(depth).toBe(0);
  });

  it("documents stopped writers, verified backups, sidecar isolation and native deployment gates", () => {
    for (const required of [
      "set -eu", "umask 077", "chmod 0600 /etc/multiplayer-game/game.env",
      "systemctl stop game.service", "MainPID --value", "ActiveState --value",
      "PRAGMA wal_checkpoint(TRUNCATE);", 'test "$checkpoint" = \'0|0|0\'',
      '".backup \'$backup_dir/game.sqlite\'"', "PRAGMA integrity_check;",
      "PRAGMA foreign_key_check;", 'cp -a "$source_dir/themes" "$backup_dir/themes"',
      'mv "$state_dir" "$rollback_dir"', 'mv "$restore_dir" "$state_dir"',
      "absolute", "Interrupted", "systemd-analyze verify", "sudo nginx -t",
      "/health/ready", "co-hosted", "Do not expose 8082", "not a deployed game"
    ]) expect(runbook).toContain(required);
    expect(runbook).not.toMatch(/(?:sudo )?rm -rf/);
    expect(runbook.replace(/\s+/g, " ")).toContain("Do not overwrite the Certbot-managed site");
  });

  it("backs up committed WAL data and restores matching assets into a clean state tree", async () => {
    const temporary = mkdtempSync(join(tmpdir(), "multiplayer-deploy-backup-"));
    let source: SqliteDatabase | undefined;
    let restored: SqliteDatabase | undefined;
    try {
      const state = join(temporary, "state");
      const backup = join(temporary, "backup");
      const staged = join(temporary, "restore");
      mkdirSync(state);
      mkdirSync(backup);
      mkdirSync(staged);
      source = openDatabase(join(state, "game.sqlite"));
      source.pragma("journal_mode = WAL");
      source.pragma("foreign_keys = ON");
      source.exec(`
        CREATE TABLE accounts(id TEXT PRIMARY KEY, username TEXT NOT NULL);
        CREATE TABLE results(account_id TEXT REFERENCES accounts(id), score INTEGER NOT NULL);
        CREATE TABLE assets(digest TEXT PRIMARY KEY);
        INSERT INTO accounts VALUES ('synthetic-account', 'SyntheticPlayer');
        INSERT INTO results VALUES ('synthetic-account', 25);
        INSERT INTO assets VALUES ('fixture-digest');
      `);
      expect(existsSync(join(state, "game.sqlite-wal"))).toBe(true);
      mkdirSync(join(state, "themes", "fixture-digest"), { recursive: true });
      writeFileSync(join(state, "themes", "fixture-digest", "asset.txt"), "fixture-only asset");
      // SQLite's online backup is the API behind sqlite3 .backup, not a live file copy.
      await source.backup(join(backup, "game.sqlite"));
      cpSync(join(state, "themes"), join(backup, "themes"), { recursive: true });
      source.close();
      source = undefined;
      cpSync(join(backup, "game.sqlite"), join(staged, "game.sqlite"));
      cpSync(join(backup, "themes"), join(staged, "themes"), { recursive: true });
      // Old sidecars stay with the rollback tree rather than the restored database.
      writeFileSync(join(state, "game.sqlite-wal"), "stale sidecar fixture");
      writeFileSync(join(state, "game.sqlite-shm"), "stale sidecar fixture");
      const rollback = join(temporary, "rollback");
      renameSync(state, rollback);
      renameSync(staged, state);
      expect(existsSync(join(state, "game.sqlite-wal"))).toBe(false);
      expect(existsSync(join(state, "game.sqlite-shm"))).toBe(false);
      expect(existsSync(join(rollback, "game.sqlite-wal"))).toBe(true);
      restored = openDatabase(join(state, "game.sqlite"));
      expect(restored.pragma("integrity_check", { simple: true })).toBe("ok");
      expect(restored.pragma("foreign_key_check")).toEqual([]);
      expect(restored.prepare("SELECT username, score FROM accounts JOIN results ON id = account_id").get())
        .toEqual({ username: "SyntheticPlayer", score: 25 });
      const asset = restored.prepare("SELECT digest FROM assets").get() as { digest: string } | undefined;
      if (!asset) throw new Error("Restored database lost its asset declaration.");
      expect(readFileSync(join(state, "themes", asset.digest, "asset.txt"), "utf8"))
        .toBe("fixture-only asset");
    } finally {
      restored?.close();
      source?.close();
      rmSync(temporary, { recursive: true, force: true });
    }
  });
});
