# Feature Specification: Theme Credits

**Feature Branch**: `001-multiplayer-engine` (separate feature, same checkout)

**Created**: 2026-11-08

**Status**: Specified; engine-only implementation authorized, companion work blocked

**Input**: Require confirmed Project and public Author credits in theme manifests,
enforce at export/import, and generate language-correct source headers while
preserving existing attribution. Keep installed themes runnable. Preserve pending
verification documentation and `.idea`; leave T042 open, uncommitted, and undeployed.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Exchange credited themes (Priority: P1)

A developer exports a theme with an identified project and public person or team.
An operator imports it with useful field-specific feedback if either credit is absent.

**Why this priority**: Theme handoffs must identify the project and its public author.

**Independent Test**: Attempt each handoff with absent, empty, whitespace-only and
valid credits; verify exact field errors and unchanged installed themes on failure.

**Acceptance Scenarios**:

1. **Given** absent or blank Project, **When** export or import is attempted,
   **Then** it fails with an error identifying Project.
2. **Given** valid Project and absent or blank Author, **When** export or import
   is attempted, **Then** it fails with an error identifying Author.
3. **Given** nonblank Project and public Author, **When** an otherwise valid
   theme is exchanged, **Then** credits survive the handoff.
4. **Given** an installed theme without these credits, **When** it is loaded or
   played, **Then** it remains usable; its next export/import requires the credits.

### User Story 2 - Confirm credits during setup (Priority: P2)

Setup suggests credits from existing metadata or recognizable credit comments,
shows conflicting names as choices, and asks the developer to confirm public credits.

**Why this priority**: Suggestions must not silently assign authorship.

**Independent Test**: Supply agreeing, conflicting and absent candidates and
verify no suggestion is written before developer confirmation.

**Acceptance Scenarios**:

1. **Given** recognizable credits, **When** setup runs, **Then** suggestions are
   shown with their sources and the developer confirms or replaces them.
2. **Given** conflicting names, **When** setup runs, **Then** all choices are
   presented rather than one being silently selected.
3. **Given** confirmed nonblank credits, **When** setup completes, **Then** the
   manifest stores them; Course remains optional.

### User Story 3 - Generate accurate headers (Priority: P2)

Generated source identifies Project, Author and that file's Description without
overwriting contributor credits, asset attribution or unrelated comments.

**Why this priority**: Credits must be accurate without destroying prior attribution.

**Independent Test**: Generate headers for Java, JavaScript/TypeScript, HTML and
Python, and verify JSON remains comment-free.

**Acceptance Scenarios**:

1. **Given** confirmed credits, **When** source is generated, **Then** Project,
   Author and a file-specific Description use the language's comment syntax.
2. **Given** optional Course, **When** headers are generated, **Then** it appears
   only when supplied; the template adds no copyright or SPDX lines.
3. **Given** existing attribution and unrelated comments, **When** setup generates
   or updates source, **Then** those existing statements are preserved.

### Edge Cases

- Missing, empty, whitespace-only, null and non-string credits must not pass handoff.
- Both absent fields must be identified; no placeholder author is inferred.
- Team names are valid public authors. Private account/commit identity is not consent.
- Credits with surrounding whitespace are nonblank; validation must not change
  bytes used in an existing canonical digest.
- JSON must remain valid JSON; source headers must not invalidate special preambles.
- Failed import must not alter the registry or promote assets.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Theme handoff manifests MUST contain nonblank Project and public Author.
- **FR-002**: Export and all import entry points MUST reject each missing or blank
  field with an error identifying that exact field.
- **FR-003**: Existing installed themes MUST continue to load/run unchanged and
  MUST satisfy credits on their next export/import.
- **FR-004**: Setup MUST suggest credits from existing metadata or recognizable
  comments, expose conflicts and require developer confirmation before writing.
- **FR-005**: Confirmed credits MUST be stored in the manifest. Course is optional.
- **FR-006**: Generated source MUST have Project, Author and a file-specific
  Description using appropriate comments for Java, JavaScript/TypeScript, HTML
  and Python; JSON MUST remain comment-free.
- **FR-007**: Templates MUST omit copyright/SPDX and preserve existing contributor
  credits, asset attribution and unrelated comments.
- **FR-008**: Developer and AI instructions MUST describe credit confirmation,
  boundary validation, header rules and legacy compatibility.
- **FR-009**: Verification MUST cover absent and whitespace-only credits at both
  exchange boundaries and the required header languages, without fabricated evidence.
- **FR-010**: Inaccessible paths MUST be reported explicitly; blocked companion
  work MUST remain open rather than be replaced by an invented parallel tool.

### Key Entities

- **Theme credits**: Project, public Author (person or team), optional Course.
- **Credit suggestion**: Candidate credit and metadata/comment source; conflicting
  candidates require developer choice.
- **Source header**: Confirmed credits and a description specific to its file.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every tested missing or blank Project/Author is rejected at both
  handoff boundaries, with the affected field identified.
- **SC-002**: All tested installed legacy themes remain runnable without edits.
- **SC-003**: All setup suggestions require confirmation and all conflicts expose choices.
- **SC-004**: All required source formats have correct headers, JSON stays
  comment-free, and existing attribution survives unchanged.

## Assumptions

- Manifest keys are lower-case `project`, `author` and optional `course`; labels
  in diagnostics/headers are Project, Author and Course.
- Existing runtime compatibility contracts are unchanged; credits are required
  at handoff boundaries, not at installed-theme load.
- The user authorized engine-only work after the local themes checkout could not
  be found. Companion setup/export/header implementation and tests remain blocked.
- GitHub `main` has only README; `001-theme-development` has planning documents
  and a skeleton, not runnable setup/export tooling. Remote inspection is read-only.
