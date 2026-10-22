// Runs every source, normalises what they found, dedupes by normalised link and
// POSTs each job to /api/jobs (which dedupes again against the database).
// Shared by scripts/ingest.mjs and the /api/cron/ingest route.
import * as gradcracker from "./gradcracker.mjs";
import { createFetcher } from "./http.mjs";
import * as indeed from "./indeed.mjs";
import * as luma from "./luma.mjs";
import { normaliseJob, todayISO } from "./normalise.mjs";

/**
 * @typedef {{
 *   fetchText: (url: string, opts?: { accept?: string }) => Promise<string>,
 *   warn: (message: string) => void,
 * }} SourceContext
 * @typedef {{ name: string, fetchJobs: (ctx: SourceContext) => Promise<Record<string, unknown>[]> }} Source
 * @typedef {{ source: string, found: number, new: number, skipped: number, failed: number,
 *   error: string | null, warnings: string[] }} SourceStats
 * @typedef {{ ok: boolean, dryRun: boolean, fatal: string | null, sources: SourceStats[],
 *   jobs?: import("./normalise.mjs").Job[] }} Summary
 */

/** @type {Source[]} */
export const SOURCES = [gradcracker, indeed, luma];

const POST_CONCURRENCY = 4;
const POST_TIMEOUT_MS = 15_000;

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
 * Reads INGEST_SOURCES, INGEST_API_KEY and INGEST_BASE_URL.
 * @param {{ baseUrl?: string, sources?: string }} [defaults]
 */
export function ingestConfigFromEnv(defaults = {}) {
  return {
    sources: selectSources(defaults.sources ?? process.env.INGEST_SOURCES),
    // Comma-separated: each job is posted once per key, so it becomes
    // eligible for every key's owner.
    apiKeys: (process.env.INGEST_API_KEY ?? "").split(/[\s,]+/).filter(Boolean),
    baseUrl: process.env.INGEST_BASE_URL || defaults.baseUrl || "",
  };
}

/**
 * @param {{
 *   sources?: Source[], dryRun?: boolean, baseUrl?: string, apiKeys?: string[],
 *   log?: (line: string) => void, today?: string,
 *   fetcher?: { fetchText: SourceContext["fetchText"] }, fetchImpl?: typeof fetch,
 * }} options
 * @returns {Promise<Summary>}
 */
export async function runIngest(options) {
  const {
    sources = SOURCES,
    dryRun = false,
    baseUrl = "",
    apiKeys = [],
    log = console.log,
    today = todayISO(),
    fetcher = createFetcher(),
    fetchImpl = fetch,
  } = options;
  if (!dryRun && !baseUrl) throw new Error("INGEST_BASE_URL is not set (e.g. https://your-app.vercel.app)");
  if (!dryRun && !apiKeys.length) throw new Error("INGEST_API_KEY is not set (an atk_… key from `npm run keys`)");

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

  // 3. Post with a few requests in flight. A rejected key fails every request,
  //    so it stops the run instead of failing each job separately.
  const endpoint = new URL("/api/jobs", baseUrl).toString();
  let fatal = null;
  let next = 0;
  let postFailures = 0;
  async function worker() {
    while (next < queue.length) {
      const { job, stat } = queue[next++];
      if (fatal) {
        stat.failed++;
        postFailures++;
        continue;
      }
      let created = false;
      let failure = null;
      for (const key of apiKeys) {
        const outcome = await postJob(fetchImpl, endpoint, key, job);
        if (outcome.unauthorized) fatal = "POST /api/jobs returned 401: check INGEST_API_KEY";
        if (outcome.error) failure = outcome.error;
        if (outcome.created) created = true;
      }
      if (failure) {
        stat.failed++;
        postFailures++;
        if (!fatal) log(`[${stat.source}] post failed for ${job.link}: ${failure}`);
      } else if (created) stat.new++;
      else stat.skipped++; // already in the tracker
    }
  }
  await Promise.all(Array.from({ length: POST_CONCURRENCY }, worker));
  if (fatal) log(`aborted: ${fatal}`);
  return finish({ dryRun, fatal, stats, postFailures });
}

async function postJob(fetchImpl, endpoint, key, job) {
  let res;
  try {
    res = await fetchImpl(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(job),
      signal: AbortSignal.timeout(POST_TIMEOUT_MS),
    });
  } catch (err) {
    return { error: errorMessage(err) };
  }
  const body = await res.json().catch(() => ({}));
  if (res.status === 201) return { created: true };
  if (res.status === 200) return { created: false };
  if (res.status === 401) return { unauthorized: true, error: "HTTP 401" };
  const details = Array.isArray(body?.details) ? `: ${body.details.join("; ")}` : "";
  return { error: `HTTP ${res.status} ${body?.error ?? ""}${details}`.trim() };
}

function finish({ dryRun, fatal, stats, jobs, postFailures = 0 }) {
  const ok = !fatal && postFailures === 0 && stats.every((s) => !s.error);
  return { ok, dryRun, fatal, sources: stats, ...(jobs ? { jobs } : {}) };
}

/**
 * One line per source, e.g. for logs.
 * @param {Summary} summary
 */
export function formatSummary(summary) {
  const header = ["source", "found", summary.dryRun ? "to post" : "new", "skipped", "failed"];
  const rows = summary.sources.map((s) => [s.source, s.found, s.new, s.skipped, s.failed, s.error ? `ERROR: ${s.error}` : ""]);
  const width = (col) => Math.max(...[header, ...rows].map((r) => String(r[col]).length));
  const line = (r) =>
    r
      .slice(0, 5)
      .map((v, col) => (col === 0 ? String(v).padEnd(width(col)) : String(v).padStart(width(col))))
      .join("  ") + (r[5] ? `  ${r[5]}` : "");
  const lines = [line(header), ...rows.map(line)];
  if (summary.dryRun) lines.push("(dry run: nothing was posted, and links weren't checked against the tracker)");
  if (summary.fatal) lines.push(`aborted: ${summary.fatal}`);
  return lines.join("\n");
}

function errorMessage(err) {
  return err instanceof Error ? err.message : String(err);
}
