// Turns what a source scraped into the exact shape POST /api/jobs accepts.
// The API re-validates everything; this just avoids sending junk and keeps
// fields consistent across sources.
import { normalizeLink } from "../links.mjs";
import { cleanText } from "./html.mjs";

// Mirrors JOB_TYPES in lib/types.ts (that file is TypeScript, scripts are not).
const JOB_TYPES = ["internship", "part-time", "fellowship", "hackathon"];
const HACKATHON = /hackathon/i; // same test as the re-tagging in lib/app-schema.mjs
const MAX_FIELD = 300; // the API rejects longer text fields

// UK jobs are split into London and the rest of the UK, so each is its own
// option in the board's region filter.
export const LONDON = "London";
export const UK_REGION = "UK (outside London)";

/**
 * @typedef {{ company: string, role: string, type: string, domain: string | null,
 *   location: string | null, region: string | null, deadline: string | null,
 *   source: string | null, link: string }} Job
 */

/**
 * Besides the job, returns `details` (description text and degree list) that
 * profiles.mjs uses to decide who sees it; details aren't stored.
 * @param {Record<string, unknown>} raw
 * @param {string} today YYYY-MM-DD
 * @returns {{ job: Job, details: { text: string, degrees: string[] } } | { skip: string }}
 */
export function normaliseJob(raw, today) {
  const text = (v) => {
    const s = cleanText(v);
    return s ? s.slice(0, MAX_FIELD) : null;
  };
  const company = text(raw.company);
  const role = text(raw.role);
  if (!company || !role) return { skip: "missing company or role" };

  const given = typeof raw.type === "string" ? raw.type : "";
  if (!JOB_TYPES.includes(given)) return { skip: `unknown type "${given}"` };
  // Whatever the source called it, a hackathon is a hackathon.
  const type = HACKATHON.test(role) || HACKATHON.test(String(raw.domain ?? "")) ? "hackathon" : given;

  const link = typeof raw.link === "string" ? normalizeLink(raw.link) : null;
  if (!link || link.length > 2048) return { skip: "missing or invalid link" };

  const deadline = typeof raw.deadline === "string" && isISODate(raw.deadline) ? raw.deadline : null;
  if (deadline && deadline < today) return { skip: "deadline passed" };

  const location = text(raw.location);
  return {
    job: {
      company,
      role,
      type,
      domain: text(raw.domain) ?? guessDomain(role) ?? guessDomain(company),
      location,
      region: text(raw.region) ?? regionFor(location),
      deadline,
      source: text(raw.source),
      link,
    },
    details: {
      text: cleanText(raw.details).slice(0, 5000),
      degrees: Array.isArray(raw.degrees) ? raw.degrees.map(String) : [],
    },
  };
}

/** Today in APP_TIMEZONE, matching lib/dates.ts. */
export function todayISO() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: process.env.APP_TIMEZONE || "UTC" }).format(new Date());
}

function isISODate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * Best-effort date parser for what job sites print: ISO dates/timestamps,
 * "30 November 2026", "30th Nov 2026", "November 30, 2026". A timestamp is
 * converted to its calendar date in `timeZone` (default UTC).
 * @param {unknown} value
 * @param {string} [timeZone]
 * @returns {string | null} YYYY-MM-DD
 */
export function toISODate(value, timeZone = "UTC") {
  if (typeof value !== "string") return null;
  const s = value.trim();

  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return null;
    try {
      return new Intl.DateTimeFormat("en-CA", { timeZone }).format(d);
    } catch {
      return d.toISOString().slice(0, 10);
    }
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return isISODate(s) ? s : null;

  const dayFirst = /(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})\.?,?\s+(\d{4})/i.exec(s);
  const monthFirst = /([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/i.exec(s);
  const [day, month, year] = dayFirst
    ? [dayFirst[1], dayFirst[2], dayFirst[3]]
    : monthFirst
      ? [monthFirst[2], monthFirst[1], monthFirst[3]]
      : [];
  const m = month ? MONTHS.indexOf(month.slice(0, 3).toLowerCase()) : -1;
  if (m === -1) return null;
  const iso = `${year}-${String(m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return isISODate(iso) ? iso : null;
}

const US_STATES =
  /,\s*(AL|AK|AZ|AR|CA|CO|CT|DE|DC|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\b/;
const CA_PROVINCES = /,\s*(ON|BC|QC|AB|MB|NS|NB|SK|NL|PE)\b/;
// Checked in order: explicit countries and US/Canadian state codes before city
// names, so "New York" and "Cambridge, MA" aren't read as UK places.
const REGION_RULES = [
  ["Remote", /\b(remote|online|virtual|anywhere)\b/i],
  ["Canada", /\bcanada\b/i],
  ["Canada", CA_PROVINCES],
  ["US", /\b(united states|usa|u\.s\.a?\.|new york|nyc|sf|south sf|silicon valley|bay area|san francisco|los angeles|chicago|seattle|austin|miami|houston|dallas|philadelphia|denver|atlanta)\b/i],
  ["US", US_STATES],
  ["US", /^(la|us)$/i],
  ["US", /\b(alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming)\b/i],
  ["Australia", /\b(australia|sydney|melbourne|new south wales|new zealand)\b/i],
  // Before the UK rule, so "London, UK" is London. (London, ON is caught by Canada above.)
  [LONDON, /\b(london|canary wharf|croydon|westminster|shoreditch|hammersmith|wimbledon|uxbridge)\b/i],
  [UK_REGION, /\b(uk|u\.k\.|united kingdom|great britain|england|scotland|wales|northern ireland)\b/i],
  ["Europe", /\b(europe|ireland|france|germany|spain|portugal|italy|netherlands|belgium|switzerland|austria|sweden|norway|denmark|finland|poland|czechia|czech republic|greece|hungary|romania|estonia|latvia|lithuania|luxembourg|serbia|croatia|slovakia|slovenia|bulgaria|ukraine|belarus|armenia|cyprus|malta|iceland)\b/i],
  ["Pakistan", /\b(pakistan|karachi|lahore|islamabad|rawalpindi|faisalabad|peshawar|multan)\b/i],
  ["India", /\b(india|bengaluru|bangalore|mumbai|delhi|new delhi|hyderabad|pune|chennai|gurgaon|gurugram|noida|kolkata|ahmedabad)\b/i],
  ["Asia", /\b(singapore|china|shanghai|beijing|shenzhen|hong kong|taiwan|taipei|japan|tokyo|korea|seoul|malaysia|kuala lumpur|philippines|manila|vietnam|indonesia|jakarta|thailand|bangkok)\b/i],
  [UK_REGION, /\b(manchester|birmingham|bristol|leeds|glasgow|edinburgh|cambridge|oxford|liverpool|sheffield|nottingham|newcastle|cardiff|belfast|reading|southampton|leicester|coventry|bath|brighton|milton keynes|guildford|aberdeen|derby|warwick|surrey)\b/i],
  ["Europe", /\b(paris|berlin|munich|amsterdam|dublin|madrid|barcelona|lisbon|zurich|stockholm|copenhagen|milan|vienna|warsaw|prague)\b/i],
];

/**
 * Coarse region for the board's region filter, from a location or country.
 * @param {string | null | undefined} place
 * @returns {string | null}
 */
export function regionFor(place) {
  if (!place) return null;
  for (const [region, re] of REGION_RULES) if (re.test(place)) return region;
  return null;
}

/**
 * One location string and region for a job listed in several places, e.g.
 * ["London, UK", "NYC"] -> "London, UK; NYC" with the first place's region.
 * @param {unknown} places
 */
export function joinLocations(places, max = 3) {
  const list = (Array.isArray(places) ? places : [])
    .map((p) => cleanText(p))
    .filter(Boolean);
  if (!list.length) return { location: null, region: null };
  const shown = list.slice(0, max).join("; ");
  const regions = new Set(list.map(regionFor));
  return {
    location: list.length > max ? `${shown} +${list.length - max}` : shown,
    region: regions.size === 1 ? [...regions][0] : (regionFor(list[0]) ?? null),
  };
}

// First match wins, so more specific domains come first ("Data Engineer" is Data).
// Business functions come first, so "AI Sales Intern" is GTM & Sales and
// "Product Marketing Intern" is Marketing. GTM & Sales, Consulting and Business
// Analysis are opt-in per person (see OPT_IN_DOMAINS in profiles.mjs).
const DOMAIN_RULES = [
  ["Business Analysis", /\b(business analy(st|sts|sis|tics)|biz ?ops|business operations|strategy (and|&) operations|strategy ?& ?ops|operations analyst|commercial analyst|insights analyst|strategy analyst)\b/i],
  ["Consulting", /\b(consult(ing|ancy|ant|ants)|advisory)\b/i],
  ["GTM & Sales", /\b(go[- ]to[- ]market|gtm|sales(?! ?(and|&) ?trading)|business development|bizdev|bdr|sdr|account (executive|manager|management)|partnerships?|outreach|lead gen(eration)?|customer success)\b/i],
  ["Marketing", /\b(marketing|growth (marketing|intern|associate|analyst)|brand|social media|content (creator|marketing|writer)|community (manager|intern|associate)|communications|copywrit\w*|seo)\b/i],
  ["Product", /\b(product manag\w*|associate product manager|apm|product owner|product operations|product ops|product analyst|product strategy)\b/i],
  ["AI/ML", /\b(machine learning|ml|ai|artificial intelligence|deep learning|nlp|computer vision)\b/i],
  ["Security", /\b(security|cyber)\b/i],
  ["Finance", /\b(quant|quantitative|trading|trader|investment|banking|finance|financial|accounting|audit|actuarial|tax)\b/i],
  ["Data", /\b(data|analytics)\b/i],
  ["Software", /\b(software|swe|developer|web|front[- ]?end|back[- ]?end|full[- ]?stack|devops|cloud|programmer|computer science|computing|it support)\b/i],
  ["Hardware", /\b(hardware|embedded|electronics?|electrical|fpga|semiconductor)\b/i],
  ["Engineering", /\b(mechanical|civil|aerospace|chemical|manufacturing|structural|engineering|engineer)\b/i],
  ["Marketing", /\b(marketing|social media|brand|content|communications|pr)\b/i],
  ["Product", /\b(product manager|product management|product)\b/i],
  ["Design", /\b(design|designer|ux|ui)\b/i],
  ["Research", /\b(research|researcher|scientist)\b/i],
  ["Policy", /\b(policy|government|public sector)\b/i],
  ["Business", /\b(sales|business|operations|consulting|consultant|strategy|hr|recruitment)\b/i],
];

/** @param {string} text @returns {string | null} */
export function guessDomain(text) {
  for (const [domain, re] of DOMAIN_RULES) if (re.test(text)) return domain;
  return null;
}
