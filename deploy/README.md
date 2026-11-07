# Deployment examples (not a deployed game)

T040 supplies reviewable Ubuntu/systemd/Nginx examples and an operator runbook.
It does not authorize SSH, provisioning, firewall/DNS changes or live installation.
The [hosting baseline](../docs/hosting.md) records owner-supplied Nginx/Certbot
setup, not a running game or independently verified HTTPS/WSS service. Preserve
the existing site, attached static IP, domain and renewal configuration. Do not
overwrite the Certbot-managed site with this example.

The commands below are **operator-only Ubuntu instructions**, not PowerShell
commands and not actions executed by this task. Review paths, existing services
and permissions on an authorized target first. Native `nginx -t`,
`systemd-analyze verify`, HTTPS/WSS checks and restore drills are deployment gates;
local automated consistency checks cannot replace them.

## Release and private state

Use an immutable engine revision built with Node 24 and npm 11 on Linux compatible
with the target (better-sqlite3 is native). Run `npm ci`, `npm run build` and the
appropriate verification before publishing a release. Do not copy Windows
`node_modules` to Ubuntu. The release must contain:

- `apps/server/dist/`, `dist/client/`, compiled `packages/*/dist/` and both themes.
- Workspace manifests and working `node_modules` workspace links, including runtime
  dependencies. Keep workspace directories at their original relative locations.
- `apps/server/src/storage/migrations/*.sql`: startup currently reads SQL migrations
  from this path relative to the working directory, not from the server dist folder.

Install a reviewed release under `/opt/multiplayer-game/releases/<revision>/` and
point `/opt/multiplayer-game/current` at it. Release directories/code are root-owned,
not writable by the service account, and readable/traversable by Nginx for
`dist/client`. Never publish the repository root as a document root. Do not bundle
`.env`, databases, uploads, generated reports or production credentials.
`ExecStart` uses `/usr/bin/node` directly; verify that this is Node 24 on the target.
Do not use `npm start` here: its local `--env-file=.env` is not the production loader.

For an authorized installation, create the service identity only if absent:

```sh
getent passwd multiplayer-game
# If absent, review and run:
sudo useradd --system --user-group --home-dir /var/lib/multiplayer-game --no-create-home --shell /usr/sbin/nologin multiplayer-game
sudo install -d -o root -g root -m 0700 /etc/multiplayer-game
sudo install -d -o multiplayer-game -g multiplayer-game -m 0700 /var/lib/multiplayer-game
sudo install -d -o root -g root -m 0700 /var/backups/multiplayer-game
sudoedit /etc/multiplayer-game/game.env
sudo chown root:root /etc/multiplayer-game/game.env
sudo chmod 0600 /etc/multiplayer-game/game.env
```

The operator-managed environment file uses literal `KEY=value` entries:

```dotenv
NODE_ENV=production
HOST=127.0.0.1
PORT=8082
PUBLIC_ORIGIN=https://multiplayer-game.vergotek.com
DATABASE_PATH=/var/lib/multiplayer-game/game.sqlite
```

systemd reads `EnvironmentFile=/etc/multiplayer-game/game.env` as root and passes
values to the unprivileged process; it need not grant the process direct file
access. Do not use shell commands, `export` or interpolated secrets in that file.
SQLite/WAL/SHM and content-addressed themes live under the private state directory,
with service umask 0077. The service may write only that state and its private temp
directory; Nginx must not read the database or state. Do not add a public alias to
`/var/lib/multiplayer-game`; asset installation alone does not authorize serving
arbitrary uploaded files. Backup files contain credentials and must also be private.

## systemd lifecycle and readiness

Review `game.service` and copy it to `/etc/systemd/system/game.service` only after
authorization. Review the service user, release symlink, Node path and private state
first. `Type=simple` only indicates process startup: it does **not** mean ready.
Startup opens SQLite, applies migrations, reconciles stale waiting/running matches
as Interrupted, then listens. Graceful SIGTERM marks active simulations Interrupted
and closes sockets/SQLite; waiting metadata is reconciled on the next startup.
Restarts do not resume in-memory matches or clear persisted accounts/results.

```sh
sudo systemd-analyze verify /etc/systemd/system/game.service
sudo systemctl daemon-reload
sudo systemctl enable --now game.service
sudo systemctl status game.service --no-pager
curl --fail --silent --show-error http://127.0.0.1:8082/health/live
curl --fail --silent --show-error http://127.0.0.1:8082/health/ready
sudo journalctl -u game.service -n 100 --no-pager
```

Require readiness `200 {"status":"ok"}` after every deployment/restart/restore.
Readiness is 503 during startup/shutdown or a failed database probe; liveness alone
is not sufficient. On failure inspect the journal; do not announce success or
repeatedly restart a bad release. `Restart=on-failure`, five-second backoff and a
five-start/minute limit bound restart loops. SIGTERM has a 60-second shutdown
budget; investigate any forced termination. Restarting interrupts active matches,
so arrange a maintenance window. Update/rollback the release symlink only while
the service is stopped, and do not assume older code can read a migrated schema.
Take a backup before upgrades; coordinate compatible code and database rollback.

## Nginx, existing TLS and co-hosted services

`nginx.conf` is an example site included from Ubuntu's `http` context. Its uniquely
named Upgrade map avoids a generic variable collision. Merge the API, health and
WebSocket locations into the existing
`/etc/nginx/sites-available/multiplayer-game`; retain its Certbot directives,
certificate paths and enabled-site symlink. The documented certificate directory
is `/etc/letsencrypt/live/multiplayer-game.vergotek.com/`. Do not run certificate
issuance or replace keys to apply these examples. Preserve the current ACME method
and redirect behavior; renewal remains an operator responsibility.

Nginx serves only `/opt/multiplayer-game/current/dist/client`, forwards `/api/`,
`/health/` and exact `/ws` to loopback 8082 without rewriting their paths, and
preserves the original Origin and cookies. Never substitute a trusted Origin for
an untrusted request. HTTP/1.1 Upgrade/Connection headers enable WSS. A 75-second
idle timeout exceeds the server's 15-second heartbeat. The 10 MiB request limit
matches ZIP admission; the application enforces smaller route/message limits.
API/WS proxy caching is disabled; private cookies/authorization/body data must
never be added to Nginx logs. API/WS access logging is disabled in this example.

Do not expose 8082 in Lightsail/UFW or bind Node to a public interface. Before using
the port, inspect existing listeners and services (`sudo ss -ltnp`); do not stop
another service to free it. If co-hosted applications exist, preserve their sites,
ports, certificates and service users. Apply changes to this named site/unit only,
not a global Nginx replacement. CPU/RSS/event-loop capacity includes co-hosted work;
measure it before choosing resource limits or increasing players. Do not assign
arbitrary MemoryMax/CPUQuota values without measurement.

After authorized edits:

```sh
sudo nginx -t
# Reload only if the preceding validation succeeds.
sudo systemctl reload nginx
curl --fail --silent --show-error https://multiplayer-game.vergotek.com/health/ready
sudo certbot renew --dry-run
```

Review Nginx validation output before reloading; if it fails, leave the existing
service/configuration in place. Verify redirect, client page/assets and a real
authenticated browser WSS connection through the existing public origin. Verify
regular accounts get 403 for `/api/v1/admin/metrics` and operators get no-store JSON.
Do not put an auth token in a URL or paste cookies into logs or documentation.
Do not claim these checks were performed merely because commands are listed.

## Consistent SQLite and theme backup

Use a maintenance window and a **stopped** game service for a coordinated backup
of SQLite and its content-addressed theme assets. No other process/CLI may write
the database or install themes during backup. Keep the release revision and
schema-migration versions with the backup (no environment secrets in metadata).
The following is a root-shell example with `set -eu`; choose a new backup name.
Run the stop/check first; a failed assertion must halt the procedure:

```sh
sudo systemctl stop game.service
sudo systemctl is-active game.service
# Expected: inactive. Do not proceed while active/activating/deactivating.
sudo systemctl show game.service -p MainPID --value
# Expected: 0. Confirm no other database writers before the root-shell steps below.
```

In an authorized root shell:

```sh
set -eu
umask 077
source_dir=/var/lib/multiplayer-game
backup_dir=/var/backups/multiplayer-game/$(date -u +%Y%m%dT%H%M%SZ)
test -f "$source_dir/game.sqlite"
test "$(systemctl show game.service -p MainPID --value)" = 0
test "$(systemctl show game.service -p ActiveState --value)" = inactive
mkdir -m 0700 "$backup_dir"
# Checkpoint reports busy|log|checkpointed; require an unblocked TRUNCATE.
checkpoint=$(sqlite3 -bail -cmd '.timeout 5000' "$source_dir/game.sqlite" 'PRAGMA wal_checkpoint(TRUNCATE);')
test "$checkpoint" = '0|0|0'
sqlite3 -bail "$source_dir/game.sqlite" ".backup '$backup_dir/game.sqlite'"
if test -d "$source_dir/themes"; then
    cp -a "$source_dir/themes" "$backup_dir/themes"
fi
test "$(sqlite3 -readonly -bail "$backup_dir/game.sqlite" 'PRAGMA integrity_check;')" = ok
test -z "$(sqlite3 -readonly -bail "$backup_dir/game.sqlite" 'PRAGMA foreign_key_check;')"
readlink -f /opt/multiplayer-game/current > "$backup_dir/release.txt"
sqlite3 -readonly -bail "$backup_dir/game.sqlite" 'SELECT version,name FROM schema_migrations ORDER BY version;' > "$backup_dir/migrations.txt"
chmod -R go-rwx "$backup_dir"
```

Keep the service stopped until all checks succeed and database plus themes are
present. On failure retain the partial backup for diagnosis, leave the service
stopped and report the error. Never copy just a **live** `game.sqlite` while omitting
its WAL. SQLite's `.backup` API includes committed WAL contents; checkpointing alone
does not make a concurrently copied file or asset tree consistent. This stopped
procedure coordinates both. Do not delete WAL/SHM manually on a live database.
After success, restart and require readiness. Copy/encrypt verified backups to
operator-controlled storage with restricted access and an approved retention
policy; keep them outside both repositories and the Nginx root.

## Restore without stale WAL or lost rollback data

Perform a restore drill on an isolated target before relying on backups. Stop the
game and all writers, confirm MainPID 0/inactive as above, then validate the chosen
backup's integrity/foreign keys again. Review its recorded release/migrations and
theme directories against a compatible release. Installed `asset_root` values are
absolute: restore to `/var/lib/multiplayer-game` on the target, or perform an
explicit reviewed path migration, not a silent relocation.

In an authorized root shell, after the service is stopped:

```sh
set -eu
umask 077
# Replace this literal with the selected, verified backup directory.
backup_dir=/var/backups/multiplayer-game/SELECTED_BACKUP
state_dir=/var/lib/multiplayer-game
test -f "$backup_dir/game.sqlite"
test "$(systemctl show game.service -p MainPID --value)" = 0
test "$(systemctl show game.service -p ActiveState --value)" = inactive
test "$(sqlite3 -readonly -bail "$backup_dir/game.sqlite" 'PRAGMA integrity_check;')" = ok
test -z "$(sqlite3 -readonly -bail "$backup_dir/game.sqlite" 'PRAGMA foreign_key_check;')"
restore_dir=$(mktemp -d /var/lib/multiplayer-game-restore.XXXXXX)
cp "$backup_dir/game.sqlite" "$restore_dir/game.sqlite"
if test -d "$backup_dir/themes"; then
    cp -a "$backup_dir/themes" "$restore_dir/themes"
fi
chown -R multiplayer-game:multiplayer-game "$restore_dir"
chmod -R go-rwx "$restore_dir"
# Retain the entire old tree, including its WAL/SHM, outside the replacement.
rollback_dir=/var/lib/multiplayer-game-before-restore-$(date -u +%Y%m%dT%H%M%SZ)
test ! -e "$rollback_dir"
mv "$state_dir" "$rollback_dir"
mv "$restore_dir" "$state_dir"
```

Do not merge the restored database with old `game.sqlite-wal`/`-shm`; moving the
entire previous tree aside avoids stale sidecar replay and preserves rollback.
If promotion fails, leave the service stopped and restore the previous tree from
the named rollback directory. Do not recursively delete rollback data. Once a
compatible release and restored permissions are confirmed, start `game.service`,
check readiness/journal, and verify account login, saved results and installed
theme pins. Active matches from the backup become Interrupted at startup, not
resumed. Record the restore outcome before applying retention cleanup.

## Local evidence boundary

`npm test -- tests\deployment.test.ts` checks the examples against startup paths,
private-state/Origin/Upgrade/TLS requirements and backup/runbook safeguards. A
temporary SQLite fixture exercises the online backup API used by `.backup`,
integrity/foreign-key checks and restoration without stale sidecars. It does not
run systemd, Nginx, Certbot, SSH, or commands on the documented host. T041 operational
restart/failure/shutdown verification and T042 separate-host capacity work remain
separate tasks.
