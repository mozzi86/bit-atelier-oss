// Content of the shortcut help "?" (plan 105-14) — built from the command registers (104-03) instead of a hand-written list.
//
// Why: the help used to read only the palette actions of the current route (aktionen.js); on most pages nobody registers
// such actions, so "?" showed "Keine Aktionen in dieser Ansicht" on 22 of 24 pages. The keys themselves already live in
// command registers: every drawing surface has one (MassingModellierer, BIM studio, IFC viewer) and publishes it while
// mounted (befehlsregister.js registerAnmelden). The app-wide keys (palette, help, close) are one more register, built
// here by globaleBefehle(), so the help is never empty and lists them the same way.
//
// In:  the actions of the current view (aktionen.js), the published surface registers, the global register.
// Out: hilfeAbschnitte() → sections [{id, titel, eintraege: [{id, titel, beschreibung?, taste?, kurz[]}]}];
//      globaleBefehle() → the register of the app-wide keys.
//
// Pure (no React, no window). Titles stay German i18n keys; the help component translates them.

import { befehlsRegister } from "./befehlsregister.js";

/**
 * One line of the help.
 * @typedef {{id: string, titel: string, beschreibung?: string, taste?: string, kurz: string[]}} HilfeEintrag
 *   taste: key as shown ("Strg+K", "?", "L"); kurz: typed short forms of the command line ("hs", "l")
 */

/**
 * One section of the help.
 * @typedef {{id: string, titel: string, eintraege: HilfeEintrag[]}} HilfeAbschnitt
 *   titel: German i18n key ("Diese Ansicht", a surface name, "Überall")
 */

/**
 * The register of the app-wide keys. The handlers come from the shell (Layout.jsx owns the overlays); the help calls
 * nothing of it, it only lists `alle()` — a script or agent may run them like any other command.
 * @param {{paletteOeffnen?: () => void, hilfeOeffnen?: () => void, schliessen?: () => void}} [handler]
 * @returns {ReturnType<typeof befehlsRegister>}
 */
export function globaleBefehle(handler = {}) {
  const reg = befehlsRegister();
  const nichts = () => null;
  reg.registrieren({ id: "palette", label: "Suche und Befehle öffnen", menue: "Überall", taste: "Strg+K", ausfuehren: handler.paletteOeffnen || nichts });
  reg.registrieren({ id: "tastenhilfe", label: "Kürzel und Aktionen anzeigen", menue: "Überall", taste: "?", ausfuehren: handler.hilfeOeffnen || nichts });
  reg.registrieren({ id: "schliessen", label: "Fenster oder Befehl schließen", menue: "Überall", taste: "Esc", ausfuehren: handler.schliessen || nichts });
  return reg;
}

/**
 * Lines of one register: every command with a key or a typed short form (the rest — agent-only commands like
 * "zeichnen-lesen" — has nothing to press and stays out of the help). Inactive commands are listed too: the help
 * tells which key does what, not what is possible this very moment.
 * @param {ReturnType<typeof befehlsRegister>} reg
 * @returns {HilfeEintrag[]}
 */
export function registerEintraege(reg) {
  /** @type {HilfeEintrag[]} */
  const aus = [];
  for (const b of reg?.alle?.() || []) {
    const kurz = (b.kurz || []).filter(Boolean);
    if (!b.taste && kurz.length === 0) continue;
    // A single-letter key is shown as on the keycap ("l" → "L"); chords and "?" stay as registered.
    const taste = b.taste && b.taste.length === 1 ? b.taste.toUpperCase() : b.taste;
    aus.push({ id: b.id, titel: b.label, ...(taste ? { taste } : {}), kurz });
  }
  return aus;
}

/**
 * All sections of the help, empty ones left out. Order: the current view's actions, the mounted surfaces, the global
 * keys last (they are the same everywhere).
 * @param {{
 *   aktionen?: ReadonlyArray<{id: string, titel: string, beschreibung?: string, kuerzel?: string}>,
 *   register?: ReadonlyArray<{bereich: string, reg: ReturnType<typeof befehlsRegister>}>,
 *   global?: ReturnType<typeof befehlsRegister>|null,
 *   kuerzelAnzeige?: (kuerzel: string) => string,
 * }} quellen kuerzelAnzeige: turns an action chord ("mod+shift+p") into display text
 * @returns {HilfeAbschnitt[]}
 */
export function hilfeAbschnitte({ aktionen = [], register = [], global = null, kuerzelAnzeige = (k) => k } = {}) {
  /** @type {HilfeAbschnitt[]} */
  const abschnitte = [];
  if (aktionen.length) {
    abschnitte.push({
      id: "ansicht",
      titel: "Diese Ansicht",
      eintraege: aktionen.map((a) => ({
        id: a.id, titel: a.titel, ...(a.beschreibung ? { beschreibung: a.beschreibung } : {}),
        ...(a.kuerzel ? { taste: kuerzelAnzeige(a.kuerzel) } : {}), kurz: [],
      })),
    });
  }
  register.forEach(({ bereich, reg }, i) => {
    const eintraege = registerEintraege(reg);
    if (eintraege.length) abschnitte.push({ id: `register-${i}`, titel: bereich, eintraege });
  });
  if (global) {
    const eintraege = registerEintraege(global);
    if (eintraege.length) abschnitte.push({ id: "global", titel: "Überall", eintraege });
  }
  return abschnitte;
}
