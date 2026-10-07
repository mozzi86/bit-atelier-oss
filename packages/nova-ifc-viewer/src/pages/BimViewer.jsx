// BimViewer.jsx — BIM viewer page with the ticket list (BCF-style issues) and
// comments on the current project.
//
// 72-13 (N-10): tickets are addressable and keyboard-creatable (contract in
// lib/ticketLink.js):
// - ?ticket=<id> selects the ticket once the list is loaded and scrolls it into
//   view; the parameter stays in the URL so a reload shows the same ticket.
// - ?neu=1[&element&titel&quelle] opens the prefilled form without a model point;
//   these parameters are removed afterwards so a reload does not reopen it.
// - "Ticket ohne Modellpunkt" creates a ticket with location null; the 3D view
//   only receives tickets with a model point, so none sits at the origin.
// - save and delete report success or the plain error text as a toast.
//
// 72-16 (N-17): no phantom building. Without a building the 3D view used to draw
// an invented default ({ floors: 6, area_net: 1800 }, placeholder "Demo-Gebäude")
// that tickets could be placed on. Now the page shows an empty state with two
// ways on (Komplex-Designer, IFC-Viewer); placing a ticket or a comment in the
// model is disabled with a visible reason, "Ticket ohne Modellpunkt" keeps
// working. A failed load shows the error with "Erneut versuchen" instead of
// passing for "no building" or "no tickets". Display only — the data paths
// (building_id null etc.) are unchanged.

import { seitenWurzel } from "@core/lib/utils";
import React, { useState, useEffect, useRef, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { bitApi } from "@core/api/bitApi";
import { useI18n } from "@core/lib/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Button, buttonVariants } from "@core/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@core/components/ui/select";
import {
  Upload,
  Eye,
  EyeOff,
  Layers,
  AlertTriangle,
  MapPin,
  Plus,
  Info,
  FilePlus2,
  Building2,
} from "lucide-react";
import { motion } from "framer-motion";
import EmptyState from "@core/components/common/EmptyState";
import BimModelViewer from "../components/BimModelViewer";
import IssuePanel from "../components/IssuePanel";
import IssueForm from "../components/IssueForm";
import { useProject } from "@core/lib/ProjectContext";
import { PresenceBar, PresenceCursors, CommentsList, collabChannel } from "../components/CollaborationPanel";
import { parseIfcText } from "@ifc/lib/interop";
import { LAYER_LABELS, labelFor } from "@ifc/lib/labels";
import { Textarea } from "@core/components/ui/textarea";
import { MessageSquare } from "lucide-react";
import {
  leseTicketParameter,
  ohneNeuParameter,
  istOffen,
  hatModellpunkt,
} from "../lib/ticketLink";

/** Plain error text for a toast (never "[object Object]"). */
const fehlerText = (e) => (e && e.message) || String(e);

export default function BimViewer() {
  const { t } = useI18n();
  const { project: selectedProject } = useProject();
  const [searchParams, setSearchParams] = useSearchParams();
  const linkParameter = useMemo(() => leseTicketParameter(searchParams), [searchParams]);
  const [buildings, setBuildings] = useState([]);
  const [selectedBuilding, setSelectedBuilding] = useState(null);
  const [issues, setIssues] = useState([]);
  // Project id the loaded ticket list belongs to — the ?ticket link is resolved
  // only against a list of the current project, never against the initial [].
  const [issuesFuer, setIssuesFuer] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  // Plain error text of the last failed project load (null = loaded fine). A
  // failed load must not pass for "no building yet"; ladeRunde retries it.
  const [ladeFehler, setLadeFehler] = useState(null);
  const [ladeRunde, setLadeRunde] = useState(0);

  // Ticket manager state
  const [selectedIssueId, setSelectedIssueId] = useState(null);
  const [addMode, setAddMode] = useState(false);
  const [showIssueForm, setShowIssueForm] = useState(false);
  const [editingIssue, setEditingIssue] = useState(null);
  const [pendingLocation, setPendingLocation] = useState(null);
  const [vorbelegung, setVorbelegung] = useState(null);
  // Remounts IssueForm on every opening so its initial state follows the new
  // ticket, prefill or edit target even if the dialog was already open.
  const [formRunde, setFormRunde] = useState(0);
  // Ticket id of the last resolved ?ticket link — resolve once, not again after
  // every reload of the list (save, delete) or on a project switch, where the
  // stale parameter would only raise a spurious "not found".
  const erledigterTicketLink = useRef("");

  // Collaboration (BIM 2.0) state
  const [comments, setComments] = useState([]);
  const [commentMode, setCommentMode] = useState(false);
  const [selectedCommentId, setSelectedCommentId] = useState(null);
  const [pendingComment, setPendingComment] = useState(null); // location awaiting text
  const [commentText, setCommentText] = useState("");

  const [visibleLayers, setVisibleLayers] = useState({
    structure: true,
    architecture: true,
    mechanical: true,
    electrical: true,
    plumbing: true,
  });

  useEffect(() => {
    if (!selectedProject) {
      setIsLoading(false);
      return;
    }
    let aktiv = true;
    setIsLoading(true);
    setLadeFehler(null);
    Promise.all([loadBuildings(), loadIssues(), loadComments()])
      .catch((e) => {
        if (!aktiv) return;
        setLadeFehler(fehlerText(e));
        toast.error(`${t("Projektdaten konnten nicht geladen werden")}: ${fehlerText(e)}`);
      })
      .finally(() => {
        if (aktiv) setIsLoading(false);
      });
    return () => {
      aktiv = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProject, ladeRunde]);

  const loadComments = async () => {
    if (!selectedProject) return;
    const data = await bitApi.entities.Comment.filter({ project_id: selectedProject.id }, "-created_date");
    setComments(data);
  };

  // --- Comment actions ------------------------------------------------------
  const handlePlaceComment = (location) => {
    setPendingComment(location);
    setCommentText("");
    setCommentMode(false);
  };
  const saveComment = async () => {
    if (!commentText.trim() || !pendingComment) return;
    await bitApi.entities.Comment.create({
      project_id: selectedProject.id,
      building_id: selectedBuilding?.id || null,
      location: pendingComment,
      author: "Du",
      text: commentText.trim(),
      resolved: false,
      created_date: new Date().toISOString(),
    });
    setPendingComment(null);
    setCommentText("");
    loadComments();
  };
  const resolveComment = async (c) => { await bitApi.entities.Comment.update(c.id, { resolved: !c.resolved }); loadComments(); collabChannel.publish("comments-changed"); };
  const deleteComment = async (id) => { await bitApi.entities.Comment.delete(id); if (selectedCommentId === id) setSelectedCommentId(null); loadComments(); collabChannel.publish("comments-changed"); };
  // Threads: Antwort an einen Kommentar anhängen (persistiert im Kommentar selbst).
  const replyComment = async (c, text) => {
    const replies = [...(c.replies || []), { author: "Du", text, date: new Date().toISOString() }];
    await bitApi.entities.Comment.update(c.id, { replies });
    loadComments();
    collabChannel.publish("comments-changed");
  };
  // Zuweisung an eine Person (Collaborator-Id) setzen/entfernen.
  const assignComment = async (c, collaboratorId) => {
    await bitApi.entities.Comment.update(c.id, { assignee: collaboratorId || null });
    loadComments();
    collabChannel.publish("comments-changed");
  };
  // Live-Kanal: Änderungen aus anderen Tabs übernehmen.
  useEffect(() => {
    const unsub = collabChannel.subscribe((msg) => {
      if (msg?.type === "comments-changed") loadComments();
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProject]);

  // ---- IFC-Import (STEP): Geschosse + Elementanzahlen parsen ----------------
  const ifcInputRef = useRef(null);
  const [ifcInfo, setIfcInfo] = useState(null);
  const handleIfcFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const text = await file.text();
    const info = parseIfcText(text);
    setIfcInfo({ ...info, filename: file.name });
  };
  const applyIfcStoreys = async () => {
    if (!ifcInfo || !selectedBuilding?.id || !ifcInfo.storeys.length) return;
    await bitApi.entities.Building.update(selectedBuilding.id, { floors: ifcInfo.storeys.length });
    await loadBuildings();
  };

  const loadBuildings = async () => {
    if (!selectedProject) return;
    const data = await bitApi.entities.Building.filter({ project_id: selectedProject.id });
    setBuildings(data);
    setSelectedBuilding(data[0] || null);
  };

  const loadIssues = async () => {
    if (!selectedProject) return;
    const data = await bitApi.entities.Issue.filter({ project_id: selectedProject.id });
    setIssues(data);
    setIssuesFuer(selectedProject.id);
  };

  // Reload after a write; a failure is reported, the list keeps its last state.
  const ladeTicketsNeu = async () => {
    try {
      await loadIssues();
    } catch (e) {
      toast.error(`${t("Tickets konnten nicht geladen werden")}: ${fehlerText(e)}`);
    }
  };

  // Only tickets with a model point go to the 3D view (no marker at the origin).
  const ticketsMitOrt = useMemo(() => issues.filter(hatModellpunkt), [issues]);

  // ?ticket=<id>: select and show the ticket once the current project's list is in.
  useEffect(() => {
    const id = linkParameter.ticket;
    if (!id || !selectedProject || issuesFuer !== selectedProject.id) return;
    if (erledigterTicketLink.current === id) return;
    erledigterTicketLink.current = id;
    if (!issues.some((i) => i.id === id)) {
      toast.info(t("Ticket nicht gefunden"));
      return;
    }
    setSelectedIssueId(id);
    // After the paint of the selection; scrolls the page and the list.
    requestAnimationFrame(() => {
      document.getElementById(`ticket-${id}`)?.scrollIntoView({ block: "center" });
    });
  }, [linkParameter.ticket, selectedProject, issuesFuer, issues, t]);

  // ?neu=1[&element&titel&quelle]: open the prefilled form without a model point,
  // then drop these parameters (replace, no history entry) — a reload must not
  // open the form again. Waits for a project, because saving needs one.
  useEffect(() => {
    if (!linkParameter.neu || !selectedProject) return;
    oeffneFormular({
      vorbelegung: {
        title: linkParameter.titel || "",
        element_guid: linkParameter.element || "",
        quelle: linkParameter.quelle || "manuell",
      },
    });
    setSearchParams((vorher) => ohneNeuParameter(vorher), { replace: true });
  }, [linkParameter, selectedProject, setSearchParams]);

  // A model exists only with a real building of this project (no invented default).
  // After a failed load selectedBuilding may still be the previous project's.
  const modellDa = !!selectedBuilding && !ladeFehler;
  // Shown only once loading is done, so the empty state does not flash on start.
  const modellFehlt = !!selectedProject && !isLoading && !ladeFehler && !selectedBuilding;

  // Leaving the model (project without a building) ends a pending placement.
  useEffect(() => {
    if (!selectedBuilding) {
      setAddMode(false);
      setCommentMode(false);
    }
  }, [selectedBuilding]);

  const toggleLayer = (layerName) =>
    setVisibleLayers((prev) => ({ ...prev, [layerName]: !prev[layerName] }));

  // --- Ticket actions -------------------------------------------------------
  /**
   * Opens the ticket form: edit an issue, or a new ticket at a model point
   * (location, metres) or without one (location null), optionally prefilled.
   */
  function oeffneFormular({ issue = null, location = null, vorbelegung: vor = null }) {
    setEditingIssue(issue);
    setPendingLocation(issue ? issue.location || null : location);
    setVorbelegung(vor);
    setAddMode(false);
    setFormRunde((n) => n + 1);
    setShowIssueForm(true);
  }

  const schliesseFormular = () => {
    setShowIssueForm(false);
    setEditingIssue(null);
    setPendingLocation(null);
    setVorbelegung(null);
  };

  const handlePlaceIssue = (location) => oeffneFormular({ location });

  // data already carries element_guid = element_id (IssueForm writes both).
  const handleSubmitIssue = async (data) => {
    let gespeichert = null;
    try {
      if (editingIssue) {
        await bitApi.entities.Issue.update(editingIssue.id, data);
      } else {
        gespeichert = await bitApi.entities.Issue.create({
          ...data,
          quelle: data.quelle || "manuell",
          project_id: selectedProject.id,
          building_id: selectedBuilding?.id || null,
          location: pendingLocation || null,
        });
      }
    } catch (e) {
      // The form stays open, so nothing typed is lost.
      toast.error(`${t("Ticket konnte nicht gespeichert werden")}: ${fehlerText(e)}`);
      return;
    }
    toast.success(t("Ticket gespeichert"));
    schliesseFormular();
    await ladeTicketsNeu();
    // A new ticket without a model point has no marker — select it in the list
    // so it is found at once.
    if (gespeichert?.id) setSelectedIssueId(gespeichert.id);
  };

  const handleEditIssue = (issue) => oeffneFormular({ issue });

  const handleDeleteIssue = async (issue) => {
    try {
      await bitApi.entities.Issue.delete(issue.id);
    } catch (e) {
      toast.error(`${t("Ticket konnte nicht gelöscht werden")}: ${fehlerText(e)}`);
      return;
    }
    toast.success(t("Ticket gelöscht"));
    if (selectedIssueId === issue.id) setSelectedIssueId(null);
    await ladeTicketsNeu();
  };

  const openCount = issues.filter(istOffen).length;

  return (
    <div className={seitenWurzel}>
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4"
        >
          <div>
            {/* Page name from the N-02 name table. */}
            <h1 className="text-3xl font-bold bg-gradient-to-r from-slate-800 via-emerald-700 to-teal-600 bg-clip-text text-transparent">
              {t("BIM-Viewer & Tickets")}
            </h1>
            <p className="text-slate-600 mt-1">
              {t("IFC-Modell mit BCF-Ticketverwaltung & Kollaboration — betroffene Stellen direkt im 3D-Modell")}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <PresenceBar />
              <Link to="/IfcViewer" className="text-sm font-medium text-emerald-700 underline-offset-4 hover:underline">
                {t("Im IFC-Viewer ansehen")}
              </Link>
            </div>
          </div>
          <div className="flex flex-col items-start lg:items-end gap-1">
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => { setCommentMode((m) => !m); setAddMode(false); }}
                disabled={!selectedProject || !modellDa}
                aria-describedby={modellFehlt ? "bim-modell-fehlt-grund" : undefined}
                variant={commentMode ? "default" : "outline"}
                className={commentMode ? "bg-amber-500 hover:bg-amber-600 text-white shadow" : ""}
              >
                <MessageSquare className="w-4 h-4 mr-2" />
                {commentMode ? t("Klick ins Modell…") : t("Kommentar setzen")}
              </Button>
              {/* Keyboard path to a new ticket (WCAG 2.1.1): no click into the 3D model
                  needed. Native button — the shadcn Button costs a tsc error per use. */}
              <button
                type="button"
                onClick={() => { setCommentMode(false); oeffneFormular({}); }}
                disabled={!selectedProject}
                className={buttonVariants({ variant: "outline" })}
              >
                <FilePlus2 className="w-4 h-4 mr-2" />
                {t("Ticket ohne Modellpunkt")}
              </button>
              <Button
                onClick={() => { setAddMode((m) => !m); setCommentMode(false); }}
                disabled={!selectedProject || !modellDa}
                aria-describedby={modellFehlt ? "bim-modell-fehlt-grund" : undefined}
                className={addMode ? "bg-red-600 hover:bg-red-700 shadow-lg" : "bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 shadow-lg"}
              >
                <MapPin className="w-4 h-4 mr-2" />
                {addMode ? t("Platzierung abbrechen") : t("Ticket im Modell setzen")}
              </Button>
            </div>
            {/* Visible reason for the disabled model actions (a bare disabled button
                explains nothing). */}
            {modellFehlt && (
              <p id="bim-modell-fehlt-grund" className="text-xs text-slate-500">
                {t("Ticket und Kommentar im Modell brauchen ein Gebäude – „Ticket ohne Modellpunkt“ geht auch ohne.")}
              </p>
            )}
          </div>
        </motion.div>

        {/* Project & Building Selection */}
        <Card className="border-0 shadow-sm rounded-xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-slate-800">
              <Layers className="w-5 h-5 text-emerald-600" />
              Modellauswahl
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-4">
              <div className="flex-1">
                <label className="text-sm font-medium mb-2 block">Projekt</label>
                <div className="h-10 flex items-center px-3 rounded-md border bg-slate-50 text-sm text-slate-700">
                  {/* 72-01 A-7 (Befund N-07): fehlender Auftraggeber zeigt „—",
                      nie „undefined" im Text. */}
                  {selectedProject ? `${selectedProject.name} — ${selectedProject.client || "—"}` : "Oben Projekt wählen…"}
                </div>
              </div>
              <div className="flex-1">
                <label className="text-sm font-medium mb-2 block">Gebäude</label>
                <Select
                  value={selectedBuilding?.id || ""}
                  onValueChange={(value) =>
                    setSelectedBuilding(buildings.find((b) => b.id === value))
                  }
                  disabled={!buildings.length}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={buildings.length ? t("Gebäude wählen…") : t("Noch kein Gebäude")} />
                  </SelectTrigger>
                  <SelectContent>
                    {buildings.map((building) => (
                      <SelectItem key={building.id} value={building.id}>
                        {building.usage_type || building.name} — {building.area_net}m²
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Main Viewer Layout */}
        <div className="grid lg:grid-cols-4 gap-6">
          {/* 3D Viewer */}
          <div className="lg:col-span-3">
            <Card className="h-[700px] border-0 shadow-sm rounded-xl">
              <CardHeader className="pb-2">
                <div className="flex justify-between items-center">
                  <CardTitle className="text-slate-800">3D-Modell
                    {addMode && <span className="text-sm font-normal text-blue-600"> — {t("klicken Sie, um ein Ticket zu setzen")}</span>}
                    {commentMode && <span className="text-sm font-normal text-amber-600"> — {t("klicken Sie, um einen Kommentar zu setzen")}</span>}
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <input ref={ifcInputRef} type="file" accept=".ifc,.stp,.step" className="hidden" onChange={handleIfcFile} />
                    <Button variant="outline" size="sm" onClick={() => ifcInputRef.current?.click()}>
                      <Upload className="w-4 h-4 mr-2" /> IFC laden
                    </Button>
                  </div>
                </div>
              </CardHeader>
              {ifcInfo && (
                <div className="mx-4 mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
                  <span className="font-semibold">{ifcInfo.filename}</span>
                  {ifcInfo.schema && <span>{ifcInfo.schema}</span>}
                  <span>Geschosse: <b>{ifcInfo.storeys.length}</b></span>
                  <span>Wände {ifcInfo.counts.walls} · Decken {ifcInfo.counts.slabs} · Räume {ifcInfo.counts.spaces} · Fenster {ifcInfo.counts.windows} · Türen {ifcInfo.counts.doors} · Dächer {ifcInfo.counts.roofs}</span>
                  <span className="ml-auto flex gap-2">
                    {ifcInfo.storeys.length > 0 && selectedBuilding?.id && (
                      <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={applyIfcStoreys}>
                        Geschosse übernehmen ({ifcInfo.storeys.length})
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => setIfcInfo(null)}>✕</Button>
                  </span>
                </div>
              )}
              <CardContent className="h-[600px] rounded-lg relative overflow-hidden p-0">
                {ladeFehler ? (
                  <div className="flex h-full items-center justify-center p-4">
                    <EmptyState
                      icon={AlertTriangle}
                      className="bg-transparent shadow-none"
                      title={t("Projektdaten konnten nicht geladen werden")}
                      description={ladeFehler}
                      action={(
                        <button
                          type="button"
                          onClick={() => setLadeRunde((n) => n + 1)}
                          className={buttonVariants({ size: "sm" })}
                        >
                          {t("Erneut versuchen")}
                        </button>
                      )}
                    />
                  </div>
                ) : modellDa ? (
                  <BimModelViewer
                    building={selectedBuilding}
                    issues={ticketsMitOrt}
                    selectedIssueId={selectedIssueId}
                    addMode={addMode}
                    onSelectIssue={setSelectedIssueId}
                    onPlaceIssue={handlePlaceIssue}
                    comments={comments}
                    commentMode={commentMode}
                    selectedCommentId={selectedCommentId}
                    onSelectComment={setSelectedCommentId}
                    onPlaceComment={handlePlaceComment}
                  />
                ) : isLoading ? (
                  <p role="status" className="flex h-full items-center justify-center text-sm text-slate-500">
                    {t("Modell wird geladen…")}
                  </p>
                ) : (
                  <div className="flex h-full items-center justify-center p-4">
                    {selectedProject ? (
                      <EmptyState
                        icon={Building2}
                        className="bg-transparent shadow-none"
                        title={t("Noch kein Gebäude für dieses Projekt")}
                        description={t("Setzen Sie einen Baukörper im Komplex-Designer oder sehen Sie sich ein IFC-Modell im IFC-Viewer an. Tickets ohne Modellpunkt lassen sich schon jetzt anlegen.")}
                        action={(
                          <div className="flex flex-wrap justify-center gap-2">
                            <Link to="/ComplexDesigner?tab=studio" className={buttonVariants({ size: "sm" })}>
                              {t("Baukörper im Komplex-Designer setzen")}
                            </Link>
                            <Link to="/IfcViewer" className={buttonVariants({ variant: "outline", size: "sm" })}>
                              {t("IFC im IFC-Viewer ansehen")}
                            </Link>
                          </div>
                        )}
                      />
                    ) : (
                      <EmptyState
                        icon={Building2}
                        className="bg-transparent shadow-none"
                        title={t("Kein Projekt gewählt")}
                        description={t("Wählen Sie oben ein Projekt – dann erscheint hier sein Gebäudemodell.")}
                        action={null}
                      />
                    )}
                  </div>
                )}
                <PresenceCursors />
                {pendingComment && (
                  <div className="absolute bottom-3 left-3 right-3 z-20 bg-white rounded-xl shadow-2xl border p-3">
                    <div className="text-xs text-slate-500 mb-1">Neuer Kommentar an Position ({Math.round(pendingComment.x)}/{Math.round(pendingComment.y)}/{Math.round(pendingComment.z)})</div>
                    <div className="flex gap-2">
                      <Textarea rows={2} autoFocus value={commentText} onChange={(e) => setCommentText(e.target.value)} placeholder="Kommentar eingeben…" className="flex-1" />
                      <div className="flex flex-col gap-1">
                        <Button size="sm" onClick={saveComment} disabled={!commentText.trim()} className="bg-amber-500 hover:bg-amber-600">Senden</Button>
                        <Button size="sm" variant="outline" onClick={() => { setPendingComment(null); setCommentText(""); }}>Abbrechen</Button>
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Control Panel */}
          <div className="space-y-6">
            {/* Layer Controls */}
            <Card className="border-0 shadow-sm rounded-xl">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm text-slate-800">
                  <Layers className="w-4 h-4 text-emerald-600" />
                  Modell-Layer
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {Object.entries(visibleLayers).map(([layer, visible]) => (
                  <div key={layer} className="flex items-center justify-between">
                    <span className="text-sm">{labelFor(LAYER_LABELS, layer)}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => toggleLayer(layer)}
                      aria-label={`Layer ${labelFor(LAYER_LABELS, layer)} ${visible ? "ausblenden" : "einblenden"}`}
                      className={visible ? "text-emerald-600" : "text-slate-400"}
                    >
                      {visible ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                    </Button>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Tickets */}
            <Card className="border-0 shadow-sm rounded-xl">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2 text-sm text-slate-800">
                    <AlertTriangle className="w-4 h-4 text-rose-500" />
                    {t("Tickets")} ({openCount} {t("offen")})
                  </CardTitle>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    disabled={!selectedProject || !modellDa}
                    title={modellFehlt ? t("Ticket im Modell setzen braucht ein Gebäude") : t("Ticket im Modell setzen")}
                    aria-label={t("Ticket im Modell setzen")}
                    onClick={() => { setAddMode(true); setCommentMode(false); }}
                  >
                    <Plus className="w-4 h-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <IssuePanel
                  issues={issues}
                  selectedIssueId={selectedIssueId}
                  onSelect={setSelectedIssueId}
                  onEdit={handleEditIssue}
                  onDelete={handleDeleteIssue}
                  loading={isLoading}
                  ladeFehler={!!ladeFehler}
                  modellpunktMoeglich={modellDa}
                />
              </CardContent>
            </Card>

            {/* Comments (BIM 2.0 collaboration) */}
            <Card className="border-0 shadow-sm rounded-xl">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2 text-sm text-slate-800">
                    <MessageSquare className="w-4 h-4 text-amber-500" />
                    Kommentare
                  </CardTitle>
                  <Button size="icon" variant="ghost" className="h-7 w-7" disabled={!selectedProject || !modellDa}
                    title={modellFehlt ? t("Kommentar setzen braucht ein Gebäude") : t("Kommentar setzen")}
                    aria-label={t("Kommentar setzen")} onClick={() => { setCommentMode(true); setAddMode(false); }}>
                    <Plus className="w-4 h-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <CommentsList
                  comments={comments}
                  selectedId={selectedCommentId}
                  onSelect={setSelectedCommentId}
                  onResolve={resolveComment}
                  onDelete={deleteComment}
                  onReply={replyComment}
                  onAssign={assignComment}
                />
              </CardContent>
            </Card>

            <Card className="bg-slate-50 border-dashed rounded-xl shadow-sm">
              <CardContent className="p-3 text-xs text-slate-500 flex gap-2">
                <Info className="w-4 h-4 shrink-0 mt-0.5" />
                Ziehen = drehen · Mausrad = zoomen · Marker anklicken = Ticket wählen.
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {showIssueForm && (
        <IssueForm
          key={formRunde}
          issue={editingIssue}
          location={pendingLocation}
          vorbelegung={vorbelegung}
          onSubmit={handleSubmitIssue}
          onCancel={schliesseFormular}
        />
      )}
    </div>
  );
}
