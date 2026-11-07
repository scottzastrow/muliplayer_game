import {
  isThemeCompatible,
  validateThemeRevision,
  type AssetLoader,
  type ModuleMetadata,
  type SkinFactoryMetadata,
  type ThemeDefinition,
  type ThemePackageRevision
} from "@multiplayer-game/theme-sdk";
import type { JsonValue } from "@multiplayer-game/protocol";
import {
  defaultModuleFactory,
  defaultSkinFactory,
  defaultThemeDefinition,
  type DefaultEntity
} from "@multiplayer-game/default-theme";
import type { ModuleContext, RosterMember } from "@multiplayer-game/theme-sdk";

export interface BuiltinThemeRegistration {
  readonly revision: ThemePackageRevision;
  readonly moduleFactory: typeof defaultModuleFactory;
  readonly skinFactory: typeof defaultSkinFactory;
}

export interface LoadedTheme {
  readonly definition: ThemeDefinition;
  readonly packageDigest: string;
  readonly moduleFactory: typeof defaultModuleFactory;
  readonly skinFactory: typeof defaultSkinFactory;
}

export const DEFAULT_THEME_REGISTRATION: BuiltinThemeRegistration = Object.freeze({
  revision: Object.freeze({
    definition: defaultThemeDefinition,
    packageDigest: defaultThemeDefinition.assetsDigest,
    installedModule: defaultModuleFactory.metadata,
    installedRenderer: defaultSkinFactory.metadata
  }),
  moduleFactory: defaultModuleFactory,
  skinFactory: defaultSkinFactory
});

export class ThemeLoader {
  readonly #themes = new Map<string, LoadedTheme>();

  constructor(
    registrations: readonly BuiltinThemeRegistration[] = [DEFAULT_THEME_REGISTRATION],
    readonly engineApiMajor = 1
  ) {
    for (const registration of registrations) {
      const definition = validateThemeRevision(registration.revision);
      if (!isThemeCompatible(definition, engineApiMajor)) {
        throw new Error(`Theme ${definition.id}@${definition.version} is not compatible.`);
      }
      if (
        registration.moduleFactory.metadata.id !== definition.module.id ||
        registration.moduleFactory.metadata.version !== definition.module.version ||
        registration.moduleFactory.metadata.stateSchemaVersion !==
          definition.module.stateSchemaVersion
      ) {
        throw new Error(`Theme ${definition.id}@${definition.version} has a mismatched module.`);
      }
      if (
        registration.skinFactory.metadata.id !== definition.skin.rendererId ||
        registration.skinFactory.metadata.version !== definition.skin.version ||
        registration.skinFactory.metadata.acceptedModuleId !== definition.module.id ||
        !registration.skinFactory.metadata.acceptedStateSchemaVersions.includes(
          definition.module.stateSchemaVersion
        )
      ) {
        throw new Error(`Theme ${definition.id}@${definition.version} has a mismatched renderer.`);
      }
      const key = `${definition.id}@${definition.version}`;
      if (this.#themes.has(key)) {
        throw new Error(`Theme ${key} is registered more than once.`);
      }
      this.#themes.set(
        key,
        Object.freeze({
          definition,
          packageDigest: registration.revision.packageDigest,
          moduleFactory: registration.moduleFactory,
          skinFactory: registration.skinFactory
        })
      );
    }
  }

  get(revision: string): LoadedTheme | undefined {
    return this.#themes.get(revision);
  }

  registeredModules(): ReadonlyMap<string, ModuleMetadata> {
    const modules = new Map<string, ModuleMetadata>();
    for (const { moduleFactory } of this.#themes.values()) {
      modules.set(
        `${moduleFactory.metadata.id}@${moduleFactory.metadata.version}`,
        moduleFactory.metadata
      );
    }
    return modules;
  }

  registeredRenderers(): ReadonlyMap<string, SkinFactoryMetadata> {
    const renderers = new Map<string, SkinFactoryMetadata>();
    for (const { skinFactory } of this.#themes.values()) {
      renderers.set(
        `${skinFactory.metadata.id}@${skinFactory.metadata.version}`,
        skinFactory.metadata
      );
    }
    return renderers;
  }

  resolve(revision: string): LoadedTheme {
    const theme = this.#themes.get(revision);
    if (!theme) {
      throw new Error(`Theme revision ${revision} is not installed in this server build.`);
    }
    return theme;
  }

  resolvePinned(revision: string, packageDigest: string): LoadedTheme {
    const theme = this.resolve(revision);
    if (theme.packageDigest !== packageDigest) {
      throw new Error(`Theme revision ${revision} does not match the pinned package digest.`);
    }
    return theme;
  }

  createModuleInstance(
    revision: string,
    context: ModuleContext<DefaultEntity>,
    settings: Readonly<Record<string, JsonValue>>,
    roster: readonly RosterMember[],
    seed: number,
    packageDigest: string
  ) {
    const theme = this.resolvePinned(revision, packageDigest);
    if (!theme.moduleFactory.validateSettings(settings)) {
      throw new TypeError(`Settings are invalid for theme revision ${revision}.`);
    }
    return theme.moduleFactory.create(context, settings, roster, seed);
  }

  createSkinInstance(
    revision: string,
    host: Parameters<typeof defaultSkinFactory.mount>[0],
    assets: AssetLoader,
    packageDigest: string
  ) {
    return this.resolvePinned(revision, packageDigest).skinFactory.mount(host, assets);
  }
}

export function createThemeLoader(): ThemeLoader {
  return new ThemeLoader();
}
