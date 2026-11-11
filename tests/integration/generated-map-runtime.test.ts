import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_GAME_SETTINGS } from "@multiplayer-game/protocol";
import type { DefaultEntity } from "@multiplayer-game/default-theme";
import type { ModuleContext } from "@multiplayer-game/theme-sdk";

vi.mock("@multiplayer-game/default-theme", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@multiplayer-game/default-theme")>();
  return {
    ...actual,
    generateMap: vi.fn((seed: number) => actual.generateMap(seed, "simple-generated"))
  };
});

import { generateMap } from "@multiplayer-game/default-theme";
import { createApp } from "../../apps/server/src/app.js";
import { readConfig } from "../../apps/server/src/config.js";
import { openDatabase, runMigrations } from "../../apps/server/src/storage/database.js";
import { ThemeLoader } from "../../apps/server/src/themes/builtins.js";
import { DefaultViewSchema } from "../../themes/default/src/skin/view.js";

describe("generated map session startup", () => {
  afterEach(() => vi.restoreAllMocks());

  it("chooses geometry once and passes the same map to the real module and world", async () => {
    const database = openDatabase(":memory:");
    runMigrations(database);
    const origin = "https://game.example.test";
    const headers = { origin, "content-type": "application/json" };
    const app = createApp(readConfig({ NODE_ENV: "test", PUBLIC_ORIGIN: origin }), database, { ready: true });
    const createModule = ThemeLoader.prototype.createModuleInstance;
    let capturedContext: ModuleContext<DefaultEntity> | undefined;
    let capturedModule: ReturnType<ThemeLoader["createModuleInstance"]> | undefined;
    vi.spyOn(ThemeLoader.prototype, "createModuleInstance").mockImplementation(function (
      this: ThemeLoader, ...args
    ) {
      capturedContext = args[1];
      capturedModule = createModule.apply(this, args);
      return capturedModule;
    });
    try {
      const register = await app.inject({
        method: "POST", url: "/api/v1/auth/register", headers,
        payload: { username: "MapTester", password: "a secure test password", controlMode: "keyboard-only" }
      });
      expect(register.statusCode).toBe(201);
      const login = await app.inject({
        method: "POST", url: "/api/v1/auth/login", headers,
        payload: { username: "MapTester", password: "a secure test password" }
      });
      expect(login.statusCode).toBe(200);
      const cookieHeader = login.headers["set-cookie"];
      const cookie = (Array.isArray(cookieHeader) ? cookieHeader[0] : cookieHeader)!.split(";")[0]!;
      const created = await app.inject({
        method: "POST", url: "/api/v1/sessions", headers: { ...headers, cookie },
        payload: { settings: { ...DEFAULT_GAME_SETTINGS, initialNpcsPerPlayer: 1 } }
      });
      expect(created.statusCode).toBe(201);
      const sessionId = created.json().session.id as string;
      const seed = (database.prepare("SELECT seed FROM matches WHERE id = ?").get(sessionId) as { seed: number }).seed;
      const started = await app.inject({
        method: "POST", url: `/api/v1/sessions/${sessionId}/start`,
        headers: { ...headers, cookie }, payload: { expectedRevision: 0 }
      });
      expect(started.statusCode).toBe(200);
      expect(vi.mocked(generateMap)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(generateMap)).toHaveBeenCalledWith(seed);
      const selected = vi.mocked(generateMap).mock.results[0]!.value;
      expect(capturedContext).toBeDefined();
      expect(capturedModule).toBeDefined();
      const snapshot = DefaultViewSchema.parse(capturedModule!.snapshot({
        accountId: register.json().account.id as string, role: "player"
      }));
      expect(snapshot.map.obstacles).toEqual(selected.map.obstacles);
      for (const obstacle of selected.map.obstacles) {
        expect(capturedContext!.geometry.intersectsObstacle(
          obstacle.x + obstacle.width / 2, obstacle.y + obstacle.height / 2, 1
        )).toBe(true);
      }
      expect(snapshot.radar!.markers.filter(marker => marker.category === "terrain")).toHaveLength(
        selected.map.obstacles.length
      );
    } finally {
      await app.close();
    }
  });
});
