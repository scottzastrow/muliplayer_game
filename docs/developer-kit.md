# Game Developer Kit 0.1.0

Engine revision: `570884aa82a18bdee2d4d58c18265098164238ba`.
This kit runs an editable, single-player local preview, not a multiplayer server.
Built JavaScript is inspectable; this is not source protection.

## Install and preview

Requires Node 24 LTS, npm 11, and Python 3 for credit setup. Extract the entire
ZIP before running commands. From the extracted kit root in PowerShell:

```powershell
node tools\checksums.mjs
Set-Location sample
npm ci --no-audit --no-fund
npm run verify
npm run dev -- --port 5174 --strictPort
```

Open `http://127.0.0.1:5174`. Move east/west and Stop operate the local module;
the wall blocks eastward travel. Edit `src\game.js`:
`const SPEED_MULTIPLIER = 1;` -> `const SPEED_MULTIPLIER = 2;`.
Vite reloads the edited module. Settings, map and skin are separately editable.
`npm run build` makes a browser preview in `dist`; it is not an authoritative
multiplayer release. Public package types are installed under
`node_modules\@multiplayer-game`. See `API.md`.

The three engine public packages, Zod and the exporter's fflate are included
as local npm tarballs, not registry releases. `package-lock.json` pins Vite and
its transitive tooling dependencies. **Initial installation needs npm registry
access** for that tooling; this is not a fully offline dependency bundle.
No engine checkout, accounts, `.env`, backend source or deployment files are needed.

## Credits and asset-package export

The reference sample's Project `Local Preview Sample` and public Author
`Scott Zastrow` were explicitly confirmed; Course is omitted. When creating
your own project, run the existing credits workflow and enter **your own**
public credits before export:

```powershell
npm run credits
npm run theme:export -- --output theme-assets.zip
```

The credits command suggests metadata/comments, presents conflicting names,
asks for file-specific descriptions and requires confirmation before writing.
It preserves existing attribution/comments and adds no comments to JSON.
Python is used only for this existing setup workflow. Export rejects absent or
blank Project/Author with exact field errors, recalculates hashes/digest in the
ZIP and leaves source files unchanged. Output must be new; choose another
filename for a subsequent export. This sample has no external media assets,
so its initial export contains only `theme.json`. Add licensed media through
the manifest's required/optional asset declarations.

**`theme-assets.zip` is not executable game distribution.** It contains the
manifest and declared media only, never `src`, npm packages or built game code.
It references `sample-grid-runner@1.0.0` and
`sample-grid-runner-skin@1.0.0`, which are NOT registered on a stock engine.
The owner must review and compile/register your module and skin separately
with matching metadata before importing that asset package. A successful local
preview/export does not install executable code on any engine.

The outer Developer Kit ZIP distributes the editable developer project and
local preview dependencies. Do not upload it to the theme importer.
Neither ZIP is a deployed or production-ready multiplayer game.

## Integrity and provenance

`kit.json` records the full engine revision, package identities, dependency
policy and companion tooling revision/hashes. `SHA256SUMS` covers every
distributed file except itself. Run the checksum command before editing or
installing; edits/generated files intentionally invalidate the original inventory.
Package tarballs contain built public code/types and their npm metadata only.
Exporter and credits tools are copied byte-for-byte from the existing themes
checkout, without changing its pin or source. Existing attribution is retained.
Checksums establish integrity, not a publisher signature.

Engine maintainers assemble this local artifact with:

```powershell
npm run kit:build -- --themes-directory ..\multiplayer-game-themes
npm run kit:verify -- --archive var\developer-kit\multiplayer-game-developer-kit-0.1.0-570884aa82a1.zip
```

Verification extracts outside the checkout, installs from that extraction,
checks a source edit (4 -> 8), builds, exercises edited movement/Stop/HUD in
Chrome, exports through the unchanged exporter, then invokes the real engine
importer with disposable SQLite/assets and explicitly registered sample
metadata. That test-only registration is not a production code installation.
No companion integration/pin upgrade, visual editor, multiplayer capacity or
deployment is implied. T031 and T042 remain open.
