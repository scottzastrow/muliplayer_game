# Hosting and Configuration Baseline

Recorded 2026-11-06 from the owner's terminal output and setup conversation; no
SSH access or independent external HTTP check was performed by this document update.

| Item | Current known value/state |
| --- | --- |
| Dedicated Lightsail instance | multiplayer-game |
| Public static IPv4 supplied by owner | 3.132.50.9 |
| Domain | multiplayer-game.vergotek.com |
| DNS | Bluehost A record resolves to 3.132.50.9 in supplied getent/dig output |
| Operating system | Ubuntu; 24.04 LTS selected in setup guidance |
| Nginx | active in supplied terminal output |
| Firewall | HTTP 80, HTTPS 443, SSH 22 shown enabled in supplied console screenshot |
| Site config | /etc/nginx/sites-available/multiplayer-game, enabled via symlink |
| Placeholder document root | /var/www/multiplayer-game |
| Certificate | Certbot deployment succeeded; /etc/letsencrypt/live/multiplayer-game.vergotek.com/ |
| Certificate expiry in issuance output | 2027-02-04 |
| Renewal | certbot timer installed; simulated renewal succeeded |
| Game runtime / Node 24 / systemd game service | Not yet installed or verified |
| HTTP redirect/HTTPS status checks | Commands requested; outputs not supplied |
| Capacity | Not measured; no supported player-count claim |

The private address 172.26.9.25 is not the DNS target. Keep the attached static IP.
Only use this host for deployment when the engine is implemented and validated.

## Environment files

Local: copy `.env.example` to `.env`. The application must load it in development
and documented local production runs; no persistent Windows variables required.
Production: operator creates `/etc/multiplayer-game/game.env`, root-owned with
restricted permissions, and configures systemd EnvironmentFile to read it. The service
may receive values through systemd without reading the protected file directly.
Use plain KEY=value syntax, with no shell commands or variable interpolation.
Keep production data under `/var/lib/multiplayer-game/` and out of the release checkout.

Proposed production values (runtime still pending):

```dotenv
NODE_ENV=production
HOST=127.0.0.1
PORT=8082
PUBLIC_ORIGIN=https://multiplayer-game.vergotek.com
DATABASE_PATH=/var/lib/multiplayer-game/game.sqlite
```

Do not put private keys, production tokens or database contents in either repository.
The themes developer needs local SDK/preview access only. Public DNS/IP/domain are
configuration metadata, not credentials. `.env.example` values are safe local defaults,
not a live deployment configuration. Designer does not need a production `.env`.
