import { z } from "zod";

export const DefaultCombatActionSchema = z
  .object({
    type: z.literal("combat"),
    controlMode: z.enum(["keyboard-only", "keyboard-mouse", "first-person"]).optional(),
    moveX: z.number().finite().min(-1).max(1),
    moveY: z.number().finite().min(-1).max(1),
    aimX: z.number().finite(),
    aimY: z.number().finite(),
    fire: z.boolean()
  })
  .strict();

export const DefaultUnlockActionSchema = z
  .object({
    type: z.literal("unlock"),
    targetId: z.string().min(1).max(128)
  })
  .strict();

export const DefaultPlayerActionSchema = z.discriminatedUnion("type", [
  DefaultCombatActionSchema,
  DefaultUnlockActionSchema
]);

export type DefaultCombatAction = z.infer<typeof DefaultCombatActionSchema>;
export type DefaultUnlockAction = z.infer<typeof DefaultUnlockActionSchema>;
export type DefaultPlayerAction = z.infer<typeof DefaultPlayerActionSchema>;
