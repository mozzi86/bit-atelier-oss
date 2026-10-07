// Three-card start path for a fresh project (72-02, review §3 B.3).
//
// Why: after "Projekt anlegen" the app dropped the user on a dashboard with 20
// sidebar entries and no next step. The review's finding was not "a card is
// missing" but "there is no path" — so this names the three things the platform
// is for, in the order they happen, each with the verb first.
//
// In:  the created project + its BIM model (both may be null while loading).
// Out: three cards, or nothing once the project has real content.

import React from "react";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@core/components/ui/card";
import { PencilRuler, ShieldCheck, FileSpreadsheet, ArrowRight } from "lucide-react";
import { createPageUrl } from "@core/utils";

// The visibility rule lives in startpfadRegel.js (plain .js) so node --test can
// load it; re-exported here so callers keep one import.
export { zeigeStartpfad } from "./startpfadRegel";

/** The three steps. Verb first, one sentence, one destination. */
const SCHRITTE = [
  {
    id: "entwurf",
    titel: "Entwurf beginnen",
    text: "Parzelle zeichnen, Baukörper setzen, Kennzahlen ablesen.",
    ziel: `${createPageUrl("ComplexDesigner")}?tab=site`,
    icon: PencilRuler,
    farbe: "text-emerald-600 bg-emerald-50",
  },
  {
    id: "pruefen",
    titel: "Modell prüfen",
    text: "IFC laden, Kollisionen und IDS prüfen, Befunde als BCF zurückgeben.",
    ziel: createPageUrl("ModelCheck"),
    icon: ShieldCheck,
    farbe: "text-sky-600 bg-sky-50",
  },
  {
    id: "ausschreiben",
    titel: "Ausschreiben",
    text: "Mengen aus dem Modell, Leistungsverzeichnis, Preisspiegel.",
    ziel: createPageUrl("AVA"),
    icon: FileSpreadsheet,
    farbe: "text-amber-600 bg-amber-50",
  },
];

/**
 * @param {object} props
 * @param {{ name?: string }} [props.project] the freshly created project (for the headline)
 * @returns {JSX.Element} the three cards
 */
export default function Startpfad({ project }) {
  return (
    <section aria-label="Nächste Schritte" className="mb-6">
      <h2 className="text-lg font-semibold text-slate-900">
        {project?.name ? `${project.name} — wie weiter?` : "Wie weiter?"}
      </h2>
      <p className="text-sm text-slate-500 mb-3">
        Drei Wege durch die Plattform. Jeder lässt sich jederzeit wechseln.
      </p>
      <div className="grid gap-3 md:grid-cols-3">
        {SCHRITTE.map((s) => {
          const Icon = s.icon;
          return (
            <Link key={s.id} to={s.ziel} className="group">
              <Card className="h-full border-slate-200 hover:border-emerald-400 hover:shadow-md transition-all">
                <CardContent className="p-4 flex flex-col gap-2">
                  <span className={`w-9 h-9 rounded-lg flex items-center justify-center ${s.farbe}`}>
                    <Icon className="w-5 h-5" />
                  </span>
                  <span className="font-medium text-slate-900 flex items-center gap-1">
                    {s.titel}
                    <ArrowRight className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </span>
                  <span className="text-sm text-slate-600">{s.text}</span>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
