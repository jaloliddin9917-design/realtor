#!/usr/bin/env bash
# Scheduled OLX crawl into Neon, run by cron on THIS (residential) machine.
#
# Why here and not the cloud: OLX blocks datacenter IPs — both Render and GitHub Actions hang on
# the first request and get killed. A normal/residential connection (this box) is served fine.
#
# The Neon DATABASE_URL is read from ../.crawl.env (gitignored) so no secret lives in the repo.
# Photos are hotlinked (CRAWL_DOWNLOAD_PHOTOS=false): the app serves them straight from the OLX
# CDN, so the crawl never downloads image bytes — a run is ~40 min instead of ~90.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND="$ROOT/backend"
ENV_FILE="$ROOT/.crawl.env"
LOG_DIR="$ROOT/crawl-logs"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/crawl-$(date +%Y%m%d-%H%M%S).log"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "$(date '+%F %T') ERROR: $ENV_FILE missing (needs DATABASE_URL=<neon url>)" >>"$LOG"
  exit 1
fi

# Load DATABASE_URL (and anything else) from the local, gitignored env file.
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a
export CRAWL_DOWNLOAD_PHOTOS=false
export PYTHONUNBUFFERED=1

# Never overlap: a crawl takes ~40 min; if the previous one is still running, skip this tick.
exec 9>"$LOG_DIR/.lock"
if ! flock -n 9; then
  echo "$(date '+%F %T') a crawl is already running — skipping this run" >>"$LOG"
  exit 0
fi

cd "$BACKEND"
echo "=== crawl start $(date '+%F %T %Z') ===" >>"$LOG"
set +e
"$BACKEND/.venv/bin/python" -m app.cli run-source olx-rent >>"$LOG" 2>&1
rc=$?
set -e
echo "=== crawl end $(date '+%F %T %Z') rc=$rc ===" >>"$LOG"

# Keep only the 20 most recent logs.
ls -1t "$LOG_DIR"/crawl-*.log 2>/dev/null | tail -n +21 | xargs -r rm -f
exit "$rc"
