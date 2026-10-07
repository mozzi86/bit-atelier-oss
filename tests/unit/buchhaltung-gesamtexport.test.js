// Unit tests of the overall workbook (79-13 T1, D-P79-26): nine sheets in tab
// order, every sheet built by the tab's own table builder, every cell read back
// through the independent reader leseArbeitsmappe equal to the model value
// (amounts as numbers, dates as Excel serial numbers with dd.mm.yyyy), no
// formula anywhere, text with a leading "=" protected.
//
// In:  src/lib/accounting/gesamtExport.js with the sample office of 27.09.2026.
// Out: assertions only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { strFromU8, unzipSync } from "fflate";
import { beispielDatensaetze } from "@/lib/accounting/beispielDaten.js";
import { saetzeZum, wirksameEinstellungen } from "@/lib/accounting/einstellungen.js";
import { BUCHHALTUNG_ENTITAETEN } from "@/lib/accounting/datenmodell.js";
import { REITER_SCHLUESSEL } from "@/lib/accounting/reiter.js";
import {
  GESAMT_BLAETTER, XLSX_MIME, exportJahre, gesamtArbeitsmappe, gesamtDateiname, gesamtModelle,
} from "@/lib/accounting/gesamtExport.js";
import { ausgangTabelle } from "@/lib/accounting/ausgangsrechnungen.js";
import { ausgabenTabelle } from "@/lib/accounting/ausgaben.js";
import { liquiditaetTabelle, monatsModell } from "@/lib/accounting/liquiditaet.js";
import { umsatzsteuerTabelle, voranmeldungen } from "@/lib/accounting/umsatzsteuer.js";
import { entnahmenTabelle } from "@/lib/accounting/entnahmen.js";
import { bankTabelle } from "@/lib/accounting/abgleich.js";
import { fuhrparkTabelle } from "@/lib/accounting/fuhrpark.js";
import { anlagenTabelle } from "@/lib/accounting/anlagen.js";
import { euerTabelle } from "@/lib/accounting/euer.js";
import { excelSerie } from "@core/lib/kalender/datum.js";
import { TEILE_EN } from "@core/lib/i18nTeile/index.js";
import { formelzahl, leseArbeitsmappe, nrZuSpalte, zellwert } from "@ava/lib/xlsxRead.js";

const HEUTE = "2026-09-27";
const JAHR = 2026;
const SEED = beispielDatensaetze(HEUTE);
const t = (/** @type {string} */ k) => k;
const PROJEKTE = [
  { id: "proj-1", name: "Stadtquartier Nordhang" }, { id: "proj-2", name: "Bürocampus Parkseite" },
  { id: "proj-3", name: "Wohnpark am See" }, { id: "proj-4", name: "Sanierung Altstadthof" },
];
const KONTEXT = { heute: HEUTE, projekte: PROJEKTE };

/** bh.daten of the sample office: the 13 collections, like useBuchhaltung loads them. */
function datenAus(seed = SEED) {
  return Object.fromEntries(BUCHHALTUNG_ENTITAETEN.map((e) => [e, structuredClone(seed[e] || [])]));
}
const EINST = wirksameEinstellungen(SEED.Setting[0].value);
const SAETZE = saetzeZum(HEUTE);

/** Expected cell of one model value, by the rules of 79-RESEARCH "CSV/XLSX-Export". */
function erwarteteZelle(wert, typ) {
  if (wert === null || wert === undefined || wert === "") return null;
  if (typ === "datum" && typeof wert === "string") return excelSerie(wert);
  if (typeof wert === "number") return typ === "betrag" ? Math.round(wert * 100) / 100 : wert;
  const text = String(wert);
  return text.startsWith("=") ? `'${text}` : text;
}

test("GESAMT_BLAETTER folgt der Reiterreihenfolge (reiter.js)", () => {
  assert.deepEqual([...GESAMT_BLAETTER], [...REITER_SCHLUESSEL]);
  assert.equal(GESAMT_BLAETTER.length, 9);
  assert.equal(gesamtDateiname(2026), "Buchhaltung_2026.xlsx");
  assert.equal(gesamtDateiname("2025"), "Buchhaltung_2025.xlsx");
  assert.equal(XLSX_MIME, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
});

test("gesamtModelle: neun Modelle, jedes genau das Modell des Tabellenbauers seines Reiters", () => {
  const daten = datenAus();
  const modelle = gesamtModelle(daten, EINST, SAETZE, JAHR, t, KONTEXT);
  const bankDesJahres = { ...daten, Bankumsatz: daten.Bankumsatz.filter((b) => b.buchungstag.startsWith("2026")) };
  const erwartet = [
    ausgangTabelle(daten.Ausgangsrechnung, t, KONTEXT, { jahr: "2026" }),
    ausgabenTabelle(daten, t, { jahr: "2026" }),
    liquiditaetTabelle(monatsModell({ daten, einst: EINST, saetze: SAETZE, jahr: JAHR, heute: HEUTE }), t),
    umsatzsteuerTabelle(voranmeldungen(JAHR, daten, EINST, SAETZE, HEUTE), t),
    entnahmenTabelle(daten, JAHR, t, EINST),
    bankTabelle(bankDesJahres, t),
    fuhrparkTabelle(daten, JAHR, t, SAETZE),
    anlagenTabelle(daten, JAHR, t, SAETZE),
    euerTabelle({ daten, einst: EINST, saetze: SAETZE, jahr: JAHR }, t),
  ];
  assert.equal(modelle.length, 9);
  assert.deepEqual(modelle, erwartet);
  assert.deepEqual(modelle.map((m) => m.titel), ["Ausgangsrechnungen", "Eingangsrechnungen", "Liquiditätsplanung", "Umsatzsteuer",
    "Entnahmen", "Bank-Abgleich", "Fuhrpark", "Anlagenverzeichnis", "Jahresübersicht"]);
  // Every sheet carries data in the sample year (no empty sheet hides a wrong filter).
  for (const m of modelle) assert.ok(m.zeilen.length > 0, `${m.titel} hat Zeilen`);
  // The year filters: invoices and expenses of 2026 only, bank transactions booked in 2026.
  const jahrDerRechnungen = daten.Ausgangsrechnung.filter((r) => (r.rechnungsdatum || "").startsWith("2026")).length;
  assert.equal(modelle[0].zeilen.length, jahrDerRechnungen);
  assert.equal(modelle[5].zeilen.length, bankDesJahres.Bankumsatz.length);
  assert.ok(bankDesJahres.Bankumsatz.length < daten.Bankumsatz.length, "die Probe enthält Bankumsätze des Vorjahres, die draußen bleiben");
});

test("gesamtArbeitsmappe: 9 Blätter in Reiterreihenfolge, jede Zelle = Wert des Modells, keine Formeln", () => {
  const daten = datenAus();
  const modelle = gesamtModelle(daten, EINST, SAETZE, JAHR, t, KONTEXT);
  const mappe = leseArbeitsmappe(gesamtArbeitsmappe(daten, EINST, SAETZE, JAHR, t, KONTEXT));
  assert.deepEqual(mappe.blattNamen, modelle.map((m) => m.titel));
  assert.equal(mappe.warnungen.length, 0);
  let zellen = 0;
  mappe.blaetter.forEach((blatt, b) => {
    const modell = modelle[b];
    assert.equal(formelzahl(blatt), 0, `${blatt.name}: keine Formel`);
    modell.spalten.forEach((s, j) => assert.equal(zellwert(blatt, `${nrZuSpalte(j + 1)}1`), s.label, `${blatt.name} Kopf ${s.label}`));
    modell.zeilen.forEach((z, i) => {
      modell.spalten.forEach((s, j) => {
        const ref = `${nrZuSpalte(j + 1)}${i + 2}`;
        const soll = erwarteteZelle(z[s.key], s.typ || "text");
        const ist = zellwert(blatt, ref);
        assert.deepEqual(ist, soll, `${blatt.name}!${ref} (${s.key})`);
        if (s.typ === "betrag" && soll !== null) assert.equal(typeof ist, "number", `${blatt.name}!${ref} Betrag als Zahl`);
        if (s.typ === "datum" && soll !== null) assert.ok(Number.isInteger(ist) && ist > 40000, `${blatt.name}!${ref} Datum als Serienzahl`);
        zellen++;
      });
    });
  });
  assert.ok(zellen > 300, `geprüfte Zellen: ${zellen}`);
});

test("Datumszellen tragen das Zahlenformat dd.mm.yyyy, Beträge #,##0.00 (styles.xml)", () => {
  const daten = datenAus();
  const dateien = unzipSync(gesamtArbeitsmappe(daten, EINST, SAETZE, JAHR, t, KONTEXT));
  const styles = strFromU8(dateien["xl/styles.xml"]);
  const formate = Object.fromEntries([...styles.matchAll(/<numFmt numFmtId="(\d+)" formatCode="([^"]+)"\/>/g)].map((m) => [m[2], Number(m[1])]));
  assert.ok(formate["dd.mm.yyyy"], "Format dd.mm.yyyy registriert");
  const xfs = [...(/<cellXfs[^>]*>(.*?)<\/cellXfs>/s.exec(styles)?.[1] || "").matchAll(/<xf numFmtId="(\d+)"/g)].map((m) => Number(m[1]));
  const formatVon = (xml, ref) => {
    const m = new RegExp(`<c r="${ref}"[^>]*\\bs="(\\d+)"`).exec(xml);
    return m ? xfs[Number(m[1])] : null;
  };
  // Sheet 1 (outgoing invoices): H = Rechnungsdatum, E = Netto; sheet 5 (drawings): B = Datum, C = Betrag.
  const blatt1 = strFromU8(dateien["xl/worksheets/sheet1.xml"]);
  const blatt5 = strFromU8(dateien["xl/worksheets/sheet5.xml"]);
  assert.equal(formatVon(blatt1, "H2"), formate["dd.mm.yyyy"]);
  assert.equal(formatVon(blatt1, "E2"), 164, "#,##0.00 (novaXlsx-Standard 164)");
  assert.equal(formatVon(blatt5, "B2"), formate["dd.mm.yyyy"]);
  assert.equal(formatVon(blatt5, "C2"), 164);
  for (const [name, inhalt] of Object.entries(dateien)) {
    if (name.startsWith("xl/worksheets/")) assert.ok(!/<f[ >]/.test(strFromU8(inhalt)), `${name} ohne <f>`);
  }
});

test("Text mit führendem „=“ bleibt Text: Lieferant =HYPERLINK(…) erscheint geschützt, keine Formel", () => {
  const daten = datenAus();
  const boese = '=HYPERLINK("https://beispiel.invalid","Rechnung")';
  daten.Eingangsrechnung.push({ id: "t-er-formel", lieferant: boese, kategorie: "sonstiges", steuerfall: "regel19",
    rechnungsdatum: "2026-09-01", leistungsdatum: "2026-09-01", netto: 100, vorsteuer: 19, brutto: 119, faellig_am: "2026-09-15", bezahlt_am: null });
  const modelle = gesamtModelle(daten, EINST, SAETZE, JAHR, t, KONTEXT);
  const index = modelle[1].zeilen.findIndex((z) => z.lieferant === boese);
  assert.ok(index >= 0, "Zeile im Modell der Eingangsrechnungen");
  const mappe = leseArbeitsmappe(gesamtArbeitsmappe(daten, EINST, SAETZE, JAHR, t, KONTEXT));
  const blatt = mappe.blaetter[1];
  assert.equal(zellwert(blatt, `A${index + 2}`), `'${boese}`);
  assert.equal(blatt.zellen[`A${index + 2}`].formel, null);
  assert.equal(mappe.blaetter.reduce((n, b) => n + formelzahl(b), 0), 0);
});

test("GmbH: weiterhin 9 Blätter, die Jahresübersicht ist die Bilanz-Hinweiszeile; Vorjahr 2025 hat eigene Werte", () => {
  const daten = datenAus();
  const gmbh = wirksameEinstellungen({ ...SEED.Setting[0].value, rechtsform: "gmbh" });
  const modelle = gesamtModelle(daten, gmbh, SAETZE, JAHR, t, KONTEXT);
  assert.equal(modelle.length, 9);
  assert.deepEqual(modelle[8].zeilen, [{ zeile: "Bilanzierungspflicht — keine EÜR (§§ 238, 242 HGB i. V. m. § 13 Abs. 3 GmbHG)", betrag: 0 }]);
  const mappe = leseArbeitsmappe(gesamtArbeitsmappe(daten, gmbh, SAETZE, JAHR, t, KONTEXT));
  assert.equal(mappe.blaetter.length, 9);
  const vorjahr = gesamtModelle(daten, EINST, SAETZE, 2025, t, KONTEXT);
  assert.ok(vorjahr[0].zeilen.length > 0 && vorjahr[0].zeilen.every((z) => z.rechnungsdatum.startsWith("2025")));
  assert.notDeepEqual(vorjahr[2], modelle[2], "Liquidität 2025 ≠ 2026");
});

test("Englisch: Blattnamen übersetzt, eindeutig, höchstens 31 Zeichen", () => {
  const en = (/** @type {string} */ k) => TEILE_EN[k] ?? k;
  const daten = datenAus();
  const mappe = leseArbeitsmappe(gesamtArbeitsmappe(daten, EINST, SAETZE, JAHR, en, KONTEXT));
  assert.deepEqual(mappe.blattNamen, ["Outgoing invoices", "Incoming invoices", "Liquidity plan", "VAT", "Drawings",
    "Bank reconciliation", "Fleet", "Fixed-asset register", "Annual summary"]);
  assert.equal(new Set(mappe.blattNamen).size, 9);
  assert.ok(mappe.blattNamen.every((n) => n.length <= 31));
});

test("exportJahre: Jahre mit Buchungen und das laufende Jahr, neueste zuerst", () => {
  const jahre = exportJahre(datenAus(), HEUTE);
  assert.equal(jahre[0], 2026);
  assert.ok(jahre.includes(2025), "Vorjahresrechnungen der Beispieldaten");
  assert.deepEqual([...jahre].sort((a, b) => b - a), jahre);
  assert.deepEqual(exportJahre({}, "2031-02-03"), [2031]);
  assert.deepEqual(exportJahre(null, HEUTE), [2026]);
});

test("gesamtModelle: ungültiges Jahr oder Datum → Klartextfehler", () => {
  assert.throws(() => gesamtModelle(datenAus(), EINST, SAETZE, "zwanzig", t, KONTEXT), /ungültiges Jahr/);
  assert.throws(() => gesamtModelle(datenAus(), EINST, SAETZE, JAHR, t, {}), /ungültiges Datum/);
  // Empty books still give nine sheets (the header row at least).
  const leer = gesamtModelle({}, wirksameEinstellungen(null), SAETZE, JAHR, t, { heute: HEUTE });
  assert.equal(leer.length, 9);
  assert.equal(leseArbeitsmappe(gesamtArbeitsmappe({}, wirksameEinstellungen(null), SAETZE, JAHR, t, { heute: HEUTE })).blaetter.length, 9);
});
