// koordinationskoerper.js — der Gebäudekoordinationswürfel des BAP als
// Lagebeweis zweier Modelle (Phase 71-02, BAP 9.4 Doppelpyramide).
//
// In:  Geometrie-Elemente aus extractGeometry (ifcImport.js:709-714):
//      [{ expressId, globalId, ifcType, name, tris, aabb, center }]
//      BEIDER Modelle — unzentriert geladen (coordinateToOrigin: false,
//      D-P71-05), sonst vergleicht man zwei Schwerpunkte, keine Lagen.
// Out: findeKoordinationskoerper(elemente) -> Element | null
//      vergleicheLage(a, b, toleranzMm = 0) -> { abweichungMm: {x,y,z},
//        maxMm, bestanden: boolean | null, grund }
//
// Fund aus 71-RESEARCH §1.5: in TX und AX existiert je ein zweiter IfcSite
// „RKW_Koordinationskörper-…" — die Placement-Z-Werte unterscheiden sich um
// 1,5 m (TX −10,80, AX −9,30; genau die Höhe des Gründungsgeschosses, das
// nur AX kennt). Ob die GEOMETRIE das ausgleicht, war offen — dieses Modul
// misst es an den echten AABBs.
//
// REIN, keine Imports.

/**
 * Sucht den Koordinationskörper in den Geometrie-Elementeines Modells.
 *
 * Strategie (Plan 71-02 Task 2):
 * 1. Name enthält „koordinationsk" (case-insensitiv) — der BAP-Name
 *    „RKW_Koordinationskörper-…" trägt ihn immer.
 * 2. Fallback: der KLEINSTE IfcSite mit Geometrie — der Projekt-Site
 *    (Projektname) fehlt normalerweise die Darstellung, der
 *    Koordinationskörper ist ein kompaktes Objekt.
 *
 * @param {Array<{ifcType?: string, name?: string, aabb?: {min:number[],max:number[]}}>} elemente
 * @returns {object|null} das Element oder null
 */
export function findeKoordinationskoerper(elemente) {
  const liste = Array.isArray(elemente) ? elemente : [];
  const byName = liste.find((el) => /koordinationsk/i.test(String(el?.name || "")));
  if (byName) return byName;

  let kleinster = null;
  let kleinstesVolumen = Infinity;
  for (const el of liste) {
    if (!el || String(el.ifcType || "").toUpperCase() !== "IFCSITE") continue;
    if (!el.aabb) continue;
    let volumen = 1;
    for (let i = 0; i < 3; i++) {
      const d = el.aabb.max[i] - el.aabb.min[i];
      volumen *= d > 0 ? d : 0;
    }
    if (volumen < kleinstesVolumen) {
      kleinstesVolumen = volumen;
      kleinster = el;
    }
  }
  return kleinster;
}

/**
 * Float32-Messboden in mm für den Lagevergleich.
 *
 * Herleitung (71-RESEARCH §1.4): die Vertex-Koordinaten laufen durch
 * Float32Array; bei den Referenzprojekt-Modellen (Vermesserpunkt-Export, z ≈ 280 m)
 * ist die Float32-Auflösung dort 280 · 2⁻²³ ≈ 0,033 mm — GEMESSEN am echten
 * Paar: 0,019 mm Differenz bei geometrisch gleicher Lage (referenz-modelle.
 * test.js, Lauf 10.09.2026). 0,05 mm ≈ das 1,5-fache der Auflösung und ist
 * bauphysikalisch belanglos (ein Haar ist dicker). Die 0-mm-Zeile der BAP
 * kann messtechnisch nur „≤ Messboden" heißen — sonst wäre jede Prüfung ein
 * Scheinbefund über 19 µm. Echte Versätze (dm/m-Bereich) bleiben sichtbar.
 */
export const MESSBODEN_MM = 0.05;

/**
 * Vergleicht die Lage zweier Koordinationskörper über ihre AABBs.
 *
 * Abweichung = maximale Grenzdifferenz je Achse in mm (min UND max — eine
 * Verschiebung ändert beide gleich, eine Skalierung unterschiedlich; die BAP
 * verlangt „Koordinatengleichheit", also beides).
 *
 * bestanden: true bei maxMm <= max(toleranzMm, MESSBODEN_MM) — der Messboden
 * fängt das Float32-Rauschen georeferenzierter Modelle (s. o.), false darüber,
 * null wenn ein Körper fehlt (dann trägt `grund` den Klartext — ein fehlender
 * Körper ist ein offener Befund, kein bestandener Test).
 *
 * @param {object|null} koerperA aus Modell A
 * @param {object|null} koerperB aus Modell B
 * @param {number} [toleranzMm] BAP-Matrix: 0
 * @returns {{abweichungMm: {x:number,y:number,z:number}|null, maxMm: number|null,
 *   bestanden: boolean|null, grund: string|null}}
 */
export function vergleicheLage(koerperA, koerperB, toleranzMm = 0) {
  if (!koerperA || !koerperB) {
    const fehlt = [!koerperA && "A", !koerperB && "B"].filter(Boolean).join(" und ");
    return {
      abweichungMm: null, maxMm: null, bestanden: null,
      grund: `Koordinationskörper in Modell ${fehlt} nicht gefunden — Lagevergleich nicht möglich`,
    };
  }
  if (!koerperA.aabb || !koerperB.aabb) {
    return {
      abweichungMm: null, maxMm: null, bestanden: null,
      grund: "Koordinationskörper ohne Geometrie (keine AABB) — Lagevergleich nicht möglich",
    };
  }
  const abweichungMm = { x: 0, y: 0, z: 0 };
  const achsen = ["x", "y", "z"];
  let maxM = 0;
  for (let i = 0; i < 3; i++) {
    const d = Math.max(
      Math.abs(koerperA.aabb.min[i] - koerperB.aabb.min[i]),
      Math.abs(koerperA.aabb.max[i] - koerperB.aabb.max[i]),
    );
    abweichungMm[achsen[i]] = Math.round(d * 1e6) / 1000; // m -> mm, µm-Rundung
    if (d > maxM) maxM = d;
  }
  const maxMm = Math.round(maxM * 1e6) / 1000;
  const schwelle = Math.max(toleranzMm, MESSBODEN_MM);
  const bestanden = maxMm <= schwelle;
  return {
    abweichungMm,
    maxMm,
    bestanden,
    grund: bestanden
      ? null
      : `Lageabweichung ${maxMm} mm über der Toleranz ${toleranzMm} mm `
        + `(Messboden ${MESSBODEN_MM} mm; x ${abweichungMm.x} / y ${abweichungMm.y} / z ${abweichungMm.z} mm)`,
  };
}
