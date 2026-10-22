// Plain ESM so both the Next.js app and the Node scripts (scripts/ingest.mjs)
// share one dedupe rule.

/**
 * Canonical form used for dedupe: http(s) only, no #fragment, no utm_* params,
 * no trailing slash.
 * @param {string} raw
 * @returns {string | null}
 */
export function normalizeLink(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  url.hash = "";
  const tracking = [...url.searchParams.keys()].filter((k) => /^utm_/i.test(k));
  for (const key of tracking) url.searchParams.delete(key);
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString();
}
