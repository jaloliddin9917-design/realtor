#!/usr/bin/env bash
# deploy/backup.sh — nightly: pg_dump + photo rsync into deploy/backups, 30-day retention, optional off-site mirror.
# cron (server, as the deploy user):  15 3 * * *  /srv/realtor-app/deploy/backup.sh >> /var/log/realtor-backup.log 2>&1
set -euo pipefail
cd "$(dirname "$0")"
ENV_FILE="../.env"; [ -f "$ENV_FILE" ] && set -a && . "$ENV_FILE" && set +a
COMPOSE="docker compose -f docker-compose.yml --env-file $ENV_FILE"
STAMP="$(date +%Y%m%d-%H%M)"
mkdir -p backups/photos
$COMPOSE exec -T postgres pg_dump -U realtor --no-owner realtor | gzip -9 > "backups/realtor-$STAMP.sql.gz"
rsync -a --delete data/photos/ backups/photos/
find backups -name 'realtor-*.sql.gz' -mtime +30 -delete
if [ -n "${BACKUP_TARGET:-}" ]; then rsync -a --delete backups/ "$BACKUP_TARGET/"; fi
echo "backup ok: backups/realtor-$STAMP.sql.gz ($(du -h "backups/realtor-$STAMP.sql.gz" | cut -f1)), photos $(find backups/photos -type f | wc -l) files"
