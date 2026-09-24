#!/bin/sh
set -e

if [ -n "$IRNITU_API_TOKEN" ]; then
  (
    while true; do
      node scripts/export-schedule.js webapp/dist/data || echo "Выгрузка расписания не удалась, повторим позже"
      sleep "${EXPORT_INTERVAL_SEC:-10800}"
    done
  ) &
else
  echo "IRNITU_API_TOKEN не задан: мини-приложение откроется без расписания"
fi

exec node --tls-max-v1.2 src/index.js
