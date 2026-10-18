#!/bin/sh
set -e

  (
    # Перезапуск приложения не должен заново выгружать весь семестр.
    last_full=$(node --input-type=module -e '
      import { readFile } from "node:fs/promises";
      try {
        const meta = JSON.parse(await readFile("webapp/dist/data/meta.json", "utf8"));
        console.log(Math.floor(Date.parse(meta.fullUpdatedAt) / 1000) || 0);
      } catch { console.log(0); }
    ')
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

exec node --tls-max-v1.2 src/index.js
