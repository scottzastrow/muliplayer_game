import { describe, expect, it } from "vitest";
import { DEFAULT_GAME_SETTINGS, MatchResultSchema, TerminalLifecycleSchema } from "@multiplayer-game/protocol";
import { resultIdFromHash } from "../apps/client/src/results.js";

const matchId = "00000000-0000-4000-8000-000000000001";
const accountId = "00000000-0000-4000-8000-000000000002";
const result = {
  matchId, status: "finished", finalLevel: 1,
  standings: [{ accountId, username: "Alice", rank: 1, points: 100, kills: 1, deaths: 0 }],
  settings: { ...DEFAULT_GAME_SETTINGS, maxLevels: 1 },
  themeDigest: "a".repeat(64), finalizedAt: "2026-11-06T22:00:00.000Z"
};

describe("saved-result public contract", () => {
  it("preserves saved ranks and complete public standings without credentials", () => {
    expect(MatchResultSchema.parse(result)).toEqual(result);
    expect(MatchResultSchema.safeParse({ ...result, passwordHash: "not-public" }).success).toBe(false);
  });
  it("rejects missing scores, duplicate accounts, unordered ranks and invalid completion", () => {
    expect(MatchResultSchema.safeParse({ ...result, standings: [] }).success).toBe(false);
    expect(MatchResultSchema.safeParse({
      ...result, standings: [result.standings[0], { ...result.standings[0], rank: 2 }]
    }).success).toBe(false);
    expect(MatchResultSchema.safeParse({
      ...result, standings: [{ ...result.standings[0], rank: 2 }]
    }).success).toBe(false);
    expect(MatchResultSchema.safeParse({ ...result, finalLevel: 2 }).success).toBe(false);
  });
  it("labels unfinished matches honestly instead of providing fabricated scores", () => {
    expect(MatchResultSchema.safeParse({ ...result, status: "interrupted", standings: [] }).success).toBe(true);
    expect(MatchResultSchema.safeParse({ ...result, status: "interrupted" }).success).toBe(false);
  });
  it("supports a stable reload URL and validates saved-result notifications", () => {
    expect(resultIdFromHash(`#results/${matchId}`)).toBe(matchId);
    expect(resultIdFromHash("#results/not-an-id")).toBeUndefined();
    expect(resultIdFromHash(`#results/${matchId}/extra`)).toBeUndefined();
    expect(TerminalLifecycleSchema.parse({ resultId: matchId, status: "finished" }))
      .toEqual({ resultId: matchId, status: "finished" });
    expect(TerminalLifecycleSchema.safeParse({ resultId: matchId, status: "running" }).success).toBe(false);
  });
});
