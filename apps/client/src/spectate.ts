import { z } from "zod";
import type { SkinFactory } from "@multiplayer-game/theme-sdk";
import { TerminalLifecycleSchema, type ServerEnvelope } from "@multiplayer-game/protocol";
import { connectRealtime, type RealtimeClient } from "./connection.js";
import { mountSkinHost, type MountedSkinHost } from "./skin-host.js";
import type { ClientAccount } from "./auth.js";
import { showStatus } from "./ui.js";
import { resolveClientTheme } from "./themes.js";

export const FollowablePlayersSchema = z.array(z.object({
  accountId: z.string().uuid(), username: z.string().min(1).max(24),
  connected: z.boolean(), life: z.enum(["alive", "dead", "unavailable"]), followable: z.boolean()
})).max(32);
const listSchema = z.object({ players: FollowablePlayersSchema });
type Player = z.infer<typeof FollowablePlayersSchema>[number];

export function mountSpectate(
  root: HTMLElement,
  status: HTMLElement,
  _account: ClientAccount,
  sessionId: string,
  navigate: (action: "lobby" | "results") => void
): () => void {
  let disposed = false;
  let admitted = false;
  let leaving = false;
  let terminal = false;
  let mounted: MountedSkinHost | undefined;
  let connection: RealtimeClient | undefined;
  let skinFactory: SkinFactory | undefined;
  let selected: Player | undefined;
  let pending: Player | undefined;
  let players: Player[] = [];
  let ready = false;
  let listGeneration = 0;
  const listeners = new AbortController();
  let viewListeners = new AbortController();
  const heading = document.createElement("h2");
  heading.textContent = "Spectating Dots and Squares";
  const view = document.createElement("section");
  view.className = "game-view";
  const back = document.createElement("button");
  back.type = "button";
  back.textContent = "Back to lobby";
  back.addEventListener("click", () => void leave(), { signal: listeners.signal });
  root.replaceChildren(heading, back, view);

  async function request(path: string, method = "GET") {
    const response = await fetch(`/api/v1/sessions/${sessionId}/${path}`, {
      method, credentials: "same-origin", cache: "no-store",
      ...(method === "POST" ? { headers: { "content-type": "application/json" }, body: "{}", keepalive: true } : {})
    });
    if (response.status === 204) return undefined;
    const body: unknown = await response.json();
    if (!response.ok) {
      const parsed = z.object({ error: z.object({ message: z.string() }) }).safeParse(body);
      throw new Error(parsed.success ? parsed.data.error.message : "Spectator request failed.");
    }
    return body;
  }
  function clearView(): void {
    document.body.classList.remove("match-view");
    heading.hidden = false;
    root.insertBefore(back, view);
    viewListeners.abort();
    viewListeners = new AbortController();
    mounted?.dispose();
    mounted = undefined;
    selected = undefined;
    pending = undefined;
  }
  function fail(error: unknown): void {
    if (disposed) return;
    showStatus(status, error instanceof Error ? error.message : "Unable to display spectator view.", true);
  }
  async function leave(): Promise<void> {
    if (leaving || disposed) return;
    leaving = true;
    back.disabled = true;
    try {
      await request("leave", "POST");
      admitted = false;
      dispose();
      navigate("lobby");
    } catch (error) {
      leaving = false;
      back.disabled = false;
      fail(error);
    }
  }
  async function refreshPlayers(): Promise<void> {
    const generation = ++listGeneration;
    try {
      const body = await request("players");
      if (disposed || generation !== listGeneration) return;
      players = listSchema.parse(body).players;
      showPlayers();
    } catch (error) { fail(error); }
  }
  function showPlayers(): void {
    clearView();
    const title = document.createElement("h3");
    title.textContent = "Choose a player to follow";
    const list = document.createElement("ul");
    list.setAttribute("aria-label", "Followable players");
    for (const player of players) {
      const item = document.createElement("li");
      const follow = document.createElement("button");
      follow.type = "button";
      follow.textContent = `Follow ${player.username}`;
      follow.disabled = !ready || !player.followable;
      follow.addEventListener("click", () => {
        if (disposed || pending) return;
        pending = player;
        if (!connection?.selectTarget(player.accountId)) {
          pending = undefined;
          fail(new Error("Spectator connection is unavailable."));
        }
      }, { signal: viewListeners.signal });
      item.append(follow, ` ${player.life}${player.connected ? "" : " (disconnected)"}`);
      list.append(item);
    }
    if (!players.some(player => player.followable)) {
      const empty = document.createElement("p");
      empty.textContent = "No players are currently available to follow.";
      list.append(empty);
    }
    const refresh = document.createElement("button");
    refresh.type = "button";
    refresh.textContent = "Refresh players";
    refresh.addEventListener("click", () => void refreshPlayers(), { signal: viewListeners.signal });
    view.replaceChildren(title, list, refresh);
  }
  function follow(player: Player): void {
    clearView();
    selected = player;
    if (!skinFactory) throw new Error("The pinned Game Theme has not been validated.");
    mounted = mountSkinHost(view, skinFactory, {
      target: { accountId: player.accountId, username: player.username },
      dispatchInput: () => { throw new Error("Spectators cannot send gameplay input."); },
      navigate: action => {
        if (action === "players") void refreshPlayers();
        else if (action === "lobby") void leave();
      },
      toolbar: [back],
      onError: fail
    });
    document.body.classList.add("match-view");
    heading.hidden = true;
    const controls = mounted.host.slots.get("controls")!;
    const following = document.createElement("p");
    following.textContent = `Following ${player.username}`;
    const switchPlayer = document.createElement("button");
    switchPlayer.type = "button";
    switchPlayer.textContent = "Back to Players";
    switchPlayer.addEventListener("click", () => {
      clearView();
      void refreshPlayers();
    }, { signal: viewListeners.signal });
    controls.append(following, switchPlayer);
    showStatus(status, "");
  }
  function message(message: ServerEnvelope): void {
    if (disposed) return;
    try {
      if (message.sessionId !== sessionId) throw new Error("Received another session's spectator state.");
      if (message.type === "server.hello") {
        const hello = z.object({ role: z.literal("spectator"), protocolVersion: z.literal(1),
          pinnedTheme: z.object({ revision: z.string().min(1), digest: z.string().regex(/^[a-f0-9]{64}$/) })
        }).parse(message.payload);
        const theme = resolveClientTheme(hello.pinnedTheme.revision, hello.pinnedTheme.digest);
        skinFactory = theme.factory;
        heading.textContent = `Spectating ${theme.definition.name}`;
        ready = hello.role === "spectator";
        showPlayers();
        showStatus(status, "");
      } else if (message.type === "server.spectate.target") {
        if (message.payload.targetAccountId === null) {
          listGeneration++;
          players = FollowablePlayersSchema.parse(message.payload.players);
          showPlayers();
          showStatus(status, typeof message.payload.message === "string"
            ? message.payload.message : "The selected player is unavailable.");
        } else if (pending && message.payload.targetAccountId === pending.accountId) {
          follow(pending);
        }
      } else if (message.type === "server.snapshot") {
        if (!mounted || !selected) return;
        if (message.payload.viewerAccountId !== selected.accountId) return;
        if (message.payload.viewerRole !== "spectator" ||
          typeof message.payload.moduleStateSchemaVersion !== "number") {
          throw new Error("Invalid spectator snapshot.");
        }
        mounted.handleSnapshot(message.payload, message.payload.moduleStateSchemaVersion);
      } else if (message.type === "server.error") {
        pending = undefined;
        fail(new Error(message.payload.message));
        if (message.payload.fatal) {
          ready = false;
          clearView();
          showPlayers();
          connection?.close();
        }
      } else if (message.type === "server.lifecycle") {
        const result = TerminalLifecycleSchema.parse(message.payload);
        if (result.resultId !== sessionId) throw new Error("Invalid spectator result notification.");
        terminal = true;
        admitted = false;
        dispose();
        navigate("results");
      }
    } catch (error) { clearView(); fail(error); }
  }
  async function start(): Promise<void> {
    showStatus(status, "Joining as spectator...");
    try {
      const body = await request("spectate", "POST");
      admitted = true;
      if (disposed) { await request("leave", "POST"); return; }
      players = listSchema.parse(body).players;
      showPlayers();
      connection = connectRealtime({
        sessionId, onMessage: message,
        onError: () => fail(new Error("Unable to connect as spectator.")),
        onClose: event => {
          if (disposed || leaving) return;
          ready = false;
          showPlayers();
          fail(new Error(event.reason || "Spectator connection closed. Return to the lobby to try again."));
        }
      });
    } catch (error) {
      if (disposed && admitted) {
        showStatus(status, error instanceof Error ? error.message : "Unable to release spectator membership.", true);
      } else fail(error);
    }
  }
  function dispose(): void {
    if (disposed) return;
    disposed = true;
    listGeneration++;
    clearView();
    viewListeners.abort();
    listeners.abort();
    connection?.close();
    if (admitted && !terminal) {
      void request("leave", "POST").catch(error => {
        showStatus(status, error instanceof Error ? error.message : "Unable to release spectator membership.", true);
      });
    }
  }
  void start();
  return dispose;
}
