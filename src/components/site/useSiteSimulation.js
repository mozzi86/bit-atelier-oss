import { useEffect, useRef, useState, useCallback } from "react";
import { bitApi } from "@core/api/bitApi";

// Drives a live digital-twin simulation of autonomous site units.
// Loads units from the backend, then animates them client-side and exposes
// command functions. Commands persist their intent (status/target/task) to the API.

const SPEED = { robot: 2.6, drone: 5.2, truck: 3.2, printer: 1.4 };
const CHARGE_STATION = { x: 90, y: 84 };
const TICK_MS = 1200;
const SAFETY_RADIUS = 9; // plan units; ground units auto-stop within this of a worker
const GROUND = new Set(["robot", "truck", "printer"]);

const DEFAULT_ZONES = [
  { id: "z1", name: "Kranschwenkbereich", x: 20, y: 12, w: 22, h: 18, active: true },
];

const inZone = (x, y, z) => x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h;

let eventSeq = 0;

export function useSiteSimulation(projectId) {
  const [units, setUnits] = useState([]);
  const [events, setEvents] = useState([]);
  const [paused, setPaused] = useState(false);
  const [emergency, setEmergency] = useState(false);
  const [airspaceClosed, setAirspaceClosedState] = useState(false);
  const [workers, setWorkers] = useState([]);
  const [safetyStops, setSafetyStops] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [zones, setZones] = useState(DEFAULT_ZONES);

  const pausedRef = useRef(false);
  const emergencyRef = useRef(false);
  const airspaceRef = useRef(false);
  const unitsRef = useRef([]);
  const workersRef = useRef([]);
  const heldRef = useRef(new Set());
  const zonesRef = useRef(DEFAULT_ZONES);
  const fenceRef = useRef(new Set());
  const zoneSeqRef = useRef(DEFAULT_ZONES.length + 1);
  pausedRef.current = paused;
  emergencyRef.current = emergency;
  airspaceRef.current = airspaceClosed;
  unitsRef.current = units;
  zonesRef.current = zones;

  // Persistent audit trail of discrete (autonomous) actions — for liability.
  const audit = useCallback(
    (action, detail, actor = "Bediener", unit = null) => {
      bitApi.entities.AuditLog.create({
        project_id: projectId,
        ts: new Date().toISOString(),
        actor,
        action,
        detail,
        unit_id: unit?.id || null,
        unit_name: unit?.name || null,
      }).catch(() => {});
    },
    [projectId]
  );

  const addEvent = useCallback((text, level = "info") => {
    eventSeq += 1;
    const id = eventSeq; // capture now — reading inside the updater can duplicate
    const time = new Date().toLocaleTimeString("de-DE");
    setEvents((prev) => [{ id, text, level, time }, ...prev].slice(0, 60));
  }, []);

  // Load units for the project. Exposed as reload() so callers can refetch
  // after creating units (e.g. Demo-Flotte seeden).
  const reload = useCallback(async () => {
    if (!projectId) return;
    try {
      const data = await bitApi.entities.SiteUnit.filter({ project_id: projectId });
      setUnits(data);
      unitsRef.current = data;
      const w = [
        { id: "w1", name: "Polier", x: 35, y: 40 },
        { id: "w2", name: "Monteur", x: 70, y: 58 },
        { id: "w3", name: "Prüfer", x: 50, y: 78 },
      ];
      setWorkers(w);
      workersRef.current = w;
      setLoaded(true);
      addEvent(`Verbindung zur Baustelle hergestellt — ${data.length} Einheiten online`, "success");
    } catch {
      setLoaded(true);
    }
  }, [projectId, addEvent]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Persist a unit's commanded intent (best-effort, not every frame).
  const persist = useCallback((unit) => {
    bitApi.entities.SiteUnit.update(unit.id, {
      status: unit.status,
      task: unit.task,
      target: unit.target,
      area: unit.area,
    }).catch(() => {});
  }, []);

  // Simulation tick.
  useEffect(() => {
    const interval = setInterval(() => {
      if (pausedRef.current || emergencyRef.current) return;

      // 1) Workers do a small random walk near the work areas.
      const ws = workersRef.current.map((w) => ({
        ...w,
        x: +Math.max(8, Math.min(92, w.x + (Math.random() * 5 - 2.5))).toFixed(2),
        y: +Math.max(8, Math.min(92, w.y + (Math.random() * 5 - 2.5))).toFixed(2),
      }));
      workersRef.current = ws;
      setWorkers(ws);

      // 2) Advance units (computed from the committed snapshot, no setState-in-updater).
      const entered = [];
      const fenced = [];
      const activeZones = zonesRef.current.filter((z) => z.active);
      const next = unitsRef.current.map((unit) => {
        let u = unit;
        if (u.type === "drone" && airspaceRef.current) {
          const base = { x: 85, y: 15 };
          const atBase = Math.hypot(u.x - base.x, u.y - base.y) < 4;
          if (atBase) return { ...u, x: base.x, y: base.y, target: null, status: "grounded", task: "Gegroundet (Wind)" };
          u = { ...u, target: base, status: "enroute", task: "Rückkehr (Wind)" };
        }
        let { x, y, target, status, battery, task } = u;
        // Battery dynamics
        if (status === "charging") {
          battery = Math.min(100, battery + 3);
          if (battery >= 95) { status = "idle"; task = "Bereit"; target = null; }
        } else if (status !== "safety_stop") {
          const drain = status === "idle" ? 0.2 : status === "working" ? 0.9 : 0.6;
          battery = Math.max(0, battery - drain);
          if (battery < 12 && status !== "enroute") {
            target = { ...CHARGE_STATION }; status = "enroute"; task = "Fahre zur Ladestation";
          }
        }
        // Intended movement
        let mx = x, my = y, mtarget = target, mstatus = status, mtask = task;
        if (target) {
          const dx = target.x - x, dy = target.y - y, dist = Math.hypot(dx, dy);
          const sp = SPEED[u.type] || 2.5;
          if (dist <= sp) {
            mx = target.x; my = target.y; mtarget = null;
            const atCharge = Math.hypot(mx - CHARGE_STATION.x, my - CHARGE_STATION.y) < 4;
            if (atCharge) { mstatus = "charging"; mtask = "Lädt"; }
            else if (u.type === "truck") { mstatus = "loading"; mtask = "Entlädt Lieferung"; }
            else { mstatus = "working"; mtask = u.pendingTask || "Arbeitet"; }
          } else {
            mx = x + (dx / dist) * sp; my = y + (dy / dist) * sp; mstatus = "enroute";
          }
        }
        // 3) Geofence: ground units must not enter an active restricted zone.
        const fence = GROUND.has(u.type) ? activeZones.find((z) => inZone(mx, my, z)) : null;
        if (fence) {
          if (!fenceRef.current.has(u.id)) { fenceRef.current.add(u.id); fenced.push({ unit: u, zone: fence }); }
          // Hard stop: hold the old position, keep target so work resumes once the zone is lifted.
          return { ...u, target, status: "geofence_stop", task: `Halt: Sperrzone ${fence.name}`, battery: +battery.toFixed(1) };
        }
        fenceRef.current.delete(u.id);
        // 4) Personen-/Kollisionsschutz: ground units auto-stop near a worker.
        const hold = GROUND.has(u.type) && ws.some((w) => Math.hypot(mx - w.x, my - w.y) < SAFETY_RADIUS);
        if (hold) {
          if (!heldRef.current.has(u.id)) { heldRef.current.add(u.id); entered.push(u.name); }
          // Stay in place, keep target so work resumes once the person leaves.
          return { ...u, target, status: "safety_stop", task: "Sicherheitshalt: Person im Radius", battery: +battery.toFixed(1) };
        }
        heldRef.current.delete(u.id);
        return { ...u, x: +mx.toFixed(2), y: +my.toFixed(2), target: mtarget, status: mstatus, task: mtask, battery: +battery.toFixed(1) };
      });

      unitsRef.current = next;
      setUnits(next);

      if (entered.length) {
        setSafetyStops((s) => s + entered.length);
        entered.forEach((n) => {
          addEvent(`🦺 Sicherheitshalt: ${n} stoppt — Person im Schutzradius`, "warning");
          audit("Sicherheitshalt", `${n} automatisch gestoppt (Person im ${SAFETY_RADIUS}m-Radius)`, "Sicherheitssystem", { name: n });
        });
      }

      if (fenced.length) {
        fenced.forEach(({ unit, zone }) => {
          addEvent(`⛔ ${unit.name}: Halt an Sperrzone ${zone.name}`, "warning");
          audit("Geofence-Halt", `${unit.name} automatisch vor Sperrzone "${zone.name}" gestoppt`, "Sicherheitssystem", unit);
        });
      }
    }, TICK_MS);
    return () => clearInterval(interval);
  }, []);

  // --- Commands -------------------------------------------------------------
  const mutate = useCallback(
    (id, patch, eventText, level) => {
      setUnits((prev) => {
        const next = prev.map((u) => (u.id === id ? { ...u, ...patch } : u));
        const unit = next.find((u) => u.id === id);
        if (unit) persist(unit);
        return next;
      });
      if (eventText) addEvent(eventText, level);
    },
    [addEvent, persist]
  );

  const moveTo = useCallback(
    (id, point, pendingTask) => {
      setUnits((prev) => {
        const u = prev.find((x) => x.id === id);
        if (!u) return prev;
        addEvent(`${u.name}: Zielpunkt gesetzt (${Math.round(point.x)}/${Math.round(point.y)})`, "info");
        return prev.map((x) =>
          x.id === id ? { ...x, target: point, status: "enroute", task: pendingTask || "Unterwegs", pendingTask } : x
        );
      });
    },
    [addEvent]
  );

  const commandWork = useCallback((id) => mutate(id, { status: "working", task: "Arbeitet", target: null }, null, "info"), [mutate]);
  const commandStop = useCallback((id) => {
    setUnits((prev) => {
      const u = prev.find((x) => x.id === id);
      if (u) addEvent(`${u.name}: gestoppt`, "warning");
      return prev.map((x) => (x.id === id ? { ...x, status: "idle", target: null, task: "Gestoppt" } : x));
    });
  }, [addEvent]);
  const commandCharge = useCallback((id) => moveTo(id, { ...CHARGE_STATION }, "Laden"), [moveTo]);

  const setDeliveryDrop = useCallback(
    (id, point) => {
      setUnits((prev) => {
        const u = prev.find((x) => x.id === id);
        if (u) addEvent(`🚚 ${u.name}: Abladezone festgelegt → fährt zum Abladen`, "success");
        return prev.map((x) =>
          x.id === id ? { ...x, target: point, status: "enroute", task: "Fahre zur Abladezone", pendingTask: "Entlädt Lieferung" } : x
        );
      });
    },
    [addEvent]
  );

  const setPrintTarget = useCallback(
    (id, point) => {
      setUnits((prev) => {
        const u = prev.find((x) => x.id === id);
        if (u) addEvent(`🖨️ ${u.name}: nächste Druckposition gesetzt`, "success");
        return prev.map((x) =>
          x.id === id ? { ...x, target: point, status: "enroute", task: "Fahre zur Druckposition", pendingTask: "Druckt Segment" } : x
        );
      });
    },
    [addEvent]
  );

  const emergencyStopAll = useCallback(() => {
    setEmergency(true);
    setUnits((prev) => prev.map((u) => ({ ...u, status: "stopped", target: null, task: "NOT-AUS" })));
    addEvent("🛑 NOT-AUS ausgelöst — alle autonomen Einheiten gestoppt", "danger");
    audit("NOT-AUS", "Alle autonomen Einheiten gestoppt", "Bediener");
  }, [addEvent, audit]);

  const resumeAll = useCallback(() => {
    setEmergency(false);
    setUnits((prev) => prev.map((u) => ({ ...u, status: "idle", task: "Bereit" })));
    addEvent("Betrieb wieder freigegeben", "success");
  }, [addEvent]);

  // Weather-driven airspace lock for drones.
  const setAirspaceClosed = useCallback(
    (closed, reason) => {
      setAirspaceClosedState(closed);
      if (closed) {
        addEvent(`🌬️ Luftraum gesperrt${reason ? ` (${reason})` : ""} — Drohnen kehren zur Basis zurück`, "warning");
        audit("Luftraum gesperrt", reason || "Windgrenze überschritten", "Wetter");
      } else {
        setUnits((prev) => prev.map((u) => (u.type === "drone" && u.status === "grounded" ? { ...u, status: "idle", task: "Bereit" } : u)));
        addEvent("✅ Luftraum freigegeben — Drohnen wieder einsatzbereit", "success");
        audit("Luftraum freigegeben", "Wetterlage entspannt", "Wetter");
      }
    },
    [addEvent, audit]
  );

  // --- Sperrzonen (Geofences) ----------------------------------------------
  const toggleZone = useCallback(
    (id) => {
      const next = zonesRef.current.map((z) => (z.id === id ? { ...z, active: !z.active } : z));
      const zone = next.find((z) => z.id === id);
      if (!zone) return;
      zonesRef.current = next;
      setZones(next);
      const verb = zone.active ? "aktiviert" : "deaktiviert";
      addEvent(`Sperrzone ${zone.name} ${verb}`, zone.active ? "warning" : "info");
      audit("Sperrzone " + verb, `Sperrzone "${zone.name}" ${verb}`, "Bediener");
    },
    [addEvent, audit]
  );

  const addZone = useCallback(
    (rect) => {
      const n = zoneSeqRef.current;
      zoneSeqRef.current = n + 1;
      const zone = { id: `z${n}`, name: `Sperrzone ${n}`, x: rect.x, y: rect.y, w: rect.w, h: rect.h, active: true };
      const next = [...zonesRef.current, zone];
      zonesRef.current = next;
      setZones(next);
      addEvent(`${zone.name} angelegt und aktiviert`, "warning");
      audit("Sperrzone angelegt", `Sperrzone "${zone.name}" (${Math.round(rect.x)}/${Math.round(rect.y)}, ${Math.round(rect.w)}x${Math.round(rect.h)}) aktiviert`, "Bediener");
      return zone;
    },
    [addEvent, audit]
  );

  // Generic assignment used by AI dispatch and BIM ticket coupling.
  const assign = useCallback(
    (id, point, taskLabel, eventText, level = "info") => {
      let assigned = null;
      setUnits((prev) => {
        const next = prev.map((u) => (u.id === id ? { ...u, target: point, status: "enroute", task: taskLabel, pendingTask: taskLabel } : u));
        const unit = next.find((u) => u.id === id);
        if (unit) { persist(unit); assigned = unit; }
        return next;
      });
      if (eventText) addEvent(eventText, level);
      if (assigned) audit("Zuweisung", taskLabel, "Disposition", assigned);
    },
    [addEvent, persist, audit]
  );

  return {
    units,
    events,
    loaded,
    reload,
    paused,
    emergency,
    airspaceClosed,
    setAirspaceClosed,
    workers,
    safetyStops,
    zones,
    toggleZone,
    addZone,
    audit,
    setPaused,
    addEvent,
    moveTo,
    assign,
    commandWork,
    commandStop,
    commandCharge,
    setDeliveryDrop,
    setPrintTarget,
    emergencyStopAll,
    resumeAll,
  };
}
