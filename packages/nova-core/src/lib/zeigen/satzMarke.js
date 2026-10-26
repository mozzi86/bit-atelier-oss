// D-IM-07 (decision of 25.10.2026): a proposal the agent makes from a SPOKEN sentence carries both origins, "sprache" and "agent".
// ASSUMPTION built with it (same logic): a proposal from an agent turn that had an image of the view attached carries "bild" as well.
//
// How the app learns it: the speech field asks the agent (sprachAgent.modellFragen) and, right before, has THIS module issue a random
// marker for the sentence that remembers what the app itself knows - spoken or typed, image along or not. The marker travels with the task
// (harness message `satz_marke`), the harness bridge puts it into the change tools' calls (never shown to the model, like the `ziel` GUID of
// 106-05), the app's MCP server passes it on as the command parameter `satz_marke`, and the change commands (aenderungsBefehle.js) look it
// up here for a call that came over the control channel.
//
// Why an issued marker and not a flag the caller sends: whatever arrives over the control channel is an agent; a flag "sprache: true" could
// be sent by any agent. A marker counts only if THIS page issued it and it is still open, so it carries nothing the app did not see itself.
// It adds origins to "agent", it never replaces it: the main origin stays "agent", confirming and undoing stay refused for the channel
// (D-IM-04), and "hand" can never come out of it (aenderungen.js refuses "hand" together with another origin).
// A marker this page did not issue, or one that ran out, adds nothing: the proposal is then "agent" alone, as before D-IM-07.
//
// In:  what the speech field knows about a sentence {sprache, bild}. Out: marker string; the origin list of an agent call with a marker.

/**
 * How long an issued marker stays valid, in ms [ASSUMED: 20 min, longer than the 15 min the app waits for one agent turn
 * (harnessClient AGENT_TIMEOUT_MS); the speech field withdraws it as soon as the turn ends].
 */
export const SATZ_MARKE_GUELTIG_MS = 20 * 60 * 1000;

/** Form of a marker: "sm-" and 32 hex digits (128 random bits) - the MCP server and the harness only pass this form on. */
export const SATZ_MARKE_MUSTER = /^sm-[0-9a-f]{32}$/;

/** @type {Map<string, {sprache: boolean, bild: boolean, bis: number}>} open markers of this page */
const offen = new Map();

/** @returns {string} 32 random hex digits (Web Crypto, in browsers and Node alike) */
function zufall() {
  const b = new Uint8Array(16);
  globalThis.crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/**
 * Issues the marker of one sentence that goes to the agent. Nothing is issued when there is nothing to add (a typed sentence without an
 * image stays "agent", as before).
 * @param {{sprache?: boolean, bild?: boolean}} was  sprache: the sentence was spoken (the speech field's own road); bild: an image of the
 *   view goes along with the task.
 * @param {{jetzt?: number}} [opt]  jetzt: time in ms (tests).
 * @returns {string|null}  The marker, or null.
 * Side effect: remembers the marker in this page until satzMarkeZuruecknehmen or SATZ_MARKE_GUELTIG_MS; drops expired ones.
 */
export function satzMarkeAusgeben(was, opt = {}) {
  const jetzt = opt.jetzt ?? Date.now();
  for (const [m, e] of offen) if (e.bis <= jetzt) offen.delete(m);
  if (!was?.sprache && !was?.bild) return null;
  const marke = `sm-${zufall()}`;
  offen.set(marke, { sprache: !!was.sprache, bild: !!was.bild, bis: jetzt + SATZ_MARKE_GUELTIG_MS });
  return marke;
}

/**
 * What an open marker says. One sentence may lead to several proposals, so reading does not use it up.
 * @param {any} marke  The marker from the command parameters. @param {{jetzt?: number}} [opt]  jetzt: time in ms (tests).
 * @returns {{sprache: boolean, bild: boolean}|null}  null: not issued by this page, withdrawn, expired or malformed.
 */
export function satzMarkeLesen(marke, opt = {}) {
  if (typeof marke !== "string" || !SATZ_MARKE_MUSTER.test(marke)) return null;
  const e = offen.get(marke);
  if (!e) return null;
  if (e.bis <= (opt.jetzt ?? Date.now())) { offen.delete(marke); return null; }
  return { sprache: e.sprache, bild: e.bild };
}

/**
 * Withdraws a marker (the agent's turn is over: a later call with it is "agent" alone).
 * @param {string|null|undefined} marke
 */
export function satzMarkeZuruecknehmen(marke) {
  if (marke) offen.delete(marke);
}

/**
 * Origins of a proposal that came over the control channel (an agent), in the order of D-IM-07: what started it, the agent, what it saw.
 * @param {any} marke  Command parameter `satz_marke` (may be missing). @param {{jetzt?: number}} [opt]
 * @returns {string[]}  ["agent"], ["sprache", "agent"], ["agent", "bild"] or ["sprache", "agent", "bild"].
 */
export function agentQuellen(marke, opt = {}) {
  const m = satzMarkeLesen(marke, opt);
  return [...(m?.sprache ? ["sprache"] : []), "agent", ...(m?.bild ? ["bild"] : [])];
}
