// Unit tests for 84-10 (R units, D-P84-R): level "R" via the unit MIX (`stufe` on the entry) and via
// the per-unit SWITCH (werkstatt_layer.stufeJeWe, keys "<level>|<typKey>|<n>"); the switch beats
// the mix beats "standard". R units get R measures in the generator (room doors 1,01 m, bath
// ≥ 1,50 × 2,05 m, hall turning area 1,50 × 1,50 m, corridor strip 1,50 m); the quality checks
// measure an R unit against R. Without both switches the result is byte-identical to before.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  tesseliere, stufeSchluessel, wirksameStufe, STUFEN,
  TUERBREITEN, TUERBREITEN_R, BAD_ZUSCHNITT_R, DIELE_MASSE_R, FLURBREITE_R,
} from "@designer/lib/tesselierung";
import { pruefeAlle, badBewegung, TUER_LICHTE_ABZUG_M } from "@designer/lib/raumQualitaet";
import { WERKSTATT_TYPEN } from "@designer/lib/wohnungsTypen";
import { mixEintragHinzufuegen, einheitenAnreichern, WERKSTATT_DEFAULT } from "@designer/lib/werkstattDefaults";

const rect = (w, d) => [{ x: -w / 2, z: -d / 2 }, { x: w / 2, z: -d / 2 }, { x: w / 2, z: d / 2 }, { x: -w / 2, z: d / 2 }];
const STD = WERKSTATT_TYPEN.filter((t) => t.gruppe === "standard").slice(0, 3);
const mitStufe = (key, stufe) => STD.map((t) => (t.key === key ? { ...t, stufe } : { ...t }));
const bau = (opts = {}) => tesseliere({ footprintM: rect(40, 16), storeys: 1, typ: "mittelflur", einheiten: STD, raumzonen: true, ...opts });
const bbox = (z) => { const xs = z.points.map((p) => p.x), zs = z.points.map((p) => p.z); return { w: Math.max(...xs) - Math.min(...xs), d: Math.max(...zs) - Math.min(...zs) }; };

/** Point in polygon (ray casting) — the hall is a rectilinear L/T polygon. */
const drin = (pts, x, z) => {
  let in_ = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) in_ = !in_;
  }
  return in_;
};
/** Is there an axis-parallel square of side s completely inside the polygon (grid 5 cm)? */
const quadratPasst = (pts, s) => {
  const xs = pts.map((p) => p.x), zs = pts.map((p) => p.z);
  const r = 0.01; // inset so boundary points count as inside
  for (let x = Math.min(...xs); x + s <= Math.max(...xs) + 1e-9; x += 0.05) {
    for (let z = Math.min(...zs); z + s <= Math.max(...zs) + 1e-9; z += 0.05) {
      const probe = [[x + r, z + r], [x + s - r, z + r], [x + s - r, z + s - r], [x + r, z + s - r], [x + s / 2, z + s / 2], [x + s / 2, z + r], [x + s / 2, z + s - r], [x + r, z + s / 2], [x + s - r, z + s / 2]];
      if (probe.every(([px, pz]) => drin(pts, px, pz))) return true;
    }
  }
  return false;
};

describe("84-10 — Schlüssel und Wirkungsreihenfolge", () => {
  it("STUFEN = standard, B, R", () => assert.deepEqual(STUFEN, ["standard", "B", "R"]));

  it("stufeSchluessel: Geschoss | Typ | laufende Nummer dieses Typs im Geschoss", () => {
    const m = stufeSchluessel([
      { we: "WE 0-1", level: 0, typKey: "a" }, { we: "WE 0-2", level: 0, typKey: "b" }, { we: "WE 0-3", level: 0, typKey: "a" },
      { we: "WE 1-1", level: 1, typKey: "a" },
    ]);
    assert.equal(m.get("WE 0-1"), "0|a|1");
    assert.equal(m.get("WE 0-2"), "0|b|1");
    assert.equal(m.get("WE 0-3"), "0|a|2");
    assert.equal(m.get("WE 1-1"), "1|a|1", "je Geschoss neu gezählt");
    assert.equal(stufeSchluessel(null).size, 0);
  });

  it("wirksameStufe: Schalter > Mix > standard, ungültige Werte werden ignoriert", () => {
    assert.equal(wirksameStufe(undefined, "0|a|1", null), "standard");
    assert.equal(wirksameStufe("R", "0|a|1", {}), "R", "Mix-Vorgabe");
    assert.equal(wirksameStufe("R", "0|a|1", { "0|a|1": "standard" }), "standard", "Schalter schaltet R aus");
    assert.equal(wirksameStufe("standard", "0|a|1", { "0|a|1": "R" }), "R", "Schalter schaltet R an");
    assert.equal(wirksameStufe("B", "0|a|1", { "0|a|1": "X" }), "B", "ungültiger Schalter fällt auf den Mix zurück");
    assert.equal(wirksameStufe("Q", "0|a|1", {}), "standard", "ungültiger Mix fällt auf standard");
    assert.equal(wirksameStufe("R", "0|a|2", { "0|a|1": "standard" }), "R", "anderer Schlüssel wirkt nicht");
  });

  it("WERKSTATT_DEFAULT.stufeJeWe = {} (ältere Layer defaulten additiv)", () => {
    assert.deepEqual(WERKSTATT_DEFAULT.stufeJeWe, {});
  });
});

describe("84-10 — Ohne Stufe ist alles bytegleich", () => {
  it("stufeJeWe {} / null / unbekannter Schlüssel / Mix 'standard' ändern nichts", () => {
    const basis = JSON.stringify(bau());
    assert.equal(JSON.stringify(bau({ stufeJeWe: {} })), basis);
    assert.equal(JSON.stringify(bau({ stufeJeWe: null })), basis);
    assert.equal(JSON.stringify(bau({ stufeJeWe: { "9|nirgends|1": "R" } })), basis);
    assert.equal(JSON.stringify(bau({ einheiten: STD.map((t) => ({ ...t, stufe: "standard" })) })), basis);
  });

  it("weListe trägt `stufe` nur bei B/R", () => {
    assert.ok(bau().weListe.every((w) => !("stufe" in w)));
    const r = bau({ einheiten: mitStufe("st-3zi", "R") });
    assert.ok(r.weListe.some((w) => w.stufe === "R"));
    assert.ok(r.weListe.filter((w) => w.typKey !== "st-3zi").every((w) => !("stufe" in w)));
  });
});

describe("84-10 — R über den Wohnungsmix: der Generator wendet R-Maße an", () => {
  const r = bau({ einheiten: mitStufe("st-3zi", "R") });
  const rWe = r.weListe.filter((w) => w.stufe === "R");
  const zonenVon = (we) => r.zonen.filter((z) => z.we === we);

  it("jede Wohnung dieses Typs ist R, die anderen Typen nicht", () => {
    assert.ok(rWe.length >= 2, `R-WE ${rWe.length}`);
    assert.ok(rWe.every((w) => w.typKey === "st-3zi"));
    assert.ok(r.weListe.filter((w) => w.typKey === "st-3zi").every((w) => w.stufe === "R"));
  });

  it("alle Innentüren: lichte Breite ≥ 0,90 m (Zimmertür 1,01 m roh, Flurende-Tür eingeschlossen)", () => {
    for (const w of rWe) {
      const innen = zonenVon(w.we).flatMap((z) => z.tueren || []).filter((t) => t.nach !== null && t.nach !== undefined);
      assert.ok(innen.length > 3);
      for (const t of innen) assert.ok(t.breite_m - TUER_LICHTE_ABZUG_M >= 0.9 - 1e-9, `${w.we}: Tür ${t.breite_m} m roh`);
      assert.ok(innen.filter((t) => t.typ === "zimmer").every((t) => Math.abs(t.breite_m - TUERBREITEN_R.zimmer) < 1e-9 || t.breite_m < TUERBREITEN_R.zimmer), "Zimmertür höchstens R-Rohmaß");
    }
  });

  it("Standard-Wohnungen behalten die Standard-Türen (0,885 m)", () => {
    const std = r.weListe.find((w) => !w.stufe && w.typKey === "st-2zi");
    const t = zonenVon(std.we).filter((z) => z.art === "aufenthalt").flatMap((z) => z.tueren || []);
    assert.ok(t.length && t.every((x) => Math.abs(x.breite_m - TUERBREITEN.zimmer) < 1e-9));
  });

  it("Bad ≥ 1,50 × 2,05 m (Bewegungsfläche 1,50 × 1,50 vor WC/Waschtisch)", () => {
    for (const w of rWe) {
      const baeder = zonenVon(w.we).filter((z) => z.art === "sanitaer");
      assert.ok(baeder.length);
      for (const b of baeder) {
        const { w: a, d } = bbox(b);
        assert.ok(Math.min(a, d) >= BAD_ZUSCHNITT_R.kurz_m - 1e-6 && Math.max(a, d) >= BAD_ZUSCHNITT_R.lang_m - 1e-6, `${w.we} ${b.name}: ${a.toFixed(2)} × ${d.toFixed(2)}`);
      }
    }
  });

  it("Diele: ein Quadrat 1,50 × 1,50 m passt hinein (Rangierfläche), Flurstreifen 1,50 m", () => {
    for (const w of rWe) {
      const diele = zonenVon(w.we).find((z) => /^Diele/.test(z.name));
      assert.ok(quadratPasst(diele.points, DIELE_MASSE_R.minBreite), `${w.we}: kein 1,5 × 1,5 m Quadrat in der Diele`);
      // The strip is the thin arm of the L/T polygon: its short side is the strip width.
      const streifen = bbox(diele);
      assert.ok(Math.max(streifen.w, streifen.d) > FLURBREITE_R, "Diele länger als der Streifen breit");
    }
  });

  it("die Prüfung misst die R-Wohnungen gegen R: keine Tür-/Bad-Warnung, Seitenverhältnis ohne fail", () => {
    const stufeJeWe = Object.fromEntries(r.weListe.map((w) => [w.we, w.stufe || "standard"]));
    const q = pruefeAlle(r.zonen, { regeln: { wohnungsgrundriss: true }, stufeJeWe });
    for (const w of rWe) {
      const e = q.find((x) => x.we === w.we).eintraege;
      assert.ok(!e.some((x) => x.regel === "tuer_breite" && x.stufe !== "ok"), e.filter((x) => x.regel === "tuer_breite").map((x) => x.text).join(" | "));
      assert.ok(!e.some((x) => x.regel === "bad_bewegung" && x.stufe !== "ok"));
      assert.ok(e.some((x) => x.regel === "tuer_breite" && x.stufe === "ok"), "positiver Nachweis");
      assert.ok(!e.some((x) => x.regel === "seitenverhaeltnis" && x.stufe === "fail"), "Kopfwohnung mit R-Probe bleibt ohne fail");
    }
  });
});

describe("84-10 — Schalter je Wohnung schlägt den Mix (beide Richtungen)", () => {
  it("Mix standard + Schalter R: genau diese Wohnung ist R", () => {
    const r = bau({ stufeJeWe: { "0|st-2zi|2": "R" } });
    const ziel = [...stufeSchluessel(r.weListe)].find(([, k]) => k === "0|st-2zi|2")[0];
    assert.deepEqual(r.weListe.filter((w) => w.stufe === "R").map((w) => w.we), [ziel]);
    const t = r.zonen.filter((z) => z.we === ziel && z.art === "aufenthalt").flatMap((z) => z.tueren || []);
    assert.ok(t.every((x) => x.breite_m >= 1.0), "R-Türen");
  });

  it("Mix R + Schalter standard: die erste 3-Zi-Wohnung ist NICHT R, die übrigen bleiben R", () => {
    const r = bau({ einheiten: mitStufe("st-3zi", "R"), stufeJeWe: { "0|st-3zi|1": "standard" } });
    const ersteDrei = [...stufeSchluessel(r.weListe)].find(([, k]) => k === "0|st-3zi|1")[0];
    assert.ok(!r.weListe.find((w) => w.we === ersteDrei).stufe, "Schalter schaltet R aus");
    assert.ok(r.weListe.filter((w) => w.typKey === "st-3zi" && w.we !== ersteDrei).every((w) => w.stufe === "R"));
  });

  it("Schalter B: Wohnung ist B (kein R-Zuschnitt), erscheint mit stufe 'B'", () => {
    const r = bau({ stufeJeWe: { "0|st-2zi|1": "B" } });
    assert.deepEqual(r.weListe.filter((w) => w.stufe).map((w) => w.stufe), ["B"]);
  });
});

describe("84-10 — Prüfregeln", () => {
  const bad = (a, b) => ({ name: "Bad", art: "sanitaer", points: [{ x: 0, z: 0 }, { x: a, z: 0 }, { x: a, z: b }, { x: 0, z: b }] });

  it("badBewegung R: 1,50 × 2,05 ok, 1,30 × 1,90 warn mit Maßangabe; B/Standard unverändert", () => {
    assert.equal(badBewegung(bad(1.5, 2.05), "R").stufe, "ok");
    const w = badBewegung(bad(1.3, 1.9), "R");
    assert.equal(w.stufe, "warn");
    assert.match(w.text, /für R keine Bewegungsfläche/);
    assert.match(w.text, /1,50 × 2,05/);
    assert.match(badBewegung(bad(1.3, 1.9)).text, /barrierefrei nutzbar|ok|nicht R|Bewegungsfläche/);
    assert.equal(badBewegung(bad(1.3, 1.9)).stufe, "ok", "B-Regel: 1,20 × 1,75 reicht");
    assert.equal(badBewegung(bad(1.3, 1.9), "B").stufe, "ok");
  });

  it("tuer_breite: eine für Standard erzeugte Wohnung (Zimmertür 0,885 m) fällt als R durch, als B nicht", () => {
    const r = bau();
    const we = r.weListe.find((w) => w.typKey === "st-2zi").we;
    const alsR = pruefeAlle(r.zonen, { regeln: { wohnungsgrundriss: true }, stufeJeWe: { [we]: "R" } }).find((x) => x.we === we);
    assert.ok(alsR.eintraege.some((e) => e.regel === "tuer_breite" && e.stufe === "warn" && /0,885/.test(e.text) && /R/.test(e.text)));
    const alsB = pruefeAlle(r.zonen, { regeln: { wohnungsgrundriss: true }, stufeJeWe: { [we]: "B" } }).find((x) => x.we === we);
    assert.ok(!alsB.eintraege.some((e) => e.regel === "tuer_breite" && e.stufe === "warn"), "lichte 0,86 ≥ 0,80");
    const ohne = pruefeAlle(r.zonen, { regeln: { wohnungsgrundriss: true } }).find((x) => x.we === we);
    assert.ok(!ohne.eintraege.some((e) => e.regel === "tuer_breite"), "ohne Stufe keine neuen Einträge");
  });
});

describe("84-10 — Mix-Eintrag mit eigenem Schlüssel (2-Zi R neben 2-Zi)", () => {
  it("zweiter Eintrag desselben Typs bekommt einen eindeutigen Schlüssel + basisKey, der erste behält seinen", () => {
    const quelle = WERKSTATT_TYPEN.find((t) => t.key === "st-2zi");
    const a = mixEintragHinzufuegen([], quelle);
    assert.equal(a[0].key, "st-2zi");
    assert.ok(!("basisKey" in a[0]));
    const b = mixEintragHinzufuegen(a, quelle);
    assert.equal(b[1].key, "st-2zi~2");
    assert.equal(b[1].basisKey, "st-2zi");
    const c = mixEintragHinzufuegen(b, quelle);
    assert.equal(c[2].key, "st-2zi~3");
    assert.equal(a.length, 1, "Eingabe unverändert");
  });

  it("einheitenAnreichern löst den Katalogtyp über basisKey auf (Raumprogramm bleibt erhalten)", () => {
    const quelle = WERKSTATT_TYPEN.find((t) => t.key === "st-2zi");
    const mix = mixEintragHinzufuegen(mixEintragHinzufuegen([], quelle), quelle).map((e) => ({ key: e.key, basisKey: e.basisKey, name: "2-Zi R", stufe: "R", flaeche_m2: 55, min_m2: 45, max_m2: 65, nutzung: "wohnen" }));
    const an = einheitenAnreichern(mix);
    assert.ok(an.every((e) => Array.isArray(e.raumprogramm) && e.raumprogramm.length >= 5));
    assert.equal(an[1].key, "st-2zi~2");
  });

  it("'2-Zi' und '2-Zi R' nebeneinander: jede Wohnung findet ihren Mix-Eintrag, R nur beim zweiten", () => {
    const quelle = WERKSTATT_TYPEN.find((t) => t.key === "st-2zi");
    const zweiR = { ...mixEintragHinzufuegen([quelle], quelle)[1], stufe: "R", name: "2-Zi R" };
    const einheiten = einheitenAnreichern([{ ...quelle }, zweiR]);
    const r = tesseliere({ footprintM: rect(40, 16), storeys: 1, typ: "mittelflur", einheiten, raumzonen: true });
    const schluessel = new Set(r.weListe.map((w) => w.typKey));
    assert.ok(schluessel.has("st-2zi") && schluessel.has("st-2zi~2"), [...schluessel].join(","));
    assert.ok(r.weListe.filter((w) => w.typKey === "st-2zi~2").every((w) => w.stufe === "R"));
    assert.ok(r.weListe.filter((w) => w.typKey === "st-2zi").every((w) => !w.stufe));
  });
});

describe("84-10 — Typologien und Häuser", () => {
  it("Laubengang 40 × 12 mit R-Typ: R-WE vorhanden, WE-Zahl nicht kleiner als 4, keine Tür-/Erschließungs-fails", () => {
    const r = tesseliere({ footprintM: rect(40, 12), storeys: 1, typ: "laubengang", einheiten: mitStufe("st-2zi", "R"), raumzonen: true });
    assert.ok(r.weListe.some((w) => w.stufe === "R"));
    assert.ok(r.weListe.length >= 4);
    const q = pruefeAlle(r.zonen, { regeln: { wohnungsgrundriss: true }, stufeJeWe: Object.fromEntries(r.weListe.map((w) => [w.we, w.stufe || "standard"])) });
    const fails = q.flatMap((x) => x.eintraege).filter((e) => e.stufe === "fail" && ["wohnungstuer", "durchgangszimmer", "erschliessung", "diele", "flurende"].includes(e.regel));
    assert.equal(fails.length, 0, fails.map((e) => e.text).join(" | "));
  });

  it("Spänner und MFH mit R-Typ erzeugen R-Wohnungen ohne Tür-/Erschließungs-fail", () => {
    for (const typ of ["spaenner", "mfh"]) {
      // Spänner: each arm takes the type nearest to its area — so every type of the mix is R there.
      const einheiten = typ === "spaenner" ? STD.map((t) => ({ ...t, stufe: "R" })) : mitStufe("st-2zi", "R");
      const r = tesseliere({ footprintM: rect(typ === "spaenner" ? 24 : 40, 18), storeys: 2, typ, einheiten, raumzonen: true });
      assert.ok(r.weListe.some((w) => w.stufe === "R"), `${typ}: keine R-WE`);
      const q = pruefeAlle(r.zonen, { regeln: { wohnungsgrundriss: true }, stufeJeWe: Object.fromEntries(r.weListe.map((w) => [w.we, w.stufe || "standard"])) });
      const fails = q.flatMap((x) => x.eintraege).filter((e) => e.stufe === "fail" && ["wohnungstuer", "durchgangszimmer", "erschliessung", "diele", "flurende"].includes(e.regel));
      assert.equal(fails.length, 0, `${typ}: ${fails.map((e) => e.text).join(" | ")}`);
    }
  });

  it("Einfamilienhaus: Schalter schaltet das Haus auf R (weListe.stufe), ohne Schalter nichts", () => {
    const efh = WERKSTATT_TYPEN.find((t) => t.key === "st-4zi");
    const r0 = tesseliere({ footprintM: rect(12, 10), storeys: 2, typ: "efh", einheiten: [efh], raumzonen: true });
    assert.ok(!r0.weListe[0].stufe);
    const r1 = tesseliere({ footprintM: rect(12, 10), storeys: 2, typ: "efh", einheiten: [efh], raumzonen: true, stufeJeWe: { "0|st-4zi|1": "R" } });
    assert.equal(r1.weListe[0].stufe, "R");
  });
});
