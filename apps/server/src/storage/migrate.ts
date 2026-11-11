import { readConfig } from "../config.js";
import { openDatabase, runMigrations } from "./database.js";

const config = readConfig();
const database = openDatabase(config.databasePath);

try {
  runMigrations(database);
} finally {
  database.close();
}
