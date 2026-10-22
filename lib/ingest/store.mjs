// Writes ingested jobs straight to Postgres. Same dedupe and update rules as
// POST /api/jobs (upsertJobForUser in lib/jobs.ts), but marks each job
// eligible for several users at once instead of one key's owner.

/**
 * Users who should see ingested jobs: INGEST_USERS (comma-separated ids), or
 * everyone in `users` when it's unset.
 * @param {import("postgres").Sql} sql
 * @param {string | undefined} wanted
 * @returns {Promise<string[]>}
 */
export async function resolveUsers(sql, wanted = process.env.INGEST_USERS) {
  const all = (await sql`select id from users order by id`).map((r) => r.id);
  const ids = (wanted ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!ids.length) return all;
  const unknown = ids.filter((id) => !all.includes(id));
  if (unknown.length) throw new Error(`INGEST_USERS has unknown user(s): ${unknown.join(", ")}`);
  return ids;
}

/**
 * A `save` function for runIngest. Upserts by link; optional fields missing
 * from the new data keep their stored value; a user's status is never touched.
 *
 * `eligible` is who should see the job (null = all of `userIds`). Everyone else
 * in `userIds` has it hidden, except where they've already moved it past "todo",
 * so re-running with stricter profiles tidies up earlier runs without losing
 * anything someone applied to. A job nobody is eligible for isn't inserted.
 * @param {import("postgres").Sql} sql
 * @param {string[]} userIds
 * @returns {(job: import("./normalise.mjs").Job, eligible?: string[] | null) => Promise<{ created: boolean }>}
 */
export function createStore(sql, userIds) {
  if (!userIds.length) throw new Error("no users to make ingested jobs eligible for");
  return async (job, eligible = null) => {
    const shown = (eligible ?? userIds).filter((id) => userIds.includes(id));
    const [row] = await sql`
      with upserted as (
        insert into jobs (company, role, type, domain, location, region, deadline, source, link)
        select ${job.company}, ${job.role}, ${job.type}, ${job.domain}, ${job.location},
               ${job.region}, ${job.deadline}::date, ${job.source}, ${job.link}
        where cardinality(${shown}::text[]) > 0 or exists (select 1 from jobs where link = ${job.link})
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
        select upserted.id, u.id, u.id = any(${shown}::text[]) from upserted cross join users u
        where u.id = any(${userIds}::text[])
        on conflict (job_id, user_id) do update set eligible = excluded.eligible, updated_at = now()
          where user_jobs.eligible <> excluded.eligible
            and (excluded.eligible or user_jobs.status = 'todo')
      )
      select created from upserted`;
    return { created: row?.created ?? false };
  };
}
