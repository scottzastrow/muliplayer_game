import { showStatus } from "./ui.js";

interface AdminTheme {
  readonly id: string;
  readonly version: string;
  readonly name: string;
  readonly module: { readonly id: string; readonly version: string };
  readonly renderer: { readonly id: string; readonly version: string };
  readonly engineApiMajor: number;
  readonly digest: string;
  readonly enabled: boolean;
}

export function mountAdminThemes(status: HTMLElement): HTMLElement {
  const section = document.createElement("section");
  section.setAttribute("aria-labelledby", "admin-themes-heading");
  const heading = document.createElement("h2");
  heading.id = "admin-themes-heading";
  heading.textContent = "Operator: Game Themes";
  const description = document.createElement("p");
  description.textContent =
    "Upload ZIP packages containing validated assets and a manifest that references reviewed code.";
  const form = document.createElement("form");
  const label = document.createElement("label");
  label.htmlFor = "theme-package";
  label.textContent = "Theme package ZIP";
  const input = document.createElement("input");
  input.id = "theme-package";
  input.name = "theme-package";
  input.type = "file";
  input.accept = ".zip,application/zip";
  input.required = true;
  const upload = document.createElement("button");
  upload.type = "submit";
  upload.textContent = "Upload theme package";
  form.append(label, input, upload);

  const refresh = document.createElement("button");
  refresh.type = "button";
  refresh.textContent = "Refresh themes";
  const table = document.createElement("table");
  table.setAttribute("aria-label", "Installed Game Themes");
  const head = document.createElement("thead");
  const headerRow = document.createElement("tr");
  for (const title of ["Theme", "Revision", "Game module", "Skin renderer", "Status", "Actions"]) {
    const cell = document.createElement("th");
    cell.scope = "col";
    cell.textContent = title;
    headerRow.append(cell);
  }
  head.append(headerRow);
  const rows = document.createElement("tbody");
  table.append(head, rows);
  section.append(heading, description, form, refresh, table);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const file = input.files?.[0];
    if (!file) {
      showStatus(status, "Choose a theme ZIP package to upload.", true);
      return;
    }
    upload.disabled = true;
    try {
      const response = await api<{ theme: { id: string; version: string } }>(
        "/api/v1/admin/themes/upload",
        {
        method: "POST",
        headers: { "content-type": "application/zip" },
        body: await file.arrayBuffer()
        }
      );
      showStatus(status, `Installed ${response.theme.id}@${response.theme.version}.`);
      input.value = "";
      await refreshThemes();
    } catch (error) {
      showStatus(status, messageOf(error), true);
    } finally {
      upload.disabled = false;
    }
  });
  refresh.addEventListener("click", () => void refreshThemes());
  void refreshThemes();

  async function refreshThemes(): Promise<void> {
    refresh.disabled = true;
    try {
      const result = await api<{ themes: AdminTheme[] }>("/api/v1/admin/themes");
      rows.replaceChildren();
      for (const theme of result.themes) {
        const row = document.createElement("tr");
        const name = document.createElement("td");
        name.textContent = theme.name;
        const revision = document.createElement("td");
        revision.textContent = `${theme.id}@${theme.version}`;
        const module = document.createElement("td");
        module.textContent = `${theme.module.id}@${theme.module.version}`;
        const renderer = document.createElement("td");
        renderer.textContent = `${theme.renderer.id}@${theme.renderer.version}`;
        const state = document.createElement("td");
        state.textContent = theme.enabled ? "Enabled" : "Disabled";
        const actions = document.createElement("td");
        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.textContent = theme.enabled ? "Disable" : "Enable";
        toggle.setAttribute(
          "aria-label",
          `${theme.enabled ? "Disable" : "Enable"} ${theme.name} ${theme.version}`
        );
        toggle.addEventListener("click", async () => {
          toggle.disabled = true;
          try {
            await api(`/api/v1/admin/themes/${encodeURIComponent(theme.id)}/${encodeURIComponent(theme.version)}`, {
              method: "PATCH",
              body: JSON.stringify({ enabled: !theme.enabled })
            });
            showStatus(
              status,
              `${theme.name} ${theme.version} ${theme.enabled ? "disabled" : "enabled"} for new sessions.`
            );
            await refreshThemes();
          } catch (error) {
            showStatus(status, messageOf(error), true);
            toggle.disabled = false;
          }
        });
        actions.append(toggle);
        row.append(name, revision, module, renderer, state, actions);
        rows.append(row);
      }
      if (result.themes.length === 0) {
        const row = document.createElement("tr");
        const empty = document.createElement("td");
        empty.colSpan = 6;
        empty.textContent = "No Game Themes are installed.";
        row.append(empty);
        rows.append(row);
      }
    } catch (error) {
      showStatus(status, messageOf(error), true);
    } finally {
      refresh.disabled = false;
    }
  }

  return section;
}

async function api<T = void>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(path, {
    ...init,
    headers,
    credentials: "same-origin"
  });
  const body: unknown = response.status === 204 ? undefined : await response.json();
  if (!response.ok) {
    const message =
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof body.error === "object" &&
      body.error !== null &&
      "message" in body.error &&
      typeof body.error.message === "string"
        ? body.error.message
        : "The request failed.";
    throw new Error(message);
  }
  return body as T;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "The request failed.";
}
