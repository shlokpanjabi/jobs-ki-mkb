// Companies' own job boards, through the public posting APIs that Greenhouse,
// Lever and Ashby provide for exactly this (no login, JSON). This is where
// business roles come from (GTM, sales, consulting, business analysis,
// marketing, product), which the GitHub lists don't cover. Only student roles
// are kept: internships, placements, working-student jobs and fellowships.
//
// Board names below appeared in live Simplify listings (October 2026), mostly
// for companies hiring in the UK or Ireland. Add more without a deploy through
// INGEST_EXTRA_BOARDS, e.g. "greenhouse:monzo:Monzo,ashby:notion:Notion"
// (ats:board:Company name, the board name being the one in the careers URL).
import { cleanText, decodeEntities } from "./html.mjs";
import { guessDomain, joinLocations } from "./normalise.mjs";

export const name = "company-boards";

/** @type {[ats: "greenhouse" | "lever" | "ashby", board: string, company: string][]} */
export const BOARDS = [
  ["greenhouse", "monzo", "Monzo"],
  ["greenhouse", "intercom", "Intercom"],
  ["greenhouse", "cloudflare", "Cloudflare"],
  ["greenhouse", "figma", "Figma"],
  ["greenhouse", "anthropic", "Anthropic"],
  ["greenhouse", "scaleai", "Scale AI"],
  ["greenhouse", "vercel", "Vercel"],
  ["greenhouse", "wppmedia", "WPP Media"],
  ["greenhouse", "airtable", "Airtable"],
  ["greenhouse", "twilio", "Twilio"],
  ["greenhouse", "robinhood", "Robinhood"],
  ["lever", "palantir", "Palantir"],
  ["lever", "spotify", "Spotify"],
  ["lever", "octoenergy", "Octopus Energy"],
  ["lever", "farfetch", "Farfetch"],
  ["lever", "zopa", "Zopa"],
  ["ashby", "notion", "Notion"],
  ["ashby", "ramp", "Ramp"],
  ["ashby", "deliveroo", "Deliveroo"],
  ["ashby", "cohere", "Cohere"],
  ["ashby", "incident", "incident.io"],
  ["ashby", "lendable", "Lendable"],
  ["ashby", "perplexity", "Perplexity"],
  ["ashby", "openai", "OpenAI"],
  ["ashby", "elevenlabs", "ElevenLabs"],
  ["ashby", "trainline", "Trainline"],
  ["ashby", "quantexa", "Quantexa"],
  ["ashby", "faculty", "Faculty AI"],
  ["ashby", "mistral.ai", "Mistral AI"],
  ["ashby", "plaid", "Plaid"],
  ["ashby", "snowflake", "Snowflake"],
];

const STUDENT_ROLE =
  /\b(intern(ship)?s?|placements?|industrial (year|placement)|year in industry|working student|werkstudent|summer (analyst|associate|program(me)?)|spring (week|insight)|insight (programme|program|week)|co-?op|apprentice(ship)?|fellow(ship)?)\b/i;

/** @param {string} raw "ats:board:Company, ..." */
export function parseBoards(raw = process.env.INGEST_EXTRA_BOARDS ?? "") {
  return raw
    .split(",")
    .map((entry) => entry.trim().split(":").map((p) => p.trim()))
    .filter(([ats, board]) => ["greenhouse", "lever", "ashby"].includes(ats) && board)
    .map(([ats, board, ...rest]) => [ats, board, rest.join(":") || board]);
}

/** @param {import("./run.mjs").SourceContext} ctx */
export async function fetchJobs(ctx) {
  const boards = [...BOARDS, ...parseBoards()];
  // All at once: the fetcher still queues and spaces requests to each host.
  const results = await Promise.allSettled(boards.map(([ats, board, company]) => READERS[ats](ctx, board, company)));
  const jobs = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") jobs.push(...r.value);
    else ctx.warn(`${boards[i][0]}:${boards[i][1]}: ${r.reason?.message ?? r.reason}`);
  });
  if (!results.some((r) => r.status === "fulfilled")) {
    throw new Error(`none of the ${boards.length} company boards could be read`);
  }
  return jobs;
}

const json = async (ctx, url) => JSON.parse(await ctx.fetchText(url, { accept: "application/json" }));

const READERS = {
  async greenhouse(ctx, board, company) {
    const data = await json(ctx, `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs?content=true`);
    return fromGreenhouse(data, company);
  },
  async lever(ctx, board, company) {
    // Lever hosts EU accounts separately; a board missing from one is on the other.
    let data;
    try {
      data = await json(ctx, `https://api.lever.co/v0/postings/${encodeURIComponent(board)}?mode=json`);
    } catch (err) {
      if (err.status !== 404) throw err;
      data = await json(ctx, `https://api.eu.lever.co/v0/postings/${encodeURIComponent(board)}?mode=json`);
    }
    return fromLever(data, company);
  },
  async ashby(ctx, board, company) {
    const data = await json(ctx, `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(board)}`);
    return fromAshby(data, company);
  },
};

function job({ company, title, link, places, department, type, details }) {
  const { location, region } = joinLocations(places);
  return {
    company,
    role: title,
    type,
    domain: guessDomain(title) ?? (department ? guessDomain(department) : null),
    location,
    region,
    deadline: null, // these APIs don't publish closing dates
    source: "Company careers",
    link,
    details,
  };
}

const typeFor = (title, partTime = false) =>
  /\bfellow(ship)?\b/i.test(title) ? "fellowship" : partTime || /\b(working student|werkstudent|part[- ]time)\b/i.test(title) ? "part-time" : "internship";

/** GET boards-api.greenhouse.io/v1/boards/:board/jobs?content=true */
export function fromGreenhouse(data, company) {
  return (Array.isArray(data?.jobs) ? data.jobs : [])
    .filter((j) => typeof j.title === "string" && STUDENT_ROLE.test(j.title) && typeof j.absolute_url === "string")
    .map((j) =>
      job({
        company,
        title: cleanText(j.title),
        link: j.absolute_url,
        places: String(j.location?.name ?? "").split(/\s*[;|]\s*/),
        department: (j.departments ?? []).map((d) => d?.name).filter(Boolean).join(" "),
        type: typeFor(j.title),
        // content is HTML with its tags entity-encoded.
        details: cleanText(decodeEntities(String(j.content ?? ""))),
      }),
    );
}

/** GET api.lever.co/v0/postings/:board?mode=json */
export function fromLever(data, company) {
  return (Array.isArray(data) ? data : [])
    .filter((p) => typeof p.text === "string" && typeof p.hostedUrl === "string")
    .filter((p) => STUDENT_ROLE.test(p.text) || /\bintern/i.test(String(p.categories?.commitment ?? "")))
    .map((p) =>
      job({
        company,
        title: cleanText(p.text),
        link: p.hostedUrl,
        places: p.categories?.allLocations?.length ? p.categories.allLocations : [p.categories?.location],
        department: [p.categories?.team, p.categories?.department].filter(Boolean).join(" "),
        type: typeFor(p.text, /part[- ]time/i.test(String(p.categories?.commitment ?? ""))),
        details: cleanText([p.descriptionPlain, p.additionalPlain, ...(p.lists ?? []).map((l) => `${l.text} ${l.content}`)].filter(Boolean).join(" ")),
      }),
    );
}

/** GET api.ashbyhq.com/posting-api/job-board/:board */
export function fromAshby(data, company) {
  return (Array.isArray(data?.jobs) ? data.jobs : [])
    .filter((j) => j.isListed !== false && typeof j.title === "string" && typeof j.jobUrl === "string")
    .filter((j) => STUDENT_ROLE.test(j.title) || j.employmentType === "Intern")
    .map((j) =>
      job({
        company,
        title: cleanText(j.title),
        link: j.jobUrl,
        places: [j.location, ...(j.secondaryLocations ?? []).map((l) => l?.location), j.isRemote ? "Remote" : null].filter(Boolean),
        department: [j.department, j.team].filter(Boolean).join(" "),
        type: typeFor(j.title, j.employmentType === "PartTime"),
        details: cleanText(String(j.descriptionPlain ?? "")),
      }),
    );
}
