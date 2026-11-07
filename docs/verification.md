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
