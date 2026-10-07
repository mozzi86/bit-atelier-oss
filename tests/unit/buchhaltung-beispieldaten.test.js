// Unit tests of the accounting sample data (79-01 T5, E-04/E-05/E-17): relative
// to "today" for three reference days, deterministic, a sole proprietor with one
// owner, consistent amounts, neutral names, and runnable without the alias hook
// (server/seed.js imports it directly).
//
// In:  src/lib/accounting/beispielDaten.js (+ grundlagen/rechtsform to read it).
// Out: assertions; one child process without the alias hook.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { beispielDatensaetze } from "@/lib/accounting/beispielDaten.js";
import { rechnungsStatus } from "@/lib/accounting/grundlagen.js";
import { personenPruefen } from "@/lib/accounting/rechtsform.js";
import { wirksameEinstellungen } from "@/lib/accounting/einstellungen.js";
import { parseTag, plusMonate } from "@core/lib/kalender/datum.js";
import { findeTreffer } from "../../tools/sperrliste.mjs";

const WURZEL = fileURLToPath(new URL("../../", import.meta.url));
const TAGE = ["2026-09-27", "2026-06-30", "2027-01-15"];

/** Every string value of a record tree that looks like a date. */
function datumsWerte(knoten, aus = []) {
  if (typeof knoten === "string" && /^\d{4}-\d{2}-\d{2}/.test(knoten)) aus.push(knoten);
  else if (Array.isArray(knoten)) knoten.forEach((k) => datumsWerte(k, aus));
  else if (knoten && typeof knoten === "object") Object.values(knoten).forEach((k) => datumsWerte(k, aus));
  return aus;
}

for (const heute of TAGE) {
  test(`Beispieldaten relativ zu ${heute}: 16 Ausgangsrechnungen in drei Gruppen`, () => {
    const d = beispielDatensaetze(heute);
    const ar = d.Ausgangsrechnung;
    assert.equal(ar.length, 16);
    const gestellt = ar.filter((r) => r.status === "gestellt");
    const aelter = gestellt.filter((r) => r.rechnungsdatum >= plusMonate(heute, -15) && r.rechnungsdatum <= plusMonate(heute, -13));
    const letzte12 = gestellt.filter((r) => r.rechnungsdatum > plusMonate(heute, -12) && r.rechnungsdatum <= heute);
    assert.equal(aelter.length, 4, "4 mit Rechnungsdatum 13–15 Monate vor heute");
    assert.ok(aelter.every((r) => rechnungsStatus(r, heute) === "bezahlt"));
    assert.equal(letzte12.length, 9, "9 in den letzten 12 Monaten");
    const status = letzte12.map((r) => rechnungsStatus(r, heute));
    assert.equal(status.filter((s) => s === "ueberfaellig").length, 2);
    assert.equal(status.filter((s) => s === "offen").length, 1);
    assert.equal(status.filter((s) => s === "bezahlt").length, 6);
    const ueberfaellig = letzte12.filter((r) => rechnungsStatus(r, heute) === "ueberfaellig");
    assert.equal(ueberfaellig.filter((r) => r.mahnungen.length === 1 && r.mahnungen[0].stufe === 1).length, 1, "eine mit Mahnstufe 1");
    const geplant = ar.filter((r) => r.status === "geplant");
    assert.equal(geplant.length, 3);
    assert.ok(geplant.every((r) => rechnungsStatus(r, heute) === "geplant" && r.versand_geplant_am > heute));
    // Numbers per invoice year without gaps, starting at 001.
    const jeJahr = new Map();
    for (const r of gestellt) jeJahr.set(r.nummer.slice(3, 7), [...(jeJahr.get(r.nummer.slice(3, 7)) || []), Number(r.nummer.slice(8))]);
    for (const [jahr, nummern] of jeJahr) {
      assert.deepEqual([...nummern].sort((a, b) => a - b), nummern.map((_, i) => i + 1), `Nummern ${jahr} lückenlos`);
      assert.ok(gestellt.filter((r) => r.nummer.slice(3, 7) === jahr).every((r) => r.rechnungsdatum.startsWith(jahr)));
    }
    for (const r of ar) {
      assert.match(r.nummer ?? "RE-0000-000", /^RE-\d{4}-\d{3}$/);
      assert.equal(r.ust_satz, 19);
      assert.equal(r.ust, Math.round(r.netto * 19) / 100, `${r.id}: ust = round(netto × 19 %)`);
      assert.equal(r.brutto, Math.round((r.netto + r.ust) * 100) / 100, `${r.id}: brutto = netto + ust`);
      assert.ok(r.netto >= 4800 && r.netto <= 38000, `${r.id}: netto ${r.netto}`);
    }
  });

  test(`Beispieldaten relativ zu ${heute}: Einzelunternehmen mit einer Inhaberin, Entnahmen, Bestände`, () => {
    const d = beispielDatensaetze(heute);
    const Y = Number(heute.slice(0, 4));
    assert.equal(d.Setting.length, 1);
    const wert = d.Setting[0].value;
    assert.equal(d.Setting[0].key, "buchhaltung");
    assert.equal(wert.rechtsform, "einzelunternehmen");
    assert.equal(wert.ust_zeitraum, "monat");
    assert.equal(wert.dauerfrist, true);
    assert.equal(wert.versteuerung, "ist");
    assert.equal("schluessel" in wert, false, "kein Gewinnschlüssel im Einzelunternehmen");
    assert.deepEqual(wert.kontostand_start, { [Y]: { betrag: 48000, datum: `${Y}-01-01` } });
    assert.deepEqual(wert.vorauszahlungen, { [Y]: { est: [9000, 9000, 9000, 9000] } });
    assert.deepEqual(wert.datev, { berater: "", mandant: "" });
    assert.equal(wert.buero.name, "Architekturbüro Beispiel");
    const aktive = d.Gesellschafter.filter((g) => g.aktiv !== false);
    assert.equal(aktive.length, 1);
    assert.equal(aktive[0].rolle, "inhaber");
    assert.equal(aktive[0].name, "Inhaberin A");
    assert.deepEqual(personenPruefen(d.Gesellschafter, wirksameEinstellungen(wert), Y), []);
    // Drawings: 9,500 € on the 25th of every month of Y up to today.
    const monate = Array.from({ length: 12 }, (_, i) => `${Y}-${String(i + 1).padStart(2, "0")}-25`).filter((t) => t <= heute);
    assert.deepEqual(d.Entnahme.map((e) => e.datum), monate);
    assert.ok(d.Entnahme.every((e) => e.betrag === 9500 && e.gesellschafter_id === "bsp-g1"));
    assert.equal(d.Honorarvertrag.length, 4);
    assert.equal(d.Anlagegut.length, 5);
    assert.equal(d.Bankumsatz.length, 12);
    assert.equal(d.Bankumsatz.filter((b) => b.status === "zugeordnet").length, 8);
    assert.equal(d.Versicherung.length, 2);
    assert.equal(d.Versicherung.filter((v) => v.typ === "buergschaft").length, 1);
    assert.equal(d.WiederkehrendeAusgabe.length, 6);
    assert.equal(d.Fahrzeug.length, 2);
    assert.equal(d.Fahrt.length, 14);
    assert.equal(d.Fahrt.filter((f) => f.fahrzeug_id === null).length, 4, "4 km-Geld-Fahrten");
    const gross = d.Eingangsrechnung.find((e) => e.netto === 45000);
    assert.ok(gross, "großer Posten Tragwerksplanung");
    assert.equal(gross.faellig_am, plusMonate(`${heute.slice(0, 7)}-01`, 2), "fällig am 1. des übernächsten Monats");
    assert.equal(gross.bezahlt_am, null);
    const eAuto = d.Fahrzeug.find((f) => f.antrieb === "elektro");
    assert.equal(eAuto.blp, 58800);
    assert.equal(eAuto.anschaffung_datum, `${Y - 1}-03-15`);
    assert.equal(eAuto.entfernung_km, 12);
    assert.equal(eAuto.nutzer, "Inhaberin A");
    assert.equal(eAuto.nutzer_art, "gesellschafter");
    assert.equal(d.HoaiPlan.length, 2);
    assert.equal(beispielDatensaetze(heute, { vorhandeneHoaiPlaene: ["proj-1"] }).HoaiPlan.length, 1);
  });

  test(`Beispieldaten relativ zu ${heute}: ids, Datumsfelder, Projekte, Determinismus`, () => {
    const d = beispielDatensaetze(heute);
    assert.deepEqual(beispielDatensaetze(heute), d, "zwei gleiche Aufrufe sind deep-equal");
    const alle = Object.values(d).flat();
    const ids = alle.map((r) => r.id);
    assert.equal(new Set(ids).size, ids.length, "ids eindeutig");
    assert.ok(ids.every((id) => id.startsWith("bsp-")));
    for (const [entity, liste] of Object.entries(d)) {
      if (entity === "Setting") continue;
      assert.ok(liste.every((r) => r.beispiel === true), `${entity}: beispiel:true`);
    }
    for (const w of datumsWerte(d)) assert.equal(parseTag(w), w, `ungültiges Datum ${w}`);
    for (const r of alle) if ("project_id" in r && r.project_id !== undefined) {
      assert.ok(["proj-1", "proj-2", "proj-3", "proj-4"].includes(r.project_id), `${r.id}: ${r.project_id}`);
    }
    // Two-sided bank assignment (79-RESEARCH risk 8).
    for (const b of d.Bankumsatz.filter((x) => x.zuordnung?.typ === "Ausgangsrechnung")) {
      const r = d.Ausgangsrechnung.find((x) => x.id === b.zuordnung.id);
      assert.ok(r.zahlungen.some((z) => z.bankumsatz_id === b.id && z.betrag === b.betrag), `${b.id} ↔ ${r.id}`);
    }
  });
}

test("keine Treffer der Sperrliste (dieselbe gehashte Liste wie projektneutral.test.js)", () => {
  // The generated sample data is not a tracked file, so the repo-wide guard
  // cannot see it — check the generator output against the hashed list (83-01).
  const { eintraege } = JSON.parse(fs.readFileSync(new URL("./sperrliste.sha256.json", import.meta.url), "utf8"));
  assert.ok(eintraege.length >= 42, "Sperrliste nicht gelesen");
  const json = JSON.stringify(TAGE.map((t) => beispielDatensaetze(t)));
  assert.deepEqual(findeTreffer(json, eintraege).map((t) => `Eintrag #${t.nr}`), []);
});

test("ungültiges Datum wird im Klartext abgelehnt", () => {
  assert.throws(() => beispielDatensaetze("27.09.2026"), /ungültiges Datum/);
});

test("der Generator läuft ohne Alias-Hook (server/seed.js importiert ihn direkt)", () => {
  const aus = execFileSync(process.execPath, ["--input-type=module", "-e",
    "import('./src/lib/accounting/beispielDaten.js').then(m=>console.log(Object.keys(m.beispielDatensaetze('2026-09-27')).length))"],
  { cwd: WURZEL, encoding: "utf8" });
  assert.equal(aus.trim(), "15");
});
