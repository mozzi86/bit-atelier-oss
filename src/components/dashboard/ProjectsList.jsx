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
  ExternalLink,
  Plus
} from "lucide-react";
import { Skeleton } from "@core/components/ui/skeleton";
import { Link, useNavigate } from "react-router-dom";
import { createPageUrl } from "@core/utils";
import { format } from "date-fns";
import { FileText } from "lucide-react";
import { useProject } from "@core/lib/ProjectContext";

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

const ProjectCard = ({ project, index, onReport }) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.5, delay: index * 0.1 }}
  >
    <Card className="group hover:shadow-xl transition-all duration-300 border-0 shadow-lg bg-white/80 backdrop-blur-sm">
      <CardHeader className="pb-4">
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <CardTitle className="text-lg font-bold text-slate-800 group-hover:text-emerald-700 transition-colors">
              {project.name}
            </CardTitle>
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <MapPin className="w-4 h-4" />
              <span>{project.location?.address || project.location || 'Location not specified'}</span>
              <Thermometer className="w-4 h-4 ml-2" />
              <span className="capitalize">{project.climate_zone}</span>
            </div>
          </div>
          <Badge className={statusColors[project.status] || statusColors.concept}>
            {project.status?.replace('_', ' ')}
          </Badge>
        </div>
      </CardHeader>
      
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-slate-500 mb-1">HOAI Phase</p>
            <p className="font-semibold">{project.hoai_phase || 'N/A'}/9</p>
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-1">Area</p>
            <p className="font-semibold">{project.building_area?.toLocaleString() || 'TBD'} m²</p>
          </div>
        </div>

        {project.sustainability_rating && (
          <div>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-slate-600">Sustainability Score</span>
              <span className="font-semibold">{project.sustainability_rating}%</span>
            </div>
            <Progress 
              value={project.sustainability_rating} 
              className="h-2"
            />
          </div>
        )}

        <div className="flex items-center justify-between pt-2">
          {project.energy_target && (
            <Badge variant="outline" className={energyTargetColors[project.energy_target]}>
              {project.energy_target?.replace('_', ' ').toUpperCase()}
            </Badge>
          )}

          {project.completion_date && (
            <div className="flex items-center gap-1 text-xs text-slate-500">
              <Calendar className="w-3 h-3" />
              {format(new Date(project.completion_date), 'MMM yyyy')}
            </div>
          )}
          <Button variant="outline" size="sm" className="h-7 px-2 text-xs border-emerald-200 text-emerald-700 hover:bg-emerald-50"
            onClick={() => onReport?.(project)} aria-label={`Bericht für ${project.name}`}>
            <FileText className="w-3.5 h-3.5 mr-1" /> Bericht
          </Button>
        </div>
      </CardContent>
    </Card>
  </motion.div>
);

export default function ProjectsList({ projects, isLoading }) {
  const navigate = useNavigate();
  const { setProjectId } = useProject();
  // Ein-Klick-Bericht: Projekt global setzen und Berichte-Seite öffnen.
  const openReport = (project) => { setProjectId(project.id); navigate(createPageUrl("Reports")); };
  if (isLoading) {
    return (
      <Card className="border-0 shadow-lg">
        <CardHeader>
          <CardTitle>Recent Projects</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="space-y-3 p-4 border rounded-lg">
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
                <div className="flex gap-4">
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-4 w-20" />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-0 shadow-lg bg-white/60 backdrop-blur-sm">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-xl font-bold text-slate-800">Recent Projects</CardTitle>
        <Link to={createPageUrl("Projects")}>
          <Button variant="outline" size="sm" className="border-emerald-200 text-emerald-700 hover:bg-emerald-50">
            <Plus className="w-4 h-4 mr-1" />
            New Project
          </Button>
        </Link>
      </CardHeader>
      
      <CardContent>
        {projects.length === 0 ? (
          <div className="text-center py-12">
            <Building2 className="w-12 h-12 text-slate-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-slate-600 mb-2">No projects yet</h3>
            <p className="text-slate-500 mb-4">Start your first climate-optimized project</p>
            <Link to={createPageUrl("Projects")}>
              <Button className="bg-gradient-to-r from-emerald-600 to-teal-600">
                <Plus className="w-4 h-4 mr-2" />
                Create Project
              </Button>
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            <AnimatePresence>
              {projects.slice(0, 5).map((project, index) => (
                <ProjectCard key={project.id} project={project} index={index} onReport={openReport} />
              ))}
            </AnimatePresence>
            
            {projects.length > 5 && (
              <div className="text-center pt-4">
                <Link to={createPageUrl("Projects")}>
                  <Button variant="outline" className="border-slate-200">
                    View All Projects
                    <ExternalLink className="w-4 h-4 ml-2" />
                  </Button>
                </Link>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}