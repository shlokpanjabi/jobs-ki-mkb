import { cookies } from "next/headers";
import Link from "next/link";
import { todayISO } from "@/lib/dates";
import { describeHome } from "@/lib/home-filter";
import { getBoardRows, getUsers } from "@/lib/jobs";
import type { BoardRow } from "@/lib/types";
import { USER_COOKIE } from "@/lib/user";
import { JobBoard, type View } from "./JobBoard";
import { UserSwitcher } from "./UserSwitcher";

const TITLES: Record<View, string> = {
  all: "All roles",
  closing: "Closing in the next 7 days",
};

export async function BoardSection({ view }: { view: View }) {
  const cookieUser = (await cookies()).get(USER_COOKIE)?.value ?? "";
  const [users, rows] = await Promise.all([
    getUsers(),
    cookieUser ? getBoardRows(cookieUser) : Promise.resolve<BoardRow[]>([]),
  ]);
  const user = users.find((u) => u.id === cookieUser);

  if (!user) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <h1 className="text-lg font-semibold">Who&apos;s applying?</h1>
        <p className="text-sm text-gray-500">Pick your name to see the roles you&apos;re eligible for.</p>
        <UserSwitcher users={users} current={null} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">{TITLES[view]}</h1>
        <UserSwitcher users={users} current={user.id} />
      </div>
      <p className="text-sm text-gray-500">
        Showing {describeHome(user.homeRegions, user.homeTypes)}.{" "}
        <Link href="/settings" className="underline hover:text-gray-900">Change this in Settings</Link>
      </p>
      <JobBoard rows={rows} today={todayISO()} view={view} />
    </div>
  );
}

export function BoardFallback() {
  return <p className="py-16 text-center text-sm text-gray-400">Loading…</p>;
}
