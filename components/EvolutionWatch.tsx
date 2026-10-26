"use client";

import { useEffect, useId, useRef, useState } from "react";
import { evolutionSound, type EvolutionSound, type SoundState } from "./evolution-sound";
import { Pet, type Form, type Species } from "./Pet";

const KEY = (userId: string) => `apply-tracker:pet-form:${userId}`;
const SOUND_KEY = "apply-tracker:evolution-sound"; // "off" when muted
const CONFETTI = ["#FF4F1A", "#111110", "#E9E7E1", "#2F8A4B", "#33527F"];

// Celebrates an evolution the first time you see your board after it happens.
// The last form you saw is kept in this browser; a first visit only records it.
// nickname: the pet's nickname, which it keeps through every form (null when it
// has none and goes by the form's name), as on the party screen.
export function EvolutionWatch({ userId, species, form, names, nickname }: {
  userId: string;
  species: Species;
  form: Form;
  names: string[];
  nickname: string | null;
}) {
  const [from, setFrom] = useState<Form | null>(null);

  useEffect(() => {
    const save = () => {
      try {
        localStorage.setItem(KEY(userId), String(form));
      } catch {
        // storage blocked: nothing to remember
      }
    };
    let seen: number | null = null;
    try {
      const raw = localStorage.getItem(KEY(userId));
      seen = raw === null ? null : Number(raw);
    } catch {
      return; // storage blocked: just skip the celebration
    }
    if (seen === null || !Number.isInteger(seen) || seen >= form) {
      save();
      return;
    }
    // Saved only once it's shown, so an effect that runs twice still celebrates.
    // From the last form seen, even if it has jumped two since.
    const show = setTimeout(() => {
      save();
      setFrom(seen as Form);
    }, 0);
    return () => clearTimeout(show);
  }, [userId, form]);

  if (from === null) return null;
  return (
    <Evolution
      species={species}
      from={from}
      to={form}
      oldName={nickname ?? names[from]}
      newName={names[form]}
      onClose={() => setFrom(null)}
    />
  );
}

type Stage = "intro" | "glow" | "alternate" | "reveal";

// Beats, in ms after it opens. The swaps are 500 ms or more apart, each a
// 400 ms crossfade between two silhouettes: never a fast flash.
const GLOW_AT = 1100;
const ALTERNATE_AT = 2000;
const SWAPS_AT = [2600, 3150, 3700, 4200, 4700]; // ends on the new form
const REVEAL_AT = 5300;

function soundWanted(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) !== "off";
  } catch {
    return true;
  }
}

// The cutscene: "What? X is evolving!", a glow, the old and new shapes taking
// turns, then the new form in colour. Escape, the backdrop or Continue close it
// at any point, which also stops the sound.
function Evolution({ species, from, to, oldName, newName, onClose }: {
  species: Species;
  from: Form;
  to: Form;
  oldName: string;
  newName: string;
  onClose: () => void;
}) {
  // Reduced motion: straight to the new form.
  const [reduced] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [stage, setStage] = useState<Stage>(reduced ? "reveal" : "intro");
  const [shape, setShape] = useState<Form>(from); // which silhouette shows while they alternate
  const [sound, setSound] = useState<SoundState>(soundWanted() ? "blocked" : "off");
  const engine = useRef<EvolutionSound | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const lineId = useId();
  const close = useRef(onClose);

  useEffect(() => {
    const fx = evolutionSound(!soundWanted(), setSound);
    engine.current = fx;
    const at = (ms: number, beat: () => void) => setTimeout(beat, ms);
    const timers = reduced
      ? [at(150, fx.chime)]
      : [
          at(250, fx.stinger),
          at(GLOW_AT, () => setStage("glow")),
          at(ALTERNATE_AT, () => {
            setStage("alternate");
            fx.blip(0);
          }),
          ...SWAPS_AT.map((ms, i) =>
            at(ms, () => {
              setShape(i % 2 === 0 ? to : from);
              fx.blip(i + 1);
            }),
          ),
          at(REVEAL_AT, () => {
            setStage("reveal");
            fx.chime();
          }),
        ];

    // A modal: focus inside it, Escape closes, focus goes back afterwards.
    const before = document.activeElement as HTMLElement | null;
    card.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      timers.forEach(clearTimeout);
      document.removeEventListener("keydown", onKey);
      fx.close();
      engine.current = null;
      before?.focus?.();
    };
  }, [reduced, from, to]);

  const toggleSound = () => {
    const mute = sound !== "off";
    try {
      localStorage.setItem(SOUND_KEY, mute ? "off" : "on");
    } catch {
      // storage blocked: applies to this time only
    }
    engine.current?.setMuted(mute);
  };

  const revealed = stage === "reveal";
  const layer = (visible: boolean) =>
    `absolute inset-0 grid place-items-center transition-opacity duration-[400ms] ease-in-out ${visible ? "opacity-100" : "opacity-0"}`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={lineId}
      className="evolve-fade fixed inset-0 z-50 grid place-items-center bg-ink-900/40 p-4"
      onClick={onClose}
    >
      {revealed &&
        !reduced &&
        Array.from({ length: 36 }, (_, i) => (
          <span
            key={i}
            aria-hidden
            className="confetti pointer-events-none fixed top-0 h-3 w-2 rounded-sm"
            style={{
              left: `${(i * 37) % 100}%`,
              background: CONFETTI[i % CONFETTI.length],
              animationDelay: `${(i % 9) * 0.12}s`,
            }}
          />
        ))}
      <div
        ref={card}
        tabIndex={-1}
        className="pop-in card-stitched relative w-full max-w-sm px-6 pb-6 pt-10 text-center outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="label-mono absolute left-0 right-0 top-0 border-b border-ink-900 py-2 text-center text-ink-900">
          {revealed ? "Evolved!" : "Evolving..."}
        </div>
        <button
          type="button"
          onClick={toggleSound}
          aria-pressed={sound !== "off"}
          className="label-mono absolute right-2 top-1 z-10 rounded-full px-2 py-1 text-ink-500 outline-offset-2 outline-accent-500 hover:text-ink-900 focus-visible:outline-2"
        >
          {sound === "off" ? "Sound off" : sound === "blocked" ? "Tap for sound" : "Sound on"}
        </button>

        <div className="relative mx-auto h-48 w-48">
          {!reduced && (
            <>
              <div className={layer(stage === "intro" || stage === "glow")}>
                <div className={stage === "glow" ? "evolve-glow" : undefined}>
                  <Pet species={species} form={from} id="evolve-old" size={170} title={oldName} />
                </div>
              </div>
              <div className={layer(stage === "alternate" && shape === from)} aria-hidden>
                <Pet species={species} form={from} id="evolve-old-shape" size={170} silhouette />
              </div>
              <div className={layer(stage === "alternate" && shape === to)} aria-hidden>
                <Pet species={species} form={to} id="evolve-new-shape" size={190} silhouette />
              </div>
            </>
          )}
          {revealed && (
            <div className="evolve-fade absolute inset-0 grid place-items-center">
              <div className="pop-in">
                <Pet species={species} form={to} id="evolve-new" size={190} title={newName} />
              </div>
            </div>
          )}
        </div>
        <p id={lineId} aria-live="polite" className="mt-2 font-display text-lg text-ink-700">
          {revealed ? `Congratulations! Your ${oldName} evolved into ${newName}!` : `What? ${oldName} is evolving!`}
        </p>
        <p className="mt-1 text-sm text-ink-500">All those applications are paying off.</p>
        <button onClick={onClose} className="btn-3d btn-cocoa mt-5 px-6 py-2">
          Continue
        </button>
      </div>
    </div>
  );
}
