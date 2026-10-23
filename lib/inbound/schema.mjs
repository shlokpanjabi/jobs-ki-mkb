// Tables for email status sync. Applied by `npm run db:migrate` (scripts/db.mjs)
// and also, idempotently, the first time the app needs them, so a deploy works
// without a manual migration step. Safe to run more than once.
//
// Email bodies are never stored: status_events keeps the subject, the date, the
// sender's domain, the original Message-ID and what the rules extracted.

import { ensureAppSchema } from "../app-schema.mjs";

// No begin/commit here: ensureInboundSchema runs this inside sql.begin. A raw
// "begin" through a pool of more than one connection is refused by postgres.js
// (UNSAFE_TRANSACTION), which is what broke /settings and /inbox in production.
export const INBOUND_SCHEMA = `
-- "already exists, skipping" notices on every cold start are just noise.
set local client_min_messages = warning;
-- Serverless instances that start together would otherwise race to make the
-- same change, and one would fail with "already exists". Held until commit.
select pg_advisory_xact_lock(hashtext('apply-tracker-schema'));

-- One forwarding address per user: track+<token>@<inbound domain>.
create table if not exists inbound_addresses (
  user_id            text primary key references users (id) on delete cascade,
  token              text not null unique check (token ~ '^[a-z0-9]{16,64}$'),
  -- Gmail sends a confirmation email to a new forwarding address; its code and
  -- link are shown on the Settings page so the user can finish the setup.
  gmail_confirm_code text,
  gmail_confirm_url  text,
  gmail_confirm_at   timestamptz,
  created_at         timestamptz not null default now()
);

create table if not exists status_events (
  id              integer generated always as identity primary key,
  resend_email_id text not null unique,
  user_id         text not null references users (id) on delete cascade,
  job_id          integer references jobs (id) on delete set null,
  received_at     timestamptz not null,
  subject         text not null default '',
  sender_domain   text,
  classification  text not null check (classification in
                    ('received', 'assessment_invite', 'interview', 'offer', 'rejected', 'unknown')),
  classified_by   text not null check (classified_by in ('rules', 'llm', 'manual', 'none')),
  previous_status text,
  new_status      text,
  -- matched: tied to a job. inbox: waiting for manual matching. dismissed: ignored.
  state           text not null default 'inbox' check (state in ('matched', 'inbox', 'dismissed')),
  created_at      timestamptz not null default now()
);

create index if not exists status_events_user_idx on status_events (user_id, received_at desc);

-- Added later, so applied column by column:
--   inbound_addresses.gmail_account  the Gmail address the person forwards from,
--                                    typed in on Settings (never guessed); used
--                                    for "Open in Gmail" links
--   status_events.source_message_id  the original email's Message-ID, only when
--                                    it's known to be the original's (see
--                                    sourceMessageId in email.mjs)
--   status_events.extracted          what the email asks for, from the rules:
--                                    action kinds, explicit dates, reminder flag.
--                                    Never the body.
--   status_events.effect             what it did: updated, no_change, stale,
--                                    conflict or kept_manual
--   status_events.new_stage          stage it moved the application to, if any
do $$
declare
  col record;
begin
  for col in select * from (values
    ('inbound_addresses', 'gmail_account', 'text'),
    ('status_events', 'source_message_id', 'text'),
    ('status_events', 'extracted', 'jsonb'),
    ('status_events', 'effect', 'text'),
    ('status_events', 'new_stage', 'text')
  ) as c(tbl, name, ddl) loop
    if not exists (select 1 from information_schema.columns
                   where table_schema = current_schema() and table_name = col.tbl and column_name = col.name) then
      execute format('alter table %I add column %I %s', col.tbl, col.name, col.ddl);
    end if;
  end loop;
end $$;

-- The same original email forwarded twice (two Resend ids) is one event, even
-- when both deliveries arrive at once.
create unique index if not exists status_events_message_idx on status_events (user_id, source_message_id)
  where source_message_id is not null;

-- Things an email asks the person to do for one application. Open until they
-- mark it done or dismiss it; an offer or rejection marks it resolved (not
-- done). Due date, time and time zone are kept exactly as the email gave them.
create table if not exists application_actions (
  id             integer generated always as identity primary key,
  user_id        text not null references users (id) on delete cascade,
  job_id         integer not null references jobs (id) on delete cascade,
  kind           text not null check (kind in ('complete_assessment', 'book_interview', 'attend_interview')),
  due_date       date,
  due_time       text check (due_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  due_tz         text,
  state          text not null default 'open' check (state in ('open', 'done', 'dismissed', 'resolved')),
  resolved_by    text check (resolved_by in ('offer', 'rejected')),
  first_event_id integer references status_events (id) on delete set null,
  last_event_id  integer references status_events (id) on delete set null,
  last_seen_at   timestamptz not null,
  reminders      integer not null default 0,
  closed_at      timestamptz,
  created_at     timestamptz not null default now(),
  check (due_time is null or due_tz is not null)
);
-- One open action of each kind per application: reminders update it.
create unique index if not exists application_actions_open_idx
  on application_actions (user_id, job_id, kind) where state = 'open';

alter table inbound_addresses   enable row level security;
alter table status_events       enable row level security;
alter table application_actions enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon')
     and exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on inbound_addresses, status_events, application_actions from anon, authenticated;
  end if;
end $$;
`;

const ensured = new WeakMap();

/**
 * Runs INBOUND_SCHEMA once per connection pool.
 * @param {import("postgres").Sql} sql
 */
export function ensureInboundSchema(sql) {
  if (!ensured.has(sql)) {
    // The pipeline also writes the user_jobs progress columns from app-schema.mjs.
    const run = ensureAppSchema(sql).then(() => sql.begin((tx) => tx.unsafe(INBOUND_SCHEMA).simple())).then(
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
