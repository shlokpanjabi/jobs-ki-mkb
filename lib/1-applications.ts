import { ensureAppSchema } from "./app-schema.mjs";
import { db } from "./db";
import { openActions } from "./inbound/db.mjs";
import type { ActionKind, BoardAction, BoardRow } from "./types";

type ActionRow = {
  id: number; kind: ActionKind; due_date: string | null; due_time: string | null; due_tz: string | null;
  reminders: number; job_key: string; subject: string | null; sender_domain: string | null; source_message_id: string | null;
};

// Every role the user has moved past "to do" on, whatever their home filter
// says (the board hides roles outside it, but they are still applications).
// Same dedupe as getPetStats in lib/jobs.ts, so the count equals "Applications
// sent" on the dashboard. Open actions are kept for the next-step pills only;
// email details are dropped.
export async function getApplications(userId: string): Promise<BoardRow[]> {
  const sql = db();
  await ensureAppSchema(sql);
  const rows = await sql<(Omit<BoardRow, "actions"> & { k: string })[]>`
    with apps as (
      select distinct on (coalesce(j.dedupe_key, 'id:' || j.id))
             j.id, j.company, j.role, j.type, j.domain, j.location, j.region,
             to_char(j.deadline, 'YYYY-MM-DD') as deadline, j.source, j.link,
             uj.status, uj.stage, coalesce(j.dedupe_key, 'id:' || j.id) as k
      from user_jobs uj join jobs j on j.id = uj.job_id
      where uj.user_id = ${userId} and uj.status in ('applied', 'rejected', 'offer')
      order by coalesce(j.dedupe_key, 'id:' || j.id), uj.stage desc nulls last, j.id
    )
    select * from apps order by company, role`;
  const byJob = new Map<string, BoardAction[]>();
  try {
    for (const r of (await openActions(sql, userId)) as ActionRow[]) {
      const list = byJob.get(r.job_key) ?? [];
      list.push({ id: r.id, kind: r.kind, dueDate: r.due_date, dueTime: r.due_time, dueTz: r.due_tz, reminders: r.reminders, email: null });
      byJob.set(r.job_key, list);
    }
  } catch (err) {
    console.error(`applications: actions unavailable: ${err instanceof Error ? err.message : err}`);
  }
  return rows.map(({ k, ...row }) => ({ ...row, actions: byJob.get(k) ?? [] }));
}
