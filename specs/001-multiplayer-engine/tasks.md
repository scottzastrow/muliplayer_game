# Tasks: Multiplayer Engine and Default Theme

**Input**: `specs/001-multiplayer-engine/` design artifacts.
**Prerequisites**: spec.md, plan.md, research.md, data-model.md, contracts/, quickstart.md.
**Tests**: Focused authority, isolation, lifecycle and extension verification is required
by the constitution. Tests are implementation work; none have run in this planning phase.
**Organization**: User-story slices; execute sequentially on this branch.

## Format: `[ID] [P?] [Story] Description`

Every task has a checkbox, stable ID, story label where appropriate and exact paths.
[P] denotes optional independent file work, not a directive to spawn agents.

## Phase 1: Setup (Shared Infrastructure)

- [X] T001 Initialize npm workspaces and lock compatible Node 24/TypeScript/Fastify/ws/Zod/better-sqlite3/Vite/Vitest versions in package.json, package-lock.json, apps/server/package.json, apps/client/package.json and packages/*/package.json; add build/check/test/dev/start scripts that load ignored local .env without Windows system variables, and .env.example per quickstart.md.
- [X] T002 Configure shared strict compilation and browser/server builds in tsconfig.base.json, apps/server/tsconfig.json and apps/client/vite.config.ts; ensure one dev origin proxies HTTP and WebSockets.
- [X] T003 Configure focused checks and build validation in vitest.config.ts and .github/workflows/ci.yml; exclude runtime data and secrets using .gitignore.

## Phase 2: Foundational (Blocking Prerequisites)

- [X] T004 Define runtime-validated version-1 envelopes, errors, public serializers and settings in packages/protocol/src/index.ts and packages/protocol/src/settings.ts from contracts/; reject unknown/nonfinite fields and exclude secrets.
- [X] T005 Define engine/module/skin/capability interfaces in packages/theme-sdk/src/index.ts from contracts/themes.md, including isolated factories, scoped services, state schema compatibility and presentation host slots; publish the versioned SDK/types/runtime schemas from this repo for pinned external consumption, with no private-path imports.
- [X] T006 Implement injectable monotonic clock, seeded RNG and bounded SessionRunner in packages/engine/src/runner.ts; fixed 30 Hz steps, maximum three catch-up steps/turn, immutable snapshots, dispose and exception reporting.
- [X] T007 Implement SQLite migration runner and tables in apps/server/src/storage/migrations/001-initial.sql and apps/server/src/storage/database.ts; enforce data-model.md UNIQUE/FK constraints, WAL, busy timeout, short transactions and token/hash redaction.
- [X] T008 Implement typed configuration, safe error handling, structured request IDs, readiness and graceful startup/shutdown in apps/server/src/config.ts and apps/server/src/main.ts; reconcile stale active matches as Interrupted.

Checkpoint: contracts and runtime infrastructure exist before user-facing behavior.

## Phase 3: User Story 1 - Accounts and Sessions (Priority: P1)

**Goal**: Authenticate and create/configure/start sessions within atomic limits.
**Independent test**: Two accounts join; five sessions succeed, a sixth fails under races.

- [ ] T009 [US1] Implement accounts and async salted scrypt credentials in apps/server/src/auth/accounts.ts; enforce username 3–24 ASCII letters/digits/underscore with lowercased UNIQUE key and password 9–128 characters; never serialize credentials.
- [ ] T010 [US1] Implement hashed opaque login tokens, seven-day expiry, rotation/logout, Secure production HttpOnly SameSite cookies, origin checks and bounded login/register throttles in apps/server/src/auth/sessions.ts and apps/server/src/auth/routes.ts.
- [ ] T011 [US1] Implement synchronous reserve/rollback/release and idempotent creation in apps/server/src/lobby/registry.ts; waiting/running/reserved total maximum five, creator joins, server-generated theme/creator display names, full settings validation and 60-second request-id deduplication.
- [ ] T012 [US1] Implement lobby HTTP routes and atomic join/start/settings revisions in apps/server/src/lobby/routes.ts; enforce creator authority, caps, frozen roster/settings/theme, terminal release and waiting owner/empty-room cleanup.
- [ ] T013 [US1] Implement account forms and session list/create/settings screens in apps/client/src/auth.ts and apps/client/src/lobby.ts; show theme/state/capacities and disabled Join/Spectate/Create with reasons; render server failures accessibly.
- [ ] T014 [US1] Verify forged roles, generic auth failures, logout, duplicate names, slot races, join/start races and settings validation in tests/integration/accounts-lobby.test.ts; record evidence in docs/verification.md.

Checkpoint: US1 independently demonstrates account and session lifecycle; it is not yet a playable game.

## Phase 4: User Story 2 - Default Theme Gameplay (Priority: P1)

**Goal**: Deliver real two-player combat through generated finite levels.
**Independent test**: Two browsers move, meet, fight, die, respawn and finish two levels.

- [X] T015 [US2] Implement authenticated/origin-checked WebSocket upgrade, membership routing, input sequence/rate validation, heartbeats, reconnectable errors and bounded/coalesced sends in apps/server/src/transport/socket.ts and apps/client/src/connection.ts from contracts/realtime.md.
- [X] T016 [US2] Implement scoped entity store, spatial grid, collision geometry and bounded staggered navigation in packages/engine/src/world.ts and packages/engine/src/navigation.ts; no cross-room mutable singleton or all-pairs NPC loop.
- [X] T017 [US2] Register the default factory/renderer through public theme interfaces in themes/default/theme.json, themes/default/module/index.ts and apps/server/src/themes/builtins.ts; do not bypass SDK for default.
- [X] T018 [US2] Implement a shared validated map format, seeded connected-map generation, obstacles, legal placement and bounded fallback in packages/theme-sdk/src/maps.ts and themes/default/module/maps.ts; 2048×2048 world and 32-unit cells per contracts/settings.md.
- [X] T019 [US2] Implement normalized player movement, proximity NPC pursuit and capability-based attacks in themes/default/module/entities.ts; use settings.md speeds/range/contact cooldown and capped navigation work.
- [X] T020 [US2] Implement authoritative shots/hits, single-claim health/rapid-fire/spread pickups, timed effects, caps and score/death accounting in themes/default/module/combat.ts and themes/default/module/pickups.ts; use settings.md tuning and no friendly fire.
- [X] T021 [US2] Implement roster-frozen growth formulas, overflow-safe preflight, five-second intermissions, max-level completion and idempotent finalization in themes/default/module/progression.ts, apps/server/src/runtime/session-lifecycle.ts and apps/server/src/storage/results.ts; verify normal session-start completion in tests/integration/session-lifecycle.test.ts without truncating NPC totals.
- [ ] T022 [US2] Implement configurable five-second death deadline and bounded random-safe respawn in themes/default/module/respawn.ts; retain score, avoid obstacle/projectile/enemy contact plus margin, retry if blocked, and provide no immunity flag or early level-transition respawn.
- [ ] T023 [US2] Implement skin host, interpolation, centered camera, input bindings and default shapes/HUD in apps/client/src/skin-host.ts and themes/default/skin/index.ts; points largest, health visible, camera independent per player and viewport resize supported.
- [ ] T024 [US2] Implement match-end standings/result reload and back-to-lobby controls in themes/default/skin/results.ts and apps/client/src/results.ts with deterministic tie ordering from spec.md.
- [ ] T025 [US2] Verify deterministic navigation, local attraction, no pickup duplication, growth, simultaneous last kills, death timing/no immunity, safe-spawn failure and five-session isolation in tests/integration/gameplay.test.ts; run two-browser scenario and record actual evidence in docs/verification.md.

Checkpoint: US1+US2 is the first playable multiplayer slice, already using default theme interfaces.

## Phase 5: User Story 3 - Spectating and Reconnect (Priority: P2)

**Goal**: Observe active games and resume reserved identities without reopening the roster.
**Independent test**: Third account switches targets; reconnecting participant retains state.

- [ ] T026 [US3] Implement spectate admission, selected-target authorization, cap races, player list and leave cleanup in apps/server/src/lobby/spectators.ts; zero allowed spectators disables admission and observers do not change roster/NPC counts.
- [ ] T027 [US3] Implement target-derived camera/HUD/death snapshots and target-unavailable events in apps/server/src/transport/spectator-view.ts; no spectator control input and no cross-room target access.
- [ ] T028 [US3] Implement target selection, switching, countdown, Back to Players/Back to Lobby and standings navigation in apps/client/src/spectate.ts using SkinHost extension slots.
- [ ] T029 [US3] Implement account-bound 60-second reservations, latest-connection replacement, stale-close guards, continued death deadlines, explicit leave forfeiture and empty-running-room abandonment in apps/server/src/lobby/reconnect.ts.
- [ ] T030 [US3] Verify reconnect expiry, preserved points/deadlines, duplicate sockets, spectator counts/targets/death view and empty-room cleanup in tests/integration/spectate-reconnect.test.ts; record three-profile scenario in docs/verification.md.

## Phase 6: User Story 4 - Developer Themes (Priority: P2)

**Goal**: Prove behavioral/presentation overrides and safe package installation.
**Independent test**: Default and fixture run together; incompatible upload fails atomically.

- [ ] T031 [US4] Implement revision compatibility, digest pinning, enabled flags and referenced-revision retention in apps/server/src/themes/registry.ts and apps/client/src/themes.ts; validate engine/module/state/renderer versions before start.
- [ ] T032 [US4] Implement operator bootstrap CLI in tools/operator.ts and reviewed module/renderer registration in tools/install-theme-code.ts; allow no public role escalation or uploaded executable code.
- [ ] T033 [US4] Implement streaming ZIP/manifest/asset validation and atomic content-addressed installation in apps/server/src/themes/packages.ts and tools/validate-theme.ts; enforce all byte/entry/pixel/path/type/hash limits from contracts/themes.md.
- [ ] T034 [US4] Implement operator-only upload/enable endpoints and UI in apps/server/src/themes/routes.ts and apps/client/src/admin-themes.ts; normal creators select enabled installed themes from lobby settings.
- [ ] T035 [US4] Create alternate enemy capability and replacement HUD fixture in themes/fixture/module/index.ts, themes/fixture/skin/index.ts and themes/fixture/theme.json without modifying core; verify multiple renderer instances dispose cleanly.
- [ ] T036 [US4] Build theme preview with deterministic life/death/combat/pickup/spectator/results fixtures in tools/theme-preview.ts and document build/install/override ownership in docs/theme-development.md, including external themes repository layout, pinned SDK consumption, extension examples and owner handoff; expose root npm theme commands.
- [ ] T037 [US4] Verify SDK conformance, behavior/HUD replacement, pinned active versions, secret-free snapshots, malformed/incompatible/traversal/oversized/executable uploads and role checks in tests/contract/themes.test.ts and tests/integration/theme-install.test.ts; add an external-consumer build fixture in tests/contract/external-theme/ using only the public pinned SDK.

## Phase 7: User Story 5 - Operations and Capacity (Priority: P3)

**Goal**: Run on Lightsail and report measured limits rather than guesses.
**Independent test**: Controlled external workloads exercise 1/3/5 rooms and produce metrics.

- [ ] T038 [US5] Implement bounded host/per-session metrics, timing histograms, event-loop delay, CPU/RSS, bytes/buffers/RTT/counts and operator-only metrics export in apps/server/src/runtime/metrics.ts and apps/client/src/admin-metrics.ts; no high-cardinality username labels.
- [ ] T039 [US5] Implement synthetic-account external protocol load harness with independent rooms/players/spectators and pursuing/firing behaviors in tools/load/index.ts and tools/load/workloads.json; support seeded runs, warm-up/steps/soak and machine-readable results.
- [ ] T040 [US5] Add systemd/Nginx HTTPS-WSS examples, env/data permissions, restart/readiness, safe SQLite backup/restore and co-hosted-service notes in deploy/game.service, deploy/nginx.conf and deploy/README.md; use EnvironmentFile=/etc/multiplayer-game/game.env, preserve existing HTTPS setup recorded in docs/hosting.md, and do not provision or alter live AWS without instruction/access.
- [ ] T041 [US5] Verify restart reconciliation/account/results durability, failure isolation, slow consumers, queue limits and shutdown behavior in tests/integration/operations.test.ts; run a local load-harness smoke check and record conditions in docs/verification.md.
- [ ] T042 [US5] On an authorized provisioned target, execute quickstart.md capacity matrix from a separate host and write revision/hardware/settings/metrics/failures/30-minute-soak results in docs/capacity-report.md; leave unchecked until real execution.

## Phase 8: Polish and Cross-Cutting Concerns

- [ ] T043 Run actual build/check/test and quickstart.md browser scenarios, review contracts/settings for drift and resolve findings in docs/verification.md; do not claim runtime checks for planning-only artifacts.
- [ ] T044 Update README.md with actual install/start commands and shipped state, add agent work evidence to docs/agent-work-log.md and a separate unfilled student reflection guide at docs/student-reflection.md; never fabricate the student's own-word reflections.

## Dependencies & Execution Order

Setup T001–T003 → Foundation T004–T008 → US1 T009–T014 → US2 T015–T025 →
US3 T026–T030 → US4 T031–T037 → US5 T038–T042 → Polish T043–T044.
US2 can use synthetic members for isolated simulation checks but requires US1 for the
real player journey. US3 requires US1+US2. US4's SDK/default interfaces are foundational
(T005/T017); package tooling can follow gameplay. US5 instruments all completed stories.
T042 has an external deployment dependency and cannot be marked complete from local smoke checks.

## Parallel Opportunities

Default execution remains sequential. After shared contracts are stable, optional
file-isolated work could pair US1 auth tests with client forms, US2 map tests with
skin drawing, US3 spectator UI with server target serialization, US4 developer guide
with package validator fixtures, and US5 load workloads with operational documentation.
These are examples for future explicitly coordinated work, not concurrent edits now.

## Implementation Strategy

First validate US1 account/lobby slice, then complete US2 as the playable MVP. Add
spectating/reconnect, full developer theme tooling and operational evidence in order.
Commit logical slices, keep task status accurate, and run convergence after implementation.
T001–T008 establish the project setup and blocking runtime foundation. User-story implementation tasks remain unchecked.
