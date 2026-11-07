import { describe, expect, it } from "vitest";
import {
  ClientEnvelopeSchema,
  DEFAULT_GAME_SETTINGS,
  calculateLevelDifficulty,
  ErrorResponseSchema,
  GameSettingsSchema,
  ServerEnvelopeSchema,
  serializePublicAccount,
  serializePublicSessionSummary,
  validateMatchCapacity
} from "../packages/protocol/src/index.js";
import { CapacityValidationError } from "../packages/protocol/src/settings.js";
import { DefaultPlayerActionSchema } from "../themes/default/module/actions.js";

describe("protocol v1 validation", () => {
  it("accepts defaults and rejects unknown, nonfinite, and out-of-range settings", () => {
    expect(GameSettingsSchema.parse(DEFAULT_GAME_SETTINGS)).toEqual(DEFAULT_GAME_SETTINGS);
    expect(
      GameSettingsSchema.safeParse({ ...DEFAULT_GAME_SETTINGS, unexpected: true }).success
    ).toBe(false);
    expect(
      GameSettingsSchema.safeParse({
        ...DEFAULT_GAME_SETTINGS,
        npcHealthGrowthPercent: Number.NaN
      }).success
    ).toBe(false);
  });

  it("validates client envelopes strictly", () => {
    const valid = {
      v: 1,
      type: "client.input",
      payload: {
        sequence: 1,
        action: {
          type: "combat",
          moveX: 0.5,
          moveY: -1,
          aimX: 200,
          aimY: 400,
          fire: false
        }
      }
    };
    expect(ClientEnvelopeSchema.parse(valid)).toEqual(valid);
    expect(
      ClientEnvelopeSchema.safeParse({
        ...valid,
        forgedRole: "operator"
      }).success
    ).toBe(false);
    expect(
      ClientEnvelopeSchema.safeParse({
        ...valid,
        payload: { ...valid.payload, position: { x: 0, y: 0 } }
      }).success
    ).toBe(false);
  });

  it("passes noncombat module actions without combat fields through the shared envelope", () => {
    const unlockEnvelope = {
      v: 1,
      type: "client.input",
      payload: {
        sequence: 2,
        action: { type: "unlock", targetId: "door-1" }
      }
    };

    expect(ClientEnvelopeSchema.parse(unlockEnvelope)).toEqual(unlockEnvelope);
    expect(DefaultPlayerActionSchema.parse(unlockEnvelope.payload.action)).toEqual(
      unlockEnvelope.payload.action
    );
    expect(
      DefaultPlayerActionSchema.safeParse({
        type: "unlock",
        targetId: "door-1",
        fire: true
      }).success
    ).toBe(false);
    expect(
      ClientEnvelopeSchema.safeParse({
        ...unlockEnvelope,
        payload: {
          ...unlockEnvelope.payload,
          action: { type: "unlock", targetId: "door-1", fire: true }
        }
      }).success
    ).toBe(true);
  });

  it("validates server error payloads and versioned envelope metadata", () => {
    const errorEnvelope = {
      v: 1,
      type: "server.error",
      payload: {
        code: "BAD_REQUEST",
        message: "Invalid input.",
        requestId: "request-1",
        fatal: false
      }
    };
    expect(ServerEnvelopeSchema.parse(errorEnvelope)).toEqual(errorEnvelope);
    expect(
      ServerEnvelopeSchema.safeParse({
        ...errorEnvelope,
        payload: { ...errorEnvelope.payload, password: "secret" }
      }).success
    ).toBe(false);
    expect(
      ServerEnvelopeSchema.safeParse({
        v: 1,
        type: "server.pong",
        serverTimeMs: Number.POSITIVE_INFINITY,
        payload: {}
      }).success
    ).toBe(false);
  });

  it("serializes only public account and session fields", () => {
    const account = serializePublicAccount({
      id: "c791c3be-bf33-4a63-a8bf-80ca3dd922f9",
      username: "Alice_1",
      role: "player",
      passwordHash: "private-hash",
      passwordSalt: "private-salt",
      tokenDigest: "private-token"
    });
    expect(account).toEqual({
      id: "c791c3be-bf33-4a63-a8bf-80ca3dd922f9",
      username: "Alice_1",
      role: "player"
    });
    expect(JSON.stringify(account)).not.toMatch(/private/);

    const source = {
      id: "c791c3be-bf33-4a63-a8bf-80ca3dd922f9",
      name: "Room",
      creator: "Alice",
      status: "waiting" as const,
      level: 1,
      maxLevels: 5,
      playerCount: 1,
      maxPlayers: 4,
      spectatorCount: 0,
      maxSpectators: 8,
      themeName: "Default",
      themeRevision: "default@1.0.0",
      settingsRevision: 0,
      canJoin: true,
      canSpectate: true,
      canRejoin: false,
      canPlay: false,
      tokenDigest: "private-token"
    };
    const session = serializePublicSessionSummary(source);
    expect(session).not.toHaveProperty("tokenDigest");
    expect(session.playerCount).toBe(1);
  });

  it("checks level growth against configured entity and health ceilings", () => {
    expect(() => validateMatchCapacity(DEFAULT_GAME_SETTINGS, 4)).not.toThrow();
    expect(() =>
      validateMatchCapacity(
        { ...DEFAULT_GAME_SETTINGS, maxLevels: 100 },
        4,
        { maxNpcsPerSession: 2_000, maxNpcHealth: 1_000_000 }
      )
    ).toThrow(CapacityValidationError);
  });

  it("calculates roster-frozen level difficulty and rejects growth before overflow", () => {
    const settings = { ...DEFAULT_GAME_SETTINGS, initialNpcsPerPlayer: 3, maxLevels: 3 };
    expect(calculateLevelDifficulty(settings, 2, 1)).toEqual({
      npcCount: 6,
      npcHealth: 100
    });
    expect(calculateLevelDifficulty(settings, 2, 3)).toEqual({
      npcCount: 9,
      npcHealth: 121
    });
    expect(() =>
      validateMatchCapacity({ ...settings, maxPlayers: 32, maxLevels: 100 }, 32)
    ).toThrow(CapacityValidationError);
  });

  it("rejects malformed or secret-bearing error envelopes", () => {
    const response = {
      error: { code: "BAD_REQUEST", message: "Invalid request.", requestId: "request-1" }
    };
    expect(ErrorResponseSchema.parse(response)).toEqual(response);
    expect(ErrorResponseSchema.safeParse({ ...response, stack: "private" }).success).toBe(false);
  });
});
