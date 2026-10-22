// Your own spreadsheets: every CSV URL in INGEST_SHEETS (comma-separated).
// A Google Sheet works if it's shared as "Anyone with the link can view";
// its normal /edit URL is turned into the CSV export URL automatically.
//
// Columns are matched by header name (case-insensitive, any order):
//   company | role (or title/position) | link (or url/apply link) are required,
//   type, domain, location, region, deadline are optional.
// A missing type is guessed from the role (fellowship / part-time / internship).
// Deadlines can be 2026-11-30, 30 Nov 2026 or 30/11/2026 (day first).
import { parseCsv } from "./html.mjs";
import { toISODate } from "./normalise.mjs";

export const name = "sheets";

const COLUMNS = {
  company: ["company", "employer", "organisation", "organization", "firm"],
  role: ["role", "title", "position", "job", "job title"],
  link: ["link", "url", "apply link", "application link", "apply", "job link"],
  type: ["type", "job type", "opportunity type"],
  domain: ["domain", "category", "sector", "industry", "field"],
  location: ["location", "city", "locations"],
  region: ["region", "country"],
  deadline: ["deadline", "closing date", "apply by", "due", "close date"],
};

/** @param {import("./run.mjs").SourceContext} ctx */
export async function fetchJobs(ctx) {
  const urls = (process.env.INGEST_SHEETS ?? "").split(",").map((u) => u.trim()).filter(Boolean);
  const jobs = [];
  for (const url of urls) {
    try {
      jobs.push(...fromCsv(await ctx.fetchText(csvUrl(url), { accept: "text/csv,text/plain" })));
    } catch (err) {
      ctx.warn(`${url}: ${err.message}`);
    }
  }
  return jobs;
}

/** Google Sheets /edit (or /view) URL -> its CSV export URL; other URLs unchanged. */
export function csvUrl(raw) {
  const url = new URL(raw);
  const m = /^\/spreadsheets\/d\/([\w-]+)\/(?:edit|view)?/.exec(url.pathname);
  if (url.hostname !== "docs.google.com" || !m || m[1] === "e") return raw;
  const gid = /gid=(\d+)/.exec(url.hash + url.search)?.[1] ?? "0";
  return `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv&gid=${gid}`;
}

/** @param {string} text */
export function fromCsv(text) {
  return parseCsv(text).map((row) => {
    const get = (field) => COLUMNS[field].map((h) => row[h]).find((v) => v) ?? "";
    const role = get("role");
    return {
      company: get("company"),
      role,
      type: typeFrom(get("type") || role),
      domain: get("domain") || null,
      location: get("location") || null,
      region: get("region") || null,
      deadline: toISODate(dayFirst(get("deadline"))),
      source: "Spreadsheet",
      link: get("link"),
    };
  });
}

function typeFrom(text) {
  if (/fellow/i.test(text)) return "fellowship";
  if (/part[\s-]?time/i.test(text)) return "part-time";
  return "internship";
}

// 30/11/2026 -> 2026-11-30 (UK order); anything else is passed through.
function dayFirst(text) {
  const m = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(text.trim());
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : text;
}
