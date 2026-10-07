import React, { useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Button, buttonVariants } from "@core/components/ui/button";
import { Badge } from "@core/components/ui/badge";
import { Input } from "@core/components/ui/input";
import { createPageUrl } from "@core/utils";
import { Plug, RefreshCw, PlugZap, ArrowRight, Clock } from "lucide-react";
import { DATENQUELLE } from "@core/lib/umgebung";
import { useI18n } from "@core/lib/i18n";
import { cn } from "@core/lib/utils";

// --- Archicad — Tapir (quick 260731-arc) ---------------------------
// Echter Erreichbarkeits-Check gegen die lokale Archicad-JSON-API via
// GET /api/archicad/status (nur Status/Read; Schreib-Anbindung = Ausbaustufe).
//
// Cloud-Modus (57-04 Task 3): Die Archicad-Kopplung spricht 127.0.0.1 des
// NUTZERS an — das kann keine Edge Function erreichen (archicad/status ist
// bewusst NICHT portiert). Statt eines Netzfehlers zeigt die Karte hier einen
// Klartext-Hinweis und der Prüfen-Knopf bleibt aus (must-have: „nur lokal
// verfügbar" statt Fehler).
const NUR_LOKAL = DATENQUELLE === "supabase";
const NUR_LOKAL_HINWEIS =
  "Archicad-Kopplung nur im lokalen Betrieb: Die Verbindung läuft über die " +
  "Archicad-JSON-API auf diesem Rechner (127.0.0.1) — in der Cloud-Version " +
  "ist sie nicht verfügbar. Bitte die installierte Fassung nutzen.";

function ArchicadCard() {
  const [port, setPort] = useState(19723);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null); // { connected, product, version, tapir, checkedAt }

  const check = async () => {
    // Cloud: no probe at all — the button is hidden, this guard is the
    // belt-and-braces so a stale render can never fire a doomed request.
    if (NUR_LOKAL) return;
    setBusy(true);
    try {
      const resp = await fetch(`/api/archicad/status?port=${port}`);
      const d = await resp.json();
      setStatus({ ...d, checkedAt: new Date() });
    } catch {
      setStatus({ connected: false, offline: true, checkedAt: new Date() });
    } finally {
      setBusy(false);
    }
  };

  const on = !!status?.connected;
  if (NUR_LOKAL) {
    // Static card: same visual slot, honest hint instead of a dead control.
    return (
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Plug className="w-4 h-4 text-slate-400" />
              Archicad — Tapir
            </CardTitle>
            <Badge variant="outline" className="text-xs">CAD/BIM</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          <Badge variant="secondary" className="text-slate-600">Nur lokal verfügbar</Badge>
          <p className="text-sm text-slate-500">{NUR_LOKAL_HINWEIS}</p>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card className={on ? "border-emerald-300" : ""}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Plug className={`w-4 h-4 ${on ? "text-emerald-600" : "text-slate-400"}`} />
            Archicad — Tapir
          </CardTitle>
          <Badge variant="outline" className="text-xs">CAD/BIM</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-slate-500">
          Live-Verbindung zum laufenden Archicad über die JSON-Schnittstelle; Tapir-Befehle
          für Klassifizierung, Eigenschaften und Modellabgleich. Schreiboperationen folgen
          als Ausbaustufe.
        </p>
        <div className="flex items-center gap-2">
          <label htmlFor="archicad-port" className="text-xs text-slate-500 whitespace-nowrap">Port</label>
          <Input
            id="archicad-port"
            type="number"
            min={1024}
            max={65535}
            value={port}
            onChange={(e) => setPort(parseInt(e.target.value, 10) || 19723)}
            className="h-8 w-24 text-sm"
          />
        </div>
        {status && (
          <div className="space-y-1">
            {on ? (
              <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">
                Verbunden · {status.product}{status.version ? ` ${status.version}` : ""}
                {status.tapir?.verfuegbar ? ` · Tapir ${status.tapir.version ?? ""}` : " · Tapir nicht verfügbar"}
              </Badge>
            ) : (
              <Badge variant="secondary" className="text-slate-600">
                Nicht erreichbar — Archicad mit Tapir-Add-on starten
              </Badge>
            )}
            {status.hinweis && (
              <div className="text-xs text-amber-600">{status.hinweis}</div>
            )}
            <div className="text-xs text-slate-400">
              Zuletzt geprüft: {status.checkedAt.toLocaleString("de-DE")}
            </div>
          </div>
        )}
        <Button variant="outline" size="sm" className="w-full" onClick={check} disabled={busy}>
          {busy ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Prüfe…</> : "Verbindung prüfen"}
        </Button>
      </CardContent>
    </Card>
  );
}

// --- IFC / buildingSMART — im Produkt vorhanden (KD-21) ----------------------
// Kein Schalter, sondern Wege zu den tatsächlichen Funktionen: Export aus dem
// Reiter „Gebäudemodell" bzw. den Projektständen, Import/Ansicht im BIM-Viewer.
//
// 72-16 (N-18): router <Link>s instead of <a href="/BimViewer">. In the
// HashRouter builds a plain href is a full reload at the domain root - the demo
// visitor left /demo/ for the website. Native <Link> with buttonVariants instead
// of <Button asChild>, which costs a tsc error per use in this repo.
const IFC_WEG_KLASSE = cn(buttonVariants({ variant: "outline", size: "sm" }), "w-full justify-start");

function IfcCard() {
  const { t } = useI18n();
  const [satzVorReiter, satzNachReiter = ""] = t(
    "Zusätzlich exportiert der Reiter {reiter} das aktuelle Modell direkt als IFC-Datei.",
  ).split("{reiter}");
  return (
    <Card className="border-sky-300">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <PlugZap className="w-4 h-4 text-sky-600" />
            IFC / buildingSMART
          </CardTitle>
          <Badge variant="outline" className="text-xs">BIM</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-slate-500">
          Offener Modellaustausch — kein externer Dienst, sondern im Produkt eingebaut:
          IFC-Datei erzeugen bzw. einlesen. Der Export ist schematisch
          (extrudierte Baukörper/Bauteile), also Konzept- und Abstimmungsstand,
          keine prüffähige Mengengrundlage.
        </p>
        <div className="flex flex-col gap-2">
          <Link to={createPageUrl("BimViewer")} className={IFC_WEG_KLASSE}>
            <ArrowRight className="w-4 h-4 mr-2" aria-hidden="true" /> {t("BIM-Viewer — IFC importieren & ansehen")}
          </Link>
          <Link to={createPageUrl("ModelVersions")} className={IFC_WEG_KLASSE}>
            <ArrowRight className="w-4 h-4 mr-2" aria-hidden="true" /> {t("Projektstände — IFC exportieren")}
          </Link>
        </div>
        {/* One sentence, one i18n key: the tab name is spliced in at {reiter},
            so a translation can move it without breaking the link. */}
        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          {satzVorReiter}
          <Link
            to={`${createPageUrl("ComplexDesigner")}?tab=bim`}
            className="font-medium text-sky-700 underline hover:text-sky-900 dark:text-sky-300 dark:hover:text-sky-200"
          >
            {t("Gebäudemodell")}
          </Link>
          {satzNachReiter}
        </p>
      </CardContent>
    </Card>
  );
}

// Nicht angebundene Systeme — bewusst ohne Schalter (KD-21): früher waren dies
// Kacheln mit „Verbinden"/„Verbunden"-Toggle ohne jedes Backend.
const GEPLANT = [
  {
    id: "bim360",
    name: "Autodesk BIM 360",
    desc: "Modell- & Dokumentenkoordination",
    category: "BIM",
    notiz: "Kein Konto-/API-Zugang im Produkt. Austausch derzeit nur über IFC-Dateien.",
  },
  {
    id: "qgis",
    name: "QGIS / GIS",
    desc: "Geodaten & Standortanalyse",
    category: "GIS",
    notiz: "Keine QGIS-Kopplung. Geodaten kommen direkt aus OpenStreetMap/Open-Meteo im Reiter „Standort & Karte“; ein GeoJSON-Austausch fehlt.",
  },
  {
    id: "sap",
    name: "SAP ERP",
    desc: "Kosten- & Beschaffungsdaten",
    category: "ERP",
    notiz: "Keine Schnittstelle. Kostendaten bleiben in der lokalen JSON-DB.",
  },
  {
    id: "datev",
    name: "DATEV",
    desc: "Buchhaltung & Rechnungen",
    category: "Finanzen",
    notiz: "Export Buchungsstapel (EXTF) im Modul Buchhaltung, Reiter Jahresübersicht — vor produktiver Nutzung Probeimport beim Steuerberater.",
  },
  {
    id: "slack",
    name: "Slack",
    desc: "Team-Benachrichtigungen",
    category: "Kommunikation",
    notiz: "Kein Webhook hinterlegt. Benachrichtigungen laufen nur in der Anwendung.",
  },
];

export default function IntegrationsPanel() {
  return (
    <div className="space-y-4">
      <div className="text-sm text-slate-600">
        Eine echte Live-Verbindung (Archicad, lokal prüfbar) und der eingebaute
        IFC-Austausch. {GEPLANT.length} weitere Systeme sind <strong>geplant und
        nicht angebunden</strong> — sie lassen sich hier deshalb auch nicht
        einschalten.
      </div>

      <div>
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
          Angebunden
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          <ArchicadCard />
          <IfcCard />
        </div>
      </div>

      <div>
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
          Geplant — nicht angebunden
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {GEPLANT.map((it) => (
            <Card key={it.id} className="border-dashed bg-slate-50/60">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2 text-slate-600">
                    <Plug className="w-4 h-4 text-slate-300" />
                    {it.name}
                  </CardTitle>
                  <Badge variant="outline" className="text-xs">{it.category}</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-sm text-slate-500">{it.desc}</p>
                <Badge variant="secondary" className="text-slate-600">
                  <Clock className="w-3 h-3 mr-1" /> geplant — nicht angebunden
                </Badge>
                <p className="text-[11px] text-slate-400">{it.notiz}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
