# Game Theme Development

## Default-theme wave status and transitions

The module emits `startingNpcCount`, `livingNpcCount` and ranked `levelStandings`
for players and spectators. Active player and selected-target spectator views
use a slim Score/Health bar with Back to Lobby; no wave timer is displayed.
Application/theme headings and duplicate external
level/enemy labels are omitted. The canvas fills the remaining desktop viewport,
with radar and its authoritative enemy count overlaid independently of filters.
Controls and radar filters are available in the arena's **Controls & radar**
disclosure; spectator follow/switch controls remain available there as well.
On a non-final clear, the existing five-second
intermission shows the completed level, viewed player's level-earned points,
running standings and next-level countdown. Totals persist across waves; only
the per-level score baseline resets at the next spawn. Final clears retain the
existing saved final-standings route. The preview includes an `intermission`
scenario; older snapshot fixtures without the additive fields still render.

The focused compact-layout browser check is `node tests\browser\default-game.mjs
--compact-match`, targeting the same test-only staged-wave fixture described
below. Set `BROWSER_TEST_ARTIFACT_DIR` for screenshots. It checks both roles at
1366x768, 1440x900 and 1920x1080 normal browser window bounds, actual content
viewport fit, a top bar at most 48 pixels high, reachable overlay filters,
smallest-window intermission standings and restoration of the roster/lobby.

The focused real-browser check is `node tests\browser\default-game.mjs
--level-transitions`, using the existing Chrome debugging setup and
`BROWSER_TEST_ORIGIN`/`BROWSER_DEBUG_URL`. It must target the **test-only**
`tests\browser\level-transitions-server.ts`, not a normal developer or deployed
server. The server requires `NODE_ENV=test` and `HOST=127.0.0.1`, opens a disposable
database, and stages one real NPC at a time at (400,272) in a verified clear lane.
It leaves default wave settings, health, scoring, combat and progression intact;
the staging is not evidence of unassisted play or natural NPC navigation.

For example, create an ignored `var\wave-check.env` with test mode, loopback host,
unused server port, matching client `PUBLIC_ORIGIN` and a new database path.
Start the fixture and Vite in separate terminals using that same env file:

```powershell
node --env-file=var\wave-check.env --import tsx tests\browser\level-transitions-server.ts
node --env-file=var\wave-check.env node_modules\vite\bin\vite.js apps\client --config apps\client\vite.config.ts --host 127.0.0.1 --port 15178 --strictPort
```

Set the file's `PUBLIC_ORIGIN` to `http://127.0.0.1:15178` for those commands.
The scenario registers a player and observer, keeps all lobby defaults, clears
wave 1 through mouse firing, checks both role summaries and filtered counts,
and verifies wave 2 starts with 12 NPCs at the intermission deadline. It leaves
its room in cleanup. Stop owned services and remove only their disposable
database/profile/env after the check; never use this fixture on Lightsail.

## Default-theme held movement controls

A fresh movement-key press sets facing to the current screen-direction movement
vector. Holding the key, including browser auto-repeat, maintains movement without
reasserting facing. In Keyboard + Mouse mode, hold Down Arrow, move the pointer
left and click to keep the downward input while aiming/firing left. In Keyboard
Only mode, hold S, rotate with Left/Right Arrow and press Space: the held input
remains down while travel bends toward facing and firing follows the rotation.
First-Person is a separate saved control choice using the same Keyboard Only
bindings. All three modes apply the same facing-steered movement, including
mouse aim while a movement key is held.

Dots and Squares exports the theme tuning setting `PLAYER_FACING_MOVEMENT_BLEND`
from `themes/default/src/module/tuning.ts`, set to `0.30`. Its range is 0 to 1:
0 follows movement input exactly; 1 follows facing whenever movement is held.
Combat intent includes `controlMode: "first-person"`, `"keyboard-only"` or
`"keyboard-mouse"`; all three apply this blend. Legacy actions without a mode
still follow the input exactly. Each authoritative update starts
from the normalized held input and rotates it
by that fraction of the shortest signed angle toward current facing, preserving
input magnitude and speed. Rightward input with upward facing therefore travels
27 degrees upward from right. Rotation never accumulates into the stored input;
zero input permits spinning without translation. Firing still targets aim and
NPC movement is unchanged. This is a theme source setting, not a host lobby option.

With the existing disposable local server/client and Chrome debugging setup,
set `BROWSER_TEST_ORIGIN` and `BROWSER_DEBUG_URL` to those loopback endpoints and run
`node tests\browser\default-game.mjs --held-controls`. This focused scenario creates
three disposable accounts and sequential one-player rooms, disables NPC pursuit,
checks real repeated keyboard events, movement/facing and authoritative projectile
directions, and leaves each room in cleanup. It does not change map mode or require
database seed edits. Exact facing stability is also covered in
`tests\default-skin.test.ts` without network/snapshot timing.

The engine repository owns the public Theme SDK, protocol, default theme, fixture
theme, compatibility policy, and server/client registration. A Game Theme supplies
developer-reviewed gameplay and presentation modules through those contracts. The
engine remains authoritative for accounts, session membership and lifecycle,
transport, persistence, and metrics. Cosmetic package uploads contain assets and a
manifest only; executable code is never accepted from an uploaded archive.

## Local workspace

The engine checkout uses npm workspaces:

```text
multiplayer-game-engine/
  packages/theme-sdk/       # published public interfaces and schemas
  themes/default/           # Dots and Squares reference implementation
  themes/fixture/           # alternate module and HUD conformance example
  tools/theme-preview.ts    # deterministic renderer preview fixtures
  tools/theme-preview/      # local Vite preview page
```

Build the protocol, SDK, engine, and both reference themes with
`npm run theme:build`. Run the standalone renderer preview using
`npm run theme:preview`, then open the local URL printed by Vite (by default
`http://127.0.0.1:5174`). Select either installed reference renderer and one of the
fixed living, death/respawn, combat, pickup, spectator, or saved-results scenarios.
The preview calls the same client theme resolver and skin host as the application,
but never connects to a server or claims multiplayer/runtime verification.

The existing root commands expose the related review workflow:

```text
npm run theme:code -- <theme.json> <module-id@version> <renderer-id@version>
npm run theme:validate -- --package <asset-package.zip>
```

`theme:code` registers only module and renderer versions already compiled into a
reviewed build. `theme:validate` validates and installs an asset/manifest archive
referencing registered code; it does not compile or execute archive contents.
Operator credentials and `.env` values are local runtime configuration and must
never be copied into theme source, preview fixtures, or packages.

## Theme credits at handoff

Every new export/import manifest must contain nonblank string `project` (Project)
and `author` (public Author, a person or team). `course` (Course) is an optional
string. These credits are separate from the theme's ID, display name and account
identity; a display name is not a substitute for confirmed Project or Author.

```json
{
  "project": "Example Theme",
  "author": "Example Theme Team",
  "course": "Optional course"
}
```

This fragment extends the existing manifest; it is not a complete theme package.
`theme:code`, `theme:validate`, and admin ZIP upload enforce the credits. Missing,
empty, whitespace-only or non-string values identify the exact field, for example
`Project (project) is required and must be a nonblank string.` If both are
missing, both appear in the validation error. Import failures leave installed
revisions unchanged. Existing installed themes without credits continue to run;
they must add confirmed credits before their next export/import.

Credits are retained in the imported `theme.json` and included in the canonical
package digest. Editing any credit requires recalculating that digest. Validation
does not trim the stored strings or rewrite existing installed revisions. The
compiled runtime SDK definition is unchanged: handoff-only credit fields are
separated before runtime compatibility checks.

## Public Node package contract

Export/build tools use `@multiplayer-game/theme-sdk/package`, not server-private
source files. This additive entry point is exported only under Node's `node`
condition. The browser-facing `@multiplayer-game/theme-sdk` root is unchanged and
does not import or re-export the package entry or its Node crypto dependency.

| Export | Purpose |
| --- | --- |
| `ThemeCreditsSchema` | Required nonblank Project/Author and optional string Course, preserving supplied strings |
| `ThemeImportDefinitionSchema`, `ThemeImportDefinition` | Reviewed-code handoff definition with credits, without asset mappings |
| `AssetDeclarationSchema`, `PackageAssetsSchema`, `ThemePackageManifestSchema` and inferred types | Strict asset declaration/maps and complete cosmetic ZIP manifest |
| `calculateThemeAssetHash(bytes)` | Lowercase SHA-256 of raw `Uint8Array`/Buffer asset bytes |
| `createThemeAssetHash()` | Node incremental SHA-256 Hash for streaming the same bytes |
| `validateThemePackageAssets(manifest, files)` | Validates asset declarations against a path-to-`{sha256}` map of included files |
| `calculateThemePackageDigest(manifest)` | Canonical `assetsDigest`; does not validate a manifest or write a ZIP |
| `runtimeThemeDefinition(definition)` | Removes credits from a handoff definition; remove ZIP `assets` first |

The manifest schema retains the runtime definition's field, module/skin and
state-schema checks. Both asset maps are required (use `{}` for empty maps); IDs
match `^[a-z0-9][a-z0-9._-]{0,63}$`, hashes are 64 lowercase hex characters,
and declaration paths are nonempty strings of at most 512 JavaScript string
units. The schema does not replace ZIP path/safety or asset-content checks.
The shared `validateThemePackageAssets` helper used by the importer additionally
rejects IDs repeated across maps, reserved/duplicate asset paths, undeclared files,
missing required assets and incorrect file hashes. It consumes hashes, not file
contents; callers must hash the actual bytes with the shared helpers.
Optional assets may be absent; present optional assets are validated identically.

For export, hash each asset's exact bytes, put those hashes in the mappings, set
`assetsDigest` using the canonical helper, then validate before writing the ZIP:

```typescript
import {
  calculateThemeAssetHash,
  calculateThemePackageDigest,
  ThemePackageManifestSchema
} from "@multiplayer-game/theme-sdk/package";

// definition and confirmedCredits are supplied by the developer's existing tooling.
const manifest = {
  ...definition,
  ...confirmedCredits,
  assets: {
    required: { logo: { path: "images/logo.png", sha256: calculateThemeAssetHash(logoBytes) } },
    optional: {}
  }
};
manifest.assetsDigest = calculateThemePackageDigest(manifest);
ThemePackageManifestSchema.parse(manifest);
// Write root theme.json and the declared asset bytes with a compatible ZIP writer.
```

Use `validateThemePackageAssets` with the validated manifest and a map of the
actual included paths/hashes before writing; `theme.json` need not be in that map.
This checks mapping consistency, not filesystem or archive safety.

Canonical JSON omits only the top-level `assetsDigest`, recursively sorts object
keys using JavaScript's default string sort, preserves array order, and uses
`JSON.stringify` for keys and scalar values, with no formatting whitespace.
SHA-256 hashes its UTF-8 bytes. This binds credits (without trimming), all other
manifest fields and all required/optional declarations, including absent optional
assets. It is not a hash of ZIP bytes or formatted `theme.json` bytes. Non-JSON
values are not supported; validate the manifest rather than passing arbitrary objects.

### Accepted ZIP formats, flags and paths

The engine importer accepts classic **single-disk, non-ZIP64 ZIP** archives with
stored (method `0`) or raw DEFLATE (method `8`) entries. Each entry may use only
general-purpose bits `1`/`2` (compression options, mask `0x0006`), bit `3` (data
descriptor, `0x0008`) and bit `11` (UTF-8 names, `0x0800`); every other bit,
including encryption bits, is rejected. With bit 3, either a 12-byte unsigned or
16-byte signature-prefixed (`0x08074b50`) descriptor must agree with the central
CRC-32 and sizes. Without it, local CRC and sizes must agree directly. Local and
central name bytes, flags and compression method must always agree.

The end record must terminate the archive (a declared archive comment is allowed).
The central directory must end exactly at that record, contain exactly the declared
entries, and have no trailing records. Local entry/data/descriptor ranges cannot
overlap each other or the central directory. Well-formed extra fields and per-entry
comments are accepted, except ZIP64 (`0x0001`), Unicode path override (`0x7075`)
and Unicode comment override (`0x6375`) extra fields. ZIP64 sentinel sizes/offsets,
multi-disk entries and unsupported compression methods are rejected. Actual
streamed sizes and CRC-32 must match declarations.

ZIP names are relative, forward-slash-separated paths of **1-512 UTF-8 bytes**.
With bit 11 clear, all name bytes must be ASCII; with bit 11 set, non-ASCII names
must decode as valid UTF-8. A single trailing slash marks a directory and is removed
for collision checking; directories must declare zero compressed/uncompressed
bytes. No leading slash, initial drive-letter prefix (`C:`), backslash, NUL,
ASCII control character, empty segment, `.` or `..` segment is accepted.
Normalized names must be unique, including case-insensitive collisions using
`toLocaleLowerCase("en-US")`. Asset mappings match file paths exactly, including
case; the root manifest must be exactly `theme.json`. A wrapper directory around
the theme is not accepted. Unix-host entries must be regular files/directories
(or have unspecified type); symlinks and other special types are rejected.
Extraction also enforces containment using the host filesystem's path rules.

All included non-manifest files must have lowercase extensions `.png`, `.jpg`,
`.jpeg`, `.webp`, `.woff2`, `.ogg`, `.mp3` or `.wav` and pass the engine's existing
format/header and image-dimension checks. No uploaded module/renderer code,
HTML, SVG, nested ZIP or other file type is allowed. This is not a general-purpose
ZIP extraction or a complete media decoder.

| Public limit | Value enforced by the importer |
| --- | --- |
| `MAX_THEME_ARCHIVE_BYTES` | 10 MiB; archive must also be at least 22 bytes |
| `MAX_THEME_EXTRACTED_BYTES` | 40 MiB across file entries, including the manifest |
| `MAX_THEME_ARCHIVE_ENTRIES` | 256, including directory entries |
| `MAX_THEME_MANIFEST_BYTES` | 256 KiB |
| `MAX_THEME_PATH_BYTES` | 512 UTF-8 bytes per ZIP name (schema string limit described above) |
| `MAX_THEME_IMAGE_EDGE` | 4096 pixels per edge |
| `MAX_THEME_IMAGE_PIXELS` | 32,000,000 image pixels across included assets |

ZIP safety/CRC, media checks, registered-code/engine compatibility, staging,
promotion, registry transactions and rollback remain in the engine. The shared
API is not an installer and does not accept executable code. The isolated
`tests/theme-package-contract.test.ts` consumer builds a ZIP using npm-packed
public dependencies and sends that exact ZIP through the real importer; it does
not implement or verify the unavailable companion export/setup tool.

### Setup and generated-source policy

Setup tooling must suggest credits found in existing manifest/package metadata
or recognizable Project/Author comments, identify their sources, and ask the
developer to confirm or replace them before writing `theme.json`. Conflicting
names must be shown as choices; never silently pick one or infer public authorship
from private account, Git identity or machine configuration.

Generated source headers must use the confirmed Project and Author plus a
**file-specific Description**. Course is optional. Use `/* ... */` for Java
and JavaScript/TypeScript, `<!-- ... -->` for HTML, and `#` lines for Python.
JSON stays comment-free. The header template adds no copyright or SPDX lines.
Preserve existing contributor credits, asset source/license attribution and
unrelated comments; do not replace prior authorship with the confirmed public
theme credit. Preserve shebangs, encoding declarations and other language
preambles; escape or reject embedded comment terminators before generating source.

**Access limit:** This engine checkout has no setup, ZIP export or source-header
generator. The companion local checkout was unavailable. GitHub `main` contains
only README; inspected `001-theme-development` contains planning documents and
`templates/theme/` as a documented skeleton, not runnable tooling. Setup,
export, header-generation implementation/tests and companion instruction edits
remain blocked in `specs/002-theme-credits/tasks.md`. Do not treat the policy above
as executed functionality or create a duplicate workflow to bypass missing access.

## Extension points and compatibility

Import `@multiplayer-game/theme-sdk` for browser/runtime module, skin, capability,
map and host contracts; use its Node-only `/package` entry for handoff tooling.
The default package is the working end-to-end example:

- A `GameModuleFactory` declares its module ID, version, and state schema, validates
  settings, and creates isolated mutable state from the supplied scoped context,
  frozen roster, and seed. Validate module-specific inputs and implement presence,
  snapshots, results, and disposal. Do not write accounts, membership, or persisted
  results from module code.
- A `SkinFactory` declares the exact module and state schemas it accepts. Its
  `mount(host, assets)` returns one independent presenter. Use only host slots,
  input dispatch, camera publication, asset services, and safe navigation callbacks;
  remove listeners, scheduled work, and DOM on `dispose`.
- The fixture module preserves the public snapshot schema while making nearby
  enemies flee rather than pursue. Its replacement skin uses a different HUD and
  host-dispatched directional input. It demonstrates that a gameplay/presentation
  override does not need edits to engine runtime code.

For timed phases, import `Countdown` from the public SDK and create
`new Countdown(context.clock, durationSeconds)` when the phase starts. Read
`remainingSeconds` for snapshots and check `expired` from the module's `step`;
the helper does not schedule callbacks or decide gameplay outcomes. The default
progression uses a hidden no-kill timer: `noKillTimeoutSeconds` is positive,
finite, at most 3600 seconds, and defaults to 60 in host/API settings (including
legacy settings that omit it). Start fresh on each wave and reset only after
a confirmed enemy kill by any player. Movement, misses, nonlethal damage,
death/respawn and reconnect do not reset it. No countdown runs in intermission;
its separate five-second next-level countdown remains visible.
Other modules can retain a fixed wave deadline by creating Countdown once at
wave start and not replacing it on kills. The public Countdown API and exported
`calculateWaveDurationSeconds` fixed-budget helper remain available unchanged.
Core still validates the
complete phase/current level and saves full standings atomically, including
module-ended matches below the configured maximum. Default snapshots omit
`waveRemainingSeconds`; the skin tolerates legacy optional fields without
displaying them. Expiry requests the existing `wave-timeout` completion once,
before further combat/respawn. Saved results retain optional `completionReason`
and show "Wave ended: no kills for a while." alongside final standings for both
roles and on reload. Existing results without a reason retain their old display.

Dots and Squares reads `npcMovementSpeed` from the public session settings:
finite 0-180 world units/second, including fractions, default 67.5. This is a
playtesting default of 75% of the former 90 units/second. Direct pursuit and
navigation use the same travel budget (speed multiplied by step seconds);
32 world units equal one navigation cell. Zero stops travel, but NPCs can still
turn and fire at a clear, uncrowded target. NPC contact never causes damage.
The host exposes "NPC movement speed" on create/edit; values lock on start.
The additive v1 schema supplies 67.5 for older rooms/results that omit the field.

`npcDetectionRange` is a separate finite 0-700 world-unit setting, default 512,
matching the previous fixed attraction distance. The default theme acquires living
targets only within this radius and still uses bounded spatial queries. Zero disables
automatic engagement and awareness bias. The host exposes it on create/edit; values lock on start, and the
additive v1 schema supplies 512 for older rooms/results that omit it.

Explore is the default state of every mobile NPC on every wave. NPCs without an
engagement slot explore at half their configured speed (33.75 world units/second
at the default), including inside engagement range. The earlier 10x playtest
increase to 337.5 was reverted. Attack approach uses the configured speed
independently (67.5 units/second by default, twice Explore), not the Explore multiplier.
On each wave's first
simulation step every NPC picks a destination and starts moving immediately,
steering directly toward it (with collision-checked axis fallbacks) until its
navigation path arrives. Destinations use the session's seeded RNG to sample at
most 8 clear cell centers around half the map's shorter side (1024 units in the
2048-unit Fixed arena; 256 in a 768x512 map). Seeded samples use 90-110% of that
target before snapping to cell centers; overly clipped candidates below 75% are
discarded. Prefer regions the NPC has never visited, then least recently visited,
then farthest from its spawn. Visit regions are at most 256 units wide, scaled to
one eighth of the shorter side on smaller maps (minimum one 32-unit cell).
On arrival it pauses 6-12 ticks (0.2-0.4 seconds) and chooses another. Exploring
and pursuit share the existing 8 requests/tick, 64 pending requests and engine
search/node budgets. Rejected requests retry on the 15-tick repath interval while
the NPC keeps steering. Unreachable/limited paths, 30 ticks without progress or
no clear candidate halve the next destination's target down to one cell. This
finds closer reachable legs without adding synchronous searches or increasing
navigation budgets. Arrival and pursuit transitions restore the full map-scaled
target. Failures report `default.npc_explore.*` metrics.

Awareness is wider than engagement: three times `npcDetectionRange` (1536 units
by default) biases destinations around the nearest living player's action area,
clamped toward the interior quarter-band. Seeded offsets of 6-25% of the shorter
map side, region novelty and per-NPC home distance spread destinations rather
than sending the wave to one point. The same bounded path service validates
routes; failed searches shorten both the focus leg and sampling radius.
Outside awareness the map-spanning/inward Explore policy above is unchanged.
Spawn quotas, player clearance, reachable cells and quadrant distribution are unchanged.

Each living player has **two sticky engagement slots**. Existing in-range
engagements retain their slots, even if another NPC or player becomes closer.
Unassigned NPC/player pairs are admitted by distance (stable ID tie-breaks), with
at most one target per NPC and two attackers independently per player. Death,
removal or loss of detection range frees a slot for the next eligible NPC on the
next simulation step. Denied NPCs keep exploring and never fire. Losing a target discards pursuit waypoints and resumes
exploration on the same step. Pending stale
results are drained but never followed. Detection range 0 allows exploration but
never acquires a player, including at the exact same position. Speed 0 remains
stationary in either mode.

Slot holders stop advancing with a clear shot within 384 units, turn independently
of movement at up to 3 pi radians/second, and fire when aligned within 0.1 radians.
They retreat inside 96 units or when another NPC crowds within 32 units, keeping
their facing toward the player even while backing away. Blocked shots trigger
bounded navigation around terrain; valid routes are retained until exhausted or
stalled rather than repeatedly restarting at their first waypoint.
The front marker is a 6-unit square attached to the rotating 16-unit square body.
Every enemy body, attached facing square and radar marker uses the same reserved
color, `#ed6b61`. The shared 32-player palette excludes the red hue sector
(player hues are 40-320 degrees) and orders hues widely apart for early roster
slots. Authoritative colors belong to frozen roster slots and survive death,
respawn, disconnect and rejoin. The skin uses one resolved account-to-color map
for bodies, facing dots, radar markers and the radar anchor, for either role.
Older snapshots with missing, unsupported, duplicate or reserved player colors
receive distinct unused palette entries in account-ID order; frozen-roster
fallback allocation is identical on reorder and remount/rejoin. No generic
shared player-color fallback can consume the enemy color.

NPC projectiles are matching 6-unit squares, travel at 300 units/second, deal 10
damage, and fire at most once per 30 ticks (one second). They expire after 60 ticks,
hit living players only, and use the shared 1000-projectile ceiling. Swept,
substepped collision uses a conservative circumscribed circle for NPC squares;
thin walls block both shot eligibility and projectiles in flight. Player weapons
and confirmed-kill scoring/reset behavior are unchanged. Legacy contact capability
exports remain source-compatible but are never executed. Optional NPC facing/target/
fire-readiness and projectile `ownerNpcId` fields are additive default-theme v4
snapshot data; the skin tolerates older snapshots without them.

`node tests\browser\default-game.mjs --npc-ranged` runs the focused ordinary-spawn
solo Fixed scenario using a disposable local database and visible Chrome.
It retains gameplay defaults, records actual viewport/DPR, 30 seconds of idle
positions, first encounter against the 60-second timeout, one-second travel,
engagement counts, screenshots of turning/firing and an SVG track map. A final
keyboard-only approach attempts physical contact without staging entities.
Its report explicitly marks contact untested if that approach cannot reach an NPC.
Set the existing `BROWSER_TEST_ORIGIN`, `BROWSER_DEBUG_URL`,
`BROWSER_TEST_DATABASE_PATH` and `BROWSER_TEST_ARTIFACT_DIR` variables for that
disposable process only; no persistent system variables are required.

`node tests\browser\default-game.mjs --npc-pace-colors` runs a fresh two-player
Fixed match plus a spectator following each player. Both players travel to a
shared area through real keyboard input and ordinary navigation. It separately
measures one-second Explore/approach travel, captures visible standoff firing,
checks the per-player two-attacker cap and color stability on rejoin, and samples
actual Canvas pixels for both player colors and the reserved enemy body/front/
radar color in all four views. It uses the same disposable-loopback environment
variables and artifact directory as the solo ranged check, without entity staging
or gameplay-default overrides.

Distant radar markers are clamped to the radar rim, so their angular changes can
look small, and the normal follow-camera hides offscreen NPC bodies. The skin
focuses the arena once when a player view first receives a snapshot (entry or
rejoin), unless another control already has focus, so movement keys work without
a click; Tab then leaves the arena normally. For a local browser check, run
`node tests\browser\default-game.mjs --npc-roaming` with the existing loopback
Chrome setup, a disposable `BROWSER_TEST_DATABASE_PATH`, and
`BROWSER_TEST_ARTIFACT_DIR` (optionally `BROWSER_TEST_SEED` and
`BROWSER_TEST_NPC_IDLE_SECONDS`, an integer from 30 to 60; default 30). Without
staging entities or changing defaults it verifies no-click keyboard movement on
entry, an idle per-NPC report (exploring distance, longest stationary interval,
pursuit/in-range ticks, painted squares), Tab focus exit, rejoin focus/movement,
and a 15-second idle observation near the arena center.
Use `node tests\browser\default-game.mjs --npc-explore-routes` for a focused
30-60-second idle route trace without arena keyboard events or the additional
focus/rejoin phases.
This is not evidence that a deployed process has rebuilt/reloaded local changes.

Dots and Squares defaults level-1 NPCs to **50 HP**: two standard, unboosted
25-damage projectile hits kill one. The default 10% health growth yields 55 HP
at level 2; population stays 10 then 12 for one player with 20% count growth.
Host `baseNpcHealth` overrides and saved rooms/results keep their explicit health
values, including the previous 100 default. No saved settings are rewritten.
New default sessions use 50; the API still requires an explicit health setting.
Partial settings passed directly to the default module resolve omitted health
from the current default. Rebuild/restart the local application before using
the changed default; do not assume an already-running build has picked it up.

## Dots and Squares map modes

Hosts now select **Fixed arena** or **Simple Generated** in session settings.
Simple Generated offers **Incremental** (starting density and integer increase per
level, capped at 10) or **Per Level** (comma-separated explicit densities, exactly
one per configured level). All entries are integers 0-10. New generated sessions
default to 3 with zero increase. Each step targets 8 percentage points of solid
coverage: 0 is empty, 3 targets 24%, 10 targets 80%. The denominator is the full
bounded playable arena, including reserved clear routes/spawn zones; whole-cell
targets round down.

Settings without explicit `mapMode` preserve the legacy source-code constant
`DEFAULT_MAP_MODE` in
`themes/default/src/module/maps.ts`: `"fixed"` (the shipped default, **Tile Cluster
Arena**) or `"simple-generated"` (**Simple Generated**). This constant is now the
legacy compatibility path, not a way to enable density for saved sessions.
Change the constant, rebuild with `npm run theme:build`, and restart the local
server before starting new matches. Existing running matches keep their selected
map. No saved settings/results are migrated. Editing unrelated saved settings
retains the "Saved legacy layout" choice; choosing a mode explicitly opts in.
The companion fixture wraps the default module and delegates its map hook.

Fixed now has 16 solid four-tile clusters (64 tiles), with four clusters in each
quadrant, adding cover to the previously sparse outer and inner regions. The
32-unit cells, bounds and spawn positions are unchanged. The radius-14 central
routes at x=1008 and y=1008 remain clear, every walkable grid cell is connected,
and all authored spawns retain their radius plus 64 units of terrain clearance.
The new clusters live in the same map object/collision definition, not a
render-only decoration layer; movement, shots, NPC paths, rendering and radar
all consume that geometry. Legacy Simple Generated still shifts its original four
clusters; its bounded fallback uses the expanded Fixed arena.

Legacy Simple Generated uses the match seed and attempt number to move the four solid
four-tile clusters by up to six 32-unit cells in each direction. The selected
layout is shared for the entire match, including later waves. Every candidate goes
through `loadMap`: the public map schema, collision bounds, all spawn clearances
and player-sized grid connectivity between all spawns are checked. After at most
`MAX_MAP_GENERATION_ATTEMPTS` (4) invalid candidates, the validated Fixed arena is
used. Unexpected generator errors propagate instead of causing a fallback. While a
fallback match is running, the operator metrics include `default.map.fallback`.
The server passes the chosen definition into the default module: the world,
navigation, collision and projectile checks, rendered obstacles and radar
footprints use its geometry. A module running outside this server context can
call `generateMap` directly.

### Reusable density and authoritative transitions

The protocol exports `TerrainDensityScheduleSchema`, `DEFAULT_TERRAIN_DENSITY`
and `resolveTerrainDensity(schedule, level, maxLevels)`; modules decide whether to
consume them. `GameModuleFactory.createInitialMap?` opts into an initial authored
map. Optional `ModuleContext.maps` exposes `prepare({bounds,cellSize,obstacles})`
and `commit(token, replacementEntities)`. Preparation never changes active terrain;
commit validates all entities before replacing geometry and retires old
navigation requests/results. Tokens are scoped to one session and one pending
layout; prepare again supersedes the old token. Modules provide their own terrain,
connectivity, clearance and spawn rules; no game-specific rules live in the engine.

Dots and Squares `generateDensityMap(seed, level, density)` uses a private stream
derived from all three inputs, independent of gameplay RNG. It reserves authored
spawns' radii plus 64-unit terrain clearance, joins them with connected routes,
then grows a seeded connected free region until the solid-area target is met.
Each of the 4096 cells enters the growth frontier at most once; total growth is
bounded to 4096 operations. Solid cells merge into disjoint horizontal rectangle
runs, keeping object/collision/radar counts bounded. Every candidate goes through
the same map loader. If protected clear area prevents the target, the generator
uses the best valid layout rather than a Fixed fallback and sets budgetExhausted.
Unexpected schema/placement errors propagate to the normal session failure path.

Intermission prepares/validates the next map without switching it. At the wave
boundary the module commits safe living-player and retained-pickup placements,
updates simulator/respawn references and places the full next NPC wave. Player
health, points, effects, identity and dead/disconnected timers survive; no
projectiles or obsolete NPC paths survive. Rendering, radar, collision, shots and
navigation use the committed map, with no across-level position interpolation.
Density does not alter Fixed, NPC wandering or other difficulty settings.

`map.terrain` in each generated snapshot and both HUD roles reports requested
density, target and actual coverage plus a safe-route/spawn limitation message.
Operator gauges `default.map.actual_coverage_percent` and
`default.map.target_coverage_percent`, with counters `default.map.prepared` and
`default.map.density_shortfall`, expose the same measured result.

After the existing theme build, reproduce without a running server:

```powershell
@'
import { generateDensityMap } from "@multiplayer-game/default-theme";
const result = generateDensityMap(42, 2, 3); // match seed, level, resolved density
console.log(JSON.stringify(result.terrain));
'@ | node --input-type=module
npm test -- tests\terrain-density.test.ts tests\integration\session-lifecycle.test.ts
```

The public SDK/protocol additions require a reviewed immutable revision for the
external consumer's contract pin. Do not repin to an uncommitted checkout or claim
its existing drift gate passed.

### Legacy layout reproduction

To reproduce a legacy layout, use the same safe-integer match seed, mode, and code
revision. `generateMap` uses the low 32 bits of the seed; the server currently
creates a random seed for each room and has no API to select or disclose it.
For a persistent **local** database, an authorized developer can obtain the session
`id` from the authenticated `GET /api/v1/sessions` response in browser developer
tools, then look up its seed without printing account data:

```powershell
@'
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.env.DATABASE_PATH ?? "./var/game.sqlite", { readOnly: true });
const match = db.prepare("SELECT seed FROM matches WHERE id = ?").get("paste-session-id");
if (!match) throw new Error("Session not found in this database");
console.log("match seed:", match.seed);
db.close();
'@ | node --env-file=.env --input-type=module
```

In-memory databases disappear when their server stops and cannot be queried from
another process. Never copy a production database or credentials for theme work.
After `npm run theme:build`, inspect/revalidate a known seed locally:

```powershell
@'
import { generateMap, loadMap } from "@multiplayer-game/default-theme";
const result = generateMap(42, "simple-generated"); // replace 42 with the recorded seed
loadMap(result.map.definition); // throws if schema, spawns or routes are invalid
console.log(JSON.stringify({ source: result.source, attempts: result.attempts,
  obstacles: result.map.obstacles }, null, 2));
'@ | node --input-type=module
npm test -- tests\maps.test.ts tests\generated-map-integration.test.ts tests\integration\generated-map-runtime.test.ts tests\default-skin.test.ts
```

`source` is `"fixed"`, `"generated"` or `"fallback"`; Fixed reports zero
attempts. The generator's optional third argument supplies a candidate function
for authored experiments and fallback tests; candidate validation and the four
attempt limit still apply. The tests compare same-seed output and different-seed
geometry, force fallback, and check startup, terrain presentation, movement,
projectile blocking, navigation, radar and wave persistence. They do not replace a
real-browser playtest of the generated mode.

### Scattered NPC waves

`themes/default/src/module/npc-spawns.ts` selects placement only; it does not
change map geometry, wave counts/growth, health, movement or detection settings.
Each wave partitions the selected map into a 4-by-4 grid of spawn zones (512-unit
squares on the shipped arenas), shuffles the zones and their eligible cells, then
takes one cell per zone per round. Unsaturated zones therefore differ by at most
one NPC; a small wave visits as many distinct zones as its count allows.

Placement uses a private deterministic stream derived from the low 32 bits of the
match seed and the wave number. It does not consume the shared respawn/pickup RNG.
The same seed, wave, selected geometry, current player positions and code revision
reproduce the same placement. Moving players can exclude different cells in later
waves; wave numbering changes the ordering even when the terrain is unchanged.
The server passes the match seed through the default module into its simulator.
Direct `DefaultEntitySimulator` consumers may supply the seed as the fourth
constructor argument; omitted seeds use zero. No shared SDK or wire schema changed.

An at-most-4096-cell flood fill includes only cells reachable from current living
players via four-neighbor, collision-resolved radius-14 travel. If all avatars are
absent, validated authored player spawns anchor the search so death/disconnection
does not reduce the frozen wave count. Each NPC has radius 8; player centers are
at least 38 units away (14 + 8 + 16 margin). One NPC per 32-unit cell center keeps
NPC centers at least 32 units apart. Radius-14 eligible cells also clear solid
terrain for the smaller NPC. Reachability is not restricted by detection radius;
distant NPCs explore the arena from the first update until they hold a pursuit slot.

**Bounded fallback:** empty/exhausted zones are skipped and remaining reachable
clear zones supply the full requested count. `default.npc_spawn.zone_fallback`
records that redistribution once per affected wave. The search never retries
randomly, changes terrain, relaxes clearance or duplicates cells. If every zone
is exhausted before the full count fits, `default.npc_spawn.insufficient_space`
increments and placement throws with the available/requested count. No partial
NPC batch is added; the existing engine error path fails the session visibly
rather than silently truncating the wave or treating it as cleared.

Run focused checks after `npm run theme:build`:

```powershell
npm test -- tests\npc-spawns.test.ts tests\maps.test.ts tests\generated-map-integration.test.ts tests\default-entities.test.ts tests\integration\gameplay.test.ts tests\integration\session-lifecycle.test.ts tests\radar.test.ts
npm run check
```

For a real local Chrome placement check, use the disposable server/client/profile
procedure below with an unused port set and a fresh database. Set
`BROWSER_TEST_ORIGIN`, `BROWSER_DEBUG_URL`, `BROWSER_TEST_DATABASE_PATH` and optionally
`BROWSER_TEST_SCREENSHOT`, then run:

```powershell
node tests\browser\default-game.mjs --npc-spawns
```

This scenario seeds only its own waiting room to 42, leaves all lobby gameplay
defaults unchanged, and checks 5 NPCs across several zones/all four quadrants,
unchanged selected terrain/health/settings, matching enemy radar positions and
5 actual Canvas radar dot draws. Repeat once with each source map mode, rebuilding
and restarting between modes, then restore Fixed and rebuild. Screenshots and
automated visible-Chrome assertions are local evidence, not human playtesting or
capacity measurements. The separate `--arena-obstacles` fixture now uses the same
disposable-database guard to pin its waiting room to seed 4315, placing its one
NPC near (560,528) for the existing blocked-shot/navigation encounter instead of
assuming a fixed NPC position. It requires `BROWSER_TEST_DATABASE_PATH`; it is not
the scattered placement check. T042 stays open; do not deploy.

### Earlier generated-map walk-around

The focused seed-42 Chrome scenario passed on the diagnostic resume recorded in
`docs/verification.md`, including open/blocked shots, movement blocking, matching
world/radar footprints and the complete walk-around. Earlier attempts failed:
the initial southward aim was outside the canvas and left the player facing east;
a later northward-leg failure was not reproduced on resume, so its cause remains
unknown. The harness now retains each leg's positions, target, authoritative
facing, sent movement vectors and nearby obstacle bounds. Geometry and timeouts
were not changed. This is automated Chrome evidence, not human visual review,
cross-browser or capacity verification. Seed 42 generates on the first attempt;
its northwest cluster begins at (544,448), not Fixed's (384,384).

Use unused loopback ports and a new local database/profile, never an existing
developer or production database. From the repository root, set `DEFAULT_MAP_MODE`
to `"simple-generated"` in `themes/default/src/module/maps.ts`, then run
`npm run build`. Create ignored `var\simple-generated-playtest.env` with:

```dotenv
NODE_ENV=development
HOST=127.0.0.1
PORT=18084
PUBLIC_ORIGIN=http://127.0.0.1:15175
DATABASE_PATH=./var/simple-generated-playtest.sqlite
```

Start the server and client in separate PowerShell terminals at the repository
root (no persistent Windows environment changes):

```powershell
node --env-file=var\simple-generated-playtest.env apps\server\dist\main.js
```

```powershell
node --env-file=var\simple-generated-playtest.env node_modules\vite\bin\vite.js apps\client --config apps\client\vite.config.ts --host 127.0.0.1 --port 15175 --strictPort
```

In another terminal launch a disposable visible Chrome, using a fresh profile
directory:

```powershell
& 'C:\Program Files\Google\Chrome\Application\chrome.exe' "--user-data-dir=$((Join-Path $PWD 'var\simple-generated-chrome'))" --remote-debugging-address=127.0.0.1 --remote-debugging-port=19224 --no-first-run --no-default-browser-check http://127.0.0.1:15175
```

Check `/health/ready` on both ports 18084 and 15175 and `/json/version` on 19224.
Then run:

```powershell
$env:BROWSER_TEST_ORIGIN = 'http://127.0.0.1:15175'
$env:BROWSER_DEBUG_URL = 'http://127.0.0.1:19224'
$env:BROWSER_TEST_DATABASE_PATH = (Resolve-Path var\simple-generated-playtest.sqlite).Path
$env:BROWSER_TEST_SCREENSHOT = Join-Path $PWD 'var\simple-generated-playtest.png'
node tests\browser\default-game.mjs --simple-generated
```

The scenario creates disposable accounts and a one-player Dots and Squares room:
one NPC, 100000 NPC health, NPC movement/detection zero and one level. Before start,
it updates **only that waiting room's seed** to 42 in the disposable database and
reads it back. This is a local test fixture, not a seed-selection session API.
It checks the initial clear (272,272) spawn and exact generated geometry, records
the initial aim's actual facing/movement, then attempts the northern approach
via y=400, x=430. Aim offsets are scaled into the canvas and authoritative facing is
checked before moving. Arrow keys move in screen directions and turn the player;
later mouse movement takes over aiming. Planned axis-aligned route segments are checked against the continuous
swept radius-14 circle, as well as loader walkability at one-unit intervals. Each
leg logs its start/end, target, authoritative facing, observed displacement,
sent movement/aim inputs and nearby obstacle bounds before its endpoint assertion.
The encounter is at
y=464, firing/moving east toward the 32-unit tile at (544,448). A clear-lane shot
above the tile provides a control; the same tile must stop both shots and the
player and have a radar footprint centered at (560,464). The final walk-around
attempt goes north to y=400, east to x=704 and south to y=464, beyond the entire
cluster's east face at x=640 (x=624 would still be inside solid geometry).
A screenshot is saved only after all scenario assertions, including walking
around, pass. The recorded resume ended at approximately (710,464); the north
leg had exactly 14 units of center-to-obstacle clearance (legal tangency).

Afterward close the disposable Chrome and stop only these two terminal services.
Restore `DEFAULT_MAP_MODE` to `"fixed"` and run `npm run build` before normal local
use. Remove only the named disposable env/database (including its WAL/SHM files),
screenshot and profile after those services stop. Do not deploy or mark T042 done.

The definition in `theme.json` binds theme, module, renderer, engine API major,
state schema, settings, and the canonical manifest digest. A compatibility change
must be proposed in this engine repository, versioned, and checked against both
reference themes. Do not copy private engine source or independently redefine SDK
contracts in a consumer.

## Companion themes repository

`scottzastrow/multiplayer-game-themes` is the separate designer/consumer
repository. It owns authored theme source and assets, not the SDK, default reference,
server registration, or production settings. Each theme uses an explicit package
layout such as:

```text
my-theme/
  theme.json
  module/index.ts
  skin/index.ts
  assets/
  engine-contract.lock.json
```

The consumer pins an immutable engine commit/release and the published
`@multiplayer-game/theme-sdk` package in its package lock. Its lock file records the
engine revision and contract paths used to build; do not track a moving branch as
the compatibility definition and do not import `apps/`, `packages/` source paths,
or other private engine internals. Build and test against that pin before proposing
an upgrade. The engine's external-consumer conformance fixture lives in
`tests/contract/external-theme/`, with an exact SDK version and immutable engine
contract pin. `tests/contract/themes.test.ts` copies it outside the checkout, packs
the public SDK/protocol and their Zod dependency, installs those artifacts offline,
then compiles and imports the consumer without workspace aliases or private-path
imports. The fixture uses only public SDK exports and has its own strict tsconfig;
the repository's pinned TypeScript compiler runs the isolated build.

Run the extension checks with:

```powershell
npm test -- tests\contract\themes.test.ts tests\integration\theme-install.test.ts tests\fixture-theme.test.ts tests\integration\fixture-theme.test.ts tests\theme-packages.test.ts tests\integration\theme-admin.test.ts
```

These exercise module isolation, the
reference behavior/HUD replacement, package limits and atomicity, operator roles,
and active revision pins. They are automated contract/API checks, not browser or
deployment evidence.

## Review and handoff

Theme authors submit module/renderer source, manifest, build provenance, and
compatibility evidence to the engine owner for review. The owner checks SDK and
state-schema compatibility, bounded work, server authority, asset declarations,
and renderer lifecycle; then registers reviewed executable code in the server and
client builds and installs or enables the manifest revision as appropriate.
Code changes are not promoted through the public asset upload. A consumer-side
collaboration grant does not grant production, operator, or deployment access.

When a required hook or schema is missing, propose it in
`scottzastrow/multiplayer-game-engine` with compatibility and migration behavior.
Do not resolve contract gaps by copying a modified SDK into the themes repository.
Active sessions retain their exact pinned theme revision and digest while new
sessions use only enabled revisions.
