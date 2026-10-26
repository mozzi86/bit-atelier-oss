// D-IM-07 (25.10.2026): a proposal the agent makes from a SPOKEN sentence carries both origins, "sprache" and "agent" (ASSUMPTION: plus "bild"
// when an image of the view went along). Under test:
//  - the additive origin model: herkunft.quelle stays one string, herkunft.quellen is the ordered list; old records read as [quelle],
//  - the refusal paths of the list (unknown origin, main origin missing, "hand" with another origin),
//  - the marker of the sentence (satzMarke.js): only a marker THIS page issued adds origins; a forged or withdrawn one adds nothing,
//  - the change commands over the control channel: main origin stays "agent", confirming stays refused (D-IM-04), never "hand",
//  - the speech flow: a spoken sentence sends a marker with the task, a typed one without an image sends none.
import { test } from "node:test";
import assert from "node:assert/strict";
import { befehlsRegister } from "@core/lib/befehlsregister.js";
import { aenderungsBefehleRegistrieren } from "@core/lib/zeigen/aenderungsBefehle.js";
import { vorschlagSpeicher } from "@core/lib/zeigen/vorschlagSpeicher.js";
import { auswahlKontext } from "@core/lib/zeigen/auswahlKontext.js";
import { vorschlagErzeugen, herkunftEintrag, herkunftQuellen, herkunftText, journalEintragAus, MARKE_FELD } from "@core/lib/zeigen/aenderungen.js";
import { satzMarkeAusgeben, satzMarkeLesen, satzMarkeZuruecknehmen, agentQuellen, SATZ_MARKE_GUELTIG_MS, SATZ_MARKE_MUSTER } from "@core/lib/zeigen/satzMarke.js";
import { modellFragen } from "@core/lib/zeigen/sprachAgent.js";
import { sprechAblauf } from "@core/lib/zeigen/sprechAblauf.js";
import { bauteilGuid } from "@core/lib/bauteil/steckbrief.js";
import { pruefeAttributeVorUebernahme } from "@ifc/lib/mengenAttributPruefung.js";

const P = "p1";
const wand = (idx, extra = {}) => ({ a: { x: 0, z: idx * 10 }, b: { x: 6, z: idx * 10 }, level: 0, thickness: 0.24, height: 3, _idx: idx, ...extra });
const guidW = (w) => bauteilGuid(P, "customWalls", w);
const agent = { kanal: "steuerung" };

/** Surface stand-in (as in aenderungsBefehle-10603.test.js): a model in a variable, the studio's way of applying a result. */
function flaeche(modell0) {
  const f = { modell: modell0, speicher: vorschlagSpeicher() };
  const reg = befehlsRegister();
  aenderungsBefehleRegistrieren(reg, () => ({
    kontext: () => auswahlKontext([]),
    modell: () => f.modell,
    optionen: () => ({ projektId: P, geschosshoehe_m: 3, attributPruefung: pruefeAttributeVorUebernahme }),
    speicher: f.speicher,
    uebernehmen: (_v, r) => { f.modell = r.modell; },
    zuruecknehmen: (_e, r) => { f.modell = r.modell; },
  }));
  f.aus = (id, p, ctx) => reg.ausfuehren(id, p, ctx);
  return f;
}

const EINGABE = { art: "eigenschaft", ziel: { guid: "G-1" }, params: { name: "kg", wert: "331" }, vorher: { feld: "kg", label: "KG", wert: null }, nachher: { feld: "kg", label: "KG", wert: "331" } };

test("vorschlagErzeugen: quellen ist additiv — ohne Liste [quelle], mit Liste geordnet und ohne Doppelte", () => {
  const alt = vorschlagErzeugen({ ...EINGABE, herkunft: { quelle: "text" } }, { id: "v1", zeit: "2026-10-25T10:00:00Z" });
  assert.equal(alt.herkunft.quelle, "text");
  assert.deepEqual(alt.herkunft.quellen, ["text"]);
  const neu = vorschlagErzeugen({ ...EINGABE, herkunft: { quelle: "agent", quellen: ["sprache", "agent", "bild", "agent"], befehl_text: "x" } }, { id: "v2" });
  assert.equal(neu.herkunft.quelle, "agent", "the main origin stays one string for old readers");
  assert.deepEqual(neu.herkunft.quellen, ["sprache", "agent", "bild"]);
  assert.equal(neu.bestaetigung, "erforderlich");
});

test("vorschlagErzeugen: Ablehnungen der Liste — leer, unbekannt, Hauptherkunft fehlt, „hand“ mit anderer Herkunft", () => {
  const mit = (quelle, quellen) => () => vorschlagErzeugen({ ...EINGABE, herkunft: { quelle, quellen } });
  assert.throws(mit("agent", []), /nicht leere Liste/);
  assert.throws(mit("agent", "sprache"), /nicht leere Liste/);
  assert.throws(mit("agent", ["sprache", "zauberei"]), /unbekannte Herkunft „zauberei“/);
  assert.throws(mit("agent", ["sprache", "bild"]), /„agent“ fehlt/);
  assert.throws(mit("agent", ["hand", "agent"]), /„hand“ steht nur allein/);
  assert.throws(mit("hand", ["hand", "sprache"]), /„hand“ steht nur allein/);
  assert.deepEqual(vorschlagErzeugen({ ...EINGABE, herkunft: { quelle: "hand", quellen: ["hand"] } }).herkunft.quellen, ["hand"]);
});

test("herkunftEintrag / journalEintragAus: herkunft bleibt der String, herkunft_quellen kommt dazu; alte Einträge lesen sich als [herkunft]", () => {
  const v = vorschlagErzeugen({ ...EINGABE, herkunft: { quelle: "agent", quellen: ["sprache", "agent"] } }, { id: "v3" });
  const e = herkunftEintrag(v, { zeit: "2026-10-25T10:01:00Z", bestaetigt_durch: "hand" });
  assert.equal(e.herkunft, "agent");
  assert.deepEqual(e.herkunft_quellen, ["sprache", "agent"]);
  const j = journalEintragAus({ ...v, ziel: { guid: "G-1", modell: "haus.ifc" }, nachher: { pset: "Pset_WallCommon", eigenschaft: "FireRating", wert: "F90" } }, { projektId: P });
  assert.equal(j.herkunft, "agent");
  assert.deepEqual(j.herkunft_quellen, ["sprache", "agent"]);
  // a step record and an IFC journal entry written before D-IM-07 carry no list
  assert.deepEqual(herkunftQuellen({ herkunft: "sprache", befehl_text: "x" }), ["sprache"]);
  assert.deepEqual(herkunftQuellen({ herkunft: { quelle: "agent", befehl_text: null } }), ["agent"]);
  assert.deepEqual(herkunftQuellen("text"), ["text"]);
  assert.deepEqual(herkunftQuellen(null), []);
  assert.deepEqual(herkunftQuellen({ herkunft: "agent", herkunft_quellen: ["sprache", "agent", "bild"] }), ["sprache", "agent", "bild"]);
});

test("herkunftText: „Spracheingabe + Agent“, mit Bild „+ Bildkontext“, jedes Label einzeln übersetzt", () => {
  assert.equal(herkunftText({ herkunft: { quelle: "agent", quellen: ["sprache", "agent"] } }), "Spracheingabe + Agent");
  assert.equal(herkunftText({ herkunft: "agent", herkunft_quellen: ["sprache", "agent", "bild"] }), "Spracheingabe + Agent + Bildkontext");
  assert.equal(herkunftText({ herkunft: "agent" }), "Agent");
  const en = { Spracheingabe: "Voice input", Bildkontext: "Image context" };
  assert.equal(herkunftText({ herkunft: { quelle: "agent", quellen: ["sprache", "agent", "bild"] } }, (s) => en[s] ?? s), "Voice input + Agent + Image context");
  assert.equal(herkunftText({}), "");
});

test("satzMarke: nur mit Inhalt ausgegeben, lesbar bis zurückgenommen oder abgelaufen; fremde Form zählt nicht", () => {
  assert.equal(satzMarkeAusgeben({ sprache: false, bild: false }), null, "typed without an image: nothing to add, no marker");
  const m = satzMarkeAusgeben({ sprache: true, bild: false }, { jetzt: 1000 });
  assert.match(m, SATZ_MARKE_MUSTER);
  assert.deepEqual(satzMarkeLesen(m, { jetzt: 1000 }), { sprache: true, bild: false });
  assert.deepEqual(satzMarkeLesen(m, { jetzt: 1000 }), { sprache: true, bild: false }, "reading does not use it up (one sentence, several proposals)");
  assert.deepEqual(agentQuellen(m, { jetzt: 1000 }), ["sprache", "agent"]);
  assert.equal(satzMarkeLesen(m, { jetzt: 1000 + SATZ_MARKE_GUELTIG_MS }), null, "expired");
  const b = satzMarkeAusgeben({ sprache: true, bild: true });
  assert.deepEqual(agentQuellen(b), ["sprache", "agent", "bild"]);
  satzMarkeZuruecknehmen(b);
  assert.deepEqual(agentQuellen(b), ["agent"], "withdrawn after the turn");
  const nurBild = satzMarkeAusgeben({ bild: true });
  assert.deepEqual(agentQuellen(nurBild), ["agent", "bild"]);
  satzMarkeZuruecknehmen(nurBild);
  assert.deepEqual(agentQuellen("sm-" + "0".repeat(32)), ["agent"], "a marker of the right form that this page never issued adds nothing");
  assert.deepEqual(agentQuellen({ sprache: true }), ["agent"]);
  assert.deepEqual(agentQuellen(undefined), ["agent"]);
});

test("Steuerkanal + ausgegebene Marke: Hauptherkunft agent, Liste sprache+agent; bestätigen bleibt verweigert; die Person übernimmt mit beiden Herkünften", () => {
  const w = wand(4);
  const f = flaeche({ customWalls: [w] });
  const marke = satzMarkeAusgeben({ sprache: true });
  try {
    const r = f.aus("eigenschaft-setzen", { guid: guidW(w), name: "kg", wert: "331", satz_marke: marke, herkunft: "hand" }, agent);
    assert.equal(r.ok, true, JSON.stringify(r));
    const v = r.result;
    assert.equal(v.herkunft, "agent");
    assert.deepEqual(v.herkunft_quellen, ["sprache", "agent"]);
    assert.equal(JSON.stringify(v).includes(marke), false, "the marker never goes back to the agent");
    // D-IM-04 unchanged: neither the marker nor a claimed channel lets the agent confirm
    const b = f.aus("bestaetigen", { vorschlag_id: v.id, durch: "sprache", satz_marke: marke }, agent);
    assert.equal(b.ok, false);
    assert.match(b.error, /Agent kann nicht bestätigen/);
    assert.equal(f.modell.customWalls[0].kg, undefined);
    // the person confirms in the window: the step keeps both origins, in the history and on the element
    const ok = f.aus("bestaetigen", { vorschlag_id: v.id, durch: "hand" });
    assert.equal(ok.ok, true, JSON.stringify(ok));
    const schritt = f.aus("vorschlaege").result.verlauf[0];
    assert.equal(schritt.herkunft, "agent");
    assert.deepEqual(schritt.herkunft_quellen, ["sprache", "agent"]);
    assert.deepEqual(f.modell.customWalls[0][MARKE_FELD].herkunft_quellen, ["sprache", "agent"]);
    assert.equal(f.modell.customWalls[0][MARKE_FELD].herkunft, "agent");
    // the agent can still withdraw its OWN speech proposal (main origin agent)
    const v2 = f.aus("transformieren", { guid: guidW(w), verschiebung_m: [1, 0], satz_marke: marke }, agent).result;
    assert.deepEqual(v2.herkunft_quellen, ["sprache", "agent"]);
    assert.equal(f.aus("verwerfen", { vorschlag_id: v2.id }, agent).ok, true);
  } finally {
    satzMarkeZuruecknehmen(marke);
  }
});

test("Steuerkanal: gefälschte oder abgelaufene Marke = nur agent; außerhalb des Kanals zählt die Marke nicht; „bild“ allein bleibt verboten", () => {
  const w = wand(5);
  const f = flaeche({ customWalls: [w] });
  const fremd = f.aus("eigenschaft-setzen", { guid: guidW(w), name: "kg", wert: "331", satz_marke: "sm-" + "a".repeat(32) }, agent).result;
  assert.deepEqual(fremd.herkunft_quellen, ["agent"]);
  const kaputt = f.aus("eigenschaft-setzen", { guid: guidW(w), name: "kg", wert: "332", satz_marke: "sprache" }, agent).result;
  assert.deepEqual(kaputt.herkunft_quellen, ["agent"]);
  const marke = satzMarkeAusgeben({ sprache: true, bild: true });
  satzMarkeZuruecknehmen(marke);
  assert.deepEqual(f.aus("eigenschaft-setzen", { guid: guidW(w), name: "kg", wert: "333", satz_marke: marke }, agent).result.herkunft_quellen, ["agent"]);
  // a typed command (no channel) with a valid marker: the marker describes an agent's turn only, the origin stays "text"
  const offen = satzMarkeAusgeben({ sprache: true, bild: true });
  try {
    const getippt = f.aus("eigenschaft-setzen", { guid: guidW(w), name: "kg", wert: "334", satz_marke: offen }).result;
    assert.equal(getippt.herkunft, "text");
    assert.deepEqual(getippt.herkunft_quellen, ["text"]);
    const mitBild = f.aus("eigenschaft-setzen", { guid: guidW(w), name: "kg", wert: "335", satz_marke: offen }, agent).result;
    assert.deepEqual(mitBild.herkunft_quellen, ["sprache", "agent", "bild"]);
  } finally {
    satzMarkeZuruecknehmen(offen);
  }
  assert.equal(f.aus("eigenschaft-setzen", { guid: guidW(w), name: "kg", wert: "336", herkunft: "bild" }).ok, false, "bild is never claimed as the one origin");
  assert.equal(f.aus("eigenschaft-setzen", { guid: guidW(w), name: "kg", wert: "337", herkunft: "hand" }).ok, false);
});

const AUSW = auswahlKontext([{ guid: "G1ABCDEFGHIJKLMNOPQRST", klasse: "IfcWall", name: "Wand 1" }]);
/** Speech service stand-in: local provider; the agent records what it got and what the marker says DURING the turn. */
const dienst = () => {
  const gesendet = [];
  return {
    gesendet,
    stt: async () => ({ text: "" }),
    bereit: async () => ({ harness: true, stt: true, sttBereit: true, hinweis: "", provider: "mock", providerLokal: true, nurLokalApp: false, nurLokalHarness: false, mcp: true, bilder: true, modell: "m" }),
    agent: async (auftrag, o) => { gesendet.push({ auftrag, o, waehrend: agentQuellen(o?.satzMarke) }); return { text: "ok", werkzeuge: [], vorschlaege: 0, fehler: null }; },
    bildFreigabe: async () => ({ ok: true, grund: null, text: "" }),
  };
};

test("modellFragen: gesprochen -> Marke mit dem Auftrag (nicht im Text), während des Zugs sprache+agent, danach zurückgenommen; getippt ohne Bild -> keine Marke", async () => {
  const d = dienst();
  await modellFragen("mach die wand dicker bitte", AUSW, { dienst: d, gesprochen: true });
  const g = d.gesendet[0];
  assert.match(g.o.satzMarke, SATZ_MARKE_MUSTER);
  assert.equal(g.auftrag.includes(g.o.satzMarke), false, "the model never reads the marker");
  assert.deepEqual(g.waehrend, ["sprache", "agent"]);
  assert.deepEqual(agentQuellen(g.o.satzMarke), ["agent"], "withdrawn when the turn is over");
  await modellFragen("mach die wand dicker bitte", AUSW, { dienst: d });
  assert.equal("satzMarke" in d.gesendet[1].o, false, "typed without an image: stays agent, nothing sent");
  // ASSUMPTION of D-IM-07: an image along adds "bild"
  await modellFragen("was ist links davon", AUSW, { dienst: d, gesprochen: true, projektId: "P1", bild: () => ({ png_base64: "iVBORw0KGgo" }) });
  assert.deepEqual(d.gesendet[2].waehrend, ["sprache", "agent", "bild"]);
});

test("sprechAblauf: das Modell erfährt die Herkunft des Satzes (sprache / text)", async () => {
  const reg = befehlsRegister();
  const gesehen = [];
  const ablauf = sprechAblauf({ register: reg, kontext: () => ({ auswahl: AUSW }), modellFrage: async (_t, _k, o) => { gesehen.push(o.herkunft); return { ok: true, art: "modell", text: "", werkzeuge: [] }; } });
  await ablauf.verarbeiten("die wand da braucht mehr feuerschutz", "sprache");
  await ablauf.verarbeiten("die wand da braucht mehr feuerschutz", "text");
  assert.deepEqual(gesehen, ["sprache", "text"]);
});
