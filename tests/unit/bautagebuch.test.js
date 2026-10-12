// 88-02: construction diary — cleaning, crew size, bad-weather hints, bad-weather days, hindrance context, weather suggestion.
import { test } from "node:test";
import assert from "node:assert/strict";
import { behinderungsKontext, istSchlechtwetterTag, mannstaerke, neuerEintrag, normalisiereEintrag, schlechtwetterHinweise, schlechtwetterTage, wetterVorschlag } from "@/lib/werkplanung/bautagebuch.js";

const E = (/** @type {Record<string, any>} */ x) => normalisiereEintrag({ ...neuerEintrag({ projectId: "p", datum: "2026-11-10" }), ...x });

test("normalisiert Zahlen und entfernt leere Firmenzeilen; Mannstärke summiert", () => {
  const e = E({ temp_min: "2", firmen: [{ name: "Rohbau Beispiel", mannstaerke: "6", arbeiten: "Decke betonieren" }, { name: "", mannstaerke: "", arbeiten: "" }, { name: "Elektro Beispiel", mannstaerke: 2.4, arbeiten: "Leerrohre" }] });
  assert.equal(e.temp_min, 2);
  assert.equal(e.firmen.length, 2);
  assert.equal(mannstaerke(e), 8);
});

test("Schlechtwetter-Hinweise: Beton unter +5 °C, Mauerwerk bei Frost, Anstrich bei Regen, Kran bei Wind", () => {
  assert.deepEqual(schlechtwetterHinweise(E({ temp_min: 2, firmen: [{ name: "Rohbau", arbeiten: "Decke betonieren" }] })).map((h) => h.art), ["beton_kalt"]);
  assert.deepEqual(schlechtwetterHinweise(E({ temp_min: 6, firmen: [{ name: "Rohbau", arbeiten: "Decke betonieren" }] })), []);
  assert.deepEqual(schlechtwetterHinweise(E({ temp_min: -2, firmen: [{ name: "Maurer", arbeiten: "KS-Mauerwerk EG" }] })).map((h) => h.art), ["mauerwerk_frost"]);
  assert.deepEqual(schlechtwetterHinweise(E({ niederschlag_mm: 1.2, firmen: [{ name: "Maler", arbeiten: "Fassadenanstrich" }] })).map((h) => h.art), ["anstrich_nass"]);
  assert.deepEqual(schlechtwetterHinweise(E({ wind_kmh: 55, firmen: [{ name: "Rohbau", arbeiten: "Kran: Fertigteile" }] })).map((h) => h.art), ["wind"]);
});

test("Schlechtwettertage und Behinderungskontext", () => {
  const liste = [
    { ...E({ temp_min: 3 }), id: "a", datum: "2026-11-09" },
    { ...E({ temp_min: -3 }), id: "b", datum: "2026-11-10" },
    { ...E({ niederschlag_mm: 12 }), id: "c", datum: "2026-11-11" },
    { ...E({ behinderung: true, behinderung_text: "Kran ausgefallen" }), id: "d", datum: "2026-11-12" },
  ];
  assert.equal(istSchlechtwetterTag(liste[0]), false);
  assert.deepEqual(schlechtwetterTage(liste).map((e) => e.id), ["b", "c", "d"]);
  const k = behinderungsKontext(liste, "b");
  assert.equal(k?.zeitraum, "10.11.2026 – 12.11.2026");
  assert.equal(k?.tage, 3);
  assert.match(String(k?.text), /10\.11\.2026: Tiefstwert -3 °C/);
  assert.match(String(k?.text), /12\.11\.2026: Kran ausgefallen/);
  assert.equal(behinderungsKontext(liste, "x"), null);
});

test("Wetter nur aus echter Messung übernehmen, nie den Offline-Ersatz", () => {
  assert.equal(wetterVorschlag({ source: "fallback", temperature: 14 }), null);
  assert.deepEqual(wetterVorschlag({ source: "open-meteo", temperature: 3.46, precipitation: 0.4, wind_speed: 21.7, condition: "Regen" }),
    { temp_min: 3.5, temp_max: 3.5, niederschlag_mm: 0.4, wind_kmh: 22, wetter_text: "Regen", wetter_quelle: "open-meteo" });
});
