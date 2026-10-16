// "Problem melden" (94-08, register 172 — no way back from a user to the
// developer). Builds a GitHub issue from a short diagnostics bundle: app
// version, page, browser, data source and the tail of the local logs. The
// user sees the full text before anything happens and submits it on GitHub
// themselves — nothing is sent from the app.
//
// No project data: only the page PATH (the query may carry project ids), the
// logs are cleaned of user folders, e-mail addresses and query strings, and
// the whole text is capped so the prefilled GitHub URL stays usable.
//
// In:  plain values (version, path, user agent, log lines). Out: text and URL;
//      no I/O.

import { ISSUES_URL } from "@core/lib/projektInfo";

/** Longest log excerpt that goes into the issue (lines, newest last). */
export const MAX_PROTOKOLL_ZEILEN = 40;

/** Upper bound for the encoded issue body — GitHub and browsers cut long URLs (~8 KB). */
const MAX_URL_ZEICHEN = 7000;

/**
 * Removes personal traces from a log text: Windows and Unix user folders, e-mail
 * addresses and URL query strings (they may carry project ids or tokens).
 * @param {string} text raw log text
 * @returns {string} cleaned text
 */
export function bereinige(text) {
  return String(text || "")
    .replace(/([A-Za-z]:[\\/]+Users[\\/]+)[^\\/\r\n]+/gi, "$1…")
    .replace(/(\/(?:home|Users)\/)[^/\s]+/g, "$1…")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "…@…")
    .replace(/(https?:\/\/[^\s?#]+)\?[^\s#]*/g, "$1?…");
}

/**
 * Markdown body of the issue.
 * @param {{version: string, pfad: string, browser: string, datenquelle: string, protokoll?: string[], beschreibung?: string}} d
 *   pfad: location.pathname (no query); protokoll: log lines, oldest first
 * @returns {string}
 */
export function issueText({ version, pfad, browser, datenquelle, protokoll = [], beschreibung = "" }) {
  const zeilen = protokoll.slice(-MAX_PROTOKOLL_ZEILEN).map(bereinige);
  return [
    "## Was ist passiert?",
    beschreibung.trim() || "<!-- Bitte kurz beschreiben: Was haben Sie getan, was haben Sie erwartet, was kam stattdessen? -->",
    "",
    "## Umgebung",
    `- Version: ${version}`,
    `- Seite: ${String(pfad || "/").split(/[?#]/)[0]}`,
    `- Datenquelle: ${datenquelle}`,
    `- Browser: ${bereinige(browser)}`,
    "",
    "## Protokoll (letzte Zeilen, bereinigt)",
    zeilen.length ? "```\n" + zeilen.join("\n") + "\n```" : "_kein Protokoll verfügbar_",
    "",
    "_Erstellt mit „Problem melden“ in BIT-Atelier. Enthält keine Projektdaten._",
  ].join("\n");
}

/**
 * GitHub "new issue" URL with title and body. Drops the oldest log lines
 * until the encoded URL fits the length limit.
 * @param {{titel?: string} & Parameters<typeof issueText>[0]} d
 * @returns {string} absolute URL
 */
export function issueUrl(d) {
  const titel = String(d.titel || "").trim() || `Problem in ${String(d.pfad || "/").split(/[?#]/)[0]} (${d.version})`;
  let protokoll = (d.protokoll || []).slice(-MAX_PROTOKOLL_ZEILEN);
  for (;;) {
    const url = `${ISSUES_URL}/new?title=${encodeURIComponent(titel)}&body=${encodeURIComponent(issueText({ ...d, protokoll }))}`;
    if (url.length <= MAX_URL_ZEICHEN || !protokoll.length) return url;
    protokoll = protokoll.slice(Math.max(1, Math.ceil(protokoll.length / 4)));
  }
}
