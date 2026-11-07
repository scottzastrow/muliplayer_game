# Multiplayer Game Engine

Browser-based multiplayer game engine POC targeting AWS Lightsail. Development uses GitHub Spec Kit. The initial requirements brief below is preserved as conversation history; the specification resolves its open questions using explicitly labeled editable assumptions.

## Current development baseline

Spec Kit 1.3.2 is configured for IntelliJ + GitHub Copilot with PowerShell helpers. Game implementation has not started.

- [Project constitution](.specify/memory/constitution.md)
- [Specification and editable POC assumptions](specs/001-multiplayer-engine/spec.md)
- [Implementation plan](specs/001-multiplayer-engine/plan.md)
- [Ordered implementation tasks](specs/001-multiplayer-engine/tasks.md)
- [Theme developer contract](specs/001-multiplayer-engine/contracts/themes.md)
- [Planned quickstart and validation](specs/001-multiplayer-engine/quickstart.md)

Open this checkout in IntelliJ with Copilot Agent mode. Follow `.github/copilot-instructions.md` and the installed skills in `.github/skills/`. If exposed by your plugin, `/speckit-implement` executes the task list and `/speckit-converge` assesses remaining work; otherwise ask Copilot to read the matching SKILL.md and follow it. These are chat workflows, not terminal commands. See AGENTS.md before edits. The current feature is `specs/001-multiplayer-engine`; if the checkout-local `.specify/feature.json` pointer is absent, the matching branch name allows the scripts to resolve it. Do not rerun init over project changes unnecessarily.

## Repository ownership and configuration

- Engine: https://github.com/scottzastrow/multiplayer-game-engine — core, server, SDK/contracts, default reference theme and owner-controlled releases.
- Themes: https://github.com/scottzastrow/multiplayer-game-themes — designer-owned theme modules, skins and assets, with read-only version-pinned SDK consumption.
- Theme collaborators do not need engine write access or Lightsail access. Repository separation supplies the permission boundary; AGENTS.md is guidance, not an access control.
- Local configuration uses an ignored `.env` copied from `.env.example`; no Windows system environment variables required. Runtime loading must be implemented before these examples are considered runnable.
- Production configuration will live in `/etc/multiplayer-game/game.env`, loaded by systemd. Never put production secrets in either repository or browser bundles.
- Hosting baseline: [deployment record](docs/hosting.md). HTTPS placeholder is configured; game runtime is not deployed.

## Confirmed scope

- Public registration and login with username and password; authenticated players can rejoin their existing active session. Store password hashes, never plaintext passwords.
- Main lobby lists game sessions. Any authenticated player can create and start a session.
- Server-wide cap: five simultaneous sessions, counting waiting and running sessions. Creation must enforce the cap on the server, including concurrent requests.
- Each session has isolated players, spectators, map, enemies, settings, scores, and progression.
- Players may join waiting sessions within capacity. Once started, new player admission is disabled; returning participants may reconnect.
- Spectating remains available during play within the session spectator limit. Select a player from a list; follow that player's camera and HUD data; return to the player list to switch targets or return to the lobby.
- Each player's camera stays centered on that player in a shared map. Nearby players become visible when their world positions enter the viewport. No shared fixed-screen arena.
- Default theme: player dots, enemy squares, simple obstacles. Minimal graphical development.
- Enemies activate pursuit within a range rather than all converging immediately. Include obstacle avoidance/navigation and valid traversable generated maps.
- Begin with ten NPCs per player. Configurable NPC population and health growth increase difficulty between levels.
- Scatter weapons and power packs through generated maps.
- On death, remove the player from the board for a configurable respawn delay, default five seconds. Return them at a random safe location clear of obstacles and immediate enemy contact. No temporary damage immunity after respawning. Preserve accumulated match points.
- Top HUD prominently displays running match points as the largest statistic, plus health. Spectators see the selected player's values.
- Clear all NPCs to complete a level; generate subsequent levels. A configurable maximum level count ends the match with a leaderboard ranked by total points.
- Measure actual multiplayer server capacity, including simulation time, latency, traffic, player/NPC counts, and resource use under load. No unsupported player-capacity promises.

## Session settings

| Setting | Confirmed default |
| --- | --- |
| Maximum players | TBD |
| Maximum spectators | TBD |
| Starting NPCs per player | 10 |
| NPC population increase rate per level | TBD |
| Starting NPC health | TBD |
| NPC health increase rate per level | TBD |
| Respawn delay | 5 seconds |
| Maximum levels | TBD |
| Game Theme | Default Theme |

Define rate units, rounding, limits, and validation explicitly during specification. Do not silently turn earlier suggested numeric defaults into approved requirements.

## Theme architecture: implement from the start

The user-facing concept is **Game Theme**. Session creators select an installed theme for the whole session; all players and spectators use it. Different sessions may use different themes.

A theme contains developer-facing components:

1. **Game module**: gameplay behavior, entities, abilities, combat, NPC logic, map generation, pickups, scoring, progression, and supported overrides.
2. **Skin**: rendering, animation, audio, HUD, and presentation extension points, including support for substantially different presentation rather than only replacing sprite files.
3. **Theme definition**: identity, versions, compatible engine/module/skin contracts, assets, and exposed settings.

The core engine owns identity, session lifecycle, networking, authoritative execution, and metrics. Define versioned extension interfaces; do not hard-code default-theme assumptions into the core or require all future entities to use the same weapon or behavior. Prefer composable capabilities where appropriate rather than a universal entity class with unsupported actions.

The default module and skin must use the public extension contracts and serve as working examples. Include a developer guide, event/state contracts, and an example/preview workflow for the separate theme developer's AI.

Provide theme browsing, selection, and a package upload/installation workflow. Executable modules require administrator installation; uploading a skin must not execute arbitrary browser or server code. Specify package validation, compatibility checks, and failure behavior before implementing installation.

## Decisions still requiring specification

The following are proposals or open questions, not locked requirements:

- Exact movement/aim/fire controls, weapon types, pickup effects, damage, scoring, and friendly-fire rules.
- Growth formulas, initial health, maximum levels default, maximum players/spectators defaults, attraction range, and total NPC/resource ceilings.
- Whether NPC counts use the roster at match start or currently connected players; recommended: stable match roster so disconnecting does not change the level target.
- Reconnect reservation duration, duplicate login handling, owner departure, empty-session cleanup, finished-session retention, and spectator target disconnect behavior.
- Between-level transition behavior, shared versus distinct spawn positions, safe-spawn fallback when no valid point exists, and leaderboard ties.
- Exact theme upload permissions, package format, install process, and presentation extension boundaries.
- Persistent data beyond accounts and match results; restart/recovery expectations.
- Technology stack. Proposed: TypeScript browser client, Node.js authoritative WebSocket server, relational persistence, Nginx/HTTPS and systemd on Lightsail. Finalize through the Spec Kit plan.

## Spec Kit workflow

Initialize the official Specify CLI integration in a local checkout using the current official instructions: https://github.com/github/spec-kit . Do not substitute handwritten slash commands or label this brief as a completed CLI installation.

1. Constitution: server authority, session isolation, extensibility through documented contracts, secure account handling, measured performance, focused verification, and minimal default visuals.
2. Specify: turn the confirmed scope above into user stories, acceptance criteria, edge cases, and explicit clarification items.
3. Clarify: resolve the open decisions that affect architecture or visible behavior.
4. Plan: select the stack and define engine/module/skin contracts, data model, networking, deployment, and load-testing method.
5. Tasks: order implementation into verifiable slices, including a real default theme and extension example.
6. Implement and verify against the specification using the installed integration's current workflow.

Keep agent work and validation evidence in the repository. Build sequentially on a feature branch; avoid unnecessary worktrees or parallel agent handoffs.

## Current status

Requirements captured and Spec Kit planning completed on November 6, 2026. Constitution v1.0.0, specification, research, data model, HTTP/realtime/theme/settings contracts, validation guide and 44 unchecked implementation tasks are present. No application code, runtime/browser tests, capacity results, or deployment yet.
