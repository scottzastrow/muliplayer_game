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
const FACING_DOT_RADIUS = 3;
const TURN_RADIANS_PER_SECOND = Math.PI;

export const defaultSkinFactory: SkinFactory = Object.freeze({
  metadata,
  mount(host: SkinHost): SkinInstance {
    const world = host.slots.get("world");
    const hud = host.slots.get("hud");
    const controls = host.slots.get("controls");
    if (!world || !hud || !controls) throw new Error("The default skin requires world, hud and controls slots.");
    const canvas = document.createElement("canvas");
    canvas.tabIndex = 0;
    const controlMode = controls.dataset.controlMode === "keyboard-only"
      ? "keyboard-only" : "keyboard-mouse";
    canvas.setAttribute("aria-label", controlMode === "keyboard-only"
      ? "Dots and Squares game. WASD to move, left and right arrows to turn, Space to fire."
      : "Dots and Squares game. Arrow keys to move, mouse to aim, left click to fire.");
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
    const waveTime = document.createElement("div");
    waveTime.className = "default-wave-time";
    hud.append(points, health, waveTime, life);
    const help = document.createElement("p");
    help.textContent = controlMode === "keyboard-only"
      ? "Click the game to focus. WASD: move. Left/Right arrows: turn in place. Space: fire."
      : "Click the game to focus. Arrow keys: move. Mouse: aim. Left click: fire.";
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
    let facingAngle = 0;
    let facingInitialized = false;
    let lastRenderAt: number | undefined;
    let pointerMoved = false;

    function sendNeutral(): void {
      if (!sending) return;
      sending = false;
      const player = current?.players.find((item) => item.accountId === current?.viewerAccountId);
      const aim = player ? aimPoint(player) : { x: host.cameraAnchor?.x ?? 0, y: host.cameraAnchor?.y ?? 0 };
      host.dispatchInput({ type: "combat", moveX: 0, moveY: 0,
        aimX: aim.x, aimY: aim.y, fire: false });
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
      if (!(event instanceof KeyboardEvent) || !isControlKey(event.code)) return;
      event.preventDefault();
      if (!event.repeat) keys.add(event.code);
    });
    listen(canvas, "keyup", (event) => {
      if (!(event instanceof KeyboardEvent)) return;
      if (isControlKey(event.code) && keys.delete(event.code)) event.preventDefault();
    });
    function updatePointer(event: PointerEvent): void {
      const rect = canvas.getBoundingClientRect();
      pointer = {
        x: (event.clientX - rect.left) * width / rect.width,
        y: (event.clientY - rect.top) * height / rect.height
      };
      pointerMoved = true;
    }
    listen(canvas, "pointermove", (event) => {
      if (event instanceof PointerEvent) updatePointer(event);
    });
    listen(canvas, "pointerdown", (event) => {
      if (!(event instanceof PointerEvent)) return;
      canvas.focus();
      focused = true;
      if (event.button !== 0 || controlMode !== "keyboard-mouse") return;
      event.preventDefault();
      updatePointer(event);
      fire = true;
    });
    listen(window, "pointerup", () => {
      if (controlMode === "keyboard-mouse") fire = false;
    });
    listen(canvas, "pointercancel", () => { fire = false; });
    listen(window, "blur", () => { focused = false; clearControls(); });
    listen(window, "focus", () => { focused = document.activeElement === canvas; });
    listen(document, "visibilitychange", () => {
      if (document.hidden) { focused = false; clearControls(); }
      else focused = document.activeElement === canvas;
    });

    function aimPoint(target: DefaultView["players"][number]): { x: number; y: number } {
      const camera = host.cameraAnchor ?? target.position;
      const pointerTarget = {
        x: camera.x + pointer.x - width / 2,
        y: camera.y + pointer.y - height / 2
      };
      if (controlMode === "keyboard-mouse" && pointerMoved) {
        const dx = pointerTarget.x - target.position.x;
        const dy = pointerTarget.y - target.position.y;
        if (Math.hypot(dx, dy) > 0) {
          facingAngle = Math.atan2(dy, dx);
          facingInitialized = true;
          return pointerTarget;
        }
      }
      return {
        x: target.position.x + Math.cos(facingAngle) * 100,
        y: target.position.y + Math.sin(facingAngle) * 100
      };
    }

    function isTurning(): boolean {
      return controlMode === "keyboard-only" &&
        (keys.has("ArrowLeft") || keys.has("ArrowRight"));
    }

    function isControlKey(code: string): boolean {
      return controlMode === "keyboard-only"
        ? ["KeyW", "KeyA", "KeyS", "KeyD", "ArrowLeft", "ArrowRight", "Space"].includes(code)
        : ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(code);
    }

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
        if (player.facing && !isTurning()) {
          facingAngle = Math.atan2(player.facing.y, player.facing.x);
          facingInitialized = true;
        }
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
        const elapsed = lastRenderAt === undefined
          ? 0
          : Math.min(0.1, Math.max(0, (time - lastRenderAt) / 1000));
        lastRenderAt = time;
        const entities = interpolateEntities(previous, current, (time - receivedAt) / interval);
        const player = current.players.find((item) => item.accountId === current?.viewerAccountId)!;
        const avatar = entities.find((item) =>
          item.state.kind === "player" && item.state.accountId === player.accountId);
        const observed = current.viewerRole === "spectator" ? current.spectatorView : undefined;
        const camera = observed?.cameraAnchor ?? avatar?.position ?? player.position;
        const turnDirection = controlMode === "keyboard-only"
          ? Number(keys.has("ArrowRight")) - Number(keys.has("ArrowLeft"))
          : 0;
        if (focused && turnDirection !== 0 && current.phase === "active" &&
            current.viewerRole === "player" && player.alive) {
          facingAngle += turnDirection * TURN_RADIANS_PER_SECOND * elapsed;
          facingInitialized = true;
        } else if (!facingInitialized && player.facing) {
          facingAngle = Math.atan2(player.facing.y, player.facing.x);
          facingInitialized = true;
        }
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
          } else if (entity.state.kind === "player") {
            const accountId = entity.state.accountId;
            const playerState = current.players.find((item) => item.accountId === accountId);
            context.fillStyle = playerState?.color ?? entity.state.color ??
              (accountId === player.accountId ? "#58d6ff" : "#f7db76");
            context.beginPath();
            context.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
            context.fill();
            const facing = playerState?.facing ?? entity.state.facing;
            const angle = facing ? Math.atan2(facing.y, facing.x) :
              accountId === player.accountId ? facingAngle : 0;
            context.beginPath();
            context.arc(
              screen.x + Math.cos(angle) * (radius + 2),
              screen.y + Math.sin(angle) * (radius + 2),
              FACING_DOT_RADIUS,
              0,
              Math.PI * 2
            );
            context.fill();
          } else {
            context.fillStyle = entity.state.kind === "projectile" ? "#ffffff"
              : entity.state.pickupType === "health" ? "#66df8a"
              : entity.state.pickupType === "rapid-fire" ? "#b892ff" : "#ffa64d";
            context.beginPath();
            context.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
            context.fill();
          }
        }
        points.textContent = `Points: ${observed?.hud.points ?? player.points}`;
        health.textContent = `Health: ${observed?.hud.health ?? player.health}`;
        waveTime.textContent = current.phase === "active" && current.waveRemainingSeconds !== undefined
          ? `Wave time remaining: ${Math.ceil(current.waveRemainingSeconds)}s` : "";
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
          const movement = controlMode === "keyboard-only"
            ? { x: Number(keys.has("KeyD")) - Number(keys.has("KeyA")),
                y: Number(keys.has("KeyS")) - Number(keys.has("KeyW")) }
            : { x: Number(keys.has("ArrowRight")) - Number(keys.has("ArrowLeft")),
                y: Number(keys.has("ArrowDown")) - Number(keys.has("ArrowUp")) };
          const aim = aimPoint(player);
          lastInputAt = time;
          sending = true;
          host.dispatchInput({
            type: "combat",
            moveX: movement.x, moveY: movement.y,
            aimX: Math.max(0, Math.min(current.map.width, aim.x)),
            aimY: Math.max(0, Math.min(current.map.height, aim.y)),
            fire: controlMode === "keyboard-only" ? keys.has("Space") : fire
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
        waveTime.remove();
        life.remove();
        help.remove();
        previous = undefined;
        current = undefined;
      }
    };
  }
});
