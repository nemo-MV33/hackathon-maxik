#!/bin/sh
# Host root job. Stops application AND exporter while producing one encrypted archive.
set -eu
umask 077
cd /home/yc-user/norfly
exec 9>/run/lock/norfly-backup.lock
flock -n 9 || exit 0
work=$(mktemp -d /var/tmp/norfly-backup.XXXXXX)
stopped=0
cleanup() {
  result=$?
  trap - EXIT INT TERM
  if [ "$stopped" = 1 ]; then docker compose start norfly || result=1; fi
  rm -rf "$work"
  if [ "$result" != 0 ]; then
    mkdir -p /var/lib/norfly-backup
    docker compose run --rm --no-deps -v /var/lib/norfly-backup:/backup --entrypoint node norfly --tls-max-v1.2 scripts/backup.js alert || true
  fi
  exit "$result"
}
trap cleanup EXIT
trap 'exit 1' INT TERM
[ "$(docker inspect -f '{{.State.Running}}' norfly-norfly-1)" = true ]
# Inspect the actual attached volumes; never create a replacement empty volume on a typo.
data=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/app/data"}}{{.Name}}{{end}}{{end}}' norfly-norfly-1)
attachments=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/app/attachments"}}{{.Name}}{{end}}{{end}}' norfly-norfly-1)
schedule=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/app/webapp/dist/data"}}{{.Name}}{{end}}{{end}}' norfly-norfly-1)
[ -n "$data" ] && [ -n "$attachments" ] && [ -n "$schedule" ]
mkdir -p /var/lib/norfly-backup
stopped=1
docker compose stop -t 60 norfly
[ "$(docker inspect -f '{{.State.Running}}' norfly-norfly-1)" = false ]
# Only helper process runs. Its entrypoint never starts bot or schedule exporter.
docker compose run --rm --no-deps -v "$data:/snapshot/data:ro" -v "$attachments:/snapshot/attachments:ro" -v "$schedule:/snapshot/schedule:ro" -v "$work:/work" -v /etc/norfly-backup:/backup-secrets:ro --entrypoint node norfly scripts/backup.js snapshot
docker compose start norfly
stopped=0
# Application is already running during network transfer and read-back verification.
docker compose run --rm --no-deps -v "$work:/work" -v /etc/norfly-backup:/backup-secrets:ro -v /var/lib/norfly-backup:/backup --entrypoint node norfly scripts/backup.js upload
