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
