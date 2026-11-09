# Terrain density and transition contract (additive v1)

`mapMode?`: `fixed` or `simple-generated`; absent means the legacy source-selected
mode and same layout for the match. `terrainDensity?` is a strict union:

```json
{"mode":"incremental","startingDensity":3,"increasePerLevel":0}
```

```json
{"mode":"per-level","densities":[0,3,10]}
```

All values are integers 0-10; Per Level has exactly maxLevels entries. Resolve
level L as min(10, startingDensity + increasePerLevel * (L-1)), or densities[L-1].
Explicit Simple Generated with no schedule resolves to 3/0. Fixed ignores the
schedule. Absence is not backfilled when saved records are loaded.

Factory `createInitialMap?` opts into authored initial maps. Context `maps?`
prepares bounds/obstacles/cellSize into a session-local token and commits a token
with a complete replacement entity list. Preparation never changes active
geometry. Commit validates all entities before changing anything; unknown/reused
tokens, invalid geometry, duplicate entities or blocked placement throw. Commit
retires old navigation jobs/results and uses the new geometry for all services.
Modules supply connectivity, clearance, terrain and placement policy; the engine
does not infer these from a theme ID.

Default generated presentation `map.terrain?` contains level, density,
targetCoveragePercent, actualCoveragePercent and budgetExhausted. Percentages
measure solid union area / full bounded interior * 100, excluding no reserved
clear area from the denominator. Target is density * 8; whole-cell targets round
down. Reports and full obstacle geometry travel in the same authoritative
snapshot for players/spectators/reconnect. No separate decorative terrain.

Prepare next layout during intermission; keep current level/map until next wave
begins. Relocate live players to safe roster spawns without changing health,
scores or identity; preserve absent players' death/presence timers and update
their current respawn map. Retire projectiles, reset stale NPC goals, retain
pickup state at safe authored positions. Full NPC wave placement remains bounded
and explicit on insufficient space; no truncation.
