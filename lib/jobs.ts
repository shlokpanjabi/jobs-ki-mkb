import { ensureAppSchema } from "./app-schema.mjs";
import { db } from "./db";
import { isValidISODate } from "./dates";
import { dedupeKey } from "./dedupe.mjs";
import { ELIGIBILITY_USERS } from "./eligibility.mjs";
import { HOME_REGIONS } from "./home-filter";
import { normalizeLink } from "./links.mjs";
import { openActions } from "./inbound/db.mjs";
import { regionFor } from "./ingest/normalise.mjs";
import {
  JOB_TYPES, type ActionKind, type BoardAction, type BoardRow, type JobType, type Stage, type Status, type User, type Verdict,
} from "./types";

export type JobInput = {
  company: string;
  role: string;
  type: JobType;
  domain: string | null;
  location: string | null;
  region: string | null;
  deadline: string | null;
  source: string | null;
  link: string;
};

// ---------- validation ----------

function normalizeType(raw: string): JobType | null {
  const t = raw.toLowerCase().replace(/[\s_]+/g, "-");
  const type = t === "parttime" ? "part-time" : t;
  return JOB_TYPES.includes(type as JobType) ? (type as JobType) : null;
}

export { normalizeLink };

export function parseJobInput(body: unknown): { job: JobInput } | { errors: string[] } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { errors: ["body must be a JSON object"] };
  }
  const input = body as Record<string, unknown>;
  const errors: string[] = [];

  const text = (field: string, required: boolean, max = 300): string | null => {
    const value = input[field];
    if (value === undefined || value === null || (typeof value === "string" && !value.trim())) {
      if (required) errors.push(`${field} is required`);
      return null;
    }
    if (typeof value !== "string") {
      errors.push(`${field} must be a string`);
      return null;
    }
    const trimmed = value.trim().replace(/\s+/g, " ");
    if (trimmed.length > max) {
      errors.push(`${field} must be at most ${max} characters`);
      return null;
    }
    return trimmed;
  };

  const company = text("company", true);
  const role = text("role", true);
  const domain = text("domain", false);
  const location = text("location", false);
  const region = text("region", false);
  const source = text("source", false);

  const rawType = text("type", true);
  const type = rawType ? normalizeType(rawType) : null;
  if (rawType && !type) errors.push(`type must be one of: ${JOB_TYPES.join(", ")}`);

  const rawDeadline = text("deadline", false);
  const deadline = rawDeadline ? rawDeadline.slice(0, 10) : null;
  if (deadline && !isValidISODate(deadline)) errors.push("deadline must be a date like 2026-11-30");

  const rawLink = text("link", true, 2048);
  const link = rawLink ? normalizeLink(rawLink) : null;
  if (rawLink && !link) errors.push("link must be an http(s) URL");

  if (errors.length || !company || !role || !type || !link) return { errors };
  return { job: { company, role, type, domain, location, region, deadline, source, link } };
}

// ---------- queries ----------

// The database, after any pending schema changes (lib/app-schema.mjs).
async function ready() {
  const sql = db();
  await ensureAppSchema(sql);
  return sql;
}

// Upserts the job (deduped by link) and marks it eligible for `userId` only.
// Optional fields that are missing in the new payload keep their stored value.
export async function upsertJobForUser(
  job: JobInput,
  userId: string,
): Promise<{ id: number; created: boolean }> {
  const sql = await ready();
  const [row] = await sql<{ id: number; created: boolean }[]>`
    with upserted as (
      insert into jobs (company, role, type, domain, location, region, deadline, source, link, dedupe_key)
      values (${job.company}, ${job.role}, ${job.type}, ${job.domain}, ${job.location},
              ${job.region}, ${job.deadline}, ${job.source}, ${job.link}, ${dedupeKey(job.company, job.role)})
      on conflict (link) do update set
        company    = excluded.company,
        role       = excluded.role,
        dedupe_key = excluded.dedupe_key,
        type       = excluded.type,
        domain     = coalesce(excluded.domain, jobs.domain),
        location   = coalesce(excluded.location, jobs.location),
        region     = coalesce(excluded.region, jobs.region),
        deadline   = coalesce(excluded.deadline, jobs.deadline),
        source     = coalesce(excluded.source, jobs.source),
        updated_at = now()
      returning id, (xmax = 0) as created
    ),
    eligibility as (
      insert into user_jobs (job_id, user_id, eligible)
      select id, ${userId}, true from upserted
      on conflict (job_id, user_id) do update set eligible = true, updated_at = now()
        where not user_jobs.eligible
    )
    select id, created from upserted`;
  return row;
}

export const HAND_SOURCE = "Added on the site";

export type AddRoleResult =
  | { ok: true; outcome: "added" | "attached" | "exists"; jobId: number; addedFor: string[]; alreadyOn: string[] }
  | { ok: false; errors: string[] };

// "Add role" on the site: puts one role on everyone's board. Same field rules
// as POST /api/jobs (parseJobInput), and the same upsert (upsertJobForUser),
// with two differences for a form:
//   - a board that already has the link is left exactly as it is (status and
//     job details included); if every board has it, it's reported as "exists";
//   - the source says it was added on the site, and the role stays visible
//     whatever each person's home filter says (user_jobs.added_by_hand).
// A link already in the tracker for some people is attached to the other
// boards ("attached"), with the job's details updated as upsertJobForUser does.
// addedFor / alreadyOn are names, in getUsers' order.
export async function addRoleByHand(body: Record<string, unknown>): Promise<AddRoleResult> {
  const parsed = parseJobInput(body);
  if ("errors" in parsed) return { ok: false, errors: parsed.errors };
  const job = parsed.job;
  const source = job.source ? `${job.source} (${HAND_SOURCE.toLowerCase()})` : HAND_SOURCE;
  if (source.length > 300) return { ok: false, errors: ["source must be at most 270 characters"] };
  job.source = source;
  // Like the ingest: a region from the location, so the board's region filter works.
  job.region ??= regionFor(job.location);

  const sql = await ready();
  const users = await getUsers();
  if (!users.length) return { ok: false, errors: ["There are no boards to add it to."] };
  const [existing] = await sql<{ id: number; on: string[] }[]>`
    select j.id, coalesce(array_agg(uj.user_id) filter (where uj.eligible), '{}') as on
    from jobs j left join user_jobs uj on uj.job_id = j.id
    where j.link = ${job.link} group by j.id`;
  const already = new Set(existing?.on ?? []);
  const missing = users.filter((u) => !already.has(u.id));
  const alreadyOn = users.filter((u) => already.has(u.id)).map((u) => u.name);
  if (existing && !missing.length) return { ok: true, outcome: "exists", jobId: existing.id, addedFor: [], alreadyOn };

  let id = existing?.id ?? 0;
  let created = false;
  for (const user of missing) {
    const row = await upsertJobForUser(job, user.id);
    id = row.id;
    created ||= row.created;
  }
  await sql`update user_jobs set added_by_hand = true
            where job_id = ${id} and user_id in ${sql(missing.map((u) => u.id))}`;
  return { ok: true, outcome: created ? "added" : "attached", jobId: id, addedFor: missing.map((u) => u.name), alreadyOn };
}

export async function getUsers(): Promise<User[]> {
  const sql = await ready();
  const rows = await sql<User[]>`
    select id, name, home_regions as "homeRegions", home_types as "homeTypes" from users order by name`;
  return [...rows];
}

// Region key -> board region pairs for the home filter, as two parallel arrays.
const REGION_KEYS = HOME_REGIONS.flatMap((r) => r.regions.map(() => r.key));
const REGION_NAMES = HOME_REGIONS.flatMap((r) => [...r.regions]);

// The user's board: only regions and types their home filter allows (plus jobs
// they added from an email), and one row per job (dedupe_key) even when several
// sources list it. The row kept is the one they've already moved past "todo",
// else the earliest deadline; its source column lists every source. Each row
// carries its stage and open actions.
export async function getBoardRows(userId: string): Promise<BoardRow[]> {
  const sql = await ready();
  const [rows, actions] = await Promise.all([
    sql<(Omit<BoardRow, "actions" | "eligibility"> & { k: string } & EligibilityColumns)[]>`
    with home as (select home_regions, home_types from users where id = ${userId}),
    region_map as (
      select * from unnest(${REGION_KEYS}::text[], ${REGION_NAMES}::text[]) as m(key, region)
    ),
    shown as (
      select j.id, j.company, j.role, j.type, j.domain, j.location, j.region, j.deadline, j.source, j.link,
             uj.status, uj.stage, uj.eligibility, uj.eligibility_note, uj.eligibility_source,
             coalesce(j.dedupe_key, 'id:' || j.id) as k
      from user_jobs uj
      join jobs j on j.id = uj.job_id
      cross join home h
      where uj.user_id = ${userId} and uj.eligible
        and (uj.added_from_email or uj.added_by_hand or (
          (h.home_types is null or j.type = any(h.home_types))
          and (j.region in (select region from region_map where key = any(h.home_regions))
               or ('other' = any(h.home_regions)
                   and (j.region is null or j.region not in (select region from region_map))))))
    ),
    sources as (
      select k, string_agg(distinct source, ', ' order by source) as source from shown group by k
    ),
    one_per_job as (
      select distinct on (k) * from shown
      order by k, (status <> 'todo') desc, deadline asc nulls last, id
    ),
    -- Eligibility for the job: one set on the board wins, then any verdict.
    verdicts as (
      select distinct on (k) k, eligibility, eligibility_note, eligibility_source from shown
      order by k, (eligibility_source = 'manual') desc nulls last, (eligibility is not null) desc, id
    )
    select o.id, o.company, o.role, o.type, o.domain, o.location, o.region,
           to_char(o.deadline, 'YYYY-MM-DD') as deadline, s.source, o.link, o.status, o.stage, o.k,
           v.eligibility, v.eligibility_note, v.eligibility_source
    from one_per_job o join sources s using (k) join verdicts v using (k)
    order by o.deadline asc nulls last, o.company`,
    boardActions(userId),
  ]);
  const verdicts = ELIGIBILITY_USERS.includes(userId);
  return rows.map(({ k, eligibility, eligibility_note, eligibility_source, ...row }) => ({
    ...row,
    actions: actions.get(k) ?? [],
    ...(verdicts && {
      eligibility: { verdict: eligibility, note: eligibility_note, manual: eligibility_source === "manual" },
    }),
  }));
}

type EligibilityColumns = {
  eligibility: Verdict | null;
  eligibility_note: string | null;
  eligibility_source: "manual" | "auto" | null;
};

type ActionRow = {
  id: number; kind: ActionKind; due_date: string | null; due_time: string | null; due_tz: string | null;
  reminders: number; job_key: string; subject: string | null; sender_domain: string | null; source_message_id: string | null;
};

// Open actions keyed by job (dedupe_key), so duplicates of a job share them. If
// the email sync tables aren't there yet, the board still loads without them.
async function boardActions(userId: string): Promise<Map<string, BoardAction[]>> {
  const byJob = new Map<string, BoardAction[]>();
  let rows: ActionRow[];
  try {
    rows = (await openActions(db(), userId)) as ActionRow[];
  } catch (err) {
    console.error(`board: actions unavailable: ${err instanceof Error ? err.message : err}`);
    return byJob;
  }
  for (const r of rows) {
    const list = byJob.get(r.job_key) ?? [];
    list.push({
      id: r.id, kind: r.kind, dueDate: r.due_date, dueTime: r.due_time, dueTz: r.due_tz, reminders: r.reminders,
      email: r.subject === null ? null : { subject: r.subject, senderDomain: r.sender_domain, messageId: r.source_message_id },
    });
    byJob.set(r.job_key, list);
  }
  return byJob;
}

// Sets the status on the job and on every duplicate of it (same dedupe_key),
// so the board shows the change whichever duplicate it picks.
// Recorded as a manual change, so an email sent before it can't undo it
// (decideProgress in lib/inbound/match.mjs).
export async function setStatus(userId: string, jobId: number, status: Status): Promise<boolean> {
  const sql = await ready();
  const rows = await sql`
    update user_jobs set status = ${status}, status_source = 'manual', status_changed_at = now(), updated_at = now()
    where user_id = ${userId} and eligible
      and job_id in (
        select j.id from jobs j, jobs target
        where target.id = ${jobId}
          and coalesce(j.dedupe_key, 'id:' || j.id) = coalesce(target.dedupe_key, 'id:' || target.id)
      )
    returning job_id`;
  return rows.length > 0;
}

/** People who can set the stage by hand on their board (otherwise only emails set it). */
export const STAGE_CONTROL_USERS = ["shlok"];

// Stage set on the board (null = no invitation yet), on the job and its
// duplicates like setStatus. Means invited, not that it was completed. Emails
// can still move it on later, as they do now.
export async function setStage(userId: string, jobId: number, stage: Stage | null): Promise<boolean> {
  if (!STAGE_CONTROL_USERS.includes(userId)) return false;
  const sql = await ready();
  const rows = await sql`
    update user_jobs set stage = ${stage}, updated_at = now()
    where user_id = ${userId} and eligible
      and job_id in (
        select j.id from jobs j, jobs target
        where target.id = ${jobId}
          and coalesce(j.dedupe_key, 'id:' || j.id) = coalesce(target.dedupe_key, 'id:' || target.id)
      )
    returning job_id`;
  return rows.length > 0;
}

// Eligibility set on the board (null = unknown), on the job and its duplicates
// like setStatus. Marked 'manual', so postings read later never change it; the
// employer's wording already saved is kept. Only for ELIGIBILITY_USERS.
export async function setEligibility(userId: string, jobId: number, verdict: Verdict | null): Promise<boolean> {
  if (!ELIGIBILITY_USERS.includes(userId)) return false;
  const sql = await ready();
  const rows = await sql`
    update user_jobs set eligibility = ${verdict}, eligibility_source = 'manual', updated_at = now()
    where user_id = ${userId} and eligible
      and job_id in (
        select j.id from jobs j, jobs target
        where target.id = ${jobId}
          and coalesce(j.dedupe_key, 'id:' || j.id) = coalesce(target.dedupe_key, 'id:' || target.id)
      )
    returning job_id`;
  return rows.length > 0;
}

export async function setHomeFilter(userId: string, regions: string[], types: string[] | null): Promise<void> {
  const sql = await ready();
  await sql`update users set home_regions = ${regions}, home_types = ${types} where id = ${userId}`;
}

export type PetStats = { applied: number; assessments: number; interviews: number; offers: number; questsDone: number };

// Progress per person for their pet (lib/pets.mjs). Each job counts once, even
// when several sources list it (dedupe_key). Every status past To do means
// they applied; the stage is the furthest invitation.
export async function getPetStats(): Promise<Record<string, PetStats>> {
  const sql = await ready();
  const rows = await sql<{ user_id: string; applied: number; assessments: number; interviews: number; offers: number }[]>`
    with apps as (
      select distinct on (uj.user_id, coalesce(j.dedupe_key, 'id:' || j.id)) uj.user_id, uj.status, uj.stage
      from user_jobs uj join jobs j on j.id = uj.job_id
      where uj.status <> 'todo' or uj.stage is not null
      order by uj.user_id, coalesce(j.dedupe_key, 'id:' || j.id), (uj.status <> 'todo') desc, uj.stage desc nulls last
    )
    select u.id as user_id,
           (count(*) filter (where a.status in ('applied', 'rejected', 'offer')))::int as applied,
           (count(*) filter (where a.stage = 'assessment_invited'))::int as assessments,
           (count(*) filter (where a.stage = 'interview_invited'))::int as interviews,
           (count(*) filter (where a.status = 'offer'))::int as offers
    from users u left join apps a on a.user_id = u.id
    group by u.id`;
  const quests = await questsDone(sql);
  return Object.fromEntries(
    rows.map((r) => [r.user_id, {
      applied: r.applied, assessments: r.assessments, interviews: r.interviews, offers: r.offers,
      questsDone: quests.get(r.user_id) ?? 0,
    }]),
  );
}

// To-dos marked done. If the email sync tables aren't there yet, nobody has any.
async function questsDone(sql: Awaited<ReturnType<typeof ready>>): Promise<Map<string, number>> {
  try {
    const rows = await sql<{ user_id: string; n: number }[]>`
      select user_id, count(*)::int as n from application_actions where state = 'done' group by user_id`;
    return new Map(rows.map((r) => [r.user_id, r.n]));
  } catch {
    return new Map();
  }
}
