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
