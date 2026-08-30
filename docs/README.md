# Realtor CRM — Documentation

| Document | What it is |
|---|---|
| [`01-requirements.md`](01-requirements.md) | Product requirements: problem, users, functional requirements FR-1 … FR-10, non-functional requirements, assumptions and open questions, glossary, the source message and its translation |
| [`02-architecture.md`](02-architecture.md) | Technical architecture: system context, modules, key flows, data model, dedupe and owner discovery, call locks, outreach bot, ingestion, web panel, API, repository layout, deployment, security, roadmap, open decisions |
| [`superpowers/specs/2026-08-29-m0-fetch-everything-design.md`](superpowers/specs/2026-08-29-m0-fetch-everything-design.md) | Approved design spec for milestone M0 "Fetch everything" — the first thing being built; implementation plans go to `superpowers/plans/` |
| [`mockups/`](mockups/) | UI mockups — 8 screens (admin desktop: dashboard, listings, duplicates, bot monitor, settings; agent mobile: queue, property, call log). Published canvas: https://claude.ai/code/artifact/e431e74b-7f22-4fd0-a450-cd5eaeb7ae9f · sources in `mockups/src/`, rebuild with `python3 docs/mockups/src/build.py`; ready-to-send PNGs of every screen in `mockups/png/` |

Status: docs are **Draft v0.1 (2026-08-29)**. Code: plan M0-1 (backend core — schema, parsing, persistence, photos, dedupe, properties, pipeline) is implemented on branch `m0-1-backend-core` with a real-PostgreSQL test suite; the implementation plan lives in `superpowers/plans/`. Mockups are Draft v0.1 too; UI copy is Uzbek (Latin) with fictional sample data.

## Running

```
make up && make migrate                    # start Postgres, apply migrations

# one-time operator setup
python -m app.cli create-user --phone +998901234567 --name "Aziz" --password ... --role admin
python -m app.cli add-source telegram @channel
python -m app.cli add-source olx https://www.olx.uz/nedvizhimost/kvartiry/arenda-dolgosrochnaya/tashkent/
python -m app.cli telegram-login           # interactive Telethon login (phone, code, 2FA)

python -m app.worker                       # run the ingestion loop (Ctrl+C / SIGTERM to stop)
```

Every `python -m app.cli ...` command above can also be run as `make cli args="..."` (e.g. `make cli args="list-sources"`). Other useful commands: `python -m app.cli run-source <name>` (one-off run of a single source), `python -m app.cli reparse --source <name>` (re-run parsing on already-fetched raw listings, no network), `python -m app.cli add-listing --url <url>` (ingest a single OLX/Telegram link by hand). Run any command with `--help` for its full option list.
