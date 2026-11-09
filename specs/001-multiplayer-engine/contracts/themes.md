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
| GameModuleInstance | initialize; validateInput; applyInput; setPlayerPresence(accountId, connected/disconnected/expired); step(dt, tick); snapshot(viewer); results; dispose |
| ModuleContext | monotonic clock, seeded RNG, scoped entity store with bounded radius queries, geometry/circle movement, bounded navigation request/results, bounded event sink, completion request sink, metrics counters |
| Capability | stable type ID plus validated state and optional behavior hooks; no mandatory universal attack method |
| SkinFactory | metadata including accepted module/state schema; mount(host, assets) returns isolated presenter |
| SkinInstance | handleSnapshot; handleEvents; render(frameTime, interpolatedState); handleViewport; dispose |
| SkinHost | Canvas/DOM slots, input dispatch, camera anchor, selected target data, safe navigation callbacks, bounded asset loader/audio services |
| MapDefinition | validated, versioned map document shared by authored maps and seeded generators; includes stable objects, explicit collision shapes and typed spawn points |

The public additive `Countdown` helper accepts `(clock: MonotonicClock,
durationSeconds: number)` and exposes `deadlineMs`, nonnegative `remainingSeconds`
and `expired`. It creates no timers and performs no completion, respawn or gameplay
action. Modules create it per timed phase and check it from their authoritative
step; each module decides what expiry means. Durations must be positive/finite and
clock/deadline values finite.

T029 adds the optional TypeScript `setPlayerPresence` hook; the running-session
host requires it and fails explicitly if a pinned module lacks reconnect support.
Only the engine calls it after authenticated admission, matching-generation detach,
reservation expiry, or explicit leave. The module removes disconnected avatars and
controls while preserving the frozen roster, score and life deadlines; expiry
cannot recreate a participant. Dots and Squares resumes a living player at their
previous position only if it remains safe, otherwise tries at most 64 generated
candidates per tick. A blocked return reports the existing respawn presentation
fields without resetting retained health. Dead players keep their original
deadline, even while disconnected. Additive player snapshot fields `connected`
and `expired` expose presence without altering the opaque action envelope.

`MapDefinition` v1 is validated by the public SDK before either source is loaded.
Objects have stable `id` and `typeId`, world `position`, and optional string `tags`
and JSON `properties`. Collision entries reference an object ID and define a
rectangle centered on that object's position. Spawn entries have stable IDs, a
`player`, `npc`, or `pickup` kind, a cell-centered position and a clearance radius.
Pickup spawns must identify `health`, `rapid-fire`, or `spread`; other spawn kinds
cannot declare a pickup effect.
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
contact damage is a typed NPC capability with a one-second per-player cooldown.
The default module authoritatively fires bounded-lifetime projectiles, damages NPCs
without friendly fire, serializes single-claim health and weapon pickups, and tracks
player score, kills, deaths and expiring powerup effects.
Defeated players leave the active entity store while their standings are retained.
Their configured respawn deadline defaults to 150 fixed ticks (five seconds);
fractional delays round up to a whole tick. Returning restores full health at a
random cell with 64 units of additional obstacle, enemy and projectile clearance.
Placement tries at most 64 candidates per player per tick; a blocked player remains
dead, publishes its unchanged deadline and blocked state, increments
`default.respawn.blocked`, and retries on the next tick. Inputs are cleared on
defeat/return and ignored while dead. There is no immunity or retained contact
cooldown after return. Intermissions do not reset death deadlines, and completed
matches never respawn players. In-flight shots retain their owner's score credit
even if that owner is defeated.

Default module state schema v3 keeps only active avatars in `entities` and adds a
`players` array containing roster identity, retained health/score/effect state,
position and `alive`. Dead entries additionally expose `respawnAtTick` and
`respawnBlocked`. Schema v4 retains these fields and adds the authoritative `tick`
and `map: {width, height, obstacles: [{x, y, width, height}]}` for presentation.
The implemented default renderer requires schema v4; earlier stub-renderer
snapshots are explicitly rejected rather than rendered with guessed geometry.

The browser skin host supplies isolated `world`, `hud` and `controls` DOM slots,
requestAnimationFrame scheduling, resize/DPR notifications, input dispatch and
navigation callbacks. The public additive `SkinHost.setCameraAnchor(Point2 |
undefined)` operation publishes each skin's chosen anchor to its own host; it
cannot alter server positions. The default skin interpolates the previous/current
entity positions over their snapshot tick interval, without extrapolation or
interpolation across respawns/level changes. It centers its own interpolated
avatar, retains the death anchor while absent, and culls off-viewport entities.
Players are dots, NPCs squares; projectiles, pickups and map obstacles are also
visible. Points are visually largest, with current health and life/level status.
The host sets `controls.dataset.controlMode` to the authenticated account preference.
Keyboard Only maps WASD to screen-direction movement and facing, left/right arrows
to turning in place, and Space to firing. Keyboard + Mouse maps all arrows to
screen-direction movement and facing, mouse movement to aim and left click to firing.
Movement is normalized diagonally. A newly pressed movement key sets facing once;
holding it, including browser key auto-repeat, maintains movement without overriding
subsequent mouse aim or keyboard rotation. Turning and firing do not change the held
screen-direction movement vector. Release preserves facing. A keyboard turn persists
until actual mouse movement takes over aiming. Inputs dispatch only module-defined `combat` intent through
the shared action envelope, at no more than 30 scheduled sends/second. Each room
assigns distinct player colors and one separate NPC-square color; player facing is
serialized with player state and rendered as a small same-color dot beyond the
player dot's front edge. Both color and facing remain in the roster view through
respawn and are included in spectator snapshots.
Blur, hidden tabs, death and disposal clear controls; release stops firing.
The host cancels frames/observers and the skin removes event listeners on disposal.
Shapes need no assets; undeclared asset requests fail explicitly. Asset package
loading and spectator views remain separate later tasks.

The default package exports `createDefaultResultsSkin(result, reload)` as an
isolated public skin factory for saved-result presentation through the same host.
It displays saved Rank/Player/Points/Kills/Deaths order, highlights the current
account, provides Reload saved result and invokes `host.navigate("lobby")` for
Back to lobby. Core fetches and validates saved results and owns the stable
`#results/<match UUID>` URL, including login/page-reload restoration and cancellation
when leaving. The theme never writes results or sends gameplay input from this
view. Missing/invalid results show an accessible error with retry and lobby
controls; unfinished results explicitly say final scores are unavailable.

Level population and NPC health use the frozen player roster and configured per-level
growth formulas; every level is preflighted against runtime ceilings before play.
Clearing a non-final level requests completion once and starts a five-second
intermission before the next difficulty tier. Clearing the maximum level requests
match completion once and returns deterministic score/kills/deaths standings. Core
persists final standings and terminal state together, with compare-and-set level
updates and one result row per match.

Default state/snapshots add authoritative `startingNpcCount`, `livingNpcCount`
and `levelStandings`. The starting count is frozen from the current wave's
preflighted difficulty; living counts only positive-health NPCs still in the
entity store. Both counts are safe nonnegative integers bounded by 2000, with
living <= starting. The module always emits both counts. The default skin renders
`Level L · living of starting enemies remaining` outside radar/filter visibility.
Counts must not be inferred from enabled radar categories.

`levelStandings` contains the frozen roster in the existing descending-points,
descending-kills, ascending-deaths, case-insensitive-name order, with
`accountId`, `username`, `rank`, `points`, `kills`, `deaths` and `levelPoints`.
`levelPoints` is the nonnegative difference from each account's score at wave
start; death/respawn does not reset it. At next-wave spawn the baseline resets,
while total scores remain. Player and spectator snapshots carry identical wave
counts and standings; spectators display their selected target's earned points.
During `intermission`, level remains the completed level and
`intermissionEndsAtTick` is the authoritative deadline. The skin shows the
completion heading, earned points, running standings and next-level countdown
`ceil(max(0, deadline - tick) / 30)`. No new lobby setting or delay is introduced.
Final clear retains the existing match-completion/saved-results route, not an
intermission promising an additional level.

These are additive default-module schema-4 fields, not a shared SDK/protocol
change. Older skins ignore the additions. This skin accepts legacy snapshots
without the new fields for installed themes/preview compatibility, using the
legacy count label when no starting total is available; supplied counts must be
paired and valid. No immutable package revision is repinned by this change.

Dots and Squares starts a new countdown after spawning each wave, provisionally
`min(360, 120 + 6 * starting NPC count)` seconds. The monotonic deadline keeps running
through death, blocked respawn and disconnection, without depending on accumulated
simulation ticks or resetting as NPCs die. Clearing before expiry cancels the
countdown during the existing five-second intermission. At or after expiry, the
module enters `complete` and requests `{kind:"match", reason:"wave-timeout"}` once,
before any further combat or respawn work. This produces saved standings at the
current level, not an abandoned result or an artificial maximum-level clear.
The additive optional schema-v4 `waveRemainingSeconds` snapshot/state field is
present during active waves (and zero after timeout), absent during intermission
or successful completion. Both default HUD modes display its rounded-up seconds,
including while the selected player is dead. Existing schema-v4 renderers may
ignore the field; updated renderers accept older v4 snapshots without it. No
protocol envelope, required SDK method or manifest schema changes are needed.

Realtime input uses a shared versioned envelope with an opaque module-defined JSON
`action`; the protocol does not require movement, aim, fire, or any other gameplay
fields. Each module validates its own action shape in `validateInput`. For example,
the default module's `combat` action carries movement, aim, and fire fields, while a
noncombat `unlock` action can carry only its target identifier.

On session start, Core freezes the roster and pinned theme, initializes one isolated
module with session-scoped services, and owns its fixed-step runner. Core rejects
actions that fail the active module's validator and publishes viewer-scoped snapshots
with protocol and module state schema versions. It consumes level requests only from
the intermission phase and persists level changes with compare-and-set semantics.
Match requests are accepted only from the complete phase with standings for the
current persisted level, no higher than the configured maximum; the module owns
the reason for ending early or after a final clear.

Modules may include the public SDK's optional `radar` view in each viewer-specific
snapshot. A view declares its game-defined marker categories and the markers selected
for that viewer; the engine forwards the selected module snapshot without imposing
combat categories or visibility rules. Spectator snapshots use the followed player's
module view. `RadarViewSchema` bounds and validates category IDs, marker IDs and
finite world positions (64 unique categories, 6,400 unique markers). Markers may
include a positive finite rectangle `footprint: {width, height}` centered on their
world position. The shared `drawRadar` helper renders a circular, north-up view.
The skin supplies category colors, optional per-marker color overrides, category
shapes (`dot`, `diamond`, `footprint`), enabled categories and a center/facing
indicator. Filtering is render-only and never mutates the authorized module view
or dispatches an input. Dots/diamonds outside range clamp to the rim; footprints
keep their world-space extent and are clipped to the circle, not clamped into
false rim obstacles. Footprints render behind point markers.

Placement, offered filters and their defaults belong to the skin, not the shared
SDK or engine. Dots and Squares authorizes live fellow players (excluding self),
living NPCs, available pickups and actual map collision rectangles as `player`,
`enemy`, `pickup` and `terrain`. Its skin puts the radar in the upper-right with
four independently selectable filters, initially enabled: Fellow players, NPCs,
Pickups and Terrain. Fellow dots use their assigned colors, NPC dots the shared
enemy color, pickups diamonds and terrain muted footprints. Self/facing stays
centered and `Enemies remaining` stays below the radar even when NPCs are hidden.
Markers disappear on authoritative death, pickup claim or player departure.
Spectators receive the followed player's authorized radar and filter only their
own skin instance. Resize preserves filter selections within a mounted view.
The optional field is additive: older snapshots without radar remain accepted;
older skins may ignore it. These uncommitted SDK additions require a reviewed
immutable engine-contract pin update before external-consumer conformance can pass.

Result persistence, terminal state and slot release happen once. Startup failure or
termination records the corresponding terminal result and disposes the runner/module.
Module instances cannot share mutable singleton state. Dispose releases listeners,
entities, audio and timers. Context supplies deterministic time; modules must not
create their own tick loops. Each event/state schema version is part of compatibility
validation.

## Package upload/install

The Node-only `@multiplayer-game/theme-sdk/package` public entry owns handoff
manifest/credit/asset schemas, raw and streamed asset SHA-256 helpers, canonical
package digest calculation and package limits. Export tools and the real importer
use the same definitions, without importing engine-private validation. The browser
SDK root remains unchanged and free of Node dependencies. ZIP safety, media
validation, registered-code compatibility and installation remain engine-owned.
See `docs/theme-development.md` for the actual accepted ZIP methods, flags,
descriptors, extra fields and path rules. This additive uncommitted export does
not authorize updating the immutable conformance pin before a reviewed commit.

Theme Credits adds handoff-only required `project` and `author` nonblank strings
to new export/import manifests; Author is a developer-confirmed public person or
team. Optional `course` is a string. Missing, empty, whitespace-only or non-string
values identify the exact field as Project (`project`) or Author (`author`).
Both are identified when both are absent. ZIP upload/validation and reviewed-code
manifest import share this requirement. Credits bind into the canonical package
digest and persist in the imported `theme.json`; do not trim their bytes during
validation. The compiled runtime ThemeDefinition remains unchanged and import
separates these fields before its compatibility checks. Existing installed
themes keep running with their original revision/digest, but require credits on
their next export/import. No installed-manifest or database migration is required.
See [Theme Credits](../../002-theme-credits/contracts/credits.md) and
`docs/theme-development.md` for setup confirmation and generated-header policy.

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

An upload manifest includes an `assets` object with `required` and `optional`
maps from stable asset IDs to `{ "path": "...", "sha256": "<64 lowercase hex>" }`.
Every required mapping must exist; optional mappings may be absent. Every included
asset must be declared exactly once, and its streamed SHA-256 must match. The
manifest's `assetsDigest` is SHA-256 of canonical JSON for the complete validated
manifest with the `assetsDigest` field omitted; canonical JSON recursively sorts
object keys and preserves array order. The asset declarations bind the content
hashes into that digest. The root `theme.json` is required and bounded to 256 KiB.
Image dimensions and aggregate decoded pixel counts are checked before registration.
Validated assets are extracted to staging outside the content-addressed asset
directory, then renamed into place before the registry transaction commits; a
failed database registration removes its newly promoted directory.

Executable module/custom renderer installation uses reviewed server/client build
artifacts and operator CLI, not public upload. Uploaded manifest may reference only
already registered code. This still permits deep developer overrides; it does not
promise safe arbitrary third-party execution. Disabled/new revisions affect future
sessions only; asset cleanup may remove only unreferenced revisions.

Before a revision can be selected or a match started, Core validates its registered
engine API major, module ID/version/state schema, renderer ID/version and package
digest against the installed server code. New matches may use only enabled revisions.
The match stores both the exact `themeId@version` and package digest; runtime,
reconnect and client presentation resolve this immutable pair. Disabling a revision
blocks new matches and waiting-session selection but does not invalidate an active
match. Revision/code cleanup must retain every pair referenced by a live match.
The client also requires the exact pinned revision/digest to be installed and checks
its renderer's accepted module and state schema before mounting.

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
