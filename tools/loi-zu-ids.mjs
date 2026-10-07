#!/usr/bin/env node
// loi-zu-ids.mjs — erzeugt eine IDS-Datei aus einer LOI-Tabelle des
// Auftraggebers (Phase 71-01, Entscheidung D-P71-01: Skript + Bibliothek, die
// IDS ist byte-stabil testbar).
//
// Aufruf:
//   node tools/loi-zu-ids.mjs [--lph 5|8] [--blaetter Wand,Stützen,…]
//                             [--aus <csv>] [--nach <ids>]
// Standard: Rohbau-Blätter (Wand, Stützen, Decken, Träger, Treppen,
// Treppenpodeste, Fassade), LPH 5 (D-P71-03). Quelle und Ziel liegen im
// NDA-Archiv (BIT_NDA_DIR, Schlüssel `loiCsv` und `rohbauIds` in
// nda-konfig.json, siehe tools/nda.mjs) — PRIVAT, nie ins Repo und nie nach
// public/: das Ergebnis ist aus NDA-Unterlagen abgeleitet (Phase 78, 83-01).
//
// Deterministisch: gleiche Eingabe -> byte-gleiche Ausgabe (Drift-Schutz
// T-71-03, geprüft in tests/unit/referenz-modelle.test.js).

import fs from 'node:fs';
import path from 'node:path';

import { parseLoiCsv, loiZuSpezifikationen } from '../packages/nova-ifc-viewer/src/lib/loiListe.js';
import { schreibeIds } from '../packages/nova-ifc-viewer/src/lib/idsWriter.js';
import { ndaPfad, ndaWert, NDA_SKIP_MELDUNG } from './nda.mjs';

// import.meta.dirname (Node >= 20.11) — wie tools/beispielmodell-erzeugen.mjs:29.
const REPO = path.resolve(import.meta.dirname, '..');

// Die Rohbau-Blätter der LOI-Tabelle (71-RESEARCH §1.3: alles aktiv, außer die
// drei inaktiven Ausbau-Blätter). Reihenfolge = Reihenfolge in der IDS-Datei.
// Exportiert für den Drift-Test (tests/unit/referenz-modelle.test.js).
export const ROHBAU_BLAETTER = ['Wand', 'Stützen', 'Decken', 'Träger', 'Treppen', 'Treppenpodeste', 'Fassade'];

/**
 * Neutral texts of the generated IDS. A project-specific wording (title,
 * provenance of the list) comes from the caller — for the real project from
 * nda-konfig.json (`loiIdsTexte`), so the drift test reproduces the archived
 * file byte for byte while no project name lives in this file.
 */
export const NEUTRALE_TEXTE = {
  titel: 'Rohbau — LOI-Tabelle des Auftraggebers',
  quelle: 'LOI-Tabelle des Auftraggebers',
  herkunft: 'Erzeugt aus der LOI-Tabelle des Auftraggebers',
};

/**
 * CLI-Argumente lesen (argparse-Minimalform, keine Dependencies).
 * @param {string[]} argv
 * @returns {{lph: number, blaetter: string[]|null, aus: string|null, nach: string|null}}
 */
function parseArgs(argv) {
  const opts = { lph: 5, blaetter: ROHBAU_BLAETTER, aus: ndaPfad('loiCsv'), nach: ndaPfad('rohbauIds') };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--lph') opts.lph = Number(argv[++i]);
    else if (a === '--blaetter') opts.blaetter = String(argv[++i]).split(',').map((s) => s.trim());
    else if (a === '--aus') opts.aus = String(argv[++i]);
    else if (a === '--nach') opts.nach = String(argv[++i]);
    else throw new Error(`Unbekannte Option: ${a}`);
  }
  if (![2, 3, 5, 8].includes(opts.lph)) throw new Error(`--lph muss 2, 3, 5 oder 8 sein (ist ${opts.lph})`);
  return opts;
}

/**
 * IDS-XML aus der LOI-CSV erzeugen (ohne Dateizugriff — testbar).
 * @param {string} csvText Inhalt der LOI-Tabelle
 * @param {{lph: number, blaetter: string[]|null, texte?: {titel: string, quelle: string, herkunft: string}}} opts
 *   texte: projektbezogene Formulierung, Default NEUTRALE_TEXTE
 * @returns {{xml: string, warnungen: string[], nichtPruefbar: Array, spezifikationen: Array}}
 */
export function loiZuIdsXml(csvText, opts) {
  const texte = { ...NEUTRALE_TEXTE, ...(opts.texte || {}) };
  const loi = parseLoiCsv(csvText);
  const { spezifikationen, warnungen, nichtPruefbar } = loiZuSpezifikationen(loi, {
    lph: opts.lph,
    blaetter: opts.blaetter,
    // Provenance of this project's list; the shipped module itself stays
    // project-neutral (tools/ never reaches a customer mirror).
    quelle: texte.quelle,
  });
  if (!spezifikationen.length) throw new Error('Keine Spezifikationen erzeugt — Blattnamen prüfen');
  const { xml, warnungen: schreibWarnungen } = schreibeIds(spezifikationen, {
    title: texte.titel,
    description:
      `${texte.herkunft} mit tools/loi-zu-ids.mjs, `
      + `Pflichtmerkmale LPH${opts.lph}. Blätter: ${spezifikationen.map((s) => s.name).join(', ')}. `
      + 'Nicht prüfbar: SiteName/BuildingName/BuildingStoreyName (partOf-Facetten) — '
      + 'siehe README.md daneben. Nicht von Hand ändern.',
    author: 'BIT-Atelier (erzeugt)',
    version: '1.0',
  });
  return { xml, warnungen: [...warnungen, ...schreibWarnungen], nichtPruefbar, spezifikationen };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.aus || !opts.nach) {
    console.error(`${NDA_SKIP_MELDUNG} — oder --aus <csv> und --nach <ids> angeben.`);
    process.exit(1);
  }
  if (!fs.existsSync(opts.aus)) {
    console.error(`LOI-CSV nicht gefunden: ${opts.aus}`);
    process.exit(1);
  }
  const csvText = fs.readFileSync(opts.aus, 'utf8');
  // Project wording only for the archive's own list; explicit --aus stays neutral.
  const texte = opts.aus === ndaPfad('loiCsv') ? ndaWert('loiIdsTexte') : undefined;
  const { xml, warnungen, nichtPruefbar, spezifikationen } = loiZuIdsXml(csvText, { ...opts, texte });

  fs.mkdirSync(path.dirname(opts.nach), { recursive: true });
  fs.writeFileSync(opts.nach, xml, 'utf8');

  console.log(`Geschrieben: ${path.relative(REPO, opts.nach)}`);
  console.log(`  Spezifikationen: ${spezifikationen.length} (LPH${opts.lph})`);
  for (const s of spezifikationen) {
    console.log(`    ${s.name}: ${s.requirements.length} Pflichtmerkmale`);
  }
  console.log(`  Nicht prüfbar:   ${nichtPruefbar.length} Merkmale (partOf/Platzhalter)`);
  if (warnungen.length) {
    console.log('  Warnungen:');
    for (const w of warnungen) console.log(`    - ${w}`);
  }
}

// Nur als Skript ausführen — beim Import (Test) soll main() nicht laufen.
import { pathToFileURL } from 'node:url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
