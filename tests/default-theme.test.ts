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
