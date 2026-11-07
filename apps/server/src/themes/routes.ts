import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import { HttpError } from "../errors.js";
import {
  authenticateRequest,
  requireAccount,
  requireJson,
  requireSameOrigin,
  type AuthContext
} from "../auth/routes.js";
import type { SqliteDatabase } from "../storage/database.js";
import type { ThemeLoader } from "./builtins.js";
import {
  MAX_THEME_ARCHIVE_BYTES,
  validateAndInstallThemePackage
} from "./packages.js";

const ThemeVersionSchema = z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
const ThemeIdSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/);
const ToggleSchema = z.object({ enabled: z.boolean() }).strict();

interface ThemeRow {
  readonly theme_id: string;
  readonly version: string;
  readonly name: string;
  readonly module_id: string;
  readonly module_version: string;
  readonly renderer_id: string;
  readonly renderer_version: string;
  readonly engine_api_major: number;
  readonly digest: string;
  readonly enabled: number;
}

function requireOperator(
  database: SqliteDatabase,
  auth: AuthContext,
  request: Parameters<typeof authenticateRequest>[1]
): void {
  const account = requireAccount(auth, request);
  if (account.role !== "operator") {
    throw new HttpError(403, "FORBIDDEN", "Operator access is required.");
  }
}

function assetDirectory(databasePath: string): string {
  const absoluteDatabasePath = databasePath === ":memory:"
    ? resolve("var/game.sqlite")
    : isAbsolute(databasePath) ? databasePath : resolve(databasePath);
  return resolve(dirname(absoluteDatabasePath), "themes");
}

export function registerThemeRoutes(
  app: FastifyInstance,
  database: SqliteDatabase,
  config: AppConfig,
  auth: AuthContext,
  loader: ThemeLoader
): void {
  app.get("/api/v1/admin/themes", async (request) => {
    requireOperator(database, auth, request);
    const themes = database.prepare(
      `SELECT theme_id, version, name, module_id, module_version, renderer_id,
              renderer_version, engine_api_major, digest, enabled
       FROM theme_revisions ORDER BY theme_id, version`
    ).all() as ThemeRow[];
    return {
      themes: themes.map((theme) => ({
        id: theme.theme_id,
        version: theme.version,
        name: theme.name,
        module: { id: theme.module_id, version: theme.module_version },
        renderer: { id: theme.renderer_id, version: theme.renderer_version },
        engineApiMajor: theme.engine_api_major,
        digest: theme.digest,
        enabled: theme.enabled === 1
      }))
    };
  });

  app.post(
    "/api/v1/admin/themes/upload",
    { bodyLimit: MAX_THEME_ARCHIVE_BYTES },
    async (request, reply) => {
      requireSameOrigin(request, config);
      requireOperator(database, auth, request);
      if (request.headers["content-type"]?.split(";")[0]?.trim() !== "application/zip") {
        throw new HttpError(400, "BAD_REQUEST", "Theme uploads must use application/zip.");
      }
      if (!Buffer.isBuffer(request.body)) {
        throw new HttpError(400, "BAD_REQUEST", "Theme upload body is not a ZIP archive.");
      }

      const uploadDirectory = mkdtempSync(join(tmpdir(), "multiplayer-theme-upload-"));
      const archivePath = join(uploadDirectory, "upload.zip");
      try {
        writeFileSync(archivePath, request.body, { flag: "wx" });
        const installed = await validateAndInstallThemePackage(
          database,
          archivePath,
          assetDirectory(config.databasePath),
          loader.registeredModules(),
          loader.registeredRenderers()
        );
        reply.code(201);
        const { definition } = installed.revision;
        return {
          theme: {
            id: definition.id,
            version: definition.version,
            name: definition.name,
            digest: installed.revision.packageDigest
          }
        };
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw new HttpError(
          422,
          "INCOMPATIBLE_THEME",
          error instanceof Error ? error.message : "Theme package validation failed."
        );
      } finally {
        rmSync(uploadDirectory, { recursive: true, force: true });
      }
    }
  );

  app.patch<{ Params: { themeId: string; version: string } }>(
    "/api/v1/admin/themes/:themeId/:version",
    { bodyLimit: 4 * 1024 },
    async (request) => {
      requireJson(request);
      requireSameOrigin(request, config);
      requireOperator(database, auth, request);
      const themeId = ThemeIdSchema.safeParse(request.params.themeId);
      const version = ThemeVersionSchema.safeParse(request.params.version);
      if (!themeId.success || !version.success) {
        throw new HttpError(404, "NOT_FOUND", "Theme revision not found.");
      }
      const parsed = ToggleSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new HttpError(400, "BAD_REQUEST", "Theme enabled state is invalid.");
      }
      const result = database.prepare(
        `UPDATE theme_revisions SET enabled = ?
         WHERE theme_id = ? AND version = ?`
      ).run(Number(parsed.data.enabled), themeId.data, version.data);
      if (result.changes !== 1) {
        throw new HttpError(404, "NOT_FOUND", "Theme revision not found.");
      }
      return {
        theme: {
          id: themeId.data,
          version: version.data,
          enabled: parsed.data.enabled
        }
      };
    }
  );
}
