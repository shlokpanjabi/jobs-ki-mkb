// speedyapply's 2027 SWE and AI internship lists (US and international). The
// lists are Markdown tables: Company | Position | Location | [Salary] | Posting | Age.
import { MAX_AGE_DAYS, rawGitHub } from "./github.mjs";
import { anchors, cleanText, markdownTables } from "./html.mjs";
import { guessDomain, regionFor } from "./normalise.mjs";

export const name = "speedyapply";

const FILES = [
  { repo: "speedyapply/2027-SWE-College-Jobs", path: "README.md", domain: "Software" },
  { repo: "speedyapply/2027-SWE-College-Jobs", path: "INTERN_INTL.md", domain: "Software" },
  { repo: "speedyapply/2027-AI-College-Jobs", path: "README.md", domain: "AI/ML" },
  { repo: "speedyapply/2027-AI-College-Jobs", path: "INTERN_INTL.md", domain: "AI/ML" },
];

/** @param {import("./run.mjs").SourceContext} ctx */
export async function fetchJobs(ctx) {
  const jobs = [];
  let read = 0;
  for (const file of FILES) {
    const url = rawGitHub(file.repo, "main", file.path);
    try {
      jobs.push(...parseList(await ctx.fetchText(url, { accept: "text/plain" }), file.domain));
      read++;
    } catch (err) {
      ctx.warn(`${url}: ${err.message}`);
    }
  }
  if (!read) throw new Error("none of the speedyapply lists could be read");
  return jobs;
}

/** @param {string} md @param {string} listDomain */
export function parseList(md, listDomain) {
  const jobs = [];
  for (const { heading, rows } of markdownTables(md)) {
    if (!rows.length || !("company" in rows[0]) || !("posting" in rows[0])) continue;
    for (const row of rows) {
      const age = ageInDays(cleanText(row.age));
      if (age !== null && age > MAX_AGE_DAYS) continue;
      const link = anchors(row.posting)[0]?.href;
      const role = cleanText(row.position);
      if (!link || !role) continue;
      const location = cleanText(row.location) || null;
      jobs.push({
        company: cleanText(row.company),
        role,
        type: "internship",
        domain: /quant/i.test(heading) ? "Finance" : (guessDomain(role) ?? listDomain),
        location,
        region: regionFor(location),
        deadline: null,
        source: "speedyapply",
        link,
      });
    }
  }
  return jobs;
}

// "3d", "2w", "4mo" -> days
function ageInDays(text) {
  const m = /^(\d+)\s*(d|w|mo|y)/i.exec(text);
  if (!m) return null;
  return Number(m[1]) * { d: 1, w: 7, mo: 30, y: 365 }[m[2].toLowerCase()];
}
