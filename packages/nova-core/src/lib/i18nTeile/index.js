// Dictionary parts per area (decision list § 5, D-P79-27): the generic mechanism
// that keeps i18n.jsx out of every area plan. i18n.jsx spreads TEILE_EN as the
// last line of DICT.en; each area writes its English texts into its own part file.
//
// Adding a phase (80–82): create the part files, add ONE import line and ONE
// spread entry per file below — i18n.jsx itself stays untouched. The guard
// (tests/unit/i18nAbdeckung.test.js via tests/unit/helpers/woerterbuch.mjs)
// reads every file of this folder and refuses a key defined twice anywhere.
//
// In:  the part files. Out: TEILE_EN, all English entries of the parts merged.

import { EN as BUCHHALTUNG_FUNDAMENT } from "./buchhaltung-fundament.js";
import { EN as BUCHHALTUNG_RECHNUNGEN } from "./buchhaltung-rechnungen.js";
import { EN as BUCHHALTUNG_MAHNWESEN } from "./buchhaltung-mahnwesen.js";
import { EN as BUCHHALTUNG_UMSATZSTEUER } from "./buchhaltung-umsatzsteuer.js";
import { EN as BUCHHALTUNG_BANK } from "./buchhaltung-bank.js";
import { EN as BUCHHALTUNG_JAHRESUHR } from "./buchhaltung-jahresuhr.js";
import { EN as BUCHHALTUNG_AUSGABEN } from "./buchhaltung-ausgaben.js";
import { EN as BUCHHALTUNG_ENTNAHMEN } from "./buchhaltung-entnahmen.js";
import { EN as BUCHHALTUNG_FUHRPARK } from "./buchhaltung-fuhrpark.js";
import { EN as BUCHHALTUNG_ANLAGEN } from "./buchhaltung-anlagen.js";
import { EN as BUCHHALTUNG_JAHRESUEBERSICHT } from "./buchhaltung-jahresuebersicht.js";
import { EN as BUCHHALTUNG_WEITERGABE } from "./buchhaltung-weitergabe.js";
import { EN as BUCHHALTUNG_GESAMT } from "./buchhaltung-gesamt.js";
// Phase 80 (80-01): lane A settings, lane B personnel — one part file per plan.
import { EN as EINSTELLUNGEN } from "./einstellungen.js";
import { EN as PERSONAL_ALLGEMEIN } from "./personal-allgemein.js";
import { EN as PERSONAL_MITARBEITENDE } from "./personal-mitarbeitende.js";
import { EN as PERSONAL_VERTRAEGE } from "./personal-vertraege.js";
import { EN as PERSONAL_SUCHE } from "./personal-suche.js";
import { EN as PERSONAL_EINTRITT } from "./personal-eintritt.js";
import { EN as PERSONAL_DATENSCHUTZ } from "./personal-datenschutz.js";
// Phase 75 (75-15): massing studio / apartment focus.
import { EN as MASSING_STUDIO } from "./massing-studio.js";
// Plan 66-14: check suite findings list (CSV / Excel).
import { EN as MODELCHECK_EXPORT } from "./modelcheck-export.js";
// Plan 83-02: open source — feedback dialog, registration request, footer link.
import { EN as OPEN_SOURCE } from "./open-source.js";
// Plan 86-05b: workshop tab "Vorschläge" (building proposals) + figure labels.
import { EN as WERKSTATT_VORSCHLAEGE } from "./werkstatt-vorschlaege.js";
import { EN as WERKSTATT_INNENWAENDE } from "./werkstatt-innenwaende.js";
import { EN as WERKSTATT_RANDBEBAUUNG } from "./werkstatt-randbebauung.js";
import { EN as MASSING_ACHSE } from "./massing-achse.js";
import { EN as WERKSTATT_ADERN } from "./werkstatt-adern.js";
import { EN as WERKSTATT_BEWERTUNG } from "./werkstatt-bewertung.js";
import { EN as BAUTEILE_WERKSTATT } from "./bauteile-werkstatt.js";
import { EN as EINE_WAHRHEIT } from "./eine-wahrheit.js";
import { EN as WERKPLANUNG_BAUTAGEBUCH } from "./werkplanung-bautagebuch.js";
import { EN as WERKPLANUNG_GENEHMIGUNGEN } from "./werkplanung-genehmigungen.js";
import { EN as PROJEKTAKTE_FOKUS } from "./projektakte-fokus.js";
import { EN as KI_LOKAL } from "./ki-lokal.js";
// Plan 72-03: accessible names of fields and icon buttons (aria-label).
import { EN as A11Y_NAMEN } from "./a11y-namen.js";
// Plan 96-02: VOB/B § 2 Abs. 3 rating against the contracted quantity (AVA).
import { EN as VOB_MENGEN_96 } from "./vob-mengen-96.js";
import { EN as PDF_PLANKOPF } from "./pdf-plankopf.js";
import { EN as REGENWASSER } from "./regenwasser.js";
import { EN as AVA_ANGEBOTIMPORT } from "./ava-angebotimport.js";
import { EN as AVA_ANGEBOTPRUEFUNG } from "./ava-angebotpruefung.js";
import { EN as AVA_VERGABEVORSCHLAG } from "./ava-vergabevorschlag.js";
import { EN as BETEILIGTE } from "./beteiligte.js";
import { EN as AVA_VHB } from "./ava-vhb.js";
import { EN as AVA_KOSTENKG } from "./ava-kostenkg.js";
import { EN as PLANNER_GANTT } from "./planner-gantt.js";
import { EN as PROTOKOLL } from "./protokoll.js";
import { EN as KONTAKT_ADRESSE } from "./kontakt-adresse.js";
import { EN as SELBST_UPDATE } from "./selbst-update.js";
// 93-03: office mode (pairing page, header marker, settings card).
import { EN as BUERO_MODUS } from "./buero-modus.js";
import { EN as NACHHALTIGKEIT } from "./nachhaltigkeit.js";
import { EN as BESTAND } from "./bestand.js";
import { EN as MODELCHECK_VERGLEICH } from "./modelcheck-vergleich.js";
import { EN as GESAMTEXPORT } from "./gesamtexport.js";
// Phase 81 (81-01): time, fees & controlling — foundation plus one part file per plan/lane.
import { EN as ZEIT_HONORAR_FUNDAMENT } from "./zeit-honorar-fundament.js";
import { EN as ZEIT_ERFASSUNG } from "./zeit-erfassung.js";
import { EN as ZEIT_CONTROLLING } from "./zeit-controlling.js";
import { EN as HONORAR_ANGEBOTE } from "./honorar-angebote.js";
import { EN as HONORAR_RECHNER } from "./honorar-rechner.js";
import { EN as HONORAR_VERTRAEGE } from "./honorar-vertraege.js";
import { EN as HONORAR_NACHTRAEGE } from "./honorar-nachtraege.js";
import { EN as ZEIT_HONORAR_ABSCHLUSS } from "./zeit-honorar-abschluss.js";
// Phase 82 (82-01): deadlines, absences, correspondence & rights — foundation plus one part file per lane.
import { EN as BUERO_ORGA_FUNDAMENT } from "./buero-orga-fundament.js";
import { EN as RECHTE } from "./rechte.js";
import { EN as FRISTEN } from "./fristen.js";
import { EN as ABWESENHEITEN } from "./abwesenheiten.js";
import { EN as SCHRIFTVERKEHR } from "./schriftverkehr.js";
import { EN as MEINE_WOCHE } from "./meine-woche.js";
// Plan 72-21: windowed lists — filter fields (check suite findings, AVA positions).
import { EN as LISTEN_FENSTER } from "./listen-fenster.js";
// Plan 66-15: finding ↔ construction section (order by section date, storeys per delivery).
import { EN as BEFUND_ABSCHNITT } from "./befund-abschnitt.js";
// Plan 71-06: attribute editor + change journal in the IFC viewer.
import { EN as IFC_ATTRIBUTE } from "./ifc-attribute.js";
// Phase 70 (70-02/70-03): desktop client — profile dialog, storage location.
import { EN as DESKTOP_CLIENT } from "./desktop-client.js";
// Plan 57-06: access request confirmation with the full text (no silent loss).
import { EN as ZUGANG_RECHT } from "./zugang-recht.js";
// Plan 74-01: bidder portal for external roles.
import { EN as BIETER_PORTAL } from "./bieter-portal.js";
// Plan 74-01 Task 14: office controls for bidder access, deadline, release, opening.
import { EN as VERGABE_ZUGRIFF } from "./vergabe-zugriff.js";
// Plan 76-07: cost-group open list (TypeSafe rollback D-P76-03).
import { EN as AVA_KG_RUECKBAU } from "./ava-kg-rueckbau.js";
// Plan 72-04: attribute check before the quantity takeover (IFC viewer).
import { EN as NACHWEIS_HAERTUNG } from "./nachweis-haertung.js";
// Plan 89-04: status visibility in the IFC viewer.
import { EN as BAUTEIL_STATUS } from "./bauteil-status.js";
// Plan 89-07: store of truth line in Settings → Data.
import { EN as SPEICHER_WAHRHEIT } from "./speicher-wahrheit.js";
// Plan 89-06: 4D timeline construction section × trade.
import { EN as ZEITSTRAHL } from "./zeitstrahl.js";
// Plan 72-05: sketch tool (freehand + constraint mode).
import { EN as SKIZZE } from "./skizze.js";
// Energy screening wording (liability fix 12.10.2026, 78-12 lane).
import { EN as ENERGIE_SCREENING } from "./energie-screening.js";
// Plan 88-03: change order review path (VOB/B § 2 Abs. 5/6).
import { EN as NACHTRAG_PRUEFPFAD } from "./nachtrag-pruefpfad.js";
// Plan 88-08: cost stages DIN 276 + construction cost ceiling.
import { EN as AVA_KOSTENSTAENDE } from "./ava-kostenstaende.js";
// Plan 88-06: page "Werkplanung & Baustelle" + plan list.
import { EN as WERKPLANUNG_PLAENE } from "./werkplanung-plaene.js";
// Plan 88-01: openings planning (Durchbrüche) on the page Werkplanung.
import { EN as WERKPLANUNG_DURCHBRUECHE } from "./werkplanung-durchbrueche.js";
// Plan 88-05: sampling + room book per room type.
import { EN as WERKPLANUNG_BEMUSTERUNG } from "./werkplanung-bemusterung.js";
// Plan 88-09: project feasibility figures (BauNVO, full storeys, residual value).
import { EN as MACHBARKEIT_KENNZAHLEN } from "./machbarkeit-kennzahlen.js";
// Plan 88-07: health & safety basics (BaustellV), forms and hints only (D-RE-04).
import { EN as WERKPLANUNG_SIGE } from "./werkplanung-sige.js";
// Plan 89-05: construction sequence chain (predecessors, award units, coverage).
import { EN as BAUABLAUF } from "./bauablauf.js";
// Plan 93-01: XRechnung export of outgoing invoices (lever 156).
import { EN as BUCHHALTUNG_XRECHNUNG } from "./buchhaltung-xrechnung.js";
// Plan 93-06: automatic local backup in Settings › Data (lever 161).
import { EN as AUTO_SICHERUNG } from "./auto-sicherung.js";

/**
 * English entries of all dictionary parts (German source text → English).
 * @type {Readonly<Record<string, string>>}
 */
// Plan 93-10: .bitproj file association (double-click import, save back).
import { EN as DATEI_OEFFNEN } from "./datei-oeffnen.js";
// Plan 93-11: app window mode ("Programm beenden").
import { EN as APP_MODUS } from "./app-modus.js";
// Phase 94: acceptance findings stations 0–2.
import { EN as ABNAHME_94 } from "./abnahme-94.js";
import { EN as KOSTENDRIFT_96 } from "./kostendrift-96.js";

export const TEILE_EN = Object.freeze({
  ...BUCHHALTUNG_FUNDAMENT,
  ...BUCHHALTUNG_RECHNUNGEN,
  ...BUCHHALTUNG_MAHNWESEN,
  ...BUCHHALTUNG_UMSATZSTEUER,
  ...BUCHHALTUNG_BANK,
  ...BUCHHALTUNG_JAHRESUHR,
  ...BUCHHALTUNG_AUSGABEN,
  ...BUCHHALTUNG_ENTNAHMEN,
  ...BUCHHALTUNG_FUHRPARK,
  ...BUCHHALTUNG_ANLAGEN,
  ...BUCHHALTUNG_JAHRESUEBERSICHT,
  ...BUCHHALTUNG_WEITERGABE,
  ...BUCHHALTUNG_GESAMT,
  ...EINSTELLUNGEN,
  ...PERSONAL_ALLGEMEIN,
  ...PERSONAL_MITARBEITENDE,
  ...PERSONAL_VERTRAEGE,
  ...PERSONAL_SUCHE,
  ...PERSONAL_EINTRITT,
  ...PERSONAL_DATENSCHUTZ,
  ...MASSING_STUDIO,
  ...MODELCHECK_EXPORT,
  ...OPEN_SOURCE,
  ...WERKSTATT_VORSCHLAEGE,
  ...PDF_PLANKOPF,
  ...REGENWASSER,
  ...AVA_ANGEBOTIMPORT,
  ...AVA_ANGEBOTPRUEFUNG,
  ...AVA_VERGABEVORSCHLAG,
  ...BETEILIGTE,
  ...AVA_VHB,
  ...AVA_KOSTENKG,
  ...PLANNER_GANTT,
  ...PROTOKOLL,
  ...KONTAKT_ADRESSE,
  ...SELBST_UPDATE,
  ...NACHHALTIGKEIT,
  ...BESTAND,
  ...MODELCHECK_VERGLEICH,
  ...GESAMTEXPORT,
  ...ZEIT_HONORAR_FUNDAMENT,
  ...ZEIT_ERFASSUNG,
  ...ZEIT_CONTROLLING,
  ...HONORAR_ANGEBOTE,
  ...HONORAR_RECHNER,
  ...HONORAR_VERTRAEGE,
  ...HONORAR_NACHTRAEGE,
  ...ZEIT_HONORAR_ABSCHLUSS,
  ...BUERO_ORGA_FUNDAMENT,
  ...RECHTE,
  ...FRISTEN,
  ...ABWESENHEITEN,
  ...SCHRIFTVERKEHR,
  ...MEINE_WOCHE,
  ...LISTEN_FENSTER,
  ...BEFUND_ABSCHNITT,
  ...IFC_ATTRIBUTE,
  ...DESKTOP_CLIENT,
  ...ZUGANG_RECHT,
  ...BIETER_PORTAL,
  ...VERGABE_ZUGRIFF,
  ...AVA_KG_RUECKBAU,
  ...NACHWEIS_HAERTUNG,
  ...BAUTEIL_STATUS,
  ...SPEICHER_WAHRHEIT,
  ...ZEITSTRAHL,
  ...SKIZZE,
  ...ENERGIE_SCREENING,
  ...NACHTRAG_PRUEFPFAD,
  ...AVA_KOSTENSTAENDE,
  ...WERKPLANUNG_PLAENE,
  ...WERKPLANUNG_DURCHBRUECHE,
  ...WERKPLANUNG_BEMUSTERUNG,
  ...MACHBARKEIT_KENNZAHLEN,
  ...WERKPLANUNG_SIGE,
  ...BAUABLAUF,
  ...WERKSTATT_INNENWAENDE,
  ...WERKSTATT_RANDBEBAUUNG,
  ...MASSING_ACHSE,
  ...WERKSTATT_ADERN,
  ...WERKSTATT_BEWERTUNG,
  ...BAUTEILE_WERKSTATT,
  ...EINE_WAHRHEIT,
  ...WERKPLANUNG_BAUTAGEBUCH,
  ...WERKPLANUNG_GENEHMIGUNGEN,
  ...PROJEKTAKTE_FOKUS,
  ...BUERO_MODUS,
  ...BUCHHALTUNG_XRECHNUNG,
  ...AUTO_SICHERUNG,
  ...KI_LOKAL,
  ...DATEI_OEFFNEN,
  ...APP_MODUS,
  ...A11Y_NAMEN,
  ...ABNAHME_94,
  ...VOB_MENGEN_96,
  ...KOSTENDRIFT_96,
});
