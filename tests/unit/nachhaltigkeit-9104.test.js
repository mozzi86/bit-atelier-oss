// Unit tests for plan 91-04 (nachhaltigkeitskonzept.js + nachhaltigkeitPdf.js): the four sections from the
// planners' figures with hand calculations, gaps instead of zeros, the "not recorded" share of the plot,
// green roof ↔ rainwater trade-off, PV potential estimate, and the PDF text (uncompressed jsPDF output).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { nachhaltigkeitsModell, PV_ANNAHMEN, wertText } from "@designer/lib/nachhaltigkeitskonzept";
import { nachhaltigkeitPdf, WARNUNG_TEXT } from "@designer/lib/nachhaltigkeitPdf";
import { regenwasserNutzung } from "@designer/lib/regenwassernutzung";

const abschnitt = (m, key) => m.abschnitte.find((a) => a.key === key);
const wert = (a, label) => a.zeilen.find((z) => z.label === label)?.wert;

describe("91-04 nachhaltigkeitsModell", () => {
  const rw = regenwasserNutzung({ footArea_m2: 1000, dachform: "flach", niederschlag_mm: 800, we: 48, tgAktiv: true, tgFlaeche_m2: 1500 });

  it("takes the rainwater figures unchanged from regenwasserNutzung", () => {
    const m = nachhaltigkeitsModell({ regenwasser: rw, footArea_m2: 1000, dachform: "flach", plot_m2: 3000 });
    const r = abschnitt(m, "regenwasser");
    assert.equal(wert(r, "Zisterne"), Math.round(rw.zisterne.volumen_m3));
    assert.equal(wert(r, "Deckungsgrad"), Math.round(rw.speicher.deckung * 100));
    assert.equal(r.status, "teilweise", "a multi-storey roof covers < 50 % of the toilet demand (91-01)");
    assert.ok(r.hinweise.some((h) => /unter der Bodenplatte/.test(h)));
  });

  it("sealing: footprint + paved areas over the plot; undrawn rest is 'nicht erfasst', never green", () => {
    const m = nachhaltigkeitsModell({ regenwasser: rw, footArea_m2: 1000, plot_m2: 3000, flaechenSummen: { befestigt: 500, gruen: 1000, beet: 200, wasser: 50 } });
    const v = abschnitt(m, "versiegelung");
    // (1000 + 500) / 3000 = 50 %; not recorded = 3000 − 1500 − 1250 = 250 m² (8 % > 5 % → teilweise)
    assert.equal(wert(v, "Versiegelungsgrad"), 50);
    assert.equal(wert(v, "Grün- und Wasserflächen"), 1250);
    assert.equal(wert(v, "Noch nicht erfasst"), 250);
    assert.equal(v.status, "teilweise");
    const voll = nachhaltigkeitsModell({ footArea_m2: 1000, plot_m2: 3000, flaechenSummen: { befestigt: 500, gruen: 1500 } });
    assert.equal(abschnitt(voll, "versiegelung").status, "umgesetzt");
    const hoch = nachhaltigkeitsModell({ footArea_m2: 1500, plot_m2: 2000, flaechenSummen: { befestigt: 300, gruen: 200 } });
    assert.equal(abschnitt(hoch, "versiegelung").status, "teilweise");
    assert.ok(abschnitt(hoch, "versiegelung").hinweise.some((h) => /60 %/.test(h)));
  });

  it("missing plot / roof / rainwater become gaps, not zeros", () => {
    const m = nachhaltigkeitsModell({});
    assert.equal(m.luecken.length, 3);
    assert.equal(abschnitt(m, "versiegelung").zeilen.length, 0);
    assert.equal(wertText({ wert: null, einheit: "%" }), "—");
  });

  it("green roof share from the roof surfaces, with the trade-off note while rainwater is active", () => {
    const mitGruen = regenwasserNutzung({ footArea_m2: 1000, dachform: "flach", gruendachAnteil: 0.6, niederschlag_mm: 800, we: 48 });
    const m = nachhaltigkeitsModell({ regenwasser: mitGruen, footArea_m2: 1000, dachform: "flach", plot_m2: 3000 });
    const g = abschnitt(m, "gruendach");
    assert.equal(wert(g, "davon begrünt"), 600);
    assert.equal(wert(g, "Anteil begrünt"), 60);
    assert.equal(g.status, "umgesetzt");
    assert.ok(g.hinweise.some((h) => /Zielkonflikt/.test(h)));
    assert.equal(abschnitt(nachhaltigkeitsModell({ regenwasser: rw, footArea_m2: 1000 }), "gruendach").status, "offen");
  });

  it("PV: planned kWp from the energy systems, roof potential as an estimate", () => {
    const m = nachhaltigkeitsModell({ footArea_m2: 1000, dachform: "flach", energySystems: [{ type: "Photovoltaik", capacity_kw: 80 }, { type: "Fernwärme", capacity_kw: 300 }] });
    const p = abschnitt(m, "pv");
    assert.equal(wert(p, "Geplante Leistung"), 80);
    assert.equal(wert(p, "Ertrag (Schätzung)"), 80 * PV_ANNAHMEN.kwhJeKwp);
    // 1000 m² × 0.5 × 0.2 kWp/m² = 100 kWp
    assert.equal(wert(p, "Dachpotenzial (Schätzung)"), 100);
    assert.equal(p.status, "umgesetzt");
    const zuViel = nachhaltigkeitsModell({ footArea_m2: 1000, energySystems: [{ type: "Photovoltaik", capacity_kw: 200 }] });
    assert.equal(abschnitt(zuViel, "pv").status, "teilweise");
    assert.equal(abschnitt(nachhaltigkeitsModell({ footArea_m2: 1000 }), "pv").status, "offen");
  });
});

describe("91-04 nachhaltigkeitPdf", () => {
  it("writes title, all sections, estimates, gaps and the draft warning", async () => {
    const m = nachhaltigkeitsModell({ footArea_m2: 1000, energySystems: [{ type: "Photovoltaik", capacity_kw: 80 }] });
    const r = await nachhaltigkeitPdf(m, { name: "Testhaus" }, { jetzt: new Date("2026-10-11T10:00:00Z") });
    const text = new TextDecoder("latin1").decode(r.bytes);
    assert.match(r.dateiname, /^Nachhaltigkeitskonzept_Testhaus_2026-10-11\.pdf$/);
    for (const s of ["Nachhaltigkeitskonzept", "Regenwassernutzung", "Photovoltaik", "Versiegelung", "Offene Angaben", "ENTWURF", "80 kWp", "Schätzung aus Faustwerten"]) {
      assert.ok(text.includes(s), s);
    }
    assert.ok(text.includes(WARNUNG_TEXT.slice(0, 30)));
    assert.equal(r.seiten, 1);
  });
});
