// 90-08: neutral meeting-minutes module (Besprechungs-/Jour-fixe-Protokoll) — numbered minutes per project
// with participants and items (information, decision, task with responsible party, deadline and status),
// carried forward ("fortschreiben") from one meeting to the next. Council 10.10.2026
// (HANDOFF-SKILLS-INTEGRATION §3): the office skills "capmo-protokoll"/"jf-protokoll-capmo" keep minutes in a
// customer system; here a neutral module WITHOUT any link to that system. The existing one-off print form
// (Reports › Besprechungsprotokoll) stays; this module stores the minutes.
//
// D-SK-03 is open → [ASSUMED] yes to the module, output PDF + CSV (Word would need a new dependency),
// no text from transcripts (would go through the LLM function as a suggestion — separate plan).
//
// In:  stored minutes of a project (entity MeetingMinutes, new), project participants (90-07) and contacts.
// Out: pure helpers — numbering, a new or carried-forward draft, item numbering, overdue check, the
//      participant list from the project's participant list, the CSV table model.
//
// Isomorph: kein window.

/** Item kinds in print order of the legend. */
export const PUNKT_ARTEN = Object.freeze([
  { id: "info", label: "Information", kurz: "I" },
  { id: "festlegung", label: "Festlegung", kurz: "F" },
  { id: "aufgabe", label: "Aufgabe", kurz: "A" },
]);

/** Default note under the minutes [ASSUMED usual wording; editable per minutes]. */
export const HINWEIS_STANDARD = "Einwände oder Ergänzungen zu diesem Protokoll bitte innerhalb von 7 Tagen nach Zugang schriftlich mitteilen.";

const iso = (d) => new Date(d).toISOString().slice(0, 10);

/**
 * Next minutes number of a project (1-based, per title series — "Jour fixe" and "Planerbesprechung" count
 * separately [ASSUMED office practice]).
 * @param {Array<{nummer?: number, titel?: string}>} protokolle
 * @param {string} titel
 */
export function naechsteNummer(protokolle, titel) {
  const reihe = (protokolle || []).filter((p) => String(p.titel || "").trim().toLowerCase() === String(titel || "").trim().toLowerCase());
  return reihe.reduce((m, p) => Math.max(m, Number(p.nummer) || 0), 0) + 1;
}

/**
 * Empty draft.
 * @param {{projektId: string, protokolle?: Array<any>, titel?: string, teilnehmer?: Array<{name: string, firma?: string}>, jetzt?: Date}} p
 */
export function neuerEntwurf({ projektId, protokolle = [], titel = "Jour fixe", teilnehmer = [], jetzt = new Date() }) {
  return {
    project_id: projektId, titel, nummer: naechsteNummer(protokolle, titel), datum: iso(jetzt), ort: "",
    teilnehmer: teilnehmer.map((t) => ({ name: String(t.name || ""), firma: String(t.firma || ""), anwesend: true })),
    punkte: [], naechster_termin: "", verteiler: "", hinweis: HINWEIS_STANDARD, fortgeschrieben_aus: null,
  };
}

/**
 * Carry the minutes forward: same title and participants (all present again), number + 1, date today,
 * every OPEN task taken over with its origin; information, decisions and done tasks stay in the old
 * minutes [ASSUMED usual practice — decisions are documented once].
 * @param {any} vorgaenger
 * @param {{protokolle?: Array<any>, jetzt?: Date}} [o]
 */
export function fortschreiben(vorgaenger, { protokolle = [], jetzt = new Date() } = {}) {
  const neu = neuerEntwurf({ projektId: vorgaenger.project_id, protokolle: protokolle.length ? protokolle : [vorgaenger], titel: vorgaenger.titel, teilnehmer: vorgaenger.teilnehmer || [], jetzt });
  neu.ort = String(vorgaenger.ort || "");
  neu.verteiler = String(vorgaenger.verteiler || "");
  neu.hinweis = String(vorgaenger.hinweis || HINWEIS_STANDARD);
  neu.fortgeschrieben_aus = vorgaenger.id || null;
  neu.punkte = (vorgaenger.punkte || []).filter((p) => p.art === "aufgabe" && p.status !== "erledigt")
    .map((p) => ({ ...p, herkunft: p.herkunft ?? vorgaenger.nummer }));
  return neu;
}

/**
 * Item numbers "<minutes no.>.<running no.>" for new items, carried items keep "<origin>.<n>" as reference.
 * @param {any} protokoll
 * @returns {string[]} one number per item, same order
 */
export function punktNummern(protokoll) {
  let lfd = 0;
  const neuNr = Number(protokoll.nummer) || 0;
  return (protokoll.punkte || []).map((p) => {
    lfd += 1;
    return p.herkunft && Number(p.herkunft) !== neuNr ? `${neuNr}.${lfd} (aus ${p.herkunft})` : `${neuNr}.${lfd}`;
  });
}

/**
 * Is a task overdue on `heute` (open, with a deadline before today)?
 * @param {{art?: string, status?: string, frist?: string|null}} punkt
 * @param {Date} [heute]
 */
export function ueberfaellig(punkt, heute = new Date()) {
  return punkt.art === "aufgabe" && punkt.status !== "erledigt" && !!punkt.frist && String(punkt.frist).slice(0, 10) < iso(heute);
}

/** Open tasks of a minutes record. */
export function offenePunkte(protokoll) {
  return (protokoll.punkte || []).filter((p) => p.art === "aufgabe" && p.status !== "erledigt");
}

/**
 * Participants from the project's participant list (90-07): name + company of every contact on it.
 * @param {Array<{contact_id: string}>} beteiligte project.beteiligte
 * @param {Array<{id: string, name?: string, company?: string}>} kontakte
 */
export function teilnehmerAusBeteiligten(beteiligte, kontakte) {
  const jeId = new Map((kontakte || []).map((c) => [c.id, c]));
  const gesehen = new Set();
  const out = [];
  for (const b of beteiligte || []) {
    const c = jeId.get(b.contact_id);
    if (!c || gesehen.has(c.id)) continue;
    gesehen.add(c.id);
    out.push({ name: String(c.name || ""), firma: String(c.company || "") });
  }
  return out;
}

/**
 * CSV/XLSX table model of the items (for @core/lib/tabellenExport).
 * @param {any} protokoll
 */
export function punkteTabelle(protokoll) {
  const nr = punktNummern(protokoll);
  const art = Object.fromEntries(PUNKT_ARTEN.map((a) => [a.id, a.label]));
  return {
    titel: `Protokoll ${protokoll.nummer}`,
    spalten: [
      { key: "nr", label: "Nr.", typ: "text", breite: 12 }, { key: "art", label: "Art", typ: "text", breite: 12 },
      { key: "thema", label: "Thema", typ: "text", breite: 30 }, { key: "text", label: "Inhalt", typ: "text", breite: 60 },
      { key: "zustaendig", label: "Zuständig", typ: "text", breite: 20 }, { key: "frist", label: "Frist", typ: "datum" },
      { key: "status", label: "Status", typ: "text", breite: 10 },
    ],
    zeilen: (protokoll.punkte || []).map((p, i) => ({
      nr: nr[i], art: art[p.art] || p.art, thema: p.thema || "", text: p.text || "", zustaendig: p.zustaendig || "",
      frist: p.frist ? String(p.frist).slice(0, 10) : "", status: p.art === "aufgabe" ? (p.status === "erledigt" ? "erledigt" : "offen") : "",
    })),
  };
}
