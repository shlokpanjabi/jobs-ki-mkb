// Run with `npm test`.
import assert from "node:assert/strict";
import { test } from "node:test";
import { EVOLVE_AT, petFor, SPECIES, speciesFor, XP, xpFor } from "./pets.mjs";

const stats = (over = {}) => ({ applied: 0, assessments: 0, interviews: 0, offers: 0, questsDone: 0, ...over });

test("pets: each of us has our own line; anyone else still gets one", () => {
  assert.deepEqual(["shlok", "taran", "muzzamil"].map(speciesFor), ["volt", "ember", "moss"]);
  assert.ok(Object.keys(SPECIES).includes(speciesFor("someone-new")));
  assert.equal(speciesFor("someone-new"), speciesFor("someone-new")); // stable
  for (const s of Object.values(SPECIES)) assert.equal(s.forms.length, 3);
});

test("pets: XP from applying, later rounds, offers and finished to-dos", () => {
  assert.equal(xpFor(stats()), 0);
  assert.equal(xpFor(stats({ applied: 3 })), 3 * XP.applied);
  // Being invited further is worth more than applying.
  assert.ok(XP.interview > XP.assessment && XP.assessment > XP.applied && XP.offer > XP.interview);
  assert.equal(xpFor(stats({ applied: 2, assessments: 1, interviews: 1, offers: 1, questsDone: 2 })),
    2 * XP.applied + XP.assessment + XP.interview + XP.offer + 2 * XP.quest);
});

test("pets: evolve at the thresholds, with progress towards the next form", () => {
  const baby = petFor("shlok", stats());
  assert.deepEqual([baby.form, baby.name, baby.formName, baby.nextName, baby.level, baby.toNext, baby.progress], [0, "Gandusaur", "Bitpip", "Voltpaw", 1, EVOLVE_AT[1], 0]);
  const halfway = petFor("shlok", stats({ applied: 7, assessments: 1 })); // 95 XP
  assert.equal(halfway.form, 0);
  assert.ok(Math.abs(halfway.progress - 95 / 150) < 1e-9);
  const evolved = petFor("taran", stats({ applied: 15 })); // exactly 150
  // Taran's pet has a nickname: it keeps it when it evolves; the form name changes.
  assert.deepEqual([evolved.form, evolved.name, evolved.formName, evolved.toNext], [1, "Bhosadmon", "Cindrabbit", EVOLVE_AT[2] - 150]);
  assert.equal(petFor("taran", stats()).name, "Bhosadmon");
  const final = petFor("muzzamil", stats({ applied: 30, interviews: 5, offers: 1 }));
  assert.equal(final.formName, final.name); // no nickname: named after its form
  assert.deepEqual([final.form, final.name, final.nextName, final.toNext, final.progress], [2, "Grovehog", null, null, 1]);
});
