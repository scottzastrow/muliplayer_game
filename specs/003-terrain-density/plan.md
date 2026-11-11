# Implementation Plan: Per-Level Terrain Density

## Controller-menu cleanup (2026-11-11)

Narrow client and public account control types to the two canonical choices.
Normalize legacy database values in public account, credential and session
reads, and accept legacy API writes as an alias for Keyboard Only. Reuse the
shared signup/lobby fieldset; keep the SQLite migration and theme input support
unchanged. Add mounted UI and HTTP/storage/authentication regressions, retaining
NULL behavior and invalid-input errors. Check only affected workspaces and
focused control/gameplay regressions; record real results under T034.

For the scoped review, stage only controller cleanup and matching note hunks,
run `git diff --cached --check`, and commit. Temporarily preserve unrelated
work outside the candidate, run the full suite once on the clean commit, and
restore that work. Stop and report if the suite fails; otherwise fetch origin
and report all exact outgoing commits. No push, deployment or T042 completion.

## Frontend appearance follow-up (2026-11-10)

Keep tokens and preference handling in `apps/client`. Mount a persistent native
labelled appearance selector outside the replaceable application root, initialize
before authentication, and follow system changes only until an explicit choice.
Style frontend surfaces and skin-host DOM slots with shared tokens, never Canvas
or game/theme-package colors. Preserve compact viewport sizing and bounded
standings. Cover preference lifecycle/storage failures with focused tests; use
the existing CDP browser harness for both appearances in all four views,
keyboard focus, contrast, persistence and unchanged arena/radar rendering.
Record actual evidence, leave original T042 open and do not commit or deploy.

For the scoped release review, isolate appearance changes and matching evidence
from mixed files. Run the full suite on the committed candidate, fetch origin,
and push without force only if that candidate is the sole outgoing commit.
Preserve unrelated edits and leave T042 open; do not deploy.

## Health packs and radar follow-up (2026-11-10)

Validate the developer setting in protocol and the theme manifest, retaining it
through lobby edits. Reuse seeded reachable-cell placement for scattered pack
slots, replenish missing slots at wave starts and re-place them on generated
terrain transitions. Expose radar marker highlights through the SDK; the
default skin supplies animation or a reduced-motion halo for health entities.
Cover placement, healing, transitions and both radar roles, and record actual
verification. Keep T042 open.

## Health-pickup wave trace follow-up (2026-11-10)

Use seeded real module/SessionWorld progression and both skins' Canvas draws to
trace three waves plus their next-start boundaries on each map. Stage overlap,
damage and NPC removal explicitly; distinguish this from browser/free-play
evidence. Reproduce before changing gameplay. Reuse entity creation in
`DefaultEntitySimulator` to fill only missing authored health sites from the
current map on `startLevel`; preserve retained IDs/state and other pickup types.
Assert no early refill, safe relocated positions, exact entity/marker agreement,
no duplicates, healing and disposal. Document counts and absence of a per-wave
health setting. Leave public contracts, consumer pin and original T042 intact.

For the scoped release review, isolate only this fix, tests and matching notes
from mixed files. Validate a disposable Linux copy with the full unfiltered
suite and unchanged consumer gate. Commit the scoped candidate, rerun the full
Linux suite on that exact commit, then push without force only if it passes
and is the sole outgoing commit. Preserve all unrelated edits and T042.

## 200-HP default and health radar follow-up (2026-11-10)

Update the existing protocol default/schema fallback and theme manifest to 200;
reuse the resolved spawn/respawn/healing/HUD path without changing enemy tuning.
Use the existing radar per-marker color overrides, selecting health pickups by
entity state rather than ID naming. Preserve diamond shapes and all other radar
colors in the common player/spectator skin. Add role-parameterized Canvas draw
checks and retain explicit 150-HP lifecycle coverage. Keep the immutable consumer
gate intact; a new pin requires a reviewed committed revision. Report focused
results before pushing; preserve unrelated work and keep original T042 open.

For the scoped commit review, stage only T024 hunks in mixed files, commit the
health/radar slice first, then pin the external consumer to that exact commit
separately. Validate a disposable Linux copy of the intended release contents
with the unfiltered suite and unchanged drift gate. Push without force only
after success and confirmation that no unrelated commits are outgoing.

## Player maximum health follow-up (2026-11-10)

Add a bounded positive integer `playerMaxHealth` to the protocol settings schema,
re-export its validator through the SDK and declare the setting/default in the
reference theme. Follow existing host/API persistence and default resolution.
Pass the resolved maximum into entity, respawn and combat/pickup simulators;
publish it in additive v4 snapshots for both HUD roles. Old v4 snapshots without
the field retain their historical 100-HP display maximum. Preserve live rejoin
health. Cover invalid inputs, explicit overrides, lifecycle, healing, HUD and
ordinary enemy hit traces. Keep the immutable consumer pin/gate intact until
a reviewed public-contract commit exists; record that local drift explicitly.

The subsequent scoped review authorizes a health-only commit and a separate
immutable-pin commit referencing it exactly. Stage only health hunks in mixed
files; keep unrelated work unstaged. Run unfiltered tests with the drift gate
unchanged and record the outcome. Both commits remain local; T042 stays open.

## All-mode directional pull follow-up (2026-11-10)

T021 supersedes the First-Person-only steering gate below. Keep the existing
per-account intent flag/reset lifecycle and shortest-angle math, but enable the
blend for every explicit supported control mode. Preserve mode-less legacy
actions, input bindings, speed, combat and NPC logic. Parameterize angle,
wraparound, held-input, firing and spin-in-place regressions across all modes;
feed real skin keyboard/pointer events into the simulator to measure the exact
27-degree bend. Update respawn/browser expectations and controls help. Report
actual local results before any push; no deployment or original T042 completion.

For the scoped commit review, stage only T021 code/tests and related note hunks.
Preserve unrelated edits, run `git diff --cached --check`, fetch origin and push
without force only as the sole outgoing commit on `0d22fbf`.

## First-Person steering scoping (2026-11-10)

Add `first-person` to the existing account preference/API/UI, preserving prior
choices and NULL through an additive SQLite migration. Reuse keyboard bindings
in the default skin and include its mode in the theme-owned combat intent.
The simulator tracks that intent per player and applies the existing blend only
to First-Person, clearing the flag with input resets/disposal. Missing mode is
unsteered for legacy clients. No shared protocol/SDK contracts change.
Verify all three control modes, respawn collision/snapshot agreement, persistence
and heartbeat behavior. Commit/push only this scoped slice and the heartbeat
test fix, in separate commits; preserve unrelated work and keep T042 open.

**Branch**: `001-multiplayer-engine` | **Date**: 2026-11-08
**Spec**: [spec.md](spec.md)

## Summary and technical context

Extend the existing strict TypeScript/Zod/npm workspace, not another architecture.
Protocol owns validated optional mode/schedule and pure level resolution. SDK adds
an optional geometry-transition service. Engine prepares immutable geometry and
atomically validates/replaces the entity store, invalidating navigation work.
Default module explicitly opts in for host-selected Simple Generated, owns its
terrain/clearance/spawn policy and prepares next terrain on intermission entry.
Fixed and absent-mode settings retain the exact prior generation path.

## Constitution check

Authority: no client geometry mutations. Isolation: prepared tokens are per-world.
Public contracts: optional additive service; unchanged v1 legacy loading and
state schema with optional coverage fields. Bounded work: at most 4096 generation
cells with bounded frontier work; navigation budgets unchanged. Verification:
focused settings, map, boundary and runtime checks, recording actual evidence.
No exceptions, deployment, branch switch, worktrees or delegated implementation.

## Structure and design

- `packages/protocol/src/settings.ts`: strict discriminated schedule, length gate,
  reusable resolver, optional mode and legacy-preserving absence.
- `packages/theme-sdk/src/index.ts`: optional prepare/commit geometry service.
- `packages/engine/src/world.ts`, `navigation.ts`, `map-transition.ts`: validated
  pending geometry, atomic entity replacement and stale-path invalidation.
- `themes/default/src/module/maps.ts`: seeded connected-clear-cell generation,
  reserved spawn clearance and shared solid rectangle area measurement.
- `themes/default/src/module/index.ts`, `progression.ts`, `entities.ts`,
  `respawn.ts`: intermission preparation, boundary commit, map references and
  preserved player state. Module supplies replacement entities/spawn rules.
- `apps/server/src/runtime/session-lifecycle.ts`: expose engine transition service
  and let module factory select initial geometry via optional public hook.
- `apps/server/src/lobby/registry.ts`: expose field-specific map/schedule errors
  through the existing INVALID_SETTINGS path; other error behavior is unchanged.
- `apps/client/src/lobby.ts`: host mode/schedules with saved legacy choice intact.
- `themes/default/src/skin/`: optional actual-coverage display for both roles.
- `tests/terrain-density.test.ts`, runtime/settings regressions: exact outcomes.

Connected clear routes join all authored spawns; radius plus 64-unit spawn
clearance is reserved before growing a seeded connected free region. Remaining
solid cells are merged into horizontal runs. Growth stops at desired free area
or its bounded budget; if protected area already exceeds that count, use it as
the best valid layout and report the shortfall. All open cells connect at player
radius. Validation rejects unexpected errors; no Fixed fallback in density mode.

## Compatibility

No migration rewrites JSON. Absent mapMode is legacy, including source-constant
Simple Generated and its four-cluster/fallback behavior. Explicit generated mode
with no schedule resolves to Incremental 3/0. Fixed never consumes density.
Saved editor preserves absent mode/schedule unless the host selects a mode.
Immutable external-consumer pin stays unchanged until a reviewed commit exists;
its drift gate is not a claimed passing check for uncommitted public changes.

## Scoped NPC playtest follow-up

T007 stays within the authoritative default entity simulator. Reserve existing
valid NPC/player engagements before sorting unassigned in-range pairs by distance;
admit at most two per player and one per NPC. Denied NPCs use the same roaming
path as distant NPCs, with no contact call. Start roaming with at most four
collision-checked adjacent directions before the asynchronous navigation legs,
retaining speed, pauses, path budgets and speed-zero semantics. No protocol/SDK
or engine geometry changes; browser evidence must separate actual world draws
from radar-rim visibility and local simulation from the uninspected deployment.

T009 uses an optional client-local skin-host toolbar to place existing navigation
beside default-theme Score/Health stats without SDK changes.
Match-only flex sizing removes fixed height deductions; controls and secondary
feedback overlay the arena, and standings retain a bounded scrollable region.
Dispose restores the normal lobby/results document layout.

T011 replaces only the default module's wave deadline with a private Countdown
recreated on wave start and the combat kill-award callback. Keep SDK Countdown
and fixed-budget helpers unchanged for other consumers. Add validated host/API
seconds configuration, omit time from default snapshots, remove its HUD node,
and carry an optional completion reason through existing finalization/storage
to saved results (additive nullable SQLite column, legacy results unchanged).
Exercise authority, resets, boundaries, non-kill activity, both standings views
and compact layout without altering entity AI.

T012 replaces local quarter-speed wandering in `themes/default/src/module/entities.ts`
with a per-NPC Explore state (tuning in `tuning.ts`): half configured speed,
seeded 192-512 unit cell-center goals preferring unvisited 256-unit regions,
direct steering until a path arrives, 6-12 tick arrival pauses and goal
replacement on no-path/limit or 30 ticks without progress, all within the
existing request/pending/search budgets. Slot assignment and contact damage stay
in the unchanged sticky two-per-player pursuit branch. The default skin focuses
the canvas once on the first player snapshot when nothing else is focused. No
protocol/SDK/engine changes. Verify per-NPC deterministic 30-second traces with
four NPCs in range, focus/keyboard skin tests and a local browser run; the
deployed release still needs its own browser verification. T014 below supersedes
only that original destination-distance/region policy.

T014 replaces the fixed 192-512-unit Explore sampling range with a target of
half the current map's shorter side. Sample eight seeded candidates around that
distance, rank less-visited regions and discard excessively boundary-clipped
goals. Halve the requested distance after no-path/limit, stalled goals or no
clear candidate; reset to full target on arrival or pursuit transitions.
Keep existing async navigation, per-tick/pending budgets and steering, with no
new synchronous searches. Scale visit regions down on smaller maps. Measure
completed paths, actual travel and region coverage with real BoundedNavigation.

### NPC perimeter-spread follow-up

Classify reachable, wall-clear spawn candidates by nearest-edge distance over
the shorter side. Use proportional 20/40/40 outer/middle/interior targets with
largest-remainder rounding, redistribute shortages to bands with capacity, and
continue the existing seeded zone/quadrant balancing and player-clearance
filters. For Explore, score interior progress ahead of region novelty only for
full-range goals when an NPC is within the 25% edge band. Aim the first sample
toward arena center and bias later samples inward; reduced-distance retries
retain their prior random-angle ordering so enclosed-area fallback remains
available. Do not change navigation budgets, pursuit behavior or speed zero.
Cover band allocation/redistribution and an ordinary 30-second browser trace.

### Full NPC ranged playtest follow-up

T016 changes only default-theme simulation/presentation and focused evidence.
Set Explore factor from 0.5 to 5; keep swept engine movement, path budgets and
safe band/quadrant spawn selection. Use awareness at 3x the existing engagement
setting, seeded action-area candidates with interior preference and shorter
reachable retries. Retain the sticky two-slot allocator. NPC state adds optional
facing, targetId and readyToFire; combat consumes authoritative readiness, enforces
cooldown/cap, and shares square-clearance shot checks with the AI.
NPC shots use additive ownerNpcId and projectile.npc, hit players (not NPCs),
and reuse existing swept projectile movement, damage/respawn/finalization.
The skin rotates the NPC body/attached marker separately from travel and draws
same-sized square bullets. Keep legacy contact exports for source compatibility,
but remove their execution. Default schema v4 additions are optional for old
snapshots; shared protocol/SDK contracts and immutable consumer pin do not change.
Record baseline/new clear-route measurements, deterministic authority regressions
and actual local browser screenshots/traces separately; do not close T042.

### NPC pace and reserved-color correction

T017 supersedes the T016 Explore multiplier with 0.5, restoring measured 33.75
units/second at default settings. Approach retains its independent configured
67.5-unit/second budget (twice Explore); verify actual clear-route travel and
stopping at the existing 384-unit shot boundary instead of increasing approach
speed or weakening the 96-unit separation/cover rules.

Share enemy color and the 32-entry non-red player palette between authoritative
entity creation and the skin. Space early roster colors across the hue range.
Resolve legacy missing/invalid/duplicate/reserved colors deterministically by
account ID using unused palette entries, then reuse the same map for every player
arena/radar surface. Respawn/rejoin keeps authoritative stored colors. No shared
protocol/SDK or immutable pin changes. Verify full-roster fallback/remount,
real rejoin, separate movement measurements and pixel-level colors in two player
windows plus both spectator follow views, using ordinary spawns and real keyboard
travel. Record local evidence without closing T042 or live gates.

### Player facing-steered movement follow-up

Export `PLAYER_FACING_MOVEMENT_BLEND = 0.30` in default-theme tuning (range 0-1).
Only player movement rotates the stored normalized input through that fraction
of the shortest signed input-to-facing angle on each step. Preserve magnitude,
leave stored input/facing untouched, and leave combat and NPC simulation unchanged.
Cover exact 27-degree steering, signed wraparound, stable repeated steps, partial
input speed, aim-based firing and stationary spinning. Update the existing held
controls browser assertion to expect blended travel, not pure downward travel;
do not claim a browser run without executing it. No public SDK/protocol change,
commit, deployment or original T042 completion.

The subsequent scoped commit authorization supersedes the no-commit handoff
for this steering slice only. Preserve unrelated edits and push without force
only as the sole outgoing commit on `1513429` after fetching origin. Skip the
local browser playtest and leave the manual steering check pending on Lightsail;
neither deployment nor original T042 completion is authorized.