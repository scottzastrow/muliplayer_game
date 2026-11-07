# Local verification

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
