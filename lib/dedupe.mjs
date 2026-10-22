// One key per real-world job, so the same role listed by several sources (with
// different links) shows as one row on the board. Plain ESM so the app and the
// ingest scripts share it.
import { regionFor } from "./ingest/normalise.mjs";

const LEGAL_SUFFIX = /\s+(inc|incorporated|ltd|limited|llc|llp|plc|corp|corporation|co|gmbh|ag|sa|bv)$/;
// A trailing "(New York, NY)", or "- London", ", NY", "| Berlin", "in Manchester".
const TRAILING_PARENS = /^(.*\S)\s*\(([^()]*)\)$/;
const TRAILING_PART = /^(.*\S)\s*(?:[-–—|,:@]|\bin\b)\s*([^-–—|,:@()]+)$/i;

function simplify(text) {
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Role without trailing location parts, e.g. "SWE Intern - London, UK" -> "SWE Intern". */
export function stripLocation(role) {
  let rest = role.trim();
  for (let i = 0; i < 4; i++) {
    const m = TRAILING_PARENS.exec(rest) ?? TRAILING_PART.exec(rest);
    // ", NY" is only recognised as a US state with its comma.
    if (!m || !(regionFor(m[2]) ?? regionFor(`, ${m[2].trim()}`))) break;
    rest = m[1].trim();
  }
  return rest;
}

/**
 * @param {string} company
 * @param {string} role
 * @returns {string} e.g. "goldman sachs|summer analyst"
 */
export function dedupeKey(company, role) {
  const c = simplify(company).replace(LEGAL_SUFFIX, "");
  return `${c}|${simplify(stripLocation(role))}`;
}
