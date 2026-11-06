// 108-08 (finding 12): the storey count must not be overwritten by opening / switching tabs, by a fallback value or by undoing a local
// step after another device changed it. Pure rules: which fields the massing studio may write (massingSchreibPatch), which programme
// fields the write-back sends (programmAenderungen), and the drawing history taking over another device's values (historieUmbasieren).
// Neutral data (EFH: KG / EG / DG with knee wall 0.75 m), no real project.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { massingSchreibPatch, MASSING_SCHREIBFELDER } from "@core/lib/massing/lage.js";
import { programmAenderungen, programmSchreibPatch, programmSignatur, gespeicherteProgrammWerte, lageNormal } from "@core/lib/useBimModelSync";
import { leereHistorie, vorAenderung, schrittZurueck, schrittVor, historieUmbasieren } from "@designer/lib/bimHistorie";

const GESCHOSSE = [{ level: -1, name: "KG", hoehe_m: 2.75 }, { level: 0, name: "EG", hoehe_m: 2.9 }, { level: 1, name: "DG", hoehe_m: 2.6, kniestock_m: 0.75 }];
const FP = [{ x: -5.7, z: -5.1 }, { x: 5.7, z: -5.1 }, { x: 5.7, z: 5.1 }, { x: -5.7, z: 5.1 }];
const STORE = { footprintM: FP, footprintLageM: null, storeys: 2, untergeschosse: 1, geschosse: GESCHOSSE, storeyHeight: 2.9 };

describe("108-08 Punkt 12: Massing-Patch", () => {
  it("Öffnen / Laden / Reiterwechsel (keine Nutzeränderung) schreibt nichts — auch nicht den Rückfall 6", () => {
    assert.deepEqual(massingSchreibPatch({ footprintM: FP, footprintLageM: { x: -0.3, z: 0.1 }, storeys: 6 }, STORE, {}), {});
  });
  it("ein Patch enthält nur footprintM, footprintLageM, storeys — nie untergeschosse, geschosse, storeyHeight", () => {
    const p = massingSchreibPatch({ footprintM: [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 3 }], footprintLageM: { x: 2, z: 1 }, storeys: 3 }, STORE, { form: true, geschosse: true });
    assert.deepEqual(Object.keys(p).sort(), [...MASSING_SCHREIBFELDER].sort());
    for (const k of ["untergeschosse", "geschosse", "storeyHeight", "kniestock_m"]) assert.equal(k in p, false, k);
  });
  it("Geschosse nur vom Schieber, nur wenn anders, nie < 1 oder keine ganze Zahl", () => {
    assert.deepEqual(massingSchreibPatch({ storeys: 3 }, STORE, { geschosse: true }), { storeys: 3 });
    assert.deepEqual(massingSchreibPatch({ storeys: 2 }, STORE, { geschosse: true }), {});
    assert.deepEqual(massingSchreibPatch({ storeys: 0 }, STORE, { geschosse: true }), {});
    assert.deepEqual(massingSchreibPatch({ storeys: 2.5 }, STORE, { geschosse: true }), {});
    assert.deepEqual(massingSchreibPatch({ storeys: 3 }, STORE, { form: true }), {}, "eine Formänderung schreibt keine Geschosszahl");
  });
  it("Verschieben schreibt nur die Lage (Form gleich), erstes Verschieben eines Altprojekts legt das Feld an", () => {
    assert.deepEqual(massingSchreibPatch({ footprintM: FP, footprintLageM: { x: 1.234, z: -2 } }, STORE, { form: true }), { footprintLageM: { x: 1.23, z: -2 } });
    // within 1 cm of the stored position: nothing
    assert.deepEqual(massingSchreibPatch({ footprintM: FP, footprintLageM: { x: 1.005, z: -2 } }, { ...STORE, footprintLageM: { x: 1, z: -2 } }, { form: true }), {});
  });
});

describe("108-08 Punkt 12: Rückschreiben nur geänderter Programmfelder", () => {
  const geladen = { footprintM: FP, storeys: 2, storeyHeight: 2.9, unit: "m", footprintQuelle: null, achseM: null, geschosse: GESCHOSSE, untergeschosse: 1, footprintLageM: null };
  const sig = programmSignatur(geladen);
  const hatte = { achseM: false, geschosse: true, untergeschosse: true, footprintLageM: false };

  it("Signatur hin und zurück", () => {
    assert.deepEqual(gespeicherteProgrammWerte(sig), geladen);
    assert.deepEqual(gespeicherteProgrammWerte(""), {});
  });
  it("nur die Lage geändert → nur footprintLageM geht raus (keine Geschosszahl, keine Untergeschosse)", () => {
    const voll = programmSchreibPatch({ ...geladen, footprintLageM: { x: 1, z: 2 } }, hatte);
    assert.deepEqual(programmAenderungen(voll, gespeicherteProgrammWerte(sig)), { footprintLageM: { x: 1, z: 2 } });
  });
  it("Rückfallwert: Datensatz ohne storeys (geladen als 4) — eine Umrissänderung schreibt die 4 nicht", () => {
    const ohne = { ...geladen, storeys: 4 }; // what the load puts into the store for a record without the field
    const voll = programmSchreibPatch({ ...ohne, footprintM: [{ x: -6, z: -5 }, { x: 6, z: -5 }, { x: 6, z: 5 }, { x: -6, z: 5 }], footprintQuelle: { art: "gezeichnet" } }, hatte);
    const p = programmAenderungen(voll, gespeicherteProgrammWerte(programmSignatur(ohne)));
    assert.deepEqual(Object.keys(p).sort(), ["footprintM", "footprintQuelle"]);
  });
  it("footprintQuelle reist mit footprintM, auch wenn sie gleich blieb", () => {
    const voll = programmSchreibPatch({ ...geladen, footprintM: FP.map((p) => ({ x: p.x + 1, z: p.z })) }, hatte);
    assert.deepEqual(Object.keys(programmAenderungen(voll, gespeicherteProgrammWerte(sig))).sort(), ["footprintM", "footprintQuelle"]);
  });
  it("footprintLageM: nur wenn gesetzt oder schon gespeichert (Altprojekte bleiben ohne Feld)", () => {
    assert.equal("footprintLageM" in programmSchreibPatch(geladen, hatte), false);
    assert.deepEqual(programmSchreibPatch(geladen, { ...hatte, footprintLageM: true }).footprintLageM, null);
    assert.deepEqual(lageNormal({ x: "1.5", z: 2 }), { x: 1.5, z: 2 });
    assert.equal(lageNormal({ x: 1 }), null);
  });
});

describe("108-08 Punkt 12: Rückgängig nach fremder Änderung", () => {
  it("Undo eines lokalen Schritts lässt Geschosse/UG/Tabelle des anderen Geräts stehen", () => {
    // before: 1 storey, no basement, no table; the local step switches the entrance on
    const vorher = { storeys: 1, untergeschosse: 0, geschosse: null, entranceCfg: { enabled: false } };
    let h = vorAenderung(leereHistorie(), vorher);
    const lokal = { ...vorher, entranceCfg: { enabled: true } };
    // another device sets KG / EG / DG with knee wall; this page took it over
    const fremd = { storeys: 2, untergeschosse: 1, geschosse: GESCHOSSE };
    h = historieUmbasieren(h, fremd);
    const r = schrittZurueck(h, { ...lokal, ...fremd });
    assert.ok(r);
    assert.deepEqual(r.snapshot, { ...fremd, entranceCfg: { enabled: false } });
    // redo keeps them as well
    const v = schrittVor(r.historie, r.snapshot);
    assert.deepEqual(v?.snapshot, { ...fremd, entranceCfg: { enabled: true } });
  });
  it("unverändert: dieselbe Historie zurück, wenn nichts zu ersetzen ist", () => {
    const h = vorAenderung(leereHistorie(), { storeys: 2 });
    assert.equal(historieUmbasieren(h, { storeys: 2 }), h);
    assert.equal(historieUmbasieren(h, {}), h);
    assert.equal(historieUmbasieren(leereHistorie(), { storeys: 3 }).stack.past.length, 0);
  });
  it("Felder, die ein Schnappschuss nicht trägt, kommen nicht hinzu", () => {
    const h = historieUmbasieren(vorAenderung(leereHistorie(), { customWalls: [] }), { storeys: 3 });
    assert.deepEqual(h.stack.past[0], { customWalls: [] });
  });
});
