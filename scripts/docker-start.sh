#!/bin/sh
set -e

if [ -n "$IRNITU_API_TOKEN" ]; then
  (
    last_full=0
    while true; do
      now=$(date +%s)
      if [ $((now - last_full)) -ge "${EXPORT_FULL_INTERVAL_SEC:-604800}" ]; then
        EXPORT_MODE=recent node scripts/export-schedule.js webapp/dist/data \
          || echo "Выгрузка ближайших недель не удалась, повторим позже"
        EXPORT_MODE=full node scripts/export-schedule.js webapp/dist/data && last_full=$(date +%s) \
          || echo "Выгрузка расписания на семестр не удалась, повторим позже"
      else
        EXPORT_MODE=recent node scripts/export-schedule.js webapp/dist/data \
          || echo "Выгрузка расписания не удалась, повторим позже"
      fi
      sleep "${EXPORT_INTERVAL_SEC:-10800}"
    done
  ) &
else
  echo "IRNITU_API_TOKEN не задан: мини-приложение откроется без расписания"
fi

exec node --tls-max-v1.2 src/index.js
