# Apply Tracker

A shared board of internships, part-time jobs and fellowships for Taran, Shlok and Muzzamil.
Next.js 16 (App Router) + TypeScript + Tailwind, backed by Supabase Postgres.

- **All roles** (`/`): search, filter by type / domain / region / deadline / status, sort by deadline.
- **Closing in 7 days** (`/closing`): the same board limited to deadlines from today through 7 days out.
- **User switcher**: each person only sees roles marked eligible for them, with their own status.
- **Apply** opens the posting; **Mark applied** sets your status in one click (or use the status dropdown).
- **`POST /api/jobs`**: add or update a job with a per-user API key. Jobs are deduped by link.

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

Scripts read `DATABASE_URL` from `.env.local` / `.env` the same way Next.js does.
