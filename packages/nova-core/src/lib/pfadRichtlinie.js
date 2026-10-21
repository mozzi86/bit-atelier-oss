// pfadRichtlinie.js — the ONE rule for file paths and document references that come from outside (plan 104-10).
//
// Why: BIT-Atelier opens, reads and writes files on this computer from several places — the .bitproj launcher
// and save back (server/dateiOeffnenRouter.js, tools/datei-oeffnen.mjs, the desktop shell src/client/
// dateiHuelle.js), the backup target (server/sicherung.js), the IFC test route and "Ordner öffnen"
// (server/systemRouter.js). Each checked "absolute + extension" on its own; none refused a network path.
// A UNC path (\\server\share\x.bitproj) or a file: URL with a host makes Windows connect to that server and
// send the user's NTLM credentials before any file is read; device paths (\\.\COM1, \\?\GLOBALROOT, NUL,
// /dev/zero) block or never end; "C:foo" silently means "foo in the current folder of drive C"; a scheme
// like javascript: or data: in a document reference runs code in the app's origin when it is opened.
//
// Rule: allowed are only
//   - absolute local paths: Windows "C:\…" / "C:/…", POSIX "/…";
//   - file: URLs without a host (file:///C:/…, file:/home/…; "localhost" counts as no host, RFC 8089 §2).
// Refused, each with its own plain-text German reason (PFAD_MELDUNGEN; English in i18nTeile/pfad-richtlinie.js):
//   empty / too long, control or invisible characters, other URL schemes (http, smb, javascript, data …),
//   file: URLs with a host, UNC paths (\\server\share, //server/share), device and namespace paths
//   (\\?\, \\.\, \??\, /dev, /proc, /sys), Windows device names (CON, NUL, COM1, LPT1 …) in any component,
//   characters Windows forbids in names (< > : " | ? *, so also alternate data streams "x:stream"), names
//   ending in a dot or a space, drive-relative "C:foo" and drive-less "\foo" on Windows, relative paths,
//   ".." components, and — where the caller names roots — paths outside every root.
// Network paths may be allowed explicitly (netzwerkErlaubt) where the path is the operator's own
// configuration, e.g. a backup folder on a NAS; a device path never is.
//
// A second, separate check covers EMBEDDED document content the browser opens (inhaltPruefen): only data: URLs
// of an allowed media type and blob: URLs pass — never a path, a web address or javascript:.
//
// Pure module: no node: import, no DOM — the server, the launcher (Node) and the app (browser) share it.
// It inspects the TEXT of a path; links on disk (symlinks, junctions, mapped network drives) are only seen
// when the caller checks the real path again after fs.realpath (server/dateiOeffnenRouter.js does).
//
// In:  a path or URL string plus options. Out: {ok: true, pfad, art} or {ok: false, grund, meldung}.

/** Longest path accepted, characters. [ASSUMED] — same cap the launcher route had (93-10); Windows' own
 * limit with long-path support is 32 767, without it 260. */
export const MAX_PFAD_ZEICHEN = 4096;

/**
 * Reason codes of a refused path or reference.
 * @type {Readonly<Record<string, string>>}
 */
export const PFAD_GRUND = Object.freeze({
  LEER: "leer",
  ZU_LANG: "zu-lang",
  STEUERZEICHEN: "steuerzeichen",
  URL_SCHEMA: "url-schema",
  FILE_HOST: "file-host",
  URL_KODIERUNG: "url-kodierung",
  UNC: "unc",
  GERAET: "geraet",
  RESERVIERT: "reserviert",
  ZEICHEN: "zeichen",
  NAME_ENDE: "name-ende",
  LAUFWERK_RELATIV: "laufwerk-relativ",
  OHNE_LAUFWERK: "ohne-laufwerk",
  RELATIV: "relativ",
  ZURUECK: "zurueck",
  AUSSERHALB: "ausserhalb",
  INHALT_TYP: "inhalt-typ",
  INHALT_VERWEIS: "inhalt-verweis",
});

/**
 * Plain-text German message per reason (the app translates it with t(); EN in i18nTeile/pfad-richtlinie.js).
 * @type {Readonly<Record<string, string>>}
 */
export const PFAD_MELDUNGEN = Object.freeze({
  [PFAD_GRUND.LEER]: "Kein Pfad angegeben.",
  [PFAD_GRUND.ZU_LANG]: "Der Pfad ist zu lang (mehr als 4096 Zeichen).",
  [PFAD_GRUND.STEUERZEICHEN]: "Der Pfad enthält Steuer- oder unsichtbare Zeichen und wird nicht geöffnet.",
  [PFAD_GRUND.URL_SCHEMA]: "Nur lokale Pfade oder file:-Adressen sind erlaubt — Web-, Netzwerk- und Skript-Adressen (http:, smb:, javascript:, data: …) werden nicht geöffnet.",
  [PFAD_GRUND.FILE_HOST]: "Eine file:-Adresse mit Rechnernamen zeigt ins Netzwerk und wird nicht geöffnet — bitte die Datei auf ein lokales Laufwerk kopieren.",
  [PFAD_GRUND.URL_KODIERUNG]: "Die file:-Adresse ist ungültig kodiert.",
  [PFAD_GRUND.UNC]: "Netzwerkpfade (\\\\Server\\Freigabe) werden nicht geöffnet — bitte die Datei auf ein lokales Laufwerk kopieren.",
  [PFAD_GRUND.GERAET]: "Geräte- und Systempfade (\\\\?\\, \\\\.\\, /dev, /proc) werden nicht geöffnet.",
  [PFAD_GRUND.RESERVIERT]: "Der Pfad enthält einen unter Windows reservierten Gerätenamen (CON, NUL, COM1, LPT1 …).",
  [PFAD_GRUND.ZEICHEN]: "Der Pfad enthält Zeichen, die in Windows-Dateinamen nicht erlaubt sind (< > : \" | ? *).",
  [PFAD_GRUND.NAME_ENDE]: "Ein Datei- oder Ordnername im Pfad endet auf Punkt oder Leerzeichen — Windows würde ihn still kürzen.",
  [PFAD_GRUND.LAUFWERK_RELATIV]: "Laufwerk ohne Ordnerangabe (z. B. „C:Datei“) ist mehrdeutig — bitte den vollständigen Pfad mit „C:\\“ angeben.",
  [PFAD_GRUND.OHNE_LAUFWERK]: "Der Pfad nennt kein Laufwerk — bitte den vollständigen Pfad mit Laufwerksbuchstaben angeben.",
  [PFAD_GRUND.RELATIV]: "Der Pfad muss absolut sein.",
  [PFAD_GRUND.ZURUECK]: "Pfade mit „..“ sind nicht erlaubt.",
  [PFAD_GRUND.AUSSERHALB]: "Der Pfad liegt außerhalb der erlaubten Ordner.",
  [PFAD_GRUND.INHALT_TYP]: "Dieser Dateityp wird aus Sicherheitsgründen nicht im Browser geöffnet.",
  [PFAD_GRUND.INHALT_VERWEIS]: "Das Dokument enthält keinen eingebetteten Inhalt, sondern einen Verweis, der nicht geöffnet wird.",
});

/**
 * ASCII control characters plus invisible/direction-changing Unicode that can disguise a name
 * ("rechnung‮fdp.exe" shows as "rechnungexe.pdf"). [ASSUMED] list: zero-width (U+200B–U+200F), bidi
 * embeddings/overrides (U+202A–U+202E), bidi isolates (U+2066–U+2069), BOM (U+FEFF).
 */
// eslint-disable-next-line no-control-regex -- control characters are exactly what this rule looks for
const STEUER = /[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/;

/** A URL scheme: at least two characters, so "C:" stays a drive letter (RFC 3986 §3.1). */
const SCHEMA = /^([A-Za-z][A-Za-z0-9+.-]+):/;

/** Device / namespace prefixes on Windows: \\?\  \\.\  //?/  //./  and the NT form \??\. */
const GERAET_PRAEFIX = /^(?:[\\/]{2}[?.](?:[\\/]|$)|\\\?\?\\)/;

/** POSIX trees that are devices or kernel views, not files: /dev, /proc, /sys. */
const POSIX_GERAET = /^\/+(?:dev|proc|sys)(?:\/|$)/;

/** Windows device names, reserved in every folder and with any extension ("nul.txt", "COM1 .log").
 * Source: Microsoft Learn, "Naming Files, Paths, and Namespaces" (reserved names list incl. superscript digits). */
const RESERVIERT = /^(?:con|prn|aux|nul|com[0-9\u00b9\u00b2\u00b3]|lpt[0-9\u00b9\u00b2\u00b3]|conin\$|conout\$|clock\$)$/i;

/** Characters Windows forbids inside a name (same source); ":" also stops alternate data streams. */
const WIN_VERBOTEN = /[<>:"|?*]/;

/**
 * @typedef {"win32"|"posix"|"auto"} PfadPlattform  which notation counts: "auto" (browser default) reads
 *   a drive letter or a backslash as Windows, everything else as POSIX
 * @typedef {{ok: true, pfad: string, art: "windows"|"posix"|"unc"}} PfadOk  pfad = normalised absolute path
 *   (Windows with "\", "." and doubled separators removed)
 * @typedef {{ok: false, grund: string, meldung: string}} PfadAbgewiesen  grund = one of PFAD_GRUND, meldung =
 *   German plain text for the user
 * @typedef {PfadOk|PfadAbgewiesen} PfadErgebnis
 * @typedef {{plattform?: PfadPlattform, wurzeln?: string[], netzwerkErlaubt?: boolean}} PfadOptionen
 *   wurzeln = absolute folders the path must lie in (none = anywhere); netzwerkErlaubt = accept UNC paths
 *   (only for the operator's own configuration, never for a path from a request or a file)
 */

/**
 * @param {string} grund one of PFAD_GRUND
 * @returns {PfadAbgewiesen}
 */
function nein(grund) {
  return { ok: false, grund, meldung: PFAD_MELDUNGEN[grund] };
}

/**
 * The local path inside a file: URL, or a refusal. Uses the WHATWG URL parser (global in Node and the
 * browser): it lower-cases the host, maps "localhost" to no host and treats "\" like "/".
 * @param {string} text the whole URL, scheme "file:"
 * @returns {{ok: true, pfad: string}|PfadAbgewiesen}
 */
export function dateiUrlZuPfad(text) {
  let url;
  try {
    url = new URL(text);
  } catch {
    return nein(PFAD_GRUND.URL_KODIERUNG);
  }
  if (url.protocol !== "file:") return nein(PFAD_GRUND.URL_SCHEMA);
  if (url.host && url.hostname !== "localhost") return nein(PFAD_GRUND.FILE_HOST);
  let pfad;
  try {
    pfad = decodeURIComponent(url.pathname);
  } catch {
    return nein(PFAD_GRUND.URL_KODIERUNG);
  }
  // "/C:/x" is the URL form of "C:/x" — never a sensible POSIX path.
  if (/^\/[A-Za-z]:/.test(pfad)) pfad = pfad.slice(1);
  return { ok: true, pfad };
}

/**
 * Checks one path or file: URL against the rule above.
 * @param {unknown} eingabe the path as it came in (request body, command line, stored link)
 * @param {PfadOptionen} [optionen] plattform: the notation of the machine that will use the path (the
 *   server passes process.platform); wurzeln: allowed folders; netzwerkErlaubt: accept UNC
 * @returns {PfadErgebnis} never throws
 */
export function pfadRichtlinie(eingabe, optionen = {}) {
  const { plattform = "auto", wurzeln = [], netzwerkErlaubt = false } = optionen;
  if (typeof eingabe !== "string" || eingabe === "") return nein(PFAD_GRUND.LEER);
  if (eingabe.length > MAX_PFAD_ZEICHEN) return nein(PFAD_GRUND.ZU_LANG);
  if (STEUER.test(eingabe)) return nein(PFAD_GRUND.STEUERZEICHEN);

  let pfad = eingabe;
  const schema = SCHEMA.exec(pfad);
  if (schema) {
    if (schema[1].toLowerCase() !== "file") return nein(PFAD_GRUND.URL_SCHEMA);
    const aus = dateiUrlZuPfad(pfad);
    // Casts: without strictNullChecks tsc does not narrow on the boolean `ok`.
    if (!aus.ok) return /** @type {PfadAbgewiesen} */ (aus);
    pfad = aus.pfad;
    // Percent-decoding may reveal what the raw text hid (%00, %5C%5Cserver …): check again.
    if (pfad === "") return nein(PFAD_GRUND.LEER);
    if (pfad.length > MAX_PFAD_ZEICHEN) return nein(PFAD_GRUND.ZU_LANG);
    if (STEUER.test(pfad)) return nein(PFAD_GRUND.STEUERZEICHEN);
  }

  // Device paths first: "\\?\C:\x" and "\\.\pipe\x" also start with two separators like UNC.
  if (GERAET_PRAEFIX.test(pfad)) return nein(PFAD_GRUND.GERAET);

  /** @type {"windows"|"posix"|"unc"} */
  let art;
  /** @type {string} */
  let praefix;
  /** @type {string} */
  let rest;
  if (/^[\\/]{2}/.test(pfad)) {
    // \\server\share\… or //server/share/… (on POSIX "//x" is implementation-defined, Cygwin/SMB read it as host).
    if (!netzwerkErlaubt) return nein(PFAD_GRUND.UNC);
    const teile = pfad.slice(2).split(/[\\/]/);
    if (teile.length < 2 || !teile[0] || !teile[1]) return nein(PFAD_GRUND.UNC);
    art = "unc";
    praefix = `\\\\${teile[0]}\\${teile[1]}`;
    rest = teile.slice(2).join("\\");
  } else {
    const windows = plattform === "win32" || (plattform === "auto" && (/^[A-Za-z]:/.test(pfad) || pfad.includes("\\")));
    if (windows) {
      const laufwerk = /^([A-Za-z]):(.*)$/s.exec(pfad);
      if (laufwerk) {
        if (!/^[\\/]/.test(laufwerk[2])) return nein(PFAD_GRUND.LAUFWERK_RELATIV);
        art = "windows";
        praefix = `${laufwerk[1]}:`;
        rest = laufwerk[2];
      } else if (/^[\\/]/.test(pfad)) {
        return nein(PFAD_GRUND.OHNE_LAUFWERK);
      } else {
        return nein(PFAD_GRUND.RELATIV);
      }
    } else {
      if (!pfad.startsWith("/")) return nein(PFAD_GRUND.RELATIV);
      if (POSIX_GERAET.test(pfad)) return nein(PFAD_GRUND.GERAET);
      art = "posix";
      praefix = "";
      rest = pfad;
    }
  }

  const trenner = art === "posix" ? /\/+/ : /[\\/]+/;
  const teile = [];
  for (const teil of rest.split(trenner)) {
    if (teil === "" || teil === ".") continue;
    if (teil === "..") return nein(PFAD_GRUND.ZURUECK);
    if (art !== "posix") {
      if (WIN_VERBOTEN.test(teil)) return nein(PFAD_GRUND.ZEICHEN);
      if (/[. ]$/.test(teil)) return nein(PFAD_GRUND.NAME_ENDE);
      if (RESERVIERT.test(teil.split(".")[0].replace(/ +$/, ""))) return nein(PFAD_GRUND.RESERVIERT);
    }
    teile.push(teil);
  }
  const sep = art === "posix" ? "/" : "\\";
  const normal = art === "posix" ? `/${teile.join("/")}` : `${praefix}${sep}${teile.join(sep)}`;

  if (wurzeln.length) {
    const drin = wurzeln.some((w) => {
      const wurzel = pfadRichtlinie(w, { plattform, netzwerkErlaubt: true });
      return wurzel.ok && imOrdner(normal, wurzel.pfad, art !== "posix");
    });
    if (!drin) return nein(PFAD_GRUND.AUSSERHALB);
  }
  return { ok: true, pfad: normal, art };
}

/**
 * Is a normalised path the folder itself or below it? Windows compares case-insensitively.
 * @param {string} pfad normalised absolute path (pfadRichtlinie().pfad)
 * @param {string} ordner normalised absolute folder
 * @param {boolean} windows true = "\" separators, case-insensitive
 * @returns {boolean}
 */
export function imOrdner(pfad, ordner, windows) {
  const sep = windows ? "\\" : "/";
  const a = windows ? pfad.toLowerCase() : pfad;
  let b = windows ? ordner.toLowerCase() : ordner;
  if (b.endsWith(sep)) b = b.slice(0, -1);
  return a === b || a.startsWith(b + sep) || (b === "" && a.startsWith(sep));
}

/**
 * The same check, throwing: for code paths that already report errors as exceptions.
 * @param {unknown} eingabe path or file: URL
 * @param {PfadOptionen} [optionen]
 * @returns {string} the normalised absolute path
 * @throws {Error & {grund: string}} with the German message of the reason
 */
export function pfadErzwingen(eingabe, optionen = {}) {
  const e = pfadRichtlinie(eingabe, optionen);
  if (!e.ok) {
    const abgewiesen = /** @type {PfadAbgewiesen} */ (e);
    throw Object.assign(new Error(abgewiesen.meldung), { grund: abgewiesen.grund });
  }
  return e.pfad;
}

/** Media types an embedded document may be opened as by default: PDF and raster images. SVG is left out on
 * purpose — it can carry script. */
export const INHALT_TYPEN_STANDARD = Object.freeze(["application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp"]);

/**
 * Checks EMBEDDED document content before the app puts it into an iframe, an image or a download link:
 * a data: URL of an allowed media type, or a blob: URL (created by this page). Anything else — a path,
 * file:, http:, javascript:, a data: URL of another type (text/html, image/svg+xml …) — is refused.
 * @param {unknown} wert the stored content (Document.data / Beleg.data or what inhaltLaden returned)
 * @param {{typen?: readonly string[], nurHerunterladen?: boolean}} [optionen] typen = allowed media types (lower
 *   case), default INHALT_TYPEN_STANDARD; nurHerunterladen = the value only becomes an <a download> link, which
 *   the browser saves instead of rendering — then any media type of a data: URL passes (a TIFF scan), while
 *   paths, web addresses and javascript: stay refused
 * @returns {{ok: true, url: string, typ: string}|PfadAbgewiesen} typ = media type ("" for blob:)
 */
export function inhaltPruefen(wert, optionen = {}) {
  const typen = optionen.typen || INHALT_TYPEN_STANDARD;
  if (typeof wert !== "string" || wert === "") return nein(PFAD_GRUND.LEER);
  if (/^blob:/i.test(wert)) return { ok: true, url: wert, typ: "" };
  const data = /^data:([^;,]*)((?:;[^;,]*)*),/i.exec(wert);
  if (!data) return nein(PFAD_GRUND.INHALT_VERWEIS);
  const typ = data[1].trim().toLowerCase();
  if (!optionen.nurHerunterladen && !typen.includes(typ)) return nein(PFAD_GRUND.INHALT_TYP);
  return { ok: true, url: wert, typ };
}
