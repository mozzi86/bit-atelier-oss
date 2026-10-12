// Working-day frame of the time tracking (phase 81-02, ZEIT-06, E-15): begin,
// end and break of one person on one day (entity Arbeitszeit, optional, rule
// zeit_honorar.tagesrahmen) and the hints of the Working Hours Act (ArbZG).
//
// Every hint is a WARNING, never a block: the app is no working-time record with
// legal review (the page says so in its subtitle, "Hinweise ersetzen keine
// Rechtsprüfung"); exceptions of collective agreements (§ 7 ArbZG), averaging
// over six months (§ 3 S. 2) and the person's status (owners are not employees,
// § 2 Abs. 2) are not evaluated. A wrong block would stop a legitimate entry —
// a liability decision, not a programming one.
//
// Arbeitszeit record: {mitarbeiter_id, datum, beginn 'HH:MM', ende 'HH:MM',
// pause_minuten, notiz} — one per person and day.
//
// In:  the frame of a day, the end of the previous day, the booked project
//      minutes. Out: net minutes and hints {regel, text, werte} (text = German
//      i18n key with {platzhalter}).

/**
 * @param {string|null|undefined} hhmm 'HH:MM'
 * @returns {number|null} minutes after midnight
 */
export function minutenVon(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/**
 * Net working minutes and the ArbZG hints of one day.
 * - § 3 ArbZG: more than 10 hours of work per working day.
 * - § 4 ArbZG: break at least 30 minutes above 6 hours, 45 minutes above 9 hours.
 * - § 5 ArbZG: at least 11 hours of rest between the end of the previous day and the begin.
 * - project hours above the frame (data plausibility, no norm).
 * @param {{beginn: string, ende: string, pause_minuten?: number}} rahmen
 * @param {{vortagEnde?: string|null, projektMinuten?: number}} [kontext] vortagEnde 'HH:MM' of the previous day
 * @returns {{netto_minuten: number|null, hinweise: Array<{regel: string, text: string, werte: Record<string, string|number>}>}}
 */
export function pruefeTagesrahmen({ beginn, ende, pause_minuten = 0 }, { vortagEnde = null, projektMinuten = 0 } = {}) {
  const b = minutenVon(beginn);
  const e = minutenVon(ende);
  /** @type {Array<{regel: string, text: string, werte: Record<string, string|number>}>} */
  const hinweise = [];
  if (b === null || e === null) return { netto_minuten: null, hinweise: [{ regel: "format", text: "Beginn und Ende bitte als HH:MM eingeben.", werte: {} }] };
  if (e <= b) return { netto_minuten: null, hinweise: [{ regel: "reihenfolge", text: "Das Ende liegt vor dem Beginn.", werte: {} }] };
  const pause = Math.max(0, Number(pause_minuten) || 0);
  const netto = Math.max(0, e - b - pause);
  if (netto > 600) hinweise.push({ regel: "arbzg_3", text: "§ 3 ArbZG: mehr als 10 Stunden Arbeitszeit ({stunden} h).", werte: { stunden: stundenText(netto) } });
  if (netto > 540 && pause < 45) hinweise.push({ regel: "arbzg_4", text: "§ 4 ArbZG: über 9 Stunden Arbeit brauchen mindestens 45 Minuten Pause.", werte: {} });
  else if (netto > 360 && pause < 30) hinweise.push({ regel: "arbzg_4", text: "§ 4 ArbZG: über 6 Stunden Arbeit brauchen mindestens 30 Minuten Pause.", werte: {} });
  const v = minutenVon(vortagEnde);
  if (v !== null) {
    const ruhe = 24 * 60 - v + b;
    if (ruhe < 660) hinweise.push({ regel: "arbzg_5", text: "§ 5 ArbZG: nur {stunden} h Ruhezeit seit dem Vortag (mindestens 11 h).", werte: { stunden: stundenText(ruhe) } });
  }
  if (Number(projektMinuten) > netto) hinweise.push({ regel: "projektzeit", text: "Projektzeiten übersteigen den Tagesrahmen.", werte: {} });
  return { netto_minuten: netto, hinweise };
}

/**
 * Hours with a decimal comma for the hint texts (670 → "11,17").
 * @param {number} minuten
 * @returns {string}
 */
function stundenText(minuten) {
  return (Math.round((minuten / 60) * 100) / 100).toString().replace(".", ",");
}
