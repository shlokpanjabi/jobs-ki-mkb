"use client";

import { useSearchParams } from "next/navigation";
import { useDeferredValue, useEffect, useMemo, useOptimistic, useState, useTransition } from "react";
import { updateStatus } from "@/app/actions";
import { daysBetween } from "@/lib/dates";
import { JOB_TYPES, STATUSES, type BoardRow, type JobType, type Status } from "@/lib/types";

export type View = "all" | "closing";

const TYPE_LABEL: Record<JobType, string> = {
  internship: "Internship",
  "part-time": "Part-time",
  fellowship: "Fellowship",
};

const STATUS_LABEL: Record<Status, string> = {
  todo: "To do",
  applied: "Applied",
  rejected: "Rejected",
  offer: "Offer",
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

export function JobBoard({ rows, today, view }: { rows: BoardRow[]; today: string; view: View }) {
  const searchParams = useSearchParams();
  const [filters, setFilters] = useState(() => readFilters(searchParams));
  const query = useDeferredValue(filters.q);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [optimisticRows, setOptimisticStatus] = useOptimistic(
    rows,
    (current: BoardRow[], change: { id: number; status: Status }) =>
      current.map((row) => (row.id === change.id ? { ...row, status: change.status } : row)),
  );

  const due: Due = view === "closing" ? "7" : filters.due;
  const update = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));

  // Keep filters in the URL so a refresh or shared link shows the same view.
  useEffect(() => {
    const qs = filtersToQuery(view === "closing" ? { ...filters, due: DEFAULTS.due } : filters);
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  }, [filters, view]);

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
      setOptimisticStatus({ id, status });
      try {
        const result = await updateStatus(id, status);
        if (!result.ok) setError(result.error);
      } catch {
        setError("Couldn't save that change. Check your connection and try again.");
      }
    });
  }

  const isFiltered = filtersToQuery({ ...filters, due: view === "closing" ? DEFAULTS.due : filters.due }) !== "";
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
        {view === "all" && (
          <select aria-label="Deadline" value={filters.due} onChange={(e) => update({ due: e.target.value as Due })} className={selectClass}>
            {(Object.keys(DUE_LABEL) as Due[]).map((d) => (
              <option key={d} value={d}>{DUE_LABEL[d]}</option>
            ))}
          </select>
        )}
        <select aria-label="Status" value={filters.status} onChange={(e) => update({ status: e.target.value })} className={selectClass}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{STATUS_LABEL[s]}</option>
          ))}
        </select>
        {isFiltered && (
          <button onClick={() => setFilters(DEFAULTS)} className="px-2 py-1.5 text-gray-500 underline hover:text-gray-900">
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
            {visible.map((row) => (
              <JobRow key={row.id} row={row} today={today} onStatus={changeStatus} />
            ))}
          </tbody>
        </table>
        {visible.length === 0 && (
          <p className="px-3 py-10 text-center text-sm text-gray-500">
            {rows.length === 0
              ? "No roles on your board yet. Roles show up here when they're posted to /api/jobs with your key."
              : view === "closing"
                ? "Nothing closing in the next 7 days."
                : "No roles match these filters."}
          </p>
        )}
      </div>
    </div>
  );
}

function JobRow({
  row,
  today,
  onStatus,
}: {
  row: BoardRow;
  today: string;
  onStatus: (id: number, status: Status) => void;
}) {
  const location = row.region && row.region !== row.location
    ? [row.location, row.region].filter(Boolean).join(" · ")
    : row.location ?? row.region;
  const href = /^https?:\/\//i.test(row.link) ? row.link : undefined;

  return (
    <tr className={row.status === "rejected" ? "text-gray-400" : undefined}>
      <td className="px-3 py-2 font-medium">{row.company}</td>
      <td className="px-3 py-2">{row.role}</td>
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
      </td>
      {/* Sticky so Apply stays reachable when the table scrolls on small screens. */}
      <td className="sticky right-0 bg-white px-3 py-2">
        <div className="flex flex-col items-end gap-1 sm:flex-row sm:justify-end sm:gap-2">
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="whitespace-nowrap rounded bg-gray-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-gray-700"
          >
            Apply ↗
          </a>
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
