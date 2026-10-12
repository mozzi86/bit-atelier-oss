// 82-04 Task 2: conflicts as data, visible reason only with rights, team raster without reasons.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { ABWESENHEIT_ARTEN, konflikte, sichtbarerGrund } from "@/lib/abwesenheit/abwesenheit.js";
import { monatsSumme, teamRaster } from "@/lib/abwesenheit/abwesenheitAnsicht.js";
import { baueZugriff } from "@core/lib/rechte.js";
import { feiertage, KALENDER_STANDARD } from "@core/lib/kalender/feiertage.js";
import { beispielDatensaetzeBueroOrga } from "@/lib/bueroOrga/beispielDaten.js";
import { personalSeedVerschieben } from "@core/api/personalDb.js";
import { personenFuerZeiterfassung } from "@/lib/zeit/personalQuelle.js";
import { contacts } from "../../packages/nova-core/server/seed-data.js";
import { SEED82_ANKER } from "./helpers/seed82Erwartung.mjs";

const PERSONAL = personalSeedVerschieben(JSON.parse(fs.readFileSync(new URL("../../packages/nova-core/src/api/personalSeed.json", import.meta.url), "utf8")), SEED82_ANKER);
const SAAT = beispielDatensaetzeBueroOrga(SEED82_ANKER, { personal: PERSONAL, kontakte: contacts });
const aw = (/** @type {string} */ id) => SAAT.Abwesenheit.find((a) => a.id === id);
const M1 = aw("aw-1").mitarbeiter_id;
const M2 = aw("aw-3").mitarbeiter_id;
const M3 = aw("aw-4").mitarbeiter_id;

test("Konflikte: aw-4 → Vertretung M2 07.–09.10. selbst abwesend; neuer Antrag M2 26.–30.10. mit Vertretung M1 → keine", () => {
  assert.deepEqual(konflikte(aw("aw-4"), SAAT.Abwesenheit), [{ art: "vertretung_abwesend", werte: { vertretung: M2, von: "2026-10-07", bis: "2026-10-09" } }]);
  assert.deepEqual(konflikte({ mitarbeiter_id: M2, art: "urlaub", von: "2026-10-26", bis: "2026-10-30", vertretung_id: M1 }, SAAT.Abwesenheit), []);
});

test("Konflikte: Überschneidung, zu viele gleichzeitig, Rest reicht nicht, Betriebsruhe", () => {
  const basis = [
    { id: "a", mitarbeiter_id: "x", art: "urlaub", status: "genehmigt", von: "2026-11-02", bis: "2026-11-06" },
    { id: "b", mitarbeiter_id: "y", art: "urlaub", status: "genehmigt", von: "2026-11-04", bis: "2026-11-04" },
    { id: "c", mitarbeiter_id: "z", art: "krank", status: "genehmigt", von: "2026-11-04", bis: "2026-11-04" },
    { id: "d", mitarbeiter_id: "buero", art: "betriebsruhe", status: "genehmigt", von: "2026-11-05", bis: "2026-11-05" },
  ];
  const arten = konflikte({ mitarbeiter_id: "x", art: "urlaub", von: "2026-11-03", bis: "2026-11-05" }, basis, { maxGleichzeitig: 2, rest: 1, tage: 3 }).map((w) => w.art);
  assert.deepEqual(arten, ["ueberschneidung", "zu_viele_gleichzeitig", "rest_reicht_nicht", "betriebsruhe"]);
  const rest = konflikte({ mitarbeiter_id: "q", art: "urlaub", von: "2026-12-01", bis: "2026-12-02" }, [], { rest: 1, tage: 2 });
  assert.deepEqual(rest, [{ art: "rest_reicht_nicht", werte: { tage: 2, rest: 1 } }]);
});

test("sichtbarerGrund: Projektleitung sieht „abwesend“, Inhaber und die Person selbst die Art", () => {
  const nutzer = (/** @type {string} */ rolle, /** @type {string|null} */ mitarbeiter_id) => baueZugriff({ nutzer: { id: "n", rolle, mitarbeiter_id }, datenquelle: "express" });
  assert.equal(sichtbarerGrund(nutzer("projektleitung", M2), aw("aw-2")), "abwesend");
  assert.equal(sichtbarerGrund(baueZugriff({ rolle: "inhaber", datenquelle: "express" }), aw("aw-2")), "krank");
  assert.equal(sichtbarerGrund(nutzer("mitarbeiter", M3), aw("aw-2")), "krank");
  assert.equal(sichtbarerGrund(nutzer("mitarbeiter", M3), aw("aw-3")), "abwesend");
});

test("Teamraster Oktober 2026: 31 Spalten, 03.10. Feiertag, Wochenenden, M2 abwesend, M3 beantragt, M1 22.10., Kürzel; Summe M2 = 5", () => {
  const personen = personenFuerZeiterfassung(PERSONAL.Mitarbeiter, SEED82_ANKER);
  const r = teamRaster(personen, SAAT.Abwesenheit, 2026, 10, feiertage(2026, KALENDER_STANDARD), { nutzer: SAAT.Nutzer });
  assert.equal(r.tage.length, 31);
  const zelle = (/** @type {string} */ id, /** @type {string} */ tag) => r.zeilen.find((z) => z.id === id)?.zellen.find((c) => c.datum === tag)?.zustand;
  assert.equal(zelle(M2, "2026-10-03"), "feiertag");
  assert.equal(zelle(M2, "2026-10-04"), "wochenende");
  for (const t of ["05", "06", "07", "08", "09"]) assert.equal(zelle(M2, `2026-10-${t}`), "abwesend");
  for (const t of ["07", "08", "09", "12", "16"]) assert.equal(zelle(M3, `2026-10-${t}`), "beantragt");
  assert.equal(zelle(M1, "2026-10-22"), "abwesend");
  assert.equal(r.zeilen.find((z) => z.id === M1)?.kuerzel, SAAT.Nutzer.find((n) => n.mitarbeiter_id === M1)?.kuerzel);
  assert.equal(monatsSumme(r, M2), 5);
});

test("Teamraster ohne Gründe für jede Rolle: kein Wert im Modell nennt eine Art (E-14)", () => {
  const personen = personenFuerZeiterfassung(PERSONAL.Mitarbeiter, SEED82_ANKER);
  const arten = Object.keys(ABWESENHEIT_ARTEN).filter((a) => a !== "abwesend");
  for (const monat of [8, 9, 10]) {
    const text = JSON.stringify(teamRaster(personen, SAAT.Abwesenheit, 2026, monat, feiertage(2026, KALENDER_STANDARD), { nutzer: SAAT.Nutzer }));
    for (const a of arten) assert.ok(!new RegExp(`"${a}"`).test(text), `Art ${a} im Raster ${monat}`);
  }
  const quelle = fs.readFileSync(new URL("../../src/lib/abwesenheit/abwesenheitAnsicht.js", import.meta.url), "utf8").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(quelle, /\.art\b/, "teamRaster liest die Art nicht");
});

test("keine Art mit Gesundheitsangabe über Dritte (E-14)", () => {
  assert.ok(!("krank_kind" in ABWESENHEIT_ARTEN));
  assert.equal(ABWESENHEIT_ARTEN.krank.notiz, false);
  assert.equal(ABWESENHEIT_ARTEN.abwesend.notiz, false);
});
