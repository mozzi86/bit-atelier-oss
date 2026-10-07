// Unit tests of the accounting settings file and the HOAI data (79-01 T1):
// frozen and dated legal values with sources, the HOAI fee tables against the
// research oracle, the registry of all 14 service profiles, the office defaults
// of the decision list, the whitelist merge, the assumptions snapshot and the
// rule shape for phase 80.
//
// In:  src/lib/accounting/einstellungen.js, @core/lib/hoai/*. Out: assertions only.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  ANNAHMEN, BUERO_STANDARD, GESETZ, KONTENRAHMEN, alsRegeln, basiszinsAm, eGrenzeFuer, hybridReichweiteFuer,
  saetzeZum, veralteteWerte, wirksameEinstellungen,
} from "@/lib/accounting/einstellungen.js";
import { GEPRUEFT_AM, QUELLE, TAFEL_FREIANLAGEN, TAFEL_GEBAEUDE_INNENRAEUME } from "@core/lib/hoai/tafel2021.js";
import {
  KG400_REGEL, LEISTUNGSBILDER, LPH, PUNKTE_ZONEN_P35, UMBAU_MAX_PROZENT, alleLeistungsbilder, leistungsbildInfo, tafelStatus,
} from "@core/lib/hoai/leistungsbilder.js";
import { WEITERE_TAFELN } from "@core/lib/hoai/tafeln/index.js";

const quelle = (pfad) => fs.readFileSync(new URL(`../../${pfad}`, import.meta.url), "utf8");
const importe = (text) => [...text.matchAll(/^import[\s\S]*?from\s+["']([^"']+)["']/gm)].map((m) => m[1]);

/** Every dated row below a node, with its path. */
function zeilen(knoten, pfad, aus = []) {
  if (Array.isArray(knoten) && knoten.length && knoten.every((r) => r && typeof r === "object" && "ab" in r && "wert" in r)) {
    for (const r of knoten) aus.push({ pfad, ...r });
  } else if (knoten && typeof knoten === "object" && !Array.isArray(knoten)) {
    for (const [k, v] of Object.entries(knoten)) zeilen(v, `${pfad}.${k}`, aus);
  }
  return aus;
}

test("einstellungen.js importiert nur die beiden HOAI-Datendateien; diese nur sich selbst", () => {
  assert.deepEqual(importe(quelle("src/lib/accounting/einstellungen.js")), ["@core/lib/hoai/tafel2021.js", "@core/lib/hoai/leistungsbilder.js"]);
  assert.deepEqual(importe(quelle("packages/nova-core/src/lib/hoai/tafel2021.js")), []);
  // leistungsbilder.js: no alias, no package — only its two data neighbours.
  assert.deepEqual(importe(quelle("packages/nova-core/src/lib/hoai/leistungsbilder.js")), ["./tafel2021.js", "./tafeln/index.js"]);
  // 79-14: one relative import per transferred fee-table file, nothing else
  // (each of the eleven files is itself import-free — checked below).
  assert.deepEqual(importe(quelle("packages/nova-core/src/lib/hoai/tafeln/index.js")), [
    "./bebauungsplan.js", "./flaechennutzungsplan.js", "./gruenordnungsplan.js", "./ingenieurbauwerke.js",
    "./landschaftspflegerischer_begleitplan.js", "./landschaftsplan.js", "./landschaftsrahmenplan.js",
    "./pflege_entwicklungsplan.js", "./technische_ausruestung.js", "./tragwerksplanung.js", "./verkehrsanlagen.js",
  ]);
  for (const t of WEITERE_TAFELN) {
    assert.deepEqual(importe(quelle(`packages/nova-core/src/lib/hoai/tafeln/${t.leistungsbild}.js`)), [], `${t.leistungsbild}.js: import-frei`);
  }
});

test("alles tiefgefroren: Zuweisung wirft im strict mode", () => {
  assert.throws(() => { GESETZ.VERZUG.basiszins[0].wert = 9; }, TypeError);
  assert.throws(() => { GESETZ.UST.saetze[0].wert.regel = 16; }, TypeError);
  assert.throws(() => { BUERO_STANDARD.zahlungsziel_tage = 30; }, TypeError);
  assert.throws(() => { KONTENRAHMEN.SKR03[0].wert.bank = 1; }, TypeError);
  assert.throws(() => { TAFEL_GEBAEUDE_INNENRAEUME[0][1][0] = 1; }, TypeError);
  assert.throws(() => { LEISTUNGSBILDER[0].label = "x"; }, TypeError);
  assert.throws(() => { ANNAHMEN[0].grund = "x"; }, TypeError);
});

test("jede Tabellenzeile hat ab (YYYY-MM-DD), wert und quelle; Zeilen je Tabelle nach ab sortiert", () => {
  const alle = [...zeilen(GESETZ, "GESETZ"), ...zeilen(KONTENRAHMEN, "KONTENRAHMEN")];
  assert.ok(alle.length > 50, `nur ${alle.length} Zeilen gefunden`);
  for (const z of alle) {
    assert.match(z.ab, /^\d{4}-\d{2}-\d{2}$/, `${z.pfad}: ab`);
    assert.ok(typeof z.quelle === "string" && z.quelle.length > 3, `${z.pfad}: quelle fehlt`);
    if (z.annahme) assert.ok(z.grund, `${z.pfad}@${z.ab}: Annahme ohne Grund`);
  }
  const jePfad = new Map();
  for (const z of alle) jePfad.set(z.pfad, [...(jePfad.get(z.pfad) || []), z]);
  for (const [pfad, liste] of jePfad) {
    const abs = liste.map((z) => z.ab);
    assert.deepEqual(abs, [...abs].sort(), `${pfad}: nicht nach ab sortiert`);
  }
});

test("Basiszins: 1,27 im März 2026, 1,52 ab 01.07.2026; Zeilen nur zum 01.01./01.07.", () => {
  assert.equal(saetzeZum("2026-03-01").verzug.basiszins, 1.27);
  assert.equal(saetzeZum("2026-09-27").verzug.basiszins, 1.52);
  assert.equal(basiszinsAm("2024-03-01"), 3.62);
  assert.equal(basiszinsAm("2023-12-31"), null);
  for (const z of GESETZ.VERZUG.basiszins) assert.match(z.ab, /-(01-01|07-01)$/);
  assert.equal(GESETZ.VERZUG.naechste_aenderung, "2027-01-01");
});

test("saetzeZum ist ein flacher Schnappschuss mit Kleinbuchstaben-Abschnitten", () => {
  const s = saetzeZum("2026-09-27");
  assert.equal(s.stichtag, "2026-09-27");
  assert.deepEqual(s.steuertermine.est, ["03-10", "06-10", "09-10", "12-10"]);
  assert.deepEqual(s.steuertermine.gewst, ["02-15", "05-15", "08-15", "11-15"]);
  assert.equal(s.steuertermine.ust, 10);
  assert.equal(s.ust.saetze.regel, 19);
  assert.equal(s.dienstwagen.e_grenzen, 100000);
  assert.equal(s.hoai.tafel_gebaeude_innenraeume.length, 20);
  assert.equal(s.kontenrahmen.SKR03.erloese_19, 8400);
  assert.equal(Object.isFrozen(s), false, "Schnappschuss ist ein neues Objekt");
});

test("E-Grenze nach Anschaffungsdatum, Hybrid-Reichweite", () => {
  assert.equal(eGrenzeFuer("2023-05-01"), 60000);
  assert.equal(eGrenzeFuer("2024-03-01"), 70000);
  assert.equal(eGrenzeFuer("2025-03-01"), 70000);
  assert.equal(eGrenzeFuer("2025-08-01"), 100000);
  assert.equal(eGrenzeFuer("2018-12-31"), null);
  assert.equal(eGrenzeFuer("2031-01-01"), null);
  assert.equal(hybridReichweiteFuer("2021-06-01"), 40);
  assert.equal(hybridReichweiteFuer("2023-06-01"), 60);
  assert.equal(hybridReichweiteFuer("2026-06-01"), 80);
});

test("LPH-Prozente § 34 Abs. 3 und § 39 Abs. 3, je Summe 100", () => {
  const p = (liste) => liste.map((l) => l.prozent);
  assert.deepEqual(p(LPH.gebaeude), [2, 7, 15, 3, 25, 10, 4, 32, 2]);
  assert.deepEqual(p(LPH.innenraeume), [2, 7, 15, 2, 30, 7, 3, 32, 2]);
  assert.deepEqual(p(LPH.freianlagen), [3, 10, 16, 4, 25, 7, 3, 30, 2]);
  for (const liste of Object.values(LPH)) assert.equal(p(liste).reduce((a, b) => a + b, 0), 100);
  assert.deepEqual(LPH.gebaeude.map((l) => l.nr), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(KG400_REGEL.voll_bis_anteil, 0.25);
  assert.equal(KG400_REGEL.darueber_faktor, 0.5);
  assert.deepEqual(UMBAU_MAX_PROZENT, { gebaeude: 33, innenraeume: 50, freianlagen: 33 });
  assert.deepEqual(PUNKTE_ZONEN_P35.map((z) => z.bis), [10, 18, 26, 34, 42]);
});

/**
 * Structure and research oracle of one fee table.
 * @param {ReadonlyArray<readonly [number, ReadonlyArray<number>]>} tafel
 * @param {number[]} verhaeltnis ratio of the six bounds to the zone-I lower bound
 */
function pruefeTafel(tafel, verhaeltnis) {
  assert.equal(tafel.length, 20);
  for (let i = 0; i < tafel.length; i++) {
    const [kosten, werte] = tafel[i];
    assert.equal(werte.length, 6, `${kosten}: sechs Werte`);
    for (let j = 1; j < werte.length; j++) assert.ok(werte[j] > werte[j - 1], `${kosten}: Zeile nicht streng steigend`);
    if (i > 0) {
      assert.ok(kosten > tafel[i - 1][0], `${kosten}: Kosten nicht steigend`);
      for (let j = 0; j < 6; j++) assert.ok(werte[j] > tafel[i - 1][1][j], `${kosten}: Spalte ${j} nicht streng steigend`);
    }
    for (let j = 0; j < 6; j++) {
      const erwartet = (werte[0] * verhaeltnis[j]) / verhaeltnis[0];
      assert.ok(Math.abs(werte[j] - erwartet) <= 2, `${kosten}: Wert ${j} ${werte[j]} weicht mehr als 2 € vom Verhältnis ab (${erwartet.toFixed(2)})`);
    }
  }
}

test("Tafel § 35: 20 Zeilen 25.000 … 25.000.000, monoton, Verhältnis 64:75:89:111:125:136, Stützwerte", () => {
  assert.equal(TAFEL_GEBAEUDE_INNENRAEUME[0][0], 25000);
  assert.equal(TAFEL_GEBAEUDE_INNENRAEUME[19][0], 25000000);
  pruefeTafel(TAFEL_GEBAEUDE_INNENRAEUME, [64, 75, 89, 111, 125, 136]);
  const zeile = TAFEL_GEBAEUDE_INNENRAEUME.find(([k]) => k === 1000000);
  assert.deepEqual([...zeile[1]], [83182, 97479, 115675, 144268, 162464, 176761]);
  assert.equal(TAFEL_GEBAEUDE_INNENRAEUME[0][1][0], 3120);
  assert.equal(QUELLE.p35, "https://www.gesetze-im-internet.de/hoai_2013/__35.html");
  assert.equal(GEPRUEFT_AM, "2026-09-27");
});

test("Tafel § 40: 20 Zeilen 20.000 … 1.500.000, monoton, Verhältnis 62:74:89:111:126:138, Stützwert", () => {
  assert.equal(TAFEL_FREIANLAGEN[0][0], 20000);
  assert.equal(TAFEL_FREIANLAGEN[19][0], 1500000);
  pruefeTafel(TAFEL_FREIANLAGEN, [62, 74, 89, 111, 126, 138]);
  assert.equal(TAFEL_FREIANLAGEN[0][1][0], 3643);
});

test("BUERO_STANDARD nach E-04/E-09/E-10/E-11/E-12/E-16", () => {
  assert.equal(BUERO_STANDARD.rechtsform, "einzelunternehmen");
  assert.equal(BUERO_STANDARD.ust_zeitraum, "quartal");
  assert.equal(BUERO_STANDARD.dauerfrist, false);
  assert.equal(BUERO_STANDARD.versteuerung, "ist");
  assert.equal(BUERO_STANDARD.kontenrahmen, "SKR03");
  assert.equal(BUERO_STANDARD.zahlungsziel_tage, 14);
  assert.equal(BUERO_STANDARD.puffer_tage, 7);
  assert.equal(BUERO_STANDARD.nebenkosten_prozent, 5);
  assert.equal(BUERO_STANDARD.ust_satz, 19);
  assert.equal(BUERO_STANDARD.rechnungsnr_muster, "RE-{jahr}-{nr3}");
});

test("wirksameEinstellungen: Whitelist über BUERO_STANDARD", () => {
  assert.deepEqual(wirksameEinstellungen({}), BUERO_STANDARD);
  assert.deepEqual(wirksameEinstellungen(null), BUERO_STANDARD);
  assert.equal(wirksameEinstellungen({ zahlungsziel_tage: -5 }).zahlungsziel_tage, 14);
  assert.equal(wirksameEinstellungen({ puffer_tage: NaN }).puffer_tage, 7);
  assert.equal(wirksameEinstellungen({ zahlungsziel_tage: 21 }).zahlungsziel_tage, 21);
  assert.equal(wirksameEinstellungen({ rechtsform: "ag" }).rechtsform, "einzelunternehmen");
  assert.equal(wirksameEinstellungen({ rechtsform: "gmbh" }).rechtsform, "gmbh");
  assert.equal(wirksameEinstellungen({ ust_zeitraum: "jahr" }).ust_zeitraum, "jahr");
  assert.equal(wirksameEinstellungen({ ust_zeitraum: "woche" }).ust_zeitraum, "quartal");
  // Chart of accounts only on the top level (E-11, one place).
  const mitDatev = wirksameEinstellungen({ datev: { kontenrahmen: "SKR04", berater: "123" } });
  assert.equal(mitDatev.kontenrahmen, "SKR03");
  assert.equal("kontenrahmen" in mitDatev.datev, false);
  assert.equal(mitDatev.datev.berater, "123");
  // Prototype pollution: nothing reaches Object.prototype.
  const boese = JSON.parse('{"__proto__":{"x":1},"zahlungsziel_je_bauherr":{"__proto__":{"y":2},"stadtwerke":30}}');
  const e = wirksameEinstellungen(boese);
  assert.equal(({}).x, undefined);
  assert.equal(({}).y, undefined);
  assert.deepEqual(e.zahlungsziel_je_bauherr, { stadtwerke: 30 });
  // Unknown keys drop out; year maps only take 4-digit keys.
  assert.equal("fremd" in wirksameEinstellungen({ fremd: 1 }), false);
  assert.deepEqual(wirksameEinstellungen({ kontostand_start: { 2026: { betrag: 48000, datum: "2026-01-01" }, abc: { betrag: 1 } } }).kontostand_start,
    { 2026: { betrag: 48000, datum: "2026-01-01" } });
  assert.equal(wirksameEinstellungen({ rechnungsnr_muster: "RE-{jahr}" }).rechnungsnr_muster, "RE-{jahr}-{nr3}");
  assert.equal(wirksameEinstellungen({ rechnungsnr_muster: "AR/{jahr}/{nr4}" }).rechnungsnr_muster, "AR/{jahr}/{nr4}");
  // The later-used keys are part of the whitelist.
  const spaeter = wirksameEinstellungen({ ust_vorjahr_zahllast: { 2025: 26400 }, umsatz_vorjahr: { 2025: 250000 }, gewinn_plan: { 2026: 90000 },
    bank_profile: [{ name: "Hausbank", spalten: { betrag: 7 } }], vorjahr_euer: { 2025: { gewinn: 1 } }, datev: { personenkonten: { "bsp-hv-1": 10001 } } });
  assert.deepEqual(spaeter.ust_vorjahr_zahllast, { 2025: 26400 });
  assert.deepEqual(spaeter.umsatz_vorjahr, { 2025: 250000 });
  assert.deepEqual(spaeter.gewinn_plan, { 2026: 90000 });
  assert.equal(spaeter.bank_profile[0].name, "Hausbank");
  assert.deepEqual(spaeter.vorjahr_euer, { 2025: { gewinn: 1 } });
  assert.deepEqual(spaeter.datev.personenkonten, { "bsp-hv-1": 10001 });
});

test("HOAI-Registry: 14 Leistungsbilder in fester Reihenfolge, Status amtlich/fehlt (E-13)", () => {
  const alle = alleLeistungsbilder();
  assert.deepEqual(alle.map((l) => l.key), [
    "gebaeude", "innenraeume", "freianlagen", "ingenieurbauwerke", "verkehrsanlagen", "tragwerksplanung",
    "technische_ausruestung", "flaechennutzungsplan", "bebauungsplan", "landschaftsplan", "gruenordnungsplan",
    "landschaftsrahmenplan", "landschaftspflegerischer_begleitplan", "pflege_entwicklungsplan",
  ]);
  for (const l of alle) {
    assert.ok(l.label && typeof l.label === "string", `${l.key}: label`);
    assert.ok(Number.isInteger(l.tafelParagraf), `${l.key}: tafelParagraf`);
  }
  // 79-14 transferred all eleven remaining fee tables (E-13 "Alle müssen
  // rechnen") — WEITERE_TAFELN now holds one record per non-79-02 profile and
  // every one of the 14 registry keys computes; only an unknown key stays
  // "fehlt". See tests/unit/buchhaltung-hoai-tafeln.test.js for the per-table
  // structural and spot-check proofs.
  assert.equal(WEITERE_TAFELN.length, 11, "79-14: elf Tafeln eingetragen (§§ 20, 21, 28–32, 44, 48, 52, 56)");
  assert.equal(tafelStatus("gebaeude"), "amtlich");
  assert.equal(tafelStatus("freianlagen"), "amtlich");
  assert.equal(tafelStatus("tragwerksplanung"), "amtlich");
  assert.equal(tafelStatus("gibtsnicht"), "fehlt");
  for (const l of alle) assert.equal(tafelStatus(l.key), "amtlich", `${l.key}: seit 79-14 amtlich`);
  const gebaeude = leistungsbildInfo("gebaeude");
  assert.equal(gebaeude.kostenregel, "p33");
  assert.equal(gebaeude.tafel.paragraf, 35);
  assert.equal(gebaeude.tafel.fassung, "HOAI 2021");
  assert.deepEqual([...gebaeude.zonen], ["I", "II", "III", "IV", "V"]);
  assert.equal(gebaeude.lph.length, 9);
  assert.equal(gebaeude.einheit, "EUR");
  assert.equal(leistungsbildInfo("innenraeume").umbau_max_prozent, 50);
  assert.equal(leistungsbildInfo("freianlagen").kostenregel, "manuell");
  const tragwerk = leistungsbildInfo("tragwerksplanung");
  assert.equal(tragwerk.tafel.paragraf, 52);
  assert.equal(tragwerk.status, "amtlich");
  assert.equal(tragwerk.lph.length, 6, "Tragwerksplanung: nur LP 1–6 (§ 51), keine 9 Phasen der Objektplanung");
  assert.equal(leistungsbildInfo("gibtsnicht"), null);
});

test("ein Datensatz mit status amtlich UND annahme rechnet nicht; ein amtlicher schon", () => {
  const basis = { leistungsbild: "tragwerksplanung", paragraf: 52, fassung: "HOAI 2021", bezug: "anrechenbare_kosten_euro", einheit: "EUR",
    zonen: ["I", "II", "III", "IV", "V"], zeilen: [[10000, [1, 2, 3, 4, 5, 6]]], lph: [], lphParagraf: 51, umbau_max_prozent: null,
    quelle: "https://www.gesetze-im-internet.de/hoai_2013/__52.html", abgerufen_am: "2026-09-27", status: "amtlich" };
  assert.equal(tafelStatus("tragwerksplanung", { weitere: [{ ...basis, annahme: true }] }), "fehlt");
  assert.equal(tafelStatus("tragwerksplanung", { weitere: [{ ...basis, status: "entwurf" }] }), "fehlt");
  assert.equal(tafelStatus("tragwerksplanung", { weitere: [basis] }), "amtlich");
  assert.equal(leistungsbildInfo("tragwerksplanung", { weitere: [basis] }).tafel.paragraf, 52);
});

test("veralteteWerte meldet den Basiszins ab dem angekündigten Wechsel", () => {
  assert.deepEqual(veralteteWerte("2026-09-27"), []);
  const v = veralteteWerte("2027-01-02");
  assert.equal(v.length, 1);
  assert.equal(v[0].pfad, "GESETZ.VERZUG.basiszins");
  assert.equal(v[0].regel, "buchhaltung.basiszins");
});

test("ANNAHMEN als Snapshot — eine neue Annahme muss bewusst hier eingetragen werden", () => {
  assert.deepEqual(ANNAHMEN.map((a) => `${a.pfad}@${a.ab}`), [
    "GESETZ.FEIERTAGE_BUND@2000-01-01",
    "GESETZ.UST.ist_grenze@2024-01-01",
    "GESETZ.GEWST.freibetrag@2000-01-01",
    "GESETZ.BUCHFUEHRUNG.grenzen_141_ao@2024-01-01",
    "GESETZ.VERZUG.tage_jahr@2000-01-01",
    "GESETZ.DIENSTWAGEN.blp_abrundung@2000-01-01",
    "GESETZ.DIENSTWAGEN.e_grenzen@2019-01-01",
    "GESETZ.DIENSTWAGEN.e_grenzen@2020-01-01",
    "GESETZ.DIENSTWAGEN.e_grenzen@2024-01-01",
    "GESETZ.DIENSTWAGEN.hybrid_reichweite@2019-01-01",
    "GESETZ.REISEKOSTEN.km_satz@2000-01-01",
    "GESETZ.AFA.nd_tabelle@2021-01-01",
    "GESETZ.AUFBEWAHRUNG.buchungsbelege_jahre@2000-01-01",
    "GESETZ.AUFBEWAHRUNG.buchungsbelege_jahre@2025-01-01",
    "GESETZ.AUFBEWAHRUNG.buecher_jahre@2000-01-01",
    "GESETZ.HOAI.umbau_max_prozent@2021-01-01",
    "GESETZ.DATEV.kopf@2000-01-01",
    "KONTENRAHMEN.SKR03@2000-01-01",
    "KONTENRAHMEN.SKR04@2000-01-01",
    "BUERO_STANDARD.kontenrahmen@2026-09-27",
    "BUERO_STANDARD.zahlungsziel_tage@2026-09-27",
    "BUERO_STANDARD.puffer_tage@2026-09-27",
    "BUERO_STANDARD.warn_tage_rest@2026-09-27",
    "BUERO_STANDARD.rechnungsnr_muster@2026-09-27",
    "BUERO_STANDARD.nebenkosten_prozent@2026-09-27",
    "BUERO_STANDARD.ust_satz@2026-09-27",
    "BUERO_STANDARD.est_ueber_buero@2026-09-27",
    "BUERO_STANDARD.mahnstufen@2026-09-27",
    "BUERO_STANDARD.ablauf_warn_tage@2026-09-27",
  ]);
  for (const a of ANNAHMEN) assert.ok(a.grund, `${a.pfad}: Grund fehlt`);
});

test("alsRegeln: Regel-Form von Phase 80, HOAI-Tafeln als Tabelle, Bürowerte als Annahme", () => {
  const regeln = alsRegeln();
  assert.ok(regeln.length >= 50);
  assert.equal(new Set(regeln.map((r) => r.id)).size, regeln.length, "ids eindeutig");
  for (const r of regeln) {
    assert.match(r.id, /^buchhaltung\.[a-z0-9_]+$/);
    assert.ok(r.quelle, `${r.id}: quelle`);
    assert.equal(r.stand, "2026-09-27");
    assert.ok(Array.isArray(r.werte) && r.werte.length > 0, `${r.id}: werte`);
    const abs = r.werte.map((w) => w.ab);
    assert.deepEqual(abs, [...abs].sort(), `${r.id}: werte nicht nach ab sortiert`);
    for (const w of r.werte) assert.ok(w.quelle, `${r.id}@${w.ab}: quelle`);
    assert.equal(r.editierbar, r.art === "buero", `${r.id}: editierbar nur für Bürowerte`);
  }
  const nach = (id) => regeln.find((r) => r.id === id);
  for (const id of ["buchhaltung.hoai_tafel_gebaeude_innenraeume", "buchhaltung.hoai_tafel_freianlagen"]) {
    assert.equal(nach(id).typ, "tabelle");
    assert.equal(nach(id).editierbar, false);
  }
  assert.equal(nach("buchhaltung.basiszins").werte.length, 6);
  for (const id of ["buchhaltung.zahlungsziel_tage", "buchhaltung.nebenkosten_prozent"]) {
    assert.equal(nach(id).art, "buero");
    assert.equal(nach(id).assumed, true);
    assert.equal(nach(id).werte[0].ab, "2026-09-27");
  }
  assert.equal(nach("buchhaltung.zahlungsziel_tage").werte[0].wert, 14);
  // Fresh objects: changing a rule does not touch the frozen source.
  nach("buchhaltung.mahnstufen").werte[0].wert[0].stufe = 99;
  assert.equal(BUERO_STANDARD.mahnstufen[0].stufe, 1);
});
