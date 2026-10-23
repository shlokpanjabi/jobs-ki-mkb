"use client";

import { useEffect, useState } from "react";
import { Pet, type Form, type Species } from "./Pet";

const KEY = (userId: string) => `apply-tracker:pet-form:${userId}`;
const CONFETTI = ["#FF9F45", "#FFD15C", "#8FD16F", "#B9A2F0", "#E2556B", "#FFC08A"];

// Celebrates an evolution the first time you see your board after it happens.
// The last form you saw is kept in this browser; a first visit only records it.
export function EvolutionWatch({ userId, species, form, names }: {
  userId: string;
  species: Species;
  form: Form;
  names: string[];
}) {
  const [from, setFrom] = useState<Form | null>(null);
  const [revealed, setRevealed] = useState(false);

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
    // Reveal the new form after the glow.
    const show = setTimeout(() => {
      save();
      setFrom(seen as Form);
    }, 0);
    const reveal = setTimeout(() => setRevealed(true), 1700);
    return () => {
      clearTimeout(show);
      clearTimeout(reveal);
    };
  }, [userId, form]);

  if (from === null) return null;
  const close = () => setFrom(null);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${names[from]} evolved into ${names[form]}`}
      className="fixed inset-0 z-50 grid place-items-center bg-cocoa-900/40 p-4"
      onClick={close}
    >
      {Array.from({ length: 36 }, (_, i) => (
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
      <div className="pop-in card-stitched relative w-full max-w-sm px-6 pb-6 pt-10 text-center" onClick={(e) => e.stopPropagation()}>
        <Ribbon text={revealed ? "Evolved!" : "Evolving..."} />
        <div className="mx-auto grid h-48 w-48 place-items-center">
          {revealed ? (
            <div className="pop-in">
              <Pet species={species} form={form} id="evolve-new" size={190} title={names[form]} />
            </div>
          ) : (
            <div className="evolve-glow">
              <Pet species={species} form={from} id="evolve-old" size={170} title={names[from]} />
            </div>
          )}
        </div>
        <p className="mt-2 font-display text-lg font-semibold text-cocoa-700">
          {revealed ? `${names[from]} evolved into ${names[form]}!` : `What? ${names[from]} is evolving!`}
        </p>
        <p className="mt-1 text-sm font-semibold text-cocoa-500">All those applications are paying off.</p>
        <button onClick={close} className="btn-3d btn-carrot mt-4 px-6 py-2 text-lg">
          Yay!
        </button>
      </div>
    </div>
  );
}

function Ribbon({ text }: { text: string }) {
  return (
    <div className="absolute -top-5 left-1/2 w-[85%] -translate-x-1/2">
      <svg viewBox="0 0 300 54" className="w-full" aria-hidden>
        <path d="M14 14 H0 L10 30 L0 46 H34 V14 Z" fill="#D9A21F" />
        <path d="M286 14 H300 L290 30 L300 46 H266 V14 Z" fill="#D9A21F" />
        <rect x="22" y="4" width="256" height="40" rx="8" fill="#FFD15C" stroke="#B9851A" strokeWidth="3" />
      </svg>
      <span className="title-outline absolute inset-0 -top-1 grid place-items-center text-2xl">{text}</span>
    </div>
  );
}
