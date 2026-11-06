// 106-08: the floating panel ("Tafel") of a VR session. In the headset there is no screen with the speech field and the preview
// card, so this panel shows the same things in words: what the ray points at, what is selected, what was heard, the proposal of
// 106-03 with its check and origin, and the buttons Übernehmen / Verwerfen. A change still runs ONLY when the person presses
// "Übernehmen" (controller ray on the button + trigger, or the face button A): guard rail 1 and D-IM-04, the press goes through the
// same command `bestaetigen` with durch "hand" as the button on the screen.
//
// Pure parts (node-testable): tafelInhalt() builds lines and buttons from a plain state, tafelLayout() places them in canvas pixels,
// tafelKnopfBei() answers which button lies under a point of the panel, tafelZeichnen() draws onto a 2D context (a stand-in in tests).
// Colour is never the only carrier (guard rail 5): every state has a sign (✓ ✕ ▲ ? ℹ ●) and an outline form (solid / dashed / dotted).
// Colours are hex copies of the LIGHT app tokens (the panel is light like the 3D views); tests/unit/xrSitzung-10608.test.js compares
// them with packages/nova-core/src/index.css.
//
// In:  a TafelStand (plain data), the translator t. Out: layout data, canvas drawing. No DOM, no three.

import { ZEIGE_ZUSTAENDE } from "@core/lib/zeigen/zustaende.js";
import { herkunftText } from "@core/lib/zeigen/aenderungen.js";

/** Canvas size of the panel, px. */
export const TAFEL_PX = Object.freeze({ breite: 1024, hoehe: 704 });
/** Size of the panel in the room, m (user metres: it does not shrink with the table model) [ASSUMED: readable at arm's length, ~1 m]. */
export const TAFEL_M = Object.freeze({ breite: 0.64, hoehe: 0.44 });

/**
 * Panel colours. Hex copies of light tokens of index.css (no JS token export exists):
 * flaeche = --card, text = --foreground, leise = --muted-foreground, primaer = --primary, primaerText = --primary-foreground;
 * fehler / warnung / fokus from zustaende.js (themselves token copies). Button outlines use --foreground, not --border
 * (#e5e5e5 has only 1.26:1 on white, see 106-07).
 */
export const TAFEL_FARBEN = Object.freeze({
  flaeche: "#ffffff",
  text: "#0a0a0a",
  leise: "#737373",
  primaer: "#171717",
  primaerText: "#fafafa",
  fehler: ZEIGE_ZUSTAENDE.fehler.hex,
  warnung: ZEIGE_ZUSTAENDE.warnung.hex,
  fokus: ZEIGE_ZUSTAENDE.fokus.hex,
});

/** Signs per answer form (same as the speech field: ✓ done, ✕ refused, ? open question, – hint without effect, ℹ information). */
export const TAFEL_ZEICHEN = Object.freeze({ ok: "✓", fehler: "✕", frage: "?", hinweis: "–", info: "ℹ", warnung: "▲", aufnahme: "●" });

/**
 * @typedef {Object} TafelVorschlag  An open proposal as the command `vorschlaege` lists it (vorschlagKurz).
 * @property {string} id
 * @property {string} satz
 * @property {{stufe: "ok"|"warn"|"fehler", saetze?: string[]}|null} [pruefung]
 * @property {string} [herkunft]
 * @property {string[]} [herkunft_quellen]
 * @property {boolean} [gesperrt]
 */

/**
 * @typedef {Object} TafelStand  Everything the panel shows; plain data.
 * @property {string|null} [zeigt]       Element under the ray in words ("IfcWall · Wand 12"), null = nothing.
 * @property {string|null} [auswahl]     Selected element in words, null = nothing.
 * @property {{zustand?: string, gehoert?: string, antwort?: {text: string, stufe: string}|null, halt?: {was: string}|null,
 *   rueckfrage?: string|null, cloud?: {anbieter: string}|null}|null} [sprechen]  State of the speech field (SprechFeld handle).
 * @property {TafelVorschlag|null} [vorschlag]  The open proposal the buttons act on (the newest one).
 * @property {number} [offenAnzahl]      Number of open proposals.
 * @property {boolean} [darfAendern]     May the person's role change the model (106-07)? false = Übernehmen is off, the reason is shown.
 * @property {{text: string, ok: boolean}|null} [meldung]  Result of the last panel action.
 * @property {{konflikte: number, titel: string|null, hinweis: string|null, getrennt: boolean}|null} [abgleich]  106-09 review: the
 *   sync between devices as the headset must see it - open conflicts (count, first title as German key), the newest
 *   "arrived from another device" note, and whether the stream is down. The decision itself is made at the screen (two
 *   versions side by side do not fit the panel); the panel says that a decision waits and that the field is not saved.
 * @property {"1:1"|"tisch"} [modus]     Current scale mode.
 */

/**
 * One line block of the panel. Review 106-08: every line says how important it is when space runs out (rang: higher = stays longer;
 * fest = a line a button depends on, dropped only when nothing else is left), which buttons need it to be readable (knoepfe: such a
 * button is switched off when its line had to go - a button never acts on something the panel does not show in words), and how many
 * wrapped rows it may take at most (maxTeile, cut with "…"; never set on the proposal sentence itself).
 * @typedef {{text: string, art: "titel"|"text"|"leise"|"ok"|"fehler"|"frage"|"hinweis"|"info"|"warnung"|"aufnahme",
 *   rahmen?: "durchgezogen"|"gestrichelt"|"gepunktet"|null, rang?: number, fest?: boolean, knoepfe?: string[], maxTeile?: number}} TafelZeile
 * @typedef {{id: string, label: string, aktiv: boolean, primaer?: boolean}} TafelKnopf
 */

/** Most wrapped rows of a check (warning / error) on the panel; the rest is cut with "…" [ASSUMED: three rows keep the stage sign and
 *  the first sentences readable and leave room for the proposal sentence]. */
const PRUEF_ZEILEN_MAX = 3;

/** Characters per line before wrapping (canvas 1024 px, 28 px text ≈ 15 px per character) [ASSUMED: average German text width]. */
const ZEICHEN_JE_ZEILE = 60;

/**
 * Wraps a sentence at word boundaries.
 * @param {string} text @param {number} max  Characters per line. @returns {string[]}
 */
export function umbrechen(text, max = ZEICHEN_JE_ZEILE) {
  const woerter = String(text ?? "").split(/\s+/).filter(Boolean);
  /** @type {string[]} */
  const zeilen = [];
  let z = "";
  for (const w of woerter) {
    if (!z) z = w;
    else if (z.length + 1 + w.length <= max) z += ` ${w}`;
    else { zeilen.push(z); z = w; }
  }
  if (z) zeilen.push(z);
  return zeilen.length ? zeilen : [""];
}

/**
 * Lines and buttons of the panel for a state. The buttons act on `stand.vorschlag` (the one shown), never on a guessed one.
 * @param {TafelStand} stand
 * @param {(s: string) => string} [t]  Translator (German keys).
 * @returns {{zeilen: TafelZeile[], knoepfe: TafelKnopf[]}}
 */
export function tafelInhalt(stand, t = (s) => s) {
  /** @type {TafelZeile[]} */
  const zeilen = [];
  /** @type {TafelKnopf[]} */
  const knoepfe = [];
  // rang: what goes first when space runs out (lowest first, see TafelZeile); fest: kept until nothing else is left
  zeilen.push(stand.zeigt
    ? { text: `${t("Strahl zeigt auf")}: ${stand.zeigt}`, art: "text", rahmen: "gepunktet", rang: 4, maxTeile: 2 }
    : { text: `${t("Strahl zeigt auf")}: —`, art: "leise", rang: 4 });
  zeilen.push(stand.auswahl
    ? { text: `${t("Ausgewählt")}: ${stand.auswahl}`, art: "text", rahmen: "durchgezogen", rang: 5, maxTeile: 2 }
    : { text: t("Nichts ausgewählt — auf ein Bauteil zeigen und den Abzug drücken"), art: "leise", rang: 1 });

  const s = stand.sprechen ?? null;
  if (!s) zeilen.push({ text: t("Sprechen nicht verfügbar — der Sprech-Knopf fehlt in dieser Ansicht"), art: "leise", rang: 1 });
  // an open microphone is always said: ranked above all older information
  else if (s.zustand === "aufnahme") zeilen.push({ text: `${TAFEL_ZEICHEN.aufnahme} ${t("Aufnahme")} — ${t("Griff loslassen zum Senden")}`, art: "aufnahme", rang: 9 });
  else if (s.zustand === "erkennt") zeilen.push({ text: `… ${t("Erkennt …")}`, art: "leise", rang: 2 });
  else if (s.zustand !== "aus") zeilen.push({ text: t("Griff halten und sprechen"), art: "leise", rang: 1 });
  if (s?.gehoert) zeilen.push({ text: `${t("Gehört")}: „${s.gehoert}“`, art: "text", rang: 2, maxTeile: 2 });
  if (s?.halt) {
    // "Abbrechen" is not tied to this line: cancelling never changes the model, so it stays usable in every case
    zeilen.push({ text: `${TAFEL_ZEICHEN.frage} ${t("Wird gleich übernommen")}: ${s.halt.was}`, art: "frage", rahmen: "gepunktet", rang: 14, fest: true });
    knoepfe.push({ id: "abbrechen", label: t("Abbrechen"), aktiv: true });
  }
  if (s?.antwort?.text) {
    const stufe = /** @type {keyof typeof TAFEL_ZEICHEN} */ (["ok", "fehler", "frage", "hinweis"].includes(s.antwort.stufe) ? s.antwort.stufe : "hinweis");
    zeilen.push({ text: `${TAFEL_ZEICHEN[stufe]} ${s.antwort.text}`, art: /** @type {TafelZeile["art"]} */ (stufe), rahmen: stufe === "fehler" ? "durchgezogen" : stufe === "ok" ? null : "gepunktet", rang: 3, maxTeile: 3 });
  }
  if (s?.rueckfrage) {
    zeilen.push({ text: `${TAFEL_ZEICHEN.frage} ${s.rueckfrage}`, art: "frage", rahmen: "gepunktet", rang: 11, fest: true, knoepfe: ["rueckfrage-ja", "rueckfrage-nein"] });
    knoepfe.push({ id: "rueckfrage-ja", label: t("Ja"), aktiv: true }, { id: "rueckfrage-nein", label: t("Nein"), aktiv: true });
  }
  if (s?.cloud) {
    zeilen.push({ text: `${TAFEL_ZEICHEN.frage} ${t("Satz geht an ein Modell außerhalb dieses Rechners")}: ${s.cloud.anbieter || "?"}`, art: "frage", rahmen: "gepunktet", rang: 10, fest: true, knoepfe: ["cloud-ja", "cloud-nein"] });
    knoepfe.push({ id: "cloud-ja", label: t("Trotzdem senden"), aktiv: true }, { id: "cloud-nein", label: t("Nicht senden"), aktiv: true });
  }

  const v = stand.vorschlag ?? null;
  if (v) {
    const stufe = v.pruefung?.stufe ?? "ok";
    const anzahl = stand.offenAnzahl && stand.offenAnzahl > 1 ? ` (${t("neuester von")} ${stand.offenAnzahl})` : "";
    // the proposal sentence in full (never cut) and its check: without them neither button may act (guard rail 1, D-IM-04)
    zeilen.push({ text: `${t("Änderung vorgeschlagen")}${anzahl}: ${v.satz}`, art: "titel", rahmen: stufe === "fehler" ? "durchgezogen" : stufe === "warn" ? "gestrichelt" : null, rang: 13, fest: true, knoepfe: ["uebernehmen", "verwerfen"] });
    // a long check is cut to PRUEF_ZEILEN_MAX rows with "…": the stage sign and the first sentences stay readable
    if (stufe === "fehler") zeilen.push({ text: `${TAFEL_ZEICHEN.fehler} ${t("Fehler")}: ${(v.pruefung?.saetze ?? []).join(" ") || t("Gesperrt — erst klären")}`, art: "fehler", rahmen: "durchgezogen", rang: 12, fest: true, knoepfe: ["uebernehmen"], maxTeile: PRUEF_ZEILEN_MAX });
    else if (stufe === "warn") zeilen.push({ text: `${TAFEL_ZEICHEN.warnung} ${t("Warnung")}: ${(v.pruefung?.saetze ?? []).join(" ")}`, art: "warnung", rahmen: "gestrichelt", rang: 12, fest: true, knoepfe: ["uebernehmen"], maxTeile: PRUEF_ZEILEN_MAX });
    else zeilen.push({ text: `${TAFEL_ZEICHEN.ok} ${t("Prüfung ohne Befund")}`, art: "ok", rang: 12, fest: true, knoepfe: ["uebernehmen"] });
    const herkunft = herkunftText(v, t);
    if (herkunft) zeilen.push({ text: `${t("Herkunft")}: ${herkunft}`, art: "leise", rang: 3 });
    const darf = stand.darfAendern !== false;
    if (!darf) zeilen.push({ text: `${TAFEL_ZEICHEN.info} ${t("Nur ansehen und vorschlagen — Ihre Rolle darf das Modell nicht ändern")}`, art: "info", rahmen: "gepunktet", rang: 4 });
    knoepfe.push({ id: "uebernehmen", label: `${t("Übernehmen")} (A)`, aktiv: darf && stufe !== "fehler" && !v.gesperrt, primaer: true });
    knoepfe.push({ id: "verwerfen", label: `${t("Verwerfen")} (B)`, aktiv: true });
  }
  // 106-09 review: a conflict blocks saving of its part - the person in the headset must know (solid border + "✕", rang high)
  const ab = stand.abgleich ?? null;
  if (ab?.konflikte) {
    const was = ab.titel ? `: ${t(ab.titel)}` : "";
    zeilen.push({ text: `${TAFEL_ZEICHEN.fehler} ${t("Konflikt mit einem anderen Gerät")}${was}${ab.konflikte > 1 ? ` (+${ab.konflikte - 1})` : ""} — ${t("wird nicht gespeichert, bis Sie am Bildschirm entscheiden")}`,
      art: "fehler", rahmen: "durchgezogen", rang: 8, maxTeile: 3 });
  }
  if (ab?.getrennt) zeilen.push({ text: `${TAFEL_ZEICHEN.warnung} ${t("Abgleich mit anderen Geräten unterbrochen")}`, art: "warnung", rahmen: "gestrichelt", rang: 3, maxTeile: 1 });
  if (ab?.hinweis) zeilen.push({ text: `${TAFEL_ZEICHEN.info} ${ab.hinweis}`, art: "info", rahmen: "gepunktet", rang: 2, maxTeile: 2 });
  if (stand.meldung?.text) {
    zeilen.push({ text: `${stand.meldung.ok ? TAFEL_ZEICHEN.ok : TAFEL_ZEICHEN.fehler} ${stand.meldung.text}`, art: stand.meldung.ok ? "ok" : "fehler", rahmen: stand.meldung.ok ? null : "durchgezogen", rang: 3, maxTeile: 2 });
  }
  knoepfe.push({ id: "massstab", label: stand.modus === "tisch" ? t("Maßstab 1:1") : t("Tischmodell"), aktiv: true });
  knoepfe.push({ id: "beenden", label: t("VR beenden"), aktiv: true });
  return { zeilen, knoepfe };
}

/** Layout measures, px. */
const RAND = 28;
const ZEILE_PX = 36;
/** Gap between two line blocks, px (counted in the space calculation since review 106-08). */
const BLOCK_ABSTAND = 6;
const KNOPF_H = 76;
const KNOPF_ABSTAND = 14;
const KNOEPFE_JE_REIHE = 4;

/**
 * @typedef {{zeilen: Array<TafelZeile & {y: number, teile: string[]}>, knoepfe: Array<TafelKnopf & {x: number, y: number, w: number, h: number}>,
 *   weg: string[], breite: number, hoehe: number}} TafelLayout  weg: ids of buttons switched off because their line did not fit.
 */

/**
 * Places lines (top down, wrapped) and buttons (bottom rows, 4 per row) in canvas pixels. Lines that do not fit above the buttons
 * are dropped by importance (lowest `rang` first, among equals the upper = older one); lines marked `fest` (proposal, check,
 * questions, the pending "ja") go only when nothing else is left. A button whose line had to go is switched OFF, so no button ever
 * acts on a change or a question the panel does not show in words (guard rail 1, D-IM-04).
 * @param {{zeilen: TafelZeile[], knoepfe: TafelKnopf[]}} inhalt  Result of tafelInhalt().
 * @param {{breite: number, hoehe: number}} [px]  Canvas size, px (default TAFEL_PX).
 * @returns {TafelLayout}  knoepfe[].aktiv can be false where tafelInhalt said true (its line was dropped, listed in `weg`).
 */
export function tafelLayout(inhalt, px = TAFEL_PX) {
  const reihen = Math.max(1, Math.ceil(inhalt.knoepfe.length / KNOEPFE_JE_REIHE));
  const knopfOben = px.hoehe - RAND - reihen * KNOPF_H - (reihen - 1) * KNOPF_ABSTAND;
  const w = (px.breite - 2 * RAND - (KNOEPFE_JE_REIHE - 1) * KNOPF_ABSTAND) / KNOEPFE_JE_REIHE;
  const knoepfe = inhalt.knoepfe.map((k, i) => {
    const reihe = Math.floor(i / KNOEPFE_JE_REIHE);
    const spalte = i % KNOEPFE_JE_REIHE;
    return { ...k, x: RAND + spalte * (w + KNOPF_ABSTAND), y: knopfOben + reihe * (KNOPF_H + KNOPF_ABSTAND), w, h: KNOPF_H };
  });
  // height for the lines: from the top margin down to one button gap above the first button row, px
  const platz = knopfOben - KNOPF_ABSTAND - RAND;
  const gebrochen = inhalt.zeilen.map((z, i) => {
    let teile = umbrechen(z.text);
    if (z.maxTeile && teile.length > z.maxTeile) teile = [...teile.slice(0, z.maxTeile - 1), `${teile[z.maxTeile - 1]} …`];
    return { ...z, teile, i };
  });
  // height of a list of blocks: rows plus the gap between blocks (the last block has no gap below it), px
  const hoeheVon = (/** @type {typeof gebrochen} */ l) => l.reduce((n, z) => n + z.teile.length * ZEILE_PX + BLOCK_ABSTAND, 0) - (l.length ? BLOCK_ABSTAND : 0);
  const wert = (/** @type {(typeof gebrochen)[number]} */ z) => (z.fest ? 1000 : 0) + (z.rang ?? 0);
  let behalten = [...gebrochen];
  /** @type {typeof gebrochen} */
  const fallen = [];
  while (behalten.length && hoeheVon(behalten) > platz) {
    let k = 0;
    behalten.forEach((z, j) => { if (wert(z) < wert(behalten[k])) k = j; }); // strict <: among equals the upper (older) line goes
    fallen.push(behalten[k]);
    behalten.splice(k, 1);
  }
  // a big block that had to go may leave room for smaller, less important ones: put them back, most important first
  for (const z of [...fallen].sort((a, b) => wert(b) - wert(a))) {
    const probe = [...behalten, z].sort((a, b) => a.i - b.i);
    if (hoeheVon(probe) <= platz) { behalten = probe; fallen.splice(fallen.indexOf(z), 1); }
  }
  /** @type {Set<string>} */
  const weg = new Set(fallen.flatMap((z) => z.knoepfe ?? []));
  let y = RAND;
  const zeilen = behalten.map(({ i: _i, ...z }) => {
    const r = { ...z, y };
    y += z.teile.length * ZEILE_PX + BLOCK_ABSTAND;
    return r;
  });
  return { zeilen, knoepfe: knoepfe.map((k) => (weg.has(k.id) ? { ...k, aktiv: false } : k)), weg: [...weg], breite: px.breite, hoehe: px.hoehe };
}

/**
 * The button under a point of the panel.
 * @param {TafelLayout} layout
 * @param {number} u  0 (left) .. 1 (right).
 * @param {number} v  0 (top) .. 1 (bottom).
 * @returns {(TafelKnopf & {x: number, y: number, w: number, h: number})|null}  null outside every button.
 */
export function tafelKnopfBei(layout, u, v) {
  if (!(u >= 0 && u <= 1 && v >= 0 && v <= 1)) return null;
  const x = u * layout.breite;
  const y = v * layout.hoehe;
  return layout.knoepfe.find((k) => x >= k.x && x <= k.x + k.w && y >= k.y && y <= k.y + k.h) ?? null;
}

/** Dash pattern per outline form, px. */
const STRICH = { durchgezogen: [], gestrichelt: [14, 8], gepunktet: [3, 6] };

/**
 * Draws the panel onto a 2D context (the canvas of a CanvasTexture). Only the methods below are used, so a stand-in works in tests.
 * @param {{fillStyle: any, strokeStyle: any, lineWidth: number, font: string, textBaseline: any, textAlign?: any,
 *   fillRect: Function, strokeRect: Function, fillText: Function, setLineDash: Function}} ctx
 * @param {TafelLayout} layout
 * @param {string|null} [markiert]  Id of the button under a ray (drawn with a thicker outline).
 * @returns {void}
 */
export function tafelZeichnen(ctx, layout, markiert = null) {
  const F = TAFEL_FARBEN;
  ctx.setLineDash([]);
  ctx.fillStyle = F.flaeche;
  ctx.fillRect(0, 0, layout.breite, layout.hoehe);
  ctx.strokeStyle = F.text;
  ctx.lineWidth = 3;
  ctx.strokeRect(1.5, 1.5, layout.breite - 3, layout.hoehe - 3);
  ctx.textBaseline = "top";
  const farbe = (/** @type {TafelZeile["art"]} */ art) => (art === "fehler" ? F.fehler : art === "warnung" ? F.warnung : art === "leise" ? F.leise : F.text);
  for (const z of layout.zeilen) {
    ctx.font = z.art === "titel" ? "bold 28px sans-serif" : "26px sans-serif";
    ctx.fillStyle = farbe(z.art);
    z.teile.forEach((teil, i) => ctx.fillText(teil, RAND + 10, z.y + i * ZEILE_PX));
    if (z.rahmen) {
      ctx.setLineDash(STRICH[z.rahmen]);
      ctx.strokeStyle = z.art === "text" && z.rahmen === "gepunktet" ? F.fokus : farbe(z.art);
      ctx.lineWidth = 2;
      ctx.strokeRect(RAND, z.y - 4, layout.breite - 2 * RAND, z.teile.length * ZEILE_PX + 4);
      ctx.setLineDash([]);
    }
  }
  for (const k of layout.knoepfe) {
    // active primary = filled; active = solid outline; off = dotted outline and muted text (form, not only colour)
    if (k.aktiv && k.primaer) { ctx.fillStyle = F.primaer; ctx.fillRect(k.x, k.y, k.w, k.h); }
    ctx.setLineDash(k.aktiv ? [] : STRICH.gepunktet);
    ctx.strokeStyle = k.aktiv ? F.text : F.leise;
    ctx.lineWidth = markiert === k.id ? 6 : 2;
    ctx.strokeRect(k.x, k.y, k.w, k.h);
    ctx.setLineDash([]);
    ctx.font = "bold 24px sans-serif";
    ctx.fillStyle = k.aktiv ? (k.primaer ? F.primaerText : F.text) : F.leise;
    ctx.fillText(k.label, k.x + 12, k.y + k.h / 2 - 12);
  }
}
