import { switchUser } from "@/app/actions";
import type { User } from "@/lib/types";

// A plain form so switching works before (or without) client JS.
export function UserSwitcher({ users, current }: { users: User[]; current: string | null }) {
  return (
    <form action={switchUser} className="flex items-center gap-1 text-sm">
      {current && <span className="mr-1 text-gray-500">Viewing as</span>}
      {users.map((user) => (
        <button
          key={user.id}
          name="user"
          value={user.id}
          aria-pressed={user.id === current}
          className={
            user.id === current
              ? "rounded border border-gray-900 bg-gray-900 px-3 py-1 text-white"
              : "rounded border border-gray-300 px-3 py-1 hover:bg-gray-50"
          }
        >
          {user.name}
        </button>
      ))}
    </form>
  );
}
