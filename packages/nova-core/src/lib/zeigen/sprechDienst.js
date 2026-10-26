// 106-05: the hook between the viewers (packages, @core/@ifc/@designer) and the AI harness (app, src/lib/harnessClient.js).
// A package may not import the app, so the app registers the harness functions here once at start-up (src/lib/sprechDienstAnmelden.js)
// and the speech field reads them. Without a registration (a build without the harness client, a unit test) there is no speech
// and no model fallback - the field says so in words instead of failing.
//
// In:  sprechDienstSetzen(dienst) from the app. Out: sprechDienst() for the speech field, an unregister function.

/**
 * What the app hands over.
 * @typedef {object} SprechDienst
 * @property {(blob: Blob) => Promise<{text: string, dauer_s?: number, geraet?: string, modell?: string, audio_s?: number}>} stt
 *   Transcribes one recording (harness POST /stt, faster-whisper on this computer). Throws a German sentence.
 * @property {() => Promise<SprechBereitschaft>} bereit  Asks the harness what it can do right now (never throws: an unreachable harness is `harness: false`).
 * @property {(auftrag: string, opt?: {profil?: string, ziel?: string[], bilder?: Array<{png_base64: string}>, projektId?: string|null, satzMarke?: string, onEvent?: (ev: any) => void}) => Promise<{text: string, werkzeuge: string[], vorschlaege?: number, fehler: string|null}>} agent
 *   ziel: the GUIDs selected when the person spoke (the harness aims the change tools at them); vorschlaege: change tools that came back without error;
 *   satzMarke (D-IM-07): the page's marker of the sentence (satzMarke.js) - the harness puts it into the change tools, never into the model's view;
 *   bilder/projektId (106-06): images of the view as context, checked again by the harness against the app's store
 *   Sends one task to the harness agent (WebSocket /ws/chat, profile "sprechen": only the proposal tools of the open viewer) and answers when its turn is done.
 *   Approval requests of the agent are refused automatically. Throws a German sentence when the harness cannot be reached.
 * @property {(projektId: string, ziel: {lokal: boolean, anbieter?: string|null, host?: string|null}) => Promise<{ok: boolean, grund: string|null, text: string}>} [bildFreigabe]
 *   106-06: may an image of this project go to that target (app store: NDA, consent, switches)? Never throws. Without it no image is sent.
 * @property {(projektId: string) => Promise<{ok: boolean, text?: string}>} [bildZustimmen]  106-06: stores the person's consent for the project.
 * @property {(projektId: string) => Promise<{ok: boolean, text?: string}>} [bildZuruecknehmen]  106-06: withdraws it.
 */

/**
 * @typedef {object} SprechBereitschaft
 * @property {boolean} harness  The harness answers.
 * @property {boolean} stt  Speech recognition is installed and enabled in the harness.
 * @property {boolean} sttBereit  The speech model is loaded (the first start downloads/loads it).
 * @property {string} hinweis  German sentence for the field when something is missing ("" when all is fine).
 * @property {string} [sttHinweis]  Why speech recognition is missing ("" = fine) - for the microphone.
 * @property {string} [mcpHinweis]  Why the viewer tools are missing ("" = fine) - for a typed free sentence.
 * @property {string|null} provider  Name of the harness's current provider profile.
 * @property {boolean} providerLokal  The provider sends nothing off this computer (loopback or mock).
 * @property {boolean} nurLokalApp  "Nur lokale KI" is on in the app (Einstellungen > KI).
 * @property {boolean} nurLokalHarness  The harness was started with "Nur lokale KI".
 * @property {boolean} mcp  The harness has the viewer tools (MCP connection to this app) - without them it cannot make proposals.
 * @property {boolean} [bilder]  106-06: the harness's model reads images (its own check: profile quirk, catalog, model-id patterns).
 * @property {string|null} [modell]  106-06: the harness's current model.
 * @property {string|null} [providerZiel]  106-06: host the provider talks to ("" for the mock, null when unknown).
 */

/** @type {SprechDienst|null} */
let aktuell = null;

/**
 * Registers the harness functions for the speech field.
 * @param {SprechDienst} dienst
 * @returns {() => void} Unregisters again (only if it is still this one).
 */
export function sprechDienstSetzen(dienst) {
  aktuell = dienst;
  return () => { if (aktuell === dienst) aktuell = null; };
}

/** @returns {SprechDienst|null} The registered service, or null. */
export function sprechDienst() {
  return aktuell;
}
