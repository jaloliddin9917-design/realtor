.PHONY: venv up down migrate revision check-migrations test lint typecheck worker api cli openapi web-install web web-check web-build deploy-up deploy-down deploy-logs backup restore-check

COMPOSE := docker compose -f deploy/docker-compose.dev.yml
COMPOSE_PROD := docker compose -f deploy/docker-compose.yml --env-file .env

venv:
	cd backend && uv venv --python 3.12 && uv pip install -e ".[dev]"

up:
	$(COMPOSE) up -d --wait

down:
	$(COMPOSE) down

migrate:
	cd backend && .venv/bin/alembic upgrade head

revision:
	cd backend && .venv/bin/alembic revision --autogenerate -m "$(m)"

check-migrations:
	cd backend && .venv/bin/alembic upgrade head && .venv/bin/alembic check

test: up
	cd backend && .venv/bin/pytest -q

lint:
	cd backend && .venv/bin/ruff check . && .venv/bin/ruff format --check .

typecheck:
	cd backend && .venv/bin/mypy app

worker:
	cd backend && .venv/bin/python -m app.worker

api:
	cd backend && .venv/bin/python -m app.api

cli:
	cd backend && .venv/bin/python -m app.cli $(args)

openapi:
	cd backend && .venv/bin/python -m app.api openapi > openapi.json

web-install:
	pnpm --dir web install --frozen-lockfile

web:
	pnpm --dir web dev

web-check:
	pnpm --dir web check

web-build:
	pnpm --dir web build

deploy-up:
	$(COMPOSE_PROD) up -d --build --wait

deploy-down:
	$(COMPOSE_PROD) down

deploy-logs:
	$(COMPOSE_PROD) logs -f --tail=200

backup:
	deploy/backup.sh

restore-check:
	deploy/restore-check.sh $(dump)
