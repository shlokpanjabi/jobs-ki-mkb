// Setting the stage by hand on the board (setStage in lib/jobs.ts). Run with
// `npm test`; needs TEST_DATABASE_URL (a scratch database with `npm run
// db:migrate` applied) and is skipped otherwise.
import assert from "node:assert/strict";
import { register } from "node:module";
import { test } from "node:test";

test("stage control: set by hand on shlok's board, for the job and its duplicates only", { skip: !process.env.TEST_DATABASE_URL }, async () => {
  register("./ts-test-hooks.mjs", import.meta.url);
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL; // lib/db.ts reads it
  const { setStage } = await import("./jobs.ts");
  const sql = (await import("./db.ts")).db();
  const stamp = Date.now();
  const links = [`https://jobs.test/stage-a-${stamp}`, `https://jobs.test/stage-b-${stamp}`, `https://jobs.test/stage-c-${stamp}`];
  const stages = async (user) =>
    (await sql`select j.link, uj.stage from user_jobs uj join jobs j on j.id = uj.job_id
               where uj.user_id = ${user} and j.link in ${sql(links)} order by j.link`).map((r) => r.stage);
  try {
    // a and b are the same job from two sources (one dedupe_key); c is another job.
    const ids = [];
    for (const [i, link] of links.entries()) {
      const [{ id }] = await sql`insert into jobs (company, role, type, link, dedupe_key)
        values ('Acme', 'Analyst', 'internship', ${link}, ${i < 2 ? `acme-${stamp}` : `other-${stamp}`}) returning id`;
      await sql`insert into user_jobs (job_id, user_id, eligible, status) values (${id}, 'shlok', true, 'applied'), (${id}, 'taran', true, 'applied')`;
      ids.push(id);
    }

    assert.equal(await setStage("shlok", ids[0], "assessment_invited"), true);
    assert.deepEqual(await stages("shlok"), ["assessment_invited", "assessment_invited", null]);
    assert.equal(await setStage("shlok", ids[1], "interview_invited"), true);
    assert.deepEqual(await stages("shlok"), ["interview_invited", "interview_invited", null]);
    assert.equal(await setStage("shlok", ids[0], null), true); // "no invite yet"
    assert.deepEqual(await stages("shlok"), [null, null, null]);

    // Not for other people, and their rows don't change.
    assert.equal(await setStage("taran", ids[0], "assessment_invited"), false);
    assert.deepEqual(await stages("taran"), [null, null, null]);
  } finally {
    await sql`delete from jobs where link in ${sql(links)}`;
    await sql.end();
  }
});
