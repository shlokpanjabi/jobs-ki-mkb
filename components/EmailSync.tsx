import { cookies } from "next/headers";
import { dismissFromInbox, matchFromInbox } from "@/app/inbox/actions";
import { db } from "@/lib/db";
import { forwardingToken, inboxFor, jobsForUser, recentEvents } from "@/lib/inbound/db.mjs";
import { forwardingAddress } from "@/lib/inbound/email.mjs";
import { getUsers } from "@/lib/jobs";
import { USER_COOKIE } from "@/lib/user";
import { CopyButton } from "./CopyButton";
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
type AddressRow = { token: string; gmail_confirm_code: string | null; gmail_confirm_url: string | null; gmail_confirm_at: Date | null };
type RecentEvent = {
  id: number; received_at: Date; subject: string; sender_domain: string | null; classification: string;
  state: string; new_status: string | null; company: string | null;
};
type InboxEvent = {
  id: number; received_at: Date; subject: string; sender_domain: string | null; classification: string;
  suggested_job_id: number | null; suggested_company: string | null; suggested_role: string | null;
};
type JobOption = { jobId: number; company: string; role: string };

const FILTER_QUERY = "application OR assessment OR interview OR unfortunately";

const formatDate = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(d);

// Shared by both pages: whoever is picked in the user switcher.
async function currentUser() {
  const cookieUser = (await cookies()).get(USER_COOKIE)?.value ?? "";
  const users = await getUsers();
  return { users, user: users.find((u) => u.id === cookieUser) ?? null };
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

export async function SettingsSection() {
  const { users, user } = await currentUser();
  if (!user) return <PickUser users={users} title="Settings" />;
  const sql = db();
  const [addressRow, events] = (await Promise.all([forwardingToken(sql, user.id), recentEvents(sql, user.id)])) as [
    AddressRow,
    RecentEvent[],
  ];
  const address = forwardingAddress(addressRow.token);

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">Settings</h1>
        <UserSwitcher users={users} current={user.id} />
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="font-medium">Email status sync</h2>
        <p className="text-sm text-gray-600">
          Forward application emails to your address and your board updates itself: confirmations, assessments and
          interviews mark a role <b>Applied</b>, rejections <b>Rejected</b>, offers <b>Offer</b>. Statuses only move
          forward. Emails it can&apos;t match to one of your roles wait in your <a className="underline" href="/inbox">Inbox</a>.
          Only the subject, date and sender&apos;s domain are kept, never the email itself.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <code className="rounded border border-gray-200 bg-gray-50 px-2 py-1 text-sm select-all">{address}</code>
          <CopyButton text={address} />
        </div>
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
          <p className="text-sm text-gray-500">None yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100 rounded border border-gray-200 text-sm">
            {events.map((e) => (
              <li key={e.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2">
                <span className="text-gray-500">{formatDate(new Date(e.received_at))}</span>
                <span className="font-medium">{LABEL_TEXT[e.classification] ?? e.classification}</span>
                <span className="min-w-0 flex-1 truncate">{e.subject || "(no subject)"}</span>
                <span className="text-gray-500">
                  {e.state === "matched"
                    ? `${e.company ?? "?"}${e.new_status ? ` → ${e.new_status}` : " (no change)"}`
                    : e.state === "inbox"
                      ? "in Inbox"
                      : "dismissed"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export async function InboxSection({ error }: { error?: string }) {
  const { users, user } = await currentUser();
  if (!user) return <PickUser users={users} title="Inbox" />;
  const sql = db();
  const [events, jobs] = (await Promise.all([inboxFor(sql, user.id), jobsForUser(sql, user.id)])) as [
    InboxEvent[],
    JobOption[],
  ];
  const jobLabel = (company: string, role: string, id: number) => `${company} — ${role} · #${id}`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">Inbox</h1>
        <UserSwitcher users={users} current={user.id} />
      </div>
      <p className="text-sm text-gray-600">
        Forwarded emails that couldn&apos;t be matched to one of your roles automatically. Pick the role and what the
        email means, then <i>Match</i>. Statuses still only move forward.
      </p>
      {error && (
        <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error === "label" ? "Pick what the email means." : "Pick a role from the list (start typing the company)."}
        </p>
      )}
      {events.length === 0 ? (
        <p className="py-8 text-center text-sm text-gray-500">Nothing to match.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {events.map((e) => (
            <li key={e.id} className="flex flex-col gap-2 rounded border border-gray-200 p-3 text-sm">
              <div className="flex flex-wrap items-baseline gap-x-3">
                <span className="text-gray-500">{formatDate(new Date(e.received_at))}</span>
                <span className="font-medium">{e.subject || "(no subject)"}</span>
                {e.sender_domain && <span className="text-gray-500">from {e.sender_domain}</span>}
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
                    className="min-w-64 flex-1 rounded border border-gray-300 px-2 py-1"
                  />
                  <button className="rounded border border-gray-900 bg-gray-900 px-3 py-1 text-white">Match</button>
                </form>
                <form action={dismissFromInbox}>
                  <input type="hidden" name="event" value={e.id} />
                  <button className="rounded border border-gray-300 px-3 py-1 hover:bg-gray-50">Dismiss</button>
                </form>
              </div>
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

export function EmailSyncFallback() {
  return <p className="py-16 text-center text-sm text-gray-400">Loading…</p>;
}
