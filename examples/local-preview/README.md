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
this editable project. The visual editor and complete developer-kit ZIP remain
deferred.
