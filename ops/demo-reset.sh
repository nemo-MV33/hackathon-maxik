#!/bin/sh
set -eu
cd /home/yc-user/norfly
exec 9>/run/lock/norfly-backup.lock
flock -n 9 || { echo 'Уже идёт резервное копирование или сброс'; exit 1; }
[ "$(docker inspect -f '{{.State.Running}}' norfly-norfly-1)" = true ]
trap 'docker compose start norfly' EXIT
docker compose stop -t 60 norfly
docker compose run --rm --no-deps -e DEMO_RESET_OFFLINE=1 --entrypoint npm norfly run demo:reset
