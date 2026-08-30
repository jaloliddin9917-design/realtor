.PHONY: venv up down migrate revision check-migrations test lint typecheck worker

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
