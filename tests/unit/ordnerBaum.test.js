import test from "node:test";
import assert from "node:assert/strict";
import {
  baueBaum, pfadZu, kinderVon, dateienIn, nachfahren, pruefeName, ORDNER_VORLAGE,
  ZIELORDNER, REITER_ZU_ORDNER, zielPfadFuer, zielPfadFuerReiter, findeOderLegeAn,
} from "@core/lib/ordnerBaum";

const o = (id, name, parent_id = null) => ({ id, name, parent_id, project_id: "p1" });

test("baueBaum — verschachtelt korrekt und sortiert natürlich", () => {
  const baum = baueBaum([o("b", "02_Planung"), o("a", "01_Grundlagen"), o("a1", "Gutachten", "a")]);
  assert.deepEqual(baum.map((k) => k.name), ["01_Grundlagen", "02_Planung"]);
  assert.deepEqual(baum[0].kinder.map((k) => k.name), ["Gutachten"]);
});

test("baueBaum — natürliche Sortierung: 02 vor 10, nicht alphabetisch", () => {
  const baum = baueBaum([o("x", "10_Anhang"), o("y", "02_Planung")]);
  assert.deepEqual(baum.map((k) => k.name), ["02_Planung", "10_Anhang"]);
});

test("baueBaum — Waisen hängen an der Wurzel statt zu verschwinden", () => {
  const baum = baueBaum([o("k", "Verwaist", "gibt-es-nicht")]);
  assert.equal(baum.length, 1, "der Ordner bleibt sichtbar");
  assert.equal(baum[0].name, "Verwaist");
});

test("baueBaum — leere Eingabe ergibt leeren Baum", () => {
  assert.deepEqual(baueBaum([]), []);
  assert.deepEqual(baueBaum(), []);
});

test("pfadZu — liefert die Brotkrumen von der Wurzel bis zum Ordner", () => {
  const liste = [o("a", "01_Grundlagen"), o("a1", "Gutachten", "a"), o("a2", "Bodengutachten", "a1")];
  assert.deepEqual(pfadZu(liste, "a2").map((k) => k.name), ["01_Grundlagen", "Gutachten", "Bodengutachten"]);
  assert.deepEqual(pfadZu(liste, "unbekannt"), []);
});

test("pfadZu — ein defekter parent_id-Ring bricht die Schleife ab", () => {
  // Datenschaden darf die App nicht einfrieren.
  const ring = [{ id: "a", name: "A", parent_id: "b" }, { id: "b", name: "B", parent_id: "a" }];
  const pfad = pfadZu(ring, "a");
  assert.ok(pfad.length <= 2, "kein Endlos-Aufstieg");
});

test("kinderVon — Wurzelebene über null, Unterebene über id", () => {
  const liste = [o("a", "A"), o("b", "B"), o("a1", "A1", "a")];
  assert.deepEqual(kinderVon(liste, null).map((k) => k.id), ["a", "b"]);
  assert.deepEqual(kinderVon(liste, "a").map((k) => k.id), ["a1"]);
});

test("dateienIn — trennt Ordnerinhalt von der ungeordneten Ablage", () => {
  const docs = [
    { id: "d1", name: "Plan.pdf", folder_id: "a" },
    { id: "d2", name: "Lose.pdf" },
    { id: "d3", name: "Alt.pdf", folder_id: null },
  ];
  assert.deepEqual(dateienIn(docs, "a").map((d) => d.id), ["d1"]);
  assert.deepEqual(dateienIn(docs, null).map((d) => d.id), ["d3", "d2"]);
});

test("nachfahren — findet alle Ebenen, nicht nur die direkte", () => {
  const liste = [o("a", "A"), o("a1", "A1", "a"), o("a2", "A2", "a1"), o("b", "B")];
  assert.deepEqual(nachfahren(liste, "a").sort(), ["a1", "a2"]);
  assert.deepEqual(nachfahren(liste, "b"), []);
});

test("pruefeName — leer, zu lang, Schrägstrich und Dublette werden abgelehnt", () => {
  assert.ok(pruefeName("", []));
  assert.ok(pruefeName("   ", []));
  assert.ok(pruefeName("x".repeat(81), []));
  assert.ok(pruefeName("a/b", []));
  assert.ok(pruefeName("Planung", [o("x", "planung")]), "Dublette unabhängig von Groß/Klein");
  assert.equal(pruefeName("Planung", [o("x", "Kosten")]), null);
});

test("ORDNER_VORLAGE — Büro-Systematik ist vollständig und eindeutig", () => {
  const namen = ORDNER_VORLAGE.map((v) => v.name);
  assert.equal(new Set(namen).size, namen.length, "keine doppelten Hauptordner");
  assert.ok(namen.every((n) => /^\d{2}_/.test(n)), "alle Hauptordner tragen eine Nummer");
});

// --- Einzige Quelle der Ablage-Regel (Weisung 26.08.2026) ---------------------------

test("Ablage-Regel — jeder Designer-Reiter ist abgedeckt, keiner vergessen", () => {
  // „und die ich nicht genannt habe": alle 29 Reiter des Komplex-Designers müssen
  // eine Antwort haben — entweder einen Ordner oder ein ausdrückliches null.
  const REITER = [
    "site", "studio", "program", "compliance", "massing", "terrain", "bim", "buildings",
    "statics", "landscape", "haustechnik", "brandschutz", "asr", "barrierefreiheit",
    "acoustics", "waermebruecken", "bauphysik", "raumklima", "funding", "apartments",
    "interiors", "analysis", "generative", "energy", "costs", "integrations", "planner",
    "flood_risk", "support",
  ];
  for (const r of REITER) {
    assert.ok(r in REITER_ZU_ORDNER, `Reiter „${r}" fehlt in der Ablage-Regel`);
  }
});

test("Ablage-Regel — jeder Zielpfad existiert in der Ordnervorlage", () => {
  // Verhindert genau den Fehler, der beim Bauen auffiel: „Landschaft" gegen
  // „Landschaft / Außenanlagen" — ein Tippfehler legt sonst still einen zweiten Ordner an.
  const vorhanden = new Set();
  for (const v of ORDNER_VORLAGE) {
    vorhanden.add(v.name);
    for (const k of v.kinder) vorhanden.add(`${v.name}/${k}`);
  }
  const pfade = [...Object.values(ZIELORDNER), ...Object.values(REITER_ZU_ORDNER)].filter(Boolean);
  for (const pfad of pfade) {
    assert.ok(vorhanden.has(pfad.join("/")), `Zielpfad „${pfad.join("/")}" fehlt in ORDNER_VORLAGE`);
  }
});

test("zielPfadFuer / zielPfadFuerReiter — Fachplanung landet in ihrer Disziplin", () => {
  assert.deepEqual(zielPfadFuer("Brandschutz"), ["03_Fachplanung", "Brandschutz"]);
  assert.deepEqual(zielPfadFuer("Schallschutz"), ["03_Fachplanung", "Schallschutz"]);
  assert.deepEqual(zielPfadFuerReiter("acoustics"), ["03_Fachplanung", "Schallschutz"]);
  assert.deepEqual(zielPfadFuerReiter("brandschutz"), ["03_Fachplanung", "Brandschutz"]);
  assert.deepEqual(zielPfadFuer("Plan-PDF"), ["04_Zeichnungen", "Aktuell"]);
  assert.deepEqual(zielPfadFuer("gibt-es-nicht"), [], "unbekannter Typ => Projektwurzel");
});

test("findeOderLegeAn — legt nur fehlende Ebenen an und nutzt vorhandene weiter", async () => {
  const bestand = [{ id: "f1", name: "03_Fachplanung", parent_id: null }];
  let n = 0;
  const anlegen = async ({ parent_id, name }) => ({ id: `neu${++n}`, name, parent_id });
  const r = await findeOderLegeAn(bestand, ["03_Fachplanung", "Brandschutz"], anlegen);
  assert.deepEqual(r.angelegt, ["Brandschutz"], "der vorhandene Hauptordner wird wiederverwendet");
  assert.equal(r.id, "neu1");

  const r2 = await findeOderLegeAn(bestand, [], anlegen);
  assert.equal(r2.id, null, "leerer Pfad => Projektwurzel");
});
