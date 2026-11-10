import {
  drawRadar,
  type SkinFactory,
  type SkinHost,
  type SkinInstance,
  type SkinFactoryMetadata
} from "@multiplayer-game/theme-sdk";
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
const TERRAIN_TILE_SIZE = 32;
const TERRAIN_TILE_COLORS = Object.freeze(["#2b3d51", "#2d4155"]);
const TERRAIN_SEAM_COLOR = "#3b5168";
const TERRAIN_PATTERN_COLOR = "#344a60";
const NPC_COLOR = "#ed6b61";
const RADAR_MARGIN = 12;
const RADAR_Y = 84;
const RADAR_RADIUS = 72;
const RADAR_RANGE = 512;
const RADAR_FILTERS = Object.freeze([
  { category: "player", label: "Fellow players" },
  { category: "enemy", label: "NPCs" },
  { category: "pickup", label: "Pickups" },
  { category: "terrain", label: "Terrain" }
]);

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
      ? "Dots and Squares game. WASD to move and face, left and right arrows to turn, Space to fire."
      : "Dots and Squares game. Arrow keys to move and face, mouse to aim, left click to fire.");
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser does not support Canvas 2D.");
    const points = document.createElement("div");
    points.className = "default-points";
    points.style.fontWeight = "bold";
    const health = document.createElement("div");
    health.className = "default-health";
    const life = document.createElement("div");
    life.className = "default-life";
    life.setAttribute("role", "status");
    const terrainCoverage = document.createElement("div");
    terrainCoverage.className = "default-terrain-coverage";
    const levelSummary = document.createElement("section");
    levelSummary.className = "default-level-summary";
    levelSummary.style.flexBasis = "100%";
    levelSummary.setAttribute("aria-label", "Level completion");
    const levelTitle = document.createElement("h2");
    const levelPoints = document.createElement("p");
    const nextLevel = document.createElement("p");
    const standings = document.createElement("table");
    standings.setAttribute("aria-label", "Running standings");
    const standingsCaption = document.createElement("caption");
    standingsCaption.textContent = "Running standings";
    const headings = document.createElement("tr");
    for (const text of ["Rank", "Player", "Level points", "Total points", "Kills", "Deaths"]) {
      const heading = document.createElement("th");
      heading.textContent = text;
      headings.append(heading);
    }
    const standingsHead = document.createElement("thead");
    standingsHead.append(headings);
    const standingsBody = document.createElement("tbody");
    standings.append(standingsCaption, standingsHead, standingsBody);
    levelSummary.append(levelTitle, levelPoints, nextLevel, standings);
    levelSummary.hidden = true;
    hud.append(points, health, levelSummary);
    const options = document.createElement("details");
    const optionsTitle = document.createElement("summary");
    optionsTitle.textContent = "Controls & radar";
    options.append(optionsTitle);
    const help = document.createElement("p");
    help.textContent = controlMode === "keyboard-only"
      ? "Click the game to focus. WASD: move and face. Left/Right arrows: turn in place. Space: fire."
      : "Click the game to focus. Arrow keys: move and face. Mouse: aim. Left click: fire.";
    options.append(help);
    controls.append(options);
    world.append(canvas, life, terrainCoverage);
    const listeners = new AbortController();
    const radarFilters = document.createElement("fieldset");
    radarFilters.className = "default-radar-filters";
    radarFilters.setAttribute("aria-label", "Radar filters");
    radarFilters.style.marginLeft = "auto";
    const legend = document.createElement("legend");
    legend.textContent = "Radar filters";
    radarFilters.append(legend);
    const enabledCategories = new Set(RADAR_FILTERS.map(filter => filter.category));
    for (const filter of RADAR_FILTERS) {
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.name = `radar-${filter.category}`;
      input.checked = true;
      input.setAttribute("aria-label", filter.label);
      input.addEventListener("change", () => {
        if (input.checked) enabledCategories.add(filter.category);
        else enabledCategories.delete(filter.category);
      }, { signal: listeners.signal });
      label.append(input, document.createTextNode(filter.label));
      radarFilters.append(label);
    }
    options.append(radarFilters);
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
    let pointerPosition: { x: number; y: number } | undefined;
    let mouseAiming = false;
    let localFacing = false;

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
      if (!event.repeat && !keys.has(event.code)) {
        keys.add(event.code);
        if (isMovementKey(event.code)) faceMovement();
      }
    });
    listen(canvas, "keyup", (event) => {
      if (!(event instanceof KeyboardEvent)) return;
      if (isControlKey(event.code) && keys.delete(event.code)) {
        event.preventDefault();
        if (isMovementKey(event.code)) faceMovement();
      }
    });
    function updatePointer(event: PointerEvent): void {
      pointerPosition = { x: event.clientX, y: event.clientY };
      const rect = canvas.getBoundingClientRect();
      pointer = {
        x: (event.clientX - rect.left) * width / rect.width,
        y: (event.clientY - rect.top) * height / rect.height
      };
    }
    listen(canvas, "pointermove", (event) => {
      if (!(event instanceof PointerEvent)) return;
      const moved = !pointerPosition ||
        event.clientX !== pointerPosition.x || event.clientY !== pointerPosition.y;
      updatePointer(event);
      if (moved && controlMode === "keyboard-mouse") {
        mouseAiming = true;
        localFacing = true;
      }
    });
    listen(canvas, "pointerdown", (event) => {
      if (!(event instanceof PointerEvent)) return;
      canvas.focus();
      focused = true;
      if (event.button !== 0 || controlMode !== "keyboard-mouse") return;
      event.preventDefault();
      if (!pointerPosition) {
        updatePointer(event);
        if (!localFacing) {
          mouseAiming = true;
          localFacing = true;
        }
      }
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
        x: Math.max(0, Math.min(current?.map.width ?? Infinity, camera.x + pointer.x - width / 2)),
        y: Math.max(0, Math.min(current?.map.height ?? Infinity, camera.y + pointer.y - height / 2))
      };
      if (controlMode === "keyboard-mouse" && mouseAiming) {
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

    function movement(): { x: number; y: number } {
      const x = controlMode === "keyboard-only"
        ? Number(keys.has("KeyD")) - Number(keys.has("KeyA"))
        : Number(keys.has("ArrowRight")) - Number(keys.has("ArrowLeft"));
      const y = controlMode === "keyboard-only"
        ? Number(keys.has("KeyS")) - Number(keys.has("KeyW"))
        : Number(keys.has("ArrowDown")) - Number(keys.has("ArrowUp"));
      const magnitude = Math.hypot(x, y);
      return magnitude > 0 ? { x: x / magnitude, y: y / magnitude } : { x: 0, y: 0 };
    }

    function isMovementKey(code: string): boolean {
      return (controlMode === "keyboard-only"
        ? ["KeyW", "KeyA", "KeyS", "KeyD"]
        : ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]).includes(code);
    }

    function faceMovement(): void {
      const direction = movement();
      if (direction.x === 0 && direction.y === 0) return;
      facingAngle = Math.atan2(direction.y, direction.x);
      facingInitialized = true;
      localFacing = true;
      mouseAiming = false;
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
        if (current.phase === "intermission" && current.levelStandings) standingsBody.replaceChildren();
        for (const standing of current.phase === "intermission" ? current.levelStandings ?? [] : []) {
          const row = document.createElement("tr");
          for (const value of [standing.rank, standing.username, standing.levelPoints,
            standing.points, standing.kills, standing.deaths]) {
            const cell = document.createElement("td");
            cell.textContent = String(value);
            row.append(cell);
          }
          standingsBody.append(row);
        }
        const player = current.players.find((item) => item.accountId === current?.viewerAccountId);
        if (!player) throw new Error("The snapshot is missing this player's life state.");
        if (player.facing && (current.viewerRole === "spectator" || !localFacing)) {
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
          localFacing = true;
        } else if (!facingInitialized && player.facing) {
          facingAngle = Math.atan2(player.facing.y, player.facing.x);
          facingInitialized = true;
        }
        host.setCameraAnchor(camera);
        if (current.viewerRole === "player") aimPoint(player);
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
        context.fillStyle = "#101824";
        context.fillRect(0, 0, width, height);
        drawTerrain(context, current.map, camera, width, height);
        for (const entity of entities) {
          const screen = worldToScreen(entity.position, camera, width, height);
          const radius = entity.radius;
          if (screen.x + radius < 0 || screen.y + radius < 0 ||
              screen.x - radius > width || screen.y - radius > height) continue;
          if (entity.state.kind === "npc") {
            context.fillStyle = NPC_COLOR;
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
            const angle = current.viewerRole === "player" && accountId === player.accountId
              ? facingAngle : facing ? Math.atan2(facing.y, facing.x) : 0;
            context.beginPath();
            context.arc(
              screen.x + Math.cos(angle) * (radius + 2),
              screen.y + Math.sin(angle) * (radius + 2),
              FACING_DOT_RADIUS,
              0,
              Math.PI * 2
            );
            context.fill();
          } else if (entity.state.kind === "pickup") {
            drawPickup(context, screen, radius, entity.state.pickupType);
          } else {
            context.fillStyle = "#ffffff";
            context.beginPath();
            context.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
            context.fill();
          }
        }
        if (current.radar) {
          const radarX = width - RADAR_MARGIN - RADAR_RADIUS;
          const radarFacing = current.viewerRole === "spectator"
            ? player.facing
            : { x: Math.cos(facingAngle), y: Math.sin(facingAngle) };
          drawRadar(context, current.radar, {
            x: radarX,
            y: RADAR_Y,
            radius: RADAR_RADIUS,
            range: RADAR_RANGE,
            center: camera,
            ...(radarFacing ? { facing: radarFacing } : {}),
            markerColors: {
              player: "#f7db76", enemy: NPC_COLOR, pickup: "#ffa64d", terrain: "#344a60"
            },
            markerColorOverrides: Object.fromEntries(current.players.map(item =>
              [`player:${item.accountId}`, item.color ?? "#f7db76"])),
            markerShapes: { pickup: "diamond", terrain: "footprint" },
            enabledCategories: [...enabledCategories],
            anchorColor: player.color ?? "#58d6ff"
          });
          context.fillStyle = "#f4f1e8";
          context.font = "12px sans-serif";
          context.textAlign = "center";
          context.textBaseline = "top";
          context.fillText(
            `Enemies remaining: ${current.livingNpcCount ?? current.radar.markers.filter((marker) =>
              marker.category === "enemy").length}`,
            radarX,
            RADAR_Y + RADAR_RADIUS + 8
          );
        }
        points.textContent = `Score: ${observed?.hud.points ?? player.points}`;
        health.textContent = `Health: ${observed?.hud.health ?? player.health}`;
        const terrain = current.map.terrain;
        terrainCoverage.textContent = terrain
          ? `Terrain density ${terrain.density}: ${terrain.actualCoveragePercent.toFixed(2)}% coverage ` +
            `(target ${terrain.targetCoveragePercent}%)${terrain.budgetExhausted ? " - limited by safe routes/spawns" : ""}`
          : "";
        terrainCoverage.hidden = !terrain;
        levelSummary.hidden = current.phase !== "intermission";
        if (current.phase === "intermission") {
          levelTitle.textContent = `Level ${current.level} Complete`;
          const earned = current.levelStandings?.find(row => row.accountId === player.accountId)?.levelPoints;
          levelPoints.textContent = earned === undefined ? "" : `Points earned this level: ${earned}`;
          const seconds = Math.max(0, Math.ceil(
            ((current.intermissionEndsAtTick ?? current.tick) - current.tick) / 30
          ));
          nextLevel.textContent = `Level ${current.level + 1} starts in ${seconds}\u2026`;
        }
        const remaining = observed ? Math.ceil(observed.death.remainingSeconds)
          : Math.max(0, Math.ceil(((player.respawnAtTick ?? current.tick) - current.tick) / 30));
        life.textContent = current.phase === "complete" ? "Match complete."
          : !(observed?.death.alive ?? player.alive)
            ? (observed?.death.respawnBlocked ?? player.respawnBlocked)
              ? "Waiting for a safe respawn..." : `Respawning in ${remaining}s`
          : "";
        life.hidden = life.textContent === "";
        if (focused && player.alive && current.phase === "active" && current.viewerRole === "player" &&
            time - lastInputAt >= INPUT_INTERVAL_MS) {
          const direction = movement();
          const aim = aimPoint(player);
          lastInputAt = time;
          sending = true;
          host.dispatchInput({
            type: "combat",
            moveX: direction.x, moveY: direction.y,
            aimX: aim.x, aimY: aim.y,
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
        life.remove();
        terrainCoverage.remove();
        levelSummary.remove();
        help.remove();
        radarFilters.remove();
        options.remove();
        previous = undefined;
        current = undefined;
      }
    };
  }
});

function drawTerrain(
  context: CanvasRenderingContext2D,
  map: DefaultView["map"],
  camera: Readonly<{ x: number; y: number }>,
  width: number,
  height: number
): void {
  const origin = worldToScreen({ x: 0, y: 0 }, camera, width, height);
  context.fillStyle = "#233345";
  context.fillRect(origin.x, origin.y, map.width, map.height);

  for (const obstacle of map.obstacles) {
    for (let tileY = 0; tileY < obstacle.height; tileY += TERRAIN_TILE_SIZE) {
      for (let tileX = 0; tileX < obstacle.width; tileX += TERRAIN_TILE_SIZE) {
        const screen = worldToScreen({
          x: obstacle.x + tileX,
          y: obstacle.y + tileY
        }, camera, width, height);
        const tileWidth = Math.min(TERRAIN_TILE_SIZE, obstacle.width - tileX);
        const tileHeight = Math.min(TERRAIN_TILE_SIZE, obstacle.height - tileY);
        context.fillStyle = TERRAIN_TILE_COLORS[
          (Math.floor(obstacle.x / TERRAIN_TILE_SIZE) +
            Math.floor(obstacle.y / TERRAIN_TILE_SIZE) +
            tileX / TERRAIN_TILE_SIZE + tileY / TERRAIN_TILE_SIZE) %
          TERRAIN_TILE_COLORS.length
        ]!;
        context.fillRect(screen.x, screen.y, tileWidth, tileHeight);
        context.strokeStyle = TERRAIN_SEAM_COLOR;
        context.lineWidth = 1;
        context.strokeRect(
          screen.x + 0.5,
          screen.y + 0.5,
          Math.max(0, tileWidth - 1),
          Math.max(0, tileHeight - 1)
        );
        if (tileWidth >= 16 && tileHeight >= 16) {
          context.fillStyle = TERRAIN_PATTERN_COLOR;
          context.fillRect(screen.x + 6, screen.y + 6, 2, 2);
          context.fillRect(screen.x + 10, screen.y + 6, 2, 2);
          context.fillRect(screen.x + 6, screen.y + 10, 2, 2);
        }
      }
    }
    const topLeft = worldToScreen(obstacle, camera, width, height);
    context.strokeStyle = "#c0cad3";
    context.lineWidth = 1.5;
    context.strokeRect(
      topLeft.x + 0.5,
      topLeft.y + 0.5,
      Math.max(0, obstacle.width - 1),
      Math.max(0, obstacle.height - 1)
    );
  }
}

function drawPickup(
  context: CanvasRenderingContext2D,
  position: Readonly<{ x: number; y: number }>,
  radius: number,
  type: "health" | "rapid-fire" | "spread"
): void {
  context.fillStyle = type === "health" ? "#66df8a"
    : type === "rapid-fire" ? "#b892ff" : "#ffa64d";
  context.beginPath();
  context.moveTo(position.x, position.y - radius);
  context.lineTo(position.x + radius, position.y);
  context.lineTo(position.x, position.y + radius);
  context.lineTo(position.x - radius, position.y);
  context.closePath();
  context.fill();
  context.strokeStyle = "#f4f1e8";
  context.lineWidth = 1.5;
  context.stroke();

  const mark = radius * 0.45;
  context.beginPath();
  if (type === "health") {
    context.moveTo(position.x - mark, position.y);
    context.lineTo(position.x + mark, position.y);
    context.moveTo(position.x, position.y - mark);
    context.lineTo(position.x, position.y + mark);
  } else if (type === "rapid-fire") {
    for (const offset of [-mark / 2, 0, mark / 2]) {
      context.moveTo(position.x - mark, position.y + offset);
      context.lineTo(position.x + mark, position.y + offset);
    }
  } else {
    context.moveTo(position.x, position.y + mark);
    context.lineTo(position.x, position.y);
    context.moveTo(position.x, position.y);
    context.lineTo(position.x - mark, position.y - mark);
    context.moveTo(position.x, position.y);
    context.lineTo(position.x + mark, position.y - mark);
  }
  context.strokeStyle = "#263445";
  context.lineWidth = 1.5;
  context.stroke();
}
