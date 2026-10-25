"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { addRole, type AddRoleState } from "@/app/actions";
import { HOME_REGIONS } from "@/lib/home-filter";
import { JOB_TYPES, type JobType } from "@/lib/types";

const TYPE_LABEL: Record<JobType, string> = {
  internship: "Internship",
  "part-time": "Part-time",
  fellowship: "Fellowship",
  hackathon: "Hackathon",
};
// The board's region labels, as the region filter shows them.
const REGIONS = HOME_REGIONS.flatMap((r) => [...r.regions]);

// "A, B and C"
function list(items: string[]) {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}
const boards = (names: string[]) => `${list(names.map((n) => `${n}'s`))} board${names.length > 1 ? "s" : ""}`;

// "Add role" on the board: a form that adds one role to everyone's board
// (`users`, the names, all shown on the form).
export function AddRole({ users }: { users: string[] }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<AddRoleState, FormData>(addRole, { status: "idle" });
  const form = useRef<HTMLFormElement>(null);

  // A role was saved: clear the fields for the next one.
  useEffect(() => {
    if (state.status === "done" && state.outcome !== "exists") form.current?.reset();
  }, [state]);

  if (!open) {
    return (
      <div className="flex justify-end">
        <button type="button" onClick={() => setOpen(true)} className="btn-3d btn-cocoa px-4 py-1.5 text-sm">
          + Add role
        </button>
      </div>
    );
  }

  const field = "field w-full px-3 py-1.5 text-sm";
  const label = "flex min-w-0 flex-col gap-1";
  return (
    <div className="card-stitched flex flex-col gap-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="label-mono text-ink-500">Add role</p>
          <h3 className="mt-1 text-xl font-semibold text-ink-900">
            Adding to <span className="text-accent-500">everyone&apos;s</span> board
          </h3>
          <p className="mt-1 text-sm text-ink-500">{list(users)} will all see it.</p>
        </div>
        <button type="button" onClick={() => setOpen(false)} className="btn-3d btn-cream px-3 py-1 text-sm">
          Close
        </button>
      </div>

      <form
        ref={form}
        noValidate
        // Submitted by hand rather than with action={...}: React resets a form after
        // an action runs, which would wipe what was typed when there's an error.
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          startTransition(() => action(data));
        }}
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
      >
        <label className={label}>
          <span className="label-mono text-ink-500">Company *</span>
          <input name="company" maxLength={300} placeholder="e.g. Revolut" className={field} />
        </label>
        <label className={`${label} lg:col-span-2`}>
          <span className="label-mono text-ink-500">Role *</span>
          <input name="role" maxLength={300} placeholder="e.g. Software Engineering Intern 2027" className={field} />
        </label>
        <label className={label}>
          <span className="label-mono text-ink-500">Type *</span>
          <select name="type" defaultValue="internship" className={field}>
            {JOB_TYPES.map((t) => (
              <option key={t} value={t}>{TYPE_LABEL[t]}</option>
            ))}
          </select>
        </label>
        <label className={`${label} sm:col-span-2 lg:col-span-4`}>
          <span className="label-mono text-ink-500">Link to the posting *</span>
          <input name="link" type="url" inputMode="url" maxLength={2048} placeholder="https://…" className={field} />
        </label>
        <label className={label}>
          <span className="label-mono text-ink-500">Location</span>
          <input name="location" maxLength={300} placeholder="e.g. London" className={field} />
        </label>
        <label className={label}>
          <span className="label-mono text-ink-500">Region</span>
          <select name="region" defaultValue="" className={field}>
            <option value="">From the location</option>
            {REGIONS.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </label>
        <label className={label}>
          <span className="label-mono text-ink-500">Domain</span>
          <input name="domain" maxLength={300} placeholder="e.g. Software" className={field} />
        </label>
        <label className={label}>
          <span className="label-mono text-ink-500">Deadline</span>
          <input name="deadline" type="date" className={field} />
        </label>
        <label className={`${label} sm:col-span-2`}>
          <span className="label-mono text-ink-500">Where you found it</span>
          <input name="source" maxLength={270} placeholder="e.g. LinkedIn post" className={field} />
        </label>
        <div className="flex flex-wrap items-end gap-3 sm:col-span-2">
          <button type="submit" disabled={pending} className="btn-3d btn-carrot px-5 py-2 text-sm disabled:opacity-60">
            {pending ? "Adding…" : "Add for everyone"}
          </button>
        </div>
      </form>

      <div aria-live="polite">
        {state.status === "error" && (
          <ul role="alert" className="rounded-2xl border border-alert-500/40 bg-alert-100 px-4 py-2 text-sm text-alert-500">
            {state.errors.map((e) => (
              <li key={e}>{e.charAt(0).toUpperCase() + e.slice(1)}</li>
            ))}
          </ul>
        )}
        {state.status === "done" && (
          <p
            className={`rounded-2xl border px-4 py-2 text-sm ${
              state.outcome === "exists" ? "border-mark-300 bg-mark-100 text-mark-600" : "border-ok-400/50 bg-ok-100 text-ok-700"
            }`}
          >
            {state.outcome !== "exists" && (
              <>
                Added <b>{state.role}</b> at {state.company} to {boards(state.addedFor)}.
                {state.alreadyOn.length > 0 && (
                  <> It was already on {boards(state.alreadyOn)}, which {state.alreadyOn.length > 1 ? "were" : "was"} left as it was.</>
                )}
              </>
            )}
            {state.outcome === "exists" && <>That link is already on everyone&apos;s board, so nothing was changed.</>}
          </p>
        )}
      </div>
    </div>
  );
}
