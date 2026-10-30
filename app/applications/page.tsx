import { cookies } from "next/headers";
import Link from "next/link";
import { Suspense } from "react";
import { todayISO } from "@/lib/dates";
import { getBoardRows, getUsers } from "@/lib/jobs";
import type { ActionKind, BoardRow, Status } from "@/lib/types";
import { USER_COOKIE } from "@/lib/user";

const STATUS_LABEL: Record<Exclude<Status, "todo">, string> = {
  offer: "Offer",
  applied: "Applied",
  rejected: "Rejected",
};
const SECTIONS: Exclude<Status, "todo">[] = ["offer", "applied", "rejected"];

const STAGE_LABEL = { assessment_invited: "Assessment invited", interview_invited: "Interview invited" } as const;
const ACTION_LABEL: Record<ActionKind, string> = {
  complete_assessment: "Complete assessment",
  book_interview: "Book interview",
  attend_interview: "Attend interview",
};

// Only the role, the status the board already holds and next steps (kind + due
// date). No email subjects, assessment links or notes: this page is as public
// as the rest of the board.
function ApplicationRow({ row }: { row: BoardRow }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-line-200 py-3 first:border-t-0">
      <div className="min-w-0">
        <p className="font-medium text-ink-900">{row.company}</p>
        <p className="text-sm text-ink-500">
          {row.role}
          {row.location ? ` · ${row.location}` : ""}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {row.stage && <span className="label-mono rounded-full bg-paper-100 px-2 py-1 text-ink-900">{STAGE_LABEL[row.stage]}</span>}
        {row.actions.map((a) => (
          <span key={a.id} className="label-mono rounded-full bg-ink-900 px-2 py-1 text-paper-50">
            {ACTION_LABEL[a.kind]}
            {a.dueDate ? ` · ${a.dueDate}` : ""}
          </span>
        ))}
        <span className="label-mono text-ink-300">{row.type}</span>
        {row.link && (
          <a href={row.link} target="_blank" rel="noreferrer" className="text-ink-900 underline decoration-1 underline-offset-4 hover:text-accent-500">
            Posting
          </a>
        )}
      </div>
    </li>
  );
}

export default function ApplicationsPage() {
  return (
    <Suspense fallback={<p className="label-mono py-16 text-center text-ink-300">Loading…</p>}>
      <Applications />
    </Suspense>
  );
}

async function Applications() {
  const cookieUser = (await cookies()).get(USER_COOKIE)?.value ?? "";
  const users = await getUsers();
  const user = users.find((u) => u.id === cookieUser);
  if (!user) {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-center">
        <h1 className="title-outline text-4xl">Who&apos;s applying?</h1>
        <p className="text-ink-500">
          Pick your name on the <Link href="/" className="underline underline-offset-4">dashboard</Link> first.
        </p>
      </div>
    );
  }
  const rows = (await getBoardRows(user.id)).filter((r) => r.status !== "todo");
  const today = todayISO();
  const upcoming = rows.filter((r) => r.actions.length > 0);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <p className="label-mono text-ink-500">Tracking · {user.name}</p>
        <h1 className="title-outline mt-1 text-4xl sm:text-5xl">Applications</h1>
        <p className="mt-2 text-sm text-ink-500">
          {rows.length} role{rows.length === 1 ? "" : "s"} past &quot;to do&quot; as of {today}. Statuses come from the board and forwarded emails.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {SECTIONS.map((s) => (
          <div key={s} className="card-plain p-4">
            <p className="label-mono text-ink-500">{STATUS_LABEL[s]}</p>
            <p className="title-outline mt-1 text-4xl">{rows.filter((r) => r.status === s).length}</p>
          </div>
        ))}
        <div className="card-plain p-4">
          <p className="label-mono text-ink-500">Next steps open</p>
          <p className="title-outline mt-1 text-4xl">{upcoming.length}</p>
        </div>
      </div>

      {rows.length === 0 && <p className="text-ink-500">Nothing applied yet. Mark a role as applied on the dashboard and it shows up here.</p>}

      {SECTIONS.map((s) => {
        const list = rows.filter((r) => r.status === s);
        if (!list.length) return null;
        return (
          <section key={s} className="card-plain p-4 sm:p-6">
            <h2 className="title-outline text-2xl">
              {STATUS_LABEL[s]} <span className="label-mono text-ink-300">{list.length}</span>
            </h2>
            <ul className="mt-2">
              {list.map((r) => (
                <ApplicationRow key={r.id} row={r} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
