# Data Model

## Persistent records

| Entity | Fields and constraints | Relationships |
| --- | --- | --- |
| Account | UUID id; display username 3–24 ASCII letters/digits/underscore; normalized username lowercased UNIQUE; password 9–128 characters at signup; salted scrypt hash/parameters; role player/operator; createdAt | Owns login sessions, game memberships, results |
| AuthSession | token digest UNIQUE; accountId; createdAt; expiresAt; revokedAt nullable; absolute lifetime 7 days | Account FK, delete cascades |
| ThemeRevision | themeId; version; name 1–64 characters; moduleId/version; rendererId/version; engineApiMajor=1; SHA-256 digest; immutable assetRoot; enabled; createdAt; UNIQUE(themeId,version) | Matches pin exact digest |
| Match | UUID id; creatorAccountId; generated display name (`<theme display name> — <creator username>`); state waiting/running/finished/abandoned/interrupted/failed; settings JSON validated on creation; themeDigest; startedAt/endedAt nullable; seed | Results/membership reference match |
| MatchParticipant | matchId/accountId composite UNIQUE; joinedOrder; final points/kills/deaths nonnegative integers; finalRank nullable | Roster reservation and final result identity |
| MatchResult | matchId UNIQUE; terminal status; final level; immutable standings/settings/theme summary; finalizedAt | One idempotent result per match |

Never expose hashes, token digests or operator internals in public serializers.
Passwords are not logged. Bind auth using account ID, not display username.
Use a transaction for match/result finalization and roster freeze. Persist significant
lifecycle transitions and terminal scores; live score/position survival across crashes
is outside scope. Failed/interrupted results may lack final scores and must say so.

## Live state

| Entity | Fields | Rules |
| --- | --- | --- |
| SessionRegistry | session map; reserved slot IDs; creation sequence | Maximum five waiting/running/reserved; synchronous allocate/release |
| Runner | matchId; lifecycle; level; phase active/intermission; monotonic timers; RNG; module instance; pinned theme | No shared mutable world objects |
| Participant | accountId; connected; connection generation; reservationDeadline; life alive/dead/disconnected/expired; respawnAt; points/kills/deaths; input sequence | Death/reservation deadlines survive socket replacement |
| Spectator | accountId; socket; targetAccountId nullable | One active role per account per match; capped separately |
| World | seed; geometry/walkability; spatial index; entities; projectiles; pickups | All entity references scoped to match ID |
| Entity | id; typeId; position; collision shape; capability state; optional health | Core does not assume all entities attack |
| Input | accountId; sequence; normalized movement/aim; module command; receivedAt | Monotonic bounded sequence/rate; server validates |
| Snapshot | protocolVersion; matchId; tick; level/phase; entities; selected HUD; theme revision; serverTime | No secrets; recoverable current state |
| Metrics | per-runner timing histograms; counts; bytes; queue high-water; CPU/RSS; event-loop delay; RTT | Bounded buckets; no username labels |

## Lifecycle and cleanup

Waiting can start as Running or close as Abandoned. Running can become Finished,
Abandoned, Interrupted or Failed. Terminal states never become Running. Intermission
is a Running substate and consumes a slot. A terminal transition releases exactly
one slot and writes one result. Finished results remain accessible by ID but do not
occupy active slots. Graceful shutdown marks active sessions Interrupted; startup
reconciliation repairs leftover waiting/running metadata likewise.

Leaving a waiting session removes membership immediately. A creator who leaves
transfers ownership to the earliest connected participant; empty rooms expire in
60 seconds. In running sessions, remove disconnected avatars immediately and reserve
membership for 60 seconds; explicit Leave forfeits reconnect. All-connected-player
absence for 60 seconds abandons a running match even with spectators. At reservation
expiry mark participation expired without changing initial roster or enemy budgets.
The single live session connection for an account is replaced by its newer login/
connection generation; stale socket callbacks cannot remove the newer connection.

Safe spawn samples bounded traversable cells using server RNG, validates enemy,
projectile and obstacle clearance, and retries next tick if none is valid. No immunity
flag exists. NPC ceilings and blocked spawns must be visible; never silently erase
remaining enemies to complete a level.
