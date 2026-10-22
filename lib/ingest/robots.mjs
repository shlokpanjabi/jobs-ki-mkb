// Minimal robots.txt parser following RFC 9309: the group for our product token
// (or `*`) applies, the longest matching rule wins, and Allow wins a tie.
// `*` and `$` are supported in paths. Crawl-delay is non-standard but honoured.

const MAX_BYTES = 500 * 1024; // RFC 9309 asks parsers to handle at least 500 KiB

/**
 * @typedef {{ allow: boolean, pattern: string }} Rule
 * @typedef {{ rules: Rule[], crawlDelay: number | null, reason?: string }} Policy
 */

/**
 * @param {string} text robots.txt body
 * @param {string} token our product token, e.g. "ApplyTrackerBot"
 * @returns {Policy}
 */
export function parseRobots(text, token) {
  const groups = []; // { agents: string[], rules: Rule[], crawlDelay }
  let current = null;
  let lastWasAgent = false;

  for (const rawLine of text.slice(0, MAX_BYTES).split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (key === "user-agent") {
      if (!lastWasAgent) {
        current = { agents: [], rules: [], crawlDelay: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue; // rules before any user-agent line are ignored
    if ((key === "allow" || key === "disallow") && value) {
      current.rules.push({ allow: key === "allow", pattern: value });
    } else if (key === "crawl-delay") {
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds >= 0) current.crawlDelay = seconds;
    }
  }

  const ours = token.toLowerCase();
  let matched = groups.filter((g) => g.agents.some((a) => a !== "*" && ours.includes(a)));
  if (!matched.length) matched = groups.filter((g) => g.agents.includes("*"));

  const delays = matched.map((g) => g.crawlDelay).filter((d) => d !== null);
  return {
    rules: matched.flatMap((g) => g.rules),
    crawlDelay: delays.length ? Math.max(...delays) : null,
  };
}

/** @type {Policy} */
export const ALLOW_ALL = { rules: [], crawlDelay: null };
/** @type {Policy} */
export const DISALLOW_ALL = { rules: [{ allow: false, pattern: "/" }], crawlDelay: null };

/**
 * @param {Policy} policy
 * @param {string} pathAndQuery e.g. "/jobs?q=intern"
 */
export function isAllowed(policy, pathAndQuery) {
  let best = null;
  for (const rule of policy.rules) {
    if (!matches(rule.pattern, pathAndQuery)) continue;
    const length = rule.pattern.length;
    if (!best || length > best.length || (length === best.length && rule.allow)) {
      best = { length, allow: rule.allow };
    }
  }
  return best ? best.allow : true;
}

function matches(pattern, path) {
  const anchored = pattern.endsWith("$");
  const body = safeDecode(anchored ? pattern.slice(0, -1) : pattern);
  const regex = body
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${regex}${anchored ? "$" : ""}`).test(safeDecode(path));
}

function safeDecode(path) {
  try {
    return decodeURI(path);
  } catch {
    return path;
  }
}
