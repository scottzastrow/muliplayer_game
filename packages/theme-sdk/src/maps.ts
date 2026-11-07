import { z } from "zod";
import { JsonValueSchema } from "@multiplayer-game/protocol";

export const MAP_CELL_SIZE = 32;
export const MAX_MAP_DIMENSION = 2_048;
export const MAX_MAP_OBJECTS = 4_096;
export const MAX_MAP_COLLISIONS = 4_096;
export const MAX_MAP_SPAWNS = 256;

const IdentifierSchema = z.string().regex(/^[a-z0-9][a-z0-9._:-]{0,127}$/);
const PositionSchema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite()
  })
  .strict();

export const MapObjectSchema = z
  .object({
    id: IdentifierSchema,
    typeId: IdentifierSchema,
    position: PositionSchema,
    tags: z.array(IdentifierSchema).max(32).optional(),
    properties: z.record(z.string(), JsonValueSchema).optional()
  })
  .strict();

export const MapCollisionSchema = z
  .object({
    id: IdentifierSchema,
    objectId: IdentifierSchema,
    shape: z
      .object({
        type: z.literal("rect"),
        width: z.number().finite().positive(),
        height: z.number().finite().positive()
      })
      .strict()
  })
  .strict();

export const MapSpawnSchema = z
  .object({
    id: IdentifierSchema,
    kind: z.enum(["player", "npc", "pickup"]),
    position: PositionSchema,
    radius: z.number().finite().min(0).max(MAP_CELL_SIZE / 2)
  })
  .strict();

export const MapDefinitionSchema = z
  .object({
    formatVersion: z.literal(1),
    id: IdentifierSchema,
    name: z.string().min(1).max(64),
    bounds: z
      .object({
        width: z.number().int().min(MAP_CELL_SIZE * 2).max(MAX_MAP_DIMENSION),
        height: z.number().int().min(MAP_CELL_SIZE * 2).max(MAX_MAP_DIMENSION)
      })
      .strict(),
    cellSize: z.literal(MAP_CELL_SIZE),
    objects: z.array(MapObjectSchema).max(MAX_MAP_OBJECTS),
    collisions: z.array(MapCollisionSchema).max(MAX_MAP_COLLISIONS),
    spawns: z.array(MapSpawnSchema).min(2).max(MAX_MAP_SPAWNS)
  })
  .strict()
  .superRefine((definition, context) => {
    if (
      definition.bounds.width % definition.cellSize !== 0 ||
      definition.bounds.height % definition.cellSize !== 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["bounds"],
        message: "Map dimensions must be multiples of the navigation cell size."
      });
    }

    const objects = new Map<string, z.infer<typeof MapObjectSchema>>();
    for (const [index, object] of definition.objects.entries()) {
      if (objects.has(object.id)) {
        context.addIssue({
          code: "custom",
          path: ["objects", index, "id"],
          message: `Map object ID ${object.id} is not unique.`
        });
      } else {
        objects.set(object.id, object);
      }
      if (
        object.position.x < 0 ||
        object.position.y < 0 ||
        object.position.x > definition.bounds.width ||
        object.position.y > definition.bounds.height
      ) {
        context.addIssue({
          code: "custom",
          path: ["objects", index, "position"],
          message: "Map objects must be positioned inside the map bounds."
        });
      }
      if (object.tags && new Set(object.tags).size !== object.tags.length) {
        context.addIssue({
          code: "custom",
          path: ["objects", index, "tags"],
          message: "Map object tags must be unique."
        });
      }
    }

    const collisionIds = new Set<string>();
    const collisionObjects = new Set<string>();
    for (const [index, collision] of definition.collisions.entries()) {
      if (collisionIds.has(collision.id)) {
        context.addIssue({
          code: "custom",
          path: ["collisions", index, "id"],
          message: `Map collision ID ${collision.id} is not unique.`
        });
      }
      collisionIds.add(collision.id);
      if (collisionObjects.has(collision.objectId)) {
        context.addIssue({
          code: "custom",
          path: ["collisions", index, "objectId"],
          message: `Map object ${collision.objectId} has more than one collision definition.`
        });
      }
      collisionObjects.add(collision.objectId);
      const object = objects.get(collision.objectId);
      if (!object) {
        context.addIssue({
          code: "custom",
          path: ["collisions", index, "objectId"],
          message: `Map collision references missing object ${collision.objectId}.`
        });
        continue;
      }
      const { width, height } = collision.shape;
      if (width % definition.cellSize !== 0 || height % definition.cellSize !== 0) {
        context.addIssue({
          code: "custom",
          path: ["collisions", index, "shape"],
          message: "Collision dimensions must be multiples of the navigation cell size."
        });
      }
      if (
        object.position.x - width / 2 < 0 ||
        object.position.y - height / 2 < 0 ||
        object.position.x + width / 2 > definition.bounds.width ||
        object.position.y + height / 2 > definition.bounds.height
      ) {
        context.addIssue({
          code: "custom",
          path: ["collisions", index, "shape"],
          message: "Collision geometry must be inside the map bounds."
        });
      }
    }

    const spawnIds = new Set<string>();
    const playerSpawns = definition.spawns.filter((spawn) => spawn.kind === "player");
    if (playerSpawns.length < 2) {
      context.addIssue({
        code: "custom",
        path: ["spawns"],
        message: "A multiplayer map must define at least two player spawns."
      });
    }
    for (const [index, spawn] of definition.spawns.entries()) {
      if (spawnIds.has(spawn.id)) {
        context.addIssue({
          code: "custom",
          path: ["spawns", index, "id"],
          message: `Map spawn ID ${spawn.id} is not unique.`
        });
      }
      spawnIds.add(spawn.id);
      const { x, y } = spawn.position;
      if (
        x - spawn.radius < 0 ||
        y - spawn.radius < 0 ||
        x + spawn.radius > definition.bounds.width ||
        y + spawn.radius > definition.bounds.height
      ) {
        context.addIssue({
          code: "custom",
          path: ["spawns", index],
          message: "Map spawns must fit inside the map bounds."
        });
      }
      if (
        (x - definition.cellSize / 2) % definition.cellSize !== 0 ||
        (y - definition.cellSize / 2) % definition.cellSize !== 0
      ) {
        context.addIssue({
          code: "custom",
          path: ["spawns", index, "position"],
          message: "Map spawns must be centered on navigation cells."
        });
      }
    }
  });

export type MapObject = z.infer<typeof MapObjectSchema>;
export type MapCollision = z.infer<typeof MapCollisionSchema>;
export type MapSpawn = z.infer<typeof MapSpawnSchema>;
export type MapDefinition = z.infer<typeof MapDefinitionSchema>;

export function validateMapDefinition(input: unknown): MapDefinition {
  return deepFreeze(MapDefinitionSchema.parse(input));
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}
