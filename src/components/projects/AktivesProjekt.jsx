// Active-project block at the top of the project overview (72-09, N-04).
//
// Why: the landing page showed portfolio numbers only — nothing about the
// project chosen in the top bar, its open tickets and change orders, or where to
// go next (LINKING-13, FINDINGS-BACKLOG-02, KRITIK-13). This block answers
// "where does my project stand, and what comes next?" before the portfolio.
//
// In:  the active project from ProjectContext. Loads in parallel its BimModel
//      (read only, via the shared loadBimModel cache), its tickets, its
//      bill-of-quantities positions and all change orders.
// Out: nothing without a project; a loading skeleton; a plain-text error with
//      "Erneut versuchen"; the unchanged <Startpfad/> while the project is still
//      empty (startpfadRegel.js); otherwise "Weiter im Projekt" (three core
//      modules) and "Offene Punkte" (open tickets → BIM viewer, open change
//      orders → finance), with an honest empty text at zero.

import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, PencilRuler, ShieldCheck, FileSpreadsheet, Ticket, FilePen, TriangleAlert } from "lucide-react";
import { bitApi } from "@core/api/bitApi";
import { createPageUrl } from "@core/utils";
import { useI18n } from "@core/lib/i18n";
import { useProject } from "@core/lib/ProjectContext";
import { loadBimModel } from "@core/lib/useBimModelSync";
import { statusInfo } from "@core/lib/projectModel";
import { nachtraegeDesProjekts, offeneNachtraege } from "@core/lib/nachtraege";
import LoadingState from "@core/components/common/LoadingState";
import Startpfad from "./Startpfad";
import { zeigeStartpfad } from "./startpfadRegel";

/** Fills {key} placeholders after translation, so the dictionary key keeps them. */
const fuellen = (text, werte) => text.replace(/\{(\w+)\}/g, (_, k) => String(werte[k] ?? ""));

/** The three core steps of a running project; titles verb-first, subtitle = menu name. */
const WEITER = [
  { ziel: createPageUrl("ComplexDesigner"), titel: "Entwurf", modul: "Komplex-Designer", icon: PencilRuler, farbe: "text-emerald-600 bg-emerald-50" },
  { ziel: createPageUrl("ModelCheck"), titel: "Prüfen", modul: "Prüf-Suite", icon: ShieldCheck, farbe: "text-sky-600 bg-sky-50" },
  { ziel: createPageUrl("AVA"), titel: "Ausschreiben", modul: "AVA (Ausschreibung)", icon: FileSpreadsheet, farbe: "text-amber-600 bg-amber-50" },
];

// Same rule as everywhere else a ticket counts as open (BimViewer.jsx, ReportDocument.jsx).
const istOffenesTicket = (i) => i.status !== "resolved" && i.status !== "closed";

/**
 * Overview block for the active project.
 * @returns {JSX.Element|null} the block, or null while no project is active
 */
export default function AktivesProjekt() {
  const { t } = useI18n();
  const { project, projectId } = useProject();
  const [zustand, setZustand] = useState({ laedt: true, fehler: "", daten: null });
  const [versuch, setVersuch] = useState(0);

  useEffect(() => {
    if (!projectId) return undefined;
    let aktiv = true;
    setZustand({ laedt: true, fehler: "", daten: null });
    // bitApi.entities is a Proxy without declared entity names (tsc sees {}).
    const e = /** @type {any} */ (bitApi.entities);
    Promise.all([
      loadBimModel(projectId),
      e.Issue.filter({ project_id: projectId }),
      e.LVPosition.filter({ project_id: projectId }),
      e.ChangeOrder.list(),
    ])
      .then(([bimModel, tickets, lvPositionen, nachtraege]) => {
        if (!aktiv) return;
        setZustand({
          laedt: false,
          fehler: "",
          daten: { bimModel, tickets: tickets || [], lvPositionen: lvPositionen || [], nachtraege: nachtraege || [] },
        });
      })
      .catch((err) => {
        if (aktiv) setZustand({ laedt: false, fehler: String(err?.message || err), daten: null });
      });
    return () => { aktiv = false; };
  }, [projectId, versuch]);

  if (!project) return null;

  const st = statusInfo(project.status);
  const kopf = (
    <div className="flex flex-wrap items-center gap-2 mb-3">
      <h2 id="aktives-projekt-titel" className="text-lg font-semibold text-slate-800">
        {fuellen(t("Aktives Projekt: {name}"), { name: project.name })}
      </h2>
      <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${st.color}`}>
        <span aria-hidden="true" className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />
        {t(st.label)}
      </span>
    </div>
  );

  let inhalt;
  if (zustand.laedt) {
    inhalt = <LoadingState variant="list" rows={2} />;
  } else if (zustand.fehler) {
    inhalt = (
      <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 flex flex-wrap items-center gap-3">
        <TriangleAlert aria-hidden="true" className="w-4 h-4 shrink-0" />
        <span className="min-w-0 flex-1">
          {fuellen(t("Die Projektdaten konnten nicht geladen werden: {fehler}"), { fehler: zustand.fehler })}
        </span>
        <button
          type="button"
          onClick={() => setVersuch((v) => v + 1)}
          className="rounded-lg border border-rose-300 bg-white px-3 py-1.5 font-medium text-rose-800 hover:bg-rose-100"
        >
          {t("Erneut versuchen")}
        </button>
      </div>
    );
  } else {
    const { bimModel, tickets, lvPositionen, nachtraege } = zustand.daten;
    if (zeigeStartpfad(project, bimModel, { tickets: tickets.length, lvPositionen: lvPositionen.length })) {
      inhalt = <Startpfad project={project} />;
    } else {
      const offeneTickets = tickets.filter(istOffenesTicket).length;
      // Same rules as finance, AVA settlement and the report (@core/lib/nachtraege):
      // a record belongs to the project by project_id, by name only when it has
      // no project_id; "open" means undecided (pending or in_progress).
      const offeneNachtraegeAnzahl = offeneNachtraege(nachtraegeDesProjekts(nachtraege, project)).length;
      inhalt = <WeiterImProjekt t={t} offeneTickets={offeneTickets} offeneNachtraege={offeneNachtraegeAnzahl} />;
    }
  }

  return (
    <section aria-labelledby="aktives-projekt-titel" data-testid="aktives-projekt">
      {kopf}
      {inhalt}
    </section>
  );
}

/**
 * "Weiter im Projekt" and "Offene Punkte" for a project with content.
 * @param {object} props
 * @param {(key: string) => string} props.t translate function from useI18n
 * @param {number} props.offeneTickets count (pieces) of tickets not resolved/closed
 * @param {number} props.offeneNachtraege count (pieces) of undecided change orders (pending, in_progress)
 * @returns {JSX.Element} the two cards
 */
function WeiterImProjekt({ t, offeneTickets, offeneNachtraege }) {
  const ticketText = offeneTickets === 1 ? t("1 offenes Ticket") : fuellen(t("{n} offene Tickets"), { n: offeneTickets });
  const nachtragText = offeneNachtraege === 1 ? t("1 offener Nachtrag") : fuellen(t("{n} offene Nachträge"), { n: offeneNachtraege });
  const punktLink = "group flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-700 hover:border-emerald-400 hover:text-emerald-700 dark:hover:border-emerald-500 dark:hover:text-emerald-300 transition-colors";

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="lg:col-span-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="font-semibold text-slate-800 mb-3">{t("Weiter im Projekt")}</h3>
        <ul className="grid gap-3 sm:grid-cols-3">
          {WEITER.map((w) => {
            const Icon = w.icon;
            return (
              <li key={w.ziel}>
                <Link
                  to={w.ziel}
                  className="group h-full flex items-start gap-3 rounded-lg border border-slate-200 bg-white p-3 hover:border-emerald-400 hover:shadow-md dark:hover:border-emerald-500 transition-all"
                >
                  <span aria-hidden="true" className={`w-9 h-9 shrink-0 rounded-lg flex items-center justify-center ${w.farbe}`}>
                    <Icon className="w-5 h-5" />
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-1 font-medium text-slate-800">
                      {t(w.titel)}
                      <ArrowRight aria-hidden="true" className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </span>
                    <span className="block text-xs text-slate-500">{t(w.modul)}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="font-semibold text-slate-800 mb-3">{t("Offene Punkte")}</h3>
        <ul className="space-y-2">
          <li>
            {offeneTickets > 0 ? (
              <Link to={createPageUrl("BimViewer")} className={punktLink}>
                <Ticket aria-hidden="true" className="w-4 h-4 shrink-0 text-rose-600" />
                <span className="min-w-0 flex-1">{ticketText}</span>
                <ArrowRight aria-hidden="true" className="w-4 h-4 shrink-0 text-slate-400" />
              </Link>
            ) : (
              <p className="flex items-center gap-3 px-3 py-2.5 text-sm text-slate-500">
                <Ticket aria-hidden="true" className="w-4 h-4 shrink-0" />
                {t("Keine offenen Tickets")}
              </p>
            )}
          </li>
          <li>
            {offeneNachtraege > 0 ? (
              <Link to={createPageUrl("Finance")} className={punktLink}>
                <FilePen aria-hidden="true" className="w-4 h-4 shrink-0 text-amber-600" />
                <span className="min-w-0 flex-1">{nachtragText}</span>
                <ArrowRight aria-hidden="true" className="w-4 h-4 shrink-0 text-slate-400" />
              </Link>
            ) : (
              <p className="flex items-center gap-3 px-3 py-2.5 text-sm text-slate-500">
                <FilePen aria-hidden="true" className="w-4 h-4 shrink-0" />
                {t("Keine offenen Nachträge")}
              </p>
            )}
          </li>
        </ul>
      </div>
    </div>
  );
}
