// Eligibility on the board (getBoardRows in lib/jobs.ts): worked out from the
// role title for people in ELIGIBILITY_COURSES only, and never saved. Run with
// `npm test`; needs TEST_DATABASE_URL (a scratch database with `npm run
// db:migrate` applied) and is skipped otherwise.
import assert from "node:assert/strict";
import { register } from "node:module";
import { test } from "node:test";

test("eligibility board: on shlok's board only, from the title, nothing written", { skip: !process.env.TEST_DATABASE_URL }, async () => {
  register("./ts-test-hooks.mjs", import.meta.url);
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL; // lib/db.ts reads it
  const { getBoardRows } = await import("./jobs.ts");
  const sql = (await import("./db.ts")).db();
  const stamp = Date.now();
  const roles = { penult: "Summer Analyst 2027 - Penultimate Year", second: "Data Intern (second year students)", plain: "ML Intern" };
  const links = Object.keys(roles).map((k) => `https://jobs.test/elig-${k}-${stamp}`);
  try {
    const ids = {};
    for (const [i, [key, role]] of Object.entries(roles).entries()) {
      const [{ id }] = await sql`insert into jobs (company, role, type, link) values ('Acme', ${role}, 'internship', ${links[i]}) returning id`;
      // added_by_hand: shown whatever each person's home filter says.
      await sql`insert into user_jobs (job_id, user_id, eligible, added_by_hand) values (${id}, 'shlok', true, true), (${id}, 'taran', true, true)`;
      ids[key] = id;
    }
    const snapshot = () => sql`select * from user_jobs where job_id in ${sql(Object.values(ids))} order by job_id, user_id`;
    const before = await snapshot();

    const shlok = await getBoardRows("shlok");
    const verdict = (key) => shlok.find((r) => r.id === ids[key]).eligibility;
    assert.deepEqual(verdict("penult"), { verdict: "worth_a_shot", note: roles.penult });
    assert.deepEqual(verdict("second"), { verdict: "eligible", note: roles.second });
    assert.deepEqual(verdict("plain"), { verdict: null, note: null }); // nothing stated: unknown

    const taran = (await getBoardRows("taran")).filter((r) => Object.values(ids).includes(r.id));
    assert.equal(taran.length, 3);
    assert.ok(taran.every((r) => !("eligibility" in r))); // other boards don't carry it at all

    assert.deepEqual(await snapshot(), before); // reading the board writes nothing
  } finally {
    await sql`delete from jobs where link in ${sql(links)}`;
    await sql.end();
  }
});
