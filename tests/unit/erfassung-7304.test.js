// Unit tests for 73-04: the Erfassungsgrad axis (no default, synonyms, rank), the deviation schema defined
// once, and the basis of the build-up per kind of work (new build: none; existing building: named, never
// silent).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ERFASSUNG_WERTE, ERFASSUNG_RANG, normalizeErfassung, erfassungAnzeige, ABWEICHUNG_SCHEMA, AUFBAU_HERKUNFT, aufbauGrundlage,
  STATUS_WERTE,
} from "@core/lib/bimClassification";

describe("73-04 Erfassungsgrad", () => {
  it("normalises spellings, unknown and empty stay null — no default", () => {
    assert.equal(normalizeErfassung("Gemessen"), "gemessen");
    assert.equal(normalizeErfassung("Aufmaß"), "gemessen");
    assert.equal(normalizeErfassung("as-built"), "altplan");
    assert.equal(normalizeErfassung("Regelaufbau"), "angenommen");
    assert.equal(normalizeErfassung("derived"), "abgeleitet");
    for (const x of [null, undefined, "", "bestand", "ja", 4]) assert.equal(normalizeErfassung(x), null, String(x));
    assert.equal(erfassungAnzeige(null), "unbekannt");
    assert.equal(erfassungAnzeige("altplan"), "Altplan");
  });

  it("four values, a strict rank, and a separate axis from the status", () => {
    assert.deepEqual(ERFASSUNG_WERTE, ["gemessen", "abgeleitet", "altplan", "angenommen"]);
    assert.ok(ERFASSUNG_RANG.gemessen > ERFASSUNG_RANG.abgeleitet && ERFASSUNG_RANG.abgeleitet > ERFASSUNG_RANG.altplan && ERFASSUNG_RANG.altplan > ERFASSUNG_RANG.angenommen);
    for (const w of ERFASSUNG_WERTE) assert.equal(STATUS_WERTE.includes(w), false);
  });

  it("deviation schema: reason, compensation, application state", () => {
    for (const f of ["regel_id", "begruendung", "kompensation", "antrag_status"]) assert.ok(ABWEICHUNG_SCHEMA.felder.includes(f), f);
    assert.ok(Object.isFrozen(ABWEICHUNG_SCHEMA));
    assert.ok(ABWEICHUNG_SCHEMA.arten.bestandsschutz);
  });

  it("basis of the build-up: none in a new build; named in an existing building, unknown is said aloud", () => {
    assert.deepEqual(aufbauGrundlage("neubau", "oeffnung"), { herkunft: null, text: null });
    assert.match(aufbauGrundlage("bestand", undefined).text, /Grundlage nicht angegeben.*Regelaufbauten/);
    assert.match(aufbauGrundlage("bestand", "archivplan").text, /Archivplan — nach einer Bauteilöffnung hochstufen/);
    assert.equal(aufbauGrundlage("bestand", "oeffnung").text, "Bauteilaufbau: Bauteilöffnung.");
    assert.equal(aufbauGrundlage("bestand", "quatsch").herkunft, null);
    assert.deepEqual(Object.keys(AUFBAU_HERKUNFT), ["oeffnung", "archivplan", "regelaufbau"]);
  });
});
