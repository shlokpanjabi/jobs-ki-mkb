// What an application email asks the person to do, read by rules from its
// subject and text when it arrives. Only this summary is stored (never the
// body), so a later manual match can still create the right actions.
//
// Dates are taken only when the email states them outright, with a year. A
// time is kept only together with the time zone the email gives; a time with
// no zone is dropped (the date stays). Nothing is converted between zones.
import { toISODate } from "../ingest/normalise.mjs";

/** @typedef {{ date: string, time: string | null, tz: string | null }} Due */
/** @typedef {{ assessment: { due: Due | null } | null, book: { due: Due | null } | null,
 *   attend: { due: Due | null } | null, reminder: boolean }} Extracted */

export const ACTION_KINDS = ["complete_assessment", "book_interview", "attend_interview"];

const DEADLINE_CUE =
  /\b(?:complete|submit|finish|take|book|schedule|select|choose)\b[^.\n]{0,60}?\b(?:by|before|no later than)\b|\bdeadline(?: is| of)?\b|\bdue (?:by|on|date)\b|\bexpir(?:es|y)(?: on| date)?\b|\b(?:valid|open) until\b|\bclos(?:es|ing)(?: on)?\b/gi;
const SCHEDULED_CUE =
  /\binterview (?:is|has been|was) (?:scheduled|confirmed|booked)\b|\b(?:scheduled|confirmed|booked) for\b|\byour (?:interview|assessment cent(?:re|er)|superday) (?:is )?(?:on|at)\b/gi;
const BOOKING_CUE =
  /\b(?:book|schedule|select|choose|pick|reserve)\b[^.\n]{0,40}?\b(?:slot|time|interview|date|session)s?\b|\b(?:send us|let us know|share|provide|confirm) your availability\b|\bcalendly\b|\bself[- ]schedul/i;
const REMINDER = /\breminder\b|\bfriendly nudge\b|\bjust a reminder\b|\bhaven'?t (?:yet )?(?:completed|booked|started)\b/i;

const TZ =
  /\b(?:(?:GMT|UTC)\s?[+-]\s?\d{1,2}(?::?\d{2})?|GMT|UTC|BST|CET|CEST|EET|EEST|WET|WEST|EST|EDT|CST|CDT|MST|MDT|PST|PDT|IST|SGT|HKT|JST|AEST|AEDT)\b|\b(?:UK|London|British|Eastern|Central|Pacific|Mountain) time\b/i;
const TIME = /\b([01]?\d|2[0-3]):([0-5]\d)\s*(am|pm)?\b|\b(1[0-2]|0?[1-9])\s*(am|pm)\b/i;

/**
 * The first explicit date after a cue, with a time only if a time zone is given.
 * @param {string} window text right after the cue
 * @returns {Due | null}
 */
export function explicitDue(window) {
  // ISO dates anywhere; otherwise "5 November 2026" / "Nov 5, 2026". Numeric
  // dates like 05/11/2026 are left out: day-month order is ambiguous.
  const date = toISODate(/\b\d{4}-\d{2}-\d{2}\b/.exec(window)?.[0]) ?? toISODate(window);
  if (!date) return null;
  const t = TIME.exec(window);
  const tz = TZ.exec(window)?.[0].replace(/\s+/g, " ").trim() ?? null;
  if (!t || !tz) return { date, time: null, tz: null };
  let hour = Number(t[1] ?? t[4]);
  const minute = t[2] ?? "00";
  const meridiem = (t[3] ?? t[5])?.toLowerCase();
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  return { date, time: `${String(hour).padStart(2, "0")}:${minute}`, tz: /^[a-z]/.test(tz) ? tz : tz.toUpperCase() };
}

/** First cue in `text` followed (within ~100 characters) by an explicit date. */
function dueAfter(cue, text) {
  cue.lastIndex = 0;
  for (let m = cue.exec(text); m; m = cue.exec(text)) {
    // Up to the end of the sentence; a date in the next sentence isn't this deadline.
    const rest = text.slice(m.index + m[0].length, m.index + m[0].length + 100).split(/(?<=[a-z)\]])\.\s|\n\n/i)[0];
    const due = explicitDue(rest);
    if (due) return due;
  }
  return null;
}

/**
 * @param {{ subject: string, text: string }} email
 * @returns {Extracted}
 */
export function extractActions({ subject, text }) {
  const all = `${subject}\n${text}`;
  const scheduled = new RegExp(SCHEDULED_CUE.source, "i").test(all);
  return {
    assessment: { due: dueAfter(DEADLINE_CUE, all) },
    book: BOOKING_CUE.test(all) ? { due: dueAfter(DEADLINE_CUE, all) } : null,
    attend: scheduled ? { due: dueAfter(SCHEDULED_CUE, all) } : null,
    reminder: REMINDER.test(all),
  };
}

/**
 * The actions an email with this label asks for. An assessment invitation
 * always asks to complete it; an interview email asks to book a slot or to
 * attend at a set time only when it says so. Other labels ask for nothing.
 * @param {string} label
 * @param {Extracted | null} extracted
 * @returns {{ kind: string, due: Due | null }[]}
 */
export function actionsFor(label, extracted) {
  const ex = extracted ?? { assessment: null, book: null, attend: null, reminder: false };
  if (label === "assessment_invite") return [{ kind: "complete_assessment", due: ex.assessment?.due ?? null }];
  if (label !== "interview") return [];
  const out = [];
  if (ex.book) out.push({ kind: "book_interview", due: ex.book.due });
  if (ex.attend) out.push({ kind: "attend_interview", due: ex.attend.due });
  return out;
}
