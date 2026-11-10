import {
  MovementController,
  ThemeDefinitionSchema,
  validateThemeRevision,
  type Capability,
  type GameModuleFactory,
  type MovementControllerOptions,
  type SkinFactory
} from "@multiplayer-game/theme-sdk";

const movementOptions: MovementControllerOptions = { facingMovementBlend: 0.4 };
export const movementController = new MovementController(movementOptions);
export const defaultMovementController = new MovementController();

type UnlockAction = { readonly type: "unlock"; readonly targetId: string };
type State = { tick: number; unlocked: string[] };

export const unlockCapability: Capability<{ unlocked: boolean }> = {
  typeId: "external.unlock",
  stateSchemaVersion: 1,
  createState: () => ({ unlocked: false }),
  onInput: () => ({ unlocked: true })
};

export const moduleFactory: GameModuleFactory<
  { enabled: boolean }, UnlockAction, State, State, { unlockedCount: number }
> = {
  metadata: { id: "external", version: "1.0.0", stateSchemaVersion: 1 },
  validateSettings(settings: unknown): settings is { enabled: boolean } {
    return typeof settings === "object" && settings !== null &&
      "enabled" in settings && typeof settings.enabled === "boolean";
  },
  create(_context, settings, roster) {
    const members = new Set(roster.map((member) => member.accountId));
    const state: State = { tick: 0, unlocked: [] };
    let disposed = false;
    function assertActive(): void {
      if (disposed) throw new Error("External module is disposed.");
    }
    return {
      stateSchemaVersion: 1,
      get state() { return { tick: state.tick, unlocked: [...state.unlocked] }; },
      initialize() { assertActive(); },
      validateInput(input: unknown): input is UnlockAction {
        return typeof input === "object" && input !== null &&
          "type" in input && input.type === "unlock" &&
          "targetId" in input && typeof input.targetId === "string";
      },
      applyInput(accountId, input) {
        assertActive();
        if (!members.has(accountId)) throw new Error("Unknown roster member.");
        if (settings.enabled && !state.unlocked.includes(input.targetId)) {
          state.unlocked.push(input.targetId);
        }
      },
      setPlayerPresence(accountId) {
        assertActive();
        if (!members.has(accountId)) throw new Error("Unknown roster member.");
      },
      step(_dt, tick) { assertActive(); state.tick = tick; },
      snapshot() { assertActive(); return { tick: state.tick, unlocked: [...state.unlocked] }; },
      results() { assertActive(); return { unlockedCount: state.unlocked.length }; },
      dispose() { disposed = true; state.unlocked.length = 0; }
    };
  }
};

export const skinFactory: SkinFactory = {
  metadata: {
    id: "external",
    version: "1.0.0",
    acceptedModuleId: "external",
    acceptedStateSchemaVersions: [1]
  },
  mount(host) {
    const slot = host.slots.get("hud");
    if (!slot) throw new Error("The external skin requires a HUD slot.");
    const panel = document.createElement("div");
    panel.textContent = "External unlock HUD";
    slot.append(panel);
    return {
      handleSnapshot() {},
      handleEvents() {},
      handleViewport() {},
      render() {},
      dispose() { panel.remove(); }
    };
  }
};

export const definition = ThemeDefinitionSchema.parse({
  id: "external",
  name: "External SDK Consumer",
  version: "1.0.0",
  engineApiMajor: 1,
  module: moduleFactory.metadata,
  skin: {
    rendererId: skinFactory.metadata.id,
    version: skinFactory.metadata.version,
    acceptedModuleId: skinFactory.metadata.acceptedModuleId,
    acceptedStateSchemaVersions: skinFactory.metadata.acceptedStateSchemaVersions
  },
  assetsDigest: "0".repeat(64),
  settingsSchemaVersion: 1,
  settingsSchema: { enabled: { type: "boolean" } },
  settingsDefaults: { enabled: true }
});

export const validatedDefinition = validateThemeRevision({
  definition,
  packageDigest: definition.assetsDigest,
  installedModule: moduleFactory.metadata,
  installedRenderer: skinFactory.metadata
});
