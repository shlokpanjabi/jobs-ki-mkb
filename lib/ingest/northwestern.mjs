// Northwestern FinTech's 2027 quant internship list. One section per firm:
//   ## Firm
//   **Locations**: Chicago, NYC
//   |Role|Links|
//   |QR|[✅ ](https://...)|           ✅ = open, 🔒 = closed
import { rawGitHub } from "./github.mjs";
import { anchors, cleanText, markdownTables } from "./html.mjs";
import { regionFor } from "./normalise.mjs";

export const name = "northwestern-quant";

const README = rawGitHub("northwesternfintech/2027QuantInternships", "main", "README.md");
const ROLE_NAMES = {
  QR: "Quant Researcher",
  QT: "Quant Trader",
  QD: "Quant Developer",
  SWE: "Software Engineer",
  HW: "Hardware Engineer",
  ML: "Machine Learning",
};

/** @param {import("./run.mjs").SourceContext} ctx */
export async function fetchJobs(ctx) {
  return parseReadme(await ctx.fetchText(README, { accept: "text/plain" }));
}

/** @param {string} md */
export function parseReadme(md) {
  // Locations per firm, from the line under each "## Firm" heading.
  const locations = new Map();
  let firm = "";
  for (const line of md.split(/\r?\n/)) {
    const h = /^##\s+(.*)$/.exec(line);
    if (h) firm = cleanText(h[1]);
    const loc = /^\*\*Locations\*\*:\s*(.*)$/.exec(line);
    if (loc && firm) locations.set(firm, cleanText(loc[1]));
  }

  const jobs = [];
  for (const { heading: company, rows } of markdownTables(md)) {
    if (!rows.length || !("role" in rows[0]) || !("links" in rows[0])) continue;
    const location = locations.get(company) || null;
    const region = regionFor(location);
    for (const row of rows) {
      const label = cleanText(row.role);
      for (const { href, text } of anchors(row.links)) {
        if (!text.includes("✅")) continue; // 🔒 means applications are closed
        const variant = text.replace("✅", "").trim();
        let role = label.replace(/\b(QR|QT|QD|SWE|HW|ML)\b/g, (m) => ROLE_NAMES[m]);
        if (!/intern|fellow/i.test(role)) role += " Intern";
        if (variant) role += ` (${variant})`;
        jobs.push({
          company,
          role,
          type: /fellow/i.test(label) ? "fellowship" : "internship",
          domain: "Finance",
          location,
          region,
          deadline: null,
          source: "Northwestern Quant",
          link: href,
        });
      }
    }
  }
  return jobs;
}
