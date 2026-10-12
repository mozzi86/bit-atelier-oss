// "Meine Woche" (phase 82, 82-06, FRIST-05): the pure model of the dashboard
// card for Monday morning — what is due, this week's deadlines (at most five),
// the own hours against the target, how many in the team are absent this week,
// how many requests are open, how much incoming mail waits with a deadline.
//
// One way of computing: gruppiere / zaehleFaellige / filterNachZugriff (82-03)
// for the terms, 81's sollIst (with 82-04's absences) for the hours. Privacy
// (80, DS-07; E-14): the result carries no names, no initials and no kinds of
// absence — absent persons are only counted. A block the role may not read (or
// a cloud-locked module, E-03) is null and is left out by the card. Without any
// user or person record (sole owner, E-17) "Abwesend im Team" and "Offene
// Anträge" are null; the hours belong to the virtual owner against
// zeit_honorar.tagessoll.
//
// In:  loaded terms, Zugriff, today, bookings, contract, holidays, absences,
//      assignments. Out: meineWoche, stundenDerWoche.

import { isoWoche } from "@core/lib/kalender/datum.js";
import { darf } from "@core/lib/rechte.js";
import { filterNachZugriff, gruppiere, zaehleFaellige } from "@/lib/termine/termineAnsicht.js";
import { sollIst } from "@/lib/zeit/zeitAnsicht.js";
import { entscheidbarePersonen } from "@/lib/abwesenheit/abwesenheitRechte.js";

/** @param {string} tag @param {number} n @returns {string} */
function plus(tag, n) {
  const d = new Date(`${tag}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** @param {string} tag @returns {string} Monday of the week */
function montag(tag) {
  const w = new Date(`${tag}T12:00:00Z`).getUTCDay();
  return plus(tag, -((w + 6) % 7));
}

/**
 * Own hours of the ISO week of `heute`: actual minutes from the bookings, target
 * through 81's sollIst (contract or daily target; holidays; approved absences, 82-04).
 * @param {{personId: string, buchungen: ReadonlyArray<any>, vertrag?: any, feiertage: ReadonlyArray<{datum: string}>,
 *   tagessollMinuten: number, abwesenheiten?: ReadonlyArray<any>, heute: string}} e
 * @returns {{istMinuten: number, sollMinuten: number}}
 */
export function stundenDerWoche({ personId, buchungen, vertrag = null, feiertage, tagessollMinuten, abwesenheiten = [], heute }) {
  const kw = /** @type {{jahr: number, woche: number}} */ (isoWoche(heute));
  const mo = montag(heute);
  const istMinuten = Array.from({ length: 7 }, (_, i) => (buchungen || [])
    .filter((b) => b?.mitarbeiter_id === personId && b.datum === plus(mo, i))
    .reduce((s, b) => s + (Number(b.minuten) || 0), 0));
  const eigene = (abwesenheiten || []).filter((a) => a?.mitarbeiter_id === personId);
  const si = sollIst(kw, { vertrag, feiertage, tagessollMinuten, istMinuten, abwesenheiten: eigene });
  return { istMinuten: si.ist, sollMinuten: si.soll };
}

/**
 * @param {{
 *   termine: ReadonlyArray<import("@core/lib/kalender/termin.js").Termin>, zugriff: any, heute: string,
 *   stunden?: {istMinuten: number, sollMinuten: number}|null,
 *   abwesenheiten?: ReadonlyArray<Record<string, any>>, zuordnungen?: ReadonlyArray<any>, solo?: boolean,
 * }} e
 *   abwesenheiten: the adapter data (82-01, all states); solo: no user and no person record (E-17)
 * @returns {{
 *   faellig: number, dieseWoche: import("@core/lib/kalender/termin.js").Termin[],
 *   stunden: {istMinuten: number, sollMinuten: number}|null,
 *   abwesendDieseWoche: number|null, offeneAntraege: number|null, posteingangFrist: number|null,
 * }}
 */
export function meineWoche({ termine, zugriff, heute, stunden = null, abwesenheiten = [], zuordnungen = [], solo = false }) {
  const erlaubt = filterNachZugriff(termine || [], zugriff);
  const g = gruppiere(erlaubt, heute);
  const dieseWoche = [...g.heute, ...g.diese_woche].slice(0, 5);
  const mo = montag(heute);
  const so = plus(mo, 6);

  let abwesendDieseWoche = null;
  let offeneAntraege = null;
  if (!solo && darf(zugriff, "abwesenheiten")) {
    const personen = new Set((abwesenheiten || [])
      .filter((a) => a?.status === "genehmigt" && a.von <= so && (a.bis || a.von) >= mo)
      .map((a) => a.mitarbeiter_id));
    abwesendDieseWoche = personen.size;
    const beantragt = (abwesenheiten || []).filter((a) => a?.status === "beantragt");
    if (darf(zugriff, "personal") || zugriff?.rolle === "inhaber") offeneAntraege = beantragt.length;
    else if (zugriff?.rolle === "projektleitung") {
      const ent = entscheidbarePersonen(zugriff, zuordnungen);
      offeneAntraege = beantragt.filter((a) => ent.has(a.mitarbeiter_id)).length;
    } else offeneAntraege = beantragt.filter((a) => zugriff?.mitarbeiterId && a.mitarbeiter_id === zugriff.mitarbeiterId).length;
  }
  const posteingangFrist = darf(zugriff, "schriftverkehr") ? erlaubt.filter((t) => t.quelle === "postbuch" && !t.erledigt).length : null;
  return {
    faellig: zaehleFaellige(erlaubt, heute),
    dieseWoche,
    stunden: darf(zugriff, "zeiterfassung") ? stunden : null,
    abwesendDieseWoche,
    offeneAntraege,
    posteingangFrist,
  };
}
