// 106-10 — review workplace "Modellfreigabe": the ordered step list (part of 102-01), the change log with status, release and reversal,
// the list of unreviewed AI changes for the plans (106-11), the export without images (D-IM-02), the hooks in the change commands,
// the write lock of the server (D-IM-04: a program never releases) and the MCP server's refusal.
// The command library has its own file (befehlsBibliothek-10610.test.js).

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import express from "express";
import { befehlsRegister } from "@core/lib/befehlsregister.js";
import { aenderungsBefehleRegistrieren } from "@core/lib/zeigen/aenderungsBefehle.js";
import { vorschlagSpeicher } from "@core/lib/zeigen/vorschlagSpeicher.js";
import { vorschlagAusfuehren, vorschlagVorbereiten } from "@core/lib/zeigen/vorschlag.js";
import { auswahlKontext } from "@core/lib/zeigen/auswahlKontext.js";
import { bauteilGuid } from "@core/lib/bauteil/steckbrief.js";
import { SCHRITT_ENTITY, pruefungKurz, schrittAktiv, schrittAusEintrag, schritteOrdnen, spaetereAktive } from "@core/lib/verlauf/schrittVerlauf.js";
import { NUR_PERSON_SCHREIBT, VORLAGE_ENTITY } from "@core/lib/verlauf/entitaeten.js";
import {
  BILD_ENTFERNT, OHNE_NAME_TEXT, STATUS_DARSTELLUNG, bildFrei, freigabeAusfuehren, freigabeVermerk, kiAenderung, protokollCsv, protokollFiltern,
  ruecknahmeAusfuehren, ruecknahmePlanen, ruecknahmeVermerk, sammelReihenfolge, schrittGuids, schrittStatus, statusZaehlen, ungepruefteKiAenderungen,
  vorherNachher,
} from "@core/lib/zeigen/aenderungsProtokoll.js";
import { pruefeAttributeVorUebernahme } from "@ifc/lib/mengenAttributPruefung.js";
import { createDb } from "../../packages/nova-core/server/db.js";
import { entitiesRouter, NUR_PERSON_TEXT } from "../../packages/nova-core/server/routes.js";

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const P = "p1";
const wand = (idx, extra = {}) => ({ a: { x: 0, z: idx * 10 }, b: { x: 6, z: idx * 10 }, level: 0, thickness: 0.24, height: 3, _idx: idx, ...extra });
const guidW = (w) => bauteilGuid(P, "customWalls", w);
const OPT = { projektId: P, geschosshoehe_m: 3, attributPruefung: pruefeAttributeVorUebernahme };

/**
 * Runs one change through the real pipeline (proposal -> confirmation) and returns the new model and the stored step record.
 * @param {any} modell @param {any} eingabe @param {{zeit: string, autor?: string, id: string}} o
 */
function schritt(modell, eingabe, o) {
  const v = vorschlagVorbereiten(modell, eingabe, { ...OPT, id: o.id, zeit: o.zeit });
  const r = vorschlagAusfuehren(modell, v, { ...OPT, bestaetigt_durch: "hand", zeit: o.zeit });
  return { modell: r.modell, rec: { id: `rec-${o.id}`, ...schrittAusEintrag(r.eintrag, { projektId: P, pruefung: v.pruefung, autor: o.autor ?? "Person A" }) } };
}

describe("106-10 schrittVerlauf (part of 102-01): one node per confirmed step", () => {
  it("builds the stored record from the origin record: origin list, state before/after, check, author, time; review fields empty", () => {
    const w = wand(1);
    const { rec } = schritt({ customWalls: [w] }, { art: "eigenschaft", ziel: { guid: guidW(w) }, params: { name: "feuerwiderstand", wert: "F90" },
      herkunft: { quelle: "agent", quellen: ["sprache", "agent", "bild"], befehl_text: "brandschutz neunzig" } }, { id: "a1", zeit: "2026-10-25T10:00:00.000Z" });
    assert.equal(rec.project_id, P);
    assert.equal(rec.quelle, "bim");
    assert.equal(rec.modell, null);
    assert.equal(rec.vorschlag_id, "a1");
    assert.deepEqual(rec.herkunft_quellen, ["sprache", "agent", "bild"]);
    assert.equal(rec.herkunft, "agent");
    assert.equal(rec.befehl_text, "brandschutz neunzig");
    assert.equal(rec.nachher.wert, "F90");
    assert.equal(rec.autor, "Person A");
    assert.equal(rec.bestaetigt_durch, "hand");
    assert.equal(rec.zeit, "2026-10-25T10:00:00.000Z");
    assert.ok(rec.pruefung && typeof rec.pruefung.stufe === "string" && Array.isArray(rec.pruefung.saetze));
    assert.equal(rec.zurueckgenommen, null);
    assert.equal(rec.freigabe, null);
    assert.ok("marke_vorher" in rec, "the undo needs the old mark");
    assert.equal(SCHRITT_ENTITY, "AenderungsSchritt");
  });

  it("refuses a record without project or origin; the check keeps level and at most the first sentences", () => {
    assert.throws(() => schrittAusEintrag({ vorschlag_id: "x", herkunft: "text" }, { projektId: "" }), /kein Projekt/);
    assert.throws(() => schrittAusEintrag({ vorschlag_id: "x" }, { projektId: P }), /Herkunft/);
    assert.equal(pruefungKurz(null), null);
    assert.deepEqual(pruefungKurz({ stufe: "warn", saetze: Array.from({ length: 20 }, (_, i) => `s${i}`), befunde: [{ x: 1 }] }).saetze.length, 8);
  });

  it("orders by time and names the later active steps of the same project", () => {
    const a = { vorschlag_id: "a", project_id: P, zeit: "2026-10-25T10:00:00Z" };
    const b = { vorschlag_id: "b", project_id: P, zeit: "2026-10-25T11:00:00Z" };
    const c = { vorschlag_id: "c", project_id: P, zeit: "2026-10-25T12:00:00Z", zurueckgenommen: { zeit: "x" } };
    const d = { vorschlag_id: "d", project_id: "anderes", zeit: "2026-10-25T13:00:00Z" };
    assert.deepEqual(schritteOrdnen([c, a, d, b]).map((s) => s.vorschlag_id), ["a", "b", "c", "d"]);
    assert.deepEqual(spaetereAktive([c, a, d, b], a).map((s) => s.vorschlag_id), ["b"], "reversed and foreign steps do not count");
    assert.equal(schrittAktiv(c), false);
  });
});

describe("106-10 aenderungsProtokoll — status, filter, release", () => {
  const ki = { id: "1", vorschlag_id: "1", project_id: P, herkunft: "agent", herkunft_quellen: ["sprache", "agent"], satz: "Wand W-1: Feuerwiderstand leer → F90", zeit: "2026-10-25T10:00:00Z", ziel: { guid: "G1", name: "Wand W-1" }, quelle: "bim" };
  const hand = { id: "2", vorschlag_id: "2", project_id: P, herkunft: "text", satz: "Wand W-2: Status", zeit: "2026-10-25T11:00:00Z", ziel: { guid: "G2" }, quelle: "bim" };
  const frei = { ...ki, id: "3", vorschlag_id: "3", zeit: "2026-10-25T12:00:00Z", freigabe: { status: "freigegeben", durch: "B", zeit: "z" } };
  const weg = { ...ki, id: "4", vorschlag_id: "4", zeit: "2026-10-25T13:00:00Z", zurueckgenommen: { zeit: "z", durch: null, ort: "fenster" }, quelle: "ifc" };
  const alle = [ki, hand, frei, weg];

  it("status: unreviewed / released / reversed; AI = agent, speech or image among the origins", () => {
    assert.deepEqual(alle.map(schrittStatus), ["ungeprueft", "ungeprueft", "freigegeben", "zurueckgenommen"]);
    assert.equal(kiAenderung(ki), true);
    assert.equal(kiAenderung(hand), false);
    assert.equal(kiAenderung({ herkunft: "sprache" }), true, "speech alone is an AI change (speech recognition)");
    for (const st of ["ungeprueft", "freigegeben", "zurueckgenommen"]) {
      const d = STATUS_DARSTELLUNG[st];
      assert.ok(d.wort && d.zeichen && d.rand, "word, sign and border form for every state (not colour alone)");
    }
    assert.equal(new Set(Object.values(STATUS_DARSTELLUNG).map((d) => d.rand)).size, 3, "three different border forms");
  });

  it("filter: default = AI steps, newest first; status, source and words narrow it; counts per state", () => {
    assert.deepEqual(protokollFiltern(alle).map((s) => s.id), ["4", "3", "1"]);
    assert.deepEqual(protokollFiltern(alle, { status: "ungeprueft" }).map((s) => s.id), ["1"]);
    assert.deepEqual(protokollFiltern(alle, { status: "ungeprueft", umfang: "alle" }).map((s) => s.id), ["2", "1"]);
    assert.deepEqual(protokollFiltern(alle, { quelle: "ifc" }).map((s) => s.id), ["4"]);
    assert.deepEqual(protokollFiltern(alle, { umfang: "alle", suche: "g2" }).map((s) => s.id), ["2"]);
    assert.deepEqual(statusZaehlen(alle), { ungeprueft: 1, freigegeben: 1, zurueckgenommen: 1, alle: 3 });
    assert.deepEqual(statusZaehlen(alle, "alle"), { ungeprueft: 2, freigegeben: 1, zurueckgenommen: 1, alle: 4 });
  });

  it("release note: needs the name; never for a reversed or an already released step", () => {
    const p = freigabeVermerk(ki, { durch: "Prüferin", zeit: "2026-10-25T14:00:00Z" });
    assert.deepEqual(p, { freigabe: { status: "freigegeben", durch: "Prüferin", zeit: "2026-10-25T14:00:00Z" } });
    assert.throws(() => freigabeVermerk(ki, { durch: "  " }), (e) => e.message === OHNE_NAME_TEXT);
    assert.throws(() => freigabeVermerk(weg, { durch: "X" }), /zurückgenommen/);
    assert.throws(() => freigabeVermerk(frei, { durch: "X" }), /Schon freigegeben durch B/);
    assert.deepEqual(ruecknahmeVermerk({ durch: "X", zeit: "t", ort: "freigabe" }), { zurueckgenommen: { zeit: "t", durch: "X", ort: "freigabe" } });
  });

  it("batch release: each step its note, a refused one is reported and the rest go on", async () => {
    const gespeichert = [];
    const r = await freigabeAusfuehren([ki, weg, hand], { durch: "Prüferin", zeit: "T", speichern: async (id, patch) => { gespeichert.push([id, patch]); return { id, ...patch }; } });
    assert.deepEqual(r.erledigt.map((s) => s.id), ["1", "2"]);
    assert.equal(r.fehler.length, 1);
    assert.match(r.fehler[0].text, /zurückgenommen/);
    assert.deepEqual(gespeichert.map(([id, p]) => [id, p.freigabe.durch, p.freigabe.zeit]), [["1", "Prüferin", "T"], ["2", "Prüferin", "T"]]);
  });

  it("unreviewed AI changes for the plans (106-11): only active, unreviewed AI steps; GUIDs of a split's parts included", () => {
    const teilen = { ...ki, id: "5", vorschlag_id: "5", art: "teilen", ziel: { guid: "GA" }, nachher: { teile: [{ guid: "GA1" }, { guid: "GA2" }] }, zeit: "2026-10-25T15:00:00Z" };
    const u = ungepruefteKiAenderungen([...alle, teilen]);
    assert.equal(u.anzahl, 2);
    assert.deepEqual(u.guids, ["G1", "GA", "GA1", "GA2"]);
    assert.deepEqual(schrittGuids(teilen), ["GA", "GA1", "GA2"]);
    // after the release the plan has nothing to flag
    const nachFreigabe = [ki, teilen].map((s) => ({ ...s, ...freigabeVermerk(s, { durch: "P" }) }));
    assert.equal(ungepruefteKiAenderungen(nachFreigabe).anzahl, 0);
  });

  it("export: combined origins (D-IM-07), name and time of the release, NDA head line, never image data (D-IM-02)", () => {
    const BILD = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    const mitBild = { ...ki, herkunft_quellen: ["sprache", "agent", "bild"], befehl_text: `schau ${BILD} an`, satz: `x iVBORw0KGgo${"A".repeat(80)}` };
    const csv = protokollCsv([mitBild, frei], { projekt: { name: "Testprojekt", nda: true }, jetzt: "2026-10-26T08:00:00Z" });
    assert.match(csv, /NDA-Projekt — ohne Bilder/);
    assert.match(csv, /Spracheingabe \+ Agent \+ Bildkontext/);
    assert.ok(!/data:image|iVBORw0KGgo/.test(csv), "no image data in the export");
    assert.ok(csv.includes(BILD_ENTFERNT));
    assert.match(csv, /Freigegeben;/);
    assert.match(csv, /;B;z;/, "release by and at");
    assert.equal(csv.split("\n").length, 4, "head, columns, two rows");
    assert.ok(!/NDA/.test(protokollCsv([ki], { projekt: { name: "Offen", nda: false } }).split("\n")[0].replace("Offen", "")), "no NDA line for an open project");
    assert.equal(bildFrei("ohne Bild"), "ohne Bild");
  });
});

describe("106-10 reversal from the workplace — the same rule as the viewer's undo", () => {
  it("plans a property reversal on the stored model: only the changed array, the value and the mark go back", () => {
    const w1 = wand(1), w2 = wand(2);
    const s1 = schritt({ customWalls: [w1, w2] }, { art: "eigenschaft", ziel: { guid: guidW(w1) }, params: { name: "feuerwiderstand", wert: "F90" }, herkunft: { quelle: "sprache" } }, { id: "s1", zeit: "2026-10-25T10:00:00Z" });
    const plan = ruecknahmePlanen(s1.rec, [s1.rec], { modell: s1.modell, projektId: P });
    assert.equal(plan.art, "bim");
    assert.deepEqual(Object.keys(plan.felder), ["customWalls"]);
    assert.equal(plan.felder.customWalls[0].feuerwiderstand, undefined);
    assert.equal(plan.felder.customWalls[0].geaendert_durch, undefined, "the mark of this step goes back too");
  });

  it("refuses when newer work would be lost (a later step on the same property) and when already reversed", () => {
    const w = wand(1);
    const s1 = schritt({ customWalls: [w] }, { art: "eigenschaft", ziel: { guid: guidW(w) }, params: { name: "feuerwiderstand", wert: "F60" }, herkunft: { quelle: "sprache" } }, { id: "s1", zeit: "2026-10-25T10:00:00Z" });
    const s2 = schritt(s1.modell, { art: "eigenschaft", ziel: { guid: guidW(w) }, params: { name: "feuerwiderstand", wert: "F90" }, herkunft: { quelle: "sprache" } }, { id: "s2", zeit: "2026-10-25T11:00:00Z" });
    assert.throws(() => ruecknahmePlanen(s1.rec, [s1.rec, s2.rec], { modell: s2.modell, projektId: P }), /erst den neueren Schritt/);
    assert.throws(() => ruecknahmePlanen({ ...s2.rec, zurueckgenommen: { zeit: "t" } }, [], { modell: s2.modell }), /schon zurückgenommen/);
    assert.throws(() => ruecknahmePlanen(s2.rec, [], {}), /Kein gespeichertes Modell/);
  });

  it("batch: newest first, so both steps on the same wall go back; the model is saved per step and each gets the note", async () => {
    const w = wand(1);
    const s1 = schritt({ customWalls: [w] }, { art: "eigenschaft", ziel: { guid: guidW(w) }, params: { name: "feuerwiderstand", wert: "F60" }, herkunft: { quelle: "sprache" } }, { id: "s1", zeit: "2026-10-25T10:00:00Z" });
    const s2 = schritt(s1.modell, { art: "transformieren", ziel: { guid: guidW(w) }, params: { verschiebung_m: [0.5, 0, 0] }, herkunft: { quelle: "agent", quellen: ["sprache", "agent"] } }, { id: "s2", zeit: "2026-10-25T11:00:00Z" });
    assert.deepEqual(sammelReihenfolge([s1.rec, s2.rec]).map((s) => s.vorschlag_id), ["s2", "s1"]);
    let gespeichert = s2.modell;
    const vermerke = [];
    let geladen = 0;
    const r = await ruecknahmeAusfuehren([s1.rec, s2.rec], [s1.rec, s2.rec], {
      projektId: P, durch: "Prüferin", zeit: "T",
      bimLaden: async () => { geladen += 1; return gespeichert; },
      bimSpeichern: async (felder) => { gespeichert = { ...gespeichert, ...felder }; },
      journalLaden: async () => [], journalLoeschen: async () => { throw new Error("nicht erwartet"); },
      vermerken: async (id, patch) => { vermerke.push([id, patch.zurueckgenommen.ort, patch.zurueckgenommen.durch]); return null; },
    });
    assert.deepEqual(r.fehler, []);
    assert.equal(geladen, 1, "the stored model is read once and carried along");
    assert.deepEqual(vermerke, [["rec-s2", "freigabe", "Prüferin"], ["rec-s1", "freigabe", "Prüferin"]]);
    const jetzt = gespeichert.customWalls[0];
    assert.deepEqual([jetzt.a, jetzt.b, jetzt.feuerwiderstand], [w.a, w.b, undefined], "geometry and property are back to the start");
  });

  it("a blocked step is reported with its reason, the others of the batch go on", async () => {
    const w1 = wand(1), w2 = wand(2);
    const s1 = schritt({ customWalls: [w1, w2] }, { art: "eigenschaft", ziel: { guid: guidW(w1) }, params: { name: "kg", wert: "331" }, herkunft: { quelle: "sprache" } }, { id: "s1", zeit: "2026-10-25T10:00:00Z" });
    const s2 = schritt(s1.modell, { art: "eigenschaft", ziel: { guid: guidW(w2) }, params: { name: "kg", wert: "341" }, herkunft: { quelle: "sprache" } }, { id: "s2", zeit: "2026-10-25T11:00:00Z" });
    // a hand edit after s1 changed the value again: s1 must not put its old value over it
    const gespeichert = { customWalls: s2.modell.customWalls.map((x) => (x._idx === 1 ? { ...x, kg: "332" } : x)) };
    const r = await ruecknahmeAusfuehren([s1.rec, s2.rec], [s1.rec, s2.rec], {
      projektId: P, durch: "P", bimLaden: async () => gespeichert, bimSpeichern: async () => {}, journalLaden: async () => [], journalLoeschen: async () => {},
      vermerken: async () => null,
    });
    assert.deepEqual(r.erledigt.map((s) => s.vorschlag_id), ["s2"]);
    assert.equal(r.fehler.length, 1);
    assert.match(r.fehler[0].text, /Spätere Änderung/);
  });

  it("IFC step: deletes exactly its journal entry (by time); a missing entry is reported", async () => {
    const rec = { id: "r1", vorschlag_id: "i1", project_id: P, quelle: "ifc", modell: "haus.ifc", art: "eigenschaft", herkunft: "agent",
      ziel: { guid: "3abcdefghijklmnopqrstu", quelle: "ifc", modell: "haus.ifc" }, vorher: { wert: null, pset: "Pset_WallCommon", eigenschaft: "FireRating" },
      nachher: { wert: "F90", pset: "Pset_WallCommon", eigenschaft: "FireRating" }, journal_zeit: "2026-10-25T10:00:00.000Z", zeit: "2026-10-25T10:00:00.000Z" };
    const eintraege = [
      { id: "j0", modell: "haus.ifc", guid: rec.ziel.guid, pset: "Pset_WallCommon", eigenschaft: "FireRating", zeit: "2026-10-24T09:00:00.000Z" },
      { id: "j1", modell: "haus.ifc", guid: rec.ziel.guid, pset: "Pset_WallCommon", eigenschaft: "FireRating", zeit: "2026-10-25T10:00:00.000Z" },
    ];
    const geloescht = [];
    const deps = { projektId: P, durch: "P", bimLaden: async () => ({}), bimSpeichern: async () => {}, vermerken: async () => null,
      journalLaden: async (m) => (m === "haus.ifc" ? eintraege : []), journalLoeschen: async (e) => { geloescht.push(e.id); } };
    const r = await ruecknahmeAusfuehren([rec], [rec], deps);
    assert.deepEqual(r.fehler, []);
    assert.deepEqual(geloescht, ["j1"]);
    const r2 = await ruecknahmeAusfuehren([rec], [rec], { ...deps, journalLaden: async () => [eintraege[0]] });
    assert.match(r2.fehler[0].text, /nicht mehr da/);
  });

  it("before / after in words per kind", () => {
    assert.deepEqual(vorherNachher({ art: "eigenschaft", vorher: { wert: null }, nachher: { wert: "F90" } }), { vorher: "leer", nachher: "F90" });
    assert.deepEqual(vorherNachher({ art: "teilen", vorher: { laenge_m: 6 }, nachher: { teile: [{ laenge_m: 3 }, { laenge_m: 3 }] } }), { vorher: "6 m", nachher: "3 m + 3 m" });
    assert.match(vorherNachher({ art: "transformieren", vorher: { geometrie: { a: { x: 0, z: 0 }, b: { x: 6, z: 0 } } }, nachher: { geometrie: { a: { x: 0.5, z: 0 }, b: { x: 6.5, z: 0 } } } }).nachher, /0,5/);
  });
});

describe("106-10 change commands feed the log", () => {
  it("bestaetigen hands the step to the log, rueckgaengig notes the reversal; an agent can do neither", () => {
    const w = wand(1);
    let modell = { customWalls: [w] };
    const bestaetigt = [], zurueck = [];
    const speicher = vorschlagSpeicher();
    const reg = befehlsRegister();
    aenderungsBefehleRegistrieren(reg, () => ({
      kontext: () => auswahlKontext([]), modell: () => modell, optionen: () => OPT, speicher,
      uebernehmen: (_v, r) => { modell = r.modell; }, zuruecknehmen: (_e, r) => { modell = r.modell; },
      schrittBestaetigt: (v, e) => bestaetigt.push([v.id, e.vorschlag_id, e.herkunft]),
      schrittZurueckgenommen: (e, ort) => zurueck.push([e.vorschlag_id, ort]),
    }));
    const v = reg.ausfuehren("eigenschaft-setzen", { guid: guidW(w), name: "feuerwiderstand", wert: "F90" }, { kanal: "steuerung" });
    assert.equal(v.ok, true, JSON.stringify(v));
    assert.equal(reg.ausfuehren("bestaetigen", {}, { kanal: "steuerung" }).ok, false, "an agent cannot confirm");
    assert.equal(bestaetigt.length, 0);
    assert.equal(reg.ausfuehren("bestaetigen", { durch: "hand" }).ok, true);
    assert.deepEqual(bestaetigt, [[v.result.id, v.result.id, "agent"]]);
    assert.equal(reg.ausfuehren("rueckgaengig", {}, { kanal: "steuerung" }).ok, false, "an agent cannot reverse");
    assert.equal(zurueck.length, 0);
    assert.equal(reg.ausfuehren("rueckgaengig", {}).ok, true);
    assert.deepEqual(zurueck, [[v.result.id, "fenster"]]);
  });
});

describe("106-10 server: the log and the command library are written only by the person (D-IM-04)", () => {
  let tmp, server, basis;
  before(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bit-atelier-10610-"));
    const db = createDb(path.join(tmp, "db.json"));
    const app = express();
    app.use(express.json());
    app.use("/api", entitiesRouter(db));
    await new Promise((r) => { server = app.listen(0, "127.0.0.1", r); });
    basis = `http://127.0.0.1:${server.address().port}/api`;
  });
  after(() => { server?.close(); fs.rmSync(tmp, { recursive: true, force: true }); });
  const BROWSER = { origin: "http://localhost:5183", "sec-fetch-site": "same-origin", "sec-fetch-mode": "cors" };
  /** A program: node:http sends neither Origin nor Sec-Fetch-*. */
  const programm = (pfad, method, body) => new Promise((resolve, reject) => {
    const u = new URL(`${basis}${pfad}`);
    const daten = body ? JSON.stringify(body) : "";
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method, headers: { "content-type": "application/json", "content-length": Buffer.byteLength(daten) } }, (res) => {
      let roh = ""; res.on("data", (c) => { roh += c; }); res.on("end", () => resolve({ status: res.statusCode, json: roh ? JSON.parse(roh) : null }));
    });
    req.on("error", reject); req.end(daten);
  });
  const person = (pfad, method, body) => fetch(`${basis}${pfad}`, { method, headers: { "content-type": "application/json", ...BROWSER }, body: body ? JSON.stringify(body) : undefined });

  it("the person writes and releases; a program may read but neither create, release, reverse nor delete", async () => {
    assert.deepEqual([...NUR_PERSON_SCHREIBT], [SCHRITT_ENTITY, VORLAGE_ENTITY]);
    const neu = await (await person(`/entities/${SCHRITT_ENTITY}`, "POST", { project_id: P, vorschlag_id: "v1", satz: "x", freigabe: null })).json();
    assert.ok(neu.id);
    const a = await programm(`/entities/${SCHRITT_ENTITY}/${neu.id}`, "PUT", { freigabe: { status: "freigegeben", durch: "Agent", zeit: "t" } });
    assert.equal(a.status, 403);
    assert.equal(a.json.error, NUR_PERSON_TEXT);
    assert.equal((await programm(`/entities/${SCHRITT_ENTITY}`, "POST", { project_id: P })).status, 403);
    assert.equal((await programm(`/entities/${SCHRITT_ENTITY}/bulk`, "PUT", { records: [{ id: neu.id, freigabe: {} }] })).status, 403);
    assert.equal((await programm(`/entities/${SCHRITT_ENTITY}/${neu.id}`, "DELETE")).status, 403);
    assert.equal((await programm(`/entities/${VORLAGE_ENTITY}`, "POST", { satz: "x {wert}" })).status, 403);
    const gelesen = await programm(`/entities/${SCHRITT_ENTITY}?project_id=${P}`, "GET");
    assert.equal(gelesen.status, 200);
    assert.equal(gelesen.json[0].freigabe, null, "the program's release did not land");
    const f = await person(`/entities/${SCHRITT_ENTITY}/${neu.id}`, "PUT", { freigabe: { status: "freigegeben", durch: "Prüferin", zeit: "t" } });
    assert.equal(f.status, 200);
    assert.equal((await f.json()).freigabe.durch, "Prüferin");
  });
});

describe("106-10 MCP server: no release tool, and the generic write tools refuse the log", () => {
  it("lists the same entities as the app; create_record / update_record on them never reach the app", async () => {
    const quelle = fs.readFileSync(path.join(WURZEL, "tools", "mcp-server.mjs"), "utf8");
    const m = quelle.match(/NUR_PERSON_ENTITAETEN = Object\.freeze\(\[([^\]]*)\]\)/);
    assert.ok(m, "list found in tools/mcp-server.mjs");
    assert.deepEqual(m[1].split(",").map((x) => x.trim().replace(/'/g, "")), [...NUR_PERSON_SCHREIBT]);

    const anfragen = [];
    const api = http.createServer((req, res) => {
      anfragen.push(`${req.method} ${req.url}`);
      res.writeHead(req.url === "/api/system/datenordner" ? 404 : 200, { "content-type": "application/json" });
      res.end(JSON.stringify({}));
    });
    await new Promise((r) => api.listen(0, "127.0.0.1", r));
    const kind = spawn(process.execPath, [path.join(WURZEL, "tools", "mcp-server.mjs"), "--schreiben"],
      { env: { ...process.env, BIT_API_URL: `http://127.0.0.1:${api.address().port}/api` }, stdio: ["pipe", "pipe", "pipe"] });
    const antworten = new Map();
    let rest = "";
    kind.stdout.setEncoding("utf8");
    kind.stdout.on("data", (s) => {
      rest += s;
      let i;
      while ((i = rest.indexOf("\n")) >= 0) { const z = JSON.parse(rest.slice(0, i)); rest = rest.slice(i + 1); antworten.get(z.id)?.(z); }
    });
    let n = 1;
    const rpc = (method, params) => { const id = n++; const p = new Promise((r) => antworten.set(id, r)); kind.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`); return p; };
    try {
      const namen = (await rpc("tools/list")).result.tools.map((w) => w.name);
      assert.ok(!namen.some((x) => /freigeb|freigabe|release|zuruecknehm|reject/i.test(x)), `no release / reject tool: ${namen.join(", ")}`);
      for (const [name, args] of [["create_record", { entity: SCHRITT_ENTITY, data: { freigabe: {} } }], ["update_record", { entity: SCHRITT_ENTITY, id: "x", data: { freigabe: {} } }],
        ["create_record", { entity: VORLAGE_ENTITY, data: { satz: "x {wert}" } }]]) {
        const r = await rpc("tools/call", { name, arguments: args });
        assert.equal(r.result.isError, true, name);
        assert.match(r.result.content[0].text, /Handlungen der Person/);
      }
      assert.ok(!anfragen.some((a) => a.includes(SCHRITT_ENTITY) || a.includes(VORLAGE_ENTITY)), `nothing sent: ${anfragen.join(" | ")}`);
    } finally {
      await new Promise((r) => { kind.on("exit", r); kind.stdin.end(); });
      api.close();
    }
  });
});
