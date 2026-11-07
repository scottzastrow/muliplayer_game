import { isThemeCompatible } from "@multiplayer-game/theme-sdk";
import type { SqliteDatabase } from "../storage/database.js";
import { HttpError } from "../errors.js";
import type { ThemeLoader } from "./builtins.js";

export interface ThemeRevisionRecord {
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

export class ThemeRegistry {
  constructor(
    readonly database: SqliteDatabase,
    readonly loader: ThemeLoader | undefined
  ) {}

  getEnabled(revision: string): ThemeRevisionRecord {
    const separator = revision.lastIndexOf("@");
    const row = separator > 0
      ? this.database.prepare(
        `SELECT theme_id, version, name, module_id, module_version, renderer_id,
                renderer_version, engine_api_major, digest, enabled
         FROM theme_revisions WHERE theme_id = ? AND version = ? AND enabled = 1`
      ).get(revision.slice(0, separator), revision.slice(separator + 1)) as
        ThemeRevisionRecord | undefined
      : undefined;
    if (!row) {
      throw new HttpError(422, "INCOMPATIBLE_THEME", "The selected theme revision is unavailable.");
    }
    return this.#validateLoaded(row);
  }

  getPinned(revision: string, packageDigest: string): ThemeRevisionRecord {
    const separator = revision.lastIndexOf("@");
    if (separator <= 0) {
      throw new Error(`Pinned theme revision ${revision} is invalid.`);
    }
    const rows = this.database.prepare(
      `SELECT theme_id, version, name, module_id, module_version, renderer_id,
              renderer_version, engine_api_major, digest, enabled
       FROM theme_revisions WHERE theme_id = ? AND version = ? AND digest = ?`
    ).all(
      revision.slice(0, separator),
      revision.slice(separator + 1),
      packageDigest
    ) as ThemeRevisionRecord[];
    if (rows.length !== 1) {
      throw new Error(`Pinned theme revision ${revision} with digest ${packageDigest} is not registered.`);
    }
    return this.#validateLoaded(rows[0]!);
  }

  #validateLoaded(row: ThemeRevisionRecord): ThemeRevisionRecord {
    if (!this.loader) return row;
    const revision = `${row.theme_id}@${row.version}`;
    const loaded = this.loader.get(revision);
    if (!loaded ||
      !isThemeCompatible(loaded.definition, this.loader.engineApiMajor) ||
      loaded.packageDigest !== row.digest ||
      loaded.definition.name !== row.name ||
      loaded.definition.engineApiMajor !== row.engine_api_major ||
      loaded.definition.module.id !== row.module_id ||
      loaded.definition.module.version !== row.module_version ||
      loaded.definition.skin.rendererId !== row.renderer_id ||
      loaded.definition.skin.version !== row.renderer_version) {
      throw new HttpError(422, "INCOMPATIBLE_THEME", "The selected theme revision is not compatible with this server.");
    }
    return row;
  }
}
