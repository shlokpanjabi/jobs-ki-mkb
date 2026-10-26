// "Can I apply?" for one person, read from what a role says about graduation
// year or year of study. Plain ESM so the board and the tests share it.
//
//   eligible      the stated requirement covers them ("graduating 2029 or later",
//                 "second-year students", "any year")
//   worth_a_shot  it's stated and doesn't cover them ("graduating 2028",
//                 "penultimate year only"); kept on the board, with the
//                 employer's words, because they sometimes apply anyway
//   null          unknown: nothing stated, or it's ambiguous (negated, or one
//                 statement covers them and another doesn't). Never promoted.
//
// Only what the role says counts: never its level, pay or programme type (a
// spring week doesn't imply a year). Worked out when the board is shown, from
// the role title (the only posting text stored); nothing is saved.

import { studyStage } from "./ingest/profiles.mjs";

/**
 * People who get eligibility on their board, with their course: the year they
 * started and its length in years (their year of study moves on each September).
 */
export const ELIGIBILITY_COURSES = { shlok: { started: 2025, courseYears: 4 } };

export const VERDICTS = /** @type {const} */ (["eligible", "worth_a_shot"]);

const YEAR = String.raw`20[2-4]\d`;
// "2027, 2028 or 2029", "2027-2029", "2027/28" is left alone (not a 4-digit year).
const YEAR_LIST = String.raw`${YEAR}(?:\s*(?:,\s*(?:or\s+|and\s+)?|\bor\b|\band\b|/|&|-|–|—|\bto\b)\s*${YEAR})*`;
const LATER = String.raw`\s*(?:\+|or later|or after|or beyond|and later|and after|and beyond|onwards?)`;
// "graduating in 2028", "graduation date between 2027 and 2029", "class of 2028",
// "graduating in or after 2028", "expected graduation: 2029".
const GRAD_BEFORE = new RegExp(
  String.raw`\b(?:graduat\w*|class of|expected to graduate)\b(?:\s+(?:date|year|in|between|from|of|after|or|by|before|no later than|no earlier than|:|-|–))*\s*(${YEAR_LIST})((?:${LATER})?)`,
  "gi",
);
// "2027 or 2028 grads", "2029 graduates", "2028 graduation".
const GRAD_AFTER = new RegExp(String.raw`(${YEAR_LIST})((?:${LATER})?)\s+(?:grads?|graduates?|graduation|graduating)\b`, "gi");

const ORDINAL = { first: 1, "1st": 1, second: 2, "2nd": 2, third: 3, "3rd": 3, fourth: 4, "4th": 4, fifth: 5, "5th": 5 };
const ORD = String.raw`(?:first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th)`;
const STUDENTS = String.raw`(?:students?|undergrad\w*|of (?:your |their )?(?:degree|study|studies|university|uni|course)|university|uni|bachelor\w*|BSc|BEng|MEng)`;
// "first or second year students", "2nd-year undergraduates", "in your second year of university".
const ORDINAL_YEARS = new RegExp(String.raw`\b(${ORD}(?:\s*(?:,|\bor\b|\band\b|/|&)\s*${ORD})*)[- ]years?\b\s*(?:\(|-)?\s*${STUDENTS}`, "gi");
// "Year 2 students", "year 2 or 3 undergraduates".
const NUMBERED_YEARS = new RegExp(String.raw`\byears?\s+([1-5](?:\s*(?:,|\bor\b|\band\b|/|&)\s*(?:year\s+)?[1-5])*)\s+${STUDENTS}`, "gi");
const PENULTIMATE = /\bpenultimate[- ]years?\b/gi;
const FINAL = /\bfinal[- ]years?\s+(?:students?|undergrad\w*|of (?:your |their )?(?:degree|study|studies|university|uni))\b|\bin (?:your|their) final year\b|\bnew[- ]grads?\b/gi;
const ANY_YEAR = /\b(?:any|all) years?(?: of (?:study|university|uni|your degree|their degree))?\b|\bat any stage of (?:your|their) (?:degree|studies)\b|\bany (?:university |uni )?year\b/gi;
const NEGATION = /\b(?:not|no|n't|excluding|except|ineligible)\b/i;

/**
 * Splits text into sentences (and title/bullet fragments), keeping the words as written.
 * @param {string} text
 */
function sentences(text) {
  return text
    .split(/(?<=[.!?;])\s+|\s*[\n•·|]+\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Every year in a list like "2027, 2028 or 2029", or in a range: "2027-2029",
 * "2027 to 2029", "between 2027 and 2029".
 * @param {string} list  the years as written
 * @param {string} match  the whole statement, to spot "between"
 */
function yearsIn(list, match) {
  const years = [...list.matchAll(new RegExp(YEAR, "g"))].map((m) => Number(m[0]));
  const range = /-|–|—|\bto\b/.test(list) || (/\bbetween\b/i.test(match) && /\band\b/.test(list));
  if (range && years.length === 2 && years[1] > years[0] && years[1] - years[0] <= 6) {
    return Array.from({ length: years[1] - years[0] + 1 }, (_, i) => years[0] + i);
  }
  return years;
}

/**
 * The year-of-study and graduation requirements a posting states, one entry
 * per statement, each with whether it covers the person.
 * @param {string} text  the role title and the posting's text
 * @param {{ gradYear: number, year: number, courseYears: number }} person  year = current year of study
 */
export function statedRequirements(text, person) {
  /** @type {{ kind: "grad" | "year", covers: boolean, ambiguous: boolean, quote: string }[]} */
  const found = [];
  for (const sentence of sentences(text)) {
    const add = (kind, covers, match) => {
      const before = sentence.slice(Math.max(0, match.index - 40), match.index);
      found.push({ kind, covers, ambiguous: NEGATION.test(before + match[0]), quote: quote(sentence, match.index, match[0].length) });
    };

    for (const re of [GRAD_BEFORE, GRAD_AFTER]) {
      for (const m of sentence.matchAll(re)) {
        const years = yearsIn(m[1], m[0]);
        if (!years.length) continue;
        const lead = m[0].toLowerCase();
        let covers;
        if (m[2]) covers = person.gradYear >= Math.min(...years); // "2028 or later"
        else if (/\bbefore\b/.test(lead)) covers = person.gradYear < Math.min(...years);
        else if (/\bby\b|no later than/.test(lead)) covers = person.gradYear <= Math.max(...years);
        else if (/\bafter\b|no earlier than|\bfrom\b/.test(lead)) covers = person.gradYear >= Math.min(...years);
        else covers = years.includes(person.gradYear);
        add("grad", covers, m);
      }
    }

    for (const m of sentence.matchAll(ORDINAL_YEARS)) {
      const years = [...m[1].matchAll(new RegExp(ORD, "gi"))].map((o) => ORDINAL[o[0].toLowerCase()]);
      add("year", years.includes(person.year), m);
    }
    for (const m of sentence.matchAll(NUMBERED_YEARS)) {
      const years = [...m[1].matchAll(/[1-5]/g)].map((d) => Number(d[0]));
      add("year", years.includes(person.year), m);
    }
    for (const m of sentence.matchAll(PENULTIMATE)) add("year", person.year === person.courseYears - 1, m);
    for (const m of sentence.matchAll(FINAL)) add("year", person.year === person.courseYears, m);
    for (const m of sentence.matchAll(ANY_YEAR)) add("year", true, m);
  }
  return found;
}

/**
 * @param {string} text  the role title and the posting's text
 * @param {{ gradYear: number, year: number, courseYears: number }} person
 * @returns {{ verdict: "eligible" | "worth_a_shot" | null, note: string | null }}
 *   note: the employer's words the verdict rests on, verbatim
 */
export function eligibilityFor(text, person) {
  const found = statedRequirements(text, person);
  if (!found.length || found.some((f) => f.ambiguous)) return { verdict: null, note: null };
  // Per kind (graduation year, year of study): covered if any statement of
  // that kind covers them ("penultimate year; second years also welcome").
  const kinds = new Map();
  for (const f of found) kinds.set(f.kind, (kinds.get(f.kind) ?? false) || f.covers);
  const covered = [...kinds.values()];
  if (covered.every(Boolean)) return { verdict: "eligible", note: notes(found.filter((f) => f.covers)) };
  if (!covered.some(Boolean)) return { verdict: "worth_a_shot", note: notes(found) };
  return { verdict: null, note: null }; // e.g. "second-year students graduating in 2028": the posting disagrees with itself
}

/**
 * The person's year of study and graduation year, from an INGEST_PROFILES entry.
 * @param {{ started: number, courseYears: number }} profile
 * @param {string} today YYYY-MM-DD
 */
export function personFor(profile, today) {
  const { year, gradYear } = studyStage(profile, today);
  return { year, gradYear, courseYears: profile.courseYears };
}

// The sentence, or the part of it around the match when it's long, word for word.
function quote(sentence, index, length) {
  if (sentence.length <= 200) return sentence;
  const start = Math.max(0, index - 80);
  const end = Math.min(sentence.length, index + length + 80);
  return `${start > 0 ? "…" : ""}${sentence.slice(start, end).trim()}${end < sentence.length ? "…" : ""}`;
}

function notes(found) {
  const quotes = [...new Set(found.map((f) => f.quote))];
  const joined = quotes.join(" … ");
  return joined.length <= 400 ? joined : `${joined.slice(0, 399)}…`;
}
