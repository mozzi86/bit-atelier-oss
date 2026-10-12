import { seitenWurzel } from "@core/lib/utils";
import React, { useState, useEffect, useMemo } from "react";
import { projekteNachZugriff } from "@core/lib/rechte.js";
import { useZugriff } from "@core/lib/ZugriffContext.jsx";
import { useSearchParams, useNavigate } from "react-router-dom";
import { bitApi } from "@core/api/bitApi";
import { Button } from "@core/components/ui/button";
import { Input } from "@core/components/ui/input";
import { Plus, Search } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { useProject } from "@core/lib/ProjectContext";
import { createPageUrl } from "@core/utils";
import { normalisiereProjekte } from "@core/lib/labels";
import { useI18n } from "@core/lib/i18n";
import { useBestaetigung } from "@core/lib/useBestaetigung";
import { BUERO_CLOUD_FREIGABE, DATENQUELLE } from "@core/lib/umgebung";
import { datumText, heuteLokal } from "@core/lib/kalender/datum.js";
import { istArchiviert, ladeLoeschDaten, loeschSperre } from "@/lib/projektLoeschschutz.js";

import ProjectForm from "../components/projects/ProjectForm";
import ProjectGrid from "../components/projects/ProjectGrid";
// 72-02: Drei-Karten-Leitfaden direkt nach dem Anlegen (Review §3 B.3).
import Startpfad from "../components/projects/Startpfad";
import ProjectFilters from "../components/projects/ProjectFilters";

/** Fills {key} placeholders after translation. */
const fuellen = (/** @type {string} */ text, /** @type {Record<string, any>} */ werte) => text.replace(/\{(\w+)\}/g, (_, k) => String(werte[k] ?? ""));

/**
 * Plural label of a guard reason (literal t() calls for the EN guard).
 * @param {(k: string) => string} t
 * @param {string} entitaet
 * @returns {string}
 */
function grundText(t, entitaet) {
  if (entitaet === "Zeitbuchung") return t("Zeitbuchungen");
  if (entitaet === "Honorarangebot") return t("Honorarangebote");
  if (entitaet === "Honorarvertrag") return t("Architektenverträge");
  return t("Ausgangsrechnungen");
}

export default function Projects() {
  // 82-02: the role's project view (same filter as ProjectContext) — applied on render, so "Ansicht als" needs no reload.
  const zugriff = useZugriff();
  const [rohProjekte, setProjects] = useState([]);
  const projects = useMemo(() => projekteNachZugriff(rohProjekte, zugriff), [rohProjekte, zugriff]);
  const [filteredProjects, setFilteredProjects] = useState([]);
  // 72-01 A-9 (Befund N-13): /Projects?neu=1 öffnet das Formular direkt —
  // der Dashboard-Button „Neues Projekt" verlinkt hierher.
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [showForm, setShowForm] = useState(() => searchParams.get("neu") === "1");
  // 72-02: ?start=<id> nach dem Anlegen → Drei-Karten-Leitfaden über der Liste.
  const startId = searchParams.get("start");
  const startProjekt = startId ? projects.find((p) => p.id === startId) : null;
  const [editingProject, setEditingProject] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [filters, setFilters] = useState({
    status: "all",
    climate_zone: "all",
    hoai_phase: "all",
    standards: "all"
  });
  // 72-01 A-6 (Befund N-06): nach dem Anlegen MUSS das neue Projekt aktiv
  // werden — sonst arbeitet der Nutzer unbemerkt im alten weiter.
  const { setProjectId, reloadProjects } = useProject();
  // 72-08 (N-02): the h1 is the menu title (src/navigation.js), same key.
  const { t, lang } = useI18n();
  const bestaetige = useBestaetigung();

  useEffect(() => {
    loadProjects();
  }, []);

  // 72-01 A-9: Navigation auf dieselbe Route mit ?neu=1 (z. B. zweiter Klick
  // auf dem Dashboard) öffnet das Formular auch, wenn die Seite schon offen ist.
  useEffect(() => {
    if (searchParams.get("neu") === "1") {
      setShowForm(true);
      setEditingProject(null);
    }
  }, [searchParams]);

  useEffect(() => {
    filterProjects();
  }, [projects, searchTerm, filters]);

  const loadProjects = async () => {
    setIsLoading(true);
    // 72-01 A-7: alte Label-Werte (Seed-Generation) beim Lesen auf Keys
    // normalisieren — Filter und Anzeige arbeiten auf einer Wertebasis.
    const data = normalisiereProjekte(await bitApi.entities.Project.list("-updated_date"));
    setProjects(data);
    setIsLoading(false);
  };

  const filterProjects = () => {
    // 81-06: archived projects leave the grid; they are listed under "Archiviert".
    let filtered = projects.filter((p) => !istArchiviert(p));

    // Search filter — 72-01 A-7: fehlende Felder (z. B. kein Auftraggeber)
    // dürfen die Suche nicht mit einem TypeError abbrechen lassen.
    if (searchTerm) {
      const such = searchTerm.toLowerCase();
      filtered = filtered.filter((project) =>
        String(project.name || "").toLowerCase().includes(such) ||
        String(project.client || "").toLowerCase().includes(such) ||
        String(project.location?.address || project.location || "").toLowerCase().includes(such)
      );
    }

    // Status filter
    if (filters.status !== "all") {
      filtered = filtered.filter(project => project.status === filters.status);
    }

    // Climate zone filter  
    if (filters.climate_zone !== "all") {
      filtered = filtered.filter(project => project.climate_zone === filters.climate_zone);
    }

    // HOAI phase filter
    if (filters.hoai_phase !== "all") {
      filtered = filtered.filter(project => project.hoai_phase?.toString() === filters.hoai_phase);
    }

    setFilteredProjects(filtered);
  };

  const handleSubmit = async (projectData) => {
    /** @type {string|null} id of a freshly created project → ?start=<id> (72-02) */
    let neuerStart = null;
    if (editingProject) {
      await bitApi.entities.Project.update(editingProject.id, projectData);
      toast.success("Projekt aktualisiert");
    } else {
      // 72-01 A-6 (Befund N-06): anlegen → AKTIVIEREN → globale Projektliste
      // neu laden → Toast mit nächstem Schritt (Standort im Designer).
      const created = await bitApi.entities.Project.create(projectData);
      if (created?.id) {
        setProjectId(created.id);
        reloadProjects?.();
        // 72-02: gemerkt, gesetzt wird der Parameter unten in EINEM Schreib-
        // vorgang zusammen mit dem Entfernen von ?neu=1 — zwei getrennte
        // setSearchParams auf demselben Render überschrieben sich gegenseitig.
        neuerStart = created.id;
      }
      toast.success("Projekt angelegt — jetzt Standort festlegen", {
        description: "Im Komplex-Designer den Standort übernehmen und den Entwurf beginnen.",
        action: { label: "Zum Designer", onClick: () => navigate(createPageUrl("ComplexDesigner")) },
      });
    }

    setShowForm(false);
    setEditingProject(null);
    // ?neu=1 aus der URL entfernen, sonst öffnet der Parameter-Effekt das
    // Formular nach jedem Schließen wieder. Im selben Schritt ?start=<id>
    // setzen, wenn gerade ein Projekt angelegt wurde (72-02).
    if (searchParams.get("neu") || neuerStart) {
      searchParams.delete("neu");
      if (neuerStart) searchParams.set("start", neuerStart);
      setSearchParams(searchParams, { replace: true });
    }
    loadProjects();
  };

  const handleEdit = (project) => {
    setEditingProject(project);
    setShowForm(true);
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingProject(null);
    if (searchParams.get("neu")) {
      searchParams.delete("neu");
      setSearchParams(searchParams, { replace: true });
    }
  };

  // 81-06 (D-P81-30): archive instead of delete; restore clears the field.
  const setzeArchiv = async (project, datum) => {
    try {
      await bitApi.entities.Project.update(project.id, { archiviert_am: datum });
      toast.success(fuellen(datum ? t("Projekt „{name}“ archiviert") : t("Projekt „{name}“ wiederhergestellt"), { name: project.name }));
      reloadProjects?.();
      loadProjects();
    } catch (err) {
      toast.error(fuellen(t("Archivieren fehlgeschlagen: {fehler}"), { fehler: err?.message || err }));
    }
  };

  // 72-01 A-11 (Befund N-17): Projekt löschen mit Rückfrage im Klartext.
  // 81-06 (BUERO-03): first the deletion guard — time bookings, fee offers,
  // contracts and invoices have retention duties, such a project is archived
  // instead (the dialog has no delete button). The guard reads 81 data only
  // through the 81 storage layer and nothing on a locked data path (E-03).
  const handleDelete = async (project) => {
    let daten;
    try {
      daten = await ladeLoeschDaten(bitApi, project.id, { datenquelle: DATENQUELLE, cloudFreigabe: BUERO_CLOUD_FREIGABE });
    } catch (err) {
      toast.error(fuellen(t("Löschprüfung fehlgeschlagen — nichts gelöscht: {fehler}"), { fehler: err?.message || err }));
      return;
    }
    const sperre = loeschSperre(project.id, daten);
    if (sperre.gesperrt) {
      const gruende = sperre.gruende.map((g) => `${grundText(t, g.entitaet)}: ${g.anzahl}`).join(", ");
      const archivieren = await bestaetige({
        titel: fuellen(t("„{name}“ kann nicht gelöscht werden"), { name: project.name }),
        text: `${t("Stundennachweise, Verträge und Rechnungen sind aufbewahrungspflichtig.")} ${gruende}. ${t("Archivieren blendet das Projekt in der Projektwahl aus; alle Daten bleiben erhalten.")}`,
        bestaetigen: t("Archivieren"),
      });
      if (archivieren) await setzeArchiv(project, heuteLokal());
      return;
    }
    const ok = window.confirm(`Projekt „${project.name}" wirklich löschen? Zugehörige Daten (Entwürfe, LV, Issues) bleiben als Waisen erhalten.`);
    if (!ok) return;
    try {
      await bitApi.entities.Project.delete(project.id);
      toast.success(`Projekt „${project.name}" gelöscht`);
      // War es das aktive Projekt, ist die Auswahl jetzt leer — der
      // ProjectContext fällt beim nächsten Reload auf das erste Projekt.
      reloadProjects?.();
      loadProjects();
    } catch (err) {
      toast.error(`Löschen fehlgeschlagen: ${err?.message || err}`);
    }
  };

  return (
    <div className={seitenWurzel}>
      <div className="max-w-7xl mx-auto space-y-8">
        
        {/* Header */}
        <motion.div 
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6"
        >
          <div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-slate-800 via-emerald-700 to-teal-600 bg-clip-text text-transparent">
              {t("Projekte")}
            </h1>
            <p className="text-slate-600 mt-1">
              Projekte anlegen, bearbeiten und filtern — mit BIM- und Energie-Anbindung
            </p>
          </div>

          <Button
            onClick={() => setShowForm(!showForm)}
            className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 shadow-lg"
          >
            <Plus className="w-4 h-4 mr-2" />
            Neues Projekt
          </Button>
        </motion.div>

        {/* Search and Filters */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="flex flex-col lg:flex-row gap-4"
        >
          <div className="relative flex-1">
            <Search aria-hidden="true" className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4 pointer-events-none" />
            <Input
              aria-label="Projekte suchen"
              placeholder="Projekte nach Name, Auftraggeber oder Ort suchen..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 border-slate-200 focus:border-emerald-500 focus-visible:ring-emerald-500/40"
            />
          </div>
          
          <ProjectFilters 
            filters={filters}
            onFilterChange={setFilters}
          />
        </motion.div>

        {/* Project Form */}
        <AnimatePresence>
          {showForm && (
            <ProjectForm
              project={editingProject}
              onSubmit={handleSubmit}
              onCancel={handleCancel}
            />
          )}
        </AnimatePresence>

        {/* 72-02: Nach „Projekt anlegen" führt ?start=<id> hierher — drei
            Karten statt eines leeren Dashboards. Der Parameter verschwindet
            beim nächsten Seitenwechsel, die Karten sind also nicht dauerhaft. */}
        {startProjekt && <Startpfad project={startProjekt} />}

        {/* Projects Grid */}
        <ProjectGrid
          projects={filteredProjects}
          isLoading={isLoading}
          onEdit={handleEdit}
          onDelete={handleDelete}
        />

        {/* 81-06: archived projects, collapsed, with "Wiederherstellen". */}
        {projects.some(istArchiviert) && (
          <details className="rounded-lg border border-slate-200 p-3 dark:border-slate-700" data-testid="projekte-archiviert">
            <summary className="cursor-pointer text-sm font-medium text-slate-700 dark:text-slate-200">
              {fuellen(t("Archiviert ({n})"), { n: projects.filter(istArchiviert).length })}
            </summary>
            <ul className="mt-2 space-y-2">
              {projects.filter(istArchiviert).map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span>{p.name} <span className="text-slate-500">· {t("archiviert am")} {datumText(p.archiviert_am, lang)}</span></span>
                  <Button type="button" variant="outline" size="sm" onClick={() => setzeArchiv(p, null)}>{t("Wiederherstellen")}</Button>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}