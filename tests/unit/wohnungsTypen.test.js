// Unit-Tests für packages/nova-designer/src/lib/wohnungsTypen.js (Phase 61-02).
//
// Quelle der Erwartungswerte: HANDGERECHNETE Referenzen (Rechenweg im
// Kommentar) + 61-02-PLAN.md Behavior-Blöcke. Konstanten-Quellen-Status:
// CITED (MBO §47, WoFlV §4) vs. [ASSUMED] wie in der Lib dokumentiert.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  WERKSTATT_TYPEN, validiereTyp,
  RAUMHOEHE_MIN, BELICHTUNG_ANTEIL, ABSTELL_MIN_M2,
  BALKON_ANRECHNUNG_DEFAULT, BALKON_ANRECHNUNG_MAX, DACHSCHRAEGE,
  KONSTRUKTIONS_AUFBAU, bewohnbarkeitChecks, woflvFlaeche, mfgFlaeche,
  belichtungJeWE, weGruppen,
} from "@designer/lib/wohnungsTypen";

describe("wohnungsTypen.js — Konstanten mit Quellen-Status", () => {
  it("CITED-Konstanten: Belichtung 1/8, Balkon 25 %/max 50 %, Dachschrägen 0/0,5/1", () => {
    assert.equal(BELICHTUNG_ANTEIL, 1 / 8);
    assert.equal(BALKON_ANRECHNUNG_DEFAULT, 0.25);
    assert.equal(BALKON_ANRECHNUNG_MAX, 0.5);
    assert.deepEqual(DACHSCHRAEGE, { unter1m: 0, m1bis2: 0.5, ab2m: 1 });
  });

  it("[ASSUMED]-Konstanten: Raumhöhe 2,40 m, Abstellraum-Richtwert 4 m²", () => {
    assert.equal(RAUMHOEHE_MIN, 2.4);
    assert.equal(ABSTELL_MIN_M2, 4);
  });
});

describe("wohnungsTypen.js — WERKSTATT_TYPEN (volles Spektrum)", () => {
  const referenzmix = WERKSTATT_TYPEN.filter((t) => t.gruppe === "referenz");
  const standard = WERKSTATT_TYPEN.filter((t) => t.gruppe === "standard");

  it("zwei Preset-Gruppen: referenzmix (6 Typen) + standard (5 Wohn + 1 Gewerbe)", () => {
    // Gruppe "referenzmix" = REALER Referenzmix-Mix: 2Zi/2P, 3Zi/3P, 4Zi/4P, 4Zi/5P,
    // 5Zi/7P, 5Zi/5P-WG — 6 Typen, alle mit Balkon.
    assert.equal(referenzmix.length, 6);
    assert.ok(referenzmix.every((t) => t.nutzung === "wohnen"));
    assert.ok(referenzmix.every((t) => t.balkon?.anzahl === 1));
    assert.deepEqual(referenzmix.map((t) => t.flaeche_m2), [54, 74, 90, 98, 128, 250]);
    // Quellen-Spannen exakt (2Zi 53–55, 3Zi 73–75):
    assert.equal(referenzmix[0].min_m2, 53);
    assert.equal(referenzmix[0].max_m2, 55);
    assert.equal(referenzmix[1].min_m2, 73);
    assert.equal(referenzmix[1].max_m2, 75);

    // Gruppe "standard" = 1–5 Zimmer [ASSUMED]-Richtwerte + 1 Gewerbe-Typ.
    assert.equal(standard.length, 6);
    const wohn = standard.filter((t) => t.nutzung === "wohnen");
    const gew = standard.filter((t) => t.nutzung === "gewerbe");
    assert.equal(wohn.length, 5);
    assert.equal(gew.length, 1);
    assert.deepEqual(wohn.map((t) => t.zimmer), [1, 2, 3, 4, 5]);
    // Flächenbänder laut Behavior:
    assert.deepEqual(wohn.map((t) => [t.flaeche_m2, t.min_m2, t.max_m2]), [
      [35, 25, 45], [55, 45, 65], [75, 65, 85], [97, 85, 110], [125, 110, 140],
    ]);
  });

  it("1-Zimmer-Apartment-Sonderregeln: Kochnische statt Küche, Duschbad, kombinierter Wohn-/Schlafraum mit Fensterpflicht", () => {
    const t1 = standard.find((t) => t.zimmer === 1);
    assert.ok(t1.raumprogramm.some((r) => r.kochnische === true && r.art === "kueche"));
    assert.ok(t1.raumprogramm.some((r) => /Duschbad/.test(r.raum) && r.art === "sanitaer"));
    const wohn = t1.raumprogramm.find((r) => r.art === "aufenthalt");
    assert.equal(wohn.fensterpflicht, true);
  });

  it("Gewerbe-Typ: WC im Programm, raumartSchall buero, keine Balkon-/WoFlV-Felder", () => {
    const g = standard.find((t) => t.nutzung === "gewerbe");
    assert.ok(g.raumprogramm.some((r) => r.art === "sanitaer"));
    assert.equal(g.raumartSchall, "buero");
    assert.equal(g.balkon, undefined);
  });

  it("alle Wohn-Presets sind vollständig (validiereTyp ohne warn)", () => {
    for (const t of [...referenzmix, ...standard]) {
      const v = validiereTyp(t);
      assert.equal(v.warns, 0, `${t.name}: ${JSON.stringify(v.checks.filter((c) => c.status === "warn"))}`);
      assert.equal(v.ok, true);
    }
  });

  it("Zimmerzahl je Referenzmix-Typ (2/3/4/4/5/5) und WG-Sonderform mit Gemeinschaftsräumen", () => {
    assert.deepEqual(referenzmix.map((t) => t.zimmer), [2, 3, 4, 4, 5, 5]);
    const wg = referenzmix.find((t) => /WG/.test(t.name));
    assert.ok(wg.raumprogramm.filter((r) => r.art === "aufenthalt").length >= 5);
    assert.ok(wg.raumprogramm.some((r) => /Gemeinschaft/.test(r.raum)));
  });
});

describe("wohnungsTypen.js — validiereTyp", () => {
  const komplett = WERKSTATT_TYPEN.find((t) => t.key === "st-2zi");

  it("vollständiger Wohn-Typ → ok: true, keine warns", () => {
    const v = validiereTyp(komplett);
    assert.equal(v.ok, true);
    assert.equal(v.warns, 0);
  });

  it("Wohn-Typ OHNE Abstellraum → warn (nicht fail) mit [ASSUMED]-Richtwert", () => {
    const typ = {
      ...komplett,
      raumprogramm: komplett.raumprogramm.filter((r) => r.art !== "abstell"),
    };
    const v = validiereTyp(typ);
    assert.equal(v.ok, false);
    const w = v.checks.find((c) => c.key === "abstell");
    assert.equal(w.status, "warn");
    assert.ok(/ASSUMED/.test(w.detail));
  });

  it("Aufenthaltsraum ohne Fensterpflicht → warn „Fensterbedarf\"", () => {
    const typ = {
      ...komplett,
      raumprogramm: komplett.raumprogramm.map((r) =>
        r.art === "aufenthalt" ? { ...r, fensterpflicht: false } : r),
    };
    const v = validiereTyp(typ);
    const w = v.checks.find((c) => c.key === "fenster");
    assert.equal(w.status, "warn");
  });

  it("min > max → wird normalisiert (geclampt) + warn, wirft nie", () => {
    // Rechenweg: { flaeche 60, min 70, max 50 } → Tausch → min 50, max 70,
    // flaeche clamp(60, 50..70) = 60. Ein warn "korridor", kein Wurf.
    const v = validiereTyp({ nutzung: "wohnen", flaeche_m2: 60, min_m2: 70, max_m2: 50, raumprogramm: [] });
    assert.equal(v.min_m2, 50);
    assert.equal(v.max_m2, 70);
    assert.equal(v.flaeche_m2, 60);
    assert.ok(v.checks.some((c) => c.key === "korridor" && c.status === "warn"));
  });

  it("Gewerbe-Typ MIT Balkon-/WoFlV-Feldern → Felder ignoriert + MF/G-Hinweis", () => {
    const g = WERKSTATT_TYPEN.find((t) => t.nutzung === "gewerbe");
    const v = validiereTyp({ ...g, balkon: { anzahl: 1, m2: 8 } });
    const w = v.checks.find((c) => c.key === "gewerbe_woflv");
    assert.equal(w.status, "warn");
    assert.ok(/MF\/G/.test(w.detail));
  });

  it("Gewerbe-Typ OHNE WC → warn; mit WC → pass", () => {
    const g = WERKSTATT_TYPEN.find((t) => t.nutzung === "gewerbe");
    const ohneWC = { ...g, raumprogramm: g.raumprogramm.filter((r) => r.art !== "sanitaer") };
    assert.equal(validiereTyp(ohneWC).checks.find((c) => c.key === "wc").status, "warn");
    assert.equal(validiereTyp(g).checks.find((c) => c.key === "wc").status, "pass");
  });

  it("NaN/negative Flächen → keine NaN im Ergebnis", () => {
    const v = validiereTyp({ nutzung: "wohnen", flaeche_m2: "abc", min_m2: -5, max_m2: NaN, raumprogramm: [] });
    assert.ok(Number.isFinite(v.flaeche_m2));
    assert.ok(Number.isFinite(v.min_m2));
    assert.ok(Number.isFinite(v.max_m2));
    assert.ok(v.min_m2 <= v.max_m2);
  });
});

// Basis-Räume für bewohnbarkeitChecks: Wohnen 20 m² + Bad 6 m² + Abstell 5 m².
const BASIS_RAEUME = [
  { name: "Wohnen", art: "aufenthalt", flaeche_m2: 20, fensterpflicht: true },
  { name: "Bad", art: "sanitaer", flaeche_m2: 6, fensterpflicht: false },
  { name: "Abstellraum", art: "abstell", flaeche_m2: 5, fensterpflicht: false },
];

describe("wohnungsTypen.js — bewohnbarkeitChecks (nur pass/warn/offen)", () => {
  it("Belichtung 1/8 (CITED MBO §47): 20 m² Raum, 2,6 m² Fenster → pass; 2,4 → warn", () => {
    // Rechenweg: Bedarf = 20/8 = 2,5 m². 2,6 ≥ 2,5 → pass; 2,4 < 2,5 → warn.
    const raeume = BASIS_RAEUME.map((r) => r.art === "aufenthalt"
      ? { ...r, fensterflaecheM2: 2.6 } : r);
    const c1 = bewohnbarkeitChecks({ raeume });
    assert.equal(c1.checks.find((c) => c.key === "belichtung_1_Wohnen").status, "pass");
    const raeume2 = BASIS_RAEUME.map((r) => r.art === "aufenthalt"
      ? { ...r, fensterflaecheM2: 2.4 } : r);
    const c2 = bewohnbarkeitChecks({ raeume: raeume2 });
    assert.equal(c2.checks.find((c) => c.key === "belichtung_1_Wohnen").status, "warn");
  });

  it("Belichtung: fensterflaecheM2 undefined → offen (nicht warn)", () => {
    const c = bewohnbarkeitChecks({ raeume: BASIS_RAEUME });
    assert.equal(c.checks.find((c2) => c2.key === "belichtung_1_Wohnen").status, "offen");
  });

  it("Raumhöhe: storeyHeight 2,8 → lichte 2,45 ≥ 2,40 pass; 2,6 → warn", () => {
    // Rechenweg: 2,8 − 0,35 [ASSUMED] = 2,45 ≥ 2,40 → pass.
    //             2,6 − 0,35 = 2,25 < 2,40 → warn.
    assert.equal(KONSTRUKTIONS_AUFBAU, 0.35);
    const c1 = bewohnbarkeitChecks({ raeume: BASIS_RAEUME, storeyHeight: 2.8 });
    assert.equal(c1.checks.find((c) => c.key === "hoehe").status, "pass");
    const c2 = bewohnbarkeitChecks({ raeume: BASIS_RAEUME, storeyHeight: 2.6 });
    assert.equal(c2.checks.find((c) => c.key === "hoehe").status, "warn");
  });

  it("2. Rettungsweg (fire.js): level 1/3,0 m → Brüstung 3,9 m ≤ 8 → pass", () => {
    // Rechenweg: Brüstung ≈ 1 · 3 + 0,9 = 3,9 m ≤ ANLEITER_TRAGBAR (8) → pass.
    const c = bewohnbarkeitChecks({ raeume: BASIS_RAEUME, storeyHeight: 3, level: 1 });
    assert.equal(c.checks.find((x) => x.key === "rettung2").status, "pass");
  });

  it("2. Rettungsweg ohne Angabe: level 8 → OFFEN, nicht grün und nicht warn", () => {
    // Rechenweg: Brüstung ≈ 8 · 3 + 0,9 = 24,9 m > ANLEITER_TRAGBAR (8).
    // Vorher unterstellte der Code hier stillschweigend eine Drehleiter. Ob eine
    // aufstellbar ist, weiss aber niemand — also "offen" (M-16 der externen
    // Review). Grün wäre eine Behauptung, warn ein Vorwurf.
    const c = bewohnbarkeitChecks({ raeume: BASIS_RAEUME, storeyHeight: 3, level: 8 });
    const r = c.checks.find((x) => x.key === "rettung2");
    assert.equal(r.status, "offen", r.detail);
    assert.ok(/nicht angegeben/.test(r.detail));
    // Mit zweitem Treppenraum → pass (Rettungsweg über Treppenraum gesichert).
    const c2 = bewohnbarkeitChecks({ raeume: BASIS_RAEUME, storeyHeight: 3, level: 8, treppenraumOk: true });
    assert.equal(c2.checks.find((x) => x.key === "rettung2").status, "pass");
    // Ausdrücklich Drehleiter benannt und über deren Grenze (23 m) → warn.
    const c3 = bewohnbarkeitChecks({ raeume: BASIS_RAEUME, storeyHeight: 3, level: 8, anleiterArt: "drehleiter" });
    assert.equal(c3.checks.find((x) => x.key === "rettung2").status, "warn");
  });

  it("2. Rettungsweg: anleiterArt \"nein\" heisst baulicher 2. RW → pass (M-01)", () => {
    // fire.js und der BrandschutzPlanner behandeln "nein" als GESICHERT
    // ("nein (baulicher 2. RW)"). Hier ergab derselbe Wert vorher ein warn —
    // ein UI-Wert, zwei gegenteilige Bedeutungen.
    const c = bewohnbarkeitChecks({ raeume: BASIS_RAEUME, storeyHeight: 3, level: 12, anleiterArt: "nein" });
    const r = c.checks.find((x) => x.key === "rettung2");
    assert.equal(r.status, "pass", r.detail);
    assert.ok(/baulicher/.test(r.detail));
  });

  it("Bad/WC innenliegend: lueftung true → pass; keine Angabe → offen + Hinweis", () => {
    // Innenliegend = fensterflaecheM2 0 am Bad.
    const innen = BASIS_RAEUME.map((r) => r.art === "sanitaer" ? { ...r, fensterflaecheM2: 0 } : r);
    const c1 = bewohnbarkeitChecks({ raeume: innen, lueftungBad: true });
    assert.equal(c1.checks.find((x) => x.key === "badlueftung").status, "pass");
    const c2 = bewohnbarkeitChecks({ raeume: innen });
    const b = c2.checks.find((x) => x.key === "badlueftung");
    assert.equal(b.status, "offen");
    assert.ok(/mechanische Lüftung/.test(b.detail));
  });

  it("Zweiter Sanitärraum wird geprüft, nicht nur der erste (H-04)", () => {
    // Vorher: liste.find(...) nahm nur den ersten Sanitärraum. [Bad mit Fenster,
    // Gäste-WC ohne Fenster] meldete "Bad/WC mit Fenster" — das innenliegende WC
    // ohne Lüftung wurde nie bewertet. Betrifft 6 der 12 Katalog-Typen.
    const raeume = [
      { name: "Wohnen", art: "aufenthalt", flaeche_m2: 20, fensterpflicht: true, fensterflaecheM2: 3 },
      { name: "Bad", art: "sanitaer", flaeche_m2: 6, fensterflaecheM2: 1.2 },
      { name: "Gäste-WC", art: "sanitaer", flaeche_m2: 2, fensterflaecheM2: 0 },
      { name: "Abstellraum", art: "abstell", flaeche_m2: 5 },
    ];
    const c = bewohnbarkeitChecks({ raeume, lueftungBad: false });
    const sanitaer = c.checks.filter((x) => x.key.startsWith("badlueftung"));
    assert.equal(sanitaer.length, 2, "je Sanitärraum ein Check");
    assert.equal(sanitaer[0].status, "pass", "Bad mit Fenster");
    assert.equal(sanitaer[1].status, "warn", "innenliegendes WC ohne Lüftung");
    assert.equal(c.status, "warn", "der Mangel schlägt auf den Gesamtstatus durch");
  });

  it("Gleichnamige Räume bekommen verschiedene Keys (M-10)", () => {
    // Zwei Räume "Kind" ergaben zwei Einträge mit identischem Key; ein Consumer
    // mit find(c => c.key === …) sah nur den ersten (pass), der Mangel am zweiten
    // verschwand aus der Anzeige.
    const raeume = [
      { name: "Kind", art: "aufenthalt", flaeche_m2: 16, fensterpflicht: true, fensterflaecheM2: 3 },
      { name: "Kind", art: "aufenthalt", flaeche_m2: 16, fensterpflicht: true, fensterflaecheM2: 0.5 },
    ];
    const c = bewohnbarkeitChecks({ raeume });
    const bel = c.checks.filter((x) => x.key.startsWith("belichtung_"));
    assert.equal(bel.length, 2);
    assert.notEqual(bel[0].key, bel[1].key, "Keys müssen eindeutig sein");
    assert.equal(bel[0].status, "pass");
    assert.equal(bel[1].status, "warn", "der zweite Mangel bleibt sichtbar");
  });

  it("Negative Raumfläche ergibt keinen grünen Check (M-11)", () => {
    // Ohne Null-Klemme: Bedarf = −100/8 = −12,5; 0 ≥ −12,5 → pass, detail
    // "0.0 m² ≥ -12.5 m²". Ein Mangel, der als bestanden erschien.
    const c = bewohnbarkeitChecks({
      raeume: [{ name: "Kaputt", art: "aufenthalt", flaeche_m2: -100, fensterpflicht: true, fensterflaecheM2: 0 }],
    });
    const bel = c.checks.find((x) => x.key.startsWith("belichtung_"));
    assert.equal(bel.status, "pass", "0 m² Bedarf bei geklemmter Fläche → formal erfüllt");
    assert.ok(/≥ 0\.0 m²/.test(bel.detail), `kein negativer Bedarf mehr: ${bel.detail}`);
  });

  it("fensterpflicht: false bekommt gar keinen Belichtungs-Check (M-12)", () => {
    // Plan 61-04 Task 3 fordert das ausdrücklich. Vorher lief der Filter nur über
    // art, ein Hobbyraum ohne Fensterpflicht wurde trotzdem als "offen" gemeldet.
    const c = bewohnbarkeitChecks({
      raeume: [
        { name: "Hobby", art: "aufenthalt", flaeche_m2: 18, fensterpflicht: false },
        { name: "Wohnen", art: "aufenthalt", flaeche_m2: 20, fensterpflicht: true, fensterflaecheM2: 3 },
      ],
    });
    const bel = c.checks.filter((x) => x.key.startsWith("belichtung_"));
    assert.equal(bel.length, 1, "nur der fensterpflichtige Raum");
    assert.ok(/Wohnen/.test(bel[0].label));
  });

  it("Abstellraum fehlt im Slicing-Ergebnis → warn mit Richtwert", () => {
    const ohne = BASIS_RAEUME.filter((r) => r.art !== "abstell");
    const c = bewohnbarkeitChecks({ raeume: ohne });
    const a = c.checks.find((x) => x.key === "abstell");
    assert.equal(a.status, "warn");
    assert.ok(/Richtwert/.test(a.detail));
  });

  it("Wohnungseingang: false → warn; true → pass; undefiniert → offen", () => {
    assert.equal(bewohnbarkeitChecks({ raeume: BASIS_RAEUME, amErschliessungsweg: false }).checks.find((x) => x.key === "eingang").status, "warn");
    assert.equal(bewohnbarkeitChecks({ raeume: BASIS_RAEUME, amErschliessungsweg: true }).checks.find((x) => x.key === "eingang").status, "pass");
    assert.equal(bewohnbarkeitChecks({ raeume: BASIS_RAEUME }).checks.find((x) => x.key === "eingang").status, "offen");
  });

  it("Gesamtstatus = schlechtester Einzelstatus (pass < offen < warn); nie \"fail\"", () => {
    // Alles pass-fähig (Fenster da, Lüftung da, Eingang da) → pass.
    const raeume = BASIS_RAEUME.map((r) => r.art === "aufenthalt"
      ? { ...r, fensterflaecheM2: 3 } : r.art === "sanitaer"
        ? { ...r, fensterflaecheM2: 1 } : r);
    const allePass = bewohnbarkeitChecks({
      raeume, storeyHeight: 3, level: 0, amErschliessungsweg: true, treppenraumOk: true,
    });
    assert.equal(allePass.status, "pass");
    // Ein warn hebt den Gesamtstatus auf warn.
    const mitWarn = bewohnbarkeitChecks({ raeume: BASIS_RAEUME.filter((r) => r.art !== "abstell") });
    assert.equal(mitWarn.status, "warn");
    // Nur offene Punkte → offen.
    const nurOffen = bewohnbarkeitChecks({ raeume: BASIS_RAEUME });
    assert.equal(nurOffen.status, "offen");
    // Der String "fail" existiert nirgends im Rückgabewert.
    const alle = [allePass, mitWarn, nurOffen];
    for (const r of alle) {
      assert.ok(r.status !== "fail");
      for (const c of r.checks) assert.ok(c.status !== "fail");
    }
  });
});

describe("wohnungsTypen.js — woflvFlaeche (CITED WoFlV §4)", () => {
  it("Räume 30+14+10 + Balkon 8 m² (default 25 %) → 54 + 2,0 = 56,0 m²", () => {
    // Rechenweg: 30+14+10 = 54,0; Balkon 8 × 0,25 = 2,0 → 56,0.
    const w = woflvFlaeche({
      raeume: [{ flaeche_m2: 30 }, { flaeche_m2: 14 }, { flaeche_m2: 10 }],
      balkone: [{ m2: 8 }],
    });
    assert.ok(Math.abs(w.wohnflaeche_m2 - 56.0) < 0.01, `war ${w.wohnflaeche_m2}`);
  });

  it("Balkon-anrechnung 0.8 wird auf max 0.5 geclampt → 8 × 0,5 = 4,0", () => {
    // Rechenweg: clamp(0,8, 0, 0,5) = 0,5 → 8 × 0,5 = 4,0 (+ 0 Räume).
    const w = woflvFlaeche({ raeume: [], balkone: [{ m2: 8, anrechnung: 0.8 }] });
    assert.ok(Math.abs(w.wohnflaeche_m2 - 4.0) < 0.01, `war ${w.wohnflaeche_m2}`);
  });

  it("Dachschrägen: 20 m² mit unter1m 4 + 1bis2m 6 → 4×0 + 6×0,5 + 10×1 = 13,0", () => {
    // Rechenweg: unter 1 m: 4 × 0 = 0; 1–2 m: 6 × 0,5 = 3; Rest 20−4−6 = 10 × 1 = 10 → 13,0.
    const w = woflvFlaeche({
      raeume: [{ flaeche_m2: 20, dachschraege: { unter1m_m2: 4, zwischen1und2m_m2: 6 } }],
      balkone: [],
    });
    assert.ok(Math.abs(w.wohnflaeche_m2 - 13.0) < 0.01, `war ${w.wohnflaeche_m2}`);
  });

  it("NaN-Eingaben härten → endliche Fläche", () => {
    const w = woflvFlaeche({ raeume: [{ flaeche_m2: "abc" }], balkone: [{ m2: NaN }] });
    assert.ok(Number.isFinite(w.wohnflaeche_m2));
    assert.equal(w.wohnflaeche_m2, 0);
  });
});

describe("wohnungsTypen.js — mfgFlaeche (Gewerbe, [ASSUMED A4])", () => {
  it("Netto-Summe ohne Balkon/Schrägen-Sonderregeln + [ASSUMED]-Kennzeichnung", () => {
    // Rechenweg: 40 + 25 + 5 = 70,0 — Balkon wird NICHT addiert.
    const m = mfgFlaeche({ raeume: [{ flaeche_m2: 40 }, { flaeche_m2: 25 }, { flaeche_m2: 5 }] });
    assert.ok(Math.abs(m.mfg_m2 - 70.0) < 0.01, `war ${m.mfg_m2}`);
    assert.ok(m.details.some((d) => /ASSUMED/.test(d)));
  });
});

// --- Plan 61-04 Task 3: Belichtungs-Verdrahtung + weGruppen -------------------

describe("wohnungsTypen.js — belichtungJeWE (fensterZuRaeumen-Verdrahtung)", () => {
  // Handkonstruierte Mini-Geometrie: 1 Wand (Nord-Kante x 0..6, z = 0), 1
  // Fenster 1,26 × 2,01 ≈ 2,53 m² auf der Wand, 2 Raum-Zonen — Wohnen (mit
  // Fenster, 20 m²) und Bad (ohne Fenster, we beide "WE 0-1").
  const wand = { a: { x: 0, z: 0 }, b: { x: 6, z: 0 }, level: 0, edge: 0, thickness: 0.3 };
  const fenster = [{ level: 0, edge: 0, u: 3, breite: 1.26, hoehe: 2.01 }];
  const wohnen = {
    we: "WE 0-1", name: "Wohnen (WE 0-1) ·WT", level: 0, art: "aufenthalt",
    fensterpflicht: true, flaeche_m2: 20,
    points: [{ x: 0, z: 0 }, { x: 5, z: 0 }, { x: 5, z: 4 }, { x: 0, z: 4 }],
  };
  const bad = {
    we: "WE 0-1", name: "Bad (WE 0-1) ·WT", level: 0, art: "sanitaer",
    fensterpflicht: false, flaeche_m2: 6,
    points: [{ x: 5, z: 0 }, { x: 6, z: 0 }, { x: 6, z: 4 }, { x: 5, z: 4 }],
  };

  it("Raum 20 m² mit Fenster 1,26×2,01 (≈2,53 m²) → Belichtung pass (2,53 ≥ 2,5)", () => {
    // Rechenweg: Bedarf = 20/8 = 2,5 m²; Fenster 1,26 × 2,01 = 2,5326 ≥ 2,5.
    const r = belichtungJeWE({ zonen: [wohnen, bad], fenster, waende: [wand] });
    assert.equal(r.length, 1, "eine WE (beide Zonen teilen we)");
    const bel = r[0].checks.find((c) => c.key === "belichtung_1_Wohnen (WE 0-1) ·WT");
    assert.ok(bel, `Belichtungs-Check gefunden: ${JSON.stringify(r[0].checks.map((c) => c.key))}`);
    assert.equal(bel.status, "pass", bel.detail);
  });

  it("ohne zugeordnetes Fenster → offen bei fensterpflicht true", () => {
    // Fensterliste leer → fensterZuRaeumen findet keine Zuordnung → offen.
    const r = belichtungJeWE({ zonen: [wohnen, bad], fenster: [], waende: [wand] });
    const bel = r[0].checks.find((c) => c.key === "belichtung_1_Wohnen (WE 0-1) ·WT");
    assert.equal(bel.status, "offen");
  });

  it("Das Geschoss kommt aus der ZONE, nicht aus den Optionen (H-03)", () => {
    // Sicherheitsrelevantester Befund der Phase: belichtungJeWE reichte `level`
    // aus den Optionen durch statt zone.level zu lesen. Ohne explizite Option war
    // level = 0 — eine Wohnung im 5. OG bekam einen grünen 2. Rettungsweg über
    // die tragbare Leiter.
    const obenWohnen = { ...wohnen, level: 5 };
    const obenBad = { ...bad, level: 5 };
    const r = belichtungJeWE({ zonen: [obenWohnen, obenBad], fenster, waende: [wand], storeyHeight: 3 });
    const rw = r[0].checks.find((c) => c.key === "rettung2");
    assert.notEqual(rw.status, "pass", `5. OG darf nicht grün sein: ${rw.detail}`);
    assert.ok(/15\.9 m/.test(rw.detail), `Brüstung aus level 5 gerechnet: ${rw.detail}`);

    // Erdgeschoss bleibt unverändert grün — der Fix verschärft nicht pauschal.
    const unten = belichtungJeWE({ zonen: [wohnen, bad], fenster, waende: [wand], storeyHeight: 3 });
    assert.equal(unten[0].checks.find((c) => c.key === "rettung2").status, "pass");
  });

  it("Mehrgeschossige WE: das HÖCHSTE Geschoss entscheidet (H-03)", () => {
    // Ein Reihenhaus oder eine Maisonette liegt auf mehreren Ebenen. Die
    // Anleiterung entscheidet sich oben, nicht unten.
    const r = belichtungJeWE({
      zonen: [wohnen, { ...bad, level: 4 }],
      fenster, waende: [wand], storeyHeight: 3,
    });
    const rw = r[0].checks.find((c) => c.key === "rettung2");
    assert.ok(/12\.9 m/.test(rw.detail), `Brüstung aus level 4: ${rw.detail}`);
  });

  it("Gruppierung: Räume ohne we (Flur/Kern) erscheinen nicht als WE", () => {
    const flur = {
      name: "Flur 0 ·WT", level: 0, raumart: "flur",
      points: [{ x: 0, z: 4 }, { x: 6, z: 4 }, { x: 6, z: 5 }, { x: 0, z: 5 }],
    };
    const r = belichtungJeWE({ zonen: [wohnen, bad, flur], fenster, waende: [wand] });
    assert.equal(r.length, 1, "Flur ohne we zählt nicht als WE");
    assert.equal(r[0].we, "WE 0-1");
  });

  it("zwei WEs werden getrennt gebündelt", () => {
    const wohnenB = { ...wohnen, we: "WE 0-2", name: "Wohnen (WE 0-2) ·WT",
      points: [{ x: 7, z: 0 }, { x: 12, z: 0 }, { x: 12, z: 4 }, { x: 7, z: 4 }] };
    const r = belichtungJeWE({ zonen: [wohnen, bad, wohnenB], fenster: [], waende: [] });
    assert.equal(r.length, 2);
    assert.deepEqual(r.map((x) => x.we).sort(), ["WE 0-1", "WE 0-2"]);
  });
});

describe("wohnungsTypen.js — weGruppen (WE-Zählhelfer)", () => {
  it("zählt WEs statt Zonen: werkstatt über we-Feld, schnellmodus über ·W-Marker", () => {
    // 2 Werkstatt-WEs à 3 Raum-Zonen + 1 Schnellmodus-Zone + 2 manuelle Zonen
    // → { werkstatt: 2, schnellmodus: 1 } — manuelle Zonen zählen nicht.
    const zs = [
      { we: "WE 0-1", name: "Wohnen (WE 0-1) ·WT", level: 0 },
      { we: "WE 0-1", name: "Bad (WE 0-1) ·WT", level: 0 },
      { we: "WE 0-1", name: "Flur (WE 0-1) ·WT", level: 0 },
      { we: "WE 0-2", name: "Wohnen (WE 0-2) ·WT", level: 0 },
      { we: "WE 0-2", name: "Bad (WE 0-2) ·WT", level: 0 },
      { we: "WE 0-2", name: "Flur (WE 0-2) ·WT", level: 0 },
      { name: "Typ A 0-1 ·W", level: 0 },
      { name: "Manuelle Zone", level: 0 },
      { name: "Andere Manuelle", level: 0 },
    ];
    assert.deepEqual(weGruppen(zs), { werkstatt: 2, schnellmodus: 1 });
  });

  it("leere Eingabe → beide null", () => {
    assert.deepEqual(weGruppen([]), { werkstatt: 0, schnellmodus: 0 });
    assert.deepEqual(weGruppen(null), { werkstatt: 0, schnellmodus: 0 });
  });
});
