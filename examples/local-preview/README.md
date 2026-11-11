# Local preview sample

This is a small, editable browser game project. It uses only
`@multiplayer-game/local-preview` and `@multiplayer-game/theme-sdk` package
exports; it does not import from the engine checkout or private client code.

The game module is `src/game.js`, the skin is `src/skin.js`, the map is
`src/map.js`, and settings are in `src/settings.js`. To make each eastward
movement step twice as large, change `SPEED_MULTIPLIER` in `src/game.js` from
`1` to `2`. `npm run verify` proves that this edit changes the simulation output.
Run `npm run dev` to open the playable browser sample. With a local Chrome
DevTools endpoint and that server running, `npm run browser:smoke` checks rendered
movement, stop input and HUD output.

This project is intentionally separate from the existing theme manifest/assets
ZIP. That ZIP does not contain executable game code and cannot install or run
this editable project. The versioned Developer Kit wraps this project and the
built public preview packages separately; see the kit's root README and API
guide. The visual editor remains deferred.

The reference sample uses owner-confirmed Project `Local Preview Sample` and
public Author `Scott Zastrow`, without Course. Preserve existing attribution.
New projects must run the kit's `npm run credits` workflow and confirm their
own public credits before `npm run theme:export -- --output theme-assets.zip`.
The source manifest's placeholder digest is refreshed in the exported ZIP,
not rewritten in source. No media assets are declared initially.
