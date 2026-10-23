// Run with `npm test`; the end-to-end test also needs TEST_DATABASE_URL (a
// scratch database with `npm run db:migrate` applied). Emails here are made up.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import postgres from "postgres";
import { Resend } from "resend";
import { classify, classifyByRules } from "./classify.mjs";
import { dismissEvent, forwardingToken, inboxFor, matchManually } from "./db.mjs";
import { bodyText, forwardingAddress, gmailConfirmation, parseAddress, tokenFrom, unwrapForwarded } from "./email.mjs";
import { companyWords, forwardStatus, matchJob } from "./match.mjs";
import { processInboundEvent } from "./process.mjs";

const rules = (subject, text = "", senderDomain = "acme.com") => classifyByRules({ senderDomain, subject, text });

test("rules: clear cases are decided without the LLM", () => {
  assert.deepEqual(rules("Thank you for your application to Acme").label, "received");
  assert.equal(rules("Your application", "Thank you for applying. Unfortunately we will not be progressing your application.").label, "rejected");
  assert.equal(rules("Update", "We regret to inform you that the position has been filled.").label, "rejected");
  assert.equal(rules("Congratulations!", "We are delighted to offer you a place on our Summer Internship.").label, "offer");
  assert.equal(rules("Next steps", "We would like to invite you to a first-round interview.").label, "interview");
  assert.equal(rules("Assessment Centre invitation").label, "interview");
  assert.equal(rules("Interview confirmed", "Your interview is scheduled for 3 November 2026 at 2:30 PM GMT.").label, "interview");
  assert.equal(rules("Your online assessment", "Please complete the numerical reasoning test within 5 days.").label, "assessment_invite");
  assert.equal(rules("Acme coding challenge", "", "hackerrank.com").label, "assessment_invite");
  assert.equal(rules("Invitation", "", "eu.hirevue.com").label, "assessment_invite");
  // A rejection mentioning the interview is still a rejection.
  assert.equal(rules("Interview outcome", "Thank you for attending the interview. Unfortunately you have been unsuccessful.").label, "rejected");
});

test("rules: conflicting or missing signals are unsure", () => {
  const reschedule = rules("Interview", "Unfortunately we need to reschedule your interview slot.");
  assert.deepEqual([reschedule.sure, reschedule.guess], [false, "interview"]);
  assert.deepEqual(rules("Hello", "Just checking in."), { label: null, sure: false, guess: null });
  assert.equal(rules("Re: application", "Can you resend your CV?").sure, false);
});

test("classify: the LLM is asked only when the rules are unsure", async () => {
  let calls = 0;
  const llm = async () => (calls++, "interview");
  assert.deepEqual(await classify({ senderDomain: "acme.com", subject: "Thank you for applying", text: "" }, llm), { label: "received", by: "rules" });
  assert.equal(calls, 0);
  assert.deepEqual(await classify({ senderDomain: "acme.com", subject: "Quick question", text: "" }, llm), { label: "interview", by: "llm" });
  assert.equal(calls, 1);
  // No LLM, or a useless answer: the rules' guess, marked as nobody being sure.
  assert.deepEqual(await classify({ senderDomain: "acme.com", subject: "Hi", text: "unfortunately" }, null), { label: "rejected", by: "none" });
  assert.deepEqual(await classify({ senderDomain: "acme.com", subject: "Hi", text: "" }, async () => "banana"), { label: "unknown", by: "none" });
});

test("email helpers: tokens, senders, forwarded mail, Gmail confirmation", () => {
  assert.equal(forwardingAddress("abc", "x.resend.app"), "track+abc@x.resend.app");
  const token = "0123456789abcdef01234567";
  assert.equal(tokenFrom([["me@gmail.com"], [`TRACK+${token.toUpperCase()}@uestuuchue.resend.app`]]), token);
  assert.equal(tokenFrom([[`Shlok <me@gmail.com>`], ["X-Forwarded-To: track+short@x"]]), null); // too short
  assert.deepEqual(parseAddress('"Acme Careers" <Jobs@Careers.Acme.com>'), { name: "Acme Careers", address: "jobs@careers.acme.com", domain: "careers.acme.com" });
  assert.equal(bodyText({ text: "", html: "<p>Hi&nbsp;there</p><br>Line <b>two</b>" }).trim(), "Hi there\nLine two");

  const fwd = unwrapForwarded({
    from: "me@gmail.com",
    subject: "Fwd: Your application",
    text: "FYI\n\n---------- Forwarded message ---------\nFrom: Acme Recruiting <no-reply@acme.com>\nDate: Mon\nSubject: Your application\nTo: <me@gmail.com>\n\nThanks for applying",
  });
  assert.deepEqual([fwd.from, fwd.subject], ["Acme Recruiting <no-reply@acme.com>", "Your application"]);
  assert.equal(unwrapForwarded({ from: "a@b.com", subject: "RE: Fwd: Hi", text: "x" }).subject, "Hi");

  const gmail = gmailConfirmation({
    from: "Gmail Team <forwarding-noreply@google.com>",
    subject: "(#123456789) Gmail Forwarding Confirmation - Receive Mail from me@gmail.com",
    text: "To allow me@gmail.com to automatically forward mail... https://mail-settings.google.com/mail/vf-%5Babc%5D-xyz\nConfirmation code: 123456789",
  });
  assert.deepEqual(gmail, { code: "123456789", url: "https://mail-settings.google.com/mail/vf-%5Babc%5D-xyz" });
  assert.equal(gmailConfirmation({ from: "someone@google.com", subject: "(#123456789)", text: "" }), null);
});

const JOBS = [
  { jobId: 1, company: "Goldman Sachs", role: "Summer Analyst - Engineering", status: "applied" },
  { jobId: 2, company: "Goldman Sachs", role: "Summer Analyst - Global Markets", status: "todo" },
  { jobId: 3, company: "J.P. Morgan Chase & Co.", role: "Software Engineer Intern", status: "todo" },
  { jobId: 4, company: "Arm", role: "Graduate Intern", status: "todo" },
  { jobId: 5, company: "Jane Street", role: "Trading Intern", status: "applied" },
  { jobId: 6, company: "Jane Street", role: "Software Engineer Intern", status: "applied" },
];
const email = (over) => ({ fromName: "", senderDomain: null, subject: "", text: "", ...over });

test("match: by sender domain, sender name or subject; narrowed by role and status", () => {
  assert.deepEqual(companyWords("J.P. Morgan Chase & Co."), ["jp", "morgan", "chase", "and"]);
  assert.equal(matchJob(email({ senderDomain: "careers.jpmorgan.com" }), JOBS).job?.jobId, 3);
  // ATS sender: the company comes from the display name. Two GS roles; the applied one wins.
  assert.equal(matchJob(email({ fromName: "Goldman Sachs Recruiting", senderDomain: "greenhouse.io" }), JOBS).job?.jobId, 1);
  // The role title in the email beats status.
  assert.equal(matchJob(email({ subject: "Goldman Sachs - Global Markets update" }), JOBS).job?.jobId, 2);
  // Two applied Jane Street roles and nothing to tell them apart.
  assert.deepEqual(matchJob(email({ subject: "Jane Street application" }), JOBS).ambiguous?.map((j) => j.jobId), [5, 6]);
  assert.equal(matchJob(email({ subject: "Jane Street: Trading Intern" }), JOBS).job?.jobId, 5);
  // Short names only count outside the body.
  assert.deepEqual(matchJob(email({ text: "arm yourself with patience" }), JOBS), { none: true });
  assert.equal(matchJob(email({ subject: "Your Arm application" }), JOBS).job?.jobId, 4);
  assert.deepEqual(matchJob(email({ senderDomain: "gmail.com", subject: "hello" }), JOBS), { none: true });
});

test("status only moves forward", () => {
  assert.equal(forwardStatus("todo", "received"), "applied");
  assert.equal(forwardStatus("todo", "interview"), "applied");
  assert.equal(forwardStatus("applied", "interview"), null);
  assert.equal(forwardStatus("applied", "rejected"), "rejected");
  assert.equal(forwardStatus("rejected", "offer"), "offer");
  assert.equal(forwardStatus("offer", "rejected"), null);
  assert.equal(forwardStatus("rejected", "received"), null);
  assert.equal(forwardStatus("applied", "unknown"), null);
});

test("webhook signatures: Svix scheme, checked through Resend's SDK", () => {
  const key = Buffer.from("test-signing-key-0123456789abcdef");
  const secret = `whsec_${key.toString("base64")}`;
  const id = "msg_test";
  const timestamp = String(Math.floor(Date.now() / 1000));
  const payload = JSON.stringify({ type: "email.received", data: { email_id: "e1" } });
  const sign = (body, ts = timestamp) => `v1,${createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64")}`;
  const resend = new Resend("re_test");
  const verify = (body, signature, ts = timestamp) =>
    resend.webhooks.verify({ payload: body, headers: { id, timestamp: ts, signature }, webhookSecret: secret });

  assert.equal(verify(payload, `v1,bogus ${sign(payload)}`).data.email_id, "e1"); // any listed v1 signature
  assert.throws(() => verify(payload.replace("e1", "e2"), sign(payload)));
  assert.throws(() => verify(payload, ""));
  const stale = String(Number(timestamp) - 3600);
  assert.throws(() => verify(payload, sign(payload, stale), stale)); // replayed an hour later

  // Svix's published test vector, checked against the same signing scheme.
  const vector = createHmac("sha256", Buffer.from("MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw", "base64"))
    .update('msg_p5jXN8AQM9LWM0D4loKWxJek.1614265330.{"test": 2432232314}')
    .digest("base64");
  assert.equal(vector, "g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=");
});

test("end to end: classify, match, move status forward, inbox, Gmail confirmation", { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const sql = postgres(process.env.TEST_DATABASE_URL, { max: 1, onnotice() {} });
  const stamp = Date.now();
  const links = [`https://jobs.test/gs-${stamp}`, `https://jobs.test/ms-${stamp}`];
  const ids = [];
  const logs = [];
  try {
    const { token } = await forwardingToken(sql, "taran");
    assert.match(token, /^[a-f0-9]{24}$/);
    assert.equal((await forwardingToken(sql, "taran")).token, token); // stable
    for (const [company, link] of [["Goldman Sachs", links[0]], ["Morgan Stanley", links[1]]]) {
      const [{ id }] = await sql`insert into jobs (company, role, type, link) values (${company}, 'Summer Analyst', 'internship', ${link}) returning id`;
      await sql`insert into user_jobs (job_id, user_id) values (${id}, 'taran')`;
      ids.push(id);
    }

    const mails = {};
    const deliver = (emailId, mail, opts = {}) => {
      mails[emailId] = { to: ["taran@gmail.com"], received_for: [`track+${token}@uestuuchue.resend.app`], headers: {}, html: null, created_at: "2026-10-22T09:00:00Z", ...mail };
      return processInboundEvent({
        sql,
        event: { type: "email.received", data: { email_id: emailId, to: ["taran@gmail.com"] } },
        fetchEmail: async (i) => mails[i],
        llm: opts.llm ?? null,
        dryRun: opts.dryRun,
        log: (l) => logs.push(l),
      });
    };
    const statusOf = async (jobId) => (await sql`select status from user_jobs where job_id = ${jobId} and user_id = 'taran'`)[0].status;
    const e = (n) => `e-${stamp}-${n}`;

    // Dry run: decides, writes nothing.
    const dry = await deliver(e(1), { from: "Goldman Sachs <no-reply@gs.com>", subject: "Thank you for applying to Goldman Sachs", text: "We have received your application." }, { dryRun: true });
    assert.deepEqual([dry.outcome, dry.label, dry.by, dry.jobId, dry.dryRun], ["matched", "received", "rules", ids[0], true]);
    assert.equal(await statusOf(ids[0]), "todo");
    assert.equal((await sql`select 1 from status_events where resend_email_id = ${e(1)}`).length, 0);

    // For real: todo -> applied, then a rejection -> rejected, then a late "received" can't undo it.
    assert.equal((await deliver(e(1), mails[e(1)])).newStatus, "applied");
    assert.equal((await deliver(e(1), mails[e(1)])).outcome, "duplicate");
    const rejection = await deliver(e(2), { from: "Goldman Sachs Recruiting <noreply@greenhouse.io>", subject: "Your application", text: "Unfortunately, we will not be progressing your application." });
    assert.deepEqual([rejection.label, rejection.previousStatus, rejection.newStatus], ["rejected", "applied", "rejected"]);
    const late = await deliver(e(3), { from: "Goldman Sachs <no-reply@gs.com>", subject: "Thank you for your application", text: "" });
    assert.deepEqual([late.outcome, late.newStatus], ["matched", null]);
    assert.equal(await statusOf(ids[0]), "rejected");

    // Unsure without an LLM -> Inbox with the job suggested; with an LLM -> applied.
    const vague = { from: "Morgan Stanley <talent@morganstanley.com>", subject: "Next steps", text: "Please let us know your availability." };
    const parked = await deliver(e(4), vague);
    assert.deepEqual([parked.outcome, parked.by, parked.jobId], ["inbox", "none", ids[1]]);
    const decided = await deliver(e(5), vague, { llm: async () => "interview" });
    assert.deepEqual([decided.outcome, decided.by, decided.newStatus], ["matched", "llm", "applied"]);

    // No company match -> Inbox; matched by hand there; a second one dismissed.
    assert.equal((await deliver(e(6), { from: "Recruiter <hr@unknown-startup.io>", subject: "Thank you for applying", text: "" })).outcome, "inbox");
    assert.equal((await deliver(e(7), { from: "Newsletter <news@unknown-startup.io>", subject: "Thank you for applying", text: "" })).outcome, "inbox");
    const inbox = await inboxFor(sql, "taran");
    const byEmail = async (n) => (await sql`select id from status_events where resend_email_id = ${e(n)}`)[0].id;
    const parkedId = await byEmail(4);
    assert.ok(inbox.some((r) => r.id === parkedId && r.suggested_job_id === ids[1]));
    assert.equal(await matchManually(sql, "taran", await byEmail(6), ids[1], "offer"), true);
    assert.equal(await statusOf(ids[1]), "offer");
    assert.equal(await matchManually(sql, "shlok", await byEmail(7), ids[1], "offer"), false); // not shlok's email
    assert.equal(await dismissEvent(sql, "taran", await byEmail(7)), true);

    // Gmail's confirmation is stored for the Settings page, not as an event.
    const confirm = await deliver(e(8), { from: "forwarding-noreply@google.com", subject: "(#987654321) Gmail Forwarding Confirmation - Receive Mail from taran@gmail.com", text: "https://mail-settings.google.com/mail/vf-abc" });
    assert.equal(confirm.outcome, "gmail_confirmation");
    assert.equal((await forwardingToken(sql, "taran")).gmail_confirm_code, "987654321");

    // Unknown address -> ignored.
    mails.x = { from: "a@b.com", subject: "Thank you for applying", text: "", received_for: ["track+ffffffffffffffffffffffff@uestuuchue.resend.app"], to: [] };
    const stranger = await processInboundEvent({ sql, event: { type: "email.received", data: { email_id: `x-${stamp}` } }, fetchEmail: async () => mails.x, llm: null, log() {} });
    assert.equal(stranger.outcome, "ignored");

    // Nothing stored or logged carries the body.
    const stored = await sql`select * from status_events where user_id = 'taran' and resend_email_id like ${`e-${stamp}-%`}`;
    assert.ok(stored.every((r) => !JSON.stringify(r).includes("availability") && !JSON.stringify(r).includes("progressing")));
    assert.ok(logs.every((l) => !l.includes("progressing") && !l.includes("availability")));
  } finally {
    await sql`delete from status_events where resend_email_id like ${`e-${stamp}-%`}`;
    await sql`delete from jobs where link in ${sql(links)}`;
    await sql`update inbound_addresses set gmail_confirm_code = null, gmail_confirm_url = null, gmail_confirm_at = null where user_id = 'taran'`;
    await sql.end();
  }
});
