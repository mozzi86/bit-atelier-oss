// Feedback links for every build (Plan 83-02) — replaces the demo-only contact
// module of the former online demo. The open-source app asks its users for feedback in
// two ways the user triggers and sees in full:
//   1. "Per E-Mail senden" — a mailto: link to FEEDBACK_EMAIL; the user's own
//      mail program opens with subject and text filled in.
//   2. "Auf GitHub melden" — the repository's "new issue" page with title and
//      body filled in through URL parameters.
// Nothing here sends anything: no fetch, no telemetry, no background request.
// The browser only leaves the app when the user clicks one of the two links.
//
// In:  the user's text, optional technical details (version, page, browser,
//      operating system — exactly what the dialog shows before sending).
// Out: plain strings (URLs, lines). `oeffneFeedback` is the one side effect: a
//      window event that asks the mounted feedback dialog to open.

import { APP_VERSION, FEEDBACK_EMAIL, ISSUES_URL } from './projektInfo.js';

/**
 * Body length cap of a mailto link, in characters. Mail programs cut long
 * mailto URLs silently at ~2,000 characters — shortening visibly is better
 * than losing text without notice (rule taken over from the former demo contact module).
 */
export const MAX_MAILTO_TEXT = 1500;

/**
 * Body length cap of the GitHub "new issue" URL, in characters. GitHub answers
 * URLs beyond ~8 KB with an error page; the encoded body grows by up to a
 * factor of three, so 2,500 raw characters stay well below that. [ASSUMED]
 */
export const MAX_ISSUE_TEXT = 2500;

/** Window event the mounted feedback dialog listens to (see oeffneFeedback). */
export const FEEDBACK_EREIGNIS = 'bit-atelier:feedback-oeffnen';

/**
 * Builds a mailto: URL.
 * @param {string} empfaenger mail address
 * @param {string} betreff subject line
 * @param {string[]} [zeilen] body lines, joined with newlines, cut at MAX_MAILTO_TEXT characters
 * @returns {string} mailto URL
 */
export function mailtoLink(empfaenger, betreff, zeilen = []) {
  const body = zeilen.join('\n').slice(0, MAX_MAILTO_TEXT);
  return `mailto:${empfaenger}?subject=${encodeURIComponent(betreff)}&body=${encodeURIComponent(body)}`;
}

/**
 * Subject of every feedback mail: "BIT-Atelier Feedback (<version>)".
 * @param {string} [version] app version, default APP_VERSION
 * @returns {string}
 */
export function feedbackBetreff(version = APP_VERSION) {
  return `BIT-Atelier Feedback (${version})`;
}

/**
 * Reads browser and operating system from a user-agent string — coarse on
 * purpose (name only, no version numbers, no device model): enough to
 * reproduce a layout bug, too little to fingerprint anyone.
 * @param {string} [userAgent] navigator.userAgent
 * @returns {{ browser: string, betriebssystem: string }} names, '—' when unknown
 */
export function erkenneUmgebung(userAgent = '') {
  const ua = String(userAgent || '');
  // Order matters: Edge and Opera carry "Chrome" too, Chrome carries "Safari".
  let browser = '—';
  if (/Edg\//.test(ua)) browser = 'Edge';
  else if (/OPR\/|Opera/.test(ua)) browser = 'Opera';
  else if (/Firefox\//.test(ua)) browser = 'Firefox';
  else if (/Chrome\/|Chromium\//.test(ua)) browser = 'Chrome';
  else if (/Safari\//.test(ua)) browser = 'Safari';

  let betriebssystem = '—';
  if (/Windows/.test(ua)) betriebssystem = 'Windows';
  else if (/Android/.test(ua)) betriebssystem = 'Android';
  else if (/iPhone|iPad|iPod/.test(ua)) betriebssystem = 'iOS';
  else if (/Mac OS X|Macintosh/.test(ua)) betriebssystem = 'macOS';
  else if (/Linux/.test(ua)) betriebssystem = 'Linux';
  return { browser, betriebssystem };
}

/**
 * The technical lines attached when the user ticks the box. Labels stay
 * German on purpose: the mail goes to the maintainer, not to the user.
 * @param {{ version?: string, seite?: string, browser?: string, betriebssystem?: string }} angaben
 * @returns {string[]} four lines "Version: …", "Seite: …", "Browser: …", "Betriebssystem: …"
 */
export function technischeZeilen({ version = APP_VERSION, seite = '', browser = '—', betriebssystem = '—' } = {}) {
  return [
    `Version: ${version}`,
    `Seite: ${seite || '—'}`,
    `Browser: ${browser}`,
    `Betriebssystem: ${betriebssystem}`,
  ];
}

/**
 * The full message: the user's text, then — only when wanted — the technical block.
 * @param {string} text what the user typed
 * @param {string[]|null} technik lines from technischeZeilen, or null when unticked
 * @returns {string[]} body lines
 */
function nachrichtZeilen(text, technik) {
  const zeilen = [String(text || '').trim()];
  if (technik && technik.length) zeilen.push('', '---', ...technik);
  return zeilen;
}

/**
 * "Per E-Mail senden": mailto link to FEEDBACK_EMAIL.
 * @param {{ text?: string, technik?: string[]|null, version?: string, empfaenger?: string }} eingabe
 * @returns {string} mailto URL
 */
export function feedbackMailto({ text = '', technik = null, version = APP_VERSION, empfaenger = FEEDBACK_EMAIL } = {}) {
  return mailtoLink(empfaenger, feedbackBetreff(version), nachrichtZeilen(text, technik));
}

/**
 * Issue title: the first line of the user's text (max. 80 characters), or the
 * mail subject when the text is empty.
 * @param {string} text
 * @param {string} [version]
 * @returns {string}
 */
export function issueTitel(text, version = APP_VERSION) {
  const ersteZeile = String(text || '').trim().split(/\r?\n/)[0].trim();
  if (!ersteZeile) return feedbackBetreff(version);
  return ersteZeile.length > 80 ? `${ersteZeile.slice(0, 79)}…` : ersteZeile;
}

/**
 * "Auf GitHub melden": the repository's new-issue page, pre-filled.
 * @param {{ text?: string, technik?: string[]|null, version?: string, issuesUrl?: string }} eingabe
 * @returns {string} https URL (ISSUES_URL/new?title=…&body=…)
 */
export function feedbackIssueUrl({ text = '', technik = null, version = APP_VERSION, issuesUrl = ISSUES_URL } = {}) {
  const body = nachrichtZeilen(text, technik).join('\n').slice(0, MAX_ISSUE_TEXT);
  return `${issuesUrl}/new?title=${encodeURIComponent(issueTitel(text, version))}&body=${encodeURIComponent(body)}`;
}

/**
 * Pre-filled text for "Befund besprechen" in the check suite: the key figures
 * of the finished run (successor of the demo's "Ergebnis besprechen" mail). The user sees
 * and edits it in the dialog before anything is sent.
 * @param {{ modell?: string, quelle?: string, bauteile?: number, geschosse?: number|null,
 *   kollisionen?: number, duplikate?: number, idsFehler?: number, paketName?: string }} [kennzahlen]
 * @param {(k: string) => string} [t] translation function (identity under node)
 * @returns {string} multi-line text
 */
export function befundText(kennzahlen = {}, t = (k) => k) {
  const {
    modell = '—', quelle = 'datei', bauteile = 0, geschosse = null,
    kollisionen = 0, duplikate = 0, idsFehler = 0, paketName = '',
  } = kennzahlen || {};
  const zeilen = [
    t('Ich möchte ein Ergebnis der Prüf-Suite besprechen.'),
    '',
    `${t('Modell')}: ${modell}${quelle === 'beispiel' ? ` (${t('Musterprojekt')})` : ''}`,
    `${t('Bauteile mit Geometrie')}: ${bauteile}`,
  ];
  if (geschosse != null) zeilen.push(`${t('Geschosse')}: ${geschosse}`);
  zeilen.push(
    `${t('Harte Kollisionen')}: ${kollisionen}`,
    `${t('Doppelmodellierungen')}: ${duplikate}`,
    `${t('IDS-Verstöße')}: ${idsFehler}`,
  );
  // mailto cannot carry attachments (finding W-03): say so instead of implying
  // the text is the deliverable.
  if (paketName) {
    zeilen.push('', t('Das Befund-Paket „{datei}“ liegt im Download-Ordner — bitte von Hand an die E-Mail anhängen.').replace('{datei}', paketName));
  }
  zeilen.push('', `${t('Meine Frage')}: `);
  return zeilen.join('\n');
}

/**
 * Asks the feedback dialog mounted in the layout to open, optionally with a
 * pre-filled text. No-op outside a browser.
 * @param {{ text?: string }} [vorbelegung]
 * @returns {void}
 */
export function oeffneFeedback(vorbelegung = {}) {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  window.dispatchEvent(new CustomEvent(FEEDBACK_EREIGNIS, { detail: { text: vorbelegung.text || '' } }));
}
