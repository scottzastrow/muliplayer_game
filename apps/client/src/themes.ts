import {
  isThemeCompatible,
  type SkinFactory,
  type ThemeDefinition
} from "@multiplayer-game/theme-sdk";
import {
  defaultSkinFactory,
  defaultThemeDefinition
} from "@multiplayer-game/default-theme";
import {
  fixtureSkinFactory,
  fixtureThemeDefinition
} from "@multiplayer-game/fixture-theme";

const ENGINE_API_MAJOR = 1;
const themes = new Map<string, {
  readonly definition: ThemeDefinition;
  readonly factory: SkinFactory;
}>([
  [`${defaultThemeDefinition.id}@${defaultThemeDefinition.version}`, {
    definition: defaultThemeDefinition,
    factory: defaultSkinFactory
  }],
  [`${fixtureThemeDefinition.id}@${fixtureThemeDefinition.version}`, {
    definition: fixtureThemeDefinition,
    factory: fixtureSkinFactory
  }]
]);

export function resolveClientTheme(revision: string, digest: string): {
  readonly definition: ThemeDefinition;
  readonly factory: SkinFactory;
} {
  const theme = themes.get(revision);
  if (!theme) {
    throw new Error("The pinned Game Theme revision is not installed in this client.");
  }
  const { definition, factory } = theme;
  if (definition.assetsDigest !== digest) {
    throw new Error("The pinned Game Theme package digest does not match this client.");
  }
  if (!isThemeCompatible(definition, ENGINE_API_MAJOR) ||
      factory.metadata.id !== definition.skin.rendererId ||
      factory.metadata.version !== definition.skin.version ||
      factory.metadata.acceptedModuleId !== definition.module.id ||
      !factory.metadata.acceptedStateSchemaVersions.includes(definition.module.stateSchemaVersion)) {
    throw new Error("The pinned Game Theme is incompatible with this client.");
  }
  return theme;
}
