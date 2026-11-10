import { DEFAULT_GAME_SETTINGS, GameSettingsSchema, type GameSettings } from "@multiplayer-game/protocol";
import {
  createControlModeFieldset,
  saveControlMode,
  selectedControlMode,
  type ClientAccount
} from "./auth.js";
import { showStatus } from "./ui.js";
import { mountAdminThemes } from "./admin-themes.js";
import { mountAdminMetrics } from "./admin-metrics.js";

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

const NUMBER_FIELDS: ReadonlyArray<{
  key: Exclude<keyof GameSettings, "themeRevision" | "mapMode" | "terrainDensity">;
  label: string;
  min: number;
  max: number;
  step: number | "any";
  help?: string;
}> = [
  { key: "maxPlayers", label: "Maximum players", min: 1, max: 32, step: 1 },
  { key: "maxSpectators", label: "Maximum spectators", min: 0, max: 64, step: 1 },
  { key: "initialNpcsPerPlayer", label: "Initial NPCs per player", min: 1, max: 100, step: 1 },
  { key: "npcPopulationGrowthPercent", label: "NPC growth percent", min: 0, max: 100, step: 1 },
  { key: "baseNpcHealth", label: "Base NPC health", min: 1, max: 100_000, step: 1 },
  { key: "playerMaxHealth", label: "Player maximum health", min: 1, max: 100_000, step: 1,
    help: "Initial and respawn health, and healing limit. Default 150." },
  { key: "npcHealthGrowthPercent", label: "NPC health growth percent", min: 0, max: 100, step: 1 },
  { key: "npcMovementSpeed", label: "NPC movement speed", min: 0, max: 180, step: "any",
    help: "0-180 world units/second; default 67.5. Zero keeps NPCs stationary. One navigation cell is 32 units." },
  { key: "npcDetectionRange", label: "NPC detection range", min: 0, max: 700, step: "any",
    help: "0-700 world units; default 512. Zero disables automatic pursuit." },
  { key: "respawnDelaySeconds", label: "Respawn delay (seconds)", min: 0, max: 60, step: 1 },
  { key: "noKillTimeoutSeconds", label: "No-kill timeout (seconds)", min: 0.001, max: 3600, step: "any",
    help: "Dots and Squares: hidden server timer, reset by any player's enemy kill. Default 60 seconds." },
  { key: "maxLevels", label: "Maximum levels", min: 1, max: 100, step: 1 }
];

export function mountLobby(
  root: HTMLElement,
  status: HTMLElement,
  account: ClientAccount,
  onLogout: () => void,
  onAccountUpdate: (account: ClientAccount) => void,
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

  const controlHeading = document.createElement("h2");
  controlHeading.textContent = "Controls";
  const controlForm = document.createElement("form");
  const controlChoices = createControlModeFieldset(account.controlMode ?? undefined);
  const saveControls = document.createElement("button");
  saveControls.type = "submit";
  saveControls.textContent = "Save controls";
  controlForm.append(controlChoices, saveControls);
  controlForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const controlMode = selectedControlMode(controlChoices);
    if (!controlMode) {
      showStatus(status, "Choose a control mode before saving.", true);
      return;
    }
    saveControls.disabled = true;
    try {
      onAccountUpdate(await saveControlMode(controlMode));
      showStatus(status, "Controls updated.");
    } catch (error) {
      showStatus(status, messageOf(error), true);
    } finally {
      saveControls.disabled = false;
    }
  });

  const createHeading = document.createElement("h2");
  createHeading.textContent = "Create a session";
  const createForm = document.createElement("form");
  const createSettings = buildSettingsForm(DEFAULT_GAME_SETTINGS, true);
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
    controlHeading,
    controlForm,
    createHeading,
    createForm,
    listHeading,
    refresh,
    list,
    ...(account.role === "operator" ? [mountAdminThemes(status), mountAdminMetrics(status)] : [])
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
    if (session.creator === account.username && session.status === "running") {
      const end = document.createElement("button");
      end.type = "button";
      end.textContent = "End Session";
      end.addEventListener("click", async () => {
        if (!window.confirm("End this session now? Current standings will be saved as final results.")) return;
        end.disabled = true;
        try {
          await api(`/api/v1/sessions/${session.id}/end`, { method: "POST", body: "{}" });
          await refreshSessions();
          showStatus(status, "Session ended. Final results saved.");
        } catch (error) {
          showStatus(status, messageOf(error), true);
          end.disabled = false;
        }
      });
      statusCell.append(end);
    }
    if (session.creator === account.username && session.status === "waiting") {
      const start = document.createElement("button");
      start.type = "button";
      start.textContent = "Start Session";
      start.addEventListener("click", () => void startSession(session, start));
      statusCell.append(start);
    }
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
      controls.append(settingsForm, save);
    } catch (error) {
      const message = document.createElement("p");
      message.textContent = messageOf(error);
      controls.append(message);
    }
  }

  async function startSession(session: SessionSummary, button: HTMLButtonElement): Promise<void> {
    button.disabled = true;
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
      button.disabled = false;
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

function buildSettingsForm(settings: GameSettings, newSession = false): HTMLFieldSetElement {
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
    if (field.help) {
      const help = document.createElement("p");
      help.id = `${control.input.id}-help`;
      help.textContent = field.help;
      control.input.setAttribute("aria-describedby", help.id);
      fieldset.append(help);
    }
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
  const mode = selectField("Map mode", "setting-mapMode", [
    ["legacy", "Saved legacy layout"], ["fixed", "Fixed arena"], ["simple-generated", "Simple Generated"]
  ], settings.mapMode ?? (newSession ? "fixed" : "legacy"));
  const density = settings.terrainDensity;
  const schedule = selectField("Terrain density schedule", "setting-densityMode", [
    ["incremental", "Incremental"], ["per-level", "Per Level"]
  ], density?.mode ?? "incremental");
  const start = inputField("Starting density (0-10)", "setting-startingDensity", "number",
    String(density?.mode === "incremental" ? density.startingDensity : 3), 2);
  const increase = inputField("Density increase per level (0-10)", "setting-increasePerLevel", "number",
    String(density?.mode === "incremental" ? density.increasePerLevel : 0), 2);
  for (const input of [start.input, increase.input]) {
    input.min = "0"; input.max = "10"; input.step = "1"; input.required = true;
  }
  const perLevel = inputField("Per Level densities (comma-separated, one per level)",
    "setting-densities", "text",
    density?.mode === "per-level" ? density.densities.join(",") : Array(settings.maxLevels).fill(3).join(","),
    300);
  const help = document.createElement("p");
  help.textContent = "Simple Generated only: each density step targets 8% obstacle coverage. " +
    "Safe routes/spawns can reduce actual coverage. Default 3 with zero increase.";
  fieldset.append(mode.label, mode.select, schedule.label, schedule.select,
    start.label, start.input, increase.label, increase.input, perLevel.label, perLevel.input, help);
  const update = () => {
    const enabled = mode.select.value === "simple-generated";
    schedule.select.disabled = !enabled;
    start.input.disabled = increase.input.disabled = !enabled || schedule.select.value !== "incremental";
    perLevel.input.disabled = !enabled || schedule.select.value !== "per-level";
  };
  mode.select.addEventListener("change", update);
  schedule.select.addEventListener("change", update);
  update();
  // Saved non-generated schedules are retained when editing unrelated settings.
  fieldset.dataset.terrainDensity = JSON.stringify(settings.terrainDensity ?? null);
  return fieldset;
}

function readSettings(fieldset: HTMLFieldSetElement): GameSettings {
  const value = (key: keyof GameSettings | "densityMode" | "densities"): string =>
    fieldset.querySelector<HTMLInputElement>(`[name="setting-${key}"]`)?.value ?? "";
  if (value("npcMovementSpeed").trim() === "") {
    throw new Error("NPC movement speed is required.");
  }
  if (value("npcDetectionRange").trim() === "") {
    throw new Error("NPC detection range is required.");
  }
  if (value("noKillTimeoutSeconds").trim() === "") {
    throw new Error("No-kill timeout is required.");
  }
  if (value("playerMaxHealth").trim() === "") {
    throw new Error("Player maximum health is required.");
  }
  const mapMode = value("mapMode");
  const savedDensity: unknown = JSON.parse(fieldset.dataset.terrainDensity ?? "null");
  const terrainDensity = mapMode === "simple-generated"
    ? value("densityMode") === "per-level"
      ? { mode: "per-level", densities: value("densities").split(",").map(item => {
        if (!item.trim()) throw new Error("Each Per Level density is required.");
        return Number(item);
      }) }
      : { mode: "incremental", startingDensity: requiredNumber("startingDensity"),
        increasePerLevel: requiredNumber("increasePerLevel") }
    : savedDensity;
  return GameSettingsSchema.parse({
    maxPlayers: Number(value("maxPlayers")),
    maxSpectators: Number(value("maxSpectators")),
    initialNpcsPerPlayer: Number(value("initialNpcsPerPlayer")),
    npcPopulationGrowthPercent: Number(value("npcPopulationGrowthPercent")),
    baseNpcHealth: Number(value("baseNpcHealth")),
    playerMaxHealth: Number(value("playerMaxHealth")),
    npcHealthGrowthPercent: Number(value("npcHealthGrowthPercent")),
    npcMovementSpeed: Number(value("npcMovementSpeed")),
    npcDetectionRange: Number(value("npcDetectionRange")),
    respawnDelaySeconds: Number(value("respawnDelaySeconds")),
    noKillTimeoutSeconds: Number(value("noKillTimeoutSeconds")),
    maxLevels: Number(value("maxLevels")),
    themeRevision: value("themeRevision"),
    ...(mapMode === "legacy" ? {} : { mapMode }),
    ...(terrainDensity === null ? {} : { terrainDensity })
  });

  function requiredNumber(key: keyof GameSettings | "startingDensity" | "increasePerLevel"): number {
    const input = fieldset.querySelector<HTMLInputElement>(`[name="setting-${key}"]`)?.value ?? "";
    if (!input.trim()) throw new Error("Terrain density is required.");
    return Number(input);
  }
}

function selectField(labelText: string, name: string, choices: readonly (readonly [string, string])[],
  value: string): { label: HTMLLabelElement; select: HTMLSelectElement } {
  const label = document.createElement("label");
  label.htmlFor = name;
  label.textContent = labelText;
  const select = document.createElement("select");
  select.id = name; select.name = name;
  for (const [value, text] of choices) {
    const option = document.createElement("option");
    option.value = value; option.textContent = text;
    select.append(option);
  }
  select.value = value;
  return { label, select };
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
