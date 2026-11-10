import type { JsonValue } from "@multiplayer-game/protocol";
import type { AssetLoader, Point2, SkinFactory, SkinHost, SkinInstance } from "@multiplayer-game/theme-sdk";
import type { ControlMode } from "./auth.js";

export interface MountedSkinHost {
  readonly host: SkinHost;
  handleSnapshot(snapshot: JsonValue, schemaVersion: number): void;
  handleEvents(events: readonly JsonValue[]): void;
  dispose(): void;
}

export function mountSkinHost(
  root: HTMLElement,
  factory: SkinFactory,
  options: {
    readonly target: Readonly<{ accountId: string; username: string }>;
    readonly controlMode?: ControlMode;
    readonly dispatchInput: (action: JsonValue) => void;
    readonly navigate: SkinHost["navigate"];
    readonly onError: (error: Error) => void;
    readonly toolbar?: readonly HTMLElement[];
    readonly assets?: AssetLoader;
  }
): MountedSkinHost {
  const world = document.createElement("section");
  world.className = "game-world";
  const hud = document.createElement("div");
  hud.className = "game-hud";
  const controls = document.createElement("div");
  controls.className = "game-controls";
  controls.dataset.controlMode = options.controlMode ?? "keyboard-mouse";
  root.replaceChildren(hud, world, controls);
  let cameraAnchor: Point2 | undefined;
  let disposed = false;
  let disposing = false;
  let snapshot: JsonValue | undefined;
  let frame = 0;
  let skin: SkinInstance | undefined;
  const host: SkinHost = {
    slots: new Map([["world", world], ["hud", hud], ["controls", controls]]),
    selectedTarget: options.target,
    get cameraAnchor() { return cameraAnchor; },
    setCameraAnchor(anchor) {
      if (anchor && (!Number.isFinite(anchor.x) || !Number.isFinite(anchor.y))) {
        throw new TypeError("Camera anchor must contain finite coordinates.");
      }
      cameraAnchor = anchor ? Object.freeze({ ...anchor }) : undefined;
    },
    dispatchInput(action) {
      if (!disposed) options.dispatchInput(action);
    },
    navigate(action) { if (!disposed) options.navigate(action); }
  };
  const assets: AssetLoader = options.assets ?? {
    image: async (id) => { throw new Error(`No image asset is registered: ${id}.`); },
    audio: async (id) => { throw new Error(`No audio asset is registered: ${id}.`); }
  };
  const resize = (): void => {
    if (disposed || !skin) return;
    const rect = world.getBoundingClientRect();
    skin.handleViewport(Math.max(1, rect.width), Math.max(1, rect.height), window.devicePixelRatio);
  };
  const observer = new ResizeObserver(() => guarded(resize));
  function dispose(): void {
    if (disposed || disposing) return;
    disposing = true;
    try {
      skin?.dispose();
    } finally {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", onResize);
      cameraAnchor = undefined;
      snapshot = undefined;
    }
  }
  function guarded(action: () => void): void {
    try {
      action();
    } catch (error) {
      dispose();
      options.onError(error instanceof Error ? error : new Error("Skin presentation failed."));
    }
  }
  const onResize = (): void => guarded(resize);
  function render(time: number): void {
    if (disposed) return;
    guarded(() => {
      if (snapshot !== undefined) skin?.render(time, snapshot);
    });
    if (!disposed) frame = requestAnimationFrame(render);
  }
  try {
    skin = factory.mount(host, assets);
    hud.prepend(...(options.toolbar ?? []));
    resize();
    observer.observe(world);
    window.addEventListener("resize", onResize);
    frame = requestAnimationFrame(render);
  } catch (error) {
    dispose();
    throw error;
  }
  return {
    host,
    handleSnapshot(value, schemaVersion) {
      if (disposed) return;
      if (!factory.metadata.acceptedStateSchemaVersions.includes(schemaVersion)) {
        throw new Error(`This renderer does not support module state schema ${schemaVersion}.`);
      }
      snapshot = structuredClone(value);
      skin?.handleSnapshot(snapshot);
    },
    handleEvents(events) { if (!disposed) skin?.handleEvents(events); },
    dispose
  };
}
