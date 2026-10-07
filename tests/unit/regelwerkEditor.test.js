// Unit tests of the rule-book EDITOR (80-07, behavior 1–8): the write-side
// helpers of packages/nova-core/src/lib/regelwerk.js (overrideWert,
// settingFeldSetzen/-Entfernen, statusFuer, tabellenZeilen, rechenweg) and
// useRegelwerkBearbeiten.js (setzeRegel, zuruecksetzen, gruppeZuruecksetzen) —
// both storage kinds, against a fake "buchhaltung" group whose vorSchreiben is a
// spy and whose pruefeSetting stands in for 79's wirksameEinstellungen (this
// package's own boundary keeps it from importing @/lib/accounting/* directly,
// see useRegelwerkBearbeiten.js file header — the real caller injects the real
// one; here a small equivalent whitelist is enough to prove the write path).
//
// In:  packages/nova-core/src/lib/regelwerk.js, useRegelwerkBearbeiten.js,
//      the HR rule book and the rule registry (read-only, for real rule shapes).
// Out: assertions only.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  heuteLokal, overrideWert, pruefeOverride, rechenweg, regelSchluessel, settingFeldEntfernen, settingFeldSetzen,
  statusFuer, tabellenZeilen, wirksamerWert,
} from "@core/lib/regelwerk.js";
import { gruppeZuruecksetzen, setzeRegel, zuruecksetzen } from "@core/lib/useRegelwerkBearbeiten.js";
import { HR_REGELN } from "@/lib/people/hrRegeln.js";
import { REGELWERKE } from "@/lib/settings/regelwerke.js";

const PERSONAL = REGELWERKE.find((g) => g.gruppe === "personal");
const BUCHHALTUNG = REGELWERKE.find((g) => g.gruppe === "buchhaltung");
const hr = (name) => {
  const r = HR_REGELN.find((x) => x.id === `personal.${name}`);
  assert.ok(r, `HR-Regel ${name} fehlt`);
  return r;
};
const HEUTE = "2026-09-27";

/**
 * In-memory Setting client (demoDb semantics, like tests/unit/einstellungen.test.js).
 * @param {any[]} [start] initial rows
 */
function attrappe(start = []) {
  const zeilen = start.map((z) => ({ ...z }));
  let uhr = Date.UTC(2026, 8, 27, 10, 0, 0);
  let naechste = 1;
  const jetzt = () => new Date((uhr += 1000)).toISOString();
  return {
    zeilen,
    async filter(q) { return zeilen.filter((z) => Object.entries(q).every(([k, v]) => z[k] === v)).map((z) => ({ ...z })); },
    async create(daten) {
      const zeit = jetzt();
      const z = { id: `s${naechste++}`, created_date: zeit, updated_date: zeit, ...daten };
      zeilen.push(z);
      return { ...z };
    },
    async update(id, daten) {
      const i = zeilen.findIndex((z) => z.id === id);
      if (i < 0) throw new Error("404");
      zeilen[i] = { ...zeilen[i], ...daten, id, updated_date: jetzt() };
      return { ...zeilen[i] };
    },
    async delete(id) {
      const i = zeilen.findIndex((z) => z.id === id);
      if (i >= 0) zeilen.splice(i, 1);
    },
  };
}

/** Window stub so setzeEinstellung/loescheEinstellung can dispatch their event under node. */
function fensterStub() {
  const ereignisse = [];
  globalThis.window = /** @type {any} */ ({ dispatchEvent: (e) => { ereignisse.push(e); return true; } });
  return ereignisse;
}

/**
 * A minimal stand-in for 79's wirksameEinstellungen: enough whitelist to prove
 * the write path (unknown legal form falls back, negative/NaN days fall back).
 * @param {any} s
 */
function pruefeSettingAttrappe(s) {
  const rechtsform = ["einzelunternehmen", "gbr", "partg", "gmbh", "ug"].includes(s.rechtsform) ? s.rechtsform : "einzelunternehmen";
  const zahlungsziel_tage = Number.isInteger(s.zahlungsziel_tage) && s.zahlungsziel_tage >= 0 && s.zahlungsziel_tage <= 365 ? s.zahlungsziel_tage : 14;
  return { ...s, rechtsform, zahlungsziel_tage };
}

/** Fake "buchhaltung"-shaped group: storage kind `setting`, a spied vorSchreiben. */
function buchhaltungAttrappe(anfangswert) {
  let vorSchreibenAufrufe = 0;
  const gruppe = {
    gruppe: "buchhaltung", titel: "Buchhaltung & Steuern",
    regeln: [BUCHHALTUNG.regeln.find((r) => r.id === "buchhaltung.zahlungsziel_tage")],
    speicher: { art: "setting", key: "buchhaltung", feld: (id) => id.slice("buchhaltung.".length) },
    sichtbar: () => true,
    vorSchreiben: async () => { vorSchreibenAufrufe++; },
  };
  return { gruppe, aufrufe: () => vorSchreibenAufrufe, client: attrappe(anfangswert ? [{ id: "b1", key: "buchhaltung", value: anfangswert }] : []) };
}

test("Behavior 1: overrideWert setzt basis_stand/gesetzt_am, verlauf wächst bis 20, settingFeldSetzen rein", () => {
  const regel = URLAUB_BUERO();
  const ov1 = overrideWert({ wert: 28 }, regel, null);
  assert.equal(ov1.basis_stand, regel.stand);
  assert.equal(ov1.gesetzt_am, heuteLokal());
  assert.deepEqual(ov1.verlauf, []);
  let vorher = ov1;
  for (let i = 0; i < 24; i++) vorher = overrideWert({ wert: 28 + i }, regel, vorher);
  assert.equal(vorher.verlauf.length, 20, "nach 25 Aufrufen 20 Einträge");
  assert.equal(vorher.verlauf[0].wert, 28 + 22, "neuester zuerst (vorletzter Aufruf)");

  const basis = { a: 1 };
  const neu = settingFeldSetzen(basis, "zahlungsziel_tage", 21);
  assert.deepEqual(neu, { a: 1, zahlungsziel_tage: 21 });
  assert.deepEqual(basis, { a: 1 }, "Original unverändert");
  assert.deepEqual(settingFeldEntfernen({ a: 1, zahlungsziel_tage: 21 }, "zahlungsziel_tage"), { a: 1 });
});

function URLAUB_BUERO() { return hr("urlaub_buero_standard"); }

test("Behavior 2: statusFuer — standard, geplant/abweichend, veraltet, gesetzlich/formel/fest", () => {
  const regel = URLAUB_BUERO();
  assert.equal(statusFuer(regel, null, HEUTE), "standard");
  const ov = { wert: 30, gueltig_ab: "2027-01-01", basis_stand: regel.stand };
  assert.equal(statusFuer(regel, ov, "2026-12-31"), "geplant");
  assert.equal(statusFuer(regel, ov, "2027-01-01"), "abweichend");
  const alteBasis = { wert: 30, basis_stand: "2000-01-01" };
  assert.equal(statusFuer(regel, alteBasis, HEUTE), "veraltet");
  assert.equal(statusFuer(hr("mindestlohn"), null, HEUTE), "gesetzlich");
  assert.equal(statusFuer(hr("minijob_grenze"), null, HEUTE), "formel");
  assert.equal(statusFuer(hr("kuendigung_staffel"), null, HEUTE), "fest");
});

test("Behavior 3: tabellenZeilen — Gruppen und Zeilenzahl je Kontext, Andockpunkt 81 per Fake-Gruppe", () => {
  const zeitHonorarFake = {
    gruppe: "zeit_honorar", titel: "Zeit & Honorar",
    regeln: [
      { id: "zeit_honorar.a", label: "A", einheit: "%", typ: "zahl", art: "buero", werte: [{ ab: "2000-01-01", wert: 80 }], stand: HEUTE, quelle: "Test" },
      { id: "zeit_honorar.b", label: "B", einheit: "%", typ: "zahl", art: "buero", werte: [{ ab: "2000-01-01", wert: 21 }], stand: HEUTE, quelle: "Test" },
      { id: "zeit_honorar.c", label: "C", einheit: "%", typ: "zahl", art: "buero", werte: [{ ab: "2000-01-01", wert: 85 }], stand: HEUTE, quelle: "Test" },
    ],
    speicher: { art: "zeilen" }, sichtbar: () => true,
  };
  const regelwerke = [...REGELWERKE, zeitHonorarFake];
  const voll = tabellenZeilen(regelwerke, {}, { datenquelle: "serverlos", personalZugang: "erlaubt" }, HEUTE);
  assert.equal(voll.length, 3, "buchhaltung, personal, zeit_honorar");
  const zeilenZahl = (g) => voll.find((x) => x.gruppe === g).abschnitte.reduce((n, a) => n + a.zeilen.length, 0);
  assert.equal(zeilenZahl("buchhaltung"), 60);
  assert.equal(zeilenZahl("personal"), HR_REGELN.length);
  assert.equal(zeilenZahl("zeit_honorar"), 3);

  const eingeschraenkt = tabellenZeilen(regelwerke, {}, { datenquelle: "express", personalZugang: "keine-berechtigung" }, HEUTE);
  assert.deepEqual(eingeschraenkt.map((g) => g.gruppe).sort(), ["buchhaltung", "zeit_honorar"]);
});

test("Behavior 9 (rechenweg): Minijob-Formel als Text, Kündigungsstaffel als Zeilenliste", () => {
  const wertVon = (id, stichtag) => wirksamerWert(HR_REGELN.find((r) => r.id === id), null, stichtag).wert;
  const minijob = rechenweg(hr("minijob_grenze"), "2026-06-01", wertVon);
  assert.equal(minijob.text, "⌈13,90 × 130 / 3⌉ = 603");
  assert.equal(minijob.zeilen, null);
  const staffel = rechenweg(hr("kuendigung_staffel"), HEUTE);
  assert.equal(staffel.zeilen.length, 7);
  assert.equal(staffel.text, null);
});

test("Behavior 4: setzeRegel (zeilen) — genau 1 Zeile, gültig ab wirkt, zuruecksetzen → 0 Zeilen", async () => {
  const ereignisse = fensterStub();
  const client = attrappe();
  const r = await setzeRegel(PERSONAL, "personal.urlaub_buero_standard", { wert: 30, gueltig_ab: "2027-01-01" }, { client });
  assert.equal(r.ok, true);
  assert.equal(client.zeilen.filter((z) => z.key === regelSchluessel("personal.urlaub_buero_standard")).length, 1);
  const details = (stichtag) => wirksamerWert(URLAUB_BUERO(), client.zeilen[0].value, stichtag);
  assert.equal(details("2026-12-31").wert, 28);
  assert.equal(details("2027-01-01").wert, 30);
  await zuruecksetzen(PERSONAL, "personal.urlaub_buero_standard", { client });
  assert.equal(client.zeilen.filter((z) => z.key === regelSchluessel("personal.urlaub_buero_standard")).length, 0);
  assert.equal(statusFuer(URLAUB_BUERO(), null, HEUTE), "standard");
  assert.ok(ereignisse.length >= 2, "setzen und zurücksetzen melden das Ereignis");
});

test("Behavior 5: setzeRegel — nur lesend und Grenze weisen ab, keine Schreibvorgänge", async () => {
  const client = attrappe();
  fensterStub();
  const nurLesend = await setzeRegel(PERSONAL, "personal.urlaub_mindest_werktage", { wert: 18 }, { client });
  assert.equal(nurLesend.ok, false);
  assert.match(nurLesend.text, /nur lesend/);
  assert.ok(nurLesend.text.includes("§ 3 BUrlG"));
  const grenze = await setzeRegel(PERSONAL, "personal.urlaub_buero_standard", { wert: 18 }, { client });
  assert.equal(grenze.ok, false);
  assert.ok(grenze.text.includes("§ 3 BUrlG"));
  assert.equal(client.zeilen.length, 0, "kein Schreibvorgang");
});

test("Behavior 6: setzeRegel (setting) — vorSchreiben einmal, erste Zeile bei Dublette, zuruecksetzen behält andere Felder", async () => {
  fensterStub();
  const { gruppe, aufrufe, client } = buchhaltungAttrappe({ rechtsform: "partg" });
  const r = await setzeRegel(gruppe, "buchhaltung.zahlungsziel_tage", { wert: 21 }, { client, pruefeSetting: pruefeSettingAttrappe });
  assert.equal(r.ok, true);
  assert.equal(aufrufe(), 1, "vorSchreiben genau einmal");
  const zeilenBuchhaltung = client.zeilen.filter((z) => z.key === "buchhaltung");
  assert.equal(zeilenBuchhaltung.length, 1);
  assert.deepEqual(zeilenBuchhaltung[0].value, { rechtsform: "partg", zahlungsziel_tage: 21 });

  await zuruecksetzen(gruppe, "buchhaltung.zahlungsziel_tage", { client });
  const nachReset = client.zeilen.find((z) => z.key === "buchhaltung").value;
  assert.equal("zahlungsziel_tage" in nachReset, false);
  assert.equal(nachReset.rechtsform, "partg", "anderes Feld bleibt");

  // Duplicate row: the FIRST one is changed, like einstellungLesen (filter({key})[0]).
  const { gruppe: g2, client: c2 } = buchhaltungAttrappe();
  c2.zeilen.push({ id: "erste", key: "buchhaltung", value: { rechtsform: "einzelunternehmen" }, created_date: "2026-01-01", updated_date: "2026-01-01" });
  c2.zeilen.push({ id: "zweite", key: "buchhaltung", value: { rechtsform: "gmbh" }, created_date: "2026-02-01", updated_date: "2026-02-01" });
  await setzeRegel(g2, "buchhaltung.zahlungsziel_tage", { wert: 30 }, { client: c2, pruefeSetting: pruefeSettingAttrappe });
  const erste = c2.zeilen.find((z) => z.id === "erste");
  const zweite = c2.zeilen.find((z) => z.id === "zweite");
  assert.equal(erste.value.zahlungsziel_tage, 30, "die erste Zeile wird geändert");
  assert.equal("zahlungsziel_tage" in zweite.value, false, "die zweite bleibt unberührt");
});

test("Behavior 7: setzeRegel (setting) weist eine ungültige Zahl über die 79-Attrappe ab, kein Schreibvorgang", async () => {
  fensterStub();
  const { gruppe, client } = buchhaltungAttrappe({ rechtsform: "einzelunternehmen", zahlungsziel_tage: 14 });
  const r = await setzeRegel(gruppe, "buchhaltung.zahlungsziel_tage", { wert: -5 }, { client, pruefeSetting: pruefeSettingAttrappe });
  assert.equal(r.ok, false);
  assert.equal(client.zeilen[0].value.zahlungsziel_tage, 14, "Wert unverändert");
});

test("Behavior 8: gruppeZuruecksetzen löscht nur die eigenen regel:*-Zeilen, andere Gruppen bleiben unberührt", async () => {
  fensterStub();
  const client = attrappe();
  await setzeRegel(PERSONAL, "personal.urlaub_buero_standard", { wert: 30 }, { client });
  await setzeRegel(PERSONAL, "personal.probezeit_standard_monate", { wert: 3 }, { client });
  const { gruppe: bh, client: bhClient } = buchhaltungAttrappe({ rechtsform: "gmbh" });
  assert.equal(client.zeilen.filter((z) => z.key.startsWith("regel:personal.")).length, 2);
  await gruppeZuruecksetzen(PERSONAL, { client });
  assert.equal(client.zeilen.filter((z) => z.key.startsWith("regel:personal.")).length, 0);
  assert.equal(bhClient.zeilen.find((z) => z.key === "buchhaltung").value.rechtsform, "gmbh", "andere Gruppe unberührt");
});

test("pruefeOverride bleibt die einzige Typprüfung — setzeRegel fügt keine zweite hinzu", async () => {
  fensterStub();
  const client = attrappe();
  const rechtsform = BUCHHALTUNG.regeln.find((r) => r.id === "buchhaltung.rechtsform");
  assert.equal(pruefeOverride(rechtsform, "ag")?.schwere, "fail");
  const { gruppe, client: c } = buchhaltungAttrappe({ rechtsform: "einzelunternehmen" });
  const gruppeMitRechtsform = { ...gruppe, regeln: [rechtsform] };
  const r = await setzeRegel(gruppeMitRechtsform, "buchhaltung.rechtsform", { wert: "ag" }, { client: c, pruefeSetting: pruefeSettingAttrappe });
  assert.equal(r.ok, false);
  assert.equal(client.zeilen.length, 0);
});
