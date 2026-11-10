# Implementation Plan: Per-Level Terrain Density

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
deployed release still needs its own browser verification.
