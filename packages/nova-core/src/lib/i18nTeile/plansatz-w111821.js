// W-1118-21 (plan set with dimension chains): English texts of the plan output in BitBimStudio.
// Format and guard as in every part file (tests/unit/i18nAbdeckung.test.js).
//
// In:  nothing. Out: EN, merged into DICT.en through ./index.js.

/** @type {Record<string, string>} */
export const EN = {
  "Plansatz mit Maßketten als PDF": "Plan set with dimension chains as PDF",
  "Alle Geschosse als Grundriss mit Maßketten und beide Schnitte in einem PDF.": "Every storey as a floor plan with dimension chains and both sections in one PDF.",
  "Maßstab des Plansatzes": "Scale of the plan set",
  "Plansatz 1:{{m}} erstellt — {{n}} Blätter ({{liste}}), maßstäblich, Grundrisse mit Maßketten. Ansichten sind noch nicht enthalten.": "Plan set 1:{{m}} created — {{n}} sheets ({{liste}}), true to scale, floor plans with dimension chains. Elevations are not included yet.",
  "Achtung: {{n}} Maßkette(n) gehen nicht auf das Gesamtmaß auf.": "Warning: {{n}} dimension chain(s) do not add up to the overall length.",
  "Plansatz fehlgeschlagen": "Plan set failed",
};
