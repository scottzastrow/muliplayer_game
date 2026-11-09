# Implementation Plan: Multiplayer Engine and Default Theme

**Branch**: `001-multiplayer-engine` | **Date**: 2026-11-06 | **Spec**: [spec.md](spec.md)

**Input**: `specs/001-multiplayer-engine/spec.md`

## Summary

Build a single-host authoritative multiplayer engine, with public accounts, a lobby
capped at five waiting/running sessions, generated cooperative combat, spectators,
reconnect, finite matches, and persistent results. Implement Game Themes as a public
module/skin contract from the start. Ship the minimal default theme and a small
fixture proving meaningful behavior and HUD replacement. No game code is delivered
by this planning change.

## Technical Context

**Language/Version**: TypeScript, Node.js 24 LTS target, desktop browser ES2022.
Exact dependency versions must be resolved, compatibility checked, and locked in T001.

**Primary Dependencies**: Vite client build, native Canvas/WebSocket in browser,
Fastify HTTP, ws server transport, Zod boundary schemas, better-sqlite3 persistence,
Vitest focused automated checks. Use npm workspaces; no heavy client UI framework.

**Storage**: SQLite on local disk, WAL mode, short serialized transactions, foreign
keys, busy timeout. Account/auth/session metadata and results persist. Live worlds
are in memory. Do not write per-entity state every tick.

**Testing**: Vitest for deterministic simulation, contracts and HTTP/socket integration;
real two-browser/manual scenario checks; external protocol load harness for capacity.
Do not install or claim browser automation until the execution environment supports it.

**Target Platform**: Ubuntu Lightsail, one Node service behind Nginx HTTPS/WSS.

**Project Type**: Browser game with shared engine SDK, server, client, theme packages.

**Performance Goals**: Start at 30 authoritative ticks/sec and 15 snapshots/sec with
client interpolation. These are engineering targets, not verified results. At a
reported sustainable workload require p95 simulation work below 33.3 ms, less than
1% missed deadlines, no sustained tick debt or unbounded buffers, no unexpected
application disconnects, and a 30-minute soak. Record latency rather than hiding WAN effects.

**Constraints**: Five session slots, no cross-session mutable state, bounded work,
trusted installed game modules, no online AWS changes in this planning phase.

**Scale/Scope**: One host, one default theme plus one contract fixture. Maximum
players, spectators and entities remain bounded and configurable, with capacity
established experimentally on the actual host.

## Constitution Check

Pre-research and post-design gates both pass by design; runtime evidence remains pending.

| Principle | Design evidence | Implementation gate |
| --- | --- | --- |
| Server authority/isolation | Input commands only; per-session state; atomic registry | Forged input and admission race checks |
| Public theme contracts | Versioned SDK; default and fixture use same path | Fixture behavior/HUD replacement with no core edits |
| Focused verification | Tasks map to stories and meaningful risk checks | Run actual checks and retain evidence |
| Bounded measured work | Entity/queue/navigation caps and external load harness | Measured report, no guessed capacity |
| Secure identity/simple defaults | scrypt hashes, server sessions, Canvas shapes | Auth/origin/package checks and browser exercise |

## Project Structure

### Documentation (this feature)

| Path | Responsibility |
| --- | --- |
| `specs/001-multiplayer-engine/spec.md` | Product requirements, assumptions, acceptance |
| `specs/001-multiplayer-engine/research.md` | Technical decisions and sources |
| `specs/001-multiplayer-engine/data-model.md` | Persistent/live state and constraints |
| `specs/001-multiplayer-engine/contracts/` | HTTP, socket, theme and settings contracts |
| `specs/001-multiplayer-engine/quickstart.md` | Planned run and validation workflow |
| `specs/001-multiplayer-engine/tasks.md` | Dependency-ordered implementation work |

### Source Code (repository root)

| Path | Responsibility |
| --- | --- |
| `apps/server/src/auth/` | Credentials, sessions, permissions |
| `apps/server/src/lobby/` | Atomic registry, lifecycle and admission |
| `apps/server/src/transport/` | HTTP/socket schemas, routing, backpressure |
| `apps/server/src/runtime/` | Authoritative runners, tick scheduling, metrics |
| `apps/server/src/storage/` | Migrations, accounts, results |
| `apps/server/src/themes/` | Validated install registry and immutable assets |
| `apps/client/src/` | Account/lobby shell, connection, host for skin UI |
| `packages/protocol/src/` | Versioned wire schemas and errors |
| `packages/engine/src/` | Simulation runner, clock, RNG, geometry/navigation services |
| `packages/theme-sdk/src/` | Module/skin/capability contracts |
| `themes/default/module/` | Default gameplay implementations |
| `themes/default/skin/` | Shape rendering, HUD, controls and spectator presentation |
| `themes/fixture/` | Alternate behavior/HUD and conformance fixture |
| `tools/` | Theme validation/installation, previews, external load clients |
| `tests/` | Cross-component contract and integration scenarios |
| `deploy/` | Lightsail service/proxy examples and operational guide |

**Structure Decision**: Small npm workspace with explicit engine/theme boundaries;
no external microservices or separate database host required for the POC.

## Companion repository and configuration

The engine repo owns `packages/theme-sdk`, `packages/protocol`, contracts and
`themes/default`. The themes repo owns authored modules/skins/assets, never engine
internals or production configuration. Publish a versioned distributable SDK from
this repo (no third repository); until available, pin an immutable contract commit
and explicitly block compile/preview claims. Verify one external consumer builds
against the released SDK without importing private engine paths.

Root local scripts must load `.env` with Node's env-file support or a single documented
loader; Windows users must not need persistent system variables. Validate values in
config.ts and fail with redacted diagnostics. Production systemd loads the separate
`/etc/multiplayer-game/game.env`; only PUBLIC_ORIGIN may be exposed as intentional
client configuration, not the whole process environment. No env file is needed in
the themes repo unless later preview tooling needs optional nonsecret local settings.

Existing hosting state and production environment layout are recorded in
`docs/hosting.md`. It reports infrastructure only, not readiness of application scripts.

## Phase 0: Research Decisions

See [research.md](research.md). Select local SQLite over hosted persistence for a
single-host POC; choose explicit WebSocket protocols over hidden room middleware;
keep rendering separate from game rules. Use a SessionRunner interface with inline
execution initially; retain a worker implementation path if measurements justify it.
Trusted modules are not sandboxed by worker threads.

## Phase 1: Design

- Persistent/live records and lifecycle: [data-model.md](data-model.md).
- HTTP/auth/installation: [contracts/http.md](contracts/http.md).
- WebSocket/input/spectator contracts: [contracts/realtime.md](contracts/realtime.md).
- Public SDK/package boundary: [contracts/themes.md](contracts/themes.md).
- Validated settings, formulas, bounds: [contracts/settings.md](contracts/settings.md).
- End-to-end validation procedure: [quickstart.md](quickstart.md).

### Scheduling and Simulation

Use monotonic elapsed time and fixed 1/30-second steps; cap catch-up at three steps
per scheduler turn, record dropped time/missed deadlines instead of unbounded catch-up.
Each runner owns its module instance, seeded RNG, geometry, input queue and snapshots.
World state cannot hold Account password/session data. Core owns time and lifecycle;
module returns typed gameplay events and level/match completion requests. Core checks
state transitions and persists final results idempotently.

Use a uniform spatial grid for nearby queries and seeded walkable-grid maps. Stagger
bounded path searches, with cached paths and replanning on obstruction/target movement.
Do not run all-pairs NPC scans or all-enemy pathfinding each tick. Normalize movement
so diagonal commands do not exceed speed. Bound projectiles and pickup claims.

### Account and Session Lifecycle

Use Node asynchronous scrypt with random salt and stored parameters, constant-time
credential comparison, opaque 256-bit login tokens stored hashed in SQLite, HttpOnly
SameSite=Lax cookies (Secure in production), origin validation on mutations and WSS
upgrade, generic login failure, bounded password/username lengths, auth throttles,
no public role escalation. Bootstrap an operator via a local CLI, never a default password.

A synchronous registry owns slot allocation with no await between check and reserve;
rollback reservations on creation failures. Start atomically freezes settings, roster
and exact theme revision. Sessions transition Waiting → Running → Finished, Abandoned,
Interrupted or Failed. Between-level transitions are a Running substate.

Reconnect binds account ID and match participation rather than just username. An
expired 60-second reservation cannot rejoin the active roster. Server owns death and
reservation deadlines. Closing/replacing sockets cleans membership exactly once.
SQLite startup reconciliation marks previous active matches Interrupted; it does not
pretend live worlds were saved.

### Theme Installation and Pinning

Expose Game Themes only to users; module/skin is developer vocabulary. A privileged
operator installs reviewed compiled modules out of band. The admin upload accepts a
bounded ZIP of manifest plus assets referencing an installed module and skin renderer;
it cannot introduce JavaScript, HTML, SVG scripts or module code. Custom renderers and
menus are installed developer code served from the application build and selected by
manifest ID, with a typed skin host interface. Unknown renderer/module IDs fail.

Validate normalized ZIP paths, entry types/count/size, decoded image/audio limits,
manifest schemas, hashes and compatible API versions before atomic promotion into a
content-addressed directory. Pin exact theme revision, module and renderer versions at
start; retain immutable asset directories while referenced. Package failure must leave
the installed registry unchanged. Missing optional assets use a declared fallback;
missing required entries reject installation. Static assets alone do not claim full UI extensibility.

### Capacity and Failure Handling

Bound input at 60 commands/sec, payload at 16 KiB and outgoing pending bytes at 1 MiB
per socket initially. Coalesce obsolete snapshots, disable compression initially,
heartbeat every 15 seconds, close after two missed responses. Retain no unbounded
reliable event history. A snapshot contains current required state so resync is possible.
Module exceptions fail that session with a visible reason, release capacity and keep
other sessions alive. CPU-heavy trusted code can still stall an inline runner: report
this limit and use metrics to decide worker/process isolation before extending trust.

Expose operator-only metrics, separate liveness and readiness, handle graceful shutdown,
checkpoint and back up SQLite safely, and never copy only a live database file without
its WAL. Load generators must run on a separate machine from the measured host.

## Complexity Tracking

### Scoped level-transition presentation follow-up

Extend completed T021/T023/T024 through the default module/skin only. Preserve
frozen-roster growth, server-authoritative combat, the existing 150-tick
intermission and normal final-result handoff. Add starting/living wave counts and
per-wave score baselines to default snapshots; render counts independently of
radar filters and a roster standings table during intermission for both roles.
Use focused default-module/skin, spectator and lifecycle tests, then a disposable
loopback Chrome scenario with default settings and staged clear-lane combat.
Do not change the Theme Credits pointer, shared SDK declarations, deployment or
T042. Keep changes uncommitted for review.

No constitution exceptions. Workspace packages exist to enforce the requested public
extension boundaries; further service or plugin abstraction requires a demonstrated need.

### Scoped host-ended session follow-up

T048 extends the existing lobby routes/UI and SessionLifecycle finalization, without
changing the theme SDK or wire envelopes. Authorize the creator account ID before
running or terminal retries; an already finished match returns its immutable saved
result. Capture current module standings and share the same persistence, runner
release and terminal notification helper as normal completion. Queue the next
level during intermission and persist it only when the module starts that wave.
Verify denial, disk reopen, host-first/completion-first races and confirmation in
visible local Chrome. Preserve the existing countdown verification note, feature
pointer and T042; leave the scoped changes local and uncommitted.

### Scoped NPC-health measurement follow-up

T049 extends completed T004/T020/T021. Measure a spawned level-1 NPC using
standard firing inputs and projectile collision, isolating movement/pickups in
a clear lane. Only if more than two hits are observed, set the shared lobby and
default-theme manifest health default to 50 for the unchanged 25-damage shot.
Preserve explicit host/saved settings, count and health growth formulas, NPC
counts, weapon tuning and lifecycle. Verify both default and overridden health,
saved-room/result JSON, create/edit UI and wave progression with focused checks.
Do not repin uncommitted public-package changes, alter the Theme Credits pointer,
complete T042, commit, push or deploy.
