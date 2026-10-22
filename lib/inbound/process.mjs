// One Resend `email.received` event, end to end: find the user from the
// track+<token> address, fetch the email, classify it, match it to one of the
// user's jobs, and record it (moving the status forward) or park it in the Inbox.
import { classify, LABELS } from "./classify.mjs";
import { eventExists, jobsForUser, recordEvent, saveGmailConfirmation, userForToken } from "./db.mjs";
import { bodyText, gmailConfirmation, header, parseAddress, tokenFrom, unwrapForwarded } from "./email.mjs";
import { matchJob } from "./match.mjs";

/**
 * @param {{
 *   sql: import("postgres").Sql,
 *   event: any,
 *   fetchEmail: (id: string) => Promise<any>,
 *   llm: ((email: { senderDomain: string | null, subject: string, text: string }) => Promise<string | null>) | null,
 *   dryRun?: boolean,
 *   log?: (line: string) => void,
 * }} options
 */
export async function processInboundEvent({ sql, event, fetchEmail, llm, dryRun = false, log = console.log }) {
  if (event?.type !== "email.received") return { outcome: "ignored", reason: `event type ${event?.type ?? "missing"}` };
  const id = event.data?.email_id;
  if (typeof id !== "string" || !id) return { outcome: "ignored", reason: "no email_id" };
  if (!dryRun && (await eventExists(sql, id))) return { outcome: "duplicate", emailId: id };

  // The webhook carries metadata only; the body comes from the Received Emails API.
  const email = await fetchEmail(id);
  const token = tokenFrom([
    email.received_for, event.data.received_for, email.to, event.data.to, email.cc, email.bcc,
    Object.values(email.headers ?? {}),
  ].filter(Boolean));
  const userId = token ? await userForToken(sql, token) : null;
  if (!userId) return { outcome: "ignored", reason: "no known forwarding address", emailId: id };

  const text = bodyText(email);
  const confirmation = gmailConfirmation({ from: email.from, subject: email.subject, text, html: email.html });
  if (confirmation) {
    // Saved even in a dry run: it's setup, not a status change.
    await saveGmailConfirmation(sql, userId, confirmation);
    log(`inbound ${id}: Gmail forwarding confirmation for ${userId}`);
    return { outcome: "gmail_confirmation", userId };
  }

  const original = unwrapForwarded({ from: email.from, subject: email.subject, text });
  const sender = parseAddress(original.from);
  const facts = { senderDomain: sender.domain, subject: original.subject, text: original.text };
  const { label, by } = await classify(facts, llm);
  const match = matchJob({ fromName: sender.name, ...facts }, await jobsForUser(sql, userId));

  // Only a confident label on a single matched job changes a status.
  const apply = "job" in match && by !== "none" && LABELS.includes(label);
  const date = Date.parse(header(email.headers, "date") ?? "") || Date.parse(email.created_at ?? "") || Date.now();
  const decision = {
    outcome: apply ? "matched" : "inbox",
    emailId: id,
    userId,
    label,
    by,
    jobId: "job" in match ? match.job.jobId : null,
    candidates: "ambiguous" in match ? match.ambiguous.map((j) => j.jobId) : [],
    dryRun,
  };
  if (dryRun) {
    log(`inbound ${id} (dry run): ${userId} ${label} by ${by} -> ${decision.outcome}${decision.jobId ? ` job ${decision.jobId}` : ""}`);
    return decision;
  }

  const change = await recordEvent(sql, {
    resendEmailId: id,
    userId,
    jobId: decision.jobId,
    apply,
    label,
    by,
    receivedAt: new Date(date),
    subject: original.subject,
    senderDomain: sender.domain,
  });
  if (change.duplicate) return { outcome: "duplicate", emailId: id };
  log(
    `inbound ${id}: ${userId} ${label} by ${by} -> ${decision.outcome}` +
      (decision.jobId ? ` job ${decision.jobId}` : "") +
      (change.next ? ` (${change.previous} -> ${change.next})` : ""),
  );
  return { ...decision, previousStatus: change.previous, newStatus: change.next };
}
