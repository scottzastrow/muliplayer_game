import { loadCurrentAccount, mountAuth, type ClientAccount } from "./auth.js";
import { mountLobby } from "./lobby.js";
import { showStatus } from "./ui.js";
import { mountGame } from "./game.js";
import "./style.css";
import { mountResults, resultIdFromHash } from "./results.js";

const root = document.querySelector<HTMLElement>("#app");
const status = document.querySelector<HTMLElement>("#status");
let disposeGame: (() => void) | undefined;
let activeAccount: ClientAccount | undefined;

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
      showAccountView(account);
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
  activeAccount = undefined;
  void mountAuth(root, status, showAccountView);
}

function showAccountView(account: ClientAccount): void {
  activeAccount = account;
  const resultId = resultIdFromHash(window.location.hash);
  if (resultId) showResults(account, resultId);
  else showLobby(account);
}

function showResults(account: ClientAccount, matchId: string): void {
  if (!root || !status) return;
  disposeGame?.();
  history.replaceState(null, "", `#results/${matchId}`);
  disposeGame = mountResults(root, status, account, matchId, () => showLobby(account));
}

function showLobby(account: ClientAccount): void {
  if (!root || !status) {
    return;
  }
  disposeGame?.();
  disposeGame = undefined;
  activeAccount = account;
  history.replaceState(null, "", window.location.pathname + window.location.search);
  showStatus(status, "");
  mountLobby(root, status, account, showAuth, (sessionId) => {
    if (!root || !status) return;
    disposeGame = mountGame(root, status, account, sessionId, (action) => {
      if (action === "lobby") showLobby(account);
      else if (action === "results") showResults(account, sessionId);
      else showStatus(status, "That view is not available yet.", true);
    });
  });
}

window.addEventListener("pagehide", () => disposeGame?.());
window.addEventListener("hashchange", () => {
  if (activeAccount) showAccountView(activeAccount);
});
