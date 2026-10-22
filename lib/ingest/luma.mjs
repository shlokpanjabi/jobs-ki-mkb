// Luma hackathons, read from public Luma discovery pages. Luma pages embed
// their event list as JSON (__NEXT_DATA__) and some also carry JSON-LD Events;
// both are read so a change to one doesn't empty the source.
import { cleanText, hasType, jsonLd, nextData } from "./html.mjs";
import { regionFor, toISODate } from "./normalise.mjs";

export const name = "luma";

const ORIGIN = "https://luma.com";
const PAGES = [`${ORIGIN}/london`, `${ORIGIN}/ai`, `${ORIGIN}/tech`];
const HACKATHON = /\b(hack(athon|day|night)?s?|buildathon|game ?jam|codefest)\b/i;

// The jobs table only allows internship / part-time / fellowship, and adding a
// "hackathon" type would be a schema change. Hackathons are stored as
// fellowships with domain "Hackathon", so they can be filtered on the board.
const HACKATHON_TYPE = "fellowship";
const HACKATHON_DOMAIN = "Hackathon";

/** @param {import("./run.mjs").SourceContext} ctx */
export async function fetchJobs(ctx) {
  const events = new Map(); // link -> job
  let pagesRead = 0;
  for (const page of PAGES) {
    let html;
    try {
      html = await ctx.fetchText(page);
      pagesRead++;
    } catch (err) {
      ctx.warn(`${page}: ${err.message}`);
      continue;
    }
    for (const job of parsePage(html)) if (!events.has(job.link)) events.set(job.link, job);
  }
  if (!pagesRead) throw new Error(`none of the ${PAGES.length} Luma pages could be read`);
  return [...events.values()];
}

/** Hackathons on one Luma page. @param {string} html */
export function parsePage(html) {
  const jobs = [];
  const data = nextData(html);
  if (data) walk(data, null, (event, wrapper) => jobs.push(fromLumaEvent(event, wrapper)), 0);
  for (const node of jsonLd(html)) if (hasType(node, "Event")) jobs.push(fromJsonLdEvent(node));
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
  const organiser = wrapper?.calendar?.name ?? wrapper?.hosts?.[0]?.name ?? "";
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
