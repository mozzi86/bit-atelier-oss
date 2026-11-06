// 107-14 / 107-09: plain-language warning of a component whose solid was not used (volume comparison, open input, load error,
// degenerate input). A file of its own (107-09): the BIM studio shows the text on the component and in the data sheet and must not
// pull the CSG modules onto its chunk for it, and it lies outside lib/csg/ so that showing it requests no module of the core; csg/index.js
// re-exports it.
//
// In: a warning object of csg/volumen.js (VolumenWarnung), a translate function, the language. Out: German source text (i18n key).

/**
 * Plain-language warning of a component (German source text, translated by tz). Pure — the panel (inspector, data sheet of
 * the calling plan) only shows it. Every text of a known case is an i18n key; only csg-fehler inserts a technical message
 * of the library or the loader (an error text of a third party, it has no translation).
 * @param {{code: string, abweichung_rel?: number|null, eingabe?: string, art?: string, text?: string}|null|undefined} warnung VolumenWarnung of csg/volumen.js
 * @param {(text: string) => string} [tz] translation (useI18n().t); default: German source text
 * @param {string} [lang] language of the interface (useI18n().lang, "de" | "en") for the number format; default "de"
 * @returns {string} empty for no warning
 */
export function csgWarnungText(warnung, tz = (t) => t, lang = "de") {
  if (!warnung) return "";
  if (warnung.code === "csg-abweichung") {
    const p = warnung.abweichung_rel == null || !Number.isFinite(warnung.abweichung_rel)
      ? "–"
      : (warnung.abweichung_rel * 100).toLocaleString(lang === "en" ? "en-GB" : "de-DE", { maximumFractionDigits: 2 });
    return tz("Volumen des 3D-Körpers weicht um {{prozent}} % von der Handrechnung ab — Menge aus der Handrechnung (Fläche × Dicke)").replace("{{prozent}}", p);
  }
  if (warnung.code === "csg-offen") {
    return warnung.eingabe === "ergebnis"
      ? tz("3D-Körper nicht verwendet: das Ergebnis ist nicht geschlossen — Menge aus der Handrechnung (Fläche × Dicke)")
      : tz("3D-Körper nicht berechnet: ein Eingabekörper ist nicht geschlossen — Menge aus der Handrechnung (Fläche × Dicke)");
  }
  // 107-10: solid relations (bauteil/seo.js)
  if (warnung.code === "seo-gruppe-0") return tz("Bauteil verschneidet nie (Gruppe 0) — die Relation bleibt gespeichert, wirkt aber nicht");
  if (warnung.code === "seo-ohne-referenz") return tz("Abschrägung ohne analytische Referenz (mehrere Dächer oder Körper mit Innenring) — Menge offen");
  if (warnung.code === "seo-nicht-unterstuetzt") return tz("Diese Bauteil-Operation wird noch nicht berechnet (gekrümmte Dachform oder andere Kombination) — offen");
  if (warnung.code === "csg-ungueltig") {
    return warnung.art === "platte"
      ? tz("3D-Körper nicht berechnet: Decke ohne Fläche oder Dicke — Menge aus der Handrechnung (Fläche × Dicke)")
      : tz("3D-Körper nicht berechnet: Wand ohne Länge, Höhe oder Dicke — Menge aus der Handrechnung (Fläche × Dicke)");
  }
  return tz("3D-Körper nicht verfügbar ({{text}}) — Menge aus der Handrechnung (Fläche × Dicke)").replace("{{text}}", String(warnung.text || "?"));
}
