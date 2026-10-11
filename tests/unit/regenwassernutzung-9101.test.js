// Unit tests for plan 91-01 (packages/nova-designer/src/lib/regenwassernutzung.js): DIN 1989-1
// yield / demand / storage against a hand calculation, green roof lowers the yield, cistern under
// the garage fits / does not fit, overflow below the backwater level, building-services room,
// checks never "fail", quantities, layer hardening old → new (entwaesserung.js additive).
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  ERTRAGSBEIWERTE, FILTER_ETA, NIEDERSCHLAG_FALLBACK_MM, WC_L_JE_PERSON_TAG, GARTEN_L_JE_M2_JAHR, TROCKENTAGE,
  NUTZUNG_DEFAULT, nutzungHardened, standardFlaechen, ertrag, bedarf, speicher, zisterne, technikraumRegenwasser,
  regenwasserChecks, regenwasserMengen, regenwasserNutzung,
} from "@designer/lib/regenwassernutzung";
import { ENTW_DEFAULT, layerHardened } from "@designer/lib/entwaesserung";

// Hand calculation (DIN 1989-1 simplified method):
//   yield  E = 1 000 m² · 0,6 (flat roof, gravel) · 0,9 · 650 mm / 1 000 = 351 m³/a
//   demand WC 48 WE · 2,5 P = 120 P · 24 l/d · 365 / 1 000 = 1 051,2 m³/a; garden 400 m² · 60 l / 1 000 = 24 m³/a
//   storage min(351; 1 075,2) = 351 · 21 / 365 = 20,19 → 21 m³; coverage 351 / 1 075,2 = 32,6 %
const HAND = { footArea_m2: 1000, dachform: "flach", niederschlag_mm: 650, we: 48, gruenflaeche_m2: 400 };

describe("91-01 — Ertrag, Bedarf, Speicher (Handrechnung)", () => {
  it("Konstanten wie im Plan", () => {
    assert.equal(ERTRAGSBEIWERTE.flachdach.e, 0.6);
    assert.equal(FILTER_ETA, 0.9);
    assert.equal(WC_L_JE_PERSON_TAG, 24);
    assert.equal(GARTEN_L_JE_M2_JAHR, 60);
    assert.equal(TROCKENTAGE, 21);
  });

  it("Ertrag 1 000 m² Flachdach bei 650 mm = 351 m³/a", () => {
    const e = ertrag({ flaechen: standardFlaechen({ footArea_m2: 1000, dachform: "flach" }), niederschlag_mm: 650 });
    assert.equal(e.m3a, 351);
    assert.equal(e.niederschlagGeschaetzt, false);
  });

  it("Bedarf 48 WE + 400 m² Garten = 1 051,2 + 24 m³/a", () => {
    const b = bedarf({ we: 48, gartenFlaeche_m2: 400 });
    assert.equal(b.personen, 120);
    assert.equal(b.wc_m3a, 1051.2);
    assert.equal(b.garten_m3a, 24);
    assert.equal(b.gesamt_m3a, 1075.2);
  });

  it("Speicher = aufgerundet min(E, B) · 21/365 = 21 m³, Deckung 32,6 %, ertragsbegrenzt", () => {
    const s = speicher({ ertrag_m3a: 351, bedarf_m3a: 1075.2 });
    assert.equal(s.nutz_m3, 21);
    assert.equal(s.deckung, 0.326);
    assert.equal(s.einsparung_m3a, 351);
    assert.equal(s.begrenzt, "ertrag");
    assert.equal(speicher({ ertrag_m3a: 351, bedarf_m3a: 1075.2, rueckhalt_m3: 12.3 }).gesamt_m3, 34, "Rückhalt oben drauf, aufgerundet");
    assert.equal(speicher({ ertrag_m3a: 0, bedarf_m3a: 100 }).nutz_m3, 0);
    assert.equal(speicher({ ertrag_m3a: 10, bedarf_m3a: 0 }).deckung, null);
  });

  it("Gründach mindert den Ertrag; Niederschlag fehlt → Fallback und als geschätzt markiert", () => {
    const voll = ertrag({ flaechen: standardFlaechen({ footArea_m2: 1000 }), niederschlag_mm: 650 }).m3a;
    const halb = ertrag({ flaechen: standardFlaechen({ footArea_m2: 1000, gruendachAnteil: 0.5 }), niederschlag_mm: 650 }).m3a;
    assert.ok(halb < voll, `${halb} < ${voll}`);
    const f = ertrag({ flaechen: [{ art: "flachdach", m2: 100 }], niederschlag_mm: null });
    assert.equal(f.niederschlag_mm, NIEDERSCHLAG_FALLBACK_MM);
    assert.equal(f.niederschlagGeschaetzt, true);
    assert.equal(ertrag({ flaechen: [{ art: "unbekannt", m2: 100 }] }).m3a, 0, "unbekannte Fläche zählt nicht");
  });
});

describe("91-01 — Zisterne unter der Tiefgarage, Technikraum", () => {
  it("unter der TG: 21 m³ / 1,5 m = 14 m² passen unter 600 m² TG", () => {
    const z = zisterne({ volumen_m3: 21, tgAktiv: true, tgFlaeche_m2: 600 });
    assert.equal(z.lage, "unter_tg");
    assert.equal(z.grundflaeche_m2, 14);
    assert.equal(z.passt, true);
    assert.equal(z.hoeheNoetig_m, null);
  });

  it("passt nicht: nötige Nutzhöhe wird genannt; ohne TG-Fläche offen; ohne TG im Erdreich", () => {
    const z = zisterne({ volumen_m3: 300, tgAktiv: true, tgFlaeche_m2: 150 });
    assert.equal(z.passt, false);
    assert.equal(z.hoeheNoetig_m, 2);
    assert.equal(zisterne({ volumen_m3: 20, tgAktiv: true, tgFlaeche_m2: null }).passt, null);
    assert.equal(zisterne({ volumen_m3: 20, tgAktiv: false }).lage, "erdreich");
  });

  it("Technikraum Regenwasser: eigener Raum, Größe nach Speicher, laut, Nachspeisung mit freiem Auslauf", () => {
    assert.equal(technikraumRegenwasser(8).m2, 8);
    assert.equal(technikraumRegenwasser(21).m2, 12);
    assert.equal(technikraumRegenwasser(80).m2, 16);
    const r = technikraumRegenwasser(21);
    assert.equal(r.name, "Haustechnik Regenwasser");
    assert.equal(r.raumart, "laut");
    assert.ok(r.inhalt.some((x) => /DIN EN 1717/.test(x)));
  });
});

describe("91-01 — Checks und Mengen", () => {
  const voll = regenwasserNutzung({ ...HAND, tgAktiv: true, tgFlaeche_m2: 600, geschosse: 4, geschosshoehe_m: 3 });

  it("Gesamtlauf = Handrechnung, Zisterne unter der TG", () => {
    assert.equal(voll.ertrag.m3a, 351);
    assert.equal(voll.bedarf.gesamt_m3a, 1075.2);
    assert.equal(voll.speicher.nutz_m3, 21);
    assert.equal(voll.zisterne.lage, "unter_tg");
    assert.equal(voll.gartenFlaeche_m2, 400, "Garten aus den Grünflächen des Lageplans");
  });

  it("nie fail; Deckung < 50 % → warn; Überlauf unter der Rückstauebene ohne Maßnahme → warn, mit → pass", () => {
    assert.ok(voll.checks.every((c) => ["pass", "warn", "offen"].includes(c.status)));
    const c = Object.fromEntries(voll.checks.map((x) => [x.key, x]));
    assert.equal(c.rw_deckung.status, "warn");
    assert.equal(c.rw_ueberlauf.status, "warn");
    assert.equal(c.rw_lage.status, "pass");
    assert.equal(c.rw_nachspeisung.status, "offen");
    const mitHebe = regenwasserNutzung({ ...HAND, tgAktiv: true, tgFlaeche_m2: 600, nutzung: { ueberlaufMassnahme: "hebeanlage" } });
    assert.equal(mitHebe.checks.find((x) => x.key === "rw_ueberlauf").status, "pass");
    assert.ok(mitHebe.mengen.some((m) => m.key === "rw_hebeanlage"));
  });

  it("ohne TG kein Überlauf-Check; abgeschaltet → genau ein warn mit Projektvorgabe, keine Mengen", () => {
    const erd = regenwasserNutzung({ ...HAND, tgAktiv: false });
    assert.ok(!erd.checks.some((x) => x.key === "rw_ueberlauf"));
    const aus = regenwasserNutzung({ ...HAND, nutzung: { aktiv: false } });
    assert.deepEqual(aus.checks.map((x) => [x.key, x.status]), [["rw_aktiv", "warn"]]);
    assert.deepEqual(aus.mengen, []);
  });

  it("Mengen mit Einheit: Zisterne m³, Sohle m², Filter/Pumpe Stk., Leitung m, Technikraum m²", () => {
    const m = Object.fromEntries(voll.mengen.map((x) => [x.key, x]));
    assert.equal(m.rw_zisterne.menge, 21);
    assert.equal(m.rw_zisterne.einheit, "m³");
    assert.match(m.rw_zisterne.label, /unter TG-Bodenplatte/);
    assert.equal(m.rw_zisterne_sohle.menge, 14);
    assert.equal(m.rw_filter.einheit, "Stk.");
    // risers ceil(48 / 8) = 6 · (4 + 1) · 3 m = 90 m + 30 m garden line
    assert.equal(m.rw_leitung.menge, 120);
    assert.equal(m.rw_technikraum.menge, 12);
    assert.deepEqual(regenwasserMengen({ sp: speicher({}), zi: null, raum: null }), []);
  });
});

describe("91-01 — Layer (additiv in entwaesserung_layer)", () => {
  it("Default aktiv (Projektvorgabe), alte Layer ohne nutzung bekommen den Default", () => {
    assert.equal(NUTZUNG_DEFAULT.aktiv, true);
    assert.deepEqual(ENTW_DEFAULT.nutzung, NUTZUNG_DEFAULT);
    const alt = layerHardened({ rueckstau: { ebene_m: 0.1 } });
    assert.equal(alt.nutzung.aktiv, true);
    assert.equal(alt.nutzung.ueberlaufMassnahme, "keine");
    assert.equal(alt.rueckstau.ebene_m, 0.1, "Bestehendes bleibt");
  });

  it("Härtung: Unsinn fällt weg, gespeicherte Werte bleiben", () => {
    const n = nutzungHardened({ aktiv: false, ueberlaufMassnahme: "zauberei", flaechen: [{ art: "flachdach", m2: -5 }, { art: "quatsch", m2: 9 }], gartenFlaeche_m2: "120" });
    assert.equal(n.aktiv, false);
    assert.equal(n.ueberlaufMassnahme, "keine");
    assert.deepEqual(n.flaechen, [{ art: "flachdach", m2: 0 }]);
    assert.equal(n.gartenFlaeche_m2, 120);
    assert.equal(nutzungHardened({ gartenFlaeche_m2: "" }).gartenFlaeche_m2, null);
  });
});
