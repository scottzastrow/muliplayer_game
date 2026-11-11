import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  validateThemeRevision,
  type ThemePackageRevision
} from "@multiplayer-game/theme-sdk";
import {
  defaultModuleFactory,
  defaultSkinFactory
} from "@multiplayer-game/default-theme";
import {
  runtimeThemeDefinition,
  ThemeImportDefinitionSchema,
  type ThemeImportDefinition
} from "@multiplayer-game/theme-sdk/package";

const reviewedModules = new Map([
  [`${defaultModuleFactory.metadata.id}@${defaultModuleFactory.metadata.version}`, defaultModuleFactory]
]);
const reviewedRenderers = new Map([
  [`${defaultSkinFactory.metadata.id}@${defaultSkinFactory.metadata.version}`, defaultSkinFactory]
]);

export interface ReviewedThemeCodeRegistration {
  readonly manifest: ThemeImportDefinition;
  readonly revision: ThemePackageRevision;
  readonly moduleFactory: typeof defaultModuleFactory;
  readonly skinFactory: typeof defaultSkinFactory;
}

export function registerReviewedThemeCode(
  manifestInput: unknown,
  moduleKey: string,
  rendererKey: string
): ReviewedThemeCodeRegistration {
  const manifest = ThemeImportDefinitionSchema.parse(manifestInput);
  const definition = runtimeThemeDefinition(manifest);
  const moduleFactory = reviewedModules.get(moduleKey);
  const skinFactory = reviewedRenderers.get(rendererKey);
  if (!moduleFactory) {
    throw new Error(`Game module ${moduleKey} is not registered in the reviewed build.`);
  }
  if (!skinFactory) {
    throw new Error(`Skin renderer ${rendererKey} is not registered in the reviewed build.`);
  }

  const revision: ThemePackageRevision = Object.freeze({
    definition,
    packageDigest: definition.assetsDigest,
    installedModule: moduleFactory.metadata,
    installedRenderer: skinFactory.metadata
  });
  validateThemeRevision(revision);
  if (
    skinFactory.metadata.acceptedModuleId !== moduleFactory.metadata.id ||
    !skinFactory.metadata.acceptedStateSchemaVersions.includes(
      moduleFactory.metadata.stateSchemaVersion
    )
  ) {
    throw new Error("The reviewed skin renderer does not support the selected game module.");
  }

  return Object.freeze({ manifest, revision, moduleFactory, skinFactory });
}

async function main(args: readonly string[]): Promise<void> {
  if (args.length !== 3) {
    throw new Error(
      "Usage: install-theme-code <theme.json> <module-id@version> <renderer-id@version>"
    );
  }
  const manifest: unknown = JSON.parse(await readFile(args[0]!, "utf8"));
  const registration = registerReviewedThemeCode(manifest, args[1]!, args[2]!);
  const definition = registration.revision.definition;
  console.log(
    `Registered reviewed code for ${definition.id}@${definition.version}: ` +
    `${definition.module.id}@${definition.module.version} + ` +
    `${definition.skin.rendererId}@${definition.skin.version}.`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Theme code registration failed.");
    process.exitCode = 1;
  });
}
