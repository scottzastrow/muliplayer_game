# Planned Quickstart and Validation

Application commands below are implemented unless explicitly identified as future
workload or deployment interfaces. Their existence does not imply that an unexecuted
browser, deployment, or capacity scenario has been verified.

## Current Spec Kit use

Install Python 3.11+, uv, Git, and IntelliJ with GitHub Copilot Agent mode. This repository
uses Specify CLI 1.3.2 with Copilot skills and PowerShell helpers (Bash helpers remain available). Pin the
same version when reproducing the setup:

```bash
uv tool install specify-cli==1.3.2
```

Clone the repository, check out `001-multiplayer-engine`, and open it in IntelliJ.
The `.github/skills/` directory supplies the Spec Kit workflows. Read
`.github/copilot-instructions.md` in Copilot Agent chat. If the plugin exposes them,
use `/speckit-implement`, `/speckit-analyze` and `/speckit-converge`; otherwise ask it
to read and follow the corresponding SKILL.md. These are chat workflows, not shell commands. Read the
constitution/spec/plan/tasks and preserve explicit assumptions before implementing.

## Required application command interface (future implementation)

Prerequisites: Node 24 LTS, npm, local writable disk, supported desktop browser.
Copy committed `.env.example` to ignored `.env`; startup scripts must load it automatically. No Windows system environment variables are required. No live credentials are needed locally.
Expected environment: HOST=127.0.0.1, PORT=8082, DATABASE_PATH=./var/game.sqlite,
PUBLIC_ORIGIN=http://localhost:5173, NODE_ENV=development. Development proxy forwards
HTTP and WebSocket requests from Vite to the local server. Production uses one HTTPS origin.

```bash
npm ci
npm run db:migrate
npm run build
npm run check
npm test
npm run dev
```

`dev` must start the server and Vite client together. Root scripts also support
`npm start` for built production assets/server and `npm run theme:preview`,
`npm run theme:validate -- --package <path>`, and local operator bootstrap via
`npm run operator:grant -- --username <existing-account>` (never a password argument).
`theme:preview` launches deterministic local renderer fixtures; it is not a
multiplayer server. Task evidence records checks actually run.
`npm run theme:validate -- --package <archive.zip>` validates and installs an asset
package that references code already registered in the server build. It never
installs executable code from an uploaded archive.

## Manual acceptance exercise

1. Open two separate browser profiles. Register Alice and Bob using distinct passwords;
   choose a different control mode for each, verify invalid login fails. Create a
   two-level session, have Bob join, and start.
   Verify keyboard-only WASD movement, arrow-key turning and Space fire; verify
   keyboard+mouse arrow movement, pointer aim and left-click fire. Turn/aim while
   stationary and confirm the same-color facing dot follows; confirm room player
   colors differ and spectator views show the same colors and facing.
2. Move apart and meet; verify independent centered cameras and nearby visibility.
   Attract only nearby NPCs; navigate around obstacles and claim pickups.
3. Kill one player and time the five-second absence. Verify the other keeps playing,
   score persists, a random safe return occurs, and no immunity follows it.
4. In a third profile, log in as Carol. Confirm Join is disabled but Spectate works.
   Select Alice/Bob, observe HUD and death state, switch targets and return to lobby.
5. Disconnect/reconnect Alice within 60 seconds and verify identity, points and
   remaining death delay. Verify a new account cannot join the running roster.
6. Clear both levels; verify growth and final standings. Reload results and confirm
   the active session slot is released. Restart server; accounts/results survive and
   any other formerly active sessions are Interrupted.
7. Exercise five waiting/running sessions and concurrent sixth creation; test player
   and spectator cap races, zero spectator allowance, and empty-session cleanup.
8. Install the fixture through the trusted developer workflow. Run beside default;
   confirm alternate behavior/HUD, immutable theme pinning and no core file edits.
9. As operator, test valid asset upload and reject incompatible, oversized, traversal,
   executable and malformed packages. Regular account installation must fail.

Record actual environment, commit, steps, observed results and failures in
`docs/verification.md`; never mark scenarios run solely because they are documented.

## Capacity experiment (requires separately provisioned target)

The command `npm run load -- --authorized --config <workload.json> --output
<report.json>` uses real public registration/login and WebSocket paths on an
operator-authorized disposable test target. Run it from another machine for
capacity evidence. It never reads the server database or bypasses admissions.

The template is `tools/load/workloads.json`. Copy it into ignored `var/`, set the
explicit HTTP(S) target origin and workload settings, then run, for example:

```powershell
npm run load -- --authorized --config var\workload.json --output var\load-report.json
```

`origin` may be set separately when an authorized local API listener's configured
public origin differs from its address. No operator credentials are required.
The harness creates synthetic accounts with random credentials in memory; it does
not save account names, passwords or cookies. Existing output files are rejected
before sending load. SIGINT/SIGTERM stops the run and attempts public Leave/logout
cleanup. Synthetic accounts/results remain on the disposable target; running
rooms may take the normal 60-second abandonment interval to release capacity.

`playersPerRoom` (1-32), `spectatorsPerRoom` (0-64), and settings are fixed for a
run because the roster locks at start. `steps` adds independent rooms in strictly
increasing order, up to five. Each step gets a bounded warm-up before measurement;
an optional soak follows the last step (up to 1800 seconds). Run separate configs
to vary players, spectators and enemy settings. The default registration interval
of 12.5 seconds respects the five/minute IP registration limit; large setup takes
time and is excluded from phase measurements. Lowering that interval does not
bypass throttles: HTTP 429 is a failed run, not a retry or success fallback.

Players send bounded 30 Hz intents toward nearby enemies, fire, seek pickups when
health is low, avoid local obstacles, and send neutral input while dead or between
levels. Spectators independently follow their room's creator and never send combat
input. The harness seed reproduces client random decisions given the same snapshots,
not the complete simulation: the public API currently generates server map seeds
and does not expose a seed override. Reports include first-map fingerprints and
pinned revisions/digests rather than claiming a controlled server map seed.

JSON reports include config, client Node/platform/architecture, actual phase
durations, per-room/role bytes and actions, moving/firing counts, snapshots, control
queue high-water and bounded application ping/pong RTT histograms. Warm-up samples
are labeled separately. Percentiles are bucket upper-bound estimates. One latest
snapshot and one pending ping are retained per client, with 16 KiB control queues
and 10-second request/message/ping timeouts. Server errors, unexpected closes,
premature match completion, missing snapshots and cleanup failures mark the report
failed and produce a nonzero CLI exit. A completed run means the workload executed,
not that a host met capacity budgets. Collect the operator metrics JSON separately
for host/runner timing, CPU/RSS and server queue/deadline evidence.

- Test 1, 3 and 5 rooms with 1/2/4 players per room, then raise players intentionally.
- Vary spectators separately (0/4/8 per room); raise active enemy totals/difficulty.
- Exercise proximity pursuit, navigation, fire and pickup claims; idle sockets alone
  do not demonstrate gameplay capacity.
- Include warm-up, stepped increases, and a 30-minute soak near sustainable load.
- Record host CPU/RAM/instance size, co-hosted services, revision, dependency versions,
  settings, tick/snapshot rates, p50/p95/p99 tick time, missed deadlines, event-loop
  delay, CPU/RSS, bytes, queue sizes, RTT, unexpected disconnects and errors.
- Apply the provisional budgets in plan.md; stop/label failed runs on runaway queues,
  memory pressure or sustained deadline misses. Record failures as well as passes.

Dedicated Lightsail infrastructure and HTTPS placeholder were configured by the owner; see ../../docs/hosting.md. No game deployment or production load test has run.
