// Which of a user's jobs an email is about, by company name, and the
// forward-only status change it implies.

const LEGAL_WORDS = new Set([
  "ltd", "limited", "plc", "llc", "llp", "lp", "inc", "incorporated", "corp", "corporation", "co", "company",
  "group", "holdings", "gmbh", "ag", "sa", "the",
]);

// Senders that don't identify the employer: applicant-tracking systems,
// assessment platforms and mail providers.
const GENERIC_DOMAINS = [
  "greenhouse.io", "greenhouse-mail.io", "lever.co", "hire.lever.co", "myworkday.com", "myworkdayjobs.com", "workday.com",
  "smartrecruiters.com", "icims.com", "ashbyhq.com", "successfactors.com", "successfactors.eu", "taleo.net",
  "oraclecloud.com", "jobvite.com", "eightfold.ai", "avature.net", "workablemail.com", "workable.com",
  "teamtailor.com", "pinpointhq.com", "beapplied.com", "recruitee.com", "bamboohr.com", "personio.de",
  "hackerrank.com", "codility.com", "codesignal.com", "hirevue.com", "testgorilla.com", "pymetrics.ai", "shl.com",
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "yahoo.com", "icloud.com", "google.com",
  "linkedin.com", "indeed.com", "handshake.com", "joinhandshake.com", "brightnetwork.co.uk", "gradcracker.com",
];
// Labels in a domain that never name a company.
const DOMAIN_NOISE = new Set([
  "com", "co", "uk", "io", "org", "net", "ai", "eu", "de", "fr", "us", "jobs", "careers", "career", "mail", "email",
  "talent", "recruiting", "recruitment", "hr", "people", "notifications", "noreply", "no-reply", "www", "apply",
]);

/** "J.P. Morgan & Co. Ltd" -> ["jp", "morgan", "and"] */
export function companyWords(name) {
  return String(name ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\.(?=\w\b)|\.(?=\w\.)/g, "") // J.P. -> JP
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !LEGAL_WORDS.has(w));
}

const phrase = (words) => words.join(" ");
const textWords = (text) => ` ${companyWords(text).join(" ")} `;

function domainLabels(domain) {
  if (!domain || GENERIC_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`))) return [];
  return domain.split(".").filter((l) => !DOMAIN_NOISE.has(l) && l.length >= 3);
}

/**
 * @typedef {{ jobId: number, company: string, role: string, status: string }} Candidate
 * @param {{ fromName: string, senderDomain: string | null, subject: string, text: string }} email
 * @param {Candidate[]} jobs the user's jobs
 * @returns {{ job: Candidate } | { ambiguous: Candidate[] } | { none: true }}
 */
export function matchJob(email, jobs) {
  const labels = domainLabels(email.senderDomain);
  const nameText = textWords(email.fromName);
  const subjectText = textWords(email.subject);
  const bodyText = textWords(email.text);

  const byCompany = new Map(); // company key -> { score, jobs }
  for (const job of jobs) {
    const words = companyWords(job.company);
    if (!words.length) continue;
    const key = words.join("");
    const p = ` ${phrase(words)} `;
    let score = 0;
    // careers.goldmansachs.com -> "goldmansachs"; jpmorgan.com vs "JP Morgan Chase"
    if (labels.some((l) => l === key || (Math.min(l.length, key.length) >= 5 && (key.startsWith(l) || l.startsWith(key))))) score += 3;
    if (nameText.includes(p)) score += 3;
    if (subjectText.includes(p)) score += 2;
    // Short names ("EY", "Arm") are too common as words to trust in a body.
    if (key.length >= 4 && bodyText.includes(p)) score += 1;
    if (!score) continue;
    const entry = byCompany.get(key) ?? { score, jobs: [] };
    entry.score = Math.max(entry.score, score);
    entry.jobs.push(job);
    byCompany.set(key, entry);
  }
  if (!byCompany.size) return { none: true };

  const ranked = [...byCompany.values()].sort((a, b) => b.score - a.score);
  if (ranked.length > 1 && ranked[1].score === ranked[0].score) {
    return { ambiguous: ranked.flatMap((r) => r.jobs).slice(0, 10) };
  }
  let pool = ranked[0].jobs;
  if (pool.length > 1) {
    // Several roles at that company: the one whose title the email mentions,
    // else the one the user has already moved past "todo".
    const mentioned = bestRoleMatches(pool, `${subjectText} ${bodyText}`);
    if (mentioned.length) pool = mentioned;
  }
  if (pool.length > 1) {
    const active = pool.filter((j) => j.status !== "todo");
    if (active.length) pool = active;
  }
  return pool.length === 1 ? { job: pool[0] } : { ambiguous: pool.slice(0, 10) };
}

const ROLE_NOISE = new Set(["intern", "internship", "summer", "spring", "winter", "fall", "autumn", "program", "programme",
  "analyst", "associate", "student", "placement", "year", "and", "for", "with", "the"]);

function bestRoleMatches(jobs, text) {
  let best = 0;
  let out = [];
  for (const job of jobs) {
    const words = companyWords(job.role).filter((w) => w.length >= 3 && !ROLE_NOISE.has(w) && !/^\d+$/.test(w));
    const hits = words.filter((w) => text.includes(` ${w} `)).length;
    if (hits > best) {
      best = hits;
      out = [job];
    } else if (hits === best && hits > 0) out.push(job);
  }
  return out;
}

// Email label -> board status. Assessments and interviews keep the role at
// "applied"; the event log records the stage.
export const STATUS_FOR = {
  received: "applied",
  assessment_invite: "applied",
  interview: "applied",
  offer: "offer",
  rejected: "rejected",
};
export const STATUS_RANK = { todo: 0, applied: 1, rejected: 2, offer: 3 };

/** The new status for `label`, or null if it wouldn't move `current` forward. */
export function forwardStatus(current, label) {
  const next = STATUS_FOR[label];
  if (!next) return null;
  return (STATUS_RANK[next] ?? -1) > (STATUS_RANK[current] ?? 0) ? next : null;
}
