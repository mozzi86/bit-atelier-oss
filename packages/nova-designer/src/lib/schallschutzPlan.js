// Schallschutz auf dem Grundriss (Phase 39, SCHALL-01..04): bauteil- statt
// pauschalbezogen — Raumarten je Zone, automatische Wand-Adjazenz WE↔WE
// (wohnungstrennende Wände), fassadenseitige Lärmpegel je Orientierung und
// resultierendes R'w der Außenwand inkl. Fensteranteil (energetische Mischung).
//
// Bewusst schlank gehalten: nur Imports aus Schwester-Libs desselben Pakets
// (raumklima-Geometrie, acoustics-Richtwerte) — Node-testbar, kein React.
//
// Konventionen (wie raumklima.js): XZ-Meter, −z = Nord ohne northAngle;
// Zonen = customZones {points, level, name}; Wände = createBuildingModel-Kanten
// {a, b, level, edge, composite}. Zone-Key = `level:name` (KD-17-roomKey —
// Umbenennen verwaist Zuweisungen, dokumentierte Einschränkung).
//
// Ehrlichkeit (Haftung): ALLES Konzept-Richtwerte ([ASSUMED]), KEIN Nachweis
// nach DIN 4109. Checks liefern nie "fail", nur pass/warn/offen.
import {
  polygonSignedAreaXZ, outwardNormal, azimutFromNormal,
} from "@designer/lib/raumklima";
import { laermpegelbereich, erfRwGes, TRENN_RICHTWERTE } from "@designer/lib/acoustics";

// ---- Raumarten (SCHALL-01) ----------------------------------------------------
// schutz = schutzbedürftiger Raum (Anforderungen gelten FÜR ihn),
// quelle = besonders lauter Raum (erhöhte Anforderung an die Trennwand).
export const PLAN_RAUMARTEN = {
  wohnen: { label: "Wohnen/Schlafen", kurz: "W", schutz: true, quelle: false, farbe: "#0d9488" },
  buero: { label: "Büro", kurz: "B", schutz: true, quelle: false, farbe: "#2563eb" },
  laut: { label: "laut (Technik/Gewerbe)", kurz: "L", schutz: false, quelle: true, farbe: "#dc2626" },
  flur: { label: "Flur/Erschließung", kurz: "F", schutz: false, quelle: false, farbe: "#64748b" },
  // Kellerabteil/Abstellraum (Phase 61-06, level −1): weder schutzbedürftig noch
  // Quelle — ohne diesen Eintrag fiele "keller" auf "wohnen" zurück und zwei
  // Abteile verschiedener WEs bekämen eine Wohnungstrennwand-Anforderung.
  // Nicht in RAUMART_REIHE (der Klick-Zyklus der Plan-Karte bleibt vierstufig).
  keller: { label: "Keller/Abstellraum", kurz: "K", schutz: false, quelle: false, farbe: "#a8a29e" },
  // Tiefgarage (Phase 62, level −1): Stellplätze, Fahrgasse, Rampe. Verkehrsfläche
  // ist keine Aufenthaltsfläche — kein Schutz. Als Quelle NICHT gesetzt: die
  // Garagen-Immission gegen Wohnräume darüber ist ein Deckenthema (Trittschall/
  // Körperschall), das die WE-Adjazenz auf dem Grundriss nicht abbildet [ASSUMED].
  verkehr: { label: "Tiefgarage/Verkehrsfläche", kurz: "TG", schutz: false, quelle: false, farbe: "#94a3b8" },
};
export const RAUMART_REIHE = ["wohnen", "buero", "laut", "flur"];

// R'w-Anforderung an Wände zu besonders lauten Räumen (dB). [ASSUMED]
export const RW_LAUT = 57;
// Pauschales Fenster-R'w (2-Scheiben-WSV, dB) für die Mischung. [ASSUMED]
export const RW_FENSTER_DEFAULT = 33;

export const zoneKey = (z) => `${z?.level ?? 0}:${z?.name ?? "Raum"}`;

/**
 * Effective room type of a zone — the ONE rule for calculation and plan card
 * (I-03, external review 02.09.): an explicit layer entry wins, then the zone's
 * own `raumart` (set by the Wohnungs-Werkstatt, Phase 61), then "wohnen".
 * Unknown ids fall back to "wohnen" too, so a stale or foreign value never
 * reaches PLAN_RAUMARTEN as undefined (closes N-09 as a side effect).
 *
 * Before this helper zonenAdjazenzen read zone.raumart while the plan card did
 * not: "Flur 0 ·WT" was computed as flur (not wohnungstrennend) and drawn as
 * "W"/Wohnen on the same screen.
 * @param {Record<string, string>|undefined} raumarten layer map { [zoneKey]: raumartId }
 * @param {{level?: number, name?: string, raumart?: string}|undefined} zone
 * @returns {string} a key of PLAN_RAUMARTEN
 */
export const effektiveRaumart = (raumarten, zone) => {
  const id = (raumarten || {})[zoneKey(zone)] || zone?.raumart || "wohnen";
  return PLAN_RAUMARTEN[id] ? id : "wohnen";
};

// Nutzungseinheit einer Zone — rückwärtskompatible Zwei-Wege-Signatur
// (D-P61-08, Phase 61):
//   1. Zone-Objekt MIT we-Feld → das we-Feld gewinnt (Werkstatt-Raum-Zonen:
//      mehrere Räume derselben WE teilen dasselbe we; Phase-39-Gruppierung
//      bleibt korrekt, RESEARCH Pitfall 1).
//   2. Zone-Objekt OHNE we ODER String → Namens-Logik wie bisher:
//      Wohnungsplaner-Zonen (Suffix " ·W", apartments.js GEN_MARKER) sind je
//      Zone EINE WE — der Marker fällt weg. Manuelle Zonen zählen je Name als
//      eigene Einheit (dokumentiert; Adjazenzen innerhalb derselben Wohnung
//      per Klick ausnehmbar, s. adjazenzKey).
export const weKey = (zoneOrName) => {
  // Objekt mit we-Feld: das explizite Feld gewinnt (Werkstatt-Zonen, 61-04).
  if (zoneOrName && typeof zoneOrName === "object") {
    if (typeof zoneOrName.we === "string" && zoneOrName.we) return zoneOrName.we;
    return weKey(zoneOrName.name); // Namens-Fallback für Objekte ohne we
  }
  const n = String(zoneOrName ?? "Raum");
  return n.endsWith(" ·W") ? n.slice(0, -3) : n;
};

// ---- Geometrie: kollineare Segment-Überlappung ---------------------------------
// Liefert das gemeinsame Teilstück zweier (nahezu) kollinearer Segmente auf der
// Achse von a1→a2, oder null. tol = max. Querabstand in m (Zonen, die an einer
// Wand aneinanderstoßen, teilen die Kante i. d. R. exakt).
export function segmentUeberlappung(a1, a2, b1, b2, { tol = 0.2, minLen = 0.5 } = {}) {
  const ux = a2.x - a1.x, uz = a2.z - a1.z;
  const lenA = Math.hypot(ux, uz);
  if (lenA < 1e-9) return null;
  const ex = ux / lenA, ez = uz / lenA;
  // Querabstand beider b-Punkte zur Trägergeraden von A (auch Parallelitätstest).
  const quer = (p) => Math.abs((p.x - a1.x) * ez - (p.z - a1.z) * ex);
  if (quer(b1) > tol || quer(b2) > tol) return null;
  const t = (p) => (p.x - a1.x) * ex + (p.z - a1.z) * ez;
  const tb1 = t(b1), tb2 = t(b2);
  const lo = Math.max(0, Math.min(tb1, tb2));
  const hi = Math.min(lenA, Math.max(tb1, tb2));
  if (hi - lo < minLen) return null;
  return {
    p1: { x: a1.x + ex * lo, z: a1.z + ez * lo },
    p2: { x: a1.x + ex * hi, z: a1.z + ez * hi },
    laenge: hi - lo,
  };
}

const zonenKanten = (z) => {
  const p = z?.points || [];
  // Degenerierte Zonen (< 3 Punkte, nur per Import/Handedit in der db.json
  // möglich — BimPlan2D erzeugt sie nicht) überspringen: eine 2-Punkt-Zone
  // lieferte sonst zwei antiparallele identische Kanten (p0→p1 und p1→p0),
  // die dieselbe Nachbar-Kante doppelt überlappen → doppelte Segmente/Länge.
  if (p.length < 3) return [];
  return p.map((a, i) => [a, p[(i + 1) % p.length]]);
};

// Stabiler Schlüssel einer Adjazenz (Zonen-Paar, reihenfolgeunabhängig).
export const adjazenzKey = (keyA, keyB) => [keyA, keyB].sort().join("|");

/**
 * Wand-Adjazenz WE↔WE (SCHALL-03): gemeinsame Kantenstücke zweier Zonen
 * desselben Geschosses. `relevant` = wohnungstrennend (verschiedene WE,
 * mind. eine Seite schutzbedürftig); Anforderung 53 dB (DIN 4109-1 Tab. 2
 * Richtwert) bzw. 57 dB, wenn eine Seite "laut". [ASSUMED]
 * Flur/Treppenraum: ein Flur der SELBEN WE (gleicher weKey) ist ohnehin nicht
 * wohnungstrennend; ein GEMEINSAMER Erschließungsflur/Treppenraum (Flur mit
 * anderem weKey) wird wie wohnungstrennend mit 53 dB behandelt [ASSUMED,
 * DIN 4109-1 Tab. 2 Richtwert für Wände neben Hausfluren/Treppenräumen] —
 * eine pauschale Flur-Ausnahme würde die korrekte Eingabe (Hausflur als "F")
 * paradoxerweise anforderungsfrei stellen. Intra-WE-Flure mit eigenem Namen
 * sind per Klick ausnehmbar (ausgenommen).
 * @param zonen     [{points, level, name}]
 * @param raumarten { [zoneKey]: raumartId } (Default "wohnen")
 * @param ausgenommen [adjazenzKey] — vom Nutzer als „gleiche WE" markiert
 */
export function zonenAdjazenzen({ zonen = [], raumarten = {}, ausgenommen = [] } = {}) {
  const ausSet = new Set(ausgenommen || []);
  const items = [];
  for (let i = 0; i < zonen.length; i++) {
    for (let j = i + 1; j < zonen.length; j++) {
      const za = zonen[i], zb = zonen[j];
      if ((za.level ?? 0) !== (zb.level ?? 0)) continue;
      const ka = zoneKey(za), kb = zoneKey(zb);
      // Alle Kanten-Paare abtasten, überlappende Stücke einsammeln.
      zonenKanten(za).forEach(([a1, a2]) => {
        zonenKanten(zb).forEach(([b1, b2]) => {
          const ueberlapp = segmentUeberlappung(a1, a2, b1, b2, {});
          if (!ueberlapp) return;
          // Same rule as the plan card in SchallschutzPlanner (I-03).
          const ra = effektiveRaumart(raumarten, za);
          const rb = effektiveRaumart(raumarten, zb);
          const artA = PLAN_RAUMARTEN[ra];
          const artB = PLAN_RAUMARTEN[rb];
          const key = adjazenzKey(ka, kb);
          // Gemeinsamer Flur/Treppenraum (andere WE) bleibt relevant (53 dB);
          // Flur derselben WE fällt über den weKey-Vergleich heraus. weKey
          // bekommt die GANZE Zone (D-P61-08): we-Feld-Vorrang, Namens-Fallback.
          const flur = ra === "flur" || rb === "flur";
          const relevant = weKey(za) !== weKey(zb)
            && (artA.schutz || artB.schutz);
          items.push({
            key,
            level: za.level ?? 0,
            a: { key: ka, name: za.name, raumart: ra },
            b: { key: kb, name: zb.name, raumart: rb },
            ...ueberlapp,
            relevant,
            flur,
            ausgenommen: ausSet.has(key),
            anforderung: (artA.quelle || artB.quelle) ? RW_LAUT : TRENN_RICHTWERTE.wand_wohnungstrennend,
          });
        });
      });
    }
  }
  return items;
}

// ---- Fassade (SCHALL-04) --------------------------------------------------------
// 4er-Sektor aus dem Kompass-Azimut der Außennormalen (N/O/S/W).
export const SEKTOREN4 = ["N", "O", "S", "W"];
export const sektor4 = (azimut) =>
  SEKTOREN4[Math.round((((azimut % 360) + 360) % 360) / 90) % 4];

// Resultierendes R'w von Wand + Fenster (energetische Mischung über die
// Flächenanteile — DIN-4109-2-Muster für zusammengesetzte Außenbauteile).
export function mischRw(rwWand, rwFenster, aWand, aFenster) {
  const aw = Math.max(0, Number(aWand) || 0);
  const af = Math.max(0, Number(aFenster) || 0);
  const ges = aw + af;
  if (ges <= 0) return 0;
  const tau = (aw * 10 ** (-(Number(rwWand) || 0) / 10) + af * 10 ** (-(Number(rwFenster) || 0) / 10)) / ges;
  return tau > 0 ? -10 * Math.log10(tau) : 99;
}

// Übernahme in die klassische Prüfung: konservativ auf 0,1 dB ABRUNDEN, nie
// aufrunden — Math.round(39,88) = 40 machte aus Plan-"warn" (39,88 < erf 40)
// in der klassischen Prüfung ein "pass" (40 ≥ 40): zwei widersprüchliche
// Ampeln für denselben Sachverhalt auf demselben Screen.
export const rwUebernahme = (v) => Math.floor((Number(v) || 0) * 10) / 10;

/**
 * Fassaden-Bewertung je Footprint-Kante (SCHALL-04): Orientierung aus der
 * Außennormalen (Umlaufrichtung wie raumklima), Lärmpegel je 4er-Sektor,
 * erforderliches R'w,ges aus Bereich + Raumart, vorhandenes R'w als Mischung
 * Wand (Katalog) + Fensteranteil der Kante.
 * @param waende   level-0-Hüllwände [{a,b,edge}] (Kanten sind je Geschoss gleich)
 * @param fensterJeKante { [edge]: m² } Fensterfläche der Kante ÜBER ALLE Geschosse
 * @param pegel    { N,O,S,W: dB(A) }
 * @param rwWand   Katalog-R'w des Hüllwand-Aufbaus (dB)
 * @param rwFenster Fenster-R'w (dB, Default 33 [ASSUMED])
 * @param raumart  strengste angrenzende Raumart für ERF_RW_AUSSEN ("wohnen")
 */
export function fassadenBewertung({
  waende = [], fensterJeKante = {}, pegel = {}, northAngle = 0,
  storeys = 1, storeyHeight = 3, rwWand = 50, rwFenster = RW_FENSTER_DEFAULT,
  raumart = "wohnen",
} = {}) {
  const lvl0 = waende.filter((w) => (w.level ?? 0) === (waende[0]?.level ?? 0));
  const fp = [...lvl0].sort((a, b) => a.edge - b.edge).map((w) => w.a);
  const umlauf = Math.sign(polygonSignedAreaXZ(fp)) || 1;
  return lvl0.map((w) => {
    const azimut = azimutFromNormal(outwardNormal(w, umlauf), northAngle);
    const sektor = sektor4(azimut);
    const dbA = Number(pegel[sektor]) || 0;
    const bereich = laermpegelbereich(dbA);
    const erf = erfRwGes(bereich, raumart);
    const laenge = Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z);
    const aGes = laenge * storeyHeight * Math.max(1, storeys);
    const aFenster = Math.min(aGes, Math.max(0, Number(fensterJeKante[w.edge]) || 0));
    const rwRes = mischRw(rwWand, rwFenster, aGes - aFenster, aFenster);
    return {
      edge: w.edge, a: w.a, b: w.b, azimut, sektor, dbA, bereich, erf,
      laenge, aGes, aFenster, fensterAnteil: aGes > 0 ? aFenster / aGes : 0,
      rwWand, rwRes,
      status: aGes > 0 ? (rwRes >= erf ? "pass" : "warn") : "offen",
    };
  });
}

// ---- Checks (pass/warn/offen — nie "fail", Haftung) -----------------------------
export function schallPlanChecks({ fassaden = [], adjazenzen = [], rwTrennwand = 0 } = {}) {
  const items = [];
  const de = (n) => Math.round(Number(n) || 0).toLocaleString("de-DE");
  const de1 = (n) => (Number(n) || 0).toLocaleString("de-DE", { maximumFractionDigits: 1 });

  if (!fassaden.length) {
    items.push({
      key: "fassade", label: "Fassade", status: "offen",
      detail: "Kein Gebäudemodell — Footprint im Reiter Gebäudemodell anlegen.",
    });
  } else {
    SEKTOREN4.forEach((s) => {
      const kanten = fassaden.filter((f) => f.sektor === s);
      if (!kanten.length) return;
      // Ungünstigste Kante des Sektors (kleinste Reserve R'w,res − erf).
      const worst = kanten.reduce((m, f) => ((f.rwRes - f.erf) < (m.rwRes - m.erf) ? f : m), kanten[0]);
      const ok = worst.status === "pass";
      items.push({
        key: `fassade-${s}`,
        label: `Fassade ${s} — ${de(worst.dbA)} dB(A) (Bereich ${worst.bereich})`,
        status: worst.status,
        detail: ok
          ? `R'w,res ${de1(worst.rwRes)} dB ≥ erforderlich ${de(worst.erf)} dB (Kante ${worst.edge}, Fensteranteil ${Math.round(worst.fensterAnteil * 100)} %)`
          : `R'w,res ${de1(worst.rwRes)} dB unter erforderlich ${de(worst.erf)} dB (Kante ${worst.edge}, Fensteranteil ${Math.round(worst.fensterAnteil * 100)} %) — Fenster-/Wandaufbau prüfen`,
      });
    });
  }

  const relevante = adjazenzen.filter((a) => a.relevant && !a.ausgenommen);
  if (!relevante.length) {
    items.push({
      key: "trennwand", label: "Wohnungstrennwände", status: "offen",
      detail: adjazenzen.length
        ? "Keine wohnungstrennende Adjazenz aktiv (alle ausgenommen oder gleiche WE)."
        : "Keine WE↔WE-Adjazenz erkannt — Zonen zeichnen oder Wohnungen generieren.",
    });
  } else {
    const erfMax = relevante.reduce((m, a) => Math.max(m, a.anforderung), 0);
    const gesamt = relevante.reduce((s, a) => s + a.laenge, 0);
    const ok = Math.max(0, Number(rwTrennwand) || 0) >= erfMax;
    items.push({
      key: "trennwand",
      label: `Wohnungstrennwände (${relevante.length} Segmente, ${de1(gesamt)} m)`,
      status: ok ? "pass" : "warn",
      detail: ok
        ? `R'w ${de(rwTrennwand)} dB ≥ erforderlich ${de(erfMax)} dB (Richtwert)`
        : `R'w ${de(rwTrennwand)} dB unter erforderlich ${de(erfMax)} dB — Trennwandaufbau prüfen`,
    });
  }

  const ampel = items.some((i) => i.status === "warn") ? "warn"
    : items.every((i) => i.status === "pass") ? "pass" : "offen";
  return { items, ampel };
}
