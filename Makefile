.PHONY: venv up down migrate revision check-migrations test lint typecheck worker api cli openapi web-install web web-check web-build

COMPOSE := docker compose -f deploy/docker-compose.dev.yml

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
