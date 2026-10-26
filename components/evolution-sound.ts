// Sound effects for the evolution cutscene, synthesised with the Web Audio API
// (square and triangle oscillators with short envelopes, Game Boy style). No
// audio files.
//
// Browsers only let a page play sound after the person has interacted with it,
// and the cutscene can open on page load. So the AudioContext is made at once
// only if the page already has had a click or key press, and otherwise on the
// first one. Until then each beat is skipped silently and the animation runs on.

export type SoundState = "on" | "off" | "blocked";

type Tone = { freq: number; at: number; dur: number; type?: OscillatorType; gain?: number };

const C5 = 523.25, E5 = 659.25, G5 = 783.99, C6 = 1046.5, E6 = 1318.51, G6 = 1567.98;

export function evolutionSound(muted: boolean, onState: (state: SoundState) => void) {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let off = muted;
  const live = new Set<OscillatorNode>();

  const report = () => onState(off ? "off" : ctx?.state === "running" ? "on" : "blocked");

  function start() {
    if (!ctx) {
      try {
        ctx = new AudioContext();
      } catch {
        return; // no Web Audio here: stay silent
      }
      ctx.onstatechange = report;
      master = ctx.createGain();
      master.gain.value = 0.12;
      master.connect(ctx.destination);
    }
    if (ctx.state === "suspended") ctx.resume().then(report, report);
    report();
  }

  const unlock = () => start();
  if (typeof navigator !== "undefined" && navigator.userActivation?.hasBeenActive) start();
  else report();
  window.addEventListener("pointerdown", unlock, true);
  window.addEventListener("keydown", unlock, true);

  function play(tones: Tone[]) {
    if (off || !ctx || !master || ctx.state !== "running") return;
    const now = ctx.currentTime;
    for (const { freq, at, dur, type = "square", gain = 0.5 } of tones) {
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      const t = now + at;
      osc.type = type;
      osc.frequency.value = freq;
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(gain, t + 0.01);
      env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(env).connect(master);
      osc.onended = () => live.delete(osc);
      live.add(osc);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    }
  }

  function stopAll() {
    for (const osc of live) {
      try {
        osc.stop();
      } catch {
        // already stopped
      }
    }
    live.clear();
  }

  return {
    /** "What? … is evolving!": a quick rising arpeggio. */
    stinger: () =>
      play([
        { freq: C5, at: 0, dur: 0.1 },
        { freq: E5, at: 0.08, dur: 0.1 },
        { freq: G5, at: 0.16, dur: 0.1 },
        { freq: C6, at: 0.24, dur: 0.32 },
      ]),
    /** One form swap: a soft blip that climbs a little each time. */
    blip: (step: number) => {
      const freq = 392 * 2 ** ((step * 2) / 12);
      play([
        { freq, at: 0, dur: 0.14, type: "triangle", gain: 0.7 },
        { freq: freq * 2, at: 0, dur: 0.08, gain: 0.12 },
      ]);
    },
    /** The reveal: a short fanfare and a held chord. */
    chime: () =>
      play([
        { freq: G5, at: 0, dur: 0.12 },
        { freq: C6, at: 0.1, dur: 0.12 },
        { freq: E6, at: 0.2, dur: 0.12 },
        { freq: G6, at: 0.3, dur: 0.22 },
        { freq: C6, at: 0.46, dur: 0.9, type: "triangle", gain: 0.6 },
        { freq: E6, at: 0.46, dur: 0.9, type: "triangle", gain: 0.45 },
        { freq: G6, at: 0.46, dur: 0.9, type: "triangle", gain: 0.35 },
      ]),
    setMuted(value: boolean) {
      off = value;
      if (off) stopAll();
      else start(); // called from a click, so this can unlock sound too
      report();
    },
    /** Stops everything at once and lets the AudioContext go. */
    close() {
      stopAll();
      window.removeEventListener("pointerdown", unlock, true);
      window.removeEventListener("keydown", unlock, true);
      if (ctx) {
        ctx.onstatechange = null;
        ctx.close().catch(() => {});
      }
      ctx = null;
      master = null;
    },
  };
}

export type EvolutionSound = ReturnType<typeof evolutionSound>;
