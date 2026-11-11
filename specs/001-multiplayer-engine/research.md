# Research and Decisions

Date: 2026-11-06. Architecture decisions below are planning results, not benchmarks.

## Runtime and transport

**Decision**: TypeScript, Node 24 LTS target, native browser WebSocket and Canvas,
server ws transport; dependency versions are locked during implementation.
**Rationale**: Shared protocol types, explicit server authority, minimal graphics.
**Alternatives**: Phaser is useful for later visual themes but unnecessary for shapes;
Socket.IO adds reconnection/protocol machinery but hides some bandwidth behavior.

Sources: https://nodejs.org/en/about/previous-releases ;
https://github.com/websockets/ws/blob/master/README.md ;
https://github.com/websockets/ws/blob/master/doc/ws.md

## Persistent versus live state

**Decision**: Local SQLite WAL with short serialized writes, in-memory worlds.
**Rationale**: One Lightsail host does not require another managed service. Accounts
and immutable results persist; movement is not written to disk each tick.
**Alternatives**: PostgreSQL offers a later multi-host path but adds POC operations.
WAL allows concurrent readers with one writer and requires local storage.
Source: https://sqlite.org/wal.html

## Session scheduling

**Decision**: Explicit SessionRunner boundary, inline implementation first, fixed
30 Hz simulation and initial 15 Hz snapshots. Each runner owns its mutable state.
**Rationale**: Start simple, measure stalls and scaling, preserve later worker migration.
**Alternatives**: One worker per room may reduce blocking but adds serialization and
memory cost and does not supply a security boundary. One process per room adds more operations.
Sources: https://nodejs.org/api/worker_threads.html ;
https://nodejs.org/api/perf_hooks.html

## Themes and overrides

**Decision**: Game Theme binds trusted module, trusted skin renderer and validated
asset package. Use typed capabilities/hooks and versioned state/event contracts.
**Rationale**: A theme can change behavior and full HUD presentation without forcing
all entities into a universal class or allowing asset uploads to execute code.
**Alternatives**: Sprite replacement alone fails the requested flexibility; arbitrary
uploaded code would require a separate trust/sandboxing project.

## Networking and capacity

**Decision**: Validate auth/origin on upgrade; bound payloads/input, heartbeat,
sequence commands and cap buffered sends; send replaceable snapshots, not unbounded queues.
**Rationale**: Spectators consume bandwidth and slow receivers otherwise distort results.
**Alternatives**: Unbounded full snapshots/queues can inflate memory and latency until failure.
Sources: https://github.com/websockets/ws/blob/master/doc/ws.md ;
https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API

**Measurement**: Vary 1/3/5 rooms, players, spectators and active NPCs independently.
Use pursuing/firing workloads, seeded maps, external clients and a 30-minute soak.
Record revision, CPU/RAM, co-hosted work, settings, versions, throughput, event-loop
lag, tick p50/p95/p99, deadline misses, application RTT, RSS, queue bytes and failures.
No sustainable workload is known yet.

## Credentials

**Decision**: Asynchronous built-in scrypt; salted hashes with stored parameters,
opaque revocable cookie sessions with token digests at rest.
**Rationale**: No plaintext passwords or username-based impersonation for reconnect.
**Alternatives**: Username-only access cannot establish ownership. JWT adds no clear
benefit for revocable single-host sessions. Calibrate scrypt work/memory cost on host.
Source: https://nodejs.org/api/crypto.html#cryptoscryptpassword-salt-keylen-options-callback

## Product defaults

All formerly unspecified numeric values and departure/reconnect policies are recorded
as editable assumptions in spec.md. They require no invented claim of user approval.
There are no unresolved technical blockers to task generation. AWS access, hardware,
domain and production secrets remain deployment inputs, not planning prerequisites.
