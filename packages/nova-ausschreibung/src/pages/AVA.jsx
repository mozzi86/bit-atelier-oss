import { seitenWurzel } from "@core/lib/utils";
import React, { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { bitApi } from "@core/api/bitApi";
import { motion } from "framer-motion";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@core/components/ui/tabs";
import { useProject } from "@core/lib/ProjectContext";
import { toast } from "sonner";
import {
  ListTree, Boxes, ScrollText, Gavel, Ruler, BarChart3, FileSpreadsheet,
  SlidersHorizontal, Calculator,
} from "lucide-react";
import LVTable from "@ava/components/LVTable";
import QuantityTakeoff from "@ava/components/QuantityTakeoff";
import TenderPanel from "@ava/components/TenderPanel";
import PriceComparison from "@ava/components/PriceComparison";
import PriceReferencePanel from "@ava/components/PriceReferencePanel";
import SettlementPanel from "@ava/components/SettlementPanel";
import CostControl from "@ava/components/CostControl";
import KostenberechnungTabelle from "@ava/components/KostenberechnungTabelle";
import PreisSchichtPanel from "@ava/components/PreisSchichtPanel";
import DeckungsReport from "@ava/components/DeckungsReport";
import IfcImportPanel from "@ifc/components/IfcImportPanel";
import ImportWizard from "@ava/components/ImportWizard";
// Phase 33 / W6 (Plan 33-04) — Pflege: Regeln, Muster, Kataloge, Parität.
import RegelTabelle from "@ava/components/RegelTabelle";
import RegelEditor from "@ava/components/RegelEditor";
import MusterBibliothek from "@ava/components/MusterBibliothek";
import MehrfachnutzungsReport from "@ava/components/MehrfachnutzungsReport";
import ParitaetsBadge from "@ava/components/ParitaetsBadge";
import KatalogEditor from "@core/components/catalogs/KatalogEditor";
// Phase 33 / W7 (Plan 33-04) — Preisquellen: Büro-Preisspiegel und Ernte.
import ReferenzpreisPoolPanel from "@ava/components/ReferenzpreisPoolPanel";
import { ordneAlleZu } from "@ava/lib/stlbMatch";
import { neueSchicht } from "@ava/lib/preisschichten";
import { laufErzeugen } from "@ava/lib/regelLauf";
import { regelAusMuster } from "@ava/lib/mengenregeln";
import { pruefeReferenzenOderWirf } from "@core/lib/rules/catalogs";
import { classifiedElements } from "@core/lib/bimClassification";
import { filterQuantity } from "@ava/lib/avaFilters";
import { positionMode } from "@ava/components/avaUtils";
import { buildTedQuery, parseTedResponse, parseDoeeCsv, aggregateLots } from "@ava/lib/priceReference";
import { aktiveSchicht, rangfolge } from "@core/lib/rules/priceStack";
import { nachtraegeDesProjekts } from "@core/lib/nachtraege";
import { useTabParam } from "@core/lib/useTabParam";
import { useI18n } from "@core/lib/i18n";

// The eight AVA tabs, addressable as #/AVA?tab=<key> (72-15, N-16). The keys are
// the TabsTrigger values below and a contract: links from Finance (?tab=control,
// ?tab=settlement), change order toasts and "Weiter mit …" (lane A, N-03, which
// checks the literals in this file) point at them. Never rename a key.
const AVA_REITER = ["lv", "mengenregeln", "takeoff", "kostenberechnung", "tender", "prices", "settlement", "control"];
// German names as aliases, so a hand-written link such as ?tab=kostenkontrolle
// works too; the URL is normalised to the key.
const AVA_REITER_ALIAS = {
  leistungsverzeichnis: "lv",
  "bim-mengen": "takeoff",
  mengen: "takeoff",
  ausschreibung: "tender",
  preisspiegel: "prices",
  abrechnung: "settlement",
  kostenkontrolle: "control",
};

// AVA — Ausschreibung · Vergabe · Abrechnung (NOVA-AVA-style, BIM-gekoppelt).
export default function AVA() {
  const { t } = useI18n();
  const { projectId, project } = useProject();
  const [building, setBuilding] = useState(null);
  const [bimModel, setBimModel] = useState(null);
  const [positions, setPositions] = useState([]);
  const [tenders, setTenders] = useState([]);
  const [bids, setBids] = useState([]);
  const [measurements, setMeasurements] = useState([]);
  const [changeOrders, setChangeOrders] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [filters, setFilters] = useState([]);
  const [priceRefs, setPriceRefs] = useState([]);
  // Phase 33 / W4 — Preisfachlichkeit: Schichten, Verträge, Deckungsfälle.
  const [preisSchichten, setPreisSchichten] = useState([]);
  const [vertraege, setVertraege] = useState([]);
  const [deckungen, setDeckungen] = useState([]);
  // Phase 33 / W6 — Mengenregeln als eigene Entität, Läufe als Historie.
  const [mengenRegeln, setMengenRegeln] = useState([]);
  const [regelLaeufe, setRegelLaeufe] = useState([]);
  const [paritaetsLaeufe, setParitaetsLaeufe] = useState([]);
  const [snapshots, setSnapshots] = useState([]);
  // Büroweite Kataloge in EINEM Request (GET /api/catalogs). Das dreistellige DIN 276
  // kommt daraus — nicht aus einer Konstante im Code, sonst ist es nicht pflegbar.
  const [kataloge, setKataloge] = useState({});
  const [selectedTenderId, setSelectedTenderId] = useState(null);
  // Active tab lives in ?tab= behind the hash: a switch pushes a history entry
  // (Back returns to the previous tab), reload keeps it, ?projekt stays untouched.
  const [tab, setTab] = useTabParam(AVA_REITER, "lv", { alias: AVA_REITER_ALIAS });

  useEffect(() => {
    bitApi.entities.Contact.list("name").then(setContacts);
    fetch("/api/catalogs")
      .then((r) => (r.ok ? r.json() : {}))
      .then(setKataloge)
      .catch(() => setKataloge({}));
  }, []);

  // Race-Schutz (ME-02): Antworten eines Reloads für ein inzwischen gewechseltes
  // Projekt werden verworfen — sonst kann ein langsamer Reload veraltete Listen setzen.
  const projectIdRef = useRef(projectId);
  useEffect(() => { projectIdRef.current = projectId; }, [projectId]);

  const reload = useCallback(async (pid) => {
    if (!pid) return;
    const [pos, td, bd, ms, blds, cos, bims, flt, prefs, schichten, vtr, dck,
      regeln, laeufe, pLaeufe, snaps] = await Promise.all([
      bitApi.entities.LVPosition.filter({ project_id: pid }),
      bitApi.entities.Tender.filter({ project_id: pid }),
      bitApi.entities.Bid.filter({ project_id: pid }),
      bitApi.entities.Measurement.filter({ project_id: pid }),
      bitApi.entities.Building.filter({ project_id: pid }),
      bitApi.entities.ChangeOrder.list("-submission_date"),
      bitApi.entities.BimModel.filter({ project_id: pid }),
      bitApi.entities.AvaFilter.filter({ project_id: pid }),
      // PriceReference ist GLOBAL (Marktdaten sind projektunabhängig) — kein project_id-Filter.
      bitApi.entities.PriceReference.list(),
      // Schemalose Entitäten (Phase 33). `.catch(() => [])`, weil ein Projekt
      // ohne Preisschichten kein Fehler ist — es ist der Normalfall vor dem Import.
      bitApi.entities.PreisSchicht.filter({ project_id: pid }).catch(() => []),
      bitApi.entities.ProjectContract.filter({ project_id: pid }).catch(() => []),
      bitApi.entities.Deckung.filter({ project_id: pid }).catch(() => []),
      bitApi.entities.MengenRegel.filter({ project_id: pid }).catch(() => []),
      bitApi.entities.RegelLauf.filter({ project_id: pid }).catch(() => []),
      // ParitaetsLauf ist NICHT projektgebunden: die Gates prüfen das Programm,
      // nicht ein Projekt.
      bitApi.entities.ParitaetsLauf.list().catch(() => []),
      bitApi.entities.BimSnapshot.filter({ project_id: pid }).catch(() => []),
    ]);
    if (pid !== projectIdRef.current) return; // veraltete Antwort verwerfen (ME-02)
    setPositions(pos);
    setTenders(td);
    setBids(bd);
    setMeasurements(ms);
    setChangeOrders(cos);
    setBuilding(blds[0] || { floors: 6, area_net: 1800 });
    setBimModel(bims[0] || null);
    setFilters(flt);
    setPriceRefs(prefs);
    setPreisSchichten(schichten || []);
    setVertraege(vtr || []);
    setDeckungen(dck || []);
    setMengenRegeln(regeln || []);
    setRegelLaeufe(laeufe || []);
    setParitaetsLaeufe(pLaeufe || []);
    setSnapshots(snaps || []);
  }, []);

  useEffect(() => { if (projectId) reload(projectId); }, [projectId, reload]);

  // --- LV CRUD --------------------------------------------------------------
  const createPos = async (data) => {
    await bitApi.entities.LVPosition.create({ ...data, project_id: projectId });
    toast.success("Position angelegt");
    reload(projectId);
  };
  const updatePos = async (id, data) => {
    await bitApi.entities.LVPosition.update(id, data);
    toast.success("Position aktualisiert");
    reload(projectId);
  };
  const deletePos = async (id) => {
    await bitApi.entities.LVPosition.delete(id);
    toast("Position gelöscht");
    reload(projectId);
  };
  // GAEB-/CSV-Import: geparste Zeilen als Positionen im aktuellen Projekt anlegen.
  // In-flight-Guard gegen Doppel-Import (HI-03) — die JSON-DB hat keine Unique-Constraints.
  const importingRef = useRef(false);
  const importPositions = async (rows) => {
    if (!rows?.length || importingRef.current) return;
    importingRef.current = true;
    try {
      for (const row of rows) {
        await bitApi.entities.LVPosition.create({ ...row, project_id: projectId });
      }
      toast.success(`${rows.length} Positionen importiert`);
    } catch (err) {
      console.error("LV-Import fehlgeschlagen:", err);
      toast.error("Import fehlgeschlagen — Positionsliste bitte prüfen");
    } finally {
      importingRef.current = false;
      reload(projectId);
    }
  };

  // ENTFERNT (Phase 33 / W3): `generateFromBim` erzeugte 9 Positionen mit HART
  // KODIERTEN Einheitspreisen (28/95/210/120/180/145/850/620/175 €) aus einer
  // Kubatur-Schätzung. Das war die Platzhalter-AVA: erfundene Preise, die im
  // Kostenanschlag genauso aussahen wie belegte. Mengen kommen jetzt aus dem
  // Modell über Filter (Modus `filter`) oder belegt aus dem LV-Altstand
  // (Modus `uebernahme`); Preise kommen als PreisSchicht mit Quellenangabe.
  // Die Demo-Substanz liegt isoliert im Demoprojekt (server/demo-data.js).

  // --- Phase 26: echtes IFC-Modell als alternative Mengenquelle (web-ifc) ----
  const [ifcElements, setIfcElements] = useState(null);

  // --- Phase 25: klassifizierte Bauteile + Filterbibliothek (WAS ∩ ZUSTAND) --
  // Normalisierte Element-Liste (inkl. synthHull-Fallback fürs grobe Demo-Modell);
  // ein importiertes IFC-Modell (Phase 26) hat Vorrang vor dem BIT-BIM-Modell.
  const elements = useMemo(
    () => (ifcElements && ifcElements.length ? ifcElements : classifiedElements(bimModel, building)),
    [ifcElements, bimModel, building],
  );

  // AvaFilter-CRUD (schemalose Entität, project-scoped — Muster wie LVPosition).
  const createFilter = async (data) => {
    await bitApi.entities.AvaFilter.create({ ...data, project_id: projectId });
    toast.success("Filter gespeichert");
    reload(projectId);
  };
  const updateFilter = async (id, data) => {
    await bitApi.entities.AvaFilter.update(id, data);
    toast.success("Filter aktualisiert");
    reload(projectId);
  };
  const deleteFilter = async (id) => {
    // ME-04: hängende filter_refs vermeiden — referenzierende Positionen erkennen,
    // warnen und beim Löschen auf Handeingabe zurückstufen (Menge bleibt erhalten).
    const refs = positions.filter((p) => positionMode(p) === "filter" && p.filter_ref === id);
    if (refs.length > 0) {
      const ok = window.confirm(
        `${refs.length} LV-Position${refs.length === 1 ? "" : "en"} nutzt diesen Filter für die Mengenermittlung. ` +
        "Beim Löschen werden sie auf „Übernahme\" umgestellt: die aktuelle Menge bleibt erhalten " +
        "und wird als eingefroren gekennzeichnet (Grund: Filter gelöscht). Fortfahren?",
      );
      if (!ok) return;
      try {
        for (const p of refs) {
          // NICHT `handeingabe`: niemand hat hier eine Zahl getippt. Die Menge ist die
          // letzte gerechnete, sie ist ab jetzt eingefroren — und genau das wird
          // festgehalten, damit später erkennbar ist, warum sie nicht mehr nachläuft.
          await bitApi.entities.LVPosition.update(p.id, {
            mengen_modus: "uebernahme",
            filter_ref: null,
            ausschluss_grund: "filter_geloescht",
            menge_herkunft: {
              quelle: "Filter gelöscht",
              filter_ref_alt: id,
              eingefroren_am: new Date().toISOString().slice(0, 10),
              menge_bei_einfrieren: p.quantity ?? null,
            },
          });
        }
      } catch (err) {
        console.error("Positionen zurückstufen fehlgeschlagen:", err);
        toast.error("Positionen konnten nicht umgestellt werden — Filter wurde NICHT gelöscht");
        reload(projectId);
        return;
      }
    }
    await bitApi.entities.AvaFilter.delete(id);
    toast("Filter gelöscht");
    reload(projectId);
  };
  // Editor-Callback: mit id → update, sonst create.
  const saveFilter = async (data) => {
    const { id, ...rest } = data || {};
    if (id) await updateFilter(id, rest);
    else await createFilter(rest);
  };

  // Klassifizierungs-Patch (element-id → {kg, gewerk, schicht, status}) per _idx
  // zurück auf die BimModel-Custom-Arrays mappen und additiv persistieren.
  const saveClassification = async (patch) => {
    if (!bimModel) {
      toast.error("Kein gespeichertes Gebäudemodell — im Komplex-Designer zeichnen");
      return;
    }
    const arrays = {
      customWalls: [...(bimModel.customWalls || [])],
      customColumns: [...(bimModel.customColumns || [])],
      customWindows: [...(bimModel.customWindows || [])],
      envOpenings: [...(bimModel.envOpenings || [])],
      customZones: [...(bimModel.customZones || [])],
      customSlabs: [...(bimModel.customSlabs || [])],
      customRoofs: [...(bimModel.customRoofs || [])],
    };
    // ID-Präfix (aus classifiedElements) → Custom-Array; hull-* ist synthetisch.
    const arrayForId = (id) => {
      if (id.startsWith("hull-")) return null;
      if (id.startsWith("wall-")) return "customWalls";
      if (id.startsWith("column-")) return "customColumns";
      if (id.startsWith("env-window-") || id.startsWith("env-door-")) return "envOpenings";
      if (id.startsWith("window-") || id.startsWith("door-")) return "customWindows";
      if (id.startsWith("zone-")) return "customZones";
      if (id.startsWith("slab-")) return "customSlabs";
      if (id.startsWith("roof-")) return "customRoofs";
      return null;
    };
    let applied = 0;
    for (const [elId, attrs] of Object.entries(patch || {})) {
      const key = arrayForId(elId);
      if (!key) continue;
      const idx = Number(elId.slice(elId.lastIndexOf("-") + 1));
      const pos = arrays[key].findIndex((el, i) => (el?._idx ?? i) === idx);
      if (pos < 0) continue;
      arrays[key][pos] = {
        ...arrays[key][pos],
        kg: attrs.kg,
        gewerk: attrs.gewerk,
        schicht: attrs.schicht,
        status: attrs.status,
      };
      applied++;
    }
    if (applied === 0) {
      toast("Synthetische Hüllen-Bauteile sind nicht persistierbar — Bauteile im Komplex-Designer zeichnen");
      return;
    }
    await bitApi.entities.BimModel.update(bimModel.id, arrays);
    toast.success(`Klassifizierung für ${applied} ${applied === 1 ? "Bauteil" : "Bauteile"} gespeichert`);
    reload(projectId);
  };

  // Live-Mengen filter-gekoppelter Positionen materialisieren (Write-Back in
  // p.quantity — Downstream Preisspiegel/Abrechnung/Kostenkontrolle/GAEB liest
  // unverändert quantity). Δ-Guard 0,005 + loadingRef gegen Schreibschleife
  // (RESEARCH §Pitfall 2/3); Auslöser: einmal nach dem Laden + Button.
  const loadingRef = useRef(false);
  const recomputeFilterQuantities = useCallback(async (opts = {}) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      let changed = 0;
      // NUR `filter` wird nachgerechnet. `uebernahme` und `handeingabe` bleiben
      // unberührt — würde der Recompute sie anfassen, überschriebe er eine belegte
      // Menge (Übernahme) bzw. eine bewusst getippte Zahl mit einer Modellmenge.
      const nachrechenbar = positions.filter(
        (x) => positionMode(x) === "filter" && x.filter_ref,
      );
      for (const p of nachrechenbar) {
        const f = filters.find((x) => x.id === p.filter_ref);
        if (!f) continue;
        const { menge } = filterQuantity(elements, f, p.mengenbasis || "area");
        if (Math.abs((p.quantity || 0) - menge) > 0.005) {
          await bitApi.entities.LVPosition.update(p.id, { quantity: menge });
          changed++;
        }
      }
      if (changed > 0) {
        if (!opts.silent) toast.success(`${changed} Filter-${changed === 1 ? "Menge" : "Mengen"} aktualisiert`);
        await reload(projectId);
      } else if (!opts.silent) {
        toast("Alle Filter-Mengen aktuell");
      }
    } finally {
      loadingRef.current = false;
    }
  }, [positions, filters, elements, projectId, reload]);

  // Einmalige Aktualisierung nach dem ersten Laden (ref-guarded, KEIN Dauer-Effekt).
  const autoRecomputeRef = useRef(false);
  // ME-01: Projektwechsel setzt den Guard zurück — sonst rechnet das neue Projekt
  // nach dem Laden nie automatisch nach.
  useEffect(() => { autoRecomputeRef.current = false; }, [projectId]);
  useEffect(() => {
    if (autoRecomputeRef.current) return;
    if (!projectId || positions.length === 0) return;
    autoRecomputeRef.current = true;
    recomputeFilterQuantities({ silent: true });
  }, [projectId, positions, recomputeFilterQuantities]);

  // --- Phase 33 / W4: `unit_price` ist ein NUR-LESE-CACHE --------------------
  // Die Wahrheit ist der Preisstapel; `unit_price` und `preis_schicht_id` sind
  // abgeleitet und werden nur von HIER geschrieben. Kein Formularfeld schreibt
  // sie mehr. Δ-Guard 0,005 + `loadingRef` verhindern die Schreibschleife
  // (dasselbe Muster wie beim Mengen-Recompute); die Index-Schicht wird
  // gerechnet und ihr ep NIE persistiert.
  const schichtenJePosition = useMemo(() => {
    const m = new Map();
    for (const s of preisSchichten) {
      const k = s.position_id ?? null;
      if (k == null) continue;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(s);
    }
    return (p) => m.get(p?.id) || [];
  }, [preisSchichten]);

  const indexReihen = useMemo(() => {
    const out = {};
    for (const r of kataloge.Preisindexreihe || []) out[r.id ?? r.reihe] = r;
    return out;
  }, [kataloge.Preisindexreihe]);

  const deckungJePosition = useMemo(() => {
    const m = new Map();
    for (const d of deckungen) if (d.position_id != null) m.set(d.position_id, d);
    return (p) => m.get(p?.id) || null;
  }, [deckungen]);

  const [preisPositionId, setPreisPositionId] = useState(null);
  const preisPosition = useMemo(
    () => positions.find((p) => p.id === preisPositionId) || null,
    [positions, preisPositionId],
  );

  // Eine neue Schicht wird ANGELEGT, nie eine bestehende überschrieben —
  // `ersetzt_id` trägt die Historie (siehe `neueSchicht`).
  const addPreisSchicht = async (schicht) => {
    try {
      await bitApi.entities.PreisSchicht.create({ ...schicht, project_id: projectId });
      toast.success("Preisschicht angelegt");
      await reload(projectId);
      await recomputePreisCache({ silent: true });
    } catch (err) {
      console.error("Preisschicht anlegen fehlgeschlagen:", err);
      toast.error("Preisschicht konnte nicht gespeichert werden");
    }
  };

  const preisCacheRef = useRef(false);
  const recomputePreisCache = useCallback(async (opts = {}) => {
    if (preisCacheRef.current) return;
    preisCacheRef.current = true;
    try {
      const rf = rangfolge(kataloge.PreisRangfolge || []);
      if (rf.leer) return; // ohne Katalog keine Rangfolge — und keine geratene
      let changed = 0;
      for (const p of positions) {
        const sch = schichtenJePosition(p);
        if (!sch.length) continue;
        const a = aktiveSchicht(sch, indexReihen, rf);
        const alt = p.unit_price ?? null;
        const neu = a.ep;
        const gleich = alt == null && neu == null
          ? true
          : alt != null && neu != null && Math.abs(alt - neu) <= 0.005;
        if (gleich && (p.preis_schicht_id ?? null) === (a.schicht?.id ?? null)) continue;
        await bitApi.entities.LVPosition.update(p.id, {
          unit_price: neu,
          preis_schicht_id: a.schicht?.id ?? null,
          preis_art: a.art ?? null,
        });
        changed += 1;
      }
      if (changed > 0) {
        if (!opts.silent) toast.success(`${changed} Einheitspreise aus dem Preisstapel abgeleitet`);
        await reload(projectId);
      } else if (!opts.silent) {
        toast("Alle Einheitspreise entsprechen der aktiven Preisschicht");
      }
    } finally {
      preisCacheRef.current = false;
    }
  }, [positions, kataloge.PreisRangfolge, schichtenJePosition, indexReihen, projectId, reload]);

  // --- Phase 33 / W7: Referenzpreis-Pool, Ernte, STLB-Bilanz -----------------
  // Der Pool ist ein BÜROWEITER Katalog (kein project_id) — deshalb kommt er aus
  // `kataloge`, nicht aus dem Projektladevorgang.
  const referenzpreisPool = useMemo(() => kataloge.ReferenzpreisPool || [], [kataloge.ReferenzpreisPool]);

  // Sichtungsfälle: vorhanden, sichtbar, NICHT aktiv.
  const reviewSchichten = useMemo(
    () => preisSchichten.filter((s) => s?.art === "referenzprojekt" && s?.review?.flag === true),
    [preisSchichten],
  );

  // STLB-Bilanz — ehrlich, ohne Glättung. Der Kandidatenkorpus kommt aus dem
  // Katalog; ist er leer, ist die Bilanz „alles kein" und sagt das auch.
  const stlbBilanz = useMemo(() => {
    const kandidaten = (kataloge.StlbKatalog || []).filter((r) => r.kurztext);
    if (positions.length === 0) return null;
    return ordneAlleZu(positions, kandidaten, kataloge.PreisUebernahmeRegel || []).bilanz;
  }, [positions, kataloge.StlbKatalog, kataloge.PreisUebernahmeRegel]);

  // Übernahme aus dem Pool: IMMER eine neue Schicht (Rang 30), nie ein Update.
  const poolUebernehmen = async (eintrag, ziel) => {
    if (!ziel) return;
    try {
      const schicht = neueSchicht(null, {
        art: "referenzprojekt",
        ep: eintrag.ep,
        stand: eintrag.stand ?? null,
        herkunft: {
          typ: "referenzprojekt",
          projekt_nr: eintrag.projekt_nr ?? null,
          beleg: `Referenzpreis-Pool · ${eintrag.kurztext}`,
        },
        match: { similarity: null, ratio: null, verfahren: "manuelle Übernahme aus dem Büro-Preisspiegel" },
      });
      await addPreisSchicht({ ...schicht, position_id: ziel.id });
    } catch (err) {
      console.error("Übernahme aus dem Pool fehlgeschlagen:", err);
      toast.error(err.message);
    }
  };

  // --- Phase 28: Preisreferenz (TED/DÖE/Demo) — nur Aggregat-Zellen, global ---
  // Idempotent je Quelle: bestehende Zellen der Quelle löschen, neue anlegen
  // (kein Duplikat-Wachstum bei erneutem Sync — T-28-07).
  // Reihenfolge bewusst „erst neu anlegen, dann Bestand löschen" — bei einem
  // Teilfehler gehen keine vorhandenen Benchmark-Zellen verloren (CR-02).
  // Rückgabe: true bei Erfolg, false bei Fehler (Aufrufer zeigt dann keinen Erfolgs-Toast).
  const replaceCells = async (source, cells) => {
    const created = [];
    try {
      for (const cell of cells) {
        created.push(await bitApi.entities.PriceReference.create(cell));
      }
    } catch (err) {
      console.error("Benchmark-Zellen anlegen fehlgeschlagen:", err);
      // Rollback der bereits neu angelegten Zellen — Bestand unangetastet.
      for (const c of created) {
        try { await bitApi.entities.PriceReference.delete(c.id); } catch { /* best effort */ }
      }
      toast.error("Referenzdaten konnten nicht gespeichert werden — Bestand bleibt unverändert");
      await reload(projectId);
      return false;
    }
    try {
      for (const r of priceRefs.filter((x) => x.source === source)) {
        await bitApi.entities.PriceReference.delete(r.id);
      }
    } catch (err) {
      console.error("Alte Referenzzellen löschen fehlgeschlagen:", err);
      toast.error("Alte Referenzzellen konnten nicht vollständig entfernt werden — Tabelle bitte prüfen");
    }
    await reload(projectId);
    return true;
  };

  // TED-Sync — Netz NUR nach explizitem Klick (Cache-first, RESEARCH §3).
  // Max. 4 Seiten × 250 = ≤ 1.000 Notices — Fenstergrenze 15.000 nie gerissen.
  const syncTed = async (year) => {
    try {
      const lots = [];
      for (let page = 1; page <= 4; page++) {
        const q = { ...buildTedQuery({ year }), page };
        const r = await bitApi.apiFetch("/api/prices/ted-search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(q),
        });
        const json = await r.json();
        if (json?.offline || !Array.isArray(json?.notices)) {
          if (!lots.length) {
            toast.error("TED nicht erreichbar — offline? Demo-Daten oder DÖE-Import nutzen");
            return;
          }
          break; // Teilausbeute behalten, Schleife beenden
        }
        lots.push(...parseTedResponse(json, year));
        if (json.notices.length === 0) break;
      }
      if (!lots.length) {
        toast.error("Keine TED-Zuschläge mit Wert gefunden — Demo-Daten oder DÖE-Import nutzen");
        return;
      }
      const cells = aggregateLots(lots, { source: "ted", fetched_at: new Date().toISOString() })
        .map((c) => ({ ...c, license: "EU-2011/833", query_info: `CPV 45* · DEU · can-standard · ${year}` }));
      const ok = await replaceCells("ted", cells);
      if (ok) toast.success(`${cells.length} Benchmark-Zellen aus ${lots.length} TED-Losen (${year})`);
    } catch (err) {
      console.error("TED-Sync fehlgeschlagen:", err);
      toast.error("TED-Abruf fehlgeschlagen — Demo-Daten oder DÖE-Import nutzen");
    }
  };

  // DÖE-Monatspaket (CC0): lokal entpackte CSVs importieren, joinen, aggregieren.
  const importDoee = async ({ tenderFile, classificationFile, placeFile, submissionsFile, year }) => {
    try {
      const [tenderCsv, classificationCsv, placeCsv, submissionsCsv] = await Promise.all([
        tenderFile.text(), classificationFile.text(), placeFile.text(),
        submissionsFile ? submissionsFile.text() : Promise.resolve(null),
      ]);
      const lots = parseDoeeCsv({ tenderCsv, classificationCsv, placeCsv, submissionsCsv, year });
      if (!lots.length) {
        toast.error("Keine EU-Zuschläge mit Wert im Paket (Unterschwelle ist preislos)");
        return;
      }
      const cells = aggregateLots(lots, { source: "doee", fetched_at: new Date().toISOString() })
        .map((c) => ({ ...c, license: "CC0", query_info: `DÖE-Monatspaket · ${year}` }));
      const ok = await replaceCells("doee", cells);
      if (ok) toast.success(`${cells.length} Benchmark-Zellen aus ${lots.length} DÖE-Losen (${year})`);
    } catch (err) {
      console.error("DÖE-Import fehlgeschlagen:", err);
      toast.error("DÖE-Import fehlgeschlagen — CSV-Dateien prüfen (tender/classification/placeOfPerformance)");
    }
  };

  // ENTFERNT (Phase 33 / W3): der Demo-Korpus (DEMO_BENCHMARKS) lag als Konstante in
  // `priceReference.js` und wurde per Knopf in das GERADE GEÖFFNETE Projekt geschrieben —
  // also auch in ein echtes. Die Werte liegen jetzt als Daten im isolierten Demoprojekt
  // (server/demo-data.js, `source: "demo"`), wo sie als Beispiel erkennbar bleiben.

  // --- Tender CRUD ----------------------------------------------------------
  const createTender = async (data) => {
    await bitApi.entities.Tender.create({ ...data, project_id: projectId });
    toast.success("Ausschreibung erstellt");
    reload(projectId);
  };
  const updateTender = async (id, data) => {
    await bitApi.entities.Tender.update(id, data);
    reload(projectId);
  };
  const deleteTender = async (id) => {
    await bitApi.entities.Tender.delete(id);
    if (selectedTenderId === id) setSelectedTenderId(null);
    toast("Ausschreibung gelöscht");
    reload(projectId);
  };

  // --- Bids + award ---------------------------------------------------------
  const createBid = async (data) => {
    await bitApi.entities.Bid.create({ ...data, project_id: projectId });
    toast.success("Angebot erfasst");
    reload(projectId);
  };
  const award = async (tender, bid) => {
    const tBids = bids.filter((b) => b.tender_id === tender.id);
    await Promise.all([
      bitApi.entities.Bid.update(bid.id, { status: "awarded" }),
      ...tBids.filter((b) => b.id !== bid.id).map((b) => bitApi.entities.Bid.update(b.id, { status: "rejected" })),
      bitApi.entities.Tender.update(tender.id, { status: "awarded", awarded_bid_id: bid.id }),
    ]);
    toast.success(`Zuschlag an ${bid.bidder_name}`);
    reload(projectId);
  };

  const addMeasurement = async (data) => {
    await bitApi.entities.Measurement.create(data);
    toast.success("Aufmaß gespeichert");
    reload(projectId);
  };

  // Change orders of the current project — the one rule shared with Finance
  // (72-14): project_id, or project_name for legacy seed records without an id.
  const projectCOs = nachtraegeDesProjekts(changeOrders, project);

  // --- Phase 33 / W6: Mengenregeln, Muster, Kataloge, Läufe ------------------
  // Der aktive Bauteilstand. Ohne ihn wird KEIN Lauf geschrieben (Ehrlichkeits-
  // regel aus `regelLauf.laufErzeugen`) — eine Modellmenge ohne Modellstand ist
  // keine Aussage.
  const aktiverSnapshot = useMemo(() => {
    const sortiert = [...snapshots].sort((a, b) =>
      String(b.stand ?? b.created_date ?? "").localeCompare(String(a.stand ?? a.created_date ?? "")));
    return sortiert[0] || null;
  }, [snapshots]);

  const regelnJePosition = useMemo(() => {
    const m = new Map();
    for (const r of mengenRegeln) {
      const k = r.position_id ?? null;
      if (k == null) continue;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(r);
    }
    return (p) => m.get(p?.id) || [];
  }, [mengenRegeln]);

  const [regelPositionId, setRegelPositionId] = useState(null);
  const regelPosition = useMemo(
    () => positions.find((p) => p.id === regelPositionId) || null,
    [positions, regelPositionId],
  );

  const letzterRegelLauf = useMemo(() => {
    const s = [...regelLaeufe].sort((a, b) =>
      String(b.zeitpunkt ?? "").localeCompare(String(a.zeitpunkt ?? "")));
    return s[0] || null;
  }, [regelLaeufe]);

  // Einen Lauf schreiben — für EINE Position oder für alle.
  const laufSchreiben = useCallback(async (zielPositionen, anlass) => {
    const eingabe = zielPositionen.map((p) => ({ ...p, regeln: regelnJePosition(p) }));
    const res = laufErzeugen(eingabe, elements, {
      snapshot_id: aktiverSnapshot?.id ?? null,
      kataloge,
      anlass,
    });
    if (!res.ok) {
      // Kein stiller Abbruch: der Grund steht auf dem Bildschirm.
      toast.error(res.grund);
      return null;
    }
    try {
      await bitApi.entities.RegelLauf.create({ ...res.lauf, project_id: projectId });
    } catch (err) {
      console.error("RegelLauf konnte nicht gespeichert werden:", err);
      toast.error("Der Lauf wurde gerechnet, aber nicht gespeichert — Historie unvollständig");
    }
    return res.lauf;
  }, [regelnJePosition, elements, aktiverSnapshot, kataloge, projectId]);

  const speichereRegel = async (regel, { snapshotId } = {}) => {
    if (!regelPosition) return;
    try {
      // Zweiter Wächter an der SPEICHER-Kante: der Editor prüft schon, aber ein
      // Aufruf von anderer Stelle darf keine ungültige Referenz durchlassen.
      pruefeReferenzenOderWirf(regel, kataloge);
    } catch (err) {
      toast.error(err.message);
      return;
    }
    const daten = { ...regel, position_id: regelPosition.id, project_id: projectId, snapshot_id: snapshotId ?? aktiverSnapshot?.id ?? null };
    try {
      if (regel.id) await bitApi.entities.MengenRegel.update(regel.id, daten);
      else await bitApi.entities.MengenRegel.create(daten);
      toast.success(regel.id ? "Regel aktualisiert" : "Regel angelegt");
    } catch (err) {
      console.error("Regel speichern fehlgeschlagen:", err);
      toast.error("Regel konnte nicht gespeichert werden");
      return;
    }
    await reload(projectId);
    const lauf = await laufSchreiben([regelPosition], "regel_bearbeitet");
    // Die Menge der Position ist ein abgeleiteter Wert — sie wird aus dem Lauf
    // übernommen, nicht vom Formular getippt.
    const zeile = lauf?.je_position?.[0];
    if (zeile && zeile.veraendert) {
      await bitApi.entities.LVPosition.update(regelPosition.id, {
        quantity: zeile.menge_neu,
        mengen_modus: "filter",
        modell_geprueft_am: new Date().toISOString().slice(0, 10),
      });
      toast.success(`Menge ${zeile.menge_alt ?? "—"} → ${zeile.menge_neu}`);
      await reload(projectId);
    }
  };

  const loescheRegel = async (regel) => {
    if (!regel?.id) return;
    await bitApi.entities.MengenRegel.delete(regel.id);
    toast("Regel gelöscht — die zuletzt gerechnete Menge bleibt an der Position stehen");
    await reload(projectId);
  };

  const alleNachrechnen = async () => {
    const lauf = await laufSchreiben(positions, "manuell");
    if (!lauf) return;
    let geschrieben = 0;
    for (const z of lauf.abweichungen) {
      const p = positions.find((x) => x.id === z.position_id);
      if (!p) continue;
      await bitApi.entities.LVPosition.update(p.id, { quantity: z.menge_neu });
      geschrieben += 1;
    }
    toast.success(
      geschrieben > 0
        ? `${geschrieben} Menge(n) aktualisiert · ${lauf.warnungen.length} Warnung(en)`
        : `Alle Mengen aktuell · ${lauf.warnungen.length} Warnung(en)`,
    );
    await reload(projectId);
  };

  // Muster: büroweit speichern bzw. auf eine Position anwenden.
  const musterSpeichern = async (muster) => {
    try {
      await bitApi.entities.MengenMuster.create(muster);
      toast.success("Muster büroweit gespeichert — im nächsten Projekt verfügbar");
      const k = await fetch("/api/catalogs").then((r) => (r.ok ? r.json() : {}));
      setKataloge(k);
    } catch (err) {
      console.error("Muster speichern fehlgeschlagen:", err);
      toast.error("Muster konnte nicht gespeichert werden");
    }
  };

  const musterAnwenden = async (muster, ziel) => {
    if (!ziel) return;
    const regel = regelAusMuster(muster, { muster_ref: muster.id ?? muster.nr ?? null });
    try {
      pruefeReferenzenOderWirf(regel, kataloge);
    } catch (err) {
      toast.error(`Muster nicht anwendbar — ${err.message}`);
      return;
    }
    await bitApi.entities.MengenRegel.create({ ...regel, position_id: ziel.id, project_id: projectId });
    toast.success(`Muster „${muster.name}" auf ${ziel.oz} angewandt`);
    await reload(projectId);
    await laufSchreiben([ziel], "muster_angewandt");
  };

  // Katalogpflege: schreibt in die Katalog-Entität und lädt die Kataloge neu.
  const katalogSpeichern = async (entity, zeile) => {
    try {
      if (zeile.id) await bitApi.entities[entity].update(zeile.id, zeile);
      else await bitApi.entities[entity].create(zeile);
      const k = await fetch("/api/catalogs").then((r) => (r.ok ? r.json() : {}));
      setKataloge(k);
      toast.success(`${entity} gespeichert`);
    } catch (err) {
      console.error(`${entity} speichern fehlgeschlagen:`, err);
      toast.error(`${entity} konnte nicht gespeichert werden`);
    }
  };

  const katalogLoeschen = async (entity, zeile) => {
    if (!zeile?.id) return;
    await bitApi.entities[entity].delete(zeile.id);
    const k = await fetch("/api/catalogs").then((r) => (r.ok ? r.json() : {}));
    setKataloge(k);
    toast("Override gelöscht — der Bürostandard gilt wieder");
  };

  const selectedTender = tenders.find((t) => t.id === selectedTenderId) || null;
  const openTender = (id) => { setSelectedTenderId(id); setTab("prices"); };

  return (
    <div className={seitenWurzel}>
      <div className="max-w-7xl mx-auto space-y-6">
        <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-slate-800 via-emerald-700 to-teal-600 bg-clip-text text-transparent flex items-center gap-2">
              <FileSpreadsheet className="w-7 h-7 text-emerald-600" /> {t("AVA (Ausschreibung)")}
            </h1>
            {/* Menu name as h1, the three phases as subtitle (naming table N-02). */}
            <p className="text-slate-600 mt-1">
              {t("Ausschreibung · Vergabe · Abrechnung")}
              {project && <> · <span className="font-medium text-slate-700">{project.name}</span></>}
            </p>
          </div>
        </motion.div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="flex flex-wrap h-auto gap-1 bg-slate-100">
            <TabsTrigger value="lv"><ListTree className="w-4 h-4 mr-2" /> Leistungsverzeichnis</TabsTrigger>
            <TabsTrigger value="mengenregeln"><SlidersHorizontal className="w-4 h-4 mr-2" /> Mengenregeln</TabsTrigger>
            <TabsTrigger value="takeoff"><Boxes className="w-4 h-4 mr-2" /> BIM-Mengen</TabsTrigger>
            <TabsTrigger value="kostenberechnung"><Calculator className="w-4 h-4 mr-2" /> Kostenberechnung</TabsTrigger>
            <TabsTrigger value="tender"><ScrollText className="w-4 h-4 mr-2" /> Ausschreibung</TabsTrigger>
            <TabsTrigger value="prices"><Gavel className="w-4 h-4 mr-2" /> Preisspiegel</TabsTrigger>
            <TabsTrigger value="settlement"><Ruler className="w-4 h-4 mr-2" /> Abrechnung</TabsTrigger>
            <TabsTrigger value="control"><BarChart3 className="w-4 h-4 mr-2" /> Kostenkontrolle</TabsTrigger>
          </TabsList>

          <TabsContent value="lv" className="pt-4 space-y-4">
            <LVTable
              positions={positions} onCreate={createPos} onUpdate={updatePos} onDelete={deletePos} onImport={importPositions}
              dinKatalog={kataloge.Din276Katalog || []}
              filters={filters} elements={elements}
              onSelect={setPreisPositionId}
              selectedId={preisPositionId}
              onZuBimMengen={() => setTab("takeoff")}
            />
            {/* Preisstapel der gewählten Position (Phase 33 / W4). Sichtbar
                gemacht, weil ein Einheitspreis ohne einsehbare Herkunft im
                Kostenanschlag von einem belegten nicht zu unterscheiden ist. */}
            {preisPosition && (
              <PreisSchichtPanel
                position={preisPosition}
                schichten={schichtenJePosition(preisPosition)}
                reihen={indexReihen}
                rangfolgeKatalog={kataloge.PreisRangfolge || []}
                onAddSchicht={addPreisSchicht}
              />
            )}
            {/* Bundle-Import mit Trockenlauf: erst der Bericht, dann das Schreiben.
                72-15: folded below the LV — the LV is what the tab is for, the
                import is a one-off at project start. */}
            <details>
              <summary className="w-fit cursor-pointer select-none rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400">
                {t("Projekt-Bundle importieren …")}
              </summary>
              <div className="mt-3">
                <ImportWizard onDone={() => reload(projectId)} />
              </div>
            </details>
          </TabsContent>

          {/* --- Mengenregeln (Phase 33 / W6) ------------------------------
              Der Reiter, in dem eine neue Mengenregel OHNE Codeänderung
              entsteht: Tabelle → Editor (mit @core-Selektor und Live-Treffern)
              → Musterbibliothek → Kataloge → Mehrfachnutzung. Das ParitaetsBadge
              steht oben: ohne Lauf sagt es „nicht geprüft", nie grün. */}
          <TabsContent value="mengenregeln" className="pt-4 space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <ParitaetsBadge laeufe={paritaetsLaeufe} />
              {aktiverSnapshot ? (
                <span className="text-xs text-slate-600">
                  Bauteilstand: <strong>{aktiverSnapshot.name || aktiverSnapshot.id}</strong>
                  {aktiverSnapshot.stand ? ` · ${aktiverSnapshot.stand}` : ""} ·{" "}
                  {elements.length} Bauteile
                </span>
              ) : (
                <span className="text-xs text-amber-700">
                  Kein BimSnapshot erfasst — es wird gerechnet, aber kein Lauf protokolliert
                  (Modellmenge ohne Modellstand ist keine Aussage).
                </span>
              )}
            </div>
            <RegelTabelle
              positionen={positions}
              regelnJePosition={regelnJePosition}
              elemente={elements}
              snapshots={snapshots}
              onSelect={setRegelPositionId}
              selectedId={regelPositionId}
              onRecompute={alleNachrechnen}
              letzterLauf={letzterRegelLauf}
            />
            <RegelEditor
              position={regelPosition}
              regeln={regelPosition ? regelnJePosition(regelPosition) : []}
              elemente={elements}
              kataloge={kataloge}
              snapshotId={aktiverSnapshot?.id ?? null}
              onSpeichern={speichereRegel}
              onLoeschen={loescheRegel}
              onMusterSpeichern={musterSpeichern}
              onSchliessen={() => setRegelPositionId(null)}
            />
            <MusterBibliothek
              muster={kataloge.MengenMuster || []}
              elemente={elements}
              positionen={positions}
              zielPositionId={regelPositionId}
              onAnwenden={musterAnwenden}
            />
            <MehrfachnutzungsReport
              positionen={positions}
              regelnJePosition={regelnJePosition}
              elemente={elements}
            />
            <KatalogEditor
              kataloge={kataloge}
              projektId={projectId}
              onSave={katalogSpeichern}
              onDelete={katalogLoeschen}
            />
          </TabsContent>

          <TabsContent value="takeoff" className="pt-4 space-y-4">
            <IfcImportPanel
              onUse={setIfcElements}
              active={!!ifcElements}
              count={ifcElements?.length || 0}
              onReset={() => setIfcElements(null)}
            />
            <QuantityTakeoff
              building={building} positions={positions} onUpdate={updatePos}
              bimModelAvailable={!!bimModel}
              elements={elements} filters={filters}
              onSaveFilter={saveFilter} onDeleteFilter={deleteFilter}
              onSaveClassification={saveClassification}
              onRecompute={recomputeFilterQuantities}
            />
          </TabsContent>

          {/* --- Kostenberechnung (Phase 33 / W4+W5, Reiter aus W6) ---------
              Die Sicht, die es vorher nicht gab: Menge × belegter Einheitspreis
              je Position, mit dem Preisstand als Datum, dem Preisstapel der
              gewählten Zeile und der Deckung in BEIDE Richtungen. */}
          <TabsContent value="kostenberechnung" className="pt-4 space-y-4">
            <KostenberechnungTabelle
              positionen={positions}
              schichtenJePosition={schichtenJePosition}
              reihen={indexReihen}
              kataloge={kataloge}
              vertraege={vertraege}
              deckungJePosition={deckungJePosition}
              onPreisstand={() => recomputePreisCache({ silent: true })}
              onSelect={setPreisPositionId}
              selectedId={preisPositionId}
              onUpdate={updatePos}
            />
            {preisPosition && (
              <PreisSchichtPanel
                position={preisPosition}
                schichten={schichtenJePosition(preisPosition)}
                reihen={indexReihen}
                rangfolgeKatalog={kataloge.PreisRangfolge || []}
                onAddSchicht={addPreisSchicht}
              />
            )}
            {/* Deckung in BEIDE Richtungen (Phase 33 / W5): welches Bauteil hat
                keine Position — und welche Position keine Bauteile. */}
            <DeckungsReport elemente={elements} positionen={positions} kataloge={kataloge} />
          </TabsContent>

          <TabsContent value="tender" className="pt-4">
            <TenderPanel
              tenders={tenders} positions={positions} contacts={contacts} bids={bids}
              selectedTenderId={selectedTenderId} onSelect={openTender}
              onCreate={createTender} onUpdate={updateTender} onDelete={deleteTender}
            />
          </TabsContent>

          <TabsContent value="prices" className="pt-4">
            <PriceComparison
              tender={selectedTender} positions={positions} bids={bids} contacts={contacts}
              onCreateBid={createBid} onAward={award} priceRefs={priceRefs}
            />
            <div className="mt-4">
              <PriceReferencePanel priceRefs={priceRefs} onSyncTed={syncTed} onImportDoee={importDoee} />
            </div>
            {/* Der Büro-Preisspiegel NEBEN dem TED/DÖE-Panel — nicht darin.
                TED/DÖE bleiben Los-Summen und werden nie zu €/Einheit
                (Ehrlichkeitsgrenze aus Phase 28, `priceReference.js` unverändert). */}
            <div className="mt-4">
              <ReferenzpreisPoolPanel
                pool={referenzpreisPool}
                position={preisPosition}
                reviewSchichten={reviewSchichten}
                stlbBilanz={stlbBilanz}
                onUebernehmen={poolUebernehmen}
              />
            </div>
          </TabsContent>

          <TabsContent value="settlement" className="pt-4">
            <SettlementPanel
              tenders={tenders} positions={positions} bids={bids} measurements={measurements}
              changeOrders={projectCOs} onAddMeasurement={addMeasurement}
              onTab={setTab}
            />
          </TabsContent>

          <TabsContent value="control" className="pt-4 space-y-4">
            {/* Die Kostenberechnungs-Sicht ist mit W6 in den eigenen Reiter
                „Kostenberechnung" gezogen (Tabs 6 → 8). Hier bleibt die
                Kostenkontrolle gegen Ausschreibung/Angebote/Aufmaß. */}
            <CostControl positions={positions} tenders={tenders} bids={bids} measurements={measurements} changeOrders={projectCOs} priceRefs={priceRefs} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
