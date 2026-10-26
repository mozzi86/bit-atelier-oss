// 106-05 review: ONE place that says whether a register call came over the local control channel (an agent, through the app's MCP
// server). The change commands (aenderungsBefehle.js) and the text input (eingabe.js) both refuse "bestaetigen" and "rueckgaengig" for
// such a call; two copies of this test could drift apart and open the lock on one road.
//
// In:  the register context `ctx` of a call. Out: boolean.

/** The marker the control channel sets on every call it forwards (server -> viewer, plan 104-04). */
export const AGENTEN_KANAL = "steuerung";

/** @param {any} ctx  Register context. @returns {boolean} the call came over the local control channel (an agent) */
export const vomAgentenKanal = (ctx) => ctx?.kanal === AGENTEN_KANAL;
