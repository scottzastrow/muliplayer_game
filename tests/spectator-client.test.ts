import { describe, expect, it } from "vitest";
import { FollowablePlayersSchema } from "../apps/client/src/spectate.js";

describe("spectator browser player lists", () => {
  it("validates bounded public targets and rejects malformed or oversized lists", () => {
    const player = { accountId: "00000000-0000-4000-8000-000000000001",
      username: "Alice", connected: true, life: "dead", followable: true };
    expect(FollowablePlayersSchema.parse([player])).toEqual([player]);
    expect(FollowablePlayersSchema.safeParse([{ ...player, accountId: "another-room" }]).success).toBe(false);
    expect(FollowablePlayersSchema.safeParse(Array.from({ length: 33 }, () => player)).success).toBe(false);
  });
});
