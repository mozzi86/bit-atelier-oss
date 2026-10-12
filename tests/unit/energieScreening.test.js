// Liability guard (12.10.2026): the app screens energy demand against a reference guide value and never issues
// a GEG proof. Checks the central wording (energieScreening.js), the portfolio count that replaced the flat
// "GEG-konform 89 %" KPI, the English entries, and scans every UI source for proof claims such as
// "GEG-Nachweis bestanden ✓" or "erfüllt die GEG-Anforderungen".
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { screeningAussage, screeningZaehlung, KEIN_GEG_NACHWEIS, SCREENING_TITEL } from "@core/lib/energieScreening";
import { EN } from "@core/lib/i18nTeile/energie-screening.js";

const WURZEL = fileURLToPath(new URL("../../", import.meta.url));

test("screeningAussage: three states, every statement says it is not a GEG proof", () => {
  assert.equal(screeningAussage({ passes_geg: true }).stand, "eingehalten");
  assert.equal(screeningAussage({ passes_geg: false }).stand, "ueberschritten");
  assert.equal(screeningAussage(null).stand, "offen");
  assert.equal(screeningAussage({}).stand, "offen", "a missing flag is no result, not a pass");
  assert.equal(screeningAussage({ passes_geg: true }).text, "Energie-Screening: Richtwert eingehalten — kein GEG-Nachweis");
  for (const geg of [{ passes_geg: true }, { passes_geg: false }, undefined]) {
    const a = screeningAussage(geg);
    assert.ok(a.wert.endsWith(KEIN_GEG_NACHWEIS) && a.text.endsWith(KEIN_GEG_NACHWEIS));
    assert.ok(EN[a.wert] && EN[a.text], `EN entry for ${a.text}`);
  }
  assert.ok(EN[SCREENING_TITEL] && EN[KEIN_GEG_NACHWEIS]);
});

test("screeningZaehlung: newest scenario per project decides, projects without result are not counted", () => {
  const projekte = [{ id: "A" }, { id: "B" }, { id: "C" }];
  const szenarien = [
    { project_id: "A", created_date: "2026-01-01", geg_compliance: { passes_geg: false } },
    { project_id: "A", created_date: "2026-05-01", geg_compliance: { passes_geg: true } },
    { project_id: "B", created_date: "2026-03-01", geg_compliance: { passes_geg: false } },
    { project_id: "X", created_date: "2026-03-01", geg_compliance: { passes_geg: true } },
  ];
  assert.deepEqual(screeningZaehlung(projekte, szenarien), { eingehalten: 1, mitErgebnis: 2 });
  assert.deepEqual(screeningZaehlung([], []), { eingehalten: 0, mitErgebnis: 0 });
});

/** UI sources: src/** and packages/<pkg>/src/** (js/jsx/mjs). */
function quellen() {
  const wurzeln = [path.join(WURZEL, "src")];
  for (const paket of fs.readdirSync(path.join(WURZEL, "packages"))) {
    const src = path.join(WURZEL, "packages", paket, "src");
    if (fs.existsSync(src)) wurzeln.push(src);
  }
  const dateien = [];
  const laufe = (ordner) => {
    for (const e of fs.readdirSync(ordner, { withFileTypes: true })) {
      if (e.name === "node_modules") continue;
      const voll = path.join(ordner, e.name);
      if (e.isDirectory()) laufe(voll);
      else if (/\.(jsx?|mjs)$/.test(e.name)) dateien.push(voll);
    }
  };
  wurzeln.forEach(laufe);
  return dateien;
}

test("no UI source claims a GEG proof or GEG conformity", () => {
  const VERBOTEN = [
    /GEG-Nachweis["']?\s*v=\{[^}]*bestanden/,
    /Nachweis bestanden/,
    /erfüllt die GEG-Anforderungen/,
    /GEG-konform\b/,
    /GEG-Konformität erreicht/,
    /GEG-Konformitätsprüfung/,
  ];
  const funde = [];
  for (const datei of quellen()) {
    const rel = path.relative(WURZEL, datei).replace(/\\/g, "/");
    const text = fs.readFileSync(datei, "utf8");
    for (const muster of VERBOTEN) if (muster.test(text)) funde.push(`${rel}: ${muster}`);
    // Every mention of a GEG proof must be a negation ("kein GEG-Nachweis", "nicht aus einem GEG-Nachweis").
    for (const m of text.matchAll(/GEG-Nachweis/g)) {
      const davor = text.slice(Math.max(0, (m.index ?? 0) - 24), m.index);
      if (!/(kein|keinen|nicht aus einem)\s+$/i.test(davor) && !/["']$/.test(davor)) funde.push(`${rel}: "…${davor}GEG-Nachweis"`);
    }
  }
  assert.deepEqual(funde, []);
});
