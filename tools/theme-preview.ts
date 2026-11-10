import type { JsonValue, MatchResult } from "@multiplayer-game/protocol";
import { DEFAULT_GAME_SETTINGS } from "@multiplayer-game/protocol";
import {
  createDefaultResultsSkin,
  defaultThemeDefinition
} from "@multiplayer-game/default-theme";
import { fixtureThemeDefinition } from "@multiplayer-game/fixture-theme";
import { resolveClientTheme } from "../apps/client/src/themes.js";
import { mountSkinHost, type MountedSkinHost } from "../apps/client/src/skin-host.js";

export const PREVIEW_SCENARIOS = [
  "life",
  "death",
  "combat",
  "pickup",
  "spectator",
  "intermission",
  "results"
] as const;

export type PreviewScenario = typeof PREVIEW_SCENARIOS[number];
export type SnapshotScenario = Exclude<PreviewScenario, "results">;

const PREVIEW_PLAYER_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_PLAYER_ID = "00000000-0000-4000-8000-000000000002";
const PREVIEW_REVISION = `${defaultThemeDefinition.id}@${defaultThemeDefinition.version}`;

export function createPreviewSnapshot(scenario: SnapshotScenario): JsonValue {
  const isDead = scenario === "death";
  const isSpectator = scenario === "spectator";
  const entities: JsonValue[] = [
    {
      id: `player:${PREVIEW_PLAYER_ID}`,
      position: { x: 512, y: 512 },
      radius: 14,
      state: { kind: "player", accountId: PREVIEW_PLAYER_ID, deaths: Number(isDead) }
    },
    {
      id: `player:${OTHER_PLAYER_ID}`,
      position: { x: 628, y: 556 },
      radius: 14,
      state: { kind: "player", accountId: OTHER_PLAYER_ID, deaths: 0 }
    },
    {
      id: "npc:preview",
      position: { x: 720, y: 500 },
      radius: 12,
      state: { kind: "npc", health: 75 }
    }
  ];

  if (scenario === "combat") {
    entities.push({
      id: "projectile:preview",
      position: { x: 664, y: 520 },
      radius: 4,
      state: { kind: "projectile" }
    });
  }
  if (scenario === "pickup") {
    entities.push({
      id: "pickup:preview",
      position: { x: 574, y: 458 },
      radius: 12,
      state: { kind: "pickup", pickupType: "health" }
    });
  }
  if (isDead) {
    entities.splice(0, 1);
  }
  if (scenario === "intermission") {
    const npcIndex = entities.findIndex(entity => typeof entity === "object" &&
      entity !== null && !Array.isArray(entity) && entity.id === "npc:preview");
    entities.splice(npcIndex, 1);
  }

  const targetAccountId = isSpectator ? OTHER_PLAYER_ID : PREVIEW_PLAYER_ID;
  const targetPosition = isSpectator ? { x: 628, y: 556 } : { x: 512, y: 512 };
  const targetPoints = isSpectator ? 460 : 1_250;
  const targetHealth = isSpectator ? 65 : isDead ? 0 : 80;
  const previewPlayer: Record<string, JsonValue> = {
    accountId: PREVIEW_PLAYER_ID,
    position: { x: 512, y: 512 },
    health: targetAccountId === PREVIEW_PLAYER_ID ? targetHealth : 80,
    points: targetAccountId === PREVIEW_PLAYER_ID ? targetPoints : 100,
    deaths: Number(isDead),
    alive: !isDead,
    ...(isDead ? { respawnAtTick: 450, respawnBlocked: false } : {})
  };
  const guestPlayer: Record<string, JsonValue> = {
    accountId: OTHER_PLAYER_ID,
    position: { x: 628, y: 556 },
    health: targetAccountId === OTHER_PLAYER_ID ? targetHealth : 65,
    points: targetAccountId === OTHER_PLAYER_ID ? targetPoints : 460,
    deaths: 0,
    alive: true
  };
  const snapshot: Record<string, JsonValue> = {
    playerMaxHealth: DEFAULT_GAME_SETTINGS.playerMaxHealth,
    tick: 300,
    viewerAccountId: targetAccountId,
    viewerRole: isSpectator ? "spectator" : "player",
    level: 2,
    phase: scenario === "intermission" ? "intermission" : "active",
    ...(scenario === "intermission" ? { intermissionEndsAtTick: 450 } : {}),
    startingNpcCount: 10,
    livingNpcCount: scenario === "intermission" ? 0 : 1,
    levelStandings: [
      { accountId: PREVIEW_PLAYER_ID, username: "PreviewPlayer",
        points: isSpectator ? 100 : targetPoints, levelPoints: isSpectator ? 100 : 250,
        kills: 12, deaths: Number(isDead) },
      { accountId: OTHER_PLAYER_ID, username: "PreviewGuest",
        points: 460, levelPoints: 60, kills: 4, deaths: 0 }
    ].sort((left, right) => right.points - left.points)
      .map((standing, index) => ({ ...standing, rank: index + 1 })),
    map: {
      width: 2_048,
      height: 2_048,
      obstacles: [{ x: 400, y: 400, width: 32, height: 128 }]
    },
    entities,
    players: [previewPlayer, guestPlayer]
  };
  if (isSpectator) {
    snapshot.spectatorView = {
      targetAccountId,
      cameraAnchor: targetPosition,
      hud: { points: targetPoints, health: targetHealth },
      death: { alive: true, remainingSeconds: 0 }
    };
  }
  return snapshot;
}

export function createPreviewResult(): MatchResult {
  return {
    matchId: "00000000-0000-4000-8000-000000000003",
    status: "finished",
    finalLevel: DEFAULT_GAME_SETTINGS.maxLevels,
    standings: [
      {
        accountId: PREVIEW_PLAYER_ID,
        username: "PreviewPlayer",
        rank: 1,
        points: 1_250,
        kills: 12,
        deaths: 1
      },
      {
        accountId: OTHER_PLAYER_ID,
        username: "GuestPlayer",
        rank: 2,
        points: 460,
        kills: 4,
        deaths: 0
      }
    ],
    settings: { ...DEFAULT_GAME_SETTINGS, themeRevision: PREVIEW_REVISION },
    themeDigest: defaultThemeDefinition.assetsDigest,
    finalizedAt: "2026-01-01T00:00:00.000Z"
  };
}

function mountPreview(): void {
  const root = document.querySelector<HTMLElement>("#preview-host");
  const status = document.querySelector<HTMLElement>("#preview-status");
  const themeSelect = document.querySelector<HTMLSelectElement>("#preview-theme");
  const scenarioSelect = document.querySelector<HTMLSelectElement>("#preview-scenario");
  if (!root || !status || !themeSelect || !scenarioSelect) {
    throw new Error("Theme preview page is missing a required element.");
  }

  let mounted: MountedSkinHost | undefined;
  const render = (): void => {
    mounted?.dispose();
    mounted = undefined;
    root.replaceChildren();
    try {
      const scenario = scenarioSelect.value as PreviewScenario;
      const themeRevision = themeSelect.value;
      const target = {
        accountId: scenario === "spectator" ? OTHER_PLAYER_ID : PREVIEW_PLAYER_ID,
        username: scenario === "spectator" ? "GuestPlayer" : "PreviewPlayer"
      };
      const selectedTheme = scenario === "results"
        ? undefined
        : resolveClientTheme(
          themeRevision,
          themeRevision === PREVIEW_REVISION
            ? defaultThemeDefinition.assetsDigest
            : fixtureThemeDefinition.assetsDigest
        );
      const factory = selectedTheme
        ? selectedTheme.factory
        : createDefaultResultsSkin(createPreviewResult(), () => render());
      mounted = mountSkinHost(root, factory, {
        target,
        dispatchInput: (input) => {
          status.textContent = `Preview input (not sent to a server): ${JSON.stringify(input)}`;
        },
        navigate: (action) => {
          status.textContent = `Preview navigation requested: ${action}`;
        },
        onError: (error) => {
          status.textContent = `Renderer error: ${error.message}`;
        }
      });
      if (scenario !== "results") {
        if (!selectedTheme) throw new Error("The selected theme could not be resolved.");
        mounted.handleSnapshot(createPreviewSnapshot(scenario), selectedTheme.definition.module.stateSchemaVersion);
        status.textContent = "Deterministic local fixture data; no multiplayer server is connected.";
      } else {
        mounted.handleSnapshot({}, defaultThemeDefinition.module.stateSchemaVersion);
        status.textContent = "Deterministic saved-results example; no server request was made.";
      }
    } catch (error) {
      mounted?.dispose();
      mounted = undefined;
      status.textContent = error instanceof Error ? error.message : "Unable to mount this preview.";
    }
  };

  themeSelect.addEventListener("change", render);
  scenarioSelect.addEventListener("change", render);
  window.addEventListener("pagehide", () => mounted?.dispose(), { once: true });
  render();
}

if (typeof document !== "undefined") {
  mountPreview();
}
