import { seitenWurzel } from "@core/lib/utils";
// ModelCheck.jsx — Prüf-Suite (Phase 64): Clash Detection + IDS-Prüfung + BCF/PDF-Export.
//
// Ablauf: (1) IFC laden (parseIfcFile + extractGeometry) → (2) Kollisionsregeln
// wählen + optional .ids laden → (3) Prüfung starten (chunked via clashPairsIter,
// setTimeout-Yield je 200 Paare) → Ergebnis-Dashboard → BCF-2.1-/PDF-Export und
// Befundliste als CSV/Excel (66-14, befundListe.js + @core/lib/tabellenExport).
//
// Verwendete Modul-Signaturen (verifiziert):
//   parseIfcFile(arrayBuffer, onProgress) → { schema, storeys, elements }
//   extractGeometry(arrayBuffer, onProgress) → { elemente, uebersprungen }
//   clashPairsIter(elems, {rules, tolerance, clearance, duplikate, maxPairs})
//     — Generator, yield {typ:'fortschritt', geprueft, gesamt},
//       return {clashes, geprueft, uebersprungen, ohneGeometrie}
//   parseIdsXml(xmlString) → specs; evaluateIds(specs, elements) → Ergebnisliste
//   buildBcfZip(topics, {autor, modellName, datum}) → Uint8Array; newTopicGuid()
//   exportElementToPdf(el, filename) — jsPDF+html2canvas (Briefkopf-Muster der Berichte-Seite)

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { bitApi } from "@core/api/bitApi";
import { useSearchParams, useLocation } from "react-router-dom";
import { useProject } from "@core/lib/ProjectContext";
import { useI18n } from "@core/lib/i18n";
import { useAktionen } from "@core/lib/aktionen";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Button } from "@core/components/ui/button";
import { Badge } from "@core/components/ui/badge";
import { Input } from "@core/components/ui/input";
import { Progress } from "@core/components/ui/progress";
import { toast } from "sonner";
import {
  ShieldCheck, FileUp, Loader2, AlertTriangle, CheckCircle2, XCircle,
  Boxes, Building2, Download, FileDown, ChevronDown, ChevronRight, Play, Info,
  Package, Share2, FileSpreadsheet,
} from "lucide-react";
import { parseIfcFile, extractGeometry } from "@ifc/lib/ifcImport";
import BcfIssues from "@ifc/components/BcfIssues";
import IdsEditor from "@ifc/components/IdsEditor";
import LieferpaketKarte, { klassenZaehlung } from "@ifc/components/LieferpaketKarte";
import Befundkarte from "@ifc/components/Befundkarte";
import { datumText } from "@ifc/lib/lieferplan";
import { clashPairsIter, STANDARD_REGELN } from "@ifc/lib/clash";
import { ladeRegelsatz, regelnZuOptionen, grundlageText } from "@ifc/lib/clashRegeln";
import { findeKoordinationskoerper, vergleicheLage } from "@ifc/lib/koordinationskoerper";
import { parseIdsXml, evaluateIds } from "@ifc/lib/ids";
import { buildBcfZip, newTopicGuid } from "@ifc/lib/bcf";
import { befundHtml } from "@ifc/lib/befundHtml";
import { baueBefundPaket } from "@ifc/lib/befundPaket";
import { befundTabelle, befundlisteDateiname, zaehleBefundzeilen } from "@ifc/lib/befundListe";
import { dateiAnbieten, tabelleAlsCsv, tabellenAlsXlsx } from "@core/lib/tabellenExport";
import { exportElementToPdf } from "@core/lib/pdf";
import { pfadText } from "@core/lib/ablage";
import { befundText, oeffneFeedback } from "@core/lib/feedback";
import { SERVERLOS } from "@core/lib/umgebung";
import { parsePruefzustand, prueflaufLink, serialisierePruefzustand } from "@ifc/lib/prueflaufLink";

const nf = new Intl.NumberFormat("de-DE");
const nf3 = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 3 });
const nf2 = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 });

const KIND_LABELS = {
  hard: "Kollision",
  clearance: "Abstand",
  duplicate: "Duplikat",
  // 71-02 BAP-Prüfarten — als Näherung beschriftet (T-71-05).
  enthalten: "nicht größer als (AABB-Näherung)",
  gefuellt: "gefüllt (AABB-Näherung)",
  deckung: "deckungsgleich (AABB-Näherung)",
  ohne_partner: "ohne Gegenstück",
};
const KIND_BADGE = {
  hard: "bg-rose-100 text-rose-700 border-rose-200",
  clearance: "bg-amber-100 text-amber-700 border-amber-200",
  duplicate: "bg-violet-100 text-violet-700 border-violet-200",
  enthalten: "bg-sky-100 text-sky-700 border-sky-200",
  gefuellt: "bg-sky-100 text-sky-700 border-sky-200",
  deckung: "bg-cyan-100 text-cyan-700 border-cyan-200",
  ohne_partner: "bg-slate-100 text-slate-600 border-slate-200",
};

// Standard-Briefkopf — identisch zur Berichte-Seite (Setting-Entität key "briefkopf").
const BRIEFKOPF_DEFAULTS = {
  office: "Architekturbüro",
  tagline: "INTEGRATED PROJECT PLATFORM",
  address: "",
  contact: "",
};

const fmtCenter = (c) =>
  c ? `(${nf2.format(c.x)} / ${nf2.format(c.y)} / ${nf2.format(c.z)})` : "—";

function downloadBytes(bytes, filename, mime = "application/octet-stream") {
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const safeFileName = (s) => String(s || "modell").replace(/[^\wäöüÄÖÜß-]+/g, "_");

/** MIME type of an .xlsx download (66-14). */
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export default function ModelCheck() {
  const { project } = useProject();
  const { t } = useI18n();
  // Route path is the registry key (plan 69-12 Task 1: "/ModelCheck"); derived
  // from useLocation so it stays correct behind any basename.
  const location = useLocation();

  // --- Schritt 1: IFC laden --------------------------------------------------
  const ifcInputRef = useRef(null);
  const ifc2InputRef = useRef(null);
  const [suchParams] = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [fehler, setFehler] = useState("");
  const [modell, setModell] = useState(null); // { fileName, parsed|null, geo, buffer }
  // Vergleichsmodell (71-02 Task 3): zweites IFC für die BAP-Matrix-Prüfung
  // (Rohbau ↔ Architektur). Sobald es geladen ist, werden BEIDE Geometrien
  // unzentriert neu extrahiert (D-P71-05) — COORDINATE_TO_ORIGIN würde jedes
  // Modell auf seinen eigenen Schwerpunkt setzen und jeden Lagevergleich
  // zerstören (71-RESEARCH §1.4).
  const [vergleich, setVergleich] = useState(null); // { fileName, geo, buffer }

  // --- Schritt 2: Regeln + IDS ----------------------------------------------
  const [regelAktiv, setRegelAktiv] = useState(() => STANDARD_REGELN.map(() => true));
  const [toleranzMm, setToleranzMm] = useState(1); // Bagatellfilter in mm
  const [clearanceMm, setClearanceMm] = useState(0); // 0 = kein Abstands-Check
  const [duplikate, setDuplikate] = useState(true);

  const idsInputRef = useRef(null);
  const [idsSpecs, setIdsSpecs] = useState([]);
  // 69-08: own rules from the IDS editor — evaluated IN ADDITION to the loaded
  // file specs and marked "eigene Regel" in the result table.
  const [eigeneSpecs, setEigeneSpecs] = useState([]);
  const [idsFileName, setIdsFileName] = useState("");
  const [idsFehler, setIdsFehler] = useState("");
  // Regelsatz-Wähler (71-01 Task 3): mitgelieferte IDS-Sätze aus
  // public/pruefregeln/index.json ([{datei, titel, quelle}], Pfade relativ zu
  // BASE_URL) + „eigene Datei" (der bestehende Picker). D-P71-06: Demo und
  // Client sehen dieselben Sätze. 71-02: Einträge mit art:"clash" laden eine
  // BAP-Regeldatei statt einer IDS.
  const [regelsaetze, setRegelsaetze] = useState([]);
  const [regelsatzWahl, setRegelsatzWahl] = useState("eigene");
  // BAP-Clash-Regelsatz (71-02): { regeln, koordination, warnungen } aus
  // ladeRegelsatz, dazu Anzeigename und Fehler-/Warnmeldung.
  const [bapRegeln, setBapRegeln] = useState(null);
  const [bapName, setBapName] = useState("");
  const [bapFehler, setBapFehler] = useState("");

  // --- Schritt 3: Prüfung + Ergebnis ------------------------------------------
  const [laufStatus, setLaufStatus] = useState("idle"); // idle | laeuft | fertig
  const [fortschritt, setFortschritt] = useState({ geprueft: 0, gesamt: 0 });
  const [ergebnis, setErgebnis] = useState(null); // { clash, ids }
  const [offeneGruppen, setOffeneGruppen] = useState(() => new Set());
  const [exportiert, setExportiert] = useState(false);

  // Briefkopf für den Prüfbericht (persistente Setting-Entität, wie Berichte-Seite).
  const [briefkopf, setBriefkopf] = useState(BRIEFKOPF_DEFAULTS);
  useEffect(() => {
    (async () => {
      try {
        const rows = await bitApi.entities.Setting.filter({ key: "briefkopf" });
        if (rows[0]) setBriefkopf({ ...BRIEFKOPF_DEFAULTS, ...rows[0].value });
      } catch { /* Defaults verwenden */ }
    })();
  }, []);
  const reportRef = useRef(null);
  // Lieferung (71-03): die LieferpaketKarte meldet Lieferung, Richtlinien-Name
  // und Warnungen — der Prüfbericht zieht daraus seinen Abschnitt „Lieferung".
  const [lieferInfo, setLieferInfo] = useState(null);
  const lieferInfoSetzen = useCallback((info) => setLieferInfo(info), []);

  // --- IFC laden --------------------------------------------------------------
  // Ein Ladepfad für beide Quellen (Phase 65-03): die Datei des Besuchers und das
  // mitgelieferte Musterprojekt laufen durch dieselben Funktionen. Zwei Pfade
  // hätten bedeutet, dass der Beispiel-Lauf etwas anderes beweist als der echte.
  /**
   * @param {ArrayBuffer} buffer IFC-Rohdaten
   * @param {string} dateiname Anzeigename
   * @param {"datei"|"beispiel"} quelle Herkunft, wird im Ergebnis ausgewiesen
   */
  const ladeIfcBuffer = async (buffer, dateiname, quelle) => {
    setFehler("");
    setModell(null);
    setErgebnis(null);
    setLaufStatus("idle");
    setBusy(true);
    setStatusText("Lese Datei…");
    try {
      // Mikro-Yield, damit der Spinner gerendert ist, bevor WASM rechnet.
      await new Promise((r) => setTimeout(r, 0));

      // Semantik (Psets/Klassifizierung/Material) für IDS — darf fehlschlagen,
      // wenn das Modell nur Typen außerhalb des Produktkatalogs enthält (reines
      // TGA-Modell): die Clash-Prüfung läuft dann trotzdem über die Geometrie.
      let parsed = null;
      try {
        parsed = await parseIfcFile(buffer, setStatusText);
      } catch { /* nur Geometrie-Prüfung möglich */ }

      // Geometrie (StreamAllMeshes ist blockierend — Hinweis läuft über statusText).
      // Steht schon ein Vergleichsmodell, wird direkt UNZENTRIERT gelesen
      // (D-P71-05) — der zentrierte Erstlauf wäre sofort veraltet.
      const zweiModelle = vergleich != null;
      const geo = await extractGeometry(buffer, setStatusText,
        { coordinateToOrigin: !zweiModelle });
      if (!geo.elemente.length) {
        throw new Error("Das Modell enthält keine prüfbare Geometrie.");
      }
      // buffer bleibt im State: kommt später ein Vergleichsmodell dazu, wird
      // die Geometrie unzentriert neu gelesen, ohne die Datei neu zu wählen.
      setModell({ fileName: dateiname, parsed, geo, quelle, buffer });
      return true;
    } catch (err) {
      // Der Nutzer bekommt einen lesbaren Satz, die Konsole den echten Fehler —
      // ohne den ist eine Meldung wie "x.get is not a function" nicht auffindbar.
      console.error("IFC konnte nicht geladen werden:", err);
      setFehler(err?.message || "Die IFC-Datei konnte nicht gelesen werden.");
      return false;
    } finally {
      setBusy(false);
      if (ifcInputRef.current) ifcInputRef.current.value = "";
    }
  };

  const handleIfcFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await ladeIfcBuffer(await file.arrayBuffer(), file.name, "datei");
  };

  // --- Vergleichsmodell (71-02 Task 3) ----------------------------------------
  /**
   * Zweites IFC laden: BEIDE Geometrien werden unzentriert neu gelesen, damit
   * sie im SELBEN Koordinatensystem stehen (Plan-Wahrheit #4). Das Hauptmodell
   * braucht dafür seinen buffer (beim Laden behalten).
   * @param {ArrayBuffer} buffer
   * @param {string} dateiname
   */
  const ladeVergleichBuffer = async (buffer, dateiname) => {
    setFehler("");
    setErgebnis(null);
    setLaufStatus("idle");
    setBusy(true);
    try {
      if (!modell?.buffer) {
        throw new Error(
          "Hauptmodell ohne Puffer (z. B. per Deep-Link geladen) — bitte zuerst das Haupt-IFC neu wählen.");
      }
      setStatusText("Lese Vergleichsmodell (unzentriert)…");
      const geoB = await extractGeometry(buffer, setStatusText, { coordinateToOrigin: false });
      if (!geoB.elemente.length) {
        throw new Error("Das Vergleichsmodell enthält keine prüfbare Geometrie.");
      }
      setStatusText("Hauptmodell unzentriert neu gelesen (gemeinsames Koordinatensystem)…");
      const geoA = await extractGeometry(modell.buffer, () => {}, { coordinateToOrigin: false });
      if (!geoA.elemente.length) {
        throw new Error("Das Hauptmodell enthält unzentriert keine prüfbare Geometrie.");
      }
      setModell({ ...modell, geo: geoA });
      setVergleich({ fileName: dateiname, geo: geoB, buffer });
      return true;
    } catch (err) {
      console.error("Vergleichsmodell konnte nicht geladen werden:", err);
      setFehler(err?.message || "Das Vergleichsmodell konnte nicht gelesen werden.");
      return false;
    } finally {
      setBusy(false);
      if (ifc2InputRef.current) ifc2InputRef.current.value = "";
    }
  };

  const handleIfc2File = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await ladeVergleichBuffer(await file.arrayBuffer(), file.name);
  };

  /**
   * Vergleich entfernen (R-3, 71-02-Nacharbeit): das Hauptmodell wird wieder
   * ZENTRIERT gelesen — sonst rechnete der Ein-Modell-Lauf eines UTM-Modells
   * weiter auf unzentrierten Float32-Koordinaten (0,5-m-Raster bei x ≈ 4 Mio.).
   */
  const vergleichEntfernen = async () => {
    setVergleich(null);
    setErgebnis(null);
    setLaufStatus("idle");
    if (!modell?.buffer) return;
    setBusy(true);
    try {
      setStatusText("Hauptmodell zentriert neu gelesen…");
      const geo = await extractGeometry(modell.buffer, setStatusText, { coordinateToOrigin: true });
      if (geo.elemente.length) setModell({ ...modell, geo });
    } catch (err) {
      console.error("Hauptmodell konnte nicht zentriert neu gelesen werden:", err);
      setFehler(err?.message || "Das Hauptmodell konnte nicht neu gelesen werden.");
    } finally {
      setBusy(false);
    }
  };

  // --- IDS laden --------------------------------------------------------------
  /**
   * @param {string} text IDS-XML
   * @param {string} dateiname Anzeigename
   */
  const ladeIdsText = (text, dateiname) => {
    setIdsFehler("");
    setIdsSpecs([]);
    setIdsFileName(dateiname);
    try {
      const specs = parseIdsXml(text); // Browser: nativer DOMParser
      if (!specs.length) throw new Error("Die Datei enthält keine <specification>-Einträge.");
      setIdsSpecs(specs);
      return true;
    } catch (err) {
      setIdsFehler(err?.message || "Die IDS-Datei konnte nicht gelesen werden.");
      return false;
    } finally {
      if (idsInputRef.current) idsInputRef.current.value = "";
    }
  };

  const handleIdsFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setRegelsatzWahl("eigene");   // eigener Pick überschreibt die Wähler-Auswahl
    // Project rule sets (IDS and BAP clash matrices) are never shipped in
    // public/ (phase 78 hotfix) — a .json pick is a BAP rule set, validated by
    // the same ladeRegelsatz() the selector uses.
    if (file.name.toLowerCase().endsWith(".json")) {
      setBapFehler("");
      try {
        const bap = ladeRegelsatz(JSON.parse(await file.text()));
        setBapRegeln(bap);
        setBapName(file.name);
        if (bap.warnungen.length) setBapFehler(bap.warnungen.join(" · "));
      } catch (err) {
        setBapFehler(err?.message || "Die BAP-Regeldatei konnte nicht gelesen werden.");
      } finally {
        if (idsInputRef.current) idsInputRef.current.value = "";
      }
      return;
    }
    ladeIdsText(await file.text(), file.name);
  };

  // --- Mitgelieferte Regelsätze (71-01 Task 3, D-P71-06) -----------------------
  // index.json liegt unter public/pruefregeln/ und wird beim Build mitgeliefert —
  // Demo (BASE_URL /demo/) und lokaler Client (/) sehen dieselben Sätze.
  useEffect(() => {
    (async () => {
      try {
        const basis = import.meta.env.BASE_URL || "/";
        const antwort = await fetch(`${basis}pruefregeln/index.json`);
        if (!antwort.ok) return;            // kein Wähler ohne Index — Karte bleibt wie vorher
        const liste = await antwort.json();
        if (Array.isArray(liste)) setRegelsaetze(liste.filter((e) => e?.datei && e?.titel));
      } catch { /* offline o. ä. — der Wähler bleibt leer, eigener Upload geht weiter */ }
    })();
  }, []);

  /**
   * Regelsatz aus dem Wähler laden — derselbe fetch-Weg wie beispielLaden()
   * für musterprojekt.ids (key_link 71-01). 71-02: index.json-Einträge tragen
   * `art: "ids" | "clash"`; Clash-Sätze (BAP-Matrix) werden validiert und
   * ersetzen die Standard-Regeln, sobald ein Vergleichsmodell geladen ist.
   * @param {string} wert Select-Wert: Index in regelsaetze oder "eigene"
   */
  const regelsatzLaden = async (wert) => {
    setRegelsatzWahl(wert);
    if (wert === "eigene") {
      idsInputRef.current?.click();
      return;
    }
    const satz = regelsaetze[Number(wert)];
    if (!satz) return;
    setIdsFehler("");
    try {
      const basis = import.meta.env.BASE_URL || "/";
      const antwort = await fetch(`${basis}${satz.datei}`);
      if (!antwort.ok) throw new Error(`„${satz.titel}" konnte nicht geladen werden (HTTP ${antwort.status}).`);
      if (satz.art === "clash") {
        // BAP-Matrix: validieren (T-71-06 Klartextfehler mit Regel-ID) und
        // für den Zwei-Modell-Lauf vormerken.
        setBapFehler("");
        const ergebnis = ladeRegelsatz(await antwort.json());
        setBapRegeln(ergebnis);
        setBapName(satz.titel);
        if (ergebnis.warnungen.length) setBapFehler(ergebnis.warnungen.join(" · "));
        return;
      }
      ladeIdsText(await antwort.text(), satz.titel);
    } catch (err) {
      const meldung = err?.message || `„${satz.titel}" konnte nicht geladen werden.`;
      if (satz.art === "clash") setBapFehler(meldung);
      else setIdsFehler(meldung);
    }
  };

  // --- Musterprojekt ----------------------------------------------------------
  // Ohne dieses Modell verlangt die Prüf-Suite vom Erstbesucher als Allererstes
  // ein eigenes IFC — fremdes Projekt, NDA, 200 MB. Genau dort blieb das
  // Kernversprechen der Website unbewiesen (Befund BEF-01).
  const beispielLaden = async () => {
    setFehler("");
    setBusy(true);
    setStatusText("Lade Musterprojekt…");
    try {
      const basis = import.meta.env.BASE_URL || "/";
      const [ifcAntwort, idsAntwort] = await Promise.all([
        fetch(`${basis}beispiel/musterprojekt.ifc`),
        fetch(`${basis}beispiel/musterprojekt.ids`),
      ]);
      if (!ifcAntwort.ok) {
        throw new Error(
          `Das Musterprojekt konnte nicht geladen werden (HTTP ${ifcAntwort.status}). ` +
            "Erwartet unter public/beispiel/musterprojekt.ifc.",
        );
      }
      const buffer = await ifcAntwort.arrayBuffer();
      if (idsAntwort.ok) ladeIdsText(await idsAntwort.text(), "musterprojekt.ids");
      return await ladeIfcBuffer(buffer, "musterprojekt.ifc", "beispiel");
    } catch (err) {
      console.error("Musterprojekt konnte nicht geladen werden:", err);
      setFehler(err?.message || "Das Musterprojekt konnte nicht geladen werden.");
      setBusy(false);
      return false;
    }
  };

  // Elementform für evaluateIds aus parseIfcFile zusammensetzen.
  // MAPPING-FIX (71-01 Task 3, Befund 71-RESEARCH §2): der Import liefert
  //   parseIfcFile: { guid, ifcType, name, psets, qty, klassifikation: string[] („<code> <name>"),
  //                   classifications: string[], materials: string[] }   (ifcImport.js:569-597)
  //   evaluateIds erwartet: { globalId, ifcType, name, psets, classification|classifications, material:[…] }
  // Vorher stand hier el.globalId / el.classification.{name,code} — Felder, die
  // es im Import NICHT gibt. Folge: jede IDS-Verletzung ohne GlobalId,
  // Klassifikations-Facetten immer verletzt, BCF aus IDS ohne Components.
  // Klassifikation: das Array wird direkt durchgereicht — pruefeKlassifikation
  // (ids.js, 71-01 erweitert) versteht `classifications` als Array von
  // „<code> <name>"-Strings (mind. EIN Eintrag muss matchen).
  const idsElemente = useMemo(() => {
    const liste = modell?.parsed?.elements || [];
    return liste.map((el) => ({
      globalId: el.guid ?? el.globalId ?? undefined,
      ifcType: el.ifcType,
      name: el.name,
      predefinedType: el.predefinedType || undefined,
      psets: el.psets || {},
      classifications: el.classifications || [],
      material: el.materials || [],
    }));
  }, [modell]);

  // --- Prüfung (chunked: der Generator yieldet alle 200 Paare) -----------------
  const pruefungStarten = async () => {
    if (!modell?.geo?.elemente?.length || laufStatus === "laeuft") return;
    setLaufStatus("laeuft");
    setErgebnis(null);
    setExportiert(false);
    setOffeneGruppen(new Set());
    setFortschritt({ geprueft: 0, gesamt: 0 });

    // Zwei-Modell-Lauf (71-02): BAP-Regeln + quellmarkierte Elemente, sonst
    // der Bestandspfad (STANDARD_REGELN, ein Modell).
    const zweiModelle = vergleich != null;
    const bapAktiv = zweiModelle && bapRegeln != null;
    let rules;
    let optionen;
    if (bapAktiv) {
      optionen = regelnZuOptionen(bapRegeln.regeln, {
        tolerance: Math.max(0, Number(toleranzMm) || 0) / 1000,
        clearance: Math.max(0, Number(clearanceMm) || 0) / 1000,
        duplikate,
        // TX×AX: 5.970 × 5.430 Kandidaten (71-RESEARCH §1.4) — das Cap hoch,
        // sonst zählen wir nur noch 'uebersprungen' (T-71-04: das Gitter
        // begrenzt die echten Paare, Broadphase + maxPairs bleiben der Anker).
        maxPairs: 500_000,
      });
    } else {
      rules = STANDARD_REGELN.filter((_, i) => regelAktiv[i]);
      optionen = {
        rules,
        tolerance: Math.max(0, Number(toleranzMm) || 0) / 1000,
        clearance: Math.max(0, Number(clearanceMm) || 0) / 1000,
        duplikate,
      };
    }
    // Hauptmodell = Quelle A, Vergleichsmodell = Quelle B (Regeldatei spricht
    // A/B). Ein-Modell-Lauf: keine Quelle (Bestandsverhalten).
    const elemente = zweiModelle
      ? [
        ...modell.geo.elemente.map((el) => ({ ...el, quelle: "A" })),
        ...vergleich.geo.elemente.map((el) => ({ ...el, quelle: "B" })),
      ]
      : modell.geo.elemente;

    // Koordinationskörper (BAP-Matrix KOORD-01, 0 mm): Lage beider Modelle
    // über den zweiten IfcSite vergleichen — unabhängig vom Clash-Lauf.
    let koordination = null;
    if (zweiModelle && bapRegeln?.koordination) {
      const koerperA = findeKoordinationskoerper(modell.geo.elemente);
      const koerperB = findeKoordinationskoerper(vergleich.geo.elemente);
      koordination = {
        regel: bapRegeln.koordination,
        ...vergleicheLage(koerperA, koerperB, bapRegeln.koordination.toleranzMm),
        nameA: koerperA?.name || null,
        nameB: koerperB?.name || null,
      };
    }

    try {
      const iter = clashPairsIter(elemente, optionen);
      let schritt = iter.next();
      while (!schritt.done) {
        if (schritt.value?.typ === "fortschritt") setFortschritt(schritt.value);
        // Yield an den Browser — UI (Fortschrittsbalken) bleibt responsiv.
        await new Promise((r) => setTimeout(r, 0));
        schritt = iter.next();
      }
      const clash = schritt.value;

      // IDS nur, wenn Specs geladen UND semantische Elemente vorhanden sind.
      // 69-08: own rules from the editor are evaluated IN ADDITION to the loaded
      // file specs — file specs first, so the "eigene Regel" marking (r.eigen:
      // table, report, BCF) starts at index idsSpecs.length. eigeneSpecs arrive
      // in run form from the editor (pattern RegExps rebuilt, specsFuerLauf).
      const alleSpecs = [...idsSpecs, ...eigeneSpecs];
      const ids = alleSpecs.length && idsElemente.length
        ? evaluateIds(alleSpecs, idsElemente).map((r, i) => (i >= idsSpecs.length ? { ...r, eigen: true } : r))
        : [];

      setFortschritt({ geprueft: clash.geprueft, gesamt: clash.geprueft });
      setErgebnis({ clash, ids, koordination, zweiModelle, bapAktiv });
      setLaufStatus("fertig");
    } catch (err) {
      setLaufStatus("idle");
      toast.error("Prüfung fehlgeschlagen: " + (err?.message || String(err)));
    }
  };

  // --- Auswertung fürs Dashboard ------------------------------------------------
  const kpi = useMemo(() => {
    if (!ergebnis) return null;
    const c = ergebnis.clash.clashes;
    return {
      hard: c.filter((x) => x.kind === "hard").length,
      clearance: c.filter((x) => x.kind === "clearance").length,
      duplicate: c.filter((x) => x.kind === "duplicate").length,
      // BAP-Prüfarten (71-02): Näherungsbefunde + fehlende Gegenstücke.
      enthalten: c.filter((x) => x.kind === "enthalten").length,
      gefuellt: c.filter((x) => x.kind === "gefuellt").length,
      deckung: c.filter((x) => x.kind === "deckung").length,
      ohnePartner: c.filter((x) => x.kind === "ohne_partner").length,
      idsBestanden: ergebnis.ids.filter((r) => r.bestanden).length,
      idsVerletzt: ergebnis.ids.filter((r) => !r.bestanden).length,
    };
  }, [ergebnis]);

  // Clash-Gruppen nach Paar-Typ; globale Sortierung (Volumen absteigend) bleibt
  // innerhalb der Gruppen erhalten, Gruppenreihenfolge = erster (größter) Befund.
  const clashGruppen = useMemo(() => {
    if (!ergebnis) return [];
    const map = new Map();
    for (const c of ergebnis.clash.clashes) {
      const key = `${c.aType || "?"} × ${c.bType || "?"}`;
      let g = map.get(key);
      if (!g) map.set(key, (g = { key, clashes: [] }));
      g.clashes.push(c);
    }
    return [...map.values()];
  }, [ergebnis]);

  // 66-08: report number of each finding (position in the result list + 1) — the
  // same number the finding map prints, so map and list resolve each other.
  const befundNr = useMemo(
    () => new Map((ergebnis?.clash?.clashes || []).map((c, i) => [c, i + 1])),
    [ergebnis],
  );
  // 66-08: geometry the check ran on (both models in a comparison run, uncentred
  // there; centred in a single run — the finding centres share that system). The
  // source tag A/B mirrors the check run: express IDs repeat across the two files.
  const kartenElemente = useMemo(
    () => (vergleich
      ? [
        ...(modell?.geo?.elemente || []).map((el) => ({ ...el, quelle: "A" })),
        ...(vergleich.geo?.elemente || []).map((el) => ({ ...el, quelle: "B" })),
      ]
      : (modell?.geo?.elemente || [])),
    [modell, vergleich],
  );

  const gruppeToggle = (key) =>
    setOffeneGruppen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // --- Tieflink „?beispiel=1" UND Teil-Link (69-06) ---------------------------
  // Die Website verlinkt den Prüf-Suite-Screenshot auf demo/#/ModelCheck?beispiel=1.
  // Wer dort ankommt, soll das Ergebnis sehen, nicht erst zwei Knöpfe suchen.
  // 69-06: ein geteilter Stand kommt als ?q=…&r=…&f=…&s=…&o=… — parsePruefzustand
  // liest BEIDE Formen (Legacy ?beispiel=1 bleibt lesbar).
  const teilZustand = useMemo(() => parsePruefzustand(suchParams), [suchParams]);
  const beispielAngefordert = suchParams.get("beispiel") === "1" || teilZustand?.quelle === "beispiel";
  const beispielAusgeloest = useRef(false);
  const [autoStart, setAutoStart] = useState(false);

  // 69-06: the shared finding (GlobalId) — pre-set from the link, click on a
  // table row selects/deselects. The GlobalId is the anchor, NOT the expressId
  // (viewerLink lesson: expressIds change on every export).
  const [selBefund, setSelBefund] = useState(/** @type {string|null} */ (teilZustand?.sel || null));
  // A q=datei link cannot restore the model (a link never carries model
  // content) — say so instead of showing an empty list (must-have 2).
  const modellFehltHinweis = teilZustand?.quelle === "datei" && !modell && !busy;
  // Open the groups named in the link once the result exists (filter f).
  const filterAngewandt = useRef(false);
  useEffect(() => {
    if (!ergebnis || filterAngewandt.current || !teilZustand?.filter?.length) return;
    filterAngewandt.current = true;
    setOffeneGruppen((prev) => new Set([...prev, ...teilZustand.filter]));
  }, [ergebnis, teilZustand]);

  useEffect(() => {
    if (!beispielAngefordert || beispielAusgeloest.current) return;
    beispielAusgeloest.current = true; // nur einmal, auch bei Re-Render
    (async () => {
      if (await beispielLaden()) setAutoStart(true);
    })();
    // beispielLaden hängt an Settern, die React stabil hält — kein Neulauf nötig.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beispielAngefordert]);

  // Das Modell steht erst nach dem State-Update bereit, deshalb ein zweiter Schritt.
  useEffect(() => {
    if (!autoStart || !modell || laufStatus !== "idle") return;
    setAutoStart(false);
    pruefungStarten();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, modell, laufStatus]);

  // --- BCF-Export -----------------------------------------------------------------
  /** BCF-Topics aus dem Ergebnis — geteilt von Export und Lieferpaket (kein zweiter Prüflauf). */
  const bcfTopics = () => {
    const topics = [];
    for (const c of ergebnis.clash.clashes) {
      topics.push({
        guid: newTopicGuid(),
        titel: `${KIND_LABELS[c.kind] || c.kind}: ${c.aType || "?"} <-> ${c.bType || "?"}`,
        beschreibung:
          `Bauteile ${c.aId == null ? "—" : (c.aGuid || `#${c.aId}`)} / ${c.bId == null ? "—" : (c.bGuid || `#${c.bId}`)} — ` +
          `Überlappung (AABB-Näherung) ${nf3.format(c.overlapVol)} m³ bei ${fmtCenter(c.center)}. ` +
          "Geometrischer Verdachtsmoment — fachliche Bewertung erforderlich." +
          // 66-07: name the client document the rule comes from (register no. 80).
          (c.regel ? ` Regel ${[c.regel.id, c.regel.name].filter(Boolean).join(" ")}` +
            (grundlageText(c.regel.grundlage) ? ` — Grundlage: ${grundlageText(c.regel.grundlage)}` : "") + "." : ""),
        ifcGuids: [c.aGuid, c.bGuid].filter(Boolean),
      });
    }
    for (const r of ergebnis.ids) {
      if (r.bestanden) continue;
      const guids = r.verletzungen.map((v) => v.globalId).filter(Boolean);
      topics.push({
        guid: newTopicGuid(),
        titel: `IDS verletzt: ${r.spec.name}`,
        beschreibung:
          `${r.verletzungen.length} ${r.verletzungen.length === 1 ? "Verletzung" : "Verletzungen"} ` +
          `bei ${r.anwendbar} anwendbaren Elementen. ` +
          r.verletzungen.slice(0, 10).map((v) =>
            `${v.globalId || v.elementName || "—"}: erwartet ${v.erwartet}, gefunden ${v.gefunden}`
          ).join(" | ") +
          // 66-07: IDS carries description/instructions of the spec — pass them on when present.
          ([r.spec.beschreibung, r.spec.hinweise].filter(Boolean).length
            ? ` — Grundlage: ${[r.spec.beschreibung, r.spec.hinweise].filter(Boolean).join(" / ")}` : "") +
          // 69-08: a rule written in the suite is no client requirement — the
          // recipient must be able to tell the two apart.
          (r.eigen ? " — Eigene Regel aus der Prüf-Suite, nicht aus der IDS-Vorgabe." : ""),
        ifcGuids: guids,
      });
    }
    return topics;
  };

  /** BCF-Bytes fürs Lieferpaket (71-03) — null, wenn es keine Befunde gibt. */
  const baueBcfBytes = () => {
    if (!ergebnis) return null;
    const topics = bcfTopics();
    if (!topics.length) return null;
    return buildBcfZip(topics, { autor: briefkopf.office || "BIT-Atelier", modellName: modell?.fileName || "" });
  };

  const exportBcf = () => {
    if (!ergebnis) return;
    try {
      const topics = bcfTopics();
      if (!topics.length) {
        toast.info("Keine Befunde — es gibt nichts zu exportieren.");
        return;
      }
      const bytes = buildBcfZip(topics, {
        autor: briefkopf.office || "BIT-Atelier",
        modellName: modell?.fileName || "",
      });
      downloadBytes(bytes, `${safeFileName(project?.name || modell?.fileName?.replace(/\.ifc$/i, ""))}_pruefung.bcf`);
      setExportiert(true);
      toast.success(`BCF mit ${topics.length} Topics exportiert`);
    } catch (err) {
      toast.error("BCF-Export fehlgeschlagen: " + (err?.message || String(err)));
    }
  };

  // --- PDF-Export (Briefkopf-Muster der Berichte-Seite, jsPDF via @core/lib/pdf) ---
  const [pdfBusy, setPdfBusy] = useState(false);
  const exportPdf = async () => {
    if (!reportRef.current) return;
    setPdfBusy(true);
    try {
      const r = await exportElementToPdf(
        reportRef.current,
        `${safeFileName(project?.name || modell?.fileName?.replace(/\.ifc$/i, ""))}_pruefbericht.pdf`,
        {
          ablage: {
            projectId: project?.id,
            typ: "Nachweis",
            notiz: `Prüfbericht (Clash/IDS/BCF) zum Modell ${modell?.fileName || "—"}`,
          },
        },
      );
      toast.success(r?.abgelegt ? `Prüfbericht exportiert und abgelegt: ${pfadText(r.pfad)}` : "Prüfbericht exportiert");
    } catch {
      toast.error("PDF-Export fehlgeschlagen");
    }
    setPdfBusy(false);
  };

  // --- Befundliste als Tabelle (66-14, register no. 124): CSV und Excel ----------
  // ONE table model (befundListe.befundTabelle) feeds both files, so they cannot
  // disagree. It takes the FULL finding list in report order (the 60 rows of the print
  // report do not apply) and the element list the finding map uses, so the number in
  // column 1 is `befundNr`. Purely local: a Blob download, no network request.
  const befundZeilen = useMemo(
    () => (ergebnis ? zaehleBefundzeilen(ergebnis.clash.clashes, ergebnis.ids) : 0),
    [ergebnis],
  );
  const exportBefundliste = (/** @type {"csv"|"xlsx"} */ art) => {
    if (!ergebnis) return;
    try {
      const tabelle = befundTabelle({
        clashes: ergebnis.clash.clashes,
        nummern: befundNr,
        ids: ergebnis.ids,
        elemente: kartenElemente,
        parsedElemente: modell?.parsed?.elements,
        modellNamen: { A: modell?.fileName, B: vergleich?.fileName },
        artLabels: KIND_LABELS,
      });
      if (!tabelle.zeilen.length) {
        toast.info(t("Keine Befunde — es gibt nichts zu exportieren."));
        return;
      }
      const name = befundlisteDateiname({ projekt: project?.name, modell: modell?.fileName, datum: new Date(), endung: art });
      if (art === "csv") dateiAnbieten(tabelleAlsCsv(tabelle), name, "text/csv;charset=utf-8");
      else dateiAnbieten(tabellenAlsXlsx([tabelle]), name, XLSX_MIME);
      toast.success(t("Befundliste „{{datei}}“ heruntergeladen (Zeilen: {{n}})")
        .replace("{{datei}}", name).replace("{{n}}", String(tabelle.zeilen.length)));
    } catch (err) {
      toast.error(t("Befundliste fehlgeschlagen: ") + (err?.message || String(err)));
    }
  };

  // --- Befund-Paket (69-14): EIN Download statt zwei ---------------------------
  // PDF bytes (same renderer as exportPdf via {alsBytes:true}) + BCF bytes
  // (same builder as exportBcf) + generated HTML summary → one ZIP with a
  // SHA-256 manifest. The IFC stays OUT of the package (NDA, plan 69-14).
  const [paketBusy, setPaketBusy] = useState(false);
  // Name of the last downloaded package — the mailto line names it honestly
  // only once it really sits in the download folder.
  const [paketGeladen, setPaketGeladen] = useState(null);

  /** Key figures of the finished run — one truth for mail, HTML and package. */
  const kennzahlenAktuell = useMemo(() => {
    if (!ergebnis) return null;
    return {
      modell: modell?.fileName,
      quelle: modell?.quelle,
      bauteile: modell?.geo?.elemente?.length || 0,
      geschosse: modell?.parsed?.storeys?.length ?? null,
      kollisionen: ergebnis.clash.clashes.filter((c) => c.kind === "hard").length,
      duplikate: ergebnis.clash.clashes.filter((c) => c.kind === "duplicate").length,
      idsFehler: ergebnis.ids.filter((r) => !r.bestanden).length,
    };
  }, [ergebnis, modell]);

  const exportPaket = async () => {
    if (!ergebnis || paketBusy) return;
    setPaketBusy(true);
    try {
      // PDF: same print template as exportPdf, but returned as bytes instead
      // of saved. A failed PDF must not kill the package — the manifest notes
      // its absence (baueBefundPaket) and the HTML carries the same figures.
      let pdfBytes = null;
      try {
        const r = await exportElementToPdf(reportRef.current, "bericht.pdf", { alsBytes: true });
        pdfBytes = r?.bytes || null;
      } catch { /* PDF fehlt → Hinweis im Manifest */ }

      // BCF: same topics as exportBcf (one builder — no second findings path).
      let bcfBytes = null;
      const topics = bcfTopics();
      if (topics.length) {
        bcfBytes = buildBcfZip(topics, {
          autor: briefkopf.office || "BIT-Atelier",
          modellName: modell?.fileName || "",
        });
      }

      const k = kennzahlenAktuell || {};
      const html = befundHtml({
        projekt: project?.name || "—",
        modell: modell?.fileName || "—",
        datum: new Date().toLocaleDateString("de-DE"),
        regelsatz: bapRegeln?.name || (vergleich ? "" : "Standardregeln"),
        kennzahlen: k,
        befunde: { clash: ergebnis.clash.clashes, ids: ergebnis.ids },
      });

      const { zip, name, manifest } = await baueBefundPaket({
        projekt: project?.name || modell?.fileName || "projekt",
        pdf: pdfBytes,
        bcf: bcfBytes,
        html,
        kennzahlen: k,
      });
      downloadBytes(zip, name);
      setPaketGeladen(name);
      // One key per number form: a spliced-in German plural ending produced
      // "(2 notee in the manifest)" in English (SPRACHE-07).
      const ohne = manifest.hinweise.length === 0
        ? ""
        : manifest.hinweise.length === 1
          ? t("(1 Hinweis im Manifest)")
          : t("({n} Hinweise im Manifest)").replace("{n}", String(manifest.hinweise.length));
      toast.success(`${t("Befund-Paket „{{datei}}“ heruntergeladen").replace("{{datei}}", name)}${ohne ? " " + ohne : ""}`);
    } catch (err) {
      toast.error(t("Befund-Paket fehlgeschlagen: ") + (err?.message || String(err)));
    }
    setPaketBusy(false);
  };

  // --- Prüflauf teilen (69-06): the visible run state as one link -------------
  // Serverless, no account: source, rule set, open groups and the selected
  // finding travel in the URL; the MODEL does not (NDA/size) — a q=datei
  // receiver is told so instead of seeing an empty list.
  const standTeilen = async () => {
    const zustand = {
      quelle: modell?.quelle || null,
      regelsatz: bapRegeln ? (bapName || null) : (idsFileName || null),
      filter: Array.from(offeneGruppen),
      sel: selBefund || null,
      // sort stays reserved: the table has no user-chosen order yet (69-06 SUMMARY).
    };
    // Router form follows the build (App.jsx: SERVERLOS → HashRouter, else
    // BrowserRouter): the demo link is origin/#/ModelCheck?…, the express dev
    // link origin/ModelCheck?… — a hash link would not route there.
    const q = serialisierePruefzustand(zustand);
    const link = q === null
      ? null
      : (SERVERLOS
        ? prueflaufLink(window.location.origin + window.location.pathname, zustand)
        : `${window.location.origin}/ModelCheck${q ? `?${q}` : ""}`);
    if (!link) {
      toast.error(t("Prüflauf konnte nicht geteilt werden — unbekannte Modellquelle."));
      return;
    }
    try {
      await navigator.clipboard.writeText(link);
      toast.success(t("Link zum Prüflauf kopiert"));
    } catch {
      // Locked clipboard (older browsers, strict permissions) — the prompt
      // fallback from viewerLink/65-05: show the link, let the user copy.
      window.prompt(t("Link zum Prüflauf (Strg+C zum Kopieren):"), link);
    }
  };

  // --- Aktions-Registrierung (69-12) -----------------------------------------
  // The palette (Strg+K) and the ?-help offer the SAME verbs as the buttons —
  // one registration site, no duplicated handler. The handlers above are plain
  // functions recreated each render, so we call them through a ref: the
  // registry entry stays stable while always reaching the latest closure.
  /** @type {React.MutableRefObject<{pruefungStarten?: () => void, exportBcf?: () => void, exportPdf?: () => void, exportPaket?: () => void, standTeilen?: () => void, exportBefundliste?: (art: "csv"|"xlsx") => void}>} */
  const handlerRef = useRef({});
  handlerRef.current = { pruefungStarten, exportBcf, exportPdf, exportPaket, standTeilen, exportBefundliste };

  // „Prüflauf starten" only makes sense with a loaded model and when no run is
  // in progress (mirrors the button's disabled condition); the exports need a
  // finished result. aktiv=false hides them from the palette (plan Task 1).
  const kannPruefen = !!modell && laufStatus !== "laeuft";
  const kannExportieren = !!ergebnis;
  const aktionenListe = useMemo(
    () => [
      {
        id: "prueflauf",
        titel: t("Prüflauf starten"),
        beschreibung: t("Kollisionen und IDS am geladenen Modell prüfen"),
        kuerzel: "mod+shift+p",
        aktiv: kannPruefen,
        ausfuehren: () => handlerRef.current.pruefungStarten?.(),
      },
      {
        id: "bcf",
        titel: t("BCF exportieren"),
        beschreibung: t("Befunde als BCF 2.1 an die Fachplaner zurückgeben"),
        aktiv: kannExportieren,
        ausfuehren: () => handlerRef.current.exportBcf?.(),
      },
      {
        id: "pdf",
        titel: t("Bericht als PDF"),
        beschreibung: t("Prüfbericht mit Briefkopf als PDF exportieren"),
        aktiv: kannExportieren,
        ausfuehren: () => handlerRef.current.exportPdf?.(),
      },
      // 66-14: the findings as a table (register no. 124) — only with findings to list.
      {
        id: "befundliste-csv",
        titel: t("Befundliste (CSV)"),
        beschreibung: t("Alle Befunde als CSV-Datei für Excel (Semikolon, UTF-8); Nr. = laufende Nummer im Prüfbericht und auf der Befundkarte"),
        aktiv: kannExportieren && befundZeilen > 0,
        ausfuehren: () => handlerRef.current.exportBefundliste?.("csv"),
      },
      {
        id: "befundliste-xlsx",
        titel: t("Befundliste (Excel)"),
        beschreibung: t("Alle Befunde als Excel-Datei mit Filter und fixierter Kopfzeile; Nr. = laufende Nummer im Prüfbericht und auf der Befundkarte"),
        aktiv: kannExportieren && befundZeilen > 0,
        ausfuehren: () => handlerRef.current.exportBefundliste?.("xlsx"),
      },
      // 69-14: ONE download — PDF + BCF + HTML summary + SHA-256 manifest.
      {
        id: "paket",
        titel: t("Befund-Paket herunterladen"),
        beschreibung: t("PDF + BCF + HTML-Zusammenfassung + Manifest als eine ZIP"),
        aktiv: kannExportieren && !paketBusy,
        ausfuehren: () => handlerRef.current.exportPaket?.(),
      },
      // 69-06: share the visible run state as a link (serverless, no account).
      {
        id: "teilen",
        titel: t("Prüflauf teilen"),
        beschreibung: t("Link auf Quelle, Regelsatz, Filter und den gewählten Befund kopieren"),
        aktiv: kannExportieren,
        ausfuehren: () => handlerRef.current.standTeilen?.(),
      },
    ],
    [t, kannPruefen, kannExportieren, paketBusy, befundZeilen],
  );
  useAktionen(location.pathname, aktionenListe);

  // --- Berichtsdaten 71-03: Bauteile je Klasse, Pset-Quote, Modelllage ----------
  const klassen = useMemo(() => (modell ? Object.entries(klassenZaehlung(modell)).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])) : []), [modell]);
  // Anteil der Elemente je Klasse mit einem Projekt-Pset: jeder Pset, der kein
  // buildingSMART-Standardsatz ist (Pset_*, Qto_*, BaseQuantities) — so ohne
  // den Pset-Namen eines bestimmten Bauherrn (Phase-78-Hotfix). Ohne Semantik: leer.
  const psetQuote = useMemo(() => {
    const liste = modell?.parsed?.elements || [];
    const je = new Map();
    for (const el of liste) {
      const k = String(el?.ifcType || "?").toUpperCase();
      const hat = Object.keys(el?.psets || {}).some((n) => !/^(pset_|qto_|basequantities)/i.test(n));
      const z = je.get(k) || { n: 0, mit: 0 };
      z.n += 1;
      if (hat) z.mit += 1;
      je.set(k, z);
    }
    return [...je.entries()].map(([klasse, z]) => ({ klasse, n: z.n, mit: z.mit, quote: z.n ? z.mit / z.n : 0 }))
      .sort((a, b) => b.n - a.n || a.klasse.localeCompare(b.klasse));
  }, [modell]);
  const modelllage = useMemo(() => {
    const liste = modell?.geo?.elemente || [];
    let min = null;
    let max = null;
    for (const el of liste) {
      const b = el?.aabb;
      if (!b) continue;
      if (!min) { min = [...b.min]; max = [...b.max]; continue; }
      for (let i = 0; i < 3; i++) { if (b.min[i] < min[i]) min[i] = b.min[i]; if (b.max[i] > max[i]) max[i] = b.max[i]; }
    }
    return min ? { min, max, zentriert: vergleich == null } : null;
  }, [modell, vergleich]);

  const heute = new Date();
  const prozent = fortschritt.gesamt > 0 ? Math.round((fortschritt.geprueft / fortschritt.gesamt) * 100) : 0;

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
            {/* h1 = menu name (N-02 name table, navigation.js:91); what the suite
                checks moves into the subtitle. */}
            <h1 className="text-3xl font-bold bg-gradient-to-r from-slate-800 via-emerald-700 to-teal-600 bg-clip-text text-transparent">
              {t("Prüf-Suite")}
            </h1>
            <p className="text-slate-600 mt-1">
              {t("Kollisionen, IDS & BCF: IFC-Modell geometrisch (Clash Detection) und semantisch (buildingSMART IDS) prüfen — Befunde als BCF 2.1 an die Fachplaner zurückgeben.")}
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={pruefungStarten}
              disabled={!modell || laufStatus === "laeuft"}
              className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 shadow-lg"
            >
              {laufStatus === "laeuft"
                ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                : <Play className="w-4 h-4 mr-2" />}
              {laufStatus === "laeuft" ? "Prüfung läuft…" : "Prüfung starten"}
            </Button>
          </div>
        </motion.div>

        {/* Ehrlichkeits-Banner (persistent) */}
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-500" />
          <span>
            <b>Hinweis:</b> Alle Ergebnisse sind geometrische bzw. semantische{" "}
            <b>Verdachtsmomente</b> — die fachliche Bewertung durch die BIM-Koordination
            ist erforderlich. Die Prüfung ersetzt keine vertraglich geschuldeten Nachweise.
            Überlappungsvolumina sind AABB-Näherungen.
          </span>
        </div>

        {/* 69-06 must-have 2: a shared link from a FILE-based run cannot carry
            the model itself — say so instead of showing an empty result list. */}
        {modellFehltHinweis && (
          <div
            className="flex items-start gap-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900"
            data-testid="modell-fehlt-hinweis"
          >
            <Info className="w-4 h-4 mt-0.5 shrink-0 text-sky-500" />
            <span>
              {t("Dieser Link zeigt einen Prüflauf mit einem eigenen Modell — das Modell selbst reist aus Datenschutzgründen nicht mit. Bitte die Datei erneut wählen; Quelle, Regelsatz, Filter und der gewählte Befund werden dann wiederhergestellt.")}
            </span>
          </div>
        )}

        {/* Schritt 1: IFC laden */}
        <Card className="border-0 shadow-sm rounded-xl">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-slate-800">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-600 text-xs font-bold text-white">1</span>
              <FileUp className="w-5 h-5 text-emerald-600" />
              IFC-Modell laden
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <input
                ref={ifcInputRef}
                type="file"
                accept=".ifc"
                disabled={busy}
                onChange={handleIfcFile}
                className="hidden"
              />
              {/* Musterprojekt ist die HAUPTAKTION im Leerzustand: ohne eigenes
                  Modell endete der Besuch hier bisher (Befund BEF-01). */}
              {!modell && (
                <Button
                  type="button"
                  size="sm"
                  disabled={busy}
                  onClick={beispielLaden}
                  data-testid="beispiel-laden"
                  className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  <Play className="w-4 h-4" /> Musterprojekt laden
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => ifcInputRef.current?.click()}
                className="gap-1.5"
              >
                <FileUp className="w-4 h-4" /> {modell ? "Anderes IFC wählen" : "Eigenes IFC wählen"}
              </Button>
              {modell?.parsed?.schema && <Badge variant="outline">{modell.parsed.schema}</Badge>}
            </div>

            {!modell && !busy && !fehler && (
              <p className="text-sm text-slate-500">
                Das Musterprojekt ist ein <strong>synthetisches</strong> Beispielmodell
                (12 × 8 m, 9 Bauteile) mit drei absichtlich eingebauten Befunden — eine harte
                Kollision, eine Doppelmodellierung und eine fehlende Brandschutz-Angabe. Es
                enthält keine Projekt- oder Kundendaten. Ihr eigenes Modell verlässt Ihren
                Browser ebenfalls nicht.
              </p>
            )}

            {busy && (
              <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                <span>{statusText || "Verarbeite IFC-Datei…"}</span>
              </div>
            )}

            {fehler && !busy && (
              <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{fehler}</span>
              </div>
            )}

            {modell && !busy && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                <span className="font-semibold flex items-center gap-1.5">
                  <Boxes className="w-4 h-4" /> {modell.fileName}
                </span>
                <span>{nf.format(modell.geo.elemente.length)} Bauteil-Geometrien</span>
                {modell.parsed && (
                  <span className="flex items-center gap-1">
                    <Building2 className="w-3.5 h-3.5" />
                    {nf.format(modell.parsed.storeys.length)} {modell.parsed.storeys.length === 1 ? "Geschoss" : "Geschosse"} ·{" "}
                    {nf.format(modell.parsed.elements.length)} Bauteile mit Eigenschaften
                  </span>
                )}
                {!modell.parsed && (
                  <span className="text-amber-700">
                    Keine semantischen Bauteildaten lesbar — IDS-Prüfung nicht verfügbar.
                  </span>
                )}
                {modell.geo.uebersprungen > 0 && (
                  <span className="text-emerald-700/70">{nf.format(modell.geo.uebersprungen)} ohne Geometrie übersprungen</span>
                )}
              </div>
            )}

            {/* Vergleichsmodell (71-02 Task 3): zweites IFC für die BAP-Matrix
                (Rohbau A ↔ Architektur B). Beide Geometrien werden dafür
                unzentriert gelesen — gemeinsames Koordinatensystem (D-P71-05). */}
            {modell && (
              <div className="space-y-2" data-testid="vergleichsmodell">
                <div className="text-sm font-medium text-slate-700">
                  Vergleichsmodell (optional) — zwei Modelle gegeneinander prüfen
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <input
                    ref={ifc2InputRef}
                    type="file"
                    accept=".ifc"
                    disabled={busy}
                    onChange={handleIfc2File}
                    className="hidden"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => ifc2InputRef.current?.click()}
                    className="gap-1.5"
                    data-testid="vergleich-laden"
                  >
                    <FileUp className="w-4 h-4" /> {vergleich ? "Anderes Vergleichs-IFC wählen" : "Zweites IFC wählen"}
                  </Button>
                  {vergleich && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={vergleichEntfernen}
                      data-testid="vergleich-entfernen"
                    >
                      <XCircle className="w-4 h-4 mr-1" /> Vergleich entfernen
                    </Button>
                  )}
                </div>
                {vergleich && (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
                    <span className="font-semibold flex items-center gap-1.5">
                      <Boxes className="w-4 h-4" /> {vergleich.fileName}
                    </span>
                    <span>{nf.format(vergleich.geo.elemente.length)} Bauteil-Geometrien</span>
                    <span className="text-sky-700/80">
                      Beide Modelle unzentriert im selben Koordinatensystem — A: {modell.fileName} · B: {vergleich.fileName}
                    </span>
                  </div>
                )}
                {vergleich && !bapRegeln && (
                  <p className="text-xs text-amber-700">
                    Zwei Modelle geladen, aber kein BAP-Regelsatz gewählt — es laufen die
                    Standard-Regeln (Toleranz global). Für eine Prüfmatrix des Bauherrn die
                    BAP-Regeldatei (.json) über „IDS- oder BAP-Datei auswählen" laden.
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Schritt 2: Regeln + IDS */}
        <div className="grid lg:grid-cols-2 gap-6">
          <Card className="border-0 shadow-sm rounded-xl">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-slate-800">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-600 text-xs font-bold text-white">2</span>
                <ShieldCheck className="w-5 h-5 text-emerald-600" />
                Kollisionsregeln
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                {STANDARD_REGELN.map((regel, i) => (
                  <label key={regel.name} className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={regelAktiv[i]}
                      onChange={() =>
                        setRegelAktiv((prev) => prev.map((v, k) => (k === i ? !v : v)))
                      }
                      className="h-4 w-4 rounded border-slate-300 accent-emerald-600"
                    />
                    <span className="font-medium">{regel.name}</span>
                    <span className="text-xs text-slate-400">
                      ({regel.a.length}×{regel.b.length} IFC-Typen)
                    </span>
                  </label>
                ))}
                <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer pt-1 border-t border-slate-100">
                  <input
                    type="checkbox"
                    checked={duplikate}
                    onChange={() => setDuplikate((v) => !v)}
                    className="h-4 w-4 rounded border-slate-300 accent-emerald-600"
                  />
                  <span className="font-medium">Duplikate erkennen</span>
                  <span className="text-xs text-slate-400">(nahezu deckungsgleiche Bauteile gleichen Typs)</span>
                </label>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">Toleranz (mm)</label>
                  <Input
                    type="number"
                    min="0"
                    step="0.5"
                    value={toleranzMm}
                    onChange={(e) => setToleranzMm(e.target.value)}
                  />
                  <p className="text-[11px] text-slate-400 mt-1">Bagatellfilter — Berührungen unterhalb sind kein Clash.</p>
                </div>
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">Mindestabstand (mm)</label>
                  <Input
                    type="number"
                    min="0"
                    step="5"
                    value={clearanceMm}
                    onChange={(e) => setClearanceMm(e.target.value)}
                  />
                  <p className="text-[11px] text-slate-400 mt-1">0 = kein Abstands-Check; sonst Befund bei Unterschreitung.</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm rounded-xl">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-slate-800">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-600 text-xs font-bold text-white">2</span>
                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                IDS-Prüfung (optional)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-slate-500">
                buildingSMART-IDS-1.0-Datei (.ids) laden — die Spezifikationen werden gegen
                Klassen, Attribute, Psets, Klassifizierung und Material der Bauteile geprüft.
              </p>
              <input
                ref={idsInputRef}
                type="file"
                accept=".ids,.xml,.json"
                onChange={handleIdsFile}
                className="hidden"
              />
              {/* Regelsatz-Wähler (71-01): mitgelieferte Sätze aus pruefregeln/index.json
                  + „Eigene Datei…" — nativ <select> statt Radix, damit der headless
                  Test (tmp-verify-71-01.mjs) ohne Portal-Timing auskommt. */}
              {regelsaetze.length > 0 && (
                <div className="flex flex-wrap items-center gap-3">
                  <label htmlFor="regelsatz-wahl" className="text-sm font-medium text-slate-700">
                    Mitgelieferter Regelsatz
                  </label>
                  <select
                    id="regelsatz-wahl"
                    data-testid="regelsatz-wahl"
                    className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700"
                    value={regelsatzWahl}
                    onChange={(e) => regelsatzLaden(e.target.value)}
                  >
                    <option value="">— wählen —</option>
                    {regelsaetze.map((s, i) => (
                      <option key={s.datei} value={String(i)}>{s.titel}</option>
                    ))}
                    <option value="eigene">Eigene Datei…</option>
                  </select>
                </div>
              )}
              {/* Geladener BAP-Clash-Regelsatz (71-02) — Status sichtbar machen. */}
              {bapRegeln && (
                <div className="space-y-1.5 rounded-lg border border-sky-200 bg-sky-50 p-3" data-testid="bap-regelsatz">
                  <div className="text-sm font-medium text-sky-900">
                    {bapName} — {bapRegeln.regeln.length} Clash-Regeln
                    {bapRegeln.koordination ? " + Koordinationskörper-Prüfung" : ""}
                  </div>
                  <p className="text-xs text-sky-800/80">
                    Wirkt im Zwei-Modell-Lauf (A = Hauptmodell, B = Vergleichsmodell).
                    Prüfarten: Schnitt, „nicht größer als", „gefüllt", „deckungsgleich" —
                    die Containment-Arten als AABB-Näherung.
                  </p>
                  {bapFehler && <p className="text-xs text-amber-700">{bapFehler}</p>}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => idsInputRef.current?.click()}
                  className="gap-1.5"
                >
                  <FileUp className="w-4 h-4" /> IDS- oder BAP-Datei auswählen
                </Button>
                {idsSpecs.length === 0 && <span className="text-sm text-slate-400">Keine Datei gewählt</span>}
              </div>

              {idsFehler && (
                <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{idsFehler}</span>
                </div>
              )}

              {idsSpecs.length > 0 && (
                <div className="space-y-1.5 rounded-lg border border-slate-200 p-3">
                  <div className="text-sm font-medium text-slate-700">
                    {idsFileName} — {nf.format(idsSpecs.length)} {idsSpecs.length === 1 ? "Spezifikation" : "Spezifikationen"}
                  </div>
                  <ul className="space-y-1">
                    {idsSpecs.map((s, i) => (
                      <li key={`${s.name}-${i}`} className="flex flex-wrap items-center gap-1.5 text-xs text-slate-600">
                        <Badge variant="secondary" className="font-normal">{s.name}</Badge>
                        <span>{s.applicability.length} Anwendbarkeits- / {s.requirements.length} Anforderungs-Facetten</span>
                        {s.kardinalitaet !== "required" && <Badge variant="outline">{s.kardinalitaet}</Badge>}
                        {s.ifcVersions.length > 0 && <span className="text-slate-400">{s.ifcVersions.join(", ")}</span>}
                      </li>
                    ))}
                  </ul>
                  {modell && !modell.parsed && (
                    <p className="text-xs text-amber-700">
                      Für dieses Modell liegen keine semantischen Daten vor — die IDS-Prüfung wird übersprungen.
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* 69-08: write your own IDS rule in four steps — suggestions come
            from the loaded model, "Erneut prüfen" re-runs the whole check with
            the own specs added (same path as "Prüfung starten", one truth), and
            the .ids download/upload round-trips through the 71-01 writer and
            the phase-64 parser. */}
        <IdsEditor
          projectId={project?.id || null}
          elemente={modell?.parsed?.elements || []}
          onSpecs={setEigeneSpecs}
          onErneutPruefen={pruefungStarten}
          pruefungMoeglich={kannPruefen}
          semantikFehlt={!!modell && !modell.parsed}
        />

        {/* Schritt 3: Fortschritt */}
        {laufStatus === "laeuft" && (
          <Card className="border-0 shadow-sm rounded-xl">
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center justify-between text-sm text-slate-600">
                <span className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
                  Kollisionsprüfung läuft…
                </span>
                <span>
                  {nf.format(fortschritt.geprueft)} / {nf.format(fortschritt.gesamt)} Paare ({prozent} %)
                </span>
              </div>
              <Progress value={prozent} />
            </CardContent>
          </Card>
        )}

        {/* Ergebnis-Dashboard */}
        {ergebnis && kpi && (
          <>
            {/* KPI-Zeile */}
            <div className={`grid grid-cols-2 ${ergebnis.koordination ? "md:grid-cols-6" : "md:grid-cols-5"} gap-3`}>
              {[
                { label: "Kollisionen (hard)", wert: kpi.hard, farbe: kpi.hard > 0 ? "text-rose-600" : "text-emerald-600" },
                { label: "Abstands-Befunde", wert: kpi.clearance, farbe: kpi.clearance > 0 ? "text-amber-600" : "text-emerald-600" },
                { label: "Duplikate", wert: kpi.duplicate, farbe: kpi.duplicate > 0 ? "text-violet-600" : "text-emerald-600" },
                ...(ergebnis.koordination ? [{
                  // BAP KOORD-01 (0 mm): der Lagebeweis über den Koordinationskörper.
                  label: ergebnis.koordination.bestanden === null ? "Lage: offen"
                    : `Lage: ${nf.format(Math.round(ergebnis.koordination.maxMm))} mm`,
                  wert: null,
                  text: ergebnis.koordination.bestanden === null ? "?"
                    : (ergebnis.koordination.bestanden ? "0 mm ✓" : `${nf.format(Math.round(ergebnis.koordination.maxMm))} mm`),
                  farbe: ergebnis.koordination.bestanden === null ? "text-amber-600"
                    : ergebnis.koordination.bestanden ? "text-emerald-600" : "text-rose-600",
                }] : []),
                { label: "IDS bestanden", wert: kpi.idsBestanden, farbe: "text-emerald-600" },
                { label: "IDS verletzt", wert: kpi.idsVerletzt, farbe: kpi.idsVerletzt > 0 ? "text-rose-600" : "text-emerald-600" },
              ].map((k) => (
                <Card key={k.label} className="border-0 shadow-sm rounded-xl">
                  <CardContent className="p-4 text-center">
                    <div className={`text-2xl font-bold ${k.farbe}`} data-testid={`kpi-${k.label}`}>
                      {k.text ?? nf.format(k.wert)}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">{k.label}</div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* BAP-Zusammenfassung (71-02): Prüfarten der Matrix als eigene Zeile. */}
            {ergebnis.bapAktiv && (
              <div className="flex flex-wrap items-center gap-2 text-xs" data-testid="bap-zusammenfassung">
                <Badge variant="outline">{bapName || "BAP-Regelsatz"}</Badge>
                {[
                  ["nicht größer als (Näherung)", kpi.enthalten],
                  ["gefüllt (Näherung)", kpi.gefuellt],
                  ["deckungsgleich (Näherung)", kpi.deckung],
                  ["ohne Gegenstück", kpi.ohnePartner],
                ].map(([label, n]) => (
                  <Badge key={label} variant="secondary" className="font-normal">
                    {nf.format(n)} {label}
                  </Badge>
                ))}
                <span className="text-slate-400">
                  Enthaltensein/Füllung als AABB-Näherung (BAP-Matrix S. 23-24)
                </span>
              </div>
            )}
            {ergebnis.koordination && ergebnis.koordination.grund && (
              <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700" data-testid="koordination-befund">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>
                  Koordinationskörper: {ergebnis.koordination.grund}
                  {ergebnis.koordination.nameA ? ` (A: ${ergebnis.koordination.nameA} / B: ${ergebnis.koordination.nameB})` : ""}
                </span>
              </div>
            )}

            {/* Export-Buttons */}
            <div className="flex flex-wrap items-center gap-2">
              {/* 69-06: share the visible run state — link instead of words.
                  Native button: the shadcn Button costs one TS2322 under
                  checkJs (night-run rule), and the outline look is two classes. */}
              <button
                type="button"
                onClick={standTeilen}
                data-testid="stand-teilen"
                className="inline-flex items-center rounded-md border border-sky-300 bg-white px-4 py-2 text-sm font-medium text-sky-800 hover:bg-sky-50"
              >
                <Share2 className="w-4 h-4 mr-2" />
                {t("Prüflauf teilen")}
              </button>
              <Button onClick={exportBcf} variant="outline" className="border-emerald-300">
                <Download className="w-4 h-4 mr-2" />
                Als BCF exportieren
              </Button>
              <Button onClick={exportPdf} disabled={pdfBusy} variant="outline">
                {pdfBusy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FileDown className="w-4 h-4 mr-2" />}
                Prüfbericht (PDF)
              </Button>
              {/* 66-14 (register no. 124): the findings as a table for the project
                  controller — CSV (";" + BOM, opens correctly in a German Excel) and
                  .xlsx, both from ONE table model. Native buttons like "Prüflauf
                  teilen" above (the shadcn Button costs a TS2322 under checkJs). */}
              <button
                type="button"
                onClick={() => exportBefundliste("csv")}
                disabled={befundZeilen === 0}
                title={befundZeilen === 0
                  ? t("Keine Befunde — es gibt nichts zu exportieren.")
                  : t("Alle Befunde als CSV-Datei für Excel (Semikolon, UTF-8); Nr. = laufende Nummer im Prüfbericht und auf der Befundkarte")}
                data-testid="befundliste-csv"
                className="inline-flex items-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <FileSpreadsheet className="w-4 h-4 mr-2" />
                {t("Befundliste (CSV)")}
              </button>
              <button
                type="button"
                onClick={() => exportBefundliste("xlsx")}
                disabled={befundZeilen === 0}
                title={befundZeilen === 0
                  ? t("Keine Befunde — es gibt nichts zu exportieren.")
                  : t("Alle Befunde als Excel-Datei mit Filter und fixierter Kopfzeile; Nr. = laufende Nummer im Prüfbericht und auf der Befundkarte")}
                data-testid="befundliste-xlsx"
                className="inline-flex items-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <FileSpreadsheet className="w-4 h-4 mr-2" />
                {t("Befundliste (Excel)")}
              </button>
              {befundZeilen === 0 && (
                <span className="text-xs text-slate-500" data-testid="befundliste-leer">
                  {t("Keine Befunde — es gibt nichts zu exportieren.")}
                </span>
              )}
              {/* 83-02: from a finding to a conversation (BEF-05), in every build:
                  "Befund besprechen" opens the one feedback dialog of the layout,
                  pre-filled with the key figures of this run. The user reads and
                  edits the text there and sends it by mail or on GitHub. 69-14:
                  the text names the package file only once it was really
                  downloaded (paketGeladen). */}
              {befundZeilen > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  className="border-emerald-300 text-emerald-800"
                  data-testid="befund-besprechen"
                  onClick={() => oeffneFeedback({
                    text: befundText({ ...(kennzahlenAktuell || {}), paketName: paketGeladen || "" }, t),
                  })}
                >
                  <Info className="w-4 h-4 mr-2" />
                  {t("Befund besprechen")}
                </Button>
              )}
              {exportiert && (
                <span className="text-xs text-emerald-700 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> BCF heruntergeladen
                </span>
              )}
              <span className="text-xs text-slate-400 ml-auto">
                {nf.format(ergebnis.clash.geprueft)} Paare geprüft
                {ergebnis.clash.uebersprungen > 0 && ` · ${nf.format(ergebnis.clash.uebersprungen)} über Limit übersprungen`}
                {ergebnis.clash.ohneGeometrie > 0 && ` · ${nf.format(ergebnis.clash.ohneGeometrie)} ohne Geometrie`}
              </span>
            </div>

            {/* Befund-Paket (69-14): EIN Download mit Prüfbericht (PDF),
                Befunden (BCF), HTML-Zusammenfassung (öffnet ohne Software)
                und Manifest mit SHA-256 — benannt nach Projekt und Datum.
                Das IFC selbst bleibt draußen (fremdes Modell, NDA). */}
            <div
              className="flex flex-wrap items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-3"
              data-testid="befund-paket-karte"
            >
              <Package className="w-5 h-5 text-emerald-700 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-emerald-900">{t("Befund-Paket")}</p>
                <p className="text-xs text-emerald-700">
                  {t("Prüfbericht (PDF) + Befunde (BCF) + HTML-Zusammenfassung + Manifest (SHA-256) als eine ZIP-Datei — das Modell selbst bleibt aus Datenschutzgründen draußen.")}
                </p>
                {paketGeladen && (
                  <p className="mt-1 text-xs text-emerald-800 flex items-center gap-1" data-testid="paket-geladen">
                    <CheckCircle2 className="w-3.5 h-3.5" /> {t("„{{datei}}“ liegt in Ihrem Download-Ordner.").replace("{{datei}}", paketGeladen)}
                  </p>
                )}
              </div>
              {/* Native button instead of the shadcn Button — that element
                  costs one TS2322 under checkJs (night-run rule: no new
                  shadcn element when a native one does the same job). */}
              <button
                type="button"
                onClick={exportPaket}
                disabled={paketBusy}
                data-testid="paket-download"
                className="inline-flex items-center rounded-md px-4 py-2 text-sm font-medium text-white shadow bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 disabled:opacity-50"
              >
                {paketBusy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Package className="w-4 h-4 mr-2" />}
                {t("Paket herunterladen")}
              </button>
            </div>

            {/* Clash-Tabelle (gruppiert nach Paar-Typ) */}
            <Card className="border-0 shadow-sm rounded-xl">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-slate-800">
                  <AlertTriangle className="w-5 h-5 text-rose-500" />
                  Kollisions-Befunde ({nf.format(ergebnis.clash.clashes.length)})
                </CardTitle>
              </CardHeader>
              <CardContent>
                {clashGruppen.length === 0 ? (
                  <p className="text-sm text-slate-500 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    Keine Kollisionen, Abstands-Befunde oder Duplikate gefunden.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {clashGruppen.map((g) => {
                      const offen = offeneGruppen.has(g.key);
                      return (
                        <div key={g.key} className="rounded-lg border border-slate-200">
                          <button
                            type="button"
                            onClick={() => gruppeToggle(g.key)}
                            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50 rounded-lg"
                          >
                            {offen ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
                            <span className="font-medium text-slate-800">{g.key}</span>
                            <Badge variant="secondary" className="font-normal">{nf.format(g.clashes.length)}</Badge>
                            <span className="ml-auto text-xs text-slate-400">
                              max. Überlappung {nf3.format(g.clashes[0]?.overlapVol || 0)} m³
                            </span>
                          </button>
                          {offen && (
                            <div className="overflow-x-auto border-t border-slate-100">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="text-left text-slate-400">
                                    <th className="px-3 py-1.5 text-right">Nr.</th>
                                    <th className="px-3 py-1.5">Prüfart</th>
                                    <th className="px-3 py-1.5">GlobalId A</th>
                                    <th className="px-3 py-1.5">GlobalId B</th>
                                    {/* 71-02: Regel + Abweichung mm bei den BAP-Prüfarten;
                                        Überlappung nur bei den Schnitt-Arten sinnvoll. */}
                                    {ergebnis.bapAktiv && <th className="px-3 py-1.5">Regel</th>}
                                    {ergebnis.bapAktiv && <th className="px-3 py-1.5 text-right">Abw. mm (Toleranz)</th>}
                                    <th className="px-3 py-1.5 text-right">Überlappung (AABB) m³</th>
                                    <th className="px-3 py-1.5">Mittelpunkt (x/y/z)</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {g.clashes.map((c, i) => {
                                    // 69-06: a row click selects the finding by
                                    // GlobalId — the anchor that travels in the
                                    // share link (expressIds are export-unstable).
                                    const guid = c.aGuid || c.bGuid || "";
                                    const gewaehlt = !!guid && guid === selBefund;
                                    return (
                                    <tr
                                      key={`${c.aId}-${c.bId}-${i}`}
                                      onClick={() => guid && setSelBefund(gewaehlt ? null : guid)}
                                      data-testid={guid ? `befund-zeile-${guid}` : undefined}
                                      data-gewaehlt={gewaehlt ? "1" : undefined}
                                      className={`border-t border-slate-100 ${guid ? "cursor-pointer hover:bg-sky-50/60" : ""} ${gewaehlt ? "bg-sky-50 outline outline-1 outline-sky-300" : ""}`}
                                    >
                                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-500" data-befund-nr>{befundNr.get(c)}</td>
                                      <td className="px-3 py-1.5">
                                        <Badge className={`font-normal border ${KIND_BADGE[c.kind] || ""}`}>
                                          {KIND_LABELS[c.kind] || c.kind}
                                        </Badge>
                                      </td>
                                      <td className="px-3 py-1.5 font-mono text-[11px]">{c.aGuid || `#${c.aId}`}</td>
                                      <td className="px-3 py-1.5 font-mono text-[11px]">
                                        {c.bId == null ? "—" : (c.bGuid || `#${c.bId}`)}
                                      </td>
                                      {ergebnis.bapAktiv && (
                                        <td className="px-3 py-1.5 text-slate-500"
                                          title={c.regel ? grundlageText(c.regel.grundlage) || undefined : undefined}>
                                          {c.regel ? `${c.regel.id} ${c.regel.name}` : "—"}
                                          {/* 66-07: where the rule comes from (document + page), full text in title */}
                                          {c.regel && grundlageText(c.regel.grundlage, { mitText: false }) && (
                                            <div className="text-[10px] text-slate-400" data-grundlage>
                                              {grundlageText(c.regel.grundlage, { mitText: false })}
                                            </div>
                                          )}
                                        </td>
                                      )}
                                      {ergebnis.bapAktiv && (
                                        <td className="px-3 py-1.5 text-right">
                                          {c.abweichungMm == null ? "—"
                                            : `${nf.format(Math.round(c.abweichungMm * 10) / 10)} (${nf.format(c.toleranzMm)})`}
                                        </td>
                                      )}
                                      <td className="px-3 py-1.5 text-right">{nf3.format(c.overlapVol)}</td>
                                      <td className="px-3 py-1.5 text-slate-500">{fmtCenter(c.center)}</td>
                                    </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* 66-08 (register no. 85): floor plan per storey with numbered markers */}
            {ergebnis.clash.clashes.length > 0 && (
              <Befundkarte
                befunde={ergebnis.clash.clashes}
                elemente={kartenElemente}
                modellName={modell?.fileName || ""}
                projektName={project?.name || ""}
                idsOhneLage={ergebnis.ids.filter((r) => !r.bestanden).length}
              />
            )}

            {/* IDS-Tabelle */}
            {ergebnis.ids.length > 0 && (
              <Card className="border-0 shadow-sm rounded-xl">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-slate-800">
                    <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                    IDS-Ergebnis ({nf.format(ergebnis.ids.length)} Spezifikationen)
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {ergebnis.ids.map((r, i) => (
                    <div
                      key={`${r.spec.name}-${i}`}
                      className="rounded-lg border border-slate-200 p-3"
                      data-testid={r.eigen ? "ids-ergebnis-eigen" : "ids-ergebnis"}
                      data-spec-name={r.spec.name}
                    >
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        {r.bestanden
                          ? <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                          : <XCircle className="w-4 h-4 text-rose-600 shrink-0" />}
                        <span className="font-medium text-slate-800">{r.spec.name}</span>
                        {/* 69-08: rules written in the IDS editor are marked */}
                        {r.eigen && (
                          <Badge variant="secondary" className="font-normal bg-violet-100 text-violet-700 border-violet-200" data-testid="ids-eigen-marke">
                            {t("eigene Regel")}
                          </Badge>
                        )}
                        <Badge variant="outline" className="font-normal">
                          {nf.format(r.anwendbar)} anwendbar
                        </Badge>
                        <Badge
                          className={`font-normal border ${r.bestanden
                            ? "bg-emerald-100 text-emerald-700 border-emerald-200"
                            : "bg-rose-100 text-rose-700 border-rose-200"}`}
                        >
                          {r.bestanden ? "bestanden" : `${nf.format(r.verletzungen.length)} ${r.verletzungen.length === 1 ? "Verletzung" : "Verletzungen"}`}
                        </Badge>
                      </div>
                      {r.verletzungen.length > 0 && (
                        <div className="overflow-x-auto mt-2">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-left text-slate-400">
                                <th className="py-1 pr-3">Bauteil</th>
                                <th className="py-1 pr-3">Facette</th>
                                <th className="py-1 pr-3">Erwartet</th>
                                <th className="py-1">Gefunden</th>
                              </tr>
                            </thead>
                            <tbody>
                              {r.verletzungen.map((v, k) => (
                                <tr key={k} className="border-t border-slate-100 align-top" data-globalid={v.globalId || ""}>
                                  <td className="py-1 pr-3 font-mono text-[11px]">
                                    {v.globalId || "—"}
                                    {v.elementName && <div className="font-sans text-slate-500">{v.elementName}</div>}
                                  </td>
                                  <td className="py-1 pr-3">{v.facette}</td>
                                  <td className="py-1 pr-3 text-slate-600">{v.erwartet}</td>
                                  <td className="py-1 text-slate-600">{v.gefunden}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </>
        )}

        {/* Hinweis-Karte */}
        {!ergebnis && laufStatus !== "laeuft" && (
          <Card className="bg-slate-50 border-dashed rounded-xl shadow-sm">
            <CardContent className="p-3 text-xs text-slate-500 flex gap-2">
              <Info className="w-4 h-4 shrink-0 mt-0.5" />
              IFC laden · Regeln wählen · optional IDS-Datei ergänzen · „Prüfung starten".
              Die Kollisionsprüfung läuft vollständig lokal im Browser (AABB-Broadphase +
              Dreiecks-Narrowphase).
            </CardContent>
          </Card>
        )}
      </div>

      {/* Druckvorlage Prüfbericht — off-screen gerendert, via html2canvas/jsPDF exportiert
          (Briefkopf-Muster der Berichte-Seite / ReportDocument). */}
      {ergebnis && kpi && (
        <div style={{ position: "fixed", left: -10000, top: 0 }} aria-hidden="true">
          <div ref={reportRef} className="bg-white" style={{ width: 794, padding: 48, color: "#0f172a" }}>
            {/* Briefkopf */}
            <div className="flex items-center justify-between border-b-2 border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-lg flex items-center justify-center">
                  <ShieldCheck className="w-5 h-5 text-white" />
                </div>
                <div>
                  <div className="font-bold text-slate-800 leading-tight max-w-[360px]">{briefkopf.office}</div>
                  <div className="text-[10px] text-slate-400">{briefkopf.tagline}</div>
                  {(briefkopf.address || briefkopf.contact) && (
                    <div className="text-[10px] text-slate-500">
                      {[briefkopf.address, briefkopf.contact].filter(Boolean).join(" · ")}
                    </div>
                  )}
                </div>
              </div>
              <div className="text-right text-[11px] text-slate-500">
                <div className="font-semibold text-slate-700 text-[13px]">Prüfbericht — Kollisions- & IDS-Prüfung</div>
                <div>Erstellt: {heute.toLocaleDateString("de-DE")}</div>
              </div>
            </div>

            {/* Deckblatt-Daten */}
            <div className="mt-6">
              <h1 className="text-2xl font-bold text-slate-900">{project?.name || "Modellprüfung"}</h1>
              <p className="text-slate-500">
                {[project?.client, modell?.fileName].filter(Boolean).join(" · ")}
              </p>
            </div>

            {/* Zusammenfassung */}
            <div className="mt-6">
              <h2 className="text-[15px] font-bold text-slate-800 border-b-2 border-emerald-500 pb-1 mb-3">Zusammenfassung</h2>
              <div className="grid grid-cols-5 gap-3">
                {[
                  ["Kollisionen (hard)", kpi.hard],
                  ["Abstands-Befunde", kpi.clearance],
                  ["Duplikate", kpi.duplicate],
                  ["IDS bestanden", kpi.idsBestanden],
                  ["IDS verletzt", kpi.idsVerletzt],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-lg bg-slate-50 p-3 text-center">
                    <div className="text-lg font-bold text-slate-800">{nf.format(v)}</div>
                    <div className="text-[10px] text-slate-500">{k}</div>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-slate-500 mt-2">
                {nf.format(ergebnis.clash.geprueft)} Bauteil-Paare geprüft ·{" "}
                {nf.format(modell?.geo?.elemente?.length || 0)} Bauteil-Geometrien ·{" "}
                Toleranz {nf2.format(Number(toleranzMm) || 0)} mm
                {Number(clearanceMm) > 0 && ` · Mindestabstand ${nf2.format(Number(clearanceMm))} mm`}
              </p>
            </div>

            {/* Lieferung (71-03) */}
            {lieferInfo && (lieferInfo.lieferung || lieferInfo.dateiname) && (
              <div className="mt-6" data-testid="bericht-lieferung">
                <h2 className="text-[15px] font-bold text-slate-800 border-b-2 border-emerald-500 pb-1 mb-3">Lieferung</h2>
                <table className="w-full text-[11px]">
                  <tbody>
                    {[
                      ["Lieferung Nr.", lieferInfo.lieferung ? lieferInfo.lieferung.nr : "—"],
                      ["Termin Soll / Ist", lieferInfo.lieferung
                        ? `${datumText(lieferInfo.lieferung.termin)} / ${lieferInfo.lieferung.datum_ist ? datumText(lieferInfo.lieferung.datum_ist) : heute.toLocaleDateString("de-DE")}`
                        : "—"],
                      ["LoG", lieferInfo.lieferung ? lieferInfo.lieferung.log : "—"],
                      ["Bauabschnitt", lieferInfo.lieferung?.bauabschnitt || "—"],
                      ["Fachsicht", lieferInfo.fachsicht],
                      ["Dateiname (Namenskonvention)", lieferInfo.dateiname || "—"],
                      ["Ausgangsdatei", modell?.fileName || "—"],
                      ["Herkunft", lieferInfo.herkunft],
                    ].map(([k, v]) => (
                      <tr key={k} className="border-b border-slate-100">
                        <td className="py-1 pr-3 text-slate-500 w-44">{k}</td>
                        <td className="py-1 font-medium">{v}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {lieferInfo.warnungen?.length > 0 && (
                  <ul className="mt-2 text-[10px] text-amber-800">
                    {lieferInfo.warnungen.map((w) => <li key={w}>⚠ {w}</li>)}
                  </ul>
                )}
              </div>
            )}

            {/* Modelllage (71-03) */}
            {modelllage && (
              <div className="mt-6" data-testid="bericht-modelllage">
                <h2 className="text-[15px] font-bold text-slate-800 border-b-2 border-emerald-500 pb-1 mb-3">Modelllage</h2>
                <p className="text-[11px] text-slate-700">
                  Ausdehnung (Welt, {modelllage.zentriert ? "auf den Ursprung zentriert" : "unzentriert — Projektkoordinaten"}):{" "}
                  min ({nf2.format(modelllage.min[0])} / {nf2.format(modelllage.min[1])} / {nf2.format(modelllage.min[2])}) m ·{" "}
                  max ({nf2.format(modelllage.max[0])} / {nf2.format(modelllage.max[1])} / {nf2.format(modelllage.max[2])}) m
                </p>
                <p className="text-[11px] text-slate-700 mt-1">
                  Koordinationskörper:{" "}
                  {!ergebnis.koordination ? "nicht geprüft (Ein-Modell-Lauf)"
                    : ergebnis.koordination.bestanden === null ? `offen — ${ergebnis.koordination.grund || "Körper fehlt"}`
                      : ergebnis.koordination.bestanden ? `Lage bestätigt (max. ${nf2.format(ergebnis.koordination.maxMm)} mm)`
                        : `Abweichung ${nf.format(Math.round(ergebnis.koordination.maxMm))} mm`}
                  {ergebnis.koordination?.nameA ? ` · A: ${ergebnis.koordination.nameA} / B: ${ergebnis.koordination.nameB || "—"}` : ""}
                </p>
              </div>
            )}

            {/* Bauteile je Klasse + Pset-Quote (71-03) */}
            {klassen.length > 0 && (
              <div className="mt-6" data-testid="bericht-klassen">
                <h2 className="text-[15px] font-bold text-slate-800 border-b-2 border-emerald-500 pb-1 mb-3">
                  Bauteile je Klasse ({nf.format(klassen.reduce((a, [, n]) => a + n, 0))})
                  {psetQuote.length > 0 && " · Quote Projekt-Pset"}
                </h2>
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="text-left text-slate-400 border-b">
                      <th className="py-1 pr-2">Klasse</th>
                      <th className="py-1 pr-2 text-right">Anzahl</th>
                      {psetQuote.length > 0 && <th className="py-1 pr-2 text-right">mit Projekt-Pset</th>}
                      {psetQuote.length > 0 && <th className="py-1 text-right">Quote</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {klassen.slice(0, 40).map(([k, n]) => {
                      const q = psetQuote.find((x) => x.klasse === k);
                      return (
                        <tr key={k} className="border-b border-slate-100">
                          <td className="py-1 pr-2">{k}</td>
                          <td className="py-1 pr-2 text-right">{nf.format(n)}</td>
                          {psetQuote.length > 0 && <td className="py-1 pr-2 text-right">{q ? nf.format(q.mit) : "—"}</td>}
                          {psetQuote.length > 0 && <td className="py-1 text-right">{q ? `${Math.round(q.quote * 100)} %` : "—"}</td>}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {klassen.length > 40 && <p className="text-[10px] text-slate-400 mt-1">… {klassen.length - 40} weitere Klassen.</p>}
                {psetQuote.length === 0 && <p className="text-[10px] text-slate-400 mt-1">Pset-Quote: keine semantischen Daten im Modell.</p>}
              </div>
            )}

            {/* Clash-Tabelle */}
            <div className="mt-6">
              <h2 className="text-[15px] font-bold text-slate-800 border-b-2 border-emerald-500 pb-1 mb-3">
                Kollisions-Befunde ({nf.format(ergebnis.clash.clashes.length)})
              </h2>
              {ergebnis.clash.clashes.length === 0 ? (
                <p className="text-[12px] text-slate-400">Keine Befunde.</p>
              ) : (
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="text-left text-slate-400 border-b">
                      <th className="py-1 pr-2 text-right">Nr.</th>
                      <th className="py-1 pr-2">Prüfart</th>
                      <th className="py-1 pr-2">Bauteil-Paar</th>
                      <th className="py-1 pr-2">GlobalIds</th>
                      {ergebnis.bapAktiv && <th className="py-1 pr-2">Regel</th>}
                      {ergebnis.bapAktiv && <th className="py-1 pr-2 text-right">Abw. mm</th>}
                      <th className="py-1 text-right">Überlappung (AABB) m³</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ergebnis.clash.clashes.slice(0, 60).map((c, i) => (
                      <tr key={i} className="border-b border-slate-100">
                        <td className="py-1 pr-2 text-right">{i + 1}</td>
                        <td className="py-1 pr-2">{KIND_LABELS[c.kind] || c.kind}</td>
                        <td className="py-1 pr-2">{c.aType} × {c.bType || "—"}</td>
                        <td className="py-1 pr-2 font-mono text-[9px]">
                          {c.aId == null ? "—" : (c.aGuid || `#${c.aId}`)} / {c.bId == null ? "—" : (c.bGuid || `#${c.bId}`)}
                        </td>
                        {ergebnis.bapAktiv && (
                          <td className="py-1 pr-2 text-[9px]">
                            {c.regel?.id || "—"}
                            {/* 66-07: page of the client document in the printed report */}
                            {c.regel?.grundlage?.stelle && <span className="text-slate-400"> · {c.regel.grundlage.stelle}</span>}
                          </td>
                        )}
                        {ergebnis.bapAktiv && (
                          <td className="py-1 pr-2 text-right">
                            {c.abweichungMm == null ? "—" : nf.format(Math.round(c.abweichungMm * 10) / 10)}
                          </td>
                        )}
                        <td className="py-1 text-right">{nf3.format(c.overlapVol)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {/* T-71-05: die Näherung steht IMMER sichtbar im Bericht. */}
              {ergebnis.bapAktiv && (
                <p className="text-[10px] text-slate-500 mt-1">
                  Fußnote: Enthaltensein („nicht größer als"), Füllung und Deckungsgleichheit sind
                  AABB-Näherungen (umschließende Quader, D-P71-04) — für schräge Bauteile
                  (Rampen, Treppenläufe) unsicher; Überlappungsvolumen ebenfalls AABB.
                  Fachliche Bewertung erforderlich.
                </p>
              )}
              {ergebnis.koordination && (
                <p className="text-[11px] mt-2">
                  <strong>Koordinationskörper:</strong>{" "}
                  {ergebnis.koordination.bestanden === null
                    ? `offen — ${ergebnis.koordination.grund}`
                    : ergebnis.koordination.bestanden
                      ? "Lage gleich (Abweichung ≤ Toleranz, BAP KOORD-01)."
                      : `Lageabweichung ${nf.format(Math.round(ergebnis.koordination.maxMm))} mm `
                        + `(x ${nf.format(ergebnis.koordination.abweichungMm.x)} / `
                        + `y ${nf.format(ergebnis.koordination.abweichungMm.y)} / `
                        + `z ${nf.format(ergebnis.koordination.abweichungMm.z)} mm) — `
                        + "über der 0-mm-Forderung der BAP-Matrix."}
                </p>
              )}
              {ergebnis.clash.clashes.length > 60 && (
                <p className="text-[10px] text-slate-400 mt-1">
                  … Nr. 61–{nf.format(ergebnis.clash.clashes.length)}: {nf.format(ergebnis.clash.clashes.length - 60)} weitere Befunde (mit Nummer in der Befundliste; alle Befunde auch im BCF-Export).
                </p>
              )}
            </div>

            {/* IDS-Tabelle */}
            <div className="mt-6">
              <h2 className="text-[15px] font-bold text-slate-800 border-b-2 border-emerald-500 pb-1 mb-3">
                IDS-Konformität ({nf.format(ergebnis.ids.length)} Spezifikationen)
              </h2>
              {ergebnis.ids.length === 0 ? (
                <p className="text-[12px] text-slate-400">Keine IDS-Datei geprüft.</p>
              ) : (
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="text-left text-slate-400 border-b">
                      <th className="py-1 pr-2">Spezifikation</th>
                      <th className="py-1 pr-2 text-right">Anwendbar</th>
                      <th className="py-1 pr-2 text-right">Verletzungen</th>
                      <th className="py-1">Ergebnis</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ergebnis.ids.map((r, i) => (
                      <tr key={i} className="border-b border-slate-100">
                        {/* 69-08: the report says which rules were written in the
                            suite and did not come from the client's IDS file. */}
                        <td className="py-1 pr-2">{r.spec.name}{r.eigen ? ` (${t("eigene Regel")})` : ""}</td>
                        <td className="py-1 pr-2 text-right">{nf.format(r.anwendbar)}</td>
                        <td className="py-1 pr-2 text-right">{nf.format(r.verletzungen.length)}</td>
                        <td className="py-1">{r.bestanden ? "bestanden" : "verletzt"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Haftungshinweis */}
            <div className="mt-8 rounded-lg border border-amber-300 bg-amber-50 p-3 text-[11px] text-amber-900">
              <b>Haftungshinweis:</b> Dieser Bericht dokumentiert automatisiert ermittelte
              geometrische und semantische Verdachtsmomente (AABB-/Dreiecks-Verfahren,
              buildingSMART IDS 1.0). Er ersetzt weder die fachliche Bewertung durch die
              BIM-Koordination noch vertraglich geschuldete Nachweise. Überlappungsvolumina
              sind AABB-Näherungen und können die tatsächliche Durchdringung überschätzen.
            </div>

            {/* Fußzeile */}
            <div className="mt-8 pt-3 border-t border-slate-200 flex justify-between text-[10px] text-slate-400">
              <span>{briefkopf.office} · Prüfbericht</span>
              <span>{[project?.name, modell?.fileName].filter(Boolean).join(" · ")} · {heute.toLocaleDateString("de-DE")}</span>
            </div>
          </div>
        </div>
      )}

      {/* Issues (BCF) — 71-04 Task 3: Rückkanal für Solibri/Catenda-Issues.
          Immer sichtbar (auch ohne Prüflauf): der Generalplaner liefert
          Issues unabhängig davon, ob hier selbst geprüft wurde. Persistenz
          im exklusiven BimModel-Feld befunde_layer (Phase 66 übernimmt). */}
      {/* Lieferung (71-03): Modelllieferplan + Richtlinien-Name + Lieferpaket.
          Baut aus dem VORHANDENEN Ergebnis (kein zweiter Prüflauf); Persistenz
          lieferung_layer. */}
      {modell && (
        <LieferpaketKarte
          projectId={project?.id}
          projekt={project}
          modell={modell}
          ergebnis={ergebnis}
          reportRef={reportRef}
          briefkopf={briefkopf}
          baueBcf={baueBcfBytes}
          onLieferInfo={lieferInfoSetzen}
        />
      )}
      <BcfIssues projectId={project?.id} autor={briefkopf.office || "BIT-Atelier"} />
    </div>
  );
}
