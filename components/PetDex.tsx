import { cookies } from "next/headers";
import { getPetStats, getUsers } from "@/lib/jobs";
import { EVOLVE_AT, petFor, SPECIES, XP } from "@/lib/pets.mjs";
import { USER_COOKIE } from "@/lib/user";
import type { PetInfo } from "./Party";
import { Pet, type Form } from "./Pet";

// Every pet line: forms you've reached in colour, the rest as silhouettes.
export async function PetDex() {
  const me = (await cookies()).get(USER_COOKIE)?.value ?? "";
  const [users, stats] = await Promise.all([getUsers(), getPetStats()]);
  const empty = { applied: 0, assessments: 0, interviews: 0, offers: 0, questsDone: 0 };
  const lines = users
    .map((u) => ({ user: u, pet: petFor(u.id, stats[u.id] ?? empty) as PetInfo }))
    .sort((a, b) => Number(b.user.id === me) - Number(a.user.id === me));

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="title-outline text-5xl sm:text-7xl">Pet Dex</h1>
        <p className="mt-1 text-ink-500">
          Every application feeds your pet. Get invited to later rounds and it grows faster.
        </p>
      </div>

      <section className="card-plain grid gap-3 p-4 sm:grid-cols-5">
        <h2 className="font-display text-lg text-ink-700 sm:col-span-5">How pets grow</h2>
        <Rule xp={XP.applied} text="for each role you apply to" />
        <Rule xp={XP.assessment} text="when you're invited to an assessment" />
        <Rule xp={XP.interview} text="when you're invited to interview" />
        <Rule xp={XP.offer} text="for every offer" />
        <Rule xp={XP.quest} text="for each to-do you finish" />
        <p className="text-sm text-ink-500 sm:col-span-5">
          Pets evolve at {EVOLVE_AT[1]} XP and {EVOLVE_AT[2]} XP. A rejection never takes XP away: you still applied.
        </p>
      </section>

      {lines.map(({ user, pet }) => {
        const species = SPECIES[pet.speciesKey];
        return (
          <section key={user.id} className="card-stitched p-5">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="title-outline text-2xl">{user.name}&apos;s line</h2>
              <span className="rounded-full bg-white px-2.5 py-0.5 text-xs text-ink-700">
                {species.type} type · Lv {pet.level} · {pet.xp} XP
              </span>
            </div>
            <ol className="mt-4 grid gap-3 sm:grid-cols-3">
              {species.forms.map((f, i) => {
                const unlocked = i <= pet.form;
                return (
                  <li key={f.name} className={`flex items-center gap-3 rounded-sm border p-3 ${unlocked ? "border-line-300 bg-white" : "border-dashed border-line-300 bg-paper-50"}`}>
                    <div className="grid h-24 w-24 shrink-0 place-items-center rounded-sm" style={{ background: unlocked ? species.blob : "transparent" }}>
                      <Pet species={pet.speciesKey} form={i as Form} id={`dex-${user.id}-${i}`} size={92} silhouette={!unlocked} title={unlocked ? f.name : "Locked form"} />
                    </div>
                    <div className="min-w-0">
                      <div className="font-display text-lg font-semibold">{unlocked ? f.name : "???"}</div>
                      <p className="text-xs text-ink-500">
                        {unlocked ? f.blurb : `Evolves at ${EVOLVE_AT[i]} XP.`}
                      </p>
                      {i === pet.form && (
                        <span className="mt-1 inline-block rounded-full bg-mark-100 px-2 py-0.5 text-[11px] text-ink-700">
                          Current form
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
            <div className="mt-3 flex gap-1.5" aria-label="Colours">
              {species.swatches.map((c) => (
                <span key={c} className="h-6 w-6 rounded-full border border-white shadow" style={{ background: c }} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function Rule({ xp, text }: { xp: number; text: string }) {
  return (
    <div className="rounded-sm bg-mark-100 p-3">
      <div className="title-outline text-2xl">+{xp} XP</div>
      <div className="text-sm text-ink-700">{text}</div>
    </div>
  );
}
