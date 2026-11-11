import { sampleMap } from "./map.js";

export const sampleSkinFactory = Object.freeze({
  metadata: Object.freeze({
    id: "sample-grid-runner-skin",
    version: "1.0.0",
    acceptedModuleId: "sample-grid-runner",
    acceptedStateSchemaVersions: Object.freeze([1])
  }),

  mount(host) {
    const worldSlot = host.slots.get("world");
    const hudSlot = host.slots.get("hud");
    const controlsSlot = host.slots.get("controls");
    if (!worldSlot || !hudSlot || !controlsSlot) {
      throw new Error("The sample skin requires world, hud and controls slots.");
    }

    const world = document.createElement("section");
    world.dataset.testid = "sample-world";
    const arena = document.createElement("div");
    arena.setAttribute("role", "img");
    arena.setAttribute("aria-label", `${sampleMap.name} game map`);
    Object.assign(arena.style, {
      position: "relative",
      width: `${sampleMap.bounds.width * 2}px`,
      height: `${sampleMap.bounds.height * 2}px`,
      overflow: "hidden",
      border: "1px solid #263238",
      background: "#eef4f7"
    });
    const mapObjects = new Map(sampleMap.objects.map(object => [object.id, object]));
    const walls = [];
    for (const collision of sampleMap.collisions) {
      const object = mapObjects.get(collision.objectId);
      if (!object) throw new Error(`Missing sample map object ${collision.objectId}.`);
      const wall = document.createElement("div");
      wall.setAttribute("aria-hidden", "true");
      Object.assign(wall.style, {
        position: "absolute",
        left: `${(object.position.x - collision.shape.width / 2) * 2}px`,
        top: `${(object.position.y - collision.shape.height / 2) * 2}px`,
        width: `${collision.shape.width * 2}px`,
        height: `${collision.shape.height * 2}px`,
        background: "#52616b"
      });
      arena.append(wall);
      walls.push(wall);
    }
    const playerToken = document.createElement("div");
    playerToken.dataset.testid = "sample-player";
    playerToken.setAttribute("aria-hidden", "true");
    Object.assign(playerToken.style, {
      position: "absolute",
      width: "16px",
      height: "16px",
      borderRadius: "50%",
      background: "#087f5b",
      border: "2px solid white",
      boxSizing: "border-box"
    });
    arena.append(playerToken);
    const position = document.createElement("output");
    position.dataset.testid = "sample-position";
    const hud = document.createElement("output");
    hud.dataset.testid = "sample-hud";
    const buttons = [];
    for (const input of [
      { label: "Move west", x: -1, y: 0 },
      { label: "Move east", x: 1, y: 0 },
      { label: "Stop", x: 0, y: 0 }
    ]) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = input.label;
      const listener = () => host.dispatchInput({ type: "move", x: input.x, y: input.y });
      button.addEventListener("click", listener);
      buttons.push({ button, listener });
      controlsSlot.append(button);
    }
    world.append(arena, position);
    worldSlot.append(world);
    hudSlot.append(hud);
    let current;
    let disposed = false;

    return {
      handleSnapshot(snapshot) {
        if (disposed) return;
        current = snapshot;
      },
      handleEvents() {},
      render() {
        if (disposed || !current) return;
        const player = current.players.find(({ accountId }) =>
          accountId === current.viewerAccountId);
        if (!player) throw new Error("The sample snapshot is missing its viewer.");
        playerToken.style.left = `${player.position.x * 2 - 8}px`;
        playerToken.style.top = `${player.position.y * 2 - 8}px`;
        position.textContent = `Position ${player.position.x}, ${player.position.y}`;
        hud.textContent = `${player.username}: ${player.points} points · tick ${current.tick}`;
      },
      handleViewport() {},
      dispose() {
        if (disposed) return;
        disposed = true;
        for (const { button, listener } of buttons) {
          button.removeEventListener("click", listener);
        }
        for (const wall of walls) wall.remove();
        world.remove();
        hud.remove();
        for (const { button } of buttons) button.remove();
        current = undefined;
      }
    };
  }
});
