import { describe, expect, it } from "vitest";
import {
  type EntityStore,
  type ModuleContext,
  type RosterMember
} from "@multiplayer-game/theme-sdk";
import {
  type DefaultEntity,
  type DefaultPlayerAction
} from "@multiplayer-game/default-theme";
import { DefaultViewSchema } from "../themes/default/src/skin/view.js";
import {
  createThemeLoader,
  DEFAULT_THEME_REGISTRATION,
  ThemeLoader
} from "../apps/server/src/themes/builtins.js";
import { defaultThemeDefinition } from "@multiplayer-game/default-theme";

function createContext(): ModuleContext<DefaultEntity> {
  const entities = new Map<string, DefaultEntity>();
  const store: EntityStore<DefaultEntity> = {
    get: (id) => entities.get(id),
    add: (entity) => {
      entities.set(entity.id, entity);
    },
    update: (id, update) => {
      const current = entities.get(id);
      if (!current) {
        throw new RangeError(`Entity ${id} does not exist.`);
      }
      entities.set(id, update(current));
    },
    remove: (id) => entities.delete(id),
    values: () => [...entities.values()],
    queryRadius: (center, radius) =>
      [...entities.values()].filter(
        (entity) => Math.hypot(entity.position.x - center.x, entity.position.y - center.y) <= radius
      )
  };
  return {
    clock: { nowMs: () => 0 },
    random: { next: () => 0.5 },
    entities: store,
    geometry: {
      isWalkable: () => true,
      intersectsObstacle: () => false,
      moveCircle: (position, delta) => ({
        x: position.x + delta.x,
        y: position.y + delta.y
      })
    },
    navigation: { requestPath: () => undefined, getPath: () => undefined },
    emit: () => {},
    requestCompletion: () => {},
    metrics: {
      increment: () => {},
      gauge: () => {}
    }
  };
}

describe("default theme registration", () => {
  it("loads the public theme definition and creates isolated module instances", () => {
    const loader = createThemeLoader();
    const loaded = loader.resolve("default@1.0.0");
    const roster: readonly RosterMember[] = [
      { accountId: "account-1", username: "host", joinedOrder: 0 }
    ];
    const first = loader.createModuleInstance(
      "default@1.0.0",
      createContext(),
      {},
      roster,
      1,
      defaultThemeDefinition.assetsDigest
    );
    const second = loader.createModuleInstance(
      "default@1.0.0",
      createContext(),
      {},
      roster,
      2,
      defaultThemeDefinition.assetsDigest
    );
    first.initialize();
    second.initialize();
    const action: DefaultPlayerAction = {
      type: "combat",
      moveX: 0,
      moveY: 0,
      aimX: 10,
      aimY: 10,
      fire: false
    };

    expect(loaded.definition.name).toBe("Dots and Squares");
    expect(loaded.moduleFactory.metadata.id).toBe("default");
    expect(loaded.skinFactory.metadata.id).toBe("default");
    expect(first.validateInput(action)).toBe(true);
    expect(first.validateInput({ type: "fire" })).toBe(false);
    first.applyInput("account-1", action);

    expect(first.state?.acceptedInputs).toBe(1);
    expect(second.state?.acceptedInputs).toBe(0);
    expect(first.snapshot({ accountId: "account-1", role: "player" }).acceptedInputs).toBe(1);
  });

  it("includes the spread pickup as a non-player entity in a one-player room", () => {
    const roster: readonly RosterMember[] = [
      { accountId: "account-1", username: "host", joinedOrder: 0 }
    ];
    const module = DEFAULT_THEME_REGISTRATION.moduleFactory.create(
      createContext(),
      { initialNpcsPerPlayer: 1, baseNpcHealth: 100_000 },
      roster,
      42
    );
    try {
      module.initialize();
      const snapshot = DefaultViewSchema.parse(
        module.snapshot({ accountId: "account-1", role: "player" })
      );
      expect(snapshot.players).toHaveLength(1);
      expect(snapshot.entities.filter((entity) => entity.state.kind === "player"))
        .toHaveLength(1);
      expect(snapshot.entities.some((entity) =>
        entity.state.kind === "pickup" && entity.state.pickupType === "spread"
      )).toBe(true);
    } finally {
      module.dispose();
    }
  });

  it("authorizes viewer radar markers from live entities and collision geometry", () => {
    const roster: readonly RosterMember[] = [
      { accountId: "account-1", username: "host", joinedOrder: 0 },
      { accountId: "account-2", username: "guest", joinedOrder: 1 }
    ];
    const context = createContext();
    const module = DEFAULT_THEME_REGISTRATION.moduleFactory.create(
      context,
      { initialNpcsPerPlayer: 1, baseNpcHealth: 100_000 },
      roster,
      42
    );
    try {
      module.initialize();
      const npcs = context.entities.values().filter((entity) => entity.state.kind === "npc");
      expect(npcs.length).toBeGreaterThan(0);

      const playerView = DefaultViewSchema.parse(
        module.snapshot({ accountId: "account-1", role: "player" })
      );
      expect(playerView.radar?.categories).toEqual(["player", "enemy", "pickup", "terrain"]);
      expect(playerView.radar?.markers.filter(marker => marker.category === "enemy")).toEqual(npcs.map((npc) => ({
        id: npc.id, category: "enemy", position: npc.position
      })));
      expect(playerView.radar?.markers.filter(marker => marker.category === "player"))
        .toEqual([{ id: "player:account-2", category: "player",
          position: playerView.players[1]!.position }]);
      const pickups = context.entities.values().filter(entity => entity.state.kind === "pickup");
      expect(playerView.radar?.markers.filter(marker => marker.category === "pickup"))
        .toEqual(pickups.map(pickup => ({
          id: pickup.id, category: "pickup", position: pickup.position
        })));
      expect(playerView.radar?.markers.filter(marker => marker.category === "terrain"))
        .toEqual(playerView.map.obstacles.map((obstacle, index) => ({
          id: `terrain:${index}`, category: "terrain",
          position: { x: obstacle.x + obstacle.width / 2, y: obstacle.y + obstacle.height / 2 },
          footprint: { width: obstacle.width, height: obstacle.height }
        })));

      const spectatorView = DefaultViewSchema.parse(
        module.snapshot({ accountId: "account-1", role: "spectator" })
      );
      expect(spectatorView.viewerAccountId).toBe("account-1");
      expect(spectatorView.radar).toEqual(playerView.radar);
      expect(() => module.snapshot({ accountId: "unauthorized", role: "player" }))
        .toThrow(/roster/);

      for (const npc of npcs) {
        context.entities.update(npc.id, (entity) => entity.state.kind === "npc"
          ? { ...entity, state: { ...entity.state, health: 0 } }
          : entity);
      }
      for (const pickup of pickups) context.entities.remove(pickup.id);
      module.setPlayerPresence?.("account-2", "disconnected");
      const removed = DefaultViewSchema.parse(
        module.snapshot({ accountId: "account-1", role: "player" })
      ).radar!;
      expect(removed.markers.filter(marker => marker.category !== "terrain")).toEqual([]);
      expect(removed.markers.filter(marker => marker.category === "terrain"))
        .toEqual(playerView.radar!.markers.filter(marker => marker.category === "terrain"));
    } finally {
      module.dispose();
    }
  });

  it("assigns distinct room colors and keeps authoritative facing through death and respawn", () => {
    const roster: readonly RosterMember[] = [
      { accountId: "account-1", username: "host", joinedOrder: 0 },
      { accountId: "account-2", username: "guest", joinedOrder: 1 }
    ];
    const context = createContext();
    const module = DEFAULT_THEME_REGISTRATION.moduleFactory.create(
      context,
      { initialNpcsPerPlayer: 1, baseNpcHealth: 100_000 },
      roster,
      42
    );
    try {
      module.initialize();
      const snapshot = () => DefaultViewSchema.parse(
        module.snapshot({ accountId: "account-1", role: "player" })
      );
      const initial = snapshot();
      const first = initial.players.find((item) => item.accountId === "account-1")!;
      const second = initial.players.find((item) => item.accountId === "account-2")!;
      expect(first.color).not.toBe(second.color);
      expect(first.facing).toEqual({ x: 1, y: 0 });

      module.applyInput("account-1", {
        type: "combat", moveX: 0, moveY: 0,
        aimX: first.position.x, aimY: first.position.y - 100, fire: false
      });
      module.step(0, 1);
      expect(snapshot().players.find((item) => item.accountId === "account-1")?.facing)
        .toMatchObject({ x: 0, y: -1 });
      context.entities.update("player:account-1", (entity) => entity.state.kind === "player"
        ? { ...entity, state: { ...entity.state, health: 0 } }
        : entity);
      module.step(0, 2);
      module.step(0, 152);
      const returned = snapshot().players.find((item) => item.accountId === "account-1")!;
      expect(returned.color).toBe(first.color);
      expect(returned.facing).toMatchObject({ x: 0, y: -1 });
      expect(returned.alive).toBe(true);

      const spectatorSnapshot = DefaultViewSchema.parse(
        module.snapshot({ accountId: "account-2", role: "spectator" })
      );
      const observed = spectatorSnapshot.players.find((item) => item.accountId === "account-1")!;
      expect(spectatorSnapshot.viewerRole).toBe("spectator");
      expect(observed.color).toBe(first.color);
      expect(observed.facing).toMatchObject({ x: 0, y: -1 });
    } finally {
      module.dispose();
    }
  });

  it("requires the exact pinned digest and compatible engine, module, and renderer versions", () => {
    const loader = createThemeLoader();
    expect(() => loader.resolvePinned("default@1.0.0", "0".repeat(64)))
      .toThrow(/pinned package digest/);

    const registration = DEFAULT_THEME_REGISTRATION;
    expect(() => new ThemeLoader([{
      ...registration,
      revision: {
        ...registration.revision,
        definition: { ...registration.revision.definition, engineApiMajor: 2 }
      }
    }])).toThrow(/not compatible/);
    expect(() => new ThemeLoader([{
      ...registration,
      revision: {
        ...registration.revision,
        definition: {
          ...registration.revision.definition,
          module: {
            ...registration.revision.definition.module,
            stateSchemaVersion: registration.revision.definition.module.stateSchemaVersion + 1
          },
          skin: {
            ...registration.revision.definition.skin,
            acceptedStateSchemaVersions: [
              ...registration.revision.definition.skin.acceptedStateSchemaVersions,
              registration.revision.definition.module.stateSchemaVersion + 1
            ]
          }
        }
      }
    }])).toThrow(/mismatched module/);
  });
});
