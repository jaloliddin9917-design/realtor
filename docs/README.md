# Realtor CRM — Documentation

| Document | What it is |
|---|---|
| [`01-requirements.md`](01-requirements.md) | Product requirements: problem, users, functional requirements FR-1 … FR-10, non-functional requirements, assumptions and open questions, glossary, the source message and its translation |
| [`02-architecture.md`](02-architecture.md) | Technical architecture: system context, modules, key flows, data model, dedupe and owner discovery, call locks, outreach bot, ingestion, web panel, API, repository layout, deployment, security, roadmap, open decisions |
| [`superpowers/specs/2026-08-29-m0-fetch-everything-design.md`](superpowers/specs/2026-08-29-m0-fetch-everything-design.md) | Approved design spec for milestone M0 "Fetch everything" — the first thing being built; implementation plans go to `superpowers/plans/` |
| [`mockups/`](mockups/) | UI mockups — 8 screens (admin desktop: dashboard, listings, duplicates, bot monitor, settings; agent mobile: queue, property, call log). Published canvas: https://claude.ai/code/artifact/e431e74b-7f22-4fd0-a450-cd5eaeb7ae9f · sources in `mockups/src/`, rebuild with `python3 docs/mockups/src/build.py`; ready-to-send PNGs of every screen in `mockups/png/` |

Status: docs are **Draft v0.1 (2026-08-29)**. Code: plans M0-1 (backend core — schema, parsing, persistence, photos, dedupe, properties, pipeline), M0-2 (Telegram and OLX adapters, manual ingestion by link or form, the worker loop, the operator CLI), M0-3 (the HTTP API — auth, properties, listings, manual ingestion, sources, OpenAPI contract) and M0-4's web panel (see "Web" below) are implemented, with a real-PostgreSQL backend test suite and a typecheck/steiger/vitest/i18n/API-client-gated web suite; the implementation plans live in `superpowers/plans/`. Remaining for M0-4 is deployment, per the "Deployment" section below. Mockups are Draft v0.1 too; UI copy is Uzbek (Latin) with fictional sample data.

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

All endpoints live under `/api/v1` and expect `Authorization: Bearer <access>`; errors are RFC 7807 problems (`application/problem+json`) with a `code` such as `auth.invalid_credentials` — the one exception is `GET /api/v1/healthz`, whose 503 body is its plain JSON status document, because an uptime monitor reads those fields. Log in with the phone and password created by `create-user`:

```
curl -s http://127.0.0.1:8000/api/v1/auth/login -H 'content-type: application/json' \
  -d '{"phone": "+998901234567", "password": "..."}'
# → {"access": "...", "refresh": "...", "token_type": "bearer"}   (access 15 min, refresh 30 days)
```

Then `POST /api/v1/auth/refresh {"refresh": "…"}` and `GET /api/v1/me` for the session itself; `GET /api/v1/meta` for the district, status, source-kind and contact-classification values the filters offer; `GET /api/v1/properties?district=…&rooms=2&status=active&page=1`, `GET /api/v1/properties/{property_id}`, `POST /api/v1/properties/{property_id}/status {"status": "active"}`, `POST /api/v1/listings/manual {"url": "…"}` and `POST /api/v1/listings/manual/form` (multipart: the same fields plus up to 10 photos); and, for admins, `GET|POST /api/v1/sources`, `PATCH /api/v1/sources/{source_id}`, `GET /api/v1/sources/{source_id}/runs`. `GET /api/v1/healthz` returns 200 only when the database answers and the worker heartbeat is under 5 minutes old. Photos are served from `/api/v1/photos/<listing id>/<n>.jpg`.

### Web

```
pnpm --dir web install --frozen-lockfile     # once (Node 22, pnpm 11)
pnpm --dir web dev                           # http://127.0.0.1:5173 — proxies /api to the API on :8000
pnpm --dir web check                         # tsc, steiger (FSD), vitest, i18n key check, API-client check, build
pnpm --dir web api:generate                  # after `make openapi`: regenerate src/shared/api/schema.d.ts
```

The web app is Feature-Sliced (`web/src/{app,pages,widgets,features,entities,shared}`), state is Effector, routing is atomic-router (filters live in the URL), strings come from `web/src/shared/i18n/{uz,ru}.json` (add keys to both files — `pnpm i18n:check` fails otherwise). Log in with a user created by `create-user`; admins also see *Manbalar* (`/admin/sources`).

## Deployment

One server (data stays in Uzbekistan, spec §11), Docker Compose:

```
git clone … /srv/realtor-app && cd /srv/realtor-app
cp .env.example .env        # fill DOMAIN, POSTGRES_PASSWORD, JWT_SECRET (≥ 32 random bytes), TELEGRAM_API_ID/HASH
make deploy-init            # first clone only: deploy/data/{photos,telegram} owned by uid 1000 (the container's user)
make deploy-up              # builds realtor-api + realtor-web, runs migrations, starts postgres/api/worker/caddy
docker compose -f deploy/docker-compose.yml --env-file .env exec api python -m app.cli create-user --phone +998… --name … --role admin
docker compose -f deploy/docker-compose.yml --env-file .env exec -it api python -m app.cli telegram-login
```

Caddy serves the web app at `https://$DOMAIN` (automatic HTTPS) and proxies `/api/*` — JSON and photos — to the API. Photos live in `deploy/data/photos`, the Telegram session in `deploy/data/telegram`, PostgreSQL in the `pgdata` volume. `/api/v1/photos/*` is served without authentication in M0 — its URLs are unguessable rather than access-controlled, so treat them as effectively public.

**Backups:** `deploy/backup.sh` (cron nightly) writes a gzipped `pg_dump` (30-day local retention) and an accumulating rsync copy of the photos into `deploy/backups/`, and copies both to `BACKUP_TARGET` when set — never deleting there, so retention on that target is its own policy. **Rehearse the restore once before the team starts** (acceptance §14.9): `make restore-check dump=deploy/backups/realtor-<stamp>.sql.gz` restores into a scratch database, prints row counts and drops it.

**First deployment checklist:** real `JWT_SECRET`; `POSTGRES_PASSWORD`; `DOMAIN` pointing at the server (ports 80/443 open); `TELEGRAM_API_ID/HASH` and `telegram-login` before enabling Telegram sources; `make deploy-init` before the first `make deploy-up` (otherwise Docker creates `deploy/data/` root-owned and photo writes fail silently); the 30 MB request-body cap is in the Caddyfile; `make deploy-logs` to watch the first crawl (`GET /api/v1/healthz` turns `ok` after the worker's first heartbeat); keep a copy of `.env` and the Telegram session (`deploy/data/telegram`) outside the server.
