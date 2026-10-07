// Default configuration table of the Wohnungs-Werkstatt (persisted as
// werkstatt_layer in the BimModel, KD-17). Extracted from
// WohnungsWerkstatt.jsx in 75-06 Task 0 so useWerkstattRehydrate reads the
// SAME table: node --test cannot parse JSX, and a second defaults table would
// drift. WohnungsWerkstatt.jsx re-exports WERKSTATT_DEFAULT for compatibility.
//
// In:  nothing (constants only). Out: WERKSTATT_DEFAULT.
import { WERKSTATT_TYPEN } from "@designer/lib/wohnungsTypen";
import { KELLER_DEFAULT_OPTIONEN } from "@designer/lib/keller";
import { TG_DEFAULT_OPTIONEN } from "@designer/lib/tiefgarage";

// Starting unit mix: the three standard types (moved unchanged from the
// component, 61-01 selection).
const START_TYPEN = WERKSTATT_TYPEN.filter((t) => ["st-2zi", "st-3zi", "st-4zi"].includes(t.key));

// Persistente Werkstatt-Konfiguration (werkstatt_layer im BimModel, KD-17).
// Zonen selbst sind Session-State im Store; beim angewendet: true wird live
// deterministisch re-generiert (D-P61-04). Schema-Erweiterungen (61-05):
// eigeneTypen, gesperrteGrenzen, balkonJeTyp — Migrations-Guard defaultet.
/**
 * Default values of every werkstatt_layer field (units: m² for areas, m for
 * lengths, degrees for nordwinkel). The migration guard in the workshop (and
 * in useWerkstattRehydrate) spreads stored layers over this table, so missing
 * fields of older records default additively — never a schema migration.
 */
export const WERKSTATT_DEFAULT = {
  typ: "mittelflur",
  einheiten: START_TYPEN.map((t) => ({ ...t })),
  angewendet: false,
  eigeneTypen: [],
  gesperrteGrenzen: [],
  balkonJeTyp: {},
  // 75-07: Architekturregeln (jede optional, Default aus = heutiges Verhalten) + Nordwinkel.
  regeln: {},
  nordwinkel: 0,
  // 61-06: Kellerabteil-Planung (level −1). mengen = AVA-Übergabeliste (D-P61-10).
  keller: { aktiv: false, optionen: { ...KELLER_DEFAULT_OPTIONEN }, mengen: null },
  // 62-02: Tiefgarage (level −1, head end of the footprint); the cellar moves behind it.
  tiefgarage: { aktiv: false, optionen: { ...TG_DEFAULT_OPTIONEN }, mengen: null },
  // 61-07: manual arrangement — band order by drag (anordnung) and dragged
  // boundary positions (grenzenPositionen). Both are solver INPUTS, not geometry.
  anordnung: {},
  grenzenPositionen: {},
};

/**
 * Enrich stored units of older layers with the catalogue definitions so the
 * raumzonen mode keeps working (61-05 migration guard, extracted from
 * WohnungsWerkstatt.jsx verbatim in 75-06 Task 0 — ONE enrichment path shared
 * by the workshop component and useWerkstattRehydrate).
 *
 * Gespeicherte Einheiten im Alt-Format (61-01: ohne raumprogramm/balkon)
 * werden additiv mit den Katalog-Definitionen angereichert.
 *
 * @param {Array<object>|null|undefined} einheiten stored layer.einheiten (may
 *   be missing/empty — then the default mix is used)
 * @returns {Array<object>} enriched units (same order, user inputs win)
 */
export function einheitenAnreichern(einheiten) {
  return (Array.isArray(einheiten) && einheiten.length
    ? einheiten
    : WERKSTATT_DEFAULT.einheiten
  ).map((e) => {
    // Zimmerzahl aus dem Namen ableiten, falls das Feld fehlt (Alt-Format).
    const nameZimmer = (() => {
      const m = String(e?.name || "").match(/(\d+)/);
      return m ? Number(m[1]) : undefined;
    })();
    const zielZimmer = e?.zimmer ?? nameZimmer;
    const katalogTyp = WERKSTATT_TYPEN.find((t) => t.key === e?.key)
      // Alt-Format (61-01: Keys t2/t3/t4, kein zimmer-Feld) → Fallback über
      // die Zimmerzahl, damit auch ältere Layer ein raumprogramm bekommen.
      || WERKSTATT_TYPEN.find((t) => t.nutzung === (e?.nutzung || "wohnen") && t.zimmer === zielZimmer);
    if (!katalogTyp) return e;
    // Legacy group value (renamed 23.09.2026, phase 78): a stored unit whose
    // group differs from the catalogue AND whose name only differs in the
    // "(…)" suffix still carries the old preset name — take the catalogue's.
    // A name the user changed (other prefix) is kept.
    const altGruppe = e?.gruppe && katalogTyp.gruppe && e.gruppe !== katalogTyp.gruppe;
    const praefix = (n) => String(n || "").replace(/\s*\([^)]*\)\s*$/, "");
    const altName = altGruppe && e?.name && e.name !== katalogTyp.name
      && praefix(e.name) === praefix(katalogTyp.name);
    return {
      ...katalogTyp, // Basis: Katalog-Felder (raumprogramm, balkon, nutzung …)
      ...e,          // Nutzereingaben gewinnen (name/flaeche/min/max/Varianten)
      ...(altGruppe ? { gruppe: katalogTyp.gruppe } : {}),
      ...(altName ? { name: katalogTyp.name } : {}),
      raumprogramm: Array.isArray(e.raumprogramm) && e.raumprogramm.length
        ? e.raumprogramm
        : katalogTyp.raumprogramm,
      balkon: e.balkon ?? katalogTyp.balkon,
      nutzung: e.nutzung ?? katalogTyp.nutzung,
    };
  });
}
