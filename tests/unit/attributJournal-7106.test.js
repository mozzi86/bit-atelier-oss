// Unit tests for 71-06 (ROHB-06): attribute editor journal — typing of edited values, effective
// values per property (newest wins, original = value before the first edit), editor rows over the
// model psets, the export in the harness writer format (71-05) and the undo target.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  JOURNAL_FORMAT, JOURNAL_VERSION, wertTypisieren, eintragBauen, wirksameWerte, editorZeilen,
  journalExport, letzterEintrag, journalDateiname, gleich,
} from "@ifc/lib/attributJournal";

const M = "rohbau.ifc";
const G = "2O2Fr$t4X7Zf8NOew3FLOH";
const e = (pset, eigenschaft, alt, wert, zeit, guid = G, modell = M) =>
  eintragBauen({ projectId: "p1", modell, guid, pset, eigenschaft, alt, wert, zeit });

describe("71-06 Attribut-Journal", () => {
  it("types the input like the current value", () => {
    assert.equal(wertTypisieren("0,25", 0.2), 0.25);
    assert.equal(wertTypisieren(" 30 ", 12), 30);
    assert.equal(wertTypisieren("ja", false), true);
    assert.equal(wertTypisieren("false", true), false);
    assert.equal(wertTypisieren("C30/37", "C25/30"), "C30/37");
    assert.equal(wertTypisieren("12", null), "12");
    assert.throws(() => wertTypisieren("dick", 0.2), /keine Zahl/);
    assert.throws(() => wertTypisieren("vielleicht", true), /weder ja noch nein/);
  });

  it("entry needs model, guid, pset and property", () => {
    assert.throws(() => eintragBauen({ modell: M, guid: "", pset: "PRJ", eigenschaft: "Material", alt: 1, wert: 2 }), /guid fehlt/);
    const x = e("PRJ", "Material", "C25/30", "C30/37", "2026-10-12T10:00:00Z");
    assert.deepEqual(x, { project_id: "p1", modell: M, guid: G, pset: "PRJ", eigenschaft: "Material",
      alt: "C25/30", wert: "C30/37", zeit: "2026-10-12T10:00:00Z" });
  });

  it("newest entry wins, original stays the value before the first edit", () => {
    const j = [e("PRJ", "Material", "C30/37", "C35/45", "2026-10-12T11:00:00Z"),
      e("PRJ", "Material", "C25/30", "C30/37", "2026-10-12T10:00:00Z"),
      e("PRJ", "Material", "C25/30", "X", "2026-10-12T09:00:00Z", "andereGuid"),
      e("PRJ", "Material", "C25/30", "Y", "2026-10-12T09:00:00Z", G, "anderes.ifc")];
    const w = wirksameWerte(j, M, G);
    assert.equal(w.size, 1);
    const v = [...w.values()][0];
    assert.equal(v.wert, "C35/45");
    assert.equal(v.original, "C25/30");
    assert.equal(v.anzahl, 2);
  });

  it("editor rows overlay the model psets and keep journal-only properties", () => {
    const psets = { PRJ: { Material: "C25/30", DIN276_Nummer: "331" }, Pset_WallCommon: { LoadBearing: true } };
    const j = [e("PRJ", "Material", "C25/30", "C30/37", "2026-10-12T10:00:00Z"),
      e("PRJ", "Betondeckung_mm", null, "35", "2026-10-12T10:05:00Z")];
    const z = editorZeilen(psets, j, M, G);
    const mat = z.find((r) => r.eigenschaft === "Material");
    assert.deepEqual([mat.wert, mat.original, mat.geaendert], ["C30/37", "C25/30", true]);
    assert.equal(z.find((r) => r.eigenschaft === "DIN276_Nummer").geaendert, false);
    assert.equal(z.find((r) => r.eigenschaft === "LoadBearing").wert, true);
    const neu = z.find((r) => r.eigenschaft === "Betondeckung_mm");
    assert.deepEqual([neu.pset, neu.wert, neu.original, neu.geaendert], ["PRJ", "35", null, true]);
  });

  it("a value set back to the original is not marked as changed", () => {
    const z = editorZeilen({ PRJ: { Material: "C25/30" } },
      [e("PRJ", "Material", "C25/30", "C30/37", "2026-10-12T10:00:00Z"),
        e("PRJ", "Material", "C30/37", "C25/30", "2026-10-12T10:01:00Z")], M, G);
    assert.equal(z[0].geaendert, false);
  });

  it("export: harness format, one entry per property, alt = first old value, no-ops dropped", () => {
    const j = [e("PRJ", "Material", "C25/30", "C30/37", "2026-10-12T10:00:00Z"),
      e("PRJ", "Material", "C30/37", "C35/45", "2026-10-12T11:00:00Z"),
      e("Pset_WallCommon", "FireRating", "F30", "F90", "2026-10-12T10:00:00Z"),
      e("Pset_WallCommon", "FireRating", "F90", "F30", "2026-10-12T10:30:00Z"),
      e("PRJ", "Material", "C25/30", "Z", "2026-10-12T10:00:00Z", G, "anderes.ifc")];
    const x = journalExport(j, M, "2026-10-12T12:00:00Z");
    assert.equal(x.format, JOURNAL_FORMAT);
    assert.equal(x.format, "bit-ifc-journal");
    assert.equal(x.version, JOURNAL_VERSION);
    assert.equal(x.modell, M);
    assert.deepEqual(x.eintraege, [{ guid: G, pset: "PRJ", eigenschaft: "Material", alt: "C25/30", wert: "C35/45", zeit: "2026-10-12T11:00:00Z" }]);
  });

  it("undo target is the newest entry of that property", () => {
    const a = e("PRJ", "Material", "C25/30", "C30/37", "2026-10-12T10:00:00Z");
    const b = e("PRJ", "Material", "C30/37", "C35/45", "2026-10-12T11:00:00Z");
    assert.equal(letzterEintrag([b, a], M, G, "PRJ", "Material"), b);
    assert.equal(letzterEintrag([a], M, G, "PRJ", "Anderes"), null);
  });

  it("value equality and file name", () => {
    assert.ok(gleich(1, "1.0"));
    assert.ok(!gleich(null, ""));
    assert.ok(gleich(true, "true"));
    assert.equal(journalDateiname("Rohbau TX.ifc"), "Rohbau_TX.journal.json");
  });
});
