// What the office may do with a tender under access separation (Phase 74-01
// Task 14). Pure — the panel is components/VergabeZugriff.jsx, the rules in
// the database (0009/0012) decide; this only decides which buttons to SHOW,
// so nobody clicks into a refusal.
//
// Phases of a tender: ohne (no submission yet) → laeuft (deadline in the
// future) → abgelaufen (deadline passed, not opened) → geoeffnet.
//
// In:  role, submission row, now. Out: phase and allowed actions. No imports.

/**
 * @param {{ frist?: string, geoeffnet_am?: string|null } | null} submission
 * @param {Date} [jetzt]
 * @returns {'ohne'|'laeuft'|'abgelaufen'|'geoeffnet'}
 */
export function vergabePhase(submission, jetzt = new Date()) {
  if (!submission) return 'ohne';
  if (submission.geoeffnet_am) return 'geoeffnet';
  const t = Date.parse(String(submission.frist || ''));
  if (!Number.isFinite(t)) return 'ohne';
  return t > jetzt.getTime() ? 'laeuft' : 'abgelaufen';
}

/**
 * Which actions to offer. Mirrors 0009/0012: deadline, opening, award and
 * invitations are the owner's; creating the submission and releasing are
 * owner/planner; `leser` and external roles get nothing.
 * @param {{ rolle?: string, submission: any, jetzt?: Date }} k
 * @returns {{ phase: string, anlegen: boolean, fristVerschieben: boolean, freigeben: boolean,
 *   oeffnen: boolean, zuschlagPerRpc: boolean, einladen: boolean }}
 */
export function vergabeAktionen({ rolle, submission, jetzt = new Date() }) {
  const phase = vergabePhase(submission, jetzt);
  const schreibt = rolle === 'owner' || rolle === 'planner';
  const owner = rolle === 'owner';
  return {
    phase,
    anlegen: schreibt && phase === 'ohne',
    fristVerschieben: owner && phase === 'laeuft',
    freigeben: schreibt && phase !== 'ohne',
    oeffnen: owner && phase === 'abgelaufen',
    zuschlagPerRpc: owner && phase === 'geoeffnet',
    einladen: owner && (phase === 'ohne' || phase === 'laeuft'),
  };
}

/**
 * Reads a datetime-local input ('YYYY-MM-DDTHH:mm', local time) as a deadline.
 * @param {string} eingabe
 * @param {Date} [jetzt]
 * @returns {string|null} ISO string, or null when empty, invalid or not in the future
 */
export function fristAusEingabe(eingabe, jetzt = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(eingabe || ''))) return null;
  const t = new Date(String(eingabe)).getTime();
  if (!Number.isFinite(t) || t <= jetzt.getTime()) return null;
  return new Date(t).toISOString();
}

/**
 * How an award is written: through the RPC once a submission exists for the
 * tender (it may hold sealed portal bids, which no UPDATE reaches after 0011),
 * otherwise as before (Bid.update on paper bids).
 * @param {{ zugriffstrennung?: boolean, submission: any }} k
 * @returns {'rpc'|'rpc-erst-oeffnen'|'update'}
 */
export function zuschlagWeg({ zugriffstrennung, submission }) {
  if (!zugriffstrennung || !submission) return 'update';
  return submission.geoeffnet_am ? 'rpc' : 'rpc-erst-oeffnen';
}
