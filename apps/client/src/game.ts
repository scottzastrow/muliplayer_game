import { defaultSkinFactory, defaultThemeDefinition } from "@multiplayer-game/default-theme";
import type { JsonValue, ServerEnvelope } from "@multiplayer-game/protocol";
import { TerminalLifecycleSchema } from "@multiplayer-game/protocol";
import { connectRealtime, type RealtimeClient } from "./connection.js";
import type { ClientAccount } from "./auth.js";
import { mountSkinHost, type MountedSkinHost } from "./skin-host.js";
import { showStatus } from "./ui.js";

const renderers = new Map([
  [`${defaultThemeDefinition.id}@${defaultThemeDefinition.version}`, {
    definition: defaultThemeDefinition, factory: defaultSkinFactory
  }]
]);

export function mountGame(
  root: HTMLElement,
  status: HTMLElement,
  account: ClientAccount,
  sessionId: string,
  navigate: (action: "lobby" | "players" | "results") => void
): () => void {
  let mounted: MountedSkinHost | undefined;
  let connection: RealtimeClient | undefined;
  let disposed = false;
  const heading = document.createElement("h2");
  heading.textContent = "Connecting to game...";
  const view = document.createElement("div");
  view.className = "game-view";
  const back = document.createElement("button");
  back.type = "button";
  back.textContent = "Back to lobby";
  const listeners = new AbortController();
  back.addEventListener("click", () => navigate("lobby"), { signal: listeners.signal });
  root.replaceChildren(heading, back, view);
  showStatus(status, "Connecting...");
  function stopRealtime(): void {
    if (disposed) return;
    disposed = true;
    mounted?.dispose();
    connection?.close();
  }
  function dispose(): void {
    stopRealtime();
    listeners.abort();
  }
  function fail(message: string): void {
    stopRealtime();
    showStatus(status, message, true);
  }
  function handleMessage(message: ServerEnvelope): void {
    if (disposed) return;
    try {
      if (message.sessionId !== sessionId) throw new Error("Received a message for another session.");
      if (message.type === "server.error") {
        showStatus(status, message.payload.message, true);
        if (message.payload.fatal) dispose();
      } else if (message.type === "server.hello") {
        const pinned = message.payload.pinnedTheme;
        if (
          message.payload.protocolVersion !== 1 || message.payload.role !== "player" ||
          !pinned || typeof pinned !== "object" || Array.isArray(pinned) ||
          typeof pinned.revision !== "string"
        ) throw new Error("Invalid game handshake.");
        const renderer = renderers.get(pinned.revision);
        if (!renderer) throw new Error("The pinned Game Theme renderer is not installed in this client.");
        mounted?.dispose();
        mounted = mountSkinHost(view, renderer.factory, {
          target: { accountId: account.id, username: account.username },
          dispatchInput(action: JsonValue) {
            if (!connection?.sendAction(action)) {
              fail("The game connection is unavailable. Refresh the lobby to reopen the view.");
            }
          },
          navigate,
          onError: (error) => fail(error.message)
        });
        heading.textContent = renderer.definition.name;
        showStatus(status, message.payload.sessionState === "waiting" ? "Waiting for the creator to start." : "");
      } else if (message.type === "server.snapshot") {
        if (!mounted || message.payload.protocolVersion !== 1 ||
            typeof message.payload.moduleStateSchemaVersion !== "number") {
          throw new Error("Received game state before a compatible handshake.");
        }
        mounted.handleSnapshot(message.payload, message.payload.moduleStateSchemaVersion);
      } else if (message.type === "server.event") {
        mounted?.handleEvents([message.payload]);
      } else if (message.type === "server.lifecycle") {
        const terminal = TerminalLifecycleSchema.safeParse(message.payload);
        if (!terminal.success || terminal.data.resultId !== sessionId) {
          throw new Error("Received an invalid saved-result notification.");
        }
        dispose();
        navigate("results");
      }
    } catch (error) {
      fail(error instanceof Error ? error.message : "Unable to display game state.");
    }
  }
  connection = connectRealtime({
    sessionId,
    onMessage: handleMessage,
    onError: () => fail("Unable to connect to the game. Refresh the lobby and try again."),
    onClose: (event) => {
      if (!disposed) fail(event.reason || "Game connection closed. Refresh the lobby to reopen the view.");
    }
  });
  return dispose;
}
