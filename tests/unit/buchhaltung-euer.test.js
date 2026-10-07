// Unit tests of the annual profit statement module (79-11): cash-basis gross
// method (netto + vereinnahmte/gezahlte USt as separate lines), the § 11
// Abs. 2 S. 2 EStG ten-day rule for the December VAT period, profit
// allocation by legal form, prior-year comparison.
//
// In:  src/lib/accounting/euer.js, src/lib/accounting/einstellungen.js.
// Out: assertions only.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aufteilung, euerJahr, euerTabelle, hinweisText, steuerzahlungJahr, vergleich, vorjahr, zeileText,
} from "@/lib/accounting/euer.js";
import { saetzeZum } from "@/lib/accounting/einstellungen.js";
import { euroZuCent } from "@/lib/accounting/geld.js";

const SAETZE_2026 = saetzeZum("2026-12-31");
const EINST_EINZEL = { rechtsform: "einzelunternehmen", dauerfrist: false, gewst_aktiv: false };

/**
 * The main 2026 scenario of the plan's <behavior> block: Zahlungseingänge
 * brutto 119.000 € (netto 100.000, USt 19.000), bezahlte Eingangsrechnung
 * brutto 23.800 € (netto 20.000, VSt 3.800), USt-Zahlung 15.200 €, AfA
 * 2.000 € → Einnahmen 119.000, Ausgaben 39.000, AfA 2.000, Gewinn 78.000.
 * @param {{personal?: number}} [zusatz] an additional "personal"-category
 *   expense (Euro, steuerfrei) — used by the "Löhne und Gehälter" test.
 * @returns {Record<string, any[]>}
 */
function basisSzenario(zusatz = {}) {
  /** @type {Record<string, any[]>} */
  const daten = {
    Ausgangsrechnung: [{
      id: "ar-1", status: "gestellt", rechnungsdatum: "2026-03-05", netto: 100000, ust_satz: 19, ust: 19000, brutto: 119000,
      empfaenger: { name: "Beispiel Bauherr" }, zahlungen: [{ datum: "2026-03-20", betrag: 119000 }],
    }],
    Eingangsrechnung: [
      { id: "er-1", lieferant: "Beispiel Lieferant", kategorie: "sonstiges", steuerfall: "regel19",
        netto: 20000, vorsteuer: 3800, brutto: 23800, rechnungsdatum: "2026-04-01", bezahlt_am: "2026-04-08" },
      // Pkw-Rechnung MIT anlage_id — zählt nicht als Ausgabe, nur ihre AfA (separat im Anlagegut unten).
      { id: "er-2", lieferant: "Autohaus Beispiel", kategorie: "fahrzeug", steuerfall: "regel19",
        netto: 30000, vorsteuer: 5700, brutto: 35700, rechnungsdatum: "2026-02-01", bezahlt_am: "2026-02-10", anlage_id: "ag-pkw" },
    ],
    Steuerzahlung: [
      { id: "st-1", art: "ust", zeitraum: { von: "2026-01-01", bis: "2026-03-31" }, betrag: 15200, faellig_am: "2026-04-10", bezahlt_am: "2026-04-08" },
      // ESt vom Bürokonto = Entnahme — euer.js liest nur art ust/ust_svz/gewst, "est" bleibt unberücksichtigt.
      { id: "st-2", art: "est", zeitraum: null, betrag: 9000, faellig_am: "2026-06-10", bezahlt_am: "2026-06-10" },
    ],
    // AfA 2026 = 2.000,00 € (24.000 € / 12 Jahre, volles Jahr — Anschaffung lange vor 2026).
    Anlagegut: [{ id: "ag-1", bezeichnung: "Bürocomputer-Ausstattung", kategorie: "bueroausstattung",
      ak_netto: 24000, nutzungsdauer: 12, anschaffung_datum: "2020-01-01", methode: "linear", abgang: null }],
    // Wird von euerJahr() gar nicht gelesen — steht hier nur, um zu zeigen, dass sie den Gewinn nicht ändert.
    Entnahme: [{ id: "en-1", gesellschafter_id: "g-inhaber", datum: "2026-05-01", betrag: 10000, art: "ueberweisung" }],
  };
  if (zusatz.personal) {
    daten.Eingangsrechnung.push({
      id: "er-personal", lieferant: "Lohnbüro Beispiel", kategorie: "personal", steuerfall: "steuerfrei",
      netto: zusatz.personal, vorsteuer: 0, brutto: zusatz.personal, rechnungsdatum: "2026-05-01", bezahlt_am: "2026-05-05",
    });
  }
  return daten;
}

// --- T1: EÜR-Grundszenario, Rechtsform, Vorjahr -------------------------------------------

test("euerJahr: Grundszenario 2026 — Einnahmen 119.000,00 €, Ausgaben 39.000,00 €, AfA 2.000,00 €, Gewinn 78.000,00 €", () => {
  const ergebnis = /** @type {any} */ (euerJahr({ daten: basisSzenario(), einst: EINST_EINZEL, saetze: SAETZE_2026, jahr: 2026 }));
  assert.equal(ergebnis.einnahmen, euroZuCent(119000));
  assert.equal(ergebnis.ausgaben, euroZuCent(39000));
  assert.equal(ergebnis.afa, euroZuCent(2000));
  assert.equal(ergebnis.gewinn, euroZuCent(78000));
  assert.ok(ergebnis.zeilen.some((z) => z.schluessel === "einnahmen_leistungen_netto" && z.betragCent === euroZuCent(100000)));
  assert.ok(ergebnis.zeilen.some((z) => z.schluessel === "einnahmen_leistungen_ust" && z.betragCent === euroZuCent(19000)));
  assert.ok(ergebnis.zeilen.some((z) => z.schluessel === "ausgaben_sonstiges_netto" && z.betragCent === euroZuCent(20000)));
  assert.ok(ergebnis.zeilen.some((z) => z.schluessel === "ausgaben_sonstiges_vst" && z.betragCent === euroZuCent(3800)));
  assert.ok(ergebnis.zeilen.some((z) => z.schluessel === "ausgaben_ust" && z.betragCent === euroZuCent(15200)));
  assert.ok(!ergebnis.zeilen.some((z) => z.schluessel.startsWith("ausgaben_fahrzeug")), "Pkw mit anlage_id zählt nicht als Ausgabe");
});

test("euerJahr: Kategorie „personal“ 3.000 € (steuerfrei) → Zeile „Löhne und Gehälter“, Gewinn sinkt auf 75.000,00 €", () => {
  const ergebnis = /** @type {any} */ (euerJahr({ daten: basisSzenario({ personal: 3000 }), einst: EINST_EINZEL, saetze: SAETZE_2026, jahr: 2026 }));
  assert.equal(ergebnis.gewinn, euroZuCent(75000));
  const zeile = ergebnis.zeilen.find((z) => z.schluessel === "ausgaben_personal");
  assert.ok(zeile);
  assert.equal(zeile.betragCent, euroZuCent(3000));
  assert.equal(zeileText("ausgaben_personal", (s) => s), "Löhne und Gehälter");
});

test("euerJahr: GmbH/UG — nur der Bilanz-Hinweis, keine Zeilen", () => {
  const gmbh = /** @type {any} */ (euerJahr({ daten: basisSzenario(), einst: { rechtsform: "gmbh" }, saetze: SAETZE_2026, jahr: 2026 }));
  assert.deepEqual(gmbh, { hinweis: "bilanzierung", ug: false });
  const ug = /** @type {any} */ (euerJahr({ daten: basisSzenario(), einst: { rechtsform: "ug" }, saetze: SAETZE_2026, jahr: 2026 }));
  assert.deepEqual(ug, { hinweis: "bilanzierung", ug: true });
});

test("euerJahr: Hinweis „feststellung“ bei GbR/PartG, „grenzen_141_ao“ nur über der Buchführungsgrenze", () => {
  const gbrKlein = /** @type {any} */ (euerJahr({ daten: basisSzenario(), einst: { rechtsform: "gbr", gewst_aktiv: true }, saetze: SAETZE_2026, jahr: 2026 }));
  assert.ok(gbrKlein.hinweise.includes("feststellung"));
  assert.ok(!gbrKlein.hinweise.includes("grenzen_141_ao"), "Umsatz 119.000 € und Gewinn 78.000 € liegen unter den Grenzen (800.000/80.000 €)");

  const einzelGross = { rechtsform: "einzelunternehmen", gewst_aktiv: true };
  const daten = basisSzenario();
  daten.Ausgangsrechnung[0].netto = 900000; daten.Ausgangsrechnung[0].ust = 171000; daten.Ausgangsrechnung[0].brutto = 1071000;
  daten.Ausgangsrechnung[0].zahlungen[0].betrag = 1071000;
  const ergebnis = /** @type {any} */ (euerJahr({ daten, einst: einzelGross, saetze: SAETZE_2026, jahr: 2026 }));
  assert.ok(ergebnis.hinweise.includes("grenzen_141_ao"), "Umsatz 900.000 € > 800.000 € löst den Hinweis aus");
  assert.ok(!ergebnis.hinweise.includes("feststellung"), "Einzelunternehmen braucht keine Feststellung");
});

test("aufteilung: Einzelunternehmen 100 % an die Inhaberin, kein Schlüssel", () => {
  const daten = { Gesellschafter: [{ id: "g-inhaber", name: "Inhaberin A", rolle: "inhaber", aktiv: true }] };
  const anteile = aufteilung(euroZuCent(78000), daten, EINST_EINZEL, 2026);
  assert.deepEqual(anteile, { "g-inhaber": euroZuCent(78000) });
});

test("aufteilung: GbR 60/40 → 46.800,00 €/31.200,00 €, Summe exakt", () => {
  const daten = { Gesellschafter: [
    { id: "g-a", name: "Gesellschafter A", rolle: "gesellschafter", aktiv: true },
    { id: "g-b", name: "Gesellschafter B", rolle: "gesellschafter", aktiv: true },
  ] };
  const einst = { rechtsform: "gbr", schluessel: { 2026: { "g-a": 60, "g-b": 40 } } };
  const anteile = /** @type {any} */ (aufteilung(euroZuCent(78000), daten, einst, 2026));
  assert.equal(anteile["g-a"], euroZuCent(46800));
  assert.equal(anteile["g-b"], euroZuCent(31200));
  assert.equal(anteile["g-a"] + anteile["g-b"], euroZuCent(78000));
});

test("aufteilung: GbR ohne (vollständigen) Schlüssel → {fehlt: \"schluessel\"}, kein NaN", () => {
  const daten = { Gesellschafter: [
    { id: "g-a", name: "Gesellschafter A", rolle: "gesellschafter", aktiv: true },
    { id: "g-b", name: "Gesellschafter B", rolle: "gesellschafter", aktiv: true },
  ] };
  const anteile = aufteilung(euroZuCent(78000), daten, { rechtsform: "gbr", schluessel: {} }, 2026);
  assert.deepEqual(anteile, { fehlt: "schluessel" });
});

test("vergleich: Vorjahresgewinn 70.000 € → Δ +8.000,00 € (+11,4 %)", () => {
  const ergebnis = /** @type {any} */ (vergleich(euroZuCent(78000), euroZuCent(70000)));
  assert.equal(ergebnis.deltaCent, euroZuCent(8000));
  assert.equal(ergebnis.prozent, 11.4);
});

test("vergleich: unbekanntes Vorjahr → null; Vorjahresgewinn 0 → prozent null (Delta trotzdem gesetzt)", () => {
  assert.equal(vergleich(euroZuCent(78000), null), null);
  const ergebnis = /** @type {any} */ (vergleich(euroZuCent(78000), 0));
  assert.equal(ergebnis.prozent, null);
  assert.equal(ergebnis.deltaCent, euroZuCent(78000));
});

test("vorjahr: ohne Buchungen im Vorjahr → einst.vorjahr_euer[jahr-1].gewinn; mit Buchungen → berechnet", () => {
  const leer = { Ausgangsrechnung: [], Eingangsrechnung: [], Steuerzahlung: [], Anlagegut: [] };
  const eingetragen = vorjahr(leer, { ...EINST_EINZEL, vorjahr_euer: { 2025: { gewinn: 70000 } } }, SAETZE_2026, 2026);
  assert.equal(eingetragen, euroZuCent(70000));

  const mitBuchungen2025 = basisSzenario();
  mitBuchungen2025.Ausgangsrechnung[0].zahlungen[0].datum = "2025-03-20";
  mitBuchungen2025.Eingangsrechnung.forEach((e) => { e.bezahlt_am = e.bezahlt_am.replace("2026", "2025"); });
  mitBuchungen2025.Steuerzahlung[0].zeitraum = { von: "2025-01-01", bis: "2025-03-31" };
  mitBuchungen2025.Steuerzahlung[0].bezahlt_am = "2025-04-08";
  mitBuchungen2025.Steuerzahlung.pop(); // die ESt-Zahlung stört hier nicht, aber unnötig
  const berechnet = vorjahr(mitBuchungen2025, EINST_EINZEL, saetzeZum("2025-12-31"), 2026);
  assert.equal(berechnet, euroZuCent(78000));
});

// --- T2/T3: 10-Tage-Regel § 11 Abs. 2 S. 2 EStG -------------------------------------------

test("steuerzahlungJahr: USt-VA 12/2027 (Nenntermin Mo 10.01.2028) — gezahlt 10.01.2028 → 2027, gezahlt 12.01.2028 → 2028", () => {
  const basis = { art: "ust", zeitraum: { von: "2027-12-01", bis: "2027-12-31" } };
  assert.equal(steuerzahlungJahr({ ...basis, bezahlt_am: "2028-01-10" }, { dauerfrist: false }), 2027);
  assert.equal(steuerzahlungJahr({ ...basis, bezahlt_am: "2028-01-12" }, { dauerfrist: false }), 2028);
});

test("steuerzahlungJahr: mit Dauerfristverlängerung greift die 10-Tage-Regel nie (Nenntermin liegt im Februar)", () => {
  const basis = { art: "ust", zeitraum: { von: "2027-12-01", bis: "2027-12-31" }, bezahlt_am: "2028-01-05" };
  assert.equal(steuerzahlungJahr(basis, { dauerfrist: true }), 2028);
});

test("steuerzahlungJahr: SVZ und Nicht-Dezember-Perioden zählen immer im Zahlungsjahr; unbezahlt → null", () => {
  assert.equal(steuerzahlungJahr({ art: "ust_svz", zeitraum: null, bezahlt_am: "2027-02-10" }, {}), 2027);
  assert.equal(steuerzahlungJahr({ art: "ust", zeitraum: { von: "2027-01-01", bis: "2027-03-31" }, bezahlt_am: "2027-04-10" }, {}), 2027);
  assert.equal(steuerzahlungJahr({ art: "ust", zeitraum: { von: "2027-12-01", bis: "2027-12-31" } }, {}), null);
});

// --- Text-Helfer (i18n guard) --------------------------------------------------------------

test("zeileText/hinweisText: literale t()-Aufrufe, auch für unbekannte Kategorie-Zeilen", () => {
  for (const s of ["einnahmen_leistungen_netto", "einnahmen_leistungen_ust", "einnahmen_nutzungsentnahme_netto",
    "einnahmen_ust_erstattung", "ausgaben_personal", "ausgaben_kilometergeld", "ausgaben_ust", "ausgaben_gewst", "afa",
    "ausgaben_miete_netto", "ausgaben_miete_vst"]) {
    assert.equal(typeof zeileText(s, (k) => k), "string");
  }
  for (const s of ["feststellung", "grenzen_141_ao"]) assert.equal(typeof hinweisText(s, (k) => k), "string");
});

test("euerTabelle: Tabellenmodell mit Zeilen + Gewinn-Zeile; Bilanz-Rechtsform exportiert einen Hinweis", () => {
  const t = (/** @type {string} */ s) => s;
  const modell = euerTabelle({ daten: basisSzenario(), einst: EINST_EINZEL, saetze: SAETZE_2026, jahr: 2026 }, t);
  assert.equal(modell.zeilen.at(-1).zeile, "Gewinn");
  assert.equal(modell.zeilen.at(-1).betrag, 78000);

  const gmbhModell = euerTabelle({ daten: basisSzenario(), einst: { rechtsform: "gmbh" }, saetze: SAETZE_2026, jahr: 2026 }, t);
  assert.equal(gmbhModell.zeilen.length, 1);
});
