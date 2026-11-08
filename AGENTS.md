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
- This planning branch has no game implementation yet. Future run commands are
  contracts to implement, not currently verified commands.

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
