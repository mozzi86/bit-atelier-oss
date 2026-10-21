// SonderwunschReiter — tab "Wohnungen & Sonderwünsche" of the page Werkplanung (99-01…03):
//   99-01 the stored apartments (Wohneinheit) drawn per storey, take-over/match from the
//         model with reported deviations (numbers stay), sales status, buyer, section;
//   99-02 special requests per apartment with the status chain and the technical approvals
//         its severity needs, the project's equipment catalogue; a released request with
//         product data becomes a released apartment sample in Bemusterung;
//   99-03 the decision deadline per apartment × trade from the schedule (ScheduleTask start
//         − 4 weeks), lights in the drawing, the request rows and the matrix.
// Layout "drawing first": the plan takes the width, the apartment panel stays narrow.
//
// In:  projectId, projekt ({name, client}). Loads Wohneinheit, Sonderwunsch,
//      AusstattungsOption, ScheduleTask, Bemusterung, BimModel. Rules:
//      src/lib/werkplanung/{wohneinheiten,sonderwunsch,sonderwunschFrist,bemusterung}.js.
// Out: UI; writes Wohneinheit, Sonderwunsch, AusstattungsOption (child), Bemusterung (one
//      row per released request with product data), Document (protocol per apartment).
//      data-testids: sw-reiter, sw-abgleich, sw-abgleich-panel, sw-abgleich-zeile (data-art,
//      data-stufe, data-nr), sw-abgleich-uebernehmen, sw-geschoss-<n>, sw-wohnung (panel),
//      sw-w-status, sw-w-kaeufer, sw-w-bauabschnitt, sw-w-speichern, sw-neu, sw-form-*,
//      sw-speichern, sw-zeile (data-nr, data-status, data-ampel), sw-aktion-<art>[-<rolle>],
//      sw-a-von, sw-a-ergebnis, sw-a-preis, sw-a-speichern, sw-matrix, sw-matrix-zelle
//      (data-nr, data-lb, data-ampel, data-frist), sw-pdf, sw-meldung, sw-fehler.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Button } from "@core/components/ui/button";
import { Input } from "@core/components/ui/input";
import { Label } from "@core/components/ui/label";
import FormModal from "@core/components/common/FormModal";
import { bitApi } from "@core/api/bitApi";
import { useI18n } from "@core/lib/i18n";
import { useAuth } from "@core/lib/AuthContext";
import { fileToDataUrl } from "@core/lib/pdf";
import { dokumentAblegen } from "@core/lib/ablage";
import { dateiAnbieten } from "@core/lib/tabellenExport";
import { STLB_LB } from "@core/lib/bauteil/gewerke.js";
import { Plus, RefreshCw } from "lucide-react";
import WohnungsPlan from "./WohnungsPlan";
import AusstattungsKatalog from "./AusstattungsKatalog";
import {
  WOHNUNG_STATUS, kandidatenAusModell, abgleichen, abgleichPlan, abgleichMeldungen, geschossLabel, wohnungStatusLabel, wohnungPatch,
} from "@/lib/werkplanung/wohneinheiten";
import {
  FREIGABE_ROLLEN, SCHWERE, OFFEN, swStatusLabel, gewerkLabel, noetigeFreigaben, offeneFreigaben, wirksameSchwere, neuerSonderwunsch,
  pruefungPatch, angebotPatch, kaeuferEntscheidungPatch, einarbeitungPatch, abnahmePatch, sonderwunschHinweise, summeWohnung,
} from "@/lib/werkplanung/sonderwunsch";
import { FRIST_VORLAUF_TAGE, fristFuer, fristenDerWuensche, fristMatrix, tageBis } from "@/lib/werkplanung/sonderwunschFrist";
import { OHNE_ABSCHNITT, abschnittVon } from "@/lib/planung/zeitstrahl.js";
import { OBERFLAECHEN, bemusterungAusSonderwunsch, bemusterungsProtokollPdf } from "@/lib/werkplanung/bemusterung";

const AUSWAHL = "h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm";
// schwere "" = not classified: wirksameSchwere() then assumes 'grundriss' (architect looks at it).
const LEER_WUNSCH = { katalog_option_id: "", raum: "", gewerk_lb: "", beschreibung: "", menge: "1", preis_eur: "", schwere: "", fabrikat: "", produkt: "", farbe_system: "sonstig", farbe: "", oberflaeche: "" };

/** Token classes of a light (badge / table cell). @type {Record<string, string>} */
const AMPEL_KLASSE = {
  rot: "bg-fehler-flaeche text-fehler border-fehler-rand",
  gelb: "bg-warnung-flaeche text-warnung border-warnung-rand",
  gruen: "bg-erfolg-flaeche text-erfolg border-erfolg-rand",
  offen: "bg-hinweis-flaeche text-hinweis border-hinweis-rand",
};
/** German light labels (i18n keys). @type {Record<string, string>} */
const AMPEL_TEXT = { rot: "Frist überschritten", gelb: "Frist läuft", gruen: "erledigt", offen: "ohne Termin im Bauablauf" };

const eur = (/** @type {unknown} */ v) => (Number(v) || 0).toLocaleString("de-DE", { style: "currency", currency: "EUR" });
const datum = (/** @type {string|null|undefined} */ iso) => (iso ? String(iso).slice(0, 10).split("-").reverse().join(".") : "—");
const m2 = (/** @type {unknown} */ v) => (Number(v) || 0).toLocaleString("de-DE", { maximumFractionDigits: 1 });
const fehlerText = (/** @type {unknown} */ e) => (e instanceof Error ? e.message : String(e));
const nachNr = (/** @type {any} */ a, /** @type {any} */ b) => String(a.nr || "").localeCompare(String(b.nr || ""), "de", { numeric: true });
const rolleLabel = (/** @type {string} */ k) => FREIGABE_ROLLEN.find((r) => r.key === k)?.label || k;

/**
 * @typedef {{sw: any, art: 'pruefung'|'angebot'|'entscheidung'|'einarbeitung'|'abnahme', rolle?: string,
 *   ergebnis?: string, von: string, bemerkung: string, preis: string}} Aktion one step of the chain in the dialog
 */

/**
 * @param {{projectId: string, projekt?: {name?: string, client?: string}|null}} props
 * @returns {import("react").JSX.Element}
 */
export default function SonderwunschReiter({ projectId, projekt = null }) {
  const { t } = useI18n();
  const { user } = useAuth();
  const [daten, setDaten] = useState(/** @type {{wohnungen: any[], wuensche: any[], katalog: any[], tasks: any[], muster: any[], modell: any}} */ ({ wohnungen: [], wuensche: [], katalog: [], tasks: [], muster: [], modell: null }));
  const [geladen, setGeladen] = useState(false);
  const [geschoss, setGeschoss] = useState(/** @type {number|null} */ (null));
  const [auswahlId, setAuswahlId] = useState(/** @type {string|null} */ (null));
  const [abgleich, setAbgleich] = useState(/** @type {null | {ergebnis: ReturnType<typeof abgleichen>, meldungen: ReturnType<typeof abgleichMeldungen>, anzahl: number}} */ (null));
  const [verkauf, setVerkauf] = useState(/** @type {{status: string, kaeufer: string, bauabschnitt: string}} */ ({ status: "frei", kaeufer: "", bauabschnitt: "" }));
  const [formular, setFormular] = useState(/** @type {null | Record<string, string>} */ (null));
  const [aktion, setAktion] = useState(/** @type {Aktion|null} */ (null));
  const [fehler, setFehler] = useState(/** @type {string|null} */ (null));
  const [meldung, setMeldung] = useState(/** @type {string|null} */ (null));
  // One write at a time: numbers (W-/SW-/B-) are computed from the loaded rows, so a second
  // click during a running write would hand out the same number twice. The ref blocks within
  // the same tick, the state disables the buttons.
  const sperre = useRef(false);
  const [laeuft, setLaeuft] = useState(false);
  const einmal = async (/** @type {() => Promise<void>} */ fn) => {
    if (sperre.current) return;
    sperre.current = true; setLaeuft(true);
    try { await fn(); } finally { sperre.current = false; setLaeuft(false); }
  };
  const heute = new Date().toISOString().slice(0, 10);

  const laden = useCallback(async () => {
    try {
      const liste = async (/** @type {string} */ name) => {
        const r = await bitApi.entities[name].filter({ project_id: projectId });
        return Array.isArray(r) ? r : [];
      };
      const [wohnungen, wuensche, katalog, tasks, muster, modelle] = await Promise.all([
        liste("Wohneinheit"), liste("Sonderwunsch"), liste("AusstattungsOption"),
        liste("ScheduleTask").catch(() => []), liste("Bemusterung").catch(() => []), liste("BimModel").catch(() => []),
      ]);
      setDaten({ wohnungen: wohnungen.sort(nachNr), wuensche: wuensche.sort(nachNr), katalog: katalog.sort(nachNr), tasks, muster, modell: modelle[0] || null });
      setGeladen(true);
    } catch (e) { setFehler(`${t("Wohnungen konnten nicht geladen werden")}: ${fehlerText(e)}`); }
  }, [projectId, t]);
  useEffect(() => { laden(); }, [laden]);

  const { wohnungen, wuensche, katalog, tasks, muster } = daten;
  const aktive = useMemo(() => wohnungen.filter((w) => w.entfallen !== true), [wohnungen]);
  const geschosse = useMemo(() => [...new Set(aktive.map((w) => Math.round(Number(w.geschoss) || 0)))].sort((a, b) => a - b), [aktive]);
  const auswahl = wohnungen.find((w) => w.id === auswahlId) || null;
  const aktGeschoss = geschoss !== null && geschosse.includes(geschoss) ? geschoss : (geschosse[0] ?? null);
  const zustand = useMemo(() => fristenDerWuensche(wuensche, wohnungen, tasks, heute), [wuensche, wohnungen, tasks, heute]);
  const matrix = useMemo(() => fristMatrix({ wohnungen, wuensche, tasks, katalog, heute }), [wohnungen, wuensche, tasks, katalog, heute]);
  const lichter = useMemo(() => new Map(matrix.zeilen.map((z) => [z.wohnung.id, { ampel: z.ampel, anzahl: wuensche.filter((s) => s.wohnung_id === z.wohnung.id).length }])), [matrix, wuensche]);
  const abschnitte = useMemo(() => [...new Set(tasks.map(abschnittVon))].filter((a) => a !== OHNE_ABSCHNITT).sort(), [tasks]);
  const eigene = auswahl ? wuensche.filter((s) => s.wohnung_id === auswahl.id) : [];
  const summe = summeWohnung(eigene);
  const entfallene = wohnungen.filter((w) => w.entfallen === true);

  useEffect(() => {
    setVerkauf({ status: auswahl?.status || "frei", kaeufer: auswahl?.kaeufer || "", bauabschnitt: auswahl?.bauabschnitt || "" });
  }, [auswahl?.id, auswahl?.status, auswahl?.kaeufer, auswahl?.bauabschnitt]);

  const waehlen = (/** @type {string} */ id) => { setAuswahlId(id); setMeldung(null); };

  // --- 99-01: take-over / match ---------------------------------------------------------
  const abgleichPruefen = () => {
    setFehler(null); setMeldung(null);
    const kandidaten = kandidatenAusModell(daten.modell);
    if (!kandidaten.length && !wohnungen.length) { setFehler(t("Kein Wohnungszuschnitt im Modell: in der Wohnungs-Werkstatt anwenden oder Riegel im Massing-Studio zeichnen.")); return; }
    const ergebnis = abgleichen(wohnungen, kandidaten);
    const mitWuenschen = new Set(wuensche.filter((s) => s.status !== "abgelehnt").map((s) => String(s.wohnung_id)));
    setAbgleich({ ergebnis, meldungen: abgleichMeldungen(ergebnis, mitWuenschen), anzahl: kandidaten.length });
  };

  const abgleichUebernehmen = () => einmal(async () => {
    if (!abgleich) return;
    setFehler(null);
    try {
      const plan = abgleichPlan(abgleich.ergebnis, { projectId, alle: wohnungen });
      for (const rec of plan.anlegen) await bitApi.entities.Wohneinheit.create({ ...rec, created_date: new Date().toISOString() });
      for (const a of plan.aendern) await bitApi.entities.Wohneinheit.update(a.id, a.patch);
      setAbgleich(null);
      setMeldung(t("Abgleich übernommen: {neu} neu, {geaendert} geändert, {entfallen} entfallen")
        .replace("{neu}", String(plan.anlegen.length)).replace("{geaendert}", String(abgleich.ergebnis.geaendert.length)).replace("{entfallen}", String(abgleich.ergebnis.entfallen.length)));
      await laden();
    } catch (err) {
      // Part of the plan may be written already: drop the stale comparison and reload, so a
      // retry starts from a fresh check against the stored rows (no number twice).
      setAbgleich(null);
      await laden();
      setFehler(`${t("Wohnungen konnten nicht gespeichert werden")}: ${fehlerText(err)} — ${t("Bitte erneut abgleichen.")}`);
    }
  });

  const verkaufSpeichern = () => einmal(async () => {
    if (!auswahl) return;
    const patch = wohnungPatch(auswahl, verkauf);
    if (!patch) return;
    setFehler(null);
    try { await bitApi.entities.Wohneinheit.update(auswahl.id, patch); await laden(); setMeldung(t("Wohnung gespeichert")); }
    catch (err) { setFehler(`${t("Wohnungen konnten nicht gespeichert werden")}: ${fehlerText(err)}`); }
  });

  // --- 99-02: requests ----------------------------------------------------------------------
  const option = formular?.katalog_option_id ? katalog.find((o) => o.id === formular.katalog_option_id) || null : null;
  const formGewerk = String(option?.gewerk_lb || formular?.gewerk_lb || "");
  const formFrist = auswahl && formGewerk ? fristFuer(tasks, formGewerk, auswahl.bauabschnitt || "") : null;
  const formFreigaben = formular ? noetigeFreigaben({ schwere: option?.schwere || formular.schwere, beschreibung: formular.beschreibung || option?.bezeichnung, raum: formular.raum }) : [];

  const wunschSpeichern = (/** @type {import("react").FormEvent} */ e) => {
    e.preventDefault();
    return einmal(async () => {
      if (!formular || !auswahl) return;
      setFehler(null);
      try {
        const rec = neuerSonderwunsch({ ...formular, wohnung_id: auswahl.id }, { projectId, alle: wuensche, option, frist: formFrist?.frist ?? null });
        await bitApi.entities.Sonderwunsch.create({ ...rec, created_date: new Date().toISOString() });
        setFormular(null);
        await laden();
      } catch (err) { setFehler(`${t("Sonderwunsch konnte nicht gespeichert werden")}: ${fehlerText(err)}`); }
    });
  };

  const aktionStarten = (/** @type {any} */ sw, /** @type {Aktion['art']} */ art, /** @type {{rolle?: string, ergebnis?: string}} */ extra = {}) => {
    setFehler(null);
    setAktion({ sw, art, von: art === "entscheidung" ? (auswahl?.kaeufer || "") : (user?.full_name || ""), bemerkung: "", preis: String(sw.preis_eur ?? ""), ergebnis: extra.ergebnis || "ok", rolle: extra.rolle });
  };

  const aktionAusfuehren = () => einmal(async () => {
    if (!aktion) return;
    const a = aktion;
    const frist = zustand.get(a.sw.id)?.frist?.frist ?? null;
    /** @type {Record<string, any>|null} */
    let patch = null;
    if (a.art === "pruefung") patch = pruefungPatch(a.sw, String(a.rolle), /** @type {'ok'|'abgelehnt'} */ (a.ergebnis), a.von, a.bemerkung);
    else if (a.art === "angebot") patch = angebotPatch(a.sw, a.preis);
    else if (a.art === "entscheidung") patch = kaeuferEntscheidungPatch(a.sw, /** @type {'freigegeben'|'abgelehnt'} */ (a.ergebnis), a.von, { bemerkung: a.bemerkung, frist });
    else if (a.art === "einarbeitung") patch = einarbeitungPatch(a.sw, a.von, a.bemerkung);
    else if (a.art === "abnahme") patch = abnahmePatch(a.sw, a.von);
    if (!patch) { setFehler(t("Schritt nicht möglich: Status, Name oder Preis fehlt")); return; }
    try {
      await bitApi.entities.Sonderwunsch.update(a.sw.id, patch);
      // The released product goes into the sample register of the apartment (one list of released products).
      if (a.art === "entscheidung" && patch.status === "freigegeben") {
        const b = bemusterungAusSonderwunsch({ ...a.sw, ...patch }, auswahl, { projectId, alle: muster });
        // A retry after a failed write must not file the sample twice.
        if (b && !muster.some((m) => m.sonderwunsch_id === a.sw.id)) await bitApi.entities.Bemusterung.create({ ...b, created_date: new Date().toISOString() });
      }
      setAktion(null);
      await laden();
    } catch (err) { setFehler(`${t("Sonderwunsch konnte nicht gespeichert werden")}: ${fehlerText(err)}`); }
  });

  const protokoll = () => einmal(async () => {
    if (!auswahl) return;
    setFehler(null); setMeldung(null);
    try {
      const { bytes, dateiname, anzahl } = await bemusterungsProtokollPdf({ projekt, muster, wohnung: auswahl });
      dateiAnbieten(bytes, dateiname, "application/pdf");
      const daten64 = await fileToDataUrl(new Blob([/** @type {BlobPart} */ (/** @type {unknown} */ (bytes))], { type: "application/pdf" }));
      const r = await dokumentAblegen({ projectId, name: dateiname, typ: "Protokoll", daten: String(daten64), notiz: `Bemusterungsprotokoll Wohnung ${auswahl.nr}, ${anzahl} Muster` });
      setMeldung(r.ok ? t("Protokoll abgelegt unter Berichtswesen / Protokolle") : `${t("Protokoll nicht abgelegt")}: ${r.grund || ""}`);
    } catch (err) { setFehler(`${t("Protokoll konnte nicht erzeugt werden")}: ${fehlerText(err)}`); }
  });

  const setze = (/** @type {string} */ k, /** @type {string} */ v) => setFormular((f) => f && { ...f, [k]: v });
  const feld = (/** @type {string} */ key, /** @type {string} */ label, props = {}) => (
    <div className="space-y-1">
      <Label htmlFor={`sw-form-${key}`}>{t(label)}</Label>
      <Input id={`sw-form-${key}`} data-testid={`sw-form-${key}`} value={formular?.[key] ?? ""} onChange={(e) => setze(key, e.target.value)} {...props} />
    </div>
  );

  /** Step buttons of a request row (only the next step of the chain). */
  const schritte = (/** @type {any} */ sw) => {
    if (sw.status === "angefragt") {
      return offeneFreigaben(sw).map((r) => (
        <Button key={r} size="sm" variant="outline" data-testid={`sw-aktion-pruefung-${r}`} onClick={() => aktionStarten(sw, "pruefung", { rolle: r })}>{t("Prüfung")}: {t(rolleLabel(r))}</Button>
      ));
    }
    if (sw.status === "geprueft") return <Button size="sm" variant="outline" data-testid="sw-aktion-angebot" onClick={() => aktionStarten(sw, "angebot")}>{t("Anbieten")}</Button>;
    if (sw.status === "angeboten") {
      return (<>
        <Button size="sm" data-testid="sw-aktion-freigeben" onClick={() => aktionStarten(sw, "entscheidung", { ergebnis: "freigegeben" })}>{t("Käufer gibt frei")}</Button>
        <Button size="sm" variant="ghost" data-testid="sw-aktion-ablehnen" onClick={() => aktionStarten(sw, "entscheidung", { ergebnis: "abgelehnt" })}>{t("Käufer lehnt ab")}</Button>
      </>);
    }
    if (sw.status === "freigegeben") return <Button size="sm" variant="outline" data-testid="sw-aktion-einarbeitung" onClick={() => aktionStarten(sw, "einarbeitung")}>{t("Eingearbeitet")}</Button>;
    if (sw.status === "eingearbeitet") return <Button size="sm" variant="outline" data-testid="sw-aktion-abnahme" onClick={() => aktionStarten(sw, "abnahme")}>{t("Abgenommen")}</Button>;
    return null;
  };

  const ampelBadge = (/** @type {string|null|undefined} */ a) => (a
    ? <span className={`inline-block rounded border px-1.5 py-0.5 text-xs ${AMPEL_KLASSE[a] || ""}`}>{t(AMPEL_TEXT[a] || a)}</span>
    : null);

  return (
    <Card data-testid="sw-reiter">
      <CardHeader className="pb-2 flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="text-base">{t("Wohnungen & Sonderwünsche")} ({aktive.length})</CardTitle>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" data-testid="sw-abgleich" onClick={abgleichPruefen}>
            <RefreshCw className="w-4 h-4 mr-1" />{wohnungen.length ? t("Mit dem Modell abgleichen") : t("Wohnungen aus dem Modell übernehmen")}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {abgleich && (
          <div className="rounded-md border border-border bg-muted/40 p-3 space-y-2" data-testid="sw-abgleich-panel">
            <p className="text-sm">
              {t("Im Modell: {n} Wohnungen. Gleich: {g}, geändert: {a}, neu: {neu}, entfallen: {e}.")
                .replace("{n}", String(abgleich.anzahl)).replace("{g}", String(abgleich.ergebnis.gleich.length))
                .replace("{a}", String(abgleich.ergebnis.geaendert.length)).replace("{neu}", String(abgleich.ergebnis.neu.length))
                .replace("{e}", String(abgleich.ergebnis.entfallen.length))}
            </p>
            {abgleich.meldungen.length > 0 && (
              <ul className="text-xs space-y-1 max-h-48 overflow-y-auto">
                {abgleich.meldungen.map((m, i) => (
                  <li key={i} data-testid="sw-abgleich-zeile" data-art={m.art} data-stufe={m.stufe} data-nr={m.nr}
                    className={m.stufe === "warn" ? "text-warnung" : "text-muted-foreground"}>
                    <span className="font-mono">{m.nr || t("neu")}</span>{" · "}
                    {m.art === "entfallen" ? t("nicht mehr im Modell")
                      : m.art === "neu" ? m.text
                      : m.abweichungen.map((a) => (a.feld === "flaeche_m2" ? `${t("Fläche")} ${m2(a.alt)} → ${m2(a.neu)} m²`
                        : a.feld === "entfallen" ? t("wieder im Modell")
                        : a.feld === "typ" ? `${t("Typ")} ${a.alt || "—"} → ${a.neu || "—"}`
                        : `${t("Zimmer")} ${a.alt ?? "—"} → ${a.neu ?? "—"}`)).join(" · ")}
                    {m.stufe === "warn" && <> · {t("Käufer oder Sonderwunsch betroffen")}</>}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted-foreground">{t("Nummern bleiben; entfallene Wohnungen werden markiert, nicht gelöscht.")}</p>
            <div className="flex gap-2 justify-end">
              <Button size="sm" variant="ghost" onClick={() => setAbgleich(null)}>{t("Abbrechen")}</Button>
              <Button size="sm" data-testid="sw-abgleich-uebernehmen" disabled={laeuft} onClick={abgleichUebernehmen}>{t("Abgleich übernehmen")}</Button>
            </div>
          </div>
        )}

        {geladen && aktive.length === 0 && !abgleich && (
          <p className="text-sm text-muted-foreground">
            {t("Noch keine Wohnungen gespeichert. Den Zuschnitt aus der Wohnungs-Werkstatt oder den Riegeln übernehmen — die Nummern bleiben danach stabil.")}{" "}
            <Link to="/ComplexDesigner" className="text-primary underline-offset-4 hover:underline">{t("Zum Komplex-Designer")}</Link>
          </p>
        )}

        {aktive.length > 0 && (
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2 space-y-2">
              <div className="flex flex-wrap items-center gap-1" role="group" aria-label={t("Geschoss")}>
                {geschosse.map((g) => (
                  <Button key={g} size="sm" variant={g === aktGeschoss ? "default" : "outline"} data-testid={`sw-geschoss-${g}`} aria-pressed={g === aktGeschoss} onClick={() => setGeschoss(g)}>
                    {geschossLabel(g)}
                  </Button>
                ))}
                <span className="ml-auto flex flex-wrap gap-1">{["rot", "gelb", "gruen", "offen"].map((a) => <React.Fragment key={a}>{ampelBadge(a)}</React.Fragment>)}</span>
              </div>
              <WohnungsPlan wohnungen={aktive.filter((w) => Math.round(Number(w.geschoss) || 0) === aktGeschoss)} lichter={lichter} auswahlId={auswahlId} onWaehlen={waehlen} />
              {entfallene.length > 0 && (
                <p className="text-xs text-muted-foreground">{t("Nicht mehr im Modell")}: {entfallene.map((w) => w.nr).join(", ")}</p>
              )}
            </div>

            <div className="space-y-3 rounded-md border border-border bg-card p-3" data-testid="sw-wohnung" data-nr={auswahl?.nr || ""}>
              {!auswahl ? (
                <p className="text-sm text-muted-foreground">{t("Wohnung im Plan wählen.")}</p>
              ) : (<>
                <div>
                  <h3 className="text-sm font-semibold">{t("Wohnung")} {auswahl.nr}</h3>
                  <p className="text-xs text-muted-foreground">{geschossLabel(auswahl.geschoss)} · {auswahl.typ || "—"} · {m2(auswahl.flaeche_m2)} m²{auswahl.zimmer ? ` · ${auswahl.zimmer} ${t("Zi.")}` : ""}</p>
                  {auswahl.entfallen && <p className="text-xs text-warnung">{t("nicht mehr im Modell")}</p>}
                </div>
                <div className="space-y-2">
                  <div className="space-y-1">
                    <Label htmlFor="sw-w-status">{t("Verkaufsstand")}</Label>
                    <select id="sw-w-status" data-testid="sw-w-status" className={AUSWAHL} value={verkauf.status} onChange={(e) => setVerkauf({ ...verkauf, status: e.target.value })}>
                      {WOHNUNG_STATUS.map((s) => <option key={s.key} value={s.key}>{t(s.label)}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="sw-w-kaeufer">{t("Käufer")}</Label>
                    <Input id="sw-w-kaeufer" data-testid="sw-w-kaeufer" value={verkauf.kaeufer} onChange={(e) => setVerkauf({ ...verkauf, kaeufer: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="sw-w-bauabschnitt">{t("Bauabschnitt")}</Label>
                    <Input id="sw-w-bauabschnitt" data-testid="sw-w-bauabschnitt" list="sw-abschnitte" value={verkauf.bauabschnitt} onChange={(e) => setVerkauf({ ...verkauf, bauabschnitt: e.target.value })} />
                    <datalist id="sw-abschnitte">{abschnitte.map((a) => <option key={a} value={a} />)}</datalist>
                  </div>
                  <Button size="sm" variant="outline" data-testid="sw-w-speichern" disabled={laeuft || !wohnungPatch(auswahl, verkauf)} onClick={verkaufSpeichern}>{t("Speichern")}</Button>
                </div>
                <div className="text-xs space-y-0.5 border-t border-border pt-2">
                  <div className="flex justify-between"><span>{t("Beauftragte Sonderwünsche")}</span><span className="tabular-nums" data-testid="sw-summe-beauftragt">{eur(summe.beauftragt)}</span></div>
                  <div className="flex justify-between text-muted-foreground"><span>{t("Angeboten, offen")}</span><span className="tabular-nums">{eur(summe.angeboten)}</span></div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" data-testid="sw-neu" onClick={() => setFormular({ ...LEER_WUNSCH })}><Plus className="w-4 h-4 mr-1" />{t("Sonderwunsch erfassen")}</Button>
                  <Button size="sm" variant="outline" data-testid="sw-pdf" disabled={laeuft} onClick={protokoll}>{t("Bemusterungsprotokoll der Wohnung (PDF)")}</Button>
                </div>
              </>)}
            </div>
          </div>
        )}

        {auswahl && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">{t("Sonderwünsche")} {auswahl.nr} ({eigene.length})</h3>
            {eigene.length === 0 ? <p className="text-sm text-muted-foreground">{t("Noch keine Sonderwünsche für diese Wohnung.")}</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground border-b border-border">
                      <th className="py-2 px-2">{t("Nr.")}</th>
                      <th className="py-2 px-2">{t("Wunsch")}</th>
                      <th className="py-2 px-2">{t("Gewerk")}</th>
                      <th className="py-2 px-2 text-right">{t("Preis")}</th>
                      <th className="py-2 px-2">{t("Freigaben")}</th>
                      <th className="py-2 px-2">{t("Status")}</th>
                      <th className="py-2 px-2">{t("Entscheidung bis")}</th>
                      <th className="py-2 px-2">{t("Hinweise")}</th>
                      <th className="py-2 px-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {eigene.map((sw) => {
                      const z = zustand.get(sw.id);
                      const ok = new Set((sw.pruefungen || []).filter((p) => p.ergebnis === "ok").map((p) => p.rolle));
                      return (
                        <tr key={sw.id} className="border-b border-border last:border-0 align-top" data-testid="sw-zeile" data-nr={sw.nr} data-status={sw.status} data-ampel={z?.ampel || ""}>
                          <td className="py-1.5 px-2 font-mono text-xs">{sw.nr}</td>
                          <td className="py-1.5 px-2">{sw.beschreibung || "—"}{sw.raum && <div className="text-xs text-muted-foreground">{sw.raum}</div>}
                            {(sw.fabrikat || sw.farbe) && <div className="text-xs text-muted-foreground">{[sw.fabrikat, sw.produkt, sw.farbe, sw.oberflaeche].filter(Boolean).join(" · ")}</div>}</td>
                          <td className="py-1.5 px-2 text-xs">{gewerkLabel(sw.gewerk_lb)}</td>
                          <td className="py-1.5 px-2 text-right text-xs tabular-nums">{sw.preis_eur === null || sw.preis_eur === undefined ? "—" : eur(sw.preis_eur)}</td>
                          <td className="py-1.5 px-2 text-xs">
                            <div className="text-muted-foreground">{t(SCHWERE.find((s) => s.key === wirksameSchwere(sw))?.label || "")}</div>
                            {noetigeFreigaben(sw).map((r) => <div key={r} className={ok.has(r) ? "text-erfolg" : ""}>{ok.has(r) ? "✓" : "○"} {t(rolleLabel(r))}</div>)}
                          </td>
                          <td className="py-1.5 px-2 text-xs">{t(swStatusLabel(sw.status))}
                            {sw.entscheidung && <div className="text-muted-foreground">{sw.entscheidung.von}, {datum(sw.entscheidung.am)}</div>}
                            {sw.abgelehnt_grund && <div className="text-muted-foreground">{sw.abgelehnt_grund}</div>}</td>
                          <td className="py-1.5 px-2 text-xs">
                            {z?.frist ? <div className="tabular-nums">{datum(z.frist.frist)}</div> : <div className="text-muted-foreground">—</div>}
                            {OFFEN.includes(sw.status) && z?.frist && <div className="text-muted-foreground">{t("noch {n} Tage").replace("{n}", String(tageBis(heute, z.frist.frist)))}</div>}
                            {z?.verschoben_tage ? <div className="text-hinweis">{t("verschoben um {n} Tage").replace("{n}", String(z.verschoben_tage))}</div> : null}
                            {ampelBadge(z?.ampel)}
                          </td>
                          <td className="py-1.5 px-2 text-xs">{sonderwunschHinweise(sw).map((h) => <div key={h.code} data-code={h.code} className={h.stufe === "warn" ? "text-warnung" : "text-muted-foreground"}>{t(h.text)}</div>)}</td>
                          <td className="py-1.5 px-2"><div className="flex flex-wrap gap-1 justify-end">{schritte(sw)}</div></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {matrix.zeilen.length > 0 && matrix.gewerke.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">{t("Entscheidungsfristen je Wohnung und Gewerk")}</h3>
            <p className="text-xs text-muted-foreground">
              {t("Spätester Freigabetermin = Beginn des Gewerks im Bauabschnitt der Wohnung minus {n} Tage; ändert sich mit dem Bauablauf.").replace("{n}", String(FRIST_VORLAUF_TAGE))}
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs" data-testid="sw-matrix">
                <thead>
                  <tr className="text-left text-muted-foreground border-b border-border">
                    <th className="py-2 px-2">{t("Wohnung")}</th>
                    {matrix.gewerke.map((lb) => <th key={lb} className="py-2 px-2 font-normal" title={gewerkLabel(lb)}>{lb} {STLB_LB.find((g) => g.lb === lb)?.name.split(/[ ,–-]/)[0] || ""}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {matrix.zeilen.map((z) => (
                    <tr key={z.wohnung.id} className={`border-b border-border last:border-0 cursor-pointer ${z.wohnung.id === auswahlId ? "bg-muted/50" : ""}`} onClick={() => waehlen(z.wohnung.id)}>
                      <td className="py-1 px-2 font-mono">{z.wohnung.nr}</td>
                      {matrix.gewerke.map((lb) => {
                        const c = z.zellen[lb];
                        return (
                          <td key={lb} className="py-1 px-1" data-testid="sw-matrix-zelle" data-nr={z.wohnung.nr} data-lb={lb} data-ampel={c.ampel || ""} data-frist={c.frist?.frist || ""}>
                            <span className={`inline-block rounded border px-1.5 py-0.5 tabular-nums ${c.ampel ? AMPEL_KLASSE[c.ampel] : "border-transparent text-muted-foreground"}`}>
                              {c.frist ? datum(c.frist.frist) : "—"}{c.anzahl > 0 ? ` (${c.anzahl})` : ""}
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <AusstattungsKatalog projectId={projectId} katalog={katalog} onGeaendert={laden} />

        {meldung && <p className="text-sm text-erfolg" data-testid="sw-meldung">{meldung}</p>}
        {fehler && <p className="text-sm text-fehler" role="alert" data-testid="sw-fehler">{fehler}</p>}
      </CardContent>

      {formular && auswahl && (
        <FormModal title={`${t("Sonderwunsch erfassen")} · ${auswahl.nr}`} onClose={() => setFormular(null)}>
          <form onSubmit={wunschSpeichern} className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="sw-form-katalog_option_id">{t("Aus dem Katalog")}</Label>
              <select id="sw-form-katalog_option_id" data-testid="sw-form-katalog_option_id" className={AUSWAHL} value={formular.katalog_option_id} onChange={(e) => setze("katalog_option_id", e.target.value)}>
                <option value="">{t("freier Wunsch (ohne Katalog)")}</option>
                {katalog.filter((o) => o.aktiv !== false).map((o) => <option key={o.id} value={o.id}>{o.nr} · {o.bezeichnung} ({eur(o.preis_eur)} / {o.einheit || "psch"})</option>)}
              </select>
            </div>
            {feld("beschreibung", "Beschreibung", { required: !option, placeholder: option?.bezeichnung || t("z. B. zusätzliche Steckdose im Flur") })}
            <div className="grid grid-cols-2 gap-3">
              {feld("raum", "Raum")}
              {feld("menge", "Menge", { inputMode: "decimal" })}
              {!option && (<>
                <div className="space-y-1 col-span-2">
                  <Label htmlFor="sw-form-gewerk_lb">{t("Gewerk")}</Label>
                  <select id="sw-form-gewerk_lb" data-testid="sw-form-gewerk_lb" className={AUSWAHL} value={formular.gewerk_lb} onChange={(e) => setze("gewerk_lb", e.target.value)}>
                    <option value="">—</option>
                    {STLB_LB.map((g) => <option key={g.lb} value={g.lb}>{g.lb} {g.name}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="sw-form-schwere">{t("Eingriff")}</Label>
                  <select id="sw-form-schwere" data-testid="sw-form-schwere" className={AUSWAHL} value={formular.schwere} onChange={(e) => setze("schwere", e.target.value)}>
                    <option value="">{t("nicht eingestuft (Grundriss)")}</option>
                    {SCHWERE.map((s) => <option key={s.key} value={s.key}>{t(s.label)}</option>)}
                  </select>
                </div>
                {feld("preis_eur", "Preis (€ brutto)", { inputMode: "decimal" })}
              </>)}
              {feld("fabrikat", "Fabrikat")}
              {feld("produkt", "Produkt")}
              <div className="space-y-1">
                <Label htmlFor="sw-form-farbe_system">{t("Farbsystem")}</Label>
                <select id="sw-form-farbe_system" data-testid="sw-form-farbe_system" className={AUSWAHL} value={formular.farbe_system} onChange={(e) => setze("farbe_system", e.target.value)}>
                  <option value="RAL">RAL</option><option value="NCS">NCS</option><option value="sonstig">{t("sonstig")}</option>
                </select>
              </div>
              {feld("farbe", "Farbe")}
              <div className="space-y-1 col-span-2">
                <Label htmlFor="sw-form-oberflaeche">{t("Oberfläche")}</Label>
                <Input id="sw-form-oberflaeche" data-testid="sw-form-oberflaeche" list="sw-oberflaechen" value={formular.oberflaeche} onChange={(e) => setze("oberflaeche", e.target.value)} />
                <datalist id="sw-oberflaechen">{OBERFLAECHEN.map((o) => <option key={o} value={o} />)}</datalist>
              </div>
            </div>
            <div className="text-xs text-muted-foreground space-y-0.5" data-testid="sw-form-vorschau">
              <div>{t("Freigabe durch")}: {formFreigaben.map((r) => t(rolleLabel(r))).join(" + ")}</div>
              <div>{t("Entscheidung bis")}: {formFrist ? `${datum(formFrist.frist)} (${t("Beginn")} ${datum(formFrist.beginn)})` : t("ohne Termin im Bauablauf")}</div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="ghost" onClick={() => setFormular(null)}>{t("Abbrechen")}</Button>
              <Button type="submit" data-testid="sw-speichern" disabled={laeuft}>{t("Speichern")}</Button>
            </div>
          </form>
        </FormModal>
      )}

      {aktion && (
        <FormModal title={`${aktion.sw.nr} · ${aktion.art === "pruefung" ? `${t("Prüfung")}: ${t(rolleLabel(String(aktion.rolle)))}`
          : aktion.art === "angebot" ? t("Anbieten")
          : aktion.art === "entscheidung" ? (aktion.ergebnis === "freigegeben" ? t("Käufer gibt frei") : t("Käufer lehnt ab"))
          : aktion.art === "einarbeitung" ? t("Eingearbeitet") : t("Abgenommen")}`} onClose={() => setAktion(null)}>
          <div className="space-y-3">
            <p className="text-sm">{aktion.sw.beschreibung}</p>
            {aktion.art === "entscheidung" && zustand.get(aktion.sw.id)?.zu_spaet && (
              <p className="text-sm text-warnung" data-testid="sw-a-zu-spaet">{t("Frist abgelaufen — Freigabe nur noch als Nachtrag mit Rückbau-/Terminrisiko.")}</p>
            )}
            {aktion.art === "pruefung" && (
              <div className="space-y-1">
                <Label htmlFor="sw-a-ergebnis">{t("Ergebnis")}</Label>
                <select id="sw-a-ergebnis" data-testid="sw-a-ergebnis" className={AUSWAHL} value={aktion.ergebnis} onChange={(e) => setAktion({ ...aktion, ergebnis: e.target.value })}>
                  <option value="ok">{t("technisch freigegeben")}</option>
                  <option value="abgelehnt">{t("technisch nicht möglich")}</option>
                </select>
              </div>
            )}
            {aktion.art === "angebot" ? (
              <div className="space-y-1">
                <Label htmlFor="sw-a-preis">{t("Preis (€ brutto)")}</Label>
                <Input id="sw-a-preis" data-testid="sw-a-preis" inputMode="decimal" value={aktion.preis} onChange={(e) => setAktion({ ...aktion, preis: e.target.value })} />
              </div>
            ) : (
              <div className="space-y-1">
                <Label htmlFor="sw-a-von">{aktion.art === "entscheidung" ? t("Käufer / Vertreter") : t("Name")}</Label>
                <Input id="sw-a-von" data-testid="sw-a-von" value={aktion.von} onChange={(e) => setAktion({ ...aktion, von: e.target.value })} />
              </div>
            )}
            {aktion.art !== "angebot" && aktion.art !== "abnahme" && (
              <div className="space-y-1">
                <Label htmlFor="sw-a-bemerkung">{t("Bemerkung")}</Label>
                <Input id="sw-a-bemerkung" value={aktion.bemerkung} onChange={(e) => setAktion({ ...aktion, bemerkung: e.target.value })}
                  placeholder={aktion.art === "einarbeitung" ? t("z. B. Grundriss 1. OG, Index c") : ""} />
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setAktion(null)}>{t("Abbrechen")}</Button>
              <Button data-testid="sw-a-speichern" disabled={laeuft || (aktion.art === "angebot" ? !aktion.preis.trim() : !aktion.von.trim())} onClick={aktionAusfuehren}>{t("Speichern")}</Button>
            </div>
          </div>
        </FormModal>
      )}
    </Card>
  );
}
