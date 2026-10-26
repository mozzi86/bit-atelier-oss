// 107-01 Task 1: the real IFC golden. The files tests/unit/fixtures/ifc-golden-107*.ifc hold the output
// of `exportIFC` as it was BEFORE phase 107 touched it (fixed example model, see
// fixtures/ifcGoldenModell-107.js). Every later plan of phase 107 measures "byte-identical" against
// them; a plan with new output adds a second golden of its own and leaves these two untouched.
//
// Exception (D-BK-25, 25.10.2026): ifc-golden-107-steckbrief.ifc was regenerated ON PURPOSE. Its roof carries only the old
// `pitch` (2.5 m ridge over a 4 m half span) and is now classified by the real slope (32.0054 deg, GABLE_ROOF) instead of
// 2.5 read as degrees (FLAT_ROOF); see 107-02-SUMMARY.md, section "Nachtrag 25.10. D-BK-25".
// ifcSteckbrief-9702a.test.js is no golden: it only compares two runs of today's code with each other.
// `exportIFC` writes no timestamp and counts its GlobalIds (G()), so the text is deterministic and
// no line needs normalising.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { exportIFC } from "@designer/lib/ifcExport";
import { ifcGoldenSzenario } from "./fixtures/ifcGoldenModell-107.js";

const lies = (/** @type {string} */ name) => readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8");

/** Fails with the first differing line, not with a 30 000 character diff. */
function gleich(/** @type {string} */ ist, /** @type {string} */ soll, /** @type {string} */ was) {
  if (ist === soll) return;
  const a = ist.split("\n"), b = soll.split("\n");
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  assert.fail(`${was}: erste Abweichung in Zeile ${i + 1}\n  ist:  ${a[i]}\n  soll: ${b[i]}`);
}

describe("107-01 IFC-Golden (Export vor Phase 107)", () => {
  const { model, ohne, mit } = ifcGoldenSzenario();

  it("ohne Steckbrief-Option Zeichen für Zeichen gleich dem Golden", () => {
    const meldungen = [];
    gleich(exportIFC(model, { ...ohne, onWarn: (m) => meldungen.push(m) }), lies("ifc-golden-107.ifc"), "ohne Steckbrief");
    assert.deepEqual(meldungen, [], "das Beispielmodell erzeugt keine Warnung");
  });

  it("mit Steckbrief-Option Zeichen für Zeichen gleich dem Golden", () => {
    gleich(exportIFC(model, mit), lies("ifc-golden-107-steckbrief.ifc"), "mit Steckbrief");
  });

  it("das Beispielmodell deckt jede Elementart ab (der Golden ist nicht leer)", () => {
    const z = (/** @type {string} */ t, /** @type {string} */ k) => (t.match(new RegExp(`=${k}\\(`, "g")) || []).length;
    const mitText = lies("ifc-golden-107-steckbrief.ifc");
    for (const [k, n] of [["IFCWALL", 12], ["IFCCOLUMN", 1], ["IFCSLAB", 4], ["IFCROOF", 1], ["IFCWINDOW", 2], ["IFCDOOR", 3], ["IFCSPACE", 4],
      ["IFCBUILDINGELEMENTPROXY", 4], ["IFCELEMENTASSEMBLY", 1], ["IFCBEAM", 1], ["IFCPIPESEGMENT", 1], ["IFCOPENINGELEMENT", 5]]) {
      assert.equal(z(mitText, /** @type {string} */ (k)), n, String(k));
    }
  });
});
