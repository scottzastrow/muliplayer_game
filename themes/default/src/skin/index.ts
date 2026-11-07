import type { SkinFactory, SkinHost, SkinInstance, SkinFactoryMetadata } from "@multiplayer-game/theme-sdk";
import {
  DefaultViewSchema, interpolateEntities, worldToScreen, type DefaultView
} from "./view.js";

const metadata: SkinFactoryMetadata = Object.freeze({
  id: "default",
  version: "1.0.0",
  acceptedModuleId: "default",
  acceptedStateSchemaVersions: Object.freeze([4])
});
const INPUT_INTERVAL_MS = 1000 / 30;
const SNAPSHOT_INTERVAL_MS = 1000 / 15;

export const defaultSkinFactory: SkinFactory = Object.freeze({
  metadata,
  mount(host: SkinHost): SkinInstance {
    const world = host.slots.get("world");
    const hud = host.slots.get("hud");
    const controls = host.slots.get("controls");
    if (!world || !hud || !controls) throw new Error("The default skin requires world, hud and controls slots.");
    const canvas = document.createElement("canvas");
    canvas.tabIndex = 0;
    canvas.setAttribute("aria-label", "Dots and Squares game. WASD to move, mouse to aim, hold left button to fire.");
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser does not support Canvas 2D.");
    const points = document.createElement("div");
    points.className = "default-points";
    points.style.fontSize = "2rem";
    points.style.fontWeight = "bold";
    const health = document.createElement("div");
    health.className = "default-health";
    health.style.fontSize = "1.1rem";
    const life = document.createElement("div");
    life.className = "default-life";
    life.setAttribute("role", "status");
    hud.append(points, health, life);
    const help = document.createElement("p");
    help.textContent = "Click the game to focus. WASD: move. Mouse: aim. Hold left mouse button: fire.";
    controls.append(help);
    world.append(canvas);
    const listeners = new AbortController();
    const keys = new Set<string>();
    let previous: DefaultView | undefined;
    let current: DefaultView | undefined;
    let receivedAt = 0;
    let interval = SNAPSHOT_INTERVAL_MS;
    let width = 1;
    let height = 1;
    let dpr = 1;
    let focused = false;
    let fire = false;
    let sending = false;
    let disposed = false;
    let lastInputAt = -Infinity;
    let pointer = { x: 0, y: 0 };

    function sendNeutral(): void {
      if (!sending) return;
      sending = false;
      host.dispatchInput({ type: "combat", moveX: 0, moveY: 0,
        aimX: host.cameraAnchor?.x ?? 0, aimY: host.cameraAnchor?.y ?? 0, fire: false });
    }
    function clearControls(): void {
      keys.clear();
      fire = false;
      sendNeutral();
    }
    function listen(
      target: EventTarget,
      type: string,
      listener: EventListener
    ): void {
      target.addEventListener(type, listener, { signal: listeners.signal });
    }
    listen(canvas, "focus", () => { focused = true; });
    listen(canvas, "blur", () => { focused = false; clearControls(); });
    listen(canvas, "keydown", (event) => {
      if (!(event instanceof KeyboardEvent) || !["KeyW", "KeyA", "KeyS", "KeyD"].includes(event.code)) return;
      event.preventDefault();
      keys.add(event.code);
    });
    listen(canvas, "keyup", (event) => {
      if (!(event instanceof KeyboardEvent)) return;
      if (keys.delete(event.code)) event.preventDefault();
    });
    function updatePointer(event: PointerEvent): void {
      const rect = canvas.getBoundingClientRect();
      pointer = {
        x: (event.clientX - rect.left) * width / rect.width,
        y: (event.clientY - rect.top) * height / rect.height
      };
    }
    listen(canvas, "pointermove", (event) => {
      if (event instanceof PointerEvent) updatePointer(event);
    });
    listen(canvas, "pointerdown", (event) => {
      if (!(event instanceof PointerEvent) || event.button !== 0) return;
      event.preventDefault();
      canvas.focus();
      focused = true;
      updatePointer(event);
      fire = true;
    });
    listen(window, "pointerup", () => { fire = false; });
    listen(canvas, "pointercancel", () => { fire = false; });
    listen(window, "blur", () => { focused = false; clearControls(); });
    listen(window, "focus", () => { focused = document.activeElement === canvas; });
    listen(document, "visibilitychange", () => {
      if (document.hidden) { focused = false; clearControls(); }
      else focused = document.activeElement === canvas;
    });

    return {
      handleSnapshot(snapshot) {
        const parsed = DefaultViewSchema.safeParse(snapshot);
        if (!parsed.success) throw new Error("Dots and Squares received an invalid snapshot.");
        if (parsed.data.viewerAccountId !== host.selectedTarget?.accountId) {
          throw new Error("The snapshot does not belong to this player's view.");
        }
        if (parsed.data.viewerRole === "spectator" &&
          parsed.data.spectatorView?.targetAccountId !== host.selectedTarget?.accountId) {
          throw new Error("The spectator snapshot is missing its selected target view.");
        }
        if (current && parsed.data.tick <= current.tick) return;
        previous = current;
        current = parsed.data;
        if (current.viewerRole === "spectator") {
          help.textContent = "Spectator mode. Use Back to Players to switch whom you follow.";
          canvas.setAttribute("aria-label", "Dots and Squares spectator view.");
        }
        interval = previous
          ? Math.min(250, Math.max(1, (current.tick - previous.tick) * 1000 / 30))
          : SNAPSHOT_INTERVAL_MS;
        receivedAt = performance.now();
        const player = current.players.find((item) => item.accountId === current?.viewerAccountId);
        if (!player) throw new Error("The snapshot is missing this player's life state.");
        if (!player.alive || current.phase !== "active") clearControls();
      },
      handleEvents() {},
      handleViewport(newWidth, newHeight, devicePixelRatio) {
        if (![newWidth, newHeight, devicePixelRatio].every((value) => Number.isFinite(value) && value > 0)) {
          throw new TypeError("Viewport dimensions and pixel ratio must be positive and finite.");
        }
        width = newWidth;
        height = newHeight;
        dpr = devicePixelRatio;
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        pointer = { x: width / 2, y: height / 2 };
      },
      render(time) {
        if (disposed || !current) return;
        const entities = interpolateEntities(previous, current, (time - receivedAt) / interval);
        const player = current.players.find((item) => item.accountId === current?.viewerAccountId)!;
        const avatar = entities.find((item) =>
          item.state.kind === "player" && item.state.accountId === player.accountId);
        const observed = current.viewerRole === "spectator" ? current.spectatorView : undefined;
        const camera = observed?.cameraAnchor ?? avatar?.position ?? player.position;
        host.setCameraAnchor(camera);
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
        context.fillStyle = "#101824";
        context.fillRect(0, 0, width, height);
        const origin = worldToScreen({ x: 0, y: 0 }, camera, width, height);
        context.fillStyle = "#233345";
        context.fillRect(origin.x, origin.y, current.map.width, current.map.height);
        context.fillStyle = "#657586";
        for (const obstacle of current.map.obstacles) {
          const screen = worldToScreen(obstacle, camera, width, height);
          context.fillRect(screen.x, screen.y, obstacle.width, obstacle.height);
        }
        for (const entity of entities) {
          const screen = worldToScreen(entity.position, camera, width, height);
          const radius = entity.radius;
          if (screen.x + radius < 0 || screen.y + radius < 0 ||
              screen.x - radius > width || screen.y - radius > height) continue;
          if (entity.state.kind === "npc") {
            context.fillStyle = "#ed6b61";
            context.fillRect(screen.x - radius, screen.y - radius, radius * 2, radius * 2);
          } else {
            context.fillStyle = entity.state.kind === "player"
              ? entity.state.accountId === player.accountId ? "#58d6ff" : "#f7db76"
              : entity.state.kind === "projectile" ? "#ffffff"
              : entity.state.pickupType === "health" ? "#66df8a"
              : entity.state.pickupType === "rapid-fire" ? "#b892ff" : "#ffa64d";
            context.beginPath();
            context.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
            context.fill();
          }
        }
        points.textContent = `Points: ${observed?.hud.points ?? player.points}`;
        health.textContent = `Health: ${observed?.hud.health ?? player.health}`;
        const remaining = observed ? Math.ceil(observed.death.remainingSeconds)
          : Math.max(0, Math.ceil(((player.respawnAtTick ?? current.tick) - current.tick) / 30));
        life.textContent = current.phase === "complete" ? "Match complete."
          : !(observed?.death.alive ?? player.alive)
            ? (observed?.death.respawnBlocked ?? player.respawnBlocked)
              ? "Waiting for a safe respawn..." : `Respawning in ${remaining}s`
          : current.phase === "intermission" ? `Level ${current.level} cleared. Next level soon.`
          : `Level ${current.level}`;
        if (focused && player.alive && current.phase === "active" && current.viewerRole === "player" &&
            time - lastInputAt >= INPUT_INTERVAL_MS) {
          const aimX = Math.max(0, Math.min(current.map.width, camera.x + pointer.x - width / 2));
          const aimY = Math.max(0, Math.min(current.map.height, camera.y + pointer.y - height / 2));
          lastInputAt = time;
          sending = true;
          host.dispatchInput({
            type: "combat",
            moveX: Number(keys.has("KeyD")) - Number(keys.has("KeyA")),
            moveY: Number(keys.has("KeyS")) - Number(keys.has("KeyW")),
            aimX, aimY, fire
          });
        }
      },
      dispose() {
        if (disposed) return;
        clearControls();
        disposed = true;
        listeners.abort();
        host.setCameraAnchor(undefined);
        canvas.remove();
        points.remove();
        health.remove();
        life.remove();
        help.remove();
        previous = undefined;
        current = undefined;
      }
    };
  }
});
