#!/bin/sh
# Заставка первого запуска из GIF или видео: npm run intro -- путь/к/анимации.gif
# Исходник пережимается в лёгкое видео H.264 без звука (30 кадров в секунду, 1–1,5 МБ) и первый кадр для обложки.
# Нужен ffmpeg только на машине разработчика: готовые файлы лежат в репозитории, сборке в Docker он не нужен.
set -eu

if [ $# -ne 1 ] || [ ! -f "$1" ]; then
  echo "Использование: npm run intro -- путь/к/анимации.gif|mp4" >&2
  exit 1
fi

out="$(dirname "$0")/../src/assets"
ffmpeg -y -loglevel error -i "$1" \
  -vf "fps=30,scale=720:-2:flags=lanczos,format=yuv420p" \
  -c:v libx264 -preset slow -crf 31 -movflags +faststart -an "$out/intro.mp4"
ffmpeg -y -loglevel error -i "$1" -frames:v 1 -vf "scale=720:-2:flags=lanczos" -q:v 9 "$out/intro.jpg"
ls -lh "$out/intro.mp4" "$out/intro.jpg"
