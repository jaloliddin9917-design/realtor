#!/usr/bin/env bash
# deploy/restore-check.sh <dump.sql.gz> — rehearse a restore into a scratch database and print row counts (spec §14.9).
set -euo pipefail
DUMP="${1:?usage: deploy/restore-check.sh deploy/backups/realtor-YYYYmmdd-HHMM.sql.gz}"
# Resolve relative to the caller's cwd before we cd below — a path like
# deploy/backups/realtor-....sql.gz (the natural form from the repo root: `make
# restore-check dump=...`, or Step 5's `$(ls -t deploy/backups/realtor-*.sql.gz)`)
# would otherwise be looked up a second time under deploy/ once we change directory.
DUMP="$(cd "$(dirname "$DUMP")" && pwd)/$(basename "$DUMP")"
cd "$(dirname "$0")"
ENV_FILE="../.env"
# Only used as a --env-file path below; docker compose parses it itself, so nothing here
# needs a bash-level variable from .env, and it is never sourced.
COMPOSE="docker compose -f docker-compose.yml --env-file $ENV_FILE"
SCRATCH="realtor_restore_$(date +%s)"
$COMPOSE exec -T postgres psql -U realtor -d postgres -c "CREATE DATABASE $SCRATCH"
trap '$COMPOSE exec -T postgres psql -U realtor -d postgres -c "DROP DATABASE IF EXISTS $SCRATCH" >/dev/null' EXIT
gunzip -c "$DUMP" | $COMPOSE exec -T postgres psql -v ON_ERROR_STOP=1 -U realtor -d "$SCRATCH" -q
$COMPOSE exec -T postgres psql -U realtor -d "$SCRATCH" -c "SELECT (SELECT count(*) FROM properties) AS properties, (SELECT count(*) FROM listings) AS listings, (SELECT count(*) FROM raw_listings) AS raw_listings, (SELECT count(*) FROM sources) AS sources, (SELECT count(*) FROM users) AS users"
echo "restore ok: $DUMP restored into $SCRATCH and dropped again; photos: $(find backups/photos -type f | wc -l) files in backups/photos"
