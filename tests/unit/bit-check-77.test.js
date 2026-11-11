// Phase 77 — bit-check self-check (Register 125 / 77-04).
//
// Pins: generated IDS is well-formed for parseIdsXml+DOMParserMini; BCF zip
// carries bcf.version + markup.bcf + viewpoint.bcfv; JSON finding counts match
// BEISPIEL_ERWARTET for public/beispiel/musterprojekt.ifc (24 graded findings).

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { BEISPIEL_ERWARTET } from "../../tools/beispielmodell-erzeugen.mjs";
import { parseIdsXml } from "@ifc/lib/ids.js";
import { DOMParserMini, parseXmlMini } from "@ifc/lib/domParserMini.js";
import { schreibeIds } from "@ifc/lib/idsWriter.js";
import { ROLLEN_GRUPPEN } from "@ifc/lib/clash.js";
import {
  bitCheckAusfuehren,
  bitCheckLauf,
  bitCheckSchreiben,
  exitCodeFuer,
  parseArgs,
  bcfZipInhalt,
  BitCheckFehler,
} from "@ifc/lib/bitCheck.js";
import { buildBcfZip, newTopicGuid } from "@ifc/lib/bcf.js";

const REPO = path.resolve(import.meta.dirname, "../..");
const IFC = path.join(REPO, "public/beispiel/musterprojekt.ifc");
const IDS = path.join(REPO, "public/beispiel/musterprojekt.ids");

describe("77 bit-check — args and exit codes", () => {
  it("parseArgs reads model and flags", () => {
    const a = parseArgs([
      "a.ifc",
      "--regeln",
      "r.ids",
      "--vorlauf=alt.json",
      "--streng",
    ]);
    assert.equal(a.modell, "a.ifc");
    assert.equal(a.regeln, "r.ids");
    assert.equal(a.vorlauf, "alt.json");
    assert.equal(a.streng, true);
  });

  it("parseArgs rejects unknown flags with exit 2", () => {
    assert.throws(() => parseArgs(["a.ifc", "--nope"]), (e) => e instanceof BitCheckFehler && e.exitCode === 2);
  });

  it("exitCodeFuer: hart/IDS → 1; vorlauf hartZunahme; --streng on any finding", () => {
    assert.equal(exitCodeFuer({ kennzahlen: { hart: 0, idsVerletzt: 0, befunde: 0 } }), 0);
    assert.equal(exitCodeFuer({ kennzahlen: { hart: 1, idsVerletzt: 0, befunde: 1 } }), 1);
    assert.equal(exitCodeFuer({ kennzahlen: { hart: 0, idsVerletzt: 1, befunde: 1 } }), 1);
    assert.equal(exitCodeFuer({ kennzahlen: { hart: 0, idsVerletzt: 0, befunde: 3 }, vergleichLauf: { hartZunahme: 0 } }), 0);
    assert.equal(exitCodeFuer({ kennzahlen: { hart: 0, idsVerletzt: 0, befunde: 3 }, vergleichLauf: { hartZunahme: 2 } }), 1);
    assert.equal(exitCodeFuer({ kennzahlen: { hart: 0, idsVerletzt: 0, befunde: 1 }, streng: true }), 1);
    assert.equal(exitCodeFuer({ kennzahlen: { hart: 0, idsVerletzt: 0, befunde: 0 }, streng: true }), 0);
  });
});

describe("77 bit-check — IDS well-formed (DOMParserMini)", () => {
  it("musterprojekt.ids parses to one FireRating specification", () => {
    const xml = fs.readFileSync(IDS, "utf8");
    const specs = parseIdsXml(xml, DOMParserMini);
    assert.equal(specs.length, 1);
    assert.match(specs[0].name, /Feuerwiderstand/i);
    assert.equal(specs[0].applicability[0].typ, "entity");
    assert.equal(specs[0].applicability[0].name.wert, "IFCWALL");
    assert.equal(specs[0].requirements[0].typ, "property");
    assert.equal(specs[0].requirements[0].baseName.wert, "FireRating");
  });

  it("schreibeIds output is re-parseable and keeps the spec name", () => {
    const specs = [
      {
        name: "TestSpec",
        identifier: "T-1",
        beschreibung: null,
        hinweise: null,
        ifcVersions: ["IFC4"],
        kardinalitaet: "required",
        applicability: [{ typ: "entity", name: { art: "simple", wert: "IFCWALL" }, predefinedType: null }],
        requirements: [{
          typ: "property",
          propertySet: { art: "simple", wert: "Pset_WallCommon" },
          baseName: { art: "simple", wert: "FireRating" },
          value: null,
          dataType: "IFCLABEL",
          cardinality: "required",
        }],
      },
    ];
    const { xml, warnungen } = schreibeIds(specs, { title: "bit-check self" });
    assert.equal(warnungen.length, 0);
    assert.match(xml, /xsi:schemaLocation|xmlns:xs|buildingsmart\.org\/IDS/);
    const back = parseIdsXml(xml, DOMParserMini);
    assert.equal(back.length, 1);
    assert.equal(back[0].name, "TestSpec");
  });

  it("parseXmlMini rejects DOCTYPE (XXE)", () => {
    assert.throws(() => parseXmlMini('<!DOCTYPE foo [<!ENTITY x "y">]><a/>'));
  });
});

describe("77 bit-check — BCF zip shape", () => {
  it("buildBcfZip contains bcf.version, markup.bcf, viewpoint.bcfv", () => {
    const bytes = buildBcfZip([
      {
        guid: newTopicGuid(),
        titel: "Kollision: Test",
        beschreibung: "self-check",
        ifcGuids: ["2O2Fr$t4X7Zf8NOew3FNr2"],
      },
    ], { autor: "bit-check", modellName: "musterprojekt.ifc" });
    const info = bcfZipInhalt(bytes);
    assert.equal(info.hatVersion, true);
    assert.ok(info.markup >= 1, "markup.bcf missing");
    assert.ok(info.viewpoints >= 1, "viewpoint.bcfv missing");
    assert.ok(info.dateien.some((n) => n.endsWith("/markup.bcf")));
    assert.ok(info.dateien.some((n) => n.endsWith("/viewpoint.bcfv")));
  });
});

describe("77 bit-check — musterprojekt finding counts", () => {
  /** @type {Awaited<ReturnType<typeof bitCheckLauf>>} */
  let lauf;
  /** @type {string} */
  let tmp;

  before(async () => {
    assert.ok(fs.existsSync(IFC), "musterprojekt.ifc missing");
    lauf = await bitCheckLauf({
      modellPfad: IFC,
      idsPfad: IDS,
    });
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bit-check-77-"));
  });

  it("matches BEISPIEL_ERWARTET (24 graded findings)", () => {
    const k = lauf.kennzahlen;
    assert.equal(k.bauteile, BEISPIEL_ERWARTET.bauteile);
    assert.equal(k.hart, BEISPIEL_ERWARTET.hart);
    assert.equal(k.duplikate, BEISPIEL_ERWARTET.duplikate);
    assert.equal(k.idsVerletzungen, BEISPIEL_ERWARTET.idsFehler);
    assert.equal(k.befunde, BEISPIEL_ERWARTET.befunde);
  });

  it("writes BCF/JSON whose counts and zip contents match", () => {
    const { exitCode, geschrieben } = bitCheckSchreiben(lauf, {
      bcf: path.join(tmp, "out.bcf"),
      json: path.join(tmp, "out.json"),
      bericht: path.join(tmp, "out.pdf"),
      csv: path.join(tmp, "out.csv"),
      streng: true,
    });
    assert.equal(exitCode, 1);
    assert.equal(geschrieben.length, 4);
    const json = JSON.parse(fs.readFileSync(path.join(tmp, "out.json"), "utf8"));
    assert.equal(json.kennzahlen.befunde, BEISPIEL_ERWARTET.befunde);
    assert.equal(json.befunde.length, BEISPIEL_ERWARTET.befunde);
    const bcf = bcfZipInhalt(fs.readFileSync(path.join(tmp, "out.bcf")));
    assert.equal(bcf.hatVersion, true);
    assert.ok(bcf.markup >= BEISPIEL_ERWARTET.befunde - BEISPIEL_ERWARTET.idsFehler); // clash topics + IDS topics
    assert.ok(bcf.viewpoints === bcf.markup);
    assert.ok(fs.statSync(path.join(tmp, "out.pdf")).size > 1000);
    assert.match(fs.readFileSync(path.join(tmp, "out.csv"), "utf8"), /GlobalId/);
  });

  it("vorlauf self-compare yields hartZunahme 0 → exit 0", () => {
    const vor = path.join(tmp, "vorlauf.json");
    fs.writeFileSync(vor, JSON.stringify(lauf.zusammenfassung));
    return bitCheckLauf({
      modellPfad: IFC,
      idsPfad: IDS,
      vorlaufPfad: vor,
    }).then((zweiter) => {
      assert.equal(zweiter.vergleichLauf.hartZunahme, 0);
      assert.equal(exitCodeFuer({
        kennzahlen: zweiter.kennzahlen,
        vergleichLauf: zweiter.vergleichLauf,
      }), 0);
    });
  });
});

describe("77 bit-check — BAP without a second model, empty IDS", () => {
  it("single-model --bap applies that matrix and the report names it", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bit-check-bap-"));
    const bapPfad = path.join(tmp, "sample-matrix.json");
    const jsonPfad = path.join(tmp, "out.json");
    // Same type pairs as the standard matrix, but one named rule. Standard
    // rules carry no id, so a hard finding stamped SAMPLE-MATRIX can only
    // come from this file — including when no second model is passed.
    fs.writeFileSync(bapPfad, JSON.stringify({
      name: "Sample clash matrix",
      regeln: [{
        id: "SAMPLE-MATRIX",
        name: "Services against structure and architecture",
        art: "schnitt",
        toleranzMm: 1,
        a: { klassen: ROLLEN_GRUPPEN.tga },
        b: { klassen: [...ROLLEN_GRUPPEN.tragwerk, ...ROLLEN_GRUPPEN.architektur] },
      }],
    }));

    const r = await bitCheckAusfuehren([
      IFC,
      "--bap",
      bapPfad,
      "--json",
      jsonPfad,
    ]);

    assert.equal(r.fehler, undefined);
    assert.equal(r.lauf.ergebnis.zweiModelle, false);
    assert.equal(r.lauf.regelsatzName, "Sample clash matrix");
    assert.equal(r.lauf.zusammenfassung.regelsatz, "Sample clash matrix");
    const hard = r.lauf.ergebnis.clash.clashes.filter((c) => c.kind === "hard");
    assert.equal(hard.length, BEISPIEL_ERWARTET.hart);
    assert.ok(hard.every((c) => c.regel && c.regel.id === "SAMPLE-MATRIX"));
    assert.equal(r.lauf.kennzahlen.duplikate, BEISPIEL_ERWARTET.duplikate);
    const json = JSON.parse(fs.readFileSync(jsonPfad, "utf8"));
    assert.equal(json.regelsatz, "Sample clash matrix");
    const jsonHard = json.befunde.filter((b) => b.art === "hard");
    assert.equal(jsonHard.length, BEISPIEL_ERWARTET.hart);
    assert.ok(jsonHard.every((b) => b.schluessel.startsWith("hard|SAMPLE-MATRIX|")));
  });

  it("--regeln with zero specifications fails and does not report a pass", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bit-check-ids-"));
    /** @type {Array<[string, string]>} */
    const dateien = [
      ["empty-specs.ids", `<?xml version="1.0" encoding="UTF-8"?>
<ids xmlns="http://standards.buildingsmart.org/IDS">
  <info><title>Empty</title></info>
  <specifications></specifications>
</ids>
`],
      ["missing-namespace.ids", `<?xml version="1.0" encoding="UTF-8"?>
<ids>
  <specifications>
    <specification name="Ghost" ifcVersion="IFC4">
      <applicability minOccurs="1" maxOccurs="unbounded">
        <entity><name><simpleValue>IFCWALL</simpleValue></name></entity>
      </applicability>
      <requirements></requirements>
    </specification>
  </specifications>
</ids>
`],
      ["truncated.ids", `<?xml version="1.0" encoding="UTF-8"?>
<ids xmlns="http://standards.buildingsmart.org/IDS">
  <info><title>Cut`],
    ];

    for (const [name, xml] of dateien) {
      const pfad = path.join(tmp, name);
      fs.writeFileSync(pfad, xml);
      const r = await bitCheckAusfuehren([IFC, "--regeln", pfad]);
      assert.equal(r.exitCode, 2, name);
      assert.equal(r.lauf, undefined, name);
      assert.match(r.fehler || "", /keine <specification>-Einträge/, name);
      assert.match(r.fehler || "", new RegExp(name.replace(".", "\\.")), name);
    }
  });
});
