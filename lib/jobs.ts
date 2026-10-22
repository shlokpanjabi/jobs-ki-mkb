import { ensureAppSchema } from "./app-schema.mjs";
import { db } from "./db";
import { isValidISODate } from "./dates";
import { dedupeKey } from "./dedupe.mjs";
import { HOME_REGIONS } from "./home-filter";
import { normalizeLink } from "./links.mjs";
import { JOB_TYPES, type BoardRow, type JobType, type Status, type User } from "./types";

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

export async function getUsers(): Promise<User[]> {
  const sql = await ready();
  const rows = await sql<User[]>`
    select id, name, home_regions as "homeRegions", home_types as "homeTypes" from users order by name`;
  return [...rows];
}

// Region key -> board region pairs for the home filter, as two parallel arrays.
const REGION_KEYS = HOME_REGIONS.flatMap((r) => r.regions.map(() => r.key));
const REGION_NAMES = HOME_REGIONS.flatMap((r) => [...r.regions]);

// The user's board: only regions and types their home filter allows, and one
// row per job (dedupe_key) even when several sources list it. The row kept is
// the one they've already moved past "todo", else the earliest deadline; its
// source column lists every source.
export async function getBoardRows(userId: string): Promise<BoardRow[]> {
  const sql = await ready();
  const rows = await sql<BoardRow[]>`
    with home as (select home_regions, home_types from users where id = ${userId}),
    region_map as (
      select * from unnest(${REGION_KEYS}::text[], ${REGION_NAMES}::text[]) as m(key, region)
    ),
    shown as (
      select j.id, j.company, j.role, j.type, j.domain, j.location, j.region, j.deadline, j.source, j.link,
             uj.status, coalesce(j.dedupe_key, 'id:' || j.id) as k
      from user_jobs uj
      join jobs j on j.id = uj.job_id
      cross join home h
      where uj.user_id = ${userId} and uj.eligible
        and (h.home_types is null or j.type = any(h.home_types))
        and (j.region in (select region from region_map where key = any(h.home_regions))
             or ('other' = any(h.home_regions)
                 and (j.region is null or j.region not in (select region from region_map))))
    ),
    sources as (
      select k, string_agg(distinct source, ', ' order by source) as source from shown group by k
    ),
    one_per_job as (
      select distinct on (k) * from shown
      order by k, (status <> 'todo') desc, deadline asc nulls last, id
    )
    select o.id, o.company, o.role, o.type, o.domain, o.location, o.region,
           to_char(o.deadline, 'YYYY-MM-DD') as deadline, s.source, o.link, o.status
    from one_per_job o join sources s using (k)
    order by o.deadline asc nulls last, o.company`;
  return [...rows];
}

// Sets the status on the job and on every duplicate of it (same dedupe_key),
// so the board shows the change whichever duplicate it picks.
export async function setStatus(userId: string, jobId: number, status: Status): Promise<boolean> {
  const sql = await ready();
  const rows = await sql`
    update user_jobs set status = ${status}, updated_at = now()
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
