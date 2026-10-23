"use client";

import { useSearchParams } from "next/navigation";
import { useDeferredValue, useEffect, useMemo, useOptimistic, useState, useTransition } from "react";
import { updateAction, updateStatus } from "@/app/actions";
import { daysBetween } from "@/lib/dates";
import { gmailLink } from "@/lib/inbound/gmail.mjs";
import { postingHref } from "@/lib/links.mjs";
import {
  JOB_TYPES, STATUSES, type ActionKind, type BoardAction, type BoardRow, type JobType, type Stage, type Status,
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
  todo: "border-gray-300 bg-white text-gray-700",
  applied: "border-blue-200 bg-blue-50 text-blue-800",
  rejected: "border-gray-200 bg-gray-100 text-gray-500",
  offer: "border-green-200 bg-green-50 text-green-800",
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

const PAGE_SIZE = 100; // rows rendered at a time; "Show more" adds another page

type Filters = {
  q: string;
  type: string;
  domain: string;
  region: string;
  due: Due;
  status: string;
  sort: "asc" | "desc";
};

const DEFAULTS: Filters = { q: "", type: "", domain: "", region: "", due: "open", status: "", sort: "asc" };

function readFilters(params: URLSearchParams): Filters {
  const due = params.get("due") ?? "";
  return {
    q: params.get("q") ?? "",
    type: params.get("type") ?? "",
    domain: params.get("domain") ?? "",
    region: params.get("region") ?? "",
    due: due in DUE_LABEL ? (due as Due) : DEFAULTS.due,
    status: params.get("status") ?? "",
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
export function JobBoard({ rows, today, gmailAccount }: { rows: BoardRow[]; today: string; gmailAccount: string | null }) {
  const searchParams = useSearchParams();
  const [filters, setFilters] = useState(() => readFilters(searchParams));
  const query = useDeferredValue(filters.q);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE_SIZE);
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
  // Any filter change starts again from the first page.
  const update = (patch: Partial<Filters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setLimit(PAGE_SIZE);
  };

  // Keep filters in the URL so a refresh or shared link shows the same view.
  useEffect(() => {
    const qs = filtersToQuery(filters);
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  }, [filters]);

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
          matchesDue(r.deadline, due, today) &&
          (!q || searchText(r).includes(q)),
      )
      .sort((a, b) => compareDeadline(a, b, dir));
  }, [optimisticRows, filters, query, due, today]);

  function changeStatus(id: number, status: Status) {
    setError(null);
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
  const selectClass = "rounded border border-gray-300 bg-white px-2 py-1.5";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <input
          type="search"
          value={filters.q}
          onChange={(e) => update({ q: e.target.value })}
          placeholder="Search company, role, location…"
          aria-label="Search"
          className="w-64 rounded border border-gray-300 px-2 py-1.5"
        />
        <button
          onClick={() => update({ due: closingSoon ? DEFAULTS.due : "7" })}
          aria-pressed={closingSoon}
          className={
            closingSoon
              ? "rounded-full border border-red-700 bg-red-50 px-3 py-1.5 font-medium text-red-800"
              : "rounded-full border border-gray-300 px-3 py-1.5 text-gray-700 hover:bg-gray-50"
          }
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
        <select aria-label="Status" value={filters.status} onChange={(e) => update({ status: e.target.value })} className={selectClass}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{STATUS_LABEL[s]}</option>
          ))}
        </select>
        {isFiltered && (
          <button onClick={() => update(DEFAULTS)} className="px-2 py-1.5 text-gray-500 underline hover:text-gray-900">
            Reset
          </button>
        )}
        <span className="ml-auto text-gray-500">
          {visible.length} of {rows.length} roles
        </span>
      </div>

      {error && (
        <p role="alert" className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}

      <div className="overflow-x-auto rounded border border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-3 py-2 font-medium">Company</th>
              <th className="px-3 py-2 font-medium">Role</th>
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 font-medium">Domain</th>
              <th className="px-3 py-2 font-medium">Location</th>
              <th className="px-3 py-2 font-medium" aria-sort={filters.sort === "asc" ? "ascending" : "descending"}>
                <button
                  onClick={() => update({ sort: filters.sort === "asc" ? "desc" : "asc" })}
                  className="uppercase tracking-wide hover:text-gray-900"
                >
                  Deadline {filters.sort === "asc" ? "↑" : "↓"}
                </button>
              </th>
              <th className="px-3 py-2 font-medium">Source</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="sticky right-0 bg-gray-50 px-3 py-2 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
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
          <div className="border-t border-gray-100 px-3 py-3 text-center text-sm">
            <button
              onClick={() => setLimit((n) => n + PAGE_SIZE)}
              className="rounded border border-gray-300 px-3 py-1.5 hover:bg-gray-50"
            >
              Show {Math.min(PAGE_SIZE, visible.length - limit)} more
            </button>
            <span className="ml-2 text-gray-500">
              Showing {limit} of {visible.length}
            </span>
          </div>
        )}
        {visible.length === 0 && (
          <p className="px-3 py-10 text-center text-sm text-gray-500">
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
    <tr className={row.status === "rejected" ? "text-gray-400" : undefined}>
      <td className="px-3 py-2 font-medium">{row.company}</td>
      <td className="px-3 py-2">
        {row.role}
        {/* On phones the status column starts off-screen, so progress shows here too. */}
        <Progress row={row} gmailAccount={gmailAccount} onAction={onAction} className="sm:hidden" />
      </td>
      <td className="whitespace-nowrap px-3 py-2">{TYPE_LABEL[row.type]}</td>
      <td className="px-3 py-2">{row.domain ?? "—"}</td>
      <td className="px-3 py-2">{location ?? "—"}</td>
      <td className="whitespace-nowrap px-3 py-2">
        <Deadline deadline={row.deadline} today={today} />
      </td>
      <td className="px-3 py-2 text-gray-500">{row.source ?? "—"}</td>
      <td className="px-3 py-2">
        <select
          value={row.status}
          onChange={(e) => onStatus(row.id, e.target.value as Status)}
          aria-label={`Status for ${row.company} ${row.role}`}
          className={`rounded border px-1.5 py-0.5 text-xs ${STATUS_STYLE[row.status]}`}
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>{STATUS_LABEL[s]}</option>
          ))}
        </select>
        <Progress row={row} gmailAccount={gmailAccount} onAction={onAction} className="hidden sm:block" />
      </td>
      {/* Sticky so Apply stays reachable when the table scrolls on small screens. */}
      <td className="sticky right-0 bg-white px-3 py-2">
        <div className="flex flex-col items-end gap-1 sm:flex-row sm:justify-end sm:gap-2">
          {href && (
            // Opening a posting only opens it; applying is marked separately.
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="whitespace-nowrap rounded bg-gray-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-gray-700"
            >
              Apply ↗
            </a>
          )}
          {row.status === "todo" ? (
            <button
              onClick={() => onStatus(row.id, "applied")}
              className="w-24 whitespace-nowrap rounded border border-gray-300 px-2.5 py-1 text-xs hover:bg-gray-50"
            >
              Mark applied
            </button>
          ) : (
            <span className="hidden w-24 sm:block" />
          )}
        </div>
      </td>
    </tr>
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
      {stage && <div className="mt-1 whitespace-nowrap text-xs font-medium text-blue-800">{stage}</div>}
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
  const small = "rounded border border-gray-300 px-1.5 py-0.5 hover:bg-gray-50";
  return (
    <li className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-900">
      <div className="font-medium">{ACTION_LABEL[action.kind]}</div>
      <div className="text-amber-800">{dueText(action)}</div>
      <div className="mt-1 flex flex-wrap items-center gap-1">
        <button onClick={() => onAction(action.id, "done")} className={`${small} bg-white`}>Done</button>
        <button onClick={() => onAction(action.id, "dismissed")} className={`${small} bg-white`}>Dismiss</button>
        {link ? (
          <a href={link.url} target="_blank" rel="noopener noreferrer" className="underline">
            {link.exact ? "Open in Gmail" : "Find in Gmail"}
          </a>
        ) : action.email ? (
          <a href="/settings" className="text-amber-800 underline">Add your Gmail to open the email</a>
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
  if (!deadline) return <span className="text-gray-500">Rolling</span>;
  const days = daysBetween(today, deadline);
  const label = days < 0 ? "closed" : days === 0 ? "today" : days === 1 ? "tomorrow" : `${days}d left`;
  const tone = days < 0 ? "text-gray-400" : days <= 7 ? "font-medium text-red-700" : "text-gray-500";
  return (
    <>
      {formatDate(deadline, today)} <span className={`text-xs ${tone}`}>{label}</span>
    </>
  );
}
