// Tables for email status sync. Applied by `npm run db:migrate` (scripts/db.mjs)
// and also, idempotently, the first time the app needs them, so a deploy works
// without a manual migration step. Safe to run more than once.
//
// Email bodies are never stored: status_events keeps the subject, the date and
// the sender's domain only.

export const INBOUND_SCHEMA = `
begin;
-- "already exists, skipping" notices on every cold start are just noise.
set local client_min_messages = warning;

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

alter table inbound_addresses enable row level security;
alter table status_events     enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon')
     and exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on inbound_addresses, status_events from anon, authenticated;
  end if;
end $$;
commit;
`;

const ensured = new WeakMap();

/**
 * Runs INBOUND_SCHEMA once per connection pool.
 * @param {import("postgres").Sql} sql
 */
export function ensureInboundSchema(sql) {
  if (!ensured.has(sql)) {
    const run = sql.unsafe(INBOUND_SCHEMA).simple().then(
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
