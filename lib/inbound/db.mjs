// Database access for email status sync. Bodies are never written: events keep
// subject, date, sender domain, the original Message-ID and the rules' summary
// of what the email asks for (actions.mjs).
import { randomBytes } from "node:crypto";
import { dedupeKey } from "../dedupe.mjs";
import { actionsFor } from "./actions.mjs";
import { decideProgress } from "./match.mjs";
import { ensureInboundSchema } from "./schema.mjs";

/** The user's forwarding token, created on first use. @param {import("postgres").Sql} sql */
export async function forwardingToken(sql, userId) {
  await ensureInboundSchema(sql);
  const token = randomBytes(12).toString("hex"); // 24 lower-case hex chars
  await sql`insert into inbound_addresses (user_id, token) values (${userId}, ${token}) on conflict (user_id) do nothing`;
  const [row] = await sql`select token, gmail_confirm_code, gmail_confirm_url, gmail_confirm_at, gmail_account
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

/**
 * Jobs an email can be matched to: the user's board, plus anything they've
 * moved past "todo". Duplicate listings of one job (same dedupe_key) count
 * once, so they don't make an email look ambiguous.
 */
export async function jobsForUser(sql, userId) {
  const rows = await sql`
    select distinct on (coalesce(j.dedupe_key, 'id:' || j.id)) j.id as job_id, j.company, j.role, uj.status
    from user_jobs uj join jobs j on j.id = uj.job_id
    where uj.user_id = ${userId} and (uj.eligible or uj.status <> 'todo')
    order by coalesce(j.dedupe_key, 'id:' || j.id), (uj.status <> 'todo') desc, j.id`;
  return rows.map((r) => ({ jobId: r.job_id, company: r.company, role: r.role, status: r.status }));
}

// Ids of `jobId` and its duplicate listings (same dedupe_key). Status, stage and
// actions are kept in step across them, like setStatus in lib/jobs.ts.
async function sameJobIds(tx, jobId) {
  const rows = await tx`
    select j.id from jobs j, jobs target
    where target.id = ${jobId}
      and coalesce(j.dedupe_key, 'id:' || j.id) = coalesce(target.dedupe_key, 'id:' || target.id)`;
  return rows.map((r) => r.id);
}

/**
 * Applies one email's evidence to one of the user's applications, inside `tx`:
 * status and stage per decideProgress (match.mjs), then actions. Used by
 * automatic matches, manual matches and "Add to board", so all three behave
 * the same.
 * @returns {Promise<{ previous: string | null, next: string | null, stage: string | null, effect: string }>}
 */
async function applyEvidence(tx, { userId, jobId, eventId, label, extracted, receivedAt }) {
  const [current] = await tx`
    select status, stage, status_source, status_changed_at from user_jobs
    where user_id = ${userId} and job_id = ${jobId} for update`;
  if (!current) return { previous: null, next: null, stage: null, effect: "no_change" };
  const ids = await sameJobIds(tx, jobId);
  const decision = decideProgress(
    { status: current.status, stage: current.stage, statusSource: current.status_source, statusChangedAt: current.status_changed_at },
    label,
    receivedAt,
  );
  // The row is locked above, so another email can't race these checks.
  if (decision.status) {
    await tx`update user_jobs set status = ${decision.status}, status_source = 'email', status_changed_at = ${receivedAt},
                                  updated_at = now()
             where user_id = ${userId} and job_id in ${tx(ids)}`;
  }
  if (decision.stage) {
    await tx`update user_jobs set stage = ${decision.stage}, updated_at = now()
             where user_id = ${userId} and job_id in ${tx(ids)}`;
  }

  const status = decision.status ?? current.status;
  const settled = decision.effect === "updated" || decision.effect === "no_change";
  if ((label === "offer" || label === "rejected") && status === label && settled) {
    // The outcome is in: open actions are closed as resolved, not as done.
    await tx`update application_actions set state = 'resolved', resolved_by = ${label}, closed_at = now()
             where user_id = ${userId} and job_id in ${tx(ids)} and state = 'open'`;
  } else if (status === "applied" && decision.effect !== "conflict" && decision.effect !== "kept_manual") {
    let added = false;
    for (const action of actionsFor(label, extracted)) {
      added = (await upsertAction(tx, { userId, jobId, ids, eventId, receivedAt, reminder: Boolean(extracted?.reminder), ...action })) || added;
    }
    // A new to-do (say, an interview time) is news even when the stage didn't move.
    if (added) return { previous: current.status, next: decision.status, stage: decision.stage, effect: "updated" };
  }
  return { previous: current.status, next: decision.status, stage: decision.stage, effect: decision.effect };
}

/**
 * One open action per kind per application. A repeat (reminder, or the same
 * request again) updates the open one instead of adding another; a newer
 * explicit due date replaces an older one. An action the person already closed
 * isn't reopened by an older email or a reminder; a newer non-reminder email
 * (say, a second interview round) starts a new one. Returns true if it added one.
 */
async function upsertAction(tx, { userId, jobId, ids, eventId, receivedAt, reminder, kind, due }) {
  const [open] = await tx`
    select id, last_seen_at, last_event_id from application_actions
    where user_id = ${userId} and job_id in ${tx(ids)} and kind = ${kind} and state = 'open' for update`;
  if (open) {
    const newer = receivedAt >= open.last_seen_at;
    await tx`
      update application_actions set
        reminders     = reminders + ${open.last_event_id === eventId ? 0 : 1},
        last_event_id = ${newer ? eventId : open.last_event_id},
        last_seen_at  = greatest(last_seen_at, ${receivedAt}),
        due_date      = case when ${newer && due !== null} then ${due?.date ?? null}::date else due_date end,
        due_time      = case when ${newer && due !== null} then ${due?.time ?? null} else due_time end,
        due_tz        = case when ${newer && due !== null} then ${due?.tz ?? null} else due_tz end
      where id = ${open.id}`;
    return false;
  }
  const [closed] = await tx`
    select closed_at from application_actions
    where user_id = ${userId} and job_id in ${tx(ids)} and kind = ${kind} and state <> 'open'
    order by closed_at desc nulls last limit 1`;
  if (closed && (reminder || (closed.closed_at && receivedAt <= closed.closed_at))) return false;
  await tx`
    insert into application_actions (user_id, job_id, kind, due_date, due_time, due_tz, first_event_id, last_event_id, last_seen_at)
    values (${userId}, ${jobId}, ${kind}, ${due?.date ?? null}, ${due?.time ?? null}, ${due?.tz ?? null},
            ${eventId}, ${eventId}, ${receivedAt})`;
  return true;
}

/**
 * Records an email. With `apply`, its evidence is applied to the matched job in
 * the same transaction and the event is "matched"; otherwise it waits in Email
 * matches, with `jobId` (if any) kept as the suggested match. A repeat delivery
 * of the same email (same Resend id, or the same original Message-ID) is a no-op.
 */
export async function recordEvent(sql, event) {
  return sql.begin(async (tx) => {
    const [existing] = await tx`select id from status_events where resend_email_id = ${event.resendEmailId}`;
    if (existing) return { duplicate: true };
    if (event.sourceMessageId) {
      const [same] = await tx`select id from status_events
                              where user_id = ${event.userId} and source_message_id = ${event.sourceMessageId}`;
      if (same) return { duplicate: true };
    }
    const [row] = await tx`
      insert into status_events (resend_email_id, user_id, job_id, received_at, subject, sender_domain,
                                 classification, classified_by, state, source_message_id, extracted)
      values (${event.resendEmailId}, ${event.userId}, ${event.jobId}, ${event.receivedAt},
              ${event.subject.slice(0, 300)}, ${event.senderDomain}, ${event.label}, ${event.by},
              ${event.apply ? "matched" : "inbox"}, ${event.sourceMessageId ?? null}, ${tx.json(event.extracted ?? null)})
      on conflict do nothing -- same Resend id, or same original Message-ID
      returning id`;
    if (!row) return { duplicate: true };
    if (!(event.jobId && event.apply)) return { previous: null, next: null, stage: null, effect: null };
    const change = await applyEvidence(tx, {
      userId: event.userId, jobId: event.jobId, eventId: row.id, label: event.label,
      extracted: event.extracted, receivedAt: event.receivedAt,
    });
    await saveEffect(tx, row.id, change);
    return change;
  });
}

async function saveEffect(tx, eventId, change) {
  await tx`update status_events
           set previous_status = ${change.previous}, new_status = ${change.next}, new_stage = ${change.stage},
               effect = ${change.effect}
           where id = ${eventId}`;
}

const EVENT_COLUMNS = (sql) => sql`e.id, e.received_at, e.subject, e.sender_domain, e.classification, e.classified_by,
  e.state, e.previous_status, e.new_status, e.new_stage, e.effect, e.source_message_id, e.extracted`;

export async function inboxFor(sql, userId) {
  await ensureInboundSchema(sql);
  return sql`select ${EVENT_COLUMNS(sql)},
                    e.job_id as suggested_job_id, j.company as suggested_company, j.role as suggested_role
             from status_events e left join jobs j on j.id = e.job_id
             where e.user_id = ${userId} and e.state = 'inbox' order by e.received_at desc limit 100`;
}

export async function recentEvents(sql, userId, limit = 10) {
  await ensureInboundSchema(sql);
  return sql`select ${EVENT_COLUMNS(sql)}, j.company, j.role
             from status_events e left join jobs j on j.id = e.job_id
             where e.user_id = ${userId} order by e.received_at desc limit ${limit}`;
}

// Inbox -> matched inside `tx`, with the same evidence rules as an automatic match.
async function matchInTx(tx, userId, eventId, jobId, label) {
  const [event] = await tx`select id, received_at, extracted from status_events
                           where id = ${eventId} and user_id = ${userId} and state = 'inbox' for update`;
  const [owned] = await tx`select 1 from user_jobs where user_id = ${userId} and job_id = ${jobId}`;
  if (!event || !owned) return false;
  const change = await applyEvidence(tx, {
    userId, jobId, eventId, label, extracted: event.extracted, receivedAt: new Date(event.received_at),
  });
  await tx`update status_events set job_id = ${jobId}, classification = ${label}, classified_by = 'manual', state = 'matched'
           where id = ${eventId}`;
  await saveEffect(tx, eventId, change);
  return true;
}

/** Email matches -> matched, by hand. Returns false if the event or job isn't the user's. */
export async function matchManually(sql, userId, eventId, jobId, label) {
  await ensureInboundSchema(sql);
  return sql.begin((tx) => matchInTx(tx, userId, eventId, jobId, label));
}

/**
 * "Add to board as Applied" for an unmatched email: the person confirms the
 * company and role (never inferred from the sender). An existing job with the
 * same company + role (dedupe_key) is reused, else a job with no posting link is
 * created. Either way it goes on their board and the email is matched to it as
 * an application confirmation.
 * @returns {Promise<{ jobId: number, reused: boolean } | null>} null if the event isn't theirs or isn't waiting
 */
export async function addJobFromEmail(sql, userId, eventId, { company, role, type }) {
  await ensureInboundSchema(sql);
  return sql.begin(async (tx) => {
    const [event] = await tx`select id from status_events where id = ${eventId} and user_id = ${userId} and state = 'inbox'`;
    if (!event) return null;
    const key = dedupeKey(company, role);
    const [existing] = await tx`
      select j.id from jobs j left join user_jobs uj on uj.job_id = j.id and uj.user_id = ${userId}
      where j.dedupe_key = ${key}
      order by (uj.user_id is not null) desc, (uj.status is not null and uj.status <> 'todo') desc, j.id
      limit 1`;
    const jobId = existing?.id ?? (await tx`
      insert into jobs (company, role, type, source, link, dedupe_key)
      values (${company}, ${role}, ${type}, 'Email', null, ${key})
      returning id`)[0].id;
    await tx`
      insert into user_jobs (job_id, user_id, eligible, added_from_email)
      values (${jobId}, ${userId}, true, true)
      on conflict (job_id, user_id) do update set eligible = true, added_from_email = true, updated_at = now()`;
    await matchInTx(tx, userId, eventId, jobId, "received");
    return { jobId, reused: Boolean(existing) };
  });
}

export async function dismissEvent(sql, userId, eventId) {
  const rows = await sql`update status_events set state = 'dismissed'
                         where id = ${eventId} and user_id = ${userId} and state = 'inbox' returning id`;
  return rows.length > 0;
}

// ---------- actions ----------

/** The user's open actions, with the email that last asked for each (for Gmail links). */
export async function openActions(sql, userId) {
  await ensureInboundSchema(sql);
  return sql`
    select a.id, a.job_id, a.kind, to_char(a.due_date, 'YYYY-MM-DD') as due_date, a.due_time, a.due_tz, a.reminders,
           coalesce(j.dedupe_key, 'id:' || j.id) as job_key,
           e.subject, e.sender_domain, e.source_message_id
    from application_actions a
    join jobs j on j.id = a.job_id
    left join status_events e on e.id = a.last_event_id
    where a.user_id = ${userId} and a.state = 'open'
    order by a.due_date asc nulls last, a.id`;
}

/** Marks one of the user's open actions done or dismissed. */
export async function closeAction(sql, userId, actionId, state) {
  if (state !== "done" && state !== "dismissed") throw new Error(`bad action state ${state}`);
  await ensureInboundSchema(sql);
  const rows = await sql`update application_actions set state = ${state}, closed_at = now()
                         where id = ${actionId} and user_id = ${userId} and state = 'open' returning id`;
  return rows.length > 0;
}

// ---------- Gmail account for "Open in Gmail" ----------

/** The Gmail address the user typed on Settings, or null. */
export async function gmailAccount(sql, userId) {
  await ensureInboundSchema(sql);
  const [row] = await sql`select gmail_account from inbound_addresses where user_id = ${userId}`;
  return row?.gmail_account ?? null;
}

/** Saves (or, with null, clears) the user's Gmail address. */
export async function setGmailAccount(sql, userId, account) {
  await forwardingToken(sql, userId); // makes sure their row exists
  await sql`update inbound_addresses set gmail_account = ${account} where user_id = ${userId}`;
}
