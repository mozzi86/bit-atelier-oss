// Unit tests for plan 84-11 (packages/nova-designer/src/lib/tesselierung.js tuerVersatz +
// raumQualitaet.js schrankHinterTuer): room doors sit 7 × 12,5 cm = 0,875 m from the
// hinge-side corner (NF-66a, user 10.10.2026 — wardrobe behind the opened leaf), the jamb
// distance is one masonry raster unit 0,125 m (DIN 4172), and the quality rule reports
// the wall piece corner → hinge. Door positions are checked over all 84-05 test cases.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { tesseliere, tuerVersatz, TUER_ANSCHLAG_ABSTAND, TUER_ECKABSTAND_SCHRANK_M, MAUERWERK_RASTER_M, TUERBREITEN } from "@designer/lib/tesselierung";
import { WERKSTATT_TYPEN } from "@designer/lib/wohnungsTypen";
import { schrankHinterTuer, schrankwand, pruefe, pruefeAlle, wohnungsRegeln, SCHRANK_HINTER_TUER_MIN_M } from "@designer/lib/raumQualitaet";
import { kantenVon } from "@designer/lib/wohnungsErschliessung";

const r3 = (v) => Math.round(v * 1000) / 1000;
const B = TUERBREITEN.zimmer; // 0,885 m raw opening
const rect = (w, d) => [{ x: -w / 2, z: -d / 2 }, { x: w / 2, z: -d / 2 }, { x: w / 2, z: d / 2 }, { x: -w / 2, z: d / 2 }];
const STD = WERKSTATT_TYPEN.filter((t) => t.gruppe === "standard").slice(0, 3);
const REF = WERKSTATT_TYPEN.filter((t) => t.gruppe === "referenz").slice(0, 3);
const WR = wohnungsRegeln({ wohnungsgrundriss: true });

describe("84-11 — tuerVersatz (Mauerwerksraster)", () => {
  it("Konstanten: Raster 0,125 m, Zargenabstand = ein Raster, Eckabstand 7 × Raster = 0,875 m", () => {
    assert.equal(MAUERWERK_RASTER_M, 0.125);
    assert.equal(TUER_ANSCHLAG_ABSTAND, 0.125);
    assert.equal(r3(TUER_ECKABSTAND_SCHRANK_M), 0.875);
  });

  it("lange Wand: links → u_m 0,875 (Band am Wandanfang); rechts → Band 0,875 vor dem Wandende", () => {
    assert.equal(tuerVersatz(4, B, "links"), 0.875);
    assert.equal(tuerVersatz(4, B), 0.875, "Default links");
    assert.equal(r3(tuerVersatz(4, B, "rechts")), r3(4 - B - 0.875));
  });

  it("kurze Wand: so weit wie möglich, abgerundet aufs Raster, nie unter dem Zargenabstand", () => {
    // 1,50 − 0,885 − 0,125 = 0,49 → 3 × 0,125 = 0,375
    assert.equal(tuerVersatz(1.5, B, "links"), 0.375);
    assert.equal(r3(tuerVersatz(1.5, B, "rechts")), r3(1.5 - B - 0.375));
    // exactly door + two jambs → both sides 0,125
    assert.equal(tuerVersatz(B + 0.25, B, "links"), 0.125);
    assert.equal(r3(tuerVersatz(B + 0.25, B, "rechts")), 0.125);
    // shorter than door + jambs (the width check runs before): jamb stays, rechts clamps at 0
    assert.equal(tuerVersatz(0.9, B, "links"), 0.125);
    assert.equal(tuerVersatz(0.9, B, "rechts"), 0);
  });

  it("Schwelle: ab Wandlänge 0,885 + 0,875 + 0,125 = 1,885 m die vollen 0,875, knapp darunter 0,75", () => {
    assert.equal(tuerVersatz(1.885, B, "links"), 0.875);
    assert.equal(tuerVersatz(1.88, B, "links"), 0.75);
  });
});

describe("84-11 — Türlagen über alle Typologien (Testfälle 84-05)", () => {
  const FAELLE = [
    ["mittelflur", 40, 16, 2], ["mittelflur", 30, 20, 1], ["mfh", 70, 16, 4], ["mfh", 40, 14, 3],
    ["spaenner", 24, 18, 5], ["spaenner", 24, 14, 1], ["laubengang", 40, 12, 3], ["laubengang", 30, 10, 2],
    ["reihenhaus", 48, 11, 2], ["efh", 12, 10, 2],
  ];
  /** Every room door (typ "zimmer", swinging in) with its edge and hinge-side wall piece. */
  const tueren = [];
  const regel = { ok: 0, warn: 0, fail: 0 };
  let schlafen875 = 0;
  for (const [mix, ALLE] of [["Standard", STD], ["Referenz", REF]]) {
    for (const [typ, w, d, n] of FAELLE) {
      const E = typ === "efh" ? ALLE.slice(2) : ALLE;
      const r = tesseliere({ footprintM: rect(w, d), storeys: n, typ, einheiten: E, raumzonen: true });
      for (const zone of r.zonen) {
        for (const t of zone.tueren || []) {
          if (t.typ !== "zimmer" || t.nachAussen) continue;
          const k = kantenVon(zone).find((e) => e.i === t.wand);
          assert.ok(k, `${mix} ${typ} ${zone.name}: Türkante existiert`);
          const frei = t.aufschlag === "rechts" ? k.laenge - (t.u_m + t.breite_m) : t.u_m;
          tueren.push({ fall: `${mix} ${typ} ${w}×${d}`, zone: zone.name, t, k, frei });
          if (/schlaf/i.test(zone.name) && Math.abs(frei - TUER_ECKABSTAND_SCHRANK_M) < 1e-6) schlafen875 += 1;
        }
      }
      for (const q of pruefeAlle(r.zonen, { regeln: { wohnungsgrundriss: true } })) {
        for (const e of q.eintraege) if (e.regel === "schrank_hinter_tuer") regel[e.stufe] += 1;
      }
    }
  }

  it("kein u_m unter dem Zargenabstand (Toleranz 2 cm wie die Flur-Logik), keine Tür über das Wandende", () => {
    assert.ok(tueren.length > 1000, `Messbasis ${tueren.length} Zimmertüren`);
    const zuNah = tueren.filter((x) => x.t.u_m < TUER_ANSCHLAG_ABSTAND - 0.02 - 1e-6);
    assert.deepEqual(zuNah.map((x) => `${x.fall} ${x.zone} u_m ${r3(x.t.u_m)}`), []);
    const drueber = tueren.filter((x) => x.t.u_m + x.t.breite_m > x.k.laenge + 1e-6);
    assert.deepEqual(drueber.map((x) => `${x.fall} ${x.zone}`), []);
    const bandZuNah = tueren.filter((x) => x.frei < TUER_ANSCHLAG_ABSTAND - 0.02 - 1e-6);
    assert.deepEqual(bandZuNah.map((x) => `${x.fall} ${x.zone} frei ${r3(x.frei)}`), []);
  });

  it("die Mehrheit der Zimmertüren hat das Band genau 0,875 m von der Ecke (Messung 10.10.2026: 817 von 1 332)", () => {
    const ziel = tueren.filter((x) => Math.abs(x.frei - TUER_ECKABSTAND_SCHRANK_M) < 1e-6).length;
    assert.ok(ziel / tueren.length >= 0.5, `${ziel} von ${tueren.length}`);
    assert.ok(schlafen875 >= 100, `Schlafzimmer mit 0,875: ${schlafen875}`);
  });

  it("jede Tür, die nicht bei 0,875 liegt, wurde von der Flur-Logik versetzt oder die Wand ist zu kurz", () => {
    // Not moved and long enough → must be at the target (links) or the far end (rechts).
    const falsch = tueren.filter((x) => {
      const langGenug = x.k.laenge >= x.t.breite_m + TUER_ECKABSTAND_SCHRANK_M + TUER_ANSCHLAG_ABSTAND - 1e-6;
      if (!langGenug || Math.abs(x.frei - TUER_ECKABSTAND_SCHRANK_M) < 1e-6) return false;
      // moved doors sit at the far jamb (0,125 from the other corner) or anywhere in between
      // (nearest free position / end wall) — all of them keep the jamb distance
      return x.frei < TUER_ANSCHLAG_ABSTAND - 0.02 - 1e-6;
    });
    assert.deepEqual(falsch.map((x) => `${x.fall} ${x.zone} frei ${r3(x.frei)}`), []);
  });

  it("Prüfregel schrank_hinter_tuer: kein fail, Warnungen unter 5 % (Messung 10.10.2026: 18 warn / 735 ok)", () => {
    assert.equal(regel.fail, 0);
    assert.ok(regel.ok > 500, `ok ${regel.ok}`);
    assert.ok(regel.warn <= 0.05 * (regel.ok + regel.warn), `warn ${regel.warn} von ${regel.ok + regel.warn}`);
  });

  it("Mittelflur 40 × 16 Standard: ein Schlafzimmer hat die Tür bei u_m 0,875 und die Regel ok", () => {
    const r = tesseliere({ footprintM: rect(40, 16), storeys: 1, typ: "mittelflur", einheiten: STD, raumzonen: true });
    const schlafen = r.zonen.filter((z) => /schlaf/i.test(z.name) && (z.tueren || []).some((t) => t.typ === "zimmer" && t.u_m === 0.875));
    assert.ok(schlafen.length > 0, "Schlafzimmer mit Tür bei 0,875");
    const s = schrankHinterTuer(schlafen[0], WR);
    assert.equal(s?.stufe, "ok");
    assert.equal(s?.wert, 0.875);
  });
});

describe("84-11 — schrankHinterTuer (Prüfregel)", () => {
  const raum = (tueren, extra = {}) => ({ name: "Schlafen", art: "aufenthalt", flaeche_m2: 16, points: [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 4 }, { x: 0, z: 4 }], tueren, ...extra });

  it("Band 0,875 m von der Ecke → ok, wert 0,875, Wand genannt", () => {
    const s = schrankHinterTuer(raum([{ wand: 0, u_m: 0.875, breite_m: B, aufschlag: "links", nach: "Diele" }]), WR);
    assert.equal(s.stufe, "ok");
    assert.equal(s.regel, "schrank_hinter_tuer");
    assert.equal(s.wert, 0.875);
    assert.equal(s.wand, 0);
    assert.match(s.text, /0,88 m Wand bis zur Ecke/);
  });

  it("Band 0,125 m (alte Lage) → warn mit Rat „Anschlag wechseln“ und dem Maß der anderen Seite", () => {
    const s = schrankHinterTuer(raum([{ wand: 0, u_m: 0.125, breite_m: B, aufschlag: "links", nach: "Diele" }]), WR);
    assert.equal(s.stufe, "warn");
    assert.equal(s.wert, 0.125);
    assert.match(s.text, /kein Schrank hinter dem Türflügel/);
    assert.match(s.text, /Anschlag wechseln \(dann 2,99 m\)/);
    assert.match(s.text, /NF-66a/);
  });

  it("rechts: Band bei u_m + breite, die Ecke ist das Wandende", () => {
    const ok = schrankHinterTuer(raum([{ wand: 0, u_m: r3(4 - B - 0.875), breite_m: B, aufschlag: "rechts", nach: "Diele" }]), WR);
    assert.equal(ok.stufe, "ok");
    assert.equal(ok.wert, 0.875);
    const weit = schrankHinterTuer(raum([{ wand: 0, u_m: 0.125, breite_m: B, aufschlag: "rechts", nach: "Diele" }]), WR);
    assert.equal(weit.stufe, "ok", "Band am fernen Ende: 2,99 m Wand hinter dem Flügel");
  });

  it("kurze Wand auf beiden Seiten → Rat „Tür versetzen“", () => {
    const schmal = { name: "Kind", art: "aufenthalt", points: [{ x: 0, z: 0 }, { x: 1.2, z: 0 }, { x: 1.2, z: 4 }, { x: 0, z: 4 }], tueren: [{ wand: 0, u_m: 0.125, breite_m: B, aufschlag: "links", nach: "Diele" }] };
    const s = schrankHinterTuer(schmal, WR);
    assert.equal(s.stufe, "warn");
    assert.match(s.text, /Tür versetzen \(die Wand ist auf beiden Seiten zu kurz\)/);
  });

  it("mehrere Türen: die kürzeste Wandseite zählt", () => {
    const s = schrankHinterTuer(raum([
      { wand: 0, u_m: 0.875, breite_m: B, aufschlag: "links", nach: "Diele" },
      { wand: 1, u_m: 0.25, breite_m: B, aufschlag: "links", nach: "Wohnen" },
    ]), WR);
    assert.equal(s.stufe, "warn");
    assert.equal(s.wand, 1);
    assert.equal(s.wert, 0.25);
  });

  it("null: Tür schlägt nach außen, kein Aufenthaltsraum, keine Tür, Diele-Regel aus", () => {
    assert.equal(schrankHinterTuer(raum([{ wand: 0, u_m: 0.125, breite_m: B, aufschlag: "links", nach: "Diele", nachAussen: true }]), WR), null);
    assert.equal(schrankHinterTuer(raum([{ wand: 0, u_m: 0.125, breite_m: B, aufschlag: "links", nach: "Diele" }], { art: "abstell" }), WR), null);
    assert.equal(schrankHinterTuer(raum([]), WR), null);
    assert.equal(schrankHinterTuer(raum([{ wand: 0, u_m: 0.125, breite_m: B, aufschlag: "links", nach: "Diele" }]), wohnungsRegeln({ diele: false })), null);
    assert.equal(SCHRANK_HINTER_TUER_MIN_M, 0.6);
  });

  it("pruefe() führt die Regel je Raum mit", () => {
    const e = pruefe(raum([{ wand: 0, u_m: 0.875, breite_m: B, aufschlag: "links", nach: "Diele" }]), { regeln: { wohnungsgrundriss: true } });
    assert.ok(e.some((x) => x.regel === "schrank_hinter_tuer" && x.stufe === "ok"));
  });
});

describe("84-11 — Schrankwand (75-14) weicht dem Türschwenk aus", () => {
  // Narrow bedroom 3,0 × 4,2 m: door in edge 0 (z-low wall), window at edge 2; free walls
  // are the two 4,2-m side walls. Centred, the 3-m wardrobe + 0,9 m movement on the far
  // side wall (edge 1, x ∈ [1,5; 3,0]) meets the swing of a door 0,875 m from the corner
  // (x ∈ [0,875; 1,76], z ≤ 0,885) — slid towards the window it does not.
  const schmal = (u_m) => ({
    name: "Schlafen", art: "aufenthalt", flaeche_m2: 12.6, fensterwand: 2,
    points: [{ x: 0, z: 0 }, { x: 3, z: 0 }, { x: 3, z: 4.2 }, { x: 0, z: 4.2 }],
    tueren: [{ wand: 0, u_m, breite_m: B, aufschlag: "links", nach: "Diele" }],
  });
  it("Tür bei 0,875: Schrank rutscht zum Fenster, Regel ok, Rechteck frei vom Schwenk", () => {
    const s = schrankwand(schmal(0.875), {}, WR);
    assert.equal(s.stufe, "ok");
    assert.equal(s.wand, 1);
    assert.ok(s.rect.z0 >= 0.885 - 1e-6, `Schrank beginnt hinter dem Schwenk: z0 ${s.rect.z0}`);
    assert.ok(s.rect.z1 <= 4.2 - 0.1 + 1e-6, "Eckabzug am Fenster bleibt");
  });
  it("Tür bei 0,125 (alte Lage): zentrierter Schrank passt, Rechteck wie vor 84-11", () => {
    const s = schrankwand(schmal(0.125), {}, WR);
    assert.equal(s.stufe, "ok");
    assert.equal(r3(s.rect.z0), 0.6, "zentriert: (4,2 − 3,0) / 2");
  });
  it("keine Position frei: warn nennt „an jeder Stelle der Wand“", () => {
    // Room 3,0 × 3,2 m: the 3-m wardrobe only fits at u0 = 0,1 on a 3,2-m wall — that is
    // inside the swing of the door at 0,875 (z ≤ 0,885 > 0,1) → every position hit.
    const kurz = { ...schmal(0.875), points: [{ x: 0, z: 0 }, { x: 3, z: 0 }, { x: 3, z: 3.2 }, { x: 0, z: 3.2 }], flaeche_m2: 9.6 };
    const s = schrankwand(kurz, {}, WR);
    assert.equal(s.stufe, "warn");
    assert.match(s.text, /an jeder Stelle der Wand/);
  });
});
