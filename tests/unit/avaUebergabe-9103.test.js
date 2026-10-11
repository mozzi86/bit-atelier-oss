// Unit tests for plan 91-03 (packages/nova-designer/src/lib/avaUebergabe.js): the planner quantity list
// becomes a CSV that the AVA's EXISTING LV import (gaeb.js parseLvCsv) reads back with the same
// quantities, units and cost groups — round trip through the real importer, rainwater rows included.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { mengenAlsLvCsv, kgVorschlag } from "@designer/lib/avaUebergabe";
import { regenwasserNutzung } from "@designer/lib/regenwassernutzung";
import { parseLvCsv } from "@ava/lib/gaeb";

const ZEILEN = [
  { key: "gl_dn150", label: "Grundleitung DN 150", menge: 42.5, einheit: "m" },
  { key: "ablaeufe", label: "Dachabläufe DN 100", menge: 4, einheit: "Stk." },
  { key: "rw_zisterne", label: "Regenwasserzisterne Ortbeton unter TG-Bodenplatte", menge: 29, einheit: "m³" },
  { key: "rw_leitung", label: "Betriebswasserleitung (grob)", menge: 120, einheit: "m" },
  { key: "leer", label: "Nichts", menge: 0, einheit: "Stk." },
  { key: "x", label: "Text mit ; und \"Anführungszeichen\"", menge: 1.25, einheit: "m²" },
];

describe("91-03 — Mengen als LV-CSV", () => {
  it("Rundlauf durch den echten AVA-Import: Mengen, Einheiten, KG, OZ, EP bleibt leer (null)", () => {
    const csv = mengenAlsLvCsv(ZEILEN, { gewerk: "Entwässerung", ozPrefix: "04", quelle: "Entwässerungsplaner", stand: "11.10.2026" });
    assert.ok(csv.startsWith("﻿"), "BOM");
    const rows = parseLvCsv(csv);
    assert.equal(rows.length, 5, "Zeile mit Menge 0 entfällt");
    assert.deepEqual(rows.map((r) => r.oz), ["04.0010", "04.0020", "04.0030", "04.0040", "04.0050"]);
    assert.deepEqual(rows.map((r) => r.quantity), [42.5, 4, 29, 120, 1.25]);
    assert.deepEqual(rows.map((r) => r.unit), ["m", "Stk", "m³", "m", "m²"]);
    assert.deepEqual(rows.map((r) => r.din276), ["411", "411", "412", "412", ""]);
    assert.ok(rows.every((r) => r.unit_price === null), "kein erfundener Preis");
    assert.ok(rows.every((r) => r.trade === "Entwässerung"));
    assert.match(rows[2].title, /^Regenwasserzisterne .* \(aus Entwässerungsplaner, Stand 11\.10\.2026\)$/);
    assert.match(rows[4].title, /Text mit ; und "Anführungszeichen"/, "Semikolon + Anführungszeichen überleben");
  });

  it("Regenwasser-Mengen aus 91-01 kommen vollständig und mit KG 412 an", () => {
    const rw = regenwasserNutzung({ footArea_m2: 1000, niederschlag_mm: 650, we: 48, gruenflaeche_m2: 400, tgAktiv: true, tgFlaeche_m2: 600, nutzung: { ueberlaufMassnahme: "hebeanlage" } });
    const rows = parseLvCsv(mengenAlsLvCsv(rw.mengen));
    const kurz = rows.map((r) => r.title);
    for (const t of ["Regenwasserzisterne", "Regenwasserfilter", "Pumpenanlage", "Betriebswasserleitung", "Hebeanlage Zisternenüberlauf"]) {
      assert.ok(kurz.some((x) => x.includes(t)), `${t} fehlt`);
    }
    assert.equal(rows.find((r) => r.title.startsWith("Regenwasserzisterne")).quantity, rw.speicher.gesamt_m3);
    assert.equal(rows.find((r) => r.title.startsWith("Regenwasserfilter")).din276, "412");
    assert.equal(rows.find((r) => r.title.startsWith("Hebeanlage")).din276, "411");
  });

  it("KG-Vorschlag: exakt, über Präfix, sonst leer (nie geraten)", () => {
    assert.equal(kgVorschlag("rw_pumpe"), "412");
    assert.equal(kgVorschlag("gl_dn100"), "411");
    assert.equal(kgVorschlag("rh_mulde"), "541");
    assert.equal(kgVorschlag("staffel_120"), "363", "Gefälledämmung je Dickenstaffel");
    assert.equal(kgVorschlag("daemmung_volumen"), "363");
    assert.equal(kgVorschlag("unbekannt"), "");
  });

  it("leere Liste → nur Kopfzeile, Import liefert nichts", () => {
    const csv = mengenAlsLvCsv([]);
    assert.equal(csv, "﻿OZ;Kurztext;Menge;Einheit;Gewerk;DIN276;EP\r\n");
    assert.deepEqual(parseLvCsv(csv), []);
  });
});

describe("91-05 — Tiefgarage, Keller, TGA-Netz", () => {
  it("Tabellenliste: Summenzeile fällt weg, Präfix trennt die Quellen, keine KG für Flächen", async () => {
    const { zeilenAusTabelle } = await import("@designer/lib/avaUebergabe");
    const keller = [
      { key: "abteile_stk", label: "Kellerabteile", einheit: "Stk", wert: 12 },
      { key: "trennwaende_lfm", label: "Abteil-Zwischenwände", einheit: "lfm", wert: 33.6 },
      { key: "gesamt_m2", label: "Kellerfläche gesamt (Zonen)", einheit: "m²", wert: 400 },
    ];
    const z = zeilenAusTabelle(keller, { ohne: ["gesamt_m2"], praefix: "keller_" });
    assert.deepEqual(z.map((x) => x.key), ["keller_abteile_stk", "keller_trennwaende_lfm"]);
    const rows = parseLvCsv(mengenAlsLvCsv(z, { gewerk: "Keller" }));
    assert.deepEqual(rows.map((r) => [r.quantity, r.unit, r.din276]), [[12, "Stk", ""], [33.6, "lfm", ""]]);
  });

  it("TGA-Netz: Leitungen je Gewerk + DN, Knoten je Art, KG nach Gewerk", async () => {
    const { netzZeilen } = await import("@designer/lib/avaUebergabe");
    const z = netzZeilen({
      lfm: [{ gewerk: "heizung", dn: 25, lfm: 48.2 }, { gewerk: "elektro", dn: 2.5, lfm: 120 }, { gewerk: "trinkwasser", dn: null, lfm: 10 }],
      knoten: [{ gewerk: "lueftung", art: "auslass", stk: 14 }, { gewerk: "abwasser", art: "anschluss", stk: 1 }],
    });
    const rows = parseLvCsv(mengenAlsLvCsv(z, { gewerk: "Haustechnik" }));
    assert.deepEqual(rows.map((r) => r.title), ["Heizung-Leitung DN 25", "Elektro-Leitung 2,5 mm²", "Trinkwasser-Leitung DN offen", "Lüftung: Auslass / Verbraucher", "Abwasser: Hausanschluss / Übergabe"]);
    assert.deepEqual(rows.map((r) => r.din276), ["422", "444", "412", "431", "411"]);
    assert.deepEqual(rows.map((r) => r.quantity), [48.2, 120, 10, 14, 1]);
    assert.deepEqual(netzZeilen(null), []);
  });
});
