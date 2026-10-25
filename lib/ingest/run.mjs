// Runs every source, normalises what they found, dedupes by normalised link and
// saves each job (lib/ingest/store.mjs upserts it into Postgres by link).
// Shared by scripts/ingest.mjs and the /api/cron/ingest route.
import * as companyBoards from "./company-boards.mjs";
import * as gradcracker from "./gradcracker.mjs";
import { createFetcher } from "./http.mjs";
import * as indeed from "./indeed.mjs";
import * as linkedinPosts from "./linkedin-posts.mjs";
import * as luma from "./luma.mjs";
import { normaliseJob, todayISO } from "./normalise.mjs";
import * as northwestern from "./northwestern.mjs";
import * as sheets from "./sheets.mjs";
import * as simplify from "./simplify.mjs";
import * as speedyapply from "./speedyapply.mjs";
import { brightNetwork, internshala, prospleUk } from "./uk-boards.mjs";

/**
 * @typedef {import("./normalise.mjs").Job} Job
 * @typedef {{
 *   fetchText: (url: string, opts?: { accept?: string }) => Promise<string>,
 *   warn: (message: string) => void,
 * }} SourceContext
 * @typedef {{ name: string, fetchJobs: (ctx: SourceContext) => Promise<Record<string, unknown>[]> }} Source
 * @typedef {{ source: string, found: number, new: number, skipped: number, failed: number,
 *   error: string | null, warnings: string[] }} SourceStats
 * @typedef {{ ok: boolean, dryRun: boolean, fatal: string | null, sources: SourceStats[],
 *   shownTo?: Record<string, number>, jobs?: Job[] }} Summary
 */

// Order matters only for duplicates: the first source to list a link wins, so
// your own sheets go first.
/** @type {Source[]} */
export const SOURCES = [sheets, northwestern, simplify, speedyapply, internshala, luma];

// Run by their own nightly cron jobs (vercel.json), each with its own 300 s:
// together with the main sources they wouldn't fit in one function run.
// "all" selects these and SOURCES together, e.g. npm run ingest -- --source=all.
/** @type {Source[]} */
export const SEPARATE_SOURCES = [companyBoards, linkedinPosts];

// Not run by default: in production (October 2026) these refused automated
// requests (Gradcracker and Indeed answered 403, Bright Network and Prosple
// return 403 for robots.txt, Indeed's robots.txt disallows its feed). They can
// still be run by name, e.g. INGEST_SOURCES=simplify,gradcracker, in case a
// site opens up.
/** @type {Source[]} */
export const BLOCKED_SOURCES = [gradcracker, brightNetwork, prospleUk, indeed];
const ALL_SOURCES = [...SOURCES, ...SEPARATE_SOURCES, ...BLOCKED_SOURCES];

const SAVE_BATCH = 200;
const MAX_FAILURES_IN_A_ROW = 3; // batches; then assume the database is down and stop

/**
 * Sources by name ("simplify,luma"); the default SOURCES when empty; "all"
 * for SOURCES plus SEPARATE_SOURCES.
 * @param {string | string[] | null | undefined} names
 * @returns {Source[]}
 */
export function selectSources(names) {
  const wanted = (Array.isArray(names) ? names : (names ?? "").split(","))
    .map((n) => n.trim().toLowerCase())
    .filter(Boolean);
  if (!wanted.length) return SOURCES;
  if (wanted.length === 1 && wanted[0] === "all") return [...SOURCES, ...SEPARATE_SOURCES];
  const unknown = wanted.filter((n) => !ALL_SOURCES.some((s) => s.name === n));
  if (unknown.length) {
    throw new Error(`Unknown source(s): ${unknown.join(", ")}. Known: ${ALL_SOURCES.map((s) => s.name).join(", ")}`);
  }
  return ALL_SOURCES.filter((s) => wanted.includes(s.name));
}

/**
 * @param {{
 *   sources?: Source[], dryRun?: boolean,
 *   save?: (batch: { job: Job, users: string[] | null }[]) => Promise<boolean[]>,
 *   audience?: (job: Job, details: { text: string, degrees: string[] }) => string[],
 *   log?: (line: string) => void, today?: string,
 *   fetcher?: { fetchText: SourceContext["fetchText"] },
 * }} options
 * @returns {Promise<Summary>}
 */
export async function runIngest(options) {
  const {
    sources = SOURCES,
    dryRun = false,
    save,
    audience,
    log = console.log,
    today = todayISO(),
    fetcher = createFetcher(),
  } = options;
  if (!dryRun && !save) throw new Error("runIngest needs a save function unless dryRun is set");

  /** @type {SourceStats[]} */
  const stats = sources.map((s) => ({
    source: s.name, found: 0, new: 0, skipped: 0, failed: 0, error: null, warnings: [],
  }));

  // 1. Fetch. Sources run concurrently (they hit different hosts; the fetcher
  //    still spaces requests per host) and a rejection only affects its own source.
  const results = await Promise.allSettled(
    sources.map(async (source, i) => {
      /** @type {SourceContext} */
      const ctx = {
        fetchText: fetcher.fetchText,
        warn(message) {
          stats[i].failed++;
          stats[i].warnings.push(message);
          log(`[${source.name}] warning: ${message}`);
        },
      };
      const jobs = await source.fetchJobs(ctx);
      if (!Array.isArray(jobs)) throw new Error("source did not return an array");
      return jobs;
    }),
  );

  // 2. Normalise and dedupe across sources; the first source to list a link wins.
  //    `audience` decides who sees each job (null = everyone).
  const queue = [];
  const seen = new Set();
  /** @type {Record<string, number>} */
  const shownTo = {};
  results.forEach((result, i) => {
    const stat = stats[i];
    if (result.status === "rejected") {
      stat.error = errorMessage(result.reason);
      log(`[${stat.source}] failed: ${stat.error}`);
      return;
    }
    stat.found = result.value.length;
    for (const raw of result.value) {
      const normalised = normaliseJob(raw && typeof raw === "object" ? raw : {}, today);
      if ("skip" in normalised || seen.has(normalised.job.link)) {
        stat.skipped++;
        continue;
      }
      seen.add(normalised.job.link);
      const users = audience ? audience(normalised.job, normalised.details) : null;
      for (const u of users ?? []) shownTo[u] = (shownTo[u] ?? 0) + 1;
      queue.push({ job: normalised.job, stat, users });
    }
  });

  const extra = audience ? { shownTo } : {};
  if (dryRun) {
    for (const { job, stat, users } of queue) {
      if (users && !users.length) {
        stat.skipped++; // nobody is eligible
        continue;
      }
      stat.new++;
      log(
        `[${stat.source}] ${job.company} | ${job.role} | ${job.type} | ${job.domain ?? "-"} | ` +
          `${job.location ?? "-"} (${job.region ?? "-"}) | deadline ${job.deadline ?? "rolling"} | ${job.link}` +
          (users ? ` | for ${users.join(", ")}` : ""),
      );
    }
    const jobs = queue.filter((q) => !q.users || q.users.length).map((q) => q.job);
    return finish({ dryRun, fatal: null, stats, jobs, ...extra });
  }

  // 3. Save in batches: one database round trip per batch, not per job, so a
  //    few thousand jobs fit well inside a serverless time limit. Jobs nobody
  //    is eligible for are still sent, so ones ingested earlier are hidden.
  //    Repeated batch failures mean the database is down, so the run stops.
  let fatal = null;
  let saveFailures = 0;
  let inARow = 0;
  for (let i = 0; i < queue.length; i += SAVE_BATCH) {
    const batch = queue.slice(i, i + SAVE_BATCH);
    if (fatal) {
      for (const { stat } of batch) stat.failed++;
      saveFailures += batch.length;
      continue;
    }
    try {
      const created = await save(batch.map(({ job, users }) => ({ job, users })));
      inARow = 0;
      batch.forEach(({ stat }, k) => {
        if (created[k]) stat.new++;
        else stat.skipped++; // already in the tracker (details refreshed), or nobody eligible
      });
    } catch (err) {
      for (const { stat } of batch) stat.failed++;
      saveFailures += batch.length;
      log(`save failed for ${batch.length} jobs (${batch[0].job.link} …): ${errorMessage(err)}`);
      if (++inARow >= MAX_FAILURES_IN_A_ROW) fatal = `${inARow} batches failed in a row, last: ${errorMessage(err)}`;
    }
  }
  if (fatal) log(`aborted: ${fatal}`);
  return finish({ dryRun, fatal, stats, saveFailures, ...extra });
}

function finish({ dryRun, fatal, stats, jobs, shownTo, saveFailures = 0 }) {
  const ok = !fatal && saveFailures === 0 && stats.every((s) => !s.error);
  return { ok, dryRun, fatal, sources: stats, ...(shownTo ? { shownTo } : {}), ...(jobs ? { jobs } : {}) };
}

/**
 * One line per source, e.g. for logs.
 * @param {Summary} summary
 */
export function formatSummary(summary) {
  const header = ["source", "found", summary.dryRun ? "to save" : "new", "skipped", "failed"];
  const rows = summary.sources.map((s) => [s.source, s.found, s.new, s.skipped, s.failed, s.error ? `ERROR: ${s.error}` : ""]);
  const width = (col) => Math.max(...[header, ...rows].map((r) => String(r[col]).length));
  const line = (r) =>
    r
      .slice(0, 5)
      .map((v, col) => (col === 0 ? String(v).padEnd(width(col)) : String(v).padStart(width(col))))
      .join("  ") + (r[5] ? `  ${r[5]}` : "");
  const lines = [line(header), ...rows.map(line)];
  if (summary.shownTo) {
    const counts = Object.entries(summary.shownTo).map(([u, n]) => `${u} ${n}`);
    lines.push(`shown to (jobs found this run): ${counts.join(" · ") || "nobody"}`);
  }
  if (summary.dryRun) lines.push("(dry run: nothing was saved, and links weren't checked against the tracker)");
  if (summary.fatal) lines.push(`aborted: ${summary.fatal}`);
  return lines.join("\n");
}

function errorMessage(err) {
  return err instanceof Error ? err.message : String(err);
}
