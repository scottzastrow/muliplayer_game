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
| baseNpcHealth | 50 | Integer 1–100000 |
| npcHealthGrowthPercent | 10 | Number 0–100 percent per level |
| npcMovementSpeed | 67.5 | Finite number 0–180 world units/second, fractions allowed; 0 keeps NPCs stationary |
| npcDetectionRange | 512 | Finite number 0–700 world units; 0 disables automatic pursuit |
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

One player with the defaults above starts waves 1/2 with exactly 10/12 NPCs.
Default level-1 NPC health is 50, so two unboosted 25-damage projectile hits
kill one NPC. The unchanged 10% health growth gives level 2 NPCs 55 health.
Host health overrides remain authoritative. Existing saved room/result settings
with explicit `baseNpcHealth` (including the former 100 default) retain that value;
they are not migrated or clamped. Newly created default sessions use 50.
The API still requires `baseNpcHealth`; omitting it is invalid, while the
default module's partial-settings preview uses the current default.
Living count decreases as enemies die; no NPC replacement occurs within a wave.
The next full count spawns only after zero living NPCs and the existing
five-second intermission. Wave starting totals remain frozen in the HUD while
the living count falls, regardless of radar filters; this presentation change
does not retune growth, health, speeds, detection or the wave countdown.

Operator defaults: maxSessions=5 (fixed POC cap), maxNpcsPerSession=2000,
maxNpcHealth=1000000, maxProjectilesPerSession=1000, maxPickupsPerSession=100,
maxPathSearchesPerTick=8, maxPathNodesPerSearch=2048. Bounds are configuration ceilings,
not claims of supported performance. Raising them requires a recorded load experiment.
Reject extra projectile/pickup creation at a cap, expose a metric/event, and do not
charge ammo for rejected shots. NPC count is preflighted, not spawn-truncated.

Default module tuning: 2048×2048 world, 32-unit navigation cells, configurable
enemy detection range defaulting to 512 world units, 64-unit safe-spawn margin beyond collision/contact geometry,
player speed 180 units/sec, configurable enemy speed default 67.5 units/sec, 100 player HP, bullet damage 25,
5 shots/sec, contact damage 10 with 1 second player-wide contact cooldown. Spawn
projectiles have bounded lifetime (2 seconds). Health packs restore 25 up to 100;
rapid-fire pickups double fire rate for 10 seconds; weapon pickups equip a three-shot
spread for 10 seconds. Repeated same-effect pickups refresh duration, do not stack.
These are module data, never assumptions in the core engine.

`npcMovementSpeed` is exposed as "NPC movement speed" in host session settings
and accepted by the v1 create/settings API. Dots and Squares applies it equally to
direct pursuit and navigation waypoint movement. World units are map coordinates:
one navigation cell is 32 units, so 67.5 units/sec is 2.25 units per 30 Hz tick.
This playtesting default is 75% of the former 90 units/sec speed. Zero disables
travel, not attraction or contact damage. Omitted fields in older API requests,
stored rooms and saved-result settings resolve to 67.5 without a database migration.
Invalid explicit values are rejected, not replaced by the default. Settings still
freeze on start; theme modules decide how to use this additive v1 setting.

`npcDetectionRange` is exposed as "NPC detection range" in host session settings
and accepted by the v1 create/settings API. Dots and Squares only automatically
targets living players within this world-unit radius; its spatial query remains
within the existing bounded cell-work limit. The setting is finite 0–700, defaults
to the previous fixed 512-unit distance, and zero disables automatic pursuit.
Omitted fields in older requests, rooms and saved-result settings resolve to 512
without a migration; invalid explicit values are rejected. The value freezes on
start and other themes decide how to interpret it.

Provisional Dots and Squares wave tuning is 120 seconds plus 6 seconds per NPC
present at wave start, capped at 360 seconds. Each wave recomputes its budget from
its full starting count, using the unchanged frozen-roster growth formula.
This is module tuning, not a new lobby setting or a change to NPC health/capacity.
The deadline continues during respawns and ends the match with saved standings
on expiry; clearing strictly before expiry follows normal progression.
