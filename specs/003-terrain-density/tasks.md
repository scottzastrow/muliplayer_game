# Tasks: Per-Level Terrain Density

Scoped sequential feature; retains original engine and Theme Credits context.

## First-Person steering scoping (2026-11-10)

- [x] T020 Add the owner-confirmed separate First-Person setting with Keyboard
  Only bindings. Persist it without rewriting existing choices; dispatch the mode
  in default-theme combat intent and apply the 30% pull only to First-Person.
  Keep both prior modes and legacy mode-less inputs unsteered. Verify steering,
  collision, controls, persistence and heartbeat; commit First-Person and the
  existing heartbeat fixture repair separately, preserving unrelated edits,
  and push without force. Original T042 stays open.

T020 evidence: default-theme build and server/client/default-theme type-checks
passed. The final focused selection passed **12 files / 155 tests** in 33.50
seconds, including exact 27-degree steering, signed wraparound, stable held input,
unsteered existing/legacy modes after switching, aim-based firing, stationary
spinning, all three modes' respawn/collision/snapshot agreement, mode dispatch,
account persistence, migration preservation and both heartbeat cases.
The initial migration fixture used an invalid two-character username; correcting
the fixture to a valid username resolved its failure without changing production.
Browser syntax and whitespace checks passed; no browser, Lightsail, deployment
or capacity execution is claimed. No extension hooks file exists.

## Scoped realtime heartbeat follow-up on `cfb1fe4` (2026-11-10)

Authorized test-only follow-up to original engine T015; no terrain/gameplay work
or original T042 completion. Owner-pasted Lightsail evidence reports 340/341
passing, with the heartbeat test timing out in `closedWith` at line 503.
The unchanged focused file passed locally (11 tests). A controlled 300 ms
event-loop block reproduced the same error at the old 250 ms deadline without
changing transport code; the exact remote trigger remains unconfirmed.

Completed the scoped fixture repair: public `autoPong: false` at construction,
early close/ping listeners, 1000 ms deadline, independent joined member for the
silent socket, explicit socket-error rejection/cleanup, and ordinary/delayed
cases asserting exactly two unanswered pings followed by close 1013.
An intermediate run exposed a 403 when reusing the disconnected responsive
account; the independent member corrects that fixture error.
Only `npm test -- tests\integration\realtime.test.ts` was run: final 12/12 pass
plus three consecutive 12/12 repeats. Full evidence/limitations are in
`docs/verification.md`. No production policy changes, remote rerun or deployment.
The owner subsequently authorized a separate heartbeat test-fix commit and
non-force push alongside T020. The combined final focused run passed 12 files /
155 tests, including all 12 realtime tests. Pre-existing unrelated edits remain
outside both commits.
Original T042, T010 and T013 remain open. No extension hooks file exists.

## Player facing-steered movement follow-up (2026-11-10)

- [x] T019 Add named/documented default-theme facing-movement blend 0.30 (range
  0-1); recompute shortest-signed-angle steering from held player input each
  update. Verify exact 27-degree right/up steering, wraparound, no accumulated
  drift, unchanged speed, aim-based firing and spin-in-place. Preserve NPC
  behavior, update related controls documentation/fixtures, record actual focused
  checks, and keep changes local/uncommitted with original T042 open.
  Authorized independently of live-release/capacity gates; follows T017.

T019 evidence: default-theme build and type-check passed. The focused command
below passed **8 files / 117 tests** on the local Windows workspace:

```powershell
npm test -- tests\default-entities.test.ts tests\default-combat.test.ts tests\npc-engagement.test.ts tests\npc-ranged.test.ts tests\default-skin.test.ts tests\integration\gameplay.test.ts tests\default-theme.test.ts tests\default-respawn.test.ts
```

New simulation assertions measure right/up travel at -27 degrees (screen
coordinates), reverse-sign and +/-170-degree wraparound, ten stable held-input
updates and unchanged full/partial-input speed. A simultaneous moving/firing
case checks projectile velocity toward the unchanged aim target from the moved
position, not the blended travel heading. Twelve stationary facing updates
complete a full turn with exactly unchanged position. NPC/combat/skin/respawn
regressions pass without NPC or firing implementation changes.

Before implementation the new selection had five expected steering failures and
one passing stationary-spin test. The first post-change run passed 98/99 tests;
the remaining test looked for projectile:1 although the first shot is numbered
0. Selecting the actual projectile fixed that assertion; no combat fix was
needed. Existing diagonal/isolation fixtures now explicitly aim along their
intended movement so they continue testing normalization/isolation.

`node --check tests\browser\default-game.mjs` and `git diff --check` passed.
The existing held-controls browser assertion now expects blended travel; no
local browser playtest was run: it was explicitly skipped, and the manual
steering check will happen on Lightsail. No deployment or capacity result is
claimed. No extension hooks file exists.

Scoped commit authorization (2026-11-10) supersedes T019's local/uncommitted
handoff only: commit steering, its tests and matching documentation, preserving
unrelated edits. Push without force only if this is the sole outgoing commit
on top of `1513429` after fetching origin. Original T042, T010 and T013 remain
open; the pending Lightsail check is not browser verification or deployment.

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

## Map-spanning Explore follow-up (2026-11-09)

- [x] T014 Scale Explore destination distance to half the map's shorter side
  (1024 units in Fixed), prefer less-visited areas across successive legs and
  fall back to closer reachable goals after bounded failed searches. Preserve
  Explore default, movement/pursuit speeds, two sticky attackers and speed zero.
  Measure completed routes/new-area coverage on Fixed and a smaller map; verify
  fallback and navigation budgets. Leave changes local, ranged combat separate,
  and T010, T013 and original T042 open.

T014 evidence: workspace check and 9 focused files / 93 tests passed. Real
navigation/simulation completed three Fixed routes of 1088/1280/992 units,
visiting 13 regions and distinct endpoints across the arena. A 768x512 map
scaled its target to 256 and completed 384/320/256-unit routes in 14 regions.
An enclosed-area test completed two closer reachable routes after long goals
returned no-path; a node-limit regression also recovered. Actual destination,
route and travel measurements plus initial failures/corrections are recorded
in `docs/verification.md`. Existing speeds, caps, zero-speed and navigation
budgets pass. A local route-only Chrome check then traced a normal Fixed seed-42
match for 45.344 seconds with an idle player and default settings. One visible
exploring NPC traveled 1099.84 world units, moving 297.43 CSS pixels while drawn
and reaching 821.9 units from its first tracked position; seven offscreen,
never-pursuing NPCs traveled 1512-1519 units. Their longest stationary intervals
were 0.2-0.4 seconds; the visible NPC had no stationary interval during its
painted samples. The browser saw at most two NPCs in range, so no four-in-range
browser claim is made. Full conditions and limits are in `docs/verification.md`.
No live-release result is claimed. Changes stay local; T010, T013 and original
T042 remain open.

## NPC perimeter-spread follow-up (2026-11-09)

- [x] T015 Spread ordinary Fixed NPC waves across edge-distance bands and
  quadrants, bias full-range Explore goals inward for edge-near NPCs, preserve
  safe spawns and existing navigation/pursuit limits, and verify with tests plus
  a 30-second ordinary browser match and spawn/track map. Keep T010, T013 and
  original T042 open; ranged combat remains separate.

T015 evidence: `npm run check` passed. Focused tests passed individually:
`default-entities` (27), `npc-engagement` (10) and `npc-spawns` (12). A fresh
Chrome 157 Fixed seed-42 match used ordinary 10-NPC spawning, default tuning,
no entity staging and an idle player. Across 456 snapshots (ticks 2-912) over
30.692 seconds, the first wave had 2 outer, 4 middle and 4 interior spawns;
4 spawned interior and 1 of the 2 outer-band NPCs entered the interior. All
8 NPCs that never pursued traveled 1020.41-1023.61 world units, displaced
722.50-992.27 units from their starting positions and had longest sampled
stationary intervals of 0-0.067 seconds. The browser run saw at most two NPCs
in range; two NPCs pursued during portions of the trace. The idle player stayed
at `(272,272)`, had no input-driven movement or deaths, and ended at 30 health
after contact damage. `docs/verification.md` records visible-body details,
limits and the generated map. T010, T013 and original T042 remain open. No
deployment or push was performed; changes remain local.

An interim focused run had 46 passing and 3 failing tests: two Explore region/
retry assertions and one engagement-test timeout. The inward preference had
overweighted candidate scoring and changed random-angle behavior. The final
adjustment limits inward preference to full-range goals and preserves the prior
random stream when it is inactive; the separate focused reruns above passed.
The interim failures are not counted as passing.

## Full NPC ranged playtest follow-up (2026-11-10)

- [x] T016 Implement the authorized full NPC playtest behavior against `4c8cac4`:
  measure clear-route Explore travel before/after at the requested 10x, add wider
  interior/action awareness and closer sticky two-slot engagement, remove contact
  damage, implement stop/track/cooldown ranged attacks, retreat and terrain
  repositioning, independent facing with attached front square and matching
  wall-blocked square projectiles. Verify safe spawns/speed zero, deterministic
  regressions and a fresh ordinary default solo Fixed browser match, record each
  requested behavior's verified/failed/untested status separately by evidence
  type, and keep changes local with original T042 open. Follows T015; this
  authorization supersedes the earlier ranged-combat deferral, not the live gates.

T016 evidence: `docs/verification.md` records 14 files / 150 passing tests,
workspace check and the final fresh ordinary solo Fixed seed-42 visible Chrome
run (571 snapshots, ticks 2-1142). Clear-route Explore measured 33.75 before /
337.5 after over one second; browser ticks 2-32 independently measured 337.5.
The wave retains 2/4/4 spawn bands, visible interior Explore on tick 70, first
engagement at 0.8 seconds versus the unchanged 60-second timeout, at most two
active engagements, an NPC rotating in place then firing visibly, and ordinary
keyboard contact at 16.121 units with health 70 unchanged. Simulation separately
verifies cooldown, collision/thin walls, retreat, blocked-shot repositioning,
speed zero, denied exploration and multiplayer caps. Actual screenshots/traces
and the track map persist in `var\npc-ranged-final-evidence\`. Intermediate
failures and corrections are recorded; no deployment/capacity claim is made.
Original T042, T010 and T013 remain open; changes stay local and uncommitted.

- [x] T017 Correct the uncommitted T016 playtest: restore and remeasure default
  Explore at 33.75 units/second; measure readable approach separately and preserve
  speed zero, broad interior routes, distributed spawns, two sticky attackers,
  standoff/turn/cooldown/cover behavior and zero contact damage. Enforce one shared
  enemy body/front/radar color and distinct stable enemy-excluding player colors
  across all 32 slots, fallback and rejoin. Preserve rotating squares/projectiles.
  Run focused checks and a real two-player/spectator browser match with separate
  movement and arena/radar color evidence. Follows T016; leave changes local,
  uncommitted and original T042 open.

T017 evidence: `docs/verification.md` records 15 focused files / 173 passing
tests, workspace check and the final two-player plus spectator Chrome match.
Separate one-second browser measurements are 33.7500000000001 Explore and
67.49999908819296 approach. A visible NPC stops and fires at 214.401 units
(combined radii 22); the trace retains its stationary position for 8.267
simulation seconds and records shots every 30 ticks. Gold/green players and the
reserved `#ed6b61` NPC body/front/radar color pass actual pixel checks in both
player views and both spectator follow views; real rejoin preserves colors.
Tests cover all 32 authoritative/fallback slots, remount and respawn colors,
speed zero, routes/spawns, caps, cover and no contact damage. Exact conditions,
intermediate failures and final artifacts in
`var\npc-pace-colors-final-evidence-6\` are recorded separately from simulation.
Original T042, T010 and T013 remain open; no commit, push or deployment.

Local commit review (2026-11-10): the owner authorizes committing only the
verified NPC combat/pace/colors changes, related tests/docs and saved spectator
evidence. Review of the saved two follow screenshots/report confirms that the
selected player supplies the centered avatar and radar anchor, with only two
player bodies/markers and no additional spectator entity. Runtime rebuild,
workspace check, browser-script syntax and 17 focused files / 184 tests passed.
This supersedes only T016/T017's uncommitted handoff; preserve unrelated edits.
Original T042, T010 and T013 stay open; no push or deployment is authorized.

- [x] T018 Fix the authorized release-test blockers for `1d98585`: portable
  deployment/load fixture paths, tracked migration expectation with exact-once
  coverage, fixture fleeing versus deliberate ranged approach/standoff distances,
  and rejected-movement injection after successful NPC spawn initialization.
  Run the full Linux suite at existing timeouts, compare separate/full timings
  for the reported slow tests, preserve unrelated edits and leave T042 open.
  Follows T017; no push or deployment.

T018 evidence: the Linux baseline reproduced all five blocker surfaces. The
repaired selection passed 5 files / 18 tests. A separate NPC-spawn/gameplay run
passed 2 files / 16 tests; the final full Linux suite passed **54 files / 334
tests**, zero failures/skips, in 31.84 seconds with default workers and unchanged
timeouts. Neither reported timeout recurred; five-world timings were 3.587 seconds
separately / 3.760 seconds full, and all 12 spawn tests passed. The first full run
had one copy-induced Git file-mode failure; restoring tracked modes in the
disposable Linux copy allowed the unchanged external-consumer gate to pass.
`docs/verification.md` records environment, commands, per-blocker outcomes and
timings; raw reports/logs persist in `var\release-test-1d98585-linux\`.
Unrelated edits are retained. Original T042, T010 and T013 stay open; no commit,
push or deployment was performed.

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
