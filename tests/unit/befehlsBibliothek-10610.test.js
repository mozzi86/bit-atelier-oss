// 106-10 — the office's command library: checking templates, allowed values, the speech grammar with templates (a fitting sentence becomes
// the property command, a value outside the list is refused with the list, also in the free "setze … auf …" form), and the model's task text.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  STANDARD_VORLAGEN, bibliothekAktuell, bibliothekNormen, bibliothekPromptZeilen, bibliothekSetzen, erlaubteWerte, vorlagePruefen,
} from "@core/lib/zeigen/befehlsBibliothek.js";
import { sprachbefehl } from "@core/lib/zeigen/sprachbefehl.js";
import { agentAuftrag } from "@core/lib/zeigen/sprachAgent.js";
import { KEINE_AUSWAHL_TEXT } from "@core/lib/zeigen/auswahlKontext.js";

const BIB = bibliothekNormen(STANDARD_VORLAGEN);
const SEL = { auswahl: { anzahl: 1, bauteile: [{ guid: "G1", klasse: "IfcWall" }] } };
const mit = (text, k = {}) => sprachbefehl(text, { ...SEL, bibliothek: BIB, ...k });

describe("106-10 befehlsBibliothek — templates", () => {
  it("the starting set is valid; values come in the property's own spelling", () => {
    assert.equal(BIB.length, STANDARD_VORLAGEN.length);
    const fw = BIB.find((v) => v.eigenschaft === "feuerwiderstand");
    assert.ok(fw.werte.includes("EI 90"));
    assert.equal(vorlagePruefen({ satz: "Brandschutz {wert}", eigenschaft: "Feuerwiderstand", werte: "f30, ei90, F30" }).werte.join("|"), "F30|EI 90", "normal form, duplicates removed");
  });

  it("refuses what the grammar could not use, with the reason", () => {
    const f = (v) => () => vorlagePruefen({ eigenschaft: "feuerwiderstand", werte: ["F30"], ...v });
    assert.throws(f({ satz: "" }), /Satz fehlt/);
    assert.throws(f({ satz: "Setze {eigenschaft} auf" }), /genau einmal \{wert\}/);
    assert.throws(f({ satz: "Setze {wert} jetzt" }), /am Ende/);
    assert.throws(f({ satz: "{eigenschaft} {wert}" }), /festes Wort/);
    assert.throws(f({ satz: "Setze {farbe} auf {wert}" }), /\{farbe\} gibt es nicht/);
    assert.throws(f({ satz: "Setze {wert}", eigenschaft: "farbe" }), /Eigenschaft „farbe“/);
    assert.throws(f({ satz: "Setze {wert}", werte: ["F45x"] }), /keine Feuerwiderstandsklasse/);
    assert.throws(f({ satz: "Setze {wert}", werte: [] }), /mindestens ein/);
  });

  it("normalising drops invalid and switched-off templates; allowed values merge per property; the cache holds the normal form", () => {
    const liste = bibliothekNormen([...STANDARD_VORLAGEN, { satz: "kaputt", eigenschaft: "x", werte: [] }, { satz: "Feuer {wert}", eigenschaft: "feuerwiderstand", werte: ["F180"], aktiv: false }]);
    assert.equal(liste.length, STANDARD_VORLAGEN.length);
    assert.equal(erlaubteWerte(liste, "Brandschutz") ?? null, null, "spoken names are not field names: only field or IFC spelling");
    assert.ok(erlaubteWerte(liste, "feuerwiderstand").includes("F90"));
    assert.equal(erlaubteWerte(liste, "material"), null, "no template, no restriction");
    bibliothekSetzen([STANDARD_VORLAGEN[1]]);
    assert.deepEqual(bibliothekAktuell().map((v) => v.eigenschaft), ["status"]);
    bibliothekSetzen([]);
  });
});

describe("106-10 grammar with the office's templates", () => {
  it("a fitting sentence becomes the property command (also with 'dieser Wand', verb at the end, number words)", () => {
    for (const [satz, wert] of [["Setze Brandschutz auf F90", "F90"], ["setze den Brandschutz dieser Wand auf F 90", "F90"], ["Brandschutz auf EI 90 setzen", "EI 90"],
      ["setze feuerwiderstand auf F neunzig", "F90"]]) {
      const r = mit(satz);
      assert.equal(r?.art, "befehl", `${satz}: ${JSON.stringify(r)}`);
      assert.equal(r.befehl, "eigenschaft-setzen");
      assert.deepEqual(r.params, { name: "feuerwiderstand", wert });
      assert.match(r.verstanden, /Büro-Vorlage/);
    }
    assert.deepEqual(mit("Markiere dieses als Abbruch").params, { name: "status", wert: "abbruch" });
    assert.deepEqual(mit("setze kostengruppe auf 341").params, { name: "kg", wert: "341" });
  });

  it("a value outside the list is refused with the allowed values - never proposed", () => {
    const r = mit("Setze Brandschutz auf F45");
    assert.equal(r.art, "abgelehnt");
    assert.match(r.grund, /nicht in der Befehlsbibliothek des Büros — erlaubt: F30, F60, F90, F120, EI 30, EI 60, EI 90, REI 90/);
    assert.match(mit("setze kostengruppe auf 999").grund, /erlaubt: 331/);
    assert.match(mit("Setze Brandschutz auf").grund ?? "", /Wert fehlt/);
    // the free form ("ändere … auf …") is held to the same list
    assert.match(mit("ändere den Feuerwiderstand auf F45").grund, /Befehlsbibliothek/);
    assert.equal(mit("ändere den Feuerwiderstand auf F60").params.wert, "F60");
  });

  it("without a selection the template is refused like every change (not guessed); without a library the grammar is as before", () => {
    assert.equal(sprachbefehl("Setze Brandschutz auf F90", { bibliothek: BIB }).grund, KEINE_AUSWAHL_TEXT);
    const ohne = sprachbefehl("Setze Brandschutz auf F45", SEL);
    assert.equal(ohne.art, "befehl");
    assert.equal(ohne.params.wert, "F45");
    assert.equal(mit("Setze Material auf Beton").params.wert, "Beton", "a property the library does not restrict stays free");
  });

  it("the model's task text names the allowed values (text only); without a library nothing is added", () => {
    const auftrag = agentAuftrag("mach das feuerfest", SEL.auswahl, { bibliothek: BIB });
    assert.match(auftrag, /Befehlsbibliothek des Büros/);
    assert.match(auftrag, /Feuerwiderstand: F30, F60, F90/);
    assert.match(auftrag, /„Setze Feuerwiderstand auf \{wert\}“/);
    assert.ok(!/Befehlsbibliothek/.test(agentAuftrag("x", SEL.auswahl, {})));
    assert.deepEqual(bibliothekPromptZeilen([]), []);
  });
});
