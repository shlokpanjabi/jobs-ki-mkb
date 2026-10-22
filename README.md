# Apply Tracker

A shared board of internships, part-time jobs and fellowships for Taran, Shlok and Muzzamil.
Next.js 16 (App Router) + TypeScript + Tailwind, backed by Supabase Postgres.

- **All roles** (`/`): search, filter by type / domain / region / deadline / status, sort by deadline.
- **Closing in 7 days** (`/closing`): the same board limited to deadlines from today through 7 days out.
- **User switcher**: each person only sees roles marked eligible for them, with their own status.
- **Apply** opens the posting; **Mark applied** sets your status in one click (or use the status dropdown).
- **`POST /api/jobs`**: add or update a job with a per-user API key. Jobs are deduped by link.
- **Nightly ingestion**: a daily cron pulls listings from ten sources (Simplify, speedyapply, Gradcracker,
  Bright Network, Prosple, Indeed UK, Internshala, Luma, a quant list and your own spreadsheets)
  straight into the database for everyone (see [Job ingestion](#job-ingestion)).

## How it fits together

| Table       | Purpose                                                                   |
| ----------- | ------------------------------------------------------------------------- |
| `users`     | The three users (`taran`, `shlok`, `muzzamil`). Add a row to add a user.   |
| `jobs`      | One row per posting. `link` is unique and is the dedupe key.              |
| `user_jobs` | Per-user row: `eligible` and `status` (`todo`/`applied`/`rejected`/`offer`). |
| `api_keys`  | SHA-256 hash of each user's API key. Plaintext keys are never stored.     |

The app talks to Postgres directly with [`postgres`](https://github.com/porsager/postgres) using
`DATABASE_URL`. It does not use supabase-js or the Supabase Data API. Every table has row level
security enabled with no policies, so Supabase's public `anon` key can't read or write them; the
app connects as the table owner, which bypasses RLS.

Filtering and sorting run in the browser on the user's rows, so they're instant. Filters are kept
in the URL so a refresh or a shared link shows the same view.

## Local setup

Requirements: Node 20.9+ and a Postgres database (a Supabase project, or any local Postgres).

```bash
npm install
cp .env.example .env.local     # then fill in DATABASE_URL
npm run db:migrate             # create tables (safe to re-run)
npm run db:seed                # optional sample data (fictional companies, example.com links)
npm run keys                   # create one API key per user; printed once, copy them now
npm run dev                    # http://localhost:3000
```

Instead of `db:migrate` / `db:seed` you can paste `db/schema.sql` and `db/seed.sql` into the
Supabase SQL editor. The seed's deadlines are relative to the day you run it.

### Environment variables

| Variable         | Required | Description |
| ---------------- | -------- | ----------- |
| `DATABASE_URL`   | yes      | Postgres connection string. On Supabase use the **Transaction pooler** string (port `6543`) from **Connect**, and append `?sslmode=require`. |
| `BOARD_PASSWORD` | no       | If set, the board UI asks for this password (HTTP Basic auth, any username). `/api/jobs` is unaffected. Recommended for a public deployment. |
| `APP_TIMEZONE`   | no       | IANA timezone (e.g. `America/New_York`, `Asia/Kolkata`) used to decide what "today" is for deadlines. Defaults to `UTC`. |
| `INGEST_USERS`   | no       | Comma-separated user ids who see ingested jobs, e.g. `shlok,taran`. Defaults to every user. |
| `INGEST_SOURCES` | no       | Comma-separated subset of the source names in [Job ingestion](#job-ingestion). Defaults to all of them. |
| `INGEST_SHEETS`  | no       | Comma-separated CSV / Google Sheets URLs to import (see [Your spreadsheets](#job-ingestion)). |
| `CRON_SECRET`    | for the cron | Secret Vercel Cron sends as `Authorization: Bearer <CRON_SECRET>`. Without it `/api/cron/ingest` answers `503`. |

## API

### `POST /api/jobs`

Upserts a job by `link` and marks it **eligible for the key's owner only**. Other users' rows and
the owner's existing status are left untouched.

```bash
curl -X POST https://<your-app>/api/jobs \
  -H "Authorization: Bearer $APPLY_TRACKER_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "company": "Northwind Labs",
    "role": "Software Engineering Intern",
    "type": "internship",
    "domain": "Software",
    "location": "San Francisco, CA",
    "region": "US",
    "deadline": "2026-11-30",
    "source": "LinkedIn",
    "link": "https://example.com/jobs/northwind-swe-intern"
  }'
```

| Field      | Required | Notes |
| ---------- | -------- | ----- |
| `company`  | yes      | |
| `role`     | yes      | |
| `type`     | yes      | `internship`, `part-time` or `fellowship` (case-insensitive; `part time` works too) |
| `link`     | yes      | http(s) URL. Normalized for dedupe: `#fragment`, `utm_*` params and trailing `/` are dropped. |
| `deadline` | no       | `YYYY-MM-DD`. Omit for rolling deadlines. |
| `domain`, `location`, `region`, `source` | no | Free text. `domain` and `region` populate the filter dropdowns. |

When the link already exists, `company`, `role` and `type` are overwritten. Optional fields are
only overwritten when the new request includes them.

Responses:

- `201 {"id", "created": true, "eligibleFor", "link"}`: new job
- `200 {"id", "created": false, ...}`: job already existed (deduped)
- `400`: invalid JSON or fields (`details` lists each problem)
- `401`: missing or unknown key
- `413`: body over 16 KB

The key can also be sent as `X-API-Key: <key>`. Keys in the query string are ignored on purpose,
because URLs end up in access logs. The API never logs request headers or keys.

### API keys

```bash
npm run keys                     # create keys for users who don't have one yet
npm run keys -- --rotate         # replace every user's key (old keys stop working)
npm run keys -- --rotate shlok   # replace one user's key
```

Each key looks like `atk_…` and is shown exactly once. Only its SHA-256 hash goes into `api_keys`.
A lost key can't be recovered; rotate it instead. `api_keys.last_used_at` shows when each key was
last used.

## Job ingestion

`lib/ingest/` has one module per source. Each reads public pages, feeds or files (no logins) and
returns jobs in the same shape as `POST /api/jobs` (`company, role, type, domain, location, region,
deadline, source, link`):

| Source | Module | What it reads |
| ------ | ------ | ------------- |
| `sheets` | `sheets.mjs` | Your own spreadsheets: every CSV URL in `INGEST_SHEETS` (see below) |
| `gradcracker` | `gradcracker.mjs` | Placement/internship search pages, then each job page's JSON-LD `JobPosting` |
| `bright-network` | `uk-boards.mjs` | Internship search pages, then each job page's JSON-LD |
| `prosple-uk` | `uk-boards.mjs` | Internship search pages, then each job page's JSON-LD |
| `northwestern-quant` | `northwestern.mjs` | [northwesternfintech/2027QuantInternships](https://github.com/northwesternfintech/2027QuantInternships): open (✅) links only |
| `simplify` | `simplify.mjs` | [SimplifyJobs/Summer2027-Internships](https://github.com/SimplifyJobs/Summer2027-Internships)' `listings.json`: active roles |
| `speedyapply` | `speedyapply.mjs` | speedyapply's [2027 SWE](https://github.com/speedyapply/2027-SWE-College-Jobs) and [2027 AI](https://github.com/speedyapply/2027-AI-College-Jobs) internship lists (US and international) |
| `indeed-uk` | `indeed.mjs` | RSS for "intern" / "student" part-time jobs from the last 7 days, falling back to the search page's job cards |
| `internshala` | `uk-boards.mjs` | Internship listing pages, then each job page's JSON-LD (region India) |
| `luma` | `luma.mjs` | Luma discovery pages (`/london`, `/ai`, `/tech`), keeping hackathons |

The GitHub lists (`simplify`, `speedyapply`, `northwestern-quant`) are the biggest: about 3,300
roles on a first run, mostly US. They only take roles posted in the last 30 days (`MAX_AGE_DAYS` in
`github.mjs`) so the board isn't flooded with stale listings. Jobs are never deleted when a listing
closes; they stay on the board until their deadline passes or you mark them.

`board.mjs` is the shared crawler for job boards that publish schema.org `JobPosting` data on
their job pages (Gradcracker, Bright Network, Prosple, Internshala). Adding another such board is a
config entry: its origin, search paths and job URL pattern.

Search terms, page lists and repos are constants at the top of each module. The `jobs` table only
allows `internship`, `part-time` and `fellowship`, so hackathons are stored as fellowships with
domain `Hackathon`. Their deadline is the event's start date. UK locations get region `Europe`,
like the seed data (`UK_REGION` in `normalise.mjs` changes that).

**Your spreadsheets.** Put one or more CSV URLs in `INGEST_SHEETS`, comma-separated. A Google Sheet
works if it's shared as *Anyone with the link can view*; paste its normal `…/edit#gid=…` URL. Columns
are matched by header, in any order: `company`, `role` (or `title`/`position`) and `link` (or
`url`/`apply link`) are required; `type`, `domain`, `location`, `region` and `deadline` (or
`closing date`) are optional. A missing type is guessed from the role. Dates can be `2026-11-30`,
`30 Nov 2026` or `30/11/2026` (day first). Spreadsheet rows win over the other sources for the same
link.

**Not included**, because they need a login or don't allow automated access: Handshake, MyCareers,
LinkedIn, Glassdoor, Naukri, Trackr, SimplyTK. Web search would need a paid search API key.

`run.mjs` runs all sources at the same time, normalises each job (cleans the text, skips rows
with missing fields or a past deadline, guesses `domain` from the title when the source has none),
drops links already seen in this run, and upserts the rest straight into Postgres (`store.mjs`) by
normalised link, with the same rules as `POST /api/jobs`: an existing job's details are refreshed,
and nobody's status is touched. Every job is marked eligible for every user (or just
`INGEST_USERS`), so no API key is needed. Re-running is safe. A source that throws is reported and
skipped; the others still run.

Each source's counts are logged:

| Column    | Meaning |
| --------- | ------- |
| `found`   | Listings the source returned |
| `new`     | Jobs that weren't in the tracker yet |
| `skipped` | Already in the tracker (details refreshed), already seen in this run, missing fields, or deadline passed |
| `failed`  | Pages that couldn't be fetched, or jobs the database rejected. A source that failed entirely shows `ERROR: …` |

**Being polite.** Requests send `User-Agent: ApplyTrackerBot/1.0 (+repo URL)` (override with
`INGEST_USER_AGENT`). `robots.txt` is checked before every request: a missing file (`404`) allows
everything, while `401`/`403`/`429`/`5xx` or an unreachable file means the site isn't crawled at
all. Requests to one host are made one at a time, at least 2 s apart, or the site's `Crawl-delay`
if longer (capped at 30 s). A `429`/`503` is retried once after `Retry-After`.

> Indeed doesn't like automated clients and may answer `403`, or its robots.txt may disallow the
> pages. When that happens `indeed-uk` fails on its own each night; set
> `INGEST_SOURCES=gradcracker,luma` to stop running it. Check each site's terms before enabling it.

### Running it

```bash
npm run ingest -- --dry-run                  # fetch and print what would be saved; writes nothing
npm run ingest                               # save to the DATABASE_URL database
npm run ingest -- --source=simplify,sheets   # only some sources
npm test                                     # unit tests for the parsers and the pipeline
TEST_DATABASE_URL=postgres://… npm test      # also test the database writes (use a scratch database)
```

The script exits with `1` if any source failed or any job couldn't be saved. If 5 saves fail in a
row it stops, assuming the database is down.

### Nightly cron on Vercel

`vercel.json` schedules `GET /api/cron/ingest` daily at 05:00 UTC. Vercel sends
`Authorization: Bearer $CRON_SECRET`; anything else gets `401`. The route runs the same pipeline
and writes with the app's own `DATABASE_URL`. It returns the counts as JSON, with `200` when
everything worked and `502` when a source failed or a job couldn't be saved. Its log has the
same table as the script.

1. In Project → Settings → Environment Variables add `CRON_SECRET` (e.g. `openssl rand -hex 32`),
   and optionally `INGEST_SOURCES` / `INGEST_USERS`. Redeploy. That's all: it then runs every night.
2. Cron jobs only run on the production deployment. Vercel's Hobby plan runs them once a day at
   some point within the scheduled hour.
3. To test by hand:

   ```bash
   curl -H "Authorization: Bearer $CRON_SECRET" "https://<your-app>/api/cron/ingest?dryRun=1"
   ```

`/api/cron` isn't behind `BOARD_PASSWORD`, because Vercel Cron can't send it; `CRON_SECRET` protects
it instead. The route allows up to 300 s (`maxDuration`); a normal run takes a minute or two
because of the rate limits. A local run of the three GitHub sources (3,284 roles) took 16 s.

## Deploying to Vercel

1. **Database.** Create a Supabase project. Run `db/schema.sql` (and optionally `db/seed.sql`) in
   the SQL editor, or run `npm run db:migrate` locally with `DATABASE_URL` pointing at Supabase.
2. **Keys.** With `.env.local` pointing at the Supabase database, run `npm run keys` and send each
   person their key privately.
3. **Push** this repo to GitHub, then in Vercel choose **Add New → Project** and import it. The
   framework preset is detected as Next.js; keep the default build settings.
4. **Environment variables** (Project → Settings → Environment Variables):
   - `DATABASE_URL`: the Supabase **Transaction pooler** string (port `6543`) with `?sslmode=require`.
     The pooler is needed on serverless; the app already disables prepared statements for it.
   - `BOARD_PASSWORD`: recommended, otherwise anyone with the URL can view the board and change statuses.
   - `APP_TIMEZONE`: optional.
5. **Deploy.** The build doesn't need database access, so the variables only have to be set before
   the first request. After changing a variable, redeploy so it takes effect.
6. **Check it:** open the site, pick a user, then post a test job with `curl` as shown above.

## Scripts

| Command              | What it does |
| -------------------- | ------------ |
| `npm run dev`        | Dev server |
| `npm run build` / `start` | Production build / server |
| `npm run lint`       | ESLint |
| `npm run db:migrate` | Apply `db/schema.sql` |
| `npm run db:seed`    | Apply `db/seed.sql` (sample data; idempotent) |
| `npm run db:setup`   | Both of the above |
| `npm run keys`       | Generate API keys (see above) |
| `npm run ingest`     | Fetch jobs from the sources and post them (`-- --dry-run` to only print) |
| `npm test`           | Ingestion unit tests (`node --test`) |

Scripts read `DATABASE_URL` (and `INGEST_SOURCES` / `INGEST_USERS`) from `.env.local` / `.env` the same
way Next.js does.
