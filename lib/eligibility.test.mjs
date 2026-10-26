// The stated wording -> verdict mapping (lib/eligibility.mjs). Run with `npm test`.
import assert from "node:assert/strict";
import { test } from "node:test";
import { eligibilityFor, personFor } from "./eligibility.mjs";

// Second year of a four-year degree, graduating 2029 (this academic year, 2026/27).
const SECOND_OF_FOUR = { started: 2025, courseYears: 4 };
const NOW = personFor(SECOND_OF_FOUR, "2026-10-26");
const verdict = (text, person = NOW) => eligibilityFor(text, person).verdict;

test("eligibility: person from a profile, moving on each September", () => {
  assert.deepEqual(NOW, { year: 2, gradYear: 2029, courseYears: 4 });
  assert.deepEqual(personFor(SECOND_OF_FOUR, "2027-09-01"), { year: 3, gradYear: 2029, courseYears: 4 });
});

test("eligibility: stated wording that covers a 2029 graduate in second year is eligible", () => {
  for (const text of [
    "Open to students graduating in 2029 or later.",
    "Applicants must be graduating 2027, 2028 or 2029.",
    "We're hiring 2027 or 2028 or 2029 grads!",
    "Expected graduation date between 2027 and 2029.",
    "Students graduating 2028+ are welcome",
    "Second year students welcome.",
    "Open to first or second year undergraduates.",
    "Open to 1st and 2nd-year students",
    "Year 2 students only",
    "Students of any year can apply.",
    "Penultimate year students. Second-year students are also welcome.",
    "Penultimate year; second years also welcome", // covering clause without a students-noun
  ]) {
    assert.equal(verdict(text), "eligible", text);
  }
});

test("eligibility: stated wording that doesn't cover him is worth a shot, with the employer's words", () => {
  for (const text of [
    "Summer Analyst 2027 - Penultimate Year",
    "You must be graduating in 2028.",
    "Open to final year students only.",
    "Software Engineering Internship (Class of 2028)",
    "Penultimate year students graduating in 2028",
    "Candidates graduating before 2029.",
    "For third-year students.",
    "2028 graduates only",
  ]) {
    assert.equal(verdict(text), "worth_a_shot", text);
  }
  // The note is the employer's own wording, not a summary.
  const posting = "Join our team for summer 2027. You must be graduating in 2028. Competitive pay.";
  assert.deepEqual(eligibilityFor(posting, NOW), { verdict: "worth_a_shot", note: "You must be graduating in 2028." });
  const title = "Summer Analyst 2027 - Penultimate Year";
  assert.equal(eligibilityFor(title, NOW).note, title);
  // Once he is in his penultimate year (from September 2027), the same words cover him.
  assert.equal(verdict("Penultimate year students", personFor(SECOND_OF_FOUR, "2027-09-01")), "eligible");
});

test("eligibility: unstated or ambiguous stays unknown", () => {
  for (const text of [
    "",
    "Software Engineering Intern 2027",
    "Join our summer internship. Competitive salary.",
    "Spring Week 2027", // a programme type is not a stated year
    "Graduate Programme",
    "Senior Machine Learning Engineer",
    "Applications close on 30 November 2027.",
    "Second-year students graduating in 2028", // disagrees with itself
    "This role is not open to penultimate year students.", // negated
    "Not for final year students; second years welcome", // negated next to the statement
  ]) {
    assert.deepEqual(eligibilityFor(text, NOW), { verdict: null, note: null }, text);
  }
});
