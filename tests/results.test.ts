import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_GAME_SETTINGS,
  type GameSettings
} from "@multiplayer-game/protocol";
import { LobbyRegistry } from "../apps/server/src/lobby/registry.js";
import { openDatabase, runMigrations } from "../apps/server/src/storage/database.js";
import {
  advanceMatchLevel,
  finalizeMatchResult,
  getMatchResult
} from "../apps/server/src/storage/results.js";

let database: ReturnType<typeof openDatabase> | undefined;

describe("persistent match progression and results", () => {
  afterEach(() => {
    if (database?.open) {
      database.close();
    }
    database = undefined;
  });

  it("advances exactly one configured level with compare-and-set semantics", () => {
    const matchId = createRunningMatch();
    expect(advanceMatchLevel(database!, matchId, 1, 2)).toBe(true);
    expect(advanceMatchLevel(database!, matchId, 1, 2)).toBe(false);
    expect(advanceMatchLevel(database!, matchId, 2, 3)).toBe(true);
    expect(advanceMatchLevel(database!, matchId, 3, 4)).toBe(true);
    expect(advanceMatchLevel(database!, matchId, 4, 5)).toBe(true);
    expect(advanceMatchLevel(database!, matchId, 5, 6)).toBe(false);
    expect(
      (database!.prepare("SELECT current_level FROM matches WHERE id = ?").get(matchId) as {
        current_level: number;
      }).current_level
      ).toBe(5);
  });

  it("persists ranked standings and finalizes duplicate completion requests once", () => {
    const matchId = createRunningMatch(2, 3);
    const standings = [
      { accountId: "account-b", points: 100, kills: 1, deaths: 0 },
      { accountId: "account-a", points: 100, kills: 1, deaths: 0 }
    ];
    const registry = new LobbyRegistry(database!, () => Date.parse("2026-11-06T22:00:00Z"));
    expect(advanceMatchLevel(database!, matchId, 1, 2)).toBe(true);
    expect(advanceMatchLevel(database!, matchId, 2, 3)).toBe(true);

    expect(registry.finalizeFinishedMatch(matchId, 3, standings)).toBe(true);
    expect(registry.finalizeFinishedMatch(matchId, 3, standings)).toBe(false);
    expect(
      (database!.prepare("SELECT state FROM matches WHERE id = ?").get(matchId) as {
        state: string;
      }).state
    ).toBe("finished");
    expect(
      (database!.prepare("SELECT COUNT(*) AS count FROM match_results WHERE match_id = ?")
        .get(matchId) as { count: number }).count
    ).toBe(1);
    expect(
      database!.prepare(
        `SELECT account_id, final_points, final_kills, final_deaths, final_rank
         FROM match_participants WHERE match_id = ? ORDER BY final_rank`
      ).all(matchId)
    ).toEqual([
      { account_id: "account-a", final_points: 100, final_kills: 1, final_deaths: 0, final_rank: 1 },
      { account_id: "account-b", final_points: 100, final_kills: 1, final_deaths: 0, final_rank: 2 }
    ]);
    expect(getMatchResult(database!, matchId)).toMatchObject({
      matchId,
      status: "finished",
      finalLevel: 3,
      standings: [
        { accountId: "account-a", username: "Alice", rank: 1 },
        { accountId: "account-b", username: "Bob", rank: 2 }
      ],
      settings: { ...DEFAULT_GAME_SETTINGS, maxLevels: 3 }
    });
  });

  it("rolls back invalid standings without marking a match finished", () => {
    const matchId = createRunningMatch(1, 1);
    expect(() =>
      finalizeMatchResult(database!, {
        matchId,
        status: "finished",
        finalLevel: 1,
        standings: [{ accountId: "account-a", points: Number.MAX_SAFE_INTEGER + 1, kills: 0, deaths: 0 }]
      })
    ).toThrow("Final standing values");
    expect(
      (database!.prepare("SELECT state FROM matches WHERE id = ?").get(matchId) as {
        state: string;
      }).state
    ).toBe("running");
    expect(getMatchResult(database!, matchId)).toBeUndefined();
  });

  it("orders score ties by kills, deaths, then normalized username", () => {
    const matchId = createRunningMatch(2, 1);
    database!.prepare(
      `INSERT INTO accounts
       (id, username, normalized_username, password_hash, password_salt, role, created_at)
       VALUES (?, ?, ?, 'test-hash', 'test-salt', 'player', '2026-11-06T00:00:00Z')`
    ).run("account-c", "Charlie", "charlie");
    database!.prepare(
      "INSERT INTO match_participants(match_id, account_id, joined_order) VALUES (?, ?, 2)"
    ).run(matchId, "account-c");
    expect(finalizeMatchResult(database!, {
      matchId, status: "finished", finalLevel: 1,
      standings: [
        { accountId: "account-a", points: 100, kills: 1, deaths: 0 },
        { accountId: "account-b", points: 100, kills: 2, deaths: 1 },
        { accountId: "account-c", points: 100, kills: 2, deaths: 0 }
      ]
    })).toBe(true);
    expect(getMatchResult(database!, matchId)?.standings.map((item) => item.username))
      .toEqual(["Charlie", "Bob", "Alice"]);
  });

  it("rejects completion before the configured maximum level", () => {
    const matchId = createRunningMatch();
    expect(() =>
      finalizeMatchResult(database!, {
        matchId,
        status: "finished",
        finalLevel: 1,
        standings: [{ accountId: "account-a", points: 0, kills: 0, deaths: 0 }]
      })
    ).toThrow("configured maximum level");
    expect(
      (database!.prepare("SELECT state FROM matches WHERE id = ?").get(matchId) as {
        state: string;
      }).state
    ).toBe("running");
    expect(getMatchResult(database!, matchId)).toBeUndefined();
  });
});

function createRunningMatch(participantCount = 1, maxLevels = 5): string {
  if (database?.open) {
    database.close();
  }
  database = openDatabase(":memory:");
  runMigrations(database);
  const addAccount = database.prepare(
    `INSERT INTO accounts
     (id, username, normalized_username, password_hash, password_salt, role, created_at)
     VALUES (?, ?, ?, 'test-hash', 'test-salt', 'player', '2026-11-06T00:00:00Z')`
  );
  addAccount.run("account-a", "Alice", "alice");
  if (participantCount > 1) {
    addAccount.run("account-b", "Bob", "bob");
  }
  const settings: GameSettings = { ...DEFAULT_GAME_SETTINGS, maxLevels };
  const matchId = "match-results-test";
  database
    .prepare(
      `INSERT INTO matches
       (id, creator_account_id, state, settings_json, theme_digest, seed, current_level, created_at)
       VALUES (?, 'account-a', 'running', ?, ?, 1, 1, '2026-11-06T00:00:00Z')`
    )
    .run(matchId, JSON.stringify(settings), "a".repeat(64));
  const addParticipant = database.prepare(
    "INSERT INTO match_participants(match_id, account_id, joined_order) VALUES (?, ?, ?)"
  );
  addParticipant.run(matchId, "account-a", 0);
  if (participantCount > 1) {
    addParticipant.run(matchId, "account-b", 1);
  }
  return matchId;
}
