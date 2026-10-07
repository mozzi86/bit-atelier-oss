import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Badge } from "@core/components/ui/badge";
import { Button } from "@core/components/ui/button";
import { Progress } from "@core/components/ui/progress";
import {
  Building2,
  MapPin,
  Calendar,
  Thermometer,
  Pencil,
  FileText,
  Trash2
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@core/utils";
import { useProject } from "@core/lib/ProjectContext";
import EmptyState from "@core/components/common/EmptyState";
import LoadingState from "@core/components/common/LoadingState";
import { STATUS_LABELS, CLIMATE_ZONE_LABELS, ENERGY_TARGET_LABELS, labelFor } from "./labels";

const statusColors = {
  concept: "bg-slate-100 text-slate-700 border-slate-200",
  design_development: "bg-blue-100 text-blue-700 border-blue-200",
  technical_design: "bg-purple-100 text-purple-700 border-purple-200",
  construction: "bg-orange-100 text-orange-700 border-orange-200",
  completed: "bg-emerald-100 text-emerald-700 border-emerald-200"
};

const energyTargetColors = {
  passive_house: "bg-green-100 text-green-800",
  kfw_55: "bg-blue-100 text-blue-800",
  kfw_40: "bg-purple-100 text-purple-800",
  net_zero: "bg-emerald-100 text-emerald-800",
  plus_energy: "bg-amber-100 text-amber-800"
};

const ProjectCard = ({ project, onEdit, onReport, onDelete, onActivate, isAktiv, index }) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.5, delay: index * 0.1 }}
  >
    {/* 72-01 A-11 (Befund N-17): Karten-Klick = Projekt aktivieren — vorher
        ging das nur über die Kopfzeile; die Knöpfe darunter stoppen das Event. */}
    <Card
      className={`group hover:shadow-xl transition-all duration-300 border-0 shadow-lg bg-white/80 backdrop-blur-sm cursor-pointer ${isAktiv ? "ring-2 ring-emerald-500" : ""}`}
      onClick={() => onActivate?.(project)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onActivate?.(project);
        }
      }}
      aria-label={`Projekt ${project.name} aktivieren${isAktiv ? " (aktuell aktiv)" : ""}`}
    >
      <CardHeader className="pb-4">
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <CardTitle className="text-lg font-bold text-slate-800 group-hover:text-emerald-700 transition-colors">
              {project.name}
              {isAktiv && <Badge variant="outline" className="ml-2 text-[10px] border-emerald-300 text-emerald-700 align-middle">Aktiv</Badge>}
            </CardTitle>
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <MapPin className="w-4 h-4" />
              <span>{project.location?.address || project.location || 'Standort nicht angegeben'}</span>
              <Thermometer className="w-4 h-4 ml-2" />
              <span>{labelFor(CLIMATE_ZONE_LABELS, project.climate_zone)}</span>
            </div>
          </div>
          <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
            <Badge className={statusColors[project.status] || statusColors.concept}>
              {labelFor(STATUS_LABELS, project.status)}
            </Badge>
            <Button variant="ghost" size="icon" onClick={() => onReport(project)} title="Bericht erstellen" aria-label={`Bericht für ${project.name}`}>
              <FileText className="w-4 h-4 text-emerald-600" />
            </Button>
            {/* 72-01 A-11/A-22: namenloser Stift-Knopf bekommt aria-label. */}
            <Button variant="ghost" size="icon" onClick={() => onEdit(project)} title="Bearbeiten" aria-label={`Bearbeiten: ${project.name}`}>
              <Pencil className="w-4 h-4" />
            </Button>
            {/* 72-01 A-11 (Befund N-17): Löschen mit Rückfrage (in Projects.jsx). */}
            <Button variant="ghost" size="icon" onClick={() => onDelete?.(project)} title="Löschen" aria-label={`Löschen: ${project.name}`} className="text-red-500 hover:text-red-700">
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-slate-500 mb-1">HOAI-Phase</p>
            <p className="font-semibold">{project.hoai_phase || 'k. A.'}/9</p>
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-1">Fläche</p>
            <p className="font-semibold">{project.building_area?.toLocaleString('de-DE') || 'k. A.'} m²</p>
          </div>
        </div>

        {project.sustainability_rating && (
          <div>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-slate-600">Nachhaltigkeit</span>
              <span className="font-semibold">
                {Number.isFinite(Number(project.sustainability_rating))
                  ? `${project.sustainability_rating}%`
                  : project.sustainability_rating}
              </span>
            </div>
            {Number.isFinite(Number(project.sustainability_rating)) && (
              <Progress
                value={Number(project.sustainability_rating)}
                className="h-2"
              />
            )}
          </div>
        )}

        <div className="flex items-center justify-between pt-2">
          {project.energy_target && (
            <Badge variant="outline" className={energyTargetColors[project.energy_target]}>
              {labelFor(ENERGY_TARGET_LABELS, project.energy_target)}
            </Badge>
          )}
          
          {project.completion_date && (
            <div className="flex items-center gap-1 text-xs text-slate-500">
              <Calendar className="w-3 h-3" />
              {new Date(project.completion_date).toLocaleDateString('de-DE', { month: 'short', year: 'numeric' })}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  </motion.div>
);

export default function ProjectGrid({ projects, isLoading, onEdit, onDelete }) {
  const navigate = useNavigate();
  const { setProjectId, projectId } = useProject();
  // Ein-Klick-Bericht: Projekt global setzen und Berichte-Seite öffnen.
  const openReport = (project) => { setProjectId(project.id); navigate(createPageUrl("Reports")); };
  // 72-01 A-11: Karten-Klick = aktivieren (mit Rückmeldung per „Aktiv"-Ring).
  const activate = (project) => { setProjectId(project.id); };
  if (isLoading) {
    return <LoadingState variant="cards" rows={6} className="grid-cols-1 lg:grid-cols-3" />;
  }

  if (projects.length === 0) {
    return (
      <EmptyState
        icon={Building2}
        title="Keine Projekte gefunden"
        description="Lege dein erstes klima-optimiertes Projekt an, um zu starten."
      />
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      <AnimatePresence>
        {projects.map((project, index) => (
          <ProjectCard
            key={project.id}
            project={project}
            onEdit={onEdit}
            onReport={openReport}
            onDelete={onDelete}
            onActivate={activate}
            isAktiv={project.id === projectId}
            index={index}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}