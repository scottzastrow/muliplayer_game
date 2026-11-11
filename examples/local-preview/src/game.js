import { sampleMap } from "./map.js";

const SPEED_MULTIPLIER = 1;

export const sampleGameModule = Object.freeze({
  metadata: Object.freeze({
    id: "sample-grid-runner",
    version: "1.0.0",
    stateSchemaVersion: 1
  }),

  validateSettings(settings) {
    return typeof settings === "object" && settings !== null &&
      Number.isFinite(settings.moveDistance) && settings.moveDistance > 0 &&
      settings.moveDistance <= 32;
  },

  create(context, settings, roster) {
    const movement = new Map(roster.map(player => [player.accountId, { x: 0, y: 0 }]));
    let tick = 0;

    return {
      stateSchemaVersion: 1,
      get state() {
        return { tick };
      },
      initialize() {
        const playerSpawns = sampleMap.spawns.filter(spawn => spawn.kind === "player");
        for (const [index, player] of roster.entries()) {
          const spawn = playerSpawns[index % playerSpawns.length].position;
          context.entities.add({
            id: `player:${player.accountId}`,
            typeId: "sample-player",
            position: spawn,
            radius: 8,
            state: { kind: "player", accountId: player.accountId, username: player.username, points: 0 }
          });
        }
      },
      validateInput(input) {
        return typeof input === "object" && input !== null &&
          input.type === "move" &&
          [-1, 0, 1].includes(input.x) &&
          [-1, 0, 1].includes(input.y);
      },
      applyInput(accountId, input) {
        movement.set(accountId, { x: input.x, y: input.y });
      },
      setPlayerPresence() {},
      step(_dtSeconds, nextTick) {
        tick = nextTick;
        for (const player of context.entities.values()) {
          if (player.state.kind !== "player") continue;
          const input = movement.get(player.state.accountId);
          if (!input) continue;
          const distance = settings.moveDistance * SPEED_MULTIPLIER;
          const position = context.geometry.moveCircle(
            player.position,
            { x: input.x * distance, y: input.y * distance },
            player.radius
          );
          context.entities.update(player.id, current => ({
            ...current,
            position,
            state: {
              ...current.state,
              points: current.state.points + (position.x !== player.position.x ||
                position.y !== player.position.y ? 1 : 0)
            }
          }));
        }
      },
      snapshot(viewer) {
        const players = context.entities.values()
          .filter(entity => entity.state.kind === "player")
          .map(entity => ({
            accountId: entity.state.accountId,
            username: entity.state.username,
            position: entity.position,
            points: entity.state.points
          }));
        return {
          tick,
          viewerAccountId: viewer.accountId,
          viewerRole: viewer.role,
          players,
          map: {
            width: sampleMap.bounds.width,
            height: sampleMap.bounds.height,
            obstacles: sampleMap.collisions.map(collision => {
              const object = sampleMap.objects.find(({ id }) => id === collision.objectId);
              return {
                x: object.position.x - collision.shape.width / 2,
                y: object.position.y - collision.shape.height / 2,
                width: collision.shape.width,
                height: collision.shape.height
              };
            })
          }
        };
      },
      results() {
        return { tick };
      },
      dispose() {
        movement.clear();
      }
    };
  }
});
