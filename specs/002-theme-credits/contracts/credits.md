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

## Public package entry (T012)

`@multiplayer-game/theme-sdk/package` is an additive Node-only export. It owns
`ThemeCreditsSchema`, `ThemeImportDefinitionSchema`, `AssetDeclarationSchema`,
`PackageAssetsSchema`, `ThemePackageManifestSchema`, their inferred types,
`runtimeThemeDefinition`, `calculateThemeAssetHash`, `createThemeAssetHash`,
`validateThemePackageAssets`, `calculateThemePackageDigest` and the existing archive/extracted/entry/image/
manifest/path limits. The real ZIP importer and reviewed-code handoff use these
same definitions; the browser SDK root and installed runtime schema stay unchanged.

The digest retains the previous canonical algorithm: omit top-level assetsDigest,
sort object keys recursively (default JavaScript string order), preserve arrays,
JSON.stringify scalar values/keys, then SHA-256 the UTF-8 encoding. Credits and
all optional declarations, even absent assets, bind into the digest. Asset hashes
are SHA-256 of raw bytes, not encoded strings.

The engine retains ZIP parsing/CRC/path/media safety checks, registered-code and
engine-version compatibility, installation and rollback. Accepted ZIPs are classic
single-disk ZIP (stored/raw-deflate), with only flags 0x0006/0x0008/0x0800,
matching local/central metadata and signed/unsigned descriptors. No ZIP64,
encryption, Unicode override extra fields or unsafe/case-colliding names.
Names are relative forward-slash paths bounded to 512 UTF-8 bytes; ASCII names
need no UTF-8 flag, non-ASCII names do. Root theme.json is required.
The complete accepted format, extra-field, path and limit rules are documented
in [Game Theme Development](../../../docs/theme-development.md#accepted-zip-formats-flags-and-paths).

`validateThemePackageAssets` shares the existing asset-map checks against included
file hashes: required presence, optional absence, duplicate IDs/paths, reserved
theme.json, hash agreement and undeclared files. It does not read files or validate
ZIP paths; callers supply hashes of the actual included bytes.

The npm-packed public API fixture ZIP must be imported unchanged through the real
importer and preserve credits, exact asset bytes/hashes and the registry digest;
runtime definitions must exclude credits/assets. This is engine/public-contract
coverage, not completion of blocked companion tooling. The immutable external
conformance pin stays intact until a reviewed commit can be pinned.
