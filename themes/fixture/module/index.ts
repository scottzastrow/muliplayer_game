import type {
  GameModuleFactory,
  GameModuleInstance,
  ModuleContext,
  RosterMember
} from "@multiplayer-game/theme-sdk";
import type { JsonValue } from "@multiplayer-game/protocol";
import {
  defaultModuleFactory,
  type DefaultEntity,
  type DefaultModuleResults,
  type DefaultModuleSnapshot,
  type DefaultModuleState,
  type DefaultPlayerAction
} from "@multiplayer-game/default-theme";

export const FIXTURE_NPC_FLEE_SPEED = 160;
const PLAYER_QUERY_RADIUS = 512;
const PLAYER_QUERY_MAX_CELLS = 2_048;

const fixtureModuleMetadata = Object.freeze({
  id: "fixture",
  version: "1.0.0",
  stateSchemaVersion: 4
});

export const fixtureModuleFactory: GameModuleFactory<
  Record<string, JsonValue>,
  DefaultPlayerAction,
  DefaultModuleState,
  DefaultModuleSnapshot,
  DefaultModuleResults,
  DefaultEntity
> = Object.freeze({
  metadata: fixtureModuleMetadata,
  createInitialMap(settings: Readonly<Record<string, JsonValue>>, seed: number) {
    return defaultModuleFactory.createInitialMap?.(settings, seed);
  },
  validateSettings: defaultModuleFactory.validateSettings,
  create(
    context: ModuleContext<DefaultEntity>,
    settings: Readonly<Record<string, JsonValue>>,
    roster: readonly RosterMember[],
    seed: number
  ): GameModuleInstance<
    DefaultPlayerAction,
    DefaultModuleState,
    DefaultModuleSnapshot,
    DefaultModuleResults
  > {
    const base = defaultModuleFactory.create(context, settings, roster, seed);
    const setPlayerPresence = base.setPlayerPresence;
    if (!setPlayerPresence) {
      throw new Error("The fixture requires the default module's presence support.");
    }

    return {
      get state() {
        const state = base.state;
        if (!state) throw new Error("The fixture module has no state.");
        return state;
      },
      get stateSchemaVersion() {
        return fixtureModuleMetadata.stateSchemaVersion;
      },
      initialize() {
        return base.initialize();
      },
      validateInput(input: unknown): input is DefaultPlayerAction {
        return base.validateInput(input);
      },
      applyInput(accountId: string, input: Readonly<DefaultPlayerAction>): void {
        base.applyInput(accountId, input);
      },
      setPlayerPresence(
        accountId: string,
        presence: "connected" | "disconnected" | "expired"
      ): void {
        setPlayerPresence(accountId, presence);
      },
      step(dtSeconds: number, tick: number): void {
        base.step(dtSeconds, tick);
        for (const npc of context.entities.values()) {
          if (npc.state.kind !== "npc") continue;
          const nearestPlayer = context.entities
            .queryRadius(npc.position, PLAYER_QUERY_RADIUS, PLAYER_QUERY_MAX_CELLS)
            .filter((entity) => entity.state.kind === "player")
            .reduce<DefaultEntity | undefined>((nearest, player) => {
              if (!nearest) return player;
              return distanceSquared(npc.position, player.position) <
                distanceSquared(npc.position, nearest.position) ? player : nearest;
            }, undefined);
          if (!nearestPlayer) continue;

          let dx = npc.position.x - nearestPlayer.position.x;
          let dy = npc.position.y - nearestPlayer.position.y;
          let distance = Math.hypot(dx, dy);
          if (distance === 0) {
            dx = 1;
            dy = 0;
            distance = 1;
          }
          const position = context.geometry.moveCircle(
            npc.position,
            {
              x: dx / distance * FIXTURE_NPC_FLEE_SPEED * dtSeconds,
              y: dy / distance * FIXTURE_NPC_FLEE_SPEED * dtSeconds
            },
            npc.radius
          );
          context.entities.update(npc.id, (entity) => ({ ...entity, position }));
        }
      },
      snapshot(viewer) {
        return base.snapshot(viewer);
      },
      results() {
        return base.results();
      },
      dispose() {
        base.dispose();
      }
    };
  }
});

function distanceSquared(
  left: Readonly<{ x: number; y: number }>,
  right: Readonly<{ x: number; y: number }>
): number {
  return (left.x - right.x) ** 2 + (left.y - right.y) ** 2;
}
