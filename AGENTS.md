# Multiplayer Game

Use the installed Copilot Spec Kit workflow in `.github/skills/`.
Copilot entry instructions are in `.github/copilot-instructions.md`; those instructions
reference these shared rules rather than defining another development policy.
Read `.specify/memory/constitution.md`, then the feature selected in
`.specify/feature.json` (when present) and its spec/plan/contracts/tasks before implementation.
If the checkout-local pointer is absent, use the current feature path below.

- Current feature: `specs/001-multiplayer-engine/`.
- Keep confirmed requirements separate from editable POC assumptions.
- Engine owns authority, identity, session lifecycle and metrics. Game Themes bundle
  developer-facing modules and skins through public versioned interfaces.
- Use the default theme as a real extension example; do not bypass its interfaces.
- Execute task slices sequentially on one branch; do not create worktrees or delegate
  implementation unless explicitly instructed. Research delegation required by a
  Spec Kit planning workflow is permitted within that workflow.
- Record actual checks and failures; never invent runtime, browser or capacity evidence.
- Do not commit credentials/runtime data or write the student's personal reflection for them.
- The workspace/runtime exists. Use current scripts and record actual scoped
  checks; documented browser/capacity commands are not evidence of execution.

## Companion repository and environment

Only this engine repository defines shared contracts and the future compiled SDK.
The designer works in `scottzastrow/multiplayer-game-themes` and pins an engine
revision/release. Contract gaps must be proposed to the engine owner, not resolved
by copying and changing SDK declarations in the themes repo. Keep the default
reference theme here and maintain an external-consumer conformance fixture.

For Dots and Squares map configuration, seeded reproduction and validation, read
the map modes section of `docs/theme-development.md`.

Load local `.env` through the application's startup scripts; commit `.env.example`
only. Production uses systemd EnvironmentFile=/etc/multiplayer-game/game.env.
No Windows persistent environment variables or production credentials are required
for designer previews. Consult docs/hosting.md for reported infrastructure state;
its setup success does not imply a deployed game or completed capacity test.

## Theme Credits

The separate Theme Credits feature is `specs/002-theme-credits/`; use the local
feature pointer when present, retaining the original engine artifacts for context.
Theme export/import requires nonblank `project` and public `author` (person or
team), with exact field errors. `course` is optional. Existing installed themes
continue to run; enforce credits at their next export/import, not runtime loading.

Setup must suggest credits from existing metadata/recognizable comments, show
conflicting names as choices and require developer confirmation before writing.
Never infer consent to public credit from private identity or invent an author.
Generated headers use confirmed Project, Author, file-specific Description and
optional Course, with correct language comments. Keep JSON comment-free; omit
new copyright/SPDX template lines while preserving existing contributor credits,
asset attribution and unrelated comments. Follow `docs/theme-development.md`.
Unavailable companion tooling remains blocked; do not claim export/header checks
or modify remote content when the handoff requires uncommitted local changes.
