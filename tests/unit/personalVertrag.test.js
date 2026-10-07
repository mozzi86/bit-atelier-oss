// personalVertrag.test.js — Vertragsprüfung (Plan 80-06, Task 1): Behavior
// 1, 5–8 mit Rechenweg. `regelWert` liest die ECHTEN HR_REGELN über den
// Regelwerk-Kern (regelWerteAus), keine handgeschriebene Werte-Kopie — so
// prüfen die Fälle exakt die Werte, die auch die App zur Laufzeit liest.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { regelWerteAus } from "@core/lib/regelwerk.js";
import { HR_REGELN } from "@/lib/people/hrRegeln.js";
import { probezeitEnde, befristungPruefen, mindestlohnPruefen, pruefeVertrag, gehaltAm } from "@/lib/people/vertrag.js";

/** @type {import("@core/lib/regelwerk.js").RegelGruppe} */
const HR_GRUPPE = { gruppe: "personal", titel: "Personal", regeln: HR_REGELN, sichtbar: () => true, speicher: { art: "zeilen" } };
const { wert: regelWert } = regelWerteAus([HR_GRUPPE], []);

describe("probezeitEnde — Behavior 1 (§§ 187 Abs. 2, 188 Abs. 2 Alt. 2, Abs. 3 BGB)", () => {
  it("2026-01-01 + 6 Monate = 2026-06-30", () => assert.equal(probezeitEnde("2026-01-01", 6), "2026-06-30"));
  it("2026-03-15 + 6 Monate = 2026-09-14", () => assert.equal(probezeitEnde("2026-03-15", 6), "2026-09-14"));
  it("2026-08-31 + 6 Monate = 2027-02-28 (Februar hat keinen 31.)", () => assert.equal(probezeitEnde("2026-08-31", 6), "2027-02-28"));
  it("2026-04-21 + 6 Monate = 2026-10-20 (Vertrag V-003 des Seeds)", () => assert.equal(probezeitEnde("2026-04-21", 6), "2026-10-20"));
});

describe("mindestlohnPruefen — Behavior 5 (§ 1 MiLoG, Monatsstunden = Wochenstunden × 13/3)", () => {
  it("2000 €/Monat bei 40 h = 11,54 €/h < 13,90 € (2026) → Warnung", () => {
    const w = mindestlohnPruefen(2000, "monat", 40, "2026-03-01", regelWert);
    assert.ok(w, "erwartet eine Warnung");
    assert.equal(w.norm, "§ 1 MiLoG");
    assert.equal(w.schwere, "warn");
  });
  it("2500 €/Monat bei 40 h = 14,42 €/h ≥ 13,90 € → keine Warnung", () => {
    assert.equal(mindestlohnPruefen(2500, "monat", 40, "2026-03-01", regelWert), null);
  });
  it("15 €/Stunde (2026) → keine Warnung", () => {
    assert.equal(mindestlohnPruefen(15, "stunde", 20, "2026-03-01", regelWert), null);
  });
  it("14 €/Stunde am 2027-02-01 < 14,60 € (2027) → Warnung", () => {
    const w = mindestlohnPruefen(14, "stunde", 20, "2027-02-01", regelWert);
    assert.ok(w);
    assert.match(w.text, /14,6/);
  });
});

describe("befristungPruefen — Behavior 6 (§ 14 TzBfG)", () => {
  it("sachgrundlos 2026-01-01 bis 2028-07-01 (30 Monate) → § 14 Abs. 2 TzBfG", () => {
    const vertrag = { id: "v1", mitarbeiter_id: "m1", vertragsart: "befristet_ohne_sachgrund", beginn: "2026-01-01", ende: "2028-07-01", schriftform_vor_beginn: true, unterschrieben_am: "2025-12-15", verlaengerungen: [] };
    const warnungen = befristungPruefen(vertrag, [], regelWert);
    assert.ok(warnungen.some((w) => w.norm === "§ 14 Abs. 2 TzBfG" && w.regel === "befristung_sachgrundlos_monate"));
  });
  it("4 Verlängerungen (Höchstzahl 3) → § 14 Abs. 2 TzBfG", () => {
    const vertrag = { id: "v2", mitarbeiter_id: "m2", vertragsart: "befristet_ohne_sachgrund", beginn: "2026-01-01", ende: "2026-07-01", schriftform_vor_beginn: true, unterschrieben_am: "2025-12-15", verlaengerungen: [{}, {}, {}, {}] };
    const warnungen = befristungPruefen(vertrag, [], regelWert);
    assert.ok(warnungen.some((w) => w.norm === "§ 14 Abs. 2 TzBfG" && w.regel === "befristung_sachgrundlos_verlaengerungen"));
  });
  it("schriftform_vor_beginn:false → § 14 Abs. 4 TzBfG", () => {
    const vertrag = { id: "v3", mitarbeiter_id: "m3", vertragsart: "befristet_ohne_sachgrund", beginn: "2026-01-01", ende: "2026-07-01", schriftform_vor_beginn: false, verlaengerungen: [] };
    const warnungen = befristungPruefen(vertrag, [], regelWert);
    assert.ok(warnungen.some((w) => w.norm === "§ 14 Abs. 4 TzBfG"));
  });
  it("Gründer, 36 Monate (Grenze 48) → keine Warnung", () => {
    const vertrag = {
      id: "v4", mitarbeiter_id: "m4", vertragsart: "befristet_gruender", beginn: "2026-01-01", ende: "2029-01-01",
      probezeit_monate: 6, schriftform_vor_beginn: true, unterschrieben_am: "2025-12-15", verlaengerungen: [],
    };
    assert.deepEqual(befristungPruefen(vertrag, [], regelWert), []);
  });
});

describe("pruefeVertrag — Behavior 7", () => {
  it("Probezeit 7 Monate (Grenze 6) → § 622 Abs. 3 BGB, schwere warn", () => {
    const vertrag = { id: "v5", mitarbeiter_id: "m5", vertragsart: "unbefristet", beginn: "2026-01-01", ende: null, probezeit_monate: 7, wochenstunden: 40, arbeitstage_woche: 5, urlaub_tage_jahr: 28, schriftform_vor_beginn: true, verlaengerungen: [] };
    const ergebnis = pruefeVertrag(vertrag, { mitarbeiter: { art: "angestellt" }, historie: [], gehaelter: [] }, regelWert);
    const treffer = ergebnis.find((e) => e.regel === "probezeit_max");
    assert.ok(treffer);
    assert.equal(treffer.norm, "§ 622 Abs. 3 BGB");
    assert.ok(ergebnis.every((e) => e.schwere === "warn"));
  });
  it("Urlaub 18 Tage bei 5 Arbeitstagen/Woche (Mindest 20) → § 3 BUrlG", () => {
    const vertrag = { id: "v6", mitarbeiter_id: "m6", vertragsart: "unbefristet", beginn: "2026-01-01", ende: null, probezeit_monate: 6, wochenstunden: 40, arbeitstage_woche: 5, urlaub_tage_jahr: 18, schriftform_vor_beginn: true, verlaengerungen: [] };
    const ergebnis = pruefeVertrag(vertrag, { mitarbeiter: { art: "angestellt" }, historie: [], gehaelter: [] }, regelWert);
    const treffer = ergebnis.find((e) => e.regel === "urlaub_mindest");
    assert.ok(treffer);
    assert.equal(treffer.norm, "§ 3 BUrlG");
    assert.ok(ergebnis.every((e) => e.schwere === "warn"));
  });
  it("Seed-Vertrag V-003 (Lena Beispiel) → [] (nichts zu warnen)", () => {
    const vertrag = {
      id: "V-003", mitarbeiter_id: "P-003", vertragsart: "befristet_ohne_sachgrund", beginn: "2026-04-21", ende: "2028-04-20",
      status: "unterschrieben", probezeit_monate: 6, wochenstunden: 40, arbeitstage_woche: 5, urlaub_tage_jahr: 28, zusatzurlaub_tage: 0,
      verlaengerungen: [], unterschrieben_am: "2026-04-01", schriftform_vor_beginn: true,
    };
    const gehaelter = [{ id: "G-003", arbeitsvertrag_id: "V-003", mitarbeiter_id: "P-003", gueltig_ab: "2026-04-21", brutto_eur: 4200 }];
    const ergebnis = pruefeVertrag(vertrag, { mitarbeiter: { art: "angestellt" }, historie: [], gehaelter }, regelWert);
    assert.deepEqual(ergebnis, []);
  });
  it("Personenart ohne Arbeitsrecht (Gesellschafter) → [] mit Hinweis „kein Arbeitsvertrag“", () => {
    const ergebnis = pruefeVertrag(null, { mitarbeiter: { art: "gesellschafter" }, historie: [], gehaelter: [] }, regelWert);
    assert.equal(ergebnis.length, 1);
    assert.match(ergebnis[0].text, /kein Arbeitsvertrag/);
    assert.notEqual(ergebnis[0].schwere, "warn");
  });
});

describe("gehaltAm — Behavior 8", () => {
  const gehaelter = [
    { id: "G-003", mitarbeiter_id: "P-003", gueltig_ab: "2026-04-21", brutto_eur: 4200 },
  ];
  it("am 2026-06-01 → 4200 (jüngster Eintrag ≤ Stichtag)", () => {
    assert.equal(gehaltAm(gehaelter, "P-003", "2026-06-01")?.brutto_eur, 4200);
  });
  it("am 2026-04-01 (vor gueltig_ab) → null", () => {
    assert.equal(gehaltAm(gehaelter, "P-003", "2026-04-01"), null);
  });
});
