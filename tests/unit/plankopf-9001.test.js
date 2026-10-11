// Unit tests for plan 90-01 (packages/nova-pdf/src/lib/plankopf.js): rows normal vs neutral
// (neutral never carries an office value), plan-number scheme, block geometry on A4 … A0 in
// both orientations, drawing onto a real PDF (pdf-lib) with page selection and cover area,
// characters outside WinAnsi do not crash.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";

import { PLANKOPF_FELDER, PLANKOPF_MASSE, PT_JE_MM, plannummer, plankopfZeilen, plankopfRechteck, plankopfAufPdf } from "@pdf/lib/plankopf";

const PROJEKT = { name: "Testhaus Nord", client: "Bauherrschaft Muster", location: { address: "Musterweg 1", city: "Musterstadt" } };
const BUERO = { office: "Planungsbüro Beispiel", address: "Beispielstraße 2, 12345 Beispielstadt", contact: "info@example.org" };
const mm = (w, h) => ({ width: w * PT_JE_MM, height: h * PT_JE_MM });
const FORMATE = { A4: [210, 297], A3: [297, 420], A1: [594, 841], A0: [841, 1189] };

async function pdfMitSeiten(n, [w, h] = FORMATE.A3) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < n; i += 1) doc.addPage([w * PT_JE_MM, h * PT_JE_MM]);
  return doc.save();
}

describe("90-01 — Plankopf-Zeilen", () => {
  it("normal: Projekt, Bauort, Bauherr aus dem Projekt, Planverfasser aus dem Büroprofil, kein „Anlage zu“", () => {
    const z = plankopfZeilen({ projekt: PROJEKT, buero: BUERO });
    const w = Object.fromEntries(z.map((r) => [r.key, r.wert]));
    assert.equal(w.projekt, "Testhaus Nord");
    assert.equal(w.bauort, "Musterweg 1, Musterstadt");
    assert.equal(w.bauherr, "Bauherrschaft Muster");
    assert.match(w.planverfasser, /Planungsbüro Beispiel/);
    assert.ok(!z.some((r) => r.key === "anlageZu"));
  });

  it("neutral (Anlagen-Plankopf): KEIN Wert aus dem Büroprofil, keine Büro-Felder, „Anlage zu“ dabei", () => {
    const z = plankopfZeilen({ projekt: PROJEKT, buero: BUERO, neutral: true, eingaben: { anlageZu: "LV 012 Rohbau" } });
    const alles = JSON.stringify(z);
    for (const v of Object.values(BUERO)) assert.ok(!alles.includes(v), `Büro-Wert „${v}“ im neutralen Plankopf`);
    const buero = PLANKOPF_FELDER.filter((f) => f.buero).map((f) => f.key);
    assert.ok(z.every((r) => !buero.includes(r.key)));
    assert.equal(z.find((r) => r.key === "anlageZu")?.wert, "LV 012 Rohbau");
  });

  it("Eingaben überschreiben die Vorbelegung, leere Felder bleiben als Zeile", () => {
    const z = plankopfZeilen({ projekt: PROJEKT, eingaben: { projekt: "Anderer Name", massstab: "1:100" } });
    assert.equal(z.find((r) => r.key === "projekt").wert, "Anderer Name");
    assert.equal(z.find((r) => r.key === "massstab").wert, "1:100");
    assert.equal(z.find((r) => r.key === "index").wert, "");
  });
});

describe("90-01 — Plannummer", () => {
  it("Schema Projekt-LPH-Gewerk-Nr-Index, Nr dreistellig, Leerteile entfallen", () => {
    assert.equal(plannummer({ projektKurz: "prj", lph: 5, gewerk: "ar", nr: 12, index: "b" }), "PRJ-LP5-AR-012-B");
    assert.equal(plannummer({ projektKurz: "PRJ", nr: "7" }), "PRJ-007");
    assert.equal(plannummer({}), "");
  });
});

describe("90-01 — Geometrie", () => {
  for (const [name, [w, h]] of Object.entries(FORMATE)) {
    for (const [lage, s] of [["hoch", mm(w, h)], ["quer", mm(h, w)]]) {
      it(`${name} ${lage}: Plankopf unten rechts vollständig auf der Seite, Rand ${PLANKOPF_MASSE.rand_mm} mm`, () => {
        const r = plankopfRechteck(s);
        const rand = PLANKOPF_MASSE.rand_mm * PT_JE_MM;
        assert.ok(r.x >= rand - 1e-6 && r.y >= rand - 1e-6, "innerhalb des Randes");
        assert.ok(r.x + r.w <= s.width - rand + 1e-6 && r.y + r.h <= s.height - rand + 1e-6, "nicht über die Seite");
        assert.ok(Math.abs(r.x + r.w - (s.width - rand)) < 1e-6, "bündig rechts");
      });
    }
  }
  it("schmale Seite: Breite schrumpft auf Seitenbreite − 2 × Rand", () => {
    const s = mm(120, 200);
    assert.ok(Math.abs(plankopfRechteck(s).w - (120 - 2 * PLANKOPF_MASSE.rand_mm) * PT_JE_MM) < 1e-6);
  });
});

describe("90-01 — Plankopf auf ein PDF setzen", () => {
  it("alle Seiten: PDF bleibt lesbar, Seitenzahl gleich, Bericht nennt Seiten und Rechteck in mm", async () => {
    const quelle = await pdfMitSeiten(3);
    const { bytes, bericht } = await plankopfAufPdf(quelle, { zeilen: plankopfZeilen({ projekt: PROJEKT, buero: BUERO, eingaben: { planinhalt: "Grundriss EG" } }) });
    const neu = await PDFDocument.load(bytes);
    assert.equal(neu.getPageCount(), 3);
    assert.deepEqual(bericht.seiten, [0, 1, 2]);
    assert.equal(bericht.rechteck_mm.w, PLANKOPF_MASSE.breite_mm);
    assert.equal(bericht.abdeckung_mm, null, "normaler Plankopf deckt nichts ab");
    assert.ok(bytes.length > quelle.length, "Inhalt hinzugefügt");
  });

  it("Seitenauswahl + neutral: nur gewählte Seiten, Abdeckung Standard Breite + Rand × 70 mm", async () => {
    const quelle = await pdfMitSeiten(4);
    const { bericht } = await plankopfAufPdf(quelle, { zeilen: plankopfZeilen({ projekt: PROJEKT, neutral: true }), seiten: [1, 3, 9], neutral: true });
    assert.deepEqual(bericht.seiten, [1, 3], "ungültige Seite 9 fällt weg");
    assert.deepEqual(bericht.abdeckung_mm, { w: PLANKOPF_MASSE.breite_mm + PLANKOPF_MASSE.rand_mm, h: PLANKOPF_MASSE.abdeckH_mm });
  });

  it("Sonderzeichen außerhalb WinAnsi stürzen nicht ab; Fehler im Klartext", async () => {
    const quelle = await pdfMitSeiten(1, FORMATE.A4);
    const r = await plankopfAufPdf(quelle, { zeilen: [{ label: "Planinhalt", wert: "Fläche ≥ 10 m² ✓ 中" }] });
    assert.ok(r.bytes.length > 0);
    await assert.rejects(plankopfAufPdf(quelle, { zeilen: [] }), /keine Felder/);
    await assert.rejects(plankopfAufPdf(new Uint8Array([1, 2, 3]), { zeilen: [{ label: "x", wert: "y" }] }), /nicht gelesen/);
  });
});
