// Unit tests of plans 105-28 (palette: record full text, result groups) and 105-14 (shortcut help from the command
// registers). Neutral test data only.
// Run: node --test --import ./tests/alias-register.mjs tests/unit/suche-105.test.js

import { test } from "node:test";
import assert from "node:assert/strict";
import { befehlsRegister, registerAnmelden, angemeldeteRegister, registerAbonnieren, registerStand } from "@core/lib/befehlsregister.js";
import { globaleBefehle, hilfeAbschnitte, registerEintraege } from "@core/lib/tastenhilfe.js";
import { suchVorbereiten } from "@core/lib/lockereSuche.js";
import { rankeTreffer, PALETTE_MAX } from "@/lib/suche/paletteTreffer.js";
import { ladeDatensaetze, DATENSATZ_QUELLEN } from "@/lib/suche/datensatzSuche.js";
import { baueZugriff, sichtbareDokumente } from "@core/lib/rechte.js";

// ---------------------------------------------------------------------------
// 105-14: shortcut help
// ---------------------------------------------------------------------------

test("105-14: Hilfe ist auf einer Seite ohne Aktionen und ohne Zeichenfläche nicht leer (globale Befehle)", () => {
  const abschnitte = hilfeAbschnitte({ aktionen: [], register: [], global: globaleBefehle() });
  assert.equal(abschnitte.length, 1);
  assert.equal(abschnitte[0].id, "global");
  assert.deepEqual(abschnitte[0].eintraege.map((e) => e.taste), ["Strg+K", "?", "Esc"]);
});

test("105-14: angemeldetes Register einer Zeichenfläche erscheint mit Tasten und Kurzformen, nach dem Abmelden nicht mehr", () => {
  const reg = befehlsRegister();
  reg.registrieren({ id: "linie", label: "Linie", taste: "l", kurz: ["l"], ausfuehren: () => 1 }); // as the modeller registers it
  reg.registrieren({ id: "lesen", label: "Modell lesen", ausfuehren: () => 1 }); // nothing to press → not in the help
  reg.registrieren({ id: "hs", label: "Hilfsstrecke", kurz: ["hs"], ausfuehren: () => 1 });
  let gemeldet = 0;
  const abo = registerAbonnieren(() => { gemeldet += 1; });
  const standVorher = registerStand();
  const ab = registerAnmelden(reg, { bereich: "Massenmodell" });
  assert.equal(registerStand(), standVorher + 1);
  assert.equal(gemeldet, 1);
  const abschnitte = hilfeAbschnitte({ register: angemeldeteRegister(), global: globaleBefehle() });
  assert.deepEqual(abschnitte.map((a) => a.titel), ["Massenmodell", "Überall"]);
  assert.deepEqual(abschnitte[0].eintraege, [
    { id: "linie", titel: "Linie", taste: "L", kurz: ["l"] },
    { id: "hs", titel: "Hilfsstrecke", kurz: ["hs"] },
  ]);
  ab();
  ab(); // a second call changes nothing
  assert.equal(angemeldeteRegister().length, 0);
  assert.equal(gemeldet, 2);
  abo();
});

test("105-14: Aktionen der Ansicht kommen zuerst, Kürzel in Anzeigeform", () => {
  const abschnitte = hilfeAbschnitte({
    aktionen: [{ id: "a1", titel: "Prüflauf starten", beschreibung: "x", kuerzel: "mod+shift+p" }],
    global: globaleBefehle(),
    kuerzelAnzeige: (k) => k.toUpperCase(),
  });
  assert.equal(abschnitte[0].id, "ansicht");
  assert.deepEqual(abschnitte[0].eintraege[0], { id: "a1", titel: "Prüflauf starten", beschreibung: "x", taste: "MOD+SHIFT+P", kurz: [] });
});

test("105-14: globale Befehle sind ausführbar (Palette öffnen) — dieselbe Registerform wie jede Zeichenfläche", () => {
  let offen = false;
  const reg = globaleBefehle({ paletteOeffnen: () => { offen = true; } });
  assert.deepEqual(reg.ausfuehren("palette"), { ok: true, result: null });
  assert.equal(offen, true);
  assert.equal(registerEintraege(reg).length, 3);
});

// ---------------------------------------------------------------------------
// 105-28: ranking and grouping of the palette
// ---------------------------------------------------------------------------

const e = (gruppe, titel, extra = {}) => ({ gruppe, titel, text: suchVorbereiten(titel), ...extra });

test("105-28: ohne Anfrage keine Datensätze, Gruppen in Einfügereihenfolge, höchstens PALETTE_MAX", () => {
  const liste = [
    e("Module", "Projekte"), e("Module", "Adressbuch"), e("Protokolle", "Nr. 1 · Baubesprechung", { nurMitAnfrage: true }),
    ...Array.from({ length: 20 }, (_, i) => e("Projekte", `Projekt ${i}`)),
  ];
  const gruppen = rankeTreffer(liste, "");
  assert.deepEqual(gruppen.map((g) => g.gruppe), ["Module", "Projekte"]);
  assert.equal(gruppen.flatMap((g) => g.eintraege).length, PALETTE_MAX);
});

test("105-28: die Gruppe mit dem besten Treffer steht oben, der beste Treffer zuerst (Enter öffnet ihn)", () => {
  const liste = [
    e("Module", "Zur Prüf-Suite"), e("Module", "Prüf-Suite"),
    e("Dokumente", "Prüf-Suite Handbuch", { nurMitAnfrage: true }),
    e("Protokolle", "Nr. 2 · Abstimmung Prüfsuite", { nurMitAnfrage: true }),
  ];
  const gruppen = rankeTreffer(liste, "Prüf-Suite");
  assert.equal(gruppen[0].gruppe, "Module");
  assert.equal(gruppen[0].eintraege[0].titel, "Prüf-Suite");
  assert.deepEqual(gruppen.map((g) => g.gruppe).sort(), ["Dokumente", "Module", "Protokolle"]);
});

test("105-28: Datensätze werden locker gefunden (Umlaut, Tippfehler) und je Gruppe begrenzt", () => {
  const positionen = Array.from({ length: 9 }, (_, i) => e("LV-Positionen", `01.0${i} Wände spachteln`, { nurMitAnfrage: true }));
  const gruppen = rankeTreffer([...positionen, e("Module", "Adressbuch")], "waende spachtlen");
  assert.equal(gruppen.length, 1);
  assert.equal(gruppen[0].eintraege.length, 5);
});

// ---------------------------------------------------------------------------
// 105-28: record loading with rights
// ---------------------------------------------------------------------------

/** Fake api: entities.<Name>.list() from a plain object. */
const api = (daten) => ({
  entities: new Proxy({}, { get: (_, name) => ({ list: async () => {
    if (daten[name] instanceof Error) throw daten[name];
    return daten[name] || [];
  } }) }),
});
const zugriffMit = (stufen) => ({ stufen, projektIds: null });
const ohneFristen = DATENSATZ_QUELLEN.filter((q) => q.key !== "fristen");

test("105-28: Protokolle, Positionen, Dokumente mit Sprungziel; nur Projekte der sichtbaren Liste", async () => {
  const zeilen = await ladeDatensaetze(api({
    MeetingMinutes: [
      { id: "m1", project_id: "p1", nummer: 3, titel: "Baubesprechung", datum: "2026-01-05", punkte: [{ thema: "Fassade", text: "Muster liefern" }] },
      { id: "m2", project_id: "p-fremd", nummer: 1, titel: "Fremd" },
      { id: "m3", nummer: 1, titel: "Ohne Projekt" },
    ],
    LVPosition: [{ id: "l1", project_id: "p1", oz: "01.02", short_text: "Wand spachteln", long_text: "Q2" }],
    Document: [{ id: "d1", project_id: "p1", name: "Plan A.pdf" }],
  }), {
    zugriff: zugriffMit({ berichte: "lesen", ava: "lesen" }), projekte: [{ id: "p1", name: "Testprojekt" }], heute: "2026-01-10",
    quellen: ohneFristen,
  });
  assert.deepEqual(zeilen.map((z) => [z.quelle, z.id, z.ziel]), [
    ["protokolle", "m1", "/Reports?tab=protokolle"],
    ["positionen", "l1", "/AVA?tab=lv"],
    ["dokumente", "d1", "/Reports?tab=docs"],
  ]);
  assert.equal(zeilen[0].titel, "Nr. 3 · Baubesprechung");
  assert.equal(zeilen[0].zusatz, "05.01.2026 · Testprojekt");
  assert.ok(rankeTreffer(zeilen, "fassade muster").length === 1, "Volltext findet Inhalte der Protokollpunkte");
});

test("105-28: Dokumente folgen der Bereichsregel der Berichte-Seite (personal/buchhaltung/schriftverkehr)", async () => {
  const docs = [
    { id: "d1", project_id: "p1", name: "Dokument A.pdf" },
    { id: "d2", project_id: "p1", name: "Dokument B.pdf", bereich: "personal" },
    { id: "d3", project_id: "p1", name: "Dokument C.pdf", bereich: "buchhaltung" },
    { id: "d4", project_id: "p1", name: "Dokument D.pdf", bereich: "schriftverkehr" },
  ];
  const nurDokumente = DATENSATZ_QUELLEN.filter((q) => q.key === "dokumente");
  const mitarbeiter = baueZugriff({ rolle: "mitarbeiter" });
  const zeilen = await ladeDatensaetze(api({ Document: docs }), {
    zugriff: mitarbeiter, projekte: [{ id: "p1", name: "P" }], heute: "2026-01-10", quellen: nurDokumente,
  });
  assert.deepEqual(zeilen.map((z) => z.id), sichtbareDokumente(docs, mitarbeiter).map((d) => d.id));
  assert.deepEqual(zeilen.map((z) => z.id), ["d1", "d4"], "personal/buchhaltung bleiben ohne Recht draussen");
  const inhaber = await ladeDatensaetze(api({ Document: docs }), {
    zugriff: baueZugriff({ rolle: "inhaber" }), projekte: [{ id: "p1", name: "P" }], heute: "2026-01-10", quellen: nurDokumente,
  });
  assert.deepEqual(inhaber.map((z) => z.id), ["d1", "d2", "d3", "d4"]);
});

test("105-28: ohne Leserecht auf das Modul wird die Quelle gar nicht geladen", async () => {
  const geladen = [];
  const daten = { MeetingMinutes: [{ id: "m1", project_id: "p1", titel: "X" }], LVPosition: [{ id: "l1", project_id: "p1", short_text: "Y" }] };
  const spion = { entities: new Proxy({}, { get: (_, name) => ({ list: async () => { geladen.push(name); return daten[name] || []; } }) }) };
  const zeilen = await ladeDatensaetze(spion, {
    zugriff: zugriffMit({ ava: "lesen" }), projekte: [{ id: "p1" }], heute: "2026-01-10", quellen: ohneFristen,
  });
  assert.deepEqual(geladen, ["LVPosition"]);
  assert.deepEqual(zeilen.map((z) => z.id), ["l1"]);
});

test("105-28: eine fehlerhafte Quelle bricht die anderen nicht", async () => {
  const zeilen = await ladeDatensaetze(api({ MeetingMinutes: new Error("weg"), Document: [{ id: "d1", project_id: "p1", name: "B" }] }), {
    zugriff: zugriffMit({ berichte: "lesen", ava: "lesen" }), projekte: [{ id: "p1" }], heute: "2026-01-10", quellen: ohneFristen,
  });
  assert.deepEqual(zeilen.map((z) => z.id), ["d1"]);
});

test("105-28: Fristen kommen aus dem Fristenregister (manuelle Frist mit Ziel)", async () => {
  const zeilen = await ladeDatensaetze(api({
    Termin: [{ id: "t1", art: "frist", titel: "Abgabe Bauantrag", datum: "2026-02-01", project_id: "p1" }],
  }), {
    zugriff: zugriffMit({ fristen: "lesen", projekte: "lesen" }), projekte: [{ id: "p1", name: "Testprojekt" }], heute: "2026-01-10",
    quellen: DATENSATZ_QUELLEN.filter((q) => q.key === "fristen"),
  });
  const frist = zeilen.find((z) => z.quelle === "fristen");
  assert.ok(frist, `keine Frist geladen: ${JSON.stringify(zeilen)}`);
  assert.match(frist.ziel, /Deadlines|\//);
  assert.ok(rankeTreffer([{ ...frist, gruppe: frist.gruppe }], "bauantrag abgabe").length === 1);
});
