# Theme Credits handoff contract

Extends the canonical [theme package contract](../../001-multiplayer-engine/contracts/themes.md).

Manifests at export/import require lower-case `project` and `author` as nonblank
strings. `author` is the developer-confirmed public person/team credit; `course`
is optional. Missing/empty/whitespace/non-string fields identify Project
(`project`) or Author (`author`) in the error, including both when both are absent.

Engine ZIP imports (upload and validation CLI) and reviewed-code manifest imports
use the same credit policy. ZIP failures remain HTTP 422 `INCOMPATIBLE_THEME`,
with no registry changes or promoted assets. Credits persist in imported manifest
bytes and are included in canonical hashing; runtime loading is unchanged.

Companion export must validate before writing ZIP output. Setup must gather
suggestions from metadata or recognizable credit comments, show conflicting names
as choices, and obtain confirmation before storing public credits. Header generation
must preserve existing attribution/comments and use Project, Author, file-specific
Description, optional Course: block comments for Java and JS/TS, HTML comments
for HTML, `#` comments for Python. JSON has no comments. Templates add no
copyright or SPDX lines. Escape or reject comment terminators and preserve
shebangs/encoding declarations when implementing the blocked generator.
