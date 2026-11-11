// @ts-nocheck — Node CLI orchestration (fs/path); jsconfig ships only React types.
// bitCheck.js — headless ModelCheck orchestration (Phase 77).
//
// Mirrors packages/nova-ifc-viewer/src/pages/ModelCheck.jsx without DOM:
//   IFC → parseIfcFile + extractGeometry → clashPairsIter (+ optional BAP /
//   Koordinationskörper) → parseIdsXml/evaluateIds → laufVergleich →
//   BCF / CSV / PDF / JSON. Exit-code policy lives in exitCodeFuer().
//
// Assumption D-HR-02 = YES (CLI product ordered). No duplicate check engines.

import fs from "node:fs";
import path from "node:path";
import { unzipSync } from "fflate";

import { parseIfcFile, extractGeometry } from "./ifcImport.js";
import { clashPairsIter, STANDARD_REGELN } from "./clash.js";
import { ladeRegelsatz, regelnZuOptionen } from "./clashRegeln.js";
import { findeKoordinationskoerper, vergleicheLage } from "./koordinationskoerper.js";
import { parseIdsXml, evaluateIds } from "./ids.js";
import { DOMParserMini } from "./domParserMini.js";
import { buildBcfZip, newTopicGuid } from "./bcf.js";
import { befundTabelle } from "./befundListe.js";
import { tabelleAlsCsv } from "@core/lib/tabellenExport";
import { laufZusammenfassung, laufVergleich, laufLesen } from "./laufVergleich.js";
import { schreibeBitCheckPdf, BIT_CHECK_KIND_LABELS } from "./bitCheckBericht.js";

/** Pair cap matching ModelCheck (69-19 / 71-02). */
export const BIT_CHECK_MAX_PAIRS = 500_000;

/**
 * CLI / library error with a suggested process exit code.
 * @extends Error
 */
export class BitCheckFehler extends Error {
  /**
   * @param {string} message German message for stderr
   * @param {number} [exitCode=2] 2 = arg/file, 1 = findings
   */
  constructor(message, exitCode = 2) {
    super(message);
    this.name = "BitCheckFehler";
    this.exitCode = exitCode;
  }
}

/**
 * Read a file as ArrayBuffer; throws BitCheckFehler(2) if missing.
 * @param {string} datei absolute or relative path
 * @param {string} label German label for the error
 * @returns {ArrayBuffer}
 */
export function liesDateiBuffer(datei, label = "Datei") {
  const p = path.resolve(datei);
  if (!fs.existsSync(p)) throw new BitCheckFehler(`${label} nicht gefunden: ${p}`, 2);
  const buf = fs.readFileSync(p);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

/**
 * Read UTF-8 text; throws BitCheckFehler(2) if missing.
 * @param {string} datei
 * @param {string} label
 * @returns {string}
 */
export function liesDateiText(datei, label = "Datei") {
  const p = path.resolve(datei);
  if (!fs.existsSync(p)) throw new BitCheckFehler(`${label} nicht gefunden: ${p}`, 2);
  return fs.readFileSync(p, "utf8");
}

/**
 * Parse CLI argv into options. Does not read files yet.
 * @param {string[]} argv process.argv.slice(2)
 */
export function parseArgs(argv) {
  const out = {
    modell: null,
    vergleich: null,
    regeln: null,
    bap: null,
    vorlauf: null,
    bericht: null,
    bcf: null,
    csv: null,
    json: null,
    streng: false,
    hilfe: false,
    rest: [],
  };
  const args = Array.isArray(argv) ? [...argv] : [];
  while (args.length) {
    const a = args.shift();
    if (a == null) break;
    if (a === "-h" || a === "--help" || a === "help") {
      out.hilfe = true;
      continue;
    }
    if (a === "--streng") {
      out.streng = true;
      continue;
    }
    const flag = (name) => a === name || a.startsWith(`${name}=`);
    const wert = (name) => {
      if (a.startsWith(`${name}=`)) return a.slice(name.length + 1);
      const n = args.shift();
      if (n == null || n.startsWith("-")) {
        throw new BitCheckFehler(`Option ${name} erwartet einen Pfad.`, 2);
      }
      return n;
    };
    if (flag("--vergleich")) { out.vergleich = wert("--vergleich"); continue; }
    if (flag("--regeln")) { out.regeln = wert("--regeln"); continue; }
    if (flag("--bap")) { out.bap = wert("--bap"); continue; }
    if (flag("--vorlauf")) { out.vorlauf = wert("--vorlauf"); continue; }
    if (flag("--bericht")) { out.bericht = wert("--bericht"); continue; }
    if (flag("--bcf")) { out.bcf = wert("--bcf"); continue; }
    if (flag("--csv")) { out.csv = wert("--csv"); continue; }
    if (flag("--json")) { out.json = wert("--json"); continue; }
    if (a.startsWith("-")) throw new BitCheckFehler(`Unbekannte Option: ${a}`, 2);
    if (!out.modell) out.modell = a;
    else out.rest.push(a);
  }
  return out;
}

/** German usage text for --help / missing model. */
export function hilfeText() {
  return [
    "bit-check — headless BIM-Prüflauf (IDS + Clash + Bericht)",
    "",
    "Aufruf:",
    "  bit-check <modell.ifc> [Optionen]",
    "",
    "Optionen:",
    "  --vergleich <modellB.ifc>   Zweites Modell (BAP-Quelle B)",
    "  --regeln <datei.ids>        IDS 1.0 Regeln",
    "  --bap <bap.json>            BAP-Clash-Matrix (71-02)",
    "  --vorlauf <alt.json>        Vorheriger Lauf (69-20) für hartZunahme",
    "  --bericht <out.pdf>         Prüfbericht PDF",
    "  --bcf <out.bcf>             BCF 2.1 ZIP",
    "  --csv <out.csv>             Befundliste CSV (66-14)",
    "  --json <out.json>           Lauf-Zusammenfassung + Kennzahlen",
    "  --streng                    Exit 1 schon bei jedem Befund",
    "",
    "Exit-Codes:",
    "  0  ok (keine harte Zunahme / ohne --streng keine harten|IDS-Fehler)",
    "  1  harte Kollisionen, IDS-Verletzungen oder hartZunahme > 0",
    "  2  Argument- oder Dateifehler",
  ].join("\n");
}

/**
 * Exit-code policy for a finished run.
 * @param {{kennzahlen: object, vergleichLauf?: object|null, streng?: boolean}} p
 * @returns {0|1}
 */
export function exitCodeFuer({ kennzahlen, vergleichLauf = null, streng = false }) {
  const k = kennzahlen || {};
  const befunde = Number(k.befunde) || 0;
  if (streng) return befunde > 0 ? 1 : 0;
  if (vergleichLauf) return Number(vergleichLauf.hartZunahme) > 0 ? 1 : 0;
  const hart = Number(k.hart) || 0;
  const ids = Number(k.idsVerletzt) || 0;
  return hart > 0 || ids > 0 ? 1 : 0;
}

/**
 * Map parseIfcFile elements into evaluateIds shape (ModelCheck idsElemente).
 * @param {object[]} liste
 * @returns {object[]}
 */
export function idsElementeVon(liste) {
  return (liste || []).map((el) => ({
    globalId: el.guid ?? el.globalId ?? undefined,
    ifcType: el.ifcType || el.ifc_klasse,
    name: el.name,
    predefinedType: el.predefinedType || undefined,
    psets: el.psets || {},
    classifications: el.classifications || [],
    material: el.materials || el.material || [],
  }));
}

/**
 * Build BCF topics from a run result (same wording as ModelCheck.bcfTopics).
 * @param {{clash?: {clashes?: object[]}, ids?: object[]}} ergebnis
 * @returns {object[]}
 */
export function bcfTopicsVon(ergebnis) {
  const topics = [];
  const nf3 = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 3 });
  for (const c of ergebnis?.clash?.clashes || []) {
    topics.push({
      guid: newTopicGuid(),
      titel: `${BIT_CHECK_KIND_LABELS[c.kind] || c.kind}: ${c.aType || "?"} <-> ${c.bType || "?"}`,
      beschreibung:
        `Bauteile ${c.aId == null ? "—" : (c.aGuid || `#${c.aId}`)} / ${c.bId == null ? "—" : (c.bGuid || `#${c.bId}`)} — ` +
        `Überlappung (AABB-Näherung) ${nf3.format(c.overlapVol)} m³. ` +
        "Geometrischer Verdachtsmoment — fachliche Bewertung erforderlich.",
      ifcGuids: [c.aGuid, c.bGuid].filter(Boolean),
    });
  }
  for (const r of ergebnis?.ids || []) {
    if (r.bestanden) continue;
    topics.push({
      guid: newTopicGuid(),
      titel: `IDS verletzt: ${r.spec?.name || "IDS"}`,
      beschreibung:
        `${r.verletzungen?.length || 0} Verletzung(en) bei ${r.anwendbar} anwendbaren Elementen. ` +
        (r.verletzungen || [])
          .slice(0, 10)
          .map((v) => `${v.globalId || v.elementName || "—"}: erwartet ${v.erwartet}, gefunden ${v.gefunden}`)
          .join(" | "),
      ifcGuids: (r.verletzungen || []).map((v) => v.globalId).filter(Boolean),
    });
  }
  return topics;
}

/**
 * Drain clashPairsIter synchronously (no UI yield).
 * @param {object[]} elemente
 * @param {object} optionen
 * @returns {object}
 */
export function clashLauf(elemente, optionen) {
  const iter = clashPairsIter(elemente, optionen);
  let schritt = iter.next();
  while (!schritt.done) schritt = iter.next();
  return schritt.value;
}

/**
 * Run one headless check. Does not write output files.
 * @param {object} opt
 * @returns {Promise<object>}
 */
export async function bitCheckLauf(opt) {
  const log = typeof opt.onProgress === "function" ? opt.onProgress : () => {};
  const modellPfad = path.resolve(opt.modellPfad);
  const vergleichPfad = opt.vergleichPfad ? path.resolve(opt.vergleichPfad) : null;
  const zweiModelle = Boolean(vergleichPfad);

  log(`Lese Modell ${path.basename(modellPfad)}…`);
  const bufferA = liesDateiBuffer(modellPfad, "Modell");
  const coordinateToOrigin = !zweiModelle;

  log("Semantik + Geometrie…");
  const [parsedA, geoA] = await Promise.all([
    parseIfcFile(bufferA, log),
    extractGeometry(bufferA, log, { coordinateToOrigin }),
  ]);

  let parsedB = null;
  let geoB = null;
  if (zweiModelle) {
    log(`Lese Vergleichsmodell ${path.basename(/** @type {string} */ (vergleichPfad))}…`);
    const bufferB = liesDateiBuffer(/** @type {string} */ (vergleichPfad), "Vergleichsmodell");
    [parsedB, geoB] = await Promise.all([
      parseIfcFile(bufferB, log),
      extractGeometry(bufferB, log, { coordinateToOrigin: false }),
    ]);
  }

  let bap = null;
  let regelsatzName = null;
  if (opt.bapPfad) {
    log(`Lade BAP ${path.basename(opt.bapPfad)}…`);
    let json;
    try {
      json = JSON.parse(liesDateiText(opt.bapPfad, "BAP-Datei"));
    } catch (e) {
      if (e instanceof BitCheckFehler) throw e;
      throw new BitCheckFehler(`BAP-Datei ungültig: ${/** @type {any} */ (e).message || e}`, 2);
    }
    try {
      bap = ladeRegelsatz(json);
      regelsatzName = bap.regelsatz?.name || path.basename(opt.bapPfad);
    } catch (e) {
      throw new BitCheckFehler(/** @type {any} */ (e).message || String(e), 2);
    }
  }

  // A loaded BAP is the clash matrix for this run, with or without
  // --vergleich. Gating it on a second model left regelsatzName pointing at
  // a file whose rules never ran (the report named a matrix that was not
  // applied). Coordination still needs two models: it compares two sites.
  // Elements without quelle match every source filter (clash.js), so the
  // same matrix runs on one model.
  const bapAktiv = bap != null;
  let optionen;
  if (bapAktiv) {
    optionen = regelnZuOptionen(bap.regeln, {
      tolerance: 0.001,
      clearance: 0,
      duplikate: true,
      maxPairs: BIT_CHECK_MAX_PAIRS,
    });
  } else {
    optionen = {
      rules: STANDARD_REGELN,
      tolerance: 0.001,
      clearance: 0,
      duplikate: true,
      maxPairs: BIT_CHECK_MAX_PAIRS,
    };
  }

  const elemente = zweiModelle
    ? [
      ...geoA.elemente.map((el) => ({ ...el, quelle: "A" })),
      ...geoB.elemente.map((el) => ({ ...el, quelle: "B" })),
    ]
    : geoA.elemente;

  let koordination = null;
  if (zweiModelle && bap?.koordination) {
    const koerperA = findeKoordinationskoerper(geoA.elemente);
    const koerperB = findeKoordinationskoerper(geoB.elemente);
    koordination = {
      regel: bap.koordination,
      ...vergleicheLage(koerperA, koerperB, bap.koordination.toleranzMm),
      nameA: koerperA?.name || null,
      nameB: koerperB?.name || null,
    };
  }

  log("Kollisionsprüfung…");
  const clash = clashLauf(elemente, optionen);

  let idsSpecs = [];
  if (opt.idsPfad) {
    log(`IDS ${path.basename(opt.idsPfad)}…`);
    const xml = liesDateiText(opt.idsPfad, "IDS-Datei");
    try {
      idsSpecs = parseIdsXml(xml, DOMParserMini);
    } catch (e) {
      throw new BitCheckFehler(/** @type {any} */ (e).message || String(e), 2);
    }
    // ModelCheck rejects this (ladeIdsText). Zero specs is a file error:
    // a missing namespace, a truncated file or a DOMParserMini miss must
    // not look like a clean IDS pass (exit 0, idsVerletzt 0).
    if (!idsSpecs.length) {
      throw new BitCheckFehler(
        `IDS-Datei enthält keine <specification>-Einträge: ${path.basename(opt.idsPfad)}`,
        2,
      );
    }
    if (!regelsatzName) regelsatzName = path.basename(opt.idsPfad);
  }

  const idsElemente = idsElementeVon(parsedA.elements || []);
  const ids = idsSpecs.length && idsElemente.length
    ? evaluateIds(idsSpecs, idsElemente)
    : [];

  const ergebnis = { clash, ids, koordination, zweiModelle, bapAktiv };
  const hart = clash.clashes.filter((c) => c.kind === "hard").length;
  const duplikate = clash.clashes.filter((c) => c.kind === "duplicate").length;
  const clearance = clash.clashes.filter((c) => c.kind === "clearance").length;
  const idsBestanden = ids.filter((r) => r.bestanden).length;
  const idsVerletzt = ids.filter((r) => !r.bestanden).length;
  const idsVerletzungen = ids.reduce((n, r) => n + (r.bestanden ? 0 : (r.verletzungen?.length || 0)), 0);
  const kennzahlen = {
    bauteile: geoA.elemente.length,
    hart,
    duplikate,
    clearance,
    idsBestanden,
    idsVerletzt,
    idsVerletzungen,
    clashBefunde: clash.clashes.length,
    befunde: clash.clashes.length + idsVerletzungen,
  };

  const zusammenfassung = laufZusammenfassung(ergebnis, {
    datum: new Date().toISOString(),
    modell: path.basename(modellPfad),
    regelsatz: regelsatzName,
    kennzahlen,
  });

  let vergleichLauf = null;
  if (opt.vorlaufPfad) {
    log(`Vergleich mit Vorlauf ${path.basename(opt.vorlaufPfad)}…`);
    let alt;
    try {
      alt = laufLesen(JSON.parse(liesDateiText(opt.vorlaufPfad, "Vorlauf")));
    } catch (e) {
      if (e instanceof BitCheckFehler) throw e;
      throw new BitCheckFehler(/** @type {any} */ (e).message || String(e), 2);
    }
    vergleichLauf = laufVergleich(alt, zusammenfassung);
  }

  return {
    modellPfad,
    vergleichPfad,
    regelsatzName,
    ergebnis,
    kennzahlen,
    zusammenfassung,
    vergleichLauf,
    parsedA,
    parsedB,
    geoA,
    geoB,
    elemente,
  };
}

/**
 * Write optional artefacts and compute exit code.
 * @param {Awaited<ReturnType<typeof bitCheckLauf>>} lauf
 * @param {object} ausgaben
 * @returns {{exitCode: 0|1, geschrieben: string[]}}
 */
export function bitCheckSchreiben(lauf, ausgaben = {}) {
  const geschrieben = [];
  const { ergebnis, kennzahlen, zusammenfassung, vergleichLauf, modellPfad, vergleichPfad, regelsatzName, elemente } = lauf;

  if (ausgaben.json) {
    const ziel = path.resolve(ausgaben.json);
    const payload = {
      ...zusammenfassung,
      vergleich: vergleichLauf
        ? {
          hartZunahme: vergleichLauf.hartZunahme,
          neu: vergleichLauf.neu.length,
          behoben: vergleichLauf.behoben.length,
          unveraendert: vergleichLauf.unveraendert.length,
          jeRegel: vergleichLauf.jeRegel,
        }
        : null,
    };
    fs.mkdirSync(path.dirname(ziel), { recursive: true });
    fs.writeFileSync(ziel, JSON.stringify(payload, null, 2), "utf8");
    geschrieben.push(ziel);
  }

  if (ausgaben.bcf) {
    const topics = bcfTopicsVon(ergebnis);
    if (topics.length) {
      const ziel = path.resolve(ausgaben.bcf);
      fs.mkdirSync(path.dirname(ziel), { recursive: true });
      const bytes = buildBcfZip(topics, {
        autor: "BIT-Atelier bit-check",
        modellName: path.basename(modellPfad),
      });
      fs.writeFileSync(ziel, bytes);
      geschrieben.push(ziel);
    }
  }

  if (ausgaben.csv) {
    const tabelle = befundTabelle({
      clashes: ergebnis.clash.clashes,
      ids: ergebnis.ids,
      elemente,
      parsedElemente: lauf.parsedA?.elements || [],
      modellNamen: {
        A: path.basename(modellPfad),
        B: vergleichPfad ? path.basename(vergleichPfad) : undefined,
      },
      artLabels: BIT_CHECK_KIND_LABELS,
    });
    const ziel = path.resolve(ausgaben.csv);
    fs.mkdirSync(path.dirname(ziel), { recursive: true });
    fs.writeFileSync(ziel, tabelleAlsCsv(tabelle), "utf8");
    geschrieben.push(ziel);
  }

  if (ausgaben.bericht) {
    const bytes = schreibeBitCheckPdf({
      modell: path.basename(modellPfad),
      vergleich: vergleichPfad ? path.basename(vergleichPfad) : null,
      regelsatz: regelsatzName,
      datum: zusammenfassung.datum,
      kennzahlen,
      clashes: ergebnis.clash.clashes,
      ids: ergebnis.ids,
      vergleichLauf,
    });
    const ziel = path.resolve(ausgaben.bericht);
    fs.mkdirSync(path.dirname(ziel), { recursive: true });
    fs.writeFileSync(ziel, bytes);
    geschrieben.push(ziel);
  }

  return {
    exitCode: exitCodeFuer({
      kennzahlen,
      vergleichLauf,
      streng: Boolean(ausgaben.streng),
    }),
    geschrieben,
  };
}

/**
 * Full CLI run: parse args → lauf → write → exit code.
 * @param {string[]} argv
 * @param {{onProgress?: (msg: string) => void}} [opt]
 */
export async function bitCheckAusfuehren(argv, opt = {}) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    if (e instanceof BitCheckFehler) return { exitCode: e.exitCode, fehler: e.message };
    throw e;
  }
  if (args.hilfe) return { exitCode: 0, hilfe: true, text: hilfeText() };
  if (!args.modell) return { exitCode: 2, fehler: "Modellpfad fehlt.\n\n" + hilfeText() };
  if (args.rest.length) return { exitCode: 2, fehler: `Unerwartete Argumente: ${args.rest.join(" ")}` };

  try {
    const lauf = await bitCheckLauf({
      modellPfad: args.modell,
      vergleichPfad: args.vergleich,
      idsPfad: args.regeln,
      bapPfad: args.bap,
      vorlaufPfad: args.vorlauf,
      onProgress: opt.onProgress,
    });
    const { exitCode, geschrieben } = bitCheckSchreiben(lauf, {
      bericht: args.bericht,
      bcf: args.bcf,
      csv: args.csv,
      json: args.json,
      streng: args.streng,
    });
    return { exitCode, lauf, geschrieben };
  } catch (e) {
    if (e instanceof BitCheckFehler) return { exitCode: e.exitCode, fehler: e.message };
    return { exitCode: 2, fehler: /** @type {any} */ (e).message || String(e) };
  }
}

/**
 * Inspect a BCF zip produced by buildBcfZip — used by 77-04 self-check.
 * @param {Uint8Array|ArrayBuffer|Buffer} bytes
 */
export function bcfZipInhalt(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const files = unzipSync(u8);
  const dateien = Object.keys(files).sort();
  return {
    dateien,
    hatVersion: dateien.includes("bcf.version"),
    markup: dateien.filter((n) => n.endsWith("/markup.bcf")).length,
    viewpoints: dateien.filter((n) => n.endsWith("/viewpoint.bcfv")).length,
  };
}
