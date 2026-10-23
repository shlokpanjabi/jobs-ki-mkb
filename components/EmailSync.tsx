import { cookies } from "next/headers";
import { addToBoardFromInbox, dismissFromInbox, matchFromInbox } from "@/app/inbox/actions";
import { saveGmailAccount } from "@/app/settings/actions";
import { db } from "@/lib/db";
import { forwardingToken, gmailAccount, inboxFor, jobsForUser, recentEvents } from "@/lib/inbound/db.mjs";
import { gmailLink } from "@/lib/inbound/gmail.mjs";
import { forwardingAddress } from "@/lib/inbound/email.mjs";
import { getUsers } from "@/lib/jobs";
import { JOB_TYPES } from "@/lib/types";
import { USER_COOKIE } from "@/lib/user";
import { CopyButton } from "./CopyButton";
import { HomeFilterForm } from "./HomeFilterForm";
import { UserSwitcher } from "./UserSwitcher";

const LABEL_TEXT: Record<string, string> = {
  received: "Application received",
  assessment_invite: "Assessment invite",
  interview: "Interview",
  offer: "Offer",
  rejected: "Rejected",
  unknown: "Not sure",
};
// Row shapes of the lib/inbound/db.mjs queries used here.
type AddressRow = {
  token: string; gmail_confirm_code: string | null; gmail_confirm_url: string | null; gmail_confirm_at: Date | null;
  gmail_account: string | null;
};
type EventRow = {
  id: number; received_at: Date; subject: string; sender_domain: string | null; classification: string;
  state: string; new_status: string | null; new_stage: string | null; effect: string | null; source_message_id: string | null;
};
type RecentEvent = EventRow & { company: string | null };
type InboxEvent = EventRow & {
  suggested_job_id: number | null; suggested_company: string | null; suggested_role: string | null;
};
type JobOption = { jobId: number; company: string; role: string };

const STAGE_TEXT: Record<string, string> = { assessment_invited: "Assessment invited", interview_invited: "Interview invited" };

// What a matched email did, in words. Only the cases where nothing changed need explaining.
const EFFECT_TEXT: Record<string, string> = {
  conflict: "doesn't fit your current status, so nothing changed: check it",
  kept_manual: "older than your own change, so your status stands",
  stale: "older news, no change",
};

function eventOutcome(e: RecentEvent): string {
  if (e.state === "inbox") return "in Email matches";
  if (e.state === "dismissed") return "dismissed";
  const change = [e.new_status && `→ ${e.new_status}`, e.new_stage && STAGE_TEXT[e.new_stage]].filter(Boolean).join(", ");
  // "updated" with no status or stage change means it added a to-do (say, an interview time).
  const note = e.effect === "updated" ? "new to-do added" : e.effect ? EFFECT_TEXT[e.effect] : null;
  return `${e.company ?? "?"}${change ? ` ${change}` : note ? `: ${note}` : " (no change)"}`;
}

// "Open in Gmail" for one recorded email, or a pointer to Settings if their Gmail isn't set.
function GmailButton({ account, e }: { account: string | null; e: EventRow }) {
  const link = gmailLink(account, { messageId: e.source_message_id, senderDomain: e.sender_domain, subject: e.subject });
  if (!link) {
    return account ? null : (
      <a href="/settings#gmail" className="text-gray-500 underline">Add your Gmail to open it</a>
    );
  }
  return (
    <a href={link.url} target="_blank" rel="noopener noreferrer" className="rounded border border-gray-300 px-2 py-0.5 hover:bg-gray-50">
      {link.exact ? "Open in Gmail" : "Find in Gmail"}
    </a>
  );
}

const FILTER_QUERY = "application OR assessment OR interview OR unfortunately";

const formatDate = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(d);

// Shared by both pages: whoever is picked in the user switcher.
async function currentUser() {
  const cookieUser = (await cookies()).get(USER_COOKIE)?.value ?? "";
  const users = await getUsers();
  return { users, user: users.find((u) => u.id === cookieUser) ?? null };
}

// If the email sync tables can't be created (e.g. the database user lacks
// permission), show this instead of the error page.
function SyncNotReady({ users, user, title }: { users: Awaited<ReturnType<typeof getUsers>>; user: string; title: string }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">{title}</h1>
        <UserSwitcher users={users} current={user} />
      </div>
      <p className="py-8 text-center text-sm text-gray-500">
        Email sync isn&apos;t set up yet. Your roles and statuses still work as normal.
      </p>
    </div>
  );
}

function PickUser({ users, title }: { users: Awaited<ReturnType<typeof getUsers>>; title: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <h1 className="text-lg font-semibold">{title}</h1>
      <p className="text-sm text-gray-500">Pick your name first.</p>
      <UserSwitcher users={users} current={null} />
    </div>
  );
}

export async function SettingsSection({ homeNotice, gmailNotice }: {
  homeNotice?: "saved" | "empty";
  gmailNotice?: "saved" | "cleared" | "invalid";
}) {
  const { users, user } = await currentUser();
  if (!user) return <PickUser users={users} title="Settings" />;
  const sql = db();
  let addressRow: AddressRow, events: RecentEvent[];
  try {
    [addressRow, events] = (await Promise.all([forwardingToken(sql, user.id), recentEvents(sql, user.id)])) as [
      AddressRow,
      RecentEvent[],
    ];
  } catch (err) {
    console.error(`settings: email sync unavailable: ${err instanceof Error ? err.message : err}`);
    return (
      <div className="flex max-w-3xl flex-col gap-6">
        <SettingsHeader users={users} user={user.id} />
        <HomeFilterForm user={user} notice={homeNotice} />
        <section className="flex flex-col gap-2">
          <h2 className="font-medium">Email status sync</h2>
          <p className="text-sm text-gray-500">Email sync isn&apos;t set up yet.</p>
        </section>
      </div>
    );
  }
  const address = forwardingAddress(addressRow.token);

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <SettingsHeader users={users} user={user.id} />
      <HomeFilterForm user={user} notice={homeNotice} />

      <section className="flex flex-col gap-2">
        <h2 className="font-medium">Email status sync</h2>
        <p className="text-sm text-gray-600">
          Forward application emails to your address and your board updates itself: a confirmation marks a role{" "}
          <b>Applied</b>; an assessment or interview invitation shows <b>Assessment invited</b> or{" "}
          <b>Interview invited</b> and adds a to-do (like <i>Complete assessment</i>) under the role&apos;s status;
          rejections and offers set <b>Rejected</b> or <b>Offer</b>. Progress only moves forward, and an email never
          undoes a change you made yourself after it was sent. Emails it can&apos;t match to one of your roles wait in{" "}
          <a className="underline" href="/inbox">Email matches</a>. Only the subject, date, sender&apos;s domain, the
          email&apos;s ID and any deadline it states are kept, never the email itself.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <code className="rounded border border-gray-200 bg-gray-50 px-2 py-1 text-sm select-all">{address}</code>
          <CopyButton text={address} />
        </div>
      </section>

      <section id="gmail" className="flex flex-col gap-2">
        <h2 className="font-medium">Your Gmail address</h2>
        <p className="text-sm text-gray-600">
          The address you forward from, so <i>Open in Gmail</i> opens the right account. Assessment and booking links
          stay in the original email; the tracker never stores them.
        </p>
        <form action={saveGmailAccount} className="flex flex-wrap items-center gap-2 text-sm">
          <input
            type="email"
            name="gmail"
            defaultValue={addressRow.gmail_account ?? ""}
            placeholder="you@gmail.com"
            aria-label="Your Gmail address"
            className="w-72 max-w-full rounded border border-gray-300 px-2 py-1"
          />
          <button className="rounded border border-gray-900 bg-gray-900 px-3 py-1 text-white">Save</button>
          {gmailNotice === "saved" && <span className="text-green-700">Saved.</span>}
          {gmailNotice === "cleared" && <span className="text-gray-600">Cleared.</span>}
          {gmailNotice === "invalid" && <span className="text-red-700">That doesn&apos;t look like an email address.</span>}
        </form>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Set it up in Gmail (once)</h2>
        <ol className="flex list-decimal flex-col gap-3 pl-5 text-sm text-gray-700">
          <li>
            <b>Create a filter.</b> In Gmail, click the filter icon at the right of the search bar. In <i>Has the
            words</i>, paste <code className="rounded bg-gray-100 px-1">{FILTER_QUERY}</code>
            <CopyButton text={FILTER_QUERY} />, then click <i>Create filter</i>.
          </li>
          <li>
            <b>Forward matching mail to your address.</b> On the next screen tick <i>Forward it to</i> and choose{" "}
            <i>Add forwarding address</i>. Paste your address from above. Gmail then sends it a confirmation
            email, so you&apos;ll come back to tick <i>Forward it to</i> after step 3.
          </li>
          <li>
            <b>Confirm Gmail&apos;s forwarding verification email.</b> It arrives here, not in your inbox:
            {addressRow.gmail_confirm_code || addressRow.gmail_confirm_url ? (
              <div className="mt-2 rounded border border-green-200 bg-green-50 p-3">
                <div>
                  Gmail&apos;s confirmation arrived
                  {addressRow.gmail_confirm_at ? ` ${formatDate(new Date(addressRow.gmail_confirm_at))}` : ""}.
                </div>
                {addressRow.gmail_confirm_code && (
                  <div>
                    Code: <code className="font-semibold select-all">{addressRow.gmail_confirm_code}</code> (enter it in
                    Gmail&apos;s forwarding settings), or
                  </div>
                )}
                {addressRow.gmail_confirm_url && (
                  <a className="underline" href={addressRow.gmail_confirm_url} target="_blank" rel="noreferrer">
                    open the confirmation link
                  </a>
                )}
              </div>
            ) : (
              <div className="mt-2 text-gray-500">
                Waiting for it. Refresh this page a minute after adding the forwarding address.
              </div>
            )}
            <div className="mt-2">
              Then go back to the filter (Gmail Settings → <i>Filters and Blocked Addresses</i> → edit), tick{" "}
              <i>Forward it to</i>, pick your address and save. Tick <i>Also apply filter to matching
              conversations</i> to send past emails too.
            </div>
          </li>
        </ol>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-medium">Recent emails</h2>
        {events.length === 0 ? (
          <p className="text-sm text-gray-500">No forwarded emails yet. Once forwarding is set up, they&apos;ll show here.</p>
        ) : (
          <ul className="divide-y divide-gray-100 rounded border border-gray-200 text-sm">
            {events.map((e) => (
              <li key={e.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2">
                <span className="text-gray-500">{formatDate(new Date(e.received_at))}</span>
                <span className="font-medium">{LABEL_TEXT[e.classification] ?? e.classification}</span>
                <span className="min-w-0 flex-1 truncate">{e.subject || "(no subject)"}</span>
                <span className={e.effect === "conflict" ? "text-red-700" : "text-gray-500"}>{eventOutcome(e)}</span>
                <GmailButton account={addressRow.gmail_account} e={e} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function SettingsHeader({ users, user }: { users: Awaited<ReturnType<typeof getUsers>>; user: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-lg font-semibold">Settings</h1>
      <UserSwitcher users={users} current={user} />
    </div>
  );
}

export async function InboxSection({ error, added }: { error?: string; added?: string }) {
  const { users, user } = await currentUser();
  if (!user) return <PickUser users={users} title="Email matches" />;
  const sql = db();
  let events: InboxEvent[], jobs: JobOption[], gmail: string | null;
  try {
    [events, jobs, gmail] = (await Promise.all([inboxFor(sql, user.id), jobsForUser(sql, user.id), gmailAccount(sql, user.id)])) as [
      InboxEvent[],
      JobOption[],
      string | null,
    ];
  } catch (err) {
    console.error(`inbox: email sync unavailable: ${err instanceof Error ? err.message : err}`);
    return <SyncNotReady users={users} user={user.id} title="Email matches" />;
  }
  const jobLabel = (company: string, role: string, id: number) => `${company} — ${role} · #${id}`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">Email matches</h1>
        <UserSwitcher users={users} current={user.id} />
      </div>
      <p className="text-sm text-gray-600">
        Forwarded emails we couldn&apos;t tie to one of your roles on our own: pick the role and what the email
        means, then <i>Match</i>.
      </p>
      {error && (
        <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error === "label"
            ? "Pick what the email means."
            : error === "add"
              ? "Fill in the company and the role to add it."
              : "Pick a role from the list (start typing the company)."}
        </p>
      )}
      {added && (
        <p className="rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
          {added === "existing"
            ? "That role was already in the tracker, so it's on your board now, marked Applied."
            : "Added to your board, marked Applied."}
        </p>
      )}
      {events.length === 0 ? (
        <p className="py-8 text-center text-sm text-gray-500">
          Nothing to sort out. Emails we can&apos;t match to a role on our own will show up here.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {events.map((e) => (
            <li key={e.id} className="flex flex-col gap-2 rounded border border-gray-200 p-3 text-sm">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-gray-500">{formatDate(new Date(e.received_at))}</span>
                <span className="font-medium">{e.subject || "(no subject)"}</span>
                {e.sender_domain && <span className="text-gray-500">from {e.sender_domain}</span>}
                <GmailButton account={gmail} e={e} />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <form action={matchFromInbox} className="flex flex-1 flex-wrap items-center gap-2">
                  <input type="hidden" name="event" value={e.id} />
                  <select
                    name="label"
                    defaultValue={e.classification === "unknown" ? "" : e.classification}
                    className="rounded border border-gray-300 px-2 py-1"
                  >
                    <option value="" disabled>
                      What is it?
                    </option>
                    {Object.entries(LABEL_TEXT)
                      .filter(([k]) => k !== "unknown")
                      .map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                  </select>
                  <input
                    name="job"
                    list="inbox-jobs"
                    placeholder="Company — role"
                    defaultValue={
                      e.suggested_job_id ? jobLabel(e.suggested_company ?? "", e.suggested_role ?? "", e.suggested_job_id) : ""
                    }
                    className="min-w-0 flex-1 basis-56 rounded border border-gray-300 px-2 py-1"
                  />
                  <button className="rounded border border-gray-900 bg-gray-900 px-3 py-1 text-white">Match</button>
                </form>
                <form action={dismissFromInbox}>
                  <input type="hidden" name="event" value={e.id} />
                  <button className="rounded border border-gray-300 px-3 py-1 hover:bg-gray-50">Dismiss</button>
                </form>
              </div>
              {e.classification === "received" && !e.suggested_job_id && <AddToBoard eventId={e.id} />}
            </li>
          ))}
        </ul>
      )}
      <datalist id="inbox-jobs">
        {jobs.map((j) => (
          <option key={j.jobId} value={jobLabel(j.company, j.role, j.jobId)} />
        ))}
      </datalist>
    </div>
  );
}

// For an application confirmation that matches nothing on the board. Company
// and role start empty: the sender (often an applicant-tracking system) doesn't
// say who the employer is, so the person types it.
function AddToBoard({ eventId }: { eventId: number }) {
  return (
    <details className="rounded border border-gray-200 bg-gray-50 px-3 py-2">
      <summary className="cursor-pointer select-none font-medium">Add to board as Applied</summary>
      <form action={addToBoardFromInbox} className="mt-2 flex flex-wrap items-end gap-2">
        <input type="hidden" name="event" value={eventId} />
        <label className="flex min-w-0 flex-1 basis-40 flex-col gap-0.5">
          <span className="text-gray-600">Company</span>
          <input name="company" aria-label="Company" required maxLength={300} className="rounded border border-gray-300 px-2 py-1" />
        </label>
        <label className="flex min-w-0 flex-1 basis-48 flex-col gap-0.5">
          <span className="text-gray-600">Role</span>
          <input name="role" aria-label="Role" required maxLength={300} className="rounded border border-gray-300 px-2 py-1" />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-gray-600">Type</span>
          <select name="type" defaultValue="internship" className="rounded border border-gray-300 px-2 py-1">
            {JOB_TYPES.map((t) => (
              <option key={t} value={t}>{TYPE_NAME[t]}</option>
            ))}
          </select>
        </label>
        <button className="rounded border border-gray-900 bg-gray-900 px-3 py-1 text-white">Add as Applied</button>
      </form>
      <p className="mt-1 text-xs text-gray-500">
        If the role is already in the tracker, that one is used instead of adding a copy.
      </p>
    </details>
  );
}

const TYPE_NAME: Record<(typeof JOB_TYPES)[number], string> = {
  internship: "Internship",
  "part-time": "Part-time",
  fellowship: "Fellowship",
  hackathon: "Hackathon",
};

export function EmailSyncFallback() {
  return <p className="py-16 text-center text-sm text-gray-400">Loading…</p>;
}
