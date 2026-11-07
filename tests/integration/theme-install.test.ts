import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_GAME_SETTINGS } from "@multiplayer-game/protocol";
import { defaultThemeDefinition } from "@multiplayer-game/default-theme";
import { fixtureThemeDefinition } from "@multiplayer-game/fixture-theme";
import type { ThemeDefinition } from "@multiplayer-game/theme-sdk";
import { createApp } from "../../apps/server/src/app.js";
import { readConfig } from "../../apps/server/src/config.js";
import { openDatabase, runMigrations } from "../../apps/server/src/storage/database.js";
import { createThemeLoader } from "../../apps/server/src/themes/builtins.js";
import { ThemeRegistry } from "../../apps/server/src/themes/registry.js";
import {
  calculateThemePackageDigest, MAX_THEME_ARCHIVE_BYTES, MAX_THEME_ARCHIVE_ENTRIES,
  MAX_THEME_EXTRACTED_BYTES, MAX_THEME_IMAGE_EDGE, MAX_THEME_IMAGE_PIXELS
} from "../../apps/server/src/themes/packages.js";
import { createThemeZip, png, type ArchiveEntry } from "../helpers/theme-archive.js";

const ORIGIN = "https://theme-install.example.test";
const JSON_HEADERS = { origin: ORIGIN, "content-type": "application/json" };
const PASSWORD = "test-only password with sufficient length";

describe("theme installation conformance", () => {
  let database: ReturnType<typeof openDatabase>;
  let app: ReturnType<typeof createApp>;
  let directory: string;
  let operatorCookie: string;
  let playerCookie: string;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), "multiplayer-theme-install-"));
    database = openDatabase(":memory:");
    runMigrations(database);
    app = createApp(readConfig({
      NODE_ENV: "test", PUBLIC_ORIGIN: ORIGIN, DATABASE_PATH: join(directory, "game.sqlite")
    }), database, { ready: true });
    operatorCookie = await registerLogin("InstallOperator", true);
    playerCookie = await registerLogin("InstallPlayer", false);
  });

  afterEach(async () => {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it("accepts registered default/fixture code, rolls back duplicate installs and retains active pins", async () => {
    const sessions: Array<{ id: string; revision: string; digest: string }> = [];
    for (const definition of [defaultThemeDefinition, fixtureThemeDefinition]) {
      const revision = `${definition.id}@${definition.version}`;
      const created = await app.inject({
        method: "POST", url: "/api/v1/sessions",
        headers: { ...JSON_HEADERS, cookie: playerCookie },
        payload: {
          settings: {
            ...DEFAULT_GAME_SETTINGS, themeRevision: revision, maxPlayers: 1,
            initialNpcsPerPlayer: 1, npcPopulationGrowthPercent: 0, maxLevels: 1
          }
        }
      });
      expect(created.statusCode).toBe(201);
      const id = created.json().session.id as string;
      const started = await app.inject({
        method: "POST", url: `/api/v1/sessions/${id}/start`,
        headers: { ...JSON_HEADERS, cookie: playerCookie }, payload: { expectedRevision: 0 }
      });
      expect(started.statusCode).toBe(200);
      sessions.push({ id, revision, digest: definition.assetsDigest });

      const packageDefinition = manifest(definition, [], {
        id: definition.id, name: definition.name, version: "1.0.1"
      });
      const archive = archiveFor(packageDefinition);
      const registryBefore = registryRows();
      const upload = await uploadArchive(archive, operatorCookie);
      expect(upload.statusCode).toBe(201);
      expect(upload.json().theme).toMatchObject({
        id: definition.id, version: "1.0.1", digest: packageDefinition.assetsDigest
      });
      expect(registryRows()).toHaveLength(registryBefore.length + 1);
      expect(database.prepare(
        "SELECT module_id, renderer_id, digest, enabled FROM theme_revisions WHERE theme_id = ? AND version = ?"
      ).get(definition.id, "1.0.1")).toEqual({
        module_id: definition.module.id, renderer_id: definition.skin.rendererId,
        digest: packageDefinition.assetsDigest, enabled: 1
      });
      const assetRoot = join(directory, "themes", String(packageDefinition.assetsDigest));
      expect(JSON.parse(readFileSync(join(assetRoot, "theme.json"), "utf8")))
        .toEqual(packageDefinition);
      const installedRows = registryRows();
      expect((await uploadArchive(archive, operatorCookie)).statusCode).toBe(422);
      expect(registryRows()).toEqual(installedRows);
      expect(existsSync(assetRoot)).toBe(true);

      const disabled = await toggle(definition.id, false, operatorCookie);
      expect(disabled.statusCode).toBe(200);
      const registry = new ThemeRegistry(database, createThemeLoader());
      expect(registry.getPinned(revision, definition.assetsDigest).digest).toBe(definition.assetsDigest);
      expect(() => registry.getEnabled(revision)).toThrow("unavailable");
      const newSession = await app.inject({
        method: "POST", url: "/api/v1/sessions",
        headers: { ...JSON_HEADERS, cookie: playerCookie },
        payload: { settings: { ...DEFAULT_GAME_SETTINGS, themeRevision: revision } }
      });
      expect(newSession.statusCode).toBe(422);
      expect(newSession.json().error.code).toBe("INCOMPATIBLE_THEME");
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(new Set(sessions.map(({ id }) => id)).size).toBe(2);
    for (const { id, revision, digest } of sessions) {
      const row = database.prepare(
        "SELECT state, theme_digest, settings_json FROM matches WHERE id = ?"
      ).get(id) as { state: string; theme_digest: string; settings_json: string } | undefined;
      if (!row) throw new Error(`Missing active match ${id}.`);
      expect(row.state).toBe("running");
      expect(row.theme_digest).toBe(digest);
      expect(JSON.parse(row.settings_json).themeRevision).toBe(revision);
      expect((await app.inject({
        url: `/api/v1/sessions/${id}`, headers: { cookie: playerCookie }
      })).json().session.status).toBe("running");
    }
  });

  it("enforces roles/origin and rejects malformed, incompatible and unsafe packages atomically", async () => {
    const baseline = registryRows();
    const valid = archiveFor(manifest());
    expect((await uploadArchive(valid, playerCookie)).statusCode).toBe(403);
    expect((await toggle("default", false, playerCookie)).statusCode).toBe(403);
    expect((await uploadArchive(valid, "")).statusCode).toBe(401);
    expect((await toggle("default", false, "")).statusCode).toBe(401);
    expect((await uploadArchive(valid, operatorCookie, "https://untrusted.example.test")).statusCode)
      .toBe(403);
    expect(registryRows()).toEqual(baseline);

    async function reject(bytes: Buffer, message?: string, status = 422): Promise<void> {
      const response = await uploadArchive(bytes, operatorCookie);
      expect(response.statusCode).toBe(status);
      if (status === 422) expect(response.json().error.code).toBe("INCOMPATIBLE_THEME");
      if (message) expect(response.json().error.message).toContain(message);
      expect(registryRows()).toEqual(baseline);
      expect(existsSync(join(directory, "themes")) ? readdirSync(join(directory, "themes")) : [])
        .toEqual([]);
      expect(readdirSync(directory)).toEqual([]);
    }

    await reject(Buffer.alloc(32), "end-of-central-directory");
    await reject(createThemeZip([{ path: "theme.json", bytes: Buffer.from("{invalid") }]), "invalid JSON");
    await reject(createThemeZip([{ path: "missing.png", bytes: png() }]), "theme.json");
    await reject(archiveFor(manifest(defaultThemeDefinition, [], { engineApiMajor: 2 })), "does not match");
    await reject(archiveFor(manifest(defaultThemeDefinition, [], {
      module: { ...defaultThemeDefinition.module, version: "99.0.0" }
    })), "not registered");
    await reject(archiveFor(manifest(defaultThemeDefinition, [], {
      skin: { ...defaultThemeDefinition.skin, version: "99.0.0" }
    })), "not registered");
    await reject(archiveFor(manifest(defaultThemeDefinition, [], {
      module: { ...defaultThemeDefinition.module, stateSchemaVersion: 99 },
      skin: { ...defaultThemeDefinition.skin, acceptedStateSchemaVersions: [99] }
    })), "does not match");
    await reject(archiveFor({ ...manifest(), assetsDigest: "0".repeat(64) }), "digest");

    for (const path of ["../escape.png", "/absolute.png", "C:/absolute.png", "images\\escape.png"]) {
      await reject(createThemeZip([{ path, bytes: png() }]), "Unsafe ZIP entry path");
    }
    expect(existsSync(join(directory, "escape.png"))).toBe(false);
    for (const path of ["module.js", "module.ts", "page.html", "image.svg", "program.exe", "nested.zip"]) {
      const assets = [{ path, bytes: Buffer.from("untrusted executable content") }];
      await reject(archiveFor(manifest(defaultThemeDefinition, assets), assets), "not allowed");
    }
    await reject(archiveFor(manifest(), [{ path: "undeclared.png", bytes: png() }]), "undeclared");
    const required = [{ path: "required.png", bytes: png() }];
    await reject(archiveFor(manifest(defaultThemeDefinition, required)), "missing");
    await reject(archiveFor(manifest(defaultThemeDefinition, required), [
      { path: "required.png", bytes: png(2, 1) }
    ]), "SHA-256");
    await reject(createThemeZip([
      { path: "theme.json", bytes: Buffer.from("{}") },
      { path: "THEME.JSON", bytes: Buffer.from("{}") }
    ]), "case-colliding");
    const link = createThemeZip([{ path: "link.png", bytes: Buffer.from("../outside") }]);
    const centralOffset = link.readUInt32LE(link.length - 6);
    link.writeUInt32LE(0xa1ff0000, centralOffset + 38);
    await reject(link, "not a regular file");

    expect(MAX_THEME_ARCHIVE_BYTES).toBe(10 * 1024 * 1024);
    expect(MAX_THEME_EXTRACTED_BYTES).toBe(40 * 1024 * 1024);
    expect(MAX_THEME_ARCHIVE_ENTRIES).toBe(256);
    expect(MAX_THEME_IMAGE_EDGE).toBe(4096);
    expect(MAX_THEME_IMAGE_PIXELS).toBe(32_000_000);
    await reject(Buffer.alloc(MAX_THEME_ARCHIVE_BYTES + 1), undefined, 413);
    await reject(createThemeZip(Array.from({ length: MAX_THEME_ARCHIVE_ENTRIES + 1 },
      (_, index) => ({ path: `asset-${index}.png`, bytes: Buffer.alloc(0) }))), "entry limit");
    const extractedLimit = createThemeZip([{ path: "theme.json", bytes: Buffer.from("{}") }]);
    extractedLimit.writeUInt32LE(MAX_THEME_EXTRACTED_BYTES + 1, 22);
    extractedLimit.writeUInt32LE(MAX_THEME_EXTRACTED_BYTES + 1,
      extractedLimit.readUInt32LE(extractedLimit.length - 6) + 24);
    await reject(extractedLimit, "extracted limit");
    const manifestLimit = createThemeZip([
      { path: "theme.json", bytes: Buffer.alloc(256 * 1024 + 1, 0x20) }
    ], { deflate: true });
    await reject(manifestLimit, "manifest limit");
    const lyingSize = createThemeZip([
      { path: "theme.json", bytes: Buffer.alloc(1024, 0x20) }
    ], { deflate: true });
    lyingSize.writeUInt32LE(2, 22);
    lyingSize.writeUInt32LE(2, lyingSize.readUInt32LE(lyingSize.length - 6) + 24);
    await reject(lyingSize, "declared or package size limit");
    const wide = [{ path: "wide.png", bytes: png(MAX_THEME_IMAGE_EDGE + 1, 1) }];
    await reject(archiveFor(manifest(defaultThemeDefinition, wide), wide), "edge limit");
    const pixelOverflow = [
      { path: "first.png", bytes: png(MAX_THEME_IMAGE_EDGE, MAX_THEME_IMAGE_EDGE) },
      { path: "second.png", bytes: png(MAX_THEME_IMAGE_EDGE, MAX_THEME_IMAGE_EDGE) }
    ];
    await reject(archiveFor(manifest(defaultThemeDefinition, pixelOverflow), pixelOverflow), "decoded limit");
  }, 30_000);

  function registryRows() {
    return database.prepare("SELECT * FROM theme_revisions ORDER BY theme_id, version").all();
  }

  function uploadArchive(bytes: Buffer, cookie: string, origin = ORIGIN) {
    return app.inject({
      method: "POST", url: "/api/v1/admin/themes/upload",
      headers: { origin, "content-type": "application/zip", cookie }, payload: bytes
    });
  }

  function toggle(id: string, enabled: boolean, cookie: string) {
    return app.inject({
      method: "PATCH", url: `/api/v1/admin/themes/${id}/1.0.0`,
      headers: { ...JSON_HEADERS, cookie }, payload: { enabled }
    });
  }

  async function registerLogin(username: string, operator: boolean): Promise<string> {
    const registered = await app.inject({
      method: "POST", url: "/api/v1/auth/register", headers: JSON_HEADERS,
      payload: { username, password: PASSWORD }
    });
    expect(registered.statusCode).toBe(201);
    if (operator) {
      database.prepare("UPDATE accounts SET role = 'operator' WHERE id = ?")
        .run(registered.json().account.id);
    }
    const login = await app.inject({
      method: "POST", url: "/api/v1/auth/login", headers: JSON_HEADERS,
      payload: { username, password: PASSWORD }
    });
    expect(login.statusCode).toBe(200);
    const header = login.headers["set-cookie"];
    const cookie = (Array.isArray(header) ? header[0] : header)?.split(";", 1)[0];
    if (!cookie) throw new Error("Login did not set a session cookie.");
    return cookie;
  }
});

function manifest(
  definition: ThemeDefinition = defaultThemeDefinition,
  assets: readonly ArchiveEntry[] = [],
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  const result: Record<string, unknown> = {
    ...definition,
    id: "installation-test",
    name: "Installation Test",
    assets: {
      required: Object.fromEntries(assets.map(({ path, bytes }, index) => [
        `asset-${index}`, { path, sha256: createHash("sha256").update(bytes).digest("hex") }
      ])),
      optional: {}
    },
    ...overrides
  };
  result.assetsDigest = calculateThemePackageDigest(result);
  return result;
}

function archiveFor(
  definition: Record<string, unknown>, assets: readonly ArchiveEntry[] = []
): Buffer {
  return createThemeZip([
    { path: "theme.json", bytes: Buffer.from(JSON.stringify(definition)) }, ...assets
  ], { deflate: true, descriptor: true });
}
