import { loadCurrentAccount, mountAuth, type ClientAccount } from "./auth.js";
import { mountLobby } from "./lobby.js";
import { showStatus } from "./ui.js";

const root = document.querySelector<HTMLElement>("#app");
const status = document.querySelector<HTMLElement>("#status");

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
  void mountAuth(root, status, showLobby);
}

function showLobby(account: ClientAccount): void {
  if (!root || !status) {
    return;
  }
  mountLobby(root, status, account, showAuth);
}
