// 106-05: the speech input end to end below the browser: sentence -> grammar -> register -> proposal; "ja"/"nein" as the human confirmation;
// the agent channel can neither confirm nor undo through the text input (Task 3b of 106-04); the model fallback only for unknown sentences and
// only with the local-AI and consent rules; the recording and the keys with fakes.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { befehlsRegister } from "@core/lib/befehlsregister.js";
import { aenderungsBefehleRegistrieren } from "@core/lib/zeigen/aenderungsBefehle.js";
import { auswahlBefehleRegistrieren } from "@core/lib/zeigen/auswahlBefehle.js";
import { eingabeAusfuehren, eingabeBefehlRegistrieren } from "@core/lib/zeigen/eingabe.js";
import { sprechAblauf, antwortSatz } from "@core/lib/zeigen/sprechAblauf.js";
import { vorschlagSpeicher } from "@core/lib/zeigen/vorschlagSpeicher.js";
import { auswahlKontext } from "@core/lib/zeigen/auswahlKontext.js";
import { modellFragen, agentAuftrag, AUFTRAG_MAX_ZEICHEN, zielGuids } from "@core/lib/zeigen/sprachAgent.js";
import { sprechSteuerung } from "@core/lib/zeigen/sprechStart.js";
import { vomAgentenKanal as kanalTest } from "@core/lib/zeigen/kanal.js";
import { sprechTastenAnbinden } from "@core/lib/zeigen/sprechTasten.js";
import { aufnahmeStarten, MIN_AUFNAHME_MS, mikrofonFehlerText } from "@core/lib/zeigen/aufnahme.js";
import { ansichtAusKamera, ANSICHT_GRUNDRISS } from "@core/lib/zeigen/ansichtRichtung.js";
import { sprechDienstSetzen, sprechDienst } from "@core/lib/zeigen/sprechDienst.js";
import { bauteilGuid } from "@core/lib/bauteil/steckbrief.js";
import { pruefeAttributeVorUebernahme } from "@ifc/lib/mengenAttributPruefung.js";
import fs from "node:fs";

const P = "p1";
const wand = (idx, extra = {}) => ({ a: { x: 0, z: idx * 10 }, b: { x: 6, z: idx * 10 }, level: 0, thickness: 0.24, height: 3, _idx: idx, ...extra });
const guidW = (w) => bauteilGuid(P, "customWalls", w);
const ANSICHT = { rechts: { x: 1, z: 0 }, vorn: { x: 0, z: -1 } };

/** A viewer surface stand-in with the selection, change and input commands in ONE register, like the viewers build it. */
function flaeche(modell0, { auswahl = [] } = {}) {
  const f = { modell: modell0, auswahl, speicher: vorschlaege(), angewendet: 0 };
  const reg = befehlsRegister();
  const a = () => ({
    kontext: () => auswahlKontext(f.auswahl),
    ansicht: () => ANSICHT,
    zeigepunkt: () => null,
    modell: () => f.modell,
    optionen: () => ({ projektId: P, geschosshoehe_m: 3, attributPruefung: pruefeAttributeVorUebernahme }),
    speicher: f.speicher,
    uebernehmen: (_v, r) => { f.modell = r.modell; f.angewendet += 1; },
    zuruecknehmen: (_e, r) => { f.modell = r.modell; },
  });
  aenderungsBefehleRegistrieren(reg, a);
  eingabeBefehlRegistrieren(reg, a);
  auswahlBefehleRegistrieren(reg, () => ({
    kontext: () => auswahlKontext(f.auswahl), waehleGuid: () => null, aufheben: () => { f.auswahl = []; }, ansichtAufAuswahl: () => { f.gerahmt = true; }, modell: () => ({ anzahl: 1 }),
  }));
  f.reg = reg;
  f.kontext = () => ({ auswahl: auswahlKontext(f.auswahl), ansicht: ANSICHT, zeigepunkt: null });
  /** a line of the JSON protocol as the control channel sends it */
  f.ueberKanal = (befehl, params) => JSON.parse(reg.zeileBearbeiten(JSON.stringify({ id: 1, method: "ausfuehren", params: { befehl, params } }), { kanal: "steuerung" }));
  return f;
}
function vorschlaege() { return vorschlagSpeicher(); }
const sel = (w) => [{ guid: guidW(w), klasse: "IfcWall", name: "Wand" }];

test("gesprochener Satz -> Vorschlag mit Herkunft \"sprache\" und dem Satz im Verlauf; das Modell bleibt, bis \"ja\" kommt", async () => {
  const w = wand(12, { feuerwiderstand: "F30" });
  const f = flaeche({ customWalls: [w] }, { auswahl: sel(w) });
  const ablauf = sprechAblauf({ register: f.reg, kontext: f.kontext });
  const r = await ablauf.verarbeiten("setze Brandschutz auf F90", "sprache");
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.art, "befehl");
  assert.equal(r.befehl, "eigenschaft-setzen");
  assert.equal(r.ergebnis.herkunft, "sprache");
  assert.match(r.ergebnis.satz, /Feuerwiderstand F30 → F90/);
  assert.equal(f.angewendet, 0);
  assert.equal(f.modell.customWalls[0].feuerwiderstand, "F30");
  assert.match(antwortSatz(r), /Vorschlag prüfen, dann „ja“/);
  // now the person says yes: the confirmation is "sprache", the step keeps origin and sentence
  const ja = await ablauf.verarbeiten("ja", "sprache");
  assert.equal(ja.ok, true, JSON.stringify(ja));
  assert.equal(ja.ergebnis.bestaetigt_durch, "sprache");
  assert.equal(f.modell.customWalls[0].feuerwiderstand, "F90");
  const verlauf = f.speicher.verlauf();
  assert.equal(verlauf.length, 1);
  assert.equal(verlauf[0].herkunft, "sprache");
  assert.equal(verlauf[0].befehl_text, "setze Brandschutz auf F90");
  assert.match(antwortSatz(ja), /^Übernommen: /);
});

test("getippt: Herkunft \"text\", \"ja\" zählt als Tastatur; \"nein\" verwirft ohne Änderung", async () => {
  const w = wand(3);
  const f = flaeche({ customWalls: [w] }, { auswahl: sel(w) });
  const ablauf = sprechAblauf({ register: f.reg, kontext: f.kontext });
  const v = await ablauf.verarbeiten("verschiebe dieses 50 Zentimeter nach rechts", "text");
  assert.equal(v.ergebnis.herkunft, "text");
  assert.equal(v.ergebnis.art, "transformieren");
  const nein = await ablauf.verarbeiten("nein", "text");
  assert.equal(nein.ok, true);
  assert.equal(f.speicher.offen().length, 0);
  assert.equal(f.angewendet, 0);
  await ablauf.verarbeiten("verschiebe dieses 50 Zentimeter nach rechts", "text");
  const ja = await ablauf.verarbeiten("ja", "text");
  assert.equal(ja.ergebnis.bestaetigt_durch, "tastatur");
  assert.equal(f.modell.customWalls[0].b.x, 6.5);
});

test("Task 3b: `eingabe` über den Steuerkanal kann weder bestätigen noch zurücknehmen — wörtlich, als Satz und als Befehlsname", () => {
  const w = wand(7);
  const f = flaeche({ customWalls: [w] }, { auswahl: sel(w) });
  // the agent proposes through the text input: allowed, origin "agent" whatever it claims
  const v = f.ueberKanal("eingabe", { text: "verschiebe dieses 1 m nach links", herkunft: "sprache" });
  assert.equal(v.ok, true, JSON.stringify(v));
  assert.equal(f.speicher.offen()[0].herkunft.quelle, "agent");
  for (const text of ["bestaetigen", "ja", "übernehmen", "Bestätigen", "ja bitte", "mach das"]) {
    const r = f.ueberKanal("eingabe", { text });
    assert.equal(r.ok, false, text);
    assert.match(r.error, /Ein Agent kann nicht bestätigen|Satz nicht verstanden/, text);
  }
  assert.equal(f.angewendet, 0, "nichts wurde übernommen");
  assert.equal(f.speicher.offen().length, 1, "der Vorschlag wartet auf die Person");
  // the same sentence from the person (no channel marker) works
  const person = f.reg.ausfuehren("eingabe", { text: "ja" }, {});
  assert.equal(person.ok, true, JSON.stringify(person));
  assert.equal(f.angewendet, 1);
  // undo: neither as a word, nor as a sentence, nor as the command name over the channel
  for (const text of ["rueckgaengig", "rückgängig", "mach das rückgängig", "nimm das zurück"]) {
    const r = f.ueberKanal("eingabe", { text });
    assert.equal(r.ok === true ? "rueckfrage" in r.result : false, r.ok === true, text); // a question at most, never an execution
    assert.equal(f.speicher.verlauf().filter((s) => s.zurueckgenommen).length, 0, text);
  }
  assert.equal(f.speicher.verlauf()[0].zurueckgenommen, null);
});

test("Task 3b: die Herkunft über den Kanal bleibt \"agent\", ein Parameter kann sie nicht heben; \"bild\" und \"hand\" sind als Parameter nie erlaubt", () => {
  const w = wand(2);
  const f = flaeche({ customWalls: [w] }, { auswahl: sel(w) });
  for (const herkunft of ["sprache", "text", "hand", "bild", "agent"]) {
    const r = f.ueberKanal("eingabe", { text: "verschiebe dieses 1 m nach links", herkunft });
    assert.equal(r.ok, true, `${herkunft}: ${JSON.stringify(r)}`);
  }
  assert.ok(f.speicher.offen().every((v) => v.herkunft.quelle === "agent"));
  // from the page (no channel): "sprache" is accepted as declared, "bild"/"hand" are ignored (the origin stays "text")
  const g = flaeche({ customWalls: [w] }, { auswahl: sel(w) });
  g.reg.ausfuehren("eingabe", { text: "verschiebe dieses 1 m nach links", herkunft: "bild" }, {});
  assert.equal(g.speicher.offen()[0].herkunft.quelle, "text");
});

test("Task 3b: der Befehlsname geht exakt, nie als Präfix; Fehltipp führt nichts aus", () => {
  const w = wand(2);
  const f = flaeche({ customWalls: [w] }, { auswahl: sel(w) });
  assert.equal(eingabeAusfuehren(f.reg, "vorschlaege", {}, f.kontext()).ok, true);
  assert.equal(eingabeAusfuehren(f.reg, "Auswahl lesen", {}, f.kontext()).ok, true);
  const prefix = eingabeAusfuehren(f.reg, "rueckga", {}, f.kontext());
  assert.equal(prefix.ok, false);
  assert.equal(prefix.art, "unbekannt");
  // spoken text never takes the command-name road
  assert.equal(eingabeAusfuehren(f.reg, "zeige die Vorschläge", { herkunft: "sprache" }, f.kontext()).art, "befehl", "the grammar knows this sentence");
  assert.equal(eingabeAusfuehren(f.reg, "vorschlaege", { herkunft: "sprache" }, f.kontext()).art, "unbekannt", "a bare command name is typed text only");
});

test("abgelehnte Sätze: ohne Auswahl, falsches Bauteil, Kommandozeilenfehler kommen als Text, nichts wird vorgeschlagen", async () => {
  const w = wand(1);
  const leer = flaeche({ customWalls: [w] });
  const a1 = sprechAblauf({ register: leer.reg, kontext: leer.kontext });
  const r = await a1.verarbeiten("verschiebe dieses 50 Zentimeter nach links", "sprache");
  assert.equal(r.ok, false);
  assert.match(r.text, /Keine Auswahl/);
  assert.equal(leer.speicher.offen().length, 0);
  const f = flaeche({ customWalls: [w] }, { auswahl: sel(w) });
  const a2 = sprechAblauf({ register: f.reg, kontext: f.kontext });
  const falsch = await a2.verarbeiten("verschiebe die Stütze 50 Zentimeter nach links", "sprache");
  assert.match(falsch.text, /Ausgewählt ist eine Wand, nicht eine Stütze/);
  // a command refusal passes through: an unknown property value
  const wert = await a2.verarbeiten("setze den Status auf Quatsch", "sprache");
  assert.equal(wert.ok, false);
  assert.match(wert.text, /kein Status/);
});

test("rückgängig per Sprache: erst Rückfrage in Worten, erst \"ja\" führt aus, jeder andere Satz verwirft die Frage", async () => {
  const w = wand(5);
  const f = flaeche({ customWalls: [w] }, { auswahl: sel(w) });
  const ablauf = sprechAblauf({ register: f.reg, kontext: f.kontext });
  await ablauf.verarbeiten("verschiebe dieses 1 m nach rechts", "sprache");
  // with an open proposal: refused
  const offen = await ablauf.verarbeiten("mach das rückgängig", "sprache");
  assert.equal(offen.ok, false);
  assert.match(offen.text, /Erst den offenen Vorschlag/);
  await ablauf.verarbeiten("ja", "sprache");
  assert.equal(f.modell.customWalls[0].b.x, 7);
  const frage = await ablauf.verarbeiten("mach das rückgängig", "sprache");
  assert.equal(frage.art, "rueckfrage");
  assert.match(frage.frage, /Schritt zurücknehmen: .*„ja“ oder „nein“/);
  assert.equal(f.modell.customWalls[0].b.x, 7, "die Frage ändert nichts");
  assert.ok(ablauf.rueckfrage());
  const ja = await ablauf.verarbeiten("ja", "sprache");
  assert.equal(ja.ok, true, JSON.stringify(ja));
  assert.equal(f.modell.customWalls[0].b.x, 6);
  assert.equal(ablauf.rueckfrage(), null);
  // another sentence drops the question: the "ja" a minute later is just a confirmation without a proposal
  await ablauf.verarbeiten("verschiebe dieses 1 m nach rechts", "sprache");
  await ablauf.verarbeiten("ja", "sprache");
  await ablauf.verarbeiten("mach das rückgängig", "sprache");
  await ablauf.verarbeiten("was ist das", "sprache");
  assert.equal(ablauf.rueckfrage(), null);
  const spaet = await ablauf.verarbeiten("ja", "sprache");
  assert.equal(spaet.ok, false);
  assert.equal(f.modell.customWalls[0].b.x, 7, "nichts wurde zurückgenommen");
  // "nein" cancels
  await ablauf.verarbeiten("mach das rückgängig", "sprache");
  assert.equal((await ablauf.verarbeiten("nein", "sprache")).art, "abgebrochen");
  assert.equal(f.modell.customWalls[0].b.x, 7);
});

test("Modell-Fallback nur für unbekannte Sätze: Grammatik-Treffer, Ablehnung und \"ja\" rufen das Modell nie", async () => {
  const w = wand(1);
  const f = flaeche({ customWalls: [w] }, { auswahl: sel(w) });
  const gerufen = [];
  const ablauf = sprechAblauf({ register: f.reg, kontext: f.kontext, modellFrage: async (text, k, o) => { gerufen.push([text, o]); return { art: "modell", text: "ok", werkzeuge: ["transformieren"] }; } });
  await ablauf.verarbeiten("verschiebe dieses 1 m nach rechts", "sprache");
  await ablauf.verarbeiten("verschiebe dieses nach rechts", "sprache");
  await ablauf.verarbeiten("ja", "sprache");
  assert.equal(gerufen.length, 0);
  const m = await ablauf.verarbeiten("mach die Wand etwas länger", "sprache");
  assert.equal(m.art, "modell");
  assert.deepEqual(gerufen.map((x) => x[0]), ["mach die Wand etwas länger"]);
  assert.equal(gerufen[0][1].cloudOk, false);
  assert.match(antwortSatz(m), /ok/);
});

// ---------------------------------------------------------------------------------------------------------------
// model fallback: local AI, consent, text only

const dienstMit = (bereit, agent) => ({ stt: async () => ({ text: "" }), bereit: async () => ({ harness: true, stt: true, sttBereit: true, hinweis: "", provider: "mock", providerLokal: true, nurLokalApp: false, nurLokalHarness: false, mcp: true, ...bereit }), agent });
const AUSW = auswahlKontext([{ guid: "G1ABCDEFGHIJKLMNOPQRST", klasse: "IfcWall", name: "Wand 1", geschoss: "EG", steckbrief: { status: "neubau", material: "Beton", tragend: true } }]);

test("Auftrag an das Modell: Satz, GUID der Auswahl, Regeln — nur Text, keine Bildfelder, Satz begrenzt", () => {
  const t = agentAuftrag("mach das dicker", AUSW);
  assert.match(t, /„mach das dicker“/);
  assert.match(t, /GUID G1ABCDEFGHIJKLMNOPQRST/);
  assert.match(t, /Klasse IfcWall/);
  assert.match(t, /Geschoss EG/);
  assert.match(t, /du kannst nicht bestätigen/);
  assert.doesNotMatch(t, /png|base64|data:image/i);
  assert.match(agentAuftrag("x", auswahlKontext([])), /nichts ausgewählt/);
  assert.ok(agentAuftrag("a".repeat(5000), AUSW).length < 5000 + 1500);
  assert.ok(agentAuftrag("a".repeat(5000), AUSW).includes("a".repeat(AUFTRAG_MAX_ZEICHEN)));
  assert.ok(!agentAuftrag("a".repeat(5000), AUSW).includes("a".repeat(AUFTRAG_MAX_ZEICHEN + 1)));
});

test("Modell-Fallback: ohne Dienst/Harness/Werkzeuge Klartext, nichts gesendet", async () => {
  const aufrufe = [];
  const agent = async (...a) => { aufrufe.push(a); return { text: "x", werkzeuge: [], fehler: null }; };
  assert.equal((await modellFragen("mach das dicker", AUSW, { dienst: null })).art, "modell-fehler");
  assert.match((await modellFragen("mach das dicker", AUSW, { dienst: null })).text, /brauchen den KI-Harness/);
  const aus = await modellFragen("mach das dicker", AUSW, { dienst: dienstMit({ harness: false, hinweis: "Kein Dienst unter http://127.0.0.1:8765 erreichbar" }, agent) });
  assert.match(aus.text, /KI-Harness läuft nicht/, "a typed free sentence names the harness, not the microphone (review 106-05)");
  const ohneMcp = await modellFragen("mach das dicker", AUSW, { dienst: dienstMit({ mcp: false }, agent) });
  assert.match(ohneMcp.text, /keine Verbindung zu den Modell-Werkzeugen/);
  assert.equal(aufrufe.length, 0);
});

test("Modell-Fallback: \"Nur lokale KI\" + Cloud-Anbieter = nichts gesendet; Cloud ohne Klick = Freigabe-Frage; lokal läuft", async () => {
  const aufrufe = [];
  const agent = async (auftrag, opt) => { aufrufe.push({ auftrag, opt }); return { text: "Vorschlag gemacht", werkzeuge: ["transformieren"], fehler: null }; };
  const cloud = { provider: "cloud-profil", providerLokal: false };
  for (const flag of [{ nurLokalApp: true }, { nurLokalHarness: true }]) {
    const r = await modellFragen("mach das dicker", AUSW, { dienst: dienstMit({ ...cloud, ...flag }, agent), cloudOk: true });
    assert.equal(r.art, "modell-fehler");
    assert.match(r.text, /Nur lokale KI ist eingeschaltet/);
    assert.match(r.text, /nichts wurde gesendet/);
  }
  assert.equal(aufrufe.length, 0, "auch mit cloudOk geht bei \"Nur lokale KI\" nichts hinaus");
  const frage = await modellFragen("mach das dicker", AUSW, { dienst: dienstMit(cloud, agent) });
  assert.equal(frage.art, "modell-freigabe");
  assert.equal(frage.anbieter, "cloud-profil");
  assert.match(frage.text, /außerhalb dieses Rechners/);
  assert.match(frage.text, /Kein Bild/);
  assert.equal(aufrufe.length, 0);
  const frei = await modellFragen("mach das dicker", AUSW, { dienst: dienstMit(cloud, agent), cloudOk: true });
  assert.equal(frei.art, "modell");
  assert.equal(aufrufe.length, 1);
  assert.equal(aufrufe[0].opt.profil, "sprechen");
  const lokal = await modellFragen("mach das dicker", AUSW, { dienst: dienstMit({ nurLokalApp: true, providerLokal: true, provider: "app-lokal" }, agent) });
  assert.equal(lokal.art, "modell");
  assert.deepEqual(lokal.werkzeuge, ["transformieren"]);
  assert.equal(aufrufe.length, 2);
});

test("Modell-Fallback: \"dieses\" ohne Auswahl geht nicht ans Modell; ein Fehler des Harness kommt als Klartext", async () => {
  const aufrufe = [];
  const agent = async () => { aufrufe.push(1); return { text: "", werkzeuge: [], fehler: "Provider antwortet 500" }; };
  const keine = await modellFragen("mach dieses etwas dicker", auswahlKontext([]), { dienst: dienstMit({}, agent) });
  assert.match(keine.text, /Keine Auswahl/);
  assert.equal(aufrufe.length, 0);
  const fehler = await modellFragen("mach die Wand etwas dicker", AUSW, { dienst: dienstMit({}, agent) });
  assert.equal(fehler.art, "modell-fehler");
  assert.match(fehler.text, /Provider antwortet 500/);
  const wirft = await modellFragen("mach die Wand etwas dicker", AUSW, { dienst: dienstMit({}, async () => { throw new Error("Kein Dienst unter http://127.0.0.1:8765 erreichbar"); }) });
  assert.match(wirft.text, /Kein Dienst/);
});

test("sprechDienst: Anmelden und Abmelden (nur wenn es noch der eigene ist)", () => {
  assert.equal(sprechDienst(), null);
  const a = dienstMit({}, async () => ({ text: "", werkzeuge: [], fehler: null }));
  const b = dienstMit({}, async () => ({ text: "", werkzeuge: [], fehler: null }));
  const abA = sprechDienstSetzen(a);
  assert.equal(sprechDienst(), a);
  const abB = sprechDienstSetzen(b);
  abA();
  assert.equal(sprechDienst(), b, "ein veralteter Abmelder lässt den neuen Dienst stehen");
  abB();
  assert.equal(sprechDienst(), null);
});

// ---------------------------------------------------------------------------------------------------------------
// keys and recording

/** Event target stand-in: Node has no KeyboardEvent, so listeners are called with plain event objects. */
function fakeZiel() {
  const hoerer = [];
  return {
    addEventListener: (art, fn, capture) => hoerer.push({ art, fn, capture: !!capture }),
    removeEventListener: (art, fn, capture) => { const i = hoerer.findIndex((h) => h.art === art && h.fn === fn && h.capture === !!capture); if (i >= 0) hoerer.splice(i, 1); },
    feuer: (art, e) => hoerer.filter((h) => h.art === art).forEach((h) => h.fn(e)),
  };
}
/** A key event as the window sends it. */
function taste(ziel, art, key, extra = {}) {
  const e = { type: art, key, repeat: false, ctrlKey: false, altKey: false, metaKey: false, target: { tagName: "DIV" }, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...extra };
  ziel.feuer(art, e);
  return e;
}

test("Tasten: Leertaste halten + V spricht, Loslassen stoppt; Alt+J / Strg+Enter übernehmen, Alt+N verwirft; nie in Textfeldern", () => {
  const ziel = fakeZiel();
  const log = [];
  const ab = sprechTastenAnbinden(ziel, { start: () => log.push("start"), stopp: () => log.push("stopp"), uebernehmen: () => log.push("ja"), verwerfen: () => log.push("nein") });
  taste(ziel, "keydown", "v"); // V alone: nothing
  assert.deepEqual(log, []);
  taste(ziel, "keydown", " ");
  const v = taste(ziel, "keydown", "v");
  assert.equal(v.defaultPrevented, true);
  taste(ziel, "keydown", "v", { repeat: true }); // key repeat does not start twice
  assert.deepEqual(log, ["start"]);
  taste(ziel, "keyup", "v");
  assert.deepEqual(log, ["start", "stopp"]);
  taste(ziel, "keyup", " ");
  taste(ziel, "keydown", " ");
  taste(ziel, "keydown", "V");
  taste(ziel, "keyup", " "); // releasing the space also stops
  assert.deepEqual(log, ["start", "stopp", "start", "stopp"]);
  taste(ziel, "keydown", "j", { altKey: true });
  taste(ziel, "keydown", "Enter", { ctrlKey: true });
  taste(ziel, "keydown", "n", { altKey: true });
  assert.deepEqual(log.slice(4), ["ja", "ja", "nein"]);
  // Strg+Entf and Backspace never discard (the studio deletes the element with them); AltGr (ctrl+alt) is no shortcut
  taste(ziel, "keydown", "Delete", { ctrlKey: true });
  taste(ziel, "keydown", "Backspace");
  taste(ziel, "keydown", "j", { altKey: true, ctrlKey: true });
  assert.equal(log.length, 7);
  // typing in a field: the same keys do nothing
  const feld = { tagName: "INPUT" };
  taste(ziel, "keydown", " ", { target: feld });
  taste(ziel, "keydown", "v", { target: feld });
  taste(ziel, "keydown", "j", { altKey: true, target: feld });
  taste(ziel, "keydown", "Enter", { ctrlKey: true, target: { tagName: "DIV", isContentEditable: true } });
  assert.equal(log.length, 7);
  ab();
  taste(ziel, "keydown", "j", { altKey: true });
  assert.equal(log.length, 7, "nach dem Abbinden keine Wirkung");
});

test("Tasten: aktiv()=false schaltet alles ab; Fokusverlust beendet eine laufende Aufnahme", () => {
  const ziel = fakeZiel();
  const log = [];
  let an = false;
  sprechTastenAnbinden(ziel, { start: () => log.push("start"), stopp: () => log.push("stopp"), uebernehmen: () => log.push("ja"), verwerfen: () => log.push("nein"), aktiv: () => an });
  taste(ziel, "keydown", "j", { altKey: true });
  assert.deepEqual(log, []);
  an = true;
  taste(ziel, "keydown", " "); taste(ziel, "keydown", "v");
  ziel.feuer("blur", {});
  assert.deepEqual(log, ["start", "stopp"]);
});

/** Fake microphone: getUserMedia answers a stream with one track; the recorder collects `daten` chunks. */
function fakeMikro({ ablehnen = null, daten = ["abc"], mimeUnterstuetzt = true } = {}) {
  const spur = { gestoppt: false, stop() { this.gestoppt = true; } };
  const stream = { getTracks: () => [spur] };
  class Recorder {
    static isTypeSupported() { return mimeUnterstuetzt; }
    constructor(s, opt) { this.stream = s; this.mimeType = opt.mimeType; Recorder.letzter = this; }
    start() { this.laeuft = true; }
    stop() { for (const d of daten) this.ondataavailable?.({ data: new Blob([d]) }); this.onstop?.(); }
  }
  return { spur, mediaDevices: { getUserMedia: async () => { if (ablehnen) throw ablehnen; return stream; } }, MediaRecorderKlasse: Recorder };
}

test("Aufnahme: webm/opus, Mikrofon wird wieder freigegeben, zu kurz = verworfen, Ablehnung als Klartext", async () => {
  let t = 1000;
  const m = fakeMikro();
  const a = await aufnahmeStarten({ mediaDevices: m.mediaDevices, MediaRecorderKlasse: m.MediaRecorderKlasse, jetzt: () => t });
  assert.equal(m.MediaRecorderKlasse.letzter.mimeType, "audio/webm;codecs=opus");
  t += 1500;
  const r = await a.stoppen();
  assert.ok(r && r.blob.size === 3 && r.dauerMs === 1500);
  assert.equal(m.spur.gestoppt, true, "das Mikrofon ist wieder frei");
  assert.equal(await a.stoppen(), null, "zweites Stoppen ist harmlos");
  // too short: dropped (a click is not speech)
  const k = fakeMikro();
  t = 0;
  const kurz = await aufnahmeStarten({ mediaDevices: k.mediaDevices, MediaRecorderKlasse: k.MediaRecorderKlasse, jetzt: () => t });
  t += MIN_AUFNAHME_MS - 1;
  assert.equal(await kurz.stoppen(), null);
  assert.equal(k.spur.gestoppt, true);
  // cancel frees the microphone without a result
  const c = fakeMikro();
  const ab = await aufnahmeStarten({ mediaDevices: c.mediaDevices, MediaRecorderKlasse: c.MediaRecorderKlasse });
  ab.abbrechen();
  assert.equal(c.spur.gestoppt, true);
  // permission refused / no device / no API
  const nein = fakeMikro({ ablehnen: Object.assign(new Error("x"), { name: "NotAllowedError" }) });
  await assert.rejects(() => aufnahmeStarten({ mediaDevices: nein.mediaDevices, MediaRecorderKlasse: nein.MediaRecorderKlasse }), /Mikrofon ist nicht erlaubt/);
  const kein = fakeMikro({ ablehnen: Object.assign(new Error("x"), { name: "NotFoundError" }) });
  await assert.rejects(() => aufnahmeStarten({ mediaDevices: kein.mediaDevices, MediaRecorderKlasse: kein.MediaRecorderKlasse }), /Kein Mikrofon gefunden/);
  await assert.rejects(() => aufnahmeStarten({ mediaDevices: {}, MediaRecorderKlasse: null }), /kann nicht aufnehmen/);
  assert.match(mikrofonFehlerText({ name: "NotReadableError" }), /anderen Programm/);
  // a browser without opus falls back to plain webm
  const w = fakeMikro({ mimeUnterstuetzt: false });
  await aufnahmeStarten({ mediaDevices: w.mediaDevices, MediaRecorderKlasse: w.MediaRecorderKlasse });
  assert.equal(w.MediaRecorderKlasse.letzter.mimeType, "audio/webm");
});

// ---------------------------------------------------------------------------------------------------------------
// view directions, wiring

test("ansichtAusKamera: Blick nach Norden/Osten, von oben, und der Grundriss", () => {
  const kam = (pos, ziel) => { const c = new THREE.PerspectiveCamera(50, 1, 0.1, 1000); c.position.set(...pos); c.lookAt(...ziel); c.updateMatrixWorld(); return c; };
  const nord = ansichtAusKamera(kam([0, 10, 20], [0, 0, 0])); // looks towards -z
  assert.deepEqual(nord.vorn, { x: 0, z: -1 });
  assert.deepEqual(nord.rechts, { x: 1, z: 0 });
  const ost = ansichtAusKamera(kam([-20, 10, 0], [0, 0, 0])); // looks towards +x
  assert.deepEqual(ost.vorn, { x: 1, z: 0 });
  assert.deepEqual(ost.rechts, { x: 0, z: 1 });
  // straight down with the camera's up pointing along -z: "into the screen" is -z
  const oben = kam([0, 50, 0], [0, 0, 0]);
  oben.up.set(0, 0, -1); oben.lookAt(0, 0, 0); oben.updateMatrixWorld();
  const v = ansichtAusKamera(oben);
  assert.ok(Math.abs(v.vorn.z + 1) < 1e-6 && Math.abs(v.vorn.x) < 1e-6, JSON.stringify(v));
  assert.equal(ansichtAusKamera(null), null);
  assert.deepEqual(ANSICHT_GRUNDRISS, { rechts: { x: 1, z: 0 }, vorn: { x: 0, z: -1 } });
});

test("Quelltext: die Befehlszeile des Massing-Studios gibt ctx an jeden Befehl weiter; beide Viewer registrieren `eingabe` und zeigen das Sprechfeld", () => {
  const massing = fs.readFileSync("packages/nova-designer/src/components/MassingModellierer.jsx", "utf8");
  assert.match(massing, /eingabeAnwenden = \(text = eingabe, \{ strg = false, ctx = undefined \} = \{\}\)/);
  assert.match(massing, /befehle\.ausfuehren\(fb\.id, fb\.wert != null \? \{ wert: fb\.wert \} : \{\}, ctx\)/);
  assert.match(massing, /befehle\.ausfuehren\(b\.id, \{\}, ctx\)/);
  assert.match(massing, /ausfuehren: \(p, ctx\) => \{ if \(!p\?\.text\) throw new Error\("text fehlt"\); a\(\)\.eingabeAnwenden\(String\(p\.text\), \{ ctx \}\)/);
  for (const datei of ["packages/nova-designer/src/components/BitBimStudio.jsx", "packages/nova-ifc-viewer/src/pages/IfcViewer.jsx"]) {
    const q = fs.readFileSync(datei, "utf8");
    assert.match(q, /eingabeBefehlRegistrieren\(reg, \(\) => \/\*\* @type \{any\} \*\/ \(aenderung\.current\)\)/, datei);
    assert.match(q, /<SprechFeld register=\{befehle\}/, datei);
  }
});

test("IFC element without property set: Brandschutz/Tragend go to the IFC standard property, the element's own common set wins (106-05)", async () => {
  const { eigenschaftSetzen, ifcStandardEigenschaft } = await import("@core/lib/zeigen/aenderungen.js");
  const ohne = { quelle: "ifc", modell: "m.ifc", guid: "G".repeat(22), psets: {}, klasse: "IfcWallStandardCase" };
  assert.deepEqual(ifcStandardEigenschaft(ohne, "feuerwiderstand"), { pset: "Pset_WallCommon", name: "FireRating" });
  assert.deepEqual(ifcStandardEigenschaft({ ...ohne, klasse: "IfcSlab" }, "Tragend"), { pset: "Pset_SlabCommon", name: "LoadBearing" });
  const eigen = { ...ohne, psets: { Pset_WallCommon: { FireRating: "F30" }, Pset_Eigen: { FireRating: "x" } } };
  assert.deepEqual(ifcStandardEigenschaft(eigen, "firerating"), { pset: "Pset_WallCommon", name: "FireRating" });
  assert.equal(ifcStandardEigenschaft(ohne, "material"), null, "only FireRating and LoadBearing are mapped");
  assert.equal(ifcStandardEigenschaft({ ...ohne, klasse: null }, "feuerwiderstand"), null, "no class, no guess");

  const r = eigenschaftSetzen(eigen, { name: "feuerwiderstand", wert: "F90" }, { zeit: "2026-10-25T10:00:00.000Z" });
  assert.equal(r.quelle, "ifc");
  assert.deepEqual({ pset: r.journal?.pset, eigenschaft: r.journal?.eigenschaft, alt: r.journal?.alt, wert: r.journal?.wert },
    { pset: "Pset_WallCommon", eigenschaft: "FireRating", alt: "F30", wert: "F90" });
  assert.throws(() => eigenschaftSetzen(ohne, { name: "material", wert: "Beton" }), /nur mit Eigenschaftssatz möglich/);
  // an explicit property set is taken as given
  const x = eigenschaftSetzen(ohne, { pset: "Pset_Eigen", name: "FireRating", wert: "F60" }, { zeit: "2026-10-25T10:00:00.000Z" });
  assert.equal(x.journal?.pset, "Pset_Eigen");
});

// ---------------------------------------------------------------------------------------------------------------
// review 106-05

test("Review 106-05: Doppeltippen öffnet genau eine Aufnahme; Loslassen vor dem Mikrofon schließt sie wieder", async () => {
  /** fake microphone: every aufnehmen() waits until `freigeben()` opens it */
  const streams = [];
  const warten = [];
  const aufnehmen = () => new Promise((resolve) => warten.push(() => {
    const s = { offen: true };
    streams.push(s);
    resolve({ stoppen: async () => { s.offen = false; return { blob: /** @type {any} */ ({ size: 2000 }), dauerMs: 900 }; }, abbrechen: () => { s.offen = false; } });
  }));
  let laufend = 0;
  const st = sprechSteuerung({ vorbereiten: async () => true, aufnehmen, beiAufnahme: () => { laufend += 1; } });
  const p1 = st.starten();              // down 1: the microphone is still opening
  await Promise.resolve();
  assert.equal(st.stoppen(), null);     // up 1: nothing recording yet
  const p2 = st.starten();              // down 2: joins the start under way
  assert.equal(p2, p1, "a second press during a start starts no second one");
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(warten.length, 1, "exactly one microphone request");
  warten[0]();
  await p1;
  assert.equal(laufend, 1);
  assert.equal(streams.filter((s) => s.offen).length, 1, "one open stream");
  const rec = await st.stoppen();       // up 2
  assert.ok(rec && rec.dauerMs === 900);
  assert.equal(streams.filter((s) => s.offen).length, 0, "the microphone is closed again");

  // let go while the microphone opens: the stream is closed at once, nothing records
  const p3 = st.starten();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(st.stoppen(), null);
  warten[1]();
  await p3;
  assert.equal(streams.filter((s) => s.offen).length, 0);
  assert.equal(st.offen(), false);
  // not ready: nothing is opened; verwerfen drops a running one; abbrechen ends for good
  const nein = sprechSteuerung({ vorbereiten: async () => false, aufnehmen: async () => { throw new Error("darf nicht aufnehmen"); } });
  await nein.starten();
  assert.equal(nein.offen(), false);
  const st2 = sprechSteuerung({ vorbereiten: () => true, aufnehmen: async () => ({ stoppen: async () => null, abbrechen: () => { streams.push({ offen: false, verworfen: true }); } }) });
  await st2.starten();
  assert.equal(st2.offen(), true);
  st2.verwerfen();
  assert.equal(st2.offen(), false);
  st2.abbrechen();
  await st2.starten();
  assert.equal(st2.offen(), false, "after abbrechen (unmount) nothing starts");
});

test("Review 106-05: gesprochen bestätigen nur „ja“/„übernehmen“ — „okay“, „mach das“ gelten nur getippt; auch nicht für die Rückfrage", async () => {
  const w = wand(3);
  const f = flaeche({ customWalls: [w] }, { auswahl: sel(w) });
  const ablauf = sprechAblauf({ register: f.reg, kontext: f.kontext });
  await ablauf.verarbeiten("verschiebe dieses 1 m nach rechts", "sprache");
  for (const satz of ["okay", "ok", "mach das", "mach es", "ja mach das", "ausführen"]) {
    const r = await ablauf.verarbeiten(satz, "sprache");
    assert.equal(r.ok, false, satz);
    assert.equal(r.art, "abgelehnt", satz);
    assert.match(String(r.text), /deutlich „ja“ oder „übernehmen“/, satz);
  }
  assert.equal(f.angewendet, 0, "nothing applied");
  assert.equal(f.speicher.offen().length, 1);
  assert.equal((await ablauf.verarbeiten("übernehmen", "sprache")).ok, true);
  assert.equal(f.angewendet, 1);
  // the undo question: a spoken "okay" does not run it either
  await ablauf.verarbeiten("mach das rückgängig", "sprache");
  assert.ok(ablauf.rueckfrage());
  await ablauf.verarbeiten("okay", "sprache");
  assert.equal(f.speicher.verlauf()[0].zurueckgenommen, null, "„okay“ undid nothing");
  // typed, "mach das" still confirms (what is on the screen is what was meant)
  await ablauf.verarbeiten("verschiebe dieses 1 m nach rechts", "text");
  assert.equal((await ablauf.verarbeiten("mach das", "text")).ok, true);
  assert.equal(f.angewendet, 2);
});

test("Review 106-05: getippter Befehlsname „Schritt zurücknehmen“ fragt zurück wie der Satz, statt sofort zurückzunehmen", () => {
  const w = wand(4);
  const f = flaeche({ customWalls: [w] }, { auswahl: sel(w) });
  eingabeAusfuehren(f.reg, "verschiebe dieses 1 m nach rechts", {}, f.kontext());
  eingabeAusfuehren(f.reg, "ja", {}, f.kontext());
  const label = f.reg.alle({}).find((b) => b.id === "rueckgaengig")?.label;
  assert.ok(label);
  const r = eingabeAusfuehren(f.reg, String(label), {}, f.kontext());
  assert.equal(r.art, "rueckfrage", JSON.stringify(r));
  assert.equal(f.speicher.verlauf()[0].zurueckgenommen, null, "the question undoes nothing");
});

test("Review 106-05: eine Quelle für die Agentenprüfung (kanal.js), eingabe.js reicht sie weiter", async () => {
  const { vomAgentenKanal } = await import("@core/lib/zeigen/eingabe.js");
  assert.equal(vomAgentenKanal, kanalTest);
  assert.equal(kanalTest({ kanal: "steuerung" }), true);
  assert.equal(kanalTest({}), false);
  const quelle = fs.readFileSync("packages/nova-core/src/lib/zeigen/aenderungsBefehle.js", "utf-8");
  assert.doesNotMatch(quelle, /const vomAgentenKanal\s*=/, "no second copy of the check");
});

test("Review 106-05: Modell-Fallback hält die GUID des Satzes fest, NDA steht im Auftrag, „dieses“ ohne Auswahl vor der Cloud-Frage", async () => {
  const aufrufe = [];
  const agent = async (auftrag, opt) => { aufrufe.push({ auftrag, opt }); return { text: "Vorschlag gemacht", werkzeuge: ["eigenschaft_setzen"], vorschlaege: 1, fehler: null }; };
  const r = await modellFragen("mach die Wand etwas dicker", AUSW, { dienst: dienstMit({}, agent), nda: true });
  assert.equal(r.art, "modell");
  assert.equal(r.vorschlaege, 1);
  assert.deepEqual(aufrufe[0].opt.ziel, ["G1ABCDEFGHIJKLMNOPQRST"], "the GUID selected at the sentence is the target");
  assert.match(aufrufe[0].auftrag, /NDA-Merker: nur Text und Bauteil-Kennungen, nie ein Bild/);
  assert.doesNotMatch(agentAuftrag("x", AUSW), /NDA/);
  assert.deepEqual(zielGuids(auswahlKontext([])), []);
  // cloud provider + "dieses" without a selection: refused first, no consent question
  const cloud = { provider: "cloud-profil", providerLokal: false };
  const keine = await modellFragen("mach dieses dicker", auswahlKontext([]), { dienst: dienstMit(cloud, agent) });
  assert.equal(keine.art, "modell-fehler");
  assert.match(keine.text, /Keine Auswahl/);
  // the consent names what else the model can read, and the NDA marker
  const frage = await modellFragen("mach die Wand dicker", AUSW, { dienst: dienstMit(cloud, agent), nda: true });
  assert.equal(frage.art, "modell-freigabe");
  assert.match(frage.text, /offene Vorschläge, frühere Sätze und Prüfergebnisse/);
  assert.match(frage.text, /NDA-Projekt: nie ein Bild/);
  // no MCP: the MCP reason, not the microphone one
  const ohneMcp = await modellFragen("mach die Wand dicker", AUSW, { dienst: dienstMit({ mcp: false, hinweis: "Spracheingabe nicht verfügbar: stt aus", mcpHinweis: "mcp.enabled: false" }, agent) });
  assert.equal(ohneMcp.text, "mcp.enabled: false");
  // an answer without a proposal is not "done"
  const nurText = await modellFragen("mach die Wand dicker", AUSW, { dienst: dienstMit({}, async () => ({ text: "Welche Wand?", werkzeuge: [], vorschlaege: 0, fehler: null })) });
  assert.equal(nurText.vorschlaege, 0);
});

test("Review 106-05: Antwortsätze laufen über t() mit Vorlagen", () => {
  const t = (s) => ({ "Übernommen: {satz}": "Applied: {satz}", "Nichts ausgewählt": "Nothing selected", "Zurücknehmen abgebrochen": "Undo cancelled" })[s] ?? s;
  assert.equal(antwortSatz({ ok: true, art: "befehl", befehl: "bestaetigen", ergebnis: { satz: "Wand: x" } }, t), "Applied: Wand: x");
  assert.equal(antwortSatz({ ok: true, art: "befehl", befehl: "auswahl-lesen", ergebnis: { anzahl: 0 } }, t), "Nothing selected");
  assert.equal(antwortSatz({ ok: true, art: "abgebrochen", text: "Zurücknehmen abgebrochen" }, t), "Undo cancelled");
  assert.equal(antwortSatz({ ok: true, art: "befehl", befehl: "bestaetigen", ergebnis: { satz: "s" } }), "Übernommen: s", "without t: German");
});

test("Review 106-05: IFC-Standardeigenschaft nur, wo das IFC4-Common-Set sie kennt; LoadBearing wird boolesch", async () => {
  const { eigenschaftSetzen, ifcStandardEigenschaft } = await import("@core/lib/zeigen/aenderungen.js");
  const el = (klasse, psets = {}) => ({ quelle: "ifc", modell: "m.ifc", guid: "G".repeat(22), psets, klasse });
  assert.equal(ifcStandardEigenschaft(el("IfcWindow"), "tragend"), null, "Pset_WindowCommon has no LoadBearing");
  assert.equal(ifcStandardEigenschaft(el("IfcSpace"), "feuerwiderstand"), null, "Pset_SpaceCommon has no FireRating");
  assert.equal(ifcStandardEigenschaft(el("IfcSite"), "tragend"), null);
  assert.equal(ifcStandardEigenschaft(el("IfcOpeningElement"), "feuerwiderstand"), null);
  assert.deepEqual(ifcStandardEigenschaft(el("IfcWindow"), "feuerwiderstand"), { pset: "Pset_WindowCommon", name: "FireRating" });
  assert.deepEqual(ifcStandardEigenschaft(el("IfcColumn"), "tragend"), { pset: "Pset_ColumnCommon", name: "LoadBearing" });
  assert.deepEqual(ifcStandardEigenschaft(el("IfcFooting"), "tragend"), { pset: "Pset_FootingCommon", name: "LoadBearing" });
  assert.equal(ifcStandardEigenschaft(el("IfcFooting"), "feuerwiderstand"), null);
  assert.throws(() => eigenschaftSetzen(el("IfcWindow"), { name: "tragend", wert: "ja" }), /nur mit Eigenschaftssatz möglich/);
  // LoadBearing is an IfcBoolean, also when the element has no value yet
  const wandNeu = eigenschaftSetzen(el("IfcWall", { Pset_WallCommon: { IsExternal: true } }), { name: "tragend", wert: "ja" }, { zeit: "2026-10-25T10:00:00.000Z" });
  assert.equal(wandNeu.journal?.eigenschaft, "LoadBearing");
  assert.equal(wandNeu.journal?.alt, null);
  assert.equal(wandNeu.journal?.wert, true);
  assert.equal(typeof wandNeu.nachher, "boolean");
  assert.equal(eigenschaftSetzen(el("IfcSlab"), { name: "tragend", wert: "nein" }, { zeit: "2026-10-25T10:00:00.000Z" }).journal?.wert, false);
  assert.throws(() => eigenschaftSetzen(el("IfcWall"), { name: "tragend", wert: "F90" }), /weder ja noch nein/);
  // the element's own spelling is kept
  const eigen = eigenschaftSetzen(el("IfcWall", { Pset_WallCommon: { loadbearing: false } }), { name: "tragend", wert: "ja" }, { zeit: "2026-10-25T10:00:00.000Z" });
  assert.equal(eigen.journal?.eigenschaft, "loadbearing");
  assert.equal(eigen.journal?.wert, true);
});
