// "Add role" on the site (addRoleByHand in lib/jobs.ts). Run with `npm test`;
// needs TEST_DATABASE_URL (a scratch database with `npm run db:migrate`
// applied) and is skipped otherwise.
import assert from "node:assert/strict";
import { register } from "node:module";
import { test } from "node:test";

test("add role: validates like the API, writes only to that board, dedupes by link", { skip: !process.env.TEST_DATABASE_URL }, async () => {
  register("./ts-test-hooks.mjs", import.meta.url);
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL; // lib/db.ts reads it
  const { addRoleByHand, HAND_SOURCE } = await import("./jobs.ts");
  const sql = globalThis.sql ?? (await import("./db.ts")).db();
  const stamp = Date.now();
  const link = `https://jobs.test/add-role-${stamp}`;
  const other = `https://jobs.test/add-role-other-${stamp}`;
  const row = async (l, user) =>
    (await sql`select j.company, j.role, j.source, j.region, j.link, uj.status, uj.eligible, uj.added_by_hand
               from jobs j join user_jobs uj on uj.job_id = j.id and uj.user_id = ${user} where j.link = ${l}`)[0];
  try {
    // Same field rules as POST /api/jobs.
    const bad = await addRoleByHand("shlok", { company: "", role: "Intern", type: "job", link: "ftp://x", deadline: "30/11/2026" });
    assert.equal(bad.ok, false);
    assert.deepEqual(bad.errors.sort(), [
      "company is required", "deadline must be a date like 2026-11-30", "link must be an http(s) URL",
      "type must be one of: internship, part-time, fellowship, hackathon",
    ]);
    assert.deepEqual(await addRoleByHand("nobody", { company: "A", role: "B", type: "internship", link }), { ok: false, errors: ["Pick who you are first."] });
    assert.equal((await sql`select 1 from jobs where link = ${link}`).length, 0); // nothing written

    // New role: on this board only, To do, labelled as added on the site, region from the location.
    const added = await addRoleByHand("shlok", {
      company: "Acme", role: "Product Intern", type: "internship", link: `${link}?utm_source=x`, location: "Manchester",
      source: "LinkedIn post", deadline: "2026-11-30",
    });
    assert.equal(added.ok && added.outcome, "added");
    assert.deepEqual(await row(link, "shlok"), {
      company: "Acme", role: "Product Intern", source: `LinkedIn post (${HAND_SOURCE.toLowerCase()})`, region: "UK (outside London)",
      link, status: "todo", eligible: true, added_by_hand: true,
    });
    assert.equal(await row(link, "taran"), undefined); // nobody else's board
    assert.equal((await addRoleByHand("shlok", { company: "B", role: "C", type: "internship", link: other })).ok, true);
    assert.equal((await row(other, "shlok")).source, HAND_SOURCE);

    // Same link again on the same board: reported, nothing changed (status and details kept).
    await sql`update user_jobs set status = 'applied' from jobs where jobs.id = job_id and link = ${link} and user_id = 'shlok'`;
    const again = await addRoleByHand("shlok", { company: "Renamed Co", role: "Other role", type: "fellowship", link });
    assert.deepEqual([again.ok, again.outcome, again.jobId], [true, "exists", added.jobId]);
    const kept = await row(link, "shlok");
    assert.deepEqual([kept.company, kept.role, kept.status], ["Acme", "Product Intern", "applied"]);
    assert.equal((await sql`select count(*)::int as n from jobs where link = ${link}`)[0].n, 1);

    // The same link for someone who doesn't have it yet: attached to their board, To do.
    const attached = await addRoleByHand("taran", { company: "Acme", role: "Product Intern", type: "internship", link });
    assert.deepEqual([attached.outcome, attached.jobId], ["attached", added.jobId]);
    assert.deepEqual([(await row(link, "taran")).status, (await row(link, "taran")).added_by_hand], ["todo", true]);
    assert.equal((await row(link, "shlok")).status, "applied"); // shlok's status untouched
  } finally {
    await sql`delete from jobs where link in (${link}, ${other})`;
    await sql.end();
  }
});
