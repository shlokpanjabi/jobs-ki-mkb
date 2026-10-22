// Run with `npm test`. Inputs here are small synthetic pages, not captures of
// the real sites: they pin down the parsing and pipeline logic, not the sites'
// current markup.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { fromJobCard, fromRssItem } from "./indeed.mjs";
import { parseJobPage } from "./gradcracker.mjs";
import { jsonAfter, jsonLd, links, rssItems } from "./html.mjs";
import { createFetcher } from "./http.mjs";
import { parsePage } from "./luma.mjs";
import { guessDomain, normaliseJob, regionFor, toISODate } from "./normalise.mjs";
import { isAllowed, parseRobots } from "./robots.mjs";
import { formatSummary, runIngest, selectSources } from "./run.mjs";

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
    null,
  );
  assert.deepEqual(
    [withLd.company, withLd.role, withLd.location, withLd.region, withLd.deadline, withLd.type],
    ["Acme Engineering Ltd", "Mechanical Placement", "Derby", "Europe", "2026-12-01", "internship"],
  );
  const bare = parseJobPage("<p>Deadline: 15th January 2027</p>", link, "Software");
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

test("selectSources: by name, all by default, unknown names rejected", () => {
  assert.deepEqual(selectSources("").map((s) => s.name), ["gradcracker", "indeed-uk", "luma"]);
  assert.deepEqual(selectSources("luma, gradcracker").map((s) => s.name), ["gradcracker", "luma"]);
  assert.throws(() => selectSources("linkedin"), /Unknown source/);
});

const job = (n, extra = {}) => ({ company: `Co ${n}`, role: "Intern", type: "internship", link: `https://jobs.test/${n}`, ...extra });
const noFetch = { fetchText: async () => assert.fail("sources here don't fetch") };

// A stand-in for /api/jobs: 201 for new links, 200 for known ones, 400 for "bad".
async function withFakeApi(fn, { validKeys = ["k1", "k2"] } = {}) {
  const known = new Set(["https://jobs.test/existing"]);
  const requests = [];
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const key = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1];
    requests.push({ key, job: JSON.parse(body) });
    const reply = (status, data) => res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(data));
    if (!validKeys.includes(key)) return reply(401, { error: "Unauthorized" });
    const { link, role } = JSON.parse(body);
    if (role === "bad") return reply(400, { error: "Invalid job", details: ["role is bad"] });
    const created = !known.has(link);
    known.add(link);
    reply(created ? 201 : 200, { created });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`, requests);
  } finally {
    server.close();
  }
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
  await withFakeApi(async (baseUrl, requests) => {
    const lines = [];
    const summary = await runIngest({ sources, baseUrl, apiKeys: ["k1"], fetcher: noFetch, log: (l) => lines.push(l), today: TODAY });
    const counts = Object.fromEntries(summary.sources.map((s) => [s.source, [s.found, s.new, s.skipped, s.failed, s.error]]));
    assert.deepEqual(counts, {
      a: [5, 2, 3, 0, null], // 1, 2 new; duplicate 1, invalid row, existing link skipped
      broken: [0, 0, 0, 0, "HTTP 403 from https://broken.test/"],
      b: [4, 1, 2, 2, null], // 5 new; 2 seen in "a", 4 expired; 3 rejected by API + one warning
    });
    assert.equal(summary.ok, false);
    assert.equal(requests.length, 5);
    assert.ok(requests.every((r) => r.key === "k1"));
    assert.ok(lines.some((l) => l.includes("[broken] failed")));
    assert.match(formatSummary(summary), /broken\s+0\s+0\s+0\s+0\s+ERROR: HTTP 403/);
  });
});

test("run: every key gets each job; a rejected key aborts the run", async () => {
  const sources = [{ name: "a", fetchJobs: async () => [job(1), job(2)] }];
  await withFakeApi(async (baseUrl, requests) => {
    const summary = await runIngest({ sources, baseUrl, apiKeys: ["k1", "k2"], fetcher: noFetch, log: () => {}, today: TODAY });
    assert.deepEqual([summary.ok, summary.sources[0].new], [true, 2]);
    assert.deepEqual(requests.map((r) => r.key).sort(), ["k1", "k1", "k2", "k2"]);
  });
  await withFakeApi(async (baseUrl) => {
    const summary = await runIngest({ sources, baseUrl, apiKeys: ["wrong"], fetcher: noFetch, log: () => {}, today: TODAY });
    assert.match(summary.fatal, /401/);
    assert.deepEqual([summary.ok, summary.sources[0].failed], [false, 2]);
  });
});

test("run: dry run posts nothing and needs no key", async () => {
  const lines = [];
  const summary = await runIngest({
    sources: [{ name: "a", fetchJobs: async () => [job(1), job(1)] }],
    dryRun: true,
    fetcher: noFetch,
    fetchImpl: async () => assert.fail("dry run must not POST"),
    log: (l) => lines.push(l),
    today: TODAY,
  });
  assert.deepEqual([summary.ok, summary.sources[0].new, summary.sources[0].skipped, summary.jobs.length], [true, 1, 1, 1]);
  assert.ok(lines.some((l) => l.includes("Co 1 | Intern | internship")));
  await assert.rejects(runIngest({ sources: [], log: () => {} }), /INGEST_BASE_URL/);
});
