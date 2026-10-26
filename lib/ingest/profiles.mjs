// Who each ingested job is shown to. Profiles come from the INGEST_PROFILES
// environment variable (JSON), not from code, because this repo is public:
//
//   {"alex": {"started": 2025, "courseYears": 3, "grade": 68, "hideRegions": ["Canada"]},
//    "sam":  {"started": 2025, "courseYears": 4, "grade": "2:1"}}
//
//   started      year the person started university (their year of study moves on each September)
//   courseYears  length of the degree (4 for an integrated master's)
//   grade        percentage, or "first" / "upper 2:1" / "2:1" / "lower 2:1" / "2:2"
//   hideRegions  regions (as on the board's filter) never shown to this person
//   domains      opt-in role categories to show them (see OPT_IN_DOMAINS), added
//                to the ones in DOMAIN_INTERESTS below
//
// Rules only act on evidence in the listing (its title, term, degree list or
// description). A listing that doesn't mention a year, grade or degree is shown
// to everyone. A user without a profile sees every job.

import { ELIGIBILITY_USERS } from "../eligibility.mjs";

const GRADE_WORDS = { first: 70, "upper 2:1": 65, "high 2:1": 65, "2:1": 60, "lower 2:1": 60, "2:2": 50 };

/**
 * @typedef {{ started: number, courseYears: number, grade: number | null, hideRegions: string[], domains: string[] }} Profile
 * @param {string | undefined} raw
 * @returns {Record<string, Profile>}
 */
export function parseProfiles(raw = process.env.INGEST_PROFILES) {
  if (!raw?.trim()) return {};
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("INGEST_PROFILES is not valid JSON");
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("INGEST_PROFILES must be a JSON object");
  const profiles = {};
  for (const [id, p] of Object.entries(data)) {
    const started = Number(p?.started);
    const courseYears = Number(p?.courseYears);
    if (!Number.isInteger(started) || !Number.isInteger(courseYears) || courseYears < 1) {
      throw new Error(`INGEST_PROFILES.${id} needs whole-number "started" and "courseYears"`);
    }
    const grade = typeof p.grade === "number" ? p.grade : (GRADE_WORDS[String(p.grade ?? "").toLowerCase()] ?? null);
    if (p.grade != null && grade === null) throw new Error(`INGEST_PROFILES.${id}.grade "${p.grade}" isn't a percentage or a known class`);
    const hideRegions = Array.isArray(p.hideRegions) ? p.hideRegions.map(String) : [];
    const domains = Array.isArray(p.domains) ? p.domains.map(String) : [];
    profiles[id.toLowerCase()] = { started, courseYears, grade, hideRegions, domains };
  }
  return profiles;
}

/** The calendar year the current academic year started in (it starts in September). */
export function academicYearStart(today) {
  const [y, m] = today.split("-").map(Number);
  return m >= 9 ? y : y - 1;
}

/** Current year of study and graduation year (graduating in June). */
export function studyStage(profile, today) {
  const year = academicYearStart(today) - profile.started + 1;
  return { year, gradYear: profile.started + profile.courseYears, final: year >= profile.courseYears };
}

const TERM_MONTH = { winter: 1, spring: 3, summer: 6, fall: 9, autumn: 9 };
const TERM_END_MONTH = { winter: 4, spring: 5, summer: 8, fall: 12, autumn: 12 };

/**
 * What a listing asks for, read from its text.
 * @param {{ role: string }} job
 * @param {{ text?: string, degrees?: string[] }} [details]
 */
export function requirements(job, details = {}) {
  const text = `${job.role} ${details.text ?? ""}`;

  const terms = [...job.role.matchAll(/\b(winter|spring|summer|fall|autumn)\s+(20\d\d)\b/gi)].map((m) => ({
    season: m[1].toLowerCase(),
    year: Number(m[2]),
  }));

  // Which students the listing is for. Spring weeks and insight programmes mean
  // "first year of a three-year degree or second year of a four-year one".
  const groups = new Set();
  const years = new Set();
  if (/\bpenultimate\b/i.test(text)) groups.add("penultimate");
  if (/\bfinal[- ]year (students?|undergrad\w*)\b|\bnew grad\b/i.test(text)) groups.add("final");
  if (/\bspring (week|insight)|\binsight (programme|program|week|day)s?\b/i.test(text)) groups.add("early");
  else {
    const ORDINALS = { first: 1, "1st": 1, second: 2, "2nd": 2, third: 3, "3rd": 3, fourth: 4, "4th": 4 };
    for (const m of text.matchAll(/\b(first|second|third|fourth|1st|2nd|3rd|4th)[- ]year (?:students?|undergrad\w*)\b/gi)) {
      years.add(ORDINALS[m[1].toLowerCase()]);
    }
  }

  const gradYears = new Set();
  for (const m of text.matchAll(/\b(?:graduat\w*|class of)\b[^.;]{0,60}/gi)) {
    for (const y of m[0].matchAll(/\b(20[2-4]\d)\b/g)) gradYears.add(Number(y[1]));
  }

  let minGrade = null;
  const need = (g) => (minGrade = Math.max(minGrade ?? 0, g));
  if (/\b(first[- ]class|1st[- ]class)\b/i.test(text)) need(70);
  if (/\b(high|upper|strong)\s+2[:.]1\b/i.test(text)) need(65);
  else if (/\b2[:.]1\b|\bupper second\b/i.test(text)) need(60);
  for (const m of text.matchAll(/(?:minimum|at least|average|grade|score)\D{0,30}?(\d{2}(?:\.\d)?)\s*%|(\d{2}(?:\.\d)?)\s*%\s*(?:or (?:above|higher|more)|average|minimum)/gi)) {
    const pct = Number(m[1] ?? m[2]);
    if (pct >= 50 && pct <= 85) need(pct);
  }

  const degrees = (details.degrees ?? []).map((d) => d.toLowerCase());
  const undergrad = ["bachelor's", "associate's", "incomplete", "bootcamp", "certificate"];
  const postgradOnly =
    /\bph\.?d\b|\bdoctoral\b|\bmba\b|\bmaster'?s\b|\bmsc\b/i.test(job.role) ||
    (degrees.length > 0 && !degrees.some((d) => undergrad.includes(d)));

  return { terms, groups, years, gradYears, minGrade, postgradOnly };
}

// Business role categories most people here don't want: shown only to those who
// opted in, through DOMAIN_INTERESTS or a profile's "domains". Every other
// category is shown to everyone, as before.
export const OPT_IN_DOMAINS = [
  "GTM & Sales", "Consulting", "Business Analysis", "Strategy", "Operations", "Growth", "Community & Events",
  "Venture Capital", "Revenue & Commercial", "Insights & Research", "PR & Comms", "People & Talent",
];

// Kept in code (unlike grades, which live in INGEST_PROFILES): what kinds of
// roles someone wants isn't private. Marketing and Product aren't opt-in; they're
// listed so the list says what the person asked for.
export const DOMAIN_INTERESTS = {
  taran: [...OPT_IN_DOMAINS, "Marketing", "Product"],
};

/**
 * The subset of `userIds` who should see `job`.
 * @param {{ role: string, region: string | null, domain?: string | null }} job
 * @param {{ text?: string, degrees?: string[] }} details
 * @param {string[]} userIds
 * @param {Record<string, Profile>} profiles
 * @param {string} today YYYY-MM-DD
 */
export function audienceFor(job, details, userIds, profiles, today) {
  const req = requirements(job, details);
  const [ty, tm] = today.split("-").map(Number);
  // Terms that haven't finished yet; a listing whose terms are all over is shown to nobody.
  const liveTerms = req.terms.filter((t) => t.year > ty || (t.year === ty && TERM_END_MONTH[t.season] >= tm));
  if (req.terms.length && !liveTerms.length) return [];
  if (req.postgradOnly) return [];

  return userIds.filter((id) => {
    const p = profiles[id];
    if (job.domain && OPT_IN_DOMAINS.includes(job.domain)) {
      const wants = [...(DOMAIN_INTERESTS[id] ?? []), ...(p?.domains ?? [])];
      if (!wants.includes(job.domain)) return false;
    }
    if (!p) return true;
    if (job.region && p.hideRegions.includes(job.region)) return false;

    const { year, gradYear, final } = studyStage(p, today);
    // People with eligibility verdicts see these with a "worth a shot" verdict
    // instead (lib/eligibility.mjs, verdictsFor).
    if (!ELIGIBILITY_USERS.includes(id)) {
      const group = final ? "final" : year === p.courseYears - 1 ? "penultimate" : "early";
      if ((req.groups.size || req.years.size) && !req.groups.has(group) && !req.years.has(year)) return false;
      if (req.gradYears.size && !req.gradYears.has(gradYear)) return false;
    }
    // A term has to start before they graduate in June.
    if (liveTerms.length && !liveTerms.some((t) => t.year < gradYear || (t.year === gradYear && TERM_MONTH[t.season] < 6))) {
      return false;
    }
    if (req.minGrade !== null && p.grade !== null && p.grade < req.minGrade) return false;
    return true;
  });
}
