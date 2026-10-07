import { seitenWurzel } from "@core/lib/utils";
import React, { useEffect, useRef, useState } from "react";
import { bitApi } from "@core/api/bitApi";
import { useProject } from "@core/lib/ProjectContext";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Button } from "@core/components/ui/button";
import { Badge } from "@core/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@core/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@core/components/ui/select";
import { motion } from "framer-motion";
import {
  Radio, Cpu, CalendarRange, Octagon, Pause, Play, Monitor, Smartphone, Glasses, Box, X,
  Brain, Plug, ScrollText, Layers,
} from "lucide-react";
import { useSiteSimulation } from "../components/site/useSiteSimulation";
import SitePlan from "../components/site/SitePlan";
import UnitCommander from "../components/site/UnitCommander";
import LiveFeed from "../components/site/LiveFeed";
import FleetStatus from "../components/site/FleetStatus";
import FleetEmptyState from "../components/site/FleetEmptyState";
import { toast } from "sonner";
import GanttSchedule from "../components/site/GanttSchedule";
import TaskScheduleForm from "../components/site/TaskScheduleForm";
import WeatherPanel from "../components/site/WeatherPanel";
import { useWeather } from "../components/site/useWeather";
import { computeDispatch, AREA_POINTS } from "../components/site/dispatch";
import BimTaskPanel from "../components/site/BimTaskPanel";
import TelemetryPanel from "../components/site/TelemetryPanel";
import AuditLogPanel from "../components/site/AuditLogPanel";
import FourDFiveD from "../components/site/FourDFiveD";
import ARSiteView from "../components/site/ARSiteView";
import { getTelemetryConfig } from "@/lib/telemetry";

const VIEW_MODES = [
  { id: "office", label: "Büro", icon: Monitor },
  { id: "mobile", label: "Mobil", icon: Smartphone },
  { id: "ar", label: "AR (Vor-Ort)", icon: Glasses },
  { id: "vr", label: "VR", icon: Box },
];

const ROLES = {
  bauleiter: { label: "Bauleiter", can: { command: true, emergency: true, zones: true } },
  polier: { label: "Polier", can: { command: true, emergency: false, zones: false } },
  beobachter: { label: "Beobachter", can: { command: false, emergency: false, zones: false } },
};

// Demo-Flotte nach dem Muster der geseedeten proj-1-Einheiten:
// genau 3 Drohnen + 3 Roboter, Status-Mix idle/working, Positionen im Lageplan verteilt.
const DEMO_FLEET = [
  { type: "drone", name: "Drohne Vermessung 1", status: "working", battery: 92, x: 58, y: 22, target: null, task: "Gelände-Scan", area: "Rohbau Nord" },
  { type: "drone", name: "Drohne Inspektion 2", status: "idle", battery: 88, x: 84, y: 16, target: null, task: "Bereit", area: "Basis" },
  { type: "drone", name: "Drohne Logistik 3", status: "idle", battery: 74, x: 80, y: 24, target: null, task: "Bereit", area: "Basis" },
  { type: "robot", name: "Roboter-Maurer 1", status: "working", battery: 81, x: 32, y: 38, target: null, task: "Mauerwerk EG", area: "Rohbau Nord" },
  { type: "robot", name: "3D-Druck-Roboter 2", status: "working", battery: 96, x: 70, y: 60, target: null, task: "Druck Wandsegment", area: "Rohbau Süd" },
  { type: "robot", name: "Transport-Roboter 3", status: "idle", battery: 63, x: 20, y: 72, target: null, task: "Bereit", area: "Logistik" },
];

const TELEMETRY_LABEL = {
  simulation: "Telemetrie: Simulation",
  mqtt: "Telemetrie: MQTT/Live",
  webrtc: "Telemetrie: WebRTC/Live",
};

export default function SiteControl() {
  const { projectId, project } = useProject();
  const [contacts, setContacts] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [activeTab, setActiveTab] = useState("live");
  const [viewMode, setViewMode] = useState("office");
  const [selectedId, setSelectedId] = useState(null);
  const [commandMode, setCommandMode] = useState(null);
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [role, setRole] = useState("bauleiter");
  const [telemetrySource, setTelemetrySource] = useState("simulation");

  const sim = useSiteSimulation(projectId);
  const can = ROLES[role].can;

  useEffect(() => {
    getTelemetryConfig().then((c) => setTelemetrySource(c?.source || "simulation"));
  }, []);

  const switchRole = (next) => {
    if (next === role) return;
    setRole(next);
    sim.addEvent(`Rolle gewechselt: ${ROLES[next].label}`, "info");
  };

  const [issues, setIssues] = useState([]);
  const [autoDispatch, setAutoDispatch] = useState(false);
  const lastAirspaceRef = useRef(null);

  const weather = useWeather(project?.location?.lat ?? 49.45, project?.location?.lng ?? 11.08);

  // Weather → drone airspace lock (only when the restriction actually changes).
  useEffect(() => {
    const closed = weather.restrictions.droneGround;
    if (lastAirspaceRef.current === closed) return;
    lastAirspaceRef.current = closed;
    sim.setAirspaceClosed(closed, weather.restrictions.reason);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weather.restrictions.droneGround]);

  const loadIssues = () =>
    bitApi.entities.Issue.filter({ project_id: projectId }).then(setIssues);
  useEffect(() => { loadIssues(); /* eslint-disable-next-line */ }, [projectId]);

  // KI-Disposition: assign idle units to the most behind-schedule areas.
  const runDispatch = () => {
    if (!can.command) {
      sim.addEvent("Rolle Beobachter: nur Lesezugriff", "info");
      return;
    }
    const plan = computeDispatch(sim.units, tasks, Date.now(), sim.airspaceClosed);
    if (plan.length === 0) {
      sim.addEvent("KI-Disposition: keine freien Einheiten oder kein Rückstand", "info");
      return;
    }
    plan.forEach((a) => sim.assign(a.unitId, a.point, a.label, `🧠 ${a.unitName} → ${a.area} (Rückstand ${a.deficit}%)`, "success"));
  };
  useEffect(() => {
    if (!autoDispatch || !can.command) return;
    const id = setInterval(runDispatch, 8000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoDispatch, sim.units, tasks, role]);

  // BIM ticket → robot order.
  const assignTicketToRobot = async (issue) => {
    if (!can.command) {
      sim.addEvent("Rolle Beobachter: nur Lesezugriff", "info");
      return;
    }
    const robot = sim.units.find((u) => u.status === "idle" && u.type === "robot");
    if (!robot) return;
    const areaKey = issue.building_id === "bld-2" ? "Rohbau Süd" : "Rohbau Nord";
    const base = AREA_POINTS[areaKey] || { x: 50, y: 50 };
    const point = { x: base.x + (Math.random() * 8 - 4), y: base.y + (Math.random() * 8 - 4) };
    sim.assign(robot.id, point, `Ticket: ${issue.title}`, `🤖 ${robot.name} → BIM-Ticket „${issue.title}"`, "success");
    await bitApi.entities.Issue.update(issue.id, { status: "in_progress", assigned_unit_id: robot.id, assigned_unit_name: robot.name });
    loadIssues();
  };

  useEffect(() => {
    bitApi.entities.Contact.list("name").then(setContacts);
  }, []);

  const loadTasks = () =>
    bitApi.entities.ScheduleTask.filter({ project_id: projectId }).then(setTasks);
  useEffect(() => { loadTasks(); /* eslint-disable-next-line */ }, [projectId]);

  const handlePlanClick = (point) => {
    if (!selectedId || !commandMode) return;
    if (!can.command) {
      sim.addEvent("Rolle Beobachter: nur Lesezugriff", "info");
      setCommandMode(null);
      return;
    }
    if ((commandMode === "deliver" || commandMode === "print") && !can.zones) {
      sim.addEvent(`Rolle ${ROLES[role].label}: keine Berechtigung für Zonen-Befehle`, "info");
      setCommandMode(null);
      return;
    }
    if (commandMode === "deliver") sim.setDeliveryDrop(selectedId, point);
    else if (commandMode === "print") sim.setPrintTarget(selectedId, point);
    else sim.moveTo(selectedId, point);
    setCommandMode(null);
  };

  // Demo-Flotte fürs aktuelle Projekt anlegen (3 Drohnen + 3 Roboter).
  const [seeding, setSeeding] = useState(false);
  const fleetEmpty = sim.loaded && sim.units.length === 0;
  const seedDemoFleet = async () => {
    if (seeding || !projectId) return;
    setSeeding(true);
    try {
      for (const u of DEMO_FLEET) {
        await bitApi.entities.SiteUnit.create({ ...u, project_id: projectId });
      }
      await sim.reload();
      sim.addEvent("Demo-Flotte angelegt: 3 Drohnen, 3 Roboter", "success");
      toast.success("Demo-Flotte angelegt: 3 Drohnen, 3 Roboter");
    } catch {
      toast.error("Demo-Flotte konnte nicht angelegt werden");
    } finally {
      setSeeding(false);
    }
  };

  const counts = sim.units.reduce((m, u) => ((m[u.status] = (m[u.status] || 0) + 1), m), {});

  // ---- AR / VR immersive overlay ----
  if (viewMode === "ar" || viewMode === "vr") {
    const isVr = viewMode === "vr";
    const Hud = (
      <div className="relative w-full h-full">
        <SitePlan units={sim.units} workers={sim.workers} zones={sim.zones} selectedId={selectedId} onSelectUnit={setSelectedId} onPlanClick={handlePlanClick} ar />
        {/* HUD chips */}
        <div className="absolute top-3 left-3 flex flex-wrap gap-2">
          <Badge className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">▶ {counts.working || 0} arbeiten</Badge>
          <Badge className="bg-amber-500/20 text-amber-300 border border-amber-500/40">⬇ {counts.loading || 0} laden</Badge>
          <Badge className="bg-purple-500/20 text-purple-300 border border-purple-500/40">⚡ {counts.charging || 0} Akku</Badge>
        </div>
        <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between text-cyan-300 text-xs font-mono">
          <span>● LIVE · {sim.units.length} Einheiten</span>
          <span>{commandMode ? `Befehl: ${commandMode}` : selectedId ? sim.units.find(u=>u.id===selectedId)?.name : "AR-HUD aktiv"}</span>
        </div>
      </div>
    );
    return (
      <div className="fixed inset-0 z-50 bg-[#050a14] p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="text-cyan-300 font-mono text-sm flex items-center gap-2">
            <Glasses className="w-4 h-4" /> {isVr ? "VR-Headset · Baustellen-HUD" : "AR-Vor-Ort · BIM-Overlay"}
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="destructive" disabled={!can.emergency} title="Nur Bauleiter" onClick={sim.emergency ? sim.resumeAll : sim.emergencyStopAll}>
              <Octagon className="w-4 h-4 mr-1" /> {sim.emergency ? "Freigeben" : "NOT-AUS"}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setViewMode("office")}>
              <X className="w-4 h-4 mr-1" /> Beenden
            </Button>
          </div>
        </div>
        {isVr ? (
          <div className="grid grid-cols-2 gap-2 h-[calc(100%-3rem)]">
            <div className="rounded-lg overflow-hidden border border-cyan-900">{Hud}</div>
            <div className="rounded-lg overflow-hidden border border-cyan-900">{Hud}</div>
          </div>
        ) : (
          <div className="relative h-[calc(100%-3rem)] rounded-lg overflow-hidden border border-cyan-900">
            <ARSiteView building={project} onExit={() => setViewMode("office")} />
          </div>
        )}
      </div>
    );
  }

  const mobile = viewMode === "mobile";

  return (
    <div className={seitenWurzel}>
      <div className={mobile ? "max-w-md mx-auto space-y-4" : "max-w-7xl mx-auto space-y-6"}>
        {/* Header */}
        <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="flex flex-wrap justify-between items-center gap-3">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold bg-gradient-to-r from-slate-800 via-emerald-700 to-teal-600 bg-clip-text text-transparent flex items-center gap-2">
              <Radio className="w-6 h-6 text-emerald-600" /> Baustellen-Leitstand
            </h1>
            <p className="text-slate-600 mt-1 text-sm">Live-Digital-Twin · autonome Roboter, Drohnen, LKW & 3D-Drucker steuern</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* telemetry source */}
            <Badge className="bg-white border border-slate-200 text-slate-700 flex items-center gap-1.5">
              <span className={`inline-flex h-2 w-2 rounded-full ${telemetrySource === "simulation" ? "bg-emerald-500" : "bg-blue-500"}`} />
              {TELEMETRY_LABEL[telemetrySource] || "Telemetrie: Simulation"}
            </Badge>
            {/* role switch */}
            <div className="flex items-center rounded-lg border bg-white p-0.5">
              <span className="text-xs text-slate-500 px-2">Rolle</span>
              {Object.entries(ROLES).map(([id, r]) => (
                <button key={id} onClick={() => switchRole(id)} title={`Rolle: ${r.label}`} aria-label={`Rolle: ${r.label}`}
                  className={`px-2 py-1.5 rounded-md text-xs font-medium ${role === id ? "bg-emerald-600 text-white" : "text-slate-500 hover:bg-slate-100"}`}>
                  {r.label}
                </button>
              ))}
            </div>
            {/* device switch */}
            <div className="flex rounded-lg border bg-white p-0.5">
              {VIEW_MODES.map((m) => (
                <button key={m.id} onClick={() => setViewMode(m.id)} title={m.label} aria-label={m.label}
                  className={`p-2 rounded-md ${viewMode === m.id ? "bg-emerald-600 text-white" : "text-slate-500 hover:bg-slate-100"}`}>
                  <m.icon className="w-4 h-4" />
                </button>
              ))}
            </div>
            <Button variant={sim.paused ? "default" : "outline"} size="sm" disabled={!can.command} title={!can.command ? "Rolle Beobachter: nur Lesezugriff" : undefined} onClick={() => sim.setPaused(!sim.paused)} aria-label={sim.paused ? "Simulation fortsetzen" : "Simulation pausieren"}>
              {sim.paused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
            </Button>
            <Button variant="destructive" size="sm" disabled={!can.emergency} title="Nur Bauleiter" onClick={sim.emergency ? sim.resumeAll : sim.emergencyStopAll}>
              <Octagon className="w-4 h-4 mr-1" /> {sim.emergency ? "Freigeben" : "NOT-AUS"}
            </Button>
          </div>
        </motion.div>

        {sim.emergency && (
          <div className="rounded-lg bg-red-50 border border-red-300 text-red-700 px-4 py-2 text-sm font-medium">
            🛑 NOT-AUS aktiv — alle autonomen Einheiten gestoppt. „Freigeben" klicken, um fortzufahren.
          </div>
        )}

        {/* project + safety badges */}
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-sm text-slate-500">Projekt:</span>
          <span className="text-sm font-semibold text-slate-800">{project?.name || "—"}</span>
          <Badge className="bg-rose-100 text-rose-700">🦺 {sim.workers.length} Personen vor Ort</Badge>
          {sim.safetyStops > 0 && (
            <Badge className="bg-amber-100 text-amber-800">{sim.safetyStops} Sicherheitshalte</Badge>
          )}
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="flex flex-wrap h-auto gap-1 bg-slate-100">
            <TabsTrigger value="live" className="flex items-center gap-2"><Radio className="w-4 h-4" /> Live-Leitstand</TabsTrigger>
            <TabsTrigger value="fleet" className="flex items-center gap-2"><Cpu className="w-4 h-4" /> Flotte</TabsTrigger>
            <TabsTrigger value="schedule" className="flex items-center gap-2"><CalendarRange className="w-4 h-4" /> Bauzeitenplan</TabsTrigger>
            <TabsTrigger value="integration" className="flex items-center gap-2"><Plug className="w-4 h-4" /> BIM &amp; Telemetrie</TabsTrigger>
            <TabsTrigger value="fourd" className="flex items-center gap-2"><Layers className="w-4 h-4" /> 4D/5D</TabsTrigger>
            <TabsTrigger value="audit" className="flex items-center gap-2"><ScrollText className="w-4 h-4" /> Audit-Log</TabsTrigger>
          </TabsList>

          <TabsContent value="live" className="mt-4">
            {fleetEmpty ? (
              <FleetEmptyState canSeed={can.command} busy={seeding} onSeed={seedDemoFleet} />
            ) : (
            <div className={mobile ? "space-y-4" : "grid lg:grid-cols-3 gap-4"}>
              <Card className={mobile ? "border-0 shadow-sm" : "lg:col-span-2 border-0 shadow-sm"}>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center justify-between text-base">
                    <span>Live-Lageplan (Digital Twin)</span>
                    <span className="flex items-center gap-1.5 text-xs text-red-600 font-medium">
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
                      </span>LIVE
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="aspect-square md:aspect-[4/3] w-full">
                    <SitePlan units={sim.units} workers={sim.workers} zones={sim.zones} selectedId={selectedId} onSelectUnit={setSelectedId} onPlanClick={handlePlanClick} />
                  </div>
                </CardContent>
              </Card>
              <div className="space-y-4">
                {/* KI-Disposition */}
                <Card className="border-0 shadow-sm">
                  <CardContent className="p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium flex items-center gap-1.5"><Brain className="w-4 h-4 text-emerald-600" /> KI-Disposition</span>
                      <Button size="sm" variant={autoDispatch ? "default" : "outline"} disabled={!can.command} title={!can.command ? "Rolle Beobachter: nur Lesezugriff" : undefined} onClick={() => setAutoDispatch(!autoDispatch)}>
                        Auto {autoDispatch ? "an" : "aus"}
                      </Button>
                    </div>
                    <Button size="sm" className="w-full bg-gradient-to-r from-emerald-600 to-teal-600" disabled={!can.command} title={!can.command ? "Rolle Beobachter: nur Lesezugriff" : undefined} onClick={runDispatch}>
                      <Brain className="w-4 h-4 mr-1" /> Freie Einheiten jetzt zuteilen
                    </Button>
                  </CardContent>
                </Card>
                {/* Sperrzonen (Geofencing) — Bodeneinheiten halten am Zonenrand */}
                <Card className="border-0 shadow-sm">
                  <CardContent className="p-3 space-y-2">
                    <span className="text-sm font-medium flex items-center gap-1.5">⛔ Sperrzonen (Geofencing)</span>
                    {(sim.zones || []).map((z) => (
                      <div key={z.id} className="flex items-center justify-between text-xs">
                        <span className={z.active ? "text-slate-700" : "text-slate-400 line-through"}>{z.name}</span>
                        <Button size="sm" variant={z.active ? "default" : "outline"} className="h-6 px-2 text-[11px]"
                          disabled={!can.zones} title={!can.zones ? "Nur Bauleiter" : undefined}
                          onClick={() => sim.toggleZone(z.id)}>
                          {z.active ? "aktiv" : "inaktiv"}
                        </Button>
                      </div>
                    ))}
                    <p className="text-[10px] text-slate-400">Bodeneinheiten stoppen automatisch am Rand aktiver Zonen (Drohnen ausgenommen).</p>
                  </CardContent>
                </Card>
                <WeatherPanel
                  weather={weather.weather}
                  restrictions={weather.restrictions}
                  loading={weather.loading}
                  refresh={weather.refresh}
                  isSimulated={weather.isSimulated}
                  onSimulate={(gust) =>
                    weather.setOverride({
                      temperature: weather.weather?.temperature ?? 12,
                      wind_speed: Math.round(gust * 0.7),
                      wind_gusts: gust,
                      precipitation: gust >= 60 ? 2 : 0,
                      weather_code: gust >= 60 ? 95 : 2,
                      condition: gust >= 60 ? "Sturm (simuliert)" : "Wind (simuliert)",
                    })
                  }
                  onClearSim={() => weather.setOverride(null)}
                />
                <UnitCommander units={sim.units} selectedId={selectedId} onSelect={setSelectedId} sim={sim} commandMode={commandMode} setCommandMode={setCommandMode} can={can} role={ROLES[role].label} />
              </div>
              <div className={mobile ? "" : "lg:col-span-3"}>
                <div className="h-64"><LiveFeed events={sim.events} /></div>
              </div>
            </div>
            )}
          </TabsContent>

          <TabsContent value="fleet" className="mt-4">
            {fleetEmpty ? (
              <FleetEmptyState canSeed={can.command} busy={seeding} onSeed={seedDemoFleet} />
            ) : (
              <FleetStatus units={sim.units} tasks={tasks} />
            )}
          </TabsContent>

          <TabsContent value="schedule" className="mt-4">
            <GanttSchedule tasks={tasks} onAddTask={() => setShowTaskForm(true)} />
          </TabsContent>

          <TabsContent value="integration" className="mt-4">
            <div className="grid lg:grid-cols-2 gap-4">
              <BimTaskPanel issues={issues} units={sim.units} onAssign={assignTicketToRobot} />
              <TelemetryPanel />
            </div>
          </TabsContent>

          <TabsContent value="fourd" className="mt-4">
            <FourDFiveD tasks={tasks} totalFloors={8} />
          </TabsContent>

          <TabsContent value="audit" className="mt-4">
            <AuditLogPanel projectId={projectId} />
          </TabsContent>
        </Tabs>
      </div>

      {showTaskForm && (
        <TaskScheduleForm
          contacts={contacts}
          onSubmit={async (data) => {
            await bitApi.entities.ScheduleTask.create({ ...data, project_id: projectId });
            setShowTaskForm(false);
            loadTasks();
          }}
          onCancel={() => setShowTaskForm(false)}
        />
      )}
    </div>
  );
}
