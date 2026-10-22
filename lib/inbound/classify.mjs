// What an application email means. Rules on the sender and on keywords in the
// subject and body decide first; only when they're unsure (nothing matched, or
// signals conflict) is the optional LLM classifier asked.

export const LABELS = ["received", "assessment_invite", "interview", "offer", "rejected"];

// Assessment platforms: mail from these is an assessment invite.
const ASSESSMENT_SENDERS = [
  "hackerrank.com", "codility.com", "codesignal.com", "hirevue.com", "testgorilla.com", "pymetrics.ai",
  "pymetrics.com", "shl.com", "arcticshores.com", "capp.co", "sova.uk", "coderbyte.com", "mettl.com",
  "hackerearth.com", "imocha.io", "devskiller.com", "qualified.io", "criteriacorp.com", "harver.com",
  "talentlens.com", "cut-e.com", "amberjack.com",
];

/** @type {Record<string, { strong: RegExp, weak?: RegExp }>} */
const PATTERNS = {
  offer: {
    strong:
      /\b(pleased|delighted|happy|thrilled|excited) to (offer|extend)\b|\boffer of (employment|an? internship|a place)\b|\b(formal|written|conditional|unconditional|verbal) offer\b|\boffer letter\b|\baccept (our|the|your|this) offer\b/i,
  },
  rejected: {
    strong:
      /\bregret to (inform|let you know|advise)\b|\bnot (to )?(be )?(moving|progressing|proceeding|taking) (forward|further|your application)\b|\bdecided (not to (proceed|progress|move forward)|to (move forward|proceed|progress|continue) with other)\b|\bother (candidates|applicants)\b|\bunsuccessful\b|\bno longer (being )?(considered|under consideration)\b|\bposition has (now )?been filled\b|\bnot been (selected|successful)\b|\bwill not be (taking|progressing|moving|proceeding)\b/i,
    weak: /\bunfortunately\b/i,
  },
  interview: {
    strong:
      /\binvit\w* (you )?(to|for) (an? |your |the )?([\w-]+ ){0,2}interview\b|\bschedule (an?|your|the) ([\w-]+ ){0,2}(interview|call)\b|\binterview (invitation|invite|slot|availability|confirmation)\b|\bassessment (cent(re|er)|day)\b|\bsuper ?day\b|\bfinal[- ]round\b|\bphone screen\b/i,
    weak: /\binterview/i,
  },
  assessment_invite: {
    strong:
      /\bonline (assessment|test)s?\b|\bcoding (challenge|test|assessment|exercise)\b|\b(numerical|verbal|logical|inductive|abstract) reasoning\b|\bsituational judge?ment\b|\bgame[- ]based (assessment|test)\b|\bvideo interview\b|\bhirevue\b|\bcomplete (the|your|our|an?) ([\w-]+ ){0,2}(assessment|test|challenge)\b|\btechnical (test|assessment|exercise)\b|\b(aptitude|psychometric) tests?\b/i,
    weak: /\bassessment\b/i,
  },
  received: {
    strong:
      /\bthank(s| you) for (your )?(applying|application|submitting|interest in)\b|\bapplication (has been |was )?(received|submitted)\b|\bwe('ve| have) received your application\b|\bapplication (confirmation|acknowledg)/i,
    weak: /\bapplication\b/i,
  },
};

/**
 * Rule-based classification.
 * @param {{ senderDomain: string | null, subject: string, text: string }} email
 * @returns {{ label: string | null, sure: boolean, guess: string | null }}
 */
export function classifyByRules({ senderDomain, subject, text }) {
  const haystack = `${subject}\n${text}`;
  const strong = new Set(Object.keys(PATTERNS).filter((l) => PATTERNS[l].strong.test(haystack)));
  const weak = new Set(Object.keys(PATTERNS).filter((l) => PATTERNS[l].weak?.test(haystack)));
  if (senderDomain && ASSESSMENT_SENDERS.some((d) => senderDomain === d || senderDomain.endsWith(`.${d}`))) {
    strong.add("assessment_invite");
  }
  const sure = (label) => ({ label, sure: true, guess: label });
  const unsure = (guess) => ({ label: null, sure: false, guess });

  if (strong.has("offer")) return strong.has("rejected") ? unsure("offer") : sure("offer");
  // A rejection often thanks you for applying or mentions the assessment or
  // interview you did; its own phrasing still decides.
  if (strong.has("rejected")) return sure("rejected");

  // "Unfortunately" without a rejection phrase: maybe a rejection, maybe a reschedule.
  const doubt = weak.has("rejected");
  if (strong.has("interview") && strong.has("assessment_invite")) return unsure("interview");
  for (const label of ["interview", "assessment_invite", "received"]) {
    if (strong.has(label)) return doubt ? unsure(label) : sure(label);
  }
  const weakStages = ["rejected", "interview", "assessment_invite", "received"].filter((l) => weak.has(l));
  return unsure(weakStages[0] ?? null);
}

/**
 * Rules first, then `llm` (if given) when the rules aren't sure.
 * @param {{ senderDomain: string | null, subject: string, text: string }} email
 * @param {((email: { senderDomain: string | null, subject: string, text: string }) => Promise<string | null>) | null} llm
 * @returns {Promise<{ label: string, by: "rules" | "llm" | "none" }>}
 *   label is one of LABELS, or "unknown"; by "none" means nobody was sure,
 *   and the label is only the rules' best guess.
 */
export async function classify(email, llm) {
  const rules = classifyByRules(email);
  if (rules.sure && rules.label) return { label: rules.label, by: "rules" };
  if (llm) {
    const label = await llm(email);
    if (label && (LABELS.includes(label) || label === "unknown")) return { label, by: "llm" };
  }
  return { label: rules.guess ?? "unknown", by: "none" };
}
