import type { MatchResult } from "@multiplayer-game/protocol";
import type { SkinFactory, SkinHost, SkinInstance } from "@multiplayer-game/theme-sdk";
import { defaultSkinFactory } from "./index.js";

export function createDefaultResultsSkin(
  result: MatchResult,
  reload: () => void
): SkinFactory {
  return {
    metadata: defaultSkinFactory.metadata,
    mount(host: SkinHost): SkinInstance {
      const world = host.slots.get("world");
      const controls = host.slots.get("controls");
      if (!world || !controls) throw new Error("Results require world and controls slots.");
      const heading = document.createElement("h2");
      heading.textContent = result.status === "finished" ? "Final standings" : "Match ended";
      const summary = document.createElement("p");
      summary.textContent = `Status: ${result.status}. Final level: ${result.finalLevel}.`;
      world.append(heading, summary);
      const table = document.createElement("table");
      table.setAttribute("aria-label", "Final standings");
      const head = document.createElement("thead");
      const header = document.createElement("tr");
      for (const label of ["Rank", "Player", "Points", "Kills", "Deaths"]) {
        const cell = document.createElement("th");
        cell.scope = "col";
        cell.textContent = label;
        header.append(cell);
      }
      head.append(header);
      const body = document.createElement("tbody");
      for (const standing of result.standings) {
        const row = document.createElement("tr");
        if (standing.accountId === host.selectedTarget?.accountId) {
          row.setAttribute("aria-current", "true");
        }
        for (const value of [
          standing.rank, standing.username, standing.points, standing.kills, standing.deaths
        ]) {
          const cell = document.createElement("td");
          cell.textContent = String(value);
          row.append(cell);
        }
        body.append(row);
      }
      table.append(head, body);
      const unavailable = document.createElement("p");
      unavailable.textContent = "This match did not finish; final scores are unavailable.";
      if (result.status === "finished") world.append(table);
      else world.append(unavailable);
      const reloadButton = document.createElement("button");
      reloadButton.type = "button";
      reloadButton.textContent = "Reload saved result";
      const lobby = document.createElement("button");
      lobby.type = "button";
      lobby.textContent = "Back to lobby";
      const listeners = new AbortController();
      reloadButton.addEventListener("click", reload, { signal: listeners.signal });
      lobby.addEventListener("click", () => host.navigate("lobby"), { signal: listeners.signal });
      controls.append(reloadButton, lobby);
      host.setCameraAnchor(undefined);
      return {
        handleSnapshot() {},
        handleEvents() {},
        handleViewport() {},
        render() {},
        dispose() {
          listeners.abort();
          heading.remove();
          summary.remove();
          table.remove();
          unavailable.remove();
          reloadButton.remove();
          lobby.remove();
        }
      };
    }
  };
}
