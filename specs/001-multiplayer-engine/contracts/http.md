# HTTP Contract v1

Base path `/api/v1`; JSON except multipart theme upload. Authenticated routes use
opaque session cookie `mp_session`. Login rotates the session; logout revokes it.
Require same-origin mutations, JSON Content-Type, and request body limits. Public
health endpoints disclose no details. Cookies are HttpOnly, SameSite=Lax, Secure on
HTTPS; local HTTP development is the only Secure-cookie exception.

| Method/path | Request | Success | Access |
| --- | --- | --- | --- |
| POST /auth/register | username, password | 201 public account; login still required | Public, throttled |
| POST /auth/login | username, password | 200 account and Set-Cookie | Public, throttled |
| POST /auth/logout | Empty | 204 and cleared cookie | Logged in |
| GET /me | None | Account id/display name/role | Logged in |
| GET /sessions | None | Active session summaries | Logged in |
| POST /sessions | settings, optional requestId | 201 session; creator joins as player | Logged in |
| PATCH /sessions/:id/settings | Full validated settings, expectedRevision | Updated waiting session | Creator |
| POST /sessions/:id/join | Empty | Membership and current state | Logged in, waiting only |
| POST /sessions/:id/start | expectedRevision | Running session and pinned revision | Creator |
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

Error body: `{error:{code,message,requestId,details?}}`; no stack traces or secrets.
400 malformed/schema, 401 unauthenticated, 403 forbidden/origin, 404 unknown,
409 SESSION_CAPACITY/PLAYER_CAPACITY/SPECTATOR_CAPACITY/ALREADY_STARTED/
REVISION_CONFLICT/REJOIN_EXPIRED/USERNAME_TAKEN, 413 payload too large, 422 invalid
settings/package compatibility, 429 throttled, 503 not ready. Login failure uses a
generic message regardless of whether the username exists.

Session summary: id, name, creator display name, status, level/maxLevels,
playerCount/maxPlayers, spectatorCount/maxSpectators, theme name/revision, settingsRevision,
canJoin/canSpectate/canRejoin for this account. Counts and direct actions share one
authoritative registry. The server generates `name` as the selected theme's display
name, followed by ` — ` and the authenticated creator's username. The display name is
at most 91 characters (64-character theme name, separator, 24-character username).
It is not unique; the session UUID `id` is the unique identifier, so one creator may
have multiple sessions with the same display name. GETs never create membership.
Idempotent leave/logout remain safe on retries. Retried create is not implicitly
idempotent; use requestId as an idempotency key scoped to account for 60 seconds to
avoid duplicate rooms.

Proposed throttles: login 10 attempts/minute per IP and per normalized username,
register 5/minute per IP, authenticated mutations 60/minute/account. Bound throttle
storage and expire entries. Behind Nginx trust only the configured local proxy, not
arbitrary forwarded headers. Auth request bodies max 4 KiB; other JSON max 16 KiB.
