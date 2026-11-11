import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SessionWorld, SeededRandom } from "@multiplayer-game/engine";
import type { ModuleContext, RosterMember } from "@multiplayer-game/theme-sdk";
import { JsonValueSchema } from "@multiplayer-game/protocol";
import {
  defaultThemeDefinition, type DefaultEntity, type DefaultPlayerAction
} from "@multiplayer-game/default-theme";
import { fixtureThemeDefinition } from "@multiplayer-game/fixture-theme";
import {
  createThemeLoader, DEFAULT_THEME_REGISTRATION, FIXTURE_THEME_REGISTRATION, ThemeLoader
} from "../../apps/server/src/themes/builtins.js";
import { resolveClientTheme } from "../../apps/client/src/themes.js";

describe("public theme conformance", () => {
  it.each([defaultThemeDefinition, fixtureThemeDefinition])(
    "runs isolated public module instances and serializes secret-free state for $id",
    async (definition) => {
      const loader = createThemeLoader();
      const revision = `${definition.id}@${definition.version}`;
      const member = {
        accountId: "conformance-player", username: "ConformancePlayer", joinedOrder: 0,
        passwordHash: "not-a-real-secret", tokenDigest: "not-a-real-token"
      };
      const roster: readonly RosterMember[] = [member];
      const first = loader.createModuleInstance(revision, createContext("first"), {},
        roster, 42, definition.assetsDigest);
      const second = loader.createModuleInstance(revision, createContext("second"), {},
        roster, 42, definition.assetsDigest);
      try {
        await first.initialize();
        await second.initialize();
        const action: DefaultPlayerAction = {
          type: "combat", moveX: 0, moveY: 0, aimX: 10, aimY: 10, fire: false
        };
        expect(first.validateInput(action)).toBe(true);
        expect(first.validateInput({ type: "unknown" })).toBe(false);
        first.applyInput(roster[0]!.accountId, action);
        first.step(1 / 30, 1);
        expect(first.state?.acceptedInputs).toBe(1);
        expect(second.state?.acceptedInputs).toBe(0);
        const snapshot = first.snapshot({ accountId: roster[0]!.accountId, role: "player" });
        expect(JsonValueSchema.parse(snapshot)).toEqual(snapshot);
        expect(JSON.stringify(snapshot)).not.toMatch(
          /password|salt|tokenDigest|sessionCookie|authorization|credential/i
        );
        const spectator = first.snapshot({ accountId: "spectator", role: "spectator" });
        expect(JsonValueSchema.parse(spectator)).toEqual(spectator);
        expect(JSON.stringify([snapshot, spectator, first.results()]))
          .not.toMatch(/not-a-real-secret|not-a-real-token/);
        snapshot.players.length = 0;
        expect(first.snapshot({ accountId: roster[0]!.accountId, role: "player" }).players)
          .toHaveLength(1);
        first.dispose();
        expect(() => first.step(1 / 30, 2)).toThrow();
        expect(second.snapshot({ accountId: roster[0]!.accountId, role: "player" }).players)
          .toHaveLength(1);
      } finally {
        first.dispose();
        second.dispose();
      }
    }
  );

  it.each([DEFAULT_THEME_REGISTRATION, FIXTURE_THEME_REGISTRATION])(
    "rejects incompatible engine, state and renderer metadata for $revision.definition.id",
    (registration) => {
      expect(() => new ThemeLoader([{
        ...registration,
        revision: {
          ...registration.revision,
          definition: { ...registration.revision.definition, engineApiMajor: 2 }
        }
      }])).toThrow(/not compatible/);
      expect(() => new ThemeLoader([{
        ...registration,
        skinFactory: {
          ...registration.skinFactory,
          metadata: { ...registration.skinFactory.metadata, acceptedStateSchemaVersions: [99] }
        }
      }])).toThrow(/mismatched renderer/);
      const { definition } = registration.revision;
      expect(() => resolveClientTheme(`${definition.id}@${definition.version}`, "f".repeat(64)))
        .toThrow(/digest/);
    }
  );

  it("builds and loads an isolated external consumer using only packaged public SDK exports", () => {
    const root = resolve(".");
    const fixture = fileURLToPath(new URL("./external-theme", import.meta.url));
    const directory = mkdtempSync(join(tmpdir(), "multiplayer-external-theme-"));
    try {
      cpSync(fixture, directory, { recursive: true });
      const pin = JSON.parse(readFileSync(join(directory, "engine-contract.lock.json"), "utf8")) as {
        revision: string; sdkVersion: string;
      };
      expect(pin.revision).toMatch(/^[a-f0-9]{40}$/);
      expect(execFileSync("git", [
        "--no-pager", "diff", pin.revision, "--",
        join("packages", "protocol"), join("packages", "theme-sdk")
      ], { cwd: root, encoding: "utf8" })).toBe("");
      const packagePaths = [
        join("packages", "protocol"), join("packages", "theme-sdk"), join("node_modules", "zod")
      ];
      const dependencies: Record<string, string> = {};
      for (const packagePath of packagePaths) {
        const packageDirectory = resolve(root, packagePath);
        const metadata = JSON.parse(readFileSync(join(packageDirectory, "package.json"), "utf8")) as {
          name: string; version: string;
        };
        if (metadata.name === "@multiplayer-game/theme-sdk") {
          expect(metadata.version).toBe(pin.sdkVersion);
        }
        const output = runNpm(["pack", "--ignore-scripts", "--json", "--pack-destination", directory],
          packageDirectory);
        const packed = JSON.parse(output) as Array<{ filename: string }>;
        if (!packed[0]) throw new Error(`npm pack produced no artifact for ${metadata.name}.`);
        dependencies[metadata.name] = `file:./${packed[0].filename}`;
      }
      const manifestPath = join(directory, "package.json");
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
      writeFileSync(manifestPath, JSON.stringify({ ...manifest, dependencies, devDependencies: {} }));
      runNpm(["install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund",
        "--package-lock=false"], directory);
      execFileSync(process.execPath, [
        join(root, "node_modules", "typescript", "bin", "tsc"),
        "--project", join(directory, "tsconfig.json")
      ], { cwd: directory, encoding: "utf8", timeout: 30_000 });
      expect(readFileSync(join(directory, "index.ts"), "utf8")).not.toMatch(
        /from\s+["'](?:\.|@multiplayer-game\/(?:engine|default-theme|fixture-theme|protocol))/
      );
      const output = execFileSync(process.execPath, ["--input-type=module", "-e",
        `
          import assert from "node:assert/strict";
          const theme = await import("./dist/index.js");
          const movement = { x: 0.4, y: 0 };
          const facing = { x: 0, y: -1 };
          const travel = theme.movementController.resolveMovement(movement, facing);
          assert.ok(Math.abs(Math.atan2(travel.y, travel.x) + Math.PI / 5) < 1e-10);
          assert.ok(Math.abs(Math.hypot(travel.x, travel.y) - 0.4) < 1e-10);
          assert.deepEqual(theme.defaultMovementController.resolveMovement(movement, facing), movement);
          const context = {
            clock: { nowMs: () => 0 }, random: { next: () => 0.5 },
            entities: {
              get: () => undefined, add() {}, update() {}, remove: () => false,
              values: () => [], queryRadius: () => []
            },
            geometry: {
              isWalkable: () => true, intersectsObstacle: () => false,
              moveCircle: (point) => point
            },
            navigation: { requestPath: () => undefined, getPath: () => undefined },
            emit() {}, requestCompletion() {}, metrics: { increment() {}, gauge() {} }
          };
          const roster = [{ accountId: "external-player", username: "ExternalPlayer", joinedOrder: 0 }];
          const first = theme.moduleFactory.create(context, { enabled: true }, roster, 42);
          const second = theme.moduleFactory.create(context, { enabled: true }, roster, 42);
          first.initialize(); second.initialize();
          const input = { type: "unlock", targetId: "door" };
          assert.equal(first.validateInput(input), true);
          assert.equal(first.validateInput({ type: "invalid" }), false);
          assert.throws(() => first.applyInput("outsider", input), /Unknown roster/);
          first.applyInput("external-player", input);
          first.step(1 / 30, 1);
          assert.deepEqual(first.snapshot(), { tick: 1, unlocked: ["door"] });
          assert.deepEqual(second.snapshot(), { tick: 0, unlocked: [] });
          assert.deepEqual(first.results(), { unlockedCount: 1 });
          first.dispose();
          assert.throws(() => first.step(1 / 30, 2), /disposed/);
          assert.deepEqual(second.snapshot(), { tick: 0, unlocked: [] });
          second.dispose();
          console.log(JSON.stringify(theme.validatedDefinition));
        `
      ], { cwd: directory, encoding: "utf8", timeout: 10_000 });
      expect(JSON.parse(output)).toMatchObject({
        id: "external", module: { id: "external", stateSchemaVersion: 1 }
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 60_000);
});

function runNpm(args: readonly string[], cwd: string): string {
  if (process.platform === "win32") {
    const npmCli = process.env.npm_execpath;
    if (!npmCli) throw new Error("Run the Windows conformance test through npm test to locate npm's CLI.");
    const result = spawnSync(process.execPath, [npmCli, ...args],
      { cwd, encoding: "utf8", timeout: 30_000 });
    if (result.error || result.status !== 0) {
      throw new Error(
        `npm ${args.join(" ")} failed in ${cwd}; exit code: ${result.status}; ` +
        `signal: ${result.signal}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
        { cause: result.error }
      );
    }
    return result.stdout;
  }
  return execFileSync("npm", args, { cwd, encoding: "utf8", timeout: 30_000 });
}

function createContext(id: string): ModuleContext<DefaultEntity> {
  const world = new SessionWorld<DefaultEntity>(id, { width: 2048, height: 2048 });
  return {
    clock: { nowMs: () => 0 },
    random: new SeededRandom(42),
    entities: {
      get: (entityId) => world.getEntity(entityId),
      add: (entity) => world.addEntity(entity),
      update: (entityId, update) => {
        const entity = world.getEntity(entityId);
        if (!entity) throw new Error(`Missing entity ${entityId}.`);
        world.addEntity(update(entity));
      },
      remove: (entityId) => world.removeEntity(entityId),
      values: () => world.entities(),
      queryRadius: (center, radius, maxCells) => world.queryEntities(center, radius, maxCells)
    },
    geometry: {
      isWalkable: (x, y, radius = 0) => world.geometry.isCircleWalkable({ x, y }, radius),
      intersectsObstacle: (x, y, radius) => world.geometry.intersectsObstacle({ x, y }, radius),
      moveCircle: (position, delta, radius) => world.geometry.moveCircle(position, delta, radius)
    },
    navigation: { requestPath: () => undefined, getPath: () => undefined },
    emit: () => {},
    requestCompletion: () => {},
    metrics: { increment: () => {}, gauge: () => {} }
  };
}
