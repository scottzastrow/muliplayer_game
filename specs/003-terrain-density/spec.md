# Feature Specification: Per-Level Terrain Density

## Health-pickup wave trace follow-up (2026-11-10)

Trace health spawn/collection counts through the first three Dots and Squares
waves on Fixed and Simple Generated, including arena/radar state at each next
wave start. Fix only confirmed replenishment or marker-loss issues. Replenish
consumed health packs at authored sites when a wave starts, retaining rather
than duplicating uncollected packs. Preserve intermission timing, other pickup
lifecycles and generated-map safe relocation. Report existing settings rather
than introducing a pickup-count option. Automated runtime/Canvas checks are
authorized instead of an IDE session. Keep changes local for review and
original T042 open; no commit, push or deployment.

Subsequent review authorization permits only the health replenishment fix,
its tests and matching verification notes to be committed and pushed without
force after the full Linux suite passes on the exact candidate. Preserve
unrelated edits and leave original T042 open; no deployment is authorized.

## 200-HP default and health radar follow-up (2026-11-10)

Supersede only the earlier 150-HP default with 200 through the existing
`playerMaxHealth` setting. Preserve explicit overrides (including 150), initial
spawn/respawn consistency, reconnect health, healing limits and enemy damage.
Health pickup radar markers must be bright blue diamonds in both player and
spectator views, distinct from circular players and orange other pickups.
Keep arena pickup styling unchanged. Run focused lifecycle and render checks
and report results before any push; no deployment or original T042 completion.

Subsequent scoped review authorization permits committing only this health/radar
slice and its tests/docs, followed by a separate immutable-consumer pin commit
to that exact revision. Run the full Linux suite with drift detection enabled;
push only the intended commits without force if it passes. Preserve unrelated
edits, report the full remote tip hash and leave original T042 open.

## Player maximum health follow-up (2026-11-10)

Expose validated `playerMaxHealth` through theme settings and the public SDK.
The effective Dots and Squares baseline is 100; use ceil(100 * 1.5) = 150
when omitted, preserving explicit overrides. Initial spawn, death respawn,
health-pickup cap and player/spectator HUD must use the configured maximum.
Keep ordinary NPC shot damage (10), cooldown (30 ticks) and population unchanged.
Verify actual projectile hits at 100 and 150 HP, distinguishing survived hits
from the lethal hit. Keep changes local/uncommitted; no push or deployment.

Subsequent review authorization permits committing only this health slice,
then separately pinning the external consumer to that exact health commit.
Run the full suite with its drift gate enabled; keep both commits local,
preserve unrelated edits and leave original T042 open.

## All-mode directional pull follow-up (2026-11-10)

The owner now requires the existing 30% shortest-angle pull in all three Dots
and Squares modes, superseding the First-Person-only scope below. Keyboard +
Mouse aim pulls travel toward facing while a movement key is held. Preserve
each mode's bindings, movement speed, firing direction and turning in place
without movement input. Verify the exact 27-degree bend for a 90-degree turn
in every mode, including mouse-event aim. Retain mode-less legacy behavior.
Report results before pushing; no deployment or original T042 completion.

The subsequent scoped review authorization permits committing only all-mode
steering, its tests and related notes, preserving unrelated edits. Fetch origin
and push without force only as the sole outgoing commit on `0d22fbf`.

## First-Person steering scoping (2026-11-10)

The owner authorizes a separate saved First-Person control setting, reusing
Keyboard Only bindings (WASD movement, arrow-key turning, Space to fire).
Only First-Person applies the existing 30% shortest-angle steering pull;
Keyboard Only, Keyboard + Mouse and legacy mode-less inputs remain unsteered.
Preserve speed, input magnitude, firing, spin-in-place and NPC behavior.
Run focused steering/collision checks; commit this slice and the existing
heartbeat test repair separately, preserving unrelated edits, then push without
force. This supersedes prior commit/push restrictions only for these slices.
Original T042 remains open; no browser, deployment or capacity result is implied.

**Feature Branch**: `001-multiplayer-engine` (same checkout)
**Created**: 2026-11-08
**Status**: Specified; scoped implementation authorized
**Input**: Host-selectable per-level density, reusable authoritative transitions,
Dots and Squares Simple Generated first consumer; preserve legacy sessions and
Fixed, leave changes uncommitted and T042 open, no push or deployment.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Configure density (Priority: P1)

Hosts choose Incremental or Per Level before starting a generated match.

**Why this priority**: Hosts control terrain difficulty independently of NPC tuning.
**Independent Test**: Submit both schedules and invalid values through settings.

**Acceptance Scenarios**:
1. **Given** Incremental start 3 and increase 2, **When** levels advance,
   **Then** densities are 3, 5, 7, 9, 10, with zero increase remaining steady.
2. **Given** Per Level, **When** settings are saved, **Then** exactly one integer
   density 0-10 is required for every configured level.
3. **Given** a new generated session, **When** no schedule is supplied,
   **Then** it uses start 3 and increase 0.
4. **Given** saved legacy settings, **When** loaded or edited without opting in,
   **Then** their previous layout behavior and explicit settings remain unchanged.

### User Story 2 - Play on the next shared layout (Priority: P1)

Players and spectators switch terrain together when the next wave starts.

**Why this priority**: Visible terrain must match authoritative gameplay geometry.
**Independent Test**: Clear a real initialized wave, inspect intermission and the boundary.

**Acceptance Scenarios**:
1. **Given** a completed non-final wave, **When** intermission begins,
   **Then** the next layout is prepared and validated without changing current terrain.
2. **Given** the wave boundary, **When** the next wave begins,
   **Then** all viewers, movement, projectiles and NPC routes use the new layout;
   players retain health, scores, identity and death timers with safe placement.
3. **Given** the same seed, level and density, **When** regenerated,
   **Then** geometry and coverage repeat independently of gameplay random draws.

### User Story 3 - Understand achieved coverage (Priority: P2)

Hosts and viewers can see the actual coverage, including constrained layouts.

**Why this priority**: A target must not be misreported as achieved.
**Independent Test**: Generate densities 0, 3 and 10 and measure solid area.

**Acceptance Scenarios**:
1. **Given** density D, **When** generated, **Then** the target is D times 8
   percentage points of playable area; density 0 has no interior obstacles.
2. **Given** clearance or bounded generation prevents reaching the target,
   **When** generation completes, **Then** the best valid layout is used and
   its measured coverage and target shortfall are reported.

### Edge Cases

- Fractions, negative values, values over 10, malformed schedules and wrong
  Per Level lengths fail explicitly, including when maxLevels changes.
- Final completion does not prepare an unused map.
- Unsupported modules do not acquire terrain behavior implicitly.
- Dead/disconnected players retain their timers and return using the current map.
- Old navigation requests cannot publish paths for retired geometry.
- Fixed and legacy Simple Generated remain unchanged; NPC wandering is retained.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Both integer schedules MUST be selectable by hosts and validated
  before start; Incremental caps at 10, Per Level matches configured level count.
- **FR-002**: New generated sessions MUST default to 3 with zero increase.
  Saved settings and sessions without explicit opt-in MUST retain legacy layouts.
- **FR-003**: Schedule resolution and authoritative map transition MUST be reusable;
  participating modules supply terrain, clearance, connectivity and spawn rules.
- **FR-004**: Generation MUST depend on match seed, level and resolved density,
  target 8 percentage points per step and perform explicitly bounded work.
- **FR-005**: Next layouts MUST be prepared and validated during intermission,
  committed only at the wave boundary and shared by every geometry consumer.
- **FR-006**: Safe spawns and connected player-sized routes MUST be preserved;
  placement failure MUST surface rather than overlap or truncate waves.
- **FR-007**: Actual coverage and inability to reach target MUST be reported.
- **FR-008**: Fixed, legacy settings, wandering and other wave tuning MUST survive.
- **FR-009**: Tests MUST cover both schedules, 0/3/10, determinism, safe spawns,
  connected routes and an executed level transition using changed geometry.

### Key Entities

- **Density schedule**: Incremental start/increase or ordered Per Level densities.
- **Prepared layout**: Validated pending geometry, not yet the active map.
- **Coverage report**: Level, density, target, actual coverage and target shortfall.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: All tested invalid schedules are rejected; both valid schedules
  resolve exactly to the configured integers and Incremental never exceeds 10.
- **SC-002**: Density 0 has exactly 0% interior coverage; 3 targets 24% and 10
  targets 80%, with measured solid area matching the reported actual percentage.
- **SC-003**: Every tested spawn has required clearance and every open route
  connects at full player radius; repeated inputs yield identical layouts.
- **SC-004**: An executed two-level scenario retains the first geometry throughout
  intermission and exposes only the second geometry after the boundary to both roles.

## Assumptions

- Playable-area denominator is the full bounded interior arena (no external walls);
  reserved clear routes/spawn zones remain part of that denominator.
- Coverage targets are upper targets, rounded down to whole terrain cells.
- Dense layouts can fall short because safe-spawn clearance takes precedence.
- Source-constant legacy mode remains available for settings without explicit mode.
- No browser or capacity claim is made without execution. T042 is not in this slice.

## Authorized NPC playtest follow-up (2026-11-09)

Preserve FR-008 with immediate local roaming on the first simulation step of
every wave, even with all living players outside detection range. Explicit
NPC speed 0 remains stationary, including admitted contact attackers.

Limit pursuit/contact to two NPCs per living player. Initially admit closest
eligible pairs, then retain engagements until an NPC dies, its player dies or
disappears, or detection range is lost. Refill vacant slots on the next step;
unassigned NPCs roam and cannot damage a full-slot player. Each NPC has at most
one target; multiplayer caps are independent. Verify default Fixed roaming in a
real local browser, plus first-step waves, four-NPC admission, stability,
death/range replacement, denied contact, and overlapping two-player eligibility.
Distinguish browser observations from deterministic simulation checks; do not
infer the code revision or runtime behavior of an uninspected live deployment.

### Compact active match follow-up

Player and selected-target spectator views hide the application/theme headings.
One slim top bar shows Score and Health, with compact Back to Lobby navigation.
The canvas fills the remaining
desktop viewport without page scrolling. Keep the arena radar and its enemy
count; remove duplicate external level/enemy labels. Secondary controls remain
available without reserving canvas height. Preserve lobby, respawn feedback,
terrain coverage, intermission standings and saved final results.

Verify both roles at normal desktop sizes. The reported deployed `1e94ff3`
roaming problem remains open pending its own 15-second trace of actually visible,
out-of-range NPC positions in a running Fixed match. Local results must not be
presented as proof of the deployed match's behavior. Report trace blockers before
any AI change; no push or deployment is authorized.

### Hidden no-kill timer follow-up

Dots and Squares uses a server-authoritative no-kill timeout, configurable via
`noKillTimeoutSeconds` (positive finite seconds, at most 3600; default 360).
Start fresh at every wave boundary and reset only on a confirmed enemy kill by
any player, never movement, misses or nonlethal damage. Do not expose its
remaining time in player/spectator snapshots or HUDs. Expiry uses the existing
`wave-timeout` match finalization with saved standings and the message
"Wave ended: no kills for a while." Preserve the successful-wave intermission
countdown, compact layout, Score/Health and both roles' standings. Keep the
public SDK fixed-deadline Countdown available for other themes; do not change
NPC behavior, close the deployed roaming report or mark T042 complete.

### Explore and match focus follow-up

On live release `4b7371c` one enemy approached while the others appeared
stationary; treat it as an unresolved playtest failure. Explore is the default
state of every mobile Dots and Squares NPC on every wave. On spawn each NPC
receives a reachable destination away from its spawn point and moves on the first
simulation update, choosing new destinations as it explores and preferring new
areas over small movements around spawn (confirmed: half configured speed, short
pauses). Blocked, rejected or unavailable paths retry within the existing
navigation budget instead of leaving the NPC idle. Explicit speed 0 remains
stationary.

Detection makes an NPC eligible for pursuit. Only an NPC holding one of the two
existing pursuit slots may interrupt exploration to chase or deal contact damage
to that player; others keep exploring inside detection range. Exploration resumes
immediately when pursuit ends.

On entering a playable match, including rejoin, focus the mounted game surface
once so movement keys work without a click; normal Tab navigation remains.

Verify per NPC: in a default Fixed match keep the player idle and report, for 30
seconds, each non-pursuing NPC's distance and longest stationary interval, with
four NPCs in range and the two without slots still moving. Verify keyboard
movement immediately after entry without clicking the arena. Roaming is resolved
only after a normal browser match on the deployed release. Keep T042 open and
report results before pushing or deploying.

### Map-spanning Explore follow-up

Explore destinations target roughly half the shorter map side (1024 world units
in the 2048-unit Fixed arena), scaling down on smaller maps. Prefer reachable,
less-visited areas so successive legs cross the arena. When a target-distance
destination cannot be reached within existing navigation budgets, retry closer
reachable destinations without halting exploration. Movement and pursuit speeds,
Explore default, two-attacker cap and speed zero are unchanged. Measure actual
completed-route distances and new areas over successive legs on Fixed and a
smaller map. Keep T042 open, ranged combat separate and changes local for review.

### NPC perimeter-spread follow-up

Ordinary Fixed waves distribute NPCs across outer, middle and interior bands,
where band distance is the nearest map edge divided by the shorter map side:
outer is below 10%, middle is 10% to below 25%, and interior is at least 25%.
A ten-NPC wave targets 2/4/4 respectively and spreads placements across all
quadrants. Every placement retains reachable-cell, wall-clearance, non-overlap
and safe player-spawn checks. If a band lacks eligible positions, its quota is
redistributed rather than truncating the wave or concentrating it at the edge.

Explore goals for edge-near NPCs include reachable interior destinations so
they can travel inward and across the arena. Failed long routes retry closer
reachable goals within the existing navigation budget. Preserve map-scaled
range, region novelty, the two-attacker cap, configured movement speeds and
stationary speed-zero behavior.

For verification, run an ordinary default Fixed match with an idle player and
no staged entities. Record first-wave spawn bands and a 30-second authoritative
track map; report how many spawned in the interior, how many outer-band NPCs
entered the interior, and the travel and pause bounds of visible non-pursuing
NPCs. A local seeded browser result does not imply results for other seeds or
the deployed release.

### Full NPC ranged playtest follow-up (2026-11-10)

The owner authorizes ranged combat now, superseding the earlier deferral. Use
`4c8cac4` as baseline and retain local changes for review, without push/deployment.
Explore must target 10x its baseline actual speed, measured over one clear-route
second before/after, preserving wall collision and explicit speed zero.
Wider awareness biases varied reachable Explore goals toward interior action;
closer engagement retains two sticky slots per player and denied NPCs explore.
Remove all NPC contact damage. Slot holders stop for clear in-range shots, track
with facing independent of travel, retreat when crowded, and reposition around
blocked shots. Every NPC has an attached front square, and shoots equal-sized
squares along its facing on cooldown; walls block shots.

Verify the combined behavior in a fresh default solo Fixed browser match at a
normal viewport with ordinary spawns. Record visible interior roaming, actual
speed, stationary turning/firing, first encounter versus the existing 60-second
no-kill timeout, no contact damage and at most two active attackers. Separate
browser observations from simulations and report each behavior as verified,
failed or untested. Keep original T042 and live-release gates open.

### NPC pace and reserved-color correction (2026-11-10)

This correction supersedes only T016's requested 10x Explore pace: restore the
default clear-route Explore speed to **33.75 world units/second** and measure it
again. Measure attack approach independently and keep it readable into weapon
range. Preserve explicit speed zero, broad interior routes, distributed spawns,
two sticky attackers per player, stopping outside overlap, turning/firing on
cooldown, cover repositioning and zero contact damage.

Every enemy body, attached facing square and radar marker MUST share one reserved
enemy color. Every player MUST have a distinct stable color throughout the full
supported 32-player roster, including fallback allocation and rejoin; player
allocation MUST exclude the enemy color. Preserve rotating square NPC bodies and
square NPC projectiles.

Run focused tests and a real local two-player browser match with a spectator.
Record separate measured Explore/approach speeds, a visibly stopped firing NPC
without rushing through the player, and actual arena/radar color checks from both
players and spectator follow views. Leave all changes local/uncommitted and
original T042 open; no deployment or capacity result is implied.

### Player facing-steered movement follow-up (2026-11-10)

Dots and Squares rotates held player movement input by 30% of the shortest
signed angle toward current facing, recalculating from input each update rather
than accumulating rotation. Expose a named theme tuning setting in the range
0 to 1 with default 0.30. Preserve input magnitude, movement speed, aim-based
firing, spinning at rest and all NPC behavior. Verify rightward input with upward
aim travels exactly 27 degrees upward, wraparound takes the shortest turn, held
input does not drift, firing follows aim and zero-input spinning never translates.
Keep changes local/uncommitted and original T042 open.

The subsequent scoped commit authorization permits only this steering change,
its tests and matching documentation to be committed, with a non-force push
only as the sole outgoing commit on `1513429` after fetching origin. The local
browser playtest is skipped; the manual steering check will happen on Lightsail.
Original T042 remains open; no deployment or capacity result is implied.