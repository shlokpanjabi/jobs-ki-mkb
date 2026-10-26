"use client";

import { useSearchParams } from "next/navigation";
import { useDeferredValue, useEffect, useMemo, useOptimistic, useState, useTransition } from "react";
import { updateAction, updateStatus } from "@/app/actions";
import { daysBetween } from "@/lib/dates";
import { gmailLink } from "@/lib/inbound/gmail.mjs";
import { postingHref } from "@/lib/links.mjs";
import { XP } from "@/lib/pets.mjs";
import { CompanyMark } from "./CompanyMark";
import {
  JOB_TYPES, STATUSES, type ActionKind, type BoardAction, type BoardRow, type JobType, type Stage, type Status, type Verdict,
} from "@/lib/types";

const TYPE_LABEL: Record<JobType, string> = {
  internship: "Internship",
  "part-time": "Part-time",
  fellowship: "Fellowship",
  hackathon: "Hackathon",
};

const STATUS_LABEL: Record<Status, string> = {
  todo: "To do",
  applied: "Applied",
  rejected: "Rejected",
  offer: "Offer",
};

// Invitations only: a stage never says the assessment or interview happened.
const STAGE_LABEL: Record<Stage, string> = {
  assessment_invited: "Assessment invited",
  interview_invited: "Interview invited",
};

const ACTION_LABEL: Record<ActionKind, string> = {
  complete_assessment: "Complete assessment",
  book_interview: "Book interview",
  attend_interview: "Attend interview",
};

const STATUS_STYLE: Record<Status, string> = {
  todo: "border-line-300 bg-white text-ink-700",
  applied: "border-ink-900 bg-ink-900 text-paper-50",
  rejected: "border-line-200 bg-transparent text-ink-300 line-through",
  offer: "border-ok-500 bg-ok-500 text-white",
};

const STAGE_STYLE: Record<Stage, string> = {
  assessment_invited: "bg-note-100 text-note-700",
  interview_invited: "bg-accent-300/50 text-accent-700",
};

const DUE_LABEL = {
  open: "Not past deadline",
  "7": "Closing in ≤ 7 days",
  "14": "Closing in ≤ 14 days",
  "30": "Closing in ≤ 30 days",
  rolling: "Rolling / no deadline",
  past: "Past deadline",
  all: "Any deadline",
} as const;
type Due = keyof typeof DUE_LABEL;

// "Can I apply?" on boards with eligibility (BoardRow.eligibility). Worth a shot
// means the role's stated requirement doesn't cover them; its words are shown.
const VERDICT_LABEL: Record<Verdict, string> = { eligible: "Year-eligible", worth_a_shot: "Worth a shot" };
const VERDICT_STYLE: Record<Verdict, string> = {
  eligible: "bg-ok-100 text-ok-700",
  worth_a_shot: "bg-note-100 text-note-700",
};

const ELIGIBILITY_FILTER = { "": "Any eligibility", eligible: "Year-eligible only", shot: "Year-eligible + worth a shot" } as const;

// The Status menu's option for the stage filter (Filters.stage).
const INVITED = "stage:invited";

const PAGE_SIZE = 100; // rows rendered at a time; "Show more" adds another page

type Filters = {
  q: string;
  type: string;
  domain: string;
  region: string;
  due: Due;
  status: string;
  // "invited": applied and invited to an assessment or interview (the stage
  // shown under the status, and the dashboard's "Assessment / interview").
  stage: "" | "invited";
  // Boards with eligibility only: "eligible", or "shot" for eligible + worth a shot.
  elig: keyof typeof ELIGIBILITY_FILTER;
  sort: "asc" | "desc";
};

const DEFAULTS: Filters = { q: "", type: "", domain: "", region: "", due: "open", status: "", stage: "", elig: "", sort: "asc" };

function readFilters(params: URLSearchParams): Filters {
  const due = params.get("due") ?? "";
  return {
    q: params.get("q") ?? "",
    type: params.get("type") ?? "",
    domain: params.get("domain") ?? "",
    region: params.get("region") ?? "",
    due: due in DUE_LABEL ? (due as Due) : DEFAULTS.due,
    status: params.get("status") ?? "",
    stage: params.get("stage") === "invited" ? "invited" : "",
    elig: params.get("elig") === "eligible" ? "eligible" : params.get("elig") === "shot" ? "shot" : "",
    sort: params.get("sort") === "desc" ? "desc" : "asc",
  };
}

function filtersToQuery(filters: Filters): string {
  const params = new URLSearchParams();
  for (const key of Object.keys(DEFAULTS) as (keyof Filters)[]) {
    if (filters[key] !== DEFAULTS[key]) params.set(key, filters[key]);
  }
  return params.toString();
}

function matchesDue(deadline: string | null, due: Due, today: string): boolean {
  if (due === "all") return true;
  if (deadline === null) return due === "open" || due === "rolling";
  const days = daysBetween(today, deadline);
  switch (due) {
    case "open":
      return days >= 0;
    case "past":
      return days < 0;
    case "rolling":
      return false;
    default:
      return days >= 0 && days <= Number(due);
  }
}

// Rolling (null) deadlines always sort last.
function compareDeadline(a: BoardRow, b: BoardRow, dir: 1 | -1): number {
  if (a.deadline === b.deadline) return a.company.localeCompare(b.company);
  if (a.deadline === null) return 1;
  if (b.deadline === null) return -1;
  return a.deadline < b.deadline ? -dir : dir;
}

function uniqueSorted(values: (string | null)[]): string[] {
  return [...new Set(values.filter((v): v is string => !!v))].sort((a, b) => a.localeCompare(b));
}

function searchText(row: BoardRow): string {
  return [row.company, row.role, row.domain, row.location, row.region, row.source, row.type]
    .join(" ")
    .toLowerCase();
}

function formatDate(iso: string, today: string): string {
  const options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", timeZone: "UTC" };
  if (iso.slice(0, 4) !== today.slice(0, 4)) options.year = "numeric";
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", options);
}

// gmailAccount: the Gmail address the person set on Settings, for "Open in
// Gmail" links on actions; null when they haven't set one.
// eligibility: this board has eligibility (the Eligibility filter, and a label
// under the status where the role states a requirement).
export function JobBoard({ rows, today, gmailAccount, eligibility = false }: {
  rows: BoardRow[];
  today: string;
  gmailAccount: string | null;
  eligibility?: boolean;
}) {
  const searchParams = useSearchParams();
  const [filters, setFilters] = useState(() => readFilters(searchParams));
  // Queries this board has written to the URL that the router hasn't caught up with yet.
  const [written, setWritten] = useState<string[]>([]);
  const urlQuery = searchParams.toString();
  const [seenQuery, setSeenQuery] = useState(urlQuery);
  const query = useDeferredValue(filters.q);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE_SIZE);
  // A little "+XP" pop when you make progress (lib/pets.mjs XP).
  const [toast, setToast] = useState<{ key: number; text: string } | null>(null);
  const cheer = (text: string) => {
    const key = Date.now();
    setToast({ key, text });
    setTimeout(() => setToast((t) => (t?.key === key ? null : t)), 1500);
  };
  const [, startTransition] = useTransition();
  const [optimisticRows, setOptimistic] = useOptimistic(
    rows,
    (current: BoardRow[], change: { id: number; status: Status } | { closedAction: number }) =>
      "closedAction" in change
        ? current.map((row) => ({ ...row, actions: row.actions.filter((a) => a.id !== change.closedAction) }))
        : current.map((row) => (row.id === change.id ? { ...row, status: change.status } : row)),
  );

  const due = filters.due;
  const closingSoon = due === "7";
  // Any filter change starts again from the first page. Filters are kept in
  // the URL so a refresh or shared link shows the same view.
  const update = (patch: Partial<Filters>) => {
    const next = { ...filters, ...patch };
    const qs = filtersToQuery(next);
    setFilters(next);
    setLimit(PAGE_SIZE);
    setWritten((w) => [...w, qs]);
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  };

  // The URL also changes by navigating here (the dashboard links to filtered
  // views): take those filters. Changes this board wrote itself are skipped.
  if (urlQuery !== seenQuery) {
    setSeenQuery(urlQuery);
    if (!written.includes(urlQuery)) {
      setFilters(readFilters(searchParams));
      setLimit(PAGE_SIZE);
      setWritten([]);
    } else if (urlQuery === written.at(-1)) {
      setWritten([]);
    }
  }

  // Tidy the URL on load (drops unknown values, e.g. ?due=soon).
  useEffect(() => {
    const qs = filtersToQuery(readFilters(new URLSearchParams(window.location.search)));
    if (qs !== window.location.search.slice(1)) window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  }, []);

  const domains = useMemo(() => uniqueSorted(rows.map((r) => r.domain)), [rows]);
  const regions = useMemo(() => uniqueSorted(rows.map((r) => r.region)), [rows]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const dir = filters.sort === "asc" ? 1 : -1;
    return optimisticRows
      .filter(
        (r) =>
          (!filters.type || r.type === filters.type) &&
          (!filters.domain || r.domain === filters.domain) &&
          (!filters.region || r.region === filters.region) &&
          (!filters.status || r.status === filters.status) &&
          (!filters.stage || (r.status === "applied" && r.stage !== null)) &&
          (!eligibility || !filters.elig || matchesEligibility(r, filters.elig)) &&
          matchesDue(r.deadline, due, today) &&
          (!q || searchText(r).includes(q)),
      )
      .sort((a, b) => compareDeadline(a, b, dir));
  }, [optimisticRows, filters, query, due, today, eligibility]);

  function changeStatus(id: number, status: Status) {
    setError(null);
    const before = optimisticRows.find((r) => r.id === id)?.status;
    if (before === "todo" && status === "applied") cheer(`+${XP.applied} XP`);
    if (status === "offer" && before !== "offer") cheer(`+${XP.offer} XP! An offer!`);
    startTransition(async () => {
      setOptimistic({ id, status });
      try {
        const result = await updateStatus(id, status);
        if (!result.ok) setError(result.error);
      } catch {
        setError("Couldn't save that change. Check your connection and try again.");
      }
    });
  }

  function finishAction(actionId: number, state: "done" | "dismissed") {
    setError(null);
    if (state === "done") cheer(`+${XP.quest} XP`);
    startTransition(async () => {
      setOptimistic({ closedAction: actionId });
      try {
        const result = await updateAction(actionId, state);
        if (!result.ok) setError(result.error);
      } catch {
        setError("Couldn't save that change. Check your connection and try again.");
      }
    });
  }

  const isFiltered = filtersToQuery(filters) !== "";
  const selectClass = "field px-3 py-1.5";

  return (
    <div className="flex flex-col gap-3">
      {toast && (
        <div key={toast.key} role="status" className="float-up pointer-events-none fixed bottom-10 left-1/2 z-40 -translate-x-1/2">
          <span className="label-mono rounded-full bg-ink-900 px-4 py-2 text-paper-50">{toast.text}</span>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <input
          type="search"
          value={filters.q}
          onChange={(e) => update({ q: e.target.value })}
          placeholder="Search company, role, location…"
          aria-label="Search"
          className="field w-64 max-w-full px-3 py-1.5"
        />
        <button
          onClick={() => update({ due: closingSoon ? DEFAULTS.due : "7" })}
          aria-pressed={closingSoon}
          className={`btn-3d px-3 py-1.5 ${closingSoon ? "btn-carrot" : "btn-cream"}`}
        >
          Closing soon
        </button>
        <select aria-label="Type" value={filters.type} onChange={(e) => update({ type: e.target.value })} className={selectClass}>
          <option value="">All types</option>
          {JOB_TYPES.map((t) => (
            <option key={t} value={t}>{TYPE_LABEL[t]}</option>
          ))}
        </select>
        <select aria-label="Domain" value={filters.domain} onChange={(e) => update({ domain: e.target.value })} className={selectClass}>
          <option value="">All domains</option>
          {domains.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
        <select aria-label="Region" value={filters.region} onChange={(e) => update({ region: e.target.value })} className={selectClass}>
          <option value="">All regions</option>
          {regions.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        <select aria-label="Deadline" value={filters.due} onChange={(e) => update({ due: e.target.value as Due })} className={selectClass}>
          {(Object.keys(DUE_LABEL) as Due[]).map((d) => (
            <option key={d} value={d}>{DUE_LABEL[d]}</option>
          ))}
        </select>
        <select
          aria-label="Status"
          value={filters.stage ? INVITED : filters.status}
          onChange={(e) =>
            update(e.target.value === INVITED ? { status: "", stage: "invited" } : { status: e.target.value, stage: "" })
          }
          className={selectClass}
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => [
            <option key={s} value={s}>{STATUS_LABEL[s]}</option>,
            s === "applied" && <option key={INVITED} value={INVITED}>Assessment / interview</option>,
          ])}
        </select>
        {eligibility && (
          <select
            aria-label="Eligibility"
            value={filters.elig}
            onChange={(e) => update({ elig: e.target.value as Filters["elig"] })}
            className={selectClass}
          >
            {(Object.keys(ELIGIBILITY_FILTER) as Filters["elig"][]).map((k) => (
              <option key={k} value={k}>{ELIGIBILITY_FILTER[k]}</option>
            ))}
          </select>
        )}
        {isFiltered && (
          <button onClick={() => update(DEFAULTS)} className="px-2 py-1.5 text-ink-900 underline decoration-1 underline-offset-4 hover:text-accent-500">
            Reset
          </button>
        )}
        <span className="label-mono ml-auto text-ink-500">
          {visible.length} of {rows.length} roles
        </span>
      </div>

      {error && (
        <p role="alert" className="border-l-2 border-alert-500 bg-alert-100 px-3 py-2 text-sm text-alert-500">
          {error}
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="label-mono border-b border-ink-900 text-left text-ink-500">
            <tr>
              <th className="px-3 py-2.5 font-semibold">Company</th>
              <th className="px-3 py-2.5 font-semibold">Role</th>
              <th className="px-3 py-2.5 font-semibold">Type</th>
              <th className="hidden px-3 py-2.5 font-semibold 2xl:table-cell">Domain</th>
              <th className="px-3 py-2.5 font-semibold">Location</th>
              <th className="px-3 py-2 font-medium" aria-sort={filters.sort === "asc" ? "ascending" : "descending"}>
                <button
                  onClick={() => update({ sort: filters.sort === "asc" ? "desc" : "asc" })}
                  className="uppercase hover:text-ink-900"
                >
                  Deadline {filters.sort === "asc" ? "↑" : "↓"}
                </button>
              </th>
              <th className="hidden px-3 py-2.5 font-semibold 2xl:table-cell">Source</th>
              <th className="px-3 py-2.5 font-semibold">Status</th>
              <th className="sticky right-0 bg-white px-3 py-2.5 text-right font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-200">
            {visible.slice(0, limit).map((row) => (
              <JobRow
                key={row.id}
                row={row}
                today={today}
                gmailAccount={gmailAccount}
                onStatus={changeStatus}
                onAction={finishAction}
              />
            ))}
          </tbody>
        </table>
        {visible.length > limit && (
          <div className="border-t border-line-200 px-3 py-4 text-center text-sm">
            <button
              onClick={() => setLimit((n) => n + PAGE_SIZE)}
              className="btn-3d btn-cream px-4 py-1.5"
            >
              Show {Math.min(PAGE_SIZE, visible.length - limit)} more
            </button>
            <span className="label-mono ml-3 text-ink-500">
              Showing {limit} of {visible.length}
            </span>
          </div>
        )}
        {visible.length === 0 && (
          <p className="px-3 py-12 text-center text-ink-500">
            {rows.length === 0
              ? "No roles here yet. New ones are added every morning, so check back tomorrow."
              : closingSoon
                ? "Nothing closing in the next 7 days."
                : "No roles match these filters. Try Reset, or a shorter search."}
          </p>
        )}
      </div>
    </div>
  );
}

function JobRow({
  row,
  today,
  gmailAccount,
  onStatus,
  onAction,
}: {
  row: BoardRow;
  today: string;
  gmailAccount: string | null;
  onStatus: (id: number, status: Status) => void;
  onAction: (actionId: number, state: "done" | "dismissed") => void;
}) {
  const location = row.region && row.region !== row.location
    ? [row.location, row.region].filter(Boolean).join(" · ")
    : row.location ?? row.region;
  const href = postingHref(row.link) ?? undefined;

  return (
    <tr className={`group align-top transition-colors hover:bg-paper-50 ${row.status === "rejected" ? "text-ink-300" : ""}`}>
      <td className="px-3 py-3">
        <div className="flex items-center gap-2.5">
          <CompanyMark name={row.company} size={30} />
          <span className="font-semibold tracking-[-0.01em]">{row.company}</span>
        </div>
      </td>
      <td className="px-3 py-3.5">
        {row.role}
        <div className="mt-0.5 text-xs text-ink-500 2xl:hidden">{[row.domain, row.source].filter(Boolean).join(" · ")}</div>
        {/* On phones the status column starts off-screen, so progress shows here too. */}
        <Eligibility row={row} className="sm:hidden" />
        <Progress row={row} gmailAccount={gmailAccount} onAction={onAction} className="sm:hidden" />
      </td>
      <td className="whitespace-nowrap px-3 py-3.5">{TYPE_LABEL[row.type]}</td>
      <td className="hidden px-3 py-3.5 2xl:table-cell">{row.domain ?? "—"}</td>
      <td className="px-3 py-3.5">{location ?? "—"}</td>
      <td className="whitespace-nowrap px-3 py-3.5">
        <Deadline deadline={row.deadline} today={today} />
      </td>
      <td className="hidden px-3 py-3.5 text-ink-500 2xl:table-cell">{row.source ?? "—"}</td>
      <td className="px-3 py-3">
        <select
          value={row.status}
          onChange={(e) => onStatus(row.id, e.target.value as Status)}
          aria-label={`Status for ${row.company} ${row.role}`}
          className={`label-mono rounded-full border px-2.5 py-1 ${STATUS_STYLE[row.status]}`}
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>{STATUS_LABEL[s]}</option>
          ))}
        </select>
        <Eligibility row={row} className="hidden sm:block" />
        <Progress row={row} gmailAccount={gmailAccount} onAction={onAction} className="hidden sm:block" />
      </td>
      {/* Sticky so Apply stays reachable when the table scrolls on small screens. */}
      <td className="sticky right-0 bg-white px-3 py-3 transition-colors group-hover:bg-paper-50">
        <div className="flex flex-col items-end gap-1 sm:flex-row sm:justify-end sm:gap-2">
          {href && (
            // Opening a posting only opens it; applying is marked separately.
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-3d btn-cocoa px-3 py-1 text-xs"
            >
              Apply ↗
            </a>
          )}
          {row.status === "todo" ? (
            <button
              onClick={() => onStatus(row.id, "applied")}
              className="btn-3d btn-leaf w-28 px-2.5 py-1 text-xs"
            >
              Mark applied
            </button>
          ) : (
            <span className="hidden w-28 sm:block" />
          )}
        </div>
      </td>
    </tr>
  );
}

function matchesEligibility(row: BoardRow, wanted: Filters["elig"]): boolean {
  const verdict = row.eligibility?.verdict ?? null;
  return verdict === "eligible" || (wanted === "shot" && verdict === "worth_a_shot");
}

// The verdict under the status, with the role's own words, so "worth a shot"
// never reads as meeting the requirement. Nothing when it's unknown.
function Eligibility({ row, className }: { row: BoardRow; className: string }) {
  const verdict = row.eligibility?.verdict;
  if (!verdict) return null;
  return (
    <div className={className}>
      <div className={`label-mono mt-2 inline-block rounded-full px-2 py-0.5 sm:whitespace-nowrap ${VERDICT_STYLE[verdict]}`}>
        {VERDICT_LABEL[verdict]}
      </div>
      {row.eligibility?.note && (
        <p className="mt-1 max-w-60 text-xs text-ink-500">
          {verdict === "worth_a_shot" ? "Asks for: " : "Says: "}
          <q className="text-ink-700">{row.eligibility.note}</q>
        </p>
      )}
    </div>
  );
}

// Stage and open actions, shown beneath the job's status.
function Progress({
  row,
  gmailAccount,
  onAction,
  className,
}: {
  row: BoardRow;
  gmailAccount: string | null;
  onAction: (actionId: number, state: "done" | "dismissed") => void;
  className: string;
}) {
  const stage = row.stage && row.status === "applied" ? STAGE_LABEL[row.stage] : null;
  if (!stage && !row.actions.length) return null;
  return (
    <div className={className}>
      {stage && row.stage && (
        <div className={`label-mono mt-2 inline-block rounded-full px-2 py-0.5 sm:whitespace-nowrap ${STAGE_STYLE[row.stage]}`}>
          {stage}
        </div>
      )}
      {row.actions.length > 0 && (
        <ul className="mt-1.5 flex flex-col gap-1.5 sm:min-w-40">
          {row.actions.map((action) => (
            <ActionItem key={action.id} action={action} gmailAccount={gmailAccount} onAction={onAction} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ActionItem({
  action,
  gmailAccount,
  onAction,
}: {
  action: BoardAction;
  gmailAccount: string | null;
  onAction: (actionId: number, state: "done" | "dismissed") => void;
}) {
  const link = action.email ? gmailLink(gmailAccount, action.email) : null;
  // A to-do from an email, marked with an accent rule.
  return (
    <li className="border-l-2 border-accent-500 bg-white py-1.5 pl-2.5 pr-2 text-xs text-ink-900">
      <div className="flex items-center gap-1.5">
        <span className="label-mono text-accent-500">To-do</span>
        <span className="text-sm font-medium">{ACTION_LABEL[action.kind]}</span>
      </div>
      <div className="mt-0.5 text-ink-500">{dueText(action)}</div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <button onClick={() => onAction(action.id, "done")} className="btn-3d btn-leaf px-2 py-0.5">Done</button>
        <button onClick={() => onAction(action.id, "dismissed")} className="btn-3d btn-cream px-2 py-0.5">Dismiss</button>
        {link ? (
          <a href={link.url} target="_blank" rel="noopener noreferrer" className="text-ink-900 underline decoration-1 underline-offset-2 hover:text-accent-500">
            {link.exact ? "Open in Gmail" : "Find in Gmail"}
          </a>
        ) : action.email ? (
          <a href="/settings" className="text-ink-900 underline decoration-1 underline-offset-2 hover:text-accent-500">Add your Gmail to open the email</a>
        ) : null}
      </div>
    </li>
  );
}

// As the email stated it; a time only ever comes with its zone.
function dueText(action: BoardAction): string {
  if (!action.dueDate) return action.kind === "attend_interview" ? "Time not given in the email" : "No deadline given";
  const date = new Date(`${action.dueDate}T00:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  });
  const when = action.dueTime ? `${date}, ${action.dueTime} ${action.dueTz}` : date;
  return action.kind === "attend_interview" ? when : `By ${when}`;
}

function Deadline({ deadline, today }: { deadline: string | null; today: string }) {
  if (!deadline) return <span className="text-ink-500">Rolling</span>;
  const days = daysBetween(today, deadline);
  const label = days < 0 ? "closed" : days === 0 ? "today" : days === 1 ? "tomorrow" : `${days}d left`;
  const tone = days < 0 ? "text-ink-300" : days <= 7 ? "text-accent-500" : "text-ink-500";
  return (
    <>
      {formatDate(deadline, today)} <span className={`label-mono ml-1 ${tone}`}>{label}</span>
    </>
  );
}
