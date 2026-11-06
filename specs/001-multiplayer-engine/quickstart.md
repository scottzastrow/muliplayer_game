# Planned Quickstart and Validation

Status: design only. Application commands below are the required interface to be
implemented by tasks, not commands verified against existing game code.

## Current Spec Kit use

Install Python 3.11+, uv, Git, and a compatible Codex environment. This repository
was initialized using Specify CLI 1.3.2 with Codex skills and Bash scripts. Pin the
same version when reproducing the setup:

```bash
uv tool install specify-cli==1.3.2
```

Clone the repository, check out `001-multiplayer-engine`, and open Codex at its root.
The `.agents/skills/` directory supplies `$speckit-implement`, `$speckit-analyze` and
`$speckit-converge`; these are agent chat invocations, not shell commands. Read the
constitution/spec/plan/tasks and preserve explicit assumptions before implementing.

## Required application command interface (future implementation)

Prerequisites: Node 24 LTS, npm, local writable disk, supported desktop browser.
Create `.env` from the future `.env.example`. No live credentials are needed locally.
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

`dev` must start the server and Vite client together. Root scripts must also support
`npm start` for built production assets/server, `npm run theme:preview -- --theme default`,
`npm run theme:validate -- --package <path>`, and local operator bootstrap via
`npm run operator:grant -- --username <existing-account>` (never a password argument).
If files/scripts do not yet exist, complete corresponding tasks instead of treating
these future commands as passing evidence.

## Manual acceptance exercise

1. Open two separate browser profiles. Register Alice and Bob using distinct passwords;
   verify invalid login fails. Create a two-level session, have Bob join, and start.
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

The future command `npm run load -- --config <workload.json>` must use real public
registration/login and socket paths on an operator-authorized test target. Run it
from another machine. Use synthetic accounts, a known map seed and disposable data.

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

No AWS provisioning, cost increase, host changes or production load tests have run.
