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
 * @param {import("postgres").Sql} sql
 * @param {string[]} userIds
 * @returns {(job: import("./normalise.mjs").Job) => Promise<{ created: boolean }>}
 */
export function createStore(sql, userIds) {
  if (!userIds.length) throw new Error("no users to make ingested jobs eligible for");
  return async (job) => {
    const [row] = await sql`
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
        select upserted.id, u.id, true from upserted cross join users u
        where u.id in ${sql(userIds)}
        on conflict (job_id, user_id) do update set eligible = true, updated_at = now()
          where not user_jobs.eligible
      )
      select created from upserted`;
    return { created: row.created };
  };
}
