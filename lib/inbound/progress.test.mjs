// Application progress from email: stages, actions, Gmail links, manual and
// ambiguous matches, and adding a job from an email. Run with `npm test`; the
// database test needs TEST_DATABASE_URL (a scratch database with
// `npm run db:migrate` applied) and is skipped otherwise. Emails are made up.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import postgres from "postgres";
import { postingHref } from "../links.mjs";
import { actionsFor, explicitDue, extractActions } from "./actions.mjs";
import { addJobFromEmail, closeAction, forwardingToken, gmailAccount, matchManually, openActions, setGmailAccount } from "./db.mjs";
import { sourceMessageId } from "./email.mjs";
import { gmailLink, normalizeGmailAccount } from "./gmail.mjs";
import { decideProgress } from "./match.mjs";
import { processInboundEvent } from "./process.mjs";

test("board: Apply only opens the posting; Mark applied shows on every To do row", async () => {
  assert.equal(postingHref("https://jobs.acme.com/1"), "https://jobs.acme.com/1");
  assert.equal(postingHref(null), null); // jobs added from an email: no Apply link at all
  assert.equal(postingHref("javascript:alert(1)"), null);
  assert.equal(postingHref("42"), null); // an internal id is never a link

  // The board is a client component; check its source for the two rules.
  const source = await readFile(new URL("../../components/JobBoard.tsx", import.meta.url), "utf8");
  const apply = source.slice(source.indexOf("<a\n              href={href}"), source.indexOf("Apply ↗"));
  assert.ok(apply.length > 0, "Apply link not found");
  assert.ok(!/onClick|onStatus/.test(apply), "the Apply link must not change status");
  assert.match(source, /\{row\.status === "todo" \? \(\s*<button\s+onClick=\{\(\) => onStatus\(row\.id, "applied"\)\}/);
});

const at = (iso) => new Date(iso);
const state = (status, stage = null, statusSource = null, statusChangedAt = null) => ({ status, stage, statusSource, statusChangedAt });

test("progress: status and stage stay separate and only move forward", () => {
  assert.deepEqual(decideProgress(state("todo"), "received", at("2026-10-20")), { effect: "updated", status: "applied", stage: null });
  // An invitation sets Applied and the stage; it never says the step happened.
  assert.deepEqual(decideProgress(state("todo"), "assessment_invite", at("2026-10-20")), { effect: "updated", status: "applied", stage: "assessment_invited" });
  assert.deepEqual(decideProgress(state("applied", "assessment_invited"), "interview", at("2026-10-21")), { effect: "updated", status: null, stage: "interview_invited" });
  // Delayed emails don't downgrade.
  assert.equal(decideProgress(state("applied", "interview_invited"), "received", at("2026-10-01")).effect, "no_change");
  assert.equal(decideProgress(state("applied", "interview_invited"), "assessment_invite", at("2026-10-01")).effect, "stale");
  assert.equal(decideProgress(state("applied", "interview_invited"), "interview", at("2026-10-30")).effect, "no_change");
  assert.equal(decideProgress(state("rejected", null, "email", at("2026-10-20")), "received", at("2026-10-25")).effect, "stale");
  // Offers and rejections.
  assert.deepEqual(decideProgress(state("applied", "interview_invited"), "offer", at("2026-10-25")), { effect: "updated", status: "offer", stage: null });
  assert.deepEqual(decideProgress(state("rejected", null, "email", at("2026-10-20")), "offer", at("2026-10-25")).status, "offer");
});

test("progress: conflicting evidence and manual corrections are never overwritten", () => {
  // Newer news contradicting the outcome: flagged, nothing changes.
  assert.deepEqual(decideProgress(state("rejected", null, "email", at("2026-10-20")), "interview", at("2026-10-25")), { effect: "conflict", status: null, stage: null });
  assert.equal(decideProgress(state("offer", null, "email", at("2026-10-20")), "rejected", at("2026-10-25")).effect, "conflict");
  // The same email arriving late (sent before the rejection) is just stale.
  assert.equal(decideProgress(state("rejected", null, "email", at("2026-10-20")), "interview", at("2026-10-10")).effect, "stale");
  // A manual change after the email was sent wins, whichever way it went.
  assert.equal(decideProgress(state("todo", null, "manual", at("2026-10-22")), "received", at("2026-10-20")).effect, "kept_manual");
  assert.equal(decideProgress(state("applied", null, "manual", at("2026-10-22")), "interview", at("2026-10-20")).effect, "kept_manual");
  // An email sent after the manual change is new evidence.
  assert.equal(decideProgress(state("todo", null, "manual", at("2026-10-22")), "received", at("2026-10-23")).status, "applied");
});

test("actions: what the email asks for, with dates only when explicit and zones kept", () => {
  const ex = (subject, text) => extractActions({ subject, text });
  assert.deepEqual(
    actionsFor("assessment_invite", ex("Online assessment", "Please complete the test by 5 November 2026 at 11:59pm GMT.")),
    [{ kind: "complete_assessment", due: { date: "2026-11-05", time: "23:59", tz: "GMT" } }],
  );
  // A time without a zone is dropped; the date stays.
  assert.deepEqual(explicitDue(" 5 November 2026 at 17:00."), { date: "2026-11-05", time: null, tz: null });
  assert.deepEqual(explicitDue(" Thursday, 12 November 2026 at 2:30 PM BST"), { date: "2026-11-12", time: "14:30", tz: "BST" });
  assert.deepEqual(explicitDue(" 2026-11-05 17:00 UTC+1"), { date: "2026-11-05", time: "17:00", tz: "UTC+1" });
  // Uncertain dates stay blank: relative, numeric day/month, or no year.
  assert.equal(ex("Online test", "Please complete it within 5 days.").assessment.due, null);
  assert.equal(ex("Online test", "Please complete it by 05/11/2026.").assessment.due, null);
  assert.equal(ex("Online test", "Please complete it by 5 November.").assessment.due, null);
  // A date in another sentence isn't this deadline.
  assert.equal(ex("Online test", "Please complete it by the end of the week. We met on 1 October 2026.").assessment.due, null);

  // Interviews: book a slot, or attend at a stated time; nothing if neither is asked.
  assert.deepEqual(actionsFor("interview", ex("Interview invitation", "Please book a slot by 10 November 2026.")), [
    { kind: "book_interview", due: { date: "2026-11-10", time: null, tz: null } },
  ]);
  assert.deepEqual(actionsFor("interview", ex("Interview confirmed", "Your interview is scheduled for 12 November 2026 at 3pm BST.")), [
    { kind: "attend_interview", due: { date: "2026-11-12", time: "15:00", tz: "BST" } },
  ]);
  assert.deepEqual(actionsFor("interview", ex("Interview", "We'd like to invite you to interview. We'll be in touch.")), []);
  assert.deepEqual(actionsFor("received", ex("Thanks for applying", "Please book a slot")), []);
  assert.equal(ex("Reminder: your assessment", "").reminder, true);
  // Stored summaries never carry body text.
  assert.ok(!JSON.stringify(ex("Assessment", "secret-token-123 complete by 5 November 2026")).includes("secret-token"));
});

test("gmail links: the person's own account, exact only for a verified Message-ID", () => {
  assert.equal(gmailLink(null, { subject: "Hi" }), null); // never guessed
  assert.equal(gmailLink("not an email", { subject: "Hi" }), null);
  assert.equal(normalizeGmailAccount(" Shlok.Work@Gmail.com "), "shlok.work@gmail.com");

  const exact = gmailLink("me@gmail.com", { messageId: "<abc.123@mail.acme.com>", senderDomain: "acme.com", subject: "x" });
  assert.deepEqual(exact, {
    url: "https://mail.google.com/mail/?authuser=me%40gmail.com#search/rfc822msgid%3Aabc.123%40mail.acme.com",
    exact: true,
  });
  assert.ok(!exact.url.includes("/u/0"));

  const search = gmailLink("me@gmail.com", { messageId: null, senderDomain: "greenhouse.io", subject: 'Your "Acme" application & next steps' });
  assert.equal(search.exact, false);
  assert.equal(decodeURIComponent(search.url.split("#search/")[1]), 'from:greenhouse.io subject:"Your Acme application & next steps"');
  assert.ok(!search.url.split("#search/")[1].includes(" ")); // URL-encoded
});

test("Message-ID: the original's only for a Gmail filter forward, never a hand-forward's own", () => {
  const filterForward = { "Message-ID": "<orig-1@mail.acme.com>", "X-Forwarded-To": "track+abc@x.resend.app", "X-Forwarded-For": "me@gmail.com track+abc@x.resend.app" };
  assert.equal(sourceMessageId({ headers: filterForward, text: "Thanks for applying" }), "<orig-1@mail.acme.com>");
  // No sign of a Gmail filter forward: can't tell whose ID it is.
  assert.equal(sourceMessageId({ headers: { "Message-ID": "<x@y.com>" }, text: "Thanks" }), null);
  // Forwarded by hand: the Message-ID is the forward's, not the original's.
  assert.equal(
    sourceMessageId({ headers: { "message-id": "<fwd@mail.gmail.com>", "x-forwarded-to": "track+abc@x" }, text: "---------- Forwarded message ---------\nFrom: Acme" }),
    null,
  );
  assert.equal(sourceMessageId({ headers: { "message-id": "not-an-id", "x-forwarded-to": "a" }, text: "" }), null);
});

test("end to end: stages, actions, reminders, duplicates, manual and ambiguous matches, adding jobs", { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const sql = postgres(process.env.TEST_DATABASE_URL, { max: 3, onnotice() {} });
  const stamp = Date.now();
  const user = "muzzamil";
  const links = ["acme", "bolt-1", "bolt-2", "cobalt"].map((n) => `https://jobs.test/${n}-${stamp}`);
  const ids = {};
  const logs = [];
  try {
    const { token } = await forwardingToken(sql, user);
    for (const [key, company, role, link] of [
      ["acme", `Acme ${stamp}`, "Software Engineer Intern", links[0]],
      ["bolt1", `Bolt ${stamp}`, "Data Analyst Intern", links[1]],
      ["bolt2", `Bolt ${stamp}`, "Data Analyst Intern - Remote", links[2]],
      ["cobalt", `Cobalt ${stamp}`, "Security Intern", links[3]],
    ]) {
      const [{ id }] = await sql`insert into jobs (company, role, type, link) values (${company}, ${role}, 'internship', ${link}) returning id`;
      await sql`insert into user_jobs (job_id, user_id) values (${id}, ${user})`;
      ids[key] = id;
    }
    // Two Bolt listings with different dedupe keys (as if from two sources): an email can't tell them apart.
    await sql`update jobs set dedupe_key = ${`bolt-a-${stamp}`} where id = ${ids.bolt1}`;
    await sql`update jobs set dedupe_key = ${`bolt-b-${stamp}`} where id = ${ids.bolt2}`;

    const mails = {};
    const deliver = (n, mail) => {
      const emailId = `p-${stamp}-${n}`;
      mails[emailId] ??= {
        to: ["me@gmail.com"], received_for: [`track+${token}@uestuuchue.resend.app`], html: null,
        headers: { date: mail.date ?? "Mon, 19 Oct 2026 09:00:00 +0000", ...mail.headers }, ...mail,
      };
      return processInboundEvent({
        sql, event: { type: "email.received", data: { email_id: emailId } }, fetchEmail: async (i) => mails[i], llm: null,
        log: (l) => logs.push(l),
      });
    };
    const app = async (jobId) =>
      (await sql`select status, stage, status_source from user_jobs where user_id = ${user} and job_id = ${jobId}`)[0];
    const actions = async (jobId) =>
      (await sql`select kind, state, resolved_by, to_char(due_date, 'YYYY-MM-DD') as due, due_time, due_tz, reminders
                 from application_actions where user_id = ${user} and job_id = ${jobId} order by id`).map((r) => ({ ...r }));
    const acme = `Acme ${stamp}`;
    const forwarded = (id) => ({ "message-id": `<${id}-${stamp}@mail.acme.test>`, "x-forwarded-to": `track+${token}@uestuuchue.resend.app` });

    // Confirmation -> Applied.
    assert.equal((await deliver(1, { from: `${acme} <jobs@acme.test>`, subject: `Thank you for applying to ${acme}`, text: "" })).newStatus, "applied");

    // Assessment invitation -> Assessment invited + Complete assessment, deadline and zone as written.
    const invite = await deliver(2, {
      from: `${acme} <jobs@acme.test>`, subject: `${acme}: online assessment`, headers: forwarded("assess"),
      date: "Tue, 20 Oct 2026 09:00:00 +0000",
      text: "Please complete the online assessment by 5 November 2026 at 11:59pm GMT.",
    });
    assert.deepEqual([invite.effect, invite.newStage], ["updated", "assessment_invited"]);
    assert.deepEqual(await app(ids.acme), { status: "applied", stage: "assessment_invited", status_source: "email" });
    assert.deepEqual(await actions(ids.acme), [
      { kind: "complete_assessment", state: "open", resolved_by: null, due: "2026-11-05", due_time: "23:59", due_tz: "GMT", reminders: 0 },
    ]);

    // Webhook retry (same Resend id) and the same original email forwarded again (same Message-ID): no-ops.
    assert.equal((await deliver(2, {})).outcome, "duplicate");
    mails[`p-${stamp}-3`] = { ...mails[`p-${stamp}-2`] };
    assert.equal((await deliver(3, {})).outcome, "duplicate");

    // A reminder with a new deadline updates the same action; no second one.
    await deliver(4, {
      from: `${acme} <jobs@acme.test>`, subject: `Reminder: ${acme} online assessment`, date: "Wed, 28 Oct 2026 09:00:00 +0000",
      text: "Just a reminder: please complete the online assessment by 7 November 2026.",
    });
    const [reminded] = await actions(ids.acme);
    assert.deepEqual([reminded.due, reminded.due_time, reminded.reminders], ["2026-11-07", null, 1]);

    // A delayed confirmation (sent before everything else) doesn't reset the stage or the action.
    const late = await deliver(5, { from: `${acme} <jobs@acme.test>`, subject: `Thank you for applying to ${acme}`, text: "", date: "Sun, 18 Oct 2026 09:00:00 +0000" });
    assert.equal(late.effect, "no_change");
    assert.equal((await app(ids.acme)).stage, "assessment_invited");
    assert.equal((await actions(ids.acme)).filter((a) => a.state === "open").length, 1);

    // Interview invitation with a booking request -> Interview invited + Book interview; the assessment stays open.
    await deliver(6, {
      from: `${acme} <jobs@acme.test>`, subject: `${acme}: invitation to interview`, date: "Thu, 29 Oct 2026 09:00:00 +0000",
      text: "We would like to invite you to a first-round interview. Please book a slot in the scheduler.",
    });
    assert.equal((await app(ids.acme)).stage, "interview_invited");
    assert.deepEqual((await actions(ids.acme)).map((a) => [a.kind, a.state]), [["complete_assessment", "open"], ["book_interview", "open"]]);

    // Marking done; a later reminder doesn't reopen it.
    const assessmentId = (await sql`select id from application_actions where user_id = ${user} and job_id = ${ids.acme} and kind = 'complete_assessment'`)[0].id;
    assert.equal(await closeAction(sql, user, assessmentId, "done"), true);
    assert.equal(await closeAction(sql, "taran", assessmentId, "dismissed"), false); // not taran's
    await deliver(7, {
      from: `${acme} <jobs@acme.test>`, subject: `Reminder: ${acme} online assessment`, date: "Fri, 30 Oct 2026 09:00:00 +0000",
      text: "Please complete the online assessment.",
    });
    assert.deepEqual((await actions(ids.acme)).map((a) => [a.kind, a.state]), [["complete_assessment", "done"], ["book_interview", "open"]]);
    const open = await openActions(sql, user);
    assert.deepEqual(open.filter((a) => a.job_id === ids.acme).map((a) => a.kind), ["book_interview"]);

    // Rejection: Rejected, and the open action is resolved, not marked done.
    const rejection = await deliver(8, {
      from: `${acme} <jobs@acme.test>`, subject: `Your ${acme} application`, date: "Mon, 2 Nov 2026 09:00:00 +0000",
      text: "Unfortunately we will not be progressing your application.",
    });
    assert.equal(rejection.newStatus, "rejected");
    assert.deepEqual((await actions(ids.acme)).map((a) => [a.kind, a.state, a.resolved_by]), [
      ["complete_assessment", "done", null], ["book_interview", "resolved", "rejected"],
    ]);
    // An interview invitation sent after the rejection contradicts it: flagged, nothing changes, no new action.
    const after = await deliver(9, {
      from: `${acme} <jobs@acme.test>`, subject: `${acme}: invitation to interview`, date: "Tue, 3 Nov 2026 09:00:00 +0000",
      text: "Please book a slot for your interview.",
    });
    assert.deepEqual([after.effect, after.newStatus], ["conflict", null]);
    assert.equal((await app(ids.acme)).status, "rejected");
    assert.equal((await actions(ids.acme)).length, 2);

    // A manual correction beats older emails.
    await sql`update user_jobs set status = 'todo', status_source = 'manual', status_changed_at = '2026-11-01'
              where user_id = ${user} and job_id = ${ids.cobalt}`;
    const older = await deliver(10, { from: `Cobalt ${stamp} <hr@cobalt.test>`, subject: `Thank you for applying to Cobalt ${stamp}`, text: "", date: "Fri, 30 Oct 2026 09:00:00 +0000" });
    assert.deepEqual([older.effect, (await app(ids.cobalt)).status], ["kept_manual", "todo"]);

    // Two applications could match: left in Email matches, nothing changed.
    const ambiguous = await deliver(11, { from: `Bolt ${stamp} <talent@bolt.test>`, subject: `Bolt ${stamp}: online assessment`, text: "Please complete the online assessment." });
    assert.equal(ambiguous.outcome, "inbox");
    assert.equal(ambiguous.candidates.length, 2);
    assert.equal((await app(ids.bolt1)).status, "todo");

    // Matched by hand: same stage and action rules, from what was read on arrival.
    const eventId = (await sql`select id from status_events where resend_email_id = ${`p-${stamp}-11`}`)[0].id;
    assert.equal(await matchManually(sql, user, eventId, ids.bolt2, "assessment_invite"), true);
    assert.deepEqual(await app(ids.bolt2), { status: "applied", stage: "assessment_invited", status_source: "email" });
    assert.deepEqual((await actions(ids.bolt2)).map((a) => [a.kind, a.state]), [["complete_assessment", "open"]]);

    // Unmatched confirmation -> Add to board as Applied: no posting link, no fake one.
    const unknown = await deliver(12, { from: "Careers <no-reply@greenhouse-mail.io>", subject: "Thank you for your application", text: "" });
    assert.equal(unknown.outcome, "inbox");
    const unknownId = (await sql`select id from status_events where resend_email_id = ${`p-${stamp}-12`}`)[0].id;
    const company = `Dynamo ${stamp}`;
    const added = await addJobFromEmail(sql, user, unknownId, { company, role: "Quant Intern", type: "internship" });
    assert.equal(added.reused, false);
    const [job] = await sql`select link, source from jobs where id = ${added.jobId}`;
    assert.deepEqual([job.link, job.source], [null, "Email"]);
    assert.equal((await app(added.jobId)).status, "applied");
    assert.equal((await sql`select added_from_email from user_jobs where user_id = ${user} and job_id = ${added.jobId}`)[0].added_from_email, true);
    // A second confirmation for the same company + role reuses that job instead of duplicating it.
    await deliver(13, { from: "Careers <no-reply@greenhouse-mail.io>", subject: "Application received", text: "" });
    const secondId = (await sql`select id from status_events where resend_email_id = ${`p-${stamp}-13`}`)[0].id;
    const again = await addJobFromEmail(sql, user, secondId, { company: `${company} Ltd`, role: "Quant Intern", type: "internship" });
    assert.deepEqual([again.reused, again.jobId], [true, added.jobId]);
    assert.equal(await addJobFromEmail(sql, "taran", secondId, { company, role: "X", type: "internship" }), null); // not taran's

    // Gmail account: set by the person, cleared with null.
    await setGmailAccount(sql, user, "me@gmail.com");
    assert.equal(await gmailAccount(sql, user), "me@gmail.com");
    await setGmailAccount(sql, user, null);
    assert.equal(await gmailAccount(sql, user), null);

    // Only the Message-ID of a filter-forwarded email is stored; no body anywhere.
    const stored = await sql`select * from status_events where resend_email_id like ${`p-${stamp}-%`}`;
    assert.equal(stored.find((r) => r.resend_email_id === `p-${stamp}-2`).source_message_id, `<assess-${stamp}@mail.acme.test>`);
    assert.equal(stored.find((r) => r.resend_email_id === `p-${stamp}-1`).source_message_id, null);
    for (const secret of ["progressing", "first-round", "scheduler"]) {
      assert.ok(stored.every((r) => !JSON.stringify(r).includes(secret)), `stored ${secret}`);
      assert.ok(logs.every((l) => !l.includes(secret)), `logged ${secret}`);
    }
  } finally {
    await sql`delete from status_events where resend_email_id like ${`p-${stamp}-%`}`;
    await sql`delete from jobs where link in ${sql(links)} or company like ${`%${stamp}%`}`;
    await sql.end();
  }
});
