// Run with `npm test`. Inputs here are small synthetic pages, not captures of
// the real sites: they pin down the parsing and pipeline logic, not the sites'
// current markup.
import assert from "node:assert/strict";
import { test } from "node:test";
import { fromJobCard, fromRssItem } from "./indeed.mjs";
import { parseJobPage } from "./gradcracker.mjs";
import { jsonAfter, jsonLd, links, markdownTables, parseCsv, rssItems } from "./html.mjs";
import { createFetcher } from "./http.mjs";
import { parsePage } from "./luma.mjs";
import { guessDomain, joinLocations, normaliseJob, regionFor, toISODate } from "./normalise.mjs";
import { parseReadme } from "./northwestern.mjs";
import { csvUrl, fromCsv } from "./sheets.mjs";
import { fromListing } from "./simplify.mjs";
import { parseList } from "./speedyapply.mjs";
import { audienceFor, parseProfiles, requirements, studyStage } from "./profiles.mjs";
import { isAllowed, parseRobots } from "./robots.mjs";
import postgres from "postgres";
import { formatSummary, runIngest, selectSources } from "./run.mjs";
import { createStore, resolveUsers } from "./store.mjs";

const TODAY = "2026-10-22";

test("robots: our group beats *, longest rule wins, Allow wins ties", () => {
  const policy = parseRobots(
    [
      "User-agent: *",
      "Disallow: /",
      "",
      "User-agent: applytrackerbot",
      "User-agent: otherbot",
      "Disallow: /jobs",
      "Allow: /jobs/public",
      "Disallow: /*.pdf$",
      "Allow: /tie",
      "Disallow: /tie",
      "Crawl-delay: 5",
    ].join("\n"),
    "ApplyTrackerBot",
  );
  assert.equal(policy.crawlDelay, 5);
  assert.equal(isAllowed(policy, "/"), true);
  assert.equal(isAllowed(policy, "/jobs?q=x"), false);
  assert.equal(isAllowed(policy, "/jobs/public/1"), true);
  assert.equal(isAllowed(policy, "/files/a.pdf"), false);
  assert.equal(isAllowed(policy, "/files/a.pdf?x"), true);
  assert.equal(isAllowed(policy, "/tie"), true);

  const generic = parseRobots("User-agent: *\nDisallow: /search\n", "ApplyTrackerBot");
  assert.equal(isAllowed(generic, "/search/x"), false);
  assert.equal(isAllowed(generic, "/hub/1"), true);
  assert.equal(isAllowed(parseRobots("", "ApplyTrackerBot"), "/anything"), true);
});

function fakeFetch(routes) {
  const calls = [];
  const impl = async (url) => {
    const u = new URL(url);
    calls.push({ path: u.pathname + u.search, at: Date.now() });
    const route = routes[u.pathname];
    if (!route) return new Response("not found", { status: 404 });
    return typeof route === "number" ? new Response("", { status: route }) : new Response(route);
  };
  return { impl, calls };
}

test("fetcher: honours robots.txt and spaces requests per host", async () => {
  const { impl, calls } = fakeFetch({ "/robots.txt": "User-agent: *\nDisallow: /private\n", "/a": "A", "/b": "B" });
  const { fetchText } = createFetcher({ fetchImpl: impl, minIntervalMs: 80 });
  assert.equal(await fetchText("https://site.test/a"), "A");
  assert.equal(await fetchText("https://site.test/b"), "B");
  await assert.rejects(fetchText("https://site.test/private/x"), /blocked by robots\.txt/);
  await assert.rejects(fetchText("https://site.test/missing"), /HTTP 404/);
  assert.deepEqual(calls.map((c) => c.path), ["/robots.txt", "/a", "/b", "/missing"]);
  for (let i = 1; i < calls.length; i++) assert.ok(calls[i].at - calls[i - 1].at >= 75, "requests too close");
});

test("fetcher: missing robots.txt allows, forbidden or failing robots.txt blocks", async () => {
  const missing = createFetcher({ fetchImpl: fakeFetch({ "/a": "A" }).impl, minIntervalMs: 0 });
  assert.equal(await missing.fetchText("https://one.test/a"), "A");
  const forbidden = createFetcher({ fetchImpl: fakeFetch({ "/robots.txt": 403, "/a": "A" }).impl, minIntervalMs: 0 });
  await assert.rejects(forbidden.fetchText("https://two.test/a"), /robots\.txt returned HTTP 403/);
  const down = createFetcher({ fetchImpl: fakeFetch({ "/robots.txt": 500, "/a": "A" }).impl, minIntervalMs: 0 });
  await assert.rejects(down.fetchText("https://three.test/a"), /robots\.txt returned HTTP 500/);
  const offline = createFetcher({ fetchImpl: async () => { throw new Error("ENOTFOUND"); }, minIntervalMs: 0 });
  await assert.rejects(offline.fetchText("https://four.test/a"), /robots\.txt unreachable \(ENOTFOUND\)/);
});

test("normalise: dates, regions, domains", () => {
  assert.equal(toISODate("2026-11-30"), "2026-11-30");
  assert.equal(toISODate("30th November 2026"), "2026-11-30");
  assert.equal(toISODate("Deadline: 1 Dec 2026"), "2026-12-01");
  assert.equal(toISODate("November 30, 2026"), "2026-11-30");
  assert.equal(toISODate("2026-11-30T23:30:00Z", "Europe/London"), "2026-11-30");
  assert.equal(toISODate("2026-11-30T23:30:00Z", "Asia/Kolkata"), "2026-12-01");
  assert.equal(toISODate("31 February 2026"), null);
  assert.equal(toISODate("Ongoing"), null);

  assert.equal(regionFor("London"), "Europe");
  assert.equal(regionFor("Remote"), "Remote");
  assert.equal(regionFor("Berlin, Germany"), "Europe");
  assert.equal(regionFor("San Francisco, United States"), "US");
  assert.equal(regionFor("Somewhere"), null);
  assert.equal(regionFor("New York, NY"), "US");
  assert.equal(regionFor("Milwaukee, WI"), "US");
  assert.equal(regionFor("Cambridge, MA"), "US");
  assert.equal(regionFor("Cambridge, UK"), "Europe");
  assert.equal(regionFor("Jupiter, Florida"), "US");
  assert.equal(regionFor("London, ON, Canada"), "Canada");
  assert.equal(regionFor("Sydney, New South Wales"), "Australia");
  assert.equal(regionFor("Bengaluru"), "India");
  assert.deepEqual(joinLocations(["London, UK", "Paris, France"]), { location: "London, UK; Paris, France", region: "Europe" });
  assert.deepEqual(joinLocations(["NYC", "London, UK", "SF", "Austin, TX"]), { location: "NYC; London, UK; SF +1", region: "US" });

  assert.equal(guessDomain("Data Engineering Intern"), "Data");
  assert.equal(guessDomain("Software Developer Placement"), "Software");
  assert.equal(guessDomain("Summer Investment Banking Analyst"), "Finance");
  assert.equal(guessDomain("Barista"), null);
});

test("normalise: required fields, link canonicalisation, expired deadlines", () => {
  const base = { company: " Acme  &amp; Co ", role: "SWE Intern", type: "internship", link: "https://x.test/j/1/?utm_source=a#top" };
  const { job } = normaliseJob({ ...base, location: "Leeds" }, TODAY);
  assert.equal(job.company, "Acme & Co");
  assert.equal(job.link, "https://x.test/j/1");
  assert.equal(job.region, "Europe");
  assert.equal(job.domain, "Software");
  assert.equal(job.deadline, null);

  assert.match(normaliseJob({ ...base, deadline: "2026-10-21" }, TODAY).skip, /deadline passed/);
  assert.equal(normaliseJob({ ...base, deadline: TODAY }, TODAY).job.deadline, TODAY);
  assert.match(normaliseJob({ ...base, type: "full-time" }, TODAY).skip, /unknown type/);
  assert.match(normaliseJob({ ...base, link: "javascript:alert(1)" }, TODAY).skip, /link/);
  assert.match(normaliseJob({ ...base, company: "" }, TODAY).skip, /company/);
});

test("html helpers: JSON-LD, embedded JSON, RSS", () => {
  const html = `<script type="application/ld+json">{"@graph":[{"@type":"JobPosting","title":"A"}]}</script>
    <script type="application/ld+json">not json</script>
    <script>window.data = {"a":"}{","b":{"c":[1,2]}};</script>`;
  assert.deepEqual(jsonLd(html).find((n) => n["@type"] === "JobPosting"), { "@type": "JobPosting", title: "A" });
  assert.deepEqual(jsonAfter(html, "window.data"), { a: "}{", b: { c: [1, 2] } });
  assert.equal(jsonAfter(html, "window.missing"), null);
  assert.deepEqual(links(`<a href="/hub/1/a/b/2/c#apply">x</a> <a href='https://o.test/p?a=1&amp;b=2'>`, "https://s.test"), [
    "https://s.test/hub/1/a/b/2/c",
    "https://o.test/p?a=1&b=2",
  ]);

  const items = rssItems(`<rss><channel><item><title><![CDATA[Intern - Acme - London]]></title>
    <link>https://uk.indeed.com/viewjob?jk=abc&amp;from=rss</link></item></channel></rss>`);
  assert.deepEqual(items, [{ title: "Intern - Acme - London", link: "https://uk.indeed.com/viewjob?jk=abc&from=rss" }]);
});

test("indeed: RSS items and job cards map to canonical viewjob links", () => {
  const rss = fromRssItem({ title: "Marketing Intern - Summer - Acme Ltd - Manchester", link: "https://uk.indeed.com/rc/clk?jk=a1b2&from=rss" }, "internship");
  assert.deepEqual(
    [rss.company, rss.role, rss.location, rss.link],
    ["Acme Ltd", "Marketing Intern - Summer", "Manchester", "https://uk.indeed.com/viewjob?jk=a1b2"],
  );
  assert.equal(fromRssItem({ title: "x", link: "https://uk.indeed.com/jobs" }, "internship"), null);

  const card = fromJobCard({ jobkey: "ff00", displayTitle: "Student Tutor", company: "Tutors &amp; Co", formattedLocation: "Remote" }, "part-time");
  assert.deepEqual([card.company, card.role, card.link], ["Tutors & Co", "Student Tutor", "https://uk.indeed.com/viewjob?jk=ff00"]);
});

test("gradcracker: JSON-LD first, URL slugs as fallback", () => {
  const link = "https://www.gradcracker.com/hub/123/acme-engineering/work-placement-internship/456/mechanical-placement-2027";
  const withLd = parseJobPage(
    `<script type="application/ld+json">{"@type":"JobPosting","title":"Mechanical Placement","validThrough":"2026-12-01T23:59:00Z",
      "hiringOrganization":{"name":"Acme Engineering Ltd"},"jobLocation":{"address":{"addressLocality":"Derby"}}}</script>`,
    link,
  );
  assert.deepEqual(
    [withLd.company, withLd.role, withLd.location, withLd.region, withLd.deadline, withLd.type],
    ["Acme Engineering Ltd", "Mechanical Placement", "Derby", "Europe", "2026-12-01", "internship"],
  );
  const bare = parseJobPage("<p>Deadline: 15th January 2027</p>", link, { path: "", type: "internship", domain: "Software" });
  assert.deepEqual(
    [bare.company, bare.role, bare.deadline, bare.domain],
    ["Acme Engineering", "Mechanical Placement 2027", "2027-01-15", "Software"],
  );
});

test("luma: finds hackathons in page data and JSON-LD, ignores other events", () => {
  const data = {
    props: {
      pageProps: {
        initialData: {
          events: [
            {
              event: { api_id: "evt-1", name: "London AI Hackathon", start_at: "2026-11-14T23:30:00Z", timezone: "Asia/Kolkata",
                url: "ai-hack", geo_address_info: { city_state: "London, England", country: "United Kingdom" } },
              calendar: { name: "AI Builders" },
            },
            { event: { api_id: "evt-2", name: "Founder Breakfast", start_at: "2026-11-15T08:00:00Z", url: "brekkie" } },
          ],
        },
      },
    },
  };
  const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script>
    <script type="application/ld+json">{"@type":"Event","name":"Climate Hack Day","url":"https://lu.ma/climate",
      "startDate":"2026-12-05T10:00:00Z","location":{"address":{"addressLocality":"Bristol"}},"organizer":{"name":"Green Devs"}}</script>`;
  const jobs = parsePage(html);
  assert.equal(jobs.length, 2);
  assert.deepEqual(
    [jobs[0].company, jobs[0].role, jobs[0].link, jobs[0].deadline, jobs[0].region, jobs[0].type, jobs[0].domain],
    ["AI Builders", "London AI Hackathon", "https://luma.com/ai-hack", "2026-11-15", "Europe", "fellowship", "Hackathon"],
  );
  assert.deepEqual([jobs[1].company, jobs[1].link, jobs[1].location], ["Green Devs", "https://luma.com/climate", "Bristol"]);
});

test("markdown tables and CSV", () => {
  const tables = markdownTables("## Quant :chart:\n\n| Company | Age |\n|---|---|\n| <b>A</b> | 1d |\n| B | 2d |\n\nafter\n|x|\n");
  assert.deepEqual(tables, [{ heading: "Quant", rows: [{ company: "<b>A</b>", age: "1d" }, { company: "B", age: "2d" }] }]);
  assert.deepEqual(parseCsv('﻿Company,Role\r\n"Acme, Inc","Intern ""SWE"""\n\n"Multi\nline",x\n'), [
    { company: "Acme, Inc", role: 'Intern "SWE"' },
    { company: "Multi\nline", role: "x" },
  ]);
});

// Row shapes below are copied from the live lists (October 2026), trimmed.
test("simplify: active listing to job, term appended, category to domain", () => {
  const job = fromListing({
    company_name: "JP Morgan Chase", title: "Quantitative Research Summer Analyst", active: true, terms: ["Summer 2027"],
    category: "Quant", locations: ["London, UK"], url: "https://jpmc.fa.oraclecloud.com/job/21079", date_posted: 1792633186,
  });
  assert.deepEqual(
    [job.company, job.role, job.domain, job.location, job.region, job.link],
    ["JP Morgan Chase", "Quantitative Research Summer Analyst (Summer 2027)", "Finance", "London, UK", "Europe", "https://jpmc.fa.oraclecloud.com/job/21079"],
  );
  assert.equal(fromListing({ title: "SWE Intern - Summer 2027", terms: ["Summer 2027"], locations: [] }).role, "SWE Intern - Summer 2027");
});

test("speedyapply: tables to jobs, quant section, old rows dropped", () => {
  const md = [
    "### FAANG+",
    "| Company | Position | Location | Salary | Posting | Age |",
    "|---|---|---|---|---|---|",
    '| <a href="https://netflix.com/"><strong>Netflix</strong></a> | Software Engineer Intern - Summer 2027 | Los Gatos, CA | $63/hr | <a href="https://netflix.wd108.myworkdayjobs.com/job/JR42989"><img alt="Apply"/></a> | 2d |',
    '| <a href="https://x.com"><strong>Old Co</strong></a> | Intern | Remote | $1/hr | <a href="https://x.com/j"><img/></a> | 4mo |',
    "### Quant",
    "| Company | Position | Location | Posting | Age |",
    "|---|---|---|---|---|",
    '| <a href="https://q.com"><strong>Jane Street</strong></a> | Trading Intern | London, United Kingdom | <a href="https://q.com/apply"><img/></a> | 5d |',
  ].join("\n");
  const jobs = parseList(md, "Software");
  assert.deepEqual(
    jobs.map((j) => [j.company, j.role, j.domain, j.region, j.link]),
    [
      ["Netflix", "Software Engineer Intern - Summer 2027", "Software", "US", "https://netflix.wd108.myworkdayjobs.com/job/JR42989"],
      ["Jane Street", "Trading Intern", "Finance", "Europe", "https://q.com/apply"],
    ],
  );
});

test("northwestern: open links per role, closed ones skipped", () => {
  const md = [
    "## Akuna Capital",
    "**Website**: [Akuna Capital](https://akunacapital.com/careers)",
    "",
    "**Locations**: Chicago",
    "",
    "|Role|Links|",
    "|-------|-------|",
    "|QR|[✅ ](https://akuna.test/qr)|",
    "|SWE|[✅ C++](https://akuna.test/cpp)&nbsp;&nbsp;[🔒 Python](https://akuna.test/py)|",
    "|QR Fellowship|[✅ ](https://akuna.test/fellow)|",
  ].join("\n");
  assert.deepEqual(
    parseReadme(md).map((j) => [j.company, j.role, j.type, j.location, j.region, j.link]),
    [
      ["Akuna Capital", "Quant Researcher Intern", "internship", "Chicago", "US", "https://akuna.test/qr"],
      ["Akuna Capital", "Software Engineer Intern (C++)", "internship", "Chicago", "US", "https://akuna.test/cpp"],
      ["Akuna Capital", "Quant Researcher Fellowship", "fellowship", "Chicago", "US", "https://akuna.test/fellow"],
    ],
  );
});

test("sheets: header aliases, guessed type, UK dates, Google Sheets URLs", () => {
  const jobs = fromCsv("Employer,Job Title,Apply Link,Closing Date,City\nAcme,Policy Fellowship,https://a.test/1,30/11/2026,Leeds\nBeta,Barista (part time),https://b.test/2,,\n");
  assert.deepEqual(
    jobs.map((j) => [j.company, j.role, j.type, j.deadline, j.location, j.link]),
    [
      ["Acme", "Policy Fellowship", "fellowship", "2026-11-30", "Leeds", "https://a.test/1"],
      ["Beta", "Barista (part time)", "part-time", null, null, "https://b.test/2"],
    ],
  );
  assert.equal(
    csvUrl("https://docs.google.com/spreadsheets/d/abc_123/edit#gid=42"),
    "https://docs.google.com/spreadsheets/d/abc_123/export?format=csv&gid=42",
  );
  assert.equal(csvUrl("https://example.test/jobs.csv"), "https://example.test/jobs.csv");
});

// Made-up people, not the real users' details.
const PROFILES = parseProfiles(JSON.stringify({
  ana: { started: 2025, courseYears: 3, grade: 67, hideRegions: ["Pakistan"] }, // 2nd of 3: penultimate
  ben: { started: 2025, courseYears: 4, grade: "lower 2:1", hideRegions: ["Pakistan"] }, // 2nd of 4
  cal: { started: 2025, courseYears: 3, grade: "lower 2:1", hideRegions: ["India"] },
}));
const PEOPLE = ["ana", "ben", "cal", "dee"]; // dee has no profile: sees everything
const who = (role, extra = {}, details = {}) =>
  audienceFor({ role, region: null, ...extra }, { text: "", degrees: [], ...details }, PEOPLE, PROFILES, TODAY);

test("profiles: parsing, year of study moves on each September", () => {
  assert.deepEqual(PROFILES.ben, { started: 2025, courseYears: 4, grade: 60, hideRegions: ["Pakistan"] });
  assert.deepEqual(studyStage(PROFILES.ana, "2026-10-22"), { year: 2, gradYear: 2028, final: false });
  assert.deepEqual(studyStage(PROFILES.ana, "2027-09-01"), { year: 3, gradYear: 2028, final: true });
  assert.deepEqual(studyStage(PROFILES.ben, "2027-08-31"), { year: 2, gradYear: 2029, final: false });
  assert.throws(() => parseProfiles("{"), /not valid JSON/);
  assert.throws(() => parseProfiles('{"x":{"started":2025}}'), /courseYears/);
  assert.throws(() => parseProfiles('{"x":{"started":2025,"courseYears":3,"grade":"great"}}'), /grade/);
  assert.deepEqual(parseProfiles(""), {});
});

test("audience: regions", () => {
  assert.deepEqual(who("Analyst Intern", { region: "India" }), ["ana", "ben", "dee"]);
  assert.deepEqual(who("Analyst Intern", { region: "Pakistan" }), ["cal", "dee"]);
  assert.deepEqual(who("Analyst Intern", { region: "Europe" }), PEOPLE);
});

test("audience: year of study, spring weeks, terms after graduation", () => {
  assert.deepEqual(who("Penultimate Year Summer Internship 2027"), ["ana", "cal", "dee"]);
  assert.deepEqual(who("Spring Week 2027"), ["ben", "dee"]);
  assert.deepEqual(who("Markets Internship", {}, { text: "Open to first-year students only." }), ["dee"]);
  assert.deepEqual(who("Markets Internship", {}, { text: "Open to second year students." }), PEOPLE);
  assert.deepEqual(who("Markets Internship", {}, { text: "In your first year with us you will rotate." }), PEOPLE);
  assert.deepEqual(who("Final Year Placement", {}, { text: "for final year students" }), ["dee"]);
  assert.deepEqual(who("SWE Intern (Summer 2028)"), ["ben", "dee"]); // ana and cal graduate June 2028
  assert.deepEqual(who("SWE Intern (Spring 2028)"), PEOPLE);
  assert.deepEqual(who("SWE Intern (Summer 2026)"), []); // that summer is over
  assert.deepEqual(who("SWE Intern (Summer 2026, Fall 2027)"), PEOPLE);
  assert.deepEqual(who("Intern", {}, { text: "Candidates graduating in 2029 or later." }), ["ben", "dee"]);
});

test("audience: grades and degrees", () => {
  assert.deepEqual(who("Analyst Intern", {}, { text: "You will have a 2:1 or above." }), PEOPLE);
  assert.deepEqual(who("Analyst Intern", {}, { text: "Predicted high 2:1 (65%+)." }), ["ana", "dee"]);
  assert.deepEqual(who("Analyst Intern", {}, { text: "Minimum average of 68%." }), ["dee"]);
  assert.deepEqual(who("Analyst Intern", {}, { text: "First class degree expected." }), ["dee"]);
  assert.deepEqual(who("Analyst Intern", {}, { text: "100% remote, 20% travel." }), PEOPLE);
  assert.deepEqual(who("PhD Research Intern"), []);
  assert.deepEqual(who("ML Intern", {}, { degrees: ["Master's", "PhD"] }), []);
  assert.deepEqual(who("ML Intern", {}, { degrees: ["Bachelor's", "Master's"] }), PEOPLE);
  assert.equal(requirements({ role: "Intern" }, { text: "2.1 required" }).minGrade, 60);
});

test("selectSources: by name, all by default, unknown names rejected", () => {
  assert.equal(selectSources("").length, 10);
  assert.deepEqual(selectSources("luma, gradcracker").map((s) => s.name), ["gradcracker", "luma"]);
  assert.throws(() => selectSources("linkedin"), /Unknown source/);
});

const job = (n, extra = {}) => ({ company: `Co ${n}`, role: "Intern", type: "internship", link: `https://jobs.test/${n}`, ...extra });
const noFetch = { fetchText: async () => assert.fail("sources here don't fetch") };

// A stand-in for the database: "existing" is already stored, role "bad" throws.
function fakeStore() {
  const known = new Set(["https://jobs.test/existing"]);
  const saved = [];
  const save = async (j) => {
    if (j.role === "bad") throw new Error("check constraint violated");
    saved.push(j);
    const created = !known.has(j.link);
    known.add(j.link);
    return { created };
  };
  return { save, saved };
}

test("run: a failing source doesn't stop the others; counts per source", async () => {
  const sources = [
    { name: "a", fetchJobs: async () => [job(1), job(2), job(1), { company: "", role: "x" }, job("existing")] },
    { name: "broken", fetchJobs: async () => { throw new Error("HTTP 403 from https://broken.test/"); } },
    {
      name: "b",
      fetchJobs: async (ctx) => {
        ctx.warn("detail page timed out");
        return [job(2), job(3, { role: "bad" }), job(4, { deadline: "2020-01-01" }), job(5)];
      },
    },
  ];
  const { save, saved } = fakeStore();
  const lines = [];
  const summary = await runIngest({ sources, save, fetcher: noFetch, log: (l) => lines.push(l), today: TODAY });
  const counts = Object.fromEntries(summary.sources.map((s) => [s.source, [s.found, s.new, s.skipped, s.failed, s.error]]));
  assert.deepEqual(counts, {
    a: [5, 2, 3, 0, null], // 1, 2 new; duplicate 1, invalid row, existing link skipped
    broken: [0, 0, 0, 0, "HTTP 403 from https://broken.test/"],
    b: [4, 1, 2, 2, null], // 5 new; 2 seen in "a", 4 expired; 3 failed to save + one warning
  });
  assert.equal(summary.ok, false);
  assert.deepEqual(saved.map((j) => j.link).sort(), ["https://jobs.test/1", "https://jobs.test/2", "https://jobs.test/5", "https://jobs.test/existing"]);
  assert.ok(lines.some((l) => l.includes("[broken] failed")));
  assert.match(formatSummary(summary), /broken\s+0\s+0\s+0\s+0\s+ERROR: HTTP 403/);
});

test("run: stops saving after repeated failures", async () => {
  const jobs = Array.from({ length: 20 }, (_, i) => job(i));
  const summary = await runIngest({
    sources: [{ name: "a", fetchJobs: async () => jobs }],
    save: async () => { throw new Error("ECONNREFUSED"); },
    fetcher: noFetch,
    log: () => {},
    today: TODAY,
  });
  assert.match(summary.fatal, /failed in a row, last: ECONNREFUSED/);
  assert.deepEqual([summary.ok, summary.sources[0].failed, summary.sources[0].new], [false, 20, 0]);
});

test("run: dry run saves nothing", async () => {
  const lines = [];
  const summary = await runIngest({
    sources: [{ name: "a", fetchJobs: async () => [job(1), job(1)] }],
    dryRun: true,
    fetcher: noFetch,
    log: (l) => lines.push(l),
    today: TODAY,
  });
  assert.deepEqual([summary.ok, summary.sources[0].new, summary.sources[0].skipped, summary.jobs.length], [true, 1, 1, 1]);
  assert.ok(lines.some((l) => l.includes("Co 1 | Intern | internship")));
  await assert.rejects(runIngest({ sources: [], log: () => {} }), /save function/);
});

// Needs a scratch database with db/schema.sql applied, e.g.
// TEST_DATABASE_URL=postgres://localhost/tracker_test npm test. Skipped otherwise.
test("store: upserts by link and applies each job's audience", { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const sql = postgres(process.env.TEST_DATABASE_URL, { max: 1, onnotice() {} });
  const stamp = Date.now();
  const link = `https://jobs.test/store-${stamp}`;
  const nobody = `https://jobs.test/nobody-${stamp}`;
  try {
    assert.deepEqual(await resolveUsers(sql, ""), ["muzzamil", "shlok", "taran"]);
    assert.deepEqual(await resolveUsers(sql, "Shlok, taran"), ["shlok", "taran"]);
    await assert.rejects(resolveUsers(sql, "nobody"), /unknown user/);

    const save = createStore(sql, ["muzzamil", "shlok", "taran"]);
    const base = { company: "Acme", role: "Intern", type: "internship", domain: "Software", location: "Leeds",
      region: "Europe", deadline: "2026-12-01", source: "Test", link };
    const eligibleNow = async () =>
      (await sql`select uj.user_id from user_jobs uj join jobs j on j.id = uj.job_id
                 where j.link = ${link} and uj.eligible order by 1`).map((r) => r.user_id);

    assert.deepEqual(await save(base), { created: true }); // null audience = everyone
    assert.deepEqual(await eligibleNow(), ["muzzamil", "shlok", "taran"]);
    await sql`update user_jobs set status = 'applied' from jobs where jobs.id = job_id and link = ${link} and user_id = 'shlok'`;

    // Stricter audience later: taran keeps it, muzzamil loses it, shlok applied so keeps it.
    assert.deepEqual(await save({ ...base, role: "Summer Intern", domain: null }, ["taran"]), { created: false });
    assert.deepEqual(await eligibleNow(), ["shlok", "taran"]);
    const [row] = await sql`select id, role, domain from jobs where link = ${link}`;
    assert.deepEqual([row.role, row.domain], ["Summer Intern", "Software"]); // missing domain kept
    const statuses = await sql`select user_id, status from user_jobs where job_id = ${row.id} and eligible order by user_id`;
    assert.deepEqual(statuses.map((r) => [r.user_id, r.status]), [["shlok", "applied"], ["taran", "todo"]]);

    // Nobody eligible and not stored yet: not inserted at all.
    assert.deepEqual(await save({ ...base, link: nobody }, []), { created: false });
    assert.equal((await sql`select 1 from jobs where link = ${nobody}`).length, 0);
  } finally {
    await sql`delete from jobs where link in (${link}, ${nobody})`;
    await sql.end();
  }
});
