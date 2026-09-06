#!/bin/sh
# Render free tier: run the API + crawler worker in one container (no free background worker).
# Migrations first, then the worker in the background, then the API on Render's $PORT.
# (The app reads API_PORT — see app/core/settings.py.) A start script avoids Render's
# dockerCommand quoting issues with inline "&&" chains.
set -e
alembic upgrade head
export API_PORT="${PORT:-8000}"
python -m app.worker &
exec python -m app.api
