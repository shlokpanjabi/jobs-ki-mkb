// Run with `npm test`. The database test needs TEST_DATABASE_URL (a scratch
// database with db/schema.sql applied); it's skipped otherwise.
import assert from "node:assert/strict";
import { test } from "node:test";
import postgres from "postgres";
import { ensureAppSchema } from "./app-schema.mjs";
import { dedupeKey, stripLocation } from "./dedupe.mjs";
import { normaliseJob } from "./ingest/normalise.mjs";

test("dedupe: same company and role match across punctuation, case and location suffixes", () => {
  const same = [
    ["Jane Street", "Software Engineer Intern"],
    ["Jane Street", "Software Engineer Intern (New York, NY)"],
    ["Jane Street", "Software Engineer Intern - London, UK"],
    ["JANE STREET", "Software-Engineer Intern | Remote"],
    ["Jane Street LLC", "Software Engineer Intern, Austin, TX"],
    ["Jane Street", "Software Engineer Intern in Manchester"],
  ];
  const keys = new Set(same.map(([c, r]) => dedupeKey(c, r)));
  assert.deepEqual([...keys], ["jane street|software engineer intern"]);

  // Not locations, so kept: they can be different jobs.
  assert.equal(stripLocation("Engineer - Embedded Systems"), "Engineer - Embedded Systems");
  assert.equal(stripLocation("Research Intern (Summer 2027)"), "Research Intern (Summer 2027)");
  assert.notEqual(dedupeKey("Acme", "Data Analyst"), dedupeKey("Acme", "Data Scientist"));
  assert.equal(dedupeKey("Société Générale", "Stagiaire – Paris"), "societe generale|stagiaire");
});

test("normalise: anything that mentions a hackathon is typed hackathon", () => {
  const base = { company: "Co", link: "https://a.test/1", type: "fellowship" };
  assert.equal(normaliseJob({ ...base, role: "London AI Hackathon" }, "2026-10-22").job.type, "hackathon");
  assert.equal(normaliseJob({ ...base, role: "Build day", domain: "Hackathon" }, "2026-10-22").job.type, "hackathon");
  assert.equal(normaliseJob({ ...base, role: "Policy Fellow" }, "2026-10-22").job.type, "fellowship");
});

test("app schema: home filter columns, hackathon type and re-tag, dedupe backfill", { skip: !process.env.TEST_DATABASE_URL }, async () => {
  // max > 1 like the app's pool: a raw "begin" would be refused here.
  const sql = postgres(process.env.TEST_DATABASE_URL, { max: 3, onnotice() {} });
  const stamp = Date.now();
  const links = [`https://jobs.test/hack-${stamp}`, `https://jobs.test/dup-a-${stamp}`, `https://jobs.test/dup-b-${stamp}`];
  try {
    await ensureAppSchema(sql);
    // Rows as an older version saved them: hackathon as fellowship, no dedupe key.
    await sql`insert into jobs (company, role, type, domain, link) values
      ('AI Builders', 'Spring Hackathon', 'fellowship', 'Hackathon', ${links[0]}),
      ('Acme Ltd', 'SWE Intern - London', 'internship', null, ${links[1]}),
      ('Acme', 'SWE Intern (Remote)', 'internship', null, ${links[2]})`;

    // A fresh pool runs the migration again, like a new serverless instance.
    const again = postgres(process.env.TEST_DATABASE_URL, { max: 3, onnotice() {} });
    try {
      await ensureAppSchema(again);
    } finally {
      await again.end();
    }

    const rows = await sql`select link, type, dedupe_key from jobs where link in ${sql(links)} order by link`;
    const byLink = Object.fromEntries(rows.map((r) => [r.link, r]));
    assert.equal(byLink[links[0]].type, "hackathon");
    assert.equal(byLink[links[1]].dedupe_key, "acme|swe intern");
    assert.equal(byLink[links[2]].dedupe_key, "acme|swe intern");

    const [user] = await sql`select home_regions, home_types from users where id = 'shlok'`;
    assert.deepEqual([user.home_regions, user.home_types], [["uk", "europe", "remote"], null]);
  } finally {
    await sql`delete from jobs where link in ${sql(links)}`;
    await sql.end();
  }
});
