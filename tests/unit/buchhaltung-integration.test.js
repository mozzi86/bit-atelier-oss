// Integration probe of the accounting module (79-13 T2, BUCH-01/BUCH-17/BUCH-18):
// the sample office of 27.09.2026 runs through EVERY area library at once, and
// the areas must agree with each other — the clock's VAT dates with the VAT
// tab, the EÜR receipts with the invoices' payments and the bank, the export
// tables with the tabs' own sums, the asset purchases counted once. Then the
// same probe per legal form (E-04: sole proprietor, GbR with a second partner
// and a 60/40 key, GmbH), per VAT period (E-09: monthly, quarterly, none) and
// for every HOAI service profile of the registry (E-13). The data are
// deep-frozen during every run: a library that wrote into the stored records
// would throw, and the records are compared before/after each switch.
//
// In:  src/lib/accounting/* and @core/lib/hoai/* with beispielDatensaetze.
// Out: assertions only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { beispielDatensaetze } from "@/lib/accounting/beispielDaten.js";
import { saetzeZum, wirksameEinstellungen } from "@/lib/accounting/einstellungen.js";
import { BUCHHALTUNG_ENTITAETEN } from "@/lib/accounting/datenmodell.js";
import { gesamtModelle } from "@/lib/accounting/gesamtExport.js";
import { ereignisse, lage, monatsModell, rechnungenRausBis, steuerzahltage } from "@/lib/accounting/liquiditaet.js";
import { istVersteuerungPruefen, ustTermine, voranmeldungen } from "@/lib/accounting/umsatzsteuer.js";
import { aufteilung, euerJahr, vorjahr } from "@/lib/accounting/euer.js";
import { entnahmenJeGesellschafter, geplanteEntnahmen, uebersicht, wirksamerSchluessel } from "@/lib/accounting/entnahmen.js";
import { faktor, faktorGrund, geldwerterVorteil, kilometergeld, nutzungsentnahme, pauschalWertMonat } from "@/lib/accounting/fuhrpark.js";
import { TEILE_EN } from "@core/lib/i18nTeile/index.js";
import { afaSumme, anlagenverzeichnis, methodeVorschlag } from "@/lib/accounting/anlagen.js";
import { forderungAm, ueberfaellige, verzugszinsen } from "@/lib/accounting/mahnwesen.js";
import { erwarteteAusgaben } from "@/lib/accounting/ausgaben.js";
import { konsistenz } from "@/lib/accounting/abgleich.js";
import { vorauszahlungsTermine } from "@/lib/accounting/steuertermine.js";
import { euroZuCent } from "@/lib/accounting/geld.js";
import { honorarAusTafel, honorarVertrag } from "@core/lib/hoai/honorar.js";
import { LEISTUNGSBILDER, leistungsbildInfo, tafelStatus } from "@core/lib/hoai/leistungsbilder.js";

const HEUTE = "2026-09-27";
const JAHR = 2026;
const SEED = beispielDatensaetze(HEUTE);
const SAETZE = saetzeZum(HEUTE);
const t = (/** @type {string} */ k) => k;
const PROJEKTE = [
  { id: "proj-1", name: "Stadtquartier Nordhang" }, { id: "proj-2", name: "Bürocampus Parkseite" },
  { id: "proj-3", name: "Wohnpark am See" }, { id: "proj-4", name: "Sanierung Altstadthof" },
];

/** bh.daten of the sample office (13 collections, own copy). */
const datenAus = () => Object.fromEntries(BUCHHALTUNG_ENTITAETEN.map((e) => [e, structuredClone(SEED[e] || [])]));
/** Effective settings of the sample office with a patch (the settings dialog writes the same way). */
const einstMit = (patch = {}) => wirksameEinstellungen({ ...SEED.Setting[0].value, ...patch });

/** @template T @param {T} obj @returns {T} deep-frozen (a write into the records throws a TypeError) */
function tiefGefroren(obj) {
  if (obj && typeof obj === "object" && !Object.isFrozen(obj)) {
    Object.freeze(obj);
    for (const v of Object.values(obj)) tiefGefroren(v);
  }
  return obj;
}

/** @param {unknown} v @returns {number} sum of the cents of a list of {betragCent} */
const summe = (/** @type {any[]} */ liste, feld = "betragCent") => liste.reduce((n, x) => n + x[feld], 0);
/** @param {number} euro @returns {number} */
const cent = (euro) => Math.round(euro * 100);

// Keys that carry an amount somewhere in the results of the libraries.
const BETRAG_SCHLUESSEL = /(cent|betrag|netto|brutto|zahllast|saldo|gewinn|einnahmen|ausgaben|honorar|grund|umbau|nebenkosten)$/i;

/**
 * Walks a result tree: no NaN/Infinity anywhere, no `undefined` under an amount
 * key (null stays allowed — it is the libraries' explicit "Betrag fehlt"/"frei").
 * @param {unknown} wert
 * @param {string} pfad
 * @param {string[]} fehler collected paths
 */
function pruefeBetraege(wert, pfad, fehler) {
  if (typeof wert === "number" && !Number.isFinite(wert)) { fehler.push(`${pfad} = ${wert}`); return; }
  if (!wert || typeof wert !== "object") return;
  for (const [k, v] of Object.entries(wert)) {
    if (v === undefined && BETRAG_SCHLUESSEL.test(k)) fehler.push(`${pfad}.${k} = undefined`);
    pruefeBetraege(v, `${pfad}.${k}`, fehler);
  }
}

/**
 * Runs every area library on one state of the books — the whole office in one pass.
 * @param {Record<string, any[]>} daten
 * @param {Record<string, any>} einst
 * @param {Record<string, any>} [saetze]
 */
function durchlauf(daten, einst, saetze = SAETZE) {
  const kontext = { daten, einst, saetze, jahr: JAHR, heute: HEUTE, projekte: PROJEKTE };
  const vertragVon = Object.fromEntries(daten.Honorarvertrag.map((v) => [v.id, v]));
  const euer = euerJahr({ daten, einst, saetze, jahr: JAHR });
  const gewinnCent = "gewinn" in euer ? euer.gewinn : 0;
  return {
    tabellen: gesamtModelle(daten, einst, saetze, JAHR, t, { heute: HEUTE, projekte: PROJEKTE }),
    monate: monatsModell(kontext),
    ereignisse: ereignisse(kontext),
    steuertage: steuerzahltage(kontext),
    raus: rechnungenRausBis(kontext),
    lage: lage(kontext),
    voranmeldungen: voranmeldungen(JAHR, daten, einst, saetze, HEUTE),
    ustTermine: ustTermine(JAHR, daten, einst, saetze, HEUTE),
    istPruefung: istVersteuerungPruefen(einst, daten, JAHR, saetze),
    euer,
    vorjahr: vorjahr(daten, einst, saetze, JAHR),
    aufteilung: "gewinn" in euer ? aufteilung(euer.gewinn, daten, einst, JAHR) : null,
    entnahmenIst: entnahmenJeGesellschafter(daten, JAHR),
    entnahmenPlan: geplanteEntnahmen(daten.Gesellschafter, daten.Entnahme, HEUTE, JAHR, einst),
    entnahmenUebersicht: uebersicht(daten, JAHR, gewinnCent, HEUTE, einst),
    nutzungsentnahme: nutzungsentnahme(daten, JAHR, saetze, einst),
    geldwerterVorteil: geldwerterVorteil(daten, JAHR, saetze, einst),
    kilometergeld: kilometergeld(daten.Fahrt.filter((f) => f.datum.startsWith("2026")), saetze),
    anlagen: anlagenverzeichnis(daten, JAHR, saetze),
    afa: afaSumme(daten, JAHR, saetze),
    ausgabenErwartet: erwarteteAusgaben(daten, "2026-01-01", "2026-12-31"),
    forderungen: ueberfaellige(daten.Ausgangsrechnung, HEUTE).map((r) => forderungAm(r, vertragVon[r.honorarvertrag_id] || null, HEUTE)),
    honorare: daten.Honorarvertrag.map((v) => honorarVertrag(v)),
    konsistenz: konsistenz(daten),
  };
}

/** Asserts a pass without NaN/undefined amounts, also in every betrag cell of the nine tables. */
function ohneNaN(ergebnis, titel) {
  const fehler = [];
  pruefeBetraege(ergebnis, titel, fehler);
  for (const m of ergebnis.tabellen) {
    for (const [i, z] of m.zeilen.entries()) {
      for (const s of m.spalten) if (s.typ === "betrag" && !(typeof z[s.key] === "number" && Number.isFinite(z[s.key]))) fehler.push(`${m.titel}[${i}].${s.key} = ${z[s.key]}`);
    }
  }
  assert.deepEqual(fehler, [], `${titel}: keine NaN/undefined in Beträgen`);
}

/**
 * VAT part of every clock tax day = the VAT tab's liability on that date. The
 * clock sums all taxes of one statutory date into one mark (10.03. = ESt +
 * USt), so the ESt/KSt/GewSt part is taken from a run without VAT dates.
 */
function pruefeUstUhrGleichReiter(daten, einst, titel) {
  const kontext = { daten, einst, saetze: SAETZE, jahr: JAHR, heute: HEUTE };
  const tage = steuerzahltage(kontext);
  const ohneUst = new Map(steuerzahltage({ ...kontext, einst: { ...einst, ust_zeitraum: "jahr" } }).map((st) => [st.nenn, st.betragCent || 0]));
  const termine = ustTermine(JAHR, daten, einst, SAETZE, HEUTE);
  const reiter = voranmeldungen(JAHR, daten, einst, SAETZE, HEUTE).filter((z) => z.nenn);
  const ustTage = tage.filter((st) => st.arten.some((a) => a === "ust" || a === "ust_svz"));
  assert.deepEqual(ustTage.map((st) => st.nenn), [...new Set(termine.map((x) => x.nenn))], `${titel}: USt-Tage der Uhr = ustTermine`);
  assert.deepEqual([...new Set(termine.map((x) => x.nenn))], [...new Set(reiter.map((z) => z.nenn))], `${titel}: ustTermine = Zeilen des USt-Reiters`);
  for (const st of ustTage) {
    const reiterBetrag = reiter.filter((z) => z.nenn === st.nenn).reduce((n, z) => n + Math.max(0, z.zahllast), 0);
    assert.equal(st.betragCent - (ohneUst.get(st.nenn) || 0), reiterBetrag, `${titel}: ${st.nenn} USt der Uhr = Zahllast des Reiters`);
  }
  // The clock's outflow events for VAT = the positive liabilities of the tab.
  const ustEreignisse = ereignisse(kontext).filter((e) => e.art === "steuer" && (e.quelle === "ust" || e.quelle === "ust_svz"));
  assert.equal(summe(ustEreignisse), reiter.filter((z) => z.zahllast > 0 && z.faellig.startsWith("2026")).reduce((n, z) => n + z.zahllast, 0), `${titel}: USt-Abflüsse der Uhr`);
  return { ustTage, termine, reiter };
}

test("Beispielbüro durch alle Bereiche: keine NaN/undefined in Beträgen, konsistenz() leer, Daten unverändert", () => {
  const daten = datenAus();
  const vorher = JSON.stringify(daten);
  const ergebnis = durchlauf(tiefGefroren(daten), einstMit());
  ohneNaN(ergebnis, "Seed");
  assert.deepEqual(ergebnis.konsistenz, []);
  assert.equal(ergebnis.tabellen.length, 9);
  assert.equal(JSON.stringify(daten), vorher, "kein Bereich schreibt in die Datensätze");
  // The sample office is what the demo shows (E-05/E-17): a sole proprietor with one owner.
  assert.equal(ergebnis.euer.hinweis, undefined);
  assert.equal(ergebnis.lage.ueberfaellig.anzahl, 2);
  assert.ok(ergebnis.monate.some((m) => m.saldoEndeCent < ergebnis.monate[0].saldoAnfangCent), "die Uhr hat Bewegung");
});

test("USt der Uhr = USt-Reiter (Seed: monatlich mit Dauerfristverlängerung, 13 Termine)", () => {
  const daten = datenAus();
  const { termine } = pruefeUstUhrGleichReiter(daten, einstMit(), "Seed");
  assert.equal(termine.length, 13);
});

test("EÜR-Einnahmen = Zahlungseingänge der Rechnungen = Eingänge der Uhr bis heute = zugeordnete Bankgutschriften", () => {
  const daten = datenAus();
  const einst = einstMit();
  const euer = euerJahr({ daten, einst, saetze: SAETZE, jahr: JAHR });
  const zeile = (s) => euer.zeilen.find((z) => z.schluessel === s)?.betragCent || 0;
  const zufluesse = daten.Ausgangsrechnung.filter((r) => r.status === "gestellt" || r.status === "storniert")
    .flatMap((r) => r.zahlungen).filter((z) => z.datum.startsWith("2026")).reduce((n, z) => n + euroZuCent(z.betrag), 0);
  assert.ok(zufluesse > 0);
  assert.equal(zeile("einnahmen_leistungen_netto") + zeile("einnahmen_leistungen_ust"), zufluesse);
  const eingaengeBisHeute = ereignisse({ daten, einst, saetze: SAETZE, jahr: JAHR, heute: HEUTE })
    .filter((e) => e.art === "eingang" && e.quelle === "ausgangsrechnung" && e.datum <= HEUTE);
  assert.equal(summe(eingaengeBisHeute), zufluesse);
  // Bank: every 2026 payment that carries a bank id has exactly that credit on the account.
  const mitBank = daten.Ausgangsrechnung.flatMap((r) => r.zahlungen.filter((z) => z.bankumsatz_id && z.datum.startsWith("2026")).map((z) => ({ z, r })));
  for (const { z, r } of mitBank) {
    const b = daten.Bankumsatz.find((x) => x.id === z.bankumsatz_id);
    assert.equal(euroZuCent(b.betrag), euroZuCent(z.betrag), `${r.nummer}: Bankbetrag = Zahlung`);
    assert.deepEqual([b.zuordnung.typ, b.zuordnung.id, b.status], ["Ausgangsrechnung", r.id, "zugeordnet"]);
  }
  // The VAT the EÜR collected is the VAT the tab counts by receipt (cash accounting, E-10).
  const ustReiter = voranmeldungen(JAHR, daten, einst, SAETZE, HEUTE).flatMap((z) => z.ustBelege)
    .filter((b) => b.datum.startsWith("2026")).reduce((n, b) => n + b.cent, 0);
  assert.equal(zeile("einnahmen_leistungen_ust"), ustReiter);
});

test("Anlagenkäufe nicht doppelt: Rechnung mit anlage_id nur über die AfA, einmal als Zahlung in der Uhr", () => {
  const daten = datenAus();
  const einst = einstMit();
  const kaeufe = daten.Eingangsrechnung.filter((e) => e.anlage_id);
  assert.equal(kaeufe.length, 3);
  for (const jahr of [2025, 2026]) {
    const euer = euerJahr({ daten, einst, saetze: SAETZE, jahr });
    const belegIds = euer.zeilen.filter((z) => z.schluessel !== "afa").flatMap((z) => z.belege.map((b) => b.id));
    for (const e of kaeufe) assert.ok(!belegIds.includes(e.id), `${jahr}: ${e.id} ist keine Betriebsausgabe (nur AfA)`);
    const afaIds = euer.zeilen.find((z) => z.schluessel === "afa")?.belege.map((b) => b.id) || [];
    for (const e of kaeufe.filter((x) => x.rechnungsdatum.slice(0, 4) <= String(jahr))) {
      const anlage = daten.Anlagegut.find((a) => a.id === e.anlage_id);
      if (anlage.methode === "gwg" && anlage.anschaffung_datum.slice(0, 4) !== String(jahr)) continue; // GWG: only its own year
      assert.ok(afaIds.includes(anlage.id), `${jahr}: ${anlage.id} in der AfA`);
    }
    assert.equal(euer.afa, afaSumme(daten, jahr, SAETZE));
    const ausgaben = ereignisse({ daten, einst, saetze: SAETZE, jahr, heute: HEUTE }).filter((x) => x.art === "ausgabe");
    for (const e of kaeufe.filter((x) => x.bezahlt_am.startsWith(String(jahr)))) {
      assert.equal(ausgaben.filter((x) => x.id === e.id).length, 1, `${jahr}: ${e.id} genau einmal als Abfluss`);
    }
  }
});

test("Summen der Export-Tabellen = Summen der Reiter (alle neun Blätter)", () => {
  const daten = datenAus();
  const einst = einstMit();
  const e = durchlauf(daten, einst);
  const [ausgang, eingang, liqui, ust, entn, bank, fuhr, anl, euer] = e.tabellen;
  const spalteCent = (m, key) => m.zeilen.reduce((n, z) => n + cent(z[key] || 0), 0);
  const rechnungen2026 = daten.Ausgangsrechnung.filter((r) => (r.rechnungsdatum || "").startsWith("2026"));
  assert.equal(spalteCent(ausgang, "netto"), rechnungen2026.reduce((n, r) => n + euroZuCent(r.netto), 0));
  assert.equal(spalteCent(ausgang, "zahlung_summe"), rechnungen2026.flatMap((r) => r.zahlungen).reduce((n, z) => n + euroZuCent(z.betrag), 0));
  assert.equal(spalteCent(eingang, "brutto"), daten.Eingangsrechnung.filter((x) => x.rechnungsdatum.startsWith("2026")).reduce((n, x) => n + euroZuCent(x.brutto), 0));
  assert.equal(spalteCent(liqui, "eingaenge"), summe(e.monate, "eingaengeCent"));
  assert.equal(spalteCent(liqui, "abfluss"), summe(e.monate, "abflussCent"));
  assert.equal(cent(liqui.zeilen[11].saldoEnde), e.monate[11].saldoEndeCent);
  assert.equal(spalteCent(ust, "zahllast"), summe(e.voranmeldungen, "zahllast"));
  assert.equal(spalteCent(ust, "ust"), summe(e.voranmeldungen, "ust"));
  assert.equal(spalteCent(entn, "betrag"), Object.values(e.entnahmenIst).reduce((n, c) => n + c, 0));
  assert.ok(Object.values(e.entnahmenIst).reduce((n, c) => n + c, 0) > 0);
  assert.equal(spalteCent(bank, "betrag"), daten.Bankumsatz.filter((b) => b.buchungstag.startsWith("2026")).reduce((n, b) => n + euroZuCent(b.betrag), 0));
  assert.equal(spalteCent(fuhr, "jahreswert"), e.nutzungsentnahme.summeCent + e.geldwerterVorteil.summeCent);
  assert.equal(spalteCent(anl, "afa"), e.afa);
  assert.equal(cent(euer.zeilen.at(-1).betrag), e.euer.gewinn, "EÜR-Blatt: letzte Zeile = Gewinn");
  assert.deepEqual(euer.zeilen.slice(0, -1).map((z) => cent(z.betrag)), e.euer.zeilen.map((z) => z.betragCent));
});

test("Satz-Kopie: Basiszins → Verzugszinsen, km-Satz → Kilometergeld, GWG-Grenze → AfA-Methode, Zahlungsziel → rote Fristen", () => {
  const daten = datenAus();
  const einst = einstMit();
  const kopie = (/** @type {(s: any) => void} */ aendern) => { const s = structuredClone(SAETZE); aendern(s); return s; };

  // Base rate: the overdue invoice with a first reminder is in default since 29.08.2026.
  const forderung = forderungAm(daten.Ausgangsrechnung.find((r) => r.id === "bsp-ar-12"), daten.Honorarvertrag.find((v) => v.id === "bsp-hv-3"), HEUTE);
  assert.ok(forderung.verzugsbeginn.datum && forderung.offenCent > 0);
  const normal = verzugszinsen(forderung.offenCent, forderung.verzugsbeginn.datum, HEUTE, "unternehmer", SAETZE);
  assert.equal(normal.cent, forderung.zinsen.cent, "unveränderte Sätze: dasselbe wie forderungAm");
  assert.equal(normal.perioden.at(-1).basiszins, 1.52);
  const hoeher = verzugszinsen(forderung.offenCent, forderung.verzugsbeginn.datum, HEUTE, "unternehmer", kopie((s) => { s.verzug.basiszins = 2.52; }));
  assert.equal(hoeher.perioden.at(-1).basiszins, 2.52);
  assert.ok(hoeher.cent > normal.cent, `Zinsen ${normal.cent} → ${hoeher.cent} Cent`);
  // An earlier half-year keeps its historical rate (dated table), only the snapshot's half-year follows the copy.
  const ueberJahr = verzugszinsen(1000000, "2026-06-01", "2026-07-31", "unternehmer", kopie((s) => { s.verzug.basiszins = 2.52; }));
  assert.deepEqual(ueberJahr.perioden.map((p) => p.basiszins), [1.27, 2.52]);
  assert.equal(verzugszinsen(1000000, "2026-06-01", "2026-07-31", "unternehmer", SAETZE).cent, 17376, "Prüfwert 79-RESEARCH 173,76 €");

  // Mileage rate: kilometergeld and the EÜR line follow the copy.
  const fahrten = daten.Fahrt.filter((f) => f.datum.startsWith("2026"));
  const kmNormal = kilometergeld(fahrten, SAETZE);
  const kmKopie = kopie((s) => { s.reisekosten.km_satz = 0.35; });
  assert.equal(kmNormal.summeCent, 5700);
  assert.equal(kilometergeld(fahrten, kmKopie).summeCent, 6650);
  const euerKm = euerJahr({ daten, einst, saetze: kmKopie, jahr: JAHR });
  assert.equal(euerKm.zeilen.find((z) => z.schluessel === "ausgaben_kilometergeld").betragCent, 6650);

  // GWG limit: a 690 € monitor is a GWG at 800 €, depreciated linearly at 500 €.
  assert.equal(methodeVorschlag(69000, SAETZE), "gwg");
  assert.equal(methodeVorschlag(69000, kopie((s) => { s.afa.gwg_grenze = 500; })), "linear");

  // Company-car flat rate (1 %): the monthly value follows the copy.
  const eAuto = daten.Fahrzeug.find((f) => f.id === "bsp-fz-1");
  assert.ok(pauschalWertMonat(eAuto, kopie((s) => { s.dienstwagen.pauschal_prozent = 2; })).privat > pauschalWertMonat(eAuto, SAETZE).privat);

  // Tax dates from the rates: a moved ESt date moves the clock's prepayment date.
  assert.equal(vorauszahlungsTermine(JAHR, "est", kopie((s) => { s.steuertermine.est = ["03-20", "06-10", "09-10", "12-10"]; }))[0].nenn, "2026-03-20");

  // Payment term (office value, E-12): 14 → 21 moves every red deadline 7 days earlier.
  const kontext = { daten, einst, saetze: SAETZE, jahr: JAHR, heute: HEUTE, projekte: PROJEKTE };
  const tage14 = steuerzahltage(kontext);
  const tage21 = steuerzahltage({ ...kontext, einst: { ...einst, zahlungsziel_tage: 21 } });
  assert.equal(tage14.length, tage21.length);
  tage14.forEach((st, i) => {
    const diff = (Date.parse(st.spaetesterVersand) - Date.parse(tage21[i].spaetesterVersand)) / 86400000;
    assert.equal(diff, 7, `${st.nenn}: rote Frist 7 Tage früher`);
  });
  assert.equal(tage14.find((st) => st.nenn === "2026-10-10").spaetesterVersand, "2026-09-19", "79-RESEARCH: 10.10.2026 → 19.09.2026");
});

test("Rechtsform-Schleife (E-04): Einzelunternehmen, GbR 60/40, GmbH — ohne NaN, Ist-Daten bleiben unverändert", () => {
  const basis = datenAus();
  const original = JSON.stringify(basis);
  const gesellschafterB = { id: "t-g2", name: "Gesellschafter B", rolle: "gesellschafter", aktiv: true, entnahme_plan_monat: 4000 };
  const faelle = {
    einzelunternehmen: { daten: datenAus(), einst: einstMit() },
    gbr: { daten: { ...datenAus(), Gesellschafter: [...datenAus().Gesellschafter, gesellschafterB] },
      einst: einstMit({ rechtsform: "gbr", schluessel: { 2026: { "bsp-g1": 60, "t-g2": 40 } } }) },
    gmbh: { daten: datenAus(), einst: einstMit({ rechtsform: "gmbh" }) },
  };
  /** @type {Record<string, any>} */
  const ergebnisse = {};
  for (const [rf, { daten, einst }] of Object.entries(faelle)) {
    const vorher = JSON.stringify(daten);
    ergebnisse[rf] = durchlauf(tiefGefroren(daten), einst);
    ohneNaN(ergebnisse[rf], rf);
    assert.equal(JSON.stringify(daten), vorher, `${rf}: keine gespeicherten Daten verändert`);
    assert.deepEqual(ergebnisse[rf].konsistenz, [], `${rf}: konsistenz leer`);
  }
  const { einzelunternehmen: einzel, gbr, gmbh } = ergebnisse;

  // Sole proprietor: 100 % of the profit to the one owner, no stored key needed.
  assert.ok(einzel.euer.gewinn > 0);
  assert.deepEqual(einzel.aufteilung, { "bsp-g1": einzel.euer.gewinn });
  assert.deepEqual(wirksamerSchluessel(faelle.einzelunternehmen.daten, faelle.einzelunternehmen.einst, JAHR), { "bsp-g1": 100 });
  assert.ok(einzel.entnahmenPlan.length > 0, "Plan-Entnahmen der Inhaberin");

  // GbR: the shares add up exactly to the profit, split 60/40 (largest remainder).
  const anteile = Object.values(gbr.aufteilung);
  assert.equal(anteile.length, 2);
  assert.equal(anteile.reduce((n, c) => n + c, 0), gbr.euer.gewinn);
  assert.ok(Math.abs(gbr.aufteilung["bsp-g1"] - Math.round(gbr.euer.gewinn * 0.6)) <= 1);
  assert.ok(gbr.entnahmenPlan.some((p) => p.gesellschafter_id === "t-g2"), "Plan je Gesellschafter");
  assert.ok(gbr.euer.hinweise.includes("feststellung"));

  // GmbH: balance-sheet hint instead of an EÜR, no planned drawings, trade tax and corporate tax dates.
  assert.deepEqual(gmbh.euer, { hinweis: "bilanzierung", ug: false });
  assert.equal(gmbh.aufteilung, null);
  assert.deepEqual(gmbh.entnahmenPlan, []);
  assert.ok(!gmbh.ereignisse.some((x) => x.quelle === "entnahme-plan"));
  assert.deepEqual(gmbh.steuertage.filter((st) => st.arten.includes("gewst")).map((st) => st.nenn), ["2026-02-15", "2026-05-15", "2026-08-15", "2026-11-15"]);
  assert.deepEqual(gmbh.steuertage.filter((st) => st.arten.includes("kst")).map((st) => st.nenn), ["2026-03-10", "2026-06-10", "2026-09-10", "2026-12-10"]);
  assert.ok(!gmbh.steuertage.some((st) => st.arten.includes("est")));
  assert.ok(!einzel.steuertage.some((st) => st.arten.includes("gewst")), "Freiberufler ohne GewSt");
  assert.equal(gmbh.nutzungsentnahme.summeCent, 0);
  assert.equal(gmbh.geldwerterVorteil.summeCent, einzel.nutzungsentnahme.summeCent, "Dienstwagen wandert zum geldwerten Vorteil");
  assert.equal(gmbh.tabellen[8].zeilen.length, 1);

  // Actual data keep counting whatever the form: the drawings already made stay in the balance.
  const ist = (e) => summe(e.ereignisse.filter((x) => x.art === "entnahme" && x.quelle === "entnahme"));
  assert.equal(ist(gmbh), ist(einzel));
  assert.equal(ist(gbr), ist(einzel));
  assert.equal(JSON.stringify(basis), original);
});

test("USt-Schleife (E-09): monatlich/vierteljährlich/keine Voranmeldung, je mit und ohne DFV — Uhr = ustTermine", () => {
  const erwartet = { "monat:true": 13, "monat:false": 12, "quartal:true": 4, "quartal:false": 4, "jahr:true": 0, "jahr:false": 0 };
  for (const [schluessel, anzahl] of Object.entries(erwartet)) {
    const [ust_zeitraum, dfv] = schluessel.split(":");
    const daten = tiefGefroren(datenAus());
    const einst = einstMit({ ust_zeitraum, dauerfrist: dfv === "true" });
    const { termine, ustTage } = pruefeUstUhrGleichReiter(daten, einst, schluessel);
    assert.equal(termine.length, anzahl, `${schluessel}: ${anzahl} USt-Termine`);
    ohneNaN(durchlauf(daten, einst), schluessel);
    if (ust_zeitraum === "jahr") {
      assert.equal(ustTage.length, 0, "keine USt-Marke auf der Uhr");
      const va = voranmeldungen(JAHR, daten, einst, SAETZE, HEUTE);
      assert.equal(va.length, 1);
      assert.equal(va[0].jahreserklaerung, true);
    }
  }
  // Quarterly without extension: the four statutory dates of 79-RESEARCH, Saturday 10.10. due on Monday 12.10.
  const quartal = ustTermine(JAHR, datenAus(), einstMit({ ust_zeitraum: "quartal", dauerfrist: false }), SAETZE, HEUTE);
  assert.deepEqual(quartal.map((x) => [x.nenn, x.faellig]), [["2026-01-10", "2026-01-12"], ["2026-04-10", "2026-04-10"], ["2026-07-10", "2026-07-10"], ["2026-10-10", "2026-10-12"]]);
});

test("HOAI-Schleife (E-13): jedes Leistungsbild der Registry rechnet an der ersten Tafelzeile den Tafelwert oder meldet „Tafel fehlt“", () => {
  assert.equal(LEISTUNGSBILDER.length, 14);
  let amtlich = 0;
  for (const { key } of LEISTUNGSBILDER) {
    const info = leistungsbildInfo(key);
    if (tafelStatus(key) === "amtlich") {
      amtlich++;
      const [bezug, werte] = info.tafel.zeilen[0];
      const r = honorarAusTafel(bezug, info.zonen[0], 0, key);
      assert.equal(r.tafelFehlt, false, key);
      assert.equal(r.basis, werte[0], `${key}: Zone ${info.zonen[0]} Basis = Tafelwert ${werte[0]}`);
      assert.equal(r.honorar, werte[0], key);
      assert.ok(Number.isFinite(r.oben) && r.oben > r.basis, `${key}: oberer Wert`);
      // A contract in the middle of the table: an amount, never 0 € or NaN (E-13 "alle müssen rechnen").
      const mitte = info.tafel.zeilen[Math.floor(info.tafel.zeilen.length / 2)][0];
      const vertrag = { leistungsbild: key, bezugswert: mitte, kg300_euro: mitte, kg400_euro: 0, honorarzone: info.zonen[1],
        satz_position_prozent: 0, lph: info.lph.map((p) => ({ beauftragt: true, prozent: p.prozent })), nebenkosten_prozent: 5, ust_satz: 19 };
      const h = honorarVertrag(vertrag);
      assert.equal(h.quelle, "tafel", key);
      assert.ok(Number.isFinite(h.netto) && h.netto > 0, `${key}: netto ${h.netto}`);
    } else {
      assert.equal(honorarAusTafel(1, "I", 0, key).tafelFehlt, true, `${key}: Tafel fehlt`);
    }
    // The "fehlt" branch for the same profile: a record that carries [ASSUMED] never computes.
    const ohneAmt = [{ ...(info.tafel || { leistungsbild: key, zonen: ["I"], zeilen: [[1, [1, 2]]], lph: [] }), leistungsbild: key, status: "amtlich", annahme: true }];
    assert.equal(tafelStatus(key, { weitere: ohneAmt }), "fehlt", `${key}: [ASSUMED] → fehlt`);
    const f = honorarAusTafel(info.tafel ? info.tafel.zeilen[0][0] : 1, info.zonen[0] || "I", 0, key, { weitere: ohneAmt });
    assert.equal(f.tafelFehlt, true, key);
    assert.equal(f.honorar, null, `${key}: kein 0 €`);
    const g = honorarVertrag({ leistungsbild: key, bezugswert: 100000, honorarzone: "I", lph: [] }, { weitere: ohneAmt });
    assert.deepEqual([g.quelle, g.netto], ["tafel_fehlt", null], key);
  }
  assert.equal(amtlich, 14, "seit 79-14 alle 14 Leistungsbilder amtlich");
});

test("faktorGrund (79-13, EN-Probe): deutsch = faktor().grund in allen acht Fällen, englisch ohne deutsche Reste", () => {
  const faelle = [
    { antrieb: "elektro", blp: 58800, anschaffung_datum: "2018-06-01" },
    { antrieb: "elektro", blp: 58800, anschaffung_datum: "2025-03-15" },
    { antrieb: "elektro", blp: 80000, anschaffung_datum: "2025-03-15" },
    { antrieb: "hybrid", blp: 50000, co2_g_km: 45, anschaffung_datum: "2025-03-15" },
    { antrieb: "hybrid", blp: 50000, co2_g_km: 120, e_reichweite_km: 90, anschaffung_datum: "2018-06-01" },
    { antrieb: "hybrid", blp: 50000, co2_g_km: 120, e_reichweite_km: 90, anschaffung_datum: "2025-03-15" },
    { antrieb: "hybrid", blp: 50000, co2_g_km: 120, e_reichweite_km: 70, anschaffung_datum: "2025-03-15" },
    { antrieb: "verbrenner", blp: 42000, anschaffung_datum: "2025-09-01" },
  ];
  const en = (/** @type {string} */ k) => TEILE_EN[k] ?? k;
  const deutsch = faelle.map((f) => faktorGrund(f, SAETZE, t));
  assert.deepEqual(deutsch, faelle.map((f) => faktor(f, SAETZE).grund));
  assert.equal(new Set(deutsch).size, 8, "acht verschiedene Begründungen");
  assert.equal(deutsch[1], "Elektrofahrzeug bis 70.000 € (BLP 58.800 €)");
  const englisch = faelle.map((f) => faktorGrund(f, SAETZE, en, "en"));
  assert.equal(englisch[1], "Electric vehicle up to €70,000 (list price €58,800)");
  assert.equal(englisch[6], "Electric range 70 km < 80 km");
  assert.equal(englisch[7], "Combustion");
  for (const s of englisch) assert.ok(!/[äöüß]|Fahrzeug|Anschaffung|Reichweite|Staffel|Verbrenner|\{/.test(s), s);
});
