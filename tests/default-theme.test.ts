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
import { createThemeLoader } from "../apps/server/src/themes/builtins.js";

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
    values: () => [...entities.values()]
  };
  return {
    clock: { nowMs: () => 0 },
    random: { next: () => 0.5 },
    entities: store,
    geometry: {
      isWalkable: () => true,
      intersectsObstacle: () => false
    },
    navigation: { requestPath: () => undefined },
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
      1
    );
    const second = loader.createModuleInstance(
      "default@1.0.0",
      createContext(),
      {},
      roster,
      2
    );
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
});
