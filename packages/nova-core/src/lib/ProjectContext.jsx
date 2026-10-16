import React, { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback } from "react";
import { bitApi } from "@core/api/bitApi";
import { DATENQUELLE } from "@core/lib/umgebung";
import { useAuth } from "@core/lib/AuthContext";
import { waehleStartProjekt } from "@core/lib/startProjekt";
import { sichtbareProjekte } from "@core/lib/projektArchiv.js";
import { projekteNachZugriff } from "@core/lib/rechte.js";
import { useZugriff } from "@core/lib/ZugriffContext.jsx";

// Global "current project" so every module (Komplex-Designer, AVA, Berichte,
// BIM, Leitstand, Energie …) works on the same selected project, persisted
// across reloads and shown in the top bar.
//
// Archive (81-06, D-P81-30): `projects` leaves out archived projects
// (Project.archiviert_am) except the active one — the pickers (top bar in
// Layout.jsx, command palette, time sheet) read `projects` and stay unchanged;
// an archived project never becomes the start project. `alleProjekte` is the
// full list (project controlling, the "Archiviert" section of /Projects).
//
// Rights (82-02): the role's project view filters FIRST — alleProjekte =
// projekteNachZugriff(all, zugriff), then projects = sichtbareProjekte(alleProjekte,
// active). The other order would let the controlling (which reads alleProjekte)
// show projects of other people. When the view changes ("Ansicht als") and the
// active project is no longer visible, the first visible one becomes active and
// the URL is corrected (replace).

const ProjectContext = createContext(null);
const LS_KEY = "currentProjectId";
const URL_PARAM = "projekt";

// Deep-Link: ?projekt=<id|name> lesen (window-APIs, da der Provider ggf.
// ausserhalb des Routers sitzt — keine react-router-Hooks hier).
function readUrlProjectParam() {
  try {
    return new URLSearchParams(window.location.search).get(URL_PARAM) || "";
  } catch {
    return "";
  }
}

// URL ohne Navigation aktualisieren; leere Id entfernt den Param.
function writeUrlProjectParam(id) {
  try {
    const u = new URL(/** @type {any} */ (window.location));
    if (id) u.searchParams.set(URL_PARAM, id);
    else u.searchParams.delete(URL_PARAM);
    window.history.replaceState({}, "", u);
  } catch {
    /* ignore */
  }
}

export function ProjectProvider({ children }) {
  const zugriff = useZugriff();
  const zugriffRef = useRef(zugriff);
  zugriffRef.current = zugriff;
  const [roh, setRoh] = useState(/** @type {any[]} */ ([]));
  const alleProjekte = useMemo(() => projekteNachZugriff(roh, zugriff), [roh, zugriff]);
  const [projectId, setProjectIdState] = useState(() => {
    // Deep-Link hat Vorrang vor localStorage; loadProjects validiert spaeter.
    const urlId = readUrlProjectParam();
    if (urlId) return urlId;
    try { return localStorage.getItem(LS_KEY) || ""; } catch { return ""; }
  });
  const [loading, setLoading] = useState(true);
  // 72-10 (N-05): the load error as plain text, or null. Without it a failed
  // data store looked exactly like "no project yet" (only the console knew).
  const [fehler, setFehler] = useState(/** @type {string|null} */ (null));

  const setProjectId = useCallback((id) => {
    setProjectIdState(id);
    try { localStorage.setItem(LS_KEY, id); } catch { /* ignore */ }
    writeUrlProjectParam(id);
  }, []);

  const loadProjects = useCallback(async () => {
    const data = await bitApi.entities.Project.list("name");
    setRoh(Array.isArray(data) ? data : []);
    const erlaubt = projekteNachZugriff(Array.isArray(data) ? data : [], zugriffRef.current);
    setFehler(null);
    const urlId = readUrlProjectParam();
    // Deep link (id, then exact name) > valid current/stored id > first by
    // name — returning visitors keep their project. Archived projects are
    // not candidates (81-06), so a stored archived id falls back.
    // 94-01 (B-ABN-06): the updater stays pure. React runs it lazily on the
    // next render — after a setProjectId() queued meanwhile — so writing
    // storage/URL in here put the OLD id back. The effect below persists.
    setProjectIdState((cur) => waehleStartProjekt(sichtbareProjekte(erlaubt, null), { urlWert: urlId, gespeichert: cur }));
    setLoading(false);
    return data;
  }, []);

  // Cloud path (live review 18.09.2026, R-3): the provider mounts ABOVE the
  // auth gate, so a mount-only load ran without a session (uncaught 401 on
  // the login page) and never re-ran after sign-in — the list stayed empty
  // until a manual reload. Load once there is a session; re-load on every
  // sign-in. Express/serverlos keep the mount-time load. Errors surface in
  // the console as plain text instead of an unhandled rejection, and since
  // 72-10 also as `fehler`, which the shell shows with a retry button.
  const { isAuthenticated } = useAuth();
  useEffect(() => {
    if (DATENQUELLE === "supabase" && !isAuthenticated) return;
    loadProjects().catch((err) => {
      console.error(`Projekte konnten nicht geladen werden: ${err?.message || err}`);
      setFehler(String(err?.message || err));
      setLoading(false);
    });
  }, [loadProjects, isAuthenticated]);

  // 72-10 (N-05): the shell's "Erneut versuchen". Unlike reloadProjects it
  // shows the loading state and never rejects — the outcome lands in
  // loading/fehler, where the shell reads it.
  const erneutLaden = useCallback(async () => {
    setLoading(true);
    setFehler(null);
    try {
      await loadProjects();
    } catch (err) {
      setFehler(String(err?.message || err));
      setLoading(false);
    }
  }, [loadProjects]);

  // 94-01: persist the id that actually won. Storage always; the URL only when
  // it carries ?projekt= (corrects a name or an invalid id to the chosen id).
  useEffect(() => {
    if (!projectId) return;
    try { localStorage.setItem(LS_KEY, projectId); } catch { /* ignore */ }
    const urlId = readUrlProjectParam();
    if (urlId && urlId !== projectId) writeUrlProjectParam(projectId);
  }, [projectId]);

  // 82-02: the view changed and the active project is outside it → first visible project.
  useEffect(() => {
    if (loading || !roh.length) return;
    if (projectId && alleProjekte.some((p) => p.id === projectId)) return;
    const next = waehleStartProjekt(sichtbareProjekte(alleProjekte, null), { urlWert: "", gespeichert: "" });
    if (next !== projectId) setProjectId(next || "");
  }, [alleProjekte, roh, loading, projectId, setProjectId]);

  const projects = useMemo(() => sichtbareProjekte(alleProjekte, projectId), [alleProjekte, projectId]);
  const project = alleProjekte.find((p) => p.id === projectId) || null;

  return (
    <ProjectContext.Provider value={{ projects, alleProjekte, projectId, setProjectId, project, loading, fehler, erneutLaden, reloadProjects: loadProjects }}>
      {children}
    </ProjectContext.Provider>
  );
}

export function useProject() {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error("useProject must be used within a ProjectProvider");
  return ctx;
}
