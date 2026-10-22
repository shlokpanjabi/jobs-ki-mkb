// Dependency-free extraction helpers. They read structured data (JSON-LD,
// embedded JSON, RSS) instead of CSS classes where possible, because
// structured data changes far less often than page markup.

const NAMED_ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—",
  pound: "£", euro: "€", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", hellip: "…",
};

/** @param {string} text */
export function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : match;
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? match;
  });
}

/** Strips tags, decodes entities and collapses whitespace. @param {unknown} value */
export function cleanText(value) {
  if (typeof value !== "string") return "";
  return decodeEntities(value.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

/**
 * Every JSON-LD object on the page, with arrays and @graph flattened.
 * @param {string} html
 * @returns {Record<string, any>[]}
 */
export function jsonLd(html) {
  const out = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const [, body] of html.matchAll(re)) {
    let data;
    try {
      data = JSON.parse(body.trim());
    } catch {
      continue;
    }
    const stack = [data];
    while (stack.length) {
      const node = stack.pop();
      if (Array.isArray(node)) stack.push(...node);
      else if (node && typeof node === "object") {
        out.push(node);
        if (Array.isArray(node["@graph"])) stack.push(...node["@graph"]);
      }
    }
  }
  return out;
}

/** @param {Record<string, any>} node @param {string} type */
export function hasType(node, type) {
  const t = node["@type"];
  return Array.isArray(t) ? t.includes(type) : t === type;
}

/**
 * Parses the JSON object literal that follows `marker` in `text`, e.g. the
 * value of `window.foo = {...};`. Returns null if there isn't one.
 * @param {string} text
 * @param {string} marker
 */
export function jsonAfter(text, marker) {
  const at = text.indexOf(marker);
  if (at === -1) return null;
  const start = text.indexOf("{", at + marker.length);
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) {
      try {
        return JSON.parse(text.slice(start, i + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** The `__NEXT_DATA__` payload of a Next.js page, or null. @param {string} html */
export function nextData(html) {
  const m = /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i.exec(html);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

/**
 * RSS 2.0 items as plain objects of their child elements' text.
 * @param {string} xml
 * @returns {Record<string, string>[]}
 */
export function rssItems(xml) {
  const items = [];
  for (const [, body] of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const item = {};
    for (const [, tag, value] of body.matchAll(/<([a-z][\w:.-]*)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
      const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(value);
      item[tag.toLowerCase()] = cdata ? cdata[1].trim() : decodeEntities(value.trim());
    }
    items.push(item);
  }
  return items;
}

/** All href values on the page, resolved against `base`. @param {string} html @param {string} base */
export function links(html, base) {
  const out = new Set();
  for (const [, href] of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    try {
      const url = new URL(decodeEntities(href), base);
      url.hash = "";
      out.add(url.toString());
    } catch {
      // ignore malformed hrefs
    }
  }
  return [...out];
}
