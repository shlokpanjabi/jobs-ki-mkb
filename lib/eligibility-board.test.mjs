// Eligibility on the board (lib/jobs.ts): only for ELIGIBILITY_USERS, set by
// hand per person. Run with `npm test`; needs TEST_DATABASE_URL (a scratch
// database with `npm run db:migrate` applied) and is skipped otherwise.
import assert from "node:assert/strict";
import { register } from "node:module";
import { test } from "node:test";

test("eligibility board: only on shlok's board, set by hand, others untouched", { skip: !process.env.TEST_DATABASE_URL }, async () => {
  register("./ts-test-hooks.mjs", import.meta.url);
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL; // lib/db.ts reads it
  const { getBoardRows, setEligibility } = await import("./jobs.ts");
  const sql = (await import("./db.ts")).db();
  const link = `https://jobs.test/elig-board-${Date.now()}`;
  const stored = async (user) =>
    ({ ...(await sql`select eligibility, eligibility_note, eligibility_source from user_jobs uj
                     join jobs j on j.id = uj.job_id where j.link = ${link} and uj.user_id = ${user}`)[0] });
  try {
    const [{ id }] = await sql`insert into jobs (company, role, type, link) values ('Acme', 'Analyst', 'internship', ${link}) returning id`;
    // added_by_hand: shown whatever each person's home filter says.
    await sql`insert into user_jobs (job_id, user_id, eligible, added_by_hand, eligibility, eligibility_note, eligibility_source)
              values (${id}, 'shlok', true, true, 'worth_a_shot', 'Graduating 2028.', 'auto'),
                     (${id}, 'taran', true, true, null, null, null)`;
    const mine = async (user) => (await getBoardRows(user)).find((r) => r.id === id);

    assert.deepEqual((await mine("shlok")).eligibility, { verdict: "worth_a_shot", note: "Graduating 2028.", manual: false });
    assert.equal("eligibility" in (await mine("taran")), false); // other boards don't carry it at all

    // Set by hand: kept with the employer's words; "unknown" is a choice too.
    assert.equal(await setEligibility("shlok", id, "eligible"), true);
    assert.deepEqual((await mine("shlok")).eligibility, { verdict: "eligible", note: "Graduating 2028.", manual: true });
    assert.equal(await setEligibility("shlok", id, null), true);
    assert.deepEqual(await stored("shlok"), { eligibility: null, eligibility_note: "Graduating 2028.", eligibility_source: "manual" });

    // Not for other people, and their rows don't change.
    assert.equal(await setEligibility("taran", id, "eligible"), false);
    assert.deepEqual(await stored("taran"), { eligibility: null, eligibility_note: null, eligibility_source: null });
  } finally {
    await sql`delete from jobs where link = ${link}`;
    await sql.end();
  }
});
