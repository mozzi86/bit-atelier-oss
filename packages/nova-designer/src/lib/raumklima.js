// Raumklima-Kern (Phase 45, KLIMA-02/04/05): Fenster→Raum-Zuordnung,
// Orientierung aus der Wandnormalen, Screening-Ranking "kritischster Raum je
// Geschoss" und vereinfachtes Sonneneintragskennwert-Verfahren in Anlehnung an
// DIN 4108-2:2013 Abschnitt 8.3 — bewusst importfrei (Node-testbar).
//
// Konventionen:
// - Koordinaten wie buildingModel: XZ-Ebene in Metern, Footprint zentriert.
//   Im Grundriss ist −z "oben"; ohne Nordabweichung gilt −z = Nord, +x = Ost.
// - northAngle (Grad, im Uhrzeigersinn): Kompass-Azimut der Grundriss-"oben"-
//   Richtung. 0 = oben ist Norden (Standard, Karten-Konvention der App).
// - Räume = customZones {points:[{x,z}], level, name}; Fenster normalisiert als
//   {level, edge, u, breite, hoehe, g} (Aufrufer löst WINDOW_TYPES auf).
//
// Ehrlichkeit (Haftung): [ASSUMED]-Richtwerte für den Konzept-Vergleich —
// KEIN Nachweis nach DIN 4108-2. Die Checks liefern nie "fail", nur
// pass/warn/offen (WB_STATUS-Muster). Tabellenwerte S1–S6 nach
// DIN 4108-2:2013 Tabelle 8, Zeilen Wohngebäude (übernommen aus dem
// Forschungsbericht IBH 827/11, Maas/Schlitzberger, Tabelle 2-1).

// ---- Geometrie (XZ-Meter) ---------------------------------------------------
// Vorzeichenbehaftete Shoelace-Fläche: das Vorzeichen kodiert die Umlauf-
// richtung des Polygons und bestimmt die Außenseite jeder Kante — im Gegensatz
// zum Schwerpunkt-Test auch bei konkaven (L-/U-) Footprints korrekt.
export const polygonSignedAreaXZ = (pts) => {
  const p = Array.isArray(pts) ? pts : [];
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const q = p[(i + 1) % p.length];
    a += p[i].x * q.z - q.x * p[i].z;
  }
  return a / 2;
};

export const polygonAreaXZ = (pts) => Math.abs(polygonSignedAreaXZ(pts));

export const polygonCentroid = (pts) => {
  const p = Array.isArray(pts) ? pts : [];
  if (!p.length) return { x: 0, z: 0 };
  return {
    x: p.reduce((s, q) => s + q.x, 0) / p.length,
    z: p.reduce((s, q) => s + q.z, 0) / p.length,
  };
};

// Ray-Casting-Test (Strahl in +x); Randpunkte zählen konventionsgemäß halb.
export function pointInPolygon(p, pts) {
  const poly = Array.isArray(pts) ? pts : [];
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.z > p.z) !== (b.z > p.z)
      && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

// Außennormale eines Wandsegments {a,b} (Einheitsvektor). umlauf = Vorzeichen
// der Shoelace-Fläche des Footprints (Math.sign(polygonSignedAreaXZ(...))) —
// deterministisch je Kante, auch bei konkaven Footprints (der frühere
// Schwerpunkt-Test wählte an einspringenden L-/U-Ecken die Innenseite).
export function outwardNormal(wall, umlauf = 1) {
  const len = Math.hypot(wall.b.x - wall.a.x, wall.b.z - wall.a.z) || 1;
  const dx = (wall.b.x - wall.a.x) / len, dz = (wall.b.z - wall.a.z) / len;
  return (Number(umlauf) >= 0) ? { nx: dz, nz: -dx } : { nx: -dz, nz: dx };
}

// Kompass-Azimut (0° = N, 90° = O, 180° = S, 270° = W) der Außennormalen.
export function azimutFromNormal(n, northAngle = 0) {
  const planWinkel = (Math.atan2(n.nx, -n.nz) * 180) / Math.PI; // von "oben" im UZS
  return ((planWinkel + (Number(northAngle) || 0)) % 360 + 360) % 360;
}

const ORIENT_SEKTOREN = ["N", "NO", "O", "SO", "S", "SW", "W", "NW"];
export const orientierungsLabel = (azimut) =>
  ORIENT_SEKTOREN[Math.round((((azimut % 360) + 360) % 360) / 45) % 8];

// Screening-Gewichte je Orientierung ([ASSUMED], südwest-gewichtet: West-/
// Südwestfenster treffen die Nachmittagsspitze, Nordfenster fast nur diffus).
export const ORIENT_FAKTOR = { N: 0.3, NO: 0.4, O: 0.7, SO: 0.9, S: 1.0, SW: 1.0, W: 0.95, NW: 0.5 };
export const orientFaktor = (azimut) => ORIENT_FAKTOR[orientierungsLabel(azimut)] ?? 0.5;

// Nord-Sektor im Sinne der DIN-Zeile S5 (Nord-, Nordost-, Nordwest-orientiert).
export const istNordFenster = (azimut) => ["N", "NO", "NW"].includes(orientierungsLabel(azimut));

// ---- Fenster → Raum ----------------------------------------------------------
// Fenstermitte auf der Wand + kleiner Schritt nach INNEN (halbe Wanddicke +
// 0,2 m), dann Punkt-im-Polygon gegen die Räume desselben Geschosses.
export function fensterWeltpunkt(fenster, wand, umlauf = 1, wandDicke = 0.3) {
  const len = Math.hypot(wand.b.x - wand.a.x, wand.b.z - wand.a.z) || 1;
  const dx = (wand.b.x - wand.a.x) / len, dz = (wand.b.z - wand.a.z) / len;
  const n = outwardNormal(wand, umlauf);
  const t = (Number(wandDicke) || 0.3) / 2 + 0.2;
  return {
    x: wand.a.x + dx * fenster.u - n.nx * t,
    z: wand.a.z + dz * fenster.u - n.nz * t,
    normal: n,
  };
}

/**
 * Ordnet normalisierte Hüllfenster den Räumen (customZones) zu und bestimmt
 * ihre Orientierung. Fenster ohne umschließenden Raum landen in `ohneRaum`
 * (ehrlich ausgewiesen, kein stilles Raten).
 * @param fenster [{level, edge, u, breite, hoehe, g}]
 * @param waende  Hüllwände des Modells [{a,b,level,edge,thickness}]
 * @param zonen   Räume [{points, level, name}]
 * @param northAngle Kompass-Azimut der Grundriss-"oben"-Richtung (Grad)
 */
export function fensterZuRaeumen({ fenster = [], waende = [], zonen = [], northAngle = 0 } = {}) {
  const zentrum = polygonCentroid(waende.flatMap((w) => [w.a, w.b]));
  // Umlaufrichtung des Footprints (aus den Kanten EINES Geschosses in
  // edge-Reihenfolge rekonstruiert) — bestimmt die Außenseite jeder Wand.
  const fpLevel = waende[0]?.level ?? 0;
  const fpPunkte = waende
    .filter((w) => w.level === fpLevel)
    .sort((a, b) => a.edge - b.edge)
    .map((w) => w.a);
  const umlauf = Math.sign(polygonSignedAreaXZ(fpPunkte)) || 1;
  const proRaum = new Map(); // key -> { zone, fenster: [] }
  const raumKey = (z) => `${z?.level ?? 0}:${z?.name ?? "Raum"}`;
  zonen.forEach((z) => { if (!proRaum.has(raumKey(z))) proRaum.set(raumKey(z), { zone: z, fenster: [] }); });
  const ohneRaum = [];

  fenster.forEach((f) => {
    const wand = waende.find((w) => w.level === f.level && w.edge === f.edge);
    if (!wand) { ohneRaum.push(f); return; }
    const p = fensterWeltpunkt(f, wand, umlauf, wand.thickness);
    const azimut = azimutFromNormal(p.normal, northAngle);
    const eintrag = {
      ...f,
      azimut,
      orient: orientierungsLabel(azimut),
      flaeche: Math.max(0, (Number(f.breite) || 0) * (Number(f.hoehe) || 0)),
    };
    const treffer = zonen.find((z) => z.level === f.level && pointInPolygon(p, z.points));
    if (treffer) proRaum.get(raumKey(treffer)).fenster.push(eintrag);
    else ohneRaum.push(eintrag);
  });

  return { proRaum, ohneRaum, zentrum };
}

// ---- Stufe 1: Screening-Ranking ----------------------------------------------
// Kennwert = Σ(Fensterfläche · Orientierungsfaktor) / Raumfläche, oberstes
// Geschoss mit Dachzuschlag ([ASSUMED] ×1,2 — Wärmeeintrag übers Dach).
export const DACH_ZUSCHLAG = 1.2;

// Freistellungsgrenzen des grundflächenbezogenen Fensterflächenanteils
// (DIN 4108-2 Abs. 8.2.2, senkrechte Fenster): unterhalb ist kein Nachweis
// erforderlich. 10 % allgemein, 15 % wenn alle Fenster nordorientiert.
export const FREISTELLUNG_FWG = 0.10;
export const FREISTELLUNG_FWG_NORD = 0.15;

export function screeningJeGeschoss({ proRaum, storeys = 1 } = {}) {
  const raeume = [...(proRaum?.values() || [])].map(({ zone, fenster }) => {
    const flaeche = polygonAreaXZ(zone.points);
    const fensterFlaeche = fenster.reduce((s, f) => s + f.flaeche, 0);
    const gewichtet = fenster.reduce((s, f) => s + f.flaeche * orientFaktor(f.azimut), 0);
    const dachRaum = (zone.level ?? 0) === storeys - 1;
    const fWG = flaeche > 0 ? fensterFlaeche / flaeche : 0;
    const alleNord = fenster.length > 0 && fenster.every((f) => istNordFenster(f.azimut));
    return {
      key: `${zone.level ?? 0}:${zone.name ?? "Raum"}`,
      name: zone.name ?? "Raum",
      level: zone.level ?? 0,
      flaeche,
      fenster,
      fensterFlaeche,
      fWG,
      dachRaum,
      nachweisFrei: fWG < (alleNord ? FREISTELLUNG_FWG_NORD : FREISTELLUNG_FWG),
      kennwert: flaeche > 0 ? (gewichtet / flaeche) * (dachRaum ? DACH_ZUSCHLAG : 1) : 0,
    };
  });

  const geschosse = new Map();
  raeume.forEach((r) => {
    if (!geschosse.has(r.level)) geschosse.set(r.level, []);
    geschosse.get(r.level).push(r);
  });
  geschosse.forEach((list) => list.sort((a, b) => b.kennwert - a.kennwert));
  return { raeume, geschosse };
}

// ---- Stufe 2: Sonneneintragskennwert (Anlehnung DIN 4108-2 Abschn. 8.3) -------
// S_vorh = Σ(A_w,j · g_total,j) / A_G mit g_total = g·Fc (DIN 4108-2 Gl. 3,
// g = g⊥ nach EN 410 — der 0,9-Faktor F_W gehört zum Heizfall nach
// DIN V 4108-6/18599, NICHT hierher). S_zul = Σ S_x nach Tabelle 8.

// S1 (Wohngebäude): Nachtlüftung × Bauart × Klimaregion A/B/C.
export const S1_WOHN = {
  ohne: { leicht: [0.071, 0.056, 0.041], mittel: [0.080, 0.067, 0.054], schwer: [0.087, 0.074, 0.061] },
  erhoeht: { leicht: [0.098, 0.088, 0.078], mittel: [0.114, 0.103, 0.092], schwer: [0.125, 0.113, 0.101] },
  hoch: { leicht: [0.128, 0.117, 0.105], mittel: [0.160, 0.152, 0.143], schwer: [0.181, 0.171, 0.160] },
};
export const KLIMAREGIONEN = ["A", "B", "C"];
// S2 (Wohngebäude): a − b·f_WG.
export const S2_WOHN = { a: 0.060, b: 0.231 };
// S3: Sonnenschutzglas g ≤ 0,4.
export const S3_SONNENSCHUTZGLAS = 0.03;
// S5: +0,10·f_nord (Anteil N/NO/NW-Fenster an der Gesamt-Fensterfläche).
export const S5_NORD = 0.10;
// S6 (passive Kühlung, im Modell nicht abgebildet → 0; Werte dokumentiert):
export const S6_PASSIV = { leicht: 0.02, mittel: 0.04, schwer: 0.06 };

// Fc-Anhaltswerte für Sonnenschutzvorrichtungen (DIN 4108-2, Auswahl).
export const FC_OPTIONEN = [
  { id: "ohne", name: "ohne Sonnenschutz", fc: 1.0 },
  { id: "innen", name: "innenliegend, helle Farben", fc: 0.8 },
  { id: "jalousie", name: "außen: Jalousie", fc: 0.4 },
  { id: "rollladen", name: "außen: Rollladen/Fensterladen", fc: 0.3 },
  { id: "lamellen", name: "außen: drehbare Lamellen, hinterlüftet", fc: 0.25 },
  { id: "markise", name: "Markise/Vordach", fc: 0.5 },
];

// Sommer-Klimaregion aus dem Höchstwert der mittleren Monatstemperatur
// (DIN-Definition: A ≤ 16,5 °C < B < 18 °C ≤ C). months = useSiteClimate-Form.
export function klimaregionAusKlima(months) {
  const temps = (months || []).map((m) => m?.temp).filter((t) => Number.isFinite(t));
  if (!temps.length) return null;
  const max = Math.max(...temps);
  if (max < 16.5) return "A";
  if (max < 18) return "B";
  return "C";
}

// Bauart-Vorschlag aus dem Hüllwand-Composite ([ASSUMED]: Massivbau schwer,
// Holzrahmen leicht; maßgeblich ist C_wirk/A_G nach DIN — hier nur Vorschlag).
export function bauartVorschlag(compositeId) {
  if (compositeId === "timber") return "leicht";
  if (compositeId === "single24" || compositeId === "cavity") return "schwer";
  return "mittel";
}

/**
 * Vereinfachter Sonneneintragskennwert-Vergleich für EINEN Raum.
 * @param raum   Screening-Raum ({fenster, flaeche, fensterFlaeche, fWG})
 * @param klimaregion "A"|"B"|"C"
 * @param bauart "leicht"|"mittel"|"schwer"
 * @param nachtlueftung "ohne"|"erhoeht"|"hoch"
 * @param fc     Abminderungsfaktor Sonnenschutz (g_total = g·Fc)
 * @param sonnenschutzglas true, wenn Verglasung g ≤ 0,4 (Zeile S3)
 */
export function sonneneintrag(raum, {
  klimaregion = "B", bauart = "mittel", nachtlueftung = "erhoeht", fc = 1.0, sonnenschutzglas = false,
} = {}) {
  const AG = Math.max(0, Number(raum?.flaeche) || 0);
  const fenster = raum?.fenster || [];
  if (AG <= 0 || !fenster.length) {
    return { anwendbar: false, sVorh: 0, sZul: 0, anteile: null };
  }
  const fcEff = Math.max(0, Math.min(1, Number(fc) || 1));
  // Sonnenschutzglas wirkt doppelt: reduziertes g in S_vorh UND Zeile S3 in S_zul.
  const gGlas = (f) => (sonnenschutzglas ? Math.min(0.4, Number(f.g) || 0.6) : (Number(f.g) || 0.6));
  const sVorh = fenster.reduce((s, f) => s + f.flaeche * gGlas(f) * fcEff, 0) / AG;

  const regionIdx = Math.max(0, KLIMAREGIONEN.indexOf(klimaregion));
  const s1 = (S1_WOHN[nachtlueftung] || S1_WOHN.erhoeht)[bauart]?.[regionIdx]
    ?? S1_WOHN.erhoeht.mittel[regionIdx];
  const fWG = raum.fWG ?? (fenster.reduce((s, f) => s + f.flaeche, 0) / AG);
  const s2 = S2_WOHN.a - S2_WOHN.b * fWG;
  const s3 = sonnenschutzglas ? S3_SONNENSCHUTZGLAS : 0;
  const s4 = 0; // keine geneigten Fenster im Modell (senkrechte Fassade)
  const gesamtFlaeche = fenster.reduce((s, f) => s + f.flaeche, 0) || 1;
  const fNord = fenster.filter((f) => istNordFenster(f.azimut)).reduce((s, f) => s + f.flaeche, 0) / gesamtFlaeche;
  const s5 = S5_NORD * fNord;
  const s6 = 0; // passive Kühlung nicht abgebildet
  const sZul = s1 + s2 + s3 + s4 + s5 + s6;

  return {
    anwendbar: true,
    sVorh,
    sZul,
    ueberschreitung: sVorh > sZul,
    anteile: { s1, s2, s3, s4, s5, s6, fWG, fNord, fc: fcEff },
  };
}

// ---- Checks (pass/warn/offen — nie "fail", Haftung) ---------------------------
// Ampel je Geschoss: der DIN-Vergleich läuft über ALLE nicht freigestellten
// Räume mit Fenstern, ausgewiesen wird der ungünstigste (max. S_vorh−S_zul).
// Das Kennwert-Ranking ist dafür KEIN Majorant (Nordfenster: Gewicht 0,3 im
// Kennwert, aber voll in S_vorh) — es bleibt reine Anzeige-Reihenfolge.
// Freigestellte Räume (f_WG unter Grenze) sind pass ohne Rechnung.
export function raumklimaChecks({ geschosse, ohneRaum = [], optionen = {} } = {}) {
  const items = [];
  if (!geschosse || geschosse.size === 0) {
    return {
      items: [{ key: "leer", label: "Räume", status: "offen", detail: "Keine Räume im Gebäudemodell — im Reiter Gebäudemodell mit dem Zone-Werkzeug zeichnen." }],
      ampel: "offen",
      jeGeschoss: [],
    };
  }
  const jeGeschoss = [];
  [...geschosse.keys()].sort((a, b) => a - b).forEach((lvl) => {
    const raeume = geschosse.get(lvl);
    let kritisch = raeume[0];
    let status = "offen";
    let detail = "Keine Fenster zugeordnet.";
    let din = null;
    raeume.filter((r) => r.fenster.length && !r.nachweisFrei).forEach((r) => {
      const d = sonneneintrag(r, optionen);
      if (!d.anwendbar) return;
      if (!din || (d.sVorh - d.sZul) > (din.sVorh - din.sZul)) { din = d; kritisch = r; }
    });
    if (din) {
      status = din.ueberschreitung ? "warn" : "pass";
      detail = din.ueberschreitung
        ? `S_vorh ${din.sVorh.toFixed(3)} > S_zul ${din.sZul.toFixed(3)} — Sonnenschutz/Verglasung prüfen (Richtwert, kein Nachweis).`
        : `S_vorh ${din.sVorh.toFixed(3)} ≤ S_zul ${din.sZul.toFixed(3)} (Richtwert).`;
    } else {
      const frei = raeume.find((r) => r.fenster.length && r.nachweisFrei);
      if (frei) {
        kritisch = frei;
        status = "pass";
        detail = `Fensterflächenanteil ${(frei.fWG * 100).toFixed(0)} % unter der Freistellungsgrenze — kein Nachweis erforderlich (Richtwert).`;
      }
    }
    const label = `${lvl === 0 ? "EG" : `${lvl}. OG`} — kritischster Raum: ${kritisch?.name ?? "—"}`;
    items.push({ key: `geschoss-${lvl}`, label, status, detail });
    jeGeschoss.push({ level: lvl, kritisch, status, din });
  });
  if (ohneRaum.length) {
    items.push({
      key: "ohne-raum",
      label: "Fenster ohne Raum",
      status: "warn",
      detail: `${ohneRaum.length} Hüllfenster liegen in keinem gezeichneten Raum — Ranking unvollständig.`,
    });
  }
  const ampel = items.some((i) => i.status === "warn") ? "warn"
    : items.every((i) => i.status === "pass") ? "pass" : "offen";
  return { items, ampel, jeGeschoss };
}
