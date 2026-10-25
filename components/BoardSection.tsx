import { cookies } from "next/headers";
import { switchUser } from "@/app/actions";
import Link from "next/link";
import { todayISO } from "@/lib/dates";
import { db } from "@/lib/db";
import { gmailAccount } from "@/lib/inbound/db.mjs";
import { describeHome } from "@/lib/home-filter";
import { getBoardRows, getPetStats, getUsers } from "@/lib/jobs";
import { petFor, SPECIES } from "@/lib/pets.mjs";
import type { BoardRow } from "@/lib/types";
import { USER_COOKIE } from "@/lib/user";
import { AddRole } from "./AddRole";
import { Dashboard } from "./Dashboard";
import { EvolutionWatch } from "./EvolutionWatch";
import { JobBoard } from "./JobBoard";
import { Party, type PetInfo } from "./Party";
import { Pet } from "./Pet";
import { UserSwitcher } from "./UserSwitcher";

export async function BoardSection() {
  const cookieUser = (await cookies()).get(USER_COOKIE)?.value ?? "";
  const [users, rows, gmail, stats] = await Promise.all([
    getUsers(),
    cookieUser ? getBoardRows(cookieUser) : Promise.resolve<BoardRow[]>([]),
    cookieUser ? boardGmailAccount(cookieUser) : Promise.resolve(null),
    getPetStats(),
  ]);
  const user = users.find((u) => u.id === cookieUser);
  const empty = { applied: 0, assessments: 0, interviews: 0, offers: 0, questsDone: 0 };
  const pets = users.map((u) => petFor(u.id, stats[u.id] ?? empty) as PetInfo);

  if (!user) {
    return (
      <div className="flex flex-col items-center gap-4 py-12 text-center">
        <h1 className="title-outline text-5xl sm:text-7xl">Who&apos;s applying?</h1>
        <p className="text-ink-500">Pick your name to see your roles and your pet.</p>
        <form action={switchUser} className="flex flex-wrap justify-center gap-4">
          {pets.map((pet) => (
            <button
              key={pet.userId}
              name="user"
              value={pet.userId}
              className="card-plain flex w-48 cursor-pointer flex-col items-center gap-1 px-4 pb-4 pt-3 transition-colors hover:border-ink-900"
            >
              <Pet species={pet.speciesKey} form={pet.form} id={`pick-${pet.userId}`} size={120} title={pet.name} />
              <span className="title-outline text-xl">{users.find((u) => u.id === pet.userId)?.name}</span>
              <span className="label-mono text-ink-500">{pet.name} · Lv {pet.level}</span>
            </button>
          ))}
        </form>
      </div>
    );
  }
  const mine = pets.find((p) => p.userId === user.id)!;
  const today = todayISO();

  return (
    <div className="flex flex-col gap-8">
      <EvolutionWatch
        userId={user.id}
        species={mine.speciesKey}
        form={mine.form}
        names={SPECIES[mine.speciesKey].forms.map((f) => f.name)}
      />
      <div className="flex justify-end">
        <UserSwitcher users={users} current={user.id} />
      </div>
      <Dashboard rows={rows} today={today} name={user.name} stats={stats[user.id] ?? empty} />
      <Party me={user.id} pets={pets} users={users} />
      <section className="card-plain flex flex-col gap-4 p-4 sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <p className="label-mono text-ink-500">Board</p>
            <h2 className="title-outline mt-1 text-3xl sm:text-4xl">All roles</h2>
          </div>
          <p className="text-sm text-ink-500">
            Showing {describeHome(user.homeRegions, user.homeTypes)}.{" "}
            <Link href="/settings" className="text-ink-900 underline decoration-1 underline-offset-4 hover:text-accent-500">Change</Link>
          </p>
        </div>
        <AddRole users={users.map((u) => u.name)} />
        <JobBoard rows={rows} today={today} gmailAccount={gmail} />
      </section>
    </div>
  );
}

// For "Open in Gmail" on actions. The board still loads if email sync isn't set up.
async function boardGmailAccount(userId: string): Promise<string | null> {
  try {
    return await gmailAccount(db(), userId);
  } catch {
    return null;
  }
}

export function BoardFallback() {
  return <p className="label-mono py-16 text-center text-ink-300">Loading…</p>;
}
