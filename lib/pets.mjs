// Each person's pet, and how it grows. Plain ESM so the board (server and
// client) and the tests share it. Pets earn XP from real progress only:
// applying, being invited to later rounds, offers, and finishing to-dos.

/** Per-person pet line. Ids are user ids; anyone else gets a line by name. */
export const PET_FOR_USER = { shlok: "volt", taran: "ember", muzzamil: "moss" };

/** Nicknames: kept through every evolution. Pets without one go by their form's name. */
export const PET_NICKNAMES = { taran: "Bhosadmon" };

export const SPECIES = {
  volt: {
    type: "Spark",
    forms: [
      { name: "Bitpip", blurb: "Hums when you hit submit. Runs on curiosity and wifi." },
      { name: "Voltpaw", blurb: "Crackles before every interview. Never misses a deadline." },
      { name: "Stormane", blurb: "Struck by offers. The whole sky knows your name." },
    ],
    swatches: ["#FFE07A", "#F5B83D", "#B9A2F0"],
    blob: "#F6E3A6",
  },
  ember: {
    type: "Flame",
    forms: [
      { name: "Emberbun", blurb: "Small spark, big ambitions. Warms up with every application." },
      { name: "Cindrabbit", blurb: "Hops through assessments with its ears on fire." },
      { name: "Blazelop", blurb: "Lights up every superday it walks into." },
    ],
    swatches: ["#FFE3CC", "#FF9F5A", "#E2553A"],
    blob: "#F9C9AE",
  },
  moss: {
    type: "Leaf",
    forms: [
      { name: "Mossling", blurb: "Quietly grows a little with every form you send." },
      { name: "Fernhog", blurb: "Rolls into interviews, prickly with preparation." },
      { name: "Grovehog", blurb: "A whole forest of offers, rooted in patience." },
    ],
    swatches: ["#D9F0B8", "#8FCB6B", "#4F9A5B"],
    blob: "#CFE8B4",
  },
};

export const XP = { applied: 10, assessment: 25, interview: 60, offer: 150, quest: 5 };
/** XP at which each form is reached: form 1 from the start. */
export const EVOLVE_AT = [0, 150, 600];
const XP_PER_LEVEL = 40;

/** @param {string} userId */
export function speciesFor(userId) {
  if (PET_FOR_USER[userId]) return PET_FOR_USER[userId];
  const keys = Object.keys(SPECIES);
  let h = 0;
  for (const c of String(userId)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return keys[h % keys.length];
}

/**
 * @typedef {{ applied: number, assessments: number, interviews: number, offers: number, questsDone: number }} PetStats
 *   applied: roles past To do (Applied, Rejected or Offer: they all mean you applied)
 *   assessments / interviews: roles whose furthest stage is that invitation
 * @param {PetStats} s
 */
export function xpFor(s) {
  return s.applied * XP.applied + s.assessments * XP.assessment + s.interviews * XP.interview
    + s.offers * XP.offer + s.questsDone * XP.quest;
}

/**
 * Everything the board shows about one pet.
 * @param {string} userId
 * @param {PetStats} stats
 */
export function petFor(userId, stats) {
  const speciesKey = speciesFor(userId);
  const species = SPECIES[speciesKey];
  const xp = xpFor(stats);
  const form = EVOLVE_AT.filter((t) => xp >= t).length - 1; // 0, 1 or 2
  const next = EVOLVE_AT[form + 1] ?? null;
  const floor = EVOLVE_AT[form];
  return {
    userId,
    speciesKey,
    type: species.type,
    form,
    name: PET_NICKNAMES[userId] ?? species.forms[form].name,
    formName: species.forms[form].name,
    blurb: species.forms[form].blurb,
    nextName: next === null ? null : species.forms[form + 1].name,
    level: 1 + Math.floor(xp / XP_PER_LEVEL),
    xp,
    // Progress through the current form, towards the next evolution (1 when fully evolved).
    toNext: next === null ? null : next - xp,
    progress: next === null ? 1 : (xp - floor) / (next - floor),
    swatches: species.swatches,
    blob: species.blob,
    stats,
  };
}
