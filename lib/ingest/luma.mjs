// Luma hackathons in London. Two places are read, so a change to one doesn't
// empty the source:
//   - Luma's event search (the API its own pages call), searched for hackathons
//     in the London place. This finds most of them.
//   - The public luma.com/london page, whose event list is embedded as JSON
//     (__NEXT_DATA__), plus any JSON-LD Events.
// Luma's category pages (/ai, /tech) used to be read too; since October 2026
// they load their events in the browser, so their HTML has none.
import { cleanText, hasType, jsonLd, nextData } from "./html.mjs";
import { regionFor, toISODate } from "./normalise.mjs";

export const name = "luma";

const ORIGIN = "https://luma.com";
const API = "https://api.luma.com"; // robots.txt allows everything but /insights/
const PAGES = [`${ORIGIN}/london`];
// London's place id, from the luma.com/london page data.
const LONDON = "discplace-QCcNk3HXowOR97j";
const SEARCHES = ["hackathon", "hack", "buildathon"];
const PAGE_SIZE = 50;
const MAX_PAGES = 4; // per search
const HACKATHON = /\b(hack(athon|day|night)?s?|buildathon|game ?jam|codefest)\b/i;

const HACKATHON_TYPE = "hackathon";
const HACKATHON_DOMAIN = "Hackathon";

/** @param {import("./run.mjs").SourceContext} ctx */
export async function fetchJobs(ctx) {
  const events = new Map(); // link -> job
  const add = (jobs) => {
    for (const job of jobs) if (!events.has(job.link)) events.set(job.link, job);
  };
  let read = 0;
  for (const query of SEARCHES) {
    let cursor = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const url = new URL("/discover/get-paginated-events", API);
      url.searchParams.set("discover_place_api_id", LONDON);
      url.searchParams.set("query", query);
      url.searchParams.set("pagination_limit", String(PAGE_SIZE));
      if (cursor) url.searchParams.set("pagination_cursor", cursor);
      let data;
      try {
        data = JSON.parse(await ctx.fetchText(url.toString(), { accept: "application/json" }));
        read++;
      } catch (err) {
        ctx.warn(`search "${query}": ${err.message}`);
        break;
      }
      add(parseSearch(data));
      cursor = data?.has_more && typeof data.next_cursor === "string" ? data.next_cursor : null;
      if (!cursor) break;
    }
  }
  for (const page of PAGES) {
    try {
      add(parsePage(await ctx.fetchText(page)));
      read++;
    } catch (err) {
      ctx.warn(`${page}: ${err.message}`);
    }
  }
  if (!read) throw new Error("neither Luma's search nor its London page could be read");
  return [...events.values()];
}

/** Hackathons in one response from Luma's event search. @param {unknown} data */
export function parseSearch(data) {
  return hackathonsIn(data);
}

/** Hackathons on one Luma page. @param {string} html */
export function parsePage(html) {
  const jobs = hackathonsIn(nextData(html));
  for (const node of jsonLd(html)) if (hasType(node, "Event")) jobs.push(fromJsonLdEvent(node));
  return jobs.filter((job) => job && HACKATHON.test(job.role));
}

// Luma event objects anywhere in `data`, as jobs; hackathons only.
function hackathonsIn(data) {
  const jobs = [];
  if (data) walk(data, null, (event, wrapper) => jobs.push(fromLumaEvent(event, wrapper)), 0);
  return jobs.filter((job) => job && HACKATHON.test(job.role));
}

function isLumaEvent(node) {
  return (
    typeof node.api_id === "string" &&
    node.api_id.startsWith("evt-") &&
    typeof node.name === "string" &&
    typeof node.start_at === "string" &&
    typeof node.url === "string"
  );
}

// Finds event objects anywhere in the page data. Luma usually wraps them as
// { event, calendar, hosts }, which is where the organiser's name lives.
function walk(node, parent, visit, depth) {
  if (!node || typeof node !== "object" || depth > 40) return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, parent, visit, depth + 1);
    return;
  }
  if (isLumaEvent(node)) {
    visit(node, parent?.event === node ? parent : null);
    return;
  }
  for (const child of Object.values(node)) walk(child, node, visit, depth + 1);
}

// Luma serves the same event on lu.ma and luma.com; keep one form for dedupe.
function eventLink(raw) {
  try {
    const url = new URL(raw, `${ORIGIN}/`);
    if (/^(www\.)?(lu\.ma|luma\.com)$/i.test(url.host)) url.host = "luma.com";
    return url.toString();
  } catch {
    return null;
  }
}

function fromLumaEvent(event, wrapper) {
  const link = eventLink(event.url);
  if (!link) return null;
  const geo = event.geo_address_info ?? {};
  const location =
    cleanText(geo.city_state) || cleanText(geo.city) || (event.location_type === "online" ? "Online" : null);
  // A personal calendar is just called "Personal"; the host's name says more.
  const calendar = cleanText(wrapper?.calendar?.name);
  const organiser = (calendar && calendar !== "Personal" ? calendar : null) ?? wrapper?.hosts?.[0]?.name ?? calendar ?? "";
  return {
    company: cleanText(organiser) || "Luma",
    role: cleanText(event.name),
    type: HACKATHON_TYPE,
    domain: HACKATHON_DOMAIN,
    location,
    region: regionFor(location) ?? regionFor(cleanText(geo.country)),
    // Hackathons have no application deadline on the page; the start date is
    // the last day to sign up.
    deadline: toISODate(event.start_at, event.timezone || "UTC"),
    source: "Luma",
    link,
  };
}

function fromJsonLdEvent(node) {
  const link = typeof node.url === "string" ? eventLink(node.url) : null;
  if (!link || typeof node.name !== "string") return null;
  const place = [node.location].flat()[0];
  const address = place?.address ?? {};
  const online = /OnlineEventAttendanceMode/i.test(String(node.eventAttendanceMode ?? ""));
  const location =
    cleanText(address.addressLocality) || cleanText(place?.name) || (online ? "Online" : null);
  const organiser = [node.organizer].flat()[0]?.name;
  return {
    company: cleanText(organiser) || "Luma",
    role: cleanText(node.name),
    type: HACKATHON_TYPE,
    domain: HACKATHON_DOMAIN,
    location,
    region: regionFor(location) ?? regionFor(cleanText(address.addressCountry?.name ?? address.addressCountry)),
    deadline: toISODate(node.startDate),
    source: "Luma",
    link,
  };
}
