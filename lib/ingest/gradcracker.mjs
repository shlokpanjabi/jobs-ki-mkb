// Gradcracker (UK STEM internships and placements). There's no RSS feed, so
// this reads the public search pages for job links, then each job page's
// JSON-LD JobPosting (falling back to the page heading and URL slugs).
import { cleanText, hasType, jsonLd, links } from "./html.mjs";
import { regionFor, toISODate } from "./normalise.mjs";

export const name = "gradcracker";

const ORIGIN = "https://www.gradcracker.com";
const SEARCHES = [
  { path: "/search/all-disciplines/engineering-work-placements-internships", domain: null },
  { path: "/search/computing-technology/computer-science-work-placements-internships", domain: "Software" },
];
const PAGES_PER_SEARCH = 2;
const MAX_JOB_PAGES = 40; // one request each, so this bounds the run time
// /hub/<company id>/<company slug>/<opportunity type>/<job id>/<job slug>
const JOB_PATH = /^\/hub\/\d+\/([a-z0-9-]+)\/[a-z0-9-]+\/\d+\/([a-z0-9-]+)$/i;

/** @param {import("./run.mjs").SourceContext} ctx */
export async function fetchJobs(ctx) {
  const found = new Map(); // job URL -> search domain
  for (const search of SEARCHES) {
    for (let page = 1; page <= PAGES_PER_SEARCH; page++) {
      const url = `${ORIGIN}${search.path}${page > 1 ? `?page=${page}` : ""}`;
      let html;
      try {
        html = await ctx.fetchText(url);
      } catch (err) {
        // The very first page failing means the source is down or blocked.
        if (!found.size && search === SEARCHES[0] && page === 1) throw err;
        ctx.warn(`${url}: ${err.message}`);
        break;
      }
      const before = found.size;
      for (const href of links(html, ORIGIN)) {
        const u = new URL(href);
        if (u.origin === ORIGIN && JOB_PATH.test(u.pathname) && !found.has(`${ORIGIN}${u.pathname}`)) {
          found.set(`${ORIGIN}${u.pathname}`, search.domain);
        }
      }
      if (found.size === before) break; // no new results: past the last page
    }
  }
  if (!found.size) throw new Error("no job links found on the search pages (layout change?)");

  const jobs = [];
  for (const [link, domain] of [...found].slice(0, MAX_JOB_PAGES)) {
    try {
      jobs.push(parseJobPage(await ctx.fetchText(link), link, domain));
    } catch (err) {
      ctx.warn(`${link}: ${err.message}`);
    }
  }
  return jobs;
}

/**
 * @param {string} html
 * @param {string} link
 * @param {string | null} domain
 */
export function parseJobPage(html, link, domain) {
  const posting = jsonLd(html).find((n) => hasType(n, "JobPosting"));
  const [, companySlug, roleSlug] = JOB_PATH.exec(new URL(link).pathname) ?? [];

  const company =
    cleanText(posting?.hiringOrganization?.name) || cleanText(posting?.hiringOrganization) || unslug(companySlug);
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1];
  const role = cleanText(posting?.title) || cleanText(h1) || unslug(roleSlug);

  const place = [posting?.jobLocation].flat()[0]?.address;
  const location =
    [place?.addressLocality, place?.addressRegion].map(cleanText).filter(Boolean).join(", ") ||
    cleanText(typeof place === "string" ? place : "") ||
    null;

  const deadlineText = /deadline[^0-9a-z]{0,40}([0-9]{1,2}(?:st|nd|rd|th)?\s+[a-z]{3,9}\.?\s+\d{4})/i.exec(
    cleanText(html),
  )?.[1];
  const deadline = toISODate(posting?.validThrough) ?? toISODate(deadlineText);

  return {
    company,
    role,
    type: "internship", // placements and internships only, see SEARCHES
    domain,
    location,
    region: regionFor(location) ?? regionFor(cleanText(place?.addressCountry)) ?? regionFor("UK"),
    deadline,
    source: "Gradcracker",
    link,
  };
}

function unslug(slug) {
  if (!slug) return "";
  return slug
    .split("-")
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}
