# HTTP Contract v1

Base path `/api/v1`; JSON except multipart theme upload. Authenticated routes use
opaque session cookie `mp_session`. Login rotates the session; logout revokes it.
Require same-origin mutations, JSON Content-Type, and request body limits. Public
health endpoints disclose no details. Cookies are HttpOnly, SameSite=Lax, Secure on
HTTPS; local HTTP development is the only Secure-cookie exception.

Session settings accept additive `playerMaxHealth` (integer 1-100000, default
150 when omitted). Create/edit/read/storage preserve explicit overrides;
invalid values return the existing 422 `INVALID_SETTINGS` response without
changing saved settings. Reading legacy records resolves the default without
rewriting their stored JSON.

| Method/path | Request | Success | Access |
| --- | --- | --- | --- |
| POST /auth/register | username, password, controlMode | 201 public account; login still required | Public, throttled |
| POST /auth/login | username, password | 200 account and Set-Cookie | Public, throttled |
| POST /auth/logout | Empty | 204 and cleared cookie | Logged in |
| GET /me | None | Account id/display name/role | Logged in |
| PATCH /me/control-mode | controlMode (`keyboard-only`, `keyboard-mouse` or `first-person`) | Updated public account preference | Logged in |
| GET /sessions | None | Active session summaries | Logged in |
| POST /sessions | settings, optional requestId | 201 session; creator joins as player | Logged in |
| PATCH /sessions/:id/settings | Full validated settings, expectedRevision | Updated waiting session | Creator |
| POST /sessions/:id/join | Empty | Membership and current state | Logged in, waiting only |
| POST /sessions/:id/start | expectedRevision | Running session and pinned revision | Creator |
| POST /sessions/:id/end | Empty | Saved `{result}` using the existing finished-result shape | Host/creator account only |
| POST /sessions/:id/rejoin | Empty | Reserved participation and state | Eligible account |
| POST /sessions/:id/leave | Empty | 204, immediate role release | Member |
| POST /sessions/:id/spectate | Empty | Spectator membership, player list | Logged in, available slot |
| GET /sessions/:id/players | None | Followable players with life/connectivity | Member/spectator |
| GET /matches/:id/results | None | Status, final standings/settings/theme | Logged in |
| GET /themes | None | Enabled compatible theme summaries | Logged in |
| POST /admin/themes | Multipart package | 201 validated registry revision | Operator |
| PATCH /admin/themes/:id/enabled | enabled | Updated availability for new sessions | Operator |
| GET /admin/metrics | None | Bounded host/runner metrics | Operator |
| GET /health/live | None | 200 or 503 | Public |
| GET /health/ready | None | 200 or 503 | Public |

`GET /api/v1/admin/metrics` returns a no-store JSON sample containing `sampledAt`,
`limits`, `host`, and at most five active `sessions`. Host metrics include process
uptime, cumulative user/system CPU milliseconds, RSS bytes, event-loop delay
mean/max/p50/p95/p99 milliseconds, and aggregate transport counters. Each active
session has its match ID (no account/username labels), entity/tick counts,
missed deadlines/dropped time, connection role counts, queued bytes/high-water,
JSON payload bytes sent/received, errors, disconnects, dropped/coalesced snapshots,
slow-consumer closures, and simulation/snapshot/RTT histograms. Session series are
removed on terminal release; host counters remain cumulative for the process.
Module counters/gauges are limited to 32 bounded identifier names per room.

Histograms use fixed upper-bound buckets in milliseconds (1, 2, 5, 10, 20, 33.3,
50, 100, 250, 1000, then overflow). Percentiles are bucket upper-bound estimates;
overflow uses the observed maximum and empty histograms return null percentiles.
Simulation duration includes the entire authoritative step, including snapshot
publication when scheduled; snapshot timing measures that publication separately.
RTT is server-observed transport ping/pong latency, not application or WAN-only
latency. Byte counters measure JSON payload bytes, not TLS/WebSocket framing.
The operator lobby provides manual refresh and a JSON download; no capacity
claim or load-harness execution is implied.

Error body: `{error:{code,message,requestId,details?}}`; no stack traces or secrets.
400 malformed/schema/control mode, 401 unauthenticated, 403 forbidden/origin, 404 unknown,
409 SESSION_CAPACITY/PLAYER_CAPACITY/SPECTATOR_CAPACITY/ALREADY_STARTED/
REVISION_CONFLICT/REJOIN_EXPIRED/USERNAME_TAKEN, 413 payload too large, 422 invalid
settings/package compatibility, 429 throttled, 503 not ready. Login failure uses a
generic message regardless of whether the username exists.

`controlMode` is saved on the account and returned by registration, login and
`GET /me`. Signup requires a valid value. Existing accounts receive `null` until
they choose one; the client blocks lobby access with a first-sign-in prompt. The
authenticated same-origin update endpoint allows a player to change the value from
the lobby. The preference does not alter server authority or the module's opaque
action envelope.

`GET /matches/:id/results` requires a valid login but does not create membership.
It returns `{result:{matchId,status,finalLevel,standings,settings,themeDigest,
finalizedAt,completionReason?}}` from the immutable saved result, or 404 if the identifier is invalid,
unknown, or the match has no saved result yet. Each finished standing contains
`accountId`, `username`, `rank`, `points`, `kills` and `deaths`. Ranks are persisted
in points-descending, kills-descending, deaths-ascending, normalized-username order;
clients preserve that order rather than recomputing scores. Abandoned, interrupted
and failed results have empty standings and must not appear as zero-score victories.
The public protocol validates the result shape and excludes credentials. Reloading
is a read-only request and cannot finalize the match again.

A finished result may end below `settings.maxLevels` when its module requests
completion or the host explicitly ends it, for example Dots and Squares wave timeout. `finalLevel` is the level
actually reached, not a claim that the remaining waves were cleared. It must
remain within the configured maximum; finished standings are still complete,
ranked and persisted through the same finalization path.

`completionReason` is an optional 1-128 character module completion code.
Dots and Squares uses `wave-timeout` for its hidden no-kill expiry; saved results
display "Wave ended: no kills for a while." Existing results without the field
remain compatible. Host-ended results do not acquire a timeout reason.
`noKillTimeoutSeconds` is an additive host/API setting, positive finite seconds
up to 3600, default 360 when absent. It is frozen on start; invalid values use
the existing 422 `INVALID_SETTINGS` path.

`POST /sessions/:id/end` requires authenticated same-origin JSON with an empty
body. Authorization compares the stored creator account ID, not a supplied role
or display name. Non-host participants, spectators, outsiders and operators
receive 403 `FORBIDDEN`, including after completion. Missing login returns 401;
invalid/nonexistent IDs return 404; nonempty bodies return 400 `BAD_REQUEST`.
Waiting/abandoned/interrupted/failed sessions return 409 `BAD_REQUEST`.
Running matches synchronously capture server-owned module standings, finalize as
Finished, dispose the runner, release player/spectator membership and the active
slot, and publish the existing saved-result lifecycle notification. The response
is the same `{result}` shape as the results GET. A host retry after any Finished
completion returns that original result without finalizing or notifying again.
Both normal completion and host end use the same once-only transaction.
During intermission the current level stays on the cleared wave; the next level
is persisted only when it starts. The lobby shows End Session directly after the
Running status only for the host, and asks for confirmation before posting.

Session summary: id, name, creator display name, status, level/maxLevels,
playerCount/maxPlayers, spectatorCount/maxSpectators, theme name/revision, settingsRevision,
canJoin/canSpectate/canRejoin/canPlay for this account. `canPlay` is true only for
an admitted, unexpired participant in a running session; it opens the browser view and does
not perform Join or grant reconnect admission. Counts and direct actions share one
authoritative registry. The server generates `name` as the selected theme's display
name, followed by ` — ` and the authenticated creator's username. The display name is
at most 91 characters (64-character theme name, separator, 24-character username).
It is not unique; the session UUID `id` is the unique identifier, so one creator may
have multiple sessions with the same display name. GETs never create membership.
Session create/settings requests and `GET /sessions/:id` settings include the
additive v1 `npcMovementSpeed` field: finite 0–180 world units/second with fractions
allowed, default 67.5 when omitted. `npcDetectionRange` is finite 0–700 world units,
defaults to the former fixed 512-unit distance, and zero disables automatic pursuit.
Dots and Squares uses it as the maximum player-acquisition radius; both settings are
exposed in the host create/edit UI and frozen on start. Invalid values return 422
`INVALID_SETTINGS`; only the waiting-room creator may update them, with the existing
settings revision check. Older stored rooms and result settings are normalized on
read without rewriting saved data.
Idempotent leave/logout remain safe on retries. Retried create is not implicitly
idempotent; use requestId as an idempotency key scoped to account for 60 seconds to
avoid duplicate rooms.

### Spectator admission and player list (T026)

`POST /sessions/:id/spectate` accepts an empty body and returns
`{session,spectator:{accountId,targetAccountId:null|string},players}`. Admission is
synchronous, only for running sessions and nonparticipants. Spectator slots are
live memberships, separate from persisted participants and the frozen module
roster; they never change NPC budgets. Zero `maxSpectators` disables admission.
Concurrent requests for the last slot admit one account only; retry by an already
admitted account returns its existing membership without reserving another slot.
`canSpectate` is false for participants, already admitted spectators, nonrunning
sessions and full/disabled spectator capacity.

`GET /sessions/:id/players` requires player or spectator membership in that running
session and returns `{spectator,players}`; `spectator` is null for a participant.
Each player contains `accountId`, `username`, `connected`, `life`
(`alive|dead|unavailable`) and `followable`. The list follows roster order, excludes
observers and departed participants, and reads life from the active module and
connectivity from the current authorized socket. Connected alive **or dead**
participants are followable; disconnected/unavailable players are not. Reading the
list clears a selected target that is no longer followable without creating any
membership. T027 sends the corresponding target-unavailable notification and
updated followable list to the spectator socket on the next snapshot publication.

`POST /sessions/:id/leave` immediately releases a spectator's slot and closes that
spectator connection. Retries do not change counts. Socket close/error/heartbeat
failure releases the matching spectator membership; stale close callbacks cannot
release a newer connection or admission. Terminal session cleanup releases all
spectator memberships. Admission without a socket still requires explicit leave
or session termination; GET and WebSocket upgrade never reserve spectator slots.
Target-derived views are provided by T027; browser spectator controls remain T028
work.

These are additive v1 responses/endpoints; existing player membership, module input
envelopes, snapshot schemas and saved results are unchanged.

Proposed throttles: login 10 attempts/minute per IP and per normalized username,
register 5/minute per IP, authenticated mutations 60/minute/account. Bound throttle
storage and expire entries. Behind Nginx trust only the configured local proxy, not
arbitrary forwarded headers. Auth request bodies max 4 KiB; other JSON max 16 KiB.

### Player reconnect (T029)

T029 implements Rejoin for a frozen running-match participant authenticated with
the account's current login. It returns `{session}`; the subsequent WebSocket
hello/snapshot resumes module state. Disconnect reserves participation for exactly
60 seconds; repeated Rejoin requests do not extend that deadline. Invalid bodies
return 400, missing authentication 401, and absent/expired/forfeited reservations
409 (`REJOIN_EXPIRED`). Leave forfeits running participation immediately, but
retains the frozen result roster and difficulty budget. Waiting-room leave still
removes membership; spectator leave only releases its separate spectator slot.
