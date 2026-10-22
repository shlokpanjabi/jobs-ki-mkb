// Runs every source, normalises what they found, dedupes by normalised link and
// saves each job (lib/ingest/store.mjs upserts it into Postgres by link).
// Shared by scripts/ingest.mjs and the /api/cron/ingest route.
import * as gradcracker from "./gradcracker.mjs";
import { createFetcher } from "./http.mjs";
import * as indeed from "./indeed.mjs";
import * as luma from "./luma.mjs";
import { normaliseJob, todayISO } from "./normalise.mjs";

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
 *   jobs?: Job[] }} Summary
 */

/** @type {Source[]} */
export const SOURCES = [gradcracker, indeed, luma];

const SAVE_CONCURRENCY = 4;
const MAX_FAILURES_IN_A_ROW = 5; // then assume the database is down and stop

/**
 * Sources by name ("gradcracker,luma"); all of them when empty.
 * @param {string | string[] | null | undefined} names
 * @returns {Source[]}
 */
export function selectSources(names) {
  const wanted = (Array.isArray(names) ? names : (names ?? "").split(","))
    .map((n) => n.trim().toLowerCase())
    .filter(Boolean);
  if (!wanted.length) return SOURCES;
  const unknown = wanted.filter((n) => !SOURCES.some((s) => s.name === n));
  if (unknown.length) {
    throw new Error(`Unknown source(s): ${unknown.join(", ")}. Known: ${SOURCES.map((s) => s.name).join(", ")}`);
  }
  return SOURCES.filter((s) => wanted.includes(s.name));
}

/**
 * @param {{
 *   sources?: Source[], dryRun?: boolean,
 *   save?: (job: Job) => Promise<{ created: boolean }>,
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
  const queue = [];
  const seen = new Set();
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
      queue.push({ job: normalised.job, stat });
    }
  });

  if (dryRun) {
    for (const { job, stat } of queue) {
      stat.new++;
      log(
        `[${stat.source}] ${job.company} | ${job.role} | ${job.type} | ${job.domain ?? "-"} | ` +
          `${job.location ?? "-"} (${job.region ?? "-"}) | deadline ${job.deadline ?? "rolling"} | ${job.link}`,
      );
    }
    return finish({ dryRun, fatal: null, stats, jobs: queue.map((q) => q.job) });
  }

  // 3. Save with a few writes in flight. Several failures in a row mean the
  //    database is unreachable, so the run stops instead of failing every job.
  let fatal = null;
  let next = 0;
  let saveFailures = 0;
  let inARow = 0;
  async function worker() {
    while (next < queue.length) {
      const { job, stat } = queue[next++];
      if (fatal) {
        stat.failed++;
        saveFailures++;
        continue;
      }
      try {
        const { created } = await save(job);
        inARow = 0;
        if (created) stat.new++;
        else stat.skipped++; // already in the tracker (its details are refreshed)
      } catch (err) {
        stat.failed++;
        saveFailures++;
        log(`[${stat.source}] save failed for ${job.link}: ${errorMessage(err)}`);
        if (++inARow >= MAX_FAILURES_IN_A_ROW) fatal = `${inARow} saves failed in a row, last: ${errorMessage(err)}`;
      }
    }
  }
  await Promise.all(Array.from({ length: SAVE_CONCURRENCY }, worker));
  if (fatal) log(`aborted: ${fatal}`);
  return finish({ dryRun, fatal, stats, saveFailures });
}

function finish({ dryRun, fatal, stats, jobs, saveFailures = 0 }) {
  const ok = !fatal && saveFailures === 0 && stats.every((s) => !s.error);
  return { ok, dryRun, fatal, sources: stats, ...(jobs ? { jobs } : {}) };
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
  if (summary.dryRun) lines.push("(dry run: nothing was saved, and links weren't checked against the tracker)");
  if (summary.fatal) lines.push(`aborted: ${summary.fatal}`);
  return lines.join("\n");
}

function errorMessage(err) {
  return err instanceof Error ? err.message : String(err);
}
