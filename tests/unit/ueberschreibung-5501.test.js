// 55-01: graphic rules in 3D (dreiDElementDarstellung), deckkraft, project presets (regel_vorlagen), reorder — ONE engine with
// elementDarstellung (107-12). No second override core.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  STANDARD_REGELN, STANDARD_VORLAGEN, REGEL_FARBEN, DUNKLER_ANTEIL, MAX_REGEL_VORLAGEN,
  ansichtLayerNormalisieren, ANSICHT_LEER, regelNormalisieren, regelVorlageNormalisieren,
  regelnKlonen, regelnUmordnen, naechsteVorlageId, darstellungsWerte, elementDarstellung,
  dreiDElementDarstellung, DREID_REGEL_STANDARD_FARBE,
} from "@core/lib/plan/ansichtszustand.js";
import { brilleVon, dreiDDarstellung, dunkler } from "@core/lib/plan/brillen.js";

describe("55-01 — Schema: deckkraft + Vorlagen", () => {
  it("regelNormalisieren akzeptiert deckkraft 0..1 und verwirft 0 / >1 / freie Farben", () => {
    const ok = regelNormalisieren({ wenn: { feld: "status", operator: "=", wert: null }, dann: { fuellung: "warnung", strich: "2 2", strichbreite_mm: 0.35, deckkraft: 0.85 } });
    assert.equal(ok.dann.deckkraft, 0.85);
    const ohneDk = regelNormalisieren({ wenn: { feld: "tragend", operator: "=", wert: true }, dann: { fuellung: "dunkler", deckkraft: 0 } });
    assert.equal(ohneDk?.dann?.deckkraft, undefined, "deckkraft 0 rejected (would hide via a rule)");
    assert.equal(ohneDk?.dann?.fuellung, "dunkler");
    const zuHoch = regelNormalisieren({ wenn: { feld: "tragend", operator: "=", wert: true }, dann: { fuellung: "dunkler", deckkraft: 1.5 } });
    assert.equal(zuHoch?.dann?.deckkraft, undefined);
    assert.equal(regelNormalisieren({ wenn: { feld: "tragend", operator: "=", wert: true }, dann: { fuellung: "#ff0000" } }), null);
  });

  it("STANDARD_VORLAGEN: drei Presets mit Form (FARB-01), klonbar", () => {
    assert.equal(STANDARD_VORLAGEN.length, 3);
    assert.deepEqual(STANDARD_VORLAGEN.map((v) => v.id), ["brandschutz", "tragend", "steckbrief-offen"]);
    const brand = STANDARD_VORLAGEN[0];
    assert.equal(brand.regeln[0].dann.kontur, "warnung");
    assert.ok(brand.regeln[0].dann.strich, "form with colour");
    const klon = regelnKlonen(brand.regeln);
    klon[0].dann.kontur = "erfolg";
    assert.equal(brand.regeln[0].dann.kontur, "warnung", "frozen source untouched");
  });

  it("ansicht_layer.regel_vorlagen: normalisieren, Dedup, Cap; Altprojekt ohne Feld = []", () => {
    assert.deepEqual(ansichtLayerNormalisieren(undefined).regel_vorlagen, []);
    assert.deepEqual(ANSICHT_LEER.regel_vorlagen, []);
    const layer = {
      regel_vorlagen: [
        { id: "rv1", name: "Mein Brandschutz", regeln: STANDARD_VORLAGEN[0].regeln },
        { id: "rv1", name: "Duplikat", regeln: STANDARD_VORLAGEN[1].regeln },
        { id: "x", name: "", regeln: STANDARD_REGELN },
        ...Array.from({ length: MAX_REGEL_VORLAGEN + 5 }, (_, i) => ({
          id: `rv${i + 2}`, name: `P${i}`, regeln: [{ wenn: { feld: "tragend", operator: "=", wert: true }, dann: { fuellung: "dunkler" } }],
        })),
      ],
    };
    const n = ansichtLayerNormalisieren(layer);
    assert.equal(n.regel_vorlagen.length, MAX_REGEL_VORLAGEN);
    assert.equal(n.regel_vorlagen[0].id, "rv1");
    assert.equal(n.regel_vorlagen[0].name, "Mein Brandschutz");
    assert.equal(regelVorlageNormalisieren({ id: "a", name: "leer", regeln: [] }), null);
    assert.equal(naechsteVorlageId([{ id: "rv3" }, { id: "rv1" }]), "rv4");
  });

  it("regelnUmordnen: erste Regel gewinnt — Reihenfolge ist die Rangfolge", () => {
    const a = regelnKlonen(STANDARD_REGELN);
    const b = regelnUmordnen(a, 1, 0);
    assert.equal(b[0].wenn.feld, "tragend");
    assert.equal(b[1].wenn.feld, "feuerwiderstand");
    assert.equal(regelnUmordnen(a, 0, 0)[0].wenn.feld, "feuerwiderstand");
  });
});

describe("55-01 — dreiDElementDarstellung Rangfolge = elementDarstellung", () => {
  const ein = brilleVon("eingabe");
  const bau = brilleVon("bauantrag");

  it("ohne Regeln = dreiDDarstellung (byte-gleiche Basis)", () => {
    assert.deepEqual(dreiDElementDarstellung(ein, { status: "abbruch" }, null), dreiDDarstellung(ein, "abbruch"));
    assert.deepEqual(dreiDElementDarstellung(bau, { status: "abbruch" }, []), dreiDDarstellung(bau, "abbruch"));
  });

  it("Eingabe + STANDARD_REGELN: Feuerwiderstand vor tragend; dunkler auf Standardfarbe", () => {
    const tragend = darstellungsWerte({ tragend: true }, "wand");
    const r = dreiDElementDarstellung(ein, tragend, STANDARD_REGELN);
    assert.equal(r.regel, 1);
    assert.equal(r.farbe, dunkler(DREID_REGEL_STANDARD_FARBE, DUNKLER_ANTEIL));
    const brand = darstellungsWerte({ tragend: true, feuerwiderstand: "F90" }, "wand");
    const r2 = dreiDElementDarstellung(ein, brand, STANDARD_REGELN);
    assert.equal(r2.regel, 0);
    assert.equal(r2.kontur, REGEL_FARBEN.warnung);
    assert.equal(r2.strich, "4 1 1 1");
  });

  it("Umbau-Brille mit Status: Status gewinnt; ohne Status: Regel greift", () => {
    const mitStatus = { ...darstellungsWerte({ tragend: true, feuerwiderstand: "F90", status: "abbruch" }, "wand"), status: "abbruch" };
    assert.deepEqual(dreiDElementDarstellung(bau, mitStatus, STANDARD_REGELN), dreiDDarstellung(bau, "abbruch"));
    assert.equal(dreiDElementDarstellung(bau, darstellungsWerte({ tragend: true }, "wand"), STANDARD_REGELN).regel, 1);
    // 2D parity: same gate
    assert.equal(elementDarstellung(bau, mitStatus, STANDARD_REGELN)?.regel, undefined);
    assert.equal(elementDarstellung(bau, darstellungsWerte({ tragend: true }, "wand"), STANDARD_REGELN)?.regel, 1);
  });

  it("Steckbrief-offen-Vorlage: status null → warnung + deckkraft + Form", () => {
    const vorlage = STANDARD_VORLAGEN.find((v) => v.id === "steckbrief-offen");
    const d = dreiDElementDarstellung(ein, darstellungsWerte({ status: null }, "wand"), vorlage.regeln);
    assert.equal(d.regel, 0);
    assert.equal(d.farbe, REGEL_FARBEN.warnung);
    assert.equal(d.deckkraft, 0.85);
    assert.equal(d.strich, "2 2");
    // decided status does not match status=null
    assert.equal(dreiDElementDarstellung(ein, { status: "bestand", tragend: false }, vorlage.regeln).regel, undefined);
  });

  it("deckkraft aus Regel setzt Opacity in 3D und in elementDarstellung", () => {
    const regeln = [{ wenn: { feld: "tragend", operator: "=", wert: true }, dann: { fuellung: "hinweis", strich: "1 1", deckkraft: 0.5 } }];
    const d3 = dreiDElementDarstellung(ein, { tragend: true, status: null }, regeln);
    assert.equal(d3.deckkraft, 0.5);
    assert.equal(d3.farbe, REGEL_FARBEN.hinweis);
    const d2 = elementDarstellung(ein, { tragend: true, status: null }, regeln, { standard: { fill: "#3f3f46", stroke: "#18181b" } });
    assert.equal(d2.opacity, 0.5);
  });
});
