import { z } from "zod";
import { GameSettingsSchema } from "./settings.js";

export * from "./settings.js";

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema)
  ])
);

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export const RequestIdSchema = z.string().min(1).max(128);
export const UsernameSchema = z.string().min(3).max(24).regex(/^[A-Za-z0-9_]+$/);
export const AccountRoleSchema = z.enum(["player", "operator"]);

export const PublicAccountSchema = z
  .object({
    id: z.string().uuid(),
    username: UsernameSchema,
    role: AccountRoleSchema
  })
  .strict();

export type PublicAccount = z.infer<typeof PublicAccountSchema>;

export interface AccountRecord {
  id: string;
  username: string;
  role: "player" | "operator";
  passwordHash?: string;
  passwordSalt?: string;
  tokenDigest?: string;
}

export function serializePublicAccount(account: AccountRecord): PublicAccount {
  return PublicAccountSchema.parse({
    id: account.id,
    username: account.username,
    role: account.role
  });
}

export const SessionStatusSchema = z.enum([
  "waiting",
  "running",
  "finished",
  "abandoned",
  "interrupted",
  "failed"
]);

export const PublicSessionSummarySchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().min(1).max(91),
    creator: z.string().min(1).max(24),
    status: SessionStatusSchema,
    level: z.number().int().positive(),
    maxLevels: z.number().int().positive(),
    playerCount: z.number().int().nonnegative(),
    maxPlayers: z.number().int().positive(),
    spectatorCount: z.number().int().nonnegative(),
    maxSpectators: z.number().int().nonnegative(),
    themeName: z.string().min(1).max(64),
    themeRevision: z.string().min(1).max(128),
    settingsRevision: z.number().int().nonnegative(),
    canJoin: z.boolean(),
    canSpectate: z.boolean(),
    canRejoin: z.boolean(),
    canPlay: z.boolean()
  })
  .strict()
  .superRefine((summary, context) => {
    if (summary.level > summary.maxLevels) {
      context.addIssue({
        code: "custom",
        path: ["level"],
        message: "Current level cannot exceed the configured maximum."
      });
    }
    if (summary.playerCount > summary.maxPlayers) {
      context.addIssue({
        code: "custom",
        path: ["playerCount"],
        message: "Player count cannot exceed player capacity."
      });
    }
    if (summary.spectatorCount > summary.maxSpectators) {
      context.addIssue({
        code: "custom",
        path: ["spectatorCount"],
        message: "Spectator count cannot exceed spectator capacity."
      });
    }
  });

export type PublicSessionSummary = z.infer<typeof PublicSessionSummarySchema>;

const ResultCounterSchema = z.number().int().nonnegative().safe();
export const MatchResultSchema = z.object({
  matchId: z.string().uuid(),
  status: z.enum(["finished", "abandoned", "interrupted", "failed"]),
  finalLevel: z.number().int().positive(),
  standings: z.array(z.object({
    accountId: z.string().uuid(),
    username: UsernameSchema,
    rank: z.number().int().positive(),
    points: ResultCounterSchema,
    kills: ResultCounterSchema,
    deaths: ResultCounterSchema
  }).strict()).max(32),
  settings: GameSettingsSchema,
  themeDigest: z.string().regex(/^[a-f0-9]{64}$/),
  finalizedAt: z.iso.datetime()
}).strict().superRefine((result, context) => {
  if (result.finalLevel > result.settings.maxLevels) {
    context.addIssue({ code: "custom", message: "Final level does not match result settings." });
  }
  if (result.status !== "finished" && result.standings.length !== 0) {
    context.addIssue({ code: "custom", message: "Incomplete matches cannot declare final standings." });
  }
  if (result.status === "finished" && result.standings.length === 0) {
    context.addIssue({ code: "custom", message: "Finished matches require final standings." });
  }
  const accounts = new Set<string>();
  for (const [index, standing] of result.standings.entries()) {
    if (standing.rank !== index + 1 || accounts.has(standing.accountId)) {
      context.addIssue({ code: "custom", message: "Standings require unique accounts and ordered ranks." });
    }
    accounts.add(standing.accountId);
  }
});
export type MatchResult = z.infer<typeof MatchResultSchema>;
export const TerminalLifecycleSchema = z.object({
  status: z.enum(["finished", "abandoned", "interrupted", "failed"]),
  resultId: z.string().uuid()
}).strict();

export function serializePublicSessionSummary(
  summary: PublicSessionSummary
): PublicSessionSummary {
  return PublicSessionSummarySchema.parse({
    id: summary.id,
    name: summary.name,
    creator: summary.creator,
    status: summary.status,
    level: summary.level,
    maxLevels: summary.maxLevels,
    playerCount: summary.playerCount,
    maxPlayers: summary.maxPlayers,
    spectatorCount: summary.spectatorCount,
    maxSpectators: summary.maxSpectators,
    themeName: summary.themeName,
    themeRevision: summary.themeRevision,
    settingsRevision: summary.settingsRevision,
    canJoin: summary.canJoin,
    canSpectate: summary.canSpectate,
    canRejoin: summary.canRejoin,
    canPlay: summary.canPlay
  });
}

export const ErrorCodeSchema = z.enum([
  "BAD_REQUEST",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "SESSION_CAPACITY",
  "PLAYER_CAPACITY",
  "SPECTATOR_CAPACITY",
  "ALREADY_STARTED",
  "REVISION_CONFLICT",
  "REJOIN_EXPIRED",
  "USERNAME_TAKEN",
  "PAYLOAD_TOO_LARGE",
  "INVALID_SETTINGS",
  "INCOMPATIBLE_THEME",
  "RATE_LIMITED",
  "NOT_READY",
  "INTERNAL_ERROR"
]);

export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const ErrorResponseSchema = z
  .object({
    error: z
      .object({
        code: ErrorCodeSchema,
        message: z.string().min(1).max(512),
        requestId: RequestIdSchema,
        details: z.record(z.string(), JsonValueSchema).optional()
      })
      .strict()
  })
  .strict();

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

export const ClientInputPayloadSchema = z
  .object({
    sequence: z.number().int().nonnegative().safe(),
    action: JsonValueSchema
  })
  .strict();

export const ClientEnvelopeSchema = z.discriminatedUnion("type", [
  z
    .object({
      v: z.literal(1),
      type: z.literal("client.input"),
      requestId: RequestIdSchema.optional(),
      payload: ClientInputPayloadSchema
    })
    .strict(),
  z
    .object({
      v: z.literal(1),
      type: z.literal("client.spectate.target"),
      requestId: RequestIdSchema.optional(),
      payload: z
        .object({ targetAccountId: z.string().uuid() })
        .strict()
    })
    .strict(),
  z
    .object({
      v: z.literal(1),
      type: z.literal("client.ping"),
      requestId: RequestIdSchema.optional(),
      payload: z.object({ nonce: z.string().min(1).max(64) }).strict()
    })
    .strict()
]);

export type ClientEnvelope = z.infer<typeof ClientEnvelopeSchema>;

const ServerMessageTypes = [
  "server.hello",
  "server.snapshot",
  "server.event",
  "server.spectate.target",
  "server.roster",
  "server.lifecycle",
  "server.pong",
  "server.error"
] as const;

export const ServerEnvelopeSchema = z
  .discriminatedUnion("type", [
    z
      .object({
        v: z.literal(1),
        type: z.literal("server.error"),
        requestId: RequestIdSchema.optional(),
        sessionId: z.string().uuid().optional(),
        tick: z.number().int().nonnegative().optional(),
        serverTimeMs: z.number().finite().nonnegative().optional(),
        payload: z
          .object({
            code: ErrorCodeSchema,
            message: z.string().min(1).max(512),
            requestId: RequestIdSchema,
            fatal: z.boolean()
          })
          .strict()
      })
      .strict(),
    z
      .object({
        v: z.literal(1),
        type: z.enum(ServerMessageTypes.filter((type) => type !== "server.error")),
        requestId: RequestIdSchema.optional(),
        sessionId: z.string().uuid().optional(),
        tick: z.number().int().nonnegative().optional(),
        serverTimeMs: z.number().finite().nonnegative().optional(),
        payload: z.record(z.string(), JsonValueSchema)
      })
      .strict()
  ]);

export type ServerEnvelope = z.infer<typeof ServerEnvelopeSchema>;

export const HttpErrorCodeByStatus = Object.freeze({
  400: "BAD_REQUEST",
  401: "UNAUTHENTICATED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "REVISION_CONFLICT",
  413: "PAYLOAD_TOO_LARGE",
  422: "INVALID_SETTINGS",
  429: "RATE_LIMITED",
  503: "NOT_READY"
} as const);
