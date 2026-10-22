-- Apply Tracker schema. Safe to run more than once.

create table if not exists users (
  id   text primary key check (id ~ '^[a-z][a-z0-9_-]{0,31}$'),
  name text not null
);

insert into users (id, name) values
  ('taran', 'Taran'),
  ('shlok', 'Shlok'),
  ('muzzamil', 'Muzzamil')
on conflict (id) do nothing;

create table if not exists jobs (
  id         integer generated always as identity primary key,
  company    text not null,
  role       text not null,
  type       text not null check (type in ('internship', 'part-time', 'fellowship')),
  domain     text,
  location   text,
  region     text,
  deadline   date,
  source     text,
  link       text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One row per (job, user). A user only sees jobs where eligible = true.
create table if not exists user_jobs (
  job_id     integer not null references jobs (id) on delete cascade,
  user_id    text    not null references users (id) on delete cascade,
  eligible   boolean not null default true,
  status     text    not null default 'todo'
             check (status in ('todo', 'applied', 'rejected', 'offer')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (job_id, user_id)
);

create index if not exists user_jobs_user_eligible_idx on user_jobs (user_id) where eligible;

-- Only SHA-256 hashes of API keys are stored; the plaintext is shown once by `npm run keys`.
create table if not exists api_keys (
  id           integer generated always as identity primary key,
  user_id      text not null references users (id) on delete cascade,
  key_hash     text not null unique check (key_hash ~ '^[0-9a-f]{64}$'),
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);

-- Supabase exposes the public schema over its REST API. RLS with no policies
-- blocks the anon/authenticated roles; the app connects as the table owner,
-- which bypasses RLS.
alter table users     enable row level security;
alter table jobs      enable row level security;
alter table user_jobs enable row level security;
alter table api_keys  enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon')
     and exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on users, jobs, user_jobs, api_keys from anon, authenticated;
  end if;
end $$;

-- Later additions (home filter columns, the "hackathon" type, dedupe_key) are
-- in lib/app-schema.mjs, applied the same way as the email tables below.

-- Email status sync tables (inbound_addresses, status_events) live in
-- lib/inbound/schema.mjs: `npm run db:migrate` applies them after this file, and
-- the app applies them on first use.
