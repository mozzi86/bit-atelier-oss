// BcfIssues.jsx — Karte „Befunde (BCF)" in der Prüf-Suite (Phase 71-04 Task 3).
//
// Rückkanal für das Issue-Management des Referenzauftrags: BCF-2.1-Container
// aus Solibri/Catenda importieren (parseBcfZip), je Topic Status + Antwort
// pflegen, als Antwort-BCF exportieren (antwortTopics → buildBcfZip).
//
// 72-13 (N-12): each finding can become a ticket ("Als Ticket anlegen" →
// befundTicket.js, at most one Issue per topic guid); an existing ticket shows
// "Ticket öffnen" (ticketUrl) with its status. The empty state offers
// "Beispiel-BCF laden" (public/beispiel/musterprojekt.bcf) for demo visitors.
// Rows open by keyboard: the first cell is a button with aria-expanded.
// UI wording follows the glossary: "Befund" instead of "Issue"/"Topic".
//
// Persistenz: exklusives BimModel-Feld `befunde_layer` über loadBimModel/
// saveBimModel aus @core/lib/useBimModelSync — Fachlayer-Regeln aus
// useFachlayer.js (Registry: befunde_layer, „Phase 66 übernimmt"):
//   1. EIN Feld, ein Schreiber (diese Karte).
//   2. The LAYER is read/written ONLY via load/saveBimModel, never via bitApi.
//      Tickets (Issue) are a different entity and go through befundTicket.js,
//      the one bitApi access of the chain finding → ticket.
//   3. loadingRef/lastSaved-Guard gegen Zurückschreiben des frisch Geladenen.
//   4. Debounce 1,2 s + Flush bei Unmount/Projektwechsel — Muster
//      useFachlayer.js:44-47 NACHGEBILDET, nicht importiert (der Hook liegt
//      in @designer; @ifc darf nur @core und sich selbst importieren).
//
// Sicherheit (Threat-Modell 71-04): alle Fremdtexte (Titel, Kommentare)
// werden ausschließlich als React-Text gerendert (T-71-08, React escaped).
// Snapshot-PNGs werden als Blob-URL mit festem MIME image/png angezeigt
// (T-71-08: kein SVG, kein HTML) und leben NUR in dieser Sitzung — Bytes
// gehören nicht in den BimModel-Layer (Größe, flacher Server-Merge); nach
// einem Reload ist der Snapshot weg, bis der Container erneut importiert wird.
// ZIP-Grenzen prüft parseBcfZip (T-71-07).
//
// In (props): projectId, autor (Briefkopf-Name für Antworten).
// Out: UI; Seiteneffekte: BimModel-Feld befunde_layer, BCF-Download,
//      Issue-Anlage über befundTicket.js.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { FileUp, ChevronDown, ChevronRight, Download, MessageSquare, ExternalLink, TicketPlus } from "lucide-react";

import { loadBimModel, saveBimModel } from "@core/lib/useBimModelSync";
import { useI18n } from "@core/lib/i18n";
import { parseBcfZip } from "@ifc/lib/bcfImport";
import { buildBcfZip } from "@ifc/lib/bcf";
import {
  STATUS,
  antwortTopics,
  leeresLayer,
  setzeAntwort,
  statusVon,
  ticketZuBefund,
  topicsZuLayer,
  uebergang,
} from "@ifc/lib/befundSpur";
import { ticketFuerBefund, ticketsDesProjekts } from "@ifc/lib/befundTicket";
import { statusLabel, ticketUrl } from "@ifc/lib/ticketLink";
import { viewerLink } from "@ifc/lib/viewerLink";

const nf = new Intl.NumberFormat("de-DE");

/** Kurzes Datum für die Tabelle (ISO → TT.MM.JJJJ, sonst Rohwert). */
function kurzDatum(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso || "—" : d.toLocaleDateString("de-DE");
}

/**
 * Viewer-Link für eine GlobalId — springt in den IfcViewer und markiert das
 * Bauteil (viewerLink.js, 65-05; IfcViewer wertet `sel` aus, IfcViewer.jsx:375).
 * @param {string} globalId 22-Zeichen-IFC-GlobalId
 * @returns {string} Hash-Route mit Query
 */
function bauteilLink(globalId) {
  const basis = `${window.location.origin}${window.location.pathname}`;
  return viewerLink(basis, "IfcViewer", { sel: globalId });
}

const STATUS_FARBE = {
  Open: "bg-rose-100 text-rose-700 border-rose-200",
  InProgress: "bg-amber-100 text-amber-700 border-amber-200",
  Resolved: "bg-emerald-100 text-emerald-700 border-emerald-200",
  Closed: "bg-slate-200 text-slate-600 border-slate-300",
};

/**
 * Karte „Befunde (BCF)" — Import, Antwort-Pflege, Antwort-Export, Befund → Ticket.
 *
 * @param {{projectId?: string|null, autor?: string}} props
 *   projectId: aktuelles Projekt (null → Layer bleibt flüchtig im State,
 *   keine Tickets)
 *   autor: Absender der Antworten (Briefkopf-Office, Default 'BIT-Atelier')
 * @returns {JSX.Element}
 */
export default function BcfIssues({ projectId, autor = "BIT-Atelier" }) {
  const { t } = useI18n();
  const navigate = useNavigate();

  // --- Layer-State mit Fachlayer-Guards (Regeln 1-4, s. Dateikopf) -----------
  const [layer, setLayer] = useState(() => leeresLayer());
  const loadingRef = useRef(false);
  const lastSaved = useRef(JSON.stringify(leeresLayer()));
  const pendingRef = useRef(null); // { pid, state } für Unmount-/Wechsel-Flush
  // Mirrors loadingRef for the render: an import during the load would be
  // dropped by setUser while the toast still reports success, so the
  // sample button waits for the stored layer (72-13, N-12).
  const [layerLaedt, setLayerLaedt] = useState(false);

  const setUser = useCallback((v) => {
    if (loadingRef.current) return; // Eingaben während des Ladens ignorieren
    setLayer(v);
  }, []);

  // Laden bei Projektwechsel + Flush des vorherigen Projekts.
  useEffect(() => {
    const pend = pendingRef.current;
    if (pend && pend.pid !== projectId) {
      pendingRef.current = null;
      if (JSON.stringify(pend.state) !== lastSaved.current) {
        saveBimModel(pend.pid, { befunde_layer: pend.state }).catch(() => {});
      }
    }
    if (!projectId) {
      setLayerLaedt(false);
      setLayer(leeresLayer());
      lastSaved.current = JSON.stringify(leeresLayer());
      return undefined;
    }
    let cancelled = false;
    loadingRef.current = true;
    setLayerLaedt(true);
    setLayer(leeresLayer());
    lastSaved.current = JSON.stringify(leeresLayer());
    (async () => {
      try {
        const m = await loadBimModel(projectId);
        if (cancelled) return;
        const val = m && m.befunde_layer != null ? m.befunde_layer : leeresLayer();
        lastSaved.current = JSON.stringify(val);
        setLayer(val);
      } catch {
        /* offline: Default bleibt; Speichern versucht es später */
      } finally {
        loadingRef.current = false;
        if (!cancelled) setLayerLaedt(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Debounced speichern (1,2 s wie useFachlayer) + Flush bei Unmount.
  useEffect(() => {
    if (!projectId || loadingRef.current) return undefined;
    const sig = JSON.stringify(layer);
    if (sig === lastSaved.current) return undefined;
    pendingRef.current = { pid: projectId, state: layer };
    const timer = setTimeout(() => {
      lastSaved.current = sig;
      pendingRef.current = null;
      saveBimModel(projectId, { befunde_layer: layer }).catch(() => {
        // Schreibfehler: pending bleibt für den nächsten Versuch/Unmount-Flush.
        pendingRef.current = { pid: projectId, state: layer };
        lastSaved.current = "";
      });
    }, 1200);
    return () => clearTimeout(timer);
  }, [layer, projectId]);

  useEffect(
    () => () => {
      const pend = pendingRef.current;
      if (pend && JSON.stringify(pend.state) !== lastSaved.current) {
        saveBimModel(pend.pid, { befunde_layer: pend.state }).catch(() => {});
      }
    },
    [],
  );

  // --- UI-State ---------------------------------------------------------------
  const dateiRef = useRef(null);
  const [offen, setOffen] = useState(() => new Set()); // ausgeklappte Topic-Guids
  // Antwort-Entwürfe: guid -> { status, text } — der Select setzt den Status,
  // gespeichert wird beides zusammen. Ohne Entwurf würde ein Statuswechsel
  // vor dem Text eine leere Antwort committen (setzeAntwort löscht bei leerem
  // Text) und der Status fiele auf den Import-Status zurück.
  const [entwurf, setEntwurf] = useState({});
  const [warnungen, setWarnungen] = useState([]);
  // Snapshot-Blob-URLs je Topic-Guid — nur für diese Sitzung (s. Dateikopf).
  const [snapshotUrls, setSnapshotUrls] = useState({});
  const snapshotUrlsRef = useRef({});
  const snapshotsFreigeben = useCallback(() => {
    for (const url of Object.values(snapshotUrlsRef.current)) URL.revokeObjectURL(url);
    snapshotUrlsRef.current = {};
    setSnapshotUrls({});
  }, []);
  useEffect(() => snapshotsFreigeben, [snapshotsFreigeben]);

  const antwortZahl = useMemo(
    () => Object.keys(layer.antworten || {}).filter((g) => layer.antworten[g]?.text?.trim()).length,
    [layer],
  );

  // --- Tickets of the project (72-13, N-12) -------------------------------------
  const [tickets, setTickets] = useState(/** @type {Array<{id: string, status?: string, bcf_topic_guid?: string}>} */ ([]));
  // Topic guids with a create call in flight: the ref blocks a second click at
  // once, the state disables the button on the next render.
  const [anlegend, setAnlegend] = useState(() => new Set());
  const anlegendRef = useRef(new Set());
  // A create that finishes after a project switch must not land in the new list.
  const projektRef = useRef(projectId);

  useEffect(() => {
    projektRef.current = projectId;
    setTickets([]);
    if (!projectId) return undefined;
    let cancelled = false;
    ticketsDesProjekts(projectId)
      .then((liste) => {
        if (!cancelled) setTickets(liste);
      })
      .catch((err) => {
        if (!cancelled) toast.error(`${t("Tickets konnten nicht geladen werden")}: ${err?.message || String(err)}`);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, t]);

  /**
   * Creates the ticket for a finding (or finds the existing one) and offers
   * "Ticket öffnen" in the toast.
   * @param {object} topic finding from the layer
   * @param {string} guid topic guid (lowercase)
   */
  const ticketAnlegen = async (topic, guid) => {
    if (!projectId || anlegendRef.current.has(guid)) return;
    const pid = projectId;
    anlegendRef.current.add(guid);
    setAnlegend(new Set(anlegendRef.current));
    try {
      const { issue, neu } = await ticketFuerBefund(topic, layer, pid);
      if (projektRef.current !== pid) return;
      setTickets((liste) => (liste.some((i) => i.id === issue.id) ? liste : [...liste, issue]));
      const optionen = {
        id: `bcf-ticket-${guid}`,
        duration: 12000,
        action: { label: t("Ticket öffnen"), onClick: () => navigate(ticketUrl(issue.id)) },
      };
      if (neu) toast.success(t("Ticket angelegt"), optionen);
      else toast.info(t("Zu diesem Befund gibt es schon ein Ticket."), optionen);
    } catch (err) {
      toast.error(`${t("Ticket konnte nicht angelegt werden")}: ${err?.message || String(err)}`);
    } finally {
      anlegendRef.current.delete(guid);
      setAnlegend(new Set(anlegendRef.current));
    }
  };

  // --- Import ------------------------------------------------------------------
  /**
   * .bcf/.bcfzip-Datei lesen → Layer ersetzen (Antworten für bekannte Guids
   * bleiben). Fehler als Toast, Warnungen unter der Tabelle (T-71-07:
   * parseBcfZip wirft Klartext bei Bomben-Grenzen).
   * @param {File} datei
   */
  const importieren = async (datei) => {
    try {
      const bytes = new Uint8Array(await datei.arrayBuffer());
      const erg = parseBcfZip(bytes);
      const { layer: neu, verwaist } = topicsZuLayer(erg, layer, { quelle: "catenda" });
      setUser(neu);
      setWarnungen(erg.warnungen);
      // Snapshots: alte URLs freigeben, neue anlegen (Bytes → image/png, T-71-08).
      snapshotsFreigeben();
      const urls = {};
      for (const [guid, png] of Object.entries(erg.snapshots || {})) {
        urls[String(guid).toLowerCase()] = URL.createObjectURL(new Blob([png], { type: "image/png" }));
      }
      snapshotUrlsRef.current = urls;
      setSnapshotUrls(urls);
      if (verwaist.length) {
        toast.info(`${verwaist.length} × ${t("gespeicherte Antwort gelöscht — Befund fehlt im neuen Import")}`);
      }
      toast.success(
        `${t("Befunde importiert")}: ${nf.format(erg.topics.length)}` +
          (erg.version ? ` (BCF ${erg.version})` : ""),
      );
    } catch (err) {
      toast.error(`${t("BCF-Import fehlgeschlagen")}: ${err?.message || String(err)}`);
    }
  };

  const onDatei = (ev) => {
    const datei = ev.target.files?.[0];
    ev.target.value = ""; // dieselbe Datei erneut wählen können
    if (datei) importieren(datei);
  };

  // Demo visitors have no BCF of their own (72-13, N-12). The container comes
  // from public/beispiel — the service worker precaches that folder
  // (scripts/build-sw.mjs), otherwise the fetch goes to the network.
  const [beispielLaedt, setBeispielLaedt] = useState(false);
  const beispielBcfLaden = async () => {
    setBeispielLaedt(true);
    try {
      const basis = import.meta.env.BASE_URL || "/";
      const antwort = await fetch(`${basis}beispiel/musterprojekt.bcf`);
      if (!antwort.ok) throw new Error(`HTTP ${antwort.status}`);
      const datei = new File([await antwort.arrayBuffer()], "musterprojekt.bcf", { type: "application/zip" });
      await importieren(datei);
    } catch (err) {
      toast.error(`${t("Beispiel-BCF konnte nicht geladen werden")}: ${err?.message || String(err)}`);
    } finally {
      setBeispielLaedt(false);
    }
  };

  // --- Antwort pflegen -----------------------------------------------------------
  /**
   * Entwurf (status/text) eines Topics ändern — der Select und das Textfeld
   * schreiben NUR den Entwurf; gespeichert wird mit antwortSpeichern().
   * @param {string} guid Topic-Guid (lowercase)
   * @param {{status?: string, text?: string}} patch
   */
  const entwurfSetzen = (guid, patch) => {
    setEntwurf((e) => {
      const alt = e[guid] || { status: null, text: "" };
      return { ...e, [guid]: { ...alt, ...patch } };
    });
  };

  /**
   * Entwurf committen → Layer-Antwort. Mit Übergangsprüfung (uebergang);
   * abgelehnte Wechsel bleiben folgenlos (Toast mit Grund).
   * @param {object} topic
   */
  const antwortSpeichern = (topic) => {
    const guid = String(topic.guid || "").toLowerCase();
    const antwort = layer.antworten?.[guid];
    const e = entwurf[guid] || {};
    const alt = antwort?.status || topic.topicStatus || "Open";
    const neuStatus = e.status || alt;
    const neuText = (e.text !== undefined ? e.text : (antwort?.text ?? "")).trim();
    // Review R-1 (10.09.): ein leerer Text darf eine gespeicherte Antwort NICHT
    // still löschen — setzeAntwort() interpretiert leer als „entfernen". Löschen
    // ist ein eigener Knopf (antwortLoeschen), Speichern verlangt Text.
    if (!neuText) {
      toast.error(t("Antwort braucht einen Text — zum Entfernen „Antwort löschen\" nutzen."));
      return;
    }
    if (antwort && antwort.text === neuText && antwort.status === neuStatus) {
      toast.info(t("Antwort unverändert."));
      return;
    }
    const pruefung = uebergang(alt, neuStatus, { kommentar: neuText });
    if (!pruefung.ok) {
      toast.error(pruefung.grund);
      return;
    }
    setUser(
      setzeAntwort(layer, topic.guid, {
        status: neuStatus,
        text: neuText,
        datum: new Date().toISOString(),
      }),
    );
    // Entwurf VERWERFEN (Schlüssel entfernen), nicht auf "" setzen: das Feld
    // liest `entwurf ?? antwort`, und "" ist nicht nullish — genau das ließ
    // vorher das Feld leer aussehen und den zweiten Klick löschen.
    setEntwurf((prev) => {
      const { [guid]: _weg, ...rest } = prev;
      return rest;
    });
    toast.success(t("Antwort gespeichert"));
  };

  /**
   * Gespeicherte Antwort eines Topics ausdrücklich entfernen (der einzige
   * Löschpfad — s. antwortSpeichern).
   * @param {object} topic
   */
  const antwortLoeschen = (topic) => {
    const guid = String(topic.guid || "").toLowerCase();
    if (!layer.antworten?.[guid]) return;
    setUser(setzeAntwort(layer, topic.guid, null));
    setEntwurf((prev) => {
      const { [guid]: _weg, ...rest } = prev;
      return rest;
    });
    toast.info(t("Antwort gelöscht"));
  };

  // --- Antwort-Export ---------------------------------------------------------------
  const exportAntwort = () => {
    try {
      // praefix bleibt der Plan-Vertragsstring „BIT-Atelier" (71-04-PLAN
      // interfaces: Kommentar „BIT-Atelier · <status>: <text>") — der
      // Briefkopf-Autor gehört in die Author-Felder (T-71-09), nicht in den
      // Text, sonst ändert ein Büroname die Wiedererkennbarkeit des Formats.
      const topics = antwortTopics(layer, { autor });
      if (!topics.length) {
        toast.info(t("Keine Antworten — es gibt nichts zu exportieren."));
        return;
      }
      const bytes = buildBcfZip(topics, { autor });
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = "antwort-issues.bcf";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success(`${t("Antwort-BCF exportiert")}: ${nf.format(topics.length)} ${t("Befunde")}`);
    } catch (err) {
      toast.error(`${t("BCF-Export fehlgeschlagen")}: ${err?.message || String(err)}`);
    }
  };

  // --- Render -------------------------------------------------------------------------
  const topics = layer.topics || [];

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm" data-testid="bcf-issues">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">{t("Befunde (BCF)")}</h3>
          <p className="text-xs text-slate-500">
            {topics.length
              ? `${nf.format(topics.length)} ${t("Befunde")} · BCF ${layer.version || "?"} · ${kurzDatum(layer.importiert)} · ${t("Antworten")}: ${nf.format(antwortZahl)}`
              : t("BCF des Generalplaners importieren (Solibri/Catenda) — Befunde beantworten, als Ticket übernehmen und als BCF zurückgeben.")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={dateiRef}
            type="file"
            accept=".bcf,.bcfzip,application/zip"
            className="hidden"
            data-testid="bcf-datei"
            onChange={onDatei}
          />
          <button
            type="button"
            data-testid="bcf-import"
            onClick={() => dateiRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <FileUp className="h-3.5 w-3.5" /> {t("BCF importieren")}
          </button>
          <button
            type="button"
            data-testid="bcf-antwort-export"
            disabled={!antwortZahl}
            onClick={exportAntwort}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
          >
            <Download className="h-3.5 w-3.5" /> {t("Antwort-BCF exportieren")}
          </button>
        </div>
      </header>

      {warnungen.length > 0 && (
        <ul className="border-b border-amber-100 bg-amber-50 px-4 py-2 text-xs text-amber-800" data-testid="bcf-warnungen">
          {warnungen.map((w) => (
            <li key={w}>⚠ {w}</li>
          ))}
        </ul>
      )}

      {topics.length > 0 && (
        <table className="w-full text-xs" data-testid="bcf-tabelle">
          <thead>
            <tr className="border-b border-slate-100 text-left text-slate-400">
              <th className="px-4 py-2 font-medium">{t("Titel")}</th>
              <th className="px-2 py-2 font-medium">{t("Status")}</th>
              <th className="px-2 py-2 font-medium">{t("Autor")}</th>
              <th className="px-2 py-2 font-medium">{t("Datum")}</th>
              <th className="px-2 py-2 text-right font-medium">{t("Bauteile")}</th>
              <th className="px-4 py-2 text-right font-medium">{t("Kommentare")}</th>
            </tr>
          </thead>
          <tbody>
            {topics.map((topic) => {
              const guid = String(topic.guid || "").toLowerCase();
              const offenZeile = offen.has(guid);
              const antwort = layer.antworten?.[guid];
              // Angezeigter Status: ungespeicherter Entwurf → gespeicherte
              // Antwort → Import-Status → Open (statusVon, R-5). Der Select
              // ändert NUR den Entwurf (gespeichert wird mit „Antwort speichern").
              const status = entwurf[guid]?.status || statusVon(layer, topic);
              const snapshotUrl = snapshotUrls[guid];
              const ticket = ticketZuBefund(tickets, guid);
              const detailId = `bcf-details-${guid}`;
              const umschalten = () =>
                setOffen((vorher) => {
                  const neu = new Set(vorher);
                  if (neu.has(guid)) neu.delete(guid);
                  else neu.add(guid);
                  return neu;
                });
              return (
                <React.Fragment key={guid}>
                  {/* The row click stays as mouse comfort; the keyboard path is the
                      button in the first cell (it stops the bubbling, otherwise the
                      row would toggle a second time). */}
                  <tr
                    className="cursor-pointer border-b border-slate-50 hover:bg-slate-50"
                    data-testid={`bcf-zeile-${guid}`}
                    onClick={umschalten}
                  >
                    <td className="max-w-[320px] px-4 py-2 font-medium text-slate-700">
                      <button
                        type="button"
                        aria-expanded={offenZeile}
                        aria-controls={detailId}
                        data-testid={`bcf-zeilenknopf-${guid}`}
                        className="block w-full truncate rounded text-left hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          umschalten();
                        }}
                      >
                        {offenZeile ? <ChevronDown className="mr-1 inline h-3 w-3" /> : <ChevronRight className="mr-1 inline h-3 w-3" />}
                        {topic.titel || t("(ohne Titel)")}
                        {antwort?.text ? <MessageSquare className="ml-1.5 inline h-3 w-3 text-emerald-600" /> : null}
                      </button>
                    </td>
                    <td className="px-2 py-2">
                      <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${STATUS_FARBE[status] || "bg-slate-100 text-slate-600 border-slate-200"}`}>
                        {status}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-slate-500">{topic.creationAuthor || "—"}</td>
                    <td className="px-2 py-2 text-slate-500">{kurzDatum(topic.creationDate)}</td>
                    <td className="px-2 py-2 text-right text-slate-500">{nf.format(topic.ifcGuids?.length || 0)}</td>
                    <td className="px-4 py-2 text-right text-slate-500">{nf.format(topic.kommentare?.length || 0)}</td>
                  </tr>
                  {offenZeile && (
                    <tr id={detailId} className="border-b border-slate-100 bg-slate-50/60" data-testid={`bcf-details-${guid}`}>
                      <td colSpan={6} className="px-4 py-3">
                        {topic.beschreibung && <p className="mb-2 text-slate-600">{topic.beschreibung}</p>}

                        {/* Befund → Ticket (72-13, N-12): one ticket per topic guid */}
                        <div className="mb-2 flex flex-wrap items-center gap-2" data-testid={`bcf-ticket-${guid}`}>
                          {ticket ? (
                            <>
                              <Link
                                to={ticketUrl(ticket.id)}
                                className="inline-flex items-center gap-1.5 rounded border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-100"
                              >
                                {t("Ticket öffnen")}
                              </Link>
                              <span className="text-slate-500">
                                {t("Ticket")}: {t(statusLabel(ticket.status || "open"))}
                              </span>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                disabled={!projectId || anlegend.has(guid)}
                                aria-describedby={projectId ? undefined : `bcf-ticket-grund-${guid}`}
                                className="inline-flex items-center gap-1.5 rounded border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                                onClick={() => ticketAnlegen(topic, guid)}
                              >
                                <TicketPlus className="h-3.5 w-3.5" /> {t("Als Ticket anlegen")}
                              </button>
                              {!projectId && (
                                <span id={`bcf-ticket-grund-${guid}`} className="text-slate-500">
                                  {t("Für ein Ticket zuerst ein Projekt wählen.")}
                                </span>
                              )}
                            </>
                          )}
                        </div>

                        {/* Snapshot des Generalplaners — Blob-URL image/png, nur diese Sitzung */}
                        {snapshotUrl && (
                          <img
                            src={snapshotUrl}
                            alt={t("Snapshot des Befunds")}
                            data-testid={`bcf-snapshot-${guid}`}
                            className="mb-2 max-h-48 rounded border border-slate-200 bg-white"
                          />
                        )}

                        {/* GlobalId-Chips → Viewer-Link (jede Guid springt in den IfcViewer) */}
                        {(topic.ifcGuids || []).length > 0 && (
                          <div className="mb-2 flex flex-wrap gap-1.5">
                            {topic.ifcGuids.map((g) => (
                              <a
                                key={g}
                                href={bauteilLink(g)}
                                data-testid={`bcf-guid-${g}`}
                                className="inline-flex items-center gap-1 rounded border border-sky-200 bg-sky-50 px-1.5 py-0.5 font-mono text-[10px] text-sky-700 hover:bg-sky-100"
                              >
                                <ExternalLink className="h-2.5 w-2.5" />
                                {g}
                              </a>
                            ))}
                          </div>
                        )}

                        {/* Importierte Kommentare — NUR Text (T-71-08) */}
                        {(topic.kommentare || []).length > 0 && (
                          <ul className="mb-2 space-y-1">
                            {topic.kommentare.map((k, i) => (
                              <li key={k.guid || i} className="rounded border border-slate-200 bg-white px-2 py-1 text-slate-600">
                                <span className="mr-2 text-[10px] text-slate-400">
                                  {k.autor || "?"} · {kurzDatum(k.datum)}
                                </span>
                                {k.text}
                              </li>
                            ))}
                          </ul>
                        )}

                        {/* Antwort: Status-Select + Text + Speichern */}
                        <div className="flex flex-wrap items-center gap-2">
                          <select
                            data-testid={`bcf-status-${guid}`}
                            value={status}
                            className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
                            onChange={(ev) => entwurfSetzen(guid, { status: ev.target.value })}
                          >
                            {[...new Set([...STATUS, status])].map((s) => (
                              <option key={s} value={s}>
                                {s}
                              </option>
                            ))}
                          </select>
                          <input
                            data-testid={`bcf-text-${guid}`}
                            value={entwurf[guid]?.text ?? antwort?.text ?? ""}
                            placeholder={t("Antwort…")}
                            className="min-w-[220px] flex-1 rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
                            onChange={(ev) => entwurfSetzen(guid, { text: ev.target.value })}
                          />
                          <button
                            type="button"
                            data-testid={`bcf-antwort-${guid}`}
                            className="rounded bg-slate-800 px-2.5 py-1 text-xs font-medium text-white hover:bg-slate-700"
                            onClick={() => antwortSpeichern(topic)}
                          >
                            {t("Antwort speichern")}
                          </button>
                          {antwort?.text ? (
                            <button
                              type="button"
                              data-testid={`bcf-antwort-loeschen-${guid}`}
                              className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600 hover:bg-rose-50 hover:text-rose-700"
                              onClick={() => antwortLoeschen(topic)}
                            >
                              {t("Antwort löschen")}
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      )}

      {topics.length === 0 && (
        <div className="flex flex-col items-center gap-2 px-4 py-6 text-center text-xs text-slate-400" data-testid="bcf-leer">
          <p>{t("Noch keine Befunde importiert.")}</p>
          <button
            type="button"
            data-testid="bcf-beispiel"
            disabled={beispielLaedt || layerLaedt}
            onClick={beispielBcfLaden}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <FileUp className="h-3.5 w-3.5" /> {beispielLaedt ? t("Lade Beispiel-BCF…") : t("Beispiel-BCF laden")}
          </button>
        </div>
      )}
    </section>
  );
}
