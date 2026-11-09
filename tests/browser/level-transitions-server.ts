import { createApp } from "../../apps/server/src/app.js";
import { readConfig } from "../../apps/server/src/config.js";
import { openDatabase, runMigrations } from "../../apps/server/src/storage/database.js";
import { ThemeLoader } from "../../apps/server/src/themes/builtins.js";

const config = readConfig();
if (config.host !== "127.0.0.1" || config.nodeEnv !== "test") {
  throw new Error("The staged wave browser fixture requires NODE_ENV=test and loopback only.");
}
const createModule = ThemeLoader.prototype.createModuleInstance;
ThemeLoader.prototype.createModuleInstance = function (...args) {
  const module = createModule.apply(this, args);
  const context = args[1];
  const step = module.step.bind(module);
  module.step = (dt, tick) => {
    if (module.state.phase === "active") {
      const npc = context.entities.values().find(entity => entity.state.kind === "npc");
      if (npc) {
        // Stage one real NPC in a clear firing lane; preserve health, counts and combat.
        const position = { x: 400, y: 272 };
        if (!context.geometry.isWalkable(position.x, position.y, npc.radius)) {
          throw new Error("The wave browser fixture firing lane is obstructed.");
        }
        context.entities.update(npc.id, entity => ({ ...entity, position }));
      }
    }
    step(dt, tick);
  };
  return module;
};
const database = openDatabase(config.databasePath);
runMigrations(database);
const app = createApp(config, database, { ready: true });
await app.listen({ host: config.host, port: config.port });
console.log(`Staged wave browser fixture listening on ${config.port}`);
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => { void app.close(); });
}
