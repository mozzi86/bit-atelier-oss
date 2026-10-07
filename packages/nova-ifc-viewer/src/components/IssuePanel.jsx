// IssuePanel.jsx — ticket list next to the BIM viewer.
//
// 72-13 (N-10): every card carries the anchor id `ticket-<id>` (target of the
// ?ticket=<id> link, see lib/ticketLink.js), the title is a real button with
// aria-pressed so the list works by keyboard (the card click stays as mouse
// comfort), status and priority show German labels (values stay English keys),
// and deleting asks inline a second time instead of firing on the first click.
// 72-14 (N-14): every card offers "Nachtrag anlegen" — a link to the Finance
// form prefilled from this ticket (neuerNachtragUrl, @core/lib/nachtraege). A link,
// not a button with navigate(): it changes the page and can open in a new tab.
// 72-16 (N-17): the IFC GlobalId of a ticket (element_guid || element_id) was
// invisible and led nowhere; it is now a chip linking to the element in the IFC
// viewer (/IfcViewer?sel=<GlobalId>, the ?sel contract of lib/viewerLink.js). The
// empty text names both ways to a ticket, the model way only when a model exists.
//
// In (props): issues, selectedIssueId, onSelect(id), onEdit(issue),
//   onDelete(issue), loading (true while the parent loads the tickets),
//   ladeFehler (true after a failed load: an empty list then means "unknown",
//   not "no tickets"), modellpunktMoeglich (false when the project has no
//   building to click into).
// Out: UI only; all writes go through the callbacks.

import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@core/components/ui/button";
import { Badge } from "@core/components/ui/badge";
import { useI18n } from "@core/lib/i18n";
import { neuerNachtragUrl } from "@core/lib/nachtraege";
import { Pencil, Trash2, MapPin, Crosshair, FilePlus2, Box } from "lucide-react";
import { statusLabel, prioritaetLabel, bauteilGuid } from "../lib/ticketLink";
import { serialisiereZustand } from "../lib/viewerLink";

const priorityColors = {
  low: "bg-emerald-100 text-emerald-800",
  medium: "bg-amber-100 text-amber-800",
  high: "bg-red-100 text-red-800",
  critical: "bg-red-200 text-red-900",
};

const statusColors = {
  open: "bg-blue-100 text-blue-800",
  in_progress: "bg-purple-100 text-purple-800",
  resolved: "bg-emerald-100 text-emerald-800",
  closed: "bg-slate-100 text-slate-600",
};

const kleinerKnopf =
  "rounded-md border px-2 py-0.5 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400";

export default function IssuePanel({
  issues = [],
  selectedIssueId,
  onSelect,
  onEdit,
  onDelete,
  loading = false,
  ladeFehler = false,
  modellpunktMoeglich = true,
}) {
  const { t } = useI18n();
  const listeRef = useRef(null);
  // Id of the ticket whose delete button was pressed once; null = no question open.
  const [loeschFrage, setLoeschFrage] = useState(null);
  const loeschKnopfRef = useRef(null);

  // Keep the selected card visible inside the scrolling list. Only the list scrolls,
  // not the page: a marker click in the 3D view must not pull a phone-width layout
  // away from the model. The ?ticket deep link scrolls the page itself (BimViewer).
  useEffect(() => {
    const liste = listeRef.current;
    if (!liste || !selectedIssueId) return;
    const karte = document.getElementById(`ticket-${selectedIssueId}`);
    if (!karte || !liste.contains(karte)) return;
    const l = liste.getBoundingClientRect();
    const k = karte.getBoundingClientRect();
    if (k.top < l.top) liste.scrollTop += k.top - l.top;
    else if (k.bottom > l.bottom) liste.scrollTop += k.bottom - l.bottom;
  }, [selectedIssueId, issues]);

  const frageAbbrechen = () => {
    setLoeschFrage(null);
    loeschKnopfRef.current?.focus();
  };

  if (loading && issues.length === 0) {
    return (
      <p className="text-sm text-slate-500 py-4 text-center" role="status">
        {t("Tickets werden geladen…")}
      </p>
    );
  }

  if (ladeFehler && issues.length === 0) {
    return (
      <p className="text-sm text-red-700 py-4 text-center" role="alert">
        {t("Tickets konnten nicht geladen werden")}
      </p>
    );
  }

  if (issues.length === 0) {
    return (
      <p className="text-sm text-slate-500 py-4 text-center">
        {modellpunktMoeglich
          ? t("Noch keine Tickets. Legen Sie eines ohne Modellpunkt an oder setzen Sie es im Modell.")
          : t("Noch keine Tickets. Legen Sie eines ohne Modellpunkt an.")}
      </p>
    );
  }

  return (
    <div ref={listeRef} className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
      {issues.map((issue) => {
        const active = issue.id === selectedIssueId;
        const titel = issue.title || t("(ohne Titel)");
        const prio = prioritaetLabel(issue.priority);
        const status = statusLabel(issue.status);
        const fragt = loeschFrage === issue.id;
        const guid = bauteilGuid(issue);
        return (
          <div
            key={issue.id}
            id={`ticket-${issue.id}`}
            onClick={() => onSelect?.(issue.id)}
            className={`p-3 border rounded-lg cursor-pointer transition-all ${
              active
                ? "border-blue-400 bg-blue-50 ring-1 ring-blue-300"
                : "border-slate-200 hover:border-slate-300"
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <button
                type="button"
                aria-pressed={active}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect?.(issue.id);
                }}
                className="text-left font-medium text-sm text-slate-800 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
              >
                {titel}
              </button>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  aria-label={t("Ticket „{titel}“ bearbeiten").replace("{titel}", titel)}
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit?.(issue);
                  }}
                >
                  <Pencil className="w-3.5 h-3.5" />
                </Button>
                <Button
                  ref={fragt ? loeschKnopfRef : undefined}
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-red-500 hover:text-red-700"
                  aria-label={t("Ticket „{titel}“ löschen").replace("{titel}", titel)}
                  aria-expanded={fragt}
                  onClick={(e) => {
                    e.stopPropagation();
                    setLoeschFrage(issue.id);
                  }}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
            {fragt && (
              <div
                role="group"
                aria-label={t("Löschen bestätigen")}
                className="mt-2 flex items-center gap-2 rounded-md bg-red-50 px-2 py-1.5 text-xs text-red-800"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.stopPropagation();
                    frageAbbrechen();
                  }
                }}
              >
                <span className="font-medium">{t("Wirklich löschen?")}</span>
                <button
                  type="button"
                  className={`${kleinerKnopf} border-red-300 bg-red-600 text-white hover:bg-red-700`}
                  onClick={() => {
                    setLoeschFrage(null);
                    onDelete?.(issue);
                  }}
                >
                  {t("Ja")}
                </button>
                {/* Focus lands on "Nein": the safe answer is the default one. */}
                <button
                  type="button"
                  autoFocus
                  className={`${kleinerKnopf} border-slate-300 bg-white text-slate-700 hover:bg-slate-50`}
                  onClick={frageAbbrechen}
                >
                  {t("Nein")}
                </button>
              </div>
            )}
            {issue.description && (
              <p className="text-xs text-slate-500 mt-1 line-clamp-2">
                {issue.description}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-1.5 mt-2">
              {prio && (
                <Badge className={priorityColors[issue.priority] || ""}>
                  {t(prio)}
                </Badge>
              )}
              {status && (
                <Badge className={statusColors[issue.status] || ""}>
                  {t(status)}
                </Badge>
              )}
              {issue.assignee && (
                <span className="text-xs text-slate-500">· {issue.assignee}</span>
              )}
              {guid && (
                // The aria-label contains the visible GlobalId (label in name).
                <Link
                  to={`/IfcViewer?${serialisiereZustand({ sel: guid })}`}
                  onClick={(e) => e.stopPropagation()}
                  title={t("Bauteil im IFC-Viewer zeigen")}
                  aria-label={t("Bauteil {guid} im IFC-Viewer zeigen").replace("{guid}", guid)}
                  className={`${kleinerKnopf} inline-flex max-w-full items-center gap-1 border-emerald-300 bg-emerald-50 font-mono text-emerald-800 hover:bg-emerald-100`}
                >
                  <Box className="w-3 h-3 shrink-0" aria-hidden="true" />
                  <span className="truncate">{guid}</span>
                </Link>
              )}
              {/* The aria-label starts with the visible text (label in name). */}
              <Link
                to={neuerNachtragUrl(issue.id)}
                onClick={(e) => e.stopPropagation()}
                aria-label={t("Nachtrag anlegen zu Ticket „{titel}“").replace("{titel}", titel)}
                className={`${kleinerKnopf} inline-flex items-center gap-1 border-slate-300 bg-white text-slate-700 hover:bg-slate-50`}
              >
                <FilePlus2 className="w-3 h-3" aria-hidden="true" />
                {t("Nachtrag anlegen")}
              </Link>
            </div>
            {issue.location && (
              <div className="flex items-center gap-1 text-xs text-slate-400 mt-1.5">
                {active ? (
                  <Crosshair className="w-3 h-3 text-blue-500" />
                ) : (
                  <MapPin className="w-3 h-3" />
                )}
                x {issue.location.x}, y {issue.location.y}, z {issue.location.z}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
