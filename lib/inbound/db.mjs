// Database access for email status sync. Bodies are never written: events keep
// subject, date and sender domain only.
import { randomBytes } from "node:crypto";
import { ensureInboundSchema } from "./schema.mjs";
import { STATUS_FOR, STATUS_RANK } from "./match.mjs";

/** The user's forwarding token, created on first use. @param {import("postgres").Sql} sql */
export async function forwardingToken(sql, userId) {
  await ensureInboundSchema(sql);
  const token = randomBytes(12).toString("hex"); // 24 lower-case hex chars
  await sql`insert into inbound_addresses (user_id, token) values (${userId}, ${token}) on conflict (user_id) do nothing`;
  const [row] = await sql`select token, gmail_confirm_code, gmail_confirm_url, gmail_confirm_at
                          from inbound_addresses where user_id = ${userId}`;
  return row;
}

export async function userForToken(sql, token) {
  await ensureInboundSchema(sql);
  const [row] = await sql`select user_id from inbound_addresses where token = ${token}`;
  return row?.user_id ?? null;
}

export async function saveGmailConfirmation(sql, userId, { code, url }) {
  await sql`update inbound_addresses
            set gmail_confirm_code = ${code}, gmail_confirm_url = ${url}, gmail_confirm_at = now()
            where user_id = ${userId}`;
}

export async function eventExists(sql, resendEmailId) {
  await ensureInboundSchema(sql);
  return (await sql`select 1 from status_events where resend_email_id = ${resendEmailId}`).length > 0;
}

/** Jobs an email can be matched to: the user's board, plus anything they've moved past "todo". */
export async function jobsForUser(sql, userId) {
  const rows = await sql`
    select j.id as job_id, j.company, j.role, uj.status
    from user_jobs uj join jobs j on j.id = uj.job_id
    where uj.user_id = ${userId} and (uj.eligible or uj.status <> 'todo')`;
  return rows.map((r) => ({ jobId: r.job_id, company: r.company, role: r.role, status: r.status }));
}

/**
 * Moves the user's status for `jobId` forward to the one `label` implies, never
 * backwards. Returns { previous, next } (next is null when nothing changed).
 */
async function advanceStatus(tx, userId, jobId, label) {
  const target = STATUS_FOR[label];
  const [current] = await tx`select status from user_jobs where user_id = ${userId} and job_id = ${jobId} for update`;
  if (!current) return { previous: null, next: null };
  if (!target || STATUS_RANK[target] <= (STATUS_RANK[current.status] ?? 0)) return { previous: current.status, next: null };
  // The row is locked above, so the rank check can't race another email.
  await tx`update user_jobs set status = ${target}, updated_at = now() where user_id = ${userId} and job_id = ${jobId}`;
  return { previous: current.status, next: target };
}

/**
 * Records an email. With `apply`, the user's status for the job is moved forward
 * in the same transaction and the event is "matched"; otherwise it waits in the
 * Inbox, with `jobId` (if any) kept as the suggested match. A repeat delivery of
 * the same email is a no-op.
 */
export async function recordEvent(sql, event) {
  return sql.begin(async (tx) => {
    const [existing] = await tx`select id from status_events where resend_email_id = ${event.resendEmailId}`;
    if (existing) return { duplicate: true };
    const change = event.jobId && event.apply
      ? await advanceStatus(tx, event.userId, event.jobId, event.label)
      : { previous: null, next: null };
    await tx`
      insert into status_events (resend_email_id, user_id, job_id, received_at, subject, sender_domain,
                                 classification, classified_by, previous_status, new_status, state)
      values (${event.resendEmailId}, ${event.userId}, ${event.jobId}, ${event.receivedAt},
              ${event.subject.slice(0, 300)}, ${event.senderDomain}, ${event.label}, ${event.by},
              ${change.previous}, ${change.next}, ${event.apply ? "matched" : "inbox"})
      on conflict (resend_email_id) do nothing`;
    return change;
  });
}

export async function inboxFor(sql, userId) {
  await ensureInboundSchema(sql);
  return sql`select e.id, e.received_at, e.subject, e.sender_domain, e.classification,
                    e.job_id as suggested_job_id, j.company as suggested_company, j.role as suggested_role
             from status_events e left join jobs j on j.id = e.job_id
             where e.user_id = ${userId} and e.state = 'inbox' order by e.received_at desc limit 100`;
}

export async function recentEvents(sql, userId, limit = 10) {
  await ensureInboundSchema(sql);
  return sql`select e.id, e.received_at, e.subject, e.sender_domain, e.classification, e.classified_by, e.state,
                    e.new_status, j.company, j.role
             from status_events e left join jobs j on j.id = e.job_id
             where e.user_id = ${userId} order by e.received_at desc limit ${limit}`;
}

/** Inbox -> matched, by hand. Returns false if the event or job isn't the user's. */
export async function matchManually(sql, userId, eventId, jobId, label) {
  return sql.begin(async (tx) => {
    const [event] = await tx`select id from status_events where id = ${eventId} and user_id = ${userId} and state = 'inbox' for update`;
    const [owned] = await tx`select 1 from user_jobs where user_id = ${userId} and job_id = ${jobId}`;
    if (!event || !owned) return false;
    const change = await advanceStatus(tx, userId, jobId, label);
    await tx`update status_events
             set job_id = ${jobId}, classification = ${label}, classified_by = 'manual', state = 'matched',
                 previous_status = ${change.previous}, new_status = ${change.next}
             where id = ${eventId}`;
    return true;
  });
}

export async function dismissEvent(sql, userId, eventId) {
  const rows = await sql`update status_events set state = 'dismissed'
                         where id = ${eventId} and user_id = ${userId} and state = 'inbox' returning id`;
  return rows.length > 0;
}
