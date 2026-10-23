import { switchUser } from "@/app/actions";
import type { User } from "@/lib/types";

// A plain form so switching works before (or without) client JS.
export function UserSwitcher({ users, current }: { users: User[]; current: string | null }) {
  return (
    <form action={switchUser} className="flex flex-wrap items-center gap-1.5 text-sm">
      {current && <span className="mr-1 font-semibold text-cocoa-500">Viewing as</span>}
      {users.map((user) => (
        <button
          key={user.id}
          name="user"
          value={user.id}
          aria-pressed={user.id === current}
          className={`btn-3d px-3 py-1 ${user.id === current ? "btn-cocoa" : "btn-cream"}`}
        >
          {user.name}
        </button>
      ))}
    </form>
  );
}
