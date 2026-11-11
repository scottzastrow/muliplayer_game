# Theme Credits: inspection and decisions

## Existing engine paths

- Manifest/runtime definition: `packages/theme-sdk/src/index.ts`,
  `themes/default/theme.json`, `themes/fixture/theme.json`.
- ZIP import: `apps/server/src/themes/packages.ts` called by
  `tools/validate-theme.ts` and `apps/server/src/themes/routes.ts`
  (`POST /api/v1/admin/themes/upload`).
- Reviewed-code manifest import: `tools/install-theme-code.ts`.
- Installed loading: `apps/server/src/themes/builtins.ts` and `registry.ts`;
  must not require new credits or rewrite old digests.
- `tools/`, package scripts and documentation have preview/build/import commands,
  but no existing theme setup, ZIP export or source-header generator.

## Companion access (2026-11-08)

The sibling local path
`C:\code\projects\StThomas\Vibe_Coding\multiplayer-game-themes` is absent.
GitHub read access succeeded for `scottzastrow/multiplayer-game-themes`.
`main` contains only README. Branch `001-theme-development` was inspected at
`6141fc9fd28d705f887416eb46125f20fa425455`: root, AGENTS.md, README.md,
docs/developer-guide.md, templates/theme/ and its README, and themes/.
It has planning instructions and a documented folder skeleton, not runnable
setup/package tools or a real theme manifest.

Required local setup, manifest, ZIP export, header generation, tests and
developer/AI edit paths cannot be accessed. No local checkout was provided.
User decision: "Proceed engine-only; record themes setup/export as blocked".
Do not modify remote content because changes must stay uncommitted.

## Decision: require credits at handoff, not load

Use lower-case `project`, `author`, optional `course` on handoff manifests.
Both required fields validate string/nonblank with field-specific errors.
Do not trim as a transform: canonical package hashes must bind exact supplied
strings. Strip handoff-only fields before legacy SDK runtime validation; keep the
original manifest including credits in the promoted asset directory.

Rationale: Existing installed themes remain runnable without migration or digest
rewrites. All engine import callers share the policy. No public compiled SDK files
change, so the immutable external-consumer SDK pin remains valid.

Alternatives considered: requiring credits in the installed SDK definition would
break old themes; an optional SDK field changes the public package unnecessarily.
Creating engine setup/export tooling would duplicate an unavailable consumer
workflow instead of inspecting/wiring the required existing path.

## Decision: defer inaccessible setup/export/header work

Document exact confirmation/header behavior and leave its task/test work open.
No new technology decisions or unresolved design questions need delegated research;
existing repository and remote inspection supply the evidence for this small slice.

## T012 follow-up: public Node handoff contract

The user separately authorized exposing the existing engine handoff definitions
via `@multiplayer-game/theme-sdk/package`. This supersedes the initial no-public-SDK-
change constraint only for the additive Node entry; it does not change browser
runtime schemas or legacy loading. Shared code now resides in
`packages/theme-sdk/src/package.ts`, replacing the server-private credits helper.
The importer retains archive/media checks, compatibility and installation.

An isolated test consumer installs offline npm-packed protocol/SDK/Zod artifacts
and builds the fixture ZIP through public schema/hash imports, with the existing
test-only ZIP writer. No production ZIP writer or companion workflow is invented.
The immutable conformance pin remains unchanged: the old external-consumer drift
gate cannot pass uncommitted SDK changes and must wait for a reviewed commit.
