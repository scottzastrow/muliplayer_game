import { createApp } from "./app.js";
import { readConfig } from "./config.js";
import {
  openDatabase,
  reconcileInterruptedMatches,
  runMigrations
} from "./storage/database.js";

const config = readConfig();
const database = openDatabase(config.databasePath);
const readiness = { ready: false };
const app = createApp(config, database, readiness);
let shutdownStarted = false;

try {
  runMigrations(database);
  reconcileInterruptedMatches(database);
  readiness.ready = true;
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  readiness.ready = false;
  await app.close();
  throw error;
}

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shutdownStarted) {
    return;
  }
  shutdownStarted = true;
  readiness.ready = false;
  app.log.info({ signal }, "Shutting down");
  await app.close();
}

function handleSignal(signal: NodeJS.Signals): void {
  void shutdown(signal).catch((error: unknown) => {
    app.log.error(
      { errorType: error instanceof Error ? error.name : "UnknownError", signal },
      "Graceful shutdown failed"
    );
    process.exitCode = 1;
  });
}

process.once("SIGINT", handleSignal);
process.once("SIGTERM", handleSignal);
