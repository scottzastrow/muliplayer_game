import type { ClientAccount } from "./auth.js";
import { showStatus } from "./ui.js";
import { mountAdminThemes } from "./admin-themes.js";

interface GameSettings {
  maxPlayers: number;
  maxSpectators: number;
  initialNpcsPerPlayer: number;
  npcPopulationGrowthPercent: number;
  baseNpcHealth: number;
  npcHealthGrowthPercent: number;
  respawnDelaySeconds: number;
  maxLevels: number;
  themeRevision: string;
}

interface SessionSummary {
  id: string;
  name: string;
  creator: string;
  status: "waiting" | "running" | "finished" | "abandoned" | "interrupted" | "failed";
  level: number;
  maxLevels: number;
  playerCount: number;
  maxPlayers: number;
  spectatorCount: number;
  maxSpectators: number;
  themeName: string;
  themeRevision: string;
  settingsRevision: number;
  canJoin: boolean;
  canSpectate: boolean;
  canRejoin: boolean;
  canPlay: boolean;
}

const DEFAULT_SETTINGS: GameSettings = {
  maxPlayers: 4,
  maxSpectators: 8,
  initialNpcsPerPlayer: 10,
  npcPopulationGrowthPercent: 20,
  baseNpcHealth: 100,
  npcHealthGrowthPercent: 10,
  respawnDelaySeconds: 5,
  maxLevels: 5,
  themeRevision: "default@1.0.0"
};

const NUMBER_FIELDS: ReadonlyArray<{
  key: Exclude<keyof GameSettings, "themeRevision">;
  label: string;
  min: number;
  max: number;
  step: number;
}> = [
  { key: "maxPlayers", label: "Maximum players", min: 1, max: 32, step: 1 },
  { key: "maxSpectators", label: "Maximum spectators", min: 0, max: 64, step: 1 },
  { key: "initialNpcsPerPlayer", label: "Initial NPCs per player", min: 1, max: 100, step: 1 },
  { key: "npcPopulationGrowthPercent", label: "NPC growth percent", min: 0, max: 100, step: 1 },
  { key: "baseNpcHealth", label: "Base NPC health", min: 1, max: 100_000, step: 1 },
  { key: "npcHealthGrowthPercent", label: "NPC health growth percent", min: 0, max: 100, step: 1 },
  { key: "respawnDelaySeconds", label: "Respawn delay (seconds)", min: 0, max: 60, step: 1 },
  { key: "maxLevels", label: "Maximum levels", min: 1, max: 100, step: 1 }
];

export function mountLobby(
  root: HTMLElement,
  status: HTMLElement,
  account: ClientAccount,
  onLogout: () => void,
  onPlay: (sessionId: string) => void,
  onSpectate: (sessionId: string) => void
): void {
  const header = document.createElement("header");
  const greeting = document.createElement("p");
  greeting.textContent = `Signed in as ${account.username}`;
  const logout = document.createElement("button");
  logout.type = "button";
  logout.textContent = "Sign out";
  logout.addEventListener("click", () => void signOut());
  header.append(greeting, logout);

  const createHeading = document.createElement("h2");
  createHeading.textContent = "Create a session";
  const createForm = document.createElement("form");
  const createSettings = buildSettingsForm(DEFAULT_SETTINGS);
  const createButton = document.createElement("button");
  createButton.type = "submit";
  createButton.textContent = "Create session";
  const createHelp = document.createElement("p");
  createHelp.id = "create-help";
  createButton.setAttribute("aria-describedby", createHelp.id);
  createForm.append(createSettings, createButton, createHelp);
  const listHeading = document.createElement("h2");
  listHeading.textContent = "Active sessions";
  const refresh = document.createElement("button");
  refresh.type = "button";
  refresh.textContent = "Refresh sessions";
  const list = document.createElement("table");
  list.setAttribute("aria-label", "Active sessions");
  const heading = document.createElement("thead");
  const headerRow = document.createElement("tr");
  for (const label of ["Name", "User", "Players", "Status"]) {
    const cell = document.createElement("th");
    cell.scope = "col";
    cell.textContent = label;
    headerRow.append(cell);
  }
  heading.append(headerRow);
  const rows = document.createElement("tbody");
  list.append(heading, rows);

  createForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    createButton.disabled = true;
    showStatus(status, "");
    try {
      await api("/api/v1/sessions", {
        method: "POST",
        body: JSON.stringify({
          settings: readSettings(createSettings),
          requestId: crypto.randomUUID()
        })
      });
      await refreshSessions();
      showStatus(status, "Session created.");
    } catch (error) {
      showStatus(status, messageOf(error), true);
    } finally {
      createButton.disabled = false;
    }
  });
  refresh.addEventListener("click", () => void refreshSessions());
  root.replaceChildren(
    header,
    createHeading,
    createForm,
    listHeading,
    refresh,
    list,
    ...(account.role === "operator" ? [mountAdminThemes(status)] : [])
  );
  void refreshSessions();

  async function refreshSessions(): Promise<void> {
    refresh.disabled = true;
    try {
      const result = await api<{ sessions: SessionSummary[] }>("/api/v1/sessions");
      rows.replaceChildren();
      for (const session of result.sessions) {
        rows.append(createSessionRow(session));
      }
      const full = result.sessions.length >= 5;
      createButton.disabled = full;
      createHelp.textContent = full
        ? "Session creation is disabled because the server is at its five-session cap."
        : "The creator joins as the first player.";
      if (result.sessions.length === 0) {
        const emptyRow = document.createElement("tr");
        const empty = document.createElement("td");
        empty.colSpan = 4;
        empty.textContent = "No active sessions.";
        emptyRow.append(empty);
        rows.append(emptyRow);
      }
    } catch (error) {
      showStatus(status, messageOf(error), true);
    } finally {
      refresh.disabled = false;
    }
  }

  function createSessionRow(session: SessionSummary): HTMLTableRowElement {
    const row = document.createElement("tr");
    const name = document.createElement("td");
    name.textContent = session.themeName;
    const user = document.createElement("td");
    user.textContent = session.creator;
    const players = document.createElement("td");
    players.textContent = `${session.playerCount} / ${session.maxPlayers}`;
    const statusCell = document.createElement("td");
    const state = document.createElement("span");
    state.textContent = session.status === "waiting"
      ? "Registering"
      : session.status === "running"
        ? "Running"
        : session.status;
    statusCell.append(state);
    const join = document.createElement("button");
    join.type = "button";
    join.textContent = "Join";
    join.disabled = !session.canJoin;
    join.title = session.canJoin
      ? "Join this waiting session."
      : session.status !== "waiting"
        ? "Only registering sessions can be joined."
        : session.playerCount >= session.maxPlayers
          ? "This session is full."
          : "You are already in this session.";
    join.addEventListener("click", async () => {
      try {
        await api(`/api/v1/sessions/${session.id}/join`, { method: "POST", body: "{}" });
        showStatus(status, `Joined ${session.name}.`);
        await refreshSessions();
      } catch (error) {
        showStatus(status, messageOf(error), true);
      }
    });
    const spectate = document.createElement("button");
    spectate.type = "button";
    spectate.textContent = "Spectate";
    spectate.disabled = !session.canSpectate;
    spectate.title = session.canSpectate
      ? "Observe this session and choose a player to follow."
      : "Spectating is available for running sessions with free spectator capacity.";
    spectate.addEventListener("click", () => onSpectate(session.id));
    statusCell.append(join, spectate);
    if (session.canRejoin) {
      const rejoin = document.createElement("button");
      rejoin.type = "button";
      rejoin.textContent = "Rejoin";
      rejoin.addEventListener("click", async () => {
        rejoin.disabled = true;
        try {
          await api(`/api/v1/sessions/${session.id}/rejoin`, { method: "POST", body: "{}" });
          onPlay(session.id);
        } catch (error) {
          showStatus(status, messageOf(error), true);
          rejoin.disabled = false;
        }
      });
      statusCell.append(rejoin);
    }
    if (session.canPlay) {
      const play = document.createElement("button");
      play.type = "button";
      play.textContent = "Play";
      play.addEventListener("click", () => onPlay(session.id));
      statusCell.append(play);
    }

    if (session.creator === account.username && session.status === "waiting") {
      const controls = document.createElement("details");
      const summary = document.createElement("summary");
      summary.textContent = "Creator controls";
      controls.append(summary);
      controls.addEventListener("toggle", () => {
        if (controls.open && controls.childElementCount === 1) {
          void loadCreatorControls(controls, session);
        }
      });
      statusCell.append(controls);
    }
    row.append(name, user, players, statusCell);
    return row;
  }

  async function loadCreatorControls(
    controls: HTMLDetailsElement,
    session: SessionSummary
  ): Promise<void> {
    try {
      const result = await api<{ settings: GameSettings }>(`/api/v1/sessions/${session.id}`);
      const settingsForm = buildSettingsForm(result.settings);
      const save = document.createElement("button");
      save.type = "button";
      save.textContent = "Save settings";
      save.addEventListener("click", async () => {
        save.disabled = true;
        try {
          await api(`/api/v1/sessions/${session.id}/settings`, {
            method: "PATCH",
            body: JSON.stringify({
              settings: readSettings(settingsForm),
              expectedRevision: session.settingsRevision
            })
          });
          showStatus(status, "Settings updated.");
          await refreshSessions();
        } catch (error) {
          showStatus(status, messageOf(error), true);
        } finally {
          save.disabled = false;
        }
      });
      const start = document.createElement("button");
      start.type = "button";
      start.textContent = "Start session";
      start.addEventListener("click", async () => {
        start.disabled = true;
        try {
          await api(`/api/v1/sessions/${session.id}/start`, {
            method: "POST",
            body: JSON.stringify({ expectedRevision: session.settingsRevision })
          });
          showStatus(status, "Session started.");
          onPlay(session.id);
        } catch (error) {
          showStatus(status, messageOf(error), true);
        } finally {
          start.disabled = false;
        }
      });
      controls.append(settingsForm, save, start);
    } catch (error) {
      const message = document.createElement("p");
      message.textContent = messageOf(error);
      controls.append(message);
    }
  }

  async function signOut(): Promise<void> {
    try {
      await api("/api/v1/auth/logout", { method: "POST" });
      onLogout();
    } catch (error) {
      showStatus(status, messageOf(error), true);
    }
  }
}

function buildSettingsForm(settings: GameSettings): HTMLFieldSetElement {
  const fieldset = document.createElement("fieldset");
  const legend = document.createElement("legend");
  legend.textContent = "Session settings";
  fieldset.append(legend);
  for (const field of NUMBER_FIELDS) {
    const control = inputField(
      field.label,
      `setting-${field.key}`,
      "number",
      String(settings[field.key]),
      24
    );
    control.input.min = String(field.min);
    control.input.max = String(field.max);
    control.input.step = String(field.step);
    control.input.required = true;
    fieldset.append(control.label, control.input);
  }
  const theme = inputField(
    "Theme revision",
    "setting-themeRevision",
    "text",
    settings.themeRevision,
    128
  );
  theme.input.required = true;
  fieldset.append(theme.label, theme.input);
  return fieldset;
}

function readSettings(fieldset: HTMLFieldSetElement): GameSettings {
  const value = (key: keyof GameSettings): string =>
    fieldset.querySelector<HTMLInputElement>(`[name="setting-${key}"]`)?.value ?? "";
  return {
    maxPlayers: Number(value("maxPlayers")),
    maxSpectators: Number(value("maxSpectators")),
    initialNpcsPerPlayer: Number(value("initialNpcsPerPlayer")),
    npcPopulationGrowthPercent: Number(value("npcPopulationGrowthPercent")),
    baseNpcHealth: Number(value("baseNpcHealth")),
    npcHealthGrowthPercent: Number(value("npcHealthGrowthPercent")),
    respawnDelaySeconds: Number(value("respawnDelaySeconds")),
    maxLevels: Number(value("maxLevels")),
    themeRevision: value("themeRevision")
  };
}

function inputField(
  labelText: string,
  name: string,
  type: string,
  value: string,
  maxLength: number
): { label: HTMLLabelElement; input: HTMLInputElement } {
  const label = document.createElement("label");
  label.htmlFor = name;
  label.textContent = labelText;
  const input = document.createElement("input");
  input.id = name;
  input.name = name;
  input.type = type;
  input.value = value;
  input.maxLength = maxLength;
  return { label, input };
}

async function api<T = void>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(path, {
    ...init,
    headers,
    credentials: "same-origin"
  });
  if (response.status === 204) {
    return undefined as T;
  }
  const body: unknown = await response.json();
  if (!response.ok) {
    throw new Error(
      typeof body === "object" &&
        body !== null &&
        "error" in body &&
        typeof body.error === "object" &&
        body.error !== null &&
        "message" in body.error &&
        typeof body.error.message === "string"
        ? body.error.message
        : "The request failed."
    );
  }
  return body as T;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "The request failed.";
}
