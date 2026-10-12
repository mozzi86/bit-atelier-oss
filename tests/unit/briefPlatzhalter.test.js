// 82-05 Task 1: placeholder engine and catalogue.
import { test } from "node:test";
import assert from "node:assert/strict";
import { FILTER, fuellePlatzhalter, platzhalterIn } from "@core/lib/brief/platzhalter.js";
import { KATALOG, KATALOG_GRUPPEN, erlaubt, katalogFuer } from "@core/lib/brief/platzhalterKatalog.js";

test("füllt Pfade und den Euro-Filter", () => {
  const r = fuellePlatzhalter("Rechnung {{rechnung.nummer}} über {{rechnung.betrag|eur}}", { rechnung: { nummer: "RE-2026-014", betrag: 1234.56 } });
  assert.equal(r.text, "Rechnung RE-2026-014 über 1.234,56 €");
  assert.deepEqual(r.fehlend, []);
  assert.deepEqual(r.fehler, []);
});

test("Filter datum, datum_lang, prozent, zahl, gross", () => {
  const d = { datum: "2026-09-27", p: 5, n: 1234.5, name: "Müller" };
  assert.equal(fuellePlatzhalter("{{datum|datum}}", d).text, "27.09.2026");
  assert.equal(fuellePlatzhalter("{{datum|datum_lang}}", d).text, "27. September 2026");
  assert.equal(fuellePlatzhalter("{{p|prozent}}", d).text, "5 %");
  assert.equal(fuellePlatzhalter("{{n|zahl}}", d).text, "1.234,5");
  assert.equal(fuellePlatzhalter("{{name|gross}}", d).text, "MÜLLER");
  assert.deepEqual(Object.keys(FILTER).sort(), ["datum", "datum_lang", "eur", "gross", "prozent", "zahl"]);
});

test("fehlender Pflichtwert wird sichtbar markiert und gemeldet", () => {
  const r = fuellePlatzhalter("Rechnung {{rechnung.nummer}}", {}, { pflicht: ["rechnung.nummer"] });
  assert.equal(r.text, "Rechnung [[fehlt: rechnung.nummer]]");
  assert.deepEqual(r.fehlend, ["rechnung.nummer"]);
});

test("eine Zeile nur aus einem leeren optionalen Platzhalter entfällt samt Umbruch", () => {
  const r = fuellePlatzhalter("Firma\n{{empfaenger.abteilung}}\nStraße", { empfaenger: { abteilung: "" } });
  assert.equal(r.text, "Firma\nStraße");
  // Inside a line the empty value just disappears.
  assert.equal(fuellePlatzhalter("z. H. {{empfaenger.name}}!", {}).text, "z. H. !");
});

test("constructor, __proto__ und prototype werden nie aufgelöst; Object.prototype bleibt sauber", () => {
  const vorher = Object.getOwnPropertyNames(Object.prototype).sort();
  const d = { a: { b: 1 } };
  for (const t of ["{{constructor}}", "{{__proto__.polluted}}", "{{a.prototype.b}}", "{{a.constructor.name}}"]) {
    const r = fuellePlatzhalter(t, d);
    assert.equal(r.text, t, t);
    assert.ok(r.fehler.some((f) => f.startsWith("gesperrter Pfad")), t);
  }
  // Inherited properties are not own properties.
  assert.equal(fuellePlatzhalter("[{{toString}}]", {}).text, "[]");
  assert.deepEqual(Object.getOwnPropertyNames(Object.prototype).sort(), vorher);
  assert.equal(/** @type {any} */ ({}).polluted, undefined);
});

test("unbekannter Filter bleibt Literal und wird gemeldet", () => {
  const r = fuellePlatzhalter("{{x|js}}", { x: 1 });
  assert.equal(r.text, "{{x|js}}");
  assert.deepEqual(r.fehler, ["unbekannter Filter: js"]);
});

test("Blockplatzhalter wird zum Marker an seiner Position", () => {
  const r = fuellePlatzhalter("Vorab\n{{tabelle:tops}}\nDanach", {});
  assert.deepEqual(r.teile, ["Vorab", { typ: "tabelle", name: "tops" }, "Danach"]);
  assert.equal(r.text, "Vorab\nDanach");
});

test("platzhalterIn listet Pfade ohne Filter in Reihenfolge", () => {
  assert.deepEqual(platzhalterIn("Hallo {{empfaenger.name}}, {{datum|datum}} {{tabelle:tops}} {{datum}}"), ["empfaenger.name", "datum", "tabelle:tops"]);
});

test("Katalog: erlaubte Pfade je Briefart, jede Gruppe nennt ihre Phase", () => {
  assert.equal(erlaubt("antwort", "postbuch.betreff"), true);
  assert.equal(erlaubt("brief", "rechnung.nummer"), false);
  assert.equal(erlaubt("mahnung", "rechnung.nummer"), true);
  assert.equal(erlaubt("protokoll", "tabelle:tops"), true);
  for (const art of Object.keys(KATALOG)) {
    for (const g of katalogFuer(art)) assert.match(g.phase, /^(79|80|81|82|88)$/, `${art}/${g.gruppe}`); // 88-02: behinderung.* from the site diary
  }
  for (const [name, g] of Object.entries(KATALOG_GRUPPEN)) {
    for (const p of g.pfade) assert.ok(p.pfad === `tabelle:tops` || p.pfad.startsWith(`${name}.`) || name === "brief", p.pfad);
  }
});
