import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  defaultModuleFactory,
  defaultSkinFactory
} from "@multiplayer-game/default-theme";
import { readConfig } from "../apps/server/src/config.js";
import {
  openDatabase,
  runMigrations
} from "../apps/server/src/storage/database.js";
import { validateAndInstallThemePackage } from "../apps/server/src/themes/packages.js";

const modules = new Map([
  [`${defaultModuleFactory.metadata.id}@${defaultModuleFactory.metadata.version}`, defaultModuleFactory.metadata]
]);
const renderers = new Map([
  [`${defaultSkinFactory.metadata.id}@${defaultSkinFactory.metadata.version}`, defaultSkinFactory.metadata]
]);

async function main(args: readonly string[]): Promise<void> {
  if (args.length !== 2 || args[0] !== "--package") {
    throw new Error("Usage: npm run theme:validate -- --package <archive.zip>");
  }
  const config = readConfig();
  const database = openDatabase(config.databasePath);
  try {
    runMigrations(database);
    const databasePath = config.databasePath === ":memory:"
      ? resolve("var/game.sqlite")
      : resolve(config.databasePath);
    const assetDirectory = resolve(dirname(databasePath), "themes");
    const installed = await validateAndInstallThemePackage(
      database,
      resolve(args[1]!),
      assetDirectory,
      modules,
      renderers
    );
    const definition = installed.revision.definition;
    console.log(
      `Installed ${definition.id}@${definition.version} (${installed.revision.packageDigest}).`
    );
  } finally {
    database.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Theme package validation failed.");
    process.exitCode = 1;
  });
}
