// Guard test: every German UI key has an English entry (post-merge review 27.09.).
//
// Why: the Phase-49 rule says new visible strings go through t() WITH a DICT.en
// entry. Hermes kept it, the two night lanes mostly did not — after the merge
// 235 new keys had no English, so the English UI showed the "Weiter mit" bar,
// the tickets, the change orders and the overview in German (SPRACHE-02,
// HUELLE-06). And the three-way merge put one key into DICT.en twice, which
// only lint noticed (SPRACHE-01). This test makes both visible in test:unit.
//
// In:  DICT.en of packages/nova-core/src/lib/i18n.jsx plus every dictionary part
//      under packages/nova-core/src/lib/i18nTeile/ (79-01, read as TEXT through
//      tests/unit/helpers/woerterbuch.mjs), every t("…")/t('…') literal in src/** and
//      packages/*/src/**, and the tables whose texts reach t() indirectly
//      (next steps, menu, legal way back, overview module labels).
//      tests/unit/i18n-en-altlast.json = keys that were already missing before
//      the night of 24./25.09. (baseline, may only shrink).
// Out: assertions only. To rewrite the baseline after translating old keys:
//      I18N_ALTLAST_SCHREIBEN=1 npm run test:unit -- (writes the file, then fails once).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NAECHSTE_SCHRITTE } from "@/naechsteSchritte.js";
import { navGroups, navFlach } from "@/navigation.js";
import { rechtsRueckweg } from "@core/lib/seitenLink";
import { englischePaareAlle } from "./helpers/woerterbuch.mjs";
import { REGELWERKE } from "@/lib/settings/regelwerke.js";
import { REGEL_PRUEFTEXTE } from "@core/lib/regelwerk.js";

const WURZEL = fileURLToPath(new URL("../../", import.meta.url));
const ALTLAST = new URL("./i18n-en-altlast.json", import.meta.url);

/** t("…") or t('…') as a call of its own (not obj.t(…)), literal first argument. */
const T_AUFRUF = /(?<![\w.$])t\(\s*(["'])((?:(?!\1)[^\\\n]|\\.)*)\1\s*[,)]/g;

/**
 * Undo the escapes a JS string literal may contain in these files.
 * @param {string} s raw literal content
 * @returns {string}
 */
const entschluesseln = (s) => s.replace(/\\(["'\\])/g, "$1").replace(/\\n/g, "\n");

/**
 * The English dictionary as ordered [key, value, file] triples, straight from
 * the source text: DICT.en of i18n.jsx and every part file in i18nTeile/
 * (decision list § 5 — the part files are merged into DICT.en at runtime).
 * Values may sit on the line after the key (long entries).
 * @returns {Array<[string, string, string]>}
 */
function englischePaare() {
  return englischePaareAlle();
}

/**
 * All source files of the app and its packages (js/jsx/mjs), relative paths.
 * @returns {string[]}
 */
function quelldateien() {
  const wurzeln = [path.join(WURZEL, "src")];
  for (const paket of fs.readdirSync(path.join(WURZEL, "packages"))) {
    const src = path.join(WURZEL, "packages", paket, "src");
    if (fs.existsSync(src)) wurzeln.push(src);
  }
  const dateien = [];
  const laufe = (ordner) => {
    for (const eintrag of fs.readdirSync(ordner, { withFileTypes: true })) {
      if (eintrag.name === "node_modules") continue;
      const voll = path.join(ordner, eintrag.name);
      if (eintrag.isDirectory()) laufe(voll);
      else if (/\.(jsx?|mjs)$/.test(eintrag.name)) dateien.push(voll);
    }
  };
  wurzeln.forEach(laufe);
  return dateien.map((d) => path.relative(WURZEL, d).replace(/\\/g, "/")).sort();
}

/**
 * Strings of a `const NAME = [ … ];` table in a source file, for the given fields.
 * @param {string} datei path relative to the repo root
 * @param {string} name constant name
 * @param {string[]} felder property names whose string values are i18n keys
 * @returns {string[]}
 */
function tabellenTexte(datei, name, felder) {
  const quelle = fs.readFileSync(path.join(WURZEL, datei), "utf8");
  const start = quelle.indexOf(`const ${name} = [`);
  assert.ok(start >= 0, `${name} nicht gefunden in ${datei}`);
  const block = quelle.slice(start, quelle.indexOf("];", start));
  const muster = new RegExp(`\\b(?:${felder.join("|")}):\\s*"([^"]+)"`, "g");
  return [...block.matchAll(muster)].map((m) => m[1]);
}

/**
 * Every key the UI passes to t(), with the files it comes from.
 * @returns {Map<string, Set<string>>}
 */
function benutzteSchluessel() {
  const schluessel = new Map();
  const merke = (k, herkunft) => {
    if (!schluessel.has(k)) schluessel.set(k, new Set());
    schluessel.get(k).add(herkunft);
  };
  for (const datei of quelldateien()) {
    if (datei.endsWith("lib/i18n.jsx")) continue;
    const quelle = fs.readFileSync(path.join(WURZEL, datei), "utf8");
    for (const m of quelle.matchAll(T_AUFRUF)) merke(entschluesseln(m[2]), datei);
  }
  // Tables whose texts reach t() through a variable (t(s.text), t(item.title) …).
  for (const liste of Object.values(NAECHSTE_SCHRITTE)) for (const s of liste) merke(s.text, "src/naechsteSchritte.js");
  for (const g of navGroups) merke(g.label, "src/navigation.js");
  for (const e of navFlach) merke(e.title, "src/navigation.js");
  for (const quelle of ["supabase", "express", "serverlos"]) merke(rechtsRueckweg(quelle).text, "packages/nova-core/src/lib/seitenLink.js");
  for (const k of tabellenTexte("src/pages/Dashboard.jsx", "MODULES", ["label"])) merke(k, "src/pages/Dashboard.jsx");
  for (const k of tabellenTexte("src/components/projects/AktivesProjekt.jsx", "WEITER", ["titel", "modul"])) merke(k, "src/components/projects/AktivesProjekt.jsx");
  // 79-01: tab labels of /Accounting, the HOAI profile labels and the rule labels
  // of the settings dialog reach t() through a variable.
  for (const k of tabellenTexte("src/lib/accounting/reiter.js", "BUCHHALTUNG_REITER", ["label"])) merke(k, "src/lib/accounting/reiter.js");
  for (const k of tabellenTexte("packages/nova-core/src/lib/hoai/leistungsbilder.js", "LEISTUNGSBILDER", ["label"])) merke(k, "packages/nova-core/src/lib/hoai/leistungsbilder.js");
  for (const k of tabellenTexte("src/lib/accounting/einstellungen.js", "REGEL_TABELLE", ["label"])) merke(k, "src/lib/accounting/einstellungen.js");
  // 80-01: tab labels and hints of /People, area titles and descriptions of
  // /Settings, and every rule book of the registry (group title, rule labels,
  // sections, option labels, hints) — a group phase 81 adds is covered at once.
  // Plus the message templates of pruefeOverride (the editor passes them to t()).
  for (const k of tabellenTexte("src/lib/people/reiter.js", "PERSONAL_REITER_INFO", ["label", "hinweis"])) merke(k, "src/lib/people/reiter.js");
  for (const k of tabellenTexte("src/lib/settings/bereiche.js", "EINSTELLUNGS_BEREICHE", ["titel", "beschreibung"])) merke(k, "src/lib/settings/bereiche.js");
  for (const g of REGELWERKE) {
    merke(g.titel, "src/lib/settings/regelwerke.js");
    for (const r of g.regeln) {
      merke(r.label, "src/lib/settings/regelwerke.js");
      if (r.abschnitt) merke(r.abschnitt, "src/lib/settings/regelwerke.js");
      if (r.hinweis) merke(r.hinweis, "src/lib/settings/regelwerke.js");
      for (const o of r.optionen || []) merke(o.label, "src/lib/settings/regelwerke.js");
    }
  }
  for (const v of Object.values(REGEL_PRUEFTEXTE)) merke(v, "packages/nova-core/src/lib/regelwerk.js");
  // 83-03: AI presets and connection types (LlmConnections.jsx passes label to t()).
  for (const k of tabellenTexte("packages/nova-core/src/lib/kiVorlagen.js", "KI_VORLAGEN", ["label"])) merke(k, "packages/nova-core/src/lib/kiVorlagen.js");
  for (const k of tabellenTexte("packages/nova-core/src/lib/kiVorlagen.js", "KI_TYPEN", ["label"])) merke(k, "packages/nova-core/src/lib/kiVorlagen.js");
  return schluessel;
}

/** @returns {string[]} the baseline of keys that were missing before the night of 24./25.09. */
function altlast() {
  return JSON.parse(fs.readFileSync(ALTLAST, "utf8")).schluessel;
}

test("DICT.en hat keinen Schlüssel doppelt — auch nicht über die Teilwörterbücher hinweg", () => {
  const paare = englischePaare();
  assert.ok(paare.length >= 500, `nur ${paare.length} Einträge gelesen — Parser prüfen`);
  /** @type {Map<string, string>} key → file of its first definition */
  const gesehen = new Map();
  const doppelt = [];
  for (const [k, , datei] of paare) {
    if (gesehen.has(k)) doppelt.push(`${JSON.stringify(k)} (${gesehen.get(k)} und ${datei})`);
    else gesehen.set(k, datei);
  }
  assert.deepEqual(doppelt, [], "doppelte Schlüssel in DICT.en bzw. i18nTeile/ (der Spread überschreibt still, nur der letzte gilt)");
});

test("die Teilwörterbücher werden gelesen (Mechanismus aus 79-01)", () => {
  const paare = englischePaare();
  const fundament = paare.filter(([, , datei]) => datei.endsWith("i18nTeile/buchhaltung-fundament.js")).map(([k]) => k);
  assert.ok(fundament.includes("Ausgangsrechnungen"), "buchhaltung-fundament.js nicht gelesen oder Reiter-Label fehlt");
});

test("Platzhalter im Schlüssel stehen auch in der Übersetzung", () => {
  const platz = (s) => [...s.matchAll(/\{\{?(\w+)\}?\}/g)].map((m) => m[1]).sort().join(",");
  const falsch = englischePaare().filter(([k, v]) => platz(k) !== platz(v)).map(([k, v]) => `${k} → ${v}`);
  assert.deepEqual(falsch, []);
});

test("jeder t()-Schlüssel hat einen englischen Eintrag (außer der Altlast vor dem 24.09.)", () => {
  const en = new Set(englischePaare().map(([k]) => k));
  const alt = new Set(altlast());
  const benutzt = benutzteSchluessel();
  assert.ok(benutzt.size >= 900, `nur ${benutzt.size} Schlüssel gefunden — Extraktion prüfen`);
  if (process.env.I18N_ALTLAST_SCHREIBEN === "1") {
    const neu = [...benutzt.keys()].filter((k) => !en.has(k)).sort((a, b) => a.localeCompare(b, "de"));
    fs.writeFileSync(ALTLAST, `${JSON.stringify({
      hinweis: "Keys without DICT.en entry that predate the night of 24./25.09.2026 (i18nAbdeckung.test.js). Only shrink this list: translate a key, then delete it here.",
      schluessel: neu,
    }, null, 1)}\n`);
    assert.fail(`i18n-en-altlast.json neu geschrieben (${neu.length} Schlüssel) — Lauf ohne I18N_ALTLAST_SCHREIBEN wiederholen`);
  }
  const fehlt = [...benutzt]
    .filter(([k]) => !en.has(k) && !alt.has(k))
    .map(([k, dateien]) => `${JSON.stringify(k)} (${[...dateien].join(", ")})`);
  assert.deepEqual(fehlt, [], "Neue UI-Texte ohne englischen Eintrag — DICT.en in i18n.jsx ergänzen");
});

test("die Altlast schrumpft nur: kein Eintrag, der übersetzt oder verschwunden ist", () => {
  const en = new Set(englischePaare().map(([k]) => k));
  const benutzt = benutzteSchluessel();
  const veraltet = altlast().filter((k) => en.has(k) || !benutzt.has(k));
  assert.deepEqual(veraltet, [], "aus tests/unit/i18n-en-altlast.json löschen");
});

test("die Extraktion erkennt t()-Aufrufe und nur diese", () => {
  const probe = [
    't("Titel")',
    "t('Einfach')",
    't("Mit {n} Platzhalter", x)',
    't( "Mit Leerraum" )',
    'obj.t("Fremd")',
    'format("Kein t")',
    't(`Vorlage`)',
    'gut("Nein")',
    't("Mit \\"Zitat\\"")',
  ].join("\n");
  const gefunden = [...probe.matchAll(T_AUFRUF)].map((m) => entschluesseln(m[2]));
  assert.deepEqual(gefunden, ["Titel", "Einfach", "Mit {n} Platzhalter", "Mit Leerraum", 'Mit "Zitat"']);
});
