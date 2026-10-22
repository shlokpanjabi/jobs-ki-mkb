// Polite HTTP for the ingest sources: identifies itself, checks robots.txt
// before every request, and spaces requests to the same host.
import { ALLOW_ALL, DISALLOW_ALL, isAllowed, parseRobots } from "./robots.mjs";

export const BOT_TOKEN = "ApplyTrackerBot";
const DEFAULT_USER_AGENT = `${BOT_TOKEN}/1.0 (+https://github.com/shlokpanjabi/jobs-ki-mkb)`;
const MIN_INTERVAL_MS = 2_000; // between requests to one host, unless Crawl-delay asks for more
const MAX_CRAWL_DELAY_MS = 30_000;
const TIMEOUT_MS = 20_000;
const MAX_RETRY_WAIT_MS = 30_000;

export class HttpError extends Error {
  /** @param {string} message @param {number | null} status */
  constructor(message, status = null) {
    super(message);
    this.status = status;
  }
}

/**
 * @param {{ userAgent?: string, minIntervalMs?: number, fetchImpl?: typeof fetch }} [options]
 */
export function createFetcher(options = {}) {
  const userAgent = options.userAgent || process.env.INGEST_USER_AGENT || DEFAULT_USER_AGENT;
  const minIntervalMs = options.minIntervalMs ?? MIN_INTERVAL_MS;
  const fetchImpl = options.fetchImpl ?? fetch;

  const robots = new Map(); // origin -> Promise<Policy>
  const hosts = new Map(); // host -> { queue: Promise, nextAt: number }

  // Runs `task` after every earlier request to the same host has finished and
  // the host's interval has passed.
  function throttled(host, intervalMs, task) {
    const state = hosts.get(host) ?? { queue: Promise.resolve(), nextAt: 0 };
    hosts.set(host, state);
    const run = state.queue.then(async () => {
      const wait = state.nextAt - Date.now();
      if (wait > 0) await sleep(wait);
      try {
        return await task();
      } finally {
        state.nextAt = Date.now() + intervalMs;
      }
    });
    state.queue = run.catch(() => {});
    return run;
  }

  async function rawGet(url, accept, intervalMs) {
    return throttled(url.host, intervalMs, () =>
      fetchImpl(url, {
        headers: { "User-Agent": userAgent, Accept: accept },
        redirect: "follow",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      }),
    );
  }

  // RFC 9309: a missing robots.txt allows everything; one that can't be read
  // means "assume disallowed". We also treat 401/403 as disallowed.
  function policyFor(url) {
    if (!robots.has(url.origin)) {
      const blocked = (why) => ({ ...DISALLOW_ALL, reason: `not crawling ${url.origin}: ${why}` });
      const loaded = (async () => {
        let res;
        try {
          res = await rawGet(new URL("/robots.txt", url.origin), "text/plain", minIntervalMs);
        } catch (err) {
          return blocked(`robots.txt unreachable (${err instanceof Error ? err.message : "request failed"})`);
        }
        if (res.ok) return parseRobots(await res.text(), BOT_TOKEN);
        await discard(res);
        if (res.status === 401 || res.status === 403 || res.status === 429 || res.status >= 500) {
          return blocked(`robots.txt returned HTTP ${res.status}`);
        }
        return ALLOW_ALL;
      })();
      robots.set(url.origin, loaded);
    }
    return robots.get(url.origin);
  }

  /**
   * GET a URL as text. Throws HttpError when robots.txt disallows it or the
   * response isn't 2xx. Retries once on 429/503, honouring Retry-After.
   * @param {string} target
   * @param {{ accept?: string }} [opts]
   * @returns {Promise<string>}
   */
  async function fetchText(target, opts = {}) {
    const url = new URL(target);
    const policy = await policyFor(url);
    if (!isAllowed(policy, url.pathname + url.search)) {
      throw new HttpError(policy.reason ?? `blocked by robots.txt: ${url.origin}${url.pathname}`);
    }
    const intervalMs = Math.max(
      minIntervalMs,
      Math.min((policy.crawlDelay ?? 0) * 1000, MAX_CRAWL_DELAY_MS),
    );
    const accept = opts.accept ?? "text/html,application/xhtml+xml";

    for (let attempt = 0; ; attempt++) {
      let res;
      try {
        res = await rawGet(url, accept, intervalMs);
      } catch (err) {
        throw new HttpError(`${url.host}: ${err instanceof Error ? err.message : "request failed"}`);
      }
      if (res.ok) return res.text();
      await discard(res);
      if ((res.status === 429 || res.status === 503) && attempt === 0) {
        await sleep(retryAfterMs(res.headers.get("retry-after")));
        continue;
      }
      throw new HttpError(`HTTP ${res.status} from ${url.origin}${url.pathname}`, res.status);
    }
  }

  return { fetchText, userAgent };
}

function retryAfterMs(header) {
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_RETRY_WAIT_MS);
  const at = header ? Date.parse(header) : NaN;
  if (!Number.isNaN(at)) return Math.min(Math.max(at - Date.now(), 0), MAX_RETRY_WAIT_MS);
  return 10_000;
}

async function discard(res) {
  await res.body?.cancel().catch(() => {});
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
