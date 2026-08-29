# M0-1 Backend Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the backend core of milestone M0 — database schema, text parsing, persistence, photo hashing, dedupe, properties and the ingestion pipeline — fully tested against a real PostgreSQL, so that Plan M0-2 (adapters + worker), M0-3 (API) and M0-4 (web) only add edges to it.

**Architecture:** One Python package `backend/app` (modular monolith per `docs/02-architecture.md` §4/§13). Modules own their tables and expose service functions; the pipeline in `app/ingestion/pipeline.py` composes them: raw → parse → persist → photos → dedupe → property. No queue, no Redis; PostgreSQL is the only state. Everything here runs without network access (adapters arrive in M0-2 behind the `SourceAdapter` protocol defined in Task 11).

**Tech Stack:** Python 3.12 (via `uv`), FastAPI-compatible layout (no routes yet), SQLAlchemy 2.0 async + asyncpg, Alembic, Pydantic v2 + pydantic-settings, structlog, Pillow + imagehash, phonenumbers, httpx, PyYAML, pytest + pytest-asyncio, ruff, mypy --strict. PostgreSQL 16 in Docker for tests.

**Spec:** `docs/superpowers/specs/2026-08-29-m0-fetch-everything-design.md` (sections cited as §N below).

## Global Constraints

- Python `>=3.12,<3.13`; dependencies managed with `uv`; `ruff check`, `ruff format --check` and `mypy --strict app` must pass before every commit.
- Money is stored as `bigint` minor units with an explicit currency; `price_usd_minor` is derived from the CBU rate and is never inferred from magnitude (§4).
- Phones are E.164 `+998XXXXXXXXX` (§4); contact identity is `(kind, identifier)` with kinds `phone | telegram | olx_user` (§5.3).
- Property statuses are exactly `new | active | inactive` (§7); every change is an append-only `property_status_events` row.
- Dedupe weights/thresholds live in `backend/config/dedupe.yaml`, never in code (§5.2).
- Raw payloads are stored verbatim before parsing; parse and dedupe are re-runnable and idempotent (§3, §4).
- Each listing ingests inside its own savepoint; one bad post never rolls back a batch (§10).
- Tests never touch the network; a real PostgreSQL (docker compose) is used for DB tests (§12).
- Docker on this machine: run `docker context use default` once — the active context is Docker Desktop, which is not running; the system daemon on `/var/run/docker.sock` works.
- Commit after every task with a conventional message; commit trailers: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01FaiSj2uQts7dvqkGSrWTm7`.

---

## File structure (what this plan creates)

```
backend/
├── pyproject.toml                      # deps, ruff, mypy, pytest config
├── alembic.ini
├── alembic/env.py, script.py.mako, versions/0001_initial_schema.py
├── config/dedupe.yaml                  # weights + thresholds (§5.2)
├── app/
│   ├── __init__.py
│   ├── core/
│   │   ├── settings.py                 # Settings (pydantic-settings), get_settings()
│   │   ├── db.py                       # Base, make_engine(), make_session_factory()
│   │   └── logging.py                  # configure_logging()
│   ├── modules/
│   │   ├── identity/models.py          # User
│   │   ├── listings/models.py          # Source, CrawlRun, RawListing, Listing, ListingPhoto, ListingContact, FxRate
│   │   ├── listings/service.py         # upsert_raw, persist_parsed, mark_seen, apply_misses, age_out
│   │   ├── listings/fx.py              # fetch_cbu_rate, refresh_rate, rate_for, to_usd_minor
│   │   ├── contacts/models.py          # Contact
│   │   ├── contacts/service.py         # get_or_create, link
│   │   ├── contacts/scoring.py         # agency_score, classify, rescore_contact, update_probable_owner
│   │   ├── properties/models.py        # Property, PropertyStatusEvent
│   │   ├── properties/service.py       # create_from_listing, attach, recompute, set_status
│   │   ├── dedupe/models.py            # DedupeReview
│   │   ├── dedupe/config.py            # DedupeConfig, load_config()
│   │   ├── dedupe/blocking.py          # find_candidates
│   │   ├── dedupe/scoring.py           # ScoreInput, ScoreBreakdown, score() (pure)
│   │   └── dedupe/service.py           # gather_inputs, assign
│   ├── ingestion/
│   │   ├── parse/normalize.py          # normalize, translit
│   │   ├── parse/districts.py          # DISTRICTS, match_district
│   │   ├── parse/fields.py             # extract_price, extract_rooms_floors, extract_area, extract_phones, extract_username, extract_markers
│   │   ├── parse/__init__.py           # ParsedListing, parse_text
│   │   ├── photos.py                   # store_photo, phash_bucket, hamming, save_listing_photo
│   │   ├── adapters/base.py            # RawRef, RawPayload, SeenWindow, SourceAdapter protocol
│   │   └── pipeline.py                 # ingest_payload, run_source
│   └── worker/models.py                # WorkerHeartbeat
└── tests/
    ├── conftest.py                     # engine (alembic upgrade on a reset schema), db (savepoint session)
    ├── fixtures/posts/*.txt            # Telegram-style posts for parser tests
    └── test_*.py                       # one file per task
deploy/docker-compose.dev.yml           # postgres only (dev + test databases)
Makefile, .env.example
```

---

### Task 1: Project scaffold, settings, database session, test infrastructure

**Files:**
- Create: `backend/pyproject.toml`, `backend/app/__init__.py`, `backend/app/core/__init__.py`, `backend/app/core/settings.py`, `backend/app/core/db.py`, `backend/app/core/logging.py`, `backend/tests/__init__.py`, `backend/tests/conftest.py`, `backend/tests/test_settings.py`, `backend/tests/test_db.py`, `deploy/docker-compose.dev.yml`, `Makefile`, `.env.example`
- Create (generated): `backend/alembic.ini`, `backend/alembic/env.py`, `backend/alembic/script.py.mako`

**Interfaces:**
- Produces: `app.core.settings.Settings` (fields below), `get_settings() -> Settings`; `app.core.db.Base` (DeclarativeBase), `make_engine(url: str) -> AsyncEngine`, `make_session_factory(engine) -> async_sessionmaker[AsyncSession]`; pytest fixtures `engine` (session-scoped, schema migrated to head) and `db: AsyncSession` (per-test, rolled back).

- [ ] **Step 1: Create the Python project**

```bash
mkdir -p backend/app/core backend/tests && cd backend
cat > pyproject.toml <<'PYEOF'
[build-system]
requires = ["setuptools>=68"]
build-backend = "setuptools.build_meta"

[project]
name = "realtor-backend"
version = "0.1.0"
requires-python = ">=3.12,<3.13"
dependencies = [
    "fastapi>=0.115",
    "uvicorn[standard]>=0.32",
    "sqlalchemy[asyncio]>=2.0.36",
    "asyncpg>=0.30",
    "alembic>=1.14",
    "pydantic>=2.9",
    "pydantic-settings>=2.6",
    "structlog>=24.4",
    "httpx>=0.28",
    "pillow>=11.0",
    "imagehash>=4.3",
    "phonenumbers>=8.13",
    "pyyaml>=6.0",
    "pyjwt>=2.10",
    "argon2-cffi>=23.1",
    "typer>=0.15",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.3",
    "pytest-asyncio>=0.24",
    "ruff>=0.8",
    "mypy>=1.13",
    "types-PyYAML",
    "types-Pillow",
]

[tool.setuptools.packages.find]
include = ["app*"]

[tool.ruff]
line-length = 100
target-version = "py312"

[tool.ruff.lint]
select = ["E", "F", "I", "N", "UP", "B"]

[tool.ruff.lint.isort]
known-first-party = ["app"]

[tool.mypy]
python_version = "3.12"
strict = true
warn_unused_ignores = true
plugins = []

[[tool.mypy.overrides]]
module = ["imagehash.*", "phonenumbers.*", "scrapling.*", "telethon.*"]
ignore_missing_imports = true

[tool.pytest.ini_options]
asyncio_mode = "auto"
asyncio_default_fixture_loop_scope = "session"
testpaths = ["tests"]
PYEOF
uv venv --python 3.12 && uv pip install -e ".[dev]"
```

Expected: `.venv` created, packages installed without errors.

- [ ] **Step 2: Write the failing settings test**

`backend/tests/test_settings.py`:
```python
from pathlib import Path

from app.core.settings import Settings, get_settings


def test_defaults_point_at_local_postgres() -> None:
    s = Settings(_env_file=None)
    assert s.database_url.startswith("postgresql+asyncpg://")
    assert s.test_database_url.endswith("/realtor_test")
    assert s.photo_dir == Path("./data/photos")
    assert s.tz == "Asia/Tashkent"


def test_env_overrides(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setenv("DATABASE_URL", "postgresql+asyncpg://u:p@h:5432/x")
    get_settings.cache_clear()
    assert get_settings().database_url == "postgresql+asyncpg://u:p@h:5432/x"
    get_settings.cache_clear()
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/test_settings.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.core.settings'`

- [ ] **Step 4: Implement settings, db and logging**

`backend/app/__init__.py` and `backend/app/core/__init__.py`: empty files.

`backend/app/core/settings.py`:
```python
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+asyncpg://realtor:realtor@localhost:5432/realtor"
    test_database_url: str = "postgresql+asyncpg://realtor:realtor@localhost:5432/realtor_test"
    photo_dir: Path = Path("./data/photos")
    jwt_secret: str = "change-me"
    telegram_api_id: int = 0
    telegram_api_hash: str = ""
    telegram_session_path: Path = Path("./data/telegram.session")
    dedupe_config_path: Path = BACKEND_DIR / "config" / "dedupe.yaml"
    tz: str = "Asia/Tashkent"
    log_level: str = "INFO"


@lru_cache
def get_settings() -> Settings:
    return Settings()
```

`backend/app/core/db.py`:
```python
import uuid
from datetime import datetime

from sqlalchemy import DateTime, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class IdMixin:
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


def make_engine(url: str) -> AsyncEngine:
    return create_async_engine(url, pool_pre_ping=True)


def make_session_factory(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)
```

`backend/app/core/logging.py`:
```python
import logging

import structlog


def configure_logging(level: str = "INFO") -> None:
    logging.basicConfig(level=level, format="%(message)s")
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(logging.getLevelName(level)),
    )
```

- [ ] **Step 5: Run the settings test to verify it passes**

Run: `cd backend && .venv/bin/pytest tests/test_settings.py -v`
Expected: 2 PASSED

- [ ] **Step 6: Dev database via docker compose, Makefile, .env.example**

`deploy/docker-compose.dev.yml`:
```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: realtor
      POSTGRES_PASSWORD: realtor
      POSTGRES_DB: realtor
    ports:
      - "5432:5432"
    volumes:
      - realtor_pgdata:/var/lib/postgresql/data
      - ./initdb:/docker-entrypoint-initdb.d:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U realtor -d realtor"]
      interval: 2s
      timeout: 3s
      retries: 30

volumes:
  realtor_pgdata:
```

`deploy/initdb/01-test-db.sql`:
```sql
CREATE DATABASE realtor_test OWNER realtor;
```

`Makefile` (repo root; tabs, not spaces, before each command):
```makefile
.PHONY: venv up down migrate revision test lint typecheck

VENV := backend/.venv
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

test: up
	cd backend && .venv/bin/pytest -q

lint:
	cd backend && .venv/bin/ruff check . && .venv/bin/ruff format --check .

typecheck:
	cd backend && .venv/bin/mypy app
```

`.env.example` (repo root):
```
DATABASE_URL=postgresql+asyncpg://realtor:realtor@localhost:5432/realtor
TEST_DATABASE_URL=postgresql+asyncpg://realtor:realtor@localhost:5432/realtor_test
PHOTO_DIR=./data/photos
JWT_SECRET=change-me
TELEGRAM_API_ID=0
TELEGRAM_API_HASH=
TELEGRAM_SESSION_PATH=./data/telegram.session
LOG_LEVEL=INFO
```

Run: `docker context use default && make up`
Expected: `postgres` container healthy; `docker compose -f deploy/docker-compose.dev.yml ps` shows it running.

- [ ] **Step 7: Alembic with async env**

Run: `cd backend && .venv/bin/alembic init -t async alembic`
Then replace `backend/alembic/env.py` with:
```python
import asyncio
import os
from logging.config import fileConfig

from alembic import context
from sqlalchemy.ext.asyncio import create_async_engine

from app.core.db import Base
from app.core.settings import get_settings

# import every model module so Base.metadata is complete
import app.modules.identity.models  # noqa: F401,E402
import app.modules.listings.models  # noqa: F401,E402
import app.modules.contacts.models  # noqa: F401,E402
import app.modules.properties.models  # noqa: F401,E402
import app.modules.dedupe.models  # noqa: F401,E402
import app.worker.models  # noqa: F401,E402

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata
DATABASE_URL = os.environ.get("DATABASE_URL") or get_settings().database_url


def run_migrations_offline() -> None:
    context.configure(url=DATABASE_URL, target_metadata=target_metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection) -> None:  # type: ignore[no-untyped-def]
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online() -> None:
    engine = create_async_engine(DATABASE_URL)
    async with engine.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())
```
The model modules imported above are created in Task 2; until then create them as empty files so the import succeeds: `mkdir -p app/modules/{identity,listings,contacts,properties,dedupe} app/worker && for d in identity listings contacts properties dedupe; do touch app/modules/$d/__init__.py app/modules/$d/models.py; done; touch app/modules/__init__.py app/worker/__init__.py app/worker/models.py`.

- [ ] **Step 8: Write the failing DB test and the fixtures**

`backend/tests/conftest.py`:
```python
import os
import subprocess
from collections.abc import AsyncIterator
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, create_async_engine

from app.core.db import make_engine
from app.core.settings import get_settings

BACKEND_DIR = Path(__file__).resolve().parents[1]


@pytest.fixture(scope="session")
async def engine() -> AsyncIterator[AsyncEngine]:
    url = get_settings().test_database_url
    reset = create_async_engine(url, isolation_level="AUTOCOMMIT")
    async with reset.connect() as conn:
        await conn.execute(text("DROP SCHEMA public CASCADE"))
        await conn.execute(text("CREATE SCHEMA public"))
    await reset.dispose()
    subprocess.run(
        [str(BACKEND_DIR / ".venv" / "bin" / "alembic"), "upgrade", "head"],
        check=True,
        cwd=BACKEND_DIR,
        env={**os.environ, "DATABASE_URL": url},
    )
    eng = make_engine(url)
    yield eng
    await eng.dispose()


@pytest.fixture
async def db(engine: AsyncEngine) -> AsyncIterator[AsyncSession]:
    async with engine.connect() as conn:
        trans = await conn.begin()
        session = AsyncSession(bind=conn, expire_on_commit=False, join_transaction_mode="create_savepoint")
        try:
            yield session
        finally:
            await session.close()
            await trans.rollback()
```

`backend/tests/test_db.py`:
```python
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def test_database_is_reachable_and_migrated(db: AsyncSession) -> None:
    version = (await db.execute(text("SELECT version_num FROM alembic_version"))).scalar_one()
    assert version
    extensions = {
        row[0]
        for row in (await db.execute(text("SELECT extname FROM pg_extension"))).all()
    }
    assert {"pg_trgm", "unaccent"} <= extensions
```

- [ ] **Step 9: Run it to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/test_db.py -v`
Expected: FAIL — alembic has no revisions yet (`alembic_version` missing) or extension assertion fails.

- [ ] **Step 10: First migration — extensions only (tables come in Task 2)**

`backend/alembic/versions/0000_extensions.py`:
```python
"""extensions

Revision ID: 0000
Revises:
Create Date: 2026-08-29
"""
from alembic import op

revision = "0000"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    op.execute("CREATE EXTENSION IF NOT EXISTS unaccent")


def downgrade() -> None:
    op.execute("DROP EXTENSION IF EXISTS unaccent")
    op.execute("DROP EXTENSION IF EXISTS pg_trgm")
```

- [ ] **Step 11: Run the DB test to verify it passes**

Run: `cd backend && .venv/bin/pytest tests/test_db.py -v`
Expected: 1 PASSED

- [ ] **Step 12: Lint, typecheck, commit**

Run: `make lint typecheck` — Expected: no errors (fix any import order with `.venv/bin/ruff format .`).
```bash
git add backend Makefile .env.example deploy
git commit -m "feat(backend): project scaffold, settings, async db session, alembic and test infra"
```

---

### Task 2: Schema — SQLAlchemy models and the initial migration

**Files:**
- Create: `backend/app/modules/identity/models.py`, `backend/app/modules/listings/models.py`, `backend/app/modules/contacts/models.py`, `backend/app/modules/properties/models.py`, `backend/app/modules/dedupe/models.py`, `backend/app/worker/models.py`
- Create: `backend/alembic/versions/0001_initial_schema.py` (autogenerated, then extended)
- Test: `backend/tests/test_schema.py`

**Interfaces:**
- Consumes: `Base`, `IdMixin`, `TimestampMixin` from Task 1.
- Produces: the ORM classes below with exactly these attribute names — every later task uses them: `User`, `Source`, `CrawlRun`, `RawListing`, `Listing`, `ListingContact`, `ListingPhoto`, `FxRate`, `Contact`, `Property`, `PropertyStatusEvent`, `DedupeReview`, `WorkerHeartbeat`.

- [ ] **Step 1: Write the failing schema test**

`backend/tests/test_schema.py`:
```python
import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.contacts.models import Contact
from app.modules.listings.models import Listing, RawListing, Source
from app.modules.properties.models import Property, PropertyStatusEvent


async def test_round_trip_source_raw_listing_property(db: AsyncSession) -> None:
    source = Source(kind="telegram", name="@test", config={"peer": "@test"})
    db.add(source)
    await db.flush()
    raw = RawListing(
        source_id=source.id, external_id="1:1", url=None, payload={"text": "x"},
        content_hash="h", fetched_at=datetime.now(UTC),
    )
    db.add(raw)
    prop = Property(status="new", first_seen_at=datetime.now(UTC), last_seen_at=datetime.now(UTC))
    db.add(prop)
    await db.flush()
    listing = Listing(
        raw_listing_id=raw.id, property_id=prop.id, title="t", description="d",
        first_seen_at=datetime.now(UTC), last_seen_at=datetime.now(UTC),
    )
    db.add(listing)
    contact = Contact(kind="phone", identifier="+998901234567")
    db.add(contact)
    await db.flush()
    assert listing.id and contact.id and prop.status == "new"


async def test_status_events_are_append_only(db: AsyncSession) -> None:
    prop = Property(status="new", first_seen_at=datetime.now(UTC), last_seen_at=datetime.now(UTC))
    db.add(prop)
    await db.flush()
    ev = PropertyStatusEvent(property_id=prop.id, from_status=None, to_status="new", actor_type="crawler")
    db.add(ev)
    await db.flush()
    with pytest.raises(DBAPIError):
        await db.execute(text("UPDATE property_status_events SET note = 'x' WHERE id = :id"), {"id": ev.id})


async def test_contact_identity_is_unique(db: AsyncSession) -> None:
    db.add(Contact(kind="phone", identifier="+998901234567"))
    await db.flush()
    db.add(Contact(kind="phone", identifier="+998901234567"))
    with pytest.raises(DBAPIError):
        await db.flush()


async def test_photo_bucket_index_exists(db: AsyncSession) -> None:
    rows = (await db.execute(text("SELECT indexname FROM pg_indexes WHERE tablename = 'listing_photos'"))).all()
    assert any("bucket" in r[0] for r in rows)
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/test_schema.py -v`
Expected: FAIL with `ImportError` (models are empty files).

- [ ] **Step 3: Write the models**

`backend/app/modules/identity/models.py`:
```python
from sqlalchemy import Boolean, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, IdMixin, TimestampMixin


class User(IdMixin, TimestampMixin, Base):
    __tablename__ = "users"

    phone_e164: Mapped[str] = mapped_column(String(16), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(16), nullable=False, default="agent")  # admin | agent
    locale: Mapped[str] = mapped_column(String(5), nullable=False, default="uz")
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
```

`backend/app/modules/listings/models.py`:
```python
import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base, IdMixin, TimestampMixin


class Source(IdMixin, TimestampMixin, Base):
    __tablename__ = "sources"

    kind: Mapped[str] = mapped_column(String(16), nullable=False)  # telegram | olx | manual
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    config: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    state: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    interval_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=900)
    next_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    consecutive_failures: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    paused_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="ok")  # ok | failing | login_required | paused


class CrawlRun(IdMixin, Base):
    __tablename__ = "crawl_runs"

    source_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("sources.id", ondelete="CASCADE"), nullable=False, index=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    found: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    new: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    changed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    failed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    removed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error: Mapped[str | None] = mapped_column(Text)


class RawListing(IdMixin, TimestampMixin, Base):
    __tablename__ = "raw_listings"
    __table_args__ = (UniqueConstraint("source_id", "external_id", name="uq_raw_source_external"),)

    source_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("sources.id", ondelete="CASCADE"), nullable=False)
    external_id: Mapped[str] = mapped_column(String(120), nullable=False)
    url: Mapped[str | None] = mapped_column(Text)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    parse_error: Mapped[str | None] = mapped_column(Text)

    source: Mapped[Source] = relationship()


class Listing(IdMixin, TimestampMixin, Base):
    __tablename__ = "listings"
    __table_args__ = (Index("ix_listings_attr_key", "district", "rooms", "floor", "total_floors"),)

    raw_listing_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("raw_listings.id", ondelete="CASCADE"), unique=True, nullable=False)
    property_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("properties.id", ondelete="SET NULL"), index=True)
    title: Mapped[str] = mapped_column(Text, nullable=False, default="")
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    price_amount_minor: Mapped[int | None] = mapped_column(BigInteger)
    price_currency: Mapped[str | None] = mapped_column(String(3))
    price_usd_minor: Mapped[int | None] = mapped_column(BigInteger)
    rooms: Mapped[int | None] = mapped_column(Integer)
    area_sqm: Mapped[float | None] = mapped_column(Float)
    floor: Mapped[int | None] = mapped_column(Integer)
    total_floors: Mapped[int | None] = mapped_column(Integer)
    district: Mapped[str | None] = mapped_column(String(32))
    address_text: Mapped[str | None] = mapped_column(Text)
    posted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    first_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    miss_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    source_removed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    removed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    owner_marker: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    agent_marker: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    parse_confidence: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)

    raw: Mapped[RawListing] = relationship()
    photos: Mapped[list["ListingPhoto"]] = relationship(back_populates="listing", cascade="all, delete-orphan", order_by="ListingPhoto.position")
    contact_links: Mapped[list["ListingContact"]] = relationship(back_populates="listing", cascade="all, delete-orphan")


class ListingContact(Base):
    __tablename__ = "listing_contacts"

    listing_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("listings.id", ondelete="CASCADE"), primary_key=True)
    contact_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("contacts.id", ondelete="CASCADE"), primary_key=True)

    listing: Mapped[Listing] = relationship(back_populates="contact_links")


class ListingPhoto(IdMixin, Base):
    __tablename__ = "listing_photos"

    listing_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("listings.id", ondelete="CASCADE"), nullable=False, index=True)
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    storage_key: Mapped[str | None] = mapped_column(Text)
    sha256: Mapped[str | None] = mapped_column(String(64))
    phash: Mapped[int | None] = mapped_column(BigInteger, index=True)
    width: Mapped[int | None] = mapped_column(Integer)
    height: Mapped[int | None] = mapped_column(Integer)
    download_error: Mapped[str | None] = mapped_column(Text)

    listing: Mapped[Listing] = relationship(back_populates="photos")


class FxRate(Base):
    __tablename__ = "fx_rates"

    date: Mapped[date] = mapped_column(Date, primary_key=True)
    usd_uzs: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
```

`backend/app/modules/contacts/models.py`:
```python
from sqlalchemy import Float, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, IdMixin, TimestampMixin


class Contact(IdMixin, TimestampMixin, Base):
    __tablename__ = "contacts"
    __table_args__ = (UniqueConstraint("kind", "identifier", name="uq_contact_identity"),)

    kind: Mapped[str] = mapped_column(String(16), nullable=False)  # phone | telegram | olx_user
    identifier: Mapped[str] = mapped_column(String(64), nullable=False)
    display_name: Mapped[str | None] = mapped_column(String(120))
    agency_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.5)
    classification: Mapped[str] = mapped_column(String(16), nullable=False, default="unknown")  # owner | agent | unknown
    distinct_property_count_90d: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    human_decision: Mapped[str | None] = mapped_column(String(16))
```

`backend/app/modules/properties/models.py`:
```python
import uuid
from datetime import datetime

from sqlalchemy import BigInteger, Boolean, DateTime, Float, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import TSVECTOR, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, IdMixin, TimestampMixin


class Property(IdMixin, TimestampMixin, Base):
    __tablename__ = "properties"
    __table_args__ = (Index("ix_properties_search", "search_vector", postgresql_using="gin"),)

    status: Mapped[str] = mapped_column(String(16), nullable=False, default="new")  # new | active | inactive
    district: Mapped[str | None] = mapped_column(String(32), index=True)
    rooms: Mapped[int | None] = mapped_column(Integer)
    floor: Mapped[int | None] = mapped_column(Integer)
    total_floors: Mapped[int | None] = mapped_column(Integer)
    area_sqm: Mapped[float | None] = mapped_column(Float)
    price_usd_min_minor: Mapped[int | None] = mapped_column(BigInteger)
    probable_owner_contact_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("contacts.id", ondelete="SET NULL"))
    owner_confidence: Mapped[float | None] = mapped_column(Float)
    source_removed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    needs_recheck: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    first_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    search_vector: Mapped[str | None] = mapped_column(TSVECTOR)


class PropertyStatusEvent(Base):
    __tablename__ = "property_status_events"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    property_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("properties.id", ondelete="CASCADE"), nullable=False, index=True)
    from_status: Mapped[str | None] = mapped_column(String(16))
    to_status: Mapped[str] = mapped_column(String(16), nullable=False)
    actor_type: Mapped[str] = mapped_column(String(16), nullable=False)  # crawler | agent | admin | bot
    actor_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
```

`backend/app/modules/dedupe/models.py`:
```python
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, Float, ForeignKey, String
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, IdMixin, TimestampMixin


class DedupeReview(IdMixin, TimestampMixin, Base):
    __tablename__ = "dedupe_reviews"

    listing_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("listings.id", ondelete="CASCADE"), nullable=False, index=True)
    candidate_property_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("properties.id", ondelete="CASCADE"), nullable=False, index=True)
    score: Mapped[float] = mapped_column(Float, nullable=False)
    breakdown: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    decision: Mapped[str | None] = mapped_column(String(16))  # merge | separate
    decided_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
```

`backend/app/worker/models.py`:
```python
from datetime import datetime

from sqlalchemy import DateTime, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class WorkerHeartbeat(Base):
    __tablename__ = "worker_heartbeat"

    name: Mapped[str] = mapped_column(String(32), primary_key=True)
    last_tick_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
```

- [ ] **Step 4: Generate the migration and extend it**

Run: `cd backend && DATABASE_URL=postgresql+asyncpg://realtor:realtor@localhost:5432/realtor .venv/bin/alembic upgrade head && DATABASE_URL=postgresql+asyncpg://realtor:realtor@localhost:5432/realtor .venv/bin/alembic revision --autogenerate -m "initial schema"`
Expected: a new file `backend/alembic/versions/<hash>_initial_schema.py` creating all 13 tables. Rename it to `0001_initial_schema.py`, set `revision = "0001"`, `down_revision = "0000"`. Then append to the end of `upgrade()`:

```python
    # append-only status events (§7)
    op.execute(
        """
        CREATE OR REPLACE FUNCTION forbid_change() RETURNS trigger AS $$
        BEGIN RAISE EXCEPTION 'property_status_events is append-only'; END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.execute(
        "CREATE TRIGGER property_status_events_append_only BEFORE UPDATE OR DELETE "
        "ON property_status_events FOR EACH ROW EXECUTE FUNCTION forbid_change()"
    )
    # pHash top-16-bit bucket for blocking (§5.1); phash is a signed bigint
    op.execute(
        "CREATE INDEX ix_listing_photos_bucket ON listing_photos "
        "(((phash >> 48) & 65535)) WHERE phash IS NOT NULL"
    )
    # trigram index for description similarity (§5.2)
    op.execute("CREATE INDEX ix_listings_description_trgm ON listings USING gin (description gin_trgm_ops)")
```
and to the start of `downgrade()`:
```python
    op.execute("DROP INDEX IF EXISTS ix_listings_description_trgm")
    op.execute("DROP INDEX IF EXISTS ix_listing_photos_bucket")
    op.execute("DROP TRIGGER IF EXISTS property_status_events_append_only ON property_status_events")
    op.execute("DROP FUNCTION IF EXISTS forbid_change")
```
Check the autogenerated file: the `ix_properties_search` index must carry `postgresql_using="gin"` (autogenerate keeps it); `search_vector` must be `postgresql.TSVECTOR()`.

- [ ] **Step 5: Run the schema tests to verify they pass**

Run: `cd backend && .venv/bin/pytest tests/test_schema.py tests/test_db.py -v`
Expected: 5 PASSED (the `engine` fixture resets the test schema and re-runs both migrations).

- [ ] **Step 6: Lint, typecheck, commit**

Run: `make lint typecheck`
```bash
git add backend
git commit -m "feat(schema): models for sources, listings, contacts, properties, dedupe reviews; initial migration with append-only events and phash bucket index"
```

---

### Task 3: Text normalisation and the Tashkent district dictionary

**Files:**
- Create: `backend/app/ingestion/__init__.py`, `backend/app/ingestion/parse/__init__.py` (empty for now), `backend/app/ingestion/parse/normalize.py`, `backend/app/ingestion/parse/districts.py`
- Test: `backend/tests/test_normalize.py`, `backend/tests/test_districts.py`

**Interfaces:**
- Produces: `normalize(text: str) -> str` (NFC, apostrophe variants → `'`, whitespace collapsed, original case kept); `translit(text: str) -> str` (lowercase, Uzbek/Russian Cyrillic → Latin); `DISTRICTS: dict[str, list[str]]` (canonical key → regex alias patterns); `match_district(text: str) -> str | None` returning a canonical key from `{bektemir, chilonzor, mirobod, mirzo_ulugbek, olmazor, sergeli, shayxontohur, uchtepa, yakkasaroy, yashnobod, yunusobod, yangihayot}`.

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_normalize.py`:
```python
from app.ingestion.parse.normalize import normalize, translit


def test_normalize_unifies_apostrophes_and_whitespace() -> None:
    assert normalize("Oʻrikzor   ko’chasi\n\n 3-qavat") == "O'rikzor ko'chasi 3-qavat"


def test_translit_cyrillic_uzbek_and_russian() -> None:
    assert translit("Чилонзор, 2-хонали, ЕВРО РЕМОНТ") == "chilonzor, 2-xonali, evro remont"
    assert translit("Юнусабад, 3 комн, хозяин") == "yunusabad, 3 komn, xozyain"
    assert translit("Ўрикзор кўчаси, Ғафур Ғулом") == "o'rikzor ko'chasi, g'afur g'ulom"


def test_translit_keeps_latin_and_digits() -> None:
    assert translit("Sergeli 7-mavze $450") == "sergeli 7-mavze $450"
```

`backend/tests/test_districts.py`:
```python
import pytest

from app.ingestion.parse.districts import match_district


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("Chilonzor, Qatortol, 2-xonali", "chilonzor"),
        ("Чиланзар 19 квартал", "chilonzor"),
        ("Ч-зор, 2 комн", "chilonzor"),
        ("Mirzo Ulug'bek tumani, TTZ", "mirzo_ulugbek"),
        ("М.Улугбек, Буюк Ипак Йули", "mirzo_ulugbek"),
        ("Мирзо-Улугбекский район", "mirzo_ulugbek"),
        ("Yunusobod 11-kvartal", "yunusobod"),
        ("Юнусабад, 4 квартал", "yunusobod"),
        ("Яккасарайский р-н, Бобур", "yakkasaroy"),
        ("Shayxontohur, Beruniy", "shayxontohur"),
        ("Шайхантахур", "shayxontohur"),
        ("Yashnobod, Tuzel", "yashnobod"),
        ("Яшнабад", "yashnobod"),
        ("Olmazor, Qorasaroy", "olmazor"),
        ("Алмазар", "olmazor"),
        ("Mirobod, Oybek", "mirobod"),
        ("Мирабад", "mirobod"),
        ("Sergeli, Sputnik", "sergeli"),
        ("Uchtepa", "uchtepa"),
        ("Bektemir", "bektemir"),
        ("Yangihayot tumani", "yangihayot"),
        ("Янги хаёт", "yangihayot"),
        ("2-xonali kvartira, evro remont", None),
        ("Amirzo Ulugbek fasoni", None),
    ],
)
def test_match_district(text: str, expected: str | None) -> None:
    assert match_district(text) == expected
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd backend && .venv/bin/pytest tests/test_normalize.py tests/test_districts.py -q`
Expected: FAIL with `ModuleNotFoundError: app.ingestion.parse.normalize`

- [ ] **Step 3: Implement normalisation**

`backend/app/ingestion/__init__.py` and `backend/app/ingestion/parse/__init__.py`: empty.

`backend/app/ingestion/parse/normalize.py`:
```python
import re
import unicodedata

_APOSTROPHES = str.maketrans({"ʻ": "'", "ʼ": "'", "’": "'", "‘": "'", "`": "'", "ʹ": "'"})
_WS = re.compile(r"\s+")

# Uzbek Cyrillic → Latin; Russian-only letters map to their common Uzbek-Latin reading.
_CYR = {
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "yo", "ж": "j", "з": "z",
    "и": "i", "й": "y", "к": "k", "л": "l", "м": "m", "н": "n", "о": "o", "п": "p", "р": "r",
    "с": "s", "т": "t", "у": "u", "ф": "f", "х": "x", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "sh",
    "ъ": "'", "ы": "i", "ь": "", "э": "e", "ю": "yu", "я": "ya",
    "ў": "o'", "қ": "q", "ғ": "g'", "ҳ": "h",
}
_CYR_TABLE = {ord(k): v for k, v in _CYR.items()}


def normalize(text: str) -> str:
    text = unicodedata.normalize("NFC", text).translate(_APOSTROPHES)
    return _WS.sub(" ", text).strip()


def translit(text: str) -> str:
    return normalize(text).lower().translate(_CYR_TABLE)
```

`backend/app/ingestion/parse/districts.py`:
```python
import re

from app.ingestion.parse.normalize import translit

# canonical key → alias patterns, matched on translit(text). Longer/more specific first.
DISTRICTS: dict[str, list[str]] = {
    "mirzo_ulugbek": [r"\bmirzo[\s-]*ulug'?bek\w*", r"\bm\.?\s*ulug'?bek\w*", r"\bttz\b"],
    "chilonzor": [r"\bchilonzor\w*", r"\bchilanzar\w*", r"\bch[\s-]?zor\b"],
    "yunusobod": [r"\byunusobod\w*", r"\byunusabad\w*", r"\byu[\s-]?obod\b"],
    "yakkasaroy": [r"\byakkasaroy\w*", r"\byakkasaray\w*"],
    "shayxontohur": [r"\bshayxonto[hx]ur\w*", r"\bshayxanta[hx]ur\w*", r"\bsh[\s-]?to[hx]ur\b"],
    "yashnobod": [r"\byashnobod\w*", r"\byashnabad\w*"],
    "olmazor": [r"\bolmazor\w*", r"\balmazar\w*"],
    "mirobod": [r"\bmirobod\w*", r"\bmirabad\w*"],
    "sergeli": [r"\bsergeli\w*"],
    "uchtepa": [r"\buchtepa\w*"],
    "bektemir": [r"\bbektemir\w*"],
    "yangihayot": [r"\byangi[\s-]?[hx]a[yeё]o?t\w*"],
}

_COMPILED: list[tuple[str, re.Pattern[str]]] = [
    (key, re.compile(p)) for key, patterns in DISTRICTS.items() for p in patterns
]


def match_district(text: str) -> str | None:
    t = translit(text)
    best: tuple[int, str] | None = None
    for key, pattern in _COMPILED:
        m = pattern.search(t)
        if m and (best is None or m.start() < best[0]):
            best = (m.start(), key)
    return best[1] if best else None
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && .venv/bin/pytest tests/test_normalize.py tests/test_districts.py -q`
Expected: all PASSED. If a district case fails, fix the alias pattern — never the test — unless the test's expectation is wrong against the spec table in §4.

- [ ] **Step 5: Lint, typecheck, commit**

```bash
make lint typecheck
git add backend
git commit -m "feat(parse): text normalisation, Cyrillic transliteration and Tashkent district matching"
```

---

### Task 4: Field extractors and `parse_text`

**Files:**
- Create: `backend/app/ingestion/parse/fields.py`, `backend/app/ingestion/parse/__init__.py` (replace the empty file)
- Create fixtures: `backend/tests/fixtures/posts/uz_latin_owner.txt`, `backend/tests/fixtures/posts/uz_cyrillic_agent.txt`, `backend/tests/fixtures/posts/ru_agent.txt`
- Test: `backend/tests/test_fields.py`, `backend/tests/test_parse_text.py`

**Interfaces:**
- Consumes: `normalize`, `translit`, `match_district` (Task 3).
- Produces (all in `app.ingestion.parse`):
  - `extract_price(text) -> tuple[int, str] | None` → `(amount_minor, "USD"|"UZS")`
  - `extract_rooms_floors(text) -> tuple[int | None, int | None, int | None]` → `(rooms, floor, total_floors)`
  - `extract_area(text) -> float | None`
  - `extract_phones(text) -> list[str]` (E.164, deduplicated, order kept)
  - `extract_username(text) -> str | None` (without `@`)
  - `extract_markers(text) -> tuple[bool, bool]` → `(owner_marker, agent_marker)`
  - `class ParsedListing(BaseModel)`: `title: str`, `description: str`, `price_amount_minor: int | None`, `price_currency: str | None`, `rooms: int | None`, `floor: int | None`, `total_floors: int | None`, `area_sqm: float | None`, `district: str | None`, `phones: list[str]`, `telegram_username: str | None`, `owner_marker: bool`, `agent_marker: bool`, `parse_confidence: float`
  - `parse_text(text: str, *, sender_username: str | None = None, structured: dict[str, Any] | None = None) -> ParsedListing`. `structured` keys (all optional, OLX supplies them): `title, price_amount_minor, price_currency, rooms, floor, total_floors, area_sqm, district`; a present structured value overrides text extraction.

- [ ] **Step 1: Write the fixture posts**

`backend/tests/fixtures/posts/uz_latin_owner.txt`:
```
Chilonzor, Qatortol, 2-xonali kvartira, 3/9 qavat, 54 m², evro remont, mebel va texnika bilan.
Uzoq muddatga, faqat oilaga. Egasidan, vositachilarsiz.
Narxi 450$ oyiga. Tel: 90 811 24 37, +998 93 402 18 55
```

`backend/tests/fixtures/posts/uz_cyrillic_agent.txt`:
```
Юнусобод 11-квартал, 3-хонали, 5-қават 9 қаватли уйда, 78 кв.м
Нархи 7 800 000 сўм. Хизмат ҳақи 50%. Риелтор Дилшод @dilshod_uy
```

`backend/tests/fixtures/posts/ru_agent.txt`:
```
Сдается 1 комн. квартира, Мирабад, ор-р Ойбек. 2/4 этаж, 32 кв. Цена 300 у.е.
Услуга 50%. Звоните: +998971234567
```

- [ ] **Step 2: Write the failing field tests**

`backend/tests/test_fields.py`:
```python
import pytest

from app.ingestion.parse.fields import (
    extract_area,
    extract_markers,
    extract_phones,
    extract_price,
    extract_rooms_floors,
    extract_username,
)


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("Narxi 450$ oyiga", (45000, "USD")),
        ("Цена 300 у.е.", (30000, "USD")),
        ("$1 000 в месяц", (100000, "USD")),
        ("Нархи 7 800 000 сўм", (780000000, "UZS")),
        ("5.940.700 сум", (594070000, "UZS")),
        ("narxi 3 mln so'm", (300000000, "UZS")),
        ("450 ming so'm", (45000000, "UZS")),
        ("Цена 450", None),
        ("2-xonali, 3/9", None),
    ],
)
def test_extract_price(text: str, expected: tuple[int, str] | None) -> None:
    assert extract_price(text) == expected


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("2-xonali kvartira, 3/9 qavat", (2, 3, 9)),
        ("3-хонали, 5-қават 9 қаватли уйда", (3, 5, 9)),
        ("1 комн. квартира, 2/4 этаж", (1, 2, 4)),
        ("2/5/9", (2, 5, 9)),
        ("3 комн, 4 этаж из 5", (3, 4, 5)),
        ("evro remont, mebel bilan", (None, None, None)),
    ],
)
def test_extract_rooms_floors(text: str, expected: tuple[int | None, int | None, int | None]) -> None:
    assert extract_rooms_floors(text) == expected


@pytest.mark.parametrize(
    ("text", "expected"),
    [("54 m²", 54.0), ("78 кв.м", 78.0), ("32 кв.", 32.0), ("60 kv", 60.0), ("55.5 м2", 55.5), ("2-xonali", None),
     ("54 kvartirali uyda", None), ("12 kvartira sotiladi", None)],
)
def test_extract_area(text: str, expected: float | None) -> None:
    assert extract_area(text) == expected


def test_extract_phones_all_local_formats() -> None:
    text = "Tel: 90 811 24 37, +998 93 402 18 55, 998971234567, (91) 233-90-14, 90 811 24 37"
    assert extract_phones(text) == ["+998908112437", "+998934021855", "+998971234567", "+998912339014"]


def test_extract_phones_ignores_prices_and_years() -> None:
    assert extract_phones("Narxi 5 940 700 sum, 2026 yil") == []
    assert extract_phones("994000000 so'm") == []
    assert extract_phones("Narxi 999500000 сум") == []
    assert extract_phones("994000000 tys") == []
    assert extract_phones("994000000 million") == []
    assert extract_phones("994000000 mlrd") == []
    assert extract_phones("994000000 минг") == []
    assert extract_phones("994000000 млрд") == []
    assert extract_phones("tel 994000000") == ["+998994000000"]


def test_extract_username() -> None:
    assert extract_username("Риелтор Дилшод @dilshod_uy") == "dilshod_uy"
    assert extract_username("no handle here") is None


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("Egasidan, vositachilarsiz", (True, False)),
        ("Хизмат ҳақи 50%. Риелтор", (False, True)),
        ("Услуга 50%", (False, True)),
        ("Хозяин, без посредников", (True, False)),
        ("2-xonali, 3/9", (False, False)),
    ],
)
def test_extract_markers(text: str, expected: tuple[bool, bool]) -> None:
    assert extract_markers(text) == expected
```

`backend/tests/test_parse_text.py`:
```python
from pathlib import Path

from app.ingestion.parse import parse_text

POSTS = Path(__file__).parent / "fixtures" / "posts"


def test_parse_uz_latin_owner_post() -> None:
    p = parse_text((POSTS / "uz_latin_owner.txt").read_text())
    assert (p.price_amount_minor, p.price_currency) == (45000, "USD")
    assert (p.rooms, p.floor, p.total_floors, p.area_sqm) == (2, 3, 9, 54.0)
    assert p.district == "chilonzor"
    assert p.phones == ["+998908112437", "+998934021855"]
    assert (p.owner_marker, p.agent_marker) == (True, False)
    assert p.title == "Chilonzor, Qatortol, 2-xonali kvartira, 3/9 qavat, 54 m², evro remont, mebel va texnika bilan."
    assert p.parse_confidence == 1.0


def test_parse_uz_cyrillic_agent_post() -> None:
    p = parse_text((POSTS / "uz_cyrillic_agent.txt").read_text())
    assert (p.price_amount_minor, p.price_currency) == (780000000, "UZS")
    assert (p.rooms, p.floor, p.total_floors, p.area_sqm) == (3, 5, 9, 78.0)
    assert p.district == "yunusobod"
    assert p.telegram_username == "dilshod_uy"
    assert (p.owner_marker, p.agent_marker) == (False, True)


def test_parse_ru_agent_post_uses_sender_username_fallback() -> None:
    p = parse_text((POSTS / "ru_agent.txt").read_text(), sender_username="arenda_tsh")
    assert (p.price_amount_minor, p.price_currency) == (30000, "USD")
    assert (p.rooms, p.floor, p.total_floors, p.area_sqm) == (1, 2, 4, 32.0)
    assert p.district == "mirobod"
    assert p.phones == ["+998971234567"]
    assert p.telegram_username == "arenda_tsh"
    assert p.agent_marker is True


def test_structured_values_override_text() -> None:
    p = parse_text("2-xonali, 3/9, Chilonzor, 400$", structured={"rooms": 3, "price_amount_minor": 50000, "price_currency": "USD", "district": "yunusobod"})
    assert (p.rooms, p.price_amount_minor, p.district) == (3, 50000, "yunusobod")


def test_structured_none_and_partial_price_fall_back_to_text() -> None:
    text = "2-xonali, 3/9, Chilonzor, 400$"
    p = parse_text(text, structured={"price_amount_minor": 50000})
    assert (p.price_amount_minor, p.price_currency) == (40000, "USD")
    p = parse_text("2-xonali, 3/9, Chilonzor", structured={"price_amount_minor": 50000})
    assert (p.price_amount_minor, p.price_currency) == (None, None)
    p = parse_text(text, structured={"price_currency": "UZS"})
    assert (p.price_amount_minor, p.price_currency) == (40000, "USD")
    p = parse_text(text, structured={"title": None, "district": None})
    assert p.title == "2-xonali, 3/9, Chilonzor, 400$" and p.district == "chilonzor"


def test_confidence_is_low_when_little_is_found() -> None:
    p = parse_text("Ijaraga beriladi, qo'ng'iroq qiling")
    assert p.parse_confidence == 0.0
    assert p.title == "Ijaraga beriladi, qo'ng'iroq qiling"
```

- [ ] **Step 3: Run them to verify they fail**

Run: `cd backend && .venv/bin/pytest tests/test_fields.py tests/test_parse_text.py -q`
Expected: FAIL with `ImportError` / `ModuleNotFoundError`.

- [ ] **Step 4: Implement the extractors**

`backend/app/ingestion/parse/fields.py`:
```python
import re

import phonenumbers

from app.ingestion.parse.normalize import normalize, translit

_NUM = r"(?P<amt>\d{1,3}(?:[  .,]\d{3})+|\d+)(?:[.,](?P<dec>\d{1,2})(?!\d))?"
_MULT = r"(?:\s*(?P<mult>ming|tis|tys|mln|million|mlrd))?"
_USD = r"(?:\$|usd|u\.?\s?e\.?|ye\b|doll\w*)"
_UZS = r"(?:so'?m\b|sum\b|uzs\b|sўm\b)"
_PRICE_AFTER = re.compile(rf"{_NUM}{_MULT}\.?\s*(?P<cur>{_USD}|{_UZS})", re.IGNORECASE)
_PRICE_BEFORE = re.compile(rf"(?P<cur>{_USD})\s*{_NUM}{_MULT}", re.IGNORECASE)
_MULTIPLIERS = {"ming": 1_000, "tis": 1_000, "tys": 1_000, "mln": 1_000_000, "million": 1_000_000, "mlrd": 1_000_000_000}


def _amount(m: re.Match[str]) -> int:
    whole = re.sub(r"[  .,]", "", m.group("amt"))
    value = int(whole) * 100
    if m.group("dec"):
        value += int(m.group("dec").ljust(2, "0"))
    mult = m.group("mult")
    if mult:
        value *= _MULTIPLIERS[mult.lower()]
    return value


def extract_price(text: str) -> tuple[int, str] | None:
    t = translit(text)
    candidates: list[tuple[int, re.Match[str]]] = []
    for pattern in (_PRICE_AFTER, _PRICE_BEFORE):
        m = pattern.search(t)
        if m:
            candidates.append((m.start(), m))
    if not candidates:
        return None
    m = min(candidates, key=lambda c: c[0])[1]
    cur = m.group("cur")
    currency = "USD" if re.fullmatch(_USD, cur, re.IGNORECASE) else "UZS"
    return _amount(m), currency


_SHORT = re.compile(r"\b(\d)\s*/\s*(\d{1,2})\s*/\s*(\d{1,2})\b")
_ROOMS = re.compile(r"\b(\d)\s*[- ]?\s*(?:xonali|xona\b|x\.|komn\w*|k\.|kv\b|komnat\w*)")
_FLOOR_OF = re.compile(r"\b(\d{1,2})\s*/\s*(\d{1,2})\b")
_FLOOR_QAVAT = re.compile(r"\b(\d{1,2})\s*-?\s*qavat\b")
_TOTAL_QAVATLI = re.compile(r"\b(\d{1,2})\s*-?\s*qavatli\b")
_FLOOR_ETAJ = re.compile(r"\b(\d{1,2})\s*(?:-?\s*(?:y|i)?\s*)?etaj\w*(?:\s*iz\s*(\d{1,2}))?")


def extract_rooms_floors(text: str) -> tuple[int | None, int | None, int | None]:
    t = translit(text)
    if m := _SHORT.search(t):
        return int(m.group(1)), int(m.group(2)), int(m.group(3))
    rooms = int(m.group(1)) if (m := _ROOMS.search(t)) else None
    floor: int | None = None
    total: int | None = None
    if m := _FLOOR_OF.search(t):
        floor, total = int(m.group(1)), int(m.group(2))
    else:
        if m := _FLOOR_ETAJ.search(t):
            floor = int(m.group(1))
            total = int(m.group(2)) if m.group(2) else None
        if m := _FLOOR_QAVAT.search(t):
            floor = int(m.group(1))
        if m := _TOTAL_QAVATLI.search(t):
            total = int(m.group(1))
    return rooms, floor, total


_AREA = re.compile(r"\b(\d{2,3}(?:[.,]\d)?)\s*(?:m²|m2|kv\.?\s*m\b|kv\.?(?![a-z])|m\.?\s*kv\b|kvadrat)", re.IGNORECASE)


def extract_area(text: str) -> float | None:
    t = translit(text).replace("м", "m")
    m = _AREA.search(t)
    return float(m.group(1).replace(",", ".")) if m else None


_PHONE = re.compile(r"(?<!\d)(?:\+?998|8)?[\s(-]*(\d{2})[\s)-]*(\d{3})[\s-]*(\d{2})[\s-]*(\d{2})(?!\d)")
_MULT_WORDS = "|".join(sorted(_MULTIPLIERS, key=len, reverse=True))
# a digit run followed by a currency marker is a price, not a phone (checked on the original script)
_PRICED = re.compile(
    rf"^\s*(?:so'?m\b|sum\b|uzs\b|\$|usd\b|u\.?\s?e\b|у\.?\s?е\b|сум\b|сўм\b"
    rf"|минг\b|тыс\b|млн\b|млрд\b|(?:{_MULT_WORDS})\b)",
    re.IGNORECASE,
)


def extract_phones(text: str) -> list[str]:
    out: list[str] = []
    clean = normalize(text)
    for m in _PHONE.finditer(clean):
        if _PRICED.match(clean[m.end():]):
            continue
        candidate = "+998" + "".join(m.groups())
        try:
            parsed = phonenumbers.parse(candidate, "UZ")
        except phonenumbers.NumberParseException:
            continue
        if not phonenumbers.is_valid_number(parsed):
            continue
        e164 = phonenumbers.format_number(parsed, phonenumbers.PhoneNumberFormat.E164)
        if e164 not in out:
            out.append(e164)
    return out


_USERNAME = re.compile(r"@([A-Za-z][A-Za-z0-9_]{4,31})\b")


def extract_username(text: str) -> str | None:
    m = _USERNAME.search(text)
    return m.group(1) if m else None


_OWNER = re.compile(r"\b(?:egasidan|egasi\b|vositachi\w*siz|xo'?jayin\w*|xozyain\w*|sobstvennik\w*|bez\s+posrednik\w*|ot\s+xozyaina)")
_AGENT = re.compile(r"\b(?:ri[ye]ltor\w*|rieltor\w*|agent\w*|agentstv\w*|usluga\s*\d+\s*%|xizmat\s*(?:haqi\s*)?\d+\s*%|komissiya|komissi\w*)")


def extract_markers(text: str) -> tuple[bool, bool]:
    t = translit(text)
    return bool(_OWNER.search(t)), bool(_AGENT.search(t))
```

`backend/app/ingestion/parse/__init__.py`:
```python
from typing import Any

from pydantic import BaseModel

from app.ingestion.parse.districts import match_district
from app.ingestion.parse.fields import (
    extract_area,
    extract_markers,
    extract_phones,
    extract_price,
    extract_rooms_floors,
    extract_username,
)
from app.ingestion.parse.normalize import normalize


class ParsedListing(BaseModel):
    title: str
    description: str
    price_amount_minor: int | None = None
    price_currency: str | None = None
    rooms: int | None = None
    floor: int | None = None
    total_floors: int | None = None
    area_sqm: float | None = None
    district: str | None = None
    phones: list[str] = []
    telegram_username: str | None = None
    owner_marker: bool = False
    agent_marker: bool = False
    parse_confidence: float = 0.0


def _confidence(p: "ParsedListing") -> float:
    score = 0.0
    if p.price_amount_minor is not None and p.price_currency:
        score += 0.3
    if p.rooms is not None:
        score += 0.2
    if p.district:
        score += 0.15
    if p.phones or p.telegram_username:
        score += 0.15
    if p.floor is not None:
        score += 0.1
    if p.area_sqm is not None:
        score += 0.1
    return round(score, 2)


def _override[T](s: dict[str, Any], key: str, extracted: T) -> T:
    """A structured value wins only when present and not None."""
    value = s.get(key)
    return extracted if value is None else value


def parse_text(
    text: str, *, sender_username: str | None = None, structured: dict[str, Any] | None = None
) -> ParsedListing:
    s = structured or {}
    clean = normalize(text)
    first_line = text.strip().splitlines()[0].strip() if text.strip() else ""
    price = extract_price(clean)
    amount, currency = (price[0], price[1]) if price else (None, None)
    if s.get("price_amount_minor") is not None and s.get("price_currency") is not None:
        amount, currency = s["price_amount_minor"], s["price_currency"]  # atomic: never an amount without a currency
    rooms, floor, total = extract_rooms_floors(clean)
    p = ParsedListing(
        title=str(_override(s, "title", normalize(first_line)))[:200],
        description=clean,
        price_amount_minor=amount,
        price_currency=currency,
        rooms=_override(s, "rooms", rooms),
        floor=_override(s, "floor", floor),
        total_floors=_override(s, "total_floors", total),
        area_sqm=_override(s, "area_sqm", extract_area(clean)),
        district=_override(s, "district", match_district(clean)),
        phones=extract_phones(clean),
        telegram_username=extract_username(clean) or sender_username,
    )
    p.owner_marker, p.agent_marker = extract_markers(clean)
    p.parse_confidence = _confidence(p)
    return p


__all__ = [
    "ParsedListing",
    "parse_text",
    "extract_area",
    "extract_markers",
    "extract_phones",
    "extract_price",
    "extract_rooms_floors",
    "extract_username",
]
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend && .venv/bin/pytest tests/test_fields.py tests/test_parse_text.py -q`
Expected: all PASSED. Expected trouble spots and how to fix them (fix the regex, not the test): the `у.е.` marker becomes `u.e.` after transliteration; `сўм` becomes `so'm`; `кв.м` becomes `kv.m`; the phone regex must not match inside `5 940 700` — the leading `(?<!\d)` and the trailing `(?!\d)` plus `phonenumbers.is_valid_number` reject it.

- [ ] **Step 6: Lint, typecheck, commit**

```bash
make lint typecheck
git add backend
git commit -m "feat(parse): price, rooms/floors, area, phones, username and marker extraction; parse_text with confidence"
```

---

### Task 5: FX rates from the Central Bank and USD normalisation

**Files:**
- Create: `backend/app/modules/listings/fx.py`
- Test: `backend/tests/test_fx.py`

**Interfaces:**
- Consumes: `FxRate` (Task 2), `db` fixture (Task 1).
- Produces: `CBU_URL: str`; `async def fetch_cbu_rate(client: httpx.AsyncClient) -> tuple[date, Decimal]`; `async def refresh_rate(session: AsyncSession, client: httpx.AsyncClient) -> FxRate`; `async def rate_for(session: AsyncSession, day: date) -> Decimal | None` (latest rate dated ≤ `day`, else the latest rate of any date, else `None`); `def to_usd_minor(amount_minor: int | None, currency: str | None, rate: Decimal | None) -> int | None`.

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_fx.py`:
```python
from datetime import date, timedelta
from decimal import Decimal

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.listings.fx import CBU_URL, fetch_cbu_rate, rate_for, refresh_rate, to_usd_minor

CBU_BODY = [{"id": 69, "Code": "840", "Ccy": "USD", "CcyNm_UZ": "AQSH dollari", "Nominal": "1",
             "Rate": "12345.67", "Diff": "1.2", "Date": "29.08.2026"}]


def _client() -> httpx.AsyncClient:
    def handler(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == CBU_URL
        return httpx.Response(200, json=CBU_BODY)
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


async def test_fetch_cbu_rate_parses_date_and_rate() -> None:
    async with _client() as client:
        assert await fetch_cbu_rate(client) == (date(2026, 8, 29), Decimal("12345.67"))


async def test_refresh_rate_is_idempotent(db: AsyncSession) -> None:
    async with _client() as client:
        first = await refresh_rate(db, client)
        second = await refresh_rate(db, client)
    assert first.date == second.date == date(2026, 8, 29)
    assert second.usd_uzs == Decimal("12345.67")


async def test_rate_for_uses_latest_on_or_before_day_then_any(db: AsyncSession) -> None:
    async with _client() as client:
        await refresh_rate(db, client)
    assert await rate_for(db, date(2026, 8, 29)) == Decimal("12345.67")
    assert await rate_for(db, date(2026, 9, 15)) == Decimal("12345.67")
    assert await rate_for(db, date(2026, 8, 1)) == Decimal("12345.67")  # nothing earlier → latest any


async def test_rate_for_empty_table(db: AsyncSession) -> None:
    assert await rate_for(db, date.today() - timedelta(days=1)) is None


def test_to_usd_minor() -> None:
    assert to_usd_minor(45000, "USD", None) == 45000
    assert to_usd_minor(594070000, "UZS", Decimal("11881.4")) == 50000
    assert to_usd_minor(594070000, "UZS", None) is None
    assert to_usd_minor(None, "USD", None) is None
    assert to_usd_minor(100, None, Decimal("12000")) is None
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd backend && .venv/bin/pytest tests/test_fx.py -q`
Expected: FAIL with `ModuleNotFoundError: app.modules.listings.fx`

- [ ] **Step 3: Implement**

`backend/app/modules/listings/fx.py`:
```python
from datetime import UTC, date, datetime
from decimal import ROUND_HALF_UP, Decimal

import httpx
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.listings.models import FxRate

CBU_URL = "https://cbu.uz/uz/arkhiv-kursov-valyut/json/USD/"


async def fetch_cbu_rate(client: httpx.AsyncClient) -> tuple[date, Decimal]:
    response = await client.get(CBU_URL, timeout=20)
    response.raise_for_status()
    row = next(item for item in response.json() if item.get("Ccy") == "USD")
    day = datetime.strptime(row["Date"], "%d.%m.%Y").date()
    return day, Decimal(row["Rate"])


async def refresh_rate(session: AsyncSession, client: httpx.AsyncClient) -> FxRate:
    day, rate = await fetch_cbu_rate(client)
    stmt = insert(FxRate).values(date=day, usd_uzs=rate, fetched_at=datetime.now(UTC))
    stmt = stmt.on_conflict_do_update(index_elements=[FxRate.date], set_={"usd_uzs": rate, "fetched_at": datetime.now(UTC)})
    await session.execute(stmt)
    await session.flush()
    return (await session.execute(select(FxRate).where(FxRate.date == day))).scalar_one()


async def rate_for(session: AsyncSession, day: date) -> Decimal | None:
    stmt = select(FxRate.usd_uzs).where(FxRate.date <= day).order_by(FxRate.date.desc()).limit(1)
    rate = (await session.execute(stmt)).scalar_one_or_none()
    if rate is None:
        stmt = select(FxRate.usd_uzs).order_by(FxRate.date.desc()).limit(1)
        rate = (await session.execute(stmt)).scalar_one_or_none()
    return Decimal(rate) if rate is not None else None


def to_usd_minor(amount_minor: int | None, currency: str | None, rate: Decimal | None) -> int | None:
    if amount_minor is None or currency is None:
        return None
    if currency == "USD":
        return amount_minor
    if currency == "UZS" and rate:
        return int((Decimal(amount_minor) / rate).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    return None
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && .venv/bin/pytest tests/test_fx.py -q`
Expected: 5 PASSED

- [ ] **Step 5: Lint, typecheck, commit**

```bash
make lint typecheck
git add backend
git commit -m "feat(fx): daily CBU USD rate storage and USD normalisation"
```

---

### Task 6: Contacts service and listing persistence (raw → listing, seen/miss tracking)

**Files:**
- Create: `backend/app/modules/contacts/service.py`, `backend/app/modules/listings/service.py`
- Test: `backend/tests/test_contacts_service.py`, `backend/tests/test_listings_service.py`

**Interfaces:**
- Consumes: models (Task 2), `ParsedListing` (Task 4), `to_usd_minor` (Task 5).
- Produces:
  - `contacts.service.get_or_create(session, kind: str, identifier: str, display_name: str | None = None) -> Contact`
  - `contacts.service.link(session, listing_id: UUID, contact_id: UUID) -> None` (idempotent)
  - `contacts.service.contacts_for_listing(session, listing_id) -> list[Contact]`
  - `listings.service.content_hash(payload: dict) -> str`
  - `listings.service.upsert_raw(session, source_id, external_id, url, payload, fetched_at) -> tuple[RawListing, bool]` — `True` when new or the hash changed
  - `listings.service.persist_parsed(session, raw, parsed, *, posted_at, now, usd_rate, contacts: list[tuple[str, str]]) -> Listing` — idempotent on `raw.id`; links phones from `parsed.phones` (kind `phone`), `parsed.telegram_username` (kind `telegram`) and the extra `contacts` pairs
  - `@dataclass SeenWindow(ids: set[str], oldest_posted_at: datetime | None)`
  - `listings.service.mark_seen(session, source_id, window: SeenWindow, now) -> int` — resets `miss_count`, sets `last_seen_at`; returns count
  - `listings.service.apply_misses(session, source_id, window: SeenWindow, now, max_misses: int = 3) -> int` — increments `miss_count` for listings inside the window that were not seen; marks `source_removed` at `max_misses`; returns number newly removed
  - `listings.service.age_out(session, now, days: int = 30) -> int`

- [ ] **Step 1: Write the failing contact tests**

`backend/tests/test_contacts_service.py`:
```python
from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.contacts.service import contacts_for_listing, get_or_create, link
from app.modules.listings.models import Listing, RawListing, Source


async def _listing(db: AsyncSession) -> Listing:
    source = Source(kind="telegram", name="@t", config={})
    db.add(source)
    await db.flush()
    raw = RawListing(source_id=source.id, external_id="1", payload={}, content_hash="h", fetched_at=datetime.now(UTC))
    db.add(raw)
    await db.flush()
    listing = Listing(raw_listing_id=raw.id, first_seen_at=datetime.now(UTC), last_seen_at=datetime.now(UTC))
    db.add(listing)
    await db.flush()
    return listing


async def test_get_or_create_returns_same_row(db: AsyncSession) -> None:
    a = await get_or_create(db, "phone", "+998901234567")
    b = await get_or_create(db, "phone", "+998901234567", display_name="Aziz")
    assert a.id == b.id
    assert b.display_name == "Aziz"


async def test_link_is_idempotent(db: AsyncSession) -> None:
    listing = await _listing(db)
    c = await get_or_create(db, "telegram", "dilshod_uy")
    await link(db, listing.id, c.id)
    await link(db, listing.id, c.id)
    assert [x.identifier for x in await contacts_for_listing(db, listing.id)] == ["dilshod_uy"]
```

- [ ] **Step 2: Write the failing listing-service tests**

`backend/tests/test_listings_service.py`:
```python
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ingestion.parse import parse_text
from app.modules.contacts.service import contacts_for_listing
from app.modules.listings.models import Listing, Source
from app.modules.listings.service import (
    SeenWindow,
    age_out,
    apply_misses,
    content_hash,
    mark_seen,
    persist_parsed,
    upsert_raw,
)

NOW = datetime(2026, 8, 29, 12, 0, tzinfo=UTC)
TEXT = "Chilonzor, 2-xonali, 3/9, 54 m², 450$. Egasidan. Tel 90 811 24 37"


async def _source(db: AsyncSession) -> Source:
    s = Source(kind="telegram", name="@t", config={})
    db.add(s)
    await db.flush()
    return s


def test_content_hash_is_order_independent() -> None:
    assert content_hash({"a": 1, "b": [1, 2]}) == content_hash({"b": [1, 2], "a": 1})


async def test_upsert_raw_detects_new_and_changed(db: AsyncSession) -> None:
    s = await _source(db)
    raw, changed = await upsert_raw(db, s.id, "1", None, {"text": "a"}, NOW)
    assert changed is True
    same, changed = await upsert_raw(db, s.id, "1", None, {"text": "a"}, NOW + timedelta(minutes=1))
    assert (same.id, changed) == (raw.id, False)
    same, changed = await upsert_raw(db, s.id, "1", None, {"text": "b"}, NOW + timedelta(minutes=2))
    assert (same.id, changed) == (raw.id, True)
    assert same.payload == {"text": "b"}


async def test_persist_parsed_is_idempotent_and_links_contacts(db: AsyncSession) -> None:
    s = await _source(db)
    raw, _ = await upsert_raw(db, s.id, "1", "https://t.me/t/1", {"text": TEXT}, NOW)
    parsed = parse_text(TEXT, sender_username="arenda_tsh")
    listing = await persist_parsed(db, raw, parsed, posted_at=NOW, now=NOW, usd_rate=Decimal("12000"), contacts=[("olx_user", "42")])
    again = await persist_parsed(db, raw, parsed, posted_at=NOW, now=NOW + timedelta(hours=1), usd_rate=Decimal("12000"), contacts=[])
    assert listing.id == again.id
    assert again.price_usd_minor == 45000 and again.district == "chilonzor" and again.owner_marker
    assert again.last_seen_at == NOW + timedelta(hours=1) and again.first_seen_at == NOW
    identities = {(c.kind, c.identifier) for c in await contacts_for_listing(db, listing.id)}
    assert identities == {("phone", "+998908112437"), ("telegram", "arenda_tsh"), ("olx_user", "42")}


async def test_uzs_price_is_converted_with_rate(db: AsyncSession) -> None:
    s = await _source(db)
    raw, _ = await upsert_raw(db, s.id, "2", None, {"text": "x"}, NOW)
    parsed = parse_text("Yunusobod 3-xonali 6 000 000 so'm")
    listing = await persist_parsed(db, raw, parsed, posted_at=NOW, now=NOW, usd_rate=Decimal("12000"), contacts=[])
    assert listing.price_usd_minor == 50000


async def _three_listings(db: AsyncSession, s: Source) -> list[Listing]:
    out = []
    for i in range(3):
        raw, _ = await upsert_raw(db, s.id, str(i), None, {"text": str(i)}, NOW)
        posted = NOW - timedelta(days=i)
        out.append(await persist_parsed(db, raw, parse_text("2-xonali"), posted_at=posted, now=NOW, usd_rate=None, contacts=[]))
    return out


async def test_misses_remove_after_three_consecutive_runs(db: AsyncSession) -> None:
    s = await _source(db)
    listings = await _three_listings(db, s)
    window = SeenWindow(ids={"0", "1"}, oldest_posted_at=NOW - timedelta(days=2))
    for run in range(1, 4):
        t = NOW + timedelta(minutes=15 * run)
        assert await mark_seen(db, s.id, window, t) == 2
        removed = await apply_misses(db, s.id, window, t)
        await db.refresh(listings[2])
        assert listings[2].miss_count == run
        assert removed == (1 if run == 3 else 0)
    assert listings[2].source_removed and listings[2].removed_at is not None
    await db.refresh(listings[0])
    assert listings[0].miss_count == 0 and not listings[0].source_removed


async def test_listings_outside_window_are_not_counted_as_missed(db: AsyncSession) -> None:
    s = await _source(db)
    listings = await _three_listings(db, s)
    window = SeenWindow(ids={"0"}, oldest_posted_at=NOW)  # only today's post is visible
    await apply_misses(db, s.id, window, NOW)
    await db.refresh(listings[2])
    assert listings[2].miss_count == 0


async def test_seen_resets_miss_count(db: AsyncSession) -> None:
    s = await _source(db)
    listings = await _three_listings(db, s)
    await apply_misses(db, s.id, SeenWindow(ids=set(), oldest_posted_at=NOW - timedelta(days=5)), NOW)
    await mark_seen(db, s.id, SeenWindow(ids={"2"}, oldest_posted_at=None), NOW)
    await db.refresh(listings[2])
    assert listings[2].miss_count == 0


async def test_age_out_after_30_days(db: AsyncSession) -> None:
    s = await _source(db)
    await _three_listings(db, s)
    assert await age_out(db, NOW + timedelta(days=31)) == 3
    rows = (await db.execute(select(Listing).where(Listing.source_removed.is_(True)))).scalars().all()
    assert len(rows) == 3
```

- [ ] **Step 3: Run them to verify they fail**

Run: `cd backend && .venv/bin/pytest tests/test_contacts_service.py tests/test_listings_service.py -q`
Expected: FAIL with `ModuleNotFoundError`.

- [ ] **Step 4: Implement the contacts service**

`backend/app/modules/contacts/service.py`:
```python
import uuid

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.contacts.models import Contact
from app.modules.listings.models import ListingContact


async def get_or_create(
    session: AsyncSession, kind: str, identifier: str, display_name: str | None = None
) -> Contact:
    stmt = insert(Contact).values(kind=kind, identifier=identifier, display_name=display_name)
    stmt = stmt.on_conflict_do_nothing(constraint="uq_contact_identity")
    await session.execute(stmt)
    contact = (
        await session.execute(select(Contact).where(Contact.kind == kind, Contact.identifier == identifier))
    ).scalar_one()
    if display_name and contact.display_name != display_name:
        contact.display_name = display_name
        await session.flush()
    return contact


async def link(session: AsyncSession, listing_id: uuid.UUID, contact_id: uuid.UUID) -> None:
    stmt = insert(ListingContact).values(listing_id=listing_id, contact_id=contact_id).on_conflict_do_nothing()
    await session.execute(stmt)


async def contacts_for_listing(session: AsyncSession, listing_id: uuid.UUID) -> list[Contact]:
    stmt = (
        select(Contact)
        .join(ListingContact, ListingContact.contact_id == Contact.id)
        .where(ListingContact.listing_id == listing_id)
        .order_by(Contact.created_at)
    )
    return list((await session.execute(stmt)).scalars().all())
```

- [ ] **Step 5: Implement the listings service**

`backend/app/modules/listings/service.py`:
```python
import hashlib
import json
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Any, cast

from sqlalchemy import CursorResult, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.ingestion.parse import ParsedListing
from app.modules.contacts import service as contacts_service
from app.modules.listings.fx import to_usd_minor
from app.modules.listings.models import Listing, RawListing


@dataclass
class SeenWindow:
    ids: set[str]
    oldest_posted_at: datetime | None


def content_hash(payload: dict[str, Any]) -> str:
    canonical = json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(",", ":"), default=str)
    return hashlib.sha256(canonical.encode()).hexdigest()


async def upsert_raw(
    session: AsyncSession,
    source_id: uuid.UUID,
    external_id: str,
    url: str | None,
    payload: dict[str, Any],
    fetched_at: datetime,
) -> tuple[RawListing, bool]:
    digest = content_hash(payload)
    stmt = select(RawListing).where(RawListing.source_id == source_id, RawListing.external_id == external_id)
    raw = (await session.execute(stmt)).scalar_one_or_none()
    if raw is None:
        raw = RawListing(source_id=source_id, external_id=external_id, url=url, payload=payload,
                         content_hash=digest, fetched_at=fetched_at)
        session.add(raw)
        await session.flush()
        return raw, True
    changed = raw.content_hash != digest
    raw.fetched_at = fetched_at
    if changed:
        raw.payload, raw.content_hash, raw.url = payload, digest, url or raw.url
    await session.flush()
    return raw, changed


async def persist_parsed(
    session: AsyncSession,
    raw: RawListing,
    parsed: ParsedListing,
    *,
    posted_at: datetime | None,
    now: datetime,
    usd_rate: Decimal | None,
    contacts: list[tuple[str, str]] | None = None,
) -> Listing:
    extra = contacts or []
    listing = (await session.execute(select(Listing).where(Listing.raw_listing_id == raw.id))).scalar_one_or_none()
    if listing is None:
        listing = Listing(raw_listing_id=raw.id, first_seen_at=now, last_seen_at=now)
        session.add(listing)
    listing.title = parsed.title
    listing.description = parsed.description
    listing.price_amount_minor = parsed.price_amount_minor
    listing.price_currency = parsed.price_currency
    listing.price_usd_minor = to_usd_minor(parsed.price_amount_minor, parsed.price_currency, usd_rate)
    listing.rooms, listing.floor, listing.total_floors = parsed.rooms, parsed.floor, parsed.total_floors
    listing.area_sqm, listing.district = parsed.area_sqm, parsed.district
    listing.posted_at = posted_at
    listing.last_seen_at = now
    listing.miss_count = 0
    listing.owner_marker, listing.agent_marker = parsed.owner_marker, parsed.agent_marker
    listing.parse_confidence = parsed.parse_confidence
    raw.parse_error = None
    await session.flush()
    identities: list[tuple[str, str]] = [("phone", p) for p in parsed.phones]
    if parsed.telegram_username:
        identities.append(("telegram", parsed.telegram_username))
    identities.extend(extra)
    for kind, identifier in identities:
        contact = await contacts_service.get_or_create(session, kind, identifier)
        await contacts_service.link(session, listing.id, contact.id)
    await session.flush()
    return listing


async def mark_seen(session: AsyncSession, source_id: uuid.UUID, window: SeenWindow, now: datetime) -> int:
    stmt = (
        update(Listing)
        .where(Listing.raw_listing_id == RawListing.id, RawListing.source_id == source_id,
               RawListing.external_id.in_(window.ids))
        .values(last_seen_at=now, miss_count=0)
    )
    result = cast(CursorResult[Any], await session.execute(stmt))  # mypy --strict: rowcount lives on CursorResult
    return int(result.rowcount or 0)


async def apply_misses(
    session: AsyncSession, source_id: uuid.UUID, window: SeenWindow, now: datetime, max_misses: int = 3
) -> int:
    if window.oldest_posted_at is None:
        return 0
    stmt = (
        select(Listing)
        .join(RawListing, RawListing.id == Listing.raw_listing_id)
        .where(RawListing.source_id == source_id, Listing.source_removed.is_(False),
               Listing.posted_at >= window.oldest_posted_at, RawListing.external_id.not_in(window.ids))
    )
    removed = 0
    for listing in (await session.execute(stmt)).scalars().all():
        listing.miss_count += 1
        if listing.miss_count >= max_misses:
            listing.source_removed, listing.removed_at = True, now
            removed += 1
    await session.flush()
    return removed


async def age_out(session: AsyncSession, now: datetime, days: int = 30) -> int:
    cutoff = now - timedelta(days=days)
    stmt = (
        update(Listing)
        .where(Listing.source_removed.is_(False), Listing.last_seen_at < cutoff)
        .values(source_removed=True, removed_at=now)
    )
    result = cast(CursorResult[Any], await session.execute(stmt))
    return int(result.rowcount or 0)
```
The module alias is `contacts_service` on purpose: the `contacts=` keyword parameter would shadow a plain `contacts` alias inside `persist_parsed`. Also add to `backend/tests/conftest.py` (after the existing imports) the same six model-module imports that `alembic/env.py` carries — `import app.modules.identity.models`, `listings.models`, `contacts.models`, `properties.models`, `dedupe.models`, `app.worker.models` (each with `# noqa: F401`) — so a test run that touches only one module still has every table registered in `Base.metadata` (FKs to `properties` otherwise raise `NoReferencedTableError`).

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd backend && .venv/bin/pytest tests/test_contacts_service.py tests/test_listings_service.py -q`
Expected: all PASSED.

- [ ] **Step 7: Lint, typecheck, commit**

```bash
make lint typecheck
git add backend
git commit -m "feat(listings): raw upsert with change detection, idempotent listing persistence, contact linking, seen/miss and age-out"
```

---

### Task 7: Photos — resize, hash, bucket

**Files:**
- Create: `backend/app/ingestion/photos.py`, `backend/tests/helpers.py`
- Test: `backend/tests/test_photos.py`

**Interfaces:**
- Consumes: `ListingPhoto`, `Listing` (Task 2), `Settings.photo_dir` (Task 1).
- Produces: `@dataclass StoredPhoto(storage_key: str, sha256: str, phash: int, width: int, height: int)`; `store_photo(photo_dir: Path, listing_id: UUID, position: int, data: bytes, max_side: int = 1280) -> StoredPhoto`; `phash_to_signed(hex_hash: str) -> int`; `phash_bucket(phash: int) -> int` (top 16 bits, same expression as the SQL index `(phash >> 48) & 65535`); `hamming(a: int, b: int) -> int`; `async save_listing_photo(session, photo_dir, listing: Listing, position: int, data: bytes | None, error: str | None = None) -> ListingPhoto` (idempotent on `(listing_id, position)`; with `data=None` records `download_error`).

- [ ] **Step 1: Write the helper and the failing tests**

`backend/tests/helpers.py` (shared by the photo, dedupe and pipeline tests — synthetic *photo-like* images; pixel noise is not scale-stable under a perceptual hash):
```python
"""Test-only helpers shared by photo, dedupe and pipeline tests."""

import io
import random

from PIL import Image, ImageDraw


def make_jpeg(width: int, height: int, seed: int = 0) -> bytes:
    """A photo-like JPEG: a smooth gradient plus four large blocks placed by `seed`.

    The composition scales with the canvas, so one seed rendered at two sizes hashes
    alike, while different seeds give clearly different pictures.
    """
    img = Image.new("RGB", (width, height))
    draw = ImageDraw.Draw(img)
    for x in range(width):
        v = int(255 * x / max(1, width - 1))
        draw.line([(x, 0), (x, height)], fill=((v + seed * 37) % 256, 255 - v, (v // 2 + seed * 91) % 256))
    rng = random.Random(seed)
    for _ in range(4):
        x0, y0 = rng.uniform(0.0, 0.6), rng.uniform(0.0, 0.6)
        color = (rng.randrange(256), rng.randrange(256), rng.randrange(256))
        box = [int(x0 * width), int(y0 * height), int((x0 + 0.35) * width), int((y0 + 0.35) * height)]
        draw.rectangle(box, fill=color)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=90)
    return buf.getvalue()
```

`backend/tests/test_photos.py`:
```python
import uuid
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession

from app.ingestion.photos import hamming, phash_bucket, phash_to_signed, save_listing_photo, store_photo
from app.modules.listings.models import Listing, RawListing, Source
from tests.helpers import make_jpeg as _jpeg


def test_store_photo_resizes_and_hashes(tmp_path: Path) -> None:
    listing_id = uuid.uuid4()
    stored = store_photo(tmp_path, listing_id, 0, _jpeg(2000, 1000))
    assert (stored.width, stored.height) == (1280, 640)
    assert stored.storage_key == f"{listing_id}/0.jpg"
    assert (tmp_path / stored.storage_key).exists()
    assert len(stored.sha256) == 64
    assert -(1 << 63) <= stored.phash < (1 << 63)


def test_same_image_scaled_has_near_zero_hamming(tmp_path: Path) -> None:
    a = store_photo(tmp_path, uuid.uuid4(), 0, _jpeg(1600, 1200))
    b = store_photo(tmp_path, uuid.uuid4(), 0, _jpeg(800, 600))
    assert hamming(a.phash, b.phash) <= 6
    assert phash_bucket(a.phash) == phash_bucket(b.phash)


def test_different_images_are_far_apart(tmp_path: Path) -> None:
    a = store_photo(tmp_path, uuid.uuid4(), 0, _jpeg(800, 600, seed=0))
    b = store_photo(tmp_path, uuid.uuid4(), 0, _jpeg(800, 600, seed=97))
    assert hamming(a.phash, b.phash) > 10


def test_phash_signed_conversion_round_trips_bucket() -> None:
    signed = phash_to_signed("ffff000000000000")
    assert signed < 0
    assert phash_bucket(signed) == 0xFFFF
    assert phash_bucket(phash_to_signed("0001000000000000")) == 1


async def test_save_listing_photo_is_idempotent_and_records_errors(db: AsyncSession, tmp_path: Path) -> None:
    source = Source(kind="telegram", name="@t", config={})
    db.add(source)
    await db.flush()
    raw = RawListing(source_id=source.id, external_id="1", payload={}, content_hash="h", fetched_at=datetime.now(UTC))
    db.add(raw)
    await db.flush()
    listing = Listing(raw_listing_id=raw.id, first_seen_at=datetime.now(UTC), last_seen_at=datetime.now(UTC))
    db.add(listing)
    await db.flush()
    first = await save_listing_photo(db, tmp_path, listing, 0, _jpeg(400, 300))
    again = await save_listing_photo(db, tmp_path, listing, 0, _jpeg(400, 300))
    failed = await save_listing_photo(db, tmp_path, listing, 1, None, error="timeout")
    assert first.id == again.id and first.phash is not None
    assert failed.download_error == "timeout" and failed.phash is None
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd backend && .venv/bin/pytest tests/test_photos.py -q`
Expected: FAIL with `ModuleNotFoundError: app.ingestion.photos`

- [ ] **Step 3: Implement**

`backend/app/ingestion/photos.py`:
```python
import hashlib
import io
import uuid
from dataclasses import dataclass
from pathlib import Path

import imagehash
from PIL import Image
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.listings.models import Listing, ListingPhoto

_MASK = (1 << 64) - 1


@dataclass
class StoredPhoto:
    storage_key: str
    sha256: str
    phash: int
    width: int
    height: int


def phash_to_signed(hex_hash: str) -> int:
    value = int(hex_hash, 16) & _MASK
    return value - (1 << 64) if value >= (1 << 63) else value


def phash_bucket(phash: int) -> int:
    return ((phash & _MASK) >> 48) & 0xFFFF


def hamming(a: int, b: int) -> int:
    return bin((a ^ b) & _MASK).count("1")


def store_photo(photo_dir: Path, listing_id: uuid.UUID, position: int, data: bytes, max_side: int = 1280) -> StoredPhoto:
    img = Image.open(io.BytesIO(data)).convert("RGB")
    img.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)
    key = f"{listing_id}/{position}.jpg"
    target = photo_dir / key
    target.parent.mkdir(parents=True, exist_ok=True)
    img.save(target, format="JPEG", quality=85, optimize=True)
    return StoredPhoto(
        storage_key=key,
        sha256=hashlib.sha256(data).hexdigest(),
        phash=phash_to_signed(str(imagehash.phash(img))),
        width=img.width,
        height=img.height,
    )


async def save_listing_photo(
    session: AsyncSession,
    photo_dir: Path,
    listing: Listing,
    position: int,
    data: bytes | None,
    error: str | None = None,
) -> ListingPhoto:
    stmt = select(ListingPhoto).where(ListingPhoto.listing_id == listing.id, ListingPhoto.position == position)
    photo = (await session.execute(stmt)).scalar_one_or_none()
    if photo is None:
        photo = ListingPhoto(listing_id=listing.id, position=position)
        session.add(photo)
    if data is None:
        photo.download_error = error or "download failed"
    else:
        stored = store_photo(photo_dir, listing.id, position, data)
        photo.storage_key, photo.sha256, photo.phash = stored.storage_key, stored.sha256, stored.phash
        photo.width, photo.height, photo.download_error = stored.width, stored.height, None
    await session.flush()
    return photo
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && .venv/bin/pytest tests/test_photos.py -q`
Expected: 5 PASSED. If `hamming(a, b) > 10` fails for the two generated images, change `seed=97` to another seed that produces a visibly different composition (the test's purpose is "different pictures are far apart"); do not lower the threshold, it mirrors `photo_max_distance` in §5.2. The scaled-pair test must pass as written — `make_jpeg` renders the same composition at both sizes.

- [ ] **Step 5: Lint, typecheck, commit**

```bash
make lint typecheck
git add backend
git commit -m "feat(photos): rehost with resize, sha256 and perceptual hash; bucket and hamming helpers"
```

---

### Task 8: Properties service — create, attach, recompute, status events

**Files:**
- Create: `backend/app/modules/properties/service.py`
- Test: `backend/tests/test_properties_service.py`

**Interfaces:**
- Consumes: models (Task 2), `contacts_for_listing` (Task 6).
- Produces:
  - `STATUSES = ("new", "active", "inactive")`; `ACTOR_TYPES = ("crawler", "agent", "admin", "bot")`
  - `async create_from_listing(session, listing: Listing, now: datetime) -> Property` — status `new`, event `(None → new, crawler)`, attributes copied, listing attached
  - `async attach(session, prop: Property, listing: Listing, now: datetime) -> None` — sets `listing.property_id`, then `recompute`
  - `async recompute(session, prop: Property) -> None` — from all its listings: `price_usd_min_minor` = min non-null, `first_seen_at` = min, `last_seen_at` = max, attributes (`district, rooms, floor, total_floors, area_sqm`) from the listing with the highest `parse_confidence` (ties → newest `posted_at`, then newest `created_at`), `source_removed` = all listings removed, `search_vector` rebuilt from titles + descriptions + address texts
  - `async set_status(session, prop: Property, status: str, *, actor_type: str, actor_id: UUID | None = None, note: str | None = None) -> PropertyStatusEvent` — raises `ValueError` for an unknown status/actor; no-op event is still written when status is unchanged? **No**: if `status == prop.status` return the latest event without writing
  - `async status_history(session, property_id) -> list[PropertyStatusEvent]` newest first

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_properties_service.py`:
```python
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.ingestion.parse import parse_text
from app.modules.listings.models import Listing, Source
from app.modules.listings.service import persist_parsed, upsert_raw
from app.modules.properties.service import (
    attach,
    create_from_listing,
    recompute,
    set_status,
    status_history,
)

NOW = datetime(2026, 8, 29, 12, 0, tzinfo=UTC)


async def _listing(db: AsyncSession, source: Source, ext: str, text_: str, posted: datetime, now: datetime = NOW) -> Listing:
    raw, _ = await upsert_raw(db, source.id, ext, None, {"text": text_}, now)
    return await persist_parsed(db, raw, parse_text(text_), posted_at=posted, now=now, usd_rate=None, contacts=[])


async def _source(db: AsyncSession) -> Source:
    s = Source(kind="telegram", name="@t", config={})
    db.add(s)
    await db.flush()
    return s


async def test_create_from_listing_sets_new_status_and_event(db: AsyncSession) -> None:
    s = await _source(db)
    listing = await _listing(db, s, "1", "Chilonzor 2-xonali 3/9 54 m² 450$", NOW)
    prop = await create_from_listing(db, listing, NOW)
    assert prop.status == "new" and listing.property_id == prop.id
    assert (prop.district, prop.rooms, prop.floor, prop.total_floors, prop.area_sqm) == ("chilonzor", 2, 3, 9, 54.0)
    assert prop.price_usd_min_minor == 45000
    history = await status_history(db, prop.id)
    assert [(e.from_status, e.to_status, e.actor_type) for e in history] == [(None, "new", "crawler")]


async def test_attach_recomputes_min_price_and_best_attributes(db: AsyncSession) -> None:
    s = await _source(db)
    first = await _listing(db, s, "1", "Chilonzor 2-xonali 3/9 480$", NOW - timedelta(days=2))
    prop = await create_from_listing(db, first, NOW)
    second = await _listing(db, s, "2", "Chilonzor 2-xonali 3/9 54 m² 450$ tel 90 811 24 37", NOW)
    await attach(db, prop, second, NOW)
    assert prop.price_usd_min_minor == 45000
    assert prop.area_sqm == 54.0  # from the higher-confidence listing
    assert prop.first_seen_at == NOW - timedelta(days=2) or prop.first_seen_at == NOW
    assert prop.last_seen_at == NOW


async def test_recompute_flags_source_removed_only_when_all_listings_removed(db: AsyncSession) -> None:
    s = await _source(db)
    a = await _listing(db, s, "1", "2-xonali", NOW)
    prop = await create_from_listing(db, a, NOW)
    b = await _listing(db, s, "2", "2-xonali", NOW)
    await attach(db, prop, b, NOW)
    a.source_removed = True
    await recompute(db, prop)
    assert prop.source_removed is False
    b.source_removed = True
    await recompute(db, prop)
    assert prop.source_removed is True


async def test_search_vector_is_built(db: AsyncSession) -> None:
    s = await _source(db)
    a = await _listing(db, s, "1", "Chilonzor Qatortol evro remont", NOW)
    prop = await create_from_listing(db, a, NOW)
    hit = (await db.execute(text("SELECT 1 FROM properties WHERE id = :id AND search_vector @@ plainto_tsquery('simple', 'qatortol')"), {"id": prop.id})).first()
    assert hit is not None


async def test_set_status_writes_event_and_rejects_unknown(db: AsyncSession) -> None:
    s = await _source(db)
    prop = await create_from_listing(db, await _listing(db, s, "1", "2-xonali", NOW), NOW)
    agent = uuid.uuid4()
    ev = await set_status(db, prop, "active", actor_type="agent", actor_id=agent, note="bo'sh")
    assert (prop.status, ev.from_status, ev.to_status, ev.actor_id) == ("active", "new", "active", agent)
    same = await set_status(db, prop, "active", actor_type="agent", actor_id=agent)
    assert same.id == ev.id
    with pytest.raises(ValueError):
        await set_status(db, prop, "rented", actor_type="agent")
    with pytest.raises(ValueError):
        await set_status(db, prop, "inactive", actor_type="visitor")
    assert [e.to_status for e in await status_history(db, prop.id)] == ["active", "new"]
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd backend && .venv/bin/pytest tests/test_properties_service.py -q`
Expected: FAIL with `ModuleNotFoundError: app.modules.properties.service`

- [ ] **Step 3: Implement**

`backend/app/modules/properties/service.py`:
```python
import uuid
from datetime import datetime

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.listings.models import Listing
from app.modules.properties.models import Property, PropertyStatusEvent

STATUSES = ("new", "active", "inactive")
ACTOR_TYPES = ("crawler", "agent", "admin", "bot")


async def _listings_of(session: AsyncSession, prop: Property) -> list[Listing]:
    stmt = select(Listing).where(Listing.property_id == prop.id)
    return list((await session.execute(stmt)).scalars().all())


async def recompute(session: AsyncSession, prop: Property) -> None:
    listings = await _listings_of(session, prop)
    if not listings:
        return
    best = max(listings, key=lambda l: (l.parse_confidence, l.posted_at or l.created_at, l.created_at))
    prop.district, prop.rooms, prop.floor = best.district, best.rooms, best.floor
    prop.total_floors, prop.area_sqm = best.total_floors, best.area_sqm
    prices = [l.price_usd_minor for l in listings if l.price_usd_minor is not None]
    prop.price_usd_min_minor = min(prices) if prices else None
    prop.first_seen_at = min(l.first_seen_at for l in listings)
    prop.last_seen_at = max(l.last_seen_at for l in listings)
    prop.source_removed = all(l.source_removed for l in listings)
    corpus = " ".join(f"{l.title} {l.description} {l.address_text or ''}" for l in listings)
    await session.flush()
    await session.execute(
        text("UPDATE properties SET search_vector = to_tsvector('simple', unaccent(:corpus)) WHERE id = :id"),
        {"corpus": corpus, "id": prop.id},
    )


async def attach(session: AsyncSession, prop: Property, listing: Listing, now: datetime) -> None:
    listing.property_id = prop.id
    await session.flush()
    await recompute(session, prop)


async def create_from_listing(session: AsyncSession, listing: Listing, now: datetime) -> Property:
    prop = Property(status="new", first_seen_at=listing.first_seen_at, last_seen_at=listing.last_seen_at)
    session.add(prop)
    await session.flush()
    session.add(PropertyStatusEvent(property_id=prop.id, from_status=None, to_status="new", actor_type="crawler"))
    await attach(session, prop, listing, now)
    return prop


async def status_history(session: AsyncSession, property_id: uuid.UUID) -> list[PropertyStatusEvent]:
    stmt = (
        select(PropertyStatusEvent)
        .where(PropertyStatusEvent.property_id == property_id)
        .order_by(PropertyStatusEvent.created_at.desc(), PropertyStatusEvent.id.desc())
    )
    return list((await session.execute(stmt)).scalars().all())


async def set_status(
    session: AsyncSession,
    prop: Property,
    status: str,
    *,
    actor_type: str,
    actor_id: uuid.UUID | None = None,
    note: str | None = None,
) -> PropertyStatusEvent:
    if status not in STATUSES:
        raise ValueError(f"unknown status {status!r}")
    if actor_type not in ACTOR_TYPES:
        raise ValueError(f"unknown actor_type {actor_type!r}")
    if status == prop.status:
        return (await status_history(session, prop.id))[0]
    event = PropertyStatusEvent(
        property_id=prop.id, from_status=prop.status, to_status=status,
        actor_type=actor_type, actor_id=actor_id, note=note,
    )
    prop.status = status
    session.add(event)
    await session.flush()
    return event
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && .venv/bin/pytest tests/test_properties_service.py -q`
Expected: 5 PASSED

- [ ] **Step 5: Lint, typecheck, commit**

```bash
make lint typecheck
git add backend
git commit -m "feat(properties): create from listing, attach with recompute, append-only status changes"
```

---

### Task 9: Dedupe — config, blocking, scoring, assignment

**Files:**
- Create: `backend/config/dedupe.yaml`, `backend/app/modules/dedupe/config.py`, `backend/app/modules/dedupe/blocking.py`, `backend/app/modules/dedupe/scoring.py`, `backend/app/modules/dedupe/service.py`
- Test: `backend/tests/test_dedupe_scoring.py`, `backend/tests/test_dedupe_service.py`

**Interfaces:**
- Consumes: models (Task 2), `hamming`, `phash_bucket` (Task 7), `create_from_listing`, `attach` (Task 8), `contacts_for_listing` (Task 6).
- Produces:
  - `DedupeConfig(BaseModel)` fields: `weights: dict[str, float]` (keys `contact, photo, description, rooms_floors, area, price`), `photo_max_distance: int`, `description_min_similarity: float`, `area_tolerance: float`, `price_tolerance: float`, `merge_threshold: float`, `review_threshold: float`; `load_config(path: Path) -> DedupeConfig`
  - `@dataclass ScoreInput(shared_contact: bool, min_photo_distance: int | None, description_similarity: float | None, rooms_floors_equal: bool, area_ratio: float | None, price_ratio: float | None)`
  - `@dataclass ScoreBreakdown(total: float, parts: dict[str, float])`; `score(inp: ScoreInput, cfg: DedupeConfig) -> ScoreBreakdown` (pure)
  - `async find_candidates(session, listing: Listing) -> list[Property]` (excludes `listing.property_id`)
  - `async gather_inputs(session, listing: Listing, prop: Property) -> ScoreInput`
  - `@dataclass AssignResult(property: Property, decision: str, score: float, candidate: Property | None)` with `decision in {"attached", "review", "new"}`
  - `async assign(session, listing: Listing, cfg: DedupeConfig, now: datetime) -> AssignResult` — idempotent: a listing that already has a property is returned as `("attached", 1.0)` without rescoring

- [ ] **Step 1: The config file**

`backend/config/dedupe.yaml`:
```yaml
# Dedupe weights and thresholds — spec §5.2. Change here, never in code.
weights:
  contact: 0.50
  photo: 0.30
  description: 0.15
  rooms_floors: 0.10
  area: 0.05
  price: 0.05
photo_max_distance: 10
description_min_similarity: 0.6
area_tolerance: 0.05
price_tolerance: 0.10
merge_threshold: 0.75
review_threshold: 0.50
```

- [ ] **Step 2: Write the failing pure-scoring tests**

`backend/tests/test_dedupe_scoring.py`:
```python
from pathlib import Path

from app.modules.dedupe.config import DedupeConfig, load_config
from app.modules.dedupe.scoring import ScoreInput, score

CFG = load_config(Path(__file__).resolve().parents[1] / "config" / "dedupe.yaml")


def test_config_loads_spec_values() -> None:
    assert CFG.weights["contact"] == 0.5 and CFG.merge_threshold == 0.75 and CFG.review_threshold == 0.5


def _inp(**kw: object) -> ScoreInput:
    base: dict[str, object] = dict(shared_contact=False, min_photo_distance=None, description_similarity=None,
                                   rooms_floors_equal=False, area_ratio=None, price_ratio=None)
    base.update(kw)
    return ScoreInput(**base)  # type: ignore[arg-type]


def test_nothing_in_common_scores_zero() -> None:
    assert score(_inp(), CFG).total == 0.0


def test_full_match_sums_to_one_point_fifteen() -> None:
    s = score(_inp(shared_contact=True, min_photo_distance=0, description_similarity=0.9,
                   rooms_floors_equal=True, area_ratio=1.0, price_ratio=1.0), CFG)
    assert round(s.total, 2) == 1.15
    assert s.parts == {"contact": 0.5, "photo": 0.3, "description": 0.15, "rooms_floors": 0.1, "area": 0.05, "price": 0.05}


def test_photo_distance_boundary() -> None:
    assert score(_inp(min_photo_distance=10), CFG).parts["photo"] == 0.3
    assert score(_inp(min_photo_distance=11), CFG).parts["photo"] == 0.0


def test_description_similarity_boundary() -> None:
    assert score(_inp(description_similarity=0.6), CFG).parts["description"] == 0.15
    assert score(_inp(description_similarity=0.59), CFG).parts["description"] == 0.0


def test_area_and_price_tolerances() -> None:
    assert score(_inp(area_ratio=0.96), CFG).parts["area"] == 0.05
    assert score(_inp(area_ratio=0.94), CFG).parts["area"] == 0.0
    assert score(_inp(price_ratio=1.10), CFG).parts["price"] == 0.05
    assert score(_inp(price_ratio=1.11), CFG).parts["price"] == 0.0


def test_spec_example_scores_0_65() -> None:
    # Chilonzor pair from the mockups: different phones, 2 similar photos, description 0.71, rooms/floors equal, area 54 vs 55, $450 vs $480
    s = score(_inp(min_photo_distance=6, description_similarity=0.71, rooms_floors_equal=True,
                   area_ratio=55 / 54, price_ratio=480 / 450), CFG)
    assert round(s.total, 2) == 0.65


def test_custom_config() -> None:
    cfg = DedupeConfig(weights={"contact": 1.0, "photo": 0, "description": 0, "rooms_floors": 0, "area": 0, "price": 0},
                       photo_max_distance=10, description_min_similarity=0.6, area_tolerance=0.05,
                       price_tolerance=0.1, merge_threshold=0.9, review_threshold=0.5)
    assert score(_inp(shared_contact=True), cfg).total == 1.0
```

- [ ] **Step 3: Run them to verify they fail**

Run: `cd backend && .venv/bin/pytest tests/test_dedupe_scoring.py -q`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 4: Implement config and pure scoring**

`backend/app/modules/dedupe/config.py`:
```python
from pathlib import Path

import yaml
from pydantic import BaseModel


class DedupeConfig(BaseModel):
    weights: dict[str, float]
    photo_max_distance: int
    description_min_similarity: float
    area_tolerance: float
    price_tolerance: float
    merge_threshold: float
    review_threshold: float


def load_config(path: Path) -> DedupeConfig:
    with path.open() as fh:
        return DedupeConfig.model_validate(yaml.safe_load(fh))
```

`backend/app/modules/dedupe/scoring.py`:
```python
from dataclasses import dataclass

from app.modules.dedupe.config import DedupeConfig


@dataclass
class ScoreInput:
    shared_contact: bool
    min_photo_distance: int | None
    description_similarity: float | None
    rooms_floors_equal: bool
    area_ratio: float | None
    price_ratio: float | None


@dataclass
class ScoreBreakdown:
    total: float
    parts: dict[str, float]


def _within(ratio: float | None, tolerance: float) -> bool:
    return ratio is not None and abs(ratio - 1.0) <= tolerance + 1e-9


def score(inp: ScoreInput, cfg: DedupeConfig) -> ScoreBreakdown:
    w = cfg.weights
    parts = {
        "contact": w["contact"] if inp.shared_contact else 0.0,
        "photo": w["photo"] if inp.min_photo_distance is not None and inp.min_photo_distance <= cfg.photo_max_distance else 0.0,
        "description": w["description"] if inp.description_similarity is not None and inp.description_similarity >= cfg.description_min_similarity else 0.0,
        "rooms_floors": w["rooms_floors"] if inp.rooms_floors_equal else 0.0,
        "area": w["area"] if _within(inp.area_ratio, cfg.area_tolerance) else 0.0,
        "price": w["price"] if _within(inp.price_ratio, cfg.price_tolerance) else 0.0,
    }
    return ScoreBreakdown(total=round(sum(parts.values()), 4), parts=parts)
```

- [ ] **Step 5: Run the scoring tests to verify they pass**

Run: `cd backend && .venv/bin/pytest tests/test_dedupe_scoring.py -q`
Expected: 8 PASSED

- [ ] **Step 6: Write the failing DB-level dedupe tests**

`backend/tests/test_dedupe_service.py`:
```python
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ingestion.parse import parse_text
from app.ingestion.photos import save_listing_photo
from app.modules.dedupe.blocking import find_candidates
from app.modules.dedupe.config import load_config
from app.modules.dedupe.models import DedupeReview
from app.modules.dedupe.service import assign, gather_inputs
from app.modules.listings.models import Listing, Source
from app.modules.listings.service import persist_parsed, upsert_raw
from app.modules.properties.service import create_from_listing
from tests.helpers import make_jpeg

NOW = datetime(2026, 8, 29, 12, 0, tzinfo=UTC)
CFG = load_config(Path(__file__).resolve().parents[1] / "config" / "dedupe.yaml")


def _jpeg(seed: int) -> bytes:
    return make_jpeg(400, 300, seed)


async def _source(db: AsyncSession) -> Source:
    s = Source(kind="telegram", name="@t", config={})
    db.add(s)
    await db.flush()
    return s


async def _listing(db: AsyncSession, source: Source, ext: str, text_: str, photo_seed: int | None = None, tmp: Path | None = None) -> Listing:
    raw, _ = await upsert_raw(db, source.id, ext, None, {"text": text_}, NOW)
    listing = await persist_parsed(db, raw, parse_text(text_), posted_at=NOW, now=NOW, usd_rate=None, contacts=[])
    if photo_seed is not None and tmp is not None:
        await save_listing_photo(db, tmp, listing, 0, _jpeg(photo_seed))
    return listing


OWNER_TEXT = "Chilonzor, Qatortol, 2-xonali, 3/9 qavat, 54 m², evro remont, mebel va texnika bilan, uzoq muddatga, faqat oilaga. 450$. Tel 90 811 24 37"
AGENT_TEXT = "Chilonzor Qatortol 2 xonali 3/9 qavat 55 m² evro remont mebel texnika bor uzoq muddat oila uchun 480$ xizmat 50% tel 93 402 18 55"
OTHER_TEXT = "Yunusobod 11-kvartal 3-xonali 5/9 78 m² 650$ tel 94 128 44 60"


async def test_same_phone_blocks_and_merges(db: AsyncSession) -> None:
    s = await _source(db)
    a = await _listing(db, s, "1", OWNER_TEXT)
    prop = await create_from_listing(db, a, NOW)
    b = await _listing(db, s, "2", "Chilonzor 2-xonali 3/9 460$ tel 90 811 24 37")
    assert [p.id for p in await find_candidates(db, b)] == [prop.id]
    result = await assign(db, b, CFG, NOW)
    assert result.decision == "attached" and result.property.id == prop.id
    assert b.property_id == prop.id and prop.price_usd_min_minor == 45000


async def test_review_range_creates_separate_property_and_review_row(db: AsyncSession, tmp_path: Path) -> None:
    s = await _source(db)
    a = await _listing(db, s, "1", OWNER_TEXT, photo_seed=1, tmp=tmp_path)
    prop = await create_from_listing(db, a, NOW)
    b = await _listing(db, s, "2", AGENT_TEXT, photo_seed=1, tmp=tmp_path)  # same photo, different phone
    inp = await gather_inputs(db, b, prop)
    assert inp.shared_contact is False and inp.min_photo_distance is not None and inp.min_photo_distance <= 10
    assert inp.rooms_floors_equal is True
    result = await assign(db, b, CFG, NOW)
    assert result.decision == "review" and result.property.id != prop.id and result.candidate is not None
    assert 0.5 <= result.score < 0.75
    review = (await db.execute(select(DedupeReview).where(DedupeReview.listing_id == b.id))).scalar_one()
    assert review.candidate_property_id == prop.id and review.breakdown["photo"] == 0.3


async def test_unrelated_listing_becomes_new_property(db: AsyncSession) -> None:
    s = await _source(db)
    a = await _listing(db, s, "1", OWNER_TEXT)
    await create_from_listing(db, a, NOW)
    b = await _listing(db, s, "2", OTHER_TEXT)
    assert await find_candidates(db, b) == []
    result = await assign(db, b, CFG, NOW)
    assert result.decision == "new" and result.score == 0.0


async def test_assign_is_idempotent_for_attached_listing(db: AsyncSession) -> None:
    s = await _source(db)
    a = await _listing(db, s, "1", OWNER_TEXT)
    first = await assign(db, a, CFG, NOW)
    second = await assign(db, a, CFG, NOW)
    assert first.decision == "new" and second.decision == "attached" and second.property.id == first.property.id


async def test_attribute_key_blocks_without_phone_or_photo(db: AsyncSession) -> None:
    s = await _source(db)
    a = await _listing(db, s, "1", "Chilonzor 2-xonali 3/9 54 m² 450$")
    prop = await create_from_listing(db, a, NOW)
    b = await _listing(db, s, "2", "Chilonzor 2 xonali 3/9 qavat 54 kv 455$")
    assert [p.id for p in await find_candidates(db, b)] == [prop.id]
```

- [ ] **Step 7: Run them to verify they fail**

Run: `cd backend && .venv/bin/pytest tests/test_dedupe_service.py -q`
Expected: FAIL with `ModuleNotFoundError: app.modules.dedupe.blocking`

- [ ] **Step 8: Implement blocking and the service**

`backend/app/modules/dedupe/blocking.py`:
```python
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ingestion.photos import phash_bucket
from app.modules.listings.models import Listing, ListingContact, ListingPhoto
from app.modules.properties.models import Property


async def find_candidates(session: AsyncSession, listing: Listing) -> list[Property]:
    conditions = []

    contact_ids = select(ListingContact.contact_id).where(ListingContact.listing_id == listing.id)
    conditions.append(
        Listing.id.in_(select(ListingContact.listing_id).where(ListingContact.contact_id.in_(contact_ids)))
    )

    hashes = (
        await session.execute(select(ListingPhoto.phash).where(ListingPhoto.listing_id == listing.id, ListingPhoto.phash.is_not(None)))
    ).scalars().all()
    buckets = {phash_bucket(h) for h in hashes}
    if buckets:
        bucket_expr = (ListingPhoto.phash.op(">>")(48)).op("&")(65535)
        conditions.append(
            Listing.id.in_(select(ListingPhoto.listing_id).where(ListingPhoto.phash.is_not(None), bucket_expr.in_(buckets)))
        )

    if all(v is not None for v in (listing.district, listing.rooms, listing.floor, listing.total_floors)):
        conditions.append(
            and_(Listing.district == listing.district, Listing.rooms == listing.rooms,
                 Listing.floor == listing.floor, Listing.total_floors == listing.total_floors)
        )

    stmt = (
        select(Property)
        .join(Listing, Listing.property_id == Property.id)
        .where(or_(*conditions), Listing.id != listing.id, Listing.property_id.is_not(None))
        .distinct()
    )
    if listing.property_id is not None:
        stmt = stmt.where(Property.id != listing.property_id)
    return list((await session.execute(stmt)).scalars().all())
```

`backend/app/modules/dedupe/service.py`:
```python
import re
import uuid
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ingestion.photos import hamming
from app.modules.contacts.service import contacts_for_listing
from app.modules.dedupe.blocking import find_candidates
from app.modules.dedupe.config import DedupeConfig
from app.modules.dedupe.models import DedupeReview
from app.modules.dedupe.scoring import ScoreBreakdown, ScoreInput, score
from app.modules.listings.models import Listing, ListingContact, ListingPhoto
from app.modules.properties.models import Property
from app.modules.properties.service import attach, create_from_listing

_STRIP = re.compile(r"(\+?\d[\d\s()-]{6,}\d)|([\$€]\s?\d[\d\s.,]*)|(\d[\d\s.,]*\s*(?:\$|so'm|сум|сўм|у\.е\.?|usd))|[\U0001F300-\U0001FAFF☀-➿]", re.IGNORECASE)


def strip_for_similarity(text: str) -> str:
    return re.sub(r"\s+", " ", _STRIP.sub(" ", text)).strip().lower()


@dataclass
class AssignResult:
    property: Property
    decision: str  # attached | review | new
    score: float
    candidate: Property | None


async def _property_listings(session: AsyncSession, prop: Property) -> list[Listing]:
    return list((await session.execute(select(Listing).where(Listing.property_id == prop.id))).scalars().all())


async def gather_inputs(session: AsyncSession, listing: Listing, prop: Property) -> ScoreInput:
    others = await _property_listings(session, prop)
    other_ids = [o.id for o in others]

    my_contacts = {c.id for c in await contacts_for_listing(session, listing.id)}
    their_contacts = set(
        (await session.execute(select(ListingContact.contact_id).where(ListingContact.listing_id.in_(other_ids)))).scalars().all()
    )
    shared_contact = bool(my_contacts & their_contacts)

    my_hashes = (await session.execute(select(ListingPhoto.phash).where(ListingPhoto.listing_id == listing.id, ListingPhoto.phash.is_not(None)))).scalars().all()
    their_hashes = (await session.execute(select(ListingPhoto.phash).where(ListingPhoto.listing_id.in_(other_ids), ListingPhoto.phash.is_not(None)))).scalars().all()
    distances = [hamming(a, b) for a in my_hashes for b in their_hashes]
    min_photo_distance = min(distances) if distances else None

    mine = strip_for_similarity(listing.description)
    similarity: float | None = None
    if mine and others:
        sims = [
            (await session.execute(select(func.similarity(mine, strip_for_similarity(o.description))))).scalar_one()
            for o in others if o.description
        ]
        similarity = max(sims) if sims else None

    rooms_floors_equal = (
        listing.rooms is not None and listing.floor is not None and listing.total_floors is not None
        and (listing.rooms, listing.floor, listing.total_floors) == (prop.rooms, prop.floor, prop.total_floors)
    )
    area_ratio = listing.area_sqm / prop.area_sqm if listing.area_sqm and prop.area_sqm else None
    price_ratio = listing.price_usd_minor / prop.price_usd_min_minor if listing.price_usd_minor and prop.price_usd_min_minor else None
    return ScoreInput(shared_contact, min_photo_distance, similarity, rooms_floors_equal, area_ratio, price_ratio)


async def assign(session: AsyncSession, listing: Listing, cfg: DedupeConfig, now: datetime) -> AssignResult:
    if listing.property_id is not None:
        prop = (await session.execute(select(Property).where(Property.id == listing.property_id))).scalar_one()
        return AssignResult(prop, "attached", 1.0, None)

    best: tuple[float, Property, ScoreBreakdown] | None = None
    for candidate in await find_candidates(session, listing):
        breakdown = score(await gather_inputs(session, listing, candidate), cfg)
        if best is None or breakdown.total > best[0]:
            best = (breakdown.total, candidate, breakdown)

    if best is not None and best[0] >= cfg.merge_threshold:
        await attach(session, best[1], listing, now)
        return AssignResult(best[1], "attached", best[0], None)

    prop = await create_from_listing(session, listing, now)
    if best is not None and best[0] >= cfg.review_threshold:
        session.add(DedupeReview(listing_id=listing.id, candidate_property_id=best[1].id, score=best[0], breakdown=best[2].parts))
        await session.flush()
        return AssignResult(prop, "review", best[0], best[1])
    return AssignResult(prop, "new", best[0] if best else 0.0, None)
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `cd backend && .venv/bin/pytest tests/test_dedupe_service.py tests/test_dedupe_scoring.py -q`
Expected: all PASSED. Note `func.similarity` is `pg_trgm`'s `similarity(text, text)` — installed by migration 0000.

- [ ] **Step 10: Lint, typecheck, commit**

```bash
make lint typecheck
git add backend
git commit -m "feat(dedupe): yaml config, blocking by contact/photo bucket/attributes, weighted scoring, assign with review rows"
```

---

### Task 10: Contact scoring and probable owner

**Files:**
- Create: `backend/app/modules/contacts/scoring.py`
- Test: `backend/tests/test_contact_scoring.py`

**Interfaces:**
- Consumes: models (Task 2), `contacts_for_listing` (Task 6).
- Produces:
  - `agency_score(distinct_properties: int, agent_marker: bool, owner_marker: bool, earliest_in_property: bool, lowest_price_in_property: bool) -> float` (pure, clamped 0–1)
  - `classify(score: float) -> str` → `agent` (≥ 0.6) | `owner` (≤ 0.3) | `unknown`
  - `async rescore_contact(session, contact: Contact, now: datetime) -> Contact` — recomputes `distinct_property_count_90d`, `agency_score`, `classification` (a `human_decision` of `owner`/`agent` wins and forces score 0.0/1.0)
  - `async rescore_for_listing(session, listing: Listing, now: datetime) -> None` — rescores every contact of the listing
  - `async update_probable_owner(session, prop: Property) -> None` — sets `probable_owner_contact_id` to the lowest-scoring contact across the property's listings and `owner_confidence = 1 − score`

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_contact_scoring.py`:
```python
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.ingestion.parse import parse_text
from app.modules.contacts.models import Contact
from app.modules.contacts.scoring import (
    agency_score,
    classify,
    rescore_contact,
    rescore_for_listing,
    update_probable_owner,
)
from app.modules.contacts.service import contacts_for_listing
from app.modules.listings.models import Listing, Source
from app.modules.listings.service import persist_parsed, upsert_raw
from app.modules.properties.service import attach, create_from_listing

NOW = datetime(2026, 8, 29, 12, 0, tzinfo=UTC)


@pytest.mark.parametrize(
    ("args", "expected"),
    [
        ((1, False, False, False, False), 0.0),
        ((3, False, False, False, False), 0.3),
        ((6, False, False, False, False), 0.6),
        ((12, False, False, False, False), 0.6),
        ((1, True, False, False, False), 0.3),
        ((6, True, False, False, False), 0.9),
        ((1, False, True, True, True), 0.0),
        ((3, False, True, False, False), 0.0),
        ((6, True, True, True, True), 0.4),
    ],
)
def test_agency_score(args: tuple[int, bool, bool, bool, bool], expected: float) -> None:
    assert agency_score(*args) == pytest.approx(expected)


def test_classify() -> None:
    assert classify(0.6) == "agent" and classify(0.3) == "owner" and classify(0.45) == "unknown"


async def _source(db: AsyncSession) -> Source:
    s = Source(kind="telegram", name="@t", config={})
    db.add(s)
    await db.flush()
    return s


async def _listing(db: AsyncSession, s: Source, ext: str, text_: str, posted: datetime = NOW) -> Listing:
    raw, _ = await upsert_raw(db, s.id, ext, None, {"text": text_}, NOW)
    return await persist_parsed(db, raw, parse_text(text_), posted_at=posted, now=NOW, usd_rate=None, contacts=[])


async def test_phone_on_many_properties_becomes_agent(db: AsyncSession) -> None:
    s = await _source(db)
    for i in range(6):
        listing = await _listing(db, s, str(i), f"Yunusobod {i + 1}-kvartal 2-xonali 3/9 400$ tel 93 402 18 55")
        await create_from_listing(db, listing, NOW)
    contact = (await contacts_for_listing(db, listing.id))[0]
    await rescore_contact(db, contact, NOW)
    assert contact.distinct_property_count_90d == 6
    assert contact.classification == "agent" and contact.agency_score == pytest.approx(0.6)


async def test_owner_markers_and_posting_order_pick_probable_owner(db: AsyncSession) -> None:
    s = await _source(db)
    owner = await _listing(db, s, "1", "Chilonzor 2-xonali 3/9 54 m² 450$ egasidan tel 90 811 24 37", NOW - timedelta(days=2))
    prop = await create_from_listing(db, owner, NOW)
    agent = await _listing(db, s, "2", "Chilonzor 2-xonali 3/9 55 m² 480$ xizmat 50% tel 93 402 18 55", NOW)
    await attach(db, prop, agent, NOW)
    await rescore_for_listing(db, owner, NOW)
    await rescore_for_listing(db, agent, NOW)
    await update_probable_owner(db, prop)
    owner_contact = (await contacts_for_listing(db, owner.id))[0]
    assert prop.probable_owner_contact_id == owner_contact.id
    assert prop.owner_confidence == pytest.approx(1.0)
    assert owner_contact.classification == "owner"


async def test_human_decision_wins(db: AsyncSession) -> None:
    s = await _source(db)
    listing = await _listing(db, s, "1", "Sergeli 2-xonali 1/5 350$ rieltor tel 90 555 31 08")
    await create_from_listing(db, listing, NOW)
    contact: Contact = (await contacts_for_listing(db, listing.id))[0]
    contact.human_decision = "owner"
    await rescore_contact(db, contact, NOW)
    assert (contact.classification, contact.agency_score) == ("owner", 0.0)
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd backend && .venv/bin/pytest tests/test_contact_scoring.py -q`
Expected: FAIL with `ModuleNotFoundError: app.modules.contacts.scoring`

- [ ] **Step 3: Implement**

`backend/app/modules/contacts/scoring.py`:
```python
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.contacts.models import Contact
from app.modules.contacts.service import contacts_for_listing
from app.modules.listings.models import Listing, ListingContact
from app.modules.properties.models import Property


def agency_score(
    distinct_properties: int,
    agent_marker: bool,
    owner_marker: bool,
    earliest_in_property: bool,
    lowest_price_in_property: bool,
) -> float:
    if distinct_properties >= 6:
        s = 0.6
    elif distinct_properties >= 3:
        s = 0.3
    else:
        s = 0.0
    if agent_marker:
        s += 0.3
    if owner_marker:
        s -= 0.3
    if earliest_in_property:
        s -= 0.1
    if lowest_price_in_property:
        s -= 0.1
    return round(min(1.0, max(0.0, s)), 4)


def classify(score: float) -> str:
    if score >= 0.6:
        return "agent"
    if score <= 0.3:
        return "owner"
    return "unknown"


async def _listings_of_contact(session: AsyncSession, contact: Contact, since: datetime) -> list[Listing]:
    stmt = (
        select(Listing)
        .join(ListingContact, ListingContact.listing_id == Listing.id)
        .where(ListingContact.contact_id == contact.id, Listing.last_seen_at >= since)
    )
    return list((await session.execute(stmt)).scalars().all())


async def _earliest_and_cheapest_flags(session: AsyncSession, listing: Listing) -> tuple[bool, bool]:
    if listing.property_id is None:
        return True, True
    siblings = list((await session.execute(select(Listing).where(Listing.property_id == listing.property_id))).scalars().all())
    posted = [s.posted_at for s in siblings if s.posted_at is not None]
    earliest = listing.posted_at is not None and listing.posted_at == min(posted) if posted else False
    prices = [s.price_usd_minor for s in siblings if s.price_usd_minor is not None]
    cheapest = listing.price_usd_minor is not None and listing.price_usd_minor == min(prices) if prices else False
    return earliest, cheapest


async def rescore_contact(session: AsyncSession, contact: Contact, now: datetime) -> Contact:
    listings = await _listings_of_contact(session, contact, now - timedelta(days=90))
    contact.distinct_property_count_90d = len({l.property_id for l in listings if l.property_id is not None})
    if contact.human_decision in ("owner", "agent"):
        contact.classification = contact.human_decision
        contact.agency_score = 0.0 if contact.human_decision == "owner" else 1.0
        await session.flush()
        return contact
    agent_marker = any(l.agent_marker for l in listings)
    owner_marker = any(l.owner_marker for l in listings)
    earliest = cheapest = False
    for listing in listings:
        e, c = await _earliest_and_cheapest_flags(session, listing)
        earliest, cheapest = earliest or e, cheapest or c
    contact.agency_score = agency_score(contact.distinct_property_count_90d, agent_marker, owner_marker, earliest, cheapest)
    contact.classification = classify(contact.agency_score)
    await session.flush()
    return contact


async def rescore_for_listing(session: AsyncSession, listing: Listing, now: datetime) -> None:
    for contact in await contacts_for_listing(session, listing.id):
        await rescore_contact(session, contact, now)


async def update_probable_owner(session: AsyncSession, prop: Property) -> None:
    stmt = (
        select(Contact)
        .join(ListingContact, ListingContact.contact_id == Contact.id)
        .join(Listing, Listing.id == ListingContact.listing_id)
        .where(Listing.property_id == prop.id)
        .order_by(Contact.agency_score.asc(), Contact.created_at.asc())
        .limit(1)
    )
    best = (await session.execute(stmt)).scalar_one_or_none()
    prop.probable_owner_contact_id = best.id if best else None
    prop.owner_confidence = round(1.0 - best.agency_score, 4) if best else None
    await session.flush()
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && .venv/bin/pytest tests/test_contact_scoring.py -q`
Expected: all PASSED.

- [ ] **Step 5: Lint, typecheck, commit**

```bash
make lint typecheck
git add backend
git commit -m "feat(contacts): agency scoring, classification, human decision override and probable owner"
```

---

### Task 11: Adapter protocol and the ingestion pipeline

**Files:**
- Create: `backend/app/ingestion/adapters/__init__.py`, `backend/app/ingestion/adapters/base.py`, `backend/app/ingestion/pipeline.py`
- Test: `backend/tests/test_pipeline.py`

**Interfaces:**
- Consumes: everything above — `upsert_raw`, `persist_parsed`, `mark_seen`, `apply_misses` (Task 6), `parse_text` (Task 4), `rate_for` (Task 5), `save_listing_photo` (Task 7), `assign` + `load_config` (Task 9), `rescore_for_listing`, `update_probable_owner` (Task 10), `recompute` (Task 8), `CrawlRun`, `Source` (Task 2).
- Produces (M0-2 adapters implement this; M0-3 API calls `ingest_payload` for pasted links):
  - `@dataclass RawRef(external_id: str, url: str | None, posted_at: datetime | None, meta: dict[str, Any])`
  - `@dataclass RawPayload(external_id: str, url: str | None, posted_at: datetime | None, text: str, structured: dict[str, Any] | None, sender_username: str | None, contact_hints: list[tuple[str, str]], photo_refs: list[Any], payload: dict[str, Any])`
  - `SeenWindow` is re-exported from `app.modules.listings.service`
  - `class SourceAdapter(Protocol)`: `kind: str`; `discover(source: Source) -> AsyncIterator[RawRef]`; `fetch(ref: RawRef) -> RawPayload`; `seen_window(source: Source) -> SeenWindow | None`; `download_photo(ref: Any) -> bytes`
  - `@dataclass IngestResult(listing: Listing, property: Property, created: bool, changed: bool, decision: str)`
  - `async ingest_payload(session, source: Source, payload: RawPayload, *, adapter: SourceAdapter | None, cfg: DedupeConfig, photo_dir: Path, now: datetime, max_photos: int = 10) -> IngestResult`
  - `async run_source(session, adapter: SourceAdapter, source: Source, *, cfg: DedupeConfig, photo_dir: Path, now: datetime) -> CrawlRun` — one `crawl_runs` row; each ref in its own savepoint; unchanged raw payloads are skipped (counted in `found`, not `changed`); seen/miss applied from `seen_window`; removed properties recomputed; `source.last_run_at`, `next_run_at`, `consecutive_failures`, `status` updated; exceptions inside a ref are counted in `failed` and logged, never raised; an exception in `discover` itself marks the run failed and re-raises after recording it

- [ ] **Step 1: Write the failing pipeline tests**

`backend/tests/test_pipeline.py`:
```python
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ingestion.adapters.base import RawPayload, RawRef
from app.ingestion.pipeline import ingest_payload, run_source
from app.modules.dedupe.config import load_config
from app.modules.listings.models import CrawlRun, Listing, ListingPhoto, RawListing, Source
from app.modules.listings.service import SeenWindow
from app.modules.properties.models import Property
from tests.helpers import make_jpeg

NOW = datetime(2026, 8, 29, 12, 0, tzinfo=UTC)
CFG = load_config(Path(__file__).resolve().parents[1] / "config" / "dedupe.yaml")


def _jpeg(seed: int = 1) -> bytes:
    return make_jpeg(300, 200, seed)


class FakeAdapter:
    kind = "telegram"

    def __init__(self, payloads: list[RawPayload], window: SeenWindow | None, fail_ids: set[str] | None = None) -> None:
        self.payloads = payloads
        self.window = window
        self.fail_ids = fail_ids or set()
        self.downloads = 0

    async def discover(self, source: Source) -> AsyncIterator[RawRef]:
        for p in self.payloads:
            yield RawRef(external_id=p.external_id, url=p.url, posted_at=p.posted_at, meta={})

    async def fetch(self, ref: RawRef) -> RawPayload:
        if ref.external_id in self.fail_ids:
            raise RuntimeError("boom")
        return next(p for p in self.payloads if p.external_id == ref.external_id)

    async def seen_window(self, source: Source) -> SeenWindow | None:
        return self.window

    async def download_photo(self, ref: Any) -> bytes:
        self.downloads += 1
        if ref == "bad":
            raise RuntimeError("404")
        return _jpeg(int(ref))


def _payload(ext: str, text: str, posted: datetime = NOW, photos: list[Any] | None = None, username: str | None = None) -> RawPayload:
    return RawPayload(external_id=ext, url=f"https://t.me/t/{ext}", posted_at=posted, text=text, structured=None,
                      sender_username=username, contact_hints=[], photo_refs=photos or [], payload={"text": text, "id": ext})


async def _source(db: AsyncSession) -> Source:
    s = Source(kind="telegram", name="@t", config={"peer": "@t"}, interval_seconds=900)
    db.add(s)
    await db.flush()
    return s


OWNER = "Chilonzor, Qatortol, 2-xonali, 3/9 qavat, 54 m², evro remont. Egasidan. 450$. Tel 90 811 24 37"
AGENT = "Chilonzor Qatortol 2 xonali 3/9 qavat 55 m² evro remont 480$ xizmat 50% tel 93 402 18 55"
OTHER = "Yunusobod 11-kvartal 3-xonali 5/9 78 m² 650$ tel 94 128 44 60"


async def test_ingest_payload_creates_listing_property_photos_and_owner(db: AsyncSession, tmp_path: Path) -> None:
    s = await _source(db)
    adapter = FakeAdapter([], None)
    result = await ingest_payload(db, s, _payload("1", OWNER, photos=["1", "2", "bad"]), adapter=adapter, cfg=CFG, photo_dir=tmp_path, now=NOW)
    assert result.created and result.decision == "new" and result.property.status == "new"
    photos = (await db.execute(select(ListingPhoto).where(ListingPhoto.listing_id == result.listing.id).order_by(ListingPhoto.position))).scalars().all()
    assert [p.download_error is None for p in photos] == [True, True, False]
    assert result.property.probable_owner_contact_id is not None and result.property.district == "chilonzor"


async def test_run_source_end_to_end_with_dedupe(db: AsyncSession, tmp_path: Path) -> None:
    s = await _source(db)
    adapter = FakeAdapter(
        [
            _payload("1", OWNER, NOW - timedelta(days=1), photos=["1"]),
            _payload("2", AGENT, NOW, photos=["1"]),                         # same photo, other phone → review
            _payload("2b", "Chilonzor 2-xonali 3/9 455$ tel 90 811 24 37", NOW),  # same phone as 1 → attached
            _payload("3", OTHER, NOW),
        ],
        SeenWindow(ids={"1", "2", "2b", "3"}, oldest_posted_at=NOW - timedelta(days=1)),
    )
    run = await run_source(db, adapter, s, cfg=CFG, photo_dir=tmp_path, now=NOW)
    assert (run.found, run.new, run.changed, run.failed, run.removed) == (4, 4, 0, 0, 0)
    assert (await db.execute(select(func.count()).select_from(Property))).scalar_one() == 3
    owner_listing = (await db.execute(select(Listing).join(RawListing).where(RawListing.external_id == "1"))).scalar_one()
    attached = (await db.execute(select(Listing).join(RawListing).where(RawListing.external_id == "2b"))).scalar_one()
    assert attached.property_id == owner_listing.property_id
    await db.refresh(s)
    assert s.last_run_at == NOW and s.next_run_at == NOW + timedelta(seconds=900) and s.status == "ok"


async def test_second_run_skips_unchanged_and_updates_changed(db: AsyncSession, tmp_path: Path) -> None:
    s = await _source(db)
    window = SeenWindow(ids={"1"}, oldest_posted_at=NOW - timedelta(days=1))
    first = await run_source(db, FakeAdapter([_payload("1", OWNER)], window), s, cfg=CFG, photo_dir=tmp_path, now=NOW)
    second = await run_source(db, FakeAdapter([_payload("1", OWNER)], window), s, cfg=CFG, photo_dir=tmp_path, now=NOW + timedelta(minutes=15))
    third = await run_source(db, FakeAdapter([_payload("1", OWNER.replace("450$", "430$"))], window), s, cfg=CFG, photo_dir=tmp_path, now=NOW + timedelta(minutes=30))
    assert (first.new, second.new, second.changed, third.changed) == (1, 0, 0, 1)
    assert (await db.execute(select(func.count()).select_from(Listing))).scalar_one() == 1
    listing = (await db.execute(select(Listing))).scalar_one()
    assert listing.price_usd_minor == 43000


async def test_failed_ref_does_not_stop_the_run(db: AsyncSession, tmp_path: Path) -> None:
    s = await _source(db)
    adapter = FakeAdapter([_payload("1", OWNER), _payload("2", OTHER)], None, fail_ids={"1"})
    run = await run_source(db, adapter, s, cfg=CFG, photo_dir=tmp_path, now=NOW)
    assert (run.found, run.new, run.failed) == (2, 1, 1)
    assert (await db.execute(select(func.count()).select_from(Listing))).scalar_one() == 1


async def test_removed_after_three_runs_and_property_flagged(db: AsyncSession, tmp_path: Path) -> None:
    s = await _source(db)
    seen = SeenWindow(ids={"1"}, oldest_posted_at=NOW - timedelta(days=1))
    await run_source(db, FakeAdapter([_payload("1", OWNER)], seen), s, cfg=CFG, photo_dir=tmp_path, now=NOW)
    gone = SeenWindow(ids=set(), oldest_posted_at=NOW - timedelta(days=1))
    for i in range(1, 4):
        run = await run_source(db, FakeAdapter([], gone), s, cfg=CFG, photo_dir=tmp_path, now=NOW + timedelta(minutes=15 * i))
    assert run.removed == 1
    prop = (await db.execute(select(Property))).scalar_one()
    assert prop.source_removed is True and prop.status == "new"


async def test_discover_failure_is_recorded(db: AsyncSession, tmp_path: Path) -> None:
    class Broken(FakeAdapter):
        async def discover(self, source: Source) -> AsyncIterator[RawRef]:
            raise RuntimeError("flood")
            yield  # pragma: no cover

    s = await _source(db)
    try:
        await run_source(db, Broken([], None), s, cfg=CFG, photo_dir=tmp_path, now=NOW)
    except RuntimeError:
        pass
    run = (await db.execute(select(CrawlRun))).scalar_one()
    await db.refresh(s)
    assert run.error == "flood" and run.finished_at is not None
    assert s.consecutive_failures == 1 and s.status == "failing"
```
- [ ] **Step 2: Run them to verify they fail**

Run: `cd backend && .venv/bin/pytest tests/test_pipeline.py -q`
Expected: FAIL with `ModuleNotFoundError: app.ingestion.adapters.base`

- [ ] **Step 3: Implement the adapter base**

`backend/app/ingestion/adapters/__init__.py`: empty.

`backend/app/ingestion/adapters/base.py`:
```python
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Protocol

from app.modules.listings.models import Source
from app.modules.listings.service import SeenWindow


@dataclass
class RawRef:
    external_id: str
    url: str | None
    posted_at: datetime | None
    meta: dict[str, Any] = field(default_factory=dict)


@dataclass
class RawPayload:
    external_id: str
    url: str | None
    posted_at: datetime | None
    text: str
    structured: dict[str, Any] | None
    sender_username: str | None
    contact_hints: list[tuple[str, str]]
    photo_refs: list[Any]
    payload: dict[str, Any]


class SourceAdapter(Protocol):
    kind: str

    def discover(self, source: Source) -> AsyncIterator[RawRef]: ...

    async def fetch(self, ref: RawRef) -> RawPayload: ...

    async def seen_window(self, source: Source) -> SeenWindow | None: ...

    async def download_photo(self, ref: Any) -> bytes: ...


__all__ = ["RawPayload", "RawRef", "SeenWindow", "SourceAdapter"]
```

- [ ] **Step 4: Implement the pipeline**

`backend/app/ingestion/pipeline.py`:
```python
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ingestion.adapters.base import RawPayload, SourceAdapter
from app.ingestion.parse import parse_text
from app.ingestion.photos import save_listing_photo
from app.modules.contacts.scoring import rescore_for_listing, update_probable_owner
from app.modules.dedupe.config import DedupeConfig
from app.modules.dedupe.service import assign
from app.modules.listings.fx import rate_for
from app.modules.listings.models import CrawlRun, Listing, RawListing, Source
from app.modules.listings.service import apply_misses, mark_seen, persist_parsed, upsert_raw
from app.modules.properties.models import Property
from app.modules.properties.service import recompute

log = structlog.get_logger()


@dataclass
class IngestResult:
    listing: Listing
    property: Property
    created: bool
    changed: bool
    decision: str


async def ingest_payload(
    session: AsyncSession,
    source: Source,
    payload: RawPayload,
    *,
    adapter: SourceAdapter | None,
    cfg: DedupeConfig,
    photo_dir: Path,
    now: datetime,
    max_photos: int = 10,
) -> IngestResult:
    raw, changed = await upsert_raw(session, source.id, payload.external_id, payload.url, payload.payload, now)
    existing = (await session.execute(select(Listing).where(Listing.raw_listing_id == raw.id))).scalar_one_or_none()
    created = existing is None

    day = (payload.posted_at or now).date()
    rate = await rate_for(session, day)
    parsed = parse_text(payload.text, sender_username=payload.sender_username, structured=payload.structured)
    listing = await persist_parsed(session, raw, parsed, posted_at=payload.posted_at, now=now, usd_rate=rate,
                                   contacts=payload.contact_hints)

    if adapter is not None and (created or changed):
        for position, ref in enumerate(payload.photo_refs[:max_photos]):
            try:
                data = await adapter.download_photo(ref)
            except Exception as exc:  # noqa: BLE001 — a photo must never block the listing (§10)
                await save_listing_photo(session, photo_dir, listing, position, None, error=str(exc)[:500])
                continue
            await save_listing_photo(session, photo_dir, listing, position, data)

    result = await assign(session, listing, cfg, now)
    if not created and result.decision == "attached":
        await recompute(session, result.property)
    await rescore_for_listing(session, listing, now)
    await update_probable_owner(session, result.property)
    return IngestResult(listing=listing, property=result.property, created=created, changed=changed, decision=result.decision)


async def run_source(
    session: AsyncSession,
    adapter: SourceAdapter,
    source: Source,
    *,
    cfg: DedupeConfig,
    photo_dir: Path,
    now: datetime,
) -> CrawlRun:
    run = CrawlRun(source_id=source.id, started_at=now)
    session.add(run)
    await session.flush()
    try:
        async for ref in adapter.discover(source):
            run.found += 1
            try:
                async with session.begin_nested():
                    existing = (
                        await session.execute(
                            select(RawListing).where(RawListing.source_id == source.id, RawListing.external_id == ref.external_id)
                        )
                    ).scalar_one_or_none()
                    payload = await adapter.fetch(ref)
                    result = await ingest_payload(session, source, payload, adapter=adapter, cfg=cfg, photo_dir=photo_dir, now=now)
                    if existing is None:
                        run.new += 1
                    elif result.changed:
                        run.changed += 1
            except Exception as exc:  # noqa: BLE001 — one bad post never stops the batch (§10)
                run.failed += 1
                log.warning("ingest_failed", source=source.name, external_id=ref.external_id, error=str(exc))

        window = await adapter.seen_window(source)
        if window is not None:
            await mark_seen(session, source.id, window, now)
            run.removed = await apply_misses(session, source.id, window, now)
            if run.removed:
                affected = (
                    await session.execute(
                        select(Property).join(Listing, Listing.property_id == Property.id).join(RawListing, RawListing.id == Listing.raw_listing_id)
                        .where(RawListing.source_id == source.id, Listing.source_removed.is_(True)).distinct()
                    )
                ).scalars().all()
                for prop in affected:
                    await recompute(session, prop)
        source.consecutive_failures = 0
        source.status = "ok"
    except Exception as exc:  # noqa: BLE001
        run.error = str(exc)[:1000]
        source.consecutive_failures += 1
        source.status = "failing"
        if source.consecutive_failures >= 3:
            source.paused_until = now + timedelta(hours=1)
        run.finished_at = now
        source.last_run_at = now
        source.next_run_at = now + timedelta(seconds=source.interval_seconds)
        await session.flush()
        raise
    run.finished_at = now
    source.last_run_at = now
    source.next_run_at = now + timedelta(seconds=source.interval_seconds)
    await session.flush()
    return run
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend && .venv/bin/pytest tests/test_pipeline.py -q`
Expected: 6 PASSED. Then the whole suite: `make test` — Expected: everything green.

- [ ] **Step 6: Lint, typecheck, commit**

```bash
make lint typecheck
git add backend
git commit -m "feat(ingestion): adapter protocol and pipeline — raw, parse, persist, photos, dedupe, owner, crawl runs, removal"
```

---

## Plan self-review

- **Spec coverage.** §2 processes/DB — Task 1; §3.1 adapter interface — Task 11 (`SourceAdapter`); §3.5 removal detection (3 misses, 30-day age-out, property flag) — Tasks 6, 8, 11; §4 parsing rules and confidence — Tasks 3–4; §5.1–5.2 blocking, weights, thresholds, merge recompute — Tasks 8–9; §5.3 contacts and probable owner — Tasks 6, 10; §6 tables, indexes, append-only trigger — Task 2; §7 status model — Task 8; §10 error handling (savepoints, run records, failures counted) — Task 11; §12 tests without network, real PostgreSQL — Task 1 fixtures. Not in this plan by design: §3.2–3.4 adapters, worker loop and CLI (M0-2), §8 API (M0-3), §9 web (M0-4), §11 deployment (M0-4).
- **Placeholders.** None — every step carries the code or the exact command.
- **Type consistency.** `persist_parsed(..., contacts=...)` keyword is used identically in Tasks 6, 8, 9, 10, 11; `SeenWindow(ids, oldest_posted_at)` in Tasks 6 and 11; `assign(session, listing, cfg, now) -> AssignResult(property, decision, score, candidate)` in Tasks 9 and 11; `phash` is a signed `bigint` everywhere and the SQL bucket `((phash >> 48) & 65535)` in Task 2 matches `phash_bucket` in Task 7 and the `op(">>")` expression in Task 9.
