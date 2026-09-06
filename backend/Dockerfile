FROM python:3.12-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
RUN apt-get update && apt-get install -y --no-install-recommends libjpeg62-turbo libpq5 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY pyproject.toml ./
COPY app ./app
COPY alembic.ini ./
COPY alembic ./alembic
COPY config ./config
RUN pip install --upgrade pip && pip install .
COPY start.sh ./
RUN useradd --create-home --uid 1000 realtor && mkdir -p /data/photos /data/telegram && chown -R realtor:realtor /data /app
USER realtor
# Settings.dedupe_config_path defaults to BACKEND_DIR / "config" / "dedupe.yaml", where
# BACKEND_DIR is derived from wherever app/core/settings.py was imported *from*. `pip
# install .` (no -e) also copies `app` into site-packages, so that default is only
# correct here because WORKDIR /app still holds the source tree pip installed from,
# which — being on CWD-first sys.path for `python -m`/`-c` — shadows the site-packages
# copy. Pin it explicitly instead of relying on that shadowing.
ENV PHOTO_DIR=/data/photos TELEGRAM_SESSION_PATH=/data/telegram/session API_HOST=0.0.0.0 API_PORT=8000 DEDUPE_CONFIG_PATH=/app/config/dedupe.yaml
EXPOSE 8000
CMD ["python", "-m", "app.api"]
