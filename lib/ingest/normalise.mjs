// Turns what a source scraped into the exact shape POST /api/jobs accepts.
// The API re-validates everything; this just avoids sending junk and keeps
// fields consistent across sources.
import { normalizeLink } from "../links.mjs";
import { cleanText } from "./html.mjs";

// Mirrors JOB_TYPES in lib/types.ts (that file is TypeScript, scripts are not).
const JOB_TYPES = ["internship", "part-time", "fellowship"];
const MAX_FIELD = 300; // the API rejects longer text fields

// The seed data files London under "Europe"; keep UK jobs in the same bucket so
// the region filter stays consistent. Change this one value to split out "UK".
export const UK_REGION = "Europe";

/**
 * @typedef {{ company: string, role: string, type: string, domain: string | null,
 *   location: string | null, region: string | null, deadline: string | null,
 *   source: string | null, link: string }} Job
 */

/**
 * @param {Record<string, unknown>} raw
 * @param {string} today YYYY-MM-DD
 * @returns {{ job: Job } | { skip: string }}
 */
export function normaliseJob(raw, today) {
  const text = (v) => {
    const s = cleanText(v);
    return s ? s.slice(0, MAX_FIELD) : null;
  };
  const company = text(raw.company);
  const role = text(raw.role);
  if (!company || !role) return { skip: "missing company or role" };

  const type = typeof raw.type === "string" ? raw.type : "";
  if (!JOB_TYPES.includes(type)) return { skip: `unknown type "${type}"` };

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

const UK_PLACES =
  /\b(uk|u\.k\.|united kingdom|great britain|england|scotland|wales|northern ireland|london|manchester|birmingham|bristol|leeds|glasgow|edinburgh|cambridge|oxford|liverpool|sheffield|nottingham|newcastle|cardiff|belfast|reading|southampton|leicester|coventry|bath|york|brighton|milton keynes|guildford|aberdeen|derby|warwick|surrey|kent|essex)\b/i;
const EUROPE =
  /\b(ireland|france|germany|spain|portugal|italy|netherlands|belgium|switzerland|austria|sweden|norway|denmark|finland|poland|czechia|czech republic|greece|hungary|romania|estonia|latvia|lithuania|luxembourg|paris|berlin|munich|amsterdam|dublin|madrid|barcelona|lisbon|zurich|stockholm|copenhagen|milan|vienna|warsaw|prague)\b/i;

/**
 * Coarse region for the board's region filter, from a location or country.
 * @param {string | null | undefined} place
 * @returns {string | null}
 */
export function regionFor(place) {
  if (!place) return null;
  if (/\b(remote|online|virtual|anywhere)\b/i.test(place)) return "Remote";
  if (UK_PLACES.test(place)) return UK_REGION;
  if (EUROPE.test(place)) return "Europe";
  if (/\b(united states|usa|u\.s\.|us)\b/i.test(place)) return "US";
  if (/\bcanada\b/i.test(place)) return "Canada";
  if (/\bindia\b/i.test(place)) return "India";
  return null;
}

// First match wins, so more specific domains come first ("Data Engineer" is Data).
const DOMAIN_RULES = [
  ["AI/ML", /\b(machine learning|ml|ai|artificial intelligence|deep learning|nlp|computer vision)\b/i],
  ["Security", /\b(security|cyber)\b/i],
  ["Finance", /\b(quant|quantitative|trading|trader|investment|banking|finance|financial|accounting|audit|actuarial|tax)\b/i],
  ["Data", /\b(data|analytics)\b/i],
  ["Software", /\b(software|swe|developer|web|front[- ]?end|back[- ]?end|full[- ]?stack|devops|cloud|programmer|computer science|computing|it support)\b/i],
  ["Hardware", /\b(hardware|embedded|electronics?|electrical|fpga|semiconductor)\b/i],
  ["Engineering", /\b(mechanical|civil|aerospace|chemical|manufacturing|structural|engineering|engineer)\b/i],
  ["Marketing", /\b(marketing|social media|brand|content|communications|pr)\b/i],
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
