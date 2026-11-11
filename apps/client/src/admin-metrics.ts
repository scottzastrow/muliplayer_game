import { JsonValueSchema } from "@multiplayer-game/protocol";
import { showStatus } from "./ui.js";

export function mountAdminMetrics(status: HTMLElement): HTMLElement {
  const section = document.createElement("section");
  section.setAttribute("aria-labelledby", "admin-metrics-heading");
  const heading = document.createElement("h2");
  heading.id = "admin-metrics-heading";
  heading.textContent = "Operator: Runtime Metrics";
  const description = document.createElement("p");
  description.textContent =
    "Bounded host and active-session measurements. Refresh to sample; export contains no account labels.";
  const refresh = document.createElement("button");
  refresh.type = "button";
  refresh.textContent = "Refresh metrics";
  const download = document.createElement("a");
  download.textContent = "Download metrics JSON";
  download.download = "runtime-metrics.json";
  download.hidden = true;
  const output = document.createElement("pre");
  output.setAttribute("aria-label", "Runtime metrics JSON");
  section.append(heading, description, refresh, download, output);
  refresh.addEventListener("click", () => void load());
  void load();

  async function load(): Promise<void> {
    refresh.disabled = true;
    download.hidden = true;
    output.textContent = "";
    try {
      const response = await fetch("/api/v1/admin/metrics", {
        credentials: "same-origin", cache: "no-store"
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        const message = typeof body === "object" && body !== null && "error" in body &&
          typeof body.error === "object" && body.error !== null && "message" in body.error &&
          typeof body.error.message === "string" ? body.error.message : "Unable to load metrics.";
        throw new Error(message);
      }
      const json = JSON.stringify(JsonValueSchema.parse(body), null, 2);
      output.textContent = json;
      download.href = `data:application/json;charset=utf-8,${encodeURIComponent(json)}`;
      download.hidden = false;
    } catch (error) {
      showStatus(status, error instanceof Error ? error.message : "Unable to load metrics.", true);
    } finally {
      refresh.disabled = false;
    }
  }
  return section;
}
