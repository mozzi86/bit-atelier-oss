import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { bitApi } from "@core/api/bitApi";
import { DATENQUELLE } from "@core/lib/umgebung";
import { useAuth } from "@core/lib/AuthContext";
import { waehleStartProjekt } from "@core/lib/startProjekt";

// Global "current project" so every module (Komplex-Designer, AVA, Berichte,
// BIM, Leitstand, Energie …) works on the same selected project, persisted
// across reloads and shown in the top bar.

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
    const u = new URL(window.location);
    if (id) u.searchParams.set(URL_PARAM, id);
    else u.searchParams.delete(URL_PARAM);
    window.history.replaceState({}, "", u);
  } catch {
    /* ignore */
  }
}

export function ProjectProvider({ children }) {
  const [projects, setProjects] = useState([]);
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
    setProjects(data);
    setFehler(null);
    const urlId = readUrlProjectParam();
    setProjectIdState((cur) => {
      // Deep link (id, then exact name) > valid current/stored id > first by
      // name — returning visitors keep their project.
      const next = waehleStartProjekt(data, { urlWert: urlId, gespeichert: cur });
      try { if (next) localStorage.setItem(LS_KEY, next); } catch { /* ignore */ }
      // URL-Param korrigieren (z. B. Name -> Id oder ungueltige Id).
      if (urlId && urlId !== next) writeUrlProjectParam(next);
      return next;
    });
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

  const project = projects.find((p) => p.id === projectId) || null;

  return (
    <ProjectContext.Provider value={{ projects, projectId, setProjectId, project, loading, fehler, erneutLaden, reloadProjects: loadProjects }}>
      {children}
    </ProjectContext.Provider>
  );
}

export function useProject() {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error("useProject must be used within a ProjectProvider");
  return ctx;
}
