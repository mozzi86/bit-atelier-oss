// Unit tests for the necessary stair enclosure of tesselierung.js (75-13 Task 4):
// zone "Treppenraum" (raumart treppenraum) instead of the Phase-61 "Kern", lift switch
// (default = duty: office rule > 3 storeys, D-P75-13-A), core 6 × 3 m with lift,
// extension 0–6 m per side with fire wall + T30-RS door (MBO §35 Abs. 4–6 [CITED]),
// measurement of the escape route ends at the new door.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { tesseliere, kernRegeln, TREPPENRAUM, AUFZUG_SCHWELLEN, RETTUNGSWEG_MAX } from "@designer/lib/tesselierung";
import { AUFZUG_GESCHOSS_GRENZE, AUFZUG_OKF_GRENZE } from "@designer/lib/accessibility";
import { WERKSTATT_TYPEN } from "@designer/lib/wohnungsTypen";

const FP40 = [{ x: -20, z: -13 }, { x: 20, z: -13 }, { x: 20, z: 13 }, { x: -20, z: 13 }];
// 70 × 16 m: long enough that the stair door is > 35 m from the end units.
const FP70 = [{ x: -35, z: -8 }, { x: 35, z: -8 }, { x: 35, z: 8 }, { x: -35, z: 8 }];
const REF = WERKSTATT_TYPEN.filter((t) => t.gruppe === "referenz").slice(0, 3);
const STD = WERKSTATT_TYPEN.filter((t) => t.gruppe === "standard").slice(0, 3);
const r2 = (v) => Math.round(v * 100) / 100;
const bbox = (zonen) => {
  const xs = zonen.flatMap((z) => z.points.map((p) => p.x)), zs = zonen.flatMap((z) => z.points.map((p) => p.z));
  return { w: r2(Math.max(...xs) - Math.min(...xs)), d: r2(Math.max(...zs) - Math.min(...zs)) };
};
const kern = (r, level = 0) => r.zonen.filter((z) => z.level === level && (z.raumart === "treppenraum" || z.raumart === "aufzug"));
const mfh = (regeln, extra = {}) => tesseliere({ footprintM: FP40, storeys: 1, typ: "mfh", einheiten: REF, raumzonen: true, regeln, ...extra });
const lang = (regeln) => tesseliere({ footprintM: FP70, storeys: 1, typ: "mfh", einheiten: STD, raumzonen: true, regeln: { rettungsweg: true, treppenraum: true, aufzug: false, ...regeln } });
const maxLauf = (r) => Math.max(...r.weListe.map((w) => w.rettungsweg_m));

describe("kernRegeln (75-13 Task 4)", () => {
  it("ohne Schalter alles aus; Aufzugspflicht wird trotzdem gemeldet", () => {
    const k = kernRegeln({}, 6, 15);
    assert.equal(k.aktiv, false);
    assert.equal(k.aufzug, false, "ohne Treppenraum-Schalter kein Aufzug");
    assert.equal(k.erweiterung_m, 0);
    assert.equal(k.aufzugPflicht, true);
  });

  it("Aufzug-Default = Pflicht: 4 Geschosse → an, 3 Geschosse → aus; OKF > 13 m → an (MBO §39 Abs. 4)", () => {
    assert.equal(kernRegeln({ treppenraum: true }, 4, 9).aufzug, true);
    assert.equal(kernRegeln({ treppenraum: true }, 3, 6).aufzug, false);
    assert.equal(kernRegeln({ treppenraum: true }, 3, 14).aufzug, true);
  });

  it("ausdrücklicher Aufzug-Schalter gewinnt gegen die Vorgabe (an bei 2 Geschossen, aus bei 6)", () => {
    assert.equal(kernRegeln({ treppenraum: true, aufzug: true }, 2, 3).aufzug, true);
    assert.equal(kernRegeln({ treppenraum: true, aufzug: false }, 6, 15).aufzug, false);
    assert.equal(kernRegeln({ treppenraum: true, aufzug: false }, 6, 15).aufzugPflicht, true, "Pflicht bleibt sichtbar");
  });

  it("Erweiterung wird auf 0 … 6 m geklemmt, ohne Treppenraum-Schalter 0", () => {
    assert.equal(kernRegeln({ treppenraum: true, treppenraumErweiterung_m: 9 }, 1, 0).erweiterung_m, 6);
    assert.equal(kernRegeln({ treppenraum: true, treppenraumErweiterung_m: -2 }, 1, 0).erweiterung_m, 0);
    assert.equal(kernRegeln({ treppenraumErweiterung_m: 4 }, 1, 0).erweiterung_m, 0);
  });

  it("Schwellen kommen aus accessibility.js (eine Quelle): > 3 Geschosse, OKF > 13 m", () => {
    assert.equal(AUFZUG_SCHWELLEN.geschosse, AUFZUG_GESCHOSS_GRENZE);
    assert.equal(AUFZUG_SCHWELLEN.okf_m, AUFZUG_OKF_GRENZE);
    assert.equal(AUFZUG_SCHWELLEN.geschosse, 3);
  });
});

describe("tesselierung.js — notwendiger Treppenraum (75-13 Task 4)", () => {
  it("Default (kein Schalter): weiterhin „Kern“ als Flur-Zone, kein Treppenraum, kein Aufzug", () => {
    const r = mfh({});
    assert.equal(kern(r).length, 0);
    assert.ok(r.zonen.some((z) => /^Kern /.test(z.name) && z.raumart === "flur"));
  });

  it("Treppenraum-Schalter aus → alle übrigen Kern-Schalter wirkungslos (Ausgabe byte-gleich zum Default)", () => {
    const a = mfh({});
    const b = mfh({ treppenraum: false, aufzug: true, treppenraumErweiterung_m: 5 });
    assert.equal(JSON.stringify(a), JSON.stringify(b));
  });

  it("ohne Aufzug: Treppenraum 2,5 × 5 m (raumart treppenraum, Name „Treppenraum 0 ·WT“), kein Aufzug-Zone", () => {
    const r = mfh({ treppenraum: true, aufzug: false });
    const k = kern(r);
    assert.equal(k.length, 1);
    assert.equal(k[0].raumart, "treppenraum");
    assert.match(k[0].name, /^Treppenraum 0 /);
    assert.deepEqual(bbox(k), { w: TREPPENRAUM.treppe.w, d: TREPPENRAUM.treppe.d });
    assert.equal(r.zonen.filter((z) => /^Kern /.test(z.name)).length, 0, "kein altes Kern-Label mehr");
  });

  it("mit Aufzug: getrennte Zonen Treppenraum + Aufzug, Kern gesamt 6 × 3 m (Auflage 11), Stair 3,5 + Schacht 2,5", () => {
    const r = mfh({ treppenraum: true, aufzug: true });
    const k = kern(r);
    assert.deepEqual(k.map((z) => z.raumart).sort(), ["aufzug", "treppenraum"]);
    assert.deepEqual(bbox(k), { w: 6, d: 3 });
    assert.deepEqual(bbox(k.filter((z) => z.raumart === "treppenraum")), { w: 3.5, d: 3 });
    assert.deepEqual(bbox(k.filter((z) => z.raumart === "aufzug")), { w: 2.5, d: 3 });
    assert.match(k.find((z) => z.raumart === "aufzug").name, /^Aufzug 0 /);
  });

  it("Spänner: gleicher Kern, 6 × 3 m auf der langen Achse mit Aufzug, 2,5 × 5 m ohne", () => {
    const sp = (regeln) => tesseliere({ footprintM: FP40, storeys: 1, typ: "spaenner", einheiten: REF, raumzonen: true, regeln });
    assert.deepEqual(bbox(kern(sp({ treppenraum: true, aufzug: true }))), { w: 6, d: 3 });
    assert.deepEqual(bbox(kern(sp({ treppenraum: true, aufzug: false }))), { w: 2.5, d: 5 });
  });

  it("Aufzug-Vorgabe nach Geschossen: 4 Geschosse → Aufzug-Zone und Hinweis „an“, 3 Geschosse → keine Zone, Hinweis „aus“", () => {
    const vier = mfh({ treppenraum: true }, { storeys: 4 });
    assert.equal(kern(vier, 0).filter((z) => z.raumart === "aufzug").length, 1);
    assert.equal(kern(vier, 3).filter((z) => z.raumart === "aufzug").length, 1, "durch alle Geschosse");
    const h4 = vier.hinweise.find((h) => /^Aufzug /.test(h));
    assert.match(h4, /^Aufzug an — Pflicht nach Büro-Vorgabe ab mehr als 3 Geschossen \(4 Geschosse: Pflicht\)/);
    assert.match(h4, /MBO §39 Abs\. 4/);
    assert.match(h4, /BayBO Art\. 37 Abs\. 4 ab Gebäudehöhe > 13 m/);
    assert.doesNotMatch(h4, /fünf oberirdischen/, "überholte Schwelle (HANDOFF §12) gehört nicht mehr in den Hinweis");
    assert.match(h4, /\[CITED\]/);
    const drei = mfh({ treppenraum: true }, { storeys: 3 });
    assert.equal(kern(drei).filter((z) => z.raumart === "aufzug").length, 0);
    assert.match(drei.hinweise.find((h) => /^Aufzug /.test(h)), /^Aufzug aus — .* \(3 Geschosse: keine Pflicht\)/);
  });

  it("Typologie ohne Kern (Laubengang) + Treppenraum-Schalter → Hinweis statt stiller Wirkungslosigkeit", () => {
    const r = tesseliere({ footprintM: FP40, storeys: 1, typ: "laubengang", einheiten: STD, raumzonen: true, regeln: { treppenraum: true } });
    assert.ok(r.hinweise.some((h) => /Notwendiger Treppenraum: Typologie laubengang hat keinen Kern/.test(h)));
  });
});

describe("tesselierung.js — Treppenraum-Erweiterung (75-13 Task 4)", () => {
  it("Erweiterung 0 ist byte-gleich zum Treppenraum ohne den Schieber", () => {
    assert.equal(JSON.stringify(lang({ treppenraumErweiterung_m: 0 })), JSON.stringify(lang({})));
  });

  it("Erweiterung 2 m: Treppenraum wächst auf 6,5 × 6,8 m (2 × 2 m Flur + Flurbreite), Grenzen als Brandwand, zwei Türen T30-RS", () => {
    const tr = kern(lang({ treppenraumErweiterung_m: 2 }))[0];
    assert.deepEqual(bbox([tr]), { w: r2(TREPPENRAUM.treppe.w + 4), d: r2(TREPPENRAUM.treppe.d + 1.8) });
    assert.equal(tr.brandwaende.length, 2);
    assert.equal(tr.tueren.length, 2);
    assert.ok(tr.tueren.every((t) => t.typ === "T30-RS"));
    assert.ok(tr.tueren.every((t, i) => t.wand === tr.brandwaende[i]), "jede Tür sitzt in einer Brandwand");
    // Brandwände = die beiden kurzen Querkanten am Flur (je 1,8 m lang).
    for (const i of tr.brandwaende) {
      const a = tr.points[i], b = tr.points[(i + 1) % tr.points.length];
      assert.ok(Math.abs(Math.hypot(b.x - a.x, b.z - a.z) - 1.8) < 1e-6, `Brandwand ${i} 1,8 m`);
    }
  });

  it("Erweiterung nennt die Rechtsgrundlage: feuerbeständige Wände, T30-RS, keine Nutzung (MBO §35 Abs. 4–6 [CITED]), zweiter Treppenraum sauberer", () => {
    const h = lang({ treppenraumErweiterung_m: 2 }).hinweise.find((x) => /^Treppenraum-Erweiterung/.test(x));
    assert.ok(h, "Hinweis vorhanden");
    assert.match(h, /MBO §35 Abs\. 4–6 \[CITED\]/);
    assert.match(h, /T30-RS/);
    assert.match(h, /zweite Treppenraum/);
  });

  it("Erweiterung 2 m verkürzt die Messung: Gewinn = E + halbe Treppenlänge (≈ 1,3 m), also zwischen 2 und 3,5 m für jede WE außerhalb der Erweiterung", () => {
    const ohne = lang({ treppenraumErweiterung_m: 0 }), mit = lang({ treppenraumErweiterung_m: 2 });
    assert.equal(ohne.weListe.length, mit.weListe.length);
    let geprueft = 0;
    ohne.weListe.forEach((w, i) => {
      const gewinn = w.rettungsweg_m - mit.weListe[i].rettungsweg_m;
      if (mit.weListe[i].rettungsweg_flur_m === 0) return; // door inside the enclosure: other rule
      assert.ok(gewinn >= 2 - 0.05 && gewinn <= 3.5, `${w.we}: Gewinn ${gewinn.toFixed(1)} m`);
      geprueft += 1;
    });
    assert.ok(geprueft >= 6, `nur ${geprueft} WE geprüft`);
  });

  it("Messung endet an der neuen Tür: die letzte Stelle des Pfades liegt 5 cm vor der Erweiterung (Flurachse), nicht an der Treppenmitte", () => {
    const r = lang({ treppenraumErweiterung_m: 2 });
    const tr = kern(r)[0];
    const xs = tr.points.map((p) => p.x);
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    for (const w of r.weListe) {
      if (w.rettungsweg_flur_m === 0) continue;
      const ende = w.rettungsweg_pfad[w.rettungsweg_pfad.length - 1];
      const anWestTuer = Math.abs(ende.x - (x0 - 0.05)) < 0.02, anOstTuer = Math.abs(ende.x - (x1 + 0.05)) < 0.02;
      assert.ok(anWestTuer || anOstTuer, `${w.we}: Pfadende x = ${ende.x}`);
    }
  });

  it("Warn verschwindet, wenn die Erweiterung reicht: 70 m lang → ohne Erweiterung warn (> 35 m), mit 6 m je Seite keiner mehr", () => {
    const ohne = lang({});
    assert.ok(maxLauf(ohne) > RETTUNGSWEG_MAX);
    assert.ok(ohne.rettungswegWarnungen.length > 0);
    assert.ok(ohne.rettungswegWarnungen.every((w) => w.stufe === "warn" && /Treppenraum-Erweiterung um/.test(w.text)));
    const mit = lang({ treppenraumErweiterung_m: 6 });
    assert.ok(maxLauf(mit) <= RETTUNGSWEG_MAX, `${maxLauf(mit)} m`);
    assert.equal(mit.rettungswegWarnungen.length, 0);
  });

  it("reicht auch 6 m nicht (100 m lang), nennt die Meldung den zweiten Treppenraum statt einer sinnlosen Erweiterung", () => {
    const fp = [{ x: -50, z: -8 }, { x: 50, z: -8 }, { x: 50, z: 8 }, { x: -50, z: 8 }];
    const r = tesseliere({ footprintM: fp, storeys: 1, typ: "mfh", einheiten: STD, raumzonen: true, regeln: { rettungsweg: true, treppenraum: true, aufzug: false, treppenraumErweiterung_m: 6 } });
    const w = r.rettungswegWarnungen.find((x) => x.vorschlag_m + 6 > TREPPENRAUM.erweiterungMax_m);
    assert.ok(w, "eine WE ist auch mit 6 m zu weit");
    assert.match(w.text, /zweiten Treppenraum vorsehen — eine Treppenraum-Erweiterung bis 6 m je Seite reicht nicht/);
  });

  it("Erweiterung bei Spänner: Hinweis „nicht anwendbar“, Zonen wie ohne Erweiterung", () => {
    const sp = (e) => tesseliere({ footprintM: FP40, storeys: 1, typ: "spaenner", einheiten: REF, raumzonen: true, regeln: { treppenraum: true, aufzug: false, treppenraumErweiterung_m: e } });
    assert.ok(sp(3).hinweise.some((h) => /Treppenraum-Erweiterung ohne Flur \(spaenner\) nicht anwendbar/.test(h)));
    assert.equal(JSON.stringify(sp(3).zonen), JSON.stringify(sp(0).zonen));
  });
});
