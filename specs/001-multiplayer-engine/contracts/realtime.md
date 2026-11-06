# Realtime Contract v1

Upgrade `/ws?sessionId=<uuid>` on same origin with valid session cookie and existing
player/spectator membership. No auth tokens in URLs. Rejoin/admission uses HTTP first;
upgrade cannot create a sixth room, bypass start rules or add a spectator over cap.
Only one current session role/connection per account; socket generations prevent
late close callbacks from detaching a replacement connection.

Every message is a versioned envelope with `v:1`, `type`, `requestId?`, and `payload`.
Server messages add `sessionId`, `tick`, and `serverTimeMs` when applicable.

| Direction/type | Payload and behavior |
| --- | --- |
| Server hello | protocolVersion, tickRate, snapshotRate, role, pinned theme, current state, lastAcceptedInputSeq |
| Client input | sequence, moveX/moveY (−1..1), aimX/aimY (finite world target), fire boolean, moduleCommand optional; player only |
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
ignore duplicates and stale sequence values. Clamp aim to world bounds, normalize
movement, reject malformed/unknown commands and unauthorized theme actions. Keep
latest movement intent, not an unbounded FIFO. Fire cadence belongs to the module.

Spectator snapshot visibility is derived from the selected player's authoritative
camera anchor and life/HUD state. Viewport dimensions may differ; no screenshot
streaming. On death provide countdown and last/death camera anchor until respawn.
On target disconnect/leave return to player list, and on game end show standings.

Initial limits: 16 KiB incoming message; 60 input commands/sec/account; at most
1 MiB buffered outgoing bytes/socket; no per-message compression. Coalesce obsolete
snapshots before send; close sustained slow consumers with a reconnectable error.
Heartbeat every 15 seconds; close after two missed responses. Control events need
not accumulate indefinitely: the next snapshot/hello reconstructs current state.

Snapshots include protocol and module state schema versions; an unsupported client
must fail with a clear compatibility error before receiving malformed state.
Module payloads are validated on both boundaries and scoped to the pinned module.
