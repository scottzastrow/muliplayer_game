# Settings Contract v1

All numbers must be finite; reject unknown keys, fractions for integer fields, NaN,
out-of-range values, uninstalled themes, incompatible revisions and edits after start.
The server is authoritative. Values below are editable POC design defaults except
explicitly confirmed 10:1, five-second delay and five-session cap.

| Key | Default | Validation / unit |
| --- | --- | --- |
| maxPlayers | 4 | Integer 1–32 |
| maxSpectators | 8 | Integer 0–64 |
| initialNpcsPerPlayer | 10 | Integer 1–100 |
| npcPopulationGrowthPercent | 20 | Number 0–100 percent per level |
| baseNpcHealth | 100 | Integer 1–100000 |
| npcHealthGrowthPercent | 10 | Number 0–100 percent per level |
| respawnDelaySeconds | 5 | Number 0–60 seconds |
| maxLevels | 5 | Integer 1–100 |
| themeRevision | default@1.0.0 | Installed/enabled exact immutable revision |

Freeze participant count P at match start. Level L starts at 1. Let R be initial
NPCs/player, G population percentage/100, H base health, K health percentage/100.
Desired enemies = ceil(P × R × (1+G)^(L−1)); health = ceil(H × (1+K)^(L−1)).
Use overflow-safe/logarithmic preflight validation over all configured levels.
Reject start/settings whose requested NPCs or health exceed ceilings; show a useful
maximum instead of silently truncating difficulty. On any unexpected runtime ceiling
breach fail the session explicitly; never falsely declare a level cleared.

Operator defaults: maxSessions=5 (fixed POC cap), maxNpcsPerSession=2000,
maxNpcHealth=1000000, maxProjectilesPerSession=1000, maxPickupsPerSession=100,
maxPathSearchesPerTick=8, maxPathNodesPerSearch=2048. Bounds are configuration ceilings,
not claims of supported performance. Raising them requires a recorded load experiment.
Reject extra projectile/pickup creation at a cap, expose a metric/event, and do not
charge ammo for rejected shots. NPC count is preflighted, not spawn-truncated.

Default module tuning: 2048×2048 world, 32-unit navigation cells, 512-unit enemy
attraction radius, 64-unit safe-spawn margin beyond collision/contact geometry,
player speed 180 units/sec, enemy speed 90, 100 player HP, bullet damage 25,
5 shots/sec, contact damage 10 with 1 second player-wide contact cooldown. Spawn
projectiles have bounded lifetime (2 seconds). Health packs restore 25 up to 100;
rapid-fire pickups double fire rate for 10 seconds; weapon pickups equip a three-shot
spread for 10 seconds. Repeated same-effect pickups refresh duration, do not stack.
These are module data, never assumptions in the core engine.

Provisional Dots and Squares wave tuning is 60 seconds plus 3 seconds per NPC
present at wave start, capped at 300 seconds. Each wave recomputes its budget from
its full starting count, using the unchanged frozen-roster growth formula.
This is module tuning, not a new lobby setting or a change to NPC health/capacity.
The deadline continues during respawns and ends the match with saved standings
on expiry; clearing strictly before expiry follows normal progression.
