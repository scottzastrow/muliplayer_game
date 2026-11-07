import { loadCurrentAccount, mountAuth, type ClientAccount } from "./auth.js";
import { mountLobby } from "./lobby.js";
import { showStatus } from "./ui.js";
import { mountGame } from "./game.js";
import "./style.css";

const root = document.querySelector<HTMLElement>("#app");
const status = document.querySelector<HTMLElement>("#status");
let disposeGame: (() => void) | undefined;

if (root && status) {
  void initialize();
}

async function initialize(): Promise<void> {
  if (!root || !status) {
    return;
  }
  try {
    const account = await loadCurrentAccount();
    if (account) {
      showLobby(account);
    } else {
      showAuth();
    }
  } catch (error) {
    showStatus(status, error instanceof Error ? error.message : "Unable to load the lobby.", true);
    showAuth();
  }
}

function showAuth(): void {
  if (!root || !status) {
    return;
  }
  disposeGame?.();
  disposeGame = undefined;
  void mountAuth(root, status, showLobby);
}

function showLobby(account: ClientAccount): void {
  if (!root || !status) {
    return;
  }
  disposeGame?.();
  disposeGame = undefined;
  mountLobby(root, status, account, showAuth, (sessionId) => {
    if (!root || !status) return;
    disposeGame = mountGame(root, status, account, sessionId, (action) => {
      if (action === "lobby") showLobby(account);
      else showStatus(status, "That view is not available yet.", true);
    });
  });
}

window.addEventListener("pagehide", () => disposeGame?.());
