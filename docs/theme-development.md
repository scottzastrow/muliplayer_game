# Game Theme Development

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

Import only `@multiplayer-game/theme-sdk` for module, skin, capability, map, and
host contracts. The default package is the working end-to-end example:

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
progression uses provisional `min(360, 120 + 6 * starting NPC count)` wave budgets,
continues timing through respawns, and requests match completion once on expiry.
Other modules may choose a different expiry policy. Core still validates the
complete phase/current level and saves full standings atomically, including
module-ended matches below the configured maximum. The default schema-v4 HUD
uses the additive optional `waveRemainingSeconds` field for both player and
spectator views; existing v4 consumers may ignore it.

Dots and Squares reads `npcMovementSpeed` from the public session settings:
finite 0-180 world units/second, including fractions, default 67.5. This is a
playtesting default of 75% of the former 90 units/second. Direct pursuit and
navigation use the same travel budget (speed multiplied by step seconds);
32 world units equal one navigation cell. Zero stops travel but preserves contact
damage. The host exposes "NPC movement speed" on create/edit; values lock on start.
The additive v1 schema supplies 67.5 for older rooms/results that omit the field.

`npcDetectionRange` is a separate finite 0-700 world-unit setting, default 512,
matching the previous fixed attraction distance. The default theme acquires living
targets only within this radius and still uses bounded spatial queries. Zero disables
automatic pursuit. The host exposes it on create/edit; values lock on start, and the
additive v1 schema supplies 512 for older rooms/results that omit it.

## Dots and Squares map modes

The theme developer selects the source-code constant `DEFAULT_MAP_MODE` in
`themes/default/src/module/maps.ts`: `"fixed"` (the shipped default, **Tile Cluster
Arena**) or `"simple-generated"` (**Simple Generated**). This is trusted theme
configuration, not a lobby setting, environment variable or public session API.
Change the constant, rebuild with `npm run theme:build`, and restart the local
server before starting new matches. Existing running matches keep their selected
map. The companion fixture also wraps the default module and uses this map.

Simple Generated uses the match seed and attempt number to move the four solid
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

To reproduce a layout, use the same safe-integer match seed, mode, and code
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
distant NPCs remain idle until a player approaches, as before.

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
defaults unchanged, and checks 10 NPCs across several zones/all four quadrants,
unchanged selected terrain/health/settings, matching enemy radar positions and
10 actual Canvas radar dot draws. Repeat once with each source map mode, rebuilding
and restarting between modes, then restore Fixed and rebuild. Screenshots and
automated visible-Chrome assertions are local evidence, not human playtesting or
capacity measurements. The separate `--arena-obstacles` fixture now uses the same
disposable-database guard to pin its waiting room to seed 1011, placing its one
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
the original aim's actual facing/movement, then attempts the northern approach
via y=400, x=430. Aim offsets are scaled into the canvas, authoritative facing is
checked before moving, and ArrowUp means forward relative to that facing, not
world north. Planned axis-aligned route segments are checked against the continuous
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
