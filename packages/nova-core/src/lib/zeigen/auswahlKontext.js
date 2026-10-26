// 106-02: the selection as context for speech and agents (phase 106 guard rails 3 and 4). What is
// selected is a plain data record the viewer reads off its own selection: GUID (ground truth from
// the ray or from a GUID command, never from an image), IFC class, name, storey, data sheet and
// where the element sits on the screen. A command that says "dieses" without a selection is
// refused (auswahlErforderlich), never guessed.
//
// Pure: no DOM, no React. The viewers (IFC viewer, BIM studio) resolve their own elements and hand
// in plain bauteile; the camera is only read for the projection.
//
// In:  bauteile [{guid, klasse, name, geschoss, steckbrief, mittelpunkt:[x,y,z] m}], optional
//      {kamera (THREE.Camera), breite, hoehe} in px for the screen position, optional {gesamt, verworfen}.
// Out: {anzahl, gekuerzt, ohneGuid, bauteile:[{guid, klasse, name, geschoss, steckbrief, bildschirm}]}.
import * as THREE from "three";

/** Refusal text of every command that needs a selection (106-03 uses it for "dieses/diese/dort"). */
export const KEINE_AUSWAHL_TEXT = "Keine Auswahl — erst ein Bauteil zeigen oder mit auswahl-guid wählen";

/** Refusal text when something is selected but nothing of it has a GUID (ground truth is the GUID, guard rail 3). */
export const KEIN_GUID_TEXT = "Die Auswahl hat keine GUID (z. B. generierte Öffnung oder Bauteil ohne GlobalId) — ein Befehl auf „dieses“ ist hier nicht möglich";

/** Most elements listed in the selection record of a big multi selection (the total is still reported) [ASSUMED: keeps one record readable for an agent]. */
export const AUSWAHL_KONTEXT_MAX = 200;

/**
 * Compact data sheet for agents: only what the sheet decides or derives, including where each
 * value comes from (`quelle`: gesetzt | abgeleitet | offen) so an assumption is never read as a
 * decision. A missing sheet yields all-null fields and lists them as open.
 * `menge`, `tragend` and `gewerkGrob` come from the type default or from geometry; when the sheet's `quelle`
 * does not name them they are marked `abgeleitet` (or `offen` when null), never left unmarked.
 * @param {any} sb  Result of steckbrief() (@core/lib/bauteil/steckbrief.js) or a compatible object; may be null.
 * @returns {{typ: string|null, label: string|null, kg: string|null, gewerk: {lb: string, name: string}|null, gewerkGrob: string|null,
 *   material: string|null, status: string|null, menge: {wert: number, einheit: string}|null,
 *   bauabschnitt: string|null, tragend: boolean|null, feuerwiderstand: string|null, statik_vermerk: string|null,
 *   quelle: Record<string, string>, offen: string[]}}
 */
export function steckbriefKurz(sb) {
  const s = sb && typeof sb === "object" ? sb : {};
  const gewerk = s.gewerk && typeof s.gewerk === "object" ? { lb: String(s.gewerk.lb ?? ""), name: String(s.gewerk.name ?? "") } : null;
  const felder = ["kg", "gewerk", "material", "status"];
  const menge = s.menge && typeof s.menge === "object" ? { wert: Number(s.menge.wert), einheit: String(s.menge.einheit ?? "") } : null;
  const tragend = typeof s.tragend === "boolean" ? s.tragend : null;
  const quelle = s.quelle && typeof s.quelle === "object" ? { ...s.quelle } : {};
  const offen = Array.isArray(s.offen) ? [...s.offen] : sb ? [] : felder;
  // these fields come from the type default or from geometry and carry no `quelle` of their own in the sheet
  if (sb) {
    for (const [feld, wert] of [["menge", menge], ["tragend", tragend], ["gewerkGrob", s.gewerkGrob ?? null]]) {
      if (quelle[feld]) continue;
      quelle[feld] = wert == null ? "offen" : "abgeleitet";
    }
    for (const [feld, v] of Object.entries(quelle)) if (v === "offen" && !offen.includes(feld)) offen.push(feld);
  }
  return {
    typ: s.typ ?? null,
    label: s.label ?? null,
    kg: s.kg ?? null,
    gewerk,
    gewerkGrob: s.gewerkGrob ?? null,
    material: s.material ?? null,
    status: s.status ?? null,
    menge,
    bauabschnitt: s.bauabschnitt ?? null,
    tragend,
    // 106-03: set through the change tools (aenderungen.js EIGENSCHAFTEN); null when never set
    feuerwiderstand: s.feuerwiderstand ?? null,
    statik_vermerk: s.statik_vermerk ?? null,
    quelle,
    offen,
  };
}

/**
 * Screen position of a world point in pixels (origin top left, like pointer events on the canvas).
 * @param {[number, number, number]|number[]|null|undefined} punkt  World point in m (scene coordinates).
 * @param {{kamera?: THREE.Camera|null, breite?: number, hoehe?: number}} opt
 *   kamera: camera whose cached matrices are used (only refreshed, not moved); breite/hoehe: canvas size in px.
 * @returns {{x: number, y: number, imBild: boolean}|null}  null without camera, size or point, and for a
 *   point behind the camera; imBild is false when it lies in front of the camera but outside the canvas.
 */
export function bildschirmPunkt(punkt, opt = {}) {
  const { kamera, breite, hoehe } = opt;
  if (!kamera || !(breite > 0) || !(hoehe > 0) || !Array.isArray(punkt) || punkt.length < 3) return null;
  const [px, py, pz] = punkt.map(Number);
  if (![px, py, pz].every(Number.isFinite)) return null;
  kamera.updateMatrixWorld?.();
  const v = new THREE.Vector3(px, py, pz).project(kamera);
  if (![v.x, v.y, v.z].every(Number.isFinite) || v.z > 1) return null; // z > 1: behind the camera / beyond far
  const x = Math.round(((v.x + 1) / 2) * breite * 10) / 10;
  const y = Math.round(((1 - v.y) / 2) * hoehe * 10) / 10;
  return { x, y, imBild: x >= 0 && x <= breite && y >= 0 && y <= hoehe && v.z >= -1 };
}

/**
 * The selection as context record.
 * @param {Array<{guid?: string|null, klasse?: string|null, name?: string|null, geschoss?: string|null,
 *   steckbrief?: any, mittelpunkt?: number[]|null}>} bauteile  Selected elements, already resolved by the viewer
 *   (at most AUSWAHL_KONTEXT_MAX of a big multi selection); `mittelpunkt` in m.
 * @param {{kamera?: THREE.Camera|null, breite?: number, hoehe?: number, gesamt?: number, verworfen?: number}} [opt]
 *   kamera/breite/hoehe: camera and canvas size in px for `bildschirm`; gesamt: number of elements of the whole
 *   selection when `bauteile` is only its head; verworfen: number of selected entries the viewer could not resolve
 *   to an element with a GUID, reported in `ohneGuid`.
 * @returns {{anzahl: number, gekuerzt: boolean, ohneGuid: number, bauteile: Array<{guid: string|null, klasse: string|null, name: string, geschoss: string|null,
 *   steckbrief: ReturnType<typeof steckbriefKurz>, bildschirm: {x: number, y: number, imBild: boolean}|null}>}}
 *   anzahl: elements selected in total (the list may be shorter, then `gekuerzt` is true); ohneGuid: selected
 *   entries without a GUID (listed with guid null, or dropped by the viewer and counted via `verworfen`).
 */
export function auswahlKontext(bauteile, opt = {}) {
  const liste = Array.isArray(bauteile) ? bauteile : [];
  const gesamt = typeof opt.gesamt === "number" && Number.isFinite(opt.gesamt) ? opt.gesamt : 0;
  const verworfen = typeof opt.verworfen === "number" && opt.verworfen > 0 ? opt.verworfen : 0;
  const anzahl = Math.max(liste.length, gesamt);
  return {
    anzahl,
    gekuerzt: anzahl > liste.length,
    ohneGuid: liste.filter((b) => !b?.guid).length + verworfen,
    bauteile: liste.map((b) => ({
      guid: b?.guid ? String(b.guid) : null,
      klasse: b?.klasse ?? null,
      name: b?.name ? String(b.name) : "",
      geschoss: b?.geschoss ?? null,
      steckbrief: steckbriefKurz(b?.steckbrief),
      bildschirm: bildschirmPunkt(b?.mittelpunkt, opt),
    })),
  };
}

/**
 * Guard for every command that acts on "dieses": throws the refusal text when nothing is selected, and
 * another one when something is selected but no selected element has a GUID (nothing to anchor on).
 * @template {{anzahl: number, ohneGuid?: number, bauteile?: Array<{guid?: string|null}>}} K
 * @param {K} kontext  Result of auswahlKontext().
 * @returns {K}  The same context when at least one selected element has a GUID.
 * @throws {Error} KEINE_AUSWAHL_TEXT when nothing is selected; KEIN_GUID_TEXT when only GUID-less entries are.
 */
export function auswahlErforderlich(kontext) {
  if (!kontext || (!(kontext.anzahl > 0) && !(Number(kontext.ohneGuid) > 0))) throw new Error(KEINE_AUSWAHL_TEXT);
  const liste = Array.isArray(kontext.bauteile) ? kontext.bauteile : [];
  if (!(kontext.anzahl > 0) || (liste.length > 0 && !liste.some((b) => b?.guid))) throw new Error(KEIN_GUID_TEXT);
  return kontext;
}
