// mitRueckmeldung — one wrapper for "do something, then tell the user how it
// went" (finding NA-13 of the 27.09. review: pages swallowed failed saves or
// showed "[object Object]"). Phase 81 (81-01) builds it because NA-13 had not
// landed; any phase may use it.
//
// Rule: a failure is reported in plain text (the error message, never an
// object) and returned, never swallowed and never thrown into a click handler.
//
// In:  an async action, optional toast texts (already translated by the caller)
//      and an injectable toast (tests). Out: Promise<{ok, wert?, fehler?}>.

import { toast as sonnerToast } from "sonner";

/** @param {unknown} fehler @returns {string} plain text, never "[object Object]" */
function klartext(fehler) {
  const m = /** @type {any} */ (fehler)?.message;
  return typeof m === "string" && m ? m : String(fehler);
}

/**
 * Runs an action and reports success or failure as a toast.
 * @template T
 * @param {() => Promise<T>|T} aktion the work
 * @param {{erfolg?: string|null, fehler?: string|null, toast?: {success: (s: string) => any, error: (s: string) => any}}} [texte]
 *   erfolg: success toast (none when empty); fehler: prefix of the error toast
 *   ("<fehler>: <message>"); toast: injectable (tests), default sonner
 * @returns {Promise<{ok: true, wert: T} | {ok: false, fehler: string}>}
 */
export async function mitRueckmeldung(aktion, { erfolg = null, fehler = null, toast = sonnerToast } = {}) {
  try {
    const wert = await aktion();
    if (erfolg) toast.success(erfolg);
    return { ok: true, wert };
  } catch (e) {
    const text = klartext(e);
    console.error("[mitRueckmeldung]", e);
    toast.error(fehler ? `${fehler}: ${text}` : text);
    return { ok: false, fehler: text };
  }
}
