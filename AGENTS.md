# Multiplayer Game

Use the installed Spec Kit workflow in `.agents/skills/`.
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
