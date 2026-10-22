// Indeed UK. Tries the public RSS feed first, then the search results page's
// embedded job-card JSON. Both go through the robots.txt check, and Indeed
// often refuses automated clients; when it does, this source fails on its own
// and the others still run.
import { cleanText, jsonAfter, rssItems } from "./html.mjs";

export const name = "indeed-uk";

const ORIGIN = "https://uk.indeed.com";
const SEARCHES = [
  { q: "intern", jt: "internship", type: "internship" },
  { q: "student", jt: "parttime", type: "part-time" },
];
const LOCATION = "United Kingdom";
const MAX_AGE_DAYS = 7;
const PAGES_PER_SEARCH = 2;
const PAGE_SIZE = 10; // Indeed's `start` offset step

/** @param {import("./run.mjs").SourceContext} ctx */
export async function fetchJobs(ctx) {
  const jobs = [];
  const errors = [];
  for (const search of SEARCHES) {
    try {
      jobs.push(...(await searchRss(ctx, search)));
    } catch (rssErr) {
      try {
        jobs.push(...(await searchHtml(ctx, search)));
      } catch (htmlErr) {
        errors.push(`"${search.q}": rss: ${rssErr.message}; html: ${htmlErr.message}`);
      }
    }
  }
  if (!jobs.length && errors.length) throw new Error(errors.join(" | "));
  for (const e of errors) ctx.warn(e);
  return jobs;
}

function searchUrl(path, search, page) {
  const params = new URLSearchParams({
    q: search.q,
    l: LOCATION,
    jt: search.jt,
    fromage: String(MAX_AGE_DAYS),
    sort: "date",
  });
  if (page > 0) params.set("start", String(page * PAGE_SIZE));
  return `${ORIGIN}${path}?${params}`;
}

async function searchRss(ctx, search) {
  const jobs = [];
  for (let page = 0; page < PAGES_PER_SEARCH; page++) {
    const xml = await ctx.fetchText(searchUrl("/rss", search, page), {
      accept: "application/rss+xml,application/xml,text/xml",
    });
    if (!/<rss[\s>]/i.test(xml)) throw new Error("response is not an RSS feed");
    const items = rssItems(xml);
    for (const item of items) {
      const job = fromRssItem(item, search.type);
      if (job) jobs.push(job);
    }
    if (items.length < PAGE_SIZE) break;
  }
  return jobs;
}

// RSS titles look like "Role - Company - Location".
export function fromRssItem(item, type) {
  const link = viewJobLink(item.link) ?? viewJobLink(item.guid);
  if (!link) return null;
  const parts = cleanText(item.title).split(" - ");
  const location = parts.length >= 3 ? parts.pop() : null;
  const titleCompany = parts.length >= 2 ? parts.pop() : "";
  return {
    company: cleanText(item.source) || titleCompany,
    role: parts.join(" - "),
    type,
    domain: null,
    location,
    region: null,
    deadline: null, // Indeed doesn't publish closing dates
    source: "Indeed",
    link,
  };
}

async function searchHtml(ctx, search) {
  const jobs = [];
  for (let page = 0; page < PAGES_PER_SEARCH; page++) {
    const html = await ctx.fetchText(searchUrl("/jobs", search, page));
    const cards = jsonAfter(html, 'window.mosaic.providerData["mosaic-provider-jobcards"]');
    const results = cards?.metaData?.mosaicProviderJobCardsModel?.results;
    if (!Array.isArray(results)) throw new Error("no job cards on the results page (blocked or layout change?)");
    for (const result of results) {
      const job = fromJobCard(result, search.type);
      if (job) jobs.push(job);
    }
    if (results.length < PAGE_SIZE) break;
  }
  return jobs;
}

export function fromJobCard(card, type) {
  const link = typeof card?.jobkey === "string" ? viewJobLink(`${ORIGIN}/viewjob?jk=${card.jobkey}`) : null;
  if (!link) return null;
  return {
    company: cleanText(card.company),
    role: cleanText(card.displayTitle) || cleanText(card.title),
    type,
    domain: null,
    location: cleanText(card.formattedLocation) || null,
    region: null,
    deadline: null,
    source: "Indeed",
    link,
  };
}

// Canonical posting URL (https://uk.indeed.com/viewjob?jk=<key>) so the same
// job dedupes regardless of the tracking params Indeed adds.
function viewJobLink(raw) {
  if (typeof raw !== "string") return null;
  try {
    const url = new URL(raw, ORIGIN);
    const jk = url.searchParams.get("jk");
    return jk && /^[a-z0-9]+$/i.test(jk) ? `${ORIGIN}/viewjob?jk=${jk}` : null;
  } catch {
    return null;
  }
}
