// Unit tests of outgoing invoices (79-02 T1, BUCH-04): drafting, amounts,
// gapless numbering, issuing (frozen fields), storno, payments and the
// duplicate-invoice warnings.
//
// In:  src/lib/accounting/ausgangsrechnungen.js. Out: assertions only.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  abschlagsEntwurf, ausgangTabelle, doppelteRechnung, empfaengerAus, istEditierbar, neueRechnung, rechnungBetraege, stelleRechnung,
  storniere, zahlungErfassen,
} from "@/lib/accounting/ausgangsrechnungen.js";

const EINST = { rechnungsnr_muster: "RE-{jahr}-{nr3}", zahlungsziel_tage: 14, zahlungsziel_je_bauherr: {}, ust_satz: 19 };
const PROJEKT = { id: "proj-9", name: "Testprojekt", client: "Stadtwerke Musterstadt", hoai_phase: "LP 5" };

test("rechnungBetraege: USt je Rechnung gerundet (§ 14 UStG)", () => {
  assert.deepEqual(rechnungBetraege(33.33, 19), { netto: 33.33, ust: 6.33, brutto: 39.66 });
  assert.deepEqual(rechnungBetraege(10000, 19), { netto: 10000, ust: 1900, brutto: 11900 });
});

test("neueRechnung: Empfänger aus Kontakt (Project.client), LP-Vorschlag, Entwurf ohne Nummer", () => {
  const kontakte = [{ company: "Stadtwerke Musterstadt" }];
  const entwurf = neueRechnung({ projekt: PROJEKT, kontakte, einst: EINST, heute: "2026-09-27" });
  assert.equal(entwurf.status, "entwurf");
  assert.equal(entwurf.nummer, undefined);
  assert.equal(entwurf.empfaenger.name, "Stadtwerke Musterstadt");
  assert.equal(entwurf.lp_pos[0].lp, 5, "LP-Vorschlag aus normalisiereHoaiPhase(project.hoai_phase)");
  assert.equal(entwurf.project_name, undefined, "project_name erst beim Stellen einfrieren");
});

test("neueRechnung: Empfänger aus dem Honorarvertrag hat Vorrang vor dem Kontakt", () => {
  const vertrag = { id: "hv-1", bauherr_name: "Beispiel Immobilien GmbH", bauherr_art: "unternehmer", ust_satz: 7 };
  const entwurf = neueRechnung({ projekt: PROJEKT, vertrag, kontakte: [{ company: "Stadtwerke Musterstadt" }], einst: EINST, heute: "2026-09-27" });
  assert.equal(entwurf.empfaenger.name, "Beispiel Immobilien GmbH");
  assert.equal(entwurf.ust_satz, 7, "USt-Satz des Honorarvertrags vor dem Bürostandard");
});

test("Nummernkreis: höchste Nummer + 1, Jahre getrennt, Entwürfe zählen nicht, Reihenfolge des Stellens entscheidet", () => {
  const rechnungenAlt = [{ nummer: "RE-2026-013" }, { nummer: "RE-2025-099" }];
  const entwurfB = { project_id: "proj-2", empfaenger: { name: "B" }, netto: 16750, ust_satz: 19, ust: 3182.5, brutto: 19932.5, rechnungsdatum: "2026-09-27", status: "entwurf" };
  const gestelltB = stelleRechnung(entwurfB, { rechnungen: rechnungenAlt, einst: EINST, heute: "2026-09-27", projekt: PROJEKT });
  assert.equal(gestelltB.nummer, "RE-2026-014");
  assert.equal(gestelltB.status, "gestellt");
  assert.equal(gestelltB.faellig_am, "2026-10-11", "Rechnungsdatum + Zahlungsziel (Standard 14 Tage)");

  const entwurfA = { project_id: "proj-1", empfaenger: { name: "A" }, netto: 10000, ust_satz: 19, ust: 1900, brutto: 11900, rechnungsdatum: "2026-01-31", zahlungsziel_tage: 30, status: "entwurf" };
  const gestelltA = stelleRechnung(entwurfA, { rechnungen: [...rechnungenAlt, gestelltB], einst: EINST, heute: "2026-09-27", projekt: PROJEKT });
  assert.equal(gestelltA.nummer, "RE-2026-015");
  assert.equal(gestelltA.faellig_am, "2026-03-02", "31.01. + 30 Tage");
});

test("stelleRechnung: friert Empfänger, Rechnungsdatum, Zahlungsziel, Fälligkeit und Projektnamen ein", () => {
  const entwurf = { project_id: "proj-9", empfaenger: { name: "Alt" }, netto: 5000, ust_satz: 19, ust: 950, brutto: 5950, status: "entwurf" };
  const gestellt = stelleRechnung(entwurf, { rechnungen: [], einst: EINST, heute: "2026-10-01", projekt: { name: "Neuer Name" } });
  assert.equal(gestellt.rechnungsdatum, "2026-10-01", "leeres Rechnungsdatum wird beim Stellen auf heute gesetzt");
  assert.equal(gestellt.project_name, "Neuer Name");
  assert.equal(gestellt.zahlungsziel_tage, 14);
});

test("Zahlungsziel-Kette beim Stellen: Vertrag > Bauherr > Standard (E-12)", () => {
  const einstMitBauherr = { ...EINST, zahlungsziel_je_bauherr: { "stadtwerke musterstadt": 45 } };
  const ohneVertragOhneBauherr = stelleRechnung(
    { project_id: "proj-x", empfaenger: {}, netto: 100, ust_satz: 19, ust: 19, brutto: 119, rechnungsdatum: "2026-10-01", status: "entwurf" },
    { rechnungen: [], einst: EINST, heute: "2026-10-01", projekt: { client: "Unbekannt" } }
  );
  assert.equal(ohneVertragOhneBauherr.zahlungsziel_tage, 14);
  assert.equal(ohneVertragOhneBauherr.faellig_am, "2026-10-15", "Standard 14 Tage");

  const mitBauherr = stelleRechnung(
    { project_id: "proj-1", empfaenger: {}, netto: 100, ust_satz: 19, ust: 19, brutto: 119, rechnungsdatum: "2026-10-01", status: "entwurf" },
    { rechnungen: [], einst: einstMitBauherr, heute: "2026-10-01", projekt: PROJEKT }
  );
  assert.equal(mitBauherr.zahlungsziel_tage, 45);

  const mitVertrag = stelleRechnung(
    { project_id: "proj-1", empfaenger: {}, netto: 100, ust_satz: 19, ust: 19, brutto: 119, rechnungsdatum: "2026-10-01", status: "entwurf" },
    { rechnungen: [], vertrag: { zahlungsziel_tage: 21 }, einst: einstMitBauherr, heute: "2026-10-01", projekt: PROJEKT }
  );
  assert.equal(mitVertrag.zahlungsziel_tage, 21, "Vertrag geht vor dem Bauherrn");
});

test("storniere: Stornobeleg mit eigener Nummer, negativen Beträgen und storno_von; Original storniert; Nummernfolge ohne Lücke", () => {
  const gestellt = { id: "ar-14", nummer: "RE-2026-014", project_id: "proj-2", project_name: "Bürocampus", netto: 10000, ust_satz: 19, ust: 1900, brutto: 11900, status: "gestellt", empfaenger: { name: "B" } };
  const rechnungen = [{ nummer: "RE-2026-013" }, gestellt, { nummer: "RE-2026-015" }];
  const { storno, original } = storniere(gestellt, { rechnungen, einst: EINST, heute: "2026-10-02" });
  assert.equal(storno.nummer, "RE-2026-016");
  assert.equal(storno.netto, -10000);
  assert.equal(storno.brutto, -11900);
  assert.equal(storno.storno_von, "ar-14");
  assert.equal(storno.status, "gestellt");
  assert.equal(original.status, "storniert");
});

test("zahlungErfassen: hängt Zahlungen an, ohne bestehende zu verändern", () => {
  const r = { zahlungen: [{ datum: "2026-09-01", betrag: 500 }] };
  const neu = zahlungErfassen(r, { datum: "2026-09-15", betrag: 300 });
  assert.equal(neu.zahlungen.length, 2);
  assert.deepEqual(neu.zahlungen[1], { datum: "2026-09-15", betrag: 300 });
  assert.equal(r.zahlungen.length, 1, "das Original bleibt unverändert");
});

test("istEditierbar: nur Entwurf und geplant, nie gestellt oder storniert", () => {
  assert.equal(istEditierbar({ status: "entwurf" }), true);
  assert.equal(istEditierbar({ status: "geplant" }), true);
  assert.equal(istEditierbar({ status: "gestellt" }), false);
  assert.equal(istEditierbar({ status: "storniert" }), false);
});

test("doppelteRechnung: Schlussrechnung doppelt, LP-Stand doppelt, Leistungszeitraum überlappt", () => {
  const bestehend = [
    { id: "ar-1", honorarvertrag_id: "hv-1", status: "gestellt", art: "schluss", lp_pos: [], leistung_von: "2026-03-01", leistung_bis: "2026-03-31" },
    { id: "ar-2", honorarvertrag_id: "hv-1", status: "gestellt", art: "abschlag", lp_pos: [{ lp: 5, stand: 40, netto: 1000 }] },
  ];
  assert.deepEqual(doppelteRechnung(bestehend, { id: "neu", honorarvertrag_id: "hv-1", art: "schluss", lp_pos: [] }), ["schluss_doppelt"]);
  assert.deepEqual(doppelteRechnung(bestehend, { id: "neu", honorarvertrag_id: "hv-1", art: "abschlag", lp_pos: [{ lp: 5, stand: 40, netto: 900 }] }), ["lp_stand_doppelt"]);
  assert.deepEqual(
    doppelteRechnung(bestehend, { id: "neu", honorarvertrag_id: "hv-1", art: "abschlag", lp_pos: [], leistung_von: "2026-03-15", leistung_bis: "2026-04-15" }),
    ["zeitraum_ueberlappt"]
  );
  assert.deepEqual(doppelteRechnung(bestehend, { id: "neu", honorarvertrag_id: "hv-2", art: "schluss", lp_pos: [] }), [], "anderer Honorarvertrag warnt nicht");
  // A cancelled invoice must not trigger a warning any more.
  const mitStorno = [{ ...bestehend[0], status: "storniert" }];
  assert.deepEqual(doppelteRechnung(mitStorno, { id: "neu", honorarvertrag_id: "hv-1", art: "schluss", lp_pos: [] }), []);
});

test("ausgangTabelle: Filter Status und Jahr, Summenspalten, letzte Zahlung", () => {
  const daten = [
    { id: "a", project_id: "proj-1", nummer: "RE-2026-001", netto: 1000, ust: 190, brutto: 1190, rechnungsdatum: "2026-02-01", status: "gestellt", faellig_am: "2026-02-15", zahlungen: [{ datum: "2026-02-10", betrag: 1190 }] },
    { id: "b", project_id: "proj-1", nummer: "RE-2025-050", netto: 500, ust: 95, brutto: 595, rechnungsdatum: "2025-11-01", status: "gestellt", faellig_am: "2025-11-15", zahlungen: [] },
  ];
  const kontext = { heute: "2026-09-27", projekte: [{ id: "proj-1", name: "Testprojekt" }] };
  const t = (s) => s;
  const modell = ausgangTabelle(daten, t, kontext, { jahr: 2026 });
  assert.equal(modell.zeilen.length, 1);
  assert.equal(modell.zeilen[0].nummer, "RE-2026-001");
  assert.equal(modell.zeilen[0].zahlung_summe, 1190);
  assert.equal(modell.zeilen[0].zahlung_datum, "2026-02-10");
  assert.equal(modell.zeilen[0].status, "Bezahlt");
  const nurUeberfaellig = ausgangTabelle(daten, t, kontext, { status: "ueberfaellig" });
  assert.equal(nurUeberfaellig.zeilen.length, 1);
  assert.equal(nurUeberfaellig.zeilen[0].nummer, "RE-2025-050");
});

test("empfaengerAus: Honorarvertrag vor Kontakt vor Project.client, leer wenn nichts bekannt", () => {
  const vertrag = { bauherr_name: "Beispiel Immobilien GmbH", bauherr_anschrift: "Musterweg 1", bauherr_art: "unternehmer" };
  assert.equal(empfaengerAus(vertrag, [], PROJEKT).name, "Beispiel Immobilien GmbH");
  assert.equal(empfaengerAus(vertrag, [], PROJEKT).anschrift, "Musterweg 1");
  assert.equal(empfaengerAus(null, [{ company: "Stadtwerke Musterstadt" }], PROJEKT).name, "Stadtwerke Musterstadt");
  assert.equal(empfaengerAus({ bauherr_name: "" }, [], { client: "Wohnbau Süd eG" }).name, "Wohnbau Süd eG");
  assert.equal(empfaengerAus(null, [], null).name, "");
});

test("stelleRechnung: Empfänger aus dem AKTUELLEN Vertrag/Projekt, nicht aus einer veralteten Vorschau", () => {
  // Planned invoice from zahlungsplan(): no recipient of its own.
  const geplant = { project_id: "proj-2", honorarvertrag_id: "hv-2", netto: 1000, ust_satz: 19, ust: 190, brutto: 1190, status: "geplant" };
  const ausPlan = stelleRechnung(geplant, {
    rechnungen: [], vertrag: { id: "hv-2", bauherr_name: "Beispiel Immobilien GmbH" }, einst: EINST, heute: "2026-09-27", projekt: PROJEKT,
  });
  assert.equal(ausPlan.empfaenger.name, "Beispiel Immobilien GmbH");
  // Draft saved while another project was selected: the stale preview loses.
  const veraltet = { project_id: "proj-9", empfaenger: { name: "Erstes Projekt GmbH" }, netto: 100, ust_satz: 19, ust: 19, brutto: 119, status: "entwurf" };
  const neu = stelleRechnung(veraltet, { rechnungen: [], einst: EINST, heute: "2026-09-27", projekt: PROJEKT });
  assert.equal(neu.empfaenger.name, "Stadtwerke Musterstadt");
  // Neither contract nor project name anyone: the draft's own value is kept.
  const ohneQuelle = stelleRechnung(veraltet, { rechnungen: [], einst: EINST, heute: "2026-09-27", projekt: { name: "Ohne Bauherr" } });
  assert.equal(ohneQuelle.empfaenger.name, "Erstes Projekt GmbH");
});

test("abschlagsEntwurf: Vorlage aus HoaiPlan-Stand minus Gestelltem, Positionen je LP (Beispielvertrag proj-1)", () => {
  const lph8 = [2, 7, 15, 3, 25, 10, 4, 32, 2].map((prozent, i) => ({ beauftragt: i < 8, prozent }));
  const vertrag = {
    id: "hv-p1", project_id: "proj-1", leistungsbild: "gebaeude", kg300_euro: 2399716, kg400_euro: 281000, sonstige_euro: 0,
    honorarzone: "III", satz_position_prozent: 0, lph: lph8, umbauzuschlag_prozent: 0, nebenkosten_prozent: 5, ust_satz: 19,
  };
  const rechnungen = [12400, 9800, 15200, 22600].map((netto) => ({ honorarvertrag_id: "hv-p1", status: "gestellt", art: "abschlag", netto }));
  const hoaiPlan = { progress: [100, 100, 100, 100, 80, 45, 30, 10, 0] };
  const vorlage = abschlagsEntwurf({ vertrag, projekt: { hoai_phase: "LP 5" }, hoaiPlan, rechnungen });
  assert.equal(vorlage.art, "abschlag");
  assert.equal(vorlage.stand_quelle, "hoaiplan");
  assert.equal(vorlage.netto, 94714.78);
  assert.deepEqual(vorlage.lp_pos.map((p) => p.lp), [3, 4, 5, 6, 7, 8], "LP 1/2 und ein Teil von LP 3 sind durch 60.000 € gedeckt");
  assert.equal(Math.round(vorlage.lp_pos.reduce((n, p) => n + p.netto * 100, 0)), 9471478);
  // The prefill reaches the draft unchanged.
  const entwurf = neueRechnung({ projekt: { id: "proj-1", client: "Stadtwerke Musterstadt" }, vertrag, einst: EINST, heute: "2026-09-27", vorlage });
  assert.equal(entwurf.netto, 94714.78);
  assert.equal(entwurf.lp_pos.length, 6);
  // Nothing open: no lp_pos, so neueRechnung's project-phase LP suggestion applies.
  const nichts = abschlagsEntwurf({ vertrag, projekt: { hoai_phase: "LP 5" }, hoaiPlan: { progress: [100] }, rechnungen });
  assert.equal(nichts.netto, 0);
  assert.equal(nichts.lp_pos, undefined);
});
