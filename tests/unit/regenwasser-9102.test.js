// Unit tests for plan 91-02: cistern outline under the garage (regenwassernutzung.zisternenRechteck)
// and the mandatory cellar room "Haustechnik Regenwasser" (keller.js option regenwasser_m2, set by
// the Werkstatt from useRegenwasser — default 0 keeps every existing cellar unchanged).
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { zisternenRechteck, weAusZonen } from "@designer/lib/regenwassernutzung";
import { kellerLayout, kellerOptionen, kellerMengen, KELLER_DEFAULT_OPTIONEN } from "@designer/lib/keller";

const rect = (w, d) => [{ x: -w / 2, z: -d / 2 }, { x: w / 2, z: -d / 2 }, { x: w / 2, z: d / 2 }, { x: -w / 2, z: d / 2 }];
const flaeche = (pts) => Math.abs(pts.reduce((s, p, i) => { const q = pts[(i + 1) % pts.length]; return s + p.x * q.z - q.x * p.z; }, 0) / 2);
const WE = Array.from({ length: 12 }, (_, i) => ({ we: `WE 0-${i + 1}`, level: 0 }));

describe("91-02 — Zisterne im TG-Grundriss", () => {
  it("Rechteck mit der Fläche, mittig in der TG, gleiches Seitenverhältnis", () => {
    const zonen = [{ points: rect(40, 16) }];
    const r = zisternenRechteck(zonen, 14);
    assert.ok(Math.abs(flaeche(r) - 14) < 1e-6, `Fläche ${flaeche(r)}`);
    const xs = r.map((p) => p.x), zs = r.map((p) => p.z);
    assert.ok(Math.abs((Math.max(...xs) + Math.min(...xs)) / 2) < 1e-9 && Math.abs((Math.max(...zs) + Math.min(...zs)) / 2) < 1e-9, "mittig");
    assert.ok(Math.abs((Math.max(...xs) - Math.min(...xs)) / (Math.max(...zs) - Math.min(...zs)) - 40 / 16) < 1e-9, "Seitenverhältnis");
  });

  it("größer als die TG → auf die TG begrenzt; ohne Zonen oder Fläche null", () => {
    const r = zisternenRechteck([{ points: rect(10, 5) }], 500);
    assert.ok(Math.abs(flaeche(r) - 50) < 1e-6);
    assert.equal(zisternenRechteck([], 10), null);
    assert.equal(zisternenRechteck([{ points: rect(10, 5) }], 0), null);
  });
});

describe("91-02 — Keller: Pflichtraum Haustechnik Regenwasser", () => {
  it("Default 0: kein Raum, bestehende Keller unverändert", () => {
    assert.equal(KELLER_DEFAULT_OPTIONEN.regenwasser_m2, 0);
    const k = kellerLayout({ footprintM: rect(40, 16), weListe: WE, optionen: kellerOptionen({}) });
    assert.ok(!k.zonen.some((z) => z.keller === "regenwasser"));
    assert.equal(k.mengen?.regenwasser_m2 ?? kellerMengen({ zonen: k.zonen }).regenwasser_m2, 0);
  });

  it("mit 12 m²: eigener Raum neben dem Technikraum, laut, Fläche in den Mengen", () => {
    const k = kellerLayout({ footprintM: rect(40, 16), weListe: WE, optionen: kellerOptionen({ regenwasser_m2: 12 }) });
    const raum = k.zonen.find((z) => z.keller === "regenwasser");
    assert.ok(raum, "Raum vorhanden");
    assert.match(raum.name, /^Haustechnik Regenwasser/);
    assert.equal(raum.raumart, "laut");
    assert.ok(k.zonen.some((z) => z.keller === "technik"), "allgemeiner Technikraum bleibt");
    const m = kellerMengen({ zonen: k.zonen });
    assert.ok(m.regenwasser_m2 >= 12 - 1e-6, `Fläche ${m.regenwasser_m2}`);
  });
});

describe("91-02 — Wohneinheiten aus dem angewendeten Layout", () => {
  it("zählt eindeutige WE-Ids ab Geschoss 0, Kellerabteile (−1) und Zonen ohne WE zählen nicht", () => {
    const zonen = [
      { we: "WE 0-1", level: 0 }, { we: "WE 0-1", level: 0 }, { we: "WE 0-2", level: 0 },
      { we: "WE 1-1", level: 1 }, { we: "WE 0-1", level: -1 }, { we: null, level: 0 }, { level: 0 },
    ];
    assert.equal(weAusZonen(zonen), 3);
    assert.equal(weAusZonen([]), 0);
    assert.equal(weAusZonen(null), 0);
  });
  it("Reihenhaus: eine WE über mehrere Geschosse zählt einmal", () => {
    assert.equal(weAusZonen([{ we: "WE 1", level: 0 }, { we: "WE 1", level: 1 }, { we: "WE 2", level: 0 }]), 2);
  });
});
