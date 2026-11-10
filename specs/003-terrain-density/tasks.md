# Tasks: Per-Level Terrain Density

Scoped sequential feature; retains original engine and Theme Credits context.

- [x] T001 Specify schedules, compatibility, coverage and public map transition
  in spec.md, plan.md, contracts/terrain.md and requirements checklist.
- [x] T002 Add failing schedule/coverage/connectivity/atomic transition tests in
  tests/terrain-density.test.ts and extend existing host settings/runtime tests.
- [x] T003 Implement protocol schedule validation/resolution and host editor.
- [x] T004 Implement optional public initial-map/transition services and engine
  atomic geometry/entity replacement with retired navigation work.
- [x] T005 Implement default generated terrain and intermission/boundary wiring,
  preserved respawn/player state and coverage presentation.
- [x] T006 Synchronize canonical settings/themes/realtime contracts and developer
  guide; run focused tests/checks and record measured coverage/results here.

T002 follows T001; T003 follows T002; T004 follows T003; T005 follows T004;
T006 follows T005. No blocked Theme Credits task or original T042 is a prerequisite.
T042 must remain open. No commits, push, deployment or unrelated edit removal.

## Scoped NPC playtest follow-up (2026-11-09)

- [x] T007 Reproduce default Fixed wave-start roaming with actual browser evidence;
  remove the initial navigation wait without changing speed-zero behavior; add
  sticky closest-two pursuit/contact slots per player, verify replacement and
  multiplayer isolation, and document the observed visibility limits.
  Authorized follow-up to T006/FR-008; leave original T042 open and changes local.

T007 evidence: `docs/verification.md` records the successful pre-change default
roaming observation (no sustained stall reproduced), the initial queue wait and
visibility limits, two passing post-change browser runs with actual world
draw/pixel movement, 9 focused files / 88 passing tests and `npm run check`.
The initially failing integration navigation fixture staged an NPC inside
existing Fixed terrain. The authorized follow-up replaced only that start and
its distance references with verified-clear `(112,16)`; all four cases in
`tests/integration/gameplay.test.ts` then passed with unchanged assertions/timeouts.
The user authorized committing only this scoped work after that pass, superseding
the earlier no-commit instruction for this slice; unrelated edits remain unstaged.
Original T042 is unchanged and open. No extension hooks file exists.

## Evidence

Checklist: 16 checked, 0 unchecked (PASS). The prerequisite helper resolved this
feature and its contracts/tasks. No extension hooks file exists.
Initial unrelated edits: docs/verification.md,
tests/integration/accounts-lobby.test.ts and .idea/; preserve them.

2026-11-08 local Windows/npm workspace execution:

The first `npm test -- tests\terrain-density.test.ts` failed all seven initial
cases on missing resolver/generator/transition exports. Subsequent iteration
caught two implicit-any hook parameters, optional settings fields not satisfying
the module JSON boundary (now validated/narrowed), and a test comparing fresh
walkability function identities instead of deterministic definition/coverage.
A saved-settings check exposed generic settings errors; the existing registry
now identifies mapMode/terrainDensity issues while retaining other error behavior.
No failed run is counted as passing.

Final `npm run check` and explicit engine workspace build passed. The focused
regression selection passed **17 files / 136 tests**:

```powershell
npm test -- tests\terrain-density.test.ts tests\integration\terrain-settings.test.ts tests\lobby-settings.test.ts tests\maps.test.ts tests\generated-map-integration.test.ts tests\integration\generated-map-runtime.test.ts tests\integration\session-lifecycle.test.ts tests\default-skin.test.ts tests\default-theme.test.ts tests\default-entities.test.ts tests\default-combat.test.ts tests\default-respawn.test.ts tests\npc-spawns.test.ts tests\wave-countdown.test.ts tests\radar.test.ts tests\integration\gameplay.test.ts tests\protocol.test.ts
```

Coverage measured by executing the built public default-theme generator with
seed 42, independently checked against summed non-overlapping solid rectangle
area / (2048 * 2048) * 100:

| Level | Density | Target | Actual coverage | Solid rectangles | Target limited |
| --- | --- | --- | --- | --- | --- |
| 1 | 0 | 0% | 0% | 0 | No |
| 1 | 3 | 24% | 23.9990234375% | 380 | No (whole-cell rounding) |
| 1 | 10 | 80% | 74.462890625% | 221 | Yes, safe routes/spawns |
| 2 | 3 | 24% | 23.9990234375% | 362 | No (whole-cell rounding) |

Density 10 falls short by 5.537109375 percentage points, explicitly reported in
the snapshot/HUD/metrics. Protected-area route selection also depends on the
private seed/level/density stream, including at constrained density 10.

Both schedules, capped/steady increments, default 3/0, malformed/noninteger/null
values and Per Level count changes are checked. HTTP create/read/SQLite settings
round-trip both schedules and preserve legacy explicit health/absent fields.
Host UI checks select/submit both schedules and preserve saved legacy settings.
Fixed remains 64 tiles; legacy generated layouts and unchanged across-wave maps
pass their existing tests.

All authored spawns pass radius plus 64 terrain clearance at 0/3/10. Every open
cell is connected at radius 14 using actual collision-resolved edges. Seed,
level and density reproduction/change checks pass. Engine tests reject blocked
placements without mutation, unknown/reused/cross-session tokens and clear
outstanding old navigation work.

The real lifecycle test runs a loopback HTTP/WebSocket server with authenticated
player and selected-target spectator sockets. One stationary 1-HP NPC per wave
is staged in a verified clear lane (no terrain/combat/progression replacement).
Normal firing kills wave 1, prepares density 3 during the real 150-tick
intermission, keeps density 0 geometry/DB level 1 until the boundary, then
publishes matching new map/radar to both sockets. New obstacle centers become
authoritatively solid; all live entities are walkable. Wave 2 combat completes
normally with saved 200 points/two kills and one immutable result/released slot.
This is an executed real transport/runner transition, not a browser claim.

A separate actual module/world transition verifies blocked movement and
projectiles plus found navigation paths on the new geometry; living health/score
survive, and a dead player's original 301-tick return deadline and points remain
intact before safely respawning on the new map. Skin checks render boundary
geometry directly and show measured coverage/shortfall for both roles.
Existing wandering, pursuit, growth, countdown, combat and respawn checks pass.

Additional public-package/contract checks passed **2 files / 11 tests**, with the
immutable revision drift gate **explicitly skipped (1 test)**:

```powershell
npm test -- tests\theme-package-contract.test.ts tests\contract\themes.test.ts -t '^(?!.*builds and loads an isolated external consumer).*'
```

The packed handoff API remains usable. The immutable external-consumer pin is
unchanged: public protocol/SDK edits remain uncommitted and require a reviewed
revision before that gate can pass. No drift-gate success is claimed.

No dependency/manifests, theme digest or installed legacy records were migrated.
No browser/capacity/deployment run is claimed. No commit, push or deployment was
performed; original T042 stays unchecked. Feature selection is now the new
checkout-local specs/003-terrain-density pointer.

## Evidence

- [x] T011 Implement and verify the hidden configurable 60-second no-kill timer,
  confirmed shared kill resets, fresh wave starts, timeout standings/message,
  preserved fixed-deadline SDK option, compact Score/Health and intermission.
  Authorized independently of blocked T010; keep NPC behavior and T042 unchanged.

T011 evidence: `docs/verification.md` records 19 focused files / 121 passing
tests, workspace check, engine/client builds, browser-script syntax and whitespace
checks. Real Chrome compact-match verification passed for both roles at three
desktop sizes (36.375-pixel Score/Health bar, no timer, intermission standings
and next-wave countdown). The actual 8-second idle browser timeout showed
identical saved final standings/message for player and spectator, including
reload. Deterministic authority checks cover default 60-second expiry,
another player's confirmed kills at 59/118/177/236 seconds extending beyond the
old 168-second deadline, non-kill activity not resetting, and a fresh next-wave
timer. Public-theme checks passed 4 tests with the immutable external-consumer
drift gate explicitly skipped until a reviewed public-contract revision exists.
Failure/correction history is retained. SDK fixed Countdown remains available;
NPC code is unchanged, T010/live roaming and original T042 remain open.
No hooks file exists; no push or deployment was performed.
