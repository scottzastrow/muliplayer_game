# Feature Specification: Multiplayer Engine and Default Theme

**Feature Branch**: `001-multiplayer-engine`

**Created**: 2026-11-06

**Status**: Specified; implementation not started

**Input**: Build the agreed multiplayer POC as an extensible engine from the start,
with Game Themes containing developer-facing game modules and skins. Use Spec Kit.
The README preserves the original requirements brief; assumptions below resolve
unspecified details for an editable first implementation, not retroactive user decisions.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Create an account and a game session (Priority: P1)

A visitor signs up with a username/password, logs in, views sessions, creates a
session, configures it, and starts it. Other users may join before it starts.

**Why this priority**: Establishes real shared sessions and access rather than a local demo.

**Independent Test**: Two accounts join one waiting session; create five sessions;
a sixth creation fails without disrupting the first five.

**Acceptance Scenarios**:

1. **Given** a new username, **When** a visitor signs up and logs in, **Then** they see the lobby; incorrect credentials fail without exposing account secrets.
2. **Given** fewer than five waiting/running sessions, **When** a user creates one, **Then** it appears with its creator, theme, state, level, and player/spectator capacities.
3. **Given** five sessions, **When** two users attempt creation concurrently, **Then** neither creates a sixth; the visible creation control is disabled and direct requests also fail.
4. **Given** a waiting session, **When** its creator changes valid settings and starts it with at least one player, **Then** settings lock and new-player Join becomes unavailable.
5. **Given** invalid settings or a full roster, **When** a request is submitted directly, **Then** it fails with a useful reason and leaves session state unchanged.

### User Story 2 - Play together through generated levels (Priority: P1)

Players move through a shared map, fight nearby enemies, collect equipment, die,
respawn, and complete a finite match while keeping their own centered view.

**Why this priority**: Proves the multiplayer simulation and the default gameplay loop.

**Independent Test**: Two browsers move apart and meet again; kill enemies, die,
respawn, complete two levels, and compare final scores.

**Acceptance Scenarios**:

1. **Given** two players, **When** they travel apart and then meet, **Then** each remains at their own screen center and sees the other only within their viewport.
2. **Given** enemies outside the configured NPC detection range, **When** no living player is in range, **Then** they explore at half configured speed from the first update along seeded reachable paths into new areas with only brief pauses; entering range makes them eligible, and only NPCs holding one of that player's two pursuit slots switch to configured-speed pursuit while the others keep exploring. Losing pursuit resumes exploration immediately. Zero range allows exploration without pursuit; zero speed keeps NPCs stationary.
3. **Given** a player at zero health, **When** death occurs, **Then** their avatar and combat input disappear for the configured delay (five seconds by default), their score persists, and they return at a random safe position without damage immunity.
4. **Given** a level with enemies, **When** the last enemy dies, **Then** the next map and configured increases apply once; after the configured final level, the match finishes instead.
5. **Given** a running match, **When** points or health change, **Then** the top HUD updates with points visually dominant; the final leaderboard ranks total points and includes kills and deaths.
6. **Given** weapon or power pickups, **When** two players claim one at once, **Then** only one receives its effect and all viewers see its removal.
7. **Given** a new or existing account, **When** its owner selects a control mode, **Then** the choice is required at signup or on first sign-in after the update, saved to the account, and changeable from the lobby.
8. **Given** multiple players in one room, **When** they play, **Then** each has a distinct stable color and visible facing marker shared by players and spectators.

### User Story 3 - Spectate and reconnect (Priority: P2)

A user spectates an active session, chooses whom to follow, switches targets, and
can return to the lobby. A disconnected participant can sign back in and rejoin.

**Why this priority**: Supports closed active rosters without excluding observers or returning players.

**Independent Test**: A third account spectates either player, sees a death countdown,
switches targets, and cannot control gameplay; a participant reconnects with the same score.

**Acceptance Scenarios**:

1. **Given** a running game, **When** a nonparticipant opens its lobby entry, **Then** Join is disabled and Spectate is available only below the spectator cap.
2. **Given** available spectator capacity, **When** a user chooses Spectate, **Then** they see the player list and can follow a selected player's camera/HUD data using their own display dimensions.
3. **Given** a dead target, **When** its spectator watches, **Then** the countdown appears and the view follows the respawn; Back to Players and Back to Lobby remain usable.
4. **Given** a target leaves, **When** it is no longer followable, **Then** observers return to the player list with an explanation.
5. **Given** an authenticated reserved participant, **When** they reconnect within the reservation window, **Then** they resume their identity, score, and remaining death timer even though new-player admission is closed.
6. **Given** concurrent spectate requests for the last slot, **When** both arrive, **Then** only one succeeds. Spectators never add NPCs or occupy player slots.

### User Story 4 - Select and develop Game Themes (Priority: P2)

Creators select an installed Game Theme. A separate developer builds a module and
skin using documented extension points, starting from the default working example.

**Why this priority**: Extensibility is part of the engine foundation, not a later retrofit.

**Independent Test**: Run the default theme and a small developer fixture theme with
a changed behavior and HUD in separate sessions without editing engine internals.

**Acceptance Scenarios**:

1. **Given** two installed themes, **When** creators select different ones, **Then** each session's players and spectators receive its chosen theme consistently.
2. **Given** an incompatible or incomplete package, **When** an administrator installs it, **Then** it is rejected with a reason and existing sessions remain unchanged.
3. **Given** the default theme source and guide, **When** a developer overrides an entity capability and interface presentation through the public contract, **Then** the engine runs it without requiring a universal attack or character class.
4. **Given** an active session, **When** a theme is updated or disabled for new sessions, **Then** the active session retains its pinned version until it ends.
5. **Given** a regular player, **When** they attempt executable-module installation, **Then** access is denied; they may select only installed enabled themes.

### User Story 5 - Measure capacity and operate the server (Priority: P3)

The operator runs controlled workloads, inspects metrics, and determines the useful
capacity of the actual host before increasing hardware or player settings.

**Why this priority**: The POC must provide evidence about multiplayer limits.

**Independent Test**: Exercise one, three, and five sessions with independently varied
players, enemies, and spectators; produce a reproducible measured report.

**Acceptance Scenarios**:

1. **Given** a configured workload, **When** it runs, **Then** the operator can inspect session entity/connection counts, simulation timing, traffic, latency, and process resource use.
2. **Given** five active sessions, **When** one finishes or fails, **Then** its capacity slot is released exactly once and other sessions retain their state.
3. **Given** a host restart, **When** users log in again, **Then** accounts and saved finished results remain; interrupted matches are identified honestly rather than shown as resumable.

### Edge Cases

- Simultaneous create/join/start/spectate and final-enemy kills must not over-admit or finalize twice.
- No legal safe spawn: defer placement while showing a countdown/status, retry with bounded work; never spawn inside obstacles or enemies or grant immunity.
- Map generation failure: retry a bounded number of seeds, then use a known traversable fallback map.
- Disconnection does not reduce the initial roster-based enemy budget or reset a death timer.
- Creator departure, abandoned waiting rooms, empty running rooms, full spectator list, expired reconnect reservations, duplicate connections, and login expiration use explicit rules below.
- Slow consumers, malformed input, oversized packages, unsupported themes, missing assets, module exceptions, and saturated entity budgets fail with bounded work and useful status.
- A spectator sees equivalent target camera/HUD state, not pixel-identical dimensions across devices.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Public username/password registration, login, logout, and authenticated session rejoin MUST be provided; passwords and session secrets MUST never be publicly exposed.
- **FR-002**: Any logged-in player MUST be able to create a session and, as its creator, configure/start it with at least one player. All player/spectator membership mutations MUST be authorized.
- **FR-003**: The server MUST atomically enforce a five-session cap across waiting/running sessions. Finished/abandoned/failed sessions MUST release their slot once.
- **FR-004**: The lobby MUST show session state, creator, theme, current/max level, players/max players, spectators/max spectators, and state-appropriate Join/Spectate controls.
- **FR-005**: Session settings MUST include maximum players/spectators, starting NPCs per player (default 5), population increase rate, base NPC health, health increase rate, NPC movement speed (Dots and Squares: default 67.5 world units/second, finite 0–180 with fractions allowed), NPC detection range (default 512 world units, finite 0–700; zero disables automatic pursuit), respawn delay (default 5 seconds), maximum levels, and selected Game Theme. Invalid values MUST fail before start; settings lock on start. Older configs omitting either NPC setting MUST load with its new default; zero movement speed keeps NPCs stationary without disabling contact damage.
- **FR-006**: A running match MUST reject new participants but allow eligible authenticated reconnects and spectators within capacity. It MUST isolate state from other sessions.
- **FR-007**: Players MUST traverse one shared generated map with independent centered cameras, collision with simple obstacles, and consistent nearby player visibility.
- **FR-008**: The default game module MUST provide range-triggered enemy pursuit, obstacle navigation, weapons, projectiles, damage, health/power/weapon pickups, and authoritative scoring.
  Explore is the default state of every mobile NPC on every wave: from the first
  simulation update it moves at half configured speed toward seeded reachable
  destinations roughly half the shorter map side away (1024 units in Fixed),
  scaling down for smaller maps and falling back to closer reachable goals
  within existing navigation budgets, preferring unvisited regions over its spawn
  area, choosing a new destination on arrival after a pause of at most 0.4
  seconds. Blocked, rejected or unavailable paths retry within the existing
  navigation budgets instead of idling. Detection only makes an NPC eligible;
  only NPCs holding one of a player's two pursuit slots chase or deal contact
  damage to that player, and others keep exploring even inside detection range.
  Pursuit entry/exit MUST discard stale paths and exploration resumes immediately
  when pursuit ends. Speed 0 remains stationary; detection range 0 permits
  exploration without targeting any player.
  Fixed Tile Cluster Arena MUST add solid terrain in sparse regions while retaining
  clear region routes and safe spawn clearance. Rendering, collision, projectile
  blocking, NPC navigation and radar MUST share the same terrain geometry.
  This playtest slice MUST NOT retune health, counts, growth or wave timing.
- **FR-009**: Level enemy totals MUST use the roster frozen at start and the configured growth formula. Killed enemies MUST not be continuously replaced. Clearing a level MUST advance once; clearing the maximum level MUST finish with a points-ranked leaderboard.
  For one player with default settings, waves 1 and 2 MUST start with 10 and 12
  NPCs respectively. A next wave MUST NOT spawn until the living count reaches
  zero and the existing five-second intermission ends.
- **FR-010**: Death MUST disable participation for the configured delay, preserve points, then choose a random safe spawn without damage immunity. Other players continue earning points.
- **FR-011**: The HUD MUST show running match points most prominently and current health; spectators MUST see the selected player's values and death state.
  During play, players and spectators MUST see authoritative level, living NPC
  count and starting wave count (for example, `Level 1 · 7 of 10 enemies remaining`),
  independent of radar marker filters. Non-final wave completion MUST show
  `Level 1 Complete`, the viewed player's points earned that level, running
  points-ranked standings for the roster, and `Level 2 starts in 5…` counting
  down through the existing intermission. The next wave hides that summary and
  resets only level-earned points, not running scores. Clearing the final level
  MUST go directly to final standings, without promising another wave.
- **FR-012**: Spectators MUST be able to select/switch targets and return to the lobby. They MUST have no gameplay control and MUST NOT affect enemy population.
- **FR-013**: A Game Theme MUST bind a versioned game module and skin, selected by the creator for the whole session and pinned for its duration. The default theme MUST use the public developer interfaces.
- **FR-014**: Developers MUST be able to extend gameplay and replace presentation through documented interfaces without changing core account, lobby, or transport code. Include working default source, a second fixture demonstrating behavior/presentation changes, and a preview/reference workflow.
- **FR-015**: Theme browsing, selection, validated package upload/installation, compatibility errors, and permission enforcement MUST be provided. Executable modules MUST require administrator installation, and package validation MUST not execute uploaded code.
- **FR-016**: Finished match results MUST persist per player. Host restart MUST preserve accounts/results but may end in-memory matches as interrupted.
- **FR-017**: Operator metrics and real protocol load clients MUST support reproducible capacity measurements including spectators and pursuing enemies, without a claimed unmeasured capacity.
- **FR-018**: Workloads, message/asset sizes, pending network data, NPC/projectile totals, and navigation work MUST have documented configurable ceilings with visible limit behavior.

- **FR-019**: The engine repository MUST own shared contracts, the SDK and default reference theme. The companion themes repository MUST consume a pinned compatible revision without engine/server write access. Developer instructions MUST describe extensions, validation, local preview, package handoff and compatibility-change requests.
- **FR-020**: Local startup MUST load an ignored `.env` copied from committed `.env.example` without requiring Windows system variables. Production MUST load a separate operator-managed environment file; no secrets may enter client bundles or theme packages.
- **FR-021**: Dots and Squares MUST start a hidden server-authoritative no-kill
  countdown for each wave (configurable 60-second default), reset only on a
  confirmed enemy kill by any player and keep running during deaths/respawns.
  Neither HUD shows it. Clearing before expiry advances through the existing level
  path; expiry ends the match, persists standings and releases the room through
  existing finalization. Countdown mechanics MUST be reusable; the module chooses
  expiry policy.
- **FR-022**: Signup MUST require one of two Dots and Squares control modes:
  Keyboard Only (WASD movement, left/right arrows turn in place, Space fires) or
  Keyboard + Mouse (arrow-key movement, mouse aim, left click fires). Existing
  accounts without a saved choice MUST be prompted at their first sign-in after the
  update; the choice MUST persist on the account and remain changeable in the lobby.
- **FR-023**: Every player in a room MUST have a distinct color, stable through
  respawn and consistent in player and spectator views. All NPC squares MUST share
  one different color. Each player MUST show a small same-color facing dot protruding
  from the front edge of the player dot; facing MUST track aim while stationary.
- **FR-024**: Dots and Squares MUST distribute each wave's NPCs across several
  reachable spawn zones on Fixed and Simple Generated maps, repeatably from the
  match seed and wave number for the same map/player state. Placement MUST clear
  solid terrain, current players and other newly spawned NPCs. When zones run out
  of space, bounded placement MUST use remaining reachable clear zones; if the
  full wave cannot fit, it MUST fail explicitly rather than overlap, truncate NPC
  counts or falsely clear the wave. NPC growth/counts, health, terrain and detection
  settings MUST remain unchanged by this placement-only change.
- **FR-025**: A running session's host MUST have an End Session button beside
  its lobby status, with confirmation before sending the request. The server
  MUST authorize by creator account ID, rejecting other players, spectators
  and operators who are not the host. Ending MUST use the existing finished
  result path to save current-level standings, notify players and spectators,
  and release the room. Retries and races with normal completion MUST preserve
  a single immutable result. During intermission, the completed wave remains
  the current level until the next wave actually starts.

### Key Entities

- **Account**: unique normalized username, password credential, operator role.
- **Login session**: revocable account authentication and expiration.
- **Game session**: creator, settings, pinned theme, state, level, roster, participants and spectators.
- **Participation**: account, role, connectivity, reconnect deadline, target, points, kills, deaths, alive/dead state.
- **World**: seed, traversable geometry, entities, pickups, and progression state.
- **Game Theme**: public name, compatible engine contract, exact module/skin versions and package identity.
- **Match result**: final/abandoned/interrupted status, immutable final standings and settings summary.
- **Capacity run**: host/configuration, revision, workload, measured outcomes and duration.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Two distinct users complete signup, join, play two generated levels, die/respawn, and see the same final standings in one end-to-end exercise.
- **SC-002**: Under concurrent admission attempts, no more than five sessions exist and no session exceeds its configured player or spectator capacity.
- **SC-003**: Default death absence is at least five seconds and placement occurs within one simulation step of eligibility when a safe point is available; immunity never follows placement.
- **SC-004**: An observer can switch between two players and see their points, health, location, and death state without influencing the match.
- **SC-005**: A developer changes one gameplay behavior and the HUD through documented theme interfaces with zero core-engine file edits, and runs it beside the default theme.
- **SC-006**: A capacity report covers one, three, and five sessions, independent spectator counts, increasing NPC loads, and a 30-minute soak near the measured sustainable configuration. It records actual latency, resource use, and failures.
- **SC-007**: In a restart exercise, saved accounts and completed standings remain available while previously active matches are explicitly interrupted.
- **SC-008**: Browser verification confirms both control mappings, account persistence/change, distinct room colors, and facing that follows stationary aim in player and spectator views.

## Assumptions

These are editable planning defaults chosen to keep the first implementation concrete;
only the 5:1 initial ratio, five-second respawn default, five-session cap, and other
explicit conversation decisions are user-confirmed.

- Desktop keyboard/mouse browser POC; mobile controls, chat, email/password recovery,
  global matchmaking, distributed hosting, and arbitrary untrusted-code sandboxing are outside this feature.
- WASD movement, mouse aim, hold left button to fire; no friendly fire. A final hit
  earns one kill and 100 points; leaderboard ties use kills descending, deaths ascending,
  then normalized username. Health 100; default shot damage 25, enemy health 50,
  enemy contact damage 10 at most once per second per player. Tune in the default module.
- Settings defaults: 4 players, 8 spectators, 5 NPCs/player, 20% population growth,
  50 base NPC health, 10% health growth, 5-second respawn, 5 levels. Growth compounds
  from level 1: population is ceiling(roster × initial ratio × (1 + population rate)^(level−1));
  enemy health is ceiling(base health × (1 + health rate)^(level−1)). Spectators/disconnects do not change roster size.
- Owner-only settings/start while waiting; creator is a participating player.
  Ownership passes to the earliest connected participant on departure. Waiting rooms
  with no participants close after 60 seconds. Running rooms with no connected players
  close as abandoned after 60 seconds even if spectators remain.
- Reconnect reservation is 60 seconds. Disconnected avatars are removed, death timers
  continue, and an alive returning player is safely placed. Expired reservations are
  not reopened during a match. Latest authenticated connection replaces the earlier one.
- Five seconds between levels; scores persist and living/returning players are safely
  positioned with full health when the new level begins. Existing death deadlines remain
  authoritative; no early respawn due to a level transition.
- Control mode is an account preference. Legacy accounts are migrated without a
  selection and must complete the first-sign-in prompt before entering the lobby.
- Dots and Squares no-kill duration is `noKillTimeoutSeconds`, default 360 seconds,
  started fresh each wave and reset only on a confirmed enemy kill by any player.
  A monotonic server deadline continues through death, blocked respawn and reconnect.
  No wave countdown runs during intermission. Expiry wins a clear at the exact
  deadline and saves a finished result at the current level, which may be below
  the configured maximum, with "Wave ended: no kills for a while."
  The public Countdown API retains fixed-deadline support for other themes.
  These countdown values are editable tuning defaults,
  not changes to NPC growth, health or capacity limits.
- Ended sessions leave the active list, retain results, and release capacity immediately.
  No in-progress match persistence across process restarts in this POC.
- Safe positions clear collision geometry, projectiles, and enemy contact areas plus a
  configured safety margin; safe does not mean permanently unreachable by enemies.
- Creator theme selection locks at start. Administrator installs vetted executable
  modules out of band; administrator package upload validates/registers assets and
  references only already installed module versions. Regular users select installed themes.

## Confirmed follow-up decisions — 2026-11-06

Engine repository is named `scottzastrow/multiplayer-game-engine`; designer repository
is `scottzastrow/multiplayer-game-themes`. There remain exactly two repositories;
the SDK/default example stay in the engine repo. Public Game Theme vocabulary and
session-wide theme selection are unchanged. Local configuration uses `.env`; production
uses `/etc/multiplayer-game/game.env`. Dedicated Lightsail host and HTTPS domain are
reported configured; see ../../docs/hosting.md for evidence and remaining work.
