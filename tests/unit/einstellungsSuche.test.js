// Unit tests of the settings search (80-03, behavior 13): area matches and rule
// matches over the REAL registries (src/lib/settings/bereiche.js, regelwerke.js) —
// no fixtures, so a renamed rule id or label breaks this test instead of the app
// silently going out of sync with it.
//
// In:  src/lib/settings/suche.js, EINSTELLUNGS_BEREICHE, sichtbareBereiche, REGELWERKE.
// Out: assertions only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { sucheEinstellungen, suchUmfang } from "@/lib/settings/suche.js";
import { EINSTELLUNGS_BEREICHE, sichtbareBereiche } from "@/lib/settings/bereiche.js";
import { REGELWERKE } from "@/lib/settings/regelwerke.js";

/** @param {string} text @param {any} [kontext] */
const suche = (text, kontext = { personalZugang: "erlaubt" }) =>
  sucheEinstellungen(text, { bereiche: EINSTELLUNGS_BEREICHE, regelwerke: REGELWERKE, kontext });

/** True when `treffer` contains a hit matching bereich (+ regelId, if given). */
const enthaelt = (treffer, bereich, regelId) =>
  treffer.some((t) => t.bereich === bereich && (regelId === undefined || t.regelId === regelId));

test("Behavior 13: 'briefkopf' → erster Treffer ist der Bereich office", () => {
  const treffer = suche("briefkopf");
  assert.ok(treffer.length > 0, "kein Treffer für 'briefkopf'");
  assert.equal(treffer[0].bereich, "office");
});

test("Behavior 13: 'sprache' → erster Treffer ist der Bereich display", () => {
  const treffer = suche("sprache");
  assert.ok(treffer.length > 0, "kein Treffer für 'sprache'");
  assert.equal(treffer[0].bereich, "display");
});

test("Behavior 13: 'zahlungsziel' findet buchhaltung.zahlungsziel_tage (Label „Zahlungsziel (Standard)“)", () => {
  const treffer = suche("zahlungsziel");
  assert.ok(enthaelt(treffer, "rules", "buchhaltung.zahlungsziel_tage"), JSON.stringify(treffer));
  const regel = treffer.find((t) => t.regelId === "buchhaltung.zahlungsziel_tage");
  assert.equal(regel.titel, "Zahlungsziel (Standard)");
});

test("Behavior 13: 'rechtsform' findet buchhaltung.rechtsform", () => {
  const treffer = suche("rechtsform");
  assert.ok(enthaelt(treffer, "rules", "buchhaltung.rechtsform"), JSON.stringify(treffer));
});

test("Behavior 13: 'mindestlohn' — mit Personal-Zugang ein Regeltreffer, ohne (nur-lokal) keiner aus der Gruppe personal", () => {
  const mitZugang = suche("mindestlohn", { personalZugang: "erlaubt" });
  assert.ok(enthaelt(mitZugang, "rules", "personal.mindestlohn"), JSON.stringify(mitZugang));

  const ohneZugang = suche("mindestlohn", { personalZugang: "nur-lokal" });
  const personalTreffer = ohneZugang.filter((t) => t.bereich === "rules" && t.regelId?.startsWith("personal."));
  assert.deepEqual(personalTreffer, [], "0 Regeltreffer aus der Gruppe personal bei personalZugang 'nur-lokal'");
});

test("Behavior 13: '§ 3 BUrlG' findet personal.urlaub_mindest_werktage", () => {
  const treffer = suche("§ 3 BUrlG");
  assert.ok(enthaelt(treffer, "rules", "personal.urlaub_mindest_werktage"), JSON.stringify(treffer));
});

test("Behavior 13: '' → []", () => {
  assert.deepEqual(suche(""), []);
  assert.deepEqual(suche("   "), []);
});

test("Behavior 13: höchstens 8 Treffer", () => {
  // "e" trifft praktisch jeden Bereich und jede Regel — Obergrenze prüfen.
  const treffer = suche("e");
  assert.ok(treffer.length <= 8, `${treffer.length} Treffer, erwartet ≤ 8`);
});

test("Bereichstreffer kommen vor Regeltreffern", () => {
  const treffer = suche("mindestlohn");
  const ersterRegelIndex = treffer.findIndex((t) => t.regelId);
  const ersterBereichsIndex = treffer.findIndex((t) => !t.regelId);
  if (ersterRegelIndex >= 0 && ersterBereichsIndex >= 0) {
    assert.ok(ersterBereichsIndex < ersterRegelIndex, "ein Bereichstreffer muss vor jedem Regeltreffer stehen");
  }
});

test("Großschreibung und Umlaute spielen keine Rolle", () => {
  assert.deepEqual(suche("BRIEFKOPF").map((t) => t.bereich).slice(0, 1), ["office"]);
  assert.deepEqual(suche("Büroname").map((t) => t.bereich).slice(0, 1), ["office"]);
});

// Area-level visibility and readiness: the search box gets exactly the scope the
// tab list of Settings.jsx shows (suchUmfang over sichtbareBereiche), so a hit never
// points to a tab this context does not render (E-03, DS-12, 80-03 task 6).

/** Search as EinstellungsSuche.jsx does it; every area counts as ready unless said otherwise. */
const sucheImUmfang = (text, kontext, istBereit = () => true) =>
  sucheEinstellungen(text, { ...suchUmfang(sichtbareBereiche(kontext), istBereit, REGELWERKE), kontext });

test("Cloud-Modus (supabase): weder Bereich rules noch templates noch Regeltreffer", () => {
  const kontext = { datenquelle: "supabase", personalZugang: "nur-lokal" };
  const umfang = suchUmfang(sichtbareBereiche(kontext), () => true, REGELWERKE);
  assert.deepEqual(umfang.bereiche.filter((b) => b.key === "rules" || b.key === "templates"), []);
  assert.deepEqual(umfang.regelwerke, []);
  for (const wort of ["Mindestlohn", "Zahlungsziel", "Rechtsform", "Vorlage", "Checkliste"]) {
    const treffer = sucheImUmfang(wort, kontext);
    const verboten = treffer.filter((t) => t.bereich === "rules" || t.bereich === "templates");
    assert.deepEqual(verboten, [], `'${wort}': ${JSON.stringify(treffer)}`);
  }
});

test("Ohne Personal-Zugang (lokal): 'Vorlage' trifft den Bereich templates nicht, mit Zugang schon", () => {
  const ohne = sucheImUmfang("Vorlage", { datenquelle: "express", personalZugang: "keine-berechtigung" });
  assert.equal(enthaelt(ohne, "templates"), false, JSON.stringify(ohne));
  const mit = sucheImUmfang("Vorlage", { datenquelle: "express", personalZugang: "erlaubt" });
  assert.equal(enthaelt(mit, "templates"), true, JSON.stringify(mit));
});

test("Bereich rules noch nicht fertig: keine Regeltreffer (kein Sprung auf einen fehlenden Reiter)", () => {
  const kontext = { datenquelle: "express", personalZugang: "erlaubt" };
  const nichtRules = (key) => key !== "rules";
  const umfang = suchUmfang(sichtbareBereiche(kontext), nichtRules, REGELWERKE);
  assert.deepEqual(umfang.regelwerke, []);
  const treffer = sucheImUmfang("zahlungsziel", kontext, nichtRules);
  assert.deepEqual(treffer.filter((t) => t.bereich === "rules"), [], JSON.stringify(treffer));
  const fertig = sucheImUmfang("zahlungsziel", kontext);
  assert.ok(enthaelt(fertig, "rules", "buchhaltung.zahlungsziel_tage"), JSON.stringify(fertig));
});
