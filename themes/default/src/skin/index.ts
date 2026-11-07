import type {
  AssetLoader,
  SkinFactory,
  SkinHost,
  SkinInstance,
  SkinFactoryMetadata
} from "@multiplayer-game/theme-sdk";
import type { DefaultModuleSnapshot } from "../module/index.js";

const metadata: SkinFactoryMetadata = Object.freeze({
  id: "default",
  version: "1.0.0",
  acceptedModuleId: "default",
  acceptedStateSchemaVersions: Object.freeze([1])
});

export const defaultSkinFactory: SkinFactory = Object.freeze({
  metadata,
  mount(host: SkinHost, assets: AssetLoader): SkinInstance<DefaultModuleSnapshot> {
    void host;
    void assets;
    let disposed = false;
    let latestSnapshot: Readonly<DefaultModuleSnapshot> | undefined;
    return {
      handleSnapshot(snapshot): void {
        if (!disposed) {
          latestSnapshot = snapshot;
        }
      },
      handleEvents(): void {},
      render(): void {
        void latestSnapshot;
      },
      handleViewport(): void {},
      dispose(): void {
        disposed = true;
        latestSnapshot = undefined;
      }
    };
  }
});
