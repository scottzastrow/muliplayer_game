import { MatchResultSchema } from "@multiplayer-game/protocol";
import { createDefaultResultsSkin, defaultThemeDefinition } from "@multiplayer-game/default-theme";
import { mountSkinHost, type MountedSkinHost } from "./skin-host.js";
import { showStatus } from "./ui.js";
import type { ClientAccount } from "./auth.js";

export function resultIdFromHash(hash: string): string | undefined {
  const match = /^#results\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.exec(hash);
  return match?.[1];
}

export function mountResults(
  root: HTMLElement,
  status: HTMLElement,
  account: ClientAccount,
  matchId: string,
  onLobby: () => void
): () => void {
  let disposed = false;
  let loading = false;
  let mounted: MountedSkinHost | undefined;
  let controller: AbortController | undefined;
  const view = document.createElement("section");
  view.className = "results-view";
  root.replaceChildren(view);
  async function load(): Promise<void> {
    if (disposed || loading) return;
    loading = true;
    controller?.abort();
    controller = new AbortController();
    mounted?.dispose();
    mounted = undefined;
    const pending = document.createElement("p");
    pending.textContent = "Loading saved result...";
    const back = document.createElement("button");
    back.type = "button";
    back.textContent = "Back to lobby";
    back.addEventListener("click", onLobby, { signal: controller.signal });
    view.replaceChildren(pending, back);
    showStatus(status, "");
    try {
      const response = await fetch(`/api/v1/matches/${matchId}/results`, {
        credentials: "same-origin", signal: controller.signal, cache: "no-store"
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        const message = typeof body === "object" && body !== null && "error" in body &&
          typeof body.error === "object" && body.error !== null && "message" in body.error &&
          typeof body.error.message === "string" ? body.error.message : "Unable to load saved result.";
        throw new Error(message);
      }
      if (disposed) return;
      if (!body || typeof body !== "object" || !("result" in body)) {
        throw new Error("The server returned an invalid saved result.");
      }
      const parsed = MatchResultSchema.safeParse(body.result);
      if (!parsed.success || parsed.data.matchId !== matchId) {
        throw new Error("The server returned an invalid saved result.");
      }
      const result = parsed.data;
      if (result.settings.themeRevision !== `${defaultThemeDefinition.id}@${defaultThemeDefinition.version}`) {
        throw new Error("The saved result's Game Theme renderer is not installed.");
      }
      mounted = mountSkinHost(view, createDefaultResultsSkin(result, () => void load()), {
        target: { accountId: account.id, username: account.username },
        dispatchInput: () => { throw new Error("Saved results cannot dispatch player controls."); },
        navigate: (action) => {
          if (action === "lobby") onLobby();
          else showStatus(status, "That view is not available from saved results.", true);
        },
        onError: (error) => showStatus(status, error.message, true)
      });
      showStatus(status, "Saved result loaded.");
    } catch (error) {
      if (disposed) return;
      showStatus(status, error instanceof Error ? error.message : "Unable to load saved result.", true);
      pending.textContent = "Saved result unavailable.";
      view.replaceChildren(pending, back);
      const retry = document.createElement("button");
      retry.type = "button";
      retry.textContent = "Reload saved result";
      retry.addEventListener("click", () => void load(), { signal: controller.signal });
      view.append(retry);
    } finally {
      loading = false;
    }
  }
  void load();
  return () => {
    disposed = true;
    controller?.abort();
    mounted?.dispose();
  };
}
