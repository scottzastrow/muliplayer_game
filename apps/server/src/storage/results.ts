import { GameSettingsSchema } from "@multiplayer-game/protocol";
import type { SqliteDatabase } from "./database.js";

export type MatchResultStatus = "finished" | "abandoned" | "interrupted" | "failed";

export interface SubmittedStanding {
  readonly accountId: string;
  readonly points: number;
  readonly kills: number;
  readonly deaths: number;
}

export interface MatchResultInput {
  readonly matchId: string;
  readonly status: MatchResultStatus;
  readonly finalLevel: number;
  readonly standings?: readonly SubmittedStanding[];
  readonly completionReason?: string;
}

export interface MatchStanding extends SubmittedStanding {
  readonly username: string;
  readonly rank: number;
}

export interface StoredMatchResult {
  readonly matchId: string;
  readonly status: MatchResultStatus;
  readonly finalLevel: number;
  readonly standings: readonly MatchStanding[];
  readonly settings: unknown;
  readonly themeDigest: string;
  readonly finalizedAt: string;
  readonly completionReason?: string;
}

interface ParticipantRow {
  account_id: string;
  username: string;
  normalized_username: string;
}

export function finalizeMatchResult(
  database: SqliteDatabase,
  input: MatchResultInput,
  finalizedAt = new Date().toISOString()
): boolean {
  validateFinalization(input, finalizedAt);
  return database.transaction(() => {
    const match = database
      .prepare(
        `SELECT state, current_level, settings_json, theme_digest FROM matches
         WHERE id = ?`
      )
      .get(input.matchId) as
      | {
          state: string;
          current_level: number;
          settings_json: string;
          theme_digest: string;
        }
      | undefined;
    if (
      !match ||
      !["waiting", "running"].includes(match.state) ||
      (input.status === "finished" && match.state !== "running")
    ) {
      return false;
    }

    const existing = database
      .prepare("SELECT 1 FROM match_results WHERE match_id = ?")
      .get(input.matchId);
    if (existing) {
      return false;
    }

    const settings = parseSettings(match.settings_json);
    if (input.finalLevel > settings.maxLevels) {
      throw new RangeError("Final level exceeds the match's configured maximum.");
    }
    if (input.finalLevel !== match.current_level) {
      throw new RangeError("Final level does not match the persisted match progression.");
    }
    const standings =
      input.status === "finished"
        ? buildStandings(database, input.matchId, input.standings ?? [])
        : [];
    const updateParticipant = database.prepare(
      `UPDATE match_participants
       SET final_points = ?, final_kills = ?, final_deaths = ?, final_rank = ?
       WHERE match_id = ? AND account_id = ?`
    );
    for (const standing of standings) {
      updateParticipant.run(
        standing.points,
        standing.kills,
        standing.deaths,
        standing.rank,
        input.matchId,
        standing.accountId
      );
    }

    const inserted = database
      .prepare(
        `INSERT INTO match_results
         (match_id, status, final_level, standings_json, settings_summary_json, theme_digest, finalized_at, completion_reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.matchId,
        input.status,
        input.finalLevel,
        JSON.stringify(standings),
        match.settings_json,
        match.theme_digest,
        finalizedAt,
        input.completionReason ?? null
      );
    if (inserted.changes !== 1) {
      throw new Error("Match result was not inserted exactly once.");
    }
    const updated = database
      .prepare(
        `UPDATE matches SET state = ?, ended_at = ?
         WHERE id = ? AND state IN ('waiting', 'running')`
      )
      .run(input.status, finalizedAt, input.matchId);
    if (updated.changes !== 1) {
      throw new Error("Match lifecycle changed during result finalization.");
    }
    return true;
  }).immediate();
}

export function advanceMatchLevel(
  database: SqliteDatabase,
  matchId: string,
  expectedLevel: number,
  nextLevel: number
): boolean {
  if (
    !Number.isSafeInteger(expectedLevel) ||
    expectedLevel < 1 ||
    !Number.isSafeInteger(nextLevel) ||
    nextLevel !== expectedLevel + 1
  ) {
    throw new RangeError("Level advancement must increase the level by exactly one.");
  }
  return database.transaction(() => {
    const row = database
      .prepare("SELECT settings_json FROM matches WHERE id = ? AND state = 'running'")
      .get(matchId) as { settings_json: string } | undefined;
    if (!row) {
      return false;
    }
    const settings = parseSettings(row.settings_json);
    if (nextLevel > settings.maxLevels) {
      return false;
    }
    return (
      database
        .prepare(
          `UPDATE matches SET current_level = ?
           WHERE id = ? AND state = 'running' AND current_level = ?`
        )
        .run(nextLevel, matchId, expectedLevel).changes === 1
    );
  }).immediate();
}

export function getMatchResult(
  database: SqliteDatabase,
  matchId: string
): StoredMatchResult | undefined {
  const row = database
    .prepare(
      `SELECT match_id, status, final_level, standings_json, settings_summary_json,
              theme_digest, finalized_at, completion_reason
       FROM match_results WHERE match_id = ?`
    )
    .get(matchId) as
    | {
        match_id: string;
        status: MatchResultStatus;
        final_level: number;
        standings_json: string;
        settings_summary_json: string;
        theme_digest: string;
        finalized_at: string;
        completion_reason: string | null;
      }
    | undefined;
  if (!row) {
    return undefined;
  }
  return Object.freeze({
    matchId: row.match_id,
    status: row.status,
    finalLevel: row.final_level,
    standings: Object.freeze(JSON.parse(row.standings_json) as MatchStanding[]),
    settings: JSON.parse(row.settings_summary_json) as unknown,
    themeDigest: row.theme_digest,
    finalizedAt: row.finalized_at,
    ...(row.completion_reason === null ? {} : { completionReason: row.completion_reason })
  });
}

function buildStandings(
  database: SqliteDatabase,
  matchId: string,
  submitted: readonly SubmittedStanding[]
): MatchStanding[] {
  const participants = database
    .prepare(
      `SELECT p.account_id, a.username, a.normalized_username
       FROM match_participants p
       JOIN accounts a ON a.id = p.account_id
       WHERE p.match_id = ?`
    )
    .all(matchId) as ParticipantRow[];
  if (submitted.length !== participants.length) {
    throw new TypeError("Final standings must include every frozen match participant.");
  }
  const byAccount = new Map<string, SubmittedStanding>();
  for (const standing of submitted) {
    if (
      typeof standing.accountId !== "string" ||
      !Number.isSafeInteger(standing.points) ||
      standing.points < 0 ||
      !Number.isSafeInteger(standing.kills) ||
      standing.kills < 0 ||
      !Number.isSafeInteger(standing.deaths) ||
      standing.deaths < 0 ||
      byAccount.has(standing.accountId)
    ) {
      throw new TypeError("Final standing values must be unique nonnegative safe integers.");
    }
    byAccount.set(standing.accountId, standing);
  }
  const ordered = participants.map((participant) => {
    const submittedStanding = byAccount.get(participant.account_id);
    if (!submittedStanding) {
      throw new TypeError("Final standings contain an unknown or missing participant.");
    }
    return {
      ...submittedStanding,
      username: participant.username,
      normalizedUsername: participant.normalized_username
    };
  });
  ordered.sort(
    (left, right) =>
      right.points - left.points ||
      right.kills - left.kills ||
      left.deaths - right.deaths ||
      compareText(left.normalizedUsername, right.normalizedUsername)
  );
  return ordered.map(({ normalizedUsername: _normalized, ...standing }, index) => ({
    ...standing,
    rank: index + 1
  }));
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function parseSettings(input: string): ReturnType<typeof GameSettingsSchema.parse> {
  try {
    return GameSettingsSchema.parse(JSON.parse(input));
  } catch (error) {
    throw new Error("Stored match settings are invalid.", { cause: error });
  }
}

function validateFinalization(input: MatchResultInput, finalizedAt: string): void {
  if (
    typeof input.matchId !== "string" ||
    input.matchId.length === 0 ||
    !Number.isSafeInteger(input.finalLevel) ||
    input.finalLevel < 1 ||
    !["finished", "abandoned", "interrupted", "failed"].includes(input.status) ||
    Number.isNaN(Date.parse(finalizedAt))
  ) {
    throw new TypeError("Match finalization input is invalid.");
  }
  if (input.status === "finished" && !Array.isArray(input.standings)) {
    throw new TypeError("Finished matches require complete final standings.");
  }
  if (input.completionReason !== undefined &&
    (typeof input.completionReason !== "string" ||
      input.completionReason.length < 1 || input.completionReason.length > 128)) {
    throw new TypeError("Match completion reason must contain 1-128 characters.");
  }
}
