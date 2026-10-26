// 100-02: the data sheet in the TGA, structure and opening editors — the fields set there (KG, trade,
// section) survive the layer hardening, a layer without them stays byte-identical, and the editor shows
// the same GUID the IFC export writes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { steckbrief, steckbriefFelderAus, typFuerNetz } from "@core/lib/bauteil/steckbrief.js";
import { netzHardened, aendereKante, aendereKnoten } from "@designer/lib/tgaNetz";
import { layerHardened, aendereTraeger } from "@designer/lib/tragwerkPlan";
import { durchbruchSteckbriefe } from "@/lib/werkplanung/durchbrueche";

const netz = {
  knoten: [{ id: "k1", gewerk: "heizung", art: "erzeuger", level: 0, x: 0, z: 0 }],
  kanten: [{ id: "e1", gewerk: "heizung", level: 0, dn: 20, von: "k1", nach: null, points: [{ x: 0, z: 0 }, { x: 4, z: 0 }] }],
};

test("Feldauswahl: KG 1–3 Ziffern (Tippen Ziffer für Ziffer), Gewerk-LB 3 Ziffern, Bauabschnitt; Leerzeichen bleiben", () => {
  assert.deepEqual(steckbriefFelderAus({ kg: "421", gewerk_lb: "040", bauabschnitt: "BA 1 ", x: 1 }), { kg: "421", gewerk_lb: "040", bauabschnitt: "BA 1 " });
  assert.deepEqual(steckbriefFelderAus({ kg: "4" }), { kg: "4" }, "erste getippte Ziffer bleibt");
  assert.deepEqual(steckbriefFelderAus({ kg: "4211", gewerk_lb: "abc", bauabschnitt: "   " }), {});
  assert.deepEqual(steckbriefFelderAus(null), {});
  assert.deepEqual(steckbriefFelderAus({ kg: 421 }), { kg: "421" });
});

test("TGA: ohne Steckbrief-Felder byte-gleich, gesetzte Felder überstehen die Härtung, null löscht", () => {
  assert.equal(JSON.stringify(netzHardened(netz)), JSON.stringify(netzHardened(JSON.parse(JSON.stringify(netz)))));
  assert.equal(Object.keys(netzHardened(netz).kanten[0]).includes("kg"), false);
  let n = aendereKante(netz, "e1", { kg: "422", gewerk_lb: "040", bauabschnitt: "BA 2" });
  n = aendereKnoten(n, "k1", { kg: "421" });
  assert.equal(n.kanten[0].kg, "422"); assert.equal(n.kanten[0].gewerk_lb, "040"); assert.equal(n.kanten[0].bauabschnitt, "BA 2");
  assert.equal(n.knoten[0].kg, "421");
  assert.equal("kg" in aendereKante(n, "e1", { kg: null }).kanten[0], false);
  const s = steckbrief(n.kanten[0], typFuerNetz(n.kanten[0]), { projektId: "p1", quelle: "netz-kante" });
  assert.equal(s.kg, "422"); assert.equal(s.quelle.kg, "gesetzt");
});

test("Tragwerk: Träger behält KG/Gewerk/Bauabschnitt, ohne Felder unverändert", () => {
  const layer = { traeger: [{ id: "tr_1", level: 0, a: { x: 0, z: 0 }, b: { x: 5, z: 0 } }] };
  assert.equal(Object.keys(layerHardened(layer).traeger[0]).includes("kg"), false);
  const l = aendereTraeger(layer, "tr_1", { kg: "351", bauabschnitt: "Nord" });
  assert.equal(l.traeger[0].kg, "351"); assert.equal(l.traeger[0].bauabschnitt, "Nord");
  const s = steckbrief(l.traeger[0], "traeger", { projektId: "p1", quelle: "statik-traeger" });
  assert.equal(s.kg, "351"); assert.equal(s.bauabschnitt, "Nord");
});

test("GUID im Editor = GUID im IFC-Export (gleiche Quelle, gleiches Projekt)", () => {
  const k = netzHardened(netz).kanten[0];
  const a = steckbrief(k, typFuerNetz(k), { projektId: "p1", quelle: "netz-kante" });
  const b = steckbrief({ ...k, kg: "422" }, typFuerNetz(k), { projektId: "p1", quelle: "netz-kante", storeyHeight: 3 });
  assert.equal(a.guid, b.guid, "Steckbrief-Felder ändern die GUID nicht");
});

test("Durchbruch: KG/Gewerk am Datensatz erscheinen im Steckbrief, Brandschott als eigenes Bauteil", () => {
  const d = { id: "d1", nr: "DB-001", status: "freigegeben", kg: "394", gewerk_lb: "013", brandschott: { klasse: "EI 90", system: "Mörtelschott", hersteller: "X" } };
  const { durchbruch, brandschott } = durchbruchSteckbriefe(d, { projektId: "p1" });
  assert.equal(durchbruch.kg, "394"); assert.equal(durchbruch.gewerk?.lb, "013");
  assert.ok(brandschott); assert.equal(brandschott.material, "Mörtelschott, X");
});
