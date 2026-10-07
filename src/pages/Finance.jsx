// Finance — change orders (Nachträge) of the active project: list, create, edit,
// approve and reject. 72-14 (N-13): one scoping rule for every page
// (nachtraegeDesProjekts), project_id on every write, status lifecycle with the
// allowed transitions from @core/lib/nachtraege.
// 72-14 (N-14): ?neu=1 opens the empty form, ?neu=1&ticket=<id> the form prefilled
// from that ticket (link contract in nachtraege.js); the head links to the AVA
// cost control first, the site control room is only a quiet lab link.
import { seitenWurzel } from "@core/lib/utils";
import React, { useState, useEffect, useMemo, useCallback } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { useProject } from "@core/lib/ProjectContext";
import { useI18n } from "@core/lib/i18n";
import { bitApi } from "@core/api/bitApi";
import { Button, buttonVariants } from "@core/components/ui/button";
import { Plus, BarChart3 } from "lucide-react";
import {
  nachtraegeDesProjekts, projektDesNachtrags, projektFelder, statusWechsel,
  nachtragAusTicket, ticketGehoertZuProjekt, leseNachtragParameter, ohneNachtragParameter,
} from "@core/lib/nachtraege";
import FinanceSummary from "../components/finance/FinanceSummary";
import ChangeOrderTable from "../components/finance/ChangeOrderTable";
import ChangeOrderForm from "../components/finance/ChangeOrderForm";

// bitApi.entities is typed as {} for tsc (entities are created at runtime).
const entities = () => /** @type {any} */ (bitApi.entities);

/** Plain error text for a message (never "[object Object]"). */
const fehlerText = (err) => err?.message || String(err);

export default function Finance() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { project, projects, loading: projektLaedt } = useProject();
  const [searchParams, setSearchParams] = useSearchParams();
  const [changeOrders, setChangeOrders] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [ladeFehler, setLadeFehler] = useState("");
  const [alleProjekte, setAlleProjekte] = useState(false);
  // null = closed; {nachtrag: null} = create (vorbelegung = prefill from a ticket);
  // {nachtrag: order} = edit.
  const [formular, setFormular] = useState(/** @type {{nachtrag: any, vorbelegung?: any}|null} */ (null));
  const [beschaeftigtId, setBeschaeftigtId] = useState(/** @type {string|null} */ (null));

  // leise: reload after a write without the skeleton flashing over the list.
  const loadData = useCallback(async ({ leise = false } = {}) => {
    if (!leise) setIsLoading(true);
    try {
      const orders = await entities().ChangeOrder.list("-submission_date");
      setChangeOrders(Array.isArray(orders) ? orders : []);
      setLadeFehler("");
    } catch (err) {
      setLadeFehler(fehlerText(err));
    } finally {
      if (!leise) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ?neu=1[&ticket=<id>]: open the form once the active project is known, then drop
  // the parameters (replace) so a reload or the back button does not reopen it.
  const linkParameter = useMemo(() => leseNachtragParameter(searchParams), [searchParams]);
  useEffect(() => {
    if (!linkParameter.neu || projektLaedt) return;
    let abgebrochen = false;
    (async () => {
      let vorbelegung = null;
      if (linkParameter.ticket) {
        try {
          const issue = await entities().Issue.get(linkParameter.ticket);
          if (project && !ticketGehoertZuProjekt(issue, project)) {
            toast.error(t("Das Ticket gehört zu einem anderen Projekt. Wählen Sie dieses Projekt oben in der Kopfzeile."));
          } else {
            vorbelegung = nachtragAusTicket(issue, project);
          }
        } catch (err) {
          toast.error(err?.status === 404
            ? t("Ticket nicht gefunden")
            : `${t("Ticket konnte nicht geladen werden")}: ${fehlerText(err)}`);
        }
      }
      if (abgebrochen) return;
      setFormular({ nachtrag: null, vorbelegung });
      setSearchParams(ohneNachtragParameter(searchParams), { replace: true });
    })();
    return () => { abgebrochen = true; };
  }, [linkParameter, projektLaedt, project, searchParams, setSearchParams, t]);

  // Without an active project there is nothing to scope to — then all projects.
  const zeigeAlle = alleProjekte || !project;
  const scopedOrders = useMemo(
    () => (zeigeAlle ? changeOrders : nachtraegeDesProjekts(changeOrders, project)),
    [changeOrders, project, zeigeAlle]
  );
  // Wait for the project context too, otherwise the "all projects" list flashes
  // up before the active project is known.
  const laedt = isLoading || projektLaedt;

  const zurAbrechnung = () => ({
    action: { label: t("Zur Abrechnung"), onClick: () => navigate("/AVA?tab=settlement") },
    duration: 12000,
  });

  const statusSetzen = async (order, neu) => {
    const patch = statusWechsel(order, neu, projektDesNachtrags(order, projects));
    if (!patch) {
      toast.error(t("Dieser Statuswechsel ist nicht erlaubt."));
      return;
    }
    setBeschaeftigtId(order.id);
    try {
      await entities().ChangeOrder.update(order.id, patch);
      const meldung = neu === "approved" ? t("Nachtrag genehmigt")
        : neu === "rejected" ? t("Nachtrag abgelehnt")
          : t("Status geändert");
      toast.success(meldung, zurAbrechnung());
      await loadData({ leise: true });
    } catch (err) {
      toast.error(`${t("Nachtrag konnte nicht gespeichert werden")}: ${fehlerText(err)}`);
    } finally {
      setBeschaeftigtId(null);
    }
  };

  const bearbeiten = (order) => setFormular({ nachtrag: order });
  const neu = () => setFormular({ nachtrag: null });

  const speichern = async (daten) => {
    const bearbeitet = formular?.nachtrag;
    try {
      if (bearbeitet) {
        // Lazy backfill: the order's own project, never the active one blindly.
        const felder = projektFelder(bearbeitet, projektDesNachtrags(bearbeitet, projects));
        await entities().ChangeOrder.update(bearbeitet.id, { ...daten, ...felder });
        toast.success(t("Nachtrag gespeichert"), zurAbrechnung());
      } else {
        if (!project) return;
        await entities().ChangeOrder.create({ ...daten, project_id: project.id, project_name: project.name });
        toast.success(t("Nachtrag angelegt"));
      }
      setFormular(null);
      await loadData({ leise: true });
    } catch (err) {
      toast.error(`${t("Nachtrag konnte nicht gespeichert werden")}: ${fehlerText(err)}`);
    }
  };

  const untertitel = zeigeAlle
    ? t("Nachträge aller Projekte")
    : t("Nachträge für {name}").replace("{name}", project.name || "");

  return (
    <div className={seitenWurzel}>
      <div className="max-w-7xl mx-auto space-y-8">
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-slate-800 via-emerald-700 to-teal-600 bg-clip-text text-transparent">
              {t("Finanzen & Nachträge")}
            </h1>
            <p className="text-slate-600 mt-1">{untertitel}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* Link styled as a button: <Button asChild> would cost a tsc error. */}
            <Link to="/AVA?tab=control" className={buttonVariants({ variant: "outline" })}>
              <BarChart3 aria-hidden="true" />
              {t("Kostenkontrolle (AVA)")}
            </Link>
            {project && (
              <button
                type="button"
                aria-pressed={alleProjekte}
                onClick={() => setAlleProjekte((v) => !v)}
                className={buttonVariants({ variant: alleProjekte ? "secondary" : "outline" })}
              >
                {t("Alle Projekte")}
              </button>
            )}
            <Button
              onClick={neu}
              className="bg-gradient-to-r from-emerald-600 to-teal-600 shadow-lg hover:from-emerald-700 hover:to-teal-700"
            >
              <Plus className="w-4 h-4 mr-2" />
              {t("Neuer Nachtrag")}
            </Button>
            <Link to="/SiteControl" className="px-1 text-sm text-slate-500 underline-offset-4 hover:text-slate-700 hover:underline">
              {t("Baustellen-Leitstand (Labor)")}
            </Link>
          </div>
        </div>

        {ladeFehler ? (
          <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-6 space-y-3">
            <p className="font-medium text-red-800">{t("Nachträge konnten nicht geladen werden")}</p>
            <p className="text-sm text-red-700">{ladeFehler}</p>
            <button type="button" className={buttonVariants({ variant: "outline" })} onClick={() => loadData()}>
              {t("Erneut versuchen")}
            </button>
          </div>
        ) : (
          <>
            <FinanceSummary changeOrders={scopedOrders} isLoading={laedt} />

            <ChangeOrderTable
              changeOrders={scopedOrders}
              isLoading={laedt}
              zeigeProjekt={zeigeAlle}
              beschaeftigtId={beschaeftigtId}
              onStatus={statusSetzen}
              onBearbeiten={bearbeiten}
              onNeu={project ? neu : undefined}
            />
          </>
        )}
      </div>

      {formular && (
        <ChangeOrderForm
          key={formular.nachtrag?.id || `neu-${formular.vorbelegung?.issue_id || ""}`}
          aktivesProjekt={project}
          nachtrag={formular.nachtrag}
          vorbelegung={formular.vorbelegung}
          onSubmit={speichern}
          onCancel={() => setFormular(null)}
        />
      )}
    </div>
  );
}
