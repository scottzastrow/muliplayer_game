# Implementation Plan: Theme Credits

**Branch**: `001-multiplayer-engine` | **Date**: 2026-11-08 | **Spec**: [spec.md](spec.md)

**Input**: `specs/002-theme-credits/spec.md`

## Summary

Require `project` and `author` at both existing engine import paths. Reuse one
credits schema and one handoff definition schema; keep installed runtime SDK
definitions and their immutable digests unchanged. Store credits in the imported
manifest alongside assets, stripping handoff-only fields before runtime validation.
Document the companion setup/export/header requirements without inventing tooling
or claiming those blocked paths have been implemented.

## Technical Context

**Language/Version**: Existing strict TypeScript, Node 24 target.
**Primary Dependencies**: Existing Zod, Fastify, native ZIP validator, npm workspaces.
**Storage**: Existing SQLite registry and content-addressed manifest/assets.
**Testing**: Vitest unit/import/API checks, `npm run check`.
**Target Platform**: Local Windows checkout; unchanged Linux production contract.
**Project Type**: Existing engine/server with operator CLI and external theme consumer.
**Performance Goals**: Bounded validation under existing 256-KiB manifest limit.
**Constraints**: No runtime migration, browser SDK changes, deployment, commits or `.idea` changes.
**Scale/Scope**: Engine-only implementation. Companion setup/export/header work blocked.

## Constitution Check

Pre-research and post-design gates pass:

| Principle | Design |
| --- | --- |
| Authority and isolation | Import rejects before promotion/registration; no gameplay edits |
| Public theme contracts | Canonical engine Markdown handoff contract extended; runtime SDK unchanged |
| Focused verification | Field matrix, real upload/CLI entry points, legacy load; blocked checks explicit |
| Bounded work | Existing ZIP/manifest/asset budgets unchanged |
| Identity and defaults | Public Author explicitly confirmed by developer; no inferred/private identity |

## Project Structure

Feature artifacts are in `specs/002-theme-credits/`: spec, checklist, plan,
research, data model, handoff contract, quickstart and tasks.

| Path | Change |
| --- | --- |
| `packages/theme-sdk/src/package.ts` | Shared Node handoff schemas, mapping validation, hashing and limits (T012; replaces server credits helper) |
| `apps/server/src/themes/packages.ts` | ZIP import schema and runtime field separation |
| `tools/install-theme-code.ts` | Reviewed-code import requires credits |
| `tests/theme-packages.test.ts` | ZIP field matrix and preservation |
| `tests/operator-tools.test.ts` | Reviewed-code field matrix |
| `tests/integration/theme-install.test.ts` | Public field errors and atomicity |
| `docs/theme-development.md`, `AGENTS.md`, `.github/copilot-instructions.md` | Developer/AI policy |
| `specs/001-multiplayer-engine/contracts/themes.md` | Canonical handoff extension |

**Structure Decision**: Share existing import validation; no parallel exporter,
setup tool, source generator, SDK fork or new dependencies.

## Complexity Tracking

No constitution exceptions. Separate feature artifacts do not change the original
task list; T042 stays open. The setup-plan helper reports a feature-derived branch
name, not evidence of a Git switch; keep the actual checkout branch unchanged.

## Authorized follow-up: T012 public package contract

Move the existing credit/import-definition and package-manifest schemas, SHA-256
asset hashing, manifest-to-file mapping validation, canonical package digest calculation and limits into the additive
Node-only `@multiplayer-game/theme-sdk/package` export. The browser-facing root
entry stays unchanged. ZIP parsing/safety, asset format checks, registered-code
compatibility and transactional installation remain engine responsibilities.
The reviewed-code CLI also consumes the public handoff-definition schema.

Verify an isolated consumer of npm-packed protocol/SDK dependencies produces a
ZIP using the shared manifest/hash API, then feed that exact ZIP to the real engine
importer. Preserve existing runtime definitions, digests and limits. Document actual
accepted archive rules, not a proposed exporter. Do not change the immutable
conformance pin until a reviewed commit exists; its existing drift gate remains
intentionally unsatisfied by uncommitted public SDK changes.
