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
