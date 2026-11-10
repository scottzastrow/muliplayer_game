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

## Compact match view and live roaming follow-up (2026-11-09)

- [x] T009 Compact player and selected-target spectator views: hide application
  and theme headings, use one slim Score/Health bar with compact Back to Lobby,
  retain arena radar without duplicate level/enemy labels, fill the
  desktop viewport without page scrolling, preserve lobby and wave standings.
  Verify both roles at normal desktop sizes with actual browser evidence.
- [ ] T010 Keep the reported deployed `1e94ff3` roaming issue open until a
  15-second trace of visible out-of-range NPC positions in that live Fixed match
  is available. Report positions advancing or the access/trace blocker; local
  evidence does not close the live report. Do not change AI without reproducing
  the cause. No push or deployment.

T009 is authorized independently of T010. Existing T008 local observations do
not resolve the user's reported deployed behavior.

T009 evidence: both roles passed actual Chrome desktop-window checks at
1366x768, 1440x900 and 1920x1080, a 36.375-pixel active bar, arena filling the
remaining viewport, no page scrolling, reachable overlay filters and smallest-
window intermission standings. Roster/re-follow and lobby restoration passed.
Default-theme build, client type-check/production build and 7 files / 56 focused
tests passed. The mock cleanup failure and intermediate standings/navigation
ordering issue were corrected and rerun. See docs/verification.md for exact
conditions and persisted screenshots.

T010 remains blocked for the reported deployment: no attached live session/
browser trace or IDE run configuration is available for that process. A separate
unstaged local Fixed seed-12 run traced 233 snapshots over 15.430 seconds.
Visible, continuously out-of-range npc:npc-northeast advanced in all three
five-second windows (51.69/74.88/74.69 world units), world-painted in 233/233
samples. This does not close the deployed report. No AI code was changed.
Original T042 is unchanged; no push or deployment was performed.

## Explore default and match focus follow-up (2026-11-09)

- [x] T012 Make Explore the default state of every mobile Dots and Squares NPC
  on every wave (half configured speed, seeded reachable novelty destinations,
  first-update movement, bounded retries, short pauses; speed 0 stationary).
  Only holders of the two existing pursuit slots chase or deal contact damage;
  others keep exploring in range; exploration resumes immediately after pursuit.
  Focus the game surface once on match entry/rejoin with normal Tab afterward.
  Verify per-NPC 30-second idle traces with four NPCs in range and no-click
  keyboard movement locally. The owner now authorizes separate scoped Explore
  and focus commits and a non-force push; no live-release switch.
- [ ] T013 Verify Explore roaming in a normal browser match on the deployed
  release after an authorized deployment; until then the `4b7371c` playtest
  failure (and T010) stays unresolved. Keep T042 open.

T012 evidence (local only; see docs/verification.md): the deterministic
30-second default Fixed seed-42 trace with four staged NPCs in range of an idle
player kept the two closest in pursuit for 899/900 ticks and every other NPC
exploring 978.24-1002.57 units with a longest stationary interval of
0.233-0.367 s, including the two in-range NPCs without slots (978.24 and
991.56 units). A real local Chrome 157 window (Fixed seed 42) focused the arena
2 ms after mount, moved 66 units on an arrow key without a click, left focus on
Tab, refocused on rejoin and moved 84 units after respawn. Its 30-second idle
trace showed all eight non-pursuing NPCs exploring 1001.30-1015.21 units with
longest stationary intervals of 0.133-0.333 s. The browser saw at most three
NPCs in range at once, so its four-in-range condition is not browser-verified.
No deployed-release run was possible from this environment.

Commit-review evidence: build and workspace check passed; the final full suite
has 298 passing / 2 failing tests (50 passing / 2 failing files). Both failures
were reproduced from an isolated archive of HEAD
`4b7371c6a6b4a3f7e3606a9c1328a6be43d0fe35`: the stale migration-list expectation
and the invalid-movement mock preventing NPC spawn selection. Exact errors and
the browser's three-in-range limit are recorded in `docs/verification.md`.
T010, T013 and original T042 stay open. Ranged combat is not authorized until
the owner confirms sustained exploration after deployment in a normal live
match; its eventual implementation must remain local for review.

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
