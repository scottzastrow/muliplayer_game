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
- [X] T018 [US2] Implement a shared validated map format, Fixed/default and Simple Generated source-selected map modes, seeded connected-map generation, obstacles, legal placement and bounded fallback in packages/theme-sdk/src/maps.ts and themes/default/module/maps.ts; 2048×2048 world and 32-unit cells per contracts/settings.md.
- [X] T019 [US2] Implement normalized player movement, proximity NPC pursuit and capability-based attacks in themes/default/module/entities.ts; use settings.md speeds/range/contact cooldown and capped navigation work.
- [X] T020 [US2] Implement authoritative shots/hits, single-claim health/rapid-fire/spread pickups, timed effects, caps and score/death accounting in themes/default/module/combat.ts and themes/default/module/pickups.ts; use settings.md tuning and no friendly fire.
- [X] T021 [US2] Implement roster-frozen growth formulas, overflow-safe preflight, five-second intermissions, max-level completion and idempotent finalization in themes/default/module/progression.ts, apps/server/src/runtime/session-lifecycle.ts and apps/server/src/storage/results.ts; verify normal session-start completion in tests/integration/session-lifecycle.test.ts without truncating NPC totals.
- [X] T022 [US2] Implement configurable five-second death deadline and bounded random-safe respawn in themes/default/module/respawn.ts; retain score, avoid obstacle/projectile/enemy contact plus margin, retry if blocked, and provide no immunity flag or early level-transition respawn.
- [X] T023 [US2] Implement skin host, interpolation, centered camera, input bindings and default shapes/HUD in apps/client/src/skin-host.ts and themes/default/skin/index.ts; points largest, health visible, camera independent per player and viewport resize supported.
- [X] T024 [US2] Implement match-end standings/result reload and back-to-lobby controls in themes/default/skin/results.ts and apps/client/src/results.ts with deterministic tie ordering from spec.md.
- [X] T025 [US2] Verify deterministic navigation, local attraction, no pickup duplication, growth, simultaneous last kills, death timing/no immunity, safe-spawn failure and five-session isolation in tests/integration/gameplay.test.ts; run two-browser scenario and record actual evidence in docs/verification.md.

Map-mode follow-up (2026-11-08), T018/T036/T043: Simple Generated selects one
validated seed-based layout for world/module collision, navigation, shots,
presentation and radar across waves; Fixed remains the shipped source default.
The developer guide documents mode selection, bounded fallback and disposable
seed reproduction. The diagnostic Chrome resume passed once with seed 42,
retaining the movement/shot/radar assertions and completing the full walk-around.
The previously failing north leg went from (530,463.999976) to
(530,385.999976), facing (0,-1), on a continuous radius-14 clear route.
No geometry or timeout changes were made; that earlier leg failure was not
reproduced and its cause remains unknown. Exact inputs/bounds and local conditions
are recorded in docs/verification.md. This does not complete T042 or constitute
deployment, human visual, cross-browser or capacity evidence.
After restoring Fixed, workspace build/check and diff validation passed; the
focused map/runtime/theme/combat/skin/lifecycle selection passed 7 files,
37 tests, including the seed-42 full-radius walk-around regression.

T022 local evidence: the affected gameplay/transport selection passed (6 files,
29 tests), followed by the full regression suite including the additional
fractional/zero-delay case (15 files, 72 tests). `npm run check` and
`git diff --check` passed. No browser or deployment scenario was executed;
T023 was not included in that slice.

T023 local evidence: `npm run check`, `npm run build` and the full regression
suite passed (16 files, 76 tests). `npm run test:browser` passed with two real,
visible Chrome windows and separate authenticated cookie contexts, verifying
independent controls, centered cameras, nearby visibility, HUD, mouse fire/release
and resize. Public-host fixtures also checked shape rendering, death HUD,
compatibility rejection and disposal. See docs/verification.md for conditions
and harness corrections. T024 was not included in that slice.

T024 local evidence: workspace check/build passed; affected tests passed (7 files,
35 tests), including saved-result authentication/reload, normal completion
notification, terminal-result labeling and deterministic tie ordering. The Chrome
browser scenario passed through a normal one-level completion, final table,
saved-result reload, full page refresh, missing-result retry and lobby navigation.
Details and harness failures are recorded in docs/verification.md.

T025 local evidence: full test suite passed (18 files, 85 tests), workspace
type-check/build passed, and the two-window Chrome scenario completed a shared
two-level match through normal lobby/start/Play and mouse controls. Both players
received identical standings and retained them after full page refreshes. At five
active sessions, creation failed with SESSION_CAPACITY; completion removed the
finished session and allowed a replacement. Integrated tests also verify bounded
deterministic navigation, local attraction, single-claim pickups, roster growth,
simultaneous final hits, five-second safe respawn/no immunity and five isolated
module worlds. Actual conditions and fixture corrections are in
docs/verification.md. T026 was not started.

Checkpoint: US1+US2 is the first playable multiplayer slice, already using default theme interfaces.

Focused wave-countdown follow-up (2026-11-07): FR-021 extends the existing
T005/T021/T023/T027 paths with a reusable monotonic countdown, initially using
60 + 3 seconds per starting NPC (300-second cap; retuned below), unchanged respawn/progression
rules, player/spectator HUD time and once-only timeout standings finalization.
`npm run check` passed; the final focused selection passed (11 files, 56 tests).
Actual conditions and initial fixture failures are in docs/verification.md.
This focused change does not complete T042 or the polish tasks;
no browser, deployment or separate-host capacity run was performed.

Separate timer-retuning follow-up (2026-11-08), T021/FR-021: Dots and Squares
now uses `min(360, 120 + 6 * starting NPC count)` seconds. Shared countdown API,
growth and timeout standings behavior are unchanged. Before speed edits,
`npm run check` and the focused timer selection passed (5 files, 37 tests).
An initial lifecycle test failed waiting for the first NPC kill; the follow-up
clear-lane fixture below resolved the failure and passed in the final suite.

Separate NPC-settings follow-up (2026-11-08), T004/T013/T019 and FR-005:
validated `npcMovementSpeed` and `npcDetectionRange` are exposed in host
create/edit settings. Movement defaults to 67.5 units/second; detection defaults
to the previous 512-world-unit distance and accepts 0–700, with zero disabling
automatic pursuit. Older settings resolve both defaults without a migration.
The public consumer pin was advanced after commit
`8c1238c9e4d11a08bba306c89e03b89dd3de6290`. Final `npm run check` passed and
`npm test` passed (42 files, 198 tests). No browser, deployment or capacity
result is claimed; T042 remains open. Actual checks and the initial fixture
failure are recorded in docs/verification.md.

Lifecycle fixture follow-up (2026-11-08), T021: terminal diagnostics resolved the
outstanding first-kill failure as a terrain-blocked fixed shot at a moving NPC.
The test now stages a stationary NPC in a verified open lane for each wave,
retaining real WebSocket input, projectile combat, both kills, progression,
saved results and slot release without increasing any timeout. The corrected
lifecycle reruns passed; the fixture was committed with the NPC settings change.
The full suite also required the integrated gameplay fixture to use the same
verified open lane; that correction is in
`47addd0c5af35a9dd1f67724f29e6b3654076f09`. Details are in
docs/verification.md. T042 remains open.

## Phase 5: User Story 3 - Spectating and Reconnect (Priority: P2)

**Goal**: Observe active games and resume reserved identities without reopening the roster.
**Independent test**: Third account switches targets; reconnecting participant retains state.

- [X] T026 [US3] Implement spectate admission, selected-target authorization, cap races, player list and leave cleanup in apps/server/src/lobby/spectators.ts; zero allowed spectators disables admission and observers do not change roster/NPC counts.
- [X] T027 [US3] Implement target-derived camera/HUD/death snapshots and target-unavailable events in apps/server/src/transport/spectator-view.ts; no spectator control input and no cross-room target access.
- [X] T028 [US3] Implement target selection, switching, countdown, Back to Players/Back to Lobby and standings navigation in apps/client/src/spectate.ts using SkinHost extension slots.
- [X] T029 [US3] Implement account-bound 60-second reservations, latest-connection replacement, stale-close guards, continued death deadlines, explicit leave forfeiture and empty-running-room abandonment in apps/server/src/lobby/reconnect.ts.
- [X] T030 [US3] Verify reconnect expiry, preserved points/deadlines, duplicate sockets, spectator counts/targets/death view and empty-room cleanup using tests/reconnect.test.ts, tests/default-respawn.test.ts, tests/integration/realtime.test.ts, tests/integration/spectators.test.ts and tests/spectator-view.test.ts; add the three-profile Chrome flow in tests/browser/reconnect.mjs and record evidence in docs/verification.md.

T026 local evidence: affected checks passed (5 files, 25 tests) and workspace
type-check passed. Admission races, zero capacity, repeated admission/leave,
same-session followable targets, departed/disconnected/dead targets, role/origin
validation, isolated player/NPC counts, socket replacement and slot cleanup are
covered in tests/integration/spectators.test.ts. The normal match-completion
integration also verifies terminal spectator cleanup. See docs/verification.md.
T027 target-derived views/events and T028 browser controls remain unstarted.

T027 local evidence: affected checks passed (6 files, 34 tests), workspace
type-check passed, and diff validation passed. Selected-player projection includes
camera, HUD, death countdown/deadline and blocked status; real module tests follow
death through safe respawn. Socket tests verify target loss, refreshed same-room
followable lists, switching, no snapshots without a selection, forbidden spectator
input, cross-room rejection and discarded old-target pending snapshots. Details
are in docs/verification.md. T028 remains unstarted.

T028 local evidence: affected tests passed (6 files, 26 tests), workspace
type-check/build passed, and the three-window Chrome browser scenario passed.
The observer joined through Spectate, followed/switched players, received the
unavailable-target list, returned to the lobby with the slot released, and saw
the same saved standings after normal match completion. The public skin-host
fixture verified spectator countdown/HUD/respawn camera and zero controls.
Actual evidence and synthetic-fixture limitations are in docs/verification.md.
T029 was not started.

## Phase 6: User Story 4 - Developer Themes (Priority: P2)

**Goal**: Prove behavioral/presentation overrides and safe package installation.
**Independent test**: Default and fixture run together; incompatible upload fails atomically.

- [X] T031 [US4] Implement revision compatibility, digest pinning, enabled flags and referenced-revision retention in apps/server/src/themes/registry.ts and apps/client/src/themes.ts; validate engine/module/state/renderer versions before start.
- [X] T032 [US4] Implement operator bootstrap CLI in tools/operator.ts and reviewed module/renderer registration in tools/install-theme-code.ts; allow no public role escalation or uploaded executable code.
- [X] T033 [US4] Implement streaming ZIP/manifest/asset validation and atomic content-addressed installation in apps/server/src/themes/packages.ts and tools/validate-theme.ts; enforce all byte/entry/pixel/path/type/hash limits from contracts/themes.md.
- [X] T034 [US4] Implement operator-only upload/enable endpoints and UI in apps/server/src/themes/routes.ts and apps/client/src/admin-themes.ts; normal creators select enabled installed themes from lobby settings.
- [X] T035 [US4] Create alternate enemy capability and replacement HUD fixture in themes/fixture/module/index.ts, themes/fixture/skin/index.ts and themes/fixture/theme.json without modifying core; verify multiple renderer instances dispose cleanly.
- [X] T036 [US4] Build theme preview with deterministic life/death/combat/pickup/spectator/results fixtures in tools/theme-preview.ts and document build/install/override ownership in docs/theme-development.md, including external themes repository layout, pinned SDK consumption, extension examples and owner handoff; expose root npm theme commands.
- [X] T037 [US4] Verify SDK conformance, behavior/HUD replacement, pinned active versions, secret-free snapshots, malformed/incompatible/traversal/oversized/executable uploads and role checks in tests/contract/themes.test.ts and tests/integration/theme-install.test.ts; add an external-consumer build fixture in tests/contract/external-theme/ using only the public pinned SDK.

T031 local evidence: `npm run check` passed, including workspace type-checks and
the protocol/theme SDK/default-theme builds. The affected theme SDK, default-theme,
client resolver, lobby and realtime tests passed (6 files, 25 tests). Coverage
includes incompatible engine/module/renderer metadata, client digest mismatch,
disabled-revision admission rejection, and continued resolution of an active
match's exact pinned revision after disablement. `git diff --check` passed.
No browser, deployment or load test was run; T032 was not included in that slice.

T032 local evidence: focused operator/theme-code tests passed (1 file, 3 tests),
and `npm run check` passed, including the tools type-check. No browser,
deployment or load test was run; T033 was not started.

T033 local evidence: focused theme-package validation tests passed (1 file, 4
tests), and `npm run check` passed, including the tools type-check. No browser,
deployment or load test was run; T034 was not started.

T034 local evidence: focused theme-package and operator API tests passed (2
files, 5 tests), and `npm run check` passed. Tests verify regular-account upload
and toggle denial, invalid-upload registry atomicity, preservation of a running
match's pinned theme after disablement, and rejection of new sessions using a
disabled theme. No browser, deployment or load test was run; T035 was not started.

T035 local evidence: focused fixture and session integration tests passed (2
files, 4 tests), and `npm run check` passed. Coverage verifies the fixture
revision's public definition and client compatibility, fleeing enemy movement
against default pursuit, isolated HUD/renderer instances with clean disposal,
and Dots and Squares plus fixture sessions running concurrently. No browser,
deployment or load test was run; T036 was not started.

T036 local evidence: focused preview fixture tests passed (1 file, 2 tests),
and `npm run check` passed. Snapshot fixtures passed the default view schema for
living, death/respawn, combat, pickup and spectator cases; saved results passed
the public result schema. The deterministic Vite renderer preview and theme
development/consumer ownership guide are implemented. The browser preview itself
was not launched; T037 was not started.

T037 local evidence: the focused six-file contract/install/fixture/package/admin
selection passed (16 tests), followed by one successful `npm run check`.
The isolated external consumer packed and installed real public SDK/protocol/Zod
tarballs offline, compiled against public SDK exports and loaded the compiled
module. Coverage includes behavior/HUD replacement, isolated instances, active
revision pins, secret-free snapshots, upload limits/atomicity and role enforcement.
The Windows subprocess failure was reproduced once: `cmd.exe` quoting reached npm
as a literal quoted `pack` command (exit 1, empty stderr). The test now invokes
npm's JavaScript CLI through Node and includes captured subprocess diagnostics on
failure. No browser, deployment or load test was run; T038 was not started.

## Phase 7: User Story 5 - Operations and Capacity (Priority: P3)

**Goal**: Run on Lightsail and report measured limits rather than guesses.
**Independent test**: Controlled external workloads exercise 1/3/5 rooms and produce metrics.

- [X] T038 [US5] Implement bounded host/per-session metrics, timing histograms, event-loop delay, CPU/RSS, bytes/buffers/RTT/counts and operator-only metrics export in apps/server/src/runtime/metrics.ts and apps/client/src/admin-metrics.ts; no high-cardinality username labels.
- [X] T039 [US5] Implement synthetic-account external protocol load harness with independent rooms/players/spectators and pursuing/firing behaviors in tools/load/index.ts and tools/load/workloads.json; support seeded runs, warm-up/steps/soak and machine-readable results.
- [X] T040 [US5] Add systemd/Nginx HTTPS-WSS examples, env/data permissions, restart/readiness, safe SQLite backup/restore and co-hosted-service notes in deploy/game.service, deploy/nginx.conf and deploy/README.md; use EnvironmentFile=/etc/multiplayer-game/game.env, preserve existing HTTPS setup recorded in docs/hosting.md, and do not provision or alter live AWS without instruction/access.
- [X] T041 [US5] Verify restart reconciliation/account/results durability, failure isolation, slow consumers, queue limits and shutdown behavior in tests/integration/operations.test.ts; run a local load-harness smoke check and record conditions in docs/verification.md.
- [ ] T042 [US5] On an authorized provisioned target, execute quickstart.md capacity matrix from a separate host and write revision/hardware/settings/metrics/failures/30-minute-soak results in docs/capacity-report.md; leave unchecked until real execution.

T038 local evidence: the focused metrics/browser-view/realtime/lifecycle selection
passed (5 files, 17 tests), followed by one successful `npm run check`. Coverage
includes fixed histogram buckets, bounded session/module series and release,
actual sent bytes, queued snapshots/slow consumers, operator authorization,
live runner/transport/process/event-loop measurements and JSON view/download
error handling. The initial TS2339 was caused by serializer type narrowing;
explicit session entity/tick fields preserve the runtime response and assertion
without casts. No real-browser, deployment or load test was run; T039 was not
started.

T039 local evidence: the focused workload/unit and external-protocol integration
selection passed once (2 files, 4 tests), followed by one successful
`npm run check`. Automated local HTTP/WebSocket checks exercised two independent
rooms, players and spectators, warm-up/steps/short soak, moving/firing intents,
snapshot/RTT measurements, logout cleanup and explicit origin-error reporting.
The harness uses only public HTTP/socket paths, keeps credentials in memory,
bounds client queues/histograms and emits machine-readable reports. Its seed
controls client decisions given snapshots; the public API does not permit
selecting server map seeds, so reports record first-map fingerprints and pins.
The supplied 1/3/5-room, 30-minute template was not executed. No separate-host
capacity, deployment or real-browser test was run; T040 was not started.

T040 local evidence: the focused deployment selection passed once (1 file,
4 tests), followed by one successful `npm run check`. The initial import failure
was a root-test resolution error: better-sqlite3 is installed and declared in the
server workspace. The test now uses the existing `openDatabase` entry point,
without adding dependencies or changing the lockfile. Checks cover compiled
startup/migration paths, EnvironmentFile, private state permissions, restart
settings, TLS/Origin/Upgrade proxy examples and runbook safeguards. A temporary
SQLite fixture verified committed WAL backup, integrity/foreign keys, matching
assets and clean-tree restore with old sidecars retained separately. The examples
preserve the reported hosting baseline and document readiness and co-hosted-service
precautions. Linux-native `systemd-analyze verify`, `nginx -t`, Certbot renewal,
public HTTPS/authenticated WSS, deployed readiness/permissions and an isolated
target restore drill remain pending operator deployment gates; no live host
commands or changes were performed. T041 was not started.

T041 local evidence: the operations integration test passed once (1 file,
5 tests), including the actual CLI smoke against a disposable loopback server;
`npm run check` passed once. Workload conditions, observed results and the
separate live-host gates are recorded in docs/verification.md. T042 was not
started.

## Phase 8: Polish and Cross-Cutting Concerns

- [X] T043 Run actual build/check/test and quickstart.md browser scenarios, review contracts/settings for drift and resolve findings in docs/verification.md; do not claim runtime checks for planning-only artifacts.
- [ ] T044 Update README.md with actual install/start commands and shipped state, add agent work evidence to docs/agent-work-log.md and a separate unfilled student reflection guide at docs/student-reflection.md; never fabricate the student's own-word reflections.
- [X] T045 Add account-saved Dots and Squares control selection, existing-account first-sign-in prompt and lobby editing; implement keyboard-only and keyboard+mouse input, persistent per-player colors and aim-facing indicators, with account, theme, spectator and real-browser coverage.
- [X] T046 [US2] Implement placement-only scattered NPC waves for FR-024 in themes/default/src/module/npc-spawns.ts, entities.ts and index.ts; use match seed/wave, reachable zones, terrain/player/NPC clearance and bounded explicit fallback without changing counts, health, terrain or detection settings; verify both map modes in tests/npc-spawns.test.ts and tests/browser/npc-spawns.mjs, and document reproduction/fallback in docs/theme-development.md and actual evidence in docs/verification.md.

T046 local evidence (2026-11-08): focused checks passed (11 files, 69 tests),
and `npm run check` passed. Visible local Chrome 156.0.8078.80 passed the
seed-42 `--npc-spawns` scenario once per map mode: unchanged default 10 NPCs,
100 HP, 67.5 movement speed and 512 detection range; 10 occupied zones, all four
arena quadrants and 10 rendered radar dots in each run. Fixed was restored after
the generated-mode fixture. Conditions, initial test-fixture failures and final
check totals are recorded in docs/verification.md. T042 remains unchecked. No
deployment or capacity evidence is claimed.

## Dependencies & Execution Order

Setup T001–T003 → Foundation T004–T008 → US1 T009–T014 → US2 T015–T025 →
US3 T026–T030 → US4 T031–T037 → US5 T038–T042 → Polish T043–T044.
US2 can use synthetic members for isolated simulation checks but requires US1 for the
real player journey. US3 requires US1+US2. US4's SDK/default interfaces are foundational
(T005/T017); package tooling can follow gameplay. US5 instruments all completed stories.
T042 has an external deployment dependency and cannot be marked complete from local smoke checks.
T046 is a separate placement follow-up to completed T018/T019/T021 and the
T036 developer guide; it does not depend on or complete T042.

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
