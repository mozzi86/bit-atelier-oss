// loeschlauf.js — der Löschlauf (Plan 80-10, Task 2): findet fällige
// Löschungen von selbst (loeschVorschlaege) und führt einen Plan aus
// (fuehrePlanAus) — löscht, macht bei Bedarf einen Grabstein aus dem
// Mitarbeiter (per Ersetzen, nicht Mischen) und schreibt genau EIN
// namenloses Löschprotokoll je Lauf.
//
// In:  die neun Personal-Sammlungen, ein Stichtag 'YYYY-MM-DD', ein
//      regelWert-Leser, ein Plan aus auskunft.js loeschPlan(), ein API-Objekt
//      mit derselben Form wie bitApi.personal ({<Entität>: {get, create,
//      delete}, dateien: {delete}}).
// Out: loeschVorschlaege, fuehrePlanAus.

import { loeschPlan } from "./auskunft.js";
import { loeschenAb } from "./bewerbung.js";
import { plusMonate } from "@core/lib/kalender/datum.js";

/**
 * @param {unknown} tagIso
 * @param {number} jahre
 * @returns {string|null}
 */
function plusJahre(tagIso, jahre) {
  return typeof tagIso === "string" ? plusMonate(tagIso, jahre * 12) : null;
}

/**
 * Ein Löschvorschlag: das Subjekt (falls vorhanden), der Anlass und der
 * bereits berechnete Plan (loeschPlan()-Form, oder eine gleichwertige
 * {loeschen, sperren, grabstein}-Form für das Löschprotokoll selbst).
 * @typedef {{
 *   subjekt: {mitarbeiterId: string}|{bewerbungId: string}|null,
 *   anlass: string,
 *   beschriftung: {kennung: string, tab: string},
 *   plan: {loeschen: Array<{entitaet: string, id: string}>, sperren: Array<{entitaet: string, id: string, bis: string, grund: string, norm: string}>, grabstein: boolean},
 * }} Loeschvorschlag
 */

/**
 * Alle fälligen Löschvorschläge, ohne dass irgendetwas ausgeführt wird
 * (`fuehrePlanAus` macht das getrennt, nach Rückfrage — Task 5). Drei
 * Quellen:
 * 1. Bewerbungen, deren DSGVO-Frist (bewerbung.js loeschenAb, berücksichtigt
 *    bereits einen gültigen Talentpool) bereits abgelaufen ist.
 * 2. Ausgeschiedene (Status 'ausgeschieden' — der Austritt selbst — oder
 *    bereits 'gesperrt' — ein Grabstein aus einem früheren Lauf, dessen
 *    Sperren inzwischen ausgelaufen sein können) mit noch etwas zu tun:
 *    loeschPlan liefert dafür entweder die erste Sperrung (nach dem Austritt)
 *    oder, sobald alle bisherigen Sperren abgelaufen sind, die endgültige
 *    Löschung der Restzeilen.
 * 3. Löschprotokolle, die älter als personal.aufbewahrung_loeschprotokoll_jahre
 *    sind (Art. 5 Abs. 2 DSGVO — auch das Protokoll selbst hat eine Frist).
 * @param {Record<string, object[]>} daten die neun Personal-Sammlungen
 * @param {string} heute 'YYYY-MM-DD'
 * @param {(id: string, stichtag?: string) => any} regelWert liest personal.aufbewahrung_*
 * @returns {Loeschvorschlag[]}
 */
export function loeschVorschlaege(daten, heute, regelWert) {
  /** @type {Loeschvorschlag[]} */
  const vorschlaege = [];

  // 1. Bewerbungen mit abgelaufener Frist (Talentpool bereits eingerechnet).
  for (const b of Array.isArray(daten?.Bewerbung) ? daten.Bewerbung : []) {
    const ab = loeschenAb(b, regelWert);
    if (typeof ab === "string" && ab < heute) {
      vorschlaege.push({
        subjekt: { bewerbungId: b.id },
        anlass: "frist",
        beschriftung: { kennung: b.id, tab: "recruiting" },
        plan: loeschPlan({ bewerbungId: b.id }, "frist", daten, heute, regelWert),
      });
    }
  }

  // 2. Ausgeschiedene mit offener Aufgabe (erste Sperrung ODER, sobald jede
  //    Sperre abgelaufen ist, die endgültige Löschung des Rests).
  for (const m of Array.isArray(daten?.Mitarbeiter) ? daten.Mitarbeiter : []) {
    if (m?.status !== "ausgeschieden" && m?.status !== "gesperrt") continue;
    const plan = loeschPlan({ mitarbeiterId: m.id }, m.status === "gesperrt" ? "frist_ablauf" : "austritt", daten, heute, regelWert);
    if (plan.loeschen.length === 0 && plan.sperren.length === 0) continue; // schon vollständig bereinigt
    // Ein bereits gesperrter (Grabstein-)Datensatz braucht nur dann einen
    // neuen Lauf, wenn wirklich etwas zu LÖSCHEN übrig ist — eine unveränderte
    // Sperrung erzeugt sonst bei jedem Aufruf denselben Vorschlag erneut.
    if (m.status === "gesperrt" && plan.loeschen.length === 0) continue;
    vorschlaege.push({
      subjekt: { mitarbeiterId: m.id },
      anlass: m.status === "gesperrt" ? "frist_ablauf" : "austritt",
      beschriftung: { kennung: m.personalnummer || m.id, tab: "staff" },
      plan,
    });
  }

  // 3. Löschprotokolle, die ihre eigene Aufbewahrungsfrist überschritten haben.
  const protokollJahre = Number(typeof regelWert === "function" ? regelWert("personal.aufbewahrung_loeschprotokoll_jahre") : 0) || 0;
  for (const p of Array.isArray(daten?.Loeschprotokoll) ? daten.Loeschprotokoll : []) {
    const bis = plusJahre(p?.am, protokollJahre);
    if (typeof bis === "string" && bis < heute) {
      vorschlaege.push({
        subjekt: null,
        anlass: "loeschprotokoll_frist",
        beschriftung: { kennung: p.id, tab: "staff" },
        plan: { loeschen: [{ entitaet: "Loeschprotokoll", id: p.id }], sperren: [], grabstein: false },
      });
    }
  }

  return vorschlaege;
}

/**
 * Führt einen Plan aus: löscht jede Zeile aus `plan.loeschen` (Personaldokument-
 * Inhalte zusätzlich über `api.dateien.delete`), macht bei `plan.grabstein` aus
 * dem Mitarbeiter EINEN namenlosen Stumpf — per Löschen+Neuanlegen mit
 * derselben ID, nicht per Update, damit wirklich ALLE übrigen Felder
 * verschwinden (ein Update würde nur überschreiben, nicht entfernen) — und
 * schreibt am Ende genau EIN `Loeschprotokoll` ohne Namen, E-Mail oder
 * Freitext.
 *
 * Bricht ein Schritt mit einem Fehler ab, wirft diese Funktion weiter, hängt
 * aber `erledigt` (die Liste der bereits ausgeführten Schritte) an den Fehler
 * — der Aufrufer kann so ehrlich berichten, was schon geschehen ist, ohne den
 * Lauf stillschweigend zu wiederholen.
 * @param {{loeschen: Array<{entitaet: string, id: string}>, sperren: Array<{entitaet: string, id: string, bis: string, grund: string, norm: string}>, grabstein: boolean, mitarbeiterId?: string, bewerbungId?: string}} plan
 * @param {Record<string, {get: (id: string) => Promise<any>, create: (data: object) => Promise<any>, delete: (id: string) => Promise<any>}> & {dateien: {delete: (id: string) => Promise<any>}}} api dieselbe Form wie bitApi.personal
 * @param {string} anlass z. B. 'antrag_art17', 'austritt', 'frist', 'frist_ablauf'
 * @param {string} heute 'YYYY-MM-DD'
 * @returns {Promise<{erledigt: Array<{entitaet: string, id: string}>, protokoll: object}>}
 */
export async function fuehrePlanAus(plan, api, anlass, heute) {
  /** @type {Array<{entitaet: string, id: string}>} */
  const erledigt = [];
  try {
    for (const { entitaet, id } of plan.loeschen) {
      if (entitaet === "Personaldokument") {
        const dok = await api.Personaldokument.get(id);
        if (dok?.datei_ref) await api.dateien.delete(dok.datei_ref);
      }
      await api[entitaet].delete(id);
      erledigt.push({ entitaet, id });
    }

    if (plan.grabstein && plan.mitarbeiterId) {
      const bisher = await api.Mitarbeiter.get(plan.mitarbeiterId);
      const gesperrtBis = plan.sperren.reduce((max, s) => (s.bis > max ? s.bis : max), "");
      const grund = [...new Set(plan.sperren.map((s) => s.grund))].join("; ");
      await api.Mitarbeiter.delete(plan.mitarbeiterId);
      // Neuanlage MIT derselben ID statt Update: personalDb.create() übernimmt
      // eine mitgegebene `id` (sie steht nach dem `...data`-Spread in der
      // Objektliteral-Reihenfolge) und erzeugt so einen echten Ersatz — kein
      // Feld des alten Datensatzes bleibt übrig, anders als bei einem Update,
      // das nur überschreibt, was mitgegeben wird (Task-2-Vorgabe "per
      // Ersetzen, nicht per Mischen").
      await api.Mitarbeiter.create({
        id: plan.mitarbeiterId,
        personalnummer: bisher?.personalnummer ?? null,
        status: "gesperrt",
        sperre: { gesperrt_bis: gesperrtBis || heute, grund, anonymisiert_am: heute },
      });
      erledigt.push({ entitaet: "Mitarbeiter", id: plan.mitarbeiterId });
    }

    /** @type {Record<string, number>} */
    const umfang = {};
    for (const e of erledigt) umfang[e.entitaet] = (umfang[e.entitaet] || 0) + 1;
    const datensatzId = plan.mitarbeiterId ?? plan.bewerbungId ?? erledigt[0]?.id ?? "unbekannt";
    const protokoll = await api.Loeschprotokoll.create({
      am: heute,
      entitaet: plan.grabstein ? "Mitarbeiter" : (erledigt[0]?.entitaet ?? "unbekannt"),
      datensatz_id: datensatzId,
      anlass,
      umfang,
    });
    return { erledigt, protokoll };
  } catch (fehlerUrsprung) {
    const meldung = /** @type {any} */ (fehlerUrsprung)?.message || String(fehlerUrsprung);
    const fehler = new Error(`Löschlauf teilweise ausgeführt (${erledigt.length} Schritte erledigt): ${meldung}`);
    /** @type {any} */ (fehler).erledigt = erledigt;
    /** @type {any} */ (fehler).ursprung = fehlerUrsprung;
    throw fehler;
  }
}
