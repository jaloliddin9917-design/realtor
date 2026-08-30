# Realtor CRM — Documentation

| Document | What it is |
|---|---|
| [`01-requirements.md`](01-requirements.md) | Product requirements: problem, users, functional requirements FR-1 … FR-10, non-functional requirements, assumptions and open questions, glossary, the source message and its translation |
| [`02-architecture.md`](02-architecture.md) | Technical architecture: system context, modules, key flows, data model, dedupe and owner discovery, call locks, outreach bot, ingestion, web panel, API, repository layout, deployment, security, roadmap, open decisions |
| [`superpowers/specs/2026-08-29-m0-fetch-everything-design.md`](superpowers/specs/2026-08-29-m0-fetch-everything-design.md) | Approved design spec for milestone M0 "Fetch everything" — the first thing being built; implementation plans go to `superpowers/plans/` |
| [`mockups/`](mockups/) | UI mockups — 8 screens (admin desktop: dashboard, listings, duplicates, bot monitor, settings; agent mobile: queue, property, call log). Published canvas: https://claude.ai/code/artifact/e431e74b-7f22-4fd0-a450-cd5eaeb7ae9f · sources in `mockups/src/`, rebuild with `python3 docs/mockups/src/build.py`; ready-to-send PNGs of every screen in `mockups/png/` |

Status: docs are **Draft v0.1 (2026-08-29)**. Code: plans M0-1 (backend core — schema, parsing, persistence, photos, dedupe, properties, pipeline), M0-2 (Telegram and OLX adapters, manual ingestion by link or form, the worker loop, the operator CLI) and M0-3 (the HTTP API — auth, properties, listings, manual ingestion, sources, OpenAPI contract) are implemented, with a real-PostgreSQL test suite; the implementation plans live in `superpowers/plans/`. Next is M0-4 (the web panel and deployment). Mockups are Draft v0.1 too; UI copy is Uzbek (Latin) with fictional sample data.

## Running

Everything below runs **from `backend/`** with the virtualenv active (`source .venv/bin/activate`), or from the repository root as `make cli args="..."` / `make worker`, which `cd` into `backend/` for you.

```
make up && make migrate                    # start Postgres, apply migrations

# one-time operator setup
python -m app.cli create-user --phone +998901234567 --name "Aziz" --role admin
python -m app.cli add-source telegram @channel
python -m app.cli add-source olx https://www.olx.uz/nedvizhimost/kvartiry/arenda-dolgosrochnaya/tashkent/
python -m app.cli telegram-login           # interactive Telethon login (phone, code, 2FA)

python -m app.worker                       # run the ingestion loop (Ctrl+C / SIGTERM to stop)
```

`create-user` and `telegram-login` prompt for the password and the login code — don't pass secrets on the command line, where they end up in the shell history.

Other useful commands: `python -m app.cli list-sources` (schedule, status and failure counts), `python -m app.cli run-source <name>` (one-off run of a single source), `python -m app.cli reparse --source <name>` (re-run parsing on already-fetched raw listings, no network — it never counts as a sighting, so it can't un-remove a delisted ad), `python -m app.cli add-listing --url <url>` (ingest a single OLX/Telegram link by hand). Run any command with `--help` for its full option list.

Configuration lives in `backend/.env` (copy `backend/.env.example`). `telegram-login` needs `TELEGRAM_API_ID`/`TELEGRAM_API_HASH` from my.telegram.org; without them the worker parks Telegram sources as `misconfigured` and keeps crawling OLX.

### API

```
python -m app.api                          # serves http://127.0.0.1:8000 (API_HOST/API_PORT); Swagger UI at /api/v1/docs
make openapi                               # regenerates backend/openapi.json (the contract the web client is generated from)
```

All endpoints live under `/api/v1` and expect `Authorization: Bearer <access>`; errors are RFC 7807 problems (`application/problem+json`) with a `code` such as `auth.invalid_credentials`. Log in with the phone and password created by `create-user`:

```
curl -s http://127.0.0.1:8000/api/v1/auth/login -H 'content-type: application/json' \
  -d '{"phone": "+998901234567", "password": "..."}'
# → {"access": "...", "refresh": "...", "token_type": "bearer"}   (access 15 min, refresh 30 days)
```

Then `GET /api/v1/properties?district=…&rooms=2&status=active&page=1`, `GET /api/v1/properties/{id}`, `POST /api/v1/properties/{id}/status {"status": "active"}`, `POST /api/v1/listings/manual {"url": "…"}`, and (admin) `GET|POST /api/v1/sources`, `PATCH /api/v1/sources/{id}`, `GET /api/v1/sources/{id}/runs`. `GET /api/v1/healthz` returns 200 only when the database answers and the worker heartbeat is under 5 minutes old. Photos are served from `/photos/<listing id>/<n>.jpg`.
