// Shared crawler for job boards whose job pages carry a schema.org JobPosting
// (most do, for Google Jobs). It reads the board's public search pages for job
// links, then each job page's JSON-LD, falling back to the page heading.
import { cleanText, hasType, jsonLd, links } from "./html.mjs";
import { regionFor, toISODate } from "./normalise.mjs";

/**
 * @typedef {{ path: string, domain?: string | null, type?: string }} Search
 * @typedef {{
 *   name: string, source: string, origin: string, searches: Search[],
 *   jobPath: RegExp, pageUrl?: (search: Search, page: number) => string,
 *   pagesPerSearch?: number, maxJobPages?: number, defaultRegion?: string | null,
 *   fallback?: (url: URL) => { company?: string, role?: string },
 * }} BoardConfig
 */

/** @param {BoardConfig} config */
export function jobBoard(config) {
  const {
    origin,
    searches,
    jobPath,
    pagesPerSearch = 2,
    maxJobPages = 40, // one request each, so this bounds the run time
    pageUrl = (search, page) => `${origin}${search.path}${page > 1 ? `${search.path.includes("?") ? "&" : "?"}page=${page}` : ""}`,
  } = config;

  /** @param {import("./run.mjs").SourceContext} ctx */
  async function fetchJobs(ctx) {
    const found = new Map(); // job URL -> the search it came from
    let pagesRead = 0;
    for (const search of searches) {
      for (let page = 1; page <= pagesPerSearch; page++) {
        const url = pageUrl(search, page);
        let html;
        try {
          html = await ctx.fetchText(url);
          pagesRead++;
        } catch (err) {
          ctx.warn(`${url}: ${err.message}`);
          break;
        }
        const before = found.size;
        for (const href of links(html, origin)) {
          const u = new URL(href);
          const key = `${u.origin}${u.pathname}`;
          if (u.origin === origin && jobPath.test(u.pathname) && !found.has(key)) found.set(key, search);
        }
        if (found.size === before) break; // no new results: past the last page
      }
    }
    if (!pagesRead) throw new Error("none of the search pages could be read");
    if (!found.size) throw new Error("no job links found on the search pages (layout change?)");

    const jobs = [];
    for (const [link, search] of [...found].slice(0, maxJobPages)) {
      try {
        jobs.push(parseJobPage(await ctx.fetchText(link), link, search));
      } catch (err) {
        ctx.warn(`${link}: ${err.message}`);
      }
    }
    return jobs;
  }

  /**
   * @param {string} html
   * @param {string} link
   * @param {Search} [search]
   */
  function parseJobPage(html, link, search = { path: "" }) {
    const posting = jsonLd(html).find((n) => hasType(n, "JobPosting"));
    const fallback = config.fallback?.(new URL(link)) ?? {};
    const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1];

    const company =
      cleanText(posting?.hiringOrganization?.name) || cleanText(posting?.hiringOrganization) || fallback.company || "";
    const role = cleanText(posting?.title) || cleanText(h1) || fallback.role || "";

    const place = [posting?.jobLocation].flat()[0]?.address;
    const remote = /TELECOMMUTE/i.test(String(posting?.jobLocationType ?? ""));
    const location =
      [place?.addressLocality, place?.addressRegion].map(cleanText).filter(Boolean).join(", ") ||
      cleanText(typeof place === "string" ? place : "") ||
      (remote ? "Remote" : null);
    const country = cleanText(place?.addressCountry?.name ?? place?.addressCountry);

    const deadlineText = /(?:deadline|apply by|closing date)[^0-9a-z]{0,40}([0-9]{1,2}(?:st|nd|rd|th)?\s+[a-z]{3,9}\.?,?\s+\d{4})/i.exec(
      cleanText(html),
    )?.[1];

    return {
      company,
      role,
      type: search.type ?? typeFromPosting(posting) ?? "internship",
      domain: search.domain ?? null,
      location,
      region: regionFor(location) ?? regionFor(country) ?? config.defaultRegion ?? null,
      deadline: toISODate(posting?.validThrough) ?? toISODate(deadlineText),
      source: config.source,
      link,
      details: [posting?.description, posting?.qualifications, posting?.educationRequirements?.credentialCategory ?? posting?.educationRequirements]
        .map((v) => cleanText(typeof v === "string" ? v : ""))
        .join(" "),
    };
  }

  return { name: config.name, fetchJobs, parseJobPage };
}

function typeFromPosting(posting) {
  const kinds = [posting?.employmentType].flat().map((k) => String(k ?? "").toUpperCase());
  if (kinds.includes("INTERN")) return "internship";
  if (kinds.includes("PART_TIME")) return "part-time";
  return null;
}

/** "acme-engineering" -> "Acme Engineering" */
export function unslug(slug) {
  if (!slug) return "";
  return slug
    .split("-")
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}
