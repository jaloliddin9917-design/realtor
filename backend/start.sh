#!/bin/sh
# Render free tier: one container runs migrations then the API, and the API runs the crawler
# in-process (RUN_WORKER_IN_PROCESS=true in render.yaml) — a separate background process isn't
# reliably supervised on free hosts. The app reads API_PORT (see app/core/settings.py); a start
# script avoids Render's dockerCommand quoting issues with inline "&&" chains.
set -e
alembic upgrade head
export API_PORT="${PORT:-8000}"
exec python -m app.api
