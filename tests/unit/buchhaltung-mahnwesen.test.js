// Unit tests of dunning (79-03 T1, BUCH-06): overdue list, default-interest
// start, interest split at every base-rate change, the flat fee and the
// dunning levels — every <behavior> figure of 79-03-PLAN.md.
//
// In:  src/lib/accounting/mahnwesen.js. Out: assertions only.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  basiszinsStandWarnung, faelligeMahnstufe, forderungAm, mahnTabelle, mahnTextFelder, naechsteMahnstufe, pauschale, ueberfaellige,
  verzugsbeginn, verzugszinsen,
} from "@/lib/accounting/mahnwesen.js";
import { BUERO_STANDARD } from "@/lib/accounting/einstellungen.js";
import { formatEuro } from "@/lib/accounting/geld.js";

const STUFEN = BUERO_STANDARD.mahnstufen;

test("verzugszinsen: 10.000 € Unternehmer 01.06.–31.07.2026 = 173,76 € (30 T × 10,27 % + 31 T × 10,52 %)", () => {
  const r = verzugszinsen(1000000, "2026-06-01", "2026-07-31", "unternehmer");
  assert.equal(r.cent, 17376);
  assert.deepEqual(r.perioden.map((p) => [p.von, p.bis, p.tage, p.cent]), [
    ["2026-06-01", "2026-06-30", 30, 8441],
    ["2026-07-01", "2026-07-31", 31, 8935],
  ]);
});

test("verzugszinsen: derselbe Zeitraum an einen Verbraucher = 106,91 € (51,53 € + 55,38 €), +5 Pp statt +9 Pp", () => {
  const r = verzugszinsen(1000000, "2026-06-01", "2026-07-31", "verbraucher");
  assert.equal(r.cent, 10691);
  assert.deepEqual(r.perioden.map((p) => p.cent), [5153, 5538]);
});

test("verzugszinsen: Split am 01.01.2027 — ohne neuen Wert gilt der letzte bekannte Basiszins (01.07.2026)", () => {
  const r = verzugszinsen(1000000, "2026-12-01", "2027-01-31", "unternehmer");
  assert.deepEqual(r.perioden.map((p) => [p.von, p.bis, p.basiszins]), [
    ["2026-12-01", "2026-12-31", 1.52],
    ["2027-01-01", "2027-01-31", 1.52],
  ]);
});

test("verzugszinsen: E-12-Beispiel — 14 Tage Standardziel, Verzug ab Tag 15, bis 31.07.2026 = 131,56 €", () => {
  const r = verzugszinsen(1000000, "2026-06-16", "2026-07-31", "unternehmer");
  assert.equal(r.cent, 13156);
  assert.deepEqual(r.perioden.map((p) => [p.tage, p.cent]), [[15, 4221], [31, 8935]]);
});

test("verzugszinsen: vor Verzugsbeginn keine Zinsen, ungültiger Zeitraum liefert 0", () => {
  assert.equal(verzugszinsen(1000000, "2026-07-31", "2026-06-01", "unternehmer").cent, 0);
  assert.equal(verzugszinsen(0, "2026-06-01", "2026-07-31", "unternehmer").cent, 0);
});

test("pauschale: 40,00 € nur bei Unternehmer/öffentlich, nicht doppelt, nie bei Verbrauchern", () => {
  assert.equal(pauschale({ mahnungen: [] }, "unternehmer"), 4000);
  assert.equal(pauschale({ mahnungen: [] }, "oeffentlich"), 4000);
  assert.equal(pauschale({ mahnungen: [] }, "verbraucher"), 0);
  assert.equal(pauschale({ mahnungen: [{ stufe: 1, pauschale: 40 }] }, "unternehmer"), 0, "zweite Mahnung addiert keine zweite Pauschale");
});

test("verzugsbeginn: vertragliches Ziel — Tag nach Fälligkeit, unabhängig von Bauherr-Art", () => {
  const rechnung = { faellig_am: "2026-05-31" };
  const vertrag = { zahlungsziel_vertraglich: true };
  assert.deepEqual(verzugsbeginn(rechnung, vertrag, "unternehmer"), { datum: "2026-06-01", quelle: "vertrag" });
});

test("verzugsbeginn: ohne vertragliches Ziel, Unternehmer, keine Mahnung — 30-Tage-Regel (Fälligkeit + 31 Tage)", () => {
  const rechnung = { faellig_am: "2026-05-31" };
  assert.deepEqual(verzugsbeginn(rechnung, null, "unternehmer"), { datum: "2026-07-01", quelle: "30_tage" });
});

test("verzugsbeginn: Mahnung Stufe 1 am 10.06.2026 kommt früher als die 30-Tage-Regel — Quelle „mahnung“", () => {
  const rechnung = { faellig_am: "2026-05-31", mahnungen: [{ stufe: 1, datum: "2026-06-10" }] };
  assert.deepEqual(verzugsbeginn(rechnung, null, "unternehmer"), { datum: "2026-06-11", quelle: "mahnung" });
});

test("verzugsbeginn: Verbraucher ohne Verzugshinweis und ohne Mahnung — kein Verzug", () => {
  const rechnung = { faellig_am: "2026-05-31" };
  assert.deepEqual(verzugsbeginn(rechnung, null, "verbraucher"), { datum: null, quelle: null });
});

test("verzugsbeginn: Verbraucher MIT Verzugshinweis — die 30-Tage-Regel gilt wie bei Unternehmern", () => {
  const rechnung = { faellig_am: "2026-05-31", verzugshinweis: true };
  assert.deepEqual(verzugsbeginn(rechnung, null, "verbraucher"), { datum: "2026-07-01", quelle: "30_tage" });
});

test("verzugsbeginn: Verbraucher ohne Hinweis, aber mit Mahnung Stufe 1 — die Mahnung löst trotzdem aus", () => {
  const rechnung = { faellig_am: "2026-05-31", mahnungen: [{ stufe: 1, datum: "2026-06-10" }] };
  assert.deepEqual(verzugsbeginn(rechnung, null, "verbraucher"), { datum: "2026-06-11", quelle: "mahnung" });
});

test("verzugsbeginn: keine ermittelbare Fälligkeit — null", () => {
  assert.deepEqual(verzugsbeginn({}, null, "unternehmer"), { datum: null, quelle: null });
});

test("faelligeMahnstufe: Standardwerte, fällig 31.08.2026 — Stufe 1 ab 07.09., Frist bis 17.09.; davor null", () => {
  const rechnung = { faellig_am: "2026-08-31", mahnungen: [] };
  assert.equal(faelligeMahnstufe(rechnung, "2026-09-06", STUFEN), null, "noch nicht fällig");
  assert.deepEqual(faelligeMahnstufe(rechnung, "2026-09-07", STUFEN), { stufe: 1, ab: "2026-09-07", frist: "2026-09-17" });
  assert.deepEqual(faelligeMahnstufe(rechnung, "2026-09-27", STUFEN), { stufe: 1, ab: "2026-09-07", frist: "2026-09-17" }, "bleibt fällig, bis Stufe 1 erstellt wird");
});

test("faelligeMahnstufe: nach Stufe 1 am 07.09. — Stufe 2 ab 21.09., Frist bis 28.09.; davor null", () => {
  const rechnung = { faellig_am: "2026-08-31", mahnungen: [{ stufe: 1, datum: "2026-09-07", frist: "2026-09-17" }] };
  assert.equal(faelligeMahnstufe(rechnung, "2026-09-20", STUFEN), null);
  assert.deepEqual(faelligeMahnstufe(rechnung, "2026-09-21", STUFEN), { stufe: 2, ab: "2026-09-21", frist: "2026-09-28" });
});

test("faelligeMahnstufe: nach Stufe 2 am 21.09. — Stufe 3 ab 05.10., Frist bis 12.10.", () => {
  const rechnung = {
    faellig_am: "2026-08-31",
    mahnungen: [{ stufe: 1, datum: "2026-09-07" }, { stufe: 2, datum: "2026-09-21" }],
  };
  assert.deepEqual(faelligeMahnstufe(rechnung, "2026-10-05", STUFEN), { stufe: 3, ab: "2026-10-05", frist: "2026-10-12" });
});

test("faelligeMahnstufe: nach Stufe 3 — null, unabhängig vom Datum", () => {
  const rechnung = {
    faellig_am: "2026-08-31",
    mahnungen: [{ stufe: 1, datum: "2026-09-07" }, { stufe: 2, datum: "2026-09-21" }, { stufe: 3, datum: "2026-10-05" }],
  };
  assert.equal(faelligeMahnstufe(rechnung, "2027-01-01", STUFEN), null);
});

test("faelligeMahnstufe: ohne Fälligkeit — null", () => {
  assert.equal(faelligeMahnstufe({}, "2026-09-27", STUFEN), null);
});

test("naechsteMahnstufe: zeigt die nächste Stufe schon VOR ihrem Fälligkeitsdatum (Vorschau-Spalte)", () => {
  const rechnung = { faellig_am: "2026-08-31", mahnungen: [{ stufe: 1, datum: "2026-09-07" }, { stufe: 2, datum: "2026-09-21" }] };
  // Stufe 3 wäre erst ab 2026-10-05 fällig — faelligeMahnstufe meldet an einem früheren Tag null,
  // naechsteMahnstufe zeigt sie trotzdem an (Vorschau für die Liste).
  assert.equal(faelligeMahnstufe(rechnung, "2026-09-27", STUFEN), null);
  assert.deepEqual(naechsteMahnstufe(rechnung, STUFEN), { stufe: 3, ab: "2026-10-05", frist: "2026-10-12" });
});

test("naechsteMahnstufe: nach Stufe 3 — null; ohne Fälligkeit — null", () => {
  const nachStufe3 = {
    faellig_am: "2026-08-31",
    mahnungen: [{ stufe: 1, datum: "2026-09-07" }, { stufe: 2, datum: "2026-09-21" }, { stufe: 3, datum: "2026-10-05" }],
  };
  assert.equal(naechsteMahnstufe(nachStufe3, STUFEN), null);
  assert.equal(naechsteMahnstufe({}, STUFEN), null);
});

test("ueberfaellige: nur gestellte, nicht voll bezahlte Rechnungen mit Fälligkeit vor heute", () => {
  const daten = [
    { status: "gestellt", brutto: 1000, faellig_am: "2026-09-01", zahlungen: [] }, // überfällig
    { status: "gestellt", brutto: 1000, faellig_am: "2026-09-01", zahlungen: [{ datum: "2026-08-01", betrag: 1000 }] }, // bezahlt
    { status: "gestellt", brutto: 1000, faellig_am: "2026-12-01", zahlungen: [] }, // noch nicht fällig
    { status: "entwurf", brutto: 1000, faellig_am: "2026-09-01", zahlungen: [] }, // kein Entwurf
    { status: "storniert", brutto: 1000, faellig_am: "2026-09-01", zahlungen: [] }, // storniert
  ];
  const r = ueberfaellige(daten, "2026-09-27");
  assert.equal(r.length, 1);
  assert.equal(r[0].faellig_am, "2026-09-01");
});

test("basiszinsStandWarnung: aktuell (heute 2026-09-27) — kein Hinweis; ab 01.01.2027 — Stand 01.07.2026", () => {
  assert.equal(basiszinsStandWarnung("2026-09-27"), null);
  assert.equal(basiszinsStandWarnung("2027-01-02"), "2026-07-01");
  assert.equal(basiszinsStandWarnung("2027-01-01"), "2026-07-01");
});

// --- mahnTextFelder --------------------------------------------------------

const T = (s) => s; // no-op translator for the tests (keys ARE the German text)

const RECHNUNG_STUFE1 = {
  nummer: "RE-2026-005", rechnungsdatum: "2026-05-17", brutto: 10000, netto: 8403.36, ust: 1596.64, ust_satz: 19,
  faellig_am: "2026-05-31", zahlungen: [], mahnungen: [],
  empfaenger: { name: "Beispiel Immobilien GmbH", anschrift: "Musterstraße 1\n90402 Nürnberg", art: "unternehmer" },
};

test("mahnTextFelder: Stufe 1 — Betreff „Zahlungserinnerung“, kein Pauschale-Hinweis (noch keine Zinsen vor Verzugsbeginn)", () => {
  const ctx = { heute: "2026-05-20", einst: { mahnstufen: STUFEN }, briefkopf: {}, vertrag: null };
  const f = mahnTextFelder(RECHNUNG_STUFE1, 1, ctx, T);
  assert.equal(f.betreff, "Zahlungserinnerung");
  assert.equal(f.zinsenCent, 0, "vor dem Verzugsbeginn fallen keine Zinsen an");
  assert.equal(f.pauschaleCent, 0, "vor dem Verzugsbeginn auch keine Pauschale");
  assert.ok(f.absaetze.every((a) => !a.includes("{")), "keine offenen Platzhalter im Text");
  assert.deepEqual(f.empfaengerZeilen, ["Beispiel Immobilien GmbH", "Musterstraße 1", "90402 Nürnberg"]);
});

test("mahnTextFelder: Stufe 2 — Betreff „Mahnung“, Forderungsaufstellung nennt Zinsen und Summe", () => {
  const ctx = { heute: "2026-09-27", einst: { mahnstufen: STUFEN }, briefkopf: { office: "Testbüro" }, vertrag: null, frist: "2026-10-05" };
  const f = mahnTextFelder(RECHNUNG_STUFE1, 2, ctx, T);
  assert.equal(f.betreff, "Mahnung");
  assert.ok(f.zinsenCent > 0);
  assert.equal(f.summeCent, f.offenCent + f.zinsenCent + f.pauschaleCent);
  const labels = f.tabelle.zeilen.map((z) => z[0]);
  assert.ok(labels.includes("Offener Betrag") && labels.includes("Summe"));
  assert.ok(f.absaetze.some((a) => a.includes("05.10.2026")), "übergebene Frist (ctx.frist) erscheint im Text");
});

test("mahnTextFelder: Stufe 3 — Betreff „Letzte Mahnung“, kündigt das gerichtliche Mahnverfahren an", () => {
  const ctx = { heute: "2026-09-27", einst: { mahnstufen: STUFEN }, briefkopf: {}, vertrag: null, frist: "2026-10-05" };
  const f = mahnTextFelder(RECHNUNG_STUFE1, 3, ctx, T);
  assert.equal(f.betreff, "Letzte Mahnung");
  assert.ok(f.absaetze.some((a) => a.includes("gerichtlichen Mahnverfahrens")));
});

test("mahnTextFelder: Pauschale erscheint bei Unternehmer in der Forderungsaufstellung, bei Verbraucher (5 Pp) nicht", () => {
  const ctxU = { heute: "2026-09-27", einst: { mahnstufen: STUFEN }, briefkopf: {}, vertrag: null, frist: "2026-10-05" };
  const fU = mahnTextFelder(RECHNUNG_STUFE1, 2, ctxU, T);
  assert.ok(fU.tabelle.zeilen.some((z) => z[0] === "Pauschale"));

  const verbraucher = { ...RECHNUNG_STUFE1, empfaenger: { ...RECHNUNG_STUFE1.empfaenger, art: "verbraucher" }, verzugshinweis: true };
  const fV = mahnTextFelder(verbraucher, 2, ctxU, T);
  assert.ok(!fV.tabelle.zeilen.some((z) => z[0] === "Pauschale"));
  assert.ok(fV.zinsenCent < fU.zinsenCent, "5 Pp statt 9 Pp — weniger Zinsen für den Verbraucher");
});

// --- Pauschale erst ab Verzug (Review 79-03, § 288 Abs. 5 BGB „bei Verzug") --

const VOR_VERZUG = {
  nummer: "RE-2026-020", rechnungsdatum: "2026-08-18", brutto: 5000, netto: 4201.68, ust: 798.32, ust_satz: 19,
  faellig_am: "2026-09-01", zahlungen: [], mahnungen: [],
  empfaenger: { name: "Beispiel Immobilien GmbH", anschrift: "Musterstraße 1\n90402 Nürnberg", art: "unternehmer" },
};

test("forderungAm: Unternehmer 9 Tage überfällig, kein vertragliches Ziel, keine Mahnung — weder Zinsen noch Pauschale", () => {
  const f = forderungAm(VOR_VERZUG, null, "2026-09-10");
  assert.deepEqual(f.verzugsbeginn, { datum: "2026-10-02", quelle: "30_tage" });
  assert.equal(f.offenCent, 500000);
  assert.equal(f.zinsen.cent, 0);
  assert.equal(f.pauschaleCent, 0, "vor Verzugsbeginn keine Pauschale");
  assert.ok(faelligeMahnstufe(VOR_VERZUG, "2026-09-10", STUFEN), "Stufe 1 ist an diesem Tag schon fällig (Knopf sichtbar)");
});

test("forderungAm: am Tag des Verzugsbeginns (30-Tage-Regel) — Zinsen für 1 Tag und 40,00 € Pauschale", () => {
  const f = forderungAm(VOR_VERZUG, null, "2026-10-02");
  assert.equal(f.pauschaleCent, 4000);
  assert.ok(f.zinsen.cent > 0);
  assert.equal(forderungAm(VOR_VERZUG, null, "2026-10-01").pauschaleCent, 0, "am Vortag noch nicht");
});

test("forderungAm: vertragliches Zahlungsziel — Pauschale ab dem Tag nach Fälligkeit, am Fälligkeitstag nicht", () => {
  const vertrag = { zahlungsziel_vertraglich: true };
  assert.equal(forderungAm(VOR_VERZUG, vertrag, "2026-09-01").pauschaleCent, 0);
  assert.equal(forderungAm(VOR_VERZUG, vertrag, "2026-09-02").pauschaleCent, 4000);
});

test("forderungAm: Bauherr-Art aus dem Vertrag, wenn die Rechnung keine trägt — Verbraucher nie mit Pauschale", () => {
  const ohneArt = { ...VOR_VERZUG, empfaenger: { name: "Bauherrschaft A" } };
  const f = forderungAm(ohneArt, { zahlungsziel_vertraglich: true, bauherr_art: "verbraucher" }, "2026-09-10");
  assert.equal(f.bauherrArt, "verbraucher");
  assert.ok(f.zinsen.cent > 0, "im Verzug laufen Zinsen");
  assert.equal(f.pauschaleCent, 0);
});

test("mahnTextFelder: Stufe 1 vor Verzugsbeginn — keine Pauschale-Zeile, Summe = offener Betrag, pauschaleCent 0 (wird so gespeichert)", () => {
  const ctx = { heute: "2026-09-10", einst: { mahnstufen: STUFEN }, briefkopf: {}, vertrag: null };
  const f = mahnTextFelder(VOR_VERZUG, 1, ctx, T);
  assert.equal(f.pauschaleCent, 0);
  assert.equal(f.zinsenCent, 0);
  assert.equal(f.summeCent, 500000);
  assert.ok(!f.tabelle.zeilen.some((z) => z[0] === "Pauschale"), "keine Pauschale in der Forderungsaufstellung");
  assert.deepEqual(f.tabelle.zeilen.at(-1), ["Summe", formatEuro(500000)]);
});

test("mahnTextFelder: Stufe 2 nach einer Stufe 1 ohne Pauschale — Verzug seit der Mahnung, jetzt 40,00 € Pauschale", () => {
  const nachStufe1 = { ...VOR_VERZUG, mahnungen: [{ stufe: 1, datum: "2026-09-10", frist: "2026-09-20", zinsen: 0, pauschale: 0 }] };
  const ctx = { heute: "2026-09-24", einst: { mahnstufen: STUFEN }, briefkopf: {}, vertrag: null };
  const f = mahnTextFelder(nachStufe1, 2, ctx, T);
  assert.deepEqual(f.verzugsbeginn, { datum: "2026-09-11", quelle: "mahnung" });
  assert.equal(f.pauschaleCent, 4000, "eine Stufe-1-Mahnung mit 0 € sperrt die Pauschale nicht");
  assert.ok(f.tabelle.zeilen.some((z) => z[0] === "Pauschale"));
  assert.equal(f.summeCent, f.offenCent + f.zinsenCent + 4000);
});

// --- mahnTabelle -------------------------------------------------------------

test("mahnTabelle: Titel, Spalten und Zeilen aus den vorbereiteten Zeilen", () => {
  const zeilen = [{
    rechnung: { nummer: "RE-2026-005", project_name: "Testprojekt", empfaenger: { name: "Beispiel Immobilien GmbH" } },
    tageUeberFaellig: 45,
    offenCent: 1000000,
    letzteStufe: { stufe: 1, datum: "2026-08-28" },
    faelligeStufe: { stufe: 2, ab: "2026-09-11" },
    zinsenCent: 17376,
    pauschaleCent: 4000,
  }];
  const m = mahnTabelle(zeilen, T);
  assert.equal(m.titel, "Mahnwesen");
  assert.deepEqual(m.spalten.map((s) => s.key), ["nummer", "projekt", "empfaenger", "tage_ueberfaellig", "offen", "stufe", "zinsen", "pauschale", "summe"]);
  assert.deepEqual(m.zeilen, [{
    nummer: "RE-2026-005", projekt: "Testprojekt", empfaenger: "Beispiel Immobilien GmbH",
    tage_ueberfaellig: 45, offen: 10000, stufe: 1, zinsen: 173.76, pauschale: 40, summe: 10213.76,
  }]);
});
