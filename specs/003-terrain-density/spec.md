# Feature Specification: Per-Level Terrain Density

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
