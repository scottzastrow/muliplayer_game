import { createLocalGame, mountLocalPreview } from "@multiplayer-game/local-preview";
import { sampleGameModule } from "./game.js";
import { sampleMap } from "./map.js";
import { sampleSettings } from "./settings.js";
import { sampleSkinFactory } from "./skin.js";

const root = document.querySelector("#preview");
const status = document.querySelector("#preview-status");
if (!root || !status) throw new Error("The sample page is missing its preview elements.");

const accountId = "local-player";
const game = await createLocalGame({
  moduleFactory: sampleGameModule,
  settings: sampleSettings,
  map: sampleMap,
  seed: 42,
  roster: [{ accountId, username: "Local Player", joinedOrder: 0 }],
  viewer: { accountId, role: "player" }
});
const mounted = mountLocalPreview(root, game, sampleSkinFactory, {
  onInputRejected: () => { status.textContent = "The sample module rejected an input."; }
});

const timer = window.setInterval(() => {
  try {
    game.step();
  } catch (error) {
    window.clearInterval(timer);
    status.textContent = `Local simulation failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}, 1000 / 30);
status.textContent = "Local sample running; movement is applied by its editable game module.";

window.addEventListener("pagehide", () => {
  window.clearInterval(timer);
  mounted.dispose();
  game.dispose();
}, { once: true });
