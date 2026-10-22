import { db } from "./db";
import { isValidISODate } from "./dates";
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

// Upserts the job (deduped by link) and marks it eligible for `userId` only.
// Optional fields that are missing in the new payload keep their stored value.
export async function upsertJobForUser(
  job: JobInput,
  userId: string,
): Promise<{ id: number; created: boolean }> {
  const [row] = await db()<{ id: number; created: boolean }[]>`
    with upserted as (
      insert into jobs (company, role, type, domain, location, region, deadline, source, link)
      values (${job.company}, ${job.role}, ${job.type}, ${job.domain}, ${job.location},
              ${job.region}, ${job.deadline}, ${job.source}, ${job.link})
      on conflict (link) do update set
        company    = excluded.company,
        role       = excluded.role,
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
  const rows = await db()<User[]>`select id, name from users order by name`;
  return [...rows];
}

export async function getBoardRows(userId: string): Promise<BoardRow[]> {
  const rows = await db()<BoardRow[]>`
    select j.id, j.company, j.role, j.type, j.domain, j.location, j.region,
           to_char(j.deadline, 'YYYY-MM-DD') as deadline, j.source, j.link, uj.status
    from user_jobs uj
    join jobs j on j.id = uj.job_id
    where uj.user_id = ${userId} and uj.eligible
    order by j.deadline asc nulls last, j.company`;
  return [...rows];
}

export async function setStatus(userId: string, jobId: number, status: Status): Promise<boolean> {
  const rows = await db()`
    update user_jobs set status = ${status}, updated_at = now()
    where job_id = ${jobId} and user_id = ${userId} and eligible
    returning job_id`;
  return rows.length > 0;
}
