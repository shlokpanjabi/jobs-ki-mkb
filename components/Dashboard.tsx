import { daysBetween } from "@/lib/dates";
import type { PetStats } from "@/lib/jobs";
import type { BoardRow } from "@/lib/types";
import { CompanyMark } from "./CompanyMark";
import { Icon, type IconName } from "./Icons";

// The top of the board: a greeting, headline numbers, where applications
// stand, and what closes next. The headline numbers count every application
// (the same stats the pets use); the pipeline and deadlines count the roles on
// this user's board.

type Stage = { key: string; label: string; count: number; className: string };

function greeting(timeZone: string): string {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone }).format(new Date()));
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

function longDate(today: string): string {
  return new Date(`${today}T00:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "long", timeZone: "UTC",
  });
}

export function Dashboard({ rows, today, name, stats }: { rows: BoardRow[]; today: string; name: string; stats: PetStats }) {
  const applied = rows.filter((r) => r.status !== "todo");
  const invited = rows.filter((r) => r.status === "applied" && r.stage);
  const offers = rows.filter((r) => r.status === "offer");
  const rejected = rows.filter((r) => r.status === "rejected");
  const open = rows.filter((r) => r.status === "todo" && (r.deadline === null || daysBetween(today, r.deadline) >= 0));
  const closing = open
    .filter((r) => r.deadline !== null && daysBetween(today, r.deadline) <= 7)
    .sort((a, b) => (a.deadline! < b.deadline! ? -1 : a.deadline! > b.deadline! ? 1 : 0));
  const todos = rows.reduce((n, r) => n + r.actions.length, 0);
  const progressed = stats.assessments + stats.interviews;
  // Invited onward (assessment, interview or offer), out of everything applied to.
  const onward = stats.applied ? Math.min(100, Math.round(((progressed + stats.offers) / stats.applied) * 100)) : null;

  const stages: Stage[] = [
    { key: "todo", label: "To apply", count: open.length, className: "bg-line-300" },
    { key: "applied", label: "Applied", count: applied.length - invited.length - offers.length - rejected.length, className: "bg-ink-900" },
    { key: "invited", label: "Assessment / interview", count: invited.length, className: "bg-accent-500" },
    { key: "offer", label: "Offer", count: offers.length, className: "bg-ok-500" },
    { key: "rejected", label: "Rejected", count: rejected.length, className: "bg-line-400" },
  ];
  const total = stages.reduce((n, s) => n + s.count, 0);

  return (
    <section className="flex flex-col gap-4">
      <div>
        <p className="label-mono text-ink-500">{longDate(today)}</p>
        <h1 className="title-outline mt-2 text-5xl sm:text-7xl">
          {greeting(process.env.APP_TIMEZONE || "UTC")}, {name}<span className="text-accent-500">.</span>
        </h1>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi dark icon="send" label="Applications sent" value={stats.applied} note={`${open.length} open roles on your board`} />
        <Kpi icon="spark" label="Assessments & interviews" value={progressed} note={todos ? `${todos} to-do${todos === 1 ? "" : "s"} waiting` : "No to-dos waiting"} />
        <Kpi icon="trophy" label="Offers" value={stats.offers} note={onward === null ? "Apply to start tracking" : `${onward}% invited onward`} />
        <Kpi icon="clock" label="Closing in 7 days" value={closing.length} note={closing[0] ? `Next: ${closing[0].company}` : "Nothing urgent"} accent={closing.length > 0} />
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="card-plain flex flex-col gap-4 p-5">
          <div className="flex items-baseline justify-between">
            <h2 className="label-mono text-ink-500">Pipeline · on your board</h2>
            <span className="label-mono text-ink-300">{total} roles</span>
          </div>
          <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-line-100" role="img" aria-label={stages.map((s) => `${s.label}: ${s.count}`).join(", ")}>
            {total > 0 &&
              stages.filter((s) => s.count > 0).map((s) => (
                <div key={s.key} className={s.className} style={{ width: `${(s.count / total) * 100}%`, minWidth: 6 }} />
              ))}
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-5">
            {stages.map((s) => (
              <div key={s.key} className="flex flex-col gap-1">
                <dt className="flex items-center gap-1.5 text-xs text-ink-500">
                  <span className={`h-2 w-2 rounded-full ${s.className}`} />
                  {s.label}
                </dt>
                <dd className="text-2xl font-semibold tracking-tight">{s.count}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="card-plain flex flex-col p-5">
          <div className="flex items-baseline justify-between">
            <h2 className="label-mono text-ink-500">Closing soon</h2>
            <span className="label-mono text-ink-300">Next 7 days</span>
          </div>
          {closing.length === 0 ? (
            <p className="mt-4 text-sm text-ink-500">Nothing on your board closes this week.</p>
          ) : (
            <ul className="mt-3 flex flex-col divide-y divide-line-200">
              {closing.slice(0, 4).map((r) => {
                const days = daysBetween(today, r.deadline!);
                return (
                  <li key={r.id} className="flex items-center gap-3 py-2.5">
                    <CompanyMark name={r.company} size={30} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{r.company}</div>
                      <div className="truncate text-xs text-ink-500">{r.role}</div>
                    </div>
                    <span className={`label-mono whitespace-nowrap ${days <= 2 ? "text-accent-500" : "text-ink-500"}`}>
                      {days === 0 ? "Today" : days === 1 ? "Tomorrow" : `${days} days`}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

function Kpi({ icon, label, value, note, dark = false, accent = false }: {
  icon: IconName;
  label: string;
  value: number;
  note: string;
  dark?: boolean;
  accent?: boolean;
}) {
  return (
    <div className={`flex flex-col gap-4 rounded-2xl p-4 sm:gap-6 sm:p-5 ${dark ? "bg-ink-900 text-paper-50" : "card-plain"}`}>
      <div className="flex items-start justify-between gap-2">
        <span className={`label-mono ${dark ? "text-paper-100/70" : "text-ink-500"}`}>{label}</span>
        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${dark ? "bg-accent-500 text-white" : accent ? "bg-accent-500 text-white" : "bg-paper-100 text-ink-700"}`}>
          <Icon name={icon} size={16} />
        </span>
      </div>
      <div>
        <div className="text-4xl font-semibold leading-none tracking-[-0.04em] sm:text-5xl">{value}</div>
        <div className={`mt-2 text-xs ${dark ? "text-paper-100/70" : "text-ink-500"}`}>{note}</div>
      </div>
    </div>
  );
}
