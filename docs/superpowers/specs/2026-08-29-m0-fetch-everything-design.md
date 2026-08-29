# M0 — Fetch everything: design spec

| | |
|---|---|
| **Status** | Approved design, 2026-08-29 (brainstormed and approved section by section) |
| **Milestone** | M0 of `docs/02-architecture.md` §16 — the first half of the core loop in `docs/01-requirements.md` §4 |
| **Goal** | Every rental listing from the configured sources lands in one deduplicated list of houses that the team can open, filter and mark active/inactive |
| **Out of scope** | Outreach bot, re-check scheduling, call log, locks, notifications, duplicates-review screen, LLM parsing, Redis/queues (all M1–M3) |

---

## 1. Decisions taken in the brainstorm

| Decision | Choice | Why |
|---|---|---|
| Backend stack | Python 3.12, FastAPI, PostgreSQL 16, SQLAlchemy 2 (async) + Alembic | The scraping and matching libraries (Telethon, Scrapling, imagehash, phonenumbers) are Python |
| Sources in M0 | Telegram first, then OLX; both ship in M0 | Telegram is read through the official API and is stable; OLX needs anti-bot handling and breaks more often |
| Telegram identity | A separate SIM / Telegram account owned by the team | Isolates the crawler from personal accounts; the same account does M1 outreach later |
| M0 UI | Real React app, minimal pages | Nothing thrown away in M2 |
| Web conventions | React 18 + TypeScript + Vite; **Feature-Sliced Design**; **Effector** for all state; **shadcn/ui** + Tailwind; **i18next** (uz, ru); **atomic-router**; typed client generated from OpenAPI | Set by the owner; no workarounds |
| Shape | **Lean pipeline**: `api` + `worker` processes sharing one package; PostgreSQL is the only state; no queue | Fewest moving parts; Redis/arq slot in at M1 without touching module boundaries |

---

## 2. Architecture

```
[Telegram dialogs]  [OLX category pages]  [pasted link / form]
         \                 |                     /
          v                v                    v
   worker process ── schedule loop: discover → fetch → store raw → parse → dedupe → property
          |
     PostgreSQL 16 (+ pg_trgm)  ── photos on a disk volume (/data/photos)
          ^
   api process (FastAPI) ── web (React, static files behind Caddy)
```

Two processes built from one Python package `backend/app`:

- **`worker`** — an asyncio loop. Every tick (60 s) it selects enabled sources whose `next_run_at` is due and runs them **sequentially** (concurrency 1 keeps rate limits trivial). Each run: discover → fetch → persist raw → parse → dedupe. Once a day at 03:00 local: the removal sweep, contact re-scoring, and the FX-rate fetch. The worker writes a heartbeat row every tick.
- **`api`** — FastAPI. Auth, properties, listings, sources, health. Reads and writes PostgreSQL only; never crawls (a pasted link is the one exception: it calls the adapter synchronously, with a 20 s timeout).
- **PostgreSQL** — the only state. Extensions `pg_trgm`, `unaccent`. Migrations via Alembic.
- **Photos** — downloaded at ingest to `/data/photos/<listing_id>/<n>.jpg`, resized to max side 1280 px, perceptual hash stored. Source URLs expire, so rehosting is not optional.
- **Web** — see §10.
- **Deployment** — docker compose: `postgres`, `api`, `worker`, `web` (Caddy serving the built SPA and proxying `/api`). One VPS located in Uzbekistan.

Module boundaries follow `docs/02-architecture.md` §4: a module reads another module's tables only through that module's service functions. M0 has `identity`, `listings`, `contacts`, `dedupe`, `properties` plus the `ingestion` package (adapters, parse, photos). `calls`, `outreach`, `notifications` do not exist yet.

---

## 3. Ingestion

### 3.1 Adapter interface

```python
class SourceAdapter(Protocol):
    kind: str                      # "telegram" | "olx" | "manual"

    async def discover(self, source: Source, state: dict) -> AsyncIterator[RawRef]:
        """Yield refs to listings that may be new or changed. Never parses."""

    async def fetch(self, ref: RawRef) -> RawPayload:
        """Return one listing's raw content (text/html/json + media refs). Never parses."""

    async def seen_ids(self, source: Source, state: dict) -> set[str] | None:
        """External ids currently visible at the source (for removal detection); None if unknown."""
```

`sources` rows carry `kind`, `config` (JSONB, per adapter) and `state` (JSONB, adapter cursor). Adding a source of an existing kind is a row, not code.

### 3.2 Telegram adapter

- Telethon user session for the team's account (API id/hash + phone login once, via `python -m app.cli telegram-login`). Session file on a volume, never in git.
- `config`: `{"peer": "@toshkent_ijara" | -100123456789, "backfill_days": 14}`. Public channels by username; private groups by id (the account must already be a member).
- **discover**: `iter_messages(peer, min_id=state.last_message_id, reverse=True)`; first run walks back `backfill_days`. Additionally rescans the newest 200 messages for `edit_date > state.last_run_at` so edited posts are re-fetched. Album messages (same `grouped_id`) are one listing; external id = `"<chat_id>:<first_message_id>"`.
- **fetch**: text, entities, sender id/username, dates, media ids. Media bytes are downloaded in the photos stage (max 10 per listing).
- **seen_ids**: the ids of the newest 200 messages — enough for removal detection of recent posts; older posts are handled by the age rule in §3.5.
- `FloodWaitError` is obeyed exactly; `AuthKeyUnregistered` / `SessionRevoked` marks the source `login_required` and stops that source only.

### 3.3 OLX adapter

- Scrapling (`StealthyFetcher` with `Fetcher` fallback) against configured category URLs, e.g. `https://www.olx.uz/nedvizhimost/kvartiry/arenda-dolgosrochnaya/tashkent/?search[order]=created_at:desc`.
- **discover**: list pages newest-first, up to `max_pages` (default 25) or until an id already seen with unchanged list-card price is met; yields ad ids + URLs.
- **fetch**: the detail page HTML plus the embedded JSON (`__PRERENDERED_STATE__` or equivalent) verbatim. Phone numbers on OLX sit behind a reveal endpoint; fetching it is **best-effort** — when it fails, the listing has no phone and the contact identity is the OLX user id (§5.3). Photos come from the page's image URLs.
- **seen_ids**: ids from the list pages walked this run. A detail page returning 404 or the "объявление снято" marker removes the listing immediately.
- Rate: 1 request / 2 s, jittered; 403/429 → exponential back-off (1 min → 32 min); circuit breaker after 3 failed runs (1 h pause). Scraping OLX is against its ToS — request rates stay low and manual entry remains the fallback.

### 3.4 Manual adapter

- `POST /listings/manual {url}` — hostname decides the adapter (`olx.uz` → OLX, `t.me` → Telegram); the adapter fetches synchronously and the listing runs through the same pipeline before the response returns.
- `POST /listings/manual {form}` — title, description, price + currency, rooms, floor/total, area, district, phone, photos (upload). Stored as a raw listing of kind `manual` so it is indistinguishable downstream.

### 3.5 Scheduling and removal detection

- `sources.interval_seconds` (default 900), `next_run_at`, `consecutive_failures`, `paused_until`.
- A listing whose external id was absent from `seen_ids` on **3 consecutive runs** of its source gets `source_removed = true`, `removed_at = now()`. `miss_count` resets to 0 whenever it is seen. Listings older than the source's visible window (Telegram: outside the newest 200; OLX: beyond `max_pages`) are not counted as missed — they age out only via the daily sweep rule: `last_seen_at < now() − 30 days` → `source_removed`.
- A property whose listings are all `source_removed` gets `properties.source_removed = true` (status untouched); the list shows *"manbadan o'chirilgan"*. M1 uses it as a re-check trigger.
- **Resurrection** (decided 2026-08-30 after the M0-1 review): a listing that is seen again — with the same or changed content — clears `source_removed`/`removed_at` and resets `miss_count`; its property is recomputed, so the flag disappears as soon as the ad is back. OLX ads are routinely deactivated and renewed.

---

## 4. Parsing (rules only)

Parsing reads `raw_listings.payload` and produces one `listings` row. It is idempotent: re-running over a raw row updates the same listing (keyed on `raw_listing_id`).

| Field | Rule |
|---|---|
| `price_amount_minor`, `price_currency` | First price-like number with a currency marker: `$`, `у.е.`, `USD`, `долл` → USD; `сум`, `so'm`, `сўм`, `UZS`, `ming`/`тыс` (× 1 000), `mln`/`млн` (× 1 000 000) → UZS. No marker → `price_currency = NULL` (never inferred from magnitude). OLX structured price wins over text |
| `price_usd_minor` | USD as-is; UZS ÷ the `fx_rates` rate for the listing's `posted_at` date (latest known if missing) |
| `rooms` | `(\d)[- ]?(xonali|xona|комн|к\.)`; the shorthand `2/5/9` (rooms/floor/total floors) as a third pattern; OLX structured field wins |
| `floor`, `total_floors` | `(\d{1,2})\s*/\s*(\d{1,2})`, `(\d+)[- ]?qavat`, `(\d+)\s*этаж(?:\s*из\s*(\d+))?` |
| `area_sqm` | `(\d{2,3})\s*(m²|м²|kv|кв|kv\.m|м2|м\.кв)` |
| `district` | Dictionary of the 12 Tashkent districts with Latin, Cyrillic and Russian spellings and common abbreviations (`Chilonzor / Чилонзор / Чиланзар / Ч-зор`, `Mirzo Ulug'bek / M.Ulug'bek / ТТЗ` …). First match wins; none → NULL |
| `phones[]` | Every match of `(\+?998)?[\s(-]*(\d{2})[\s)-]*(\d{3})[\s-]*(\d{2})[\s-]*(\d{2})` and `phonenumbers` validation → E.164 `+998XXXXXXXXX`; duplicates removed |
| `telegram_username` | `@[A-Za-z0-9_]{5,32}` in text, else the sender's username |
| `owner_marker` / `agent_marker` | Owner: `egasidan, egasi, vositachisiz, xo'jayin, хозяин, собственник, без посредников, от хозяина`. Agent: `rieltor, riyeltor, риелтор, риэлтор, агент, агентство, услуга \d+%, xizmat \d+%, komissiya, комиссия` |
| `parse_confidence` | 0–1: +0.3 price with currency, +0.2 rooms, +0.15 district, +0.15 phone or username, +0.1 floor, +0.1 area. Below 0.4 the listing is tagged *tekshirilmagan*; it is never dropped |

Text is normalised first: NFC, `ʻ ʼ ’ ‘` → `'`, Cyrillic-Uzbek transliterated to Latin for dictionary matching (the original text is kept).

---

## 5. Dedupe and contacts

### 5.1 Blocking

Candidates for a new or changed listing are the union of listings that share: (a) any contact identity (phone, username or OLX user id); (b) a photo pHash **top-16-bit bucket**; (c) the key `(district, rooms, floor, total_floors)` when all four are present. Never the whole table.

### 5.2 Scoring and thresholds

| Signal | Weight |
|---|---|
| Shared contact identity | +0.50 |
| Any photo pair with pHash Hamming distance ≤ 10 | +0.30 |
| Description `pg_trgm` similarity ≥ 0.6 (after stripping phones, prices, emoji) | +0.15 |
| Rooms, floor and total floors all equal | +0.10 |
| Area within 5 % | +0.05 |
| USD price within 10 % | +0.05 |

Assignment happens **once per listing, at creation** (M0). A changed listing is re-parsed in place but not re-scored: moving a listing between properties would have to cope with the emptied property and its append-only history, which needs its own design — tracked as a follow-up for the review-queue work in M2; the phone/photo signals of the *original* ingest still decide. The best-scoring candidate property decides: **≥ 0.75** attach to it; **0.50–0.75** create a new property *and* a `dedupe_reviews` row with the score breakdown (kept separate until a human decides — the review screen is M2; the property page shows *"ehtimoliy dublikat"* with the candidate); **< 0.50** new property. Weights and thresholds live in `backend/config/dedupe.yaml`.

On attach the property recomputes: lowest `price_usd_minor`, union of photos, earliest `first_seen_at`, latest `last_seen_at`, all contacts, and attributes from the highest-confidence listing (ties → newest).

### 5.3 Contacts

`contacts` has `kind` (`phone` | `telegram` | `olx_user`) and `identifier` (E.164 / username / OLX user id), unique together. One listing links to one or more contacts. Nightly and on insert: `distinct_property_count_90d`. Agency score: count 1 → 0.0, 3 → +0.3, ≥ 6 → +0.6; agent markers +0.3; owner markers −0.3; earliest listing in the property −0.1; lowest price in the property −0.1; clamped to [0, 1]. `classification` = `agent` ≥ 0.6, `owner` ≤ 0.3, else `unknown`. The property's `probable_owner_contact_id` is its lowest-scoring contact, `owner_confidence = 1 − score`. A `human_decision` column (M2) will override and is never recomputed away.

---

## 6. Data model (M0)

All ids `uuid`, all timestamps `timestamptz`, money `bigint` minor units.

| Table | Columns (beyond id / created_at / updated_at) |
|---|---|
| `users` | `phone_e164` UK, `name`, `password_hash` (argon2), `role` (`admin`/`agent`), `locale`, `active` |
| `sources` | `kind`, `name`, `config` JSONB, `state` JSONB, `enabled`, `interval_seconds`, `next_run_at`, `last_run_at`, `consecutive_failures`, `paused_until`, `status` (`ok`/`failing`/`login_required`/`paused`) |
| `crawl_runs` | `source_id` FK, `started_at`, `finished_at`, `found`, `new`, `changed`, `failed`, `error` |
| `raw_listings` | `source_id` FK, `external_id`, `url`, `payload` JSONB, `content_hash`, `fetched_at`, `parse_error`; UK `(source_id, external_id)` |
| `listings` | `raw_listing_id` FK UK, `property_id` FK, `title`, `description`, `price_amount_minor`, `price_currency`, `price_usd_minor`, `rooms`, `area_sqm`, `floor`, `total_floors`, `district`, `address_text`, `posted_at`, `first_seen_at`, `last_seen_at`, `miss_count`, `source_removed`, `removed_at`, `owner_marker`, `agent_marker`, `parse_confidence` |
| `listing_contacts` | `listing_id` FK, `contact_id` FK; PK both. (Architecture §6 gave a listing one contact; M0 allows several because a Telegram post often carries two numbers) |
| `listing_photos` | `listing_id` FK, `position`, `storage_key`, `sha256`, `phash` bigint, `width`, `height`, `download_error` |
| `contacts` | `kind`, `identifier`, UK `(kind, identifier)`, `display_name`, `agency_score`, `classification`, `distinct_property_count_90d`, `human_decision` (nullable, unused in M0) |
| `properties` | `status` (`new`/`active`/`inactive`), `district`, `rooms`, `floor`, `total_floors`, `area_sqm`, `price_usd_min_minor`, `probable_owner_contact_id` FK, `owner_confidence`, `source_removed`, `needs_recheck`, `first_seen_at`, `last_seen_at`, `search_vector` tsvector (title + description + address of all listings) |
| `property_status_events` | `property_id` FK, `from_status`, `to_status`, `actor_type` (`crawler`/`agent`/`admin`), `actor_id`, `note`, `created_at`; append-only (trigger forbids UPDATE/DELETE) |
| `dedupe_reviews` | `listing_id` FK, `candidate_property_id` FK, `score`, `breakdown` JSONB, `decision` (nullable), `decided_by`, `decided_at` |
| `fx_rates` | `date` PK, `usd_uzs` numeric, `fetched_at` |
| `worker_heartbeat` | `name` PK, `last_tick_at` |

Indexes: `listings(property_id)`, `listing_photos(phash)` plus a functional index on the top-16-bit bucket, `listings(district, rooms, floor, total_floors)`, GIN on `properties.search_vector`, trigram GIN on `listings.description`.

---

## 7. Status model

`properties.status`: `new` → set by the crawler on creation; `active` / `inactive` → set by an agent from the property page (M0) or by the bot (M1). Every change inserts a `property_status_events` row; the current status is denormalised on the property for filtering. Two derived flags: `source_removed` (§3.5) and `needs_recheck` (always false in M0; M1 sets it). Mapping to `docs/01-requirements.md` FR-3: `available` = `active`, `rented` = `inactive`; the other FR-3 states arrive with the call log in M2.

---

## 8. API (`/api/v1`, JSON, bearer JWT)

| Endpoint | Purpose |
|---|---|
| `POST /auth/login {phone, password}` → `{access, refresh}`; `POST /auth/refresh`; `GET /me` | Access 15 min, refresh 30 days. Users are created with `python -m app.cli create-user` |
| `GET /properties?district&rooms&price_min&price_max&status&source&owner_only&removed&q&sort&page&page_size` | Paged list; each row carries listing count, source kinds, probable owner phone (the whole team sees phones), last status event |
| `GET /properties/{id}` | Property + listings (with photos, contacts, source, url) + status events + possible-duplicate candidates |
| `POST /properties/{id}/status {status: active\|inactive, note?}` | Writes the event with `actor_type = agent/admin` |
| `POST /listings/manual {url}` / `{form…}` | §3.4; returns the resulting property id |
| `GET /sources`, `POST /sources {kind: telegram, peer}`, `PATCH /sources/{id} {enabled}` | Admin only; `POST` validates the peer by resolving it through Telethon before saving |
| `GET /sources/{id}/runs` | Last 20 crawl runs |
| `GET /healthz` | DB reachable + worker heartbeat age < 5 min |

OpenAPI is the contract: the web client is generated from it (`openapi-typescript`) in CI, and a stale client fails the build.

---

## 9. Web app

**Stack:** React 18, TypeScript (strict), Vite, Tailwind, shadcn/ui (components generated by the shadcn CLI into `src/shared/ui`), Effector + effector-react + patronum, atomic-router + atomic-router-react, i18next + react-i18next (+ browser language detector, persisted choice), `openapi-typescript` + `openapi-fetch` for the typed client, lucide-react icons, Vitest.

**Feature-Sliced Design layers** (`steiger` enforces imports; no cross-imports within a layer):

```
src/app/            providers (router, i18n, effector scope), routes, global styles
src/pages/          login, properties, property, admin-sources
src/widgets/        property-table, property-card-list (mobile), property-header, listings-list, contacts-list, status-timeline, sources-table
src/features/       auth/login, property/filters, property/set-status, listing/add-manual, source/toggle, source/add-telegram, i18n/switch-language
src/entities/       session, property, listing, contact, source   (each: model.ts (Effector), api.ts, ui/)
src/shared/         api (generated client + base fetch with auth), ui (shadcn), i18n (uz.json, ru.json), lib (format money/date/phone), config
```

**State:** every piece of shared state is an Effector store in an entity or feature model — session, filters (synced to the URL query via atomic-router), property list, current property, sources. Effects wrap API calls; `pending` drives loading states; errors go to a shared toast (shadcn `sonner`). No React context or `useState` for anything shared.

**i18n:** every visible string is `t('…')` from `uz.json` / `ru.json`; a CI check fails on untranslated keys (`i18next-parser` extraction compared to both files). District names, statuses and source kinds are translated through the same files.

**Pages (M0):**
- `/login` — phone + password.
- `/properties` — filter bar (district multi-select, rooms chips, price range, status, source, owner-only, show-removed), results count, table on desktop / cards on mobile, pagination; mirrors the *Uylar* mockup minus M2 columns (agent, last contact).
- `/properties/:id` — photos, price and attributes, status pill with **Faol / Nofaol** buttons (writes the event), probable owner and other contacts with labels, listings with source and link, *ehtimoliy dublikat* note, status timeline.
- `/admin/sources` — sources table with enable toggle, last run, status colour, last error; *"Kanal qo'shish"* dialog (peer). Admin role only.

---

## 10. Error handling

- One `crawl_runs` row per run; a source's failure never affects another; 3 consecutive failures → `paused_until = now() + 1h`, `status = failing`, red row on `/admin/sources`.
- Each listing persists inside its own savepoint; a bad post is recorded (`raw_listings.parse_error`) and the batch continues.
- Raw before parse, always. Parse failure keeps the raw row and shows the listing as *tekshirilmagan* (`parse_confidence = 0`).
- Telegram `FloodWait` → sleep exactly the requested seconds (cap 1 h, else pause the source); revoked session → `login_required`, worker keeps running other sources.
- OLX 403/429 → back-off; a changed layout surfaces as low parse confidence, never as silent empty fields; the circuit breaker stops a broken adapter from hammering the site.
- Photo download errors are recorded per photo and retried on the next run; they never block the listing or dedupe (dedupe simply has fewer hashes).
- FX fetch failure → keep the last rate, log a warning; a rate older than 7 days shows a banner on `/admin/sources`.
- API errors are RFC 7807 problem responses; the web shows the translated message.

---

## 11. Operations

- `Makefile`: `venv`, `up`, `down`, `migrate`, `revision`, `test`, `lint`, `typecheck`, `worker`, `api`, `web`.
- `.env.example` documents every secret: `DATABASE_URL`, `JWT_SECRET`, `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, `TELEGRAM_SESSION_PATH`, `PHOTO_DIR`, `OLX_PROXY_URL` (optional).
- structlog JSON logs; `GET /healthz`; worker heartbeat; uptime ping from outside.
- `deploy/backup.sh`: nightly `pg_dump` + photo rsync to off-site storage, 30-day retention; a restore is rehearsed once before the team starts.
- Data stays on a server in Uzbekistan (personal-data localisation); phones are visible to logged-in team members only.

---

## 12. Testing

TDD for every unit: failing test first, then the code.

- **Parser** — fixture posts in Uzbek Latin, Uzbek Cyrillic and Russian for each rule (price/currency variants, rooms, floors, area, districts incl. abbreviations, phone formats, markers); confidence arithmetic; idempotent re-parse.
- **Dedupe** — synthetic listing pairs for each block and each score component; threshold behaviour at 0.49 / 0.50 / 0.74 / 0.75; merge recomputation; pHash bucket on generated images; contact scoring at the 1 / 3 / 6 knees.
- **Adapters** — recorded fixtures (a Telegram message dump as JSON, saved OLX list and detail HTML); discover/fetch/seen_ids against them; back-off and circuit breaker with a fake clock. No live network in tests.
- **Pipeline** — end-to-end over fixtures into a real PostgreSQL (docker, started by `make test`): raw → listing → property, removal after 3 misses, edited post updates in place.
- **API** — `httpx` tests for every endpoint incl. auth and role checks.
- **Web** — Vitest for Effector models (filters ↔ URL, status change, login), `tsc --noEmit`, `steiger`, i18n key check. No e2e in M0.

Quality gates in CI: `ruff check`, `ruff format --check`, `mypy --strict`, `pytest`, `tsc`, `steiger`, `vitest`, generated client up to date.

---

## 13. Repository

```
realtor-app/
├── docs/                          # requirements, architecture, mockups, this spec, plans
├── backend/
│   ├── app/
│   │   ├── core/                  # settings, db, auth, logging, cli
│   │   ├── modules/{identity,listings,contacts,dedupe,properties}/   # models.py schemas.py service.py tests/
│   │   ├── ingestion/{adapters/{base,telegram,olx,manual}.py, parse/, photos.py, pipeline.py}
│   │   ├── api/                   # routers per module + deps
│   │   └── worker/                # loop.py, jobs/
│   ├── alembic/  config/dedupe.yaml  tests/fixtures/  pyproject.toml  Dockerfile
├── web/                           # FSD app (§9), package.json, vite.config.ts, components.json (shadcn)
├── deploy/{docker-compose.yml, docker-compose.dev.yml, Caddyfile, backup.sh}
├── Makefile  .env.example  .gitignore
```

Tooling: `uv` for Python deps, `ruff` + `mypy --strict`, `pytest` + `pytest-asyncio`; `pnpm` for the web.

---

## 14. Acceptance criteria — M0 is done when

1. With one Telegram channel and one OLX category configured, `make up && make migrate` and a running worker produce at least one property from **each** source within 30 minutes, visible on `/properties`.
2. Re-running parse over `raw_listings` changes nothing (idempotent), and an edited source post updates its listing instead of creating a second one.
3. The same flat posted with the same phone on OLX and Telegram becomes **one** property with two listings; a pair scoring 0.50–0.75 stays separate with a visible *ehtimoliy dublikat* note.
4. A listing deleted at the source is flagged `source_removed` within 3 runs; a property with all listings removed shows *manbadan o'chirilgan*.
5. An agent can log in, filter by district/rooms/price/status/owner-only, open a property, press **Faol** or **Nofaol**, and the status event records that user.
6. An admin can add a Telegram channel on `/admin/sources`; it is crawled on the next tick and its run status is visible.
7. Switching the language changes every visible label; the i18n key check passes for `uz` and `ru`.
8. All quality gates in §12 are green; the typed web client matches the running API.
9. The backup script produced a dump that was restored successfully once.

---

## 15. Parked (not M0, not to be added silently)

Outreach bot and reply parsing, re-check scheduling and `needs_recheck` logic, call log, locks and queues, agent notifications, duplicates-review screen and human decisions, LLM extraction, voice calls, additional portals, price history, any client/tenant features.
