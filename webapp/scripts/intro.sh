#!/bin/sh
# Заставка первого запуска из GIF: npm run intro -- путь/к/анимации.gif
# GIF на 10 секунд весит больше 10 МБ, поэтому в приложение идёт видео H.264 (около 0,5 МБ) и первый кадр для обложки.
# Нужен ffmpeg только на машине разработчика: готовые файлы лежат в репозитории, сборке в Docker он не нужен.
set -eu

if [ $# -ne 1 ] || [ ! -f "$1" ]; then
  echo "Использование: npm run intro -- путь/к/анимации.gif" >&2
  exit 1
fi

out="$(dirname "$0")/../src/assets"
ffmpeg -y -loglevel error -i "$1" \
  -vf "scale=720:-2:flags=lanczos,format=yuv420p" \
  -c:v libx264 -preset slow -crf 28 -movflags +faststart -an "$out/intro.mp4"
ffmpeg -y -loglevel error -i "$1" -frames:v 1 -vf "scale=720:-2:flags=lanczos" -q:v 9 "$out/intro.jpg"
ls -lh "$out/intro.mp4" "$out/intro.jpg"
