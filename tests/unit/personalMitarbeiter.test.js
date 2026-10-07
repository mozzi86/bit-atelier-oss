// personalMitarbeiter.test.js — Fachmodell Mitarbeiter/Vertrag (Plan 80-04,
// Task 2). Behavior 2–7 mit Rechenweg.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PERSONENARTEN,
  FELDER,
  normalisiereMitarbeiter,
  validiereMitarbeiter,
  gesellschafterHinweise,
  naechstePersonalnummer,
  sucheMitarbeiter,
  anzeigeName,
} from "@/lib/people/mitarbeiter.js";
import { aktiverVertrag, VERTRAGSARTEN, VERTRAGS_STATUS } from "@/lib/people/vertrag.js";
import { beispielDatensaetze } from "@/lib/accounting/beispielDaten.js";

// --- Behavior 2 -------------------------------------------------------------

describe("PERSONENARTEN", () => {
  it("hat genau 11 Einträge", () => {
    assert.equal(PERSONENARTEN.length, 11);
  });
  it("arbeitsrecht === false genau für frei, gesellschafter, inhaber", () => {
    const ohneArbeitsrecht = PERSONENARTEN.filter((p) => p.arbeitsrecht === false).map((p) => p.key).sort();
    assert.deepEqual(ohneArbeitsrecht, ["frei", "gesellschafter", "inhaber"]);
  });
  it("geldfluss: entnahme für gesellschafter/inhaber, honorar für frei, personalaufwand für die übrigen 8", () => {
    const geldflussVon = (key) => PERSONENARTEN.find((p) => p.key === key).geldfluss;
    assert.equal(geldflussVon("gesellschafter"), "entnahme");
    assert.equal(geldflussVon("inhaber"), "entnahme");
    assert.equal(geldflussVon("frei"), "honorar");
    const personalaufwand = PERSONENARTEN.filter((p) => p.geldfluss === "personalaufwand");
    assert.equal(personalaufwand.length, 8);
    assert.ok(personalaufwand.some((p) => p.key === "gf_gmbh"));
  });
});

// --- Behavior 3: DS-06 -------------------------------------------------------

describe("normalisiereMitarbeiter — DS-06 Whitelist", () => {
  it("verwirft verbotene Felder top-level und verschachtelt, behält erlaubte", () => {
    const eingabe = {
      vorname: "A", iban: "DE00", konfession: "rk", schwerbehinderung: true,
      privat: { adresse: "x", krankenkasse: "y" },
      kammer: { kammer: "ByAK", gewerkschaft: "z" },
    };
    const aus = normalisiereMitarbeiter(eingabe);
    assert.equal(aus.iban, undefined);
    assert.equal(aus.konfession, undefined);
    assert.equal(aus.schwerbehinderung, undefined);
    assert.equal(aus.privat.krankenkasse, undefined);
    assert.equal(aus.kammer.gewerkschaft, undefined);
    assert.equal(aus.privat.adresse, "x");
    assert.equal(aus.kammer.kammer, "ByAK");
    assert.equal(aus.vorname, "A");
  });
  it("FELDER.oben enthält keines der VERBOTENE_FELDER-Muster", () => {
    // Struktureller Gegencheck: eine Positiv-Whitelist, kein Blacklist-Vergleich.
    assert.ok(!FELDER.oben.includes("iban"));
    assert.ok(!FELDER.oben.includes("steuer_id"));
  });
});

// --- Behavior 4 -------------------------------------------------------------

describe("naechstePersonalnummer", () => {
  it("['P-001','P-007'] → 'P-008'", () => {
    assert.equal(naechstePersonalnummer(["P-001", "P-007"]), "P-008");
  });
  it("[] → 'P-001'", () => {
    assert.equal(naechstePersonalnummer([]), "P-001");
  });
});

// --- Behavior 5 -------------------------------------------------------------

const ZWOELF = [
  { personalnummer: "P-001", vorname: "Inhaberin", nachname: "A", funktion: "Architektin", art: "inhaber" },
  { personalnummer: "P-003", vorname: "Lena", nachname: "Beispiel", funktion: "Projektleitung", art: "angestellt" },
  { personalnummer: "P-004", vorname: "Jonas", nachname: "Probe", funktion: "Werkstudent", art: "werkstudent" },
  { personalnummer: "P-005", vorname: "Mia", nachname: "Muster", funktion: "Bauzeichnerin", art: "angestellt" },
  { personalnummer: "P-006", vorname: "Musa", nachname: "Beispiel", funktion: "Praktikant", art: "praktikum_freiwillig" },
  { personalnummer: "P-007", vorname: "Nora", nachname: "Testperson", funktion: "Architektin", art: "angestellt" },
  { personalnummer: "P-008", vorname: "Otto", nachname: "Beispielhaft", funktion: "Haustechnik (Nebenjob)", art: "minijob" },
  { personalnummer: "P-009", vorname: "Petra", nachname: "Vorlage", funktion: "Assistenz", art: "angestellt" },
  { personalnummer: "P-010", vorname: "Quirin", nachname: "Vorbild", funktion: "Azubi", art: "azubi" },
  { personalnummer: "P-011", vorname: "Rosa", nachname: "Beispiel2", funktion: "Bemusterung Fassaden", art: "angestellt" },
  { personalnummer: "P-012", vorname: "Sven", nachname: "Testfall", funktion: "Bauleitung", art: "angestellt" },
  { personalnummer: "P-013", vorname: "Tina", nachname: "Entwurf", funktion: "Freie Mitarbeit", art: "frei" },
];

describe("sucheMitarbeiter", () => {
  it("'mus' → 3 Treffer, ohne Groß-/Kleinschreibung und Diakritika", () => {
    const treffer = sucheMitarbeiter(ZWOELF, "mus");
    // Treffer: "Muster" (Nachname P-005), "Musa" (Vorname P-006),
    // "Bemusterung" (Funktion P-011) — genau 3 durch die Fixture oben.
    assert.equal(treffer.length, 3);
  });
  it("Filter {entnahme:true} auf den 12 Datensätzen → 1 (P-001, Inhaberin)", () => {
    const treffer = sucheMitarbeiter(ZWOELF, "", { entnahme: true });
    assert.equal(treffer.length, 1);
    assert.equal(treffer[0].personalnummer, "P-001");
  });
});

describe("anzeigeName", () => {
  it("verbindet Vor- und Nachname", () => {
    assert.equal(anzeigeName({ vorname: "Lena", nachname: "Beispiel" }), "Lena Beispiel");
  });
});

// --- Behavior 6 ---------------------------------------------------------------

describe("validiereMitarbeiter", () => {
  it("ohne Nachnamen → Eintrag feld:'nachname', schwere:'fail'", () => {
    const eintraege = validiereMitarbeiter({ vorname: "A", nachname: "", art: "angestellt" });
    const treffer = eintraege.find((e) => e.feld === "nachname");
    assert.ok(treffer);
    assert.equal(treffer.schwere, "fail");
  });
  it("austritt < eintritt → fail", () => {
    const eintraege = validiereMitarbeiter({ vorname: "A", nachname: "B", art: "angestellt", eintritt: "2026-05-01", austritt: "2026-04-01" });
    const treffer = eintraege.find((e) => e.feld === "austritt");
    assert.ok(treffer);
    assert.equal(treffer.schwere, "fail");
  });
});

describe("gesellschafterHinweise — E-04, rechtsformWirkung/personenPruefen aus 79", () => {
  const g79 = beispielDatensaetze("2026-09-27").Gesellschafter; // [{id:'bsp-g1', name:'Inhaberin A', rolle:'inhaber', aktiv:true, ...}]
  const seed = [{ art: "inhaber", status: "aktiv" }];

  it("einzelunternehmen (Demo-Rechtsform des 79-Seeds, eine Inhaberin) → []", () => {
    assert.deepEqual(gesellschafterHinweise({ rechtsform: "einzelunternehmen" }, seed, g79), []);
  });
  it("{} (Standard nach E-04) → []", () => {
    assert.deepEqual(gesellschafterHinweise({}, seed, g79), []);
  });
  it("unbekannter Schlüssel 'einzel' → einzelunternehmen laut rechtsformWirkung → []", () => {
    assert.deepEqual(gesellschafterHinweise({ rechtsform: "einzel" }, seed, g79), []);
  });
  it("Seed plus eine aktive Person mit Personenart gesellschafter bei einzelunternehmen → genau 1 Widerspruch (warn)", () => {
    const mitGesellschafter = [...seed, { art: "gesellschafter", status: "aktiv" }];
    const hinweise = gesellschafterHinweise({ rechtsform: "einzelunternehmen" }, mitGesellschafter, g79);
    assert.equal(hinweise.length, 1);
    assert.equal(hinweise[0].schwere, "warn");
    assert.match(hinweise[0].text, /Einzelunternehmen hat keine Gesellschafter/);
  });
  it("{rechtsform:'gbr'} → Widerspruch zur Personenart inhaber (warn)", () => {
    const hinweise = gesellschafterHinweise({ rechtsform: "gbr" }, seed, g79);
    const widerspruch = hinweise.find((h) => /Gesellschafter bzw\. Partner/.test(h.text));
    assert.ok(widerspruch);
    assert.equal(widerspruch.schwere, "warn");
  });
  it("{rechtsform:'gmbh'} → Hinweis 'gf_gmbh'", () => {
    const hinweise = gesellschafterHinweise({ rechtsform: "gmbh" }, seed, g79);
    const hinweis = hinweise.find((h) => /gf_gmbh/.test(h.text));
    assert.ok(hinweis);
  });
  it("keine eigene Rechtsform-Schlüsseltabelle (kein 'einzel' als eigener quotierter String)", async () => {
    const fs = await import("node:fs/promises");
    const inhalt = await fs.readFile(new URL("../../src/lib/people/mitarbeiter.js", import.meta.url), "utf8");
    assert.equal((inhalt.match(/einzel'|'einzel"/g) || []).length, 0);
    assert.match(inhalt, /rechtsformWirkung/);
  });
});

// --- Behavior 7 ---------------------------------------------------------------

describe("aktiverVertrag", () => {
  const vertraege = [
    { id: "V-003", mitarbeiter_id: "P-003", status: "unterschrieben", beginn: "2026-04-21", ende: "2028-04-20" },
    { id: "V-005", mitarbeiter_id: "P-005", status: "unterschrieben", beginn: "2026-11-02", ende: null },
    { id: "V-005-entwurf", mitarbeiter_id: "P-005", status: "entwurf", beginn: "2026-01-01", ende: null },
  ];
  it("P-003 am 2026-09-27 → V-003", () => {
    assert.equal(aktiverVertrag(vertraege, "P-003", "2026-09-27")?.id, "V-003");
  });
  it("P-005 am 2026-09-27 (vor Vertragsbeginn) → null", () => {
    assert.equal(aktiverVertrag(vertraege, "P-005", "2026-09-27"), null);
  });
  it("P-005 am 2026-11-02 (Vertragsbeginn) → V-005", () => {
    assert.equal(aktiverVertrag(vertraege, "P-005", "2026-11-02")?.id, "V-005");
  });
  it("ein Vertrag mit status:'entwurf' ist nie aktiv", () => {
    const nurEntwurf = [{ id: "V-x", mitarbeiter_id: "P-x", status: "entwurf", beginn: "2020-01-01", ende: null }];
    assert.equal(aktiverVertrag(nurEntwurf, "P-x", "2026-09-27"), null);
  });
  it("VERTRAGSARTEN und VERTRAGS_STATUS sind nicht leer", () => {
    assert.ok(VERTRAGSARTEN.length >= 10);
    assert.ok(VERTRAGS_STATUS.length >= 5);
  });
});
