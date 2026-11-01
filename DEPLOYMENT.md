# norfly — выпуск на сервер

## Схема

- Одна ВМ с Docker Compose: сервис `norfly`, контейнер `norfly-norfly-1`.
- HTTPS принимает reverse proxy (Caddy). Порт приложения `3000` привязан к `127.0.0.1`, наружу не открывается.
- Серверный `.env` хранится только на ВМ, в Git не попадает. Шаблон — `.env.example`.
- На каждый токен бота — ровно один работающий экземпляр (long polling).

## Данные

Тома `norfly-data`, `norfly-schedule` и `norfly-attachments` переживают пересоздание контейнера. В них профили, общее и личное ДЗ, отметки переносов, история, кэши и вложения. Перед выпуском сохранять текущий образ и копию томов в отдельный каталог для отката.

## Порядок выпуска

1. Локально: `git status` чистый, `npm test`, `npm run build:web`, YAML проверен парсером.
2. `git push origin main`. Пуш деплой не запускает.
3. На ВМ сохранить прежний образ (тег `norfly-rollback:<дата>`) и копию томов.
4. Перенести исходники без `.env`, `node_modules` и `data`:
   ```bash
   git archive --format=tar HEAD | ssh <user>@<host> 'tar -xf - -C <app-dir>'
   ```
5. В каталоге приложения: `sudo GITHUB_SHA=<хеш> docker compose build norfly`, затем `sudo GITHUB_SHA=<хеш> docker compose up -d --no-build norfly`.
6. Проверить `/health`, `/version.json` (первые 12 символов хеша), healthcheck Docker и логи запуска.
7. Личные методы без настоящего initData проверять только на `401`. Не создавать тестовые ДЗ и сообщения в живой группе.

## Откат

1. `sudo docker compose stop norfly`.
2. Вернуть исходники и тома из копии выпуска.
3. Поднять прежний образ: `sudo docker tag norfly-rollback:<дата> norfly-norfly && sudo docker compose up -d --no-build norfly`.
4. Проверить `/health` и `/version.json`.

## Резервные копии вне ВМ

`ops/backup.sh` раз в сутки (systemd timer `ops/norfly-backup.timer`) останавливает приложение, снимает согласованную копию трёх томов, шифрует её AES-256-GCM и отправляет в закрытый S3-бакет (Yandex Object Storage). Ключ шифрования — в `/etc/norfly-backup/key`, вне томов; S3-реквизиты — в серверном `.env`. Ротация: 14 ежедневных и 8 еженедельных точек. При ошибке администратор получает сообщение в MAX.

Восстановление — только в новый пустой каталог:

```bash
BACKUP_KEY_FILE=/secure/norfly/key npm run backup:restore -- /absolute/new-empty-directory
```

Команда выбирает последний архив, проверяет аутентичность до распаковки и не допускает симлинков и выхода из каталога.

## Демо

Сброс демо-группы: `sudo sh ops/demo-reset.sh` из каталога приложения. Скрипт останавливает запись, очищает только демо и восстанавливает исходное ДЗ.
