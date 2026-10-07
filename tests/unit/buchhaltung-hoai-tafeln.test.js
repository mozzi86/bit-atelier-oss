// Spot-check tests for the eleven HOAI 2021 fee tables of 79-14 (decision
// E-13, "Alle Leistungsbilder müssen rechnen"): structural invariants, a
// drift check against the raw-cells fixture (fängt nachträgliche
// Handänderungen an den generierten Datendateien), and — per table — three
// interpolation samples with LITERAL expected values plus two samples outside
// the table range.
//
// In:  @core/lib/hoai/tafeln/index.js (WEITERE_TAFELN), @core/lib/hoai/honorar.js
//      (honorarAusTafel — the SAME § 13 interpolation the app and 79-02 use),
//      @core/lib/hoai/leistungsbilder.js (tafelStatus, alleLeistungsbilder),
//      fixtures/hoai/rohzellen-2021.json (raw table cells from the fetch
//      script, tests/unit/buchhaltung-hoai.test.js's Stützwert/Orakel pattern
//      for the § 35/§ 40 tables). Out: assertions only.
//
// The expected values in STICHPROBEN below were hand-checked against the
// official rows fetched 2026-09-28 by
// .planning/phases/79-buchhaltung/tmp-e2e/hoai-tafeln-abruf.mjs (their
// literal JS output is in packages/nova-core/src/lib/hoai/tafeln/*.js); the
// arithmetic (unten + anteil*(oben-unten), rounded to the cent like
// honorar.js#rundeCent) is shown in each entry's comment.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { WEITERE_TAFELN } from "@core/lib/hoai/tafeln/index.js";
import { alleLeistungsbilder, tafelStatus } from "@core/lib/hoai/leistungsbilder.js";
import { honorarAusTafel } from "@core/lib/hoai/honorar.js";

const ROHZELLEN = JSON.parse(fs.readFileSync(new URL("./fixtures/hoai/rohzellen-2021.json", import.meta.url), "utf8"));

// § 21 Bebauungsplan: die Zeilen 0,5 ha und 1 ha beginnen beide bei 5.000 €
// (Zone I von) — ein echtes amtliches Mindesthonorar für die kleinsten
// Plangebiete (siehe hoai-tafeln-abruf.mjs), kein Parserfehler. Einziger
// Paragraf, an dem eine Spalte gleich bleiben darf statt zu steigen.
const PLATEAU_ERLAUBT = new Set([21]);

test("WEITERE_TAFELN: elf Tafeln (79-14), Struktur je HoaiTafel", () => {
  assert.equal(WEITERE_TAFELN.length, 11);
  for (const t of WEITERE_TAFELN) {
    assert.equal(t.fassung, "HOAI 2021", t.leistungsbild);
    assert.equal(t.status, "amtlich", t.leistungsbild);
    assert.equal(t.annahme, undefined, t.leistungsbild);
    assert.ok(t.quelle.startsWith(`https://www.gesetze-im-internet.de/hoai_2013/__${t.paragraf}`), `${t.leistungsbild}: quelle ${t.quelle}`);
    assert.match(t.abgerufen_am, /^\d{4}-\d{2}-\d{2}$/, t.leistungsbild);
    assert.ok(["anrechenbare_kosten_euro", "flaeche_ha"].includes(t.bezug), t.leistungsbild);
    assert.equal(t.einheit, t.bezug === "flaeche_ha" ? "ha" : "EUR", t.leistungsbild);
    const breite = t.zonen.length + 1;
    for (const [kosten, werte] of t.zeilen) assert.equal(werte.length, breite, `${t.leistungsbild} ${kosten}`);
    const summeLph = t.lph.reduce((n, l) => n + l.prozent, 0);
    assert.ok(Math.abs(summeLph - 100) < 0.001, `${t.leistungsbild}: LPH-Summe ${summeLph}`);
    assert.equal(tafelStatus(t.leistungsbild), "amtlich", t.leistungsbild);
  }
});

test("WEITERE_TAFELN: streng monoton in der Zeile, in der Spalte nicht fallend", () => {
  for (const t of WEITERE_TAFELN) {
    for (const [kosten, werte] of t.zeilen) {
      for (let i = 1; i < werte.length; i++) assert.ok(werte[i] > werte[i - 1], `${t.leistungsbild} ${kosten}: Position ${i}`);
    }
    for (let r = 1; r < t.zeilen.length; r++) {
      assert.ok(t.zeilen[r][0] > t.zeilen[r - 1][0], `${t.leistungsbild}: Bezugswert Zeile ${r}`);
      for (let s = 0; s < t.zeilen[r][1].length; s++) {
        const vorher = t.zeilen[r - 1][1][s];
        const jetzt = t.zeilen[r][1][s];
        assert.ok(jetzt >= vorher, `${t.leistungsbild}: Spalte ${s} sinkt (Zeile ${r}: ${vorher} → ${jetzt})`);
        if (jetzt === vorher) assert.ok(PLATEAU_ERLAUBT.has(t.paragraf), `${t.leistungsbild}: unerwartetes Plateau Spalte ${s} Zeile ${r}`);
      }
    }
  }
});

test("Rohzellen-Fixture: Kontinuität bis(Zone n)=von(Zone n+1), Zeilen identisch mit den Tafeln (fängt Handänderungen)", () => {
  for (const t of WEITERE_TAFELN) {
    const roh = (ROHZELLEN[String(t.paragraf)] || []).map(Number);
    const zonen = t.zonen.length;
    const breite = 1 + 2 * zonen;
    assert.ok(roh.length > 0 && roh.length % breite === 0, `${t.leistungsbild}: ${roh.length} Rohzellen, Breite ${breite}`);
    const rekonstruiert = [];
    for (let i = 0; i + breite <= roh.length; i += breite) {
      const z = roh.slice(i, i + breite);
      const [kosten, ...grenzen] = z;
      for (let zone = 0; zone < zonen - 1; zone++) {
        assert.equal(grenzen[zone * 2 + 1], grenzen[zone * 2 + 2], `${t.leistungsbild} ${kosten}: bis(Zone ${zone + 1})=von(Zone ${zone + 2})`);
      }
      const kompakt = [grenzen[0]];
      for (let zone = 1; zone < zonen; zone++) kompakt.push(grenzen[zone * 2]);
      kompakt.push(grenzen[grenzen.length - 1]);
      rekonstruiert.push([kosten, kompakt]);
    }
    assert.deepEqual(rekonstruiert, t.zeilen.map(([k, w]) => [k, [...w]]), t.leistungsbild);
  }
});

test("alleLeistungsbilder(): weiterhin 14 Schlüssel, seit 79-14 alle amtlich; ein unbekannter Schlüssel bleibt fehlt", () => {
  const alle = alleLeistungsbilder();
  assert.equal(alle.length, 14);
  for (const l of alle) assert.equal(l.status, "amtlich", l.key);
  assert.equal(tafelStatus("gibtsnicht"), "fehlt");
  assert.equal(honorarAusTafel(1, "I", 0, "gibtsnicht").tafelFehlt, true);
});

/**
 * a) Stützstelle: eine Tafelzeile direkt, Zone I, Basissatz (position 0 %).
 * b) Mitte zwischen zwei Tafelzeilen, mittlere Zone, Basissatz.
 * c) außerhalb der Mitte (Anteil 30 %), höchste Zone, Satzposition 100 % (oberer Wert).
 * d/e) Bezugswert unter der ersten / über der letzten Zeile → ausserhalb: true.
 * (Zone/Position je Eintrag [bezugswert, zone, positionProzent, erwartetesHonorar].)
 */
const STICHPROBEN = {
  flaechennutzungsplan: {
    a: [2500, "I", 0, 111311], // Tafelzeile 2.500 ha: Zone I von = 111.311 €
    b: [4500, "II", 0, 178873.5], // Mitte 4.000/5.000 ha: 169.557 + 0,5·(188.190−169.557) = 178.873,50 €
    c: [1825, "III", 100, 155169.7], // Anteil 0,3 zw. 1.750/2.000 ha: 152.161 + 0,3·(162.190−152.161) = 155.169,70 €
    d: 999.9, e: 15001,
  },
  bebauungsplan: {
    a: [5, "I", 0, 14864], // Tafelzeile 5 ha: Zone I von = 14.864 €
    b: [8.5, "II", 0, 40839.5], // Mitte 8/9 ha: 39.137 + 0,5·(42.542−39.137) = 40.839,50 €
    c: [3.3, "III", 100, 40217], // Anteil 0,3 zw. 3/4 ha: 37.628 + 0,3·(46.258−37.628) = 40.217,00 €
    d: 0.4, e: 101,
  },
  landschaftsplan: {
    a: [2500, "I", 0, 39212], // Tafelzeile 2.500 ha: Zone I von = 39.212 €
    b: [4500, "II", 0, 64476], // Mitte 4.000/5.000 ha: 60.633 + 0,5·(68.319−60.633) = 64.476,00 €
    c: [1825, "III", 100, 52504.8], // Anteil 0,3 zw. 1.750/2.000 ha: 51.306 + 0,3·(55.302−51.306) = 52.504,80 €
    d: 999.9, e: 15001,
  },
  gruenordnungsplan: {
    a: [10, "I", 0, 15445], // Tafelzeile 10 ha: Zone I von = 15.445 €
    b: [27.5, "II", 0, 35429.5], // Mitte 25/30 ha: 33.201 + 0,5·(37.658−33.201) = 35.429,50 €
    c: [4.3, "III", 100, 13711.2], // Anteil 0,3 zw. 4/5 ha: 13.155 + 0,3·(15.009−13.155) = 13.711,20 €
    d: 1.4, e: 251,
  },
  landschaftsrahmenplan: {
    a: [10000, "I", 0, 87880], // Tafelzeile 10.000 ha: Zone I von = 87.880 €
    b: [17000, "II", 0, 132099.5], // Mitte 16.000/18.000 ha: 128.430 + 0,5·(135.769−128.430) = 132.099,50 €
    c: [8300, "III", 100, 120054.1], // Anteil 0,3 zw. 8.000/9.000 ha: 117.901 + 0,3·(125.078−117.901) = 120.054,10 €
    d: 4999.9, e: 100001,
  },
  landschaftspflegerischer_begleitplan: {
    a: [40, "I", 0, 15755], // Tafelzeile 40 ha: Zone I von = 15.755 €
    b: [350, "II", 0, 81129], // Mitte 300/400 ha: 72.944 + 0,5·(89.314−72.944) = 81.129,00 €
    c: [17.2, "III", 100, 13987.3], // Anteil 0,3 zw. 16/20 ha: 13.420 + 0,3·(15.311−13.420) = 13.987,30 €
    d: 5.9, e: 4001,
  },
  pflege_entwicklungsplan: {
    a: [40, "I", 0, 7612], // Tafelzeile 40 ha: Zone I von = 7.612 €
    b: [125, "II", 0, 22357.5], // Mitte 100/150 ha: 20.816 + 0,5·(23.899−20.816) = 22.357,50 €
    c: [23, "III", 100, 25169], // Anteil 0,3 zw. 20/30 ha: 24.116 + 0,3·(27.626−24.116) = 25.169,00 €
    d: 4.9, e: 10001,
  },
  ingenieurbauwerke: {
    a: [150000, "I", 0, 13786], // Tafelzeile 150.000 €: Zone I von = 13.786 €
    b: [625000, "III", 0, 56981], // Mitte 500.000/750.000 €: 48.195 + 0,5·(65.767−48.195) = 56.981,00 €
    c: [82500, "V", 100, 16833.3], // Anteil 0,3 zw. 75.000/100.000 €: 15.663 + 0,3·(19.564−15.663) = 16.833,30 €
    d: 24999, e: 25000001,
  },
  verkehrsanlagen: {
    a: [150000, "I", 0, 14634], // Tafelzeile 150.000 €: Zone I von = 14.634 €
    b: [625000, "III", 0, 57799], // Mitte 500.000/750.000 €: 49.243 + 0,5·(66.355−49.243) = 57.799,00 €
    c: [82500, "V", 100, 18214.4], // Anteil 0,3 zw. 75.000/100.000 €: 17.003 + 0,3·(21.041−17.003) = 18.214,40 €
    d: 24999, e: 25000001,
  },
  tragwerksplanung: {
    a: [100000, "I", 0, 8946], // Tafelzeile 100.000 €: Zone I von = 8.946 €
    b: [425000, "III", 0, 39204.5], // Mitte 350.000/500.000 €: 33.776 + 0,5·(44.633−33.776) = 39.204,50 €
    c: [57500, "V", 100, 12550.4], // Anteil 0,3 zw. 50.000/75.000 €: 11.279 + 0,3·(15.517−11.279) = 12.550,40 €
    d: 9999, e: 15000001,
  },
  technische_ausruestung: {
    a: [50000, "I", 0, 13165], // Tafelzeile 50.000 €: Zone I von = 13.165 €
    b: [200000, "II", 0, 46518.5], // Mitte 150.000/250.000 €: 37.311 + 0,5·(55.726−37.311) = 46.518,50 €
    c: [28000, "III", 100, 13275.5], // Anteil 0,3 zw. 25.000/35.000 €: 12.164 + 0,3·(15.869−12.164) = 13.275,50 €
    d: 4999, e: 4000001,
  },
};

test("Interpolations-Stichproben je Tafel: Stützstelle, Zeilenmitte, oberer Wert höchster Zone; außerhalb nie 0 €", () => {
  assert.deepEqual(Object.keys(STICHPROBEN).sort(), WEITERE_TAFELN.map((t) => t.leistungsbild).sort());
  for (const t of WEITERE_TAFELN) {
    const s = STICHPROBEN[t.leistungsbild];
    const [aWert, aZone, aPos, aErwartet] = s.a;
    assert.equal(honorarAusTafel(aWert, aZone, aPos, t.leistungsbild).honorar, aErwartet, `${t.leistungsbild} a (Stützstelle)`);
    const [bWert, bZone, bPos, bErwartet] = s.b;
    assert.equal(honorarAusTafel(bWert, bZone, bPos, t.leistungsbild).honorar, bErwartet, `${t.leistungsbild} b (Zeilenmitte)`);
    const [cWert, cZone, cPos, cErwartet] = s.c;
    assert.equal(honorarAusTafel(cWert, cZone, cPos, t.leistungsbild).honorar, cErwartet, `${t.leistungsbild} c (oberer Wert höchste Zone)`);
    const unter = honorarAusTafel(s.d, t.zonen[0], 0, t.leistungsbild);
    assert.equal(unter.honorar, null, `${t.leistungsbild} d (unter der Tafel)`);
    assert.equal(unter.ausserhalb, true, `${t.leistungsbild} d (unter der Tafel)`);
    const ueber = honorarAusTafel(s.e, t.zonen[0], 0, t.leistungsbild);
    assert.equal(ueber.honorar, null, `${t.leistungsbild} e (über der Tafel)`);
    assert.equal(ueber.ausserhalb, true, `${t.leistungsbild} e (über der Tafel)`);
  }
});
