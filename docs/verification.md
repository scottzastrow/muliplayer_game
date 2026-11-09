# Local verification

## Fixed-arena minimal browser and slot-19 simulation (2026-11-09)

The separate minimal browser check passed in a fresh loopback room with one
player, one spectator and Fixed seed 42 (headless Chrome 156.0.8078.80,
Windows/Node 24.11.0). Both roles passed attached, same-color radar nose
geometry at 0, 45, 90, 135, 180, 225, 270 and 315 degrees: body radius 4,
nose radius 2, center offset 4.5 pixels and overlapping circles. The player
moved diagonally from `(272,272)` to `(374.3856,373.8234)` toward the added
tile at `(384,384)`; the position stayed fixed through another 500 ms of
movement input and remained walkable. The spectator saw the same terrain and
sent no gameplay input. The disposable room was left successfully (HTTP 204)
and its browser contexts were disposed.

The first browser attempt used WASD with a keyboard-mouse account and stopped
at the movement assertion; switching the fixture to its arrow-key controls
made the rerun pass. The first simulation assertion counted the returned
player as its own clearance blocker; the corrected check excludes that entity.
The deterministic seed-42 simulation then passed twice with the same slot-19
fallback `(368,1232)` from authored spawn `(1136,1776)`, required terrain and
entity clearance (`radius 14 + margin 64`), and a found navigation path of 42
points.

`tests/fixed-arena-spawn.test.ts` adds the repeatable simulation check, and
`tests/browser/fixed-arena-minimal.mjs` plus the `--fixed-arena-minimal` runner
entry add the separate browser check. The 32-player browser scenario was not
rerun during this focused verification and remains pending, including its
slot-19 browser placement assertion. Its local harness edits are not included
in the Fixed-arena terrain/radar commit.

The reviewed expansion adds 31 cover clusters to the existing 16, giving 641
unique solid tiles across 47 clusters and 15.6494140625% arena coverage.
Related regressions cover connected player-radius routes, authored spawn
clearance, nearby cover in every region, deterministic NPC placement, respawn
hazards and the normalized same-color radar nose at eight headings. The radar
body/nose radii remain 4/2; only the nose offset changes from 12 to 4.5 pixels.
Review also aligned the existing obstacle-browser tile count and seed-4315
NPC expectation with the map/NPC regression fixtures; that browser scenario
was not rerun and is not claimed passing.

This commit handoff reuses the recorded focused browser and simulation passes;
tests were not rerun. T042 remains unchecked. Existing rooms, unrelated edits
and local artifacts are preserved. No push, deployment or capacity run was
performed.

## Default wave counts and level-completion presentation, T047 (2026-11-08)

The first trace ran before production changes, using one player, all default
settings, seed 42 and real module combat with test-staged projectile encounters.
It passed: wave 1 started with **10 NPCs**, kills reduced living counts through
**9,8,7,6,5,4,3,2,1,0**, no killed NPC was replaced, tick +149 remained empty in
intermission, and tick +150 spawned **12 NPCs** for wave 2. No spawn/count bug was
reproduced; frozen-roster growth and spawning were not changed.

The default module now publishes starting/living counts and per-level earned
points alongside running ranked standings. HUD totals are independent of radar
filters. During the same five-second intermission both roles see completed-level
heading, selected player's earned points, roster standings and next-level
countdown. Next spawn resets only level-earned points; final clear retains normal
saved-result finalization. Fields are additive to default schema 4; legacy
fixtures remain accepted, with count pairs validated when supplied. The theme
preview gained an intermission fixture.

`npm run check` passed. The final focused selection passed **8 files, 57 tests**:
default-theme, default-skin, default-combat, wave-countdown, integrated gameplay,
spectator-view, theme-preview and session-lifecycle. Coverage includes default
counts/no replacement, exact intermission deadline, 1000 earned points from ten
kills and reset at wave 2, player/spectator HUD/counts with NPC radar disabled,
running standings ordering, countdown, legacy snapshot compatibility, invalid
count pairs, final clear without another intermission, and actual integrated
combat/result persistence. Browser harness syntax and `git diff --check` passed.
An early command included nonexistent `wave-timeout.test.ts`; that selector is
not evidence of an additional file/test run.

Visible Chrome **156.0.8078.80**, Windows, Node **24.11.0**, npm **11.6.1**:
`node tests\browser\default-game.mjs --level-transitions` passed twice. The final
run observed:

| Boundary | Level | Starting NPCs | Living NPCs | Tick |
| --- | --- | --- | --- | --- |
| Initial active wave | 1 | 10 | 10 | Initial snapshot |
| Three kills, NPC radar filtered | 1 | 10 | 7 | During combat |
| First intermission snapshot | 1 | 10 | 0 | 266 |
| Next wave / intermission deadline | 2 | 12 | 12 | 416 |

Every living count 10 down to 0 was observed. All intermission samples stayed
level 1 with zero NPCs; level 2 first appeared at the exact deadline, **150 ticks
later**. Player and spectator views both showed Level 1 Complete, **1000** earned
points, identical one-player running standings (10 kills, 0 deaths), next-level
countdown and the filtered `7 of 10` label. Wave 2 showed `12 of 12`, retained
1000 running points, reset level-earned points to zero and hid the summary.
The browser reaches wave 2; final-result correctness is covered by the focused
module and real HTTP/WebSocket lifecycle tests, not by this browser scenario.

Used disposable loopback fixture server **18088**, Vite **15178**, Chrome debugging
**19228**, a new owned database/profile and local ignored env file. All three
endpoints returned HTTP 200 before execution. The test-only server stages one
NPC at a time in the verified clear (400,272) firing lane but preserves all lobby
defaults, wave counts, NPC health, scoring, combat and progression. Real mouse
input clears the wave; this is **not** an unassisted-play or natural-navigation
claim. The server refuses non-test/non-loopback configuration. Rooms are left
in harness cleanup; owned processes and disposable env/database/profile are
removed after verification.

Changes remain uncommitted. The pre-existing countdown note below and `.idea`
were preserved. T042 remains open; no push, deployment, Lightsail load or capacity
run occurred.

## Held movement and independent facing, T023/T045 (2026-11-08)

The already-uncommitted screen-direction controls passed both requested cases;
no additional production controls change was necessary. Fresh movement presses
set facing, repeated keydowns are ignored for facing, and render dispatch keeps
the held movement vector separate from mouse aim/keyboard rotation.

Extended `tests/default-skin.test.ts` to hold Down Arrow while mouse aiming/firing
left and to hold S while rotating both left and right and firing Space. Checks
cover unchanged down movement, exact aim/facing-dot direction, repeat-flagged
and duplicate unflagged keydowns, repeated snapshots, release and a fresh press
setting downward facing again. Default-theme build/type-check passed; the focused
skin/theme/combat/entities selection passed **4 files, 43 tests**. Browser harness
syntax and `git diff --check` passed.

Visible Chrome **156.0.8078.80** passed two consecutive final runs of
`node tests\browser\default-game.mjs --held-controls` on Windows, Node **24.11.0**,
npm **11.6.1**, with disposable server **18087**, client **15177**, debugging
**19227**, and an owned fresh database/profile. All three endpoints returned
HTTP 200 before execution. Each of the mouse-left, keyboard-left-rotation and
keyboard-right-rotation cases received four real browser `repeat=true` events,
continued down **48-60 world units** with no sideways displacement, sent **5**
firing inputs and observed **1-2** new authoritative projectiles in the aimed
direction. Releasing stopped movement/firing; keyboard facing remained stable.

Initial harness attempts incorrectly compared shots created at different server
positions to one earlier facing sample and sampled a stale rendered frame.
Diagnostic inputs showed snapshot-relative aim coordinates versus the newer
moving server position, not movement-key facing reassertion. The final harness
waits two render frames, checks local keyboard-facing stability within 0.01,
and checks server/projectile heading separately: mouse shots have normalized
x < -0.97 and |y| < 0.25; keyboard server/shot vectors are within 0.35 of the
displayed rotated heading. These are directional live-network checks, not
claims of exact server-angle stability. Exact control intent and local direction
are asserted by the deterministic skin tests. Earlier wiring/cleanup mistakes
were corrected; failing fixture rooms were released by restarting only the
owned disposable server, and the final harness leaves rooms in `finally`.
A subsequent run exposed shots already removed by terrain at the final sample:
the bounded probe now records new projectiles across incoming snapshots instead
of requiring them to survive to that sample. An unrelated stationary-view
centering assertion was removed from this moving scenario; its facing-dot checks
remain. Repeated diagnostic registrations also triggered the normal auth throttle;
only the owned disposable server was restarted before the two final runs.

The existing production-control edits and other prior work were preserved.
T042 remains open; no deployment, capacity or cross-browser result is claimed.
Pre-commit review also passed `npm run check`, the focused 4-file/43-test selection
and syntax checks for both modified browser harnesses. Gamepad remains separate.

## Scattered NPC placement, T046 / FR-024 (2026-11-08)

Implemented on `001-multiplayer-engine` over `720529e` as a placement-only
Dots and Squares change. Counts/growth, NPC health, terrain,
movement/detection settings, countdown tuning and runtime navigation limits are
unchanged. Fixed remains the shipped source default.

The final focused selection passed **11 files, 69 tests**: `npc-spawns`,
`default-entities`, `generated-map-integration`, `maps`, integrated `gameplay`,
`session-lifecycle`, `radar`, `generated-map-runtime`, `default-combat`,
`default-respawn` and `fixture-theme`. `npm run check` passed after restoring
Fixed. Theme and server/client builds passed. Coverage includes same seed/wave
repeatability, variation across seeds/waves, all 16 zones for 40/50-NPC waves,
unchanged difficulty/terrain, clearance from moved/current players and all
32 player spawn positions, unique placement at the existing 2000-NPC ceiling,
player-radius routes across six seeds per map mode, excluded disconnected clear
space, bounded redistribution, explicit insufficient-space failure and waves
while avatars are absent. Reachability assertions use a **test-only** 4096-node
search ceiling to establish paths across the full grid; production search limits
remain 2048. Placement itself visits at most 4096 grid cells and four neighbors
per visited cell; it does not issue navigation searches during spawning.

Visible local Chrome **156.0.8078.80** passed
`node tests\browser\default-game.mjs --npc-spawns` once for each map mode:

| Mode / seed | NPCs / health | Speed / detection | Occupied zones / quadrants | Canvas enemy radar draws |
| --- | --- | --- | --- | --- |
| Fixed / 42 | 10 / 100 | 67.5 / 512 | 10 / 4 | 10 |
| Simple Generated / 42 | 10 / 100 | 67.5 / 512 | 10 / 4 | 10 |

The harness used actual registration/login, lobby create/start, server snapshots
and Canvas drawing in visible Chrome. It read back and asserted the unchanged
lobby defaults and changed only its own waiting room's seed in a disposable
SQLite database. Both runs received the exact selected terrain, matched every
living NPC to its authorized radar position and rendered `Enemies remaining: 10`.
Example separated positions were Fixed (176,976), (1200,1424), (1872,1104)
and (1552,1840); Generated (368,912), (1360,1392), (1872,1104) and
(1552,1840). Nearby NPCs had already begun normal pursuit when sampled; those
moving coordinates are not claimed as exact initial placement. The automated
module tests compare exact initial positions for repeatability.

Windows, Node **24.11.0**, npm **11.6.1**, disposable loopback server **18086**,
Vite client **15176**, Chrome debugging **19226** and a fresh owned Chrome
profile/database. Server/proxied readiness and Chrome debugging returned HTTP
200 before both runs. Screenshots captured after the assertions show the enemy
radar dots, including distant enemies clamped to the rim, and were inspected.
This is automated visible-Chrome/screenshot evidence, not human playtesting,
cross-browser validation or capacity measurement.

The separate existing `--arena-obstacles` fixture was adapted to use seed 1011,
whose exact NPC spawn is (560,528), rather than assume a fixed northwest spawn.
Its final Chrome run passed blocked shots (NPC health 100000), movement blocking
(approximately 374.386,373.823), navigation around solid tiles, the northern
walk-around (554.386,301.823) and open-angle damage (100000 to 99825).
The first attempt retained one projectile at the fixed 250-ms observation:
the farther encounter requires additional flight time. The fixture now polls
collision removal for at most another 240 ms, still before any projectile can
expire at two seconds. Subsequent attempts exposed snapshot/render races in the
strict radar-position comparison. Comparing the interpolated world square was
also incorrect because radar markers use the current snapshot. The final probe
records the snapshot tick drawn by Canvas and synchronizes that comparison;
the original 0.1-pixel tolerance remains unchanged. No gameplay geometry,
detection, movement or global test timeout was altered.

Initial placement-test failures were fixture issues: the renderer's existing
300-second `waveRemainingSeconds` validation rejects the unchanged 360-second
budget of a 40-NPC wave; placement assertions now inspect the module snapshot
directly. **That pre-existing HUD schema limit is not fixed by this placement
change.** The initial default navigation search budget also returned `limit`
on some distant test routes; only the test reachability budget was raised.
A search for an exact former encounter seed was stopped after its initial
180-second wait; the bounded seed-1011 fixture above was used instead.

Generated was selected only for its local fixture and restored to Fixed.
Owned local services/profile/database were stopped/cleaned; screenshots were
retained outside tracked source. T046 is complete; **T042 remains unchecked**.
No deployment, server-setting changes or capacity runs were performed.

## Default NPC projectile hits to kill (2026-11-08)

**Measured before changing health:** the initialized level-1 default NPC had
100 HP; normal, unboosted firing produced 25-damage projectiles and observed
100 -> 75 -> 50 -> 25 -> dead: **four hits**. After lowering only the default
`baseNpcHealth` to 50 in protocol defaults and the default-theme manifest,
the same firing/collision path observed **50 -> 25 -> dead: two hits**.

`tests/default-combat.test.ts` stages an initialized NPC 200 world units east
of the player, fires one projectile at a time and waits for collision/removal.
The final fixture uses the actual seed-42 Fixed arena obstacles and checks every
unit of the radius-3 firing lane. Diagnostic movement/detection are zero so
aim stays fixed; health is never written, pickups are removed and no effects
are active. Each shot is checked for 25 damage and 600 units/second velocity;
kill/score accounting is also checked. This is executed module simulation
evidence, not browser, human playtesting or IDE-breakpoint evidence. The IDE
had no run configuration and could not bind the TypeScript hit breakpoint;
the user authorized executable projectile checks instead.

Host overrides still observe 100 HP/four hits and 75 HP/three hits. NPC counts,
population growth, health growth and weapon tuning are unchanged: one-player
default waves remain 10 then 12 NPCs, now with 50 then 55 HP. Saved room/result
settings containing explicit 100 HP retain that value and their stored JSON
is not rewritten; changing defaults is not a saved-settings migration.
New default rooms and create UI use 50. Existing-room edit displays saved 100
and permits a host-selected 75. The API still requires `baseNpcHealth`;
partial settings passed directly to the module resolve omitted health to 50.
Restart/rebuild a local application before expecting new defaults in its UI/runtime.

Checks executed:

```powershell
npm run theme:build
npm test -- tests\default-combat.test.ts -t 'measures unboosted projectile hits'
npm run check
npm test -- tests\default-combat.test.ts tests\default-theme.test.ts tests\protocol.test.ts tests\npc-spawns.test.ts tests\lobby-settings.test.ts tests\results.test.ts tests\integration\accounts-lobby.test.ts tests\integration\session-lifecycle.test.ts tests\integration\gameplay.test.ts
node --check tests\browser\level-transitions.mjs
node --check tests\browser\npc-spawns.mjs
git diff --check
```

Baseline selection: 3 cases passed, 11 skipped. Workspace check passed. Final
focused selection: **9 files, 63 tests passed**, including actual projectile
collisions, overridden health, saved settings, counts and lifecycle.
The first post-change selection had 1 failure/61 passes because the new
integration test was accidentally nested inside another test; moving it to
suite scope fixed registration, and both final reruns passed 63 tests.
Both browser harnesses passed syntax checks only; browser scenarios were not
executed. The existing immutable external-theme pin was not changed; its
protocol-source drift gate awaits a reviewed commit and is not claimed passing.

The pre-existing countdown note above is preserved. T042 remains unchecked,
the Theme Credits pointer and `.idea` are untouched, and changes are uncommitted.
No push, deployment, server-setting change or capacity run.

## Seed-42 walk-around diagnostic resume (2026-11-08)

**Passed once.** The focused `node tests\browser\default-game.mjs
--simple-generated` Chrome playtest completed the whole encounter. The harness
retains the existing endpoint tolerance, movement durations, shot/blocking and
world/radar assertions. It now captures every leg's start/end, target,
authoritative facing, observed displacement, bounded sent movement/aim inputs
and nearby obstacle bounds. Axis-aligned route checks additionally measure
continuous swept-circle clearance for the full radius 14; the existing loader
checks at one-unit intervals remain. No geometry or timeout was changed.
The prior north-leg failure was not reproduced; no cause or gameplay fix is
claimed for it.

The previously failing leg's captured values were:

| Value | Observation |
| --- | --- |
| Start | (530, 463.99997592427854) |
| Planned target | (530, 400) |
| End | (530, 385.99997592427854), within the unchanged 20-unit tolerance |
| Authoritative facing, start/end | (0, -1) / (0, -1) |
| Actual displacement | (0, -78) |
| Sent movement, sequences 213-219 | (6.123233995736766e-17, -1) throughout |
| First / last world aim | (530, 221.39998507955198) / (530, 161.39998507955198) |
| Full-radius route clearance | Minimum center-to-obstacle distance 14; no intersected obstacles (legal west-face tangency) |

Nearby obstacle bounds were x=544..576/y=448..480 (clearance 14),
x=576..608/y=448..480 (46), x=608..640/y=448..480 (78) and
x=576..608/y=480..512 (48.703191). The east leg continued from
(530,385.999976) to (710,385.999967), displacement approximately (180,0);
the south leg ended at (710,463.999967). Their minimum planned-route
center clearances were 62.000024 and 70 respectively, both greater than radius 14.
All sampled positions remained walkable.

The exact first-attempt generated geometry was received from the real server.
The clear-lane shots reached x=820; blocked shots reached at most x=540 and
disappeared before their two-second lifetime. The player stopped at
(530,463.999976), stayed blocked while holding forward, and then walked around
the full cluster's x=640 east face. Visible world tiles and north-up radar
footprints matched throughout. A screenshot was captured only after every
assertion passed; no human visual review is claimed.

Windows, Node 24.11.0, npm 11.6.1, visible Chrome 156.0.8078.80; a fresh
disposable SQLite database and Chrome profile, server 18084, client 15175 and
loopback debugging 19224. Server/proxied readiness and Chrome debugging returned
HTTP 200 before execution. `npm run build` and both browser script syntax checks
passed before the single run. The source constant was temporarily Simple
Generated for the fixture and restored to Fixed afterward. Local services were
stopped; runtime evidence is kept outside tracked source. T042 remains open;
no deployment, cross-browser or capacity run was performed.

After restoring Fixed, `npm run build`, `npm run check` and `git diff --check`
passed. The focused map/default-theme/combat/skin/generated-runtime/lifecycle
selection passed **7 files, 37 tests**, including the new radius-14 seed-42
walk-around regression and a center-clear but radius-blocked east waypoint.
The prior seven-file selection had 36 tests. No full-suite rerun was performed
in this resume. Logs and the screenshot are retained in the session's `files`
directory rather than committed runtime data.

## Seed-42 facing investigation and focused Chrome rerun (2026-11-08)

**Not passed at this checkpoint; subsequently resumed above.** The focused Chrome scenario
was rerun exactly once. Its first failure was `AssertionError: reach open y
approach` at `tests/browser/simple-generated.mjs:126`, called at line 196 when
attempting to leave the blocked west face for the northern walk-around at y=400.
The failing endpoint was not included in the assertion output; no cause is claimed
for that second approach failure and no timeout was increased.

The original approach assumed a mouse offset of (0,300) would face south. Runtime
evidence showed a 940.8 by 525.2 CSS-pixel canvas: that offset is outside the canvas.
Facing remained (1,0); ArrowUp sent `moveX:1, moveY:0, aimX:372, aimY:272`.
A 120-ms diagnostic press moved the player from (272,272) to (290,272), east,
not toward y=400. The skin receives pointer movement on the canvas and maps forward
movement relative to facing. This was a test-direction error, not blocked geometry.
Loader checks at one-unit intervals confirmed the radius-14 route from (272,272)
to (272,400), the northern lane to x=704 and the west approach at x=430 are clear.
The cluster spans x=544..640: x=624 at y=464 is blocked, so the proposed walk-around
uses x=704 rather than a point inside the cluster.

With proportional in-canvas aim and an authoritative-facing assertion before each
leg, the corrected initial y=400 and x=430 approaches passed. The real server
selected seed 42's first-attempt generated geometry. The clear-lane shot control,
blocked shots, player stop at the first tile's west face, continued blocking and
matching visible world/radar footprints all passed before the walk-around failed.
The whole scenario is **not verified**, and no screenshot was produced.

Windows, Node 24.11.0, visible Chrome 156.0.8078.80; fresh local SQLite database
and Chrome profile, server 18084, client 15175 and loopback debugging 19224.
Server/proxied readiness and the debug endpoint returned HTTP 200.
`npm run build` and both browser script syntax checks passed before execution.
An initial terminal geometry probe failed due to PowerShell inline quoting; the
corrected stdin-module probe printed the actual obstacles and route clearances.
The source default was restored to Fixed after the failed run. T042 remains open;
no deployment or capacity run was performed.

## Simple Generated Chrome attempt (2026-11-08)

**Not passed at this checkpoint; changes were left uncommitted.** The first browser assertion failure was
`AssertionError: reach open y approach` at
`tests/browser/simple-generated.mjs:90`, called by the initial travel to y=400.
The attempt stopped there; it was not rerun or treated as a map collision defect.
Movement/shot blocking, radar placement and screenshot review were not reached.

Windows, Node 24.11.0, npm 11.6.1, visible Chrome 156.0.8078.80; disposable
SQLite database, fresh Chrome profile and loopback-only services. Server
`127.0.0.1:18084`, client `127.0.0.1:15175`, proxied readiness and Chrome debugging
`127.0.0.1:19224` each returned HTTP 200. `npm run build` passed with the documented
`DEFAULT_MAP_MODE` temporarily set to `"simple-generated"`. Browser harness syntax
checks passed before execution.

The disposable waiting match `9429a872-4953-43c7-90f3-917865c31ede` was locally
assigned and read back with **seed 42** before starting. The browser received the
exact `generateMap(42, "simple-generated")` geometry (generated, first attempt,
16 obstacles), different from Fixed. It observed the player at (272,272); the
loader confirmed that point is walkable with a 78-unit radius (player plus margin).
The northwest cluster's first tile is (544,448), 32 by 32, rather than Fixed's
(384,384). These are authoritative snapshot/loader observations, not completed
visual or collision-playtest evidence.

Repeat setup is in the map-mode section of `docs/theme-development.md`, using
`node tests\browser\default-game.mjs --simple-generated`. The added harness pins
only its own waiting local room to seed 42 and attempts a clear northern shot,
blocked shot, movement into the tile and matching world/radar draws. Its approach
assertion failed in this run, so those later checks remain unverified. The source
constant was restored to `"fixed"` after the attempt. Local services and disposable
runtime files were cleaned up. T042 remains open. No deployment or capacity run.

## Dots and Squares map modes (2026-11-08)

At this checkpoint this was an uncommitted follow-up to the Chrome rerun below;
the later generated-mode resume is recorded above. Fixed remains
the default Tile Cluster Arena. Simple Generated moves four solid clusters using
the match seed and validates candidates before selecting one map for the match;
after four invalid candidates it uses the Fixed arena and increments the
`default.map.fallback` session metric.

On Windows, Node 24.11.0 and npm 11.6.1, `npm run check` passed. The focused
seven-file map, runtime, default-theme/skin/combat and lifecycle selection passed
36 tests. It checks same-seed repeatability, variation between seeds 42 and 43,
validation over 32 seeds, forced fallback and error propagation. A real session
startup test substitutes Simple Generated for the shipped Fixed selection and
verifies that one selection supplies both world and module geometry. The generated
simulation checks actual NPC pursuit around a cluster, player and projectile
blocking, navigation, radar footprints and unchanged geometry across waves;
the skin test checks the generated obstacle rectangles are drawn at their world
positions. The documented reproduction command for seed 42 returned
`source: generated`, one attempt and 16 obstacles.

The Chrome rerun below preceded these map edits and exercised the Fixed arena;
no generated-mode browser, deployment or capacity run is claimed. T042 remains
open.

## Chrome radar compatibility rerun (2026-11-08)

At `d821956` on `001-multiplayer-engine`, after the spectator snapshot
compatibility fix, `npm run build` and `npm run test:browser` passed. The
automated scenario used Node 24.11.0, npm 11.6.1 and three visible Chrome
156.0.8078.80 windows on Windows, an isolated in-memory server at
`127.0.0.1:18083`, Vite at `127.0.0.1:15174`, and an isolated Chrome profile
with loopback debugging at `127.0.0.1:19223`. Server readiness, Vite, proxied
readiness and the Chrome debug endpoint each returned HTTP 200.

The run covered all four radar filters, assigned player colors, player and
spectator resize/filter isolation, circular terrain clipping, spectator
switching and no-input behavior, and both saved-standings page reloads. It also
completed the existing two-player, two-level match and capacity-slot-release
scenario. Local processes were stopped afterward. This is not human visual,
non-Chrome, deployment or capacity-test evidence; T042 remains open.

## Radar SDK commit and final checks (2026-11-08)

The reviewed radar SDK, default-theme integration, contracts, tests and browser
harness fix were committed as `600c5e0eebddf7b1b38b82fff7b377cf3b318e1c`.
The first full-suite run found that an added roster guard rejected the established
spectator snapshot contract. The guard was removed without changing the engine's
target-derived spectator projection; that compatibility fix and its test cleanup
were committed separately as `d02808facd5ed38ed1b52757caed7d50d0587453`.

The external-consumer lock now pins the public SDK contract to the reviewed radar
commit above. After the compatibility fix, `npm run check` passed and `npm test`
passed all **43 files and 206 tests**, including the isolated external-consumer
package/build conformance check against that immutable pin. The initial test failure
was followed by a clean full-suite rerun. No browser run was repeated during this
final verification; the Chrome run and earlier reload diagnostics are recorded
below. T042 remains open. No deployment or capacity run was performed.

## Radar filters and saved-standings synchronization (2026-11-08)

Continued the radar work on `001-multiplayer-engine`. Unrelated changes, including
`.idea`, were preserved.

The prior `default-game.mjs:1224` null-table failure was a reload synchronization
race, not evidence that saved standings never render. The old wait checked only
table presence and could succeed in the outgoing document before the subsequent
text read ran in the new document. The results skin builds and inserts the
populated table synchronously; the new page first restores authentication and
fetches the saved result asynchronously. An isolated real-Chrome diagnostic using
the actual results renderer and a labeled 300-ms fixture fetch delay observed no
table during the new-page load and `Saved result loaded.` with a table afterward.
Twelve further isolated reloads reached the saved table; the original intermittent
null exception was not reproduced in those diagnostics. One exploratory CDP
request-interception diagnostic stalled and was stopped. The harness now waits
for a different per-document probe ID **and** the standings table before retaining
the original full-text equality and saved-result URL assertions.

The reusable SDK accepts generic categories, marker color overrides, dot/diamond
styles, clipped rectangular footprints and display-only category selection.
Dots and Squares authorizes fellow living players, living NPCs, available pickups
and real map collision geometry in its viewer snapshots. The skin offers four
independent initially enabled filters, keeps the selected dot/facing centered,
uses assigned player colors, enemy dots, pickup diamonds and muted terrain, and
keeps the enemy count below the upper-right north-up circle independently of NPC
visibility. Spectators receive the followed player's authorized view and own
their display filters; filters never dispatch gameplay actions.

Final focused selection passed: **8 files, 58 tests** (`radar`, `default-theme`,
`default-skin`, `default-combat`, `default-respawn`, `spectator-view`,
`integration/spectators`, `results`). Real combat/claim tests now explicitly check
radar removal after an NPC kill and a contested health-pickup claim. The skin
tests check all four filters for players and spectators, unchanged snapshots,
center/facing, enemy count and disposal. `npm run check`, browser harness syntax
and `git diff --check` passed. An initial build rejected the inferred optional
footprint's `undefined` type against `JsonValue`; preserving the concrete
serializer return type corrected it without a type assertion.

The full `npm run test:browser` scenario ran **once and passed**, using three
visible Chrome 156.0.8078.80 windows on Windows, Vite at `127.0.0.1:5174`, an
isolated in-memory SQLite server at `127.0.0.1:8083`, and a session-only Chrome
profile/debug endpoint at `127.0.0.1:9223`. Readiness and client responses were
successful before the run. Assertions verified all four filters independently,
assigned fellow-player radar colors, centered self/facing, NPC count while hidden,
player and spectator resize with the NPC filter retained, spectator filters not
changing the followed player's display, and actual Canvas pixel clipping of a
terrain footprint at the circle. Existing controls, spectator switching/no input,
two-player two-level completion, saved-result reload and both full page refreshes,
identical standings and capacity-slot release also passed. The saved standings
were 300 points/3 kills and 100 points/1 kill, both with zero deaths.

**Gaps at the time of this entry:** no full regression suite, separate
`--arena-obstacles` encounter, human visual review or non-Chrome check was run in
this follow-up. External-consumer conformance had not yet run because its immutable
pin predated these public SDK edits. No pin was fabricated at that point. Local
browser/test services were stopped. T042 remained open; no deployment or capacity
run was performed.

## Radar follow-up (2026-11-08)

Resumed the saved radar edits on `001-multiplayer-engine`, preserving unrelated
`.idea` files. The module selects living NPC `enemy` markers; the public SDK
validates and renders generic markers; the default skin owns upper-right
placement and centers `Enemies remaining` below the radar. Older snapshots may
omit the additive radar field.

Before further edits, `npm run check` and the focused radar/default-skin/default-theme
selection passed (3 files, 15 tests). After correcting the saved upper-left
placement and adding player/spectator resize assertions, the same checks passed
again. Browser harness syntax and `git diff --check` also passed.

One `npm run test:browser` attempt used Node 24.11.0 on Windows, an in-memory
SQLite server at `127.0.0.1:18083`, Vite at `127.0.0.1:15174`, and a fresh isolated
Chrome profile with loopback debugging at `127.0.0.1:19223`. Server readiness,
client, Chrome debugging and proxied readiness all returned HTTP 200.
The browser reached and passed radar assertions for both players, viewport resize,
enemy marker selection/count, selected-player anchor and the followed spectator
view, including upper-right placement with the count below.

The complete browser scenario did **not** pass in that attempt. It later failed during saved-result
page-reload checks at `tests/browser/default-game.mjs:1224`:
`TypeError: Cannot read properties of null (reading 'textContent')`.
No second browser attempt was made and the failure was not repaired in this radar
slice at that time. The separate `--arena-obstacles` radar encounter, human visual
review and non-Chrome behavior remain unverified. Local test processes were stopped.
T042 remained open; no deployment or capacity test was performed.

## Timer and NPC settings browser exercise (2026-11-08)

Revision `58ad727`, Windows, Node 24.11.0, npm 11.6.1 and Chrome
156.0.8078.80. A CDP-driven visible browser used an isolated Chrome profile,
an in-memory local server at `127.0.0.1:18083` and Vite at
`127.0.0.1:15174`. A disposable account created both rooms through the host UI.
The browser probe observed actual WebSocket snapshots and HUD text; this was
automated browser observation, not human visual review.

| Exercise | Observed result |
| --- | --- |
| Host settings | Created a one-player room with 10 initial NPCs, edited speed to 0 and detection range to 700, saved, reloaded the page and reopened creator controls. The fields still displayed 0 and 700. |
| Zero speed | In the started match, all 10 NPC positions remained unchanged across 46 snapshots, ticks 2–92 (about three seconds); the nearest was 273.4 units from the player, within the configured range. |
| Countdown | The first snapshot showed 179.909 seconds and the HUD displayed `Wave time remaining: 180s`; after about three seconds the snapshot showed 176.919 seconds. |
| Short detection range | A second one-player, one-NPC match used speed 90 and range 96. The NPC at (528, 528) stayed idle during 73 sampled snapshots with the player outside 96 units, including a 2.2-second stationary observation. Its first observed movement was at a separation of 84.51 units after the player entered the range; it subsequently moved to approximately (553.93, 480.66). |

Two initial attempts did not reach the range: the keyboard-and-mouse arrow movement
was relative to changing aim, so the scripted route missed the NPC. Switching the
disposable account to keyboard-only controls and using forward/strafe produced the
recorded successful run. No deployment or capacity test was performed; T042 remains
open.

## NPC settings and final suite (2026-11-08)

The timer retune was committed separately as `afc44e45379bba8b3a79fb0abde373af667bbd3e`.
NPC movement speed and the new NPC detection range were committed as
`8c1238c9e4d11a08bba306c89e03b89dd3de6290`; the public setting defaults to 512
world units, accepts 0–700, and 0 disables automatic pursuit. Its tests verify idle
behavior one unit outside the configured range, pursuit at configured speed at both
400 and the maximum range, and zero-range idle behavior. API, legacy-config, saved
result and host create/edit coverage passed. The clear-lane session lifecycle fixture
was included with the NPC settings commit.

The full suite first exposed two integrated gameplay cases placing NPCs in blocked
cells after the generated arena changed. Commit
`47addd0c5af35a9dd1f67724f29e6b3654076f09` puts those simulated encounters in a
verified open lane, confirms projectile clearance, and holds NPCs stationary while
the fixture performs its scripted combat.

The external-theme consumer pin now targets the immutable settings commit above.
After the pin update and fixture correction:

| Check | Result |
| --- | --- |
| `npm run check` | Passed; protocol, SDK, engine, themes, server, client and tools checks. |
| `npm test` | Passed; 42 files, 198 tests, including external-consumer conformance. |
| `npm test -- tests/integration/gameplay.test.ts` | Passed; 1 file, 4 tests after the clear-lane fixture correction. |

No browser, deployment, load or capacity test was run for this follow-up.
T042 remains open pending its authorized separate-host capacity run.

## Dots and Squares wave timer retuning (2026-11-08)

Base revision: `9728949`; local Windows, Node 24.11.0, npm 11.6.1.
Changed only module timer tuning to `min(360, 120 + 6 * starting NPC count)`
seconds: 10 NPCs = 180 seconds, 20 = 240, 39 = 354, 40 or more = 360.
The shared `Countdown` implementation/API and timeout finalization remain unchanged.
Updated duration/cap and monotonic deadline fixtures, plus the browser harness's
starting-budget bound and wait budget (syntax checked, not browser executed).

Before the speed work, `npm run check` passed and the timer-focused selection
passed (5 files, 37 tests): wave-countdown, wave-timeout, default-respawn,
default-skin and spectator-view. Separately, wave-countdown and wave-timeout
passed with verbose output (2 files, 16 tests), including exact-deadline
precedence, no respawn at expiry, duplicate completion, persisted/reloaded standings
and slot release. The attempted `default-progression.test.ts` selector names no
existing file; it is not additional evidence.

An additional `session-lifecycle.test.ts` run initially failed twice waiting for
the first NPC kill/current-level advancement (line 91, 2.5-second wait), before
any wave expiry or NPC speed edits. The later clear-lane lifecycle fixture below
resolved that observation and passed in the final focused/full-suite runs above.

## Configurable Dots and Squares NPC speed (2026-11-08)

Separate follow-up on the same worktree. The original trace was
`themes/default/src/module/tuning.ts` (`NPC_SPEED = 90`) into
`entities.ts` pursuit: waypoint arrival and normalized movement both multiply
speed by `dtSeconds`. At 30 Hz this was 3 world units per tick; map/navigation
cells are 32 units. New playtesting default: 67.5 world units/second (75%),
or 2.25 units/tick. The selected allowed range is finite 0-180, with fractions;
zero stops movement but does not disable contact damage.

The public v1 settings schema validates `npcMovementSpeed`, supplies the default
when omitted, and reaches server create/update/read/start, stored settings and
result settings through existing schema boundaries. No database migration or
saved-data rewrite is needed. The host create/edit UI uses the public defaults,
labels the field "NPC movement speed", documents units/range, accepts fractions
and reports an empty value rather than converting it to zero. Dots and Squares
uses the validated setting for both direct pursuit and navigation movement;
the timer calculation is independent of speed.

Pre-pin speed-only checks:

| Check | Result |
| --- | --- |
| `npm run check` | Passed after implementation; protocol/SDK/default/fixture builds and all configured workspace/tools checks. |
| `npm test -- lobby-settings.test.ts protocol.test.ts default-entities.test.ts accounts-lobby.test.ts fixture-theme.test.ts movement-collision.test.ts wave-countdown.test.ts wave-timeout.test.ts default-respawn.test.ts default-skin.test.ts spectator-view.test.ts results.test.ts` | Passed: 13 files, 85 tests. |
| `node --check tests\browser\wave-timeout.mjs` | Passed; syntax only, not browser execution. |
| `git diff --check` | Passed. |
| `npm test -- themes.test.ts -t 'builds and loads an isolated external consumer'` | Failed at the immutable no-contract-drift gate, as the pin predates `npcMovementSpeed`. |

Movement tests measure one-second direct travel at 0, 33.75, 67.5, 90 and 180
units/second. Detour tests at every nonzero listed speed verify one second of
path travel, per-step distance bounds, walkability, passage around the wall and
navigation budgets. Coverage also verifies zero-speed contact damage, server
rejection/no revision change, creator updates, frozen running settings, omitted
legacy room fields, normalized legacy result settings without rewriting them,
and actual host create/edit request payloads using DOM stubs.

Initial new tests failed before implementation because the speed field was
unknown/missing. A detour fixture initially placed the NPC at x=992, on a blocked
navigation-cell boundary; placing it at the original x=990 and waiting for the
bounded request fixes the fixture without changing navigation. A legacy-result
test initially parsed the entire synthetic result with non-UUID fixture IDs;
it now checks the public result settings schema, the subject of that test.

This was the pre-pin consumer check: it failed because the lock revision preceded
the committed public protocol settings. The pin was subsequently advanced to the
settings commit, and the final full-suite result is recorded above. Existing task
edits and `.idea/` were left untouched. No real-browser playtest, deployment,
live-server changes or load/capacity run was performed.

## T043 - Build, contracts and browser verification (2026-11-07)

Verified locally on Windows at commit `aeddbf6bb0896a75c9a4275e283a280491898967`
with Node 24.11.0, npm 11.6.1 and Chrome 156.0.8078.80. Browser checks used
separate visible Chrome windows, a local Vite client at `127.0.0.1:5173`, a
disposable server at `127.0.0.1:8082`, process-only test configuration and an
in-memory SQLite database. The ignored `.env` was loaded; no production settings,
credentials or persistent Windows environment variables were used.

| Check | Result |
| --- | --- |
| `npm run build` | Passed; protocol, theme SDK, engine, default/fixture themes, server and client built. Rollup printed non-fatal Zod annotation warnings. |
| `npm run check` | Passed; workspace TypeScript checks and tools type-check completed. |
| `npm test` | Passed; 41 files, 177 tests. |
| `npm run test:browser` | Passed in three Chrome windows. Independent movement/cameras, nearby visibility, player controls/HUD, spectator target/switch/leave/no-input, capacity slot release, two-level completion and shared/reloaded saved standings passed. |
| `npm run test:browser -- --reconnect` | Passed; the browser flow scored with Alice, observed target loss, switched to Bob, then rejoined Alice with the original identity and score without duplicate membership. |
| `npm run test:browser -- --wave-timeout` | Passed; real player and spectator HUD countdowns both decreased from about 62.51 seconds. Timeout at level 1 of 2 displayed the saved one-player standings in both windows; Reload saved result preserved them. The persisted row had 0 points, 0 kills and 1 death. |

Contract review found that the external-consumer fixture still pinned
`ea65708b1ad0ed57cfdb9e5f6c795552b814c1e3`, before the committed additive
countdown SDK and timeout-result contract changes. The first full-suite run
therefore failed the fixture's no-drift assertion. Updated
`tests/contract/external-theme/engine-contract.lock.json` to pin this verified
commit and list the themes, realtime, settings and HTTP contracts; the full suite
then passed. No further drift was found: the settings/spec use the same
`min(300, 60 + 3 * starting NPC count)` tuning and unchanged roster growth; the SDK
and realtime contract describe a monotonic server deadline, no intermission timer,
player/selected-spectator HUD values and timeout precedence; HTTP/result schemas
allow saved standings below `maxLevels`. This adds no lobby setting or capacity
change.

Two verification-harness corrections were needed. The first quickstart browser
attempt expected `Play` after a player socket detached; the realtime contract
requires HTTP Rejoin before the replacement socket, so the browser step now uses
`Rejoin` and the run passed with the original one-NPC fixture. An initial Vite
launch from the repository root returned 404; starting it from `apps/client`
made the client, readiness and Chrome debugging endpoints return 200. Neither
failed attempt is counted as a pass.

Not run: live death-to-respawn in the browser (death/respawn remains covered by
automated and synthetic HUD checks), process-restart durability, theme installation
and hostile-package upload scenarios, production/Lightsail deployment, or T042's
separate-host 1/3/5-room capacity matrix and 30-minute soak. These checks do not
block this local T043 slice and are not represented as executed evidence.
All browser test services and the isolated Chrome profile were local; no deployment
or commit was made. T042 remains open.

## Focused Dots and Squares wave countdown (2026-11-07)

Implemented on `001-multiplayer-engine` as an uncommitted follow-up to
T005/T021/T023/T027 and FR-021, not a capacity/deployment slice.
Windows, Node 24.11.0, npm 11.6.1; in-memory SQLite and injected monotonic time.

| Check | Observed result |
| --- | --- |
| `npm run check` | All workspace checks and tools type-check passed after the final source changes |
| Focused Vitest selection below | 11 files, 56 tests passed |
| `git diff --check` | Passed |

Executed focused command:

```powershell
npm test -- tests\wave-countdown.test.ts tests\integration\wave-timeout.test.ts tests\default-skin.test.ts tests\default-respawn.test.ts tests\results.test.ts tests\result-contract.test.ts tests\integration\session-lifecycle.test.ts tests\integration\gameplay.test.ts tests\spectator-view.test.ts tests\default-theme.test.ts tests\fixture-theme.test.ts
```

Coverage checks the provisional duration formula at/below/above the 300-second
cap; fresh budgets after wave clear/intermission; strict deadline precedence;
continued time through death, safe respawn and disconnection; no respawn at
expiry; and identical player/spectator wave time. Synthetic DOM tests mount the
real default skin for both roles, verify the timer alongside the respawn HUD,
hide it during intermission and dispose its element. These are not browser runs.

The timeout integration uses the real module, runner, lobby and finalization
path with fake interval scheduling and injected `performance.now`. A long clock
jump exercises expiry independent of dropped simulation ticks. It verifies one
completion request, one result/standings transaction, one disposal/notification,
released reconnect/session slots and creation of a replacement room. A second
case deliberately duplicates the completion request to verify once-only core
finalization. Both cases save the actual reached level below `maxLevels` and
reload the same standings twice through the authenticated HTTP result endpoint,
including public-schema validation. Existing normal two-level completion,
growth, health, respawn and fixture regressions remain covered.

The first focused run had three new fixture failures: the HUD helper was
accidentally scoped inside another test, and the timeout fixture's second clock
advance was only one millisecond, insufficient for another fixed simulation
step. The helper was moved to file scope and the fixture advances a full step
while reaching the exact deadline. The first 10-file rerun passed (50 tests);
after adding public-result reload/contract coverage the 11-file selection passed
(55 tests), then the final duplicate-completion selection passed (56 tests).
`npm run check` passed both times it was executed.

NPC growth, health, configured entity/session capacities and production settings
are unchanged. No browser, full-suite, deployment or separate-host capacity
scenario was executed. T042 remains unchecked.

## T023 - Dots and Squares browser view (2026-11-06)

T022 was committed as `f0ce5b8` on `001-multiplayer-engine` before this slice.
T023 used the public theme skin factory and browser skin host; T024 results and
back-to-lobby presentation were not included in that slice.

Executed on Windows with Node 24.11.0 and Chrome 156.0.8078.80:

| Check | Observed result |
| --- | --- |
| `npm run check` | All workspace TypeScript checks passed |
| `npm run build` | All workspace/server/client builds passed |
| `npm test` | 16 files, 76 tests passed |
| `npm run test:browser` | Two visible windows, separate authenticated browser contexts; all assertions passed |

The browser test used an isolated server on `127.0.0.1:8083` with an in-memory
database and Vite on `127.0.0.1:5174`, both loading the ignored local `.env` with
test-process-only overrides. Readiness, client HTTP and Chrome debug endpoints
returned 200 before the scenario. No production data/settings were changed.

The test registered and logged in two synthetic users through the normal forms,
created a session with one NPC per player, 100000 base NPC health and one level,
joined the second player before starting, then opened each player's normal Play
view. Actual CDP keyboard and mouse events controlled the two windows. Bob moved
up while Alice stayed still; Alice then moved right while Bob stayed still.
Canvas draw calls showed each own dot exactly at its viewport center and the peer
dot only after moving within the viewport. Snapshots agreed on the peer position.
Outgoing messages retained `v:1`, `client.input`, a sequence and the module's
`combat` action. Mouse hold/release sent firing/neutral intent. Points were larger
than health and both matched received authoritative state. Resizing from a
1000x900 window to 800x740 retained centering and correct DPR backing dimensions.

A separately mounted, explicitly synthetic public-host fixture verified NPC
squares, player dots, independent camera state, keyboard intent, the five-second
death HUD, neutral controls on death, unsupported-schema rejection and listener/
frame/canvas cleanup. It did not modify the server simulation or count as a
live-match death/respawn test.
An injected browser connection fixture also verified increasing input sequences
and rejection/closure instead of queue growth at the 16 KiB control-buffer limit.
The final browser run, including that bounded-buffer check, passed. Test services,
browser contexts and the isolated debugging browser were closed afterward.

Initial harness attempts failed: a refresh-completion race prevented opening
creator controls; a misplaced helper prevented selecting the test session; integer
`clientWidth` comparisons did not match fractional CSS pixels; and the expected
action-key list accidentally omitted `type`. The harness was corrected to wait
for refresh completion, select by creator, measure actual bounding rectangles and
assert the complete envelope. A browser debug disconnect during an early attempt
was reported rather than counted as a pass. The successful run above occurred
after those corrections. Build output also contained non-fatal Rollup warnings
about Zod dependency comment annotations.

No human visual review, Edge/Firefox exercise, complete-match/results UI scenario,
deployment or capacity measurement was run.

### Repeating the browser check

Build the workspaces, then run a disposable local server/client with the ports
above (or set `BROWSER_TEST_ORIGIN` for the client origin). Launch Chrome in a
separate disposable profile with remote debugging on loopback port 9223 and
background-rendering throttling disabled. Run `npm run test:browser`; override
`BROWSER_DEBUG_URL` when using another local debugging port. The script creates
two separate visible browser windows and closes only its own contexts afterward.
Use disposable accounts/data: it exercises real registration and creates a match.
Keep remote debugging local and close that isolated browser after verification.

## T024 - Saved standings and lobby return (2026-11-06)

T023 was committed as `38f4437` (`feat: add playable Dots and Squares browser
view`) before implementation. T024 adds authenticated saved-result retrieval,
the post-persistence lifecycle notification and the default theme's results skin.
T025 remains unstarted.

`npm run check` and `npm run build` passed. The affected Vitest selection passed:
7 files, 35 tests (`session-lifecycle`, `results`, `result-contract`, `protocol`,
`default-skin`, `realtime`, and `accounts-lobby`). The normal session-start
integration completed two levels, received the saved-result notification, reloaded
identical saved standings, verified unauthenticated retrieval fails and confirmed
the result remains exactly once with the session slot released. Contract tests
cover missing/invalid scores, ordered unique ranks and honest unfinished results;
storage tests preserve score/kills/deaths/normalized-username tie ordering.

`npm run test:browser` passed in two visible Chrome 156.0.8078.80 windows on the
same isolated local ports described above. After the existing movement/HUD checks,
the test returned to the lobby, created a one-level solo match with one 1-HP NPC,
started normally and fired through mouse controls. Completion automatically
displayed saved final standings (100 points, one kill). Reload saved result and a
full page refresh retained the same table and `#results/<UUID>` URL. A public-host
results fixture verified all five table columns, preserved ranks, navigation and
disposed button handlers. An unknown-result URL displayed the actual server error
and supported retry and Back to lobby; a rejected game connection also retained
working lobby navigation.

Initial T024 checks intentionally failed for the missing lifecycle notification.
Two implementation placements were corrected after TypeScript checks caught a
nested transport method and a completion callback placed in shutdown rather than
finalization. The first browser completion attempt aimed outside the resized
Canvas; the harness now aims along the NPC direction inside the viewport. A later
attempt ran while builds rewrote watched workspace outputs and lost its mounted
Canvas; repeated attempts also consumed disposable session slots. Neither was
counted as a pass. The final successful browser run used a freshly restarted
in-memory test server after all builds completed.

No production deployment, capacity exercise, human visual review or non-Chrome
browser check was performed. The result page refresh was real browser execution;
the results table fixture was synthetic and did not fabricate server standings.

## T025 - Integrated gameplay and shared completion (2026-11-07)

T024 was committed as `7f963ef` (`feat: show saved match standings in the
browser`) before this slice. T025 adds verification only; application behavior
and public contracts are unchanged. T026 was not started.

`npm test` passed: 18 files, 85 tests. `npm run check` and `npm run build`
passed. The build retained the existing nonfatal Zod/Rollup annotation warnings.
The new `tests/integration/gameplay.test.ts` passed all four scenarios:

- Five simultaneous isolated module/world instances use identical player/entity
  IDs but retain independent inputs, scores, death clocks and progression;
  disposal of one instance does not change another.
- Two seeded runs produce identical NPC obstacle-navigation positions over 240
  ticks. Positions remain walkable, the pursuing NPC goes around the obstacle,
  and a distant NPC remains stationary. Each tick starts at most eight searches
  and processes at most 2,048 navigation nodes.
- Two overlapping players claim one health pack exactly once. The frozen
  two-player roster grows the second wave from two 25-HP NPCs to four 50-HP NPCs.
  Same-tick final projectile hits issue one completion request despite another
  step, retaining both players' scores and final level.
- A defeated player remains absent until five seconds elapse, retains score
  through blocked placement, attempts at most 64 clearance checks per retry,
  and reports the blocked metric. A later safe return clears obstacles and
  threats by the required margin and immediately permits contact damage.

`npm run test:browser` passed with two actual visible Chrome 156.0.8078.80
windows and separate authenticated browser contexts on Windows. The disposable
in-memory server used `127.0.0.1:8083`, client `127.0.0.1:5174`, and a separate
Chrome profile with loopback debugging on port 9223. All three services returned
HTTP 200 before execution; builds completed before browser gameplay.

After the independent-movement/camera/HUD/controls checks, both players returned
to the lobby. The creator made a two-level match with one NPC per player, 1-HP
NPCs, zero population/health growth and the normal five-second intermission.
The second player joined before start and opened Play through the normal lobby.
Real mouse controls killed the first wave with one kill per player; the creator
cleared the second wave. No server-world mutation or fabricated completion was
used. Match `e6436789-4166-482b-90fc-9b19f3f19157` produced identical saved
standings and result URLs in both windows:

| Rank | Player | Points | Kills | Deaths |
|------|--------|--------|-------|--------|
| 1 | ViewA_mw5zzm6o | 300 | 3 | 0 |
| 2 | ViewB_mw5zzm6o | 100 | 1 | 0 |

Reload saved result in the creator window and full page refreshes in **both**
windows preserved the same table. Authenticated retrieval confirmed the saved
match ID and final level 2. Existing missing-result retry, results-skin disposal
and Back to lobby checks also passed.

For slot-release verification, three additional waiting sessions were created
through authenticated HTTP requests from the browser, alongside the original
movement match and the completion match. At five active sessions, another
creation returned HTTP 409 / `SESSION_CAPACITY`. After completion, the finished
match was absent, active count was four, and a replacement creation returned
HTTP 201 and restored count five. This tests admission/slot release, not load
capacity or production throughput.

Initial integration fixtures failed because zero-velocity projectiles did not
traverse a collision segment, an artificial navigation position intersected the
generated map's existing wall, and the respawn counter included unrelated NPC
geometry work. Fixtures now use moving projectiles, a separate legal obstacle
location, and count respawn-clearance checks only. No gameplay implementation
was changed to satisfy those fixtures. The first readiness probe used `/health`
and returned 404; `/health/ready` was then verified successfully before the
browser scenario. No failed attempt is counted as a pass.

These are automated CDP-driven browser observations, not human visual approval.
No Edge/Firefox check, server-restart persistence exercise, production deployment
or throughput benchmark was run. Saved-result persistence across browser
refreshes used the disposable server's live database; durable on-disk storage
and exactly-once result behavior remain covered by the full test suite.

## T026 - Spectator admission and target authorization (2026-11-07)

Implemented after milestone commit `b32e92d`. Spectator memberships are live,
session-scoped and capped separately from player participation. Authenticated
same-origin admission, member-only player listing and existing WebSocket target
messages now use the same authority. Target life is read through the public module
snapshot once per player-list operation; connectivity comes from the current
authorized player socket. Dead connected targets remain followable.

Affected checks: `npm test -- --run tests\integration\spectators.test.ts
tests\integration\accounts-lobby.test.ts tests\integration\realtime.test.ts
tests\integration\session-lifecycle.test.ts tests\integration\gameplay.test.ts`
passed (5 files, 25 tests). `npm run check` passed across all workspaces.

The seven spectator integration cases verify simultaneous last-slot admission,
idempotent retries/leave, zero allowance, running-only access, player-role conflict,
authentication/origin/body validation, public player list/life/connectivity,
same-room target validation, foreign/disconnected/departed target rejection,
connected dead target eligibility, forbidden spectator controls, actual unchanged
player entities/NPC totals and persisted participant count, disconnect release,
replacement-socket stale-close protection, explicit leave closing the socket and
terminal cleanup. A failed player-state read also rolls back new admission rather
than leaking a slot. The normal two-level lifecycle integration additionally admits
an observer, completes through actual player actions, and verifies terminal
spectator count returns to zero while final standings retain only the player.

The initial new test run failed because the spectator implementation did not
exist yet. Type-check then caught circular initializer inference and unguarded
module JSON life fields; explicit types and JSON guards resolved those failures.
An early test compared an absent `rosterSize` field; it was replaced with actual
player-array, NPC-entity and participant-row assertions before final verification.

No browser scenario or deployment was run for T026. The lobby spectator button
remains unavailable pending T028. T027 target-derived snapshots and proactive
target-unavailable events were not implemented: admitted spectator sockets
currently receive hello/target acknowledgments, not ordinary player snapshots.
No player reconnect/departure policy was expanded into T029.

## T027 - Selected-player spectator snapshots (2026-11-07)

Implemented on top of the uncommitted T026 slice; neither slice was committed or
pushed during this task. T027 adds the server projection in
`apps/server/src/transport/spectator-view.ts` and wires it through the existing
bounded WebSocket sender. It uses the selected player's public module snapshot,
not a module player view for the observer. Camera position, points, health and
death/respawn data are derived from the target's authoritative player record.
Dead players retain the death position and score until safe respawn; countdown
uses the original deadline and snapshot tick. An additive `spectatorView` field
does not change the v1 envelope or default module schema version.

Each scheduled publication revalidates same-session followability. Target loss
clears selection, discards pending old-target snapshots, and sends one
target-unavailable message with a safe explanation and updated followable players.
No world snapshots are sent without a selected target. HTTP list reads that clear
selection do not suppress the socket notification. Spectator input remains
forbidden and cross-room targeting cannot replace the authorized selection.

Affected tests passed (6 files, 34 tests): `spectator-view`,
`integration/spectators`, `default-respawn`, `integration/realtime`,
`integration/session-lifecycle` and `integration/accounts-lobby`.
`npm run check` and `git diff --check` passed.
Projection tests check living HUD/anchor, dead deadline/countdown/blocked status,
missing/malformed target failures and nonmutation of the player's snapshot.
The real default module test follows a defeated player from tick 10 through tick
159 and safe respawn at tick 160, preserving score and changing the camera anchor.
HTTP/WebSocket tests verify selected-player delivery, disconnected/departed target
notifications, remaining followable players, no-selection snapshot suppression,
switching, input rejection and foreign-room rejection. A bounded-sender test
ensures a coalesced old-target snapshot cannot follow the selection-loss event.

The initial tests failed for the absent projection file and missing spectator
snapshot/unavailable notifications, as expected before implementation.
No browser spectator view or deployment was executed. T028 browser controls,
navigation and renderer integration remain unstarted.

## T028 - Browser spectator controls (2026-11-07)

Added `apps/client/src/spectate.ts`, lobby admission navigation and bounded target
selection in the existing connection client. The spectator browser view validates
the handshake/player list, mounts the default renderer through SkinHost, and uses
its controls slot for Following/Back to Players. Target loss disposes that skin
and displays the server's updated followable list and explanation. Back to lobby
performs explicit leave, and disposal/cancelled admission also releases membership.
View-local listeners and resize/render handlers are disposed on each switch.
The default skin now validates and consumes `spectatorView` camera/HUD/death fields;
spectator keyboard/mouse focus never sends gameplay actions. Completion uses the
existing persisted-result notification and standings page.

`npm run check`, `npm run build` and affected tests passed: 6 files, 26 tests
(`default-skin`, `spectator-client`, `spectator-view`, `integration/spectators`,
`integration/realtime`, `integration/session-lifecycle`). The existing nonfatal
Zod/Rollup annotation warnings remain. Client tests validate bounded public player
lists and server spectator projection fields; server tests retain input/foreign
session rejection, target loss and membership cleanup.

`npm run test:browser` passed twice in three actual visible Chrome 156.0.8078.80
windows on Windows with isolated authenticated contexts: two players and one
observer. Builds completed before each run; the final run restarted the disposable
in-memory server. Server/client/Chrome debug endpoints were responsive on loopback
ports 8083/5174/9223. The observer used the normal lobby Spectate button, selected
the creator, saw the target-centered camera and matching points/health, and sent
no gameplay controls when keyboard movement was attempted. Back to Players then
selected the second player and showed that player's centered view.

The second player returned to the lobby, causing a real disconnected-target
notification. The observer returned to the refreshed player list with the server
explanation, followed the remaining player, then used Back to lobby. An
authenticated session-summary read confirmed spectator count zero. The second
player reopened its existing Play view without implementing reconnect policy.

The observer subsequently joined a normal two-player/two-level completion match,
followed the creator and automatically received the same final standings as both
players. Final run match `3e8887e8-576b-4c84-bf7a-2da580e82550` retained
ViewA_mw60vme5 (300 points, three kills, zero deaths) and ViewB_mw60vme5
(100 points, one kill, zero deaths). Existing player refresh, result reload,
capacity-slot release and result-navigation checks also passed.

A **synthetic public SkinHost fixture**, executed in the observer's actual browser,
verified a five-second respawn label, zero-health HUD, restored health and changed
respawn camera, with zero dispatched actions. It did not kill a player in the
live browser match or fabricate server results; real module death-to-respawn is
covered by the preceding T027 automated evidence. No human visual approval,
non-Chrome exercise, deployment or player-reservation/reconnect test is claimed.
T029 remains unstarted.

## T029 - Account-bound player reconnect

T028 browser work was reviewed and committed locally as `9bf8008`
(`feat: add browser spectator controls`), with only browser/theme/tests/contracts
and verification/task documentation staged. No push was made.

Implemented 60-second account/session reservations, authenticated empty-body
HTTP Rejoin and the lobby Rejoin action. The latest authorized account connection
replaces older connections, including across rooms; matching-generation detach
removes the avatar and controls without changing the frozen roster or NPC budget.
Running Leave forfeits return but retains the result participant row. Expiry or
60 seconds without connected players abandons the empty room even with spectators,
releasing runner, reservations, spectator capacity and the session slot.

Dots and Squares retains score, kills/deaths, health and the original pending
death deadline through disconnect. A living return validates its previous location
first, then uses at most 64 bounded safe-placement candidates. Blocked returns
retry with visible respawn status and no health reset. A dead player whose deadline
passed while absent returns only after authorized admission; no immunity is added.
The public SDK presence hook owns this module behavior; gameplay input remains the
existing module-defined action envelope.

Executed:

- `npm run check`: PASS for all workspaces and prerequisite protocol/SDK/theme builds.
- `npm test -- --run tests\reconnect.test.ts tests\default-respawn.test.ts tests\integration\realtime.test.ts tests\integration\spectators.test.ts tests\integration\accounts-lobby.test.ts tests\integration\session-lifecycle.test.ts tests\theme-sdk.test.ts tests\default-theme.test.ts`: **8 files / 42 tests passed**.
- `git diff --check`: PASS.

Deterministic default-module tests preserve 500 points, five kills and one death
with the original tick-160 respawn deadline, a single returned avatar and unchanged
NPC totals. Additional checks cover an elapsed disconnected deadline and bounded
blocked placement retaining 200 points and 40 health. Real HTTP/WebSocket tests
log in again, deny outsider/unauthenticated/invalid-body admission, require Rejoin
after detach, accept repeated admission without duplication, replace sockets with
stale-close protection and keep two frozen participant rows after forfeiture.
Transport score retention here uses an unchanged zero-point state; nonzero score
and pending-death preservation are exercised with the real default module, not a
claimed browser match.

An injected-clock real-runner check keeps an observer-only room running at
59,999 ms, abandons it at 60,000 ms, clears spectator/reservation state and proves
the room is absent from the active list while its frozen participant row remains.
The normal match-completion/result/slot-release and spectator suites also pass.

Additional UI regression command
`npm test -- --run tests\spectator-client.test.ts tests\default-skin.test.ts`:
**2 files / 6 tests passed** (48 passing tests across the affected checks).

Intermediate checks exposed an unreachable old running-leave branch, stale built
module support during concurrent build/tests, spectator leave incorrectly routed
as player expiry, initial-spawn drift, and test-fixture/nesting mistakes. These were
corrected; final builds and tests ran sequentially to avoid stale package consumers.
At the T029 handoff, no browser scenario, full-suite/load test or deployment had
been claimed. T029 remained uncommitted at that point; no milestone push was made.

## T030 - Reconnect and three-profile verification (2026-11-07)

Added `tests/browser/reconnect.mjs`, loaded by the existing
`npm run test:browser -- --reconnect` branch. The real Chrome scenario created a
match for Alice and Bob, earned a score, and had an observer follow Alice. After
Alice's page disconnected, the observer received target-unavailable and switched
to Bob. Alice used the lobby Rejoin action and resumed with the same account,
score and single player record. A second authenticated WebSocket replaced Alice's
current socket; its snapshot retained unique participant identities, with two
players and one spectator in the session summary.

Executed on Windows with Node 24.11.0, npm 11.6.1 and Chrome 156.0.8078.80. The
test used an isolated in-memory server at `127.0.0.1:8082`, Vite at
`127.0.0.1:5173`, a disposable Chrome profile with loopback debugging at
`127.0.0.1:9223`, and three synthetic accounts. `npm run build` passed, with
the existing non-fatal Zod/Rollup annotation warnings. The targeted Chrome
command `npm run test:browser -- --reconnect` passed once; its completed steps
are printed with the `[reconnect]` prefix. No live death/respawn browser
observation, deployment or load test is claimed.

`npm test` was run once after the browser pass: **21/22 files and 107/108 tests
passed**. The reconnect, default-respawn/death-view, spectator and remaining
realtime integration tests passed. The one failure was
`tests/integration/realtime.test.ts > realtime transport > sends WebSocket
heartbeats and closes after two missing pong responses`, which received
`Unexpected server response: 403`; it was not rerun. The detailed reconnect
coverage remains in the existing reconnect, default-respawn, realtime,
spectators and spectator-view test files rather than duplicating those tests in
a new integration file.

## T031 - Theme compatibility and revision pinning (2026-11-07)

The server validates registered theme metadata against the engine API, installed
module and renderer, and package digest. New matches and waiting-session theme
changes require an enabled revision; start rechecks availability and persists the
exact revision/digest pin. Runtime loading and WebSocket hello resolution use that
pin without requiring the revision to remain enabled, so disabling a revision
prevents new matches while existing matches continue on the retained code. The
client rejects missing revisions, digest mismatches, incompatible engine APIs,
and renderer/module-state metadata mismatches before mounting.

`npm run check` passed, including the workspace type-checks and protocol, theme
SDK and default-theme builds. The affected test selection passed **6 files and
25 tests**, covering SDK compatibility, client digest validation, disabled
revision admission, and active-match pinned resolution after disablement.
`git diff --check` passed. No browser, deployment, load test or full-suite run
was performed for T031. T032 was not started; changes remain uncommitted.

## T041 - Local operations and load-harness smoke (2026-11-07)

`npm exec -- vitest run tests/integration/operations.test.ts` passed once on
Windows: **1 file, 5 tests**. `npm run check` also passed once. The operations
tests verified:

- Temporary on-disk SQLite reopen preserved an account and finished result.
  Stale waiting/running metadata simulated a crash; reconciliation marked both
  interrupted once, and integrity and foreign-key checks passed.
- A synthetic module-step exception produced one failed result and released its
  session slot while another runner continued producing snapshots.
- A fake slow socket coalesced 2,000 snapshots within the 1 MiB sender limit,
  dropping 1,999 obsolete snapshots and flushing tick 2,000. Reliable overflow
  closed it with code 1013; a separate healthy sender still delivered its event.
- A real loopback WebSocket and temporary SQLite database closed during shutdown;
  reopening preserved the account and one interrupted result.

The fifth test invoked the actual load CLI against a disposable server bound to
`127.0.0.1` on an ephemeral port, using an in-memory database and test-only
origin. The CLI ran locally, not from a separate load host. Its configured seed
was 41, with one player and one spectator per room, zero registration interval,
0.2-second warm-up, one room for 0.3 seconds, two rooms for 0.3 seconds, and a
0.3-second soak. Each room used two NPCs per player, 100,000 base NPC health,
one maximum level and otherwise default settings.

The report completed with no reported workload or cleanup failures, two distinct
rooms and five phases. The two-room step had four clients; both players produced
movement and firing actions. Reported clients had positive snapshot and incoming
byte counts, at least one RTT sample was present, and no active authentication
sessions remained after cleanup. The report was temporary; exact throughput,
latency values and resource measurements are not retained or claimed here.

**Separate live-host gates:** no Lightsail commands or changes were made. Native
systemd/Nginx validation, deployed readiness and permissions, public HTTPS and
authenticated WSS, certificate renewal and an isolated restore drill remain
operator deployment checks. The separate-host 1/3/5-room capacity matrix and
30-minute soak remain T042; this short loopback smoke establishes no capacity.

### Failed-room regression (2026-11-07)

The three-room loopback reproduction now injects a labeled module-step exception
in the second room after all three players receive snapshots. A separately
admitted spectator also connects to that room. The harness reports
`Server INTERNAL_ERROR: The game session failed.` rather than `FORBIDDEN`;
both affected sockets receive schema-valid fatal errors without exception details
and are closed with code 1011. The initiating exception and room ID are passed
to the server logger. At the first harness cleanup request the failed room is
persisted as failed and both other rooms are still running. Existing realtime
tests continue to exercise membership and origin enforcement.

`npm exec -- vitest run tests\integration\operations.test.ts
tests\integration\realtime.test.ts` passed: 2 files, 17 tests. `npm run check`
passed. Initial attempts exposed the five-registrations-per-minute limit when
using a spectator in every harness room, missing spectator termination before
the fix, duplicate close-handshake observations, queued input during closure,
and type errors in the pre-existing reproduction instrumentation. The final
test provisions one additional local spectator directly and distinguishes
initiated closes from the WebSocket close handshake.

This was a disposable local loopback exercise, not a capacity measurement.
No Lightsail deployment or load run was performed; T042 remains open.

## T045 - Account controls and facing indicators (2026-11-07)

`npm run check` passed. The focused selection `npm test --
tests/integration/accounts-lobby.test.ts tests/default-theme.test.ts
tests/default-skin.test.ts` passed: **3 files, 18 tests**.

`npm run test:browser` passed in three visible Chrome 156.0.8078.80 windows
against a local Vite client and an isolated in-memory server. Assertions verified
signup preference persistence, lobby preference changes, WASD/turn/Space and
arrow/mouse/click input, distinct player colors and shared spectator
color/facing, and stationary mouse aim updating the same-color facing dot. The
focused account integration test also covered signup choice validation and the
legacy null-choice account flow. The broader browser flow passed its spectator,
saved-results, match-completion and session-capacity-slot checks. Browser
accounts and server data were disposable and local. No production deployment,
load test or capacity result is claimed; T042 remains open.

Verification follow-up: `npm run check` passed; `npm test` passed with **41 files,
179 tests**; the focused account/theme selection passed with **3 files, 18 tests**.
`npm run test:browser` passed in Chrome 156.0.8078.80 with three visible windows,
Vite at `127.0.0.1:5174` and an isolated in-memory server at `127.0.0.1:8083`.
The browser harness returned a legacy-style `controlMode: null` login response to
exercise the first-sign-in picker, then used the real save, sign-out and sign-in
requests to verify the selected preference persisted. The account integration
test independently sets an existing database account's preference to `NULL`,
checks the sign-in/`GET /me` value, saves a selection, and verifies it after
logout and a new login. The theme test verifies color and facing after respawn in
both player and spectator snapshots; the browser spectator fixture renders the
respawned body and facing dot in the same color.

The initial full-suite run exposed stale migration expectations, a realtime test
sending a signup-only field to login, and a movement assertion that did not allow
the newly accepted facing update before a rejected movement step. Those tests
were corrected and the complete rerun passed. The browser fixture also needed
color normalization before comparing CSS HSL input with Canvas's normalized
color value. No production data was used; T042 remains open.

## Live playtest findings (2026-11-07)

`npm run check` passed. The focused default-theme/skin selection passed: **2 files,
11 tests**. `npm run test:browser` passed in Chrome 156.0.8078.80 with three
browser windows and an isolated in-memory server. Browser assertions covered
screen-right forward movement and normalized diagonals in both input modes,
strafing, turning, firing, mouse aiming, distinct player colors and same-color
facing dots in player and spectator views, host-only Start Session placement,
NPC squares, textured terrain tiles, and spectator lifecycle checks.

The one-player room snapshot contains a `spread` pickup, which is the extra
orange circle from the playtest. The renderer now presents it as an orange
diamond with a glyph; the browser fixture places a clone of that pickup near the
player to assert its rendered shape without changing the map generator or
collision geometry. The actual one-player room also verifies the textured,
walkable terrain rendering. No deployment, production data, or capacity result
is claimed; T042 remains open.

## Tile Cluster Arena obstacle playtest (2026-11-07)

Added the playable default-theme arena `Tile Cluster Arena`
(`dots-and-squares-tile-arena-v1`). Its four fixed Tetris-like clusters contain
16 solid 32-by-32 tiles. Geometry is seed-independent and comes from the same
map obstacle rectangles used by the skin renderer, player/NPC collision,
projectile blocking and NPC navigation. Spawn validation confirms the spawn
points are clear and connected; open routes remain around each cluster.

| Check | Result |
| --- | --- |
| `npm run check` | Passed after the final arena and browser-test changes. |
| Focused arena Vitest selection | Passed: 5 files, 33 tests (`tests/maps.test.ts`, `tests/movement-collision.test.ts`, `tests/default-combat.test.ts`, `tests/default-skin.test.ts`, `tests/default-theme.test.ts`). |
| `npm run test:browser` | Passed in Chrome 156.0.8078.80 with three windows; all account, controls, spectator, standings, match-completion and capacity-slot scenarios passed. |
| `node tests/browser/default-game.mjs --arena-obstacles` | Passed in Chrome 156.0.8078.80. Blocked shots left NPC health at 100000; direct movement stopped at `(374.39, 373.82)`; player routed to `(542.39, 307.82)`; NPC routed around the cluster without intersecting tiles; open-angle fire reduced NPC health from 100000 to 99800. Rendered tiles matched the map obstacle rectangles. |

Repeat the encounter in any generated room seed in `Tile Cluster Arena`: start a
one-player match with one high-health NPC. The fixture begins the player at
`(272, 272)` and the NPC near `(507, 507)`, on opposite sides of the northwest
T cluster whose tile origin is `(384, 384)`. The initial direct shot and move
are blocked; the player can route north and around the cluster to reach an open
firing angle. The arena browser fixture is an automated Chrome playtest, not a
claim of a separate human visual review.

One initial dedicated Chrome attempt could not connect because an older local
server still owned port 8082. After stopping that specific listener and starting
a fresh in-memory server, the dedicated encounter passed as recorded above.
All browser services and data were local. No deployment or capacity result is
claimed; T042 remains open.

## Lifecycle encounter fixture correction (2026-11-08)

Terminal `npm exec -- vitest run tests\integration\session-lifecycle.test.ts`
reproduced the first-kill timeout. A second run with temporary test-only
diagnostics confirmed accepted input and real projectiles, not a broken gameplay
path. At tick 2 the player was `(272, 272)` and the NPC was
`(526.4090, 526.4090)`, with normalized shot direction `(0.7071, 0.7071)`.
The radius-3 projectile lane first intersected terrain near `(382.2439,
382.2439)`, beside the northwest T cluster starting at `(384, 384)`.
At tick 30, acceptedInputs was 1, projectile damage was 25 and velocity was
`(424.2641, 424.2641)`, while NPC health remained 1. By tick 60 the moving NPC
had reached `(449.6508, 463.5538)`, off the original fixed aim line.

The lifecycle fixture now requests `npcMovementSpeed: 0` through the real
session settings API and relocates only each newly spawned NPC to `(400, 272)`
through a test-only module wrapper. It does not remove terrain, truncate NPCs,
inject damage/kills/scores or replace combat/progression. Both waves assert the
player at `(272, 272)`, the single NPC at `(400, 272)` and an unobstructed
projectile-radius lane. Passing diagnostics recorded direction `(1, 0)` and no
terrain blockage at ticks 2 and 158. The second wave also checks one accepted
input, 100 points and one kill from the first wave. Existing WebSocket combat,
five-second intermission, two kills/200 points, saved standings, once-only
finalization, spectator cleanup and replacement-session creation remain covered.
All timeouts are unchanged; temporary diagnostics were removed.

The corrected lifecycle test passed, including its verbose diagnostic rerun.
After `npm run check` passed and rebuilt protocol/SDK/theme dependencies, the
final focused selection passed: **5 files, 25 tests** (`session-lifecycle`,
`default-combat`, `maps`, `integration/wave-timeout`, `results`). This was local
terminal verification only, using an in-memory database and ephemeral loopback
WebSocket server. No browser, deployment or capacity run was performed.
The lifecycle fixture is committed with the NPC settings change; T042 remains open.
## Host-only End Session, T048 / FR-025 (2026-11-08)

Implemented End Session directly after Running in the host's lobby status cell,
with a native confirmation dialog. Server authorization uses creator account ID;
players, spectators, outsiders and non-host operators cannot end the match.
The authenticated same-origin empty-body endpoint returns the immutable saved
result, sharing normal completion's transaction, runner disposal, membership/slot
release and player/spectator lifecycle notification. Host retries after normal
or explicit completion do not write or notify again.

Intermission now queues the next level and persists it only when that wave
starts. Ending during the summary therefore saves the cleared/reached level,
not the unstarted next wave. The normal two-level integration still exercises
both real projectile kills, the existing five-second intermission and final
standings; its level-2 database wait now includes that actual intermission.

Actual local checks:

```powershell
npm run check
npm test -- tests\integration\end-session.test.ts tests\integration\wave-timeout.test.ts tests\integration\session-lifecycle.test.ts tests\integration\gameplay.test.ts tests\integration\spectators.test.ts tests\integration\operations.test.ts tests\results.test.ts tests\result-contract.test.ts tests\lobby-settings.test.ts
node --check tests\browser\end-session.mjs
node --check tests\browser\default-game.mjs
git diff --check
```

Workspace check passed. Final focused selection passed **9 files / 38 tests**.
The four new integration cases cover host-first and normal-completion-first
ordering, concurrent/repeated end requests, intermission at level 1 and active
level 2. They verify exactly one result/finalizer/disposal, ranked nonzero scores
(275 points, 3 kills, 2 deaths), membership/capacity release, replacement creation
and the exact result after closing and reopening a temporary disk SQLite database.
Denial covers member, spectator, outsider and non-host operator, before and after
completion; login/origin/body rejection is also checked. Existing timeout coverage
continues to verify duplicate module completion and once-only result notification.
The lobby test checks host/running-only placement, cancel without HTTP and accepted
confirmation with the empty-body POST.

`node tests\browser\default-game.mjs --end-session` passed twice in visible
Chrome **156.0.8078.80**, with three isolated authenticated browser contexts on
Windows, client `http://127.0.0.1:5174`, loopback server port 8093 and CDP port
9223. The server used the existing Node `.env` startup loader with process-local
test/origin/port/database overrides and an ignored disposable database; no
persistent environment or production settings changed. No staged game module,
score editing or countdown adjustment was used. Both runs used default match
settings, two players and one spectator; the host returned to the lobby.

The final run verified the rendered End Session control immediately after Running,
absence for waiting/non-host rows, direct non-host HTTP 403, real native dialog
cancel/accept, room removal, matching two-player final tables in player/spectator
views, saved-result reload and full refresh in both, exact immutable retry response,
finalLevel 1 and replacement-room creation. Both browser rows had zero scores;
nonzero standings are verified by the automated integration fixtures, not claimed
as browser-earned combat. The scrolled lobby screenshot was inspected and retained
outside the repository in the session artifacts.

Initial failures were retained as evidence: all three original new cases first
failed with the missing endpoint (404); after implementation their reopen check
failed because app.close closes the in-memory database. The fixture was corrected
to reopen a real temporary disk database. A later type-check caught insufficient
narrowing of the optional module level; an explicit number guard resolved it.
The first browser attempt timed out while Vite logged page reloads during a
concurrent workspace build; the retry hit the existing five-registration/minute
throttle. Restarting only the owned disposable server and running browser checks
without overlapping builds produced the two passing runs above; no throttle,
timeout or production behavior was relaxed.

T048 is complete. The pre-existing Wave HUD maximum countdown note above is
unchanged, the Theme Credits feature pointer and `.idea` are untouched, and
**T042 remains open**. Changes remain local and uncommitted; no push, deployment
or capacity run was performed.
