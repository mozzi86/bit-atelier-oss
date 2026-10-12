// Team calendar model (phase 82, 82-04, ABW-04): persons × days of a month.
// Pure. It reads only period, state and half days of an absence — NEVER its
// kind (E-14, Art. 9 DSGVO): the team calendar is the most shared view, so for
// every role, owner included, a cell says only "abwesend" or "beantragt";
// tooltips and aria labels come from this same model. Rows are labelled with
// initials (user record kuerzel, otherwise the person's initials, D-P82-41).
//
// In:  persons, absences, year/month, holidays, initials. Out: teamRaster, monatsSumme, kuerzelVon.

/** @param {number} jahr @param {number} monat 1–12 @returns {string[]} days 'YYYY-MM-DD' */
function tageDesMonats(jahr, monat) {
  const n = new Date(Date.UTC(jahr, monat, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${jahr}-${String(monat).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`);
}

/**
 * Initials of a person: the linked user's kuerzel, otherwise from the name.
 * @param {Record<string, any>} person
 * @param {ReadonlyArray<Record<string, any>>} [nutzer]
 * @returns {string}
 */
export function kuerzelVon(person, nutzer = []) {
  const n = (nutzer || []).find((x) => x?.mitarbeiter_id === person?.id && x.kuerzel);
  if (n) return String(n.kuerzel);
  const teile = [person?.vorname, person?.nachname].filter(Boolean).map((x) => String(x)[0].toUpperCase());
  return teile.join("") || String(person?.id || "?").slice(0, 3).toUpperCase();
}

/**
 * One cell: display state ('wochenende'/'feiertag' first, then the absence) and half day.
 * @typedef {{datum: string, zustand: 'abwesend'|'beantragt'|'feiertag'|'wochenende'|null, halb: boolean}} RasterZelle
 */

/**
 * @param {ReadonlyArray<Record<string, any>>} personen persons (81 personenFuerZeiterfassung)
 * @param {ReadonlyArray<Record<string, any>>} abwesenheiten
 * @param {number} jahr
 * @param {number} monat 1–12
 * @param {ReadonlyArray<{datum: string}>} feiertage
 * @param {{nutzer?: ReadonlyArray<Record<string, any>>}} [optionen]
 * @returns {{tage: Array<{datum: string, wochenende: boolean, feiertag: boolean}>, zeilen: Array<{id: string, kuerzel: string, zellen: RasterZelle[]}>}}
 */
export function teamRaster(personen, abwesenheiten, jahr, monat, feiertage, { nutzer = [] } = {}) {
  const tage = tageDesMonats(jahr, monat).map((datum) => {
    const w = new Date(`${datum}T12:00:00Z`).getUTCDay();
    return { datum, wochenende: w === 0 || w === 6, feiertag: (feiertage || []).some((f) => f.datum === datum) };
  });
  const zeilen = (personen || []).map((p) => {
    // Only period, state and half days — the kind is not even read here.
    const eigene = (abwesenheiten || []).filter((a) => a?.mitarbeiter_id === p.id && (a.status === "genehmigt" || a.status === "beantragt"))
      .map((a) => ({ von: a.von, bis: a.bis || a.von, status: a.status, halbtag_von: a.halbtag_von === true, halbtag_bis: a.halbtag_bis === true }));
    const zellen = tage.map((t) => {
      /** @type {RasterZelle['zustand']} */
      let zustand = t.feiertag ? "feiertag" : t.wochenende ? "wochenende" : null;
      let halb = false;
      if (!zustand) {
        const a = eigene.find((x) => x.von <= t.datum && x.bis >= t.datum && x.status === "genehmigt") || eigene.find((x) => x.von <= t.datum && x.bis >= t.datum);
        if (a) {
          zustand = a.status === "genehmigt" ? "abwesend" : "beantragt";
          halb = (t.datum === a.von && a.halbtag_von) || (t.datum === a.bis && a.halbtag_bis);
        }
      }
      return { datum: t.datum, zustand, halb };
    });
    return { id: String(p.id), kuerzel: kuerzelVon(p, nutzer), zellen };
  });
  return { tage, zeilen };
}

/**
 * Absent working days of a person in a raster (half days count half).
 * @param {ReturnType<typeof teamRaster>} raster
 * @param {string} personId
 * @returns {number}
 */
export function monatsSumme(raster, personId) {
  const z = raster.zeilen.find((x) => x.id === personId);
  return z ? z.zellen.reduce((n, c) => n + (c.zustand === "abwesend" ? (c.halb ? 0.5 : 1) : 0), 0) : 0;
}
