# Multiplayer Game Engine — Copilot

Read and follow `AGENTS.md` as the shared project authority, then
`.specify/memory/constitution.md` and the current feature under
the checkout-local `.specify/feature.json` pointer: spec.md, plan.md, contracts/,
tasks.md. If absent, use `specs/001-multiplayer-engine/`. Theme Credits is a
separate feature at `specs/002-theme-credits/`; retain engine artifacts as context.
Use those files rather than inventing another architecture or task list.

Environment: IntelliJ IDEA, GitHub Copilot Agent mode, Windows PowerShell,
Node 24 LTS, npm 11, branch `001-multiplayer-engine`. Load application configuration
from ignored local `.env` using the planned startup loader; no Windows system
variables or production credentials are needed. The npm workspace/runtime exists;
use its existing manifests, scripts and focused tests for scoped follow-ups.

Spec Kit 1.3.2 Copilot skills are installed at `.github/skills/` and PowerShell
helpers at `.specify/scripts/powershell/`. Skills/commands may depend on the
installed Copilot plugin's capabilities. If slash-command discovery is unavailable,
read `.github/skills/speckit-implement/SKILL.md` explicitly and follow its workflow.
Do not claim a command executed merely because its name was printed.

Use the current feature path if the checkout-local `.specify/feature.json` pointer
is absent. Work sequentially against the selected tasks and completed foundation,
checking requirements and recording real evidence. Do not deploy to Lightsail,
change server settings, or claim browser/load results without actual execution.
Shared developer API contracts and the default theme belong in this engine repo;
the separate themes repo consumes the public versioned SDK only.

Read the implementation skill, execute only the authorized task slice, run
appropriate existing checks, and update task status accurately. Do not execute
the entire original engine task list during a scoped feature follow-up.

Theme Credits policy is shared in `AGENTS.md` and `docs/theme-development.md`.
Require confirmed nonblank Project (`project`) and public Author (`author`,
person or team) at export/import with exact field errors, optional Course
(`course`), and no new requirement at legacy installed-theme load.
Setup suggestions from metadata/comments require developer confirmation and
conflicting-name choices. Generated headers use Project, Author, file-specific
Description and optional Course, with language-correct comments and no JSON
comments or new copyright/SPDX template lines. Preserve existing credits,
asset attribution and unrelated comments. Keep unavailable companion paths and
their checks explicitly blocked rather than inventing tooling or results.
