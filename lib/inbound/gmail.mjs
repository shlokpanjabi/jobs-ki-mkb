// "Open in Gmail" links for a recorded email. Plain ESM with no imports so the
// board (client code) and the server share it. Nothing here needs the body:
// links point at the person's own Gmail, where the original email and its
// links (assessments, booking pages) still are.

const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

/** A Gmail address as typed on Settings, or null if it isn't one. */
export function normalizeGmailAccount(raw) {
  const s = String(raw ?? "").trim().toLowerCase();
  return EMAIL.test(s) && s.length <= 254 ? s : null;
}

/**
 * Link to find one email in the person's Gmail, or null when their Gmail
 * account isn't set (never guessed, and never /u/0, which is whichever account
 * the browser signed into first).
 *
 * With a verified original Message-ID the search is rfc822msgid:, which finds
 * that one message (`exact`). Otherwise it's a from-domain + subject search,
 * which can match more than one email, so it's labelled as a search.
 *
 * @param {string | null | undefined} account
 * @param {{ messageId?: string | null, senderDomain?: string | null, subject?: string | null }} email
 * @returns {{ url: string, exact: boolean } | null}
 */
export function gmailLink(account, { messageId, senderDomain, subject }) {
  const user = normalizeGmailAccount(account);
  if (!user) return null;
  let query;
  let exact = false;
  const id = messageId?.trim().replace(/^<|>$/g, "");
  if (id && /^[^\s<>@]+@[^\s<>@]+$/.test(id)) {
    query = `rfc822msgid:${id}`;
    exact = true;
  } else {
    const parts = [];
    if (senderDomain && /^[a-z0-9.-]+$/i.test(senderDomain)) parts.push(`from:${senderDomain}`);
    // Quotes would end the phrase early; Gmail ignores most punctuation anyway.
    const words = String(subject ?? "").replace(/["\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 150);
    if (words) parts.push(`subject:"${words}"`);
    if (!parts.length) return null;
    query = parts.join(" ");
  }
  const url = `https://mail.google.com/mail/?authuser=${encodeURIComponent(user)}#search/${encodeURIComponent(query)}`;
  return { url, exact };
}
