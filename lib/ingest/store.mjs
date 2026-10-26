// Writes ingested jobs straight to Postgres. Same dedupe and update rules as
// POST /api/jobs (upsertJobForUser in lib/jobs.ts), but marks each job
// eligible for several users at once instead of one key's owner.

import { ensureAppSchema } from "../app-schema.mjs";
import { dedupeKey } from "../dedupe.mjs";
import { ELIGIBILITY_USERS, verdictsFor } from "../eligibility.mjs";
import { LONDON, regionFor, UK_REGION } from "./normalise.mjs";

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
 * A `save` function for runIngest: upserts a batch of jobs (unique links) in
 * one statement and returns, per job, whether it was newly created. Same rules
 * as POST /api/jobs: optional fields missing from the new data keep their
 * stored value, and a user's status is never touched.
 *
 * Each job's `users` is who should see it (null = all of `userIds`). Everyone
 * else in `userIds` has it hidden, except where they've already moved it past
 * "todo", so re-running with stricter profiles tidies up earlier runs without
 * losing anything someone applied to. A job nobody is eligible for isn't inserted.
 * Each job's `verdicts` (lib/eligibility.mjs, read from the posting) are saved
 * on those people's rows unless they've set eligibility themselves.
 * @param {import("postgres").Sql} sql
 * @param {string[]} userIds
 * @returns {(batch: { job: import("./normalise.mjs").Job, users: string[] | null, verdicts?: import("./run.mjs").Verdict[] }[]) => Promise<boolean[]>}
 */
export function createStore(sql, userIds) {
  if (!userIds.length) throw new Error("no users to make ingested jobs eligible for");
  return async (batch) => {
    if (!batch.length) return [];
    await ensureAppSchema(sql); // e.g. the "hackathon" type must be allowed before saving one
    const col = (f) => batch.map(({ job }) => job[f]);
    const shown = batch.map(({ users }) => (users ?? userIds).filter((id) => userIds.includes(id)));
    // One (link, user, eligible) row per job and managed user. Booleans go over
    // as text: postgres.js doesn't send boolean arrays as arrays.
    const pairs = batch.flatMap(({ job }, i) => userIds.map((u) => [job.link, u, shown[i].includes(u)]));

    const rows = await sql`
      with input as (
        select * from unnest(
          ${col("company")}::text[], ${col("role")}::text[], ${col("type")}::text[], ${col("domain")}::text[],
          ${col("location")}::text[], ${col("region")}::text[], ${col("deadline")}::text[]::date[],
          ${col("source")}::text[], ${col("link")}::text[], ${shown.map((s) => String(s.length > 0))}::text[]::bool[],
          ${batch.map(({ job }) => dedupeKey(job.company, job.role))}::text[]
        ) as t(company, role, type, domain, location, region, deadline, source, link, anyone, dedupe_key)
      ),
      upserted as (
        insert into jobs (company, role, type, domain, location, region, deadline, source, link, dedupe_key)
        select company, role, type, domain, location, region, deadline, source, link, dedupe_key from input
        where anyone or exists (select 1 from jobs where jobs.link = input.link)
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
        returning id, link, (xmax = 0) as created
      ),
      pairs as (
        select * from unnest(
          ${pairs.map((p) => p[0])}::text[], ${pairs.map((p) => p[1])}::text[], ${pairs.map((p) => String(p[2]))}::text[]::bool[]
        ) as p(link, user_id, eligible)
      ),
      eligibility as (
        insert into user_jobs (job_id, user_id, eligible)
        select upserted.id, pairs.user_id, pairs.eligible from pairs join upserted using (link)
        on conflict (job_id, user_id) do update set eligible = excluded.eligible, updated_at = now()
          where user_jobs.eligible <> excluded.eligible
            and (excluded.eligible or user_jobs.status = 'todo')
      )
      select link, created from upserted`;
    await saveVerdicts(sql, batch.flatMap(({ job, verdicts }) => (verdicts ?? []).map((v) => ({ link: job.link, ...v }))));
    const created = new Map(rows.map((r) => [r.link, r.created]));
    return batch.map(({ job }) => created.get(job.link) ?? false);
  };
}

/**
 * Saves eligibility read from postings ('auto'). A verdict someone set on the
 * board ('manual') is never overwritten, and unknown is never sent here.
 * @param {import("postgres").Sql} sql
 * @param {{ link: string, user: string, verdict: string, note: string }[]} verdicts
 */
async function saveVerdicts(sql, verdicts) {
  if (!verdicts.length) return;
  await sql`
    update user_jobs uj
    set eligibility = v.verdict, eligibility_note = v.note, eligibility_source = 'auto', updated_at = now()
    from unnest(${verdicts.map((v) => v.link)}::text[], ${verdicts.map((v) => v.user)}::text[],
                ${verdicts.map((v) => v.verdict)}::text[], ${verdicts.map((v) => v.note)}::text[])
           as v(link, user_id, verdict, note)
    join jobs j on j.link = v.link
    where uj.job_id = j.id and uj.user_id = v.user_id
      and uj.eligibility_source is distinct from 'manual'
      and (uj.eligibility, uj.eligibility_note) is distinct from (v.verdict, v.note)`;
}

/**
 * Eligibility for rows that have none yet (jobs no source lists any more, ones
 * added by hand, by email or through the API), read from the role title only:
 * posting text isn't stored. Explicit wording only; the rest stays unknown.
 * Safe to run again: it only touches rows nobody has a verdict for.
 * @param {import("postgres").Sql} sql
 * @param {Record<string, import("./profiles.mjs").Profile>} profiles
 * @param {string} today YYYY-MM-DD
 * @returns {Promise<number>} rows given a verdict
 */
export async function backfillEligibility(sql, profiles, today) {
  let updated = 0;
  for (const user of ELIGIBILITY_USERS) {
    if (!profiles[user]) continue;
    const rows = await sql`
      select j.link, j.role from user_jobs uj join jobs j on j.id = uj.job_id
      where uj.user_id = ${user} and uj.eligibility is null and uj.eligibility_source is null and j.link is not null`;
    const found = rows.flatMap((r) => verdictsFor(r, { text: "" }, [user], profiles, today).map((v) => ({ link: r.link, ...v })));
    await saveVerdicts(sql, found);
    updated += found.length;
  }
  return updated;
}

/**
 * UK jobs used to be filed under "Europe". Jobs the sources still list get the
 * new region when they're saved; this catches the rest (ones that dropped out
 * of a feed, sample rows). Only rows whose location is in the UK change.
 * @param {import("postgres").Sql} sql
 * @returns {Promise<number>} rows relabelled
 */
export async function relabelUkRegions(sql) {
  const rows = await sql`select id, location from jobs where region = 'Europe' and location is not null`;
  const fixes = rows
    .map((r) => ({ id: r.id, region: regionFor(r.location) }))
    .filter((f) => f.region === LONDON || f.region === UK_REGION);
  if (!fixes.length) return 0;
  await sql`
    update jobs set region = f.region, updated_at = now()
    from unnest(${fixes.map((f) => String(f.id))}::text[]::int[], ${fixes.map((f) => f.region)}::text[]) as f(id, region)
    where jobs.id = f.id`;
  return fixes.length;
}
