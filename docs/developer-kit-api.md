# Public API and sample settings

This kit uses engine API major 1 and npm packages 0.1.0 built at the revision
in `kit.json`. Full declarations ship in each package's `dist\*.d.ts`.
Import only package exports, never engine/server/client checkout paths.

| Import | Contract |
| --- | --- |
| `@multiplayer-game/local-preview` | `createLocalGame(options)`, `mountLocalPreview(root, game, skinFactory, options?)` and their types |
| `@multiplayer-game/theme-sdk` | `GameModuleFactory`, `ModuleContext`, `SkinFactory`, `SkinHost`, map schemas/validation, movement controller, radar and setting validators |
| `@multiplayer-game/theme-sdk/package` | Node-only credits/manifest/asset schemas, SHA-256 helpers, canonical digest and asset mapping validation used by the existing exporter |
| `@multiplayer-game/protocol` | JSON/wire schemas and validated engine settings; these do not automatically become sample gameplay settings |

`createLocalGame` takes a module factory, validated module settings, a validated
map (or factory `createInitialMap`), numeric seed, roster and viewer.
It initializes an isolated in-memory simulation. `sendInput(accountId, unknown)`
returns false for rejected input; `step()` advances one fixed 1/30-second tick
and returns snapshot/events/completion requests. `snapshot`, `tick`,
`subscribe(listener)` and `dispose()` provide state, observation and cleanup.
The mounted host routes skin intent to that module and renders snapshots;
the caller drives the tick timer and disposes both mount and game.
Skin metadata must match module ID/state version. Module code owns gameplay
and validation; no account, network, persistent session or trusted client
authority is supplied. Preview metrics are no-ops; completion requests are
returned to the caller, not production lobby finalization.

The sample's `src\main.js` shows the complete API composition.
`src\game.js` implements the module lifecycle and input validation;
`src\skin.js` implements the skin/HUD/controls lifecycle; `src\map.js` uses
public map validation. Do not rename module/skin metadata without also updating
`theme.json` and arranging owner registration for import.

## Supported sample settings

| Setting | Range/default | Behavior |
| --- | --- | --- |
| `moveDistance` (`src\settings.js`) | finite number > 0 and <= 32; default 4 | Distance per fixed tick before the sample source multiplier; validated by `sampleGameModule.validateSettings` |
| `SPEED_MULTIPLIER` (`src\game.js`) | editable source constant, initially 1 | Demonstrated edit to 2 doubles a clear one-tick move from 4 to 8; not an engine/lobby setting |
| seed (`src\main.js`) | 42 in the example | Reproducible local RNG seed |
| map (`src\map.js`) | public `MapDefinition` | Bounded One Wall geometry/spawns; use `validateMapDefinition` |

The module and skin currently both import the same authored map; edit that
file rather than substituting a different runtime map in `main.js` alone.
`theme.json` describes the sample's supported setting/default. When changing
settings, synchronize its documentation with module validation and
`src\settings.js`. The generic protocol's default-theme combat, NPC, wave,
health and terrain settings are **not implemented by this sample**.

## Export API boundary

`ThemeCreditsSchema` requires nonblank `project` and public `author`, with
optional string `course`. Exact errors are:

```text
Project (project) is required and must be a nonblank string.
Author (author) is required and must be a nonblank string.
```

The unchanged exporter uses `ThemePackageManifestSchema`,
`calculateThemeAssetHash`, `calculateThemePackageDigest` and
`validateThemePackageAssets`. Canonical manifest SHA-256 (`assetsDigest`) is
different from ZIP SHA-256 in the outer integrity inventory. ZIP export allows
only declared media, not JavaScript/TypeScript. Engine import additionally
checks ZIP safety, actual media bytes, registered code/version compatibility
and atomic installation. Existing installed legacy themes do not acquire a
new runtime credits requirement.
