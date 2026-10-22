// Schema changes made after db/schema.sql was first applied. Run by
// `npm run db:migrate` and also, once per connection pool, the first time the
// app or the ingest needs them, so a deploy works without a manual migration.
// Safe to run more than once: every ALTER checks first, so a database that's
// already up to date takes no exclusive locks.
import { dedupeKey } from "./dedupe.mjs";

export const APP_SCHEMA = `
set local client_min_messages = warning;

-- Per-user home filter: which regions and job types show on their board.
-- Region keys are defined in lib/home-filter.ts; home_types null = every type.
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = current_schema() and table_name = 'users' and column_name = 'home_regions') then
    alter table users add column home_regions text[] not null default '{uk,europe,remote}';
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema = current_schema() and table_name = 'users' and column_name = 'home_types') then
    alter table users add column home_types text[];
  end if;
end $$;

-- "hackathon" job type (they used to be filed as fellowships).
do $$
begin
  if not exists (select 1 from pg_constraint
                 where conrelid = 'jobs'::regclass and conname = 'jobs_type_check'
                   and pg_get_constraintdef(oid) like '%hackathon%') then
    alter table jobs drop constraint if exists jobs_type_check;
    alter table jobs add constraint jobs_type_check
      check (type in ('internship', 'part-time', 'fellowship', 'hackathon'));
  end if;
end $$;

update jobs set type = 'hackathon', updated_at = now()
where type <> 'hackathon' and (role ~* 'hackathon' or domain ~* 'hackathon');

-- Same job from several sources: lib/dedupe.mjs computes the key.
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = current_schema() and table_name = 'jobs' and column_name = 'dedupe_key') then
    alter table jobs add column dedupe_key text;
  end if;
end $$;
create index if not exists jobs_dedupe_key_idx on jobs (dedupe_key);
`;

/**
 * Fills in dedupe keys for rows saved before the column existed (or by
 * something that didn't set it). Returns how many rows were updated.
 * @param {import("postgres").Sql} sql
 */
export async function backfillDedupeKeys(sql) {
  const rows = await sql`select id, company, role from jobs where dedupe_key is null`;
  if (!rows.length) return 0;
  await sql`
    update jobs set dedupe_key = f.key
    from unnest(${rows.map((r) => String(r.id))}::text[]::int[], ${rows.map((r) => dedupeKey(r.company, r.role))}::text[])
      as f(id, key)
    where jobs.id = f.id`;
  return rows.length;
}

const ensured = new WeakMap();

/**
 * Runs APP_SCHEMA and the dedupe backfill once per connection pool.
 * @param {import("postgres").Sql} sql
 */
export function ensureAppSchema(sql) {
  if (!ensured.has(sql)) {
    const run = sql
      .begin(async (tx) => {
        await tx.unsafe(APP_SCHEMA).simple();
        await backfillDedupeKeys(tx);
      })
      .then(
        () => undefined,
        (err) => {
          ensured.delete(sql); // try again on the next request
          throw err;
        },
      );
    ensured.set(sql, run);
  }
  return ensured.get(sql);
}
