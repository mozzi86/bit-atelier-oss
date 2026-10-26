// 106-05: the keys of the speech field (106-03 left "confirm/reject by keyboard shortcut" open).
//   Leertaste halten + V  - hold to talk: start while both are down, stop when one is released (like the button),
//   Alt+J                 - Ja: confirm the open proposal  (command "bestaetigen", origin of the confirmation "tastatur"),
//   Strg+Enter            - the same as Alt+J,
//   Alt+N                 - Nein: discard the open proposal (command "verwerfen").
// Not Strg+Entf and not Backspace for "discard": the BIM studio deletes the selected element with them.
// Keys are ignored while the focus is in a text field, so typing a sentence never starts a recording or confirms a change.
//
// One listener pair on the window in the CAPTURE phase: "Space+V" must not also switch the studio's tool to "select" (the studio binds V),
// so the handler stops the event for exactly that combination - and only for it.
//
// In:  an event target (window), handlers {start, stopp, uebernehmen, verwerfen}, optional `aktiv()` (false = keys off). Out: a function that removes the listeners.

/** @param {any} t  Event target. @returns {boolean} a field the person types into */
function schreibfeld(t) {
  const tag = String(t?.tagName || "");
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t?.isContentEditable === true;
}

/**
 * Connects the keys.
 * @param {EventTarget} ziel  Usually `window`.
 * @param {{start: () => void, stopp: () => void, uebernehmen: () => void, verwerfen: () => void, aktiv?: () => boolean}} h
 * @returns {() => void}
 */
export function sprechTastenAnbinden(ziel, h) {
  let leertaste = false;
  let spricht = false;
  const an = () => (h.aktiv ? h.aktiv() : true);
  /** @param {any} e */
  const ab = (e) => {
    if (schreibfeld(e.target) || !an()) return;
    const k = String(e.key || "").toLowerCase();
    if (k === " ") { leertaste = true; return; }
    if (k === "v" && leertaste && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault(); e.stopPropagation();
      if (!e.repeat && !spricht) { spricht = true; h.start(); }
      return;
    }
    if (e.altKey && !e.ctrlKey && !e.metaKey && k === "j") { e.preventDefault(); h.uebernehmen(); return; }
    if (e.altKey && !e.ctrlKey && !e.metaKey && k === "n") { e.preventDefault(); h.verwerfen(); return; }
    if (e.ctrlKey && !e.altKey && !e.metaKey && k === "enter") { e.preventDefault(); h.uebernehmen(); }
  };
  /** @param {any} e */
  const auf = (e) => {
    const k = String(e.key || "").toLowerCase();
    if (k === " ") leertaste = false;
    if ((k === " " || k === "v") && spricht) { spricht = false; h.stopp(); }
  };
  const verloren = () => { leertaste = false; if (spricht) { spricht = false; h.stopp(); } };
  ziel.addEventListener("keydown", ab, true);
  ziel.addEventListener("keyup", auf, true);
  ziel.addEventListener("blur", verloren);
  return () => { ziel.removeEventListener("keydown", ab, true); ziel.removeEventListener("keyup", auf, true); ziel.removeEventListener("blur", verloren); };
}
