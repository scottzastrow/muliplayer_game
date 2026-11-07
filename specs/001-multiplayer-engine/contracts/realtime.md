# Realtime Contract v1

Upgrade `/ws?sessionId=<uuid>` on same origin with valid session cookie and existing
player/spectator membership. No auth tokens in URLs. Rejoin/admission uses HTTP first;
upgrade cannot create a sixth room, bypass start rules or add a spectator over cap.
Only one current session role/connection per account; socket generations prevent
late close callbacks from detaching a replacement connection.

T029 binds a player's reconnect reservation to account and session, not an old
socket or login token. Initial running admission permits the first socket; after
detach, authenticated HTTP Rejoin is required before upgrade. Latest connections
replace earlier account connections, reset input sequence for their generation,
and clear retained controls on disconnect. Stale closes cannot remove the newer
avatar or reservation. Disconnected avatars are absent from active play; the module
keeps score, health and pending death deadlines. They never change the frozen
roster or NPC budget. Explicit Leave or the exact 60-second deadline forfeits
return. A running room with no connected players for 60 seconds is abandoned and
its runner, spectator slots and session slot are released, even with observers.

Every message is a versioned envelope with `v:1`, `type`, `requestId?`, and `payload`.
Server messages add `sessionId`, `tick`, and `serverTimeMs` when applicable.
`server.hello` includes the running match's exact pinned theme revision and package
digest. A disabled flag does not affect an existing match's pin; the client must
resolve that exact installed revision and digest before rendering the session.

| Direction/type | Payload and behavior |
| --- | --- |
| Server hello | protocolVersion, tickRate, snapshotRate, role, pinned theme, current state, lastAcceptedInputSeq |
| Client input | sequence plus a module-defined JSON `action`; player only. The shared protocol validates the versioned envelope and bounded JSON shape, while the pinned module validates action fields and semantics. |
| Server snapshot | Current level/phase, entities, obstacles/map revision, pickups, projectiles, player scores/life timers and selected target HUD |
| Server events | Bounded recent presentation events with event ID/type/tick/position and module-defined validated data |
| Client spectate.target | targetAccountId; validate membership and followable target |
| Server spectate.target | Selected target or target-unavailable and refreshed player list |
| Server roster | Public participants and connection/life states |
| Server lifecycle | waiting/running/intermission/terminal, deadlines and terminal result ID |
| Client ping / Server pong | Nonce, application RTT measurement; separate from transport heartbeats |
| Server error | code, safe message, requestId; fatal flag |

Inputs never contain authoritative position, health, hits, pickup grants, scores or
life state. Sequence is an increasing safe integer for the connection generation;
ignore duplicates and stale sequence values. The shared envelope does not require
combat fields: a noncombat module action such as `{ "type": "unlock", "targetId":
"door-1" }` is valid without movement, aim, or fire properties. The module validates
action-specific fields and semantics and rejects actions it does not support. The
default theme defines its own `combat` action with moveX/moveY (−1..1), aimX/aimY
(finite world target) and fire; that module clamps aim to world bounds, normalizes
movement, and controls fire cadence. Keep the latest accepted movement intent, not
an unbounded FIFO.

The default browser skin sends keyboard/mouse intent at up to 30 scheduled commands
per second, plus neutral controls when focus/life state changes. It never sends
position, score or health. The browser connection limits buffered control bytes
to 16 KiB and closes a stalled connection with an explicit resync reason rather
than queueing unlimited movement history. This does not change the shared opaque
action envelope or the server's 60-command/second admission limit.

Spectator snapshot visibility is derived from the selected player's authoritative
camera anchor and life/HUD state. Viewport dimensions may differ; no screenshot
streaming. On death provide countdown and last/death camera anchor until respawn.
On target disconnect/leave return to player list, and on game end show standings.

T026 implements the admission/authorization portion only: an HTTP-admitted
spectator can upgrade, receives `server.hello` with role `spectator`, and sends
`client.spectate.target`. The server checks current spectator membership and a
connected followable participant in the **same session**, then acknowledges with
`server.spectate.target {targetAccountId}`. An invalid target is rejected without
overwriting a valid selection; malformed IDs/fields fail envelope validation.
Players cannot use spectator targeting, and spectators cannot send gameplay input.
Target selection and input attempts share the bounded 60-command/sec/account
window. Replacement connections retain membership; close/error/heartbeat failure
releases only the matching spectator connection generation.

T027 sends snapshots only while an authorized followable target is selected.
The module is asked for that **target's** player view, never an observer's player
view. The v1 envelope and module schema version are unchanged; `viewerAccountId`
is the selected player and `viewerRole` is `spectator`. For Dots and Squares,
the additive `spectatorView` contains:

```json
{
  "targetAccountId": "<selected player UUID>",
  "cameraAnchor": { "x": 272, "y": 272 },
  "hud": { "points": 500, "health": 0 },
  "death": {
    "alive": false,
    "respawnAtTick": 210,
    "respawnBlocked": false,
    "remainingSeconds": 4
  }
}
```

The anchor is the live player position or retained death position. Points,
health, alive status, respawn deadline and blocked status come from the module's
authoritative player record. Remaining seconds is the nonnegative difference
between deadline and snapshot tick at 30 Hz; living views use zero and omit the
deadline/blocked fields. Respawn updates the anchor and health without changing
the selected account. The renderer uses the recipient's own viewport; these
fields do not convey control authority or stream another player's pixels.

On disconnect, leave or other loss of followability, the next scheduled snapshot
publication clears the target and sends `server.spectate.target` with
`{targetAccountId:null,reason:"target-unavailable",message,players}`. `players`
contains only the currently followable same-session players, including connected
dead targets. Empty lists are valid. Notification is sent once per selection loss,
even if an HTTP list read already cleared the selection. Pending snapshots for
the old target are discarded on switching or selection loss, and no gameplay
snapshots are sent until another target is selected. Selection/visibility are
revalidated on each publication; target projections are reused only within that
session/tick. Browser list/navigation/control integration is T028.

T028 browser integration admits through HTTP before opening its spectator socket.
The lobby Spectate button uses the server's `canSpectate` flag; failed admission
is displayed rather than opening an unauthorized view. The player list validates
public targets, disables un-followable players and sends selections through the
existing `client.spectate.target` envelope. Acknowledgment mounts the pinned default
skin through the public skin host for that selected account. The renderer consumes
the server `spectatorView` camera/HUD/death fields and never dispatches spectator
gameplay intent.

Back to Players disposes the current skin, refreshes the list and ignores
in-flight snapshots until another selection is acknowledged. Target-unavailable
messages dispose the view and display the supplied updated list and explanation.
Back to lobby explicitly releases membership before navigating, displaying leave
errors with a retryable control. Disposal/page departure closes the socket and
requests idempotent leave, including admission that completes after cancellation.
Saved-result lifecycle messages navigate observers to the existing reloadable
standings view. This does not implement player reconnect/reservations (T029).

Initial limits: 16 KiB incoming message; 60 input commands/sec/account; at most
1 MiB buffered outgoing bytes/socket; no per-message compression. Coalesce obsolete
snapshots before send; close sustained slow consumers with a reconnectable error.
Heartbeat every 15 seconds; close after two missed responses. Control events need
not accumulate indefinitely: the next snapshot/hello reconstructs current state.

Snapshots include protocol and module state schema versions; an unsupported client
must fail with a clear compatibility error before receiving malformed state.
Module payloads are validated on both boundaries and scoped to the pinned module.

On normal match completion, Core commits final standings and terminal state,
releases the runner, then sends `server.lifecycle` with
`{status:"finished",resultId:<session UUID>}` to that session's connected players
and spectators.
This is a saved-result notification, not client-authoritative scoring. The client
closes gameplay controls and fetches `/api/v1/matches/:id/results` only after this
notification; a preceding complete-phase snapshot alone does not imply persistence
has finished. Result links remain reloadable without a live WebSocket or runner.
