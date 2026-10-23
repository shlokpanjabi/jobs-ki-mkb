import Link from "next/link";
import { XP } from "@/lib/pets.mjs";
import type { User } from "@/lib/types";
import { Pet, type Form, type Species } from "./Pet";

// What lib/pets.mjs petFor() returns.
export type PetInfo = {
  userId: string;
  speciesKey: Species;
  type: string;
  form: Form;
  name: string;
  blurb: string;
  nextName: string | null;
  level: number;
  xp: number;
  toNext: number | null;
  progress: number;
  swatches: string[];
  blob: string;
  stats: { applied: number; assessments: number; interviews: number; offers: number; questsDone: number };
};

// The board's header: your pet up front, the party ranked beside it.
export function Party({ me, pets, users }: { me: string; pets: PetInfo[]; users: User[] }) {
  const mine = pets.find((p) => p.userId === me);
  const ranked = [...pets].sort((a, b) => b.xp - a.xp);
  const nameOf = (id: string) => users.find((u) => u.id === id)?.name ?? id;
  if (!mine) return null;
  return (
    <section className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <HeroCard pet={mine} owner={nameOf(me)} />
      <div className="card-plain flex flex-col gap-2 p-4">
        <div className="flex items-center justify-between">
          <h2 className="label-mono text-ink-500">Party ranking</h2>
          <Link href="/pets" className="text-sm text-ink-900 underline decoration-1 underline-offset-4 hover:text-accent-500">Pet Dex →</Link>
        </div>
        <ol className="flex flex-col gap-2">
          {ranked.map((pet, i) => (
            <li
              key={pet.userId}
              className={`flex items-center gap-3 rounded-sm border px-2 py-1.5 ${
                pet.userId === me ? "border-ink-900 bg-white" : "border-line-200 bg-paper-50"
              }`}
            >
              <span className={`label-mono w-6 ${i === 0 && pet.xp > 0 ? "text-accent-500" : "text-ink-300"}`}>
                {String(i + 1).padStart(2, "0")}
              </span>
              <Pet species={pet.speciesKey} form={pet.form} id={`party-${pet.userId}`} size={56} title={pet.name} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-display font-semibold leading-tight">
                  {nameOf(pet.userId)} <span className="font-sans text-sm text-ink-500">· {pet.name}</span>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <div className="xp-track h-2.5 flex-1" aria-hidden>
                    <div className="xp-fill" style={{ width: `${Math.round(pet.progress * 100)}%` }} />
                  </div>
                  <span className="whitespace-nowrap text-xs text-ink-500">Lv {pet.level}</span>
                </div>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function HeroCard({ pet, owner }: { pet: PetInfo; owner: string }) {
  const s = pet.stats;
  return (
    <div className="card-stitched flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
      <div
        className="relative mx-auto grid h-44 w-44 shrink-0 place-items-center rounded-sm sm:mx-0"
        style={{ background: pet.blob }}
      >
        <Pet species={pet.speciesKey} form={pet.form} id={`hero-${pet.userId}`} size={172} title={pet.name} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="title-outline text-4xl">{pet.name}</h2>
          <span className="label-mono rounded-full border border-line-300 px-2.5 py-0.5 text-ink-700">
            Lv {pet.level} · {pet.type} type
          </span>
          <span className="text-sm text-ink-500">{owner}&apos;s pet</span>
        </div>
        <p className="text-sm text-ink-700">{pet.blurb}</p>

        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="xp-track h-4" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pet.progress * 100)} aria-label="Progress to next evolution">
              <div className="xp-fill" style={{ width: `${Math.max(4, Math.round(pet.progress * 100))}%` }} />
            </div>
            <div className="mt-1 text-xs text-ink-500">
              {pet.toNext === null
                ? `${pet.xp} XP · fully evolved!`
                : `${pet.xp} XP · ${pet.toNext} XP until it evolves`}
            </div>
          </div>
          {pet.nextName && (
            <div className="flex shrink-0 flex-col items-center" title={`Evolves at ${pet.xp + (pet.toNext ?? 0)} XP`}>
              <Pet species={pet.speciesKey} form={(pet.form + 1) as Form} id={`next-${pet.userId}`} size={52} silhouette title="Next form, still locked" />
              <span className="font-display text-xs text-ink-500">???</span>
            </div>
          )}
        </div>

        <ul className="flex flex-wrap gap-1.5 text-xs font-semibold">
          <Stat label={["applied", "applied"]} value={s.applied} xp={XP.applied} tone="bg-mark-100 text-ink-700" />
          <Stat label={["assessment", "assessments"]} value={s.assessments} xp={XP.assessment} tone="bg-note-100 text-note-700" />
          <Stat label={["interview", "interviews"]} value={s.interviews} xp={XP.interview} tone="bg-accent-300/40 text-accent-700" />
          <Stat label={["offer", "offers"]} value={s.offers} xp={XP.offer} tone="bg-ok-100 text-ok-700" />
          <Stat label={["to-do done", "to-dos done"]} value={s.questsDone} xp={XP.quest} tone="border border-line-300 text-ink-700" />
        </ul>
      </div>
    </div>
  );
}

// label: [singular, plural]
function Stat({ label, value, xp, tone }: { label: [string, string]; value: number; xp: number; tone: string }) {
  return (
    <li className={`rounded-full px-2.5 py-1 ${tone}`} title={`+${xp} XP each`}>
      {value} {value === 1 ? label[0] : label[1]}
    </li>
  );
}
