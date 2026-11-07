# Game Theme SDK and Package Contract v1

## Ownership

Engine: authentication, session ownership/caps, transport, authoritative clock,
runner lifecycle, metrics, persisted results. No hard-coded weapon, NPC, score or HUD rules.

Module: entity archetypes/capabilities, input schema, default gameplay settings,
map generation, navigation requests, simulation behavior, score calculation,
level progression and completion requests. Modules cannot alter account data,
admission rules or persisted results directly. Engine services expose scoped APIs.

Skin: input bindings, world renderer, effects/audio, HUD and theme-specific panels.
Core account/session navigation remains usable; skin host exposes mount/unmount
slots and navigation callbacks, so developers can replace layout without accessing
auth cookies. Renderers receive immutable state; presentation never changes authority.

## Logical interfaces

Implement TypeScript interfaces and runtime schemas in `packages/theme-sdk/src/`.

| Interface | Required operations/data |
| --- | --- |
| ThemeDefinition | id, name, version, engineApiMajor, module id/version/stateSchemaVersion, skin renderer id/version, assets digest, settings schema/defaults |
| GameModuleFactory | metadata, validateSettings, create(context, settings, roster, seed) returns isolated instance |
| GameModuleInstance | initialize; validateInput; applyInput; step(dt, tick); snapshot(viewer); results; dispose |
| ModuleContext | monotonic clock, seeded RNG, scoped entity store with bounded radius queries, geometry/circle movement, bounded navigation request/results, bounded event sink, completion request sink, metrics counters |
| Capability | stable type ID plus validated state and optional behavior hooks; no mandatory universal attack method |
| SkinFactory | metadata including accepted module/state schema; mount(host, assets) returns isolated presenter |
| SkinInstance | handleSnapshot; handleEvents; render(frameTime, interpolatedState); handleViewport; dispose |
| SkinHost | Canvas/DOM slots, input dispatch, camera anchor, selected target data, safe navigation callbacks, bounded asset loader/audio services |
| MapDefinition | validated, versioned map document shared by authored maps and seeded generators; includes stable objects, explicit collision shapes and typed spawn points |

`MapDefinition` v1 is validated by the public SDK before either source is loaded.
Objects have stable `id` and `typeId`, world `position`, and optional string `tags`
and JSON `properties`. Collision entries reference an object ID and define a
rectangle centered on that object's position. Spawn entries have stable IDs, a
`player`, `npc`, or `pickup` kind, a cell-centered position and a clearance radius.
Dimensions are multiples of the 32-unit navigation cell and no larger than 2048 by
2048. The theme's shared loader additionally checks collision bounds, spawn
walkability and connectivity; authored documents and generated documents must both
pass through that same loader. Generation is deterministic by seed, has a fixed
attempt limit, and falls back to a known-valid traversable map.

Entity stores provide radius queries backed by the session spatial index. Geometry
services provide walkability, obstacle checks and collision-resolved circle movement.
Navigation requests return opaque IDs and expose pending/completed path results;
implementations enforce per-tick search/node budgets and bounded outstanding work.
Modules must normalize player movement, query nearby targets rather than compare every
NPC against every entity, and cap path requests per simulation step. Default-theme
contact damage is a typed NPC capability with a one-second per-player cooldown;
player-fired weapons, projectiles and pickups belong to later gameplay tasks.

Realtime input uses a shared versioned envelope with an opaque module-defined JSON
`action`; the protocol does not require movement, aim, fire, or any other gameplay
fields. Each module validates its own action shape in `validateInput`. For example,
the default module's `combat` action carries movement, aim, and fire fields, while a
noncombat `unlock` action can carry only its target identifier.

Core validates completion requests against runner phase and finalizes once. Module
instances cannot share mutable singleton state. Dispose releases listeners, entities,
audio and timers. Context supplies deterministic time; modules must not create their
own tick loops. Each event/state schema version is part of compatibility validation.

## Package upload/install

Manifest includes theme ID/name/version, engine major 1, exact installed module and
renderer versions, accepted state schema, required/optional asset mappings, hashes,
and declared settings schema version. Pin resolved manifest plus digest per session.

Admin ZIP upload may contain `theme.json`, PNG/WebP/JPEG images, approved fonts
(WOFF2), and OGG/MP3/WAV audio. No JS, HTML, SVG, executables, symlinks or external
URLs. Max compressed bytes 10 MiB, extracted bytes 40 MiB, 256 entries, image edge
4096px and total decoded image pixels 32 million. Inspect archive metadata and actual
streamed bytes; reject absolute paths, traversal, duplicates/case collisions, nested
archives, decompression bombs and unknown files. Validate font/audio formats and
resource bounds. Extract to a temporary directory outside served assets, verify,
then atomically register under digest. Clean rejected staging directories.

Executable module/custom renderer installation uses reviewed server/client build
artifacts and operator CLI, not public upload. Uploaded manifest may reference only
already registered code. This still permits deep developer overrides; it does not
promise safe arbitrary third-party execution. Disabled/new revisions affect future
sessions only; asset cleanup may remove only unreferenced revisions.

## Reference deliverables

- Default theme provides all gameplay described in spec.md using the same SDK.
- Fixture changes enemy movement capability and HUD arrangement through the SDK;
  conformance checks prove no core-engine edits are required.
- Preview tool feeds living/dead players, enemies, obstacles, projectiles, pickup,
  intermission, spectators and results to a selected renderer. Deterministic fixtures
  are labeled preview data, not a multiplayer server.
- Developer guide maps hook ownership, package layout, build/install commands,
  compatibility, override examples, no-code asset upload versus trusted-code installation,
  and prohibited authority changes.

## Cross-repository developer contract

Canonical source: `scottzastrow/multiplayer-game-engine`. Consumer:
`scottzastrow/multiplayer-game-themes`. Consumer `engine-contract.lock.json` records
an immutable engine commit and contract paths; it is a planning pin until a compiled
SDK/release exists. The owner must publish SDK types, runtime schemas, fixtures,
reference module/skin and local preview tooling from this repository. Theme code
must import the released SDK, not engine private source paths. Upgrading a pin is
an explicit reviewed change with compatibility checks; do not track a moving branch
as the compatibility definition. Local full-game verification may use an engine
checkout read-only as a dependency; no deployment credentials are required.

New hooks/schema changes require an engine-side proposal and a new version/pin.
Theme releases contain source/build provenance and compatibility metadata; owner
reviews and installs code. Designer repo collaboration grants no deployment access.
