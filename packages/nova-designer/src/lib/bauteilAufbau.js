// Bauphysik-Kern (Phase 44, PHYS-01/02): Schichtaufbau, U-Wert, Temperaturverlauf
// und Glaser-Verfahren (Tauwasser-Richtwert) — bewusst importfrei (Node-testbar).
//
// Konventionen:
// - Schichten laufen IMMER von INNEN (Index 0, raumseitig) nach AUSSEN.
//   WALL_COMPOSITES (buildingModel.js) listet außen→innen — aufbauFromComposite dreht.
// - Schicht = { material: <MATERIAL_KATALOG-id>, d: <mm>, name?: <Anzeigename> }.
// - x-Koordinate der Profile: 0 = raumseitige Oberfläche, wächst nach außen (mm).
//
// Ehrlichkeit (Haftung): alles hier sind [ASSUMED]-Richtwerte für den Konzept-
// Vergleich — KEIN Nachweis nach DIN 4108-3 / DIN EN ISO 6946 / GEG. Die
// Checks liefern deshalb nie "fail", nur pass/warn/offen (WB_STATUS-Muster).

// ---- Materialkatalog -------------------------------------------------------
// [ASSUMED] λ (W/mK) und μ (–): marktübliche Bemessungs-Richtwerte (Anlehnung an
// DIN 4108-4-Größenordnungen, je Spanne EIN Wert gewählt). sd (m) überschreibt
// μ·d bei Bahnen. luft: "ruhend" → R aus LUFTSCHICHT-Tabelle statt d/λ;
// "belueftet" → Schicht + alles Außenliegende zählt nicht (ISO-6946-Idee:
// stark belüftete Luftschicht, Rse wird durch Rsi ersetzt).
// schicht: Zuordnung zum bimClassification.SCHICHTEN-Bucket (null = keiner).
// color/hatch: Darstellung im Schichtstapel-SVG (hatch-Werte wie WALL_COMPOSITES).
export const MATERIAL_KATALOG = [
  { id: "beton", name: "Stahlbeton", kategorie: "Massiv", lambda: 2.3, mu: 100, schicht: "Stahlbeton", color: "#9aa6b2", hatch: "concrete" },
  { id: "ks", name: "Kalksandstein (1800)", kategorie: "Massiv", lambda: 0.99, mu: 10, schicht: "Kalksandstein", color: "#94a3b8", hatch: "block" },
  { id: "klinker", name: "Klinker / Vollziegel", kategorie: "Massiv", lambda: 0.81, mu: 100, schicht: "Klinker", color: "#b45309", hatch: "brick" },
  { id: "hlz", name: "Hochlochziegel (Poroton)", kategorie: "Massiv", lambda: 0.12, mu: 8, schicht: null, color: "#c2703d", hatch: "brick" },
  { id: "porenbeton", name: "Porenbeton", kategorie: "Massiv", lambda: 0.11, mu: 8, schicht: null, color: "#e5e7eb", hatch: "block" },
  { id: "mw035", name: "Mineralwolle WLG 035", kategorie: "Dämmung", lambda: 0.035, mu: 1, schicht: "Dämmung", color: "#fde68a", hatch: "insul" },
  { id: "mw040", name: "Mineralwolle WLG 040", kategorie: "Dämmung", lambda: 0.04, mu: 1, schicht: "Dämmung", color: "#fde68a", hatch: "insul" },
  { id: "eps032", name: "EPS WLG 032", kategorie: "Dämmung", lambda: 0.032, mu: 50, schicht: "Dämmung", color: "#f5f5f4", hatch: "insul" },
  { id: "xps", name: "XPS", kategorie: "Dämmung", lambda: 0.035, mu: 100, schicht: "Dämmung", color: "#a5f3fc", hatch: "insul" },
  { id: "pur", name: "PUR/PIR", kategorie: "Dämmung", lambda: 0.024, mu: 60, schicht: "Dämmung", color: "#fbcfe8", hatch: "insul" },
  { id: "holzfaser", name: "Holzfaserdämmung", kategorie: "Dämmung", lambda: 0.042, mu: 5, schicht: "Dämmung", color: "#d6b38a", hatch: "insul" },
  { id: "zellulose", name: "Zellulose (Einblas)", kategorie: "Dämmung", lambda: 0.04, mu: 2, schicht: "Dämmung", color: "#e7e5e4", hatch: "insul" },
  { id: "gk", name: "Gipskarton", kategorie: "Platte", lambda: 0.25, mu: 8, schicht: "Gipskarton", color: "#e2e8f0", hatch: "none" },
  { id: "osb", name: "OSB-Platte", kategorie: "Platte", lambda: 0.13, mu: 200, schicht: "Holz", color: "#d6b38a", hatch: "wood" },
  { id: "holz", name: "Nadelholz", kategorie: "Holz", lambda: 0.13, mu: 40, schicht: "Holz", color: "#92400e", hatch: "wood" },
  { id: "gipsputz", name: "Gipsputz (innen)", kategorie: "Putz", lambda: 0.51, mu: 10, schicht: "Putz", color: "#e2e8f0", hatch: "none" },
  { id: "kalkzementputz", name: "Kalkzementputz (außen)", kategorie: "Putz", lambda: 1.0, mu: 25, schicht: "Putz", color: "#d1d5db", hatch: "none" },
  { id: "lehmputz", name: "Lehmputz", kategorie: "Putz", lambda: 0.8, mu: 10, schicht: "Putz", color: "#ca8a04", hatch: "none" },
  { id: "dampfbremse", name: "Dampfbremse PE (sd 20 m)", kategorie: "Bahn", lambda: 0.2, mu: 1, sd: 20, schicht: null, color: "#60a5fa", hatch: "none" },
  { id: "bitumenbahn", name: "Bitumenbahn (sd 300 m)", kategorie: "Bahn", lambda: 0.17, mu: 1, sd: 300, schicht: null, color: "#334155", hatch: "none" },
  { id: "luft", name: "Luftschicht (ruhend)", kategorie: "Luft", lambda: null, mu: 1, luft: "ruhend", schicht: null, color: "#f1f5f9", hatch: "none" },
  { id: "luftbel", name: "Luftschicht (hinterlüftet)", kategorie: "Luft", lambda: null, mu: 1, luft: "belueftet", schicht: null, color: "#f1f5f9", hatch: "none" },
];

export const materialById = (id) => MATERIAL_KATALOG.find((m) => m.id === id) || null;

// ---- Wärmeübergangswiderstände (Wand, horizontaler Wärmestrom) -------------
// [ASSUMED] ISO-6946-Richtwerte; Dach/Boden bewusst nicht abgebildet (Wand-Fokus).
export const DEFAULT_RSI = 0.13;
export const DEFAULT_RSE = 0.04;
// Schimmel-Check rechnet die innere Oberfläche mit Rsi = 0,25 (DIN-4108-2-Konvention).
export const RSI_SCHIMMEL = 0.25;

// R ruhender Luftschichten (m²K/W), horizontaler Wärmestrom, [ASSUMED] ISO-6946-Tabelle.
export function luftschichtR(dMm) {
  const d = Number(dMm) || 0;
  if (d <= 0) return 0;
  if (d >= 25) return 0.18;
  if (d >= 15) return 0.17;
  if (d >= 10) return 0.15;
  if (d >= 7) return 0.13;
  if (d >= 5) return 0.11;
  return (0.11 * d) / 5; // grobe lineare Näherung unter 5 mm
}

// ---- Schichtgrößen ---------------------------------------------------------
// Dicke einer Schicht (mm), auf ≥ 0 geklemmt: negative d aus Direktaufrufen
// erzeugten sonst negative R/sd (bis U = 0 mit Pass-Check), nicht-monotones
// sd/x und Schein-Tauwasserzonen. Die UI klemmt bereits — hier die Wurzel.
const layerD = (l) => Math.max(0, Number(l?.d) || 0);

// R einer Schicht (m²K/W). Unbekanntes Material → 0 (wird in den Checks als
// "offen" sichtbar, weil hatUnbekannte greift — nie stillschweigend raten).
export function schichtR(layer) {
  const mat = materialById(layer?.material);
  if (!mat) return 0;
  if (mat.luft === "ruhend") return luftschichtR(layerD(layer));
  if (mat.luft === "belueftet") return 0; // Sonderfall — uWert schneidet ab
  if (!mat.lambda) return 0;
  return layerD(layer) / 1000 / mat.lambda;
}

// sd einer Schicht (m): Bahnen mit festem sd, sonst μ·d.
export function schichtSd(layer) {
  const mat = materialById(layer?.material);
  if (!mat) return 0;
  if (mat.sd != null) return mat.sd;
  return (layerD(layer) / 1000) * (mat.mu || 1);
}

// Wirksame Schichten: ab der ersten stark belüfteten Luftschicht (von innen)
// zählt nichts mehr — dort liegt praktisch Außenklima an, Rse → Rsi.
export function wirksameSchichten(layers) {
  const list = Array.isArray(layers) ? layers : [];
  const idx = list.findIndex((l) => materialById(l?.material)?.luft === "belueftet");
  if (idx < 0) return { layers: list, belueftet: false, abgeschnitten: [] };
  return { layers: list.slice(0, idx), belueftet: true, abgeschnitten: list.slice(idx) };
}

// ---- U-Wert -----------------------------------------------------------------
// U = 1 / (Rsi + ΣR + Rse). Bei Hinterlüftung: Rse durch Rsi ersetzt,
// äußere Schichten ignoriert (ISO-6946-Vereinfachung).
export function uWert(layers, { rsi = DEFAULT_RSI, rse = DEFAULT_RSE } = {}) {
  const eff = wirksameSchichten(layers);
  const rseEff = eff.belueftet ? rsi : rse;
  const rList = eff.layers.map((l) => schichtR(l));
  const rSum = rList.reduce((s, r) => s + r, 0);
  const RT = rsi + rSum + rseEff;
  const hatUnbekannte = eff.layers.some((l) => !materialById(l?.material));
  return {
    U: RT > 0 ? 1 / RT : 0,
    RT,
    rList,
    rSum,
    belueftet: eff.belueftet,
    rseEff,
    effLayers: eff.layers,
    abgeschnitten: eff.abgeschnitten,
    hatUnbekannte,
  };
}

// ---- Temperaturverlauf ------------------------------------------------------
// θ(x) über den wirksamen Schichten; Punkte an allen Grenzflächen inkl.
// Oberflächen. x = 0 an der raumseitigen Oberfläche.
export function temperaturVerlauf(layers, { thetaI = 20, thetaE = -5, rsi = DEFAULT_RSI, rse = DEFAULT_RSE } = {}) {
  const u = uWert(layers, { rsi, rse });
  const dT = thetaI - thetaE;
  const q = u.RT > 0 ? dT / u.RT : 0; // W/m² je K-Normierung steckt in RT
  const pts = [];
  let rCum = rsi;
  let xMm = 0;
  pts.push({ xMm: 0, theta: thetaI - q * rCum }); // innere Oberfläche θ_si
  u.effLayers.forEach((l, i) => {
    rCum += u.rList[i];
    xMm += layerD(l);
    pts.push({ xMm, theta: thetaI - q * rCum });
  });
  const thetaSe = thetaI - q * (rCum + u.rseEff); // = thetaE (Kontrolle)
  return { punkte: pts, thetaSi: pts[0]?.theta ?? thetaI, thetaSe, q, U: u.U, RT: u.RT };
}

// ---- Feuchte: Magnus-Formel -------------------------------------------------
// Sättigungsdampfdruck p_sat (Pa), Magnus mit Sonntag-Koeffizienten:
// über Wasser (θ ≥ 0) bzw. über Eis (θ < 0). [ASSUMED] Richtwert-Formel.
export function pSat(theta) {
  const t = Number(theta) || 0;
  return t >= 0
    ? 611.2 * Math.exp((17.62 * t) / (243.12 + t))
    : 611.2 * Math.exp((22.46 * t) / (272.62 + t));
}

// Taupunkt (°C) aus Dampfdruck p (Pa) — inverse Magnus über Wasser.
export function taupunkt(p) {
  const v = Math.log(Math.max(1e-6, Number(p) || 0) / 611.2);
  return (243.12 * v) / (17.62 - v);
}

// Taupunkt aus Lufttemperatur + rel. Feuchte (%) — Komfort-Helfer fürs Panel.
export function taupunktAusLuft(theta, phiPct) {
  return taupunkt((Math.max(0, Math.min(100, phiPct)) / 100) * pSat(theta));
}

// ---- Glaser-Verfahren (vereinfacht) ------------------------------------------
// Dampfdruck p verläuft linear über sd; p_sat folgt θ(x). Tauwasser dort, wo
// p > p_sat. Da p_sat(x) INNERHALB einer Schicht konvex ist (exp einer in x
// linearen Temperatur), kann die Überschreitung auch im Schichtinneren liegen —
// deshalb wird jede Schicht mit `samples` Zwischenpunkten abgetastet.
// VEREINFACHUNG (dokumentiert): keine Tangenten-Konstruktion, keine
// Tauwassermengen-/Verdunstungsbilanz — reine Zonen-Erkennung als Richtwert.
export function glaser(layers, {
  thetaI = 20, phiI = 50, thetaE = -5, phiE = 80,
  rsi = DEFAULT_RSI, rse = DEFAULT_RSE, samples = 10,
} = {}) {
  const u = uWert(layers, { rsi, rse });
  const dT = thetaI - thetaE;
  const q = u.RT > 0 ? dT / u.RT : 0;
  const pI = (Math.max(0, Math.min(100, phiI)) / 100) * pSat(thetaI);
  const pE = (Math.max(0, Math.min(100, phiE)) / 100) * pSat(thetaE);
  const sdGesamt = u.effLayers.reduce((s, l) => s + schichtSd(l), 0);
  // Ohne Diffusionskennwerte (sd gesamt = 0, z.B. alle Schichten katalogfremd
  // oder gar keine) ist der lineare p-Verlauf nicht definiert — der Fallback
  // p = pI erzeugte eine Schein-Tauwasserzone über den ganzen Querschnitt.
  // Zonen-Erkennung überspringen; Aufrufer zeigen den Check als "offen".
  const glaserOffen = sdGesamt <= 0;

  const punkte = [];
  let rCum = rsi;
  let sdCum = 0;
  let xMm = 0;
  const push = (x, r, sd) => {
    const theta = thetaI - q * r;
    const p = sdGesamt > 0 ? pI + ((pE - pI) * sd) / sdGesamt : pI;
    punkte.push({ xMm: x, sd, theta, psat: pSat(theta), p, taupunkt: taupunkt(p) });
  };
  push(0, rCum, 0); // innere Oberfläche
  u.effLayers.forEach((l, i) => {
    const dR = u.rList[i];
    const dSd = schichtSd(l);
    const dX = layerD(l);
    const n = Math.max(1, Math.round(samples));
    for (let k = 1; k <= n; k++) {
      const f = k / n;
      push(xMm + dX * f, rCum + dR * f, sdCum + dSd * f);
    }
    rCum += dR;
    sdCum += dSd;
    xMm += dX;
  });

  // Zusammenhängende Tauwasser-Zonen (p über p_sat; 0,5 Pa gegen Float-Rauschen).
  const zonen = [];
  if (!glaserOffen) {
    let offen = null;
    punkte.forEach((pt) => {
      const nass = pt.p - pt.psat > 0.5;
      if (nass && !offen) offen = { vonMm: pt.xMm, bisMm: pt.xMm };
      else if (nass && offen) offen.bisMm = pt.xMm;
      else if (!nass && offen) { zonen.push(offen); offen = null; }
    });
    if (offen) zonen.push(offen);
  }

  // Schimmel-Richtwert f_Rsi mit Rsi = 0,25 (DIN-4108-2-Konvention).
  const RT025 = u.RT - rsi + RSI_SCHIMMEL;
  const thetaSi025 = thetaI - (dT * RSI_SCHIMMEL) / (RT025 > 0 ? RT025 : 1);
  const fRsi = dT !== 0 ? (thetaSi025 - thetaE) / dT : 1;

  return {
    punkte, zonen, tauwasser: zonen.length > 0, glaserOffen,
    sdGesamt, U: u.U, RT: u.RT, q,
    pI, pE, thetaSi: punkte[0]?.theta ?? thetaI, fRsi,
    belueftet: u.belueftet, hatUnbekannte: u.hatUnbekannte,
  };
}

// ---- Checks (pass/warn/offen — nie "fail", Haftung) --------------------------
// [ASSUMED] U-Referenz 0,28 W/(m²K) = GEG-Referenzgebäude Außenwand (Richtwert).
export const U_REFERENZ_AUSSENWAND = 0.28;

export function bauphysikChecks({ U = 0, tauwasser = false, fRsi = 1, hatSchichten = false, hatUnbekannte = false, glaserOffen = false } = {}) {
  if (!hatSchichten) {
    const items = [
      { key: "uwert", label: "U-Wert", status: "offen", detail: "Keine Schichten definiert." },
      { key: "tauwasser", label: "Tauwasser (Glaser-Richtwert)", status: "offen", detail: "Keine Schichten definiert." },
      { key: "schimmel", label: "Schimmel-Richtwert f_Rsi", status: "offen", detail: "Keine Schichten definiert." },
    ];
    return { items, ampel: "offen" };
  }
  const items = [
    U <= U_REFERENZ_AUSSENWAND
      ? { key: "uwert", label: "U-Wert", status: "pass", detail: `U ≤ ${U_REFERENZ_AUSSENWAND} W/(m²K) — GEG-Referenzwert Außenwand [ASSUMED].` }
      : { key: "uwert", label: "U-Wert", status: "warn", detail: `U über Referenzwert Außenwand (${U_REFERENZ_AUSSENWAND} W/(m²K)) — Dämmung prüfen.` },
    // glaserOffen (sd gesamt = 0): weder pass noch warn wäre ehrlich — "offen".
    glaserOffen
      ? { key: "tauwasser", label: "Tauwasser (Glaser-Richtwert)", status: "offen", detail: "Keine Diffusionskennwerte (sd gesamt = 0) — Glaser-Richtwert nicht auswertbar." }
      : tauwasser
        ? { key: "tauwasser", label: "Tauwasser (Glaser-Richtwert)", status: "warn", detail: "Tauwasserausfall im Querschnitt möglich — Aufbau prüfen (kein DIN-4108-3-Nachweis)." }
        : { key: "tauwasser", label: "Tauwasser (Glaser-Richtwert)", status: "pass", detail: "Kein Tauwasserausfall im Richtwert-Verfahren." },
    fRsi >= 0.7
      ? { key: "schimmel", label: "Schimmel-Richtwert f_Rsi", status: "pass", detail: `f_Rsi = ${fRsi.toFixed(2)} ≥ 0,70 (Richtwert DIN 4108-2).` }
      : { key: "schimmel", label: "Schimmel-Richtwert f_Rsi", status: "warn", detail: `f_Rsi = ${fRsi.toFixed(2)} < 0,70 — Oberflächentemperatur kritisch (Richtwert).` },
  ];
  if (hatUnbekannte) {
    items.push({ key: "material", label: "Materialkennwerte", status: "warn", detail: "Mindestens eine Schicht ohne Katalog-Kennwerte — sie geht mit R = 0 ein." });
  }
  const ampel = items.some((i) => i.status === "warn") ? "warn" : "pass";
  return { items, ampel };
}

// ---- Brücke zu WALL_COMPOSITES ----------------------------------------------
// Nimmt ein Composite-OBJEKT (kein Import — Aufrufer reicht compositeById(...)
// aus @core/lib/buildingModel durch). Skins laufen dort außen→innen und tragen
// seit Phase 44 eine material-Id; hier wird gedreht und gemappt.
export function aufbauFromComposite(composite) {
  const skins = composite?.skins || [];
  const layers = [];
  const unbekannt = [];
  [...skins].reverse().forEach((sk) => {
    const mat = materialById(sk.material);
    if (!mat) unbekannt.push(sk.name);
    layers.push({ material: mat ? mat.id : null, d: Math.max(0, Number(sk.thickness) || 0), name: sk.name });
  });
  return { layers, unbekannt };
}
