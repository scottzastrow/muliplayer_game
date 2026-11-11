# Tasks: Theme Credits

**Input**: `specs/002-theme-credits/` design artifacts.
**Prerequisites**: spec.md, plan.md, research.md, data-model.md, contracts/, quickstart.md.
**Tests**: Required by the user; record executed results, not inferred coverage.
**Organization**: Separate feature on the existing branch. IDs below are local to
this feature, not replacements for the original engine tasks.

## Format: `[ID] [P?] [Story] Description`

Exact engine paths are given below. Companion executable paths are unknown;
their tasks target the inspected layout and remain blocked until the actual
local checkout/tooling is provided. No delegated implementation or worktrees.

## Phase 1: Setup

- [X] T001 Inspect engine and companion paths and record access evidence and engine-only user decision in specs/002-theme-credits/research.md.

## Phase 2: Foundational

- [X] T002 Specify handoff-only project/author/course, unchanged installed runtime and header/confirmation requirements in specs/002-theme-credits/contracts/credits.md and data-model.md.

## Phase 3: US1 - Exchange credited themes (P1)

**Goal**: Reject uncredited handoffs without breaking legacy installed themes.
**Independent test**: Field matrix through ZIP importer, upload API and reviewed-code CLI.

- [X] T003 [US1] Add missing/empty/whitespace/non-string Project/Author import tests in tests/theme-packages.test.ts, tests/operator-tools.test.ts and tests/integration/theme-install.test.ts, plus valid-credit preservation and legacy load checks.
- [X] T004 [US1] Implement shared required nonblank-string project and author, optional-string course schemas in apps/server/src/themes/credits.ts; identify exact fields and retain original string bytes.
- [X] T005 [US1] Wire shared handoff schema into apps/server/src/themes/packages.ts and tools/install-theme-code.ts; preserve promoted credit manifest and strip handoff-only fields before unchanged SDK runtime validation.
- [ ] T006 [US1] Enforce/test missing and whitespace-only credits before ZIP export in companion themes/ tooling/tests (actual executable paths unavailable; BLOCKED).

## Phase 4: US2 - Confirm setup credits (P2)

**Goal**: Suggest with provenance, expose conflicts, require confirmation.
**Independent test**: Metadata/comment conflicts cannot silently write credits.

- [ ] T007 [US2] Implement/test credit discovery, conflicting choices, confirmation and theme.json write-back in companion templates/theme/ and themes/ setup tooling (actual executable paths unavailable; BLOCKED).

## Phase 5: US3 - Generate accurate headers (P2)

**Goal**: Correct comments, file-specific descriptions and preserved attribution.
**Independent test**: Java, JavaScript/TypeScript, HTML, Python and comment-free JSON.

- [ ] T008 [US3] Implement/test confirmed Project/Author/Description headers and optional Course in companion templates/theme/ generator/tests; omit new copyright/SPDX, preserve contributors/assets/unrelated comments and language preambles (actual executable paths unavailable; BLOCKED).

## Phase 6: Cross-cutting documentation and evidence

- [X] T009 Update docs/theme-development.md, AGENTS.md, .github/copilot-instructions.md and specs/001-multiplayer-engine/contracts/themes.md with handoff credits, legacy compatibility, confirmation/header rules and access limits.
- [ ] T010 Update companion AGENTS.md and docs/developer-guide.md with the canonical credit workflow (no local writable checkout; BLOCKED).
- [X] T011 Run focused engine import/legacy tests and npm run check, record results and blocked checks in specs/002-theme-credits/tasks.md, preserve the pre-existing docs/verification.md edit and .idea, and leave original T042 open.

## Phase 7: Public theme package contract

- [X] T012 [US1] Publish the Node-only `@multiplayer-game/theme-sdk/package` entry point in packages/theme-sdk/src/package.ts and package.json; move handoff manifest/credit schemas, asset SHA-256 helpers, canonical assetsDigest calculation and package limits there, wiring the real ZIP importer and reviewed-code tool to the same definitions. Document the accepted ZIP methods/flags/path rules in docs/theme-development.md and contracts/credits.md. Add tests/theme-package-contract.test.ts with an isolated npm-packed consumer that builds a fixture ZIP through the public API and imports those exact bytes through the engine, verifying credits, asset bytes/hashes, registry digest and credit-free runtime definitions. Run focused package/import tests and npm run check; preserve unrelated edits, leave the immutable conformance pin intact pending a reviewed commit, keep original T042 open and leave changes uncommitted without push/deployment.

T012 depends on completed T004/T005/T009, not blocked companion tasks or T042.
It is a separately authorized additive public contract slice, not completion of
companion export/setup tooling or permission to repin the external consumer.

## Dependencies & Execution Order

T002 depends on T001. T003 depends on T002; T004 follows the failing T003 checks;
T005 depends on T004. T006 and T007 depend on T002 and local companion access;
T008 also requires confirmed credits from T007. T009 depends on the designed
contract and actual engine implementation. T010 depends on companion access.
T011 depends on T003-T005 and T009, not blocked companion tasks.

US1 engine import is the available MVP slice; the whole story remains incomplete
until export is wired. US2 and US3 are deferred, not silently dropped.

## Parallel Examples

US1 unit and API test file edits are independent once the contract is fixed.
US2 suggestion fixtures and US3 language fixtures could be prepared independently
once companion paths are available; generator wiring needs confirmed credits.
Execute sequentially in this handoff; these are dependency notes, not agent launches.

## Implementation Strategy

Complete engine import and documentation first; validate the exact field errors,
credit preservation and installed legacy behavior. Keep blocked tasks unchecked.
Resume companion work only against the real existing tools. Do not deploy or commit.

## Execution Evidence

2026-11-08: The new-test selection initially failed as expected (3 files,
8 failures, 9 skipped): existing schemas rejected credit keys and accepted a
package with both credits absent. After implementation, `npm run check` passed
and the full focused selection passed:

```powershell
npm test -- tests\theme-packages.test.ts tests\operator-tools.test.ts tests\integration\theme-install.test.ts tests\integration\theme-admin.test.ts
```

Result: 4 files, 18 tests passed. The import matrices cover absent, empty,
whitespace-only (including nonbreaking space), null and numeric Project/Author,
both missing fields, public person/team and optional Course, exact promoted
manifest bytes/digest, rollback and legacy enabled/running theme behavior.
Upload errors retain HTTP 422 INCOMPATIBLE_THEME with exact field messages.
The validation CLI shares the tested ZIP importer; no separate CLI execution
is claimed by these tests.

`git diff --check` passed. `docs/verification.md` retained its pre-existing SHA-256
`9DA5E05626F69C9EF5E56C954B9FDA41C4CBF7BFC3A416CEF12D5810F5CD1957`;
all six existing `.idea` file hashes remained unchanged. Original T042 remains
unchecked. No deployment, browser, capacity or companion export/header run was
performed. No runtime SDK/package/pin or installed legacy manifest was changed.

T006-T008 and T010 remain blocked by missing local companion tooling/access;
they are not completed by the policy documentation.

### T012 public package contract evidence (2026-11-08)

The new public API test first failed at collection because `./package` was not
exported (no tests ran), confirming the missing entry point. After extraction,
the final `npm run check` passed and this focused selection passed:

```powershell
npm test -- tests\theme-package-contract.test.ts tests\theme-packages.test.ts tests\operator-tools.test.ts tests\integration\theme-install.test.ts tests\integration\theme-admin.test.ts
```

Result: 5 files, 25 tests passed. The public entry owns the former credits helper,
manifest schemas, manifest-to-file mapping checks, streamed/raw asset hashing,
canonical digest helper and limits. The importer consumes the shared definitions;
ZIP/CRC/path/media safety, registered-code compatibility and installation stay
engine-owned. Public schema checks preserve exact credit diagnostics, strict fields
and inherited module/skin refinements; digest checks cover key/array order, UTF-8
and exact credit bytes. Browser-root dependency checks find no Node imports or
package-entry re-export in the SDK's built relative dependency graph.

The isolated consumer installed offline npm-packed protocol/SDK/Zod artifacts,
then produced a deflated UTF-8 ZIP with signed data descriptors using the public
manifest/hash/mapping API and the existing test-only ZIP writer. The real importer
read that same ZIP, preserved its bytes and manifest credits, installed both
required and present optional image bytes with their exact SHA-256 hashes, tolerated
the declared absent optional asset, and registered the canonical digest/asset root.
Credits and assets were excluded from the runtime definition. Temporary packed
consumer files were removed by the test.

`git diff --check` passed. The browser SDK root and protocol sources are unchanged.
The immutable conformance pin retains SHA-256
`B296A7A33DF3AFB7711CBD425E9F682DDD81457E74E926F8CB435801A83A88E0`;
the original pinned external-consumer drift test was not run or repinned and
remains a reviewed-commit gate, not a claimed passing check.
The pre-existing docs/verification.md hash remains
`9DA5E05626F69C9EF5E56C954B9FDA41C4CBF7BFC3A416CEF12D5810F5CD1957`,
and the six existing .idea file hashes are unchanged. Original T042 stays open.
No companion export/setup/header, browser, capacity or deployment execution is
claimed. Changes remain uncommitted; no push or deployment was performed.
