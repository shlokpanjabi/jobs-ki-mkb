import { saveHomeFilter } from "@/app/settings/actions";
import { HOME_REGIONS, TYPE_PLURAL } from "@/lib/home-filter";
import { JOB_TYPES, type User } from "@/lib/types";

// Plain form so it works without client JS, like the user switcher.
export function HomeFilterForm({ user, notice }: { user: User; notice?: "saved" | "empty" }) {
  const typeChecked = (t: string) => user.homeTypes === null || user.homeTypes.includes(t);
  return (
    <section className="card-plain flex flex-col gap-2 p-4">
      <h2 className="font-display font-semibold text-cocoa-900">What shows on your board</h2>
      <p className="text-sm font-semibold text-cocoa-500">
        Untick anything you don&apos;t want to see. You can still search and filter within what&apos;s left.
      </p>
      <form action={saveHomeFilter} className="flex flex-col gap-3 text-sm">
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 font-display font-semibold text-cocoa-500">Places</legend>
          {HOME_REGIONS.map((r) => (
            <label key={r.key} className="flex items-center gap-2">
              <input type="checkbox" className="h-4 w-4 accent-carrot-500" name="region" value={r.key} defaultChecked={user.homeRegions.includes(r.key)} />
              Show {r.key === "other" ? "roles from anywhere else, or with no location given" : `${r.label} roles`}
            </label>
          ))}
        </fieldset>
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 font-display font-semibold text-cocoa-500">Kinds of role</legend>
          {JOB_TYPES.map((t) => (
            <label key={t} className="flex items-center gap-2">
              <input type="checkbox" className="h-4 w-4 accent-carrot-500" name="type" value={t} defaultChecked={typeChecked(t)} />
              Show {TYPE_PLURAL[t]}
            </label>
          ))}
        </fieldset>
        <div className="flex items-center gap-3">
          <button className="btn-3d btn-carrot px-3 py-1">Save</button>
          {notice === "saved" && <span className="font-semibold text-leaf-700">Saved. Your board now shows these.</span>}
          {notice === "empty" && (
            <span className="font-semibold text-berry-500">Tick at least one place and one kind of role, or your board would be empty.</span>
          )}
        </div>
      </form>
    </section>
  );
}
