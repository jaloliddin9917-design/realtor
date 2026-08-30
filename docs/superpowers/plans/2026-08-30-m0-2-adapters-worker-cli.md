# M0-2 Adapters, Worker and CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the M0-1 pipeline fetch real listings — a Telegram adapter, an OLX adapter, manual ingestion by link/form, a worker loop that runs sources on schedule with daily maintenance jobs, and a CLI for users, sources, one-off runs, re-parsing and Telegram login — while closing the follow-ups the M0-1 whole-branch review left for this plan.

**Architecture:** Adapters implement the `SourceAdapter` protocol from `backend/app/ingestion/adapters/base.py` and never touch the database; the pipeline (`run_source`) drives them. OLX is JSON-driven: the list page's embedded `__PRERENDERED_STATE__` gives 52 ads per page (ids, timestamps, params, photos) for discovery and removal detection; the detail page's state is the canonical payload (original price currency, description); the phone endpoint is best-effort. Telegram uses a Telethon user session behind a tiny client protocol so tests use a fake client. The worker is one asyncio loop, one session per source run, commit-always (the pipeline's transaction contract), plus daily jobs at 03:00 Tashkent. No Redis, no queue.

**Tech Stack:** Python 3.12, existing backend (SQLAlchemy 2 async, Alembic, pydantic-settings, structlog), `httpx` (already a dependency) with browser headers for OLX and photo downloads, `telethon>=1.36`, `typer>=0.15` (already a dependency) for the CLI, pytest against real PostgreSQL. Scrapling is **deferred**: OLX serves full pages to plain httpx today (verified 2026-08-30); `StealthyFetcher` is the documented upgrade path if that changes.

**Spec:** `docs/superpowers/specs/2026-08-29-m0-fetch-everything-design.md` §3 (ingestion), §10 (errors), §11 (operations). **Prerequisite:** plan M0-1 merged (`main` at `33f8f8e` or later, 149 tests).

## Global Constraints

- Python `>=3.12,<3.13`; `uv`; `ruff check`, `ruff format --check`, `mypy --strict app` and `alembic check` (`make check-migrations`) must pass before every commit.
- Adapters never open a database session; they read `source.config`, read/write `source.state` **by reassignment** (`source.state = {**source.state, ...}` — JSONB is not mutation-tracked), and yield `RawRef`/`RawPayload` with timezone-aware datetimes (§ base.py docstrings).
- Raw payloads are stored verbatim; every adapter can rebuild a `RawPayload` from a stored `raw_listings.payload` (`rebuild_payload`) so `reparse` never touches the network.
- Network access only inside adapters and the daily FX job; tests never touch the network (fake clients / recorded fixtures under `backend/tests/fixtures/`).
- OLX request budget: ≥ 2 s between requests (jittered), browser `User-Agent`, `Accept-Language: ru,uz;q=0.8`; 403/429 → raise `AdapterBackoff` (exponential 1 min → 32 min, level kept in `source.state["backoff_level"]`); the circuit breaker in `run_source` (3 failed runs → 1 h pause) stays as is.
- Telegram: obey `FloodWaitError` exactly (raise `AdapterBackoff(seconds)`); `AuthKeyUnregisteredError`/`SessionRevokedError`/`UserDeactivatedBanError` → raise `LoginRequired` (source status `login_required`, paused 1 h); the session file lives at `settings.telegram_session_path` and is never committed.
- Worker: one session per source run; **commit after `run_source` returns AND after it raises** (see `pipeline.py` module docstring); sequential source runs; heartbeat row `worker_heartbeat(name="worker")` every tick and `name="daily"` after the daily jobs.
- Statuses stay `new | active | inactive`; nothing in this plan writes `active`/`inactive` (that is M1's bot and M0-3's API).
- Docker on this machine: use the system daemon (`export DOCKER_HOST=unix:///var/run/docker.sock`); the dev/test PostgreSQL runs there on localhost:5432; `make` is not installed here — run `backend/.venv/bin/*` directly.
- Commit trailers: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01FaiSj2uQts7dvqkGSrWTm7`.

## Parallelism map (for subagent-driven execution)

Task 1 (schema + dedupe/photos backlog) → Task 2 (pipeline lifecycle + protocol extensions) → then **Task 3 (HTTP client), Task 4 (OLX), Task 5 (Telegram) can run in parallel worktrees** (they touch disjoint files; 4 and 5 depend only on 2 and 3's `ingestion/http.py` — 5 does not need 3) → Task 6 (manual ingestion, needs 4 + 5) → Task 7 (registry + worker, needs 4 + 5) → Task 8 (CLI, needs 6 + 7). Use the worktree recipe from M0-1: `git worktree add .worktrees/<task> -b m0-2-<task>`, own `backend/.venv` (`uv venv --python 3.12 && uv pip install -e ".[dev]"`), own test DB via `backend/.env` (`TEST_DATABASE_URL=...realtor_test_<task>`), rebase + fast-forward after review.

---

## File structure (what this plan creates or modifies)

```
backend/
├── alembic/versions/0002_m0_2_indexes.py       # listing_contacts(contact_id) index; unique (listing_id, position)
├── pyproject.toml                               # + telethon
├── .env.example                                 # + worker/telegram/olx keys
├── app/
│   ├── core/settings.py                         # + worker/telegram/olx settings
│   ├── cli.py                                   # typer app: create-user, add-source, list-sources, run-source, reparse, telegram-login, add-listing
│   ├── ingestion/
│   │   ├── adapters/base.py                     # + AdapterBackoff, LoginRequired, ListingGone, rebuild_payload
│   │   ├── http.py                              # HttpClient protocol, HttpxClient, RateLimiter, BackoffState
│   │   ├── adapters/olx/__init__.py             # OlxAdapter
│   │   ├── adapters/olx/state.py                # extract_state(html), parse_list_state, parse_ad
│   │   ├── adapters/telegram/__init__.py        # TelegramAdapter
│   │   ├── adapters/telegram/client.py          # TelegramClientLike protocol, make_client, Msg dataclass
│   │   ├── manual.py                            # ingest_url, ingest_form, ensure_manual_source
│   │   ├── registry.py                          # build_adapters(settings) -> AdapterRegistry
│   │   └── pipeline.py                          # + ListingGone / AdapterBackoff / LoginRequired handling; photo orphan cleanup
│   ├── modules/
│   │   ├── dedupe/blocking.py                   # bounded, ordered candidates
│   │   ├── dedupe/service.py                    # single-query trigram similarity
│   │   ├── contacts/scoring.py                  # + rescore_property_contacts, rescore_all
│   │   ├── listings/service.py                  # age_out returns affected property ids
│   │   └── listings/models.py                   # __table_args__ for the new index/unique
│   ├── ingestion/photos.py                      # EXIF transpose, close, prune_photos
│   └── worker/
│       ├── loop.py                              # tick(), run_due_sources(), daily_jobs(), main()
│       └── __main__.py                          # python -m app.worker
└── tests/
    ├── fixtures/olx/{list_page.html, detail_page.html, README.md}   # recorded 2026-08-30, anonymised (already committed with this plan)
    ├── fixtures/telegram/messages.json          # created in Task 5
    ├── test_m0_2_backlog.py, test_pipeline_lifecycle.py, test_http.py, test_olx_adapter.py,
    │   test_telegram_adapter.py, test_manual.py, test_worker.py, test_cli.py
```

---

### Task 1: Backlog from the M0-1 review — indexes, bounded blocking, single-query similarity, EXIF-safe photos

**Files:**
- Create: `backend/alembic/versions/0002_m0_2_indexes.py`
- Modify: `backend/app/modules/listings/models.py` (`ListingContact.__table_args__`, `ListingPhoto.__table_args__`), `backend/app/modules/dedupe/blocking.py`, `backend/app/modules/dedupe/service.py`, `backend/app/ingestion/photos.py`
- Test: `backend/tests/test_m0_2_backlog.py`

**Interfaces:**
- Consumes: everything from M0-1 as it exists on `main` (`find_candidates(session, listing) -> list[Property]`, `gather_inputs(session, listing, prop) -> ScoreInput`, `store_photo(...)`, `save_listing_photo(...)`, `tests/helpers.py::make_jpeg`).
- Produces: unchanged signatures; behavioural guarantees — `find_candidates` returns at most `MAX_CANDIDATES = 50` properties ordered by `Property.last_seen_at DESC, Property.id`; `gather_inputs` computes description similarity with one SQL round-trip; `store_photo` applies EXIF orientation and closes the image; new DB constraints `uq_listing_photos_listing_position` and index `ix_listing_contacts_contact_id`.

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_m0_2_backlog.py`:
```python
import io
from datetime import UTC, datetime, timedelta
from pathlib import Path

from PIL import Image
from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.ingestion.parse import parse_text
from app.ingestion.photos import store_photo
from app.modules.dedupe.blocking import MAX_CANDIDATES, find_candidates
from app.modules.dedupe.service import gather_inputs
from app.modules.listings.models import Listing, Source
from app.modules.listings.service import persist_parsed, upsert_raw
from app.modules.properties.service import create_from_listing

NOW = datetime(2026, 8, 30, 12, 0, tzinfo=UTC)


async def _source(db: AsyncSession) -> Source:
    s = Source(kind="telegram", name="@t", config={})
    db.add(s)
    await db.flush()
    return s


async def _listing(db: AsyncSession, s: Source, ext: str, text_: str, now: datetime = NOW) -> Listing:
    raw, _ = await upsert_raw(db, s.id, ext, None, {"text": text_}, now)
    return await persist_parsed(db, raw, parse_text(text_), posted_at=now, now=now, usd_rate=None, contacts=[])


async def test_new_index_and_unique_exist(db: AsyncSession) -> None:
    idx = {r[0] for r in (await db.execute(text("SELECT indexname FROM pg_indexes WHERE tablename IN ('listing_contacts','listing_photos')"))).all()}
    assert "ix_listing_contacts_contact_id" in idx
    assert "uq_listing_photos_listing_position" in idx


async def test_find_candidates_is_bounded_and_ordered(db: AsyncSession) -> None:
    s = await _source(db)
    # 60 properties sharing one agency phone, seen at different times
    for i in range(60):
        listing = await _listing(db, s, str(i), f"Yunusobod {i}-kvartal 2-xonali 3/9 400$ tel 93 402 18 55", NOW - timedelta(hours=i))
        await create_from_listing(db, listing, NOW - timedelta(hours=i))
    probe = await _listing(db, s, "probe", "Chilonzor 2-xonali 3/9 420$ tel 93 402 18 55")
    candidates = await find_candidates(db, probe)
    assert len(candidates) == MAX_CANDIDATES == 50
    seen = [c.last_seen_at for c in candidates]
    assert seen == sorted(seen, reverse=True)  # newest first


async def test_similarity_is_one_query(db: AsyncSession) -> None:
    s = await _source(db)
    a = await _listing(db, s, "1", "Chilonzor Qatortol 2-xonali evro remont mebel texnika bilan uzoq muddatga")
    prop = await create_from_listing(db, a, NOW)
    for i in range(3):
        sib = await _listing(db, s, f"sib{i}", f"Chilonzor Qatortol 2-xonali evro remont mebel texnika bilan {i}")
        sib.property_id = prop.id
    await db.flush()
    b = await _listing(db, s, "2", "Chilonzor Qatortol 2 xonali evro remont mebel texnika bor uzoq muddat")
    statements: list[str] = []

    def _record(conn, cursor, statement, parameters, context, executemany):  # type: ignore[no-untyped-def]
        statements.append(statement)

    conn = await db.connection()
    event.listen(conn.sync_connection, "before_cursor_execute", _record)
    try:
        inp = await gather_inputs(db, b, prop)
    finally:
        event.remove(conn.sync_connection, "before_cursor_execute", _record)
    assert inp.description_similarity is not None and inp.description_similarity > 0.5
    assert sum("similarity(" in st for st in statements) == 1


def _jpeg_with_orientation(tmp: Path) -> bytes:
    img = Image.new("RGB", (400, 200), (200, 30, 30))
    exif = img.getexif()
    exif[0x0112] = 6  # Orientation: rotate 90° CW on display
    buf = io.BytesIO()
    img.save(buf, format="JPEG", exif=exif.tobytes())
    return buf.getvalue()


def test_store_photo_applies_exif_orientation(tmp_path: Path) -> None:
    import uuid

    stored = store_photo(tmp_path, uuid.uuid4(), 0, _jpeg_with_orientation(tmp_path))
    assert (stored.width, stored.height) == (200, 400)  # transposed
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd backend && .venv/bin/pytest tests/test_m0_2_backlog.py -q`
Expected: FAIL — `ImportError: cannot import name 'MAX_CANDIDATES'`; after adding it, the index test fails (no migration) and the orientation test reports `(400, 200)`.

- [ ] **Step 3: Migration and model constraints**

`backend/app/modules/listings/models.py` — add to `ListingContact`:
```python
    __table_args__ = (Index("ix_listing_contacts_contact_id", "contact_id"),)
```
and to `ListingPhoto.__table_args__` (keep the existing bucket `Index`):
```python
        UniqueConstraint("listing_id", "position", name="uq_listing_photos_listing_position"),
```
`backend/alembic/versions/0002_m0_2_indexes.py`:
```python
"""m0-2 indexes: listing_contacts(contact_id), unique listing_photos(listing_id, position)

Revision ID: 0002
Revises: 0001
Create Date: 2026-08-30
"""
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index("ix_listing_contacts_contact_id", "listing_contacts", ["contact_id"])
    op.create_unique_constraint("uq_listing_photos_listing_position", "listing_photos", ["listing_id", "position"])


def downgrade() -> None:
    op.drop_constraint("uq_listing_photos_listing_position", "listing_photos", type_="unique")
    op.drop_index("ix_listing_contacts_contact_id", table_name="listing_contacts")
```
Run: `cd backend && DATABASE_URL=postgresql+asyncpg://realtor:realtor@localhost:5432/realtor .venv/bin/alembic upgrade head && DATABASE_URL=postgresql+asyncpg://realtor:realtor@localhost:5432/realtor .venv/bin/alembic check`
Expected: `No new upgrade operations detected.`

- [ ] **Step 4: Bounded, ordered blocking**

`backend/app/modules/dedupe/blocking.py` — add `MAX_CANDIDATES = 50` at module level and change the final statement to:
```python
    stmt = (
        select(Property)
        .join(Listing, Listing.property_id == Property.id)
        .where(or_(*conditions), Listing.id != listing.id, Listing.property_id.is_not(None))
        .distinct()
        .order_by(Property.last_seen_at.desc(), Property.id)
        .limit(MAX_CANDIDATES)
    )
```
(`DISTINCT` with `ORDER BY` requires the ordered columns in the select list — they are, since `Property` is selected whole.)

- [ ] **Step 5: Single-query similarity**

`backend/app/modules/dedupe/service.py::gather_inputs` — replace the per-sibling loop with one statement (`from sqlalchemy import bindparam, text` and `from sqlalchemy.dialects.postgresql import ARRAY, TEXT`):
```python
    mine = strip_for_similarity(listing.description)
    similarity: float | None = None
    stripped = [strip_for_similarity(o.description) for o in others if o.description]
    if mine and stripped:
        stmt = text("SELECT max(similarity(:mine, s)) FROM unnest(:others) AS s").bindparams(
            bindparam("mine", value=mine), bindparam("others", value=stripped, type_=ARRAY(TEXT))
        )
        similarity = (await session.execute(stmt)).scalar_one()
```
(A set-returning function cannot sit inside an aggregate in the select list, hence `FROM unnest(...)`.)

- [ ] **Step 6: EXIF-safe photos**

`backend/app/ingestion/photos.py::store_photo`:
```python
def store_photo(photo_dir: Path, listing_id: uuid.UUID, position: int, data: bytes, max_side: int = 1280) -> StoredPhoto:
    with Image.open(io.BytesIO(data)) as opened:
        img = ImageOps.exif_transpose(opened) or opened
        img = img.convert("RGB")
        img.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)
        key = f"{listing_id}/{position}.jpg"
        target = photo_dir / key
        target.parent.mkdir(parents=True, exist_ok=True)
        img.save(target, format="JPEG", quality=85, optimize=True)
        hashed = phash_to_signed(str(imagehash.phash(img)))
        width, height = img.width, img.height
    return StoredPhoto(storage_key=key, sha256=hashlib.sha256(data).hexdigest(), phash=hashed, width=width, height=height)
```
(`from PIL import Image, ImageOps`.)

- [ ] **Step 7: Run the tests, the whole suite and the gates**

Run: `cd backend && .venv/bin/pytest tests/test_m0_2_backlog.py -q && .venv/bin/pytest -q && .venv/bin/ruff check . && .venv/bin/ruff format --check . && .venv/bin/mypy app`
Expected: all PASSED; gates clean.

- [ ] **Step 8: Commit**

```bash
git add backend
git commit -m "feat(backlog): contact index and photo position unique; bounded ordered candidates; single-query similarity; EXIF-safe photos"
```

---

### Task 2: Pipeline lifecycle — adapter exceptions, gone listings, orphan photos, property-wide rescoring, age-out recompute

**Files:**
- Modify: `backend/app/ingestion/adapters/base.py`, `backend/app/ingestion/pipeline.py`, `backend/app/ingestion/photos.py`, `backend/app/modules/listings/service.py`, `backend/app/modules/properties/service.py`, `backend/app/modules/contacts/scoring.py`
- Create: `backend/tests/fakes.py` (shared `FakeAdapter`), `backend/tests/test_pipeline_lifecycle.py`
- Modify: `backend/tests/test_pipeline.py` (import `FakeAdapter`, `_payload` from `tests.fakes` instead of defining them)

**Interfaces:**
- Consumes: `run_source`, `process_raw`, `store_raw`, `ingest_payload` (M0-1), `apply_misses`, `recompute`, `rescore_contact`, `contacts_for_listing`.
- Produces (adapters and the worker rely on these):
  - `class AdapterBackoff(Exception)` with `retry_after: timedelta` and `reason: str`; `class LoginRequired(Exception)`; `class ListingGone(Exception)` (all in `adapters/base.py`)
  - `SourceAdapter.rebuild_payload(self, raw: RawListing) -> RawPayload` (new protocol method: rebuild a payload from `raw_listings.payload` without network)
  - `run_source` semantics: `ListingGone` from `fetch` → the listing (if any) is marked `source_removed`/`removed_at = now`, its property recomputed, `run.removed += 1`, no `failed`; `AdapterBackoff` from `discover`/`fetch` → run stops, `source.paused_until = now + retry_after`, `source.status = "paused"`, `run.error = reason`, **no** `consecutive_failures` increment, run returned (not raised); `LoginRequired` → `paused_until = now + 1h`, `status = "login_required"`, run returned.
  - `photos.prune_photos(session, photo_dir, listing, keep: int) -> int` — deletes `ListingPhoto` rows with `position >= keep` and their files; called by `process_raw` after the photo loop on a changed payload.
  - `contacts.scoring.rescore_property_contacts(session, prop, now) -> None` (every contact of every listing of the property) and `rescore_all(session, now) -> int` (contacts with a listing seen in the last 90 days; returns count); `process_raw` calls `rescore_property_contacts` when `decision == "attached"`.
  - `listings.service.age_out(session, now, days=30) -> list[uuid.UUID]` now returns the ids of **properties** that had a listing aged out; `properties.service.recompute_many(session, property_ids) -> int`.
  - `tests/fakes.py`: `FakeAdapter(payloads, window, fail_ids=None, gone_ids=None, backoff_on_discover=None, login_required=False)` and `payload(ext, text, posted=NOW, photos=None, username=None, structured=None) -> RawPayload` — the M0-1 fake, extended, importable by every later test file.

- [ ] **Step 1: Shared fake adapter**

`backend/tests/fakes.py`:
```python
"""Test doubles shared by pipeline, worker and CLI tests."""

from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from typing import Any

from app.ingestion.adapters.base import AdapterBackoff, ListingGone, LoginRequired, RawPayload, RawRef
from app.modules.listings.models import RawListing, Source
from app.modules.listings.service import SeenWindow
from tests.helpers import make_jpeg

NOW = datetime(2026, 8, 30, 12, 0, tzinfo=UTC)


def payload(
    ext: str,
    text: str,
    posted: datetime = NOW,
    photos: list[Any] | None = None,
    username: str | None = None,
    structured: dict[str, Any] | None = None,
) -> RawPayload:
    return RawPayload(
        external_id=ext, url=f"https://t.me/t/{ext}", posted_at=posted, text=text, structured=structured,
        sender_username=username, contact_hints=[], photo_refs=photos or [],
        payload={"text": text, "id": ext, "posted": posted.isoformat(), "photos": photos or [], "username": username},
    )


class FakeAdapter:
    kind = "telegram"

    def __init__(
        self,
        payloads: list[RawPayload],
        window: SeenWindow | None,
        fail_ids: set[str] | None = None,
        gone_ids: set[str] | None = None,
        backoff_on_discover: timedelta | None = None,
        login_required: bool = False,
        bad_photo_refs: set[str] | None = None,
    ) -> None:
        self.payloads = payloads
        self.window = window
        self.fail_ids = fail_ids or set()
        self.gone_ids = gone_ids or set()
        self.backoff_on_discover = backoff_on_discover
        self.login_required = login_required
        self.bad_photo_refs = bad_photo_refs if bad_photo_refs is not None else {"bad"}
        self.downloads = 0

    async def discover(self, source: Source) -> AsyncIterator[RawRef]:
        if self.login_required:
            raise LoginRequired("session revoked")
        if self.backoff_on_discover is not None:
            raise AdapterBackoff(self.backoff_on_discover, "flood wait")
        for p in self.payloads:
            yield RawRef(external_id=p.external_id, url=p.url, posted_at=p.posted_at, meta={})

    async def fetch(self, ref: RawRef) -> RawPayload:
        if ref.external_id in self.gone_ids:
            raise ListingGone(ref.external_id)
        if ref.external_id in self.fail_ids:
            raise RuntimeError("boom")
        return next(p for p in self.payloads if p.external_id == ref.external_id)

    async def seen_window(self, source: Source) -> SeenWindow | None:
        return self.window

    async def download_photo(self, ref: Any) -> bytes:
        self.downloads += 1
        if ref in self.bad_photo_refs:
            raise RuntimeError("404")
        return make_jpeg(300, 200, int(ref))

    async def rebuild_payload(self, raw: RawListing) -> RawPayload:
        p = raw.payload
        return payload(p["id"], p["text"], datetime.fromisoformat(p["posted"]), p.get("photos"), p.get("username"))
```
Then in `backend/tests/test_pipeline.py` delete the local `FakeAdapter`, `_payload` and `_jpeg` definitions and import: `from tests.fakes import NOW, FakeAdapter, payload as _payload` (keep every test body unchanged; `NOW` there is `2026-08-29 12:00` today — change the fakes module's `NOW` to match the existing tests, `datetime(2026, 8, 29, 12, 0, tzinfo=UTC)`, so no test needs editing). The `gone`/`backoff` fakes in `test_pipeline.py` that pass `photos=["1","2","bad"]` keep working because `bad_photo_refs` defaults to `{"bad"}`.

- [ ] **Step 2: Write the failing lifecycle tests**

`backend/tests/test_pipeline_lifecycle.py`:
```python
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ingestion.pipeline import run_source
from app.modules.contacts.models import Contact
from app.modules.dedupe.config import load_config
from app.modules.listings.models import CrawlRun, Listing, ListingPhoto, RawListing, Source
from app.modules.listings.service import SeenWindow, age_out
from app.modules.properties.models import Property
from app.modules.properties.service import recompute_many
from tests.fakes import NOW, FakeAdapter, payload

CFG = load_config(Path(__file__).resolve().parents[1] / "config" / "dedupe.yaml")
OWNER = "Chilonzor, Qatortol, 2-xonali, 3/9 qavat, 54 m², evro remont. Egasidan. 450$. Tel 90 811 24 37"
AGENT = "Chilonzor Qatortol 2 xonali 3/9 qavat 55 m² evro remont 480$ xizmat 50% tel 93 402 18 55"


async def _source(db: AsyncSession) -> Source:
    s = Source(kind="telegram", name="@t", config={"peer": "@t"}, interval_seconds=900)
    db.add(s)
    await db.flush()
    return s


async def test_listing_gone_marks_removed_without_counting_a_failure(db: AsyncSession, tmp_path: Path) -> None:
    s = await _source(db)
    window = SeenWindow(ids={"1"}, oldest_posted_at=NOW - timedelta(days=1))
    await run_source(db, FakeAdapter([payload("1", OWNER)], window), s, cfg=CFG, photo_dir=tmp_path, now=NOW)
    run = await run_source(db, FakeAdapter([payload("1", OWNER)], window, gone_ids={"1"}), s, cfg=CFG, photo_dir=tmp_path, now=NOW + timedelta(minutes=15))
    assert (run.failed, run.removed) == (0, 1)
    listing = (await db.execute(select(Listing))).scalar_one()
    prop = (await db.execute(select(Property))).scalar_one()
    assert listing.source_removed and listing.removed_at == NOW + timedelta(minutes=15) and prop.source_removed


async def test_backoff_pauses_source_without_failure(db: AsyncSession, tmp_path: Path) -> None:
    s = await _source(db)
    run = await run_source(db, FakeAdapter([], None, backoff_on_discover=timedelta(minutes=7)), s, cfg=CFG, photo_dir=tmp_path, now=NOW)
    assert run.error == "flood wait" and run.finished_at == NOW
    assert (s.consecutive_failures, s.status, s.paused_until) == (0, "paused", NOW + timedelta(minutes=7))
    assert s.next_run_at == NOW + timedelta(seconds=900)


async def test_login_required_pauses_an_hour(db: AsyncSession, tmp_path: Path) -> None:
    s = await _source(db)
    run = await run_source(db, FakeAdapter([], None, login_required=True), s, cfg=CFG, photo_dir=tmp_path, now=NOW)
    assert run.error == "session revoked"
    assert (s.status, s.paused_until, s.consecutive_failures) == ("login_required", NOW + timedelta(hours=1), 0)


async def test_changed_payload_with_fewer_photos_prunes_extra_rows(db: AsyncSession, tmp_path: Path) -> None:
    s = await _source(db)
    await run_source(db, FakeAdapter([payload("1", OWNER, photos=["1", "2", "3"])], None), s, cfg=CFG, photo_dir=tmp_path, now=NOW)
    await run_source(db, FakeAdapter([payload("1", OWNER + " (yangilandi)", photos=["1"])], None), s, cfg=CFG, photo_dir=tmp_path, now=NOW + timedelta(hours=1))
    positions = (await db.execute(select(ListingPhoto.position).order_by(ListingPhoto.position))).scalars().all()
    assert positions == [0]
    listing = (await db.execute(select(Listing))).scalar_one()
    assert not (tmp_path / f"{listing.id}" / "1.jpg").exists()


async def test_attach_rescores_every_contact_of_the_property(db: AsyncSession, tmp_path: Path) -> None:
    s = await _source(db)
    # Same posting channel (shared telegram contact) so the pair merges: contact 0.5 + photo 0.3 + rooms/floors 0.1
    # + area 0.05 + price 0.05 = 1.0 ≥ merge_threshold. The first poster is an agent (marker +0.3); once the
    # second listing attaches, the first listing is the earliest in the property (−0.1) → 0.3 becomes 0.2 —
    # a change only property-wide rescoring produces (the new listing's own contacts are rescored anyway).
    first = payload("1", "Chilonzor, Qatortol, 2-xonali, 3/9 qavat, 54 m², evro remont. Rieltor. 450$. Tel 90 811 24 37",
                    NOW - timedelta(days=1), photos=["1"], username="chilonzor_arenda")
    await run_source(db, FakeAdapter([first], None), s, cfg=CFG, photo_dir=tmp_path, now=NOW - timedelta(days=1))
    agent = (await db.execute(select(Contact).where(Contact.identifier == "+998908112437"))).scalar_one()
    assert agent.agency_score == pytest.approx(0.3) and agent.classification == "owner"  # ≤ 0.3, alone on its property
    second = payload("2", "Chilonzor 2-xonali 3/9 54 m² 430$ tel 93 402 18 55", NOW, photos=["1"], username="chilonzor_arenda")
    run = await run_source(db, FakeAdapter([first, second], None), s, cfg=CFG, photo_dir=tmp_path, now=NOW)
    assert run.new == 1
    assert (await db.execute(select(func.count()).select_from(Property))).scalar_one() == 1
    await db.refresh(agent)
    assert agent.agency_score == pytest.approx(0.2)  # rescored after the attach: earliest of two listings
    other = (await db.execute(select(Contact).where(Contact.identifier == "+998934021855"))).scalar_one()
    assert other.agency_score == pytest.approx(0.0)  # cheapest of two, clamped at 0


async def test_age_out_returns_affected_properties(db: AsyncSession, tmp_path: Path) -> None:
    s = await _source(db)
    await run_source(db, FakeAdapter([payload("1", OWNER)], None), s, cfg=CFG, photo_dir=tmp_path, now=NOW)
    affected = await age_out(db, NOW + timedelta(days=31))
    assert len(affected) == 1
    assert await recompute_many(db, affected) == 1
    prop = (await db.execute(select(Property))).scalar_one()
    assert prop.source_removed is True
```
- [ ] **Step 3: Run them to verify they fail**

Run: `cd backend && .venv/bin/pytest tests/test_pipeline_lifecycle.py -q`
Expected: FAIL with `ImportError` (`AdapterBackoff`, `recompute_many`, …).

- [ ] **Step 4: Protocol exceptions and `rebuild_payload`**

Append to `backend/app/ingestion/adapters/base.py` (before `SourceAdapter`):
```python
class AdapterBackoff(Exception):
    """The source asked us to slow down (HTTP 429/403, Telegram FloodWait). Pause, do not count a failure."""

    def __init__(self, retry_after: timedelta, reason: str) -> None:
        super().__init__(reason)
        self.retry_after = retry_after
        self.reason = reason


class LoginRequired(Exception):
    """The adapter's credentials/session are no longer valid; a human must log in again."""


class ListingGone(Exception):
    """`fetch` found that the listing no longer exists at the source (404, deactivated)."""
```
and add to the protocol:
```python
    async def rebuild_payload(self, raw: RawListing) -> RawPayload:
        """Rebuild the `RawPayload` from `raw.payload` (stored verbatim) — used by `reparse`, never touches the network."""
        ...
```
(`from datetime import datetime, timedelta`; `from app.modules.listings.models import RawListing, Source`; extend `__all__`.)

- [ ] **Step 5: Pipeline handling**

`backend/app/ingestion/pipeline.py` — inside `run_source`'s per-ref loop, before the generic `except Exception`:
```python
            except ListingGone:
                run.removed += await _mark_gone(session, source, ref.external_id, now)
                continue
            except (AdapterBackoff, LoginRequired):
                raise
```
with the helper:
```python
async def _mark_gone(session: AsyncSession, source: Source, external_id: str, now: datetime) -> int:
    stmt = (
        select(Listing).join(RawListing, RawListing.id == Listing.raw_listing_id)
        .where(RawListing.source_id == source.id, RawListing.external_id == external_id, Listing.source_removed.is_(False))
    )
    listing = (await session.execute(stmt)).scalar_one_or_none()
    if listing is None:
        return 0
    listing.source_removed, listing.removed_at = True, now
    await session.flush()
    if listing.property_id is not None:
        prop = await session.get(Property, listing.property_id)
        if prop is not None:
            await recompute(session, prop)
    return 1
```
Wrap the outer body so backoff/login end the run gracefully — replace the outer `except Exception as exc:` block with:
```python
    except AdapterBackoff as exc:
        _pause(source, run, now, exc.retry_after, "paused", exc.reason)
    except LoginRequired as exc:
        _pause(source, run, now, timedelta(hours=1), "login_required", str(exc) or "login required")
    except Exception as exc:  # noqa: BLE001
        ... (existing failure bookkeeping, unchanged) ...
        raise
```
and the helper:
```python
def _pause(source: Source, run: CrawlRun, now: datetime, retry_after: timedelta, status: str, reason: str) -> None:
    run.error = reason[:1000]
    source.status = status
    source.paused_until = now + retry_after
```
The normal tail (`run.finished_at = now`, `source.last_run_at`, `next_run_at`, flush, `return run`) must execute for the paused paths too — restructure so the tail is outside the `try` (a `finally` is wrong because the failure path re-raises after its own tail). Keep `source.consecutive_failures = 0; source.status = "ok"` only on the success path.

In `process_raw`, after the photo loop, when `changed and adapter is not None`: `await prune_photos(session, photo_dir, listing, keep=len(payload.photo_refs[:max_photos]))`; and after `assign`: `if result.decision == "attached": await rescore_property_contacts(session, result.property, now)` (keep the existing `rescore_for_listing` call for the new listing's own contacts on the other paths).

- [ ] **Step 6: Photos, scoring and age-out helpers**

`backend/app/ingestion/photos.py`:
```python
async def prune_photos(session: AsyncSession, photo_dir: Path, listing: Listing, keep: int) -> int:
    stmt = select(ListingPhoto).where(ListingPhoto.listing_id == listing.id, ListingPhoto.position >= keep)
    extra = list((await session.execute(stmt)).scalars().all())
    for photo in extra:
        if photo.storage_key:
            (photo_dir / photo.storage_key).unlink(missing_ok=True)
        await session.delete(photo)
    await session.flush()
    return len(extra)
```
`backend/app/modules/contacts/scoring.py`:
```python
async def rescore_property_contacts(session: AsyncSession, prop: Property, now: datetime) -> None:
    stmt = (
        select(Contact).join(ListingContact, ListingContact.contact_id == Contact.id)
        .join(Listing, Listing.id == ListingContact.listing_id).where(Listing.property_id == prop.id).distinct()
    )
    for contact in (await session.execute(stmt)).scalars().all():
        await rescore_contact(session, contact, now)
    await update_probable_owner(session, prop)


async def rescore_all(session: AsyncSession, now: datetime) -> int:
    since = now - timedelta(days=90)
    stmt = (
        select(Contact).join(ListingContact, ListingContact.contact_id == Contact.id)
        .join(Listing, Listing.id == ListingContact.listing_id).where(Listing.last_seen_at >= since).distinct()
    )
    contacts = list((await session.execute(stmt)).scalars().all())
    for contact in contacts:
        await rescore_contact(session, contact, now)
    return len(contacts)
```
`backend/app/modules/listings/service.py::age_out` — return the affected property ids:
```python
async def age_out(session: AsyncSession, now: datetime, days: int = 30) -> list[uuid.UUID]:
    cutoff = now - timedelta(days=days)
    stmt = select(Listing).where(Listing.source_removed.is_(False), Listing.last_seen_at < cutoff)
    aged = list((await session.execute(stmt)).scalars().all())
    for listing in aged:
        listing.source_removed, listing.removed_at = True, now
    await session.flush()
    return sorted({l_.property_id for l_ in aged if l_.property_id is not None})
```
(Update `tests/test_listings_service.py::test_age_out_after_30_days` — it asserted `== 3`; assert `len(...) == 3` there.)
`backend/app/modules/properties/service.py`:
```python
async def recompute_many(session: AsyncSession, property_ids: Sequence[uuid.UUID]) -> int:
    count = 0
    for pid in property_ids:
        prop = await session.get(Property, pid)
        if prop is not None:
            await recompute(session, prop)
            count += 1
    return count
```

- [ ] **Step 7: Run everything, then commit**

Run: `cd backend && .venv/bin/pytest tests/test_pipeline_lifecycle.py tests/test_pipeline.py tests/test_listings_service.py -q && .venv/bin/pytest -q && .venv/bin/ruff check . && .venv/bin/ruff format --check . && .venv/bin/mypy app`
Expected: all PASSED, gates clean.
```bash
git add backend
git commit -m "feat(ingestion): adapter backoff/login/gone semantics, orphan photo pruning, property-wide rescoring, age-out recompute"
```

---

### Task 3: HTTP client, rate limiter and backoff state

**Files:**
- Create: `backend/app/ingestion/http.py`
- Modify: `backend/app/core/settings.py`, `backend/.env.example`
- Test: `backend/tests/test_http.py`

**Interfaces:**
- Produces:
  - `@dataclass HttpResponse(status: int, url: str, content: bytes)` with property `text -> str` (utf-8, errors replaced)
  - `class HttpClient(Protocol)`: `async def get(self, url: str, *, headers: dict[str, str] | None = None) -> HttpResponse`; `async def aclose(self) -> None`
  - `class HttpxClient(HttpClient)`: `__init__(self, *, user_agent: str, proxy: str | None = None, timeout: float = 30.0)`; browser headers (`User-Agent`, `Accept`, `Accept-Language: ru,uz;q=0.8`), redirects followed; constructor also accepts `transport=` for tests
  - `class RateLimiter`: `__init__(self, min_interval: float, jitter: float = 0.5, *, sleep=asyncio.sleep, clock=time.monotonic)`; `async def wait(self) -> None` — sleeps so consecutive calls are ≥ `min_interval` (+ uniform jitter) apart
  - `def backoff_delay(level: int) -> timedelta` — `min(32 min, 1 min × 2**level)`
  - `def bump_backoff(source: Source) -> tuple[int, timedelta]` — reads `source.state.get("backoff_level", 0)`, returns `(level, delay)` and **reassigns** `source.state` with `backoff_level + 1`; `def reset_backoff(source: Source) -> None` reassigns with `backoff_level` removed
  - Settings additions: `http_user_agent: str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"`, `olx_proxy_url: str | None = None`, `olx_request_interval: float = 2.0`, `olx_max_pages: int = 25`, `telegram_backfill_days: int = 14`, `telegram_rescan_limit: int = 200`, `worker_tick_seconds: int = 60`, `daily_job_hour: int = 3`

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_http.py`:
```python
from datetime import timedelta

import httpx
import pytest

from app.ingestion.http import HttpxClient, RateLimiter, backoff_delay, bump_backoff, reset_backoff
from app.modules.listings.models import Source


async def test_httpx_client_sends_browser_headers_and_follows_redirects() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.url.path == "/old":
            return httpx.Response(301, headers={"location": "https://www.olx.uz/new"})
        return httpx.Response(200, content=b"<html>ok</html>")

    client = HttpxClient(user_agent="UA/1.0", transport=httpx.MockTransport(handler))
    resp = await client.get("https://www.olx.uz/old")
    await client.aclose()
    assert resp.status == 200 and resp.text == "<html>ok</html>" and resp.url == "https://www.olx.uz/new"
    assert seen[0].headers["user-agent"] == "UA/1.0" and seen[0].headers["accept-language"].startswith("ru")


async def test_rate_limiter_spaces_calls() -> None:
    now = [0.0]
    slept: list[float] = []

    async def sleep(seconds: float) -> None:
        slept.append(seconds)
        now[0] += seconds

    limiter = RateLimiter(2.0, jitter=0.0, sleep=sleep, clock=lambda: now[0])
    await limiter.wait()  # first call: no wait
    now[0] += 0.5
    await limiter.wait()  # 1.5 s remaining
    assert slept == [1.5]


def test_backoff_delay_doubles_and_caps() -> None:
    assert backoff_delay(0) == timedelta(minutes=1)
    assert backoff_delay(3) == timedelta(minutes=8)
    assert backoff_delay(9) == timedelta(minutes=32)


def test_bump_and_reset_backoff_reassign_state() -> None:
    source = Source(kind="olx", name="olx", config={}, state={"known": {"1": "x"}})
    before = source.state
    level, delay = bump_backoff(source)
    assert (level, delay) == (0, timedelta(minutes=1))
    assert source.state is not before and source.state["backoff_level"] == 1 and source.state["known"] == {"1": "x"}
    reset_backoff(source)
    assert "backoff_level" not in source.state and source.state["known"] == {"1": "x"}
```
`pytest.importorskip` is not needed — httpx is a runtime dependency.

- [ ] **Step 2: Run them to verify they fail**

Run: `cd backend && .venv/bin/pytest tests/test_http.py -q`
Expected: FAIL with `ModuleNotFoundError: app.ingestion.http`

- [ ] **Step 3: Implement**

`backend/app/ingestion/http.py`:
```python
import asyncio
import random
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import timedelta
from typing import Any, Protocol

import httpx

from app.modules.listings.models import Source

BROWSER_ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8"


@dataclass
class HttpResponse:
    status: int
    url: str
    content: bytes

    @property
    def text(self) -> str:
        return self.content.decode("utf-8", errors="replace")


class HttpClient(Protocol):
    async def get(self, url: str, *, headers: dict[str, str] | None = None) -> HttpResponse: ...

    async def aclose(self) -> None: ...


class HttpxClient:
    def __init__(
        self,
        *,
        user_agent: str,
        proxy: str | None = None,
        timeout: float = 30.0,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        headers = {"User-Agent": user_agent, "Accept": BROWSER_ACCEPT, "Accept-Language": "ru,uz;q=0.8,en;q=0.5"}
        kwargs: dict[str, Any] = {"headers": headers, "follow_redirects": True, "timeout": timeout}
        if transport is not None:
            kwargs["transport"] = transport
        elif proxy:
            kwargs["proxy"] = proxy
        self._client = httpx.AsyncClient(**kwargs)

    async def get(self, url: str, *, headers: dict[str, str] | None = None) -> HttpResponse:
        response = await self._client.get(url, headers=headers)
        return HttpResponse(status=response.status_code, url=str(response.url), content=response.content)

    async def aclose(self) -> None:
        await self._client.aclose()


class RateLimiter:
    def __init__(
        self,
        min_interval: float,
        jitter: float = 0.5,
        *,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.min_interval, self.jitter, self._sleep, self._clock = min_interval, jitter, sleep, clock
        self._last: float | None = None

    async def wait(self) -> None:
        if self._last is not None:
            due = self._last + self.min_interval + random.uniform(0, self.jitter)  # noqa: S311 — timing jitter, not security
            remaining = due - self._clock()
            if remaining > 0:
                await self._sleep(remaining)
        self._last = self._clock()


def backoff_delay(level: int) -> timedelta:
    return timedelta(minutes=min(32, 2**level))


def bump_backoff(source: Source) -> tuple[int, timedelta]:
    level = int(source.state.get("backoff_level", 0))
    source.state = {**source.state, "backoff_level": level + 1}
    return level, backoff_delay(level)


def reset_backoff(source: Source) -> None:
    if "backoff_level" in source.state:
        source.state = {k: v for k, v in source.state.items() if k != "backoff_level"}
```
Settings: add the fields listed in Interfaces to `backend/app/core/settings.py`, set `env_ignore_empty=True` in its `SettingsConfigDict` (an empty `KEY=` line in `.env` must never override a default), and add the corresponding lines to `backend/.env.example` (`# HTTP_USER_AGENT=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36` — commented out: an empty `HTTP_USER_AGENT=` would override the default with an empty string; `# OLX_PROXY_URL=http://user:pass@host:port` likewise commented; `OLX_REQUEST_INTERVAL=2.0`, `OLX_MAX_PAGES=25`, `TELEGRAM_BACKFILL_DAYS=14`, `TELEGRAM_RESCAN_LIMIT=200`, `WORKER_TICK_SECONDS=60`, `DAILY_JOB_HOUR=3`).

- [ ] **Step 4: Run the tests, suite and gates; commit**

Run: `cd backend && .venv/bin/pytest tests/test_http.py -q && .venv/bin/pytest -q && .venv/bin/ruff check . && .venv/bin/ruff format --check . && .venv/bin/mypy app`
```bash
git add backend
git commit -m "feat(ingestion): httpx client with browser headers, rate limiter, backoff state; worker/adapter settings"
```

---

### Task 4: OLX adapter (JSON-driven, fixture-tested)

**Files:**
- Create: `backend/app/ingestion/adapters/olx/__init__.py`, `backend/app/ingestion/adapters/olx/state.py`
- Modify: `backend/app/ingestion/parse/fields.py` (+ `normalize_phone`), `backend/app/ingestion/parse/__init__.py` (re-export)
- Test: `backend/tests/test_olx_adapter.py` (fixtures already in `backend/tests/fixtures/olx/`)

**Interfaces:**
- Consumes: `HttpClient`, `RateLimiter`, `bump_backoff`, `reset_backoff`, `backoff_delay` (Task 3); `AdapterBackoff`, `ListingGone`, `RawRef`, `RawPayload`, `SeenWindow` (Task 2); `match_district`, `phonenumbers`.
- Produces:
  - `olx.state.extract_state(html: str) -> dict[str, Any]` (raises `ValueError` when the marker is missing), `list_ads(state) -> list[dict]`, `list_pages(state) -> tuple[int, int]` (page_number, total_pages), `detail_ad(state) -> dict`, `ad_signature(ad) -> str`, `ad_to_payload(ad: dict, phones: list[str]) -> RawPayload`, `PARAM_KEYS`, `CURRENCY_CODES`
  - `parse.normalize_phone(raw: str) -> str | None` — `"+99 893 1793333"` → `"+998931793333"`, `"93 179 33 33"` → `"+998931793333"`, garbage → `None`
  - `OlxAdapter(http: HttpClient, limiter: RateLimiter, *, max_pages: int = 25, full_walk_every: int = 4, phone_lookup: bool = True)` implementing `SourceAdapter` (`kind = "olx"`) plus `async fetch_by_url(url) -> RawPayload`. `source.config = {"url": "<category url>"}`; `source.state` keys: `known` (external_id → signature), `run_counter`, `backoff_level`.
  - Discovery yields a `RawRef` only for ads whose signature (`lastRefreshTime|price|currency`) is new or changed; every 4th run (and the first) walks all pages, other runs stop at the first page with no new/changed ad; `seen_window` = ids of all ads on the walked pages with `oldest_posted_at = min(createdTime)`.
  - `fetch` GETs the detail page (canonical currency), raises `ListingGone` on 404 or `isActive == false`/`status != "active"`, then best-effort phones from `https://www.olx.uz/api/v1/offers/<id>/limited-phones/`.

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_olx_adapter.py`:
```python
import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from app.ingestion.adapters.base import AdapterBackoff, ListingGone, RawRef
from app.ingestion.adapters.olx import OlxAdapter
from app.ingestion.adapters.olx.state import ad_signature, ad_to_payload, detail_ad, extract_state, list_ads, list_pages
from app.ingestion.http import HttpResponse, RateLimiter
from app.ingestion.parse import normalize_phone
from app.modules.listings.models import RawListing, Source

FIX = Path(__file__).parent / "fixtures" / "olx"
LIST_HTML = (FIX / "list_page.html").read_text(encoding="utf-8")
DETAIL_HTML = (FIX / "detail_page.html").read_text(encoding="utf-8")
BASE = "https://www.olx.uz/nedvizhimost/kvartiry/arenda-dolgosrochnaya/tashkent/?search%5Border%5D=created_at:desc"
PHONES_JSON = json.dumps({"data": {"phones": ["+99 893 1793333"]}})


class FakeHttp:
    def __init__(self, routes: dict[str, tuple[int, bytes]]) -> None:
        self.routes = routes
        self.calls: list[str] = []

    async def get(self, url: str, *, headers: dict[str, str] | None = None) -> HttpResponse:
        self.calls.append(url)
        status, body = self.routes.get(url, (404, b"not found"))
        return HttpResponse(status=status, url=url, content=body)

    async def aclose(self) -> None:
        return None


async def _no_sleep(_: float) -> None:
    return None


def _adapter(routes: dict[str, tuple[int, bytes]], **kw: object) -> tuple[OlxAdapter, FakeHttp]:
    http = FakeHttp(routes)
    return OlxAdapter(http, RateLimiter(0, jitter=0, sleep=_no_sleep), **kw), http  # type: ignore[arg-type]


def _routes() -> dict[str, tuple[int, bytes]]:
    detail_url = list_ads(extract_state(LIST_HTML))[0]["url"]
    return {
        BASE: (200, LIST_HTML.encode()),
        BASE + "&page=2": (404, b""),
        detail_url: (200, DETAIL_HTML.encode()),
        "https://www.olx.uz/api/v1/offers/65000001/limited-phones/": (200, PHONES_JSON.encode()),
        "https://frankfurt.apollo.olxcdn.com:443/v1/files/fixture-1-0-UZ/image;s=1280x960": (200, b"\xff\xd8jpegbytes"),
    }


def test_extract_state_and_accessors() -> None:
    state = extract_state(LIST_HTML)
    ads = list_ads(state)
    assert [a["id"] for a in ads] == [65000001, 65000002, 65000003]
    assert list_pages(state) == (0, 25)
    ad = detail_ad(extract_state(DETAIL_HTML))
    assert ad["id"] == 65000001 and ad["price"]["regularPrice"]["currencyCode"] == "UYE"
    with pytest.raises(ValueError):
        extract_state("<html>no state</html>")


def test_ad_to_payload_maps_structured_fields() -> None:
    ad = detail_ad(extract_state(DETAIL_HTML))
    p = ad_to_payload(ad, ["+998931793333"])
    assert p.external_id == "65000001" and p.url == ad["url"]
    assert p.posted_at == datetime.fromisoformat("2026-08-28T00:55:10+05:00")
    assert p.structured == {
        "title": ad["title"], "price_amount_minor": 55000, "price_currency": "USD",
        "rooms": 2, "floor": 2, "total_floors": 7, "area_sqm": 50.0, "district": "yunusobod",
    }
    assert ("olx_user", "100000001") in p.contact_hints and ("phone", "+998931793333") in p.contact_hints
    assert p.text.startswith(ad["title"]) and "<br" not in p.text and "Юнусабад" in p.text
    assert p.photo_refs == ad["photos"] and p.payload == {"ad": ad, "phones": ["+998931793333"]}


def test_list_price_in_uzs_is_kept_as_uzs() -> None:
    ad = list_ads(extract_state(LIST_HTML))[0]
    p = ad_to_payload(ad, [])
    assert p.structured is not None and p.structured["price_currency"] == "UZS" and p.structured["price_amount_minor"] == 650375000


@pytest.mark.parametrize(("raw", "expected"), [("+99 893 1793333", "+998931793333"), ("93 179 33 33", "+998931793333"), ("998901234567", "+998901234567"), ("12345", None)])
def test_normalize_phone(raw: str, expected: str | None) -> None:
    assert normalize_phone(raw) == expected


async def test_discover_yields_new_and_changed_only_and_keeps_window(db) -> None:  # type: ignore[no-untyped-def]
    adapter, http = _adapter(_routes())
    source = Source(kind="olx", name="olx", config={"url": BASE}, state={})
    refs = [r async for r in adapter.discover(source)]
    assert [r.external_id for r in refs] == ["65000001", "65000002", "65000003"]
    assert refs[0].posted_at == datetime.fromisoformat("2026-08-28T00:55:10+05:00")
    window = await adapter.seen_window(source)
    assert window is not None and window.ids == {"65000001", "65000002", "65000003"}
    assert window.oldest_posted_at == min(r.posted_at for r in refs if r.posted_at)
    assert set(source.state["known"]) == window.ids and source.state["run_counter"] == 1
    # second run: nothing changed → no refs; a changed signature → one ref
    assert [r async for r in adapter.discover(source)] == []
    source.state = {**source.state, "known": {**source.state["known"], "65000002": "stale"}}
    assert [r.external_id async for r in adapter.discover(source)] == ["65000002"]


async def test_fetch_uses_detail_page_and_phone_endpoint() -> None:
    adapter, http = _adapter(_routes())
    ref = RawRef(external_id="65000001", url=list_ads(extract_state(LIST_HTML))[0]["url"], posted_at=None)
    p = await adapter.fetch(ref)
    assert p.structured is not None and (p.structured["price_amount_minor"], p.structured["price_currency"]) == (55000, "USD")
    assert ("phone", "+998931793333") in p.contact_hints
    assert http.calls[-1].endswith("/limited-phones/")


async def test_fetch_without_phone_endpoint_still_works() -> None:
    routes = _routes()
    routes.pop("https://www.olx.uz/api/v1/offers/65000001/limited-phones/")
    adapter, _ = _adapter(routes)
    p = await adapter.fetch(RawRef(external_id="65000001", url=list_ads(extract_state(LIST_HTML))[0]["url"], posted_at=None))
    assert all(kind != "phone" for kind, _ in p.contact_hints) and ("olx_user", "100000001") in p.contact_hints


async def test_fetch_404_and_inactive_raise_listing_gone() -> None:
    routes = _routes()
    adapter, _ = _adapter(routes)
    with pytest.raises(ListingGone):
        await adapter.fetch(RawRef(external_id="x", url="https://www.olx.uz/d/obyavlenie/missing-IDzzz.html", posted_at=None))
    inactive = DETAIL_HTML.replace('\\"isActive\\":true', '\\"isActive\\":false').replace('\\"status\\":\\"active\\"', '\\"status\\":\\"removed_by_user\\"')
    url = list_ads(extract_state(LIST_HTML))[0]["url"]
    routes[url] = (200, inactive.encode())
    with pytest.raises(ListingGone):
        await adapter.fetch(RawRef(external_id="65000001", url=url, posted_at=None))


async def test_http_429_raises_backoff_and_bumps_state() -> None:
    adapter, _ = _adapter({BASE: (429, b"slow down")})
    source = Source(kind="olx", name="olx", config={"url": BASE}, state={})
    with pytest.raises(AdapterBackoff) as info:
        _ = [r async for r in adapter.discover(source)]
    assert info.value.retry_after == timedelta(minutes=1) and source.state["backoff_level"] == 1


async def test_rebuild_payload_round_trips_and_photo_download() -> None:
    adapter, _ = _adapter(_routes())
    ad = detail_ad(extract_state(DETAIL_HTML))
    raw = RawListing(external_id="65000001", payload={"ad": ad, "phones": ["+998931793333"]}, content_hash="h", fetched_at=datetime.now(UTC))
    p = await adapter.rebuild_payload(raw)
    assert p == ad_to_payload(ad, ["+998931793333"])
    assert await adapter.download_photo(ad["photos"][0]) == b"\xff\xd8jpegbytes"
```
(`test_discover…` takes the `db` fixture only to reuse the session-scoped event loop configuration; it does not touch the database.)

- [ ] **Step 2: Run them to verify they fail**

Run: `cd backend && .venv/bin/pytest tests/test_olx_adapter.py -q`
Expected: FAIL with `ModuleNotFoundError: app.ingestion.adapters.olx`

- [ ] **Step 3: `normalize_phone`**

Append to `backend/app/ingestion/parse/fields.py` and re-export from `parse/__init__.py` (`__all__` too):
```python
def normalize_phone(raw: str) -> str | None:
    digits = re.sub(r"\D", "", raw)
    if len(digits) == 12 and digits.startswith("998"):
        candidate = "+" + digits
    elif len(digits) == 9:
        candidate = "+998" + digits
    else:
        return None
    try:
        parsed = phonenumbers.parse(candidate, "UZ")
    except phonenumbers.NumberParseException:
        return None
    if not phonenumbers.is_valid_number(parsed):
        return None
    return phonenumbers.format_number(parsed, phonenumbers.PhoneNumberFormat.E164)
```

- [ ] **Step 4: State parsing**

`backend/app/ingestion/adapters/olx/state.py`:
```python
"""Parse OLX pages through the JSON state they embed (`window.__PRERENDERED_STATE__`)."""

import html as html_lib
import json
import re
from datetime import datetime
from typing import Any

from app.ingestion.adapters.base import RawPayload
from app.ingestion.parse import normalize_phone
from app.ingestion.parse.districts import match_district

MARKER = "__PRERENDERED_STATE__"
_JSON_STRING = re.compile(r'"(?:[^"\\]|\\.)*"', re.S)
_TAGS = re.compile(r"<br\s*/?>|</p>", re.I)
_ANY_TAG = re.compile(r"<[^>]+>")
_NUMBER = re.compile(r"\d+(?:[.,]\d+)?")

PARAM_KEYS = {"number_of_rooms": "rooms", "floor": "floor", "total_floors": "total_floors", "total_area": "area_sqm"}
CURRENCY_CODES = {"UYE": "USD", "USD": "USD", "UZS": "UZS"}


def extract_state(html: str) -> dict[str, Any]:
    start = html.find(MARKER)
    if start < 0:
        raise ValueError("no __PRERENDERED_STATE__ in page")
    quote = html.find('"', start)
    match = _JSON_STRING.match(html, quote)
    if match is None:
        raise ValueError("unterminated __PRERENDERED_STATE__ literal")
    inner = json.loads(match.group(0))  # the page stores the JSON as a JS string literal
    result: dict[str, Any] = json.loads(inner)
    return result


def list_ads(state: dict[str, Any]) -> list[dict[str, Any]]:
    ads = state.get("listing", {}).get("listing", {}).get("ads") or []
    return [a for a in ads if isinstance(a, dict) and a.get("id") is not None]


def list_pages(state: dict[str, Any]) -> tuple[int, int]:
    inner = state.get("listing", {}).get("listing", {})
    return int(inner.get("pageNumber", 0)), int(inner.get("totalPages", 1))


def detail_ad(state: dict[str, Any]) -> dict[str, Any]:
    ad = state.get("ad", {}).get("ad")
    if not isinstance(ad, dict) or ad.get("id") is None:
        raise ValueError("no ad in detail state")
    return ad


def _price(ad: dict[str, Any]) -> tuple[int | None, str | None]:
    regular = (ad.get("price") or {}).get("regularPrice") or {}
    value, code = regular.get("value"), regular.get("currencyCode")
    currency = CURRENCY_CODES.get(str(code)) if code else None
    if value is None or currency is None:
        return None, None
    return int(round(float(value) * 100)), currency


def _params(ad: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for param in ad.get("params") or []:
        target = PARAM_KEYS.get(str(param.get("key")))
        if target is None:
            continue
        number = _NUMBER.search(str(param.get("value") or ""))
        if number is None:
            continue
        text = number.group(0).replace(",", ".")
        out[target] = float(text) if target == "area_sqm" else int(float(text))
    return out


def ad_signature(ad: dict[str, Any]) -> str:
    amount, currency = _price(ad)
    return f"{ad.get('lastRefreshTime')}|{amount}|{currency}"


def _description_text(raw: str | None) -> str:
    text = _TAGS.sub("\n", raw or "")
    text = _ANY_TAG.sub("", text)
    return html_lib.unescape(text).strip()


def ad_to_payload(ad: dict[str, Any], phones: list[str]) -> RawPayload:
    amount, currency = _price(ad)
    structured: dict[str, Any] = {"title": ad.get("title") or ""}
    if amount is not None:
        structured["price_amount_minor"], structured["price_currency"] = amount, currency
    structured.update(_params(ad))
    district = match_district(((ad.get("location") or {}).get("districtName")) or "")
    if district:
        structured["district"] = district
    hints: list[tuple[str, str]] = []
    user_id = (ad.get("user") or {}).get("id")
    if user_id is not None:
        hints.append(("olx_user", str(user_id)))
    normalized = [p for p in (normalize_phone(x) for x in phones) if p]
    hints.extend(("phone", p) for p in normalized)
    created = ad.get("createdTime")
    posted_at = datetime.fromisoformat(created) if created else None
    text = f"{structured['title']}\n{_description_text(ad.get('description'))}".strip()
    return RawPayload(
        external_id=str(ad["id"]),
        url=ad.get("url"),
        posted_at=posted_at,
        text=text,
        structured=structured,
        sender_username=None,
        contact_hints=hints,
        photo_refs=list(ad.get("photos") or []),
        payload={"ad": ad, "phones": normalized},
    )
```

- [ ] **Step 5: The adapter**

`backend/app/ingestion/adapters/olx/__init__.py`:
```python
"""OLX.uz adapter — list pages for discovery, detail pages for the canonical payload."""

import json
import uuid
from collections.abc import AsyncIterator
from datetime import datetime
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import structlog

from app.ingestion.adapters.base import AdapterBackoff, ListingGone, RawPayload, RawRef
from app.ingestion.adapters.olx.state import ad_signature, ad_to_payload, detail_ad, extract_state, list_ads, list_pages
from app.ingestion.http import HttpClient, HttpResponse, RateLimiter, backoff_delay, bump_backoff, reset_backoff
from app.modules.listings.models import RawListing, Source
from app.modules.listings.service import SeenWindow

log = structlog.get_logger()
PHONES_URL = "https://www.olx.uz/api/v1/offers/{id}/limited-phones/"


def page_url(base: str, page: int) -> str:
    parts = urlsplit(base)
    query = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True) if k != "page"]
    if page > 1:
        query.append(("page", str(page)))
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))


class OlxAdapter:
    kind = "olx"

    def __init__(
        self,
        http: HttpClient,
        limiter: RateLimiter,
        *,
        max_pages: int = 25,
        full_walk_every: int = 4,
        phone_lookup: bool = True,
    ) -> None:
        self.http, self.limiter = http, limiter
        self.max_pages, self.full_walk_every, self.phone_lookup = max_pages, full_walk_every, phone_lookup
        self._windows: dict[uuid.UUID, SeenWindow] = {}

    async def _get(self, url: str, source: Source | None = None) -> HttpResponse:
        await self.limiter.wait()
        response = await self.http.get(url)
        if response.status in (403, 429):
            if source is not None:
                _, delay = bump_backoff(source)
            else:
                delay = backoff_delay(0)
            raise AdapterBackoff(delay, f"olx http {response.status}")
        return response

    async def discover(self, source: Source) -> AsyncIterator[RawRef]:
        base = str(source.config["url"])
        known: dict[str, str] = dict(source.state.get("known", {}))
        run_counter = int(source.state.get("run_counter", 0)) + 1
        full_walk = run_counter == 1 or run_counter % self.full_walk_every == 0
        new_known: dict[str, str] = {}
        ids: set[str] = set()
        created: list[datetime] = []
        for page in range(1, self.max_pages + 1):
            response = await self._get(page_url(base, page), source)
            if response.status == 404:
                break
            if response.status != 200:
                raise RuntimeError(f"olx list page {page}: http {response.status}")
            state = extract_state(response.text)
            ads = list_ads(state)
            if not ads:
                break
            fresh = 0
            for ad in ads:
                ext, sig = str(ad["id"]), ad_signature(ad)
                new_known[ext] = sig
                ids.add(ext)
                posted = datetime.fromisoformat(ad["createdTime"]) if ad.get("createdTime") else None
                if posted is not None:
                    created.append(posted)
                if known.get(ext) != sig:
                    fresh += 1
                    yield RawRef(external_id=ext, url=ad.get("url"), posted_at=posted, meta={"sig": sig})
            page_number, total_pages = list_pages(state)
            if page_number + 1 >= total_pages:
                break
            if not full_walk and fresh == 0:
                break
        self._windows[source.id] = SeenWindow(ids=ids, oldest_posted_at=min(created) if created else None)
        source.state = {**source.state, "known": {**known, **new_known} if not full_walk else new_known, "run_counter": run_counter}
        reset_backoff(source)

    async def fetch(self, ref: RawRef) -> RawPayload:
        if not ref.url:
            raise ListingGone(ref.external_id)
        response = await self._get(ref.url)
        if response.status == 404:
            raise ListingGone(ref.external_id)
        if response.status != 200:
            raise RuntimeError(f"olx detail {ref.url}: http {response.status}")
        ad = detail_ad(extract_state(response.text))
        if ad.get("isActive") is False or ad.get("status") not in (None, "active"):
            raise ListingGone(ref.external_id)
        return ad_to_payload(ad, await self._phones(int(ad["id"])))

    async def _phones(self, ad_id: int) -> list[str]:
        if not self.phone_lookup:
            return []
        try:
            response = await self._get(PHONES_URL.format(id=ad_id))
        except AdapterBackoff:
            raise
        except Exception as exc:  # noqa: BLE001 — best-effort by design (spec §3.3)
            log.info("olx_phones_failed", ad_id=ad_id, error=str(exc))
            return []
        if response.status != 200:
            return []
        try:
            phones: Any = json.loads(response.text).get("data", {}).get("phones", [])
        except (ValueError, AttributeError):
            return []
        return [str(p) for p in phones]

    async def fetch_by_url(self, url: str) -> RawPayload:
        return await self.fetch(RawRef(external_id="", url=url, posted_at=None))

    async def seen_window(self, source: Source) -> SeenWindow | None:
        return self._windows.pop(source.id, None)

    async def download_photo(self, ref: Any) -> bytes:
        response = await self._get(str(ref))
        if response.status != 200:
            raise RuntimeError(f"photo {ref}: http {response.status}")
        return response.content

    async def rebuild_payload(self, raw: RawListing) -> RawPayload:
        return ad_to_payload(raw.payload["ad"], list(raw.payload.get("phones", [])))
```
Notes for the implementer: on a non-full walk, ads not on the walked pages keep their previous signature in `known` (so they are not re-fetched next time); on a full walk `known` is rebuilt from what is currently listed, which drops removed ads. The `_JSON_STRING` regex reads a 2 MB page in well under a second.

- [ ] **Step 6: Run the tests, suite and gates; commit**

Run: `cd backend && .venv/bin/pytest tests/test_olx_adapter.py -q && .venv/bin/pytest -q && .venv/bin/ruff check . && .venv/bin/ruff format --check . && .venv/bin/mypy app`
Expected: all PASSED. If `test_fetch_404_and_inactive_raise_listing_gone`'s string replacement does not hit (the fixture stores the state as an escaped JS string, hence the `\\"` in the replacement), print the first 300 characters after `isActive` in `DETAIL_HTML` and adjust the replacement to the exact escaping — do not weaken the assertion.
```bash
git add backend
git commit -m "feat(olx): JSON-driven OLX adapter — list discovery with signatures, detail fetch, best-effort phones, removal window"
```

---

#### Post-review amendments (Task 4, 2026-08-30)

The task review found defects in this task's sample code; the implementation on the branch is the source of truth and differs from the samples above as follows:

- **Removal window.** `seen_window` excludes promoted/highlighted ads (`isPromoted`/`isHighlighted`) from the boundary — OLX hoists them to the top of `created_at:desc` lists regardless of date (the recorded fixture shows it), so `min(createdTime)` over all walked ads reached months back while `ids` covered only the walked pages, and `apply_misses` would have flagged live listings on un-walked pages as removed. Promoted ids stay in `ids`; the boundary is `min(lastRefreshTime or createdTime)` over the remaining walked ads (sound under either OLX ordering because `lastRefreshTime >= createdTime`); with no qualifying ad the window is `SeenWindow(ids, oldest_posted_at=None)` (marks ids seen, disables removal detection for that run).
- **Backoff escalation lives in the pipeline.** `run_source`'s `except AdapterBackoff` now calls `bump_backoff(source)` and pauses for `max(exc.retry_after, backoff_delay(level))`; the success path calls `reset_backoff(source)`. Adapters only raise `AdapterBackoff(backoff_delay(0), reason)` (OLX: reason names the status and host; Telegram: the exact flood-wait seconds, which `max()` keeps). Previously only `discover` escalated and `fetch`/phones/photos retried every minute forever.
- **Known set is confirmed on fetch.** `discover` keeps a per-run walk (`ext → sig`, full/partial); a signature is confirmed only when `fetch(ref)` returns or raises `ListingGone`; `seen_window(source)` settles `source.state["known"]` — partial walk `{**known, **confirmed}`, full walk = walked ads that are unchanged-known or confirmed (delisted and failed-fetch ads drop out and are retried). `fetch_by_url` never touches `known`.
- **A 404 on list page 1 is a failure** (raises; the run is recorded as failed and the circuit breaker sees it); 404 ends pagination only for page > 1.
- `page_url` keeps `:` unescaped (`urlencode(..., safe=":")`, otherwise OLX's own `search[order]=created_at:desc` was mangled) and returns `base` unchanged for page <= 1.
- `parse/fields.py`: `extract_phones` and `normalize_phone` share one `_to_e164(candidate) -> str | None` helper.
- `ad_to_payload` stores the raw phone strings from the phones endpoint in the verbatim payload; normalization happens only when building `contact_hints`. A naive `createdTime` raises `ValueError` naming the ad (timezone-aware datetimes are a protocol requirement).
- Fixture edits in tests use `"isActive": true` / `"status": "active"` **with the space after the colon** — that is how the recorded JSON is spelled.
- Tests assert the discovery budget (`http.calls` per run: a full walk, then an unchanged run stops after page 1; a `full_walk_every` run drops a delisted id from `known`) and parametrize the blocked-status test over 429 and 403.

### Task 5: Telegram adapter (Telethon behind a client protocol)

**Files:**
- Create: `backend/app/ingestion/adapters/telegram/__init__.py`, `backend/app/ingestion/adapters/telegram/client.py`, `backend/tests/fixtures/telegram/messages.json`
- Modify: `backend/pyproject.toml` (+ `"telethon>=1.36"`; mypy override for `telethon.*` already exists)
- Test: `backend/tests/test_telegram_adapter.py`

**Interfaces:**
- Consumes: `AdapterBackoff`, `LoginRequired`, `RawRef`, `RawPayload`, `SeenWindow` (Task 2); settings `telegram_api_id`, `telegram_api_hash`, `telegram_session_path`, `telegram_backfill_days`, `telegram_rescan_limit`.
- Produces:
  - `telegram.client.TgMessage` dataclass: `id: int`, `date: datetime` (aware UTC), `text: str`, `grouped_id: int | None`, `has_photo: bool`, `edit_date: datetime | None`, `sender_id: int | None`, `sender_username: str | None`
  - `telegram.client.TelegramClientLike(Protocol)`: `async connect() -> None`; `async is_user_authorized() -> bool`; `async resolve_peer(peer: str | int) -> tuple[int, str | None]` → `(chat_id, username)`; `def iter_messages(chat_id: int, *, min_id: int = 0, offset_date: datetime | None = None, reverse: bool = False, limit: int | None = None) -> AsyncIterator[TgMessage]`; `async get_messages(chat_id: int, ids: list[int]) -> list[TgMessage]`; `async download_photo(chat_id: int, message_id: int) -> bytes`
  - `telegram.client.TelethonClient` — the real implementation wrapping `telethon.TelegramClient`; translates `FloodWaitError` → `AdapterBackoff(timedelta(seconds=e.seconds), "telegram flood wait")`, `AuthKeyUnregisteredError | SessionRevokedError | UserDeactivatedBanError | UnauthorizedError` → `LoginRequired`; `make_client(settings) -> TelethonClient`
  - `TelegramAdapter(client: TelegramClientLike, *, backfill_days: int = 14, rescan_limit: int = 200, now: Callable[[], datetime] = lambda: datetime.now(UTC))` implementing `SourceAdapter` (`kind = "telegram"`) plus `async fetch_by_url(url) -> RawPayload` for `https://t.me/<username>/<message_id>`. `source.config = {"peer": "@name" | -100…}`; `source.state` keys: `chat_id`, `username`, `last_message_id`, `last_run_at` (ISO).
  - External id `"<chat_id>:<first message id of the album>"`; `payload = {"chat_id", "peer", "username", "message_ids", "text", "date", "edit_date", "sender_id", "sender_username", "photo_message_ids"}`; `photo_refs = [{"chat_id": …, "message_id": …}]`; `url = "https://t.me/<username>/<id>"` when the peer has a username.

- [ ] **Step 1: Fixture and failing tests**

`backend/tests/fixtures/telegram/messages.json` (an album of two photos + text, a plain text post, an edited post, and a photo-only post):
```json
[
  {"id": 101, "date": "2026-08-28T09:00:00+00:00", "text": "Chilonzor, Qatortol, 2-xonali, 3/9, 54 m², evro remont. Egasidan. 450$. Tel 90 811 24 37", "grouped_id": 555, "has_photo": true, "edit_date": null, "sender_id": 777, "sender_username": null},
  {"id": 102, "date": "2026-08-28T09:00:01+00:00", "text": "", "grouped_id": 555, "has_photo": true, "edit_date": null, "sender_id": 777, "sender_username": null},
  {"id": 103, "date": "2026-08-28T10:00:00+00:00", "text": "Yunusobod 11-kvartal 3-xonali 5/9 78 m² 650$ tel 94 128 44 60 @dilshod_uy", "grouped_id": null, "has_photo": false, "edit_date": null, "sender_id": 778, "sender_username": "dilshod_uy"},
  {"id": 104, "date": "2026-08-28T11:00:00+00:00", "text": "Sergeli 7-mavze 2-xonali 1/5 48 m² 350$ tel 90 777 42 15", "grouped_id": null, "has_photo": true, "edit_date": "2026-08-29T08:00:00+00:00", "sender_id": 779, "sender_username": null},
  {"id": 105, "date": "2026-08-28T12:00:00+00:00", "text": "", "grouped_id": null, "has_photo": true, "edit_date": null, "sender_id": 780, "sender_username": null}
]
```

`backend/tests/test_telegram_adapter.py`:
```python
import json
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from app.ingestion.adapters.base import LoginRequired, RawRef
from app.ingestion.adapters.telegram import TelegramAdapter
from app.ingestion.adapters.telegram.client import TgMessage
from app.modules.listings.models import RawListing, Source

FIX = Path(__file__).parent / "fixtures" / "telegram" / "messages.json"
NOW = datetime(2026, 8, 30, 12, 0, tzinfo=UTC)


def _messages() -> list[TgMessage]:
    out = []
    for m in json.loads(FIX.read_text()):
        out.append(TgMessage(
            id=m["id"], date=datetime.fromisoformat(m["date"]), text=m["text"], grouped_id=m["grouped_id"],
            has_photo=m["has_photo"], edit_date=datetime.fromisoformat(m["edit_date"]) if m["edit_date"] else None,
            sender_id=m["sender_id"], sender_username=m["sender_username"],
        ))
    return out


class FakeClient:
    def __init__(self, messages: list[TgMessage], *, authorized: bool = True) -> None:
        self.messages = sorted(messages, key=lambda m: m.id)
        self.authorized = authorized
        self.connected = False
        self.downloads: list[tuple[int, int]] = []

    async def connect(self) -> None:
        self.connected = True

    async def is_user_authorized(self) -> bool:
        return self.authorized

    async def resolve_peer(self, peer: str | int) -> tuple[int, str | None]:
        return (-1001234, "toshkent_ijara") if peer == "@toshkent_ijara" else (-1009999, None)

    async def iter_messages(self, chat_id: int, *, min_id: int = 0, offset_date: datetime | None = None, reverse: bool = False, limit: int | None = None) -> AsyncIterator[TgMessage]:
        msgs = [m for m in self.messages if m.id > min_id and (offset_date is None or m.date > offset_date)]
        msgs = msgs if reverse else list(reversed(msgs))
        for m in msgs[: limit or None]:
            yield m

    async def get_messages(self, chat_id: int, ids: list[int]) -> list[TgMessage]:
        return [m for m in self.messages if m.id in ids]

    async def download_photo(self, chat_id: int, message_id: int) -> bytes:
        self.downloads.append((chat_id, message_id))
        return b"\xff\xd8" + bytes([message_id % 256]) * 16


def _source(state: dict | None = None) -> Source:  # type: ignore[type-arg]
    return Source(kind="telegram", name="@toshkent_ijara", config={"peer": "@toshkent_ijara"}, state=state or {})


async def test_first_run_backfills_and_groups_albums() -> None:
    client = FakeClient(_messages())
    adapter = TelegramAdapter(client, backfill_days=14, rescan_limit=200, now=lambda: NOW)  # type: ignore[arg-type]
    source = _source()
    refs = [r async for r in adapter.discover(source)]
    assert [r.external_id for r in refs] == ["-1001234:101", "-1001234:103", "-1001234:104", "-1001234:105"]
    assert refs[0].posted_at == datetime(2026, 8, 28, 9, 0, tzinfo=UTC) and refs[0].url == "https://t.me/toshkent_ijara/101"
    assert source.state["chat_id"] == -1001234 and source.state["last_message_id"] == 105 and source.state["username"] == "toshkent_ijara"
    window = await adapter.seen_window(source)
    assert window is not None and window.ids == {"-1001234:101", "-1001234:103", "-1001234:104", "-1001234:105"}
    assert window.oldest_posted_at == datetime(2026, 8, 28, 9, 0, tzinfo=UTC)


async def test_fetch_builds_payload_with_album_photos_and_username() -> None:
    client = FakeClient(_messages())
    adapter = TelegramAdapter(client, now=lambda: NOW)  # type: ignore[arg-type]
    source = _source()
    refs = {r.external_id: r async for r in adapter.discover(source)}
    album = await adapter.fetch(refs["-1001234:101"])
    assert album.text.startswith("Chilonzor, Qatortol") and album.photo_refs == [{"chat_id": -1001234, "message_id": 101}, {"chat_id": -1001234, "message_id": 102}]
    assert album.sender_username == "toshkent_ijara" and album.payload["message_ids"] == [101, 102]
    plain = await adapter.fetch(refs["-1001234:103"])
    assert plain.sender_username == "dilshod_uy" and plain.photo_refs == []
    photo_only = await adapter.fetch(refs["-1001234:105"])
    assert photo_only.text == "" and photo_only.photo_refs == [{"chat_id": -1001234, "message_id": 105}]
    assert await adapter.download_photo(album.photo_refs[1]) == b"\xff\xd8" + bytes([102]) * 16


async def test_second_run_yields_only_new_and_edited() -> None:
    client = FakeClient(_messages())
    adapter = TelegramAdapter(client, now=lambda: NOW)  # type: ignore[arg-type]
    source = _source()
    _ = [r async for r in adapter.discover(source)]
    # nothing new; message 104 was edited after the last run → it is re-yielded
    source.state = {**source.state, "last_run_at": (NOW - timedelta(days=2)).isoformat()}
    again = [r.external_id async for r in adapter.discover(source)]
    assert again == ["-1001234:104"]
    # a new message appears
    client.messages.append(TgMessage(id=106, date=NOW, text="Mirobod 3-xonali 700$", grouped_id=None, has_photo=False, edit_date=None, sender_id=1, sender_username=None))
    source.state = {**source.state, "last_run_at": NOW.isoformat()}
    assert [r.external_id async for r in adapter.discover(source)] == ["-1001234:106"]


async def test_unauthorized_client_raises_login_required() -> None:
    adapter = TelegramAdapter(FakeClient(_messages(), authorized=False), now=lambda: NOW)  # type: ignore[arg-type]
    with pytest.raises(LoginRequired):
        _ = [r async for r in adapter.discover(_source())]


def test_marked_chat_id_follows_telethon_conventions() -> None:
    from telethon.tl import types

    from app.ingestion.adapters.telegram.client import marked_chat_id

    assert marked_chat_id(types.PeerUser(user_id=5)) == 5
    assert marked_chat_id(types.PeerChat(chat_id=77)) == -77
    assert marked_chat_id(types.PeerChannel(channel_id=1234)) == -1000000001234


async def test_rebuild_payload_and_fetch_by_url() -> None:
    client = FakeClient(_messages())
    adapter = TelegramAdapter(client, now=lambda: NOW)  # type: ignore[arg-type]
    source = _source()
    refs = {r.external_id: r async for r in adapter.discover(source)}
    p = await adapter.fetch(refs["-1001234:101"])
    raw = RawListing(external_id=p.external_id, payload=p.payload, content_hash="h", fetched_at=NOW)
    assert await adapter.rebuild_payload(raw) == p
    by_url = await adapter.fetch_by_url("https://t.me/toshkent_ijara/103")
    assert by_url.external_id == "-1001234:103" and "Yunusobod" in by_url.text
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd backend && .venv/bin/pytest tests/test_telegram_adapter.py -q`
Expected: FAIL with `ModuleNotFoundError: app.ingestion.adapters.telegram`

- [ ] **Step 3: Client protocol and the Telethon implementation**

Add `"telethon>=1.36",` to `dependencies` in `backend/pyproject.toml`, then `cd backend && uv pip install -e ".[dev]"`.

`backend/app/ingestion/adapters/telegram/client.py`:
```python
"""A minimal Telegram client surface so the adapter is testable without Telethon."""

from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Protocol

from app.core.settings import Settings
from app.ingestion.adapters.base import AdapterBackoff, LoginRequired


@dataclass
class TgMessage:
    id: int
    date: datetime
    text: str
    grouped_id: int | None
    has_photo: bool
    edit_date: datetime | None
    sender_id: int | None
    sender_username: str | None


class TelegramClientLike(Protocol):
    async def connect(self) -> None: ...

    async def is_user_authorized(self) -> bool: ...

    async def resolve_peer(self, peer: str | int) -> tuple[int, str | None]: ...

    def iter_messages(
        self,
        chat_id: int,
        *,
        min_id: int = 0,
        offset_date: datetime | None = None,
        reverse: bool = False,
        limit: int | None = None,
    ) -> AsyncIterator[TgMessage]: ...

    async def get_messages(self, chat_id: int, ids: list[int]) -> list[TgMessage]: ...

    async def download_photo(self, chat_id: int, message_id: int) -> bytes: ...


def marked_chat_id(entity: Any) -> int:
    """Telethon's marked id: users unchanged, basic groups -id, channels/megagroups -(10**12 + id)."""
    from telethon import utils

    return int(utils.get_peer_id(entity, add_mark=True))


def _to_msg(message: Any) -> TgMessage:
    sender = getattr(message, "sender", None)
    date = message.date if message.date.tzinfo else message.date.replace(tzinfo=UTC)
    edit = message.edit_date
    return TgMessage(
        id=int(message.id),
        date=date,
        text=message.message or "",
        grouped_id=int(message.grouped_id) if message.grouped_id else None,
        has_photo=message.photo is not None,
        edit_date=(edit if edit is None or edit.tzinfo else edit.replace(tzinfo=UTC)),
        sender_id=int(message.sender_id) if message.sender_id is not None else None,
        sender_username=getattr(sender, "username", None),
    )


class TelethonClient:
    """Wraps `telethon.TelegramClient`; translates its errors into adapter exceptions."""

    def __init__(self, session_path: str, api_id: int, api_hash: str) -> None:
        from telethon import TelegramClient

        self._client = TelegramClient(session_path, api_id, api_hash)
        self._entities: dict[int, Any] = {}

    async def connect(self) -> None:
        await self._client.connect()

    async def is_user_authorized(self) -> bool:
        """Probe with `get_me()`: Telethon's own `is_user_authorized()` swallows every RPCError
        (a FloodWait would read as "not authorized"); `get_me()` returns None only when
        unauthorized and lets a FloodWait propagate through `_guard` as AdapterBackoff."""
        me = await self._guard(self._client.get_me())
        return me is not None

    async def resolve_peer(self, peer: str | int) -> tuple[int, str | None]:
        entity = await self._guard(self._client.get_entity(peer))
        chat_id = marked_chat_id(entity)
        self._entities[chat_id] = entity
        return chat_id, getattr(entity, "username", None)

    async def iter_messages(  # type: ignore[override]
        self,
        chat_id: int,
        *,
        min_id: int = 0,
        offset_date: datetime | None = None,
        reverse: bool = False,
        limit: int | None = None,
    ) -> AsyncIterator[TgMessage]:
        entity = self._entities.get(chat_id, chat_id)
        try:
            async for message in self._client.iter_messages(entity, min_id=min_id, offset_date=offset_date, reverse=reverse, limit=limit):
                yield _to_msg(message)
        except Exception as exc:  # noqa: BLE001
            raise _translate(exc) from exc

    async def get_messages(self, chat_id: int, ids: list[int]) -> list[TgMessage]:
        entity = self._entities.get(chat_id, chat_id)
        messages = await self._guard(self._client.get_messages(entity, ids=ids))
        return [_to_msg(m) for m in messages if m is not None]

    async def download_photo(self, chat_id: int, message_id: int) -> bytes:
        entity = self._entities.get(chat_id, chat_id)
        [message] = await self._guard(self._client.get_messages(entity, ids=[message_id]))
        data = await self._guard(self._client.download_media(message, file=bytes))
        if not isinstance(data, bytes):
            raise RuntimeError(f"no media on message {message_id}")
        return data

    async def _guard(self, awaitable: Any) -> Any:
        try:
            return await awaitable
        except Exception as exc:  # noqa: BLE001
            raise _translate(exc) from exc


def _translate(exc: Exception) -> Exception:
    from telethon import errors

    if isinstance(exc, errors.FloodWaitError):
        return AdapterBackoff(timedelta(seconds=int(exc.seconds)), "telegram flood wait")
    if isinstance(exc, errors.AuthKeyUnregisteredError | errors.SessionRevokedError | errors.UserDeactivatedBanError | errors.UnauthorizedError):
        return LoginRequired(str(exc))
    return exc


def make_client(settings: Settings) -> TelethonClient:
    settings.telegram_session_path.parent.mkdir(parents=True, exist_ok=True)
    return TelethonClient(str(settings.telegram_session_path), settings.telegram_api_id, settings.telegram_api_hash)
```
(`iter_messages` is an async generator on both the protocol and the implementation; mypy accepts a `def` returning `AsyncIterator` on the protocol against an `async def … yield` implementation — the `# type: ignore[override]` is a fallback only if your mypy version complains; remove it if not needed.)

- [ ] **Step 4: The adapter**

`backend/app/ingestion/adapters/telegram/__init__.py`:
```python
"""Telegram adapter: public channels or groups the team account can read."""

import re
import uuid
from collections.abc import AsyncIterator, Callable
from datetime import UTC, datetime, timedelta
from typing import Any

from app.ingestion.adapters.base import LoginRequired, RawPayload, RawRef
from app.ingestion.adapters.telegram.client import TelegramClientLike, TgMessage
from app.modules.listings.models import RawListing, Source
from app.modules.listings.service import SeenWindow

_TME = re.compile(r"^https?://t\.me/([A-Za-z0-9_]{5,32})/(\d+)$")


class TelegramAdapter:
    kind = "telegram"

    def __init__(
        self,
        client: TelegramClientLike,
        *,
        backfill_days: int = 14,
        rescan_limit: int = 200,
        now: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        self.client, self.backfill_days, self.rescan_limit, self._now = client, backfill_days, rescan_limit, now
        self._windows: dict[uuid.UUID, SeenWindow] = {}
        self._ready = False

    async def _ensure_ready(self) -> None:
        if not self._ready:
            await self.client.connect()
            self._ready = True
        if not await self.client.is_user_authorized():
            raise LoginRequired("telegram session is not authorized")

    async def _resolve(self, source: Source) -> tuple[int, str | None]:
        chat_id, username = await self.client.resolve_peer(source.config["peer"])
        if source.state.get("chat_id") != chat_id or source.state.get("username") != username:
            source.state = {**source.state, "chat_id": chat_id, "username": username}
        return chat_id, username

    @staticmethod
    def _groups(messages: list[TgMessage]) -> list[list[TgMessage]]:
        groups: list[list[TgMessage]] = []
        by_album: dict[int, list[TgMessage]] = {}
        for m in messages:
            if m.grouped_id is None:
                groups.append([m])
            elif m.grouped_id in by_album:
                by_album[m.grouped_id].append(m)
            else:
                by_album[m.grouped_id] = [m]
                groups.append(by_album[m.grouped_id])
        return groups

    def _ref(self, chat_id: int, username: str | None, group: list[TgMessage]) -> RawRef:
        first = group[0]
        url = f"https://t.me/{username}/{first.id}" if username else None
        return RawRef(
            external_id=f"{chat_id}:{first.id}",
            url=url,
            posted_at=first.date,
            meta={"chat_id": chat_id, "username": username, "messages": [m.__dict__ for m in group]},
        )

    async def discover(self, source: Source) -> AsyncIterator[RawRef]:
        await self._ensure_ready()
        chat_id, username = await self._resolve(source)
        last_id = int(source.state.get("last_message_id", 0))
        last_run = source.state.get("last_run_at")
        last_run_at = datetime.fromisoformat(last_run) if last_run else None
        now = self._now()

        new_messages: list[TgMessage] = []
        if last_id:
            async for m in self.client.iter_messages(chat_id, min_id=last_id, reverse=True):
                new_messages.append(m)
        else:
            since = now - timedelta(days=self.backfill_days)
            async for m in self.client.iter_messages(chat_id, offset_date=since, reverse=True):
                new_messages.append(m)
        yielded: set[str] = set()
        for group in self._groups(new_messages):
            ref = self._ref(chat_id, username, group)
            yielded.add(ref.external_id)
            yield ref

        recent: list[TgMessage] = []
        async for m in self.client.iter_messages(chat_id, limit=self.rescan_limit):
            recent.append(m)
        recent_groups = self._groups(sorted(recent, key=lambda m: m.id))
        ids: set[str] = set()
        oldest: datetime | None = None
        for group in recent_groups:
            ref = self._ref(chat_id, username, group)
            ids.add(ref.external_id)
            oldest = group[0].date if oldest is None or group[0].date < oldest else oldest
            edited = any(m.edit_date and last_run_at and m.edit_date > last_run_at for m in group)
            if edited and ref.external_id not in yielded:
                yielded.add(ref.external_id)
                yield ref
        self._windows[source.id] = SeenWindow(ids=ids, oldest_posted_at=oldest)

        max_id = max([m.id for m in new_messages] + [m.id for m in recent] + [last_id])
        source.state = {**source.state, "last_message_id": max_id, "last_run_at": now.isoformat()}

    async def fetch(self, ref: RawRef) -> RawPayload:
        chat_id, username = int(ref.meta["chat_id"]), ref.meta.get("username")
        messages = [TgMessage(**m) for m in ref.meta["messages"]]
        return self._payload(chat_id, username, messages)

    def _payload(self, chat_id: int, username: str | None, messages: list[TgMessage]) -> RawPayload:
        first = messages[0]
        text = next((m.text for m in messages if m.text.strip()), "")
        sender_username = next((m.sender_username for m in messages if m.sender_username), None) or username
        photo_ids = [m.id for m in messages if m.has_photo]
        edit = max((m.edit_date for m in messages if m.edit_date), default=None)
        return RawPayload(
            external_id=f"{chat_id}:{first.id}",
            url=f"https://t.me/{username}/{first.id}" if username else None,
            posted_at=first.date,
            text=text,
            structured=None,
            sender_username=sender_username,
            contact_hints=[],
            photo_refs=[{"chat_id": chat_id, "message_id": mid} for mid in photo_ids],
            payload={
                "chat_id": chat_id, "username": username, "message_ids": [m.id for m in messages], "text": text,
                "date": first.date.isoformat(), "edit_date": edit.isoformat() if edit else None,
                "sender_id": first.sender_id, "sender_username": sender_username, "photo_message_ids": photo_ids,
            },
        )

    async def fetch_by_url(self, url: str) -> RawPayload:
        match = _TME.match(url.strip())
        if match is None:
            raise ValueError(f"not a t.me message link: {url}")
        await self._ensure_ready()
        chat_id, username = await self.client.resolve_peer("@" + match.group(1))
        messages = await self.client.get_messages(chat_id, [int(match.group(2))])
        if not messages:
            raise ValueError(f"message not found: {url}")
        anchor = messages[0]
        group = [anchor]
        if anchor.grouped_id is not None:
            siblings = await self.client.get_messages(chat_id, list(range(anchor.id - 9, anchor.id + 10)))
            group = sorted([m for m in siblings if m.grouped_id == anchor.grouped_id], key=lambda m: m.id)
        return self._payload(chat_id, username, group)

    async def seen_window(self, source: Source) -> SeenWindow | None:
        return self._windows.pop(source.id, None)

    async def download_photo(self, ref: Any) -> bytes:
        return await self.client.download_photo(int(ref["chat_id"]), int(ref["message_id"]))

    async def rebuild_payload(self, raw: RawListing) -> RawPayload:
        p = raw.payload
        photo_ids = set(p.get("photo_message_ids", []))
        first_date = datetime.fromisoformat(p["date"])
        messages = [
            TgMessage(id=mid, date=first_date, text=p["text"] if i == 0 else "", grouped_id=None if len(p["message_ids"]) == 1 else 1,
                      has_photo=mid in photo_ids, edit_date=datetime.fromisoformat(p["edit_date"]) if p.get("edit_date") else None,
                      sender_id=p.get("sender_id"), sender_username=p.get("sender_username"))
            for i, mid in enumerate(p["message_ids"])
        ]
        return self._payload(int(p["chat_id"]), p.get("username"), messages)
```
Note: `rebuild_payload` reconstructs only what `_payload` reads (ids, text, photo flags, dates, sender) so the rebuilt payload equals the original; the `edit_date` is attached to the first message, which `_payload`'s `max()` reproduces.

- [ ] **Step 5: Run the tests, suite and gates; commit**

Run: `cd backend && .venv/bin/pytest tests/test_telegram_adapter.py -q && .venv/bin/pytest -q && .venv/bin/ruff check . && .venv/bin/ruff format --check . && .venv/bin/mypy app`
Expected: all PASSED. mypy: the `FakeClient` in tests is not type-checked (mypy runs on `app` only).
```bash
git add backend
git commit -m "feat(telegram): Telethon-backed adapter behind a client protocol — backfill, albums, edit rescan, removal window, login/flood handling"
```

---

### Task 6: Manual ingestion — paste a link or fill a form

**Files:**
- Create: `backend/app/ingestion/manual.py`, `backend/app/ingestion/registry.py`
- Test: `backend/tests/test_manual.py`

**Interfaces:**
- Consumes: `ingest_payload(session, source, payload, *, adapter, cfg, photo_dir, now)` (M0-1), `OlxAdapter.fetch_by_url`, `TelegramAdapter.fetch_by_url` (Tasks 4–5), `normalize_phone` (Task 4), `HttpxClient`/`RateLimiter` (Task 3), `make_client` (Task 5).
- Produces:
  - `registry.AdapterRegistry`: `__init__(self, adapters: dict[str, SourceAdapter])`; `get(kind: str) -> SourceAdapter` (raises `KeyError`); `for_source(source: Source) -> SourceAdapter`; `kinds -> list[str]`
  - `registry.build_registry(settings, *, http: HttpClient | None = None, telegram_client: TelegramClientLike | None = None) -> AdapterRegistry` — builds `olx` (HttpxClient + RateLimiter from settings) and `telegram` (`make_client(settings)`) lazily-configured instances plus `manual`
  - `manual.ManualAdapter(photos: dict[str, bytes] | None = None)` — `kind = "manual"`, `discover` yields nothing, `fetch` raises, `download_photo(ref)` returns `photos[ref]`, `rebuild_payload(raw)` rebuilds from `raw.payload`
  - `manual.ManualListingForm` (pydantic): `title: str`, `description: str = ""`, `price_amount_minor: int | None`, `price_currency: Literal["USD", "UZS"] | None`, `rooms/floor/total_floors: int | None`, `area_sqm: float | None`, `district: str | None`, `phone: str | None`; photos passed separately as `list[bytes]`
  - `manual.ensure_manual_source(session) -> Source` (kind `manual`, name `manual`, `enabled=False` so the worker never schedules it)
  - `manual.pick_source(session, kind) -> Source | None` (first enabled source of that kind by `created_at`)
  - `manual.ingest_url(session, url, registry, *, cfg, photo_dir, now) -> IngestResult` — `olx.uz` → OLX adapter, `t.me` → Telegram adapter, else `ValueError("unsupported url")`; the listing lands on the enabled source of that kind if one exists (so the crawler recognises it later), otherwise on the manual source
  - `manual.ingest_form(session, form, photos, *, cfg, photo_dir, now) -> IngestResult` — `external_id = "form:" + uuid4().hex`, `text = title + "\n" + description`, `structured` from the form, `contact_hints = [("phone", e164)]` when the phone normalises, `photo_refs = ["0", "1", …]`, `payload = form.model_dump() | {"photo_count": n}`

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_manual.py`:
```python
from datetime import UTC, datetime
from pathlib import Path

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ingestion.adapters.base import RawPayload
from app.ingestion.manual import ManualListingForm, ensure_manual_source, ingest_form, ingest_url, pick_source
from app.ingestion.registry import AdapterRegistry
from app.modules.dedupe.config import load_config
from app.modules.listings.models import Listing, ListingPhoto, RawListing, Source
from tests.fakes import FakeAdapter, payload
from tests.helpers import make_jpeg

CFG = load_config(Path(__file__).resolve().parents[1] / "config" / "dedupe.yaml")
NOW = datetime(2026, 8, 30, 12, 0, tzinfo=UTC)


class UrlFake(FakeAdapter):
    def __init__(self, kind: str, p: RawPayload) -> None:
        super().__init__([p], None)
        self.kind = kind
        self.urls: list[str] = []

    async def fetch_by_url(self, url: str) -> RawPayload:
        self.urls.append(url)
        return self.payloads[0]


async def test_ingest_url_routes_by_host_and_prefers_the_enabled_source(db: AsyncSession, tmp_path: Path) -> None:
    olx_source = Source(kind="olx", name="olx", config={"url": "x"}, enabled=True)
    db.add(olx_source)
    await db.flush()
    olx = UrlFake("olx", payload("65000001", "Chilonzor 2-xonali 3/9 450$ tel 90 811 24 37", photos=["1"]))
    tg = UrlFake("telegram", payload("-100:5", "Yunusobod 3-xonali 650$"))
    registry = AdapterRegistry({"olx": olx, "telegram": tg})  # type: ignore[dict-item]
    result = await ingest_url(db, "https://www.olx.uz/d/obyavlenie/x-ID1.html", registry, cfg=CFG, photo_dir=tmp_path, now=NOW)
    assert result.created and olx.urls == ["https://www.olx.uz/d/obyavlenie/x-ID1.html"]
    raw = (await db.execute(select(RawListing))).scalar_one()
    assert raw.source_id == olx_source.id and raw.external_id == "65000001"
    assert (await db.execute(select(ListingPhoto))).scalars().one().phash is not None
    result2 = await ingest_url(db, "https://t.me/toshkent_ijara/5", registry, cfg=CFG, photo_dir=tmp_path, now=NOW)
    manual = await pick_source(db, "manual") or (await db.execute(select(Source).where(Source.kind == "manual"))).scalar_one()
    assert result2.listing.raw.source_id == manual.id  # no enabled telegram source → the manual source
    with pytest.raises(ValueError):
        await ingest_url(db, "https://example.com/flat", registry, cfg=CFG, photo_dir=tmp_path, now=NOW)


async def test_ingest_form_builds_listing_with_photos_and_phone(db: AsyncSession, tmp_path: Path) -> None:
    form = ManualListingForm(title="Mirobod, Oybek", description="3-xonali, 4/5 qavat, 80 m²", price_amount_minor=70000, price_currency="USD",
                             rooms=3, floor=4, total_floors=5, area_sqm=80.0, district="mirobod", phone="97 715 60 02")
    result = await ingest_form(db, form, [make_jpeg(300, 200, 1), make_jpeg(300, 200, 2)], cfg=CFG, photo_dir=tmp_path, now=NOW)
    listing = result.listing
    assert (listing.price_usd_minor, listing.rooms, listing.floor, listing.total_floors, listing.area_sqm, listing.district) == (70000, 3, 4, 5, 80.0, "mirobod")
    assert listing.raw.external_id.startswith("form:") and listing.raw.payload["photo_count"] == 2
    photos = (await db.execute(select(ListingPhoto).order_by(ListingPhoto.position))).scalars().all()
    assert [p.phash is not None for p in photos] == [True, True]
    manual = await ensure_manual_source(db)
    assert listing.raw.source_id == manual.id and manual.enabled is False
    from app.modules.contacts.service import contacts_for_listing
    assert [(c.kind, c.identifier) for c in await contacts_for_listing(db, listing.id)] == [("phone", "+998977156002")]


async def test_ensure_manual_source_is_idempotent(db: AsyncSession) -> None:
    a = await ensure_manual_source(db)
    b = await ensure_manual_source(db)
    assert a.id == b.id and (await db.execute(select(Source).where(Source.kind == "manual"))).scalars().one().name == "manual"
```
(`Listing.raw` is the relationship defined in M0-1's models.)

- [ ] **Step 2: Run them to verify they fail**

Run: `cd backend && .venv/bin/pytest tests/test_manual.py -q`
Expected: FAIL with `ModuleNotFoundError: app.ingestion.manual`

- [ ] **Step 3: Registry**

`backend/app/ingestion/registry.py`:
```python
"""Build and look up the adapters the worker and the CLI drive."""

from app.core.settings import Settings
from app.ingestion.adapters.base import SourceAdapter
from app.ingestion.adapters.olx import OlxAdapter
from app.ingestion.adapters.telegram import TelegramAdapter
from app.ingestion.adapters.telegram.client import TelegramClientLike, make_client
from app.ingestion.http import HttpClient, HttpxClient, RateLimiter
from app.ingestion.manual import ManualAdapter
from app.modules.listings.models import Source


class AdapterRegistry:
    def __init__(self, adapters: dict[str, SourceAdapter]) -> None:
        self._adapters = adapters

    def get(self, kind: str) -> SourceAdapter:
        return self._adapters[kind]

    def for_source(self, source: Source) -> SourceAdapter:
        try:
            return self._adapters[source.kind]
        except KeyError as exc:
            raise ValueError(f"no adapter for source kind {source.kind!r}") from exc

    @property
    def kinds(self) -> list[str]:
        return sorted(self._adapters)


def build_registry(
    settings: Settings, *, http: HttpClient | None = None, telegram_client: TelegramClientLike | None = None
) -> AdapterRegistry:
    http = http or HttpxClient(user_agent=settings.http_user_agent, proxy=settings.olx_proxy_url)
    olx = OlxAdapter(http, RateLimiter(settings.olx_request_interval), max_pages=settings.olx_max_pages)
    telegram = TelegramAdapter(
        telegram_client or make_client(settings),
        backfill_days=settings.telegram_backfill_days,
        rescan_limit=settings.telegram_rescan_limit,
    )
    return AdapterRegistry({"olx": olx, "telegram": telegram, "manual": ManualAdapter()})
```

- [ ] **Step 4: Manual ingestion**

`backend/app/ingestion/manual.py`:
```python
"""Listings the team adds by hand: a pasted OLX/Telegram link, or a short form."""

import uuid
from collections.abc import AsyncIterator
from datetime import datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any, Literal
from urllib.parse import urlsplit

from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ingestion.adapters.base import RawPayload, RawRef
from app.ingestion.parse import normalize_phone
from app.ingestion.pipeline import IngestResult, ingest_payload
from app.modules.dedupe.config import DedupeConfig
from app.modules.listings.models import RawListing, Source
from app.modules.listings.service import SeenWindow

if TYPE_CHECKING:  # the registry imports this module; import it for typing only
    from app.ingestion.registry import AdapterRegistry

HOST_KINDS = {"olx.uz": "olx", "www.olx.uz": "olx", "t.me": "telegram", "telegram.me": "telegram"}


class ManualAdapter:
    kind = "manual"

    def __init__(self, photos: dict[str, bytes] | None = None) -> None:
        self.photos = photos or {}

    async def discover(self, source: Source) -> AsyncIterator[RawRef]:
        return
        yield  # pragma: no cover — an async generator that yields nothing

    async def fetch(self, ref: RawRef) -> RawPayload:
        raise RuntimeError("manual listings are not fetched")

    async def seen_window(self, source: Source) -> SeenWindow | None:
        return None

    async def download_photo(self, ref: Any) -> bytes:
        return self.photos[str(ref)]

    async def rebuild_payload(self, raw: RawListing) -> RawPayload:
        p = raw.payload
        form = ManualListingForm.model_validate({k: v for k, v in p.items() if k != "photo_count"})
        return form_payload(raw.external_id, form, int(p.get("photo_count", 0)), datetime.fromisoformat(p["posted_at"]))


class ManualListingForm(BaseModel):
    title: str
    description: str = ""
    price_amount_minor: int | None = None
    price_currency: Literal["USD", "UZS"] | None = None
    rooms: int | None = None
    floor: int | None = None
    total_floors: int | None = None
    area_sqm: float | None = None
    district: str | None = None
    phone: str | None = None


def form_payload(external_id: str, form: ManualListingForm, photo_count: int, now: datetime) -> RawPayload:
    structured = {k: v for k, v in form.model_dump(exclude={"phone", "description"}).items() if v is not None}
    e164 = normalize_phone(form.phone) if form.phone else None
    return RawPayload(
        external_id=external_id,
        url=None,
        posted_at=now,
        text=f"{form.title}\n{form.description}".strip(),
        structured=structured,
        sender_username=None,
        contact_hints=[("phone", e164)] if e164 else [],
        photo_refs=[str(i) for i in range(photo_count)],
        payload={**form.model_dump(), "photo_count": photo_count, "posted_at": now.isoformat()},
    )


async def ensure_manual_source(session: AsyncSession) -> Source:
    source = (await session.execute(select(Source).where(Source.kind == "manual"))).scalar_one_or_none()
    if source is None:
        source = Source(kind="manual", name="manual", config={}, enabled=False)
        session.add(source)
        await session.flush()
    return source


async def pick_source(session: AsyncSession, kind: str) -> Source | None:
    stmt = select(Source).where(Source.kind == kind, Source.enabled.is_(True)).order_by(Source.created_at).limit(1)
    return (await session.execute(stmt)).scalar_one_or_none()


async def ingest_url(
    session: AsyncSession, url: str, registry: "AdapterRegistry", *, cfg: DedupeConfig, photo_dir: Path, now: datetime
) -> IngestResult:
    host = urlsplit(url).netloc.lower()
    kind = HOST_KINDS.get(host)
    if kind is None:
        raise ValueError(f"unsupported url: {url}")
    adapter: Any = registry.get(kind)
    payload = await adapter.fetch_by_url(url)
    source = await pick_source(session, kind) or await ensure_manual_source(session)
    return await ingest_payload(session, source, payload, adapter=adapter, cfg=cfg, photo_dir=photo_dir, now=now)


async def ingest_form(
    session: AsyncSession, form: ManualListingForm, photos: list[bytes], *, cfg: DedupeConfig, photo_dir: Path, now: datetime
) -> IngestResult:
    source = await ensure_manual_source(session)
    payload = form_payload("form:" + uuid.uuid4().hex, form, len(photos), now)
    adapter = ManualAdapter({str(i): data for i, data in enumerate(photos)})
    return await ingest_payload(session, source, payload, adapter=adapter, cfg=cfg, photo_dir=photo_dir, now=now)
```
- [ ] **Step 5: Run the tests, suite and gates; commit**

Run: `cd backend && .venv/bin/pytest tests/test_manual.py -q && .venv/bin/pytest -q && .venv/bin/ruff check . && .venv/bin/ruff format --check . && .venv/bin/mypy app`
```bash
git add backend
git commit -m "feat(ingestion): manual ingestion by link or form; adapter registry"
```

---

#### Post-review amendments (Task 6, 2026-08-30)

- `ingest_url` routes `olx.uz`/`www.olx.uz` → OLX and `t.me` → Telegram only; `telegram.me` is **not** an alias (the Telegram adapter's `fetch_by_url` parses `t.me` links only) and raises `ValueError("unsupported url")` like any other host.
- `persist_parsed` never populates the `Listing.raw` relationship, so a synchronous `result.listing.raw` access after `ingest_payload` raises `MissingGreenlet` under `AsyncSession`. `IngestResult` documents this; `manual.py` wraps both entry points in one `_with_raw(session, result)` helper that does `await session.refresh(result.listing, ["raw"])`. API callers (M0-3) must eager-load or refresh the same way.
- `ManualAdapter.rebuild_payload` builds the form from the stored payload filtered to `ManualListingForm.model_fields` (so `photo_count`, `posted_at` and any future extra key are dropped explicitly rather than by pydantic's default `extra="ignore"`).
- Tests added beyond the sample: `tests/test_registry.py` (`get` KeyError, `kinds`, `for_source`, `build_registry` wiring from settings without network/DB), a committed `rebuild_payload` round-trip, `telegram.me` rejection, zero-photo and non-normalising-phone forms.

### Task 7: Worker loop and daily jobs

**Files:**
- Create: `backend/app/worker/loop.py`, `backend/app/worker/__main__.py`
- Modify: `backend/tests/fakes.py` (+ `test_session_factory`), `Makefile` (+ `worker` target)
- Test: `backend/tests/test_worker.py`

**Interfaces:**
- Consumes: `run_source` (pipeline), `AdapterRegistry` (Task 6), `age_out`/`recompute_many`/`rescore_all` (Task 2), `refresh_rate` (fx), `WorkerHeartbeat` model, settings (`worker_tick_seconds`, `daily_job_hour`, `tz`, `photo_dir`, `dedupe_config_path`).
- Produces:
  - `worker.loop.due_sources(session, now) -> list[Source]` — enabled, `next_run_at IS NULL OR <= now`, `paused_until IS NULL OR <= now`, ordered by `next_run_at NULLS FIRST`; a source whose `paused_until` has passed gets `status = "ok"` again when it runs successfully (already the pipeline's behaviour)
  - `worker.loop.run_due_sources(session_factory, registry, *, cfg, photo_dir, now) -> list[uuid.UUID]` — one session per source, `run_source` inside `try/except Exception` (logged), **`commit()` in `finally`**; returns the `CrawlRun` ids
  - `worker.loop.daily_jobs(session, *, now, http) -> dict[str, int]` — `{"aged_out_properties": n, "rescored_contacts": n, "fx": 1|0}`; FX failure is logged, never raised
  - `worker.loop.daily_due(last: datetime | None, now: datetime, tz: str, hour: int) -> bool` — true when local `now.hour >= hour` and `last` is `None` or before today's local date
  - `worker.loop.heartbeat(session, name, now) -> None` (upsert)
  - `worker.loop.tick(session_factory, registry, *, settings, cfg, http, now) -> None` — heartbeat `worker`, run due sources, then daily jobs if due (heartbeat `daily`)
  - `worker.loop.main() -> None` — settings, logging, engine/session factory, registry, loop `tick` every `worker_tick_seconds`, stops on SIGINT/SIGTERM; `python -m app.worker`
  - `tests/fakes.py::test_session_factory(db: AsyncSession) -> Callable[[], AsyncSession]` — sessions bound to the test connection (`join_transaction_mode="create_savepoint"`) so `commit()` inside the worker releases a savepoint and the test still rolls everything back

- [ ] **Step 1: Session factory for tests**

Append to `backend/tests/fakes.py`:
```python
from collections.abc import Callable

from sqlalchemy.ext.asyncio import AsyncSession


async def test_session_factory(db: AsyncSession) -> Callable[[], AsyncSession]:
    conn = await db.connection()

    def factory() -> AsyncSession:
        return AsyncSession(bind=conn, expire_on_commit=False, join_transaction_mode="create_savepoint")

    return factory
```

- [ ] **Step 2: Write the failing tests**

`backend/tests/test_worker.py`:
```python
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.settings import Settings
from app.ingestion.registry import AdapterRegistry
from app.modules.dedupe.config import load_config
from app.modules.listings.models import CrawlRun, FxRate, Source
from app.modules.listings.service import SeenWindow
from app.worker.loop import daily_due, daily_jobs, due_sources, heartbeat, run_due_sources, tick
from app.worker.models import WorkerHeartbeat
from tests.fakes import FakeAdapter, payload, test_session_factory

CFG = load_config(Path(__file__).resolve().parents[1] / "config" / "dedupe.yaml")
NOW = datetime(2026, 8, 30, 12, 0, tzinfo=UTC)  # 17:00 in Tashkent
OWNER = "Chilonzor 2-xonali 3/9 54 m² 450$ egasidan tel 90 811 24 37"


def _cbu_client() -> httpx.AsyncClient:
    body = [{"Ccy": "USD", "Rate": "12345.67", "Date": "30.08.2026"}]
    return httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(200, json=body)))


async def test_due_sources_filters_and_orders(db: AsyncSession) -> None:
    a = Source(kind="telegram", name="a", config={}, next_run_at=None)
    b = Source(kind="telegram", name="b", config={}, next_run_at=NOW - timedelta(minutes=1))
    c = Source(kind="telegram", name="c", config={}, next_run_at=NOW + timedelta(minutes=1))
    d = Source(kind="telegram", name="d", config={}, next_run_at=None, paused_until=NOW + timedelta(hours=1))
    e = Source(kind="telegram", name="e", config={}, enabled=False)
    db.add_all([a, b, c, d, e])
    await db.flush()
    assert [s.name for s in await due_sources(db, NOW)] == ["a", "b"]


async def test_run_due_sources_commits_even_when_a_source_fails(db: AsyncSession, tmp_path: Path) -> None:
    ok = Source(kind="telegram", name="ok", config={"peer": "@ok"})
    broken = Source(kind="olx", name="broken", config={"url": "x"})
    db.add_all([ok, broken])
    await db.flush()

    class Broken(FakeAdapter):
        kind = "olx"

        async def discover(self, source: Source):  # type: ignore[no-untyped-def]
            raise RuntimeError("flood")
            yield  # pragma: no cover

    registry = AdapterRegistry({"telegram": FakeAdapter([payload("1", OWNER)], SeenWindow({"1"}, NOW - timedelta(days=1))), "olx": Broken([], None)})  # type: ignore[dict-item]
    factory = await test_session_factory(db)
    run_ids = await run_due_sources(factory, registry, cfg=CFG, photo_dir=tmp_path, now=NOW)
    assert len(run_ids) == 2
    runs = {r.source_id: r for r in (await db.execute(select(CrawlRun))).scalars().all()}
    assert runs[ok.id].new == 1 and runs[broken.id].error == "flood"
    await db.refresh(broken)
    assert broken.consecutive_failures == 1 and broken.status == "failing" and broken.next_run_at == NOW + timedelta(seconds=900)


def test_daily_due_uses_local_date_and_hour() -> None:
    assert daily_due(None, NOW, "Asia/Tashkent", 3)
    assert not daily_due(NOW - timedelta(hours=1), NOW, "Asia/Tashkent", 3)  # already ran today
    assert daily_due(NOW - timedelta(days=1), NOW, "Asia/Tashkent", 3)
    early = datetime(2026, 8, 30, 21, 30, tzinfo=UTC)  # 02:30 next day in Tashkent, before 03:00
    assert not daily_due(NOW - timedelta(days=1), early, "Asia/Tashkent", 3)


async def test_daily_jobs_age_out_rescore_and_fx(db: AsyncSession, tmp_path: Path) -> None:
    s = Source(kind="telegram", name="s", config={})
    db.add(s)
    await db.flush()
    from app.ingestion.pipeline import run_source

    await run_source(db, FakeAdapter([payload("1", OWNER)], None), s, cfg=CFG, photo_dir=tmp_path, now=NOW - timedelta(days=40))
    async with _cbu_client() as client:
        result = await daily_jobs(db, now=NOW, http=client)
    assert result == {"aged_out_properties": 1, "rescored_contacts": 0, "fx": 1}
    assert (await db.execute(select(FxRate))).scalar_one().usd_uzs == 12345.67


async def test_tick_heartbeats_and_runs_daily_once(db: AsyncSession, tmp_path: Path) -> None:
    factory = await test_session_factory(db)
    registry = AdapterRegistry({})
    settings = Settings(_env_file=None, photo_dir=tmp_path)
    async with _cbu_client() as client:
        await tick(factory, registry, settings=settings, cfg=CFG, http=client, now=NOW)
        await tick(factory, registry, settings=settings, cfg=CFG, http=client, now=NOW + timedelta(minutes=1))
    beats = {b.name: b.last_tick_at for b in (await db.execute(select(WorkerHeartbeat))).scalars().all()}
    assert beats["worker"] == NOW + timedelta(minutes=1) and beats["daily"] == NOW  # daily ran on the first tick only
    await heartbeat(db, "worker", NOW + timedelta(minutes=2))
```

- [ ] **Step 3: Run them to verify they fail**

Run: `cd backend && .venv/bin/pytest tests/test_worker.py -q`
Expected: FAIL with `ModuleNotFoundError: app.worker.loop`

- [ ] **Step 4: Implement the loop**

`backend/app/worker/loop.py`:
```python
"""The worker: run due sources sequentially, keep a heartbeat, run the daily maintenance jobs."""

import asyncio
import signal
import uuid
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx
import structlog
from sqlalchemy import or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import make_engine, make_session_factory
from app.core.logging import configure_logging
from app.core.settings import Settings, get_settings
from app.ingestion.pipeline import run_source
from app.ingestion.registry import AdapterRegistry, build_registry
from app.modules.contacts.scoring import rescore_all
from app.modules.dedupe.config import DedupeConfig, load_config
from app.modules.listings.fx import refresh_rate
from app.modules.listings.models import CrawlRun, Source
from app.modules.listings.service import age_out
from app.modules.properties.service import recompute_many
from app.worker.models import WorkerHeartbeat

log = structlog.get_logger()


async def due_sources(session: AsyncSession, now: datetime) -> list[Source]:
    stmt = (
        select(Source)
        .where(
            Source.enabled.is_(True),
            or_(Source.next_run_at.is_(None), Source.next_run_at <= now),
            or_(Source.paused_until.is_(None), Source.paused_until <= now),
        )
        .order_by(Source.next_run_at.asc().nulls_first(), Source.created_at)
    )
    return list((await session.execute(stmt)).scalars().all())


async def run_due_sources(
    session_factory: Callable[[], AsyncSession],
    registry: AdapterRegistry,
    *,
    cfg: DedupeConfig,
    photo_dir: Path,
    now: datetime,
) -> list[uuid.UUID]:
    async with session_factory() as session:
        due = [s.id for s in await due_sources(session, now)]
    run_ids: list[uuid.UUID] = []
    for source_id in due:
        async with session_factory() as session:
            source = await session.get(Source, source_id)
            if source is None:
                continue
            run_id: uuid.UUID | None = None
            try:
                adapter = registry.for_source(source)
                run = await run_source(session, adapter, source, cfg=cfg, photo_dir=photo_dir, now=now)
                run_id = run.id
                log.info("source_run", source=source.name, found=run.found, new=run.new, changed=run.changed, failed=run.failed, removed=run.removed, error=run.error)
            except Exception as exc:  # noqa: BLE001 — the bookkeeping is already on the session; commit it
                log.warning("source_run_failed", source=source.name, error=str(exc))
            finally:
                await session.commit()  # the pipeline's contract: commit after return AND after raise
            if run_id is None:  # a failed run's row was written by run_source before it raised
                stmt = select(CrawlRun.id).where(CrawlRun.source_id == source_id, CrawlRun.started_at == now)
                run_id = (await session.execute(stmt)).scalar_one_or_none()
            if run_id is not None:
                run_ids.append(run_id)
    return run_ids


def daily_due(last: datetime | None, now: datetime, tz: str, hour: int) -> bool:
    zone = ZoneInfo(tz)
    local_now = now.astimezone(zone)
    if local_now.hour < hour:
        return False
    return last is None or last.astimezone(zone).date() < local_now.date()


async def daily_jobs(session: AsyncSession, *, now: datetime, http: httpx.AsyncClient) -> dict[str, int]:
    affected = await age_out(session, now)
    aged = await recompute_many(session, affected)
    rescored = await rescore_all(session, now)
    fx = 0
    try:
        await refresh_rate(session, http)
        fx = 1
    except Exception as exc:  # noqa: BLE001 — keep the last rate (spec §10)
        log.warning("fx_refresh_failed", error=str(exc))
    return {"aged_out_properties": aged, "rescored_contacts": rescored, "fx": fx}


async def heartbeat(session: AsyncSession, name: str, now: datetime) -> None:
    stmt = insert(WorkerHeartbeat).values(name=name, last_tick_at=now)
    await session.execute(stmt.on_conflict_do_update(index_elements=[WorkerHeartbeat.name], set_={"last_tick_at": now}))


async def tick(
    session_factory: Callable[[], AsyncSession],
    registry: AdapterRegistry,
    *,
    settings: Settings,
    cfg: DedupeConfig,
    http: httpx.AsyncClient,
    now: datetime,
) -> None:
    async with session_factory() as session:
        await heartbeat(session, "worker", now)
        await session.commit()
    await run_due_sources(session_factory, registry, cfg=cfg, photo_dir=settings.photo_dir, now=now)
    async with session_factory() as session:
        last = await session.get(WorkerHeartbeat, "daily")
        if daily_due(last.last_tick_at if last else None, now, settings.tz, settings.daily_job_hour):
            result = await daily_jobs(session, now=now, http=http)
            await heartbeat(session, "daily", now)
            await session.commit()
            log.info("daily_jobs", **result)


async def main() -> None:
    settings = get_settings()
    configure_logging(settings.log_level)
    engine = make_engine(settings.database_url)
    factory = make_session_factory(engine)
    registry = build_registry(settings)
    cfg = load_config(settings.dedupe_config_path)
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stop.set)
    log.info("worker_start", tick_seconds=settings.worker_tick_seconds, adapters=registry.kinds)
    async with httpx.AsyncClient(timeout=30) as http:
        while not stop.is_set():
            try:
                await tick(factory, registry, settings=settings, cfg=cfg, http=http, now=datetime.now(UTC))
            except Exception as exc:  # noqa: BLE001 — a tick must never kill the worker
                log.error("tick_failed", error=str(exc))
            try:
                await asyncio.wait_for(stop.wait(), timeout=settings.worker_tick_seconds)
            except TimeoutError:
                continue
    await engine.dispose()
    log.info("worker_stop")
```
`backend/app/worker/__main__.py`:
```python
import asyncio

from app.worker.loop import main

asyncio.run(main())
```
`Makefile`: add `worker:` → `cd backend && .venv/bin/python -m app.worker` and to `.PHONY`.

- [ ] **Step 5: Run the tests, suite and gates; commit**

Run: `cd backend && .venv/bin/pytest tests/test_worker.py -q && .venv/bin/pytest -q && .venv/bin/ruff check . && .venv/bin/ruff format --check . && .venv/bin/mypy app`
```bash
git add backend Makefile
git commit -m "feat(worker): scheduling loop with commit-always runs, heartbeat and daily maintenance jobs"
```

---

### Task 8: CLI

**Files:**
- Create: `backend/app/cli.py`
- Modify: `backend/app/ingestion/adapters/telegram/client.py` (+ `login_interactive`), `Makefile` (+ `cli` target), `backend/.env.example` (usage comment), `docs/README.md` (how to run)
- Test: `backend/tests/test_cli.py`

**Interfaces:**
- Consumes: `User` (identity), `Source`, `build_registry`, `run_source`, `process_raw`/`store_raw` (pipeline), `ingest_url`, `TelethonClient`.
- Produces: `python -m app.cli` (typer) with commands:
  - `create-user --phone +998… --name … --password … [--role admin|agent]` (argon2 hash via `argon2-cffi`)
  - `add-source telegram <peer> [--name] [--interval 900]`; `add-source olx <category-url> [--name] [--interval 900]` (name defaults to the peer / `olx`)
  - `list-sources` (table: name, kind, enabled, status, last run, next run, failures)
  - `run-source <name>` — one-off run now (builds the real registry; commits; prints the run counters)
  - `reparse --source <name> [--limit N]` — for each `raw_listings` row of the source: `adapter.rebuild_payload(raw)` → `process_raw(..., adapter=None, created=False, changed=True)` in its own savepoint; prints counts; no network
  - `telegram-login` — interactive Telethon login (phone, code, 2FA) creating the session file
  - `add-listing --url <url>` — `ingest_url`
  - `TelethonClient.login_interactive() -> None` (calls `await self._client.start()`)

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_cli.py` (runs the CLI against the test database by pointing `DATABASE_URL` at it; rows are removed at the end of each test because the CLI commits):
```python
import os
from collections.abc import AsyncIterator

import pytest
from sqlalchemy import delete, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from typer.testing import CliRunner

from app.core.settings import get_settings
from app.modules.identity.models import User
from app.modules.listings.models import Source

runner = CliRunner()


@pytest.fixture
async def cli_env(engine) -> AsyncIterator[None]:  # type: ignore[no-untyped-def]
    url = get_settings().test_database_url
    os.environ["DATABASE_URL"] = url
    get_settings.cache_clear()
    yield
    async with AsyncSession(engine) as session:
        await session.execute(delete(User).where(User.phone_e164.in_(["+998900000101"])))
        await session.execute(delete(Source).where(Source.name.in_(["@cli_test", "olx-cli"])))
        await session.commit()
    os.environ.pop("DATABASE_URL", None)
    get_settings.cache_clear()


def test_create_user_and_list(cli_env: None) -> None:
    from app.cli import app

    result = runner.invoke(app, ["create-user", "--phone", "+998900000101", "--name", "Aziz", "--password", "s3cret", "--role", "agent"])
    assert result.exit_code == 0, result.output
    assert "Aziz" in result.output and "agent" in result.output
    again = runner.invoke(app, ["create-user", "--phone", "+998900000101", "--name", "Aziz", "--password", "x"])
    assert again.exit_code != 0 and "exists" in again.output


def test_add_and_list_sources(cli_env: None) -> None:
    from app.cli import app

    assert runner.invoke(app, ["add-source", "telegram", "@cli_test"]).exit_code == 0
    assert runner.invoke(app, ["add-source", "olx", "https://www.olx.uz/nedvizhimost/kvartiry/arenda-dolgosrochnaya/tashkent/", "--name", "olx-cli", "--interval", "600"]).exit_code == 0
    listed = runner.invoke(app, ["list-sources"])
    assert listed.exit_code == 0 and "@cli_test" in listed.output and "olx-cli" in listed.output and "600" in listed.output
    dup = runner.invoke(app, ["add-source", "telegram", "@cli_test"])
    assert dup.exit_code != 0 and "exists" in dup.output


def test_reparse_reports_counts_for_unknown_source(cli_env: None) -> None:
    from app.cli import app

    result = runner.invoke(app, ["reparse", "--source", "does-not-exist"])
    assert result.exit_code != 0 and "no source" in result.output
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd backend && .venv/bin/pytest tests/test_cli.py -q`
Expected: FAIL with `ModuleNotFoundError: app.cli`

- [ ] **Step 3: Implement the CLI**

`backend/app/cli.py`:
```python
"""Operator commands: python -m app.cli <command>."""

import asyncio
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any

import typer
from argon2 import PasswordHasher
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import make_engine, make_session_factory
from app.core.logging import configure_logging
from app.core.settings import get_settings
from app.ingestion.adapters.telegram.client import make_client
from app.ingestion.manual import ingest_url
from app.ingestion.pipeline import process_raw, run_source
from app.ingestion.registry import build_registry
from app.modules.dedupe.config import load_config
from app.modules.identity.models import User
from app.modules.listings.models import RawListing, Source

app = typer.Typer(help="Realtor CRM operator commands", no_args_is_help=True)


def _run(fn: Callable[[AsyncSession], Awaitable[Any]]) -> Any:
    settings = get_settings()
    configure_logging(settings.log_level)

    async def go() -> Any:
        engine = make_engine(settings.database_url)
        factory = make_session_factory(engine)
        try:
            async with factory() as session:
                result = await fn(session)
                await session.commit()
                return result
        finally:
            await engine.dispose()

    return asyncio.run(go())


@app.command("create-user")
def create_user(phone: str = typer.Option(...), name: str = typer.Option(...), password: str = typer.Option(..., prompt=True, hide_input=True), role: str = typer.Option("agent")) -> None:
    if role not in ("admin", "agent"):
        raise typer.BadParameter("role must be admin or agent")

    async def go(session: AsyncSession) -> None:
        if (await session.execute(select(User).where(User.phone_e164 == phone))).scalar_one_or_none():
            typer.echo(f"user {phone} already exists", err=True)
            raise typer.Exit(code=1)
        session.add(User(phone_e164=phone, name=name, password_hash=PasswordHasher().hash(password), role=role))
        typer.echo(f"created {name} ({role}) {phone}")

    _run(go)


@app.command("add-source")
def add_source(kind: str = typer.Argument(..., help="telegram | olx"), target: str = typer.Argument(..., help="@peer or category url"), name: str | None = typer.Option(None), interval: int = typer.Option(900)) -> None:
    if kind not in ("telegram", "olx"):
        raise typer.BadParameter("kind must be telegram or olx")
    config = {"peer": target} if kind == "telegram" else {"url": target}
    source_name = name or (target if kind == "telegram" else "olx")

    async def go(session: AsyncSession) -> None:
        if (await session.execute(select(Source).where(Source.name == source_name))).scalar_one_or_none():
            typer.echo(f"source {source_name} already exists", err=True)
            raise typer.Exit(code=1)
        session.add(Source(kind=kind, name=source_name, config=config, interval_seconds=interval, enabled=True))
        typer.echo(f"added {kind} source {source_name} (every {interval}s)")

    _run(go)


@app.command("list-sources")
def list_sources() -> None:
    async def go(session: AsyncSession) -> None:
        rows = (await session.execute(select(Source).order_by(Source.created_at))).scalars().all()
        typer.echo(f"{'name':24} {'kind':9} {'on':3} {'status':15} {'interval':8} {'last run':20} {'next run':20} fails")
        for s in rows:
            typer.echo(f"{s.name:24} {s.kind:9} {'yes' if s.enabled else 'no':3} {s.status:15} {s.interval_seconds:<8} {str(s.last_run_at)[:19]:20} {str(s.next_run_at)[:19]:20} {s.consecutive_failures}")

    _run(go)


@app.command("run-source")
def run_source_cmd(name: str) -> None:
    async def go(session: AsyncSession) -> None:
        source = (await session.execute(select(Source).where(Source.name == name))).scalar_one_or_none()
        if source is None:
            typer.echo(f"no source named {name}", err=True)
            raise typer.Exit(code=1)
        settings = get_settings()
        registry = build_registry(settings)
        try:
            run = await run_source(session, registry.for_source(source), source, cfg=load_config(settings.dedupe_config_path), photo_dir=settings.photo_dir, now=datetime.now(UTC))
        finally:
            await session.commit()  # bookkeeping survives even when run_source raised
        typer.echo(f"found={run.found} new={run.new} changed={run.changed} failed={run.failed} removed={run.removed} error={run.error}")

    _run(go)


@app.command("reparse")
def reparse(source: str = typer.Option(..., "--source"), limit: int | None = typer.Option(None)) -> None:
    async def go(session: AsyncSession) -> None:
        src = (await session.execute(select(Source).where(Source.name == source))).scalar_one_or_none()
        if src is None:
            typer.echo(f"no source named {source}", err=True)
            raise typer.Exit(code=1)
        settings = get_settings()
        registry = build_registry(settings)
        adapter = registry.for_source(src)
        cfg = load_config(settings.dedupe_config_path)
        stmt = select(RawListing).where(RawListing.source_id == src.id).order_by(RawListing.fetched_at)
        raws = (await session.execute(stmt.limit(limit) if limit else stmt)).scalars().all()
        done = failed = 0
        for raw in raws:
            try:
                async with session.begin_nested():
                    payload = await adapter.rebuild_payload(raw)
                    await process_raw(session, src, raw, payload, created=False, changed=True, adapter=None, cfg=cfg, photo_dir=settings.photo_dir, now=datetime.now(UTC), max_photos=10)
                    done += 1
            except Exception as exc:  # noqa: BLE001
                failed += 1
                raw.parse_error = f"{type(exc).__name__}: {exc}"[:1000]
        typer.echo(f"reparsed {done} listings, {failed} failed")

    _run(go)


@app.command("telegram-login")
def telegram_login() -> None:
    settings = get_settings()
    if not settings.telegram_api_id or not settings.telegram_api_hash:
        typer.echo("set TELEGRAM_API_ID and TELEGRAM_API_HASH (my.telegram.org) in backend/.env first", err=True)
        raise typer.Exit(code=1)

    async def go() -> None:
        client = make_client(settings)
        await client.login_interactive()
        typer.echo(f"session saved to {settings.telegram_session_path}")

    asyncio.run(go())


@app.command("add-listing")
def add_listing(url: str = typer.Option(..., "--url")) -> None:
    async def go(session: AsyncSession) -> None:
        settings = get_settings()
        result = await ingest_url(session, url, build_registry(settings), cfg=load_config(settings.dedupe_config_path), photo_dir=settings.photo_dir, now=datetime.now(UTC))
        typer.echo(f"property {result.property.id} ({result.decision}); listing {result.listing.id}")

    _run(go)


if __name__ == "__main__":
    app()
```
Check `process_raw`'s real signature in `pipeline.py` (Task 2 of this plan restructured it as `process_raw(session, source, raw, payload, *, created, changed, adapter, cfg, photo_dir, now, max_photos)`) and match it exactly. Add to `TelethonClient`:
```python
    async def login_interactive(self) -> None:
        await self._client.start()  # prompts for phone, code and 2FA password on the terminal
```
`Makefile`: `cli:` → `cd backend && .venv/bin/python -m app.cli $(args)`. `docs/README.md`: add a "Running" section: `make up && make migrate`, `python -m app.cli create-user …`, `add-source telegram @channel`, `telegram-login`, `python -m app.worker`.

- [ ] **Step 4: Run the tests, suite and gates; commit**

Run: `cd backend && .venv/bin/pytest tests/test_cli.py -q && .venv/bin/pytest -q && .venv/bin/ruff check . && .venv/bin/ruff format --check . && .venv/bin/mypy app`
```bash
git add backend Makefile docs/README.md
git commit -m "feat(cli): users, sources, one-off runs, reparse, telegram login, add-listing"
```

---

## Plan self-review

- **Spec coverage.** §3.1 adapter interface — Task 2 (exceptions, `rebuild_payload`) on top of M0-1's protocol; §3.2 Telegram (session, backfill, edit rescan, albums, window, FloodWait, login_required) — Task 5; §3.3 OLX (list discovery, detail fetch, best-effort phones, photos, immediate removal on 404/inactive, rate limit + back-off, circuit breaker) — Tasks 3–4 (Scrapling deferred: documented deviation); §3.4 manual (link + form) — Task 6; §3.5 scheduling (`interval_seconds`, `next_run_at`, `paused_until`), removal windows — Tasks 4, 5, 7; §10 error handling (`FloodWait` obeyed, `login_required` status, back-off, photo retries, FX failure keeps the last rate) — Tasks 2, 3, 7; §11 operations (`make worker`, heartbeat, logging) — Tasks 7–8; CLI commands from §8 ("Users are created with `python -m app.cli create-user`") and §13 — Task 8. The M0-1 follow-ups: indexes, bounded candidates, single-query similarity, EXIF — Task 1; `age_out` recompute, property-wide rescoring, orphan photos, adapter exceptions — Task 2; worker commits after raise — Task 7. Not in this plan: the API (M0-3) and the web app + deployment (M0-4); the "validate pHash threshold on real images" follow-up is a manual check to do with the first real crawl (acceptance criterion 1 of the spec) — record the result in the M0-3 plan.
- **Placeholders.** None: every code step is complete; the two "check the real signature" notes point at code that exists on `main` (`process_raw`) rather than at something undefined.
- **Type consistency.** `AdapterBackoff(retry_after: timedelta, reason: str)` is constructed identically in Tasks 2, 3, 4, 5; `SeenWindow(ids, oldest_posted_at)` everywhere; `RawPayload` field order matches `adapters/base.py`; `rebuild_payload(raw: RawListing)` on the protocol (Task 2), OLX (4), Telegram (5), Manual (6), FakeAdapter (2); `registry.get(kind)` / `for_source(source)` used by Tasks 6, 7, 8; `run_due_sources(..., now) -> list[uuid.UUID]` used by `tick`; `daily_jobs(session, *, now, http)` used by `tick` and the test.
