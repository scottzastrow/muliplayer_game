# Multiplayer Game Engine — Copilot

Read and follow `AGENTS.md` as the shared project authority, then
`.specify/memory/constitution.md` and the current feature under
`specs/001-multiplayer-engine/`: spec.md, plan.md, contracts/, tasks.md.
Use those files rather than inventing another architecture or task list.

Environment: IntelliJ IDEA, GitHub Copilot Agent mode, Windows PowerShell,
Node 24 LTS, npm 11, branch `001-multiplayer-engine`. Load application configuration
from ignored local `.env` using the planned startup loader; no Windows system
variables or production credentials are needed. There is no package.json/runtime yet.
Do not try npm install until task T001 creates package manifests.

Spec Kit 1.3.2 Copilot skills are installed at `.github/skills/` and PowerShell
helpers at `.specify/scripts/powershell/`. Skills/commands may depend on the
installed Copilot plugin's capabilities. If slash-command discovery is unavailable,
read `.github/skills/speckit-implement/SKILL.md` explicitly and follow its workflow.
Do not claim a command executed merely because its name was printed.

Use the current feature path if the checkout-local `.specify/feature.json` pointer
is absent. Work sequentially, first T001–T008 foundation then user-story slices,
checking requirements and recording real evidence. Do not deploy to Lightsail,
change server settings, or claim browser/load results without actual execution.
Shared developer API contracts and the default theme belong in this engine repo;
the separate themes repo consumes the public versioned SDK only.

For the first local handoff, read the implementation skill and implement T001–T003
only, run appropriate setup/build checks that exist, update task status accurately,
then report changes, checks and any blockers. Do not execute all 44 tasks without
a broader implementation instruction.
