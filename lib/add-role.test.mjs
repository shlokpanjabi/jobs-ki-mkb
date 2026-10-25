// "Add role" on the site (addRoleByHand in lib/jobs.ts). Run with `npm test`;
// needs TEST_DATABASE_URL (a scratch database with `npm run db:migrate`
// applied) and is skipped otherwise.
import assert from "node:assert/strict";
import { register } from "node:module";
import { test } from "node:test";

test("add role: validates like the API, adds to every board, dedupes by link", { skip: !process.env.TEST_DATABASE_URL }, async () => {
  register("./ts-test-hooks.mjs", import.meta.url);
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL; // lib/db.ts reads it
  const { addRoleByHand, getUsers, HAND_SOURCE } = await import("./jobs.ts");
  const sql = globalThis.sql ?? (await import("./db.ts")).db();
  const users = await getUsers();
  const names = users.map((u) => u.name);
  assert.ok(users.length >= 2, "needs the seeded users");
  const [first, ...rest] = users;
  const stamp = Date.now();
  const link = `https://jobs.test/add-role-${stamp}`;
  const partial = `https://jobs.test/add-role-partial-${stamp}`;
  const acme = `Quillfern ${stamp}`; // unique names: other tests run alongside and match by company
  const beta = `Vantorel ${stamp}`;
  const row = async (l, user) =>
    (await sql`select j.company, j.role, j.source, j.region, j.link, uj.status, uj.eligible, uj.added_by_hand
               from jobs j join user_jobs uj on uj.job_id = j.id and uj.user_id = ${user} where j.link = ${l}`)[0];
  try {
    // Same field rules as POST /api/jobs.
    const bad = await addRoleByHand({ company: "", role: "Intern", type: "job", link: "ftp://x", deadline: "30/11/2026" });
    assert.equal(bad.ok, false);
    assert.deepEqual(bad.errors.sort(), [
      "company is required", "deadline must be a date like 2026-11-30", "link must be an http(s) URL",
      "type must be one of: internship, part-time, fellowship, hackathon",
    ]);
    assert.equal((await sql`select 1 from jobs where link = 'ftp://x'`).length, 0); // nothing written

    // New role: on every board, To do, labelled as added on the site, region from the location.
    const added = await addRoleByHand({
      company: acme, role: "Product Intern", type: "internship", link: `${link}?utm_source=x`, location: "Manchester",
      source: "LinkedIn post", deadline: "2026-11-30",
    });
    assert.deepEqual([added.ok, added.outcome, added.addedFor, added.alreadyOn], [true, "added", names, []]);
    for (const u of users) {
      assert.deepEqual(await row(link, u.id), {
        company: acme, role: "Product Intern", source: `LinkedIn post (${HAND_SOURCE.toLowerCase()})`,
        region: "UK (outside London)", link, status: "todo", eligible: true, added_by_hand: true,
      });
    }
    assert.equal((await sql`select count(*)::int as n from jobs where link = ${link}`)[0].n, 1);

    // Same link again: every board has it, so it's reported and nothing changes (status and details kept).
    await sql`update user_jobs set status = 'applied' from jobs where jobs.id = job_id and link = ${link} and user_id = ${first.id}`;
    const again = await addRoleByHand({ company: "Renamed Co", role: "Other role", type: "fellowship", link });
    assert.deepEqual([again.ok, again.outcome, again.jobId, again.addedFor], [true, "exists", added.jobId, []]);
    const kept = await row(link, first.id);
    assert.deepEqual([kept.company, kept.role, kept.status], [acme, "Product Intern", "applied"]);
    assert.equal((await sql`select count(*)::int as n from jobs where link = ${link}`)[0].n, 1);

    // A link already on one board: attached to the others (To do), that board left as it was.
    const [{ id: jobId }] = await sql`insert into jobs (company, role, type, link, dedupe_key)
      values (${beta}, 'Data Intern', 'internship', ${partial}, ${`vantorel|data intern|${stamp}`}) returning id`;
    await sql`insert into user_jobs (job_id, user_id, eligible, status) values (${jobId}, ${first.id}, true, 'offer')`;
    const attached = await addRoleByHand({ company: beta, role: "Data Intern", type: "internship", link: partial });
    assert.deepEqual([attached.outcome, attached.jobId, attached.addedFor, attached.alreadyOn],
      ["attached", jobId, rest.map((u) => u.name), [first.name]]);
    assert.deepEqual([(await row(partial, first.id)).status, (await row(partial, first.id)).added_by_hand], ["offer", false]);
    for (const u of rest) {
      assert.deepEqual([(await row(partial, u.id)).status, (await row(partial, u.id)).added_by_hand], ["todo", true]);
    }
  } finally {
    await sql`delete from jobs where link in (${link}, ${partial})`;
    await sql.end();
  }
});
