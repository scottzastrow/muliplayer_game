import type {
  AssetLoader,
  SkinFactory,
  SkinFactoryMetadata,
  SkinHost,
  SkinInstance
} from "@multiplayer-game/theme-sdk";
import type { JsonValue } from "@multiplayer-game/protocol";

interface FixturePlayerView {
  readonly accountId: string;
  readonly position: Readonly<{ x: number; y: number }>;
  readonly health: number;
  readonly points: number;
  readonly alive: boolean;
}

interface FixtureView {
  readonly viewerAccountId: string;
  readonly level: number;
  readonly phase: string;
  readonly players: readonly FixturePlayerView[];
  readonly entities: readonly JsonValue[];
  readonly map: Readonly<{ width: number; height: number }>;
}

const metadata: SkinFactoryMetadata = Object.freeze({
  id: "fixture",
  version: "1.0.0",
  acceptedModuleId: "fixture",
  acceptedStateSchemaVersions: Object.freeze([4])
});

export const fixtureSkinFactory: SkinFactory = Object.freeze({
  metadata,
  mount(host: SkinHost, _assets: AssetLoader): SkinInstance {
    const worldSlot = host.slots.get("world");
    const hudSlot = host.slots.get("hud");
    const controlsSlot = host.slots.get("controls");
    if (!worldSlot || !hudSlot || !controlsSlot) {
      throw new Error("The fixture skin requires world, hud and controls slots.");
    }

    const hud = document.createElement("section");
    hud.className = "fixture-hud";
    hud.style.display = "grid";
    hud.style.gridTemplateColumns = "2fr 1fr";
    hud.style.gap = "0.75rem";
    const heading = document.createElement("h2");
    heading.className = "fixture-hud-heading";
    heading.textContent = "Fleeing Squares // FIELD STATUS";
    heading.style.gridColumn = "1 / -1";
    const level = document.createElement("div");
    level.className = "fixture-hud-level";
    const points = document.createElement("div");
    points.className = "fixture-hud-points";
    const health = document.createElement("div");
    health.className = "fixture-hud-health";
    const life = document.createElement("div");
    life.className = "fixture-hud-life";
    life.style.gridColumn = "1 / -1";
    hud.append(heading, level, points, health, life);

    const world = document.createElement("section");
    world.className = "fixture-world-summary";
    const controls = document.createElement("div");
    controls.className = "fixture-controls";
    const buttons: Array<Readonly<{ element: HTMLButtonElement; listener: EventListener }>> = [];
    for (const movement of [
      { label: "Move west", x: -1, y: 0 },
      { label: "Move north", x: 0, y: -1 },
      { label: "Move south", x: 0, y: 1 },
      { label: "Move east", x: 1, y: 0 }
    ]) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = movement.label;
      const listener: EventListener = () => {
        if (!current) return;
        const player = current.players.find(({ accountId }) =>
          accountId === current?.viewerAccountId);
        if (!player) return;
        host.dispatchInput({
          type: "combat",
          moveX: movement.x,
          moveY: movement.y,
          aimX: player.position.x + (movement.x || 1) * 100,
          aimY: player.position.y + movement.y * 100,
          fire: false
        });
      };
      button.addEventListener("click", listener);
      buttons.push({ element: button, listener });
      controls.append(button);
    }

    worldSlot.append(world);
    hudSlot.append(hud);
    controlsSlot.append(controls);
    let current: FixtureView | undefined;
    let disposed = false;

    return {
      handleSnapshot(snapshot) {
        if (disposed) return;
        const view = parseFixtureView(snapshot);
        const player = view.players.find(({ accountId }) => accountId === view.viewerAccountId);
        if (!player) {
          throw new TypeError("The fixture snapshot does not contain its selected player.");
        }
        current = view;
        host.setCameraAnchor(player.position);
        level.textContent = `LEVEL ${view.level}  /  ${view.phase.toUpperCase()}`;
        points.textContent = `SCORE\n${player.points}`;
        health.textContent = `HEALTH\n${player.health}`;
        life.textContent = player.alive ? "FIELD STATUS: ACTIVE" : "FIELD STATUS: RESPAWNING";
        const npcCount = view.entities.filter((entity) => readRecord(entity)?.state &&
          readRecord(readRecord(entity)?.state)?.kind === "npc").length;
        world.textContent =
          `Fixture map ${view.map.width} x ${view.map.height} · ${npcCount} evasive squares`;
      },
      handleEvents() {},
      render() {},
      handleViewport(width, height, devicePixelRatio) {
        if (![width, height, devicePixelRatio].every((value) =>
          Number.isFinite(value) && value > 0)) {
          throw new TypeError("Viewport dimensions and pixel ratio must be positive and finite.");
        }
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        for (const { element, listener } of buttons) {
          element.removeEventListener("click", listener);
        }
        hud.remove();
        world.remove();
        controls.remove();
        current = undefined;
      }
    };
  }
});

function parseFixtureView(snapshot: Readonly<JsonValue>): FixtureView {
  const record = readRecord(snapshot);
  if (!record || typeof record.viewerAccountId !== "string" ||
      typeof record.level !== "number" || typeof record.phase !== "string" ||
      !Array.isArray(record.players) || !Array.isArray(record.entities)) {
    throw new TypeError("The fixture received an invalid module snapshot.");
  }
  const map = readRecord(record.map);
  if (!map || typeof map.width !== "number" || typeof map.height !== "number") {
    throw new TypeError("The fixture snapshot is missing map bounds.");
  }
  const players = record.players.map((value) => {
    const player = readRecord(value);
    const position = readRecord(player?.position);
    if (!player || typeof player.accountId !== "string" ||
        typeof player.health !== "number" || typeof player.points !== "number" ||
        typeof player.alive !== "boolean" ||
        typeof position?.x !== "number" || typeof position.y !== "number") {
      throw new TypeError("The fixture snapshot contains an invalid player.");
    }
    return {
      accountId: player.accountId,
      position: { x: position.x, y: position.y },
      health: player.health,
      points: player.points,
      alive: player.alive
    };
  });
  return {
    viewerAccountId: record.viewerAccountId,
    level: record.level,
    phase: record.phase,
    players,
    entities: record.entities,
    map: { width: map.width, height: map.height }
  };
}

function readRecord(value: unknown): Record<string, JsonValue> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, JsonValue>
    : undefined;
}
