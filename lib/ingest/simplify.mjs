// SimplifyJobs/Summer2027-Internships: the JSON file the repo's README is
// generated from, so no Markdown scraping is needed.
import { MAX_AGE_DAYS, rawGitHub } from "./github.mjs";
import { cleanText } from "./html.mjs";
import { guessDomain, joinLocations } from "./normalise.mjs";

export const name = "simplify";

const LISTINGS = rawGitHub("SimplifyJobs/Summer2027-Internships", "dev", ".github/scripts/listings.json");
const DOMAINS = {
  software: "Software",
  "software engineering": "Software",
  "ai/ml/data": "AI/ML",
  "data science, ai & machine learning": "AI/ML",
  hardware: "Hardware",
  "hardware engineering": "Hardware",
  product: "Product",
  "product management": "Product",
  quant: "Finance",
};

/** @param {import("./run.mjs").SourceContext} ctx */
export async function fetchJobs(ctx) {
  const listings = JSON.parse(await ctx.fetchText(LISTINGS, { accept: "application/json" }));
  if (!Array.isArray(listings)) throw new Error("listings.json is not an array");
  const since = Date.now() / 1000 - MAX_AGE_DAYS * 86_400;
  return listings
    .filter((l) => l && l.active === true && l.is_visible !== false && Number(l.date_posted) >= since)
    .map(fromListing);
}

/** @param {Record<string, any>} listing */
export function fromListing(listing) {
  const title = cleanText(listing.title);
  // Add the term ("Summer 2027") unless the title already says it.
  const terms = (Array.isArray(listing.terms) ? listing.terms : [])
    .map(cleanText)
    .filter((t) => t && t !== "N/A" && !title.toLowerCase().includes(t.toLowerCase()));
  const { location, region } = joinLocations(listing.locations);
  return {
    company: listing.company_name,
    role: terms.length ? `${title} (${terms.join(", ")})` : title,
    type: "internship",
    domain: DOMAINS[cleanText(listing.category).toLowerCase()] ?? guessDomain(title),
    location,
    region,
    deadline: null, // Simplify marks closed roles inactive instead of listing deadlines
    source: "Simplify",
    link: listing.url,
  };
}
