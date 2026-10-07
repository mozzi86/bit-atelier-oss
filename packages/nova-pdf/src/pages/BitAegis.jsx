import { seitenWurzel } from "@core/lib/utils";
import React, { useState, useEffect } from "react";
import { bitApi } from "@core/api/bitApi";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Badge } from "@core/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@core/components/ui/tabs";
import {
  Cloud,
  MapPin,
  Database,
  RefreshCw, // Changed from Sync to RefreshCw
  Shield,
  Users,
  FileText,
  Wrench
} from "lucide-react";
import { motion } from "framer-motion";

import { useProject } from "@core/lib/ProjectContext";
import CloudDataManager from "../components/CloudDataManager";
import PdfStudio from "../components/PdfStudio";
import PdfToolsGrid from "../components/PdfToolsGrid";
import { useI18n } from "@core/lib/i18n";

export default function BitAegis() {
  // 72-08 (N-02): the h1 is the menu title (src/navigation.js), same key.
  const { t } = useI18n();
  const [projects, setProjects] = useState([]);
  const [selectedProject, setSelectedProject] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [tab, setTab] = useState("tools");
  const [docs, setDocs] = useState([]);
  const [openDoc, setOpenDoc] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    loadProjects();
  }, []);

  // Testlauf 26.08.: Aegis verlangte einen ZWEITEN Projektklick und ignorierte das
  // oben gewählte Projekt — der Reiter „Cloud-Daten" blieb dadurch leer und wirkte tot.
  // Das global aktive Projekt ist die Vorauswahl; eigene Auswahl bleibt möglich.
  const { projectId: aktivesProjekt } = useProject();

  const loadProjects = async () => {
    setIsLoading(true);
    const data = await bitApi.entities.Project.list("name");
    setProjects(data);
    setSelectedProject((cur) => cur || data.find((p) => p.id === aktivesProjekt) || null);
    setIsLoading(false);
  };

  const loadDocs = async (pid) => {
    if (!pid) { setDocs([]); return; }
    const rows = await bitApi.entities.Document.filter({ project_id: pid }, "-uploaded_date");
    setDocs(rows);
  };

  // Projektwechsel in der Kopfzeile übernehmen.
  useEffect(() => {
    if (!aktivesProjekt || !projects.length) return;
    const p = projects.find((x) => x.id === aktivesProjekt);
    if (p) setSelectedProject(p);
  }, [aktivesProjekt, projects]);

  useEffect(() => {
    setOpenDoc(null);
    loadDocs(selectedProject?.id);
  }, [selectedProject?.id]);

  const handleToolsRefresh = () => {
    loadDocs(selectedProject?.id);
    setRefreshKey((k) => k + 1);
  };

  const handleAnnotate = (doc) => {
    setOpenDoc(doc);
    setTab("pdf");
  };

  return (
    <div className={seitenWurzel}>
      <div className="max-w-7xl mx-auto space-y-8">
        
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center space-y-4"
        >
          <div className="flex items-center justify-center gap-3 mb-4">
            <div className="p-4 bg-gradient-to-br from-emerald-600 to-teal-600 rounded-2xl shadow-xl">
              <Cloud className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-4xl font-bold bg-gradient-to-r from-slate-800 via-emerald-700 to-teal-600 bg-clip-text text-transparent">
              {t("PDF & Ablage")}
            </h1>
          </div>
          <p className="text-xl text-slate-600 max-w-3xl mx-auto">
            Datenmanagement und Zusammenarbeit für alle Projektdateien,
            Dokumente und die Koordination im Team — inklusive PDF-Studio
          </p>
        </motion.div>

        {/* Cloud Features Overview */}
        <div className="grid md:grid-cols-4 gap-6 mb-8">
          <Card className="border-0 shadow-sm rounded-xl bg-white hover:shadow-md transition-shadow">
            <CardContent className="p-6 text-center">
              <div className="inline-flex p-2.5 rounded-xl bg-emerald-50 mb-3">
                <Database className="w-8 h-8 text-emerald-600" />
              </div>
              <h3 className="font-semibold text-lg mb-1 text-slate-800">Datenspeicher</h3>
              <p className="text-slate-600 text-sm">Sichere Ablage für alle Projektdateien</p>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm rounded-xl bg-white hover:shadow-md transition-shadow">
            <CardContent className="p-6 text-center">
              <div className="inline-flex p-2.5 rounded-xl bg-teal-50 mb-3">
                <RefreshCw className="w-8 h-8 text-teal-600" /> {/* Changed from Sync to RefreshCw */}
              </div>
              <h3 className="font-semibold text-lg mb-1 text-slate-800">Sync & Backup</h3>
              <p className="text-slate-600 text-sm">Synchronisation in Echtzeit im ganzen Team</p>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm rounded-xl bg-white hover:shadow-md transition-shadow">
            <CardContent className="p-6 text-center">
              <div className="inline-flex p-2.5 rounded-xl bg-blue-50 mb-3">
                <Shield className="w-8 h-8 text-blue-600" />
              </div>
              <h3 className="font-semibold text-lg mb-1 text-slate-800">Sicherheit</h3>
              <p className="text-slate-600 text-sm">Sicherheit & Compliance auf Unternehmensniveau</p>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm rounded-xl bg-white hover:shadow-md transition-shadow">
            <CardContent className="p-6 text-center">
              <div className="inline-flex p-2.5 rounded-xl bg-violet-50 mb-3">
                <Users className="w-8 h-8 text-violet-600" />
              </div>
              <h3 className="font-semibold text-lg mb-1 text-slate-800">Zusammenarbeit</h3>
              <p className="text-slate-600 text-sm">Team-Arbeitsbereich und Dateifreigabe</p>
            </CardContent>
          </Card>
        </div>

        {/* Project Selection */}
        <Card className="border-0 shadow-xl bg-white/80 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MapPin className="w-5 h-5 text-emerald-600" />
              Projektauswahl
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {projects.map(project => (
                <motion.div
                  key={project.id}
                  whileHover={{ scale: 1.02 }}
                  onClick={() => setSelectedProject(project)}
                  className={`p-4 rounded-xl border-2 cursor-pointer transition-all ${
                    selectedProject?.id === project.id
                      ? 'border-emerald-500 bg-emerald-50'
                      : 'border-slate-200 hover:border-emerald-300 bg-white'
                  }`}
                >
                  <h3 className="font-semibold text-slate-800">{project.name}</h3>
                  <p className="text-sm text-slate-600 mt-1">{project.location?.address}</p>
                  <div className="flex items-center justify-between mt-3">
                    <Badge variant="outline" className="text-xs">
                      {project.climate_zone}
                    </Badge>
                    <span className="text-xs text-slate-500">HOAI {project.hoai_phase}/9</span>
                  </div>
                </motion.div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* PDF-Werkzeuge, PDF-Studio & Cloud-Daten */}
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="flex flex-wrap h-auto gap-1 bg-slate-100">
            <TabsTrigger value="tools"><Wrench className="w-4 h-4 mr-2" /> PDF-Werkzeuge</TabsTrigger>
            <TabsTrigger value="pdf"><FileText className="w-4 h-4 mr-2" /> PDF-Studio</TabsTrigger>
            <TabsTrigger value="cloud"><Cloud className="w-4 h-4 mr-2" /> Cloud-Daten</TabsTrigger>
          </TabsList>

          <TabsContent value="tools" className="pt-4">
            <PdfToolsGrid
              project={selectedProject}
              documents={docs}
              onRefresh={handleToolsRefresh}
              onAnnotate={handleAnnotate}
            />
          </TabsContent>

          <TabsContent value="pdf" className="pt-4">
            <PdfStudio project={selectedProject} openDoc={openDoc} refreshKey={refreshKey} />
          </TabsContent>

          <TabsContent value="cloud" className="pt-4">
            <CloudDataManager
              selectedProject={selectedProject}
              projects={projects}
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}