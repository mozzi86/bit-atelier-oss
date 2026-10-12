// Phase 81 (81-02): pure libraries of the time tracking — week grid, target vs.
// actual, week status, bookable rows, rows of the previous week, device timer,
// working-day frame (ArbZG hints) and the export model.
//
// In:  src/lib/zeit/{zeitAnsicht,timer,arbeitszeit,zeitExport}.js, 79's CSV writer.
// Out: assertions only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buchbareZeilen, sollIst, uebernimmVorwoche, wochenMatrix, wochenStatus, zeilenSchluessel } from "@/lib/zeit/zeitAnsicht.js";
import { leseTimer, starteTimer, stoppeTimer, timerMinuten, TIMER_SCHLUESSEL } from "@/lib/zeit/timer.js";
import { pruefeTagesrahmen } from "@/lib/zeit/arbeitszeit.js";
import { gefilterteBuchungen, zeitTabelle } from "@/lib/zeit/zeitExport.js";
import { tabelleAlsCsv } from "@/lib/accounting/tabellenExport.js";
import { feiertage, KALENDER_STANDARD } from "@core/lib/kalender/feiertage.js";

const FEI = feiertage(2026, KALENDER_STANDARD);

test("sollIst: Vertrag 40 h / 5 Tage, Pfingstmontag, Teilzeit an den ersten Wochentagen, Tagessoll ohne Vertrag", () => {
  const kw40 = sollIst({ jahr: 2026, woche: 40 }, { vertrag: { wochenstunden: 40, arbeitstage_woche: 5 }, feiertage: FEI });
  assert.equal(kw40.tage.length, 7);
  assert.equal(kw40.tage[0].datum, "2026-09-28");
  assert.equal(kw40.soll, 2400);
  assert.equal(kw40.sollQuelle, "vertrag");
  const kw22 = sollIst({ jahr: 2026, woche: 22 }, { vertrag: { wochenstunden: 40, arbeitstage_woche: 5 }, feiertage: FEI });
  assert.equal(kw22.soll, 1920);
  assert.equal(kw22.tage[0].feiertag, true, "Pfingstmontag");
  const teilzeit = sollIst({ jahr: 2026, woche: 40 }, { vertrag: { wochenstunden: 24, arbeitstage_woche: 3 }, feiertage: FEI });
  assert.equal(teilzeit.soll, 1440);
  assert.deepEqual(teilzeit.tage.map((t) => t.soll), [480, 480, 480, 0, 0, 0, 0]);
  const solo = sollIst({ jahr: 2026, woche: 40 }, { vertrag: null, tagessollMinuten: 480, feiertage: FEI, istMinuten: [600, 0, 0, 0, 0, 0, 0] });
  assert.equal(solo.soll, 2400);
  assert.equal(solo.sollQuelle, "tagessoll");
  assert.equal(solo.ist, 600);
  assert.equal(solo.diff, -1800);
  assert.equal(sollIst({ jahr: 2026, woche: 22 }, { tagessollMinuten: 480, feiertage: FEI }).soll, 1920);
});

const B = (o) => ({ mitarbeiter_id: "m1", status: "entwurf", leistung: "grund", kategorie_intern: null, honorarnachtrag_id: null, ...o });

test("wochenMatrix: Projektzeilen, Bürozeit als eigene Zeile, abgelehnte nicht in den Summen", () => {
  const buchungen = [
    B({ id: "1", project_id: "p1", lph: 5, datum: "2026-09-28", minuten: 120 }),
    B({ id: "2", project_id: "p1", lph: 5, datum: "2026-09-29", minuten: 60 }),
    B({ id: "3", project_id: null, lph: null, leistung: null, kategorie_intern: "verwaltung", datum: "2026-09-28", minuten: 30 }),
    B({ id: "4", project_id: "p2", lph: 3, datum: "2026-09-30", minuten: 45, status: "abgelehnt" }),
    B({ id: "5", project_id: "p1", lph: 5, datum: "2026-09-28", minuten: 90, mitarbeiter_id: "m2" }),
    B({ id: "6", project_id: "p1", lph: 5, datum: "2026-10-05", minuten: 90 }),
  ];
  const m = wochenMatrix(buchungen, { mitarbeiterId: "m1", jahr: 2026, woche: 40 });
  assert.equal(m.zeilen.length, 3);
  const projekt = m.zeilen.find((z) => z.project_id === "p1");
  assert.deepEqual(projekt?.tage, [120, 60, 0, 0, 0, 0, 0]);
  const buero = m.zeilen.find((z) => z.kategorie_intern === "verwaltung");
  assert.deepEqual(buero?.tage, [30, 0, 0, 0, 0, 0, 0]);
  assert.equal(m.zeilen[m.zeilen.length - 1], buero, "Bürozeit zuletzt");
  assert.deepEqual(m.tagesSummen, [150, 60, 0, 0, 0, 0, 0]);
  assert.equal(m.summe, 210);
  assert.equal(m.zeilen.find((z) => z.project_id === "p2")?.buchungen[2][0].id, "4", "abgelehnte bleibt sichtbar");
});

test("wochenStatus", () => {
  assert.equal(wochenStatus([]), "leer");
  assert.equal(wochenStatus([{ status: "entwurf" }, {}]), "entwurf");
  assert.equal(wochenStatus([{ status: "entwurf" }, { status: "eingereicht" }]), "gemischt");
  assert.equal(wochenStatus([{ status: "freigegeben" }]), "freigegeben");
});

test("buchbareZeilen: Zuordnung zuerst, dann zuletzt benutzt; ohne Zuordnung alle Projekte; Archiv fehlt", () => {
  const projekte = [{ id: "a", name: "Alpha" }, { id: "b", name: "Beta" }, { id: "c", name: "Cäsar" }, { id: "d", name: "Delta", archiviert_am: "2026-01-01" }];
  const m2 = { id: "m2", projekt_zuordnungen: [{ project_id: "c", funktion: "Projektleitung", von: "2026-01-01" }] };
  const buchungen = [{ mitarbeiter_id: "m2", project_id: "b", datum: "2026-09-20" }];
  const r = buchbareZeilen(projekte, [m2], buchungen, { mitarbeiterId: "m2", stichtagIso: "2026-09-28" });
  assert.deepEqual(r.map((x) => x.projekt.id), ["c", "b", "a"]);
  assert.deepEqual(r.map((x) => x.nichtZugeordnet), [false, true, true]);
  const solo = buchbareZeilen(projekte, [], [], { mitarbeiterId: "inhaber", stichtagIso: "2026-09-28" });
  assert.deepEqual(solo.map((x) => x.projekt.id), ["a", "b", "c"]);
  assert.ok(solo.every((x) => !x.nichtZugeordnet), "E-17: alle Projekte ohne Hinweis");
});

test("uebernimmVorwoche: Zeilenschlüssel der Vorwoche ohne Minuten", () => {
  const buchungen = [
    B({ project_id: "p1", lph: 5, datum: "2026-09-22", minuten: 120 }),
    B({ project_id: "p1", lph: 5, datum: "2026-09-23", minuten: 60 }),
    B({ project_id: null, lph: null, leistung: null, kategorie_intern: "verwaltung", datum: "2026-09-25", minuten: 60 }),
    B({ project_id: "p9", lph: 1, datum: "2026-09-15", minuten: 60 }),
  ];
  const r = uebernimmVorwoche(buchungen, { mitarbeiterId: "m1", jahr: 2026, woche: 40 });
  assert.equal(r.length, 2);
  assert.ok(r.some((z) => z.schluessel === zeilenSchluessel({ project_id: "p1", lph: 5, leistung: "grund" })));
  assert.ok(r.every((z) => !("minuten" in z)));
});

test("timerMinuten: aufrunden aufs Raster, unter 60 s keine Buchung", () => {
  const start = Date.UTC(2026, 8, 28, 7, 0, 0);
  assert.equal(timerMinuten(start, start + 7 * 60000, 15), 15);
  assert.equal(timerMinuten(start, start + 16 * 60000, 15), 30);
  assert.equal(timerMinuten(start, start + 40000, 15), 0);
  assert.equal(timerMinuten(start, start + 60 * 60000, 15), 60);
});

test("Timer im Gerätespeicher: starten, lesen, stoppen; werfender Speicher → nicht verfügbar", () => {
  /** @type {Map<string, string>} */
  const m = new Map();
  const speicher = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, removeItem: (k) => { m.delete(k); } };
  assert.deepEqual(leseTimer(speicher), { verfuegbar: true, laeuft: false, daten: null });
  assert.deepEqual(starteTimer(speicher, { mitarbeiter_id: "inhaber", project_id: "p1", lph: 5 }, 1000), { ok: true });
  assert.ok(m.has(TIMER_SCHLUESSEL));
  const t = leseTimer(speicher);
  assert.equal(t.laeuft, true);
  assert.equal(t.daten?.start_ms, 1000);
  assert.equal(stoppeTimer(speicher).daten?.project_id, "p1");
  assert.equal(leseTimer(speicher).laeuft, false);
  const wirft = { getItem: () => { throw new Error("blockiert"); }, setItem: () => { throw new Error("blockiert"); }, removeItem: () => {} };
  assert.deepEqual(leseTimer(wirft), { verfuegbar: false, laeuft: false, daten: null });
  assert.deepEqual(starteTimer(wirft, {}, 1), { ok: false });
  assert.deepEqual(leseTimer(null), { verfuegbar: false, laeuft: false, daten: null });
});

test("pruefeTagesrahmen: § 3, § 4, § 5 ArbZG und Projektzeit über dem Rahmen — nur Hinweise", () => {
  const lang = pruefeTagesrahmen({ beginn: "08:00", ende: "19:30", pause_minuten: 20 });
  assert.equal(lang.netto_minuten, 670);
  assert.deepEqual(lang.hinweise.map((h) => h.regel), ["arbzg_3", "arbzg_4"]);
  assert.deepEqual(pruefeTagesrahmen({ beginn: "08:00", ende: "16:30", pause_minuten: 30 }).hinweise, []);
  const ruhe = pruefeTagesrahmen({ beginn: "08:00", ende: "16:30", pause_minuten: 30 }, { vortagEnde: "23:00" });
  assert.deepEqual(ruhe.hinweise.map((h) => h.regel), ["arbzg_5"]);
  assert.equal(ruhe.hinweise[0].werte.stunden, "9");
  const projekt = pruefeTagesrahmen({ beginn: "08:00", ende: "19:30", pause_minuten: 20 }, { projektMinuten: 700 });
  assert.ok(projekt.hinweise.some((h) => h.regel === "projektzeit"));
  assert.equal(pruefeTagesrahmen({ beginn: "8", ende: "16:00" }).netto_minuten, null);
  assert.equal(pruefeTagesrahmen({ beginn: "16:00", ende: "08:00" }).hinweise[0].regel, "reihenfolge");
  assert.deepEqual(pruefeTagesrahmen({ beginn: "08:00", ende: "15:00", pause_minuten: 0 }).hinweise.map((h) => h.regel), ["arbzg_4"], "über 6 h ohne Pause");
});

test("zeitTabelle: Spalten, Stunden als Zahl, Inhaber/in, CSV mit BOM und Semikolon; abgelehnte nur auf Wunsch", () => {
  const buchungen = [
    B({ id: "1", mitarbeiter_id: "inhaber", project_id: "p1", lph: 5, datum: "2026-09-28", kw: "2026-W40", minuten: 90, status: "freigegeben" }),
    B({ id: "2", mitarbeiter_id: "P-3", project_id: null, lph: null, leistung: null, kategorie_intern: "verwaltung", datum: "2026-09-29", kw: "2026-W40", minuten: 60 }),
    B({ id: "3", mitarbeiter_id: "P-3", project_id: "p1", lph: 5, datum: "2026-09-30", minuten: 30, status: "abgelehnt" }),
  ];
  const t = (s) => s;
  const modell = zeitTabelle(buchungen, { mitarbeiter: [{ id: "P-3", vorname: "Mitarbeiterin", nachname: "B", personalnummer: "P-3" }], projekte: [{ id: "p1", name: "Projekt Eins" }], filter: { monat: "2026-09" } }, t);
  assert.deepEqual(modell.spalten.map((s) => s.label), ["Datum", "KW", "Mitarbeiter:in", "Kürzel", "Projekt", "LPH", "Leistung", "Stunden", "Status", "Notiz"]);
  assert.equal(modell.zeilen.length, 2, "abgelehnte nicht ohne Statusfilter");
  assert.equal(modell.zeilen[0].stunden, 1.5);
  assert.equal(modell.zeilen[0].mitarbeiter, "Inhaber/in");
  assert.equal(modell.zeilen[1].leistung, "Bürozeit: Verwaltung");
  const csv = tabelleAlsCsv(modell);
  assert.deepEqual([...new TextEncoder().encode(csv).subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.ok(csv.includes("Datum;KW;Mitarbeiter:in;Kürzel;Projekt;LPH;Leistung;Stunden;Status;Notiz"));
  assert.ok(csv.includes(";1,5;"), "Dezimalkomma");
  assert.equal(gefilterteBuchungen(buchungen, { status: ["abgelehnt"] }).length, 1);
});

// --- 82-04: approved absences and the holiday setting -----------------------
import { kalenderEinstellung } from "@/lib/abwesenheit/kalenderRegeln.js";

const V40 = { wochenstunden: 40, arbeitstage_woche: 5 };
const V20_3 = { wochenstunden: 20, arbeitstage_woche: 3 };
const FT26 = feiertage(2026, KALENDER_STANDARD);

test("82-04: krank 14.–15.09. (KW 38) mindert das Soll um zwei Tagessoll, KW 37 unverändert", () => {
  const aw = [{ mitarbeiter_id: "m3", art: "krank", status: "genehmigt", von: "2026-09-14", bis: "2026-09-15" }];
  const ohne = sollIst({ jahr: 2026, woche: 38 }, { vertrag: V20_3, feiertage: FT26 }).soll;
  const mit = sollIst({ jahr: 2026, woche: 38 }, { vertrag: V20_3, feiertage: FT26, abwesenheiten: aw });
  assert.equal(ohne - mit.soll, 2 * (20 * 60 / 3));
  assert.deepEqual(mit.tage.filter((d) => d.abwesend).map((d) => d.datum), ["2026-09-14", "2026-09-15"]);
  assert.equal(sollIst({ jahr: 2026, woche: 37 }, { vertrag: V20_3, feiertage: FT26, abwesenheiten: aw }).soll, sollIst({ jahr: 2026, woche: 37 }, { vertrag: V20_3, feiertage: FT26 }).soll);
});

test("82-04: KW 52 mit Urlaub 21.–24.12. und Feiertag 25.12. → Soll 0; KW 22 (Pfingstmontag) bleibt 1.920 min; beantragt mindert nicht", () => {
  const urlaub = [{ mitarbeiter_id: "x", art: "urlaub", status: "genehmigt", von: "2026-12-21", bis: "2026-12-24" }];
  assert.equal(sollIst({ jahr: 2026, woche: 52 }, { vertrag: V40, feiertage: FT26, abwesenheiten: urlaub }).soll, 0);
  assert.equal(sollIst({ jahr: 2026, woche: 22 }, { vertrag: V40, feiertage: FT26, abwesenheiten: urlaub }).soll, 1920);
  const beantragt = [{ ...urlaub[0], status: "beantragt" }];
  assert.equal(sollIst({ jahr: 2026, woche: 52 }, { vertrag: V40, feiertage: FT26, abwesenheiten: beantragt }).soll, 1920);
});

test("82-04: Feiertags-Einstellung aus dem Regelwerk — KW 33/2028 mit Mariä Himmelfahrt 1.920, ohne 2.400 min", () => {
  const mit = feiertage(2028, kalenderEinstellung(() => undefined));
  const ohne = feiertage(2028, kalenderEinstellung((id) => (id === "kalender.mariae_himmelfahrt" ? false : undefined)));
  assert.equal(sollIst({ jahr: 2028, woche: 33 }, { vertrag: V40, feiertage: mit }).soll, 1920);
  assert.equal(sollIst({ jahr: 2028, woche: 33 }, { vertrag: V40, feiertage: ohne }).soll, 2400);
});

test("82-04: Tagessoll ohne Vertrag (virtuelle Inhaber:in) KW 38 = 2.400 min; Abwesenheiten mindern auch dieses Soll", () => {
  assert.equal(sollIst({ jahr: 2026, woche: 38 }, { tagessollMinuten: 480, feiertage: FT26 }).soll, 2400);
  const aw = [{ mitarbeiter_id: "inhaber", art: "abwesend", status: "genehmigt", von: "2026-09-16", bis: "2026-09-16", halbtag_von: true }];
  assert.equal(sollIst({ jahr: 2026, woche: 38 }, { tagessollMinuten: 480, feiertage: FT26, abwesenheiten: aw }).soll, 2160);
});
