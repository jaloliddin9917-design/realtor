#!/usr/bin/env bash
# deploy/backup.sh — nightly: pg_dump + photo rsync into deploy/backups, 30-day retention, optional off-site mirror.
# cron (server, as the deploy user):  15 3 * * *  /srv/realtor-app/deploy/backup.sh >> /var/log/realtor-backup.log 2>&1
set -euo pipefail
cd "$(dirname "$0")"
ENV_FILE="../.env"
# Read only BACKUP_TARGET, never source the whole file — a value containing #, $ or a
# space (an rsync target with an unusual password/path) would be mis-parsed or executed
# by `.`/`source`. `|| true` covers both a missing .env and a missing BACKUP_TARGET line
# (grep's no-match exit status would otherwise trip `set -e` right here).
BACKUP_TARGET="$(grep -m1 '^BACKUP_TARGET=' "$ENV_FILE" 2>/dev/null | cut -d= -f2-)" || true
COMPOSE="docker compose -f docker-compose.yml --env-file $ENV_FILE"
STAMP="$(date +%Y%m%d-%H%M)"
mkdir -p backups/photos
# Write to a .tmp file and mv into place only on success, so a failed/killed pg_dump
# never leaves a corrupt file at the name restore-check.sh (or a human) would trust.
$COMPOSE exec -T postgres pg_dump -U realtor --no-owner realtor | gzip -9 > "backups/realtor-$STAMP.sql.gz.tmp"
mv "backups/realtor-$STAMP.sql.gz.tmp" "backups/realtor-$STAMP.sql.gz"
# Photos are immutable once written (<listing id>/<n>.jpg keys are stable, never
# overwritten in place), so a plain accumulate-only rsync is safe and correct — no
# --delete, so a photo pruned or deleted from the live tree still survives here.
rsync -a data/photos/ backups/photos/
find backups -name 'realtor-*.sql.gz' -mtime +30 -delete
# No --delete on the off-site push either: it must accumulate, not mirror deletions —
# retention on BACKUP_TARGET is that target's own policy, not this script's.
if [ -n "${BACKUP_TARGET:-}" ]; then rsync -a backups/ "$BACKUP_TARGET/"; fi
echo "backup ok: deploy/backups/realtor-$STAMP.sql.gz ($(du -h "backups/realtor-$STAMP.sql.gz" | cut -f1)), photos $(find backups/photos -type f | wc -l) files"
