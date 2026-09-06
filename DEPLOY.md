# Deploying Realtor CRM for free (Uzbekistan-friendly, no credit card)

The app is four pieces: a React SPA, a FastAPI API, a background crawler **worker**, and
**PostgreSQL**. This guide hosts all of it on perpetual free tiers that sign up with
GitHub/Google/email — **no international credit card required**:

| Piece | Host | Free tier |
|---|---|---|
| SPA (frontend) | **Cloudflare Pages** | unlimited static hosting |
| API **+ worker** (one container) | **Render** | 1 web service, 512 MB, sleeps when idle |
| PostgreSQL | **Neon** | 0.5 GB, serverless |

> Render's free tier has no free background worker, so the crawler runs **inside** the API
> container (see `render.yaml`). A free uptime pinger keeps it awake so it keeps crawling.

---

## Step 1 — Database (Neon)

1. Sign up at **neon.tech** (GitHub login) → create a project (pick a region near you, e.g. EU).
2. Copy the connection string. It looks like:
   `postgresql://user:pass@ep-xxx.eu-central-1.aws.neon.tech/neondb?sslmode=require`
3. **Rewrite it for asyncpg** (the app + Alembic both use asyncpg):
   - `postgresql://` → `postgresql+asyncpg://`
   - `?sslmode=require` → `?ssl=require`  ← asyncpg rejects `sslmode`
   - Use the **direct** (not `-pooler`) host to avoid asyncpg/pgbouncer prepared-statement errors.

   Final `DATABASE_URL`:
   ```
   postgresql+asyncpg://user:pass@ep-xxx.eu-central-1.aws.neon.tech/neondb?ssl=require
   ```

## Step 2 — API + worker (Render)

1. Sign up at **render.com** (GitHub login).
2. **New → Blueprint** → connect the `jaloliddin9917-design/realtor` repo. Render reads
   `render.yaml` and creates the `realtor-api` web service.
3. Set the two secret env vars when prompted:
   - `DATABASE_URL` = the Neon string from Step 1.
   - `CORS_ORIGINS` = leave as your future Pages URL for now, e.g. `https://realtor.pages.dev`
     (fill the exact value after Step 4; you can edit it later).
4. Deploy. The container runs `alembic upgrade head` (creating all tables), starts the worker
   in the background, and serves the API. Note the URL, e.g. `https://realtor-api.onrender.com`.
5. Verify: open `https://realtor-api.onrender.com/api/v1/healthz` → JSON status.

## Step 3 — Create the first admin

A fresh DB has no users. After Render's first deploy (tables now exist), run the CLI **locally**
pointed at Neon (works from any machine with the backend deps installed):

```bash
cd backend
DATABASE_URL='postgresql+asyncpg://...neon...?ssl=require' \
  .venv/bin/python -m app.cli create-user --phone +998XXXXXXXXX --name "Admin" --role admin
# prompts for a password
```

## Step 4 — Frontend (Cloudflare Pages)

1. Sign up at **pages.cloudflare.com** (GitHub login) → **Create → Pages → connect** the repo.
2. Build settings:
   - **Root directory:** `web`
   - **Build command:** `pnpm install && pnpm build`
   - **Build output directory:** `dist`
   - **Environment variable:** `VITE_API_BASE = https://realtor-api.onrender.com` (your Render URL)
3. Deploy. You get `https://realtor.pages.dev` (or your project name).

## Step 5 — Close the loop (CORS)

Back on Render, set `CORS_ORIGINS` to the exact Pages URL (comma-separate if you add a custom
domain), then redeploy:
```
CORS_ORIGINS=https://realtor.pages.dev
```
Open the Pages URL, log in with the admin from Step 3. Done.

## Keep it awake (so the crawler keeps running)

Render free sleeps after ~15 min idle — which also pauses the background worker. Add a free
monitor at **uptimerobot.com** (or cron-job.org) hitting
`https://realtor-api.onrender.com/api/v1/healthz` every 5 min. One always-on service ≈ 730 of
the 750 free instance-hours/month — within budget.

---

## Caveats (free-tier honesty)

- **Photos are ephemeral.** The worker downloads photos to disk (`/data/photos`), and Render
  free has **no persistent disk**, so images are lost on every restart/redeploy until re-crawled.
  The data (listings, filters, map, dedupe) is unaffected. Proper fix: store photos in
  **Cloudflare R2** (10 GB free) — a code change; ask and I'll add an R2/S3 storage backend.
- **512 MB RAM.** Enough for the API + a light crawl of a few OLX pages; keep crawl volume modest.
- **Neon auto-suspends** when idle and resumes on the next query (~1 s first-hit latency).
- **Cold start** ~30–60 s only if the service was allowed to sleep (the pinger prevents it).

## Alternative: run the crawler as a scheduled job instead of in-process

If you'd rather not keep the service warm, drive the crawl externally (the worker's `tick()` is
idempotent/schedule-aware):

- **GitHub Actions cron** running a one-shot tick — free & unlimited on a **public** repo; on a
  **private** repo stay under 2000 min/mo (run hourly, not every few minutes).
- **Cloudflare Cron Trigger (Worker)** hitting a secured `/tick` endpoint on the API.

Both need a tiny code addition (`--once` mode / a `/tick` route) — ask and I'll wire it up.
