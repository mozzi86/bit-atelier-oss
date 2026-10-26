// 106-05: the model fallback of the speech input. A sentence the grammar (sprachbefehl.js) does not know goes - with the selection as context -
// to the AI harness agent, which may call the proposal tools of the open viewer (106-04 MCP tools: eigenschaft_setzen, transformieren, teilen,
// pruefen, ...). What comes back is NEVER a change: the tools only make proposals, which the person sees in words with a preview and confirms in the
// window (decisions D-IM-04 and 106-03: an agent never confirms; the app refuses it on the control channel).
//
// What leaves this module towards the model: the sentence, and for the selection its GUID, class, name, storey and the data-sheet fields - text only.
// No image unless the person switched "mit Bild" on (106-06, below) and never coordinates of the whole model. The GUIDs selected AT THE SENTENCE also go
// as `ziel`: the harness puts exactly that GUID into the change tools, so a selection changed during a long model turn does not move the
// proposal (guard rail 3: ground truth is the GUID from the ray). A project with the NDA marker (projekt.nda, D-IM-02) says so in the task and in
// the consent question; 106-05 sends no image in any project, the marker is the switch 106-06 reads before an image would leave the device.
//
// "Nur lokale KI": with the switch on in the app the harness must run a local provider, else nothing is sent (the harness refuses it itself as well,
// this check just says it in words first). Without the switch a provider that leaves this computer needs a click per sentence ("cloudOk").
// "dieses" without a selection is refused BEFORE that question: nobody is asked to agree to something that is refused afterwards.
//
// 106-06: on request ("mit Bild") ONE image of the current view goes along as context. Before it leaves, in this order: NDA marker -> never;
// the harness's model must read images (else a sentence, never a silently dropped image); the app's store decides per project (consent once
// per project when the image leaves this computer, "Nur lokale KI", office switch) - a missing consent comes back as the question
// `bild-zustimmung`. The harness checks all of it again on its side. The image never names the target: that stays the GUID (`ziel`).
//
// D-IM-07: a spoken sentence (and, ASSUMED by the same logic, a turn with an image) gets a marker issued by this page (satzMarke.js) that
// travels with the task; the agent's proposals then carry the origins "sprache" + "agent" (+ "bild"). The marker is not in the task text.
//
// In:  the sentence, the selection record (auswahlKontext), the registered SprechDienst, the project's NDA marker, optionally the view image
//      accessor, the project id and whether the sentence was spoken. Out: {art, text, werkzeuge, vorschlaege}.
import { sprechDienst } from "./sprechDienst.js";
import { KEINE_AUSWAHL_TEXT } from "./auswahlKontext.js";
import { BILD_GRUENDE, BILD_KANTE_MAX, bildZielText } from "./bildKontext.js";
import { satzMarkeAusgeben, satzMarkeZuruecknehmen } from "./satzMarke.js";

/** Longest transcript sent to the model in characters [ASSUMED: a spoken command is a sentence, not an essay; bounds what leaves the screen]. */
export const AUFTRAG_MAX_ZEICHEN = 600;

/** Most selected elements described in the task, count [ASSUMED: a spoken sentence is about one element or a few; the total is still named]. */
export const AUFTRAG_MAX_BAUTEILE = 5;

/** Sentence words that point at the selection ("dieses", "dort", ...): without a selection such a sentence is refused, not guessed. */
const BEZUG = /\b(dies|dort|hier|diese)/i;

/**
 * The GUIDs of the selection at this moment - the target the harness aims the change tools at.
 * @param {{bauteile?: Array<{guid?: string|null}>}|null|undefined} auswahl  Selection record (auswahlKontext). @returns {string[]}
 */
export function zielGuids(auswahl) {
  return (auswahl?.bauteile ?? []).map((b) => (b?.guid ? String(b.guid) : "")).filter(Boolean);
}

/**
 * The task text for the harness agent: the sentence, the selection in words with GUIDs, and the rules.
 * @param {string} text  The person's sentence.
 * @param {{anzahl?: number, bauteile?: Array<{guid?: string|null, klasse?: string|null, name?: string, geschoss?: string|null, steckbrief?: any}>}|null} [auswahl]
 *   Selection record of the viewer (auswahlKontext).
 * @param {{nda?: boolean, mitBild?: boolean}} [opt]  nda: the project carries the NDA marker (the task says: text and GUIDs only, never an image);
 *   mitBild (106-06): an image of the view goes along - the task says what it is for and that it never picks the element.
 * @returns {string}
 */
export function agentAuftrag(text, auswahl = null, opt = {}) {
  const satz = String(text ?? "").trim().slice(0, AUFTRAG_MAX_ZEICHEN);
  const liste = auswahl?.bauteile ?? [];
  const zeilen = liste.slice(0, AUFTRAG_MAX_BAUTEILE).map((b) => {
    const sb = b.steckbrief || {};
    const teile = [`GUID ${b.guid ?? "(keine)"}`, b.klasse ? `Klasse ${b.klasse}` : null, b.name ? `Name „${b.name}“` : null, b.geschoss ? `Geschoss ${b.geschoss}` : null,
      sb.status ? `Status ${sb.status}` : null, sb.material ? `Material ${sb.material}` : null, sb.feuerwiderstand ? `Feuerwiderstand ${sb.feuerwiderstand}` : null,
      typeof sb.tragend === "boolean" ? `tragend ${sb.tragend ? "ja" : "nein"}` : null].filter(Boolean);
    return `- ${teile.join(", ")}`;
  });
  const ausw = (auswahl?.anzahl ?? 0) > 0
    ? `Ausgewählt im Fenster beim Satz (${auswahl?.anzahl}):\n${zeilen.join("\n")}${(auswahl?.anzahl ?? 0) > zeilen.length ? "\n- …" : ""}`
    : "Im Fenster ist nichts ausgewählt.";
  return [
    "Sprachbefehl einer Person an das geöffnete Modell (Transkript, kann Hörfehler enthalten):",
    `„${satz}“`,
    "",
    ausw,
    "",
    "Regeln:",
    "- Du kannst nichts ändern, nur Vorschläge machen: eigenschaft_setzen, transformieren, teilen. Sie wirken auf das Bauteil, das beim Satz ausgewählt war (die App gibt es mit); eine GUID gibst du nicht an. Die Person sieht den Vorschlag in Worten mit Vorschau und übernimmt ihn selbst; du kannst nicht bestätigen.",
    "- „dieses“, „diese“, „dort“, „hier“ meinen die Auswahl. Ist nichts ausgewählt, rate nicht: sag der Person in einem Satz, dass sie erst ein Bauteil zeigen soll.",
    "- Welches Bauteil betroffen ist, bestimmt die GUID der Auswahl, nie eine Vermutung aus dem Satz. Frage lieber kurz zurück, statt zu raten.",
    "- Maße in Metern (verschiebung_m [dx, dy, dz]), Winkel in Grad. Antworte kurz auf Deutsch.",
    ...(opt.nda ? ["- Projekt mit NDA-Merker: nur Text und Bauteil-Kennungen, nie ein Bild — frage auch nicht nach einem Bild der Ansicht."] : []),
    ...(opt.mitBild ? ["- Dabei ist ein Bild der aktuellen Ansicht (das gewählte Bauteil ist hervorgehoben). Es zeigt nur, was die Person sieht: nutze es für räumliche Bezüge („links davon“, „die obere“). Welches Bauteil sich ändert, bestimmt trotzdem die Auswahl, nie das Bild."] : []),
  ].join("\n");
}

/** 106-06: the vision refusal with the model's name - an i18n template ({modell} is filled after t()). */
export const BILD_VISION_MODELL = `Modell „{modell}“: ${BILD_GRUENDE.vision}`;
/** 106-06: the view could not be rendered (e.g. plan or section) - an i18n template ({grund} = the viewer's reason). */
export const BILD_OHNE_ANSICHT = "Kein Bild der Ansicht: {grund} — nichts gesendet";

/**
 * Asks the harness agent about a sentence the grammar did not understand.
 * @param {string} text  The sentence.
 * @param {any} auswahl  Selection record of the viewer, read at the moment of the sentence.
 * @param {{cloudOk?: boolean, nda?: boolean, bild?: ((o: {kante: number, breite: number}) => {png_base64: string, breite?: number, hoehe?: number})|null,
 *   projektId?: string|null, gesprochen?: boolean, dienst?: import("./sprechDienst.js").SprechDienst|null, onEvent?: (ev: any) => void}} [opt]
 *   cloudOk: the person clicked "send anyway" for a provider outside this computer; nda: the project carries the NDA marker;
 *   gesprochen (D-IM-07): the sentence came from the microphone - the agent's proposals then carry "sprache" + "agent" (satzMarke.js);
 *   bild (106-06): "mit Bild" is on - renders the current view (px edge limit); projektId: the open project (NDA, consent);
 *   dienst: for tests (default: the registered one).
 * @returns {Promise<{ok: boolean, art: "modell"|"modell-freigabe"|"modell-fehler"|"bild-zustimmung", text: string, werkzeuge: string[], vorschlaege?: number|null, anbieter?: string, mitBild?: boolean,
 *   vorlage?: string, werte?: Record<string, string>}>}
 *   `vorlage`/`werte`: a sentence with values as an i18n template ({…} filled after t(), see antwortSatz); `text` is the German sentence.
 *   `ok`: false only for `modell-fehler`. `modell`: the agent answered (`werkzeuge`: the tools it called; `vorschlaege`: how many proposals came
 *   back without error - 0 = the answer is only text, nothing waits in the window; null = the service does not count; `mitBild`: an image went
 *   along); `modell-freigabe`: the provider leaves this computer, ask first; `bild-zustimmung` (106-06): the image would leave this computer and
 *   the project has no consent yet - ask once for the project; `modell-fehler`: nothing was sent or the harness failed (`text` says why).
 */
export async function modellFragen(text, auswahl, opt = {}) {
  const dienst = opt.dienst ?? sprechDienst();
  if (!dienst?.agent || !dienst.bereit) return { ok: false, art: "modell-fehler", text: "Freie Sätze brauchen den KI-Harness (Einstellungen › KI) — dieser Satz ist nicht in der Befehlsliste", werkzeuge: [] };
  if (!(auswahl?.anzahl > 0) && BEZUG.test(text)) return { ok: false, art: "modell-fehler", text: KEINE_AUSWAHL_TEXT, werkzeuge: [] };
  const b = await dienst.bereit();
  if (!b.harness) return { ok: false, art: "modell-fehler", text: "Der KI-Harness läuft nicht (Einstellungen › KI) — freie Sätze gehen nur über ihn", werkzeuge: [] };
  if (!b.mcp) return { ok: false, art: "modell-fehler", text: b.mcpHinweis || "Der KI-Harness hat keine Verbindung zu den Modell-Werkzeugen dieser App — er könnte keinen Vorschlag machen", werkzeuge: [] };
  if ((b.nurLokalApp || b.nurLokalHarness) && !b.providerLokal) {
    return { ok: false, art: "modell-fehler", text: `Nur lokale KI ist eingeschaltet, der KI-Harness nutzt aber „${b.provider ?? "?"}“ (nicht auf diesem Rechner) — dort ein lokales Profil wählen; nichts wurde gesendet`, werkzeuge: [] };
  }
  const mitBild = typeof opt.bild === "function";
  /** @type {Array<{png_base64: string}>|undefined} */
  let bilder;
  if (mitBild) {
    // 106-06, in the order of D-IM-02: NDA never; the model must read images; the store decides per project (consent, switches)
    if (opt.nda) return { ok: false, art: "modell-fehler", text: BILD_GRUENDE.nda, werkzeuge: [] };
    if (!b.bilder) {
      const vorlage = b.modell ? BILD_VISION_MODELL : BILD_GRUENDE.vision;
      const werte = { modell: String(b.modell ?? "") };
      return { ok: false, art: "modell-fehler", text: vorlage.replace("{modell}", werte.modell), vorlage, werte, werkzeuge: [] };
    }
    if (!opt.projektId) return { ok: false, art: "modell-fehler", text: BILD_GRUENDE["ohne-projekt"], werkzeuge: [] };
    if (typeof dienst.bildFreigabe !== "function") return { ok: false, art: "modell-fehler", text: "Die Bildprüfung ist in dieser Fassung nicht verfügbar — kein Bild gesendet", werkzeuge: [] };
    // review fix 106-06: render BEFORE any question - a view without an image (plan or section in the BIM studio) is said at once, not after
    // the person consented for the project. The PNG stays in memory; it goes out only after every check and question below.
    try {
      const png = /** @type {NonNullable<typeof opt.bild>} */ (opt.bild)({ kante: BILD_KANTE_MAX, breite: BILD_KANTE_MAX });
      bilder = [{ png_base64: png.png_base64 }];
    } catch (e) {
      const werte = { grund: String(/** @type {any} */ (e)?.message || e) };
      return { ok: false, art: "modell-fehler", text: BILD_OHNE_ANSICHT.replace("{grund}", werte.grund), vorlage: BILD_OHNE_ANSICHT, werte, werkzeuge: [] };
    }
    const f = await dienst.bildFreigabe(opt.projektId, { lokal: !!b.providerLokal, anbieter: b.provider ?? null, host: b.providerZiel ?? null });
    if (!f.ok) {
      if (f.grund === "zustimmung") return { ok: true, art: "bild-zustimmung", anbieter: b.provider ?? "?", werkzeuge: [], text: f.text };
      return { ok: false, art: "modell-fehler", text: f.text, werkzeuge: [] };
    }
  }
  if (!b.providerLokal && !opt.cloudOk) {
    return { ok: true, art: "modell-freigabe", anbieter: b.provider ?? "?", werkzeuge: [],
      text: mitBild
        ? `Der Satz, die Auswahl (Text, Bauteil-Kennungen) und ein Bild der Ansicht gehen ${bildZielText({ lokal: false, anbieter: b.provider ?? "?", host: b.providerZiel ?? null })}. `
          + "Das Modell kann dabei auch offene Vorschläge, frühere Sätze und Prüfergebnisse als Text lesen."
        : `Der Satz und die Auswahl (Text, Bauteil-Kennungen) gehen an „${b.provider ?? "?"}“ — außerhalb dieses Rechners. Das Modell kann dabei auch offene Vorschläge, `
          + `frühere Sätze und Prüfergebnisse als Text lesen. Kein Bild, keine Zeichnung.${opt.nda ? " NDA-Projekt: nie ein Bild." : ""}` };
  }
  // D-IM-07: the marker of this sentence (spoken? image along?) - the harness puts it into the change tools, the change commands read it
  // back here in the page; the model never sees it. Withdrawn when the turn is over.
  const satzMarke = satzMarkeAusgeben({ sprache: !!opt.gesprochen, bild: !!bilder });
  try {
    const r = await dienst.agent(agentAuftrag(text, auswahl, { nda: !!opt.nda, mitBild }), {
      profil: "sprechen", ziel: zielGuids(auswahl), onEvent: opt.onEvent, ...(bilder ? { bilder, projektId: opt.projektId ?? null } : {}),
      ...(satzMarke ? { satzMarke } : {}),
    });
    if (r.fehler) return { ok: false, art: "modell-fehler", text: r.fehler, werkzeuge: r.werkzeuge };
    return { ok: true, art: "modell", text: r.text.trim() || "(keine Antwort)", werkzeuge: r.werkzeuge, vorschlaege: typeof r.vorschlaege === "number" ? r.vorschlaege : null, mitBild };
  } catch (e) {
    return { ok: false, art: "modell-fehler", text: String(/** @type {any} */ (e)?.message || e), werkzeuge: [] };
  } finally {
    satzMarkeZuruecknehmen(satzMarke);
  }
}
