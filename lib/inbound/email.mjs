// Reading the parts of a received email that status sync needs. Nothing here
// stores or logs the body; callers keep only subject, date and sender domain.
import { decodeEntities } from "../ingest/html.mjs";

export const INBOUND_DOMAIN = process.env.INBOUND_EMAIL_DOMAIN || "uestuuchue.resend.app";

/** @param {string} token */
export function forwardingAddress(token, domain = INBOUND_DOMAIN) {
  return `track+${token}@${domain}`;
}

/**
 * The user token from the first track+<token>@ address among `values`
 * (recipient lists and header values). Case-insensitive; tokens are lower-case.
 * @param {unknown[]} values
 */
export function tokenFrom(values) {
  for (const v of values.flat()) {
    const m = /\btrack\+([a-z0-9]{16,64})@/i.exec(String(v ?? ""));
    if (m) return m[1].toLowerCase();
  }
  return null;
}

/** "Acme Careers <jobs@careers.acme.com>" -> { name, address, domain } */
export function parseAddress(raw) {
  const s = String(raw ?? "").trim();
  const angle = /^(.*?)<([^>]+)>\s*$/.exec(s);
  const address = (angle ? angle[2] : s).trim().toLowerCase();
  const name = angle ? angle[1].trim().replace(/^"|"$/g, "") : "";
  const domain = /@([a-z0-9.-]+)$/i.exec(address)?.[1] ?? null;
  return { name, address, domain };
}

/** Plain text of an email, keeping line breaks (forwarded headers are line-based). */
export function bodyText({ text, html }) {
  if (typeof text === "string" && text.trim()) return text;
  if (typeof html !== "string") return "";
  const withBreaks = html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<[^>]*>/g, " ");
  return decodeEntities(withBreaks)
    .replace(/[ \t ]+/g, " ")
    .replace(/\n\s*\n+/g, "\n");
}

const FORWARD_MARKERS = /-{5,}\s*Forwarded message\s*-{5,}|Begin forwarded message:|-{3,}\s*Original Message\s*-{3,}/i;

/**
 * Gmail filters forward with the original From and Subject, but a hand-forwarded
 * email has the user as sender; in that case read the quoted original headers.
 * @param {{ from: string, subject: string, text: string }} email
 */
export function unwrapForwarded({ from, subject, text }) {
  const at = text.search(FORWARD_MARKERS);
  if (at === -1) return { from, subject: stripPrefixes(subject), text };
  const quoted = text.slice(at);
  const header = (name) => new RegExp(`^\\s*${name}:\\s*(.+)$`, "im").exec(quoted)?.[1]?.trim();
  return {
    from: header("From") ?? from,
    subject: stripPrefixes(header("Subject") ?? subject),
    text: quoted,
  };
}

function stripPrefixes(subject) {
  return String(subject ?? "").replace(/^\s*((fwd?|fw|re)\s*:\s*)+/i, "").trim();
}

/**
 * Gmail's "Gmail Forwarding Confirmation" email, sent to a new forwarding
 * address. Returns its code and confirmation link, or null.
 * @param {{ from: string, subject: string, text: string, html?: string | null }} email
 */
export function gmailConfirmation({ from, subject, text, html }) {
  if (parseAddress(from).address !== "forwarding-noreply@google.com") return null;
  const code = /\(#(\d{6,12})\)/.exec(subject ?? "")?.[1] ?? /confirmation code:\s*(\d{6,12})/i.exec(text)?.[1] ?? null;
  const source = `${text}\n${html ?? ""}`;
  const url = /https:\/\/(?:mail-settings|mail)\.google\.com\/mail\/[^\s"'<>]+/.exec(source)?.[0];
  return code || url ? { code, url: url ? decodeEntities(url) : null } : null;
}

/** Header value by case-insensitive name. @param {Record<string, string> | null | undefined} headers */
export function header(headers, name) {
  if (!headers) return null;
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? String(headers[key]) : null;
}
