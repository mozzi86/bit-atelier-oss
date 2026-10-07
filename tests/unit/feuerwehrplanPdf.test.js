// Unit-Tests für die reine Layout-Rechnung des Feuerwehrplan-Blatts (Phase 38, BSP-05).
// Rasterung und jsPDF laufen nur im Browser (Headless-Beleg tmp-verify-38.mjs).

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { A4_QUER, BLATT, HAFTUNGSZEILE, feuerwehrplanLayout } from "@designer/lib/feuerwehrplanPdf";

const innerhalb = (a, b) => a.x >= b.x - 1e-9 && a.y >= b.y - 1e-9 && a.x + a.w <= b.x + b.w + 1e-9 && a.y + a.h <= b.y + b.h + 1e-9;

describe("feuerwehrplanLayout", () => {
  it("A4 quer: Rahmen mit 10 mm Rand, Titel oben, Hinweis unten, Legende rechts, Plan links — alles im Rahmen", () => {
    const L = feuerwehrplanLayout({ imgW: 1600, imgH: 1200, legendeZeilen: 5 });
    assert.deepEqual(L.rahmen, { x: 10, y: 10, w: 277, h: 190 });
    assert.equal(L.titel.h, BLATT.titelH);
    assert.equal(L.hinweis.y + L.hinweis.h, L.rahmen.y + L.rahmen.h);
    assert.equal(L.legende.x + L.legende.w, L.rahmen.x + L.rahmen.w);
    for (const k of ["titel", "plan", "planFeld", "legende", "hinweis"]) assert.ok(innerhalb(L[k], L.rahmen), k);
    assert.ok(innerhalb(L.plan, L.planFeld), "Bild im Planfeld");
    assert.ok(L.planFeld.x + L.planFeld.w <= L.legende.x, "Plan links der Legende");
    assert.equal(A4_QUER.w, 297);
  });

  it("Seitenverhältnis bleibt erhalten und das Bild ist im Planfeld zentriert (breit und hoch)", () => {
    const breit = feuerwehrplanLayout({ imgW: 2000, imgH: 800 });
    assert.ok(Math.abs(breit.plan.w / breit.plan.h - 2.5) < 1e-9);
    assert.ok(Math.abs((breit.plan.y - breit.planFeld.y) - (breit.planFeld.y + breit.planFeld.h - breit.plan.y - breit.plan.h)) < 1e-9, "vertikal zentriert");
    const hoch = feuerwehrplanLayout({ imgW: 800, imgH: 2000 });
    assert.ok(Math.abs(hoch.plan.w / hoch.plan.h - 0.4) < 1e-9);
    assert.ok(Math.abs(hoch.plan.h - hoch.planFeld.h) < 1e-9, "Höhe füllt das Feld");
    assert.ok(Math.abs((hoch.plan.x - hoch.planFeld.x) - (hoch.planFeld.x + hoch.planFeld.w - hoch.plan.x - hoch.plan.w)) < 1e-9, "horizontal zentriert");
  });

  it("Legendenzeilen schrumpfen bei vielen Einträgen, bleiben ≥ 3,5 mm; ohne Bildmaße 4:3", () => {
    assert.equal(feuerwehrplanLayout({ imgW: 100, imgH: 100, legendeZeilen: 0 }).zeilenHoehe, 6);
    assert.equal(feuerwehrplanLayout({ imgW: 100, imgH: 100, legendeZeilen: 4 }).zeilenHoehe, 6);
    const viele = feuerwehrplanLayout({ imgW: 100, imgH: 100, legendeZeilen: 60 });
    assert.ok(viele.zeilenHoehe >= 3.5 && viele.zeilenHoehe < 6);
    const ohne = feuerwehrplanLayout({ imgW: 0, imgH: 0 });
    assert.ok(Math.abs(ohne.plan.w / ohne.plan.h - 4 / 3) < 1e-9);
  });

  it("Haftungszeile nennt Konzept, DIN 14095 und Fachplaner", () => {
    assert.match(HAFTUNGSZEILE, /Konzeptplan/);
    assert.match(HAFTUNGSZEILE, /DIN 14095/);
    assert.match(HAFTUNGSZEILE, /Fachplaner/);
  });
});
