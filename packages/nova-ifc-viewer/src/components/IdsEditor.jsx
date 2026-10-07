// IdsEditor.jsx — write your own IDS rule in the check suite (Phase 69-08).
//
// Why: the page promises "rules that adapt exactly to your project", but until
// now the demo could only READ .ids files, not write them (finding P-09). This
// is the high point of the demo path (bundle C): pick a class, a property set
// and a property (typed OR chosen from the loaded model), decide what the
// property must satisfy — and re-run at once; the new rule shows up in the
// result marked "eigene Regel".
//
// Deliberately NOT offered: the classification, material and partOf facets.
// The editor is the four-step path the demo shows (entity → property → value);
// the other facets need their own input logic (classification systems, material
// names, host-element relations) and partOf is not even evaluated by ids.js nor
// writable by idsWriter. Uploaded files may carry them: they are kept, checked
// where ids.js can, and partOf is left out of the download with a notice
// (schreibbareSpecs) — see 69-08-SUMMARY.
//
// Persistence: own specs live per project in the BimModel field
// `pruefung_layer` = { eigene_specs: Spec[] } (NOT localStorage), stored
// JSON-safe (specFuerSpeicher) over loadBimModel/saveBimModel with the
// Fachlayer guards replicated from BcfIssues — useFachlayer.js lives in
// @designer, which @ifc must not import (import boundary).
//
// Accessibility (rules of the 27.09. review): every control has a visible
// <label>, native elements only (focus ring via focus-visible:ring-2), the
// icon-only delete button carries the rule name, validation marks the fields
// with aria-invalid + aria-describedby and moves focus to the first invalid
// one, focus never drops to <body> after a delete (NB-22 lesson), disabled
// controls point to the visible reason. Native elements instead of the shadcn
// Button/Input also keep `tsc` at 0 for this file (their JSDoc types reject
// every prop, lesson 3 of the Hermes handoff).
//
// In:  projectId, the parsed model elements (suggestions), onSpecs (current
//      own specs in run form, upward —
//      one-directional, no write-back loop), onErneutPruefen + pruefungMoeglich
//      (the page's run), semantikFehlt (model without property sets).
// Out: UI; side effects: BimModel field pruefung_layer, .ids download, toasts.

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Download, Upload, RefreshCw } from "lucide-react";
import { useI18n } from "@core/lib/i18n";
import { loadBimModel, saveBimModel } from "@core/lib/useBimModelSync";
import { schreibeIds } from "@ifc/lib/idsWriter";
import { parseIdsXml } from "@ifc/lib/ids";
import {
  SPECS_KEY, leereEingabe, leeresLayer, specAusEingabe, automatischerName,
  vorschlaegeAusModell, psetVorschlaege, propertyVorschlaege, regelZusammenfassung,
  specFuerSpeicher, specsFuerLauf, layerAusSpeicher, fuegeSpecsZusammen, schreibbareSpecs,
  writerWarnungTeilen, namensSchluessel,
} from "@ifc/lib/idsEditorKern";

/** The BimModel field this editor owns exclusively (Fachlayer rule 1). */
const LAYER_FELD = "pruefung_layer";
/** Debounce of the layer save in milliseconds (same as useFachlayer). */
const SPEICHER_VERZUG_MS = 1200;

/** Keyboard focus ring for every native control (A11Y-I18N-04: ring-2). */
const FOKUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-1";
const KNOPF_RAHMEN = `inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 ${FOKUS}`;
const KNOPF_VOLL = `inline-flex h-8 items-center gap-1.5 rounded-md bg-violet-600 px-3 text-xs font-medium text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50 ${FOKUS}`;

/**
 * Class of a text field / select, red border when invalid.
 * @param {boolean} ungueltig
 * @returns {string}
 */
const feldKlasse = (ungueltig) =>
  `h-9 w-full rounded-md border bg-white px-3 text-sm text-slate-800 placeholder:text-slate-400 ${ungueltig ? "border-rose-500" : "border-slate-300"} ${FOKUS}`;

/**
 * Replace a {{name}} placeholder; the function form keeps "$&" in user text
 * literal (NA-12: String.replace with a string pattern expands it).
 * @param {string} text translated template
 * @param {string} platz placeholder name without braces
 * @param {string|number} wert
 * @returns {string}
 */
const fuellen = (text, platz, wert) => text.replace(`{{${platz}}}`, () => String(wert));

/**
 * "Own IDS rules" card: four-step form + rule list + re-run + .ids download
 * and upload (round-trip through the 71-01 writer and the phase-64 parser).
 * @param {{projectId?: string|null, elemente?: any[],
 *   onSpecs?: (specs: object[]) => void, onErneutPruefen?: () => void,
 *   pruefungMoeglich?: boolean, semantikFehlt?: boolean}} props
 * @returns {JSX.Element}
 */
export default function IdsEditor({
  projectId, elemente = [], onSpecs, onErneutPruefen,
  pruefungMoeglich = false, semantikFehlt = false,
}) {
  const { t } = useI18n();
  const id = useId();

  // --- Layer state with the Fachlayer guards (rules 1-4, replicated from
  // BcfIssues — the hook itself lives in @designer, import boundary) ---------
  const [layer, setLayer] = useState(() => leeresLayer());
  const loadingRef = useRef(false);
  const lastSaved = useRef(JSON.stringify(leeresLayer()));
  const pendingRef = useRef(null); // { pid, state } for the unmount/switch flush
  // Mirrors loadingRef for the render: while the stored layer loads, adding a
  // rule would be dropped by the guard — the form is disabled instead of
  // swallowing the click (the useFachlayer "first second" finding, 72-13).
  const [layerLaedt, setLayerLaedt] = useState(false);

  /**
   * Change the own specs (ignored while the stored layer loads).
   * @param {(liste: object[]) => object[]} fn
   */
  const aendereSpecs = useCallback((fn) => {
    if (loadingRef.current) return;
    setLayer((p) => ({ ...p, [SPECS_KEY]: fn(Array.isArray(p[SPECS_KEY]) ? p[SPECS_KEY] : []) }));
  }, []);

  // Load on project switch + flush of the previous project.
  useEffect(() => {
    const pend = pendingRef.current;
    if (pend && pend.pid !== projectId) {
      pendingRef.current = null;
      if (JSON.stringify(pend.state) !== lastSaved.current) {
        saveBimModel(pend.pid, { [LAYER_FELD]: pend.state }).catch(() => {});
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
        const val = layerAusSpeicher(m ? m[LAYER_FELD] : null);
        lastSaved.current = JSON.stringify(val);
        setLayer(val);
      } catch {
        /* offline: the default stays; saving retries on the next change */
      } finally {
        loadingRef.current = false;
        if (!cancelled) setLayerLaedt(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Debounced save + visible error: a rule the visitor wrote must not vanish
  // silently (CLAUDE.md: errors in plain text, never swallowed).
  useEffect(() => {
    if (!projectId || loadingRef.current) return undefined;
    const sig = JSON.stringify(layer);
    if (sig === lastSaved.current) return undefined;
    pendingRef.current = { pid: projectId, state: layer };
    const timer = setTimeout(() => {
      lastSaved.current = sig;
      pendingRef.current = null;
      saveBimModel(projectId, { [LAYER_FELD]: layer }).catch((err) => {
        pendingRef.current = { pid: projectId, state: layer };
        lastSaved.current = "";
        toast.error(t("Eigene Regeln konnten nicht gespeichert werden: ") + (err?.message || String(err)));
      });
    }, SPEICHER_VERZUG_MS);
    return () => clearTimeout(timer);
  }, [projectId, layer, t]);

  useEffect(() => () => {
    const pend = pendingRef.current;
    if (pend && JSON.stringify(pend.state) !== lastSaved.current) {
      saveBimModel(pend.pid, { [LAYER_FELD]: pend.state }).catch(() => {});
    }
  }, []);

  /** The own specs in storage form — always an array. */
  const specs = useMemo(() => (Array.isArray(layer?.[SPECS_KEY]) ? layer[SPECS_KEY] : []), [layer]);
  // Current project and list for the undo action of the delete toast: the
  // toast lives a few seconds and may outlast a project switch or new edits.
  const projektRef = useRef(projectId);
  const specsRef = useRef(specs);
  useEffect(() => {
    projektRef.current = projectId;
    specsRef.current = specs;
  }, [projectId, specs]);
  // Run form (pattern RegExps rebuilt) upward, so the next run includes them.
  const laufSpecs = useMemo(() => specsFuerLauf(specs), [specs]);
  useEffect(() => {
    onSpecs?.(laufSpecs);
  }, [laufSpecs, onSpecs]);

  // --- Form ------------------------------------------------------------------
  const vor = useMemo(() => vorschlaegeAusModell(elemente), [elemente]);
  const [eingabe, setEingabe] = useState(leereEingabe);
  const [fehler, setFehler] = useState(/** @type {import("@ifc/lib/idsEditorKern").EingabeFehler[]} */ ([]));
  /** @type {React.MutableRefObject<Record<string, HTMLElement|null>>} */
  const feldRefs = useRef({});
  /** @type {React.MutableRefObject<Array<HTMLButtonElement|null>>} */
  const loeschRefs = useRef([]);
  // Row index to focus after a delete (-1 = back to the class field).
  const fokusNachLoeschen = useRef(/** @type {number|null} */ (null));

  /**
   * Set one text field; its validation message goes once the visitor edits it.
   * @param {"name"|"klasse"|"pset"|"property"|"wert"|"aufzaehlung"} feld
   * @param {string} wert
   */
  const setText = (feld, wert) => {
    setEingabe((p) => ({ ...p, [feld]: wert }));
    setFehler((f) => (f.some((x) => x.feld === feld) ? f.filter((x) => x.feld !== feld) : f));
  };

  /** @param {import("@ifc/lib/idsEditorKern").EingabeFeld} feld */
  const fehlerVon = (feld) => fehler.find((f) => f.feld === feld) || null;

  /**
   * Shared props of a form control: id, ref, aria-invalid, aria-describedby
   * (own hint + validation message).
   * @param {import("@ifc/lib/idsEditorKern").EingabeFeld} feld
   * @param {string} [hinweisId] id of a permanent hint text
   */
  const steuerung = (feld, hinweisId) => {
    const f = fehlerVon(feld);
    const beschrieben = [hinweisId, f ? `${id}-${feld}-fehler` : null].filter(Boolean).join(" ");
    return {
      id: `${id}-${feld}`,
      ref: (/** @type {HTMLElement|null} */ el) => { feldRefs.current[feld] = el; },
      "aria-invalid": f ? true : undefined,
      "aria-describedby": beschrieben || undefined,
    };
  };

  /** Validation message under a field (read out via aria-describedby). */
  const fehlerText = (/** @type {import("@ifc/lib/idsEditorKern").EingabeFeld} */ feld) => {
    const f = fehlerVon(feld);
    return f ? (
      <p id={`${id}-${feld}-fehler`} className="text-xs font-medium text-rose-700" data-testid={`ids-fehler-${feld}`}>
        {t(f.text)}
      </p>
    ) : null;
  };

  const regelHinzufuegen = (/** @type {React.FormEvent} */ ev) => {
    ev.preventDefault();
    if (layerLaedt) return;
    const { spec, fehler: neu } = specAusEingabe(eingabe, specs.map((s) => s.name));
    if (!spec) {
      setFehler(neu);
      // Keyboard and screen-reader users land on the problem, not on a toast.
      feldRefs.current[neu[0].feld]?.focus();
      return;
    }
    setFehler([]);
    aendereSpecs((liste) => [...liste, spec]);
    setEingabe(leereEingabe());
    toast.success(fuellen(t("Regel „{{name}}“ hinzugefügt — „Erneut prüfen“ wertet sie aus."), "name", spec.name));
    feldRefs.current.klasse?.focus(); // ready for the next rule
  };

  const regelLoeschen = (/** @type {number} */ i) => {
    const spec = specs[i];
    if (!spec || layerLaedt) return; // the guard would drop it; no focus jump later
    const pid = projectId;
    fokusNachLoeschen.current = specs.length > 1 ? Math.min(i, specs.length - 2) : -1;
    aendereSpecs((liste) => liste.filter((_, j) => j !== i));
    toast.success(fuellen(t("Regel „{{name}}“ gelöscht"), "name", spec.name), {
      action: {
        label: t("Rückgängig"),
        onClick: () => {
          // Restore only into the project the rule was deleted from, and never
          // as a second rule of the same name (one may have been added since).
          // The old index is clamped by slice when the list got shorter.
          if (projektRef.current !== pid) {
            toast.info(t("„Rückgängig“ ist nicht mehr möglich — das Projekt wurde gewechselt."));
            return;
          }
          if (specsRef.current.some((s) => namensSchluessel(s.name) === namensSchluessel(spec.name))) {
            toast.info(t("„Rückgängig“ ist nicht möglich — es gibt wieder eine Regel mit diesem Namen."));
            return;
          }
          aendereSpecs((liste) => [...liste.slice(0, i), spec, ...liste.slice(i)]);
        },
      },
    });
  };

  // After a delete the row is gone: focus the row that moved up, else the one
  // above, else the class field — never <body> (NB-22).
  useEffect(() => {
    const ziel = fokusNachLoeschen.current;
    if (ziel === null) return;
    fokusNachLoeschen.current = null;
    if (ziel >= 0 && loeschRefs.current[ziel]) loeschRefs.current[ziel].focus();
    else feldRefs.current.klasse?.focus();
  }, [specs]);

  // --- .ids download (71-01 writer) and upload (64 parser) -------------------
  const dateiInputRef = useRef(/** @type {HTMLInputElement|null} */ (null));

  const herunterladen = () => {
    if (!specs.length) {
      toast.error(t("Es gibt noch keine eigenen Regeln zum Herunterladen."));
      return;
    }
    try {
      const { specs: schreibbar, ohnePartOf } = schreibbareSpecs(specs);
      // No author on purpose. ids.xsd (IDS 1.0) allows only an e-mail address
      // in info/author, and the <info> sequence is title, copyright, version,
      // description, author … — the office name passed before made the file
      // invalid, and the 71-01 writer emits author BEFORE version, so even an
      // address would. title + version alone are valid. Fixing the writer
      // order changes the generated rohbau-referenz.ids (drift test T-71-03):
      // follow-up of 71-01, see 69-08-SUMMARY.
      const { xml, warnungen } = schreibeIds(schreibbar, { title: t("Eigene Prüfregeln") });
      const blob = new Blob([xml], { type: "application/xml" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "eigene-pruefregeln.ids";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success(specs.length === 1
        ? t("1 eigene Regel als .ids heruntergeladen")
        : fuellen(t("{{anzahl}} eigene Regeln als .ids heruntergeladen"), "anzahl", specs.length));
      if (ohnePartOf.length) {
        toast.warning(t("Ohne partOf-Facetten geschrieben (die Prüf-Suite wertet sie nicht aus): ") + ohnePartOf.join(", "));
      }
      // The writer speaks German; translate its fixed lead text, keep the
      // quoted name as it is.
      for (const w of warnungen) {
        const { schluessel, rest } = writerWarnungTeilen(w);
        toast.warning(schluessel ? t(schluessel) + rest : w);
      }
    } catch (err) {
      toast.error(t("Download fehlgeschlagen: ") + (err?.message || String(err)));
    }
  };

  const dateiGewaehlt = async (/** @type {React.ChangeEvent<HTMLInputElement>} */ ev) => {
    const datei = ev.target.files?.[0];
    ev.target.value = ""; // the same file must stay selectable
    if (!datei) return;
    try {
      const geladen = parseIdsXml(await datei.text());
      if (!geladen.length) {
        toast.info(t("Die Datei enthält keine Spezifikationen."));
        return;
      }
      // Storage form (no RegExp) + own marking; a rule named like an existing
      // one replaces it, the rest is appended — hand-written rules are never
      // dropped silently. Repeated names inside the file get a suffix.
      const neu = geladen.map((s) => specFuerSpeicher(s));
      const { ersetzt, umbenannt } = fuegeSpecsZusammen(specs, neu);
      aendereSpecs((liste) => fuegeSpecsZusammen(liste, neu).specs);
      const text = neu.length === 1
        ? t("1 Regel geladen — „Erneut prüfen“ wertet sie aus.")
        : fuellen(t("{{anzahl}} Regeln geladen — „Erneut prüfen“ wertet sie aus."), "anzahl", neu.length);
      const ersetztText = ersetzt === 1
        ? t("(1 vorhandene Regel gleichen Namens ersetzt)")
        : fuellen(t("({{anzahl}} vorhandene Regeln gleichen Namens ersetzt)"), "anzahl", ersetzt);
      toast.success(ersetzt ? `${text} ${ersetztText}` : text);
      if (umbenannt.length) toast.info(t("Doppelte Namen in der Datei umbenannt: ") + umbenannt.join(", "));
    } catch (err) {
      toast.error(t("IDS-Datei nicht lesbar: ") + (err?.message || String(err)));
    }
  };

  /**
   * One-line summary of a spec for the list.
   * @param {object} s spec
   * @returns {string}
   */
  const regelText = (s) => {
    const z = regelZusammenfassung(s);
    if (!z.property) {
      return `${z.klasse} · ${z.kardinalitaet === "prohibited" ? t("darf im Modell nicht vorkommen") : t("muss im Modell vorkommen")}`;
    }
    // Own keys, not t("vorhanden"): that one means "available" (volume) in the
    // drainage planner and must not be translated as "exists" there.
    const erwartung = {
      vorhanden: z.kardinalitaet === "prohibited" ? t("darf nicht vorhanden sein") : t("muss vorhanden sein"),
      wert: `= ${z.werte[0] ?? ""}`,
      liste: `${t("eines von")} ${z.werte.join(", ")}`,
      muster: `${t("Muster")} ${z.werte[0] ?? ""}`,
      einschraenkung: t("Einschränkung"),
    }[z.erwartung];
    const weitere = z.weitere > 0 ? ` · ${fuellen(t("+{{anzahl}} weitere Anforderungen"), "anzahl", z.weitere)}` : "";
    return `${z.klasse} · ${z.pset}.${z.property} ${erwartung}${weitere}`;
  };

  /** Cardinality shown as a tag when it is not the default. */
  const kardinalitaetVon = (/** @type {object} */ s) => regelZusammenfassung(s).kardinalitaet;

  const psetListe = psetVorschlaege(vor, eingabe.klasse);
  const propertyListe = propertyVorschlaege(vor, eingabe.klasse, eingabe.pset);
  const namensVorschlag = eingabe.klasse.trim() ? automatischerName(eingabe) : "";
  const pruefenHinweisId = `${id}-pruefen-hinweis`;

  return (
    <section
      aria-labelledby={`${id}-titel`}
      aria-busy={layerLaedt || undefined}
      className="space-y-3 rounded-xl border border-violet-200 bg-violet-50/50 p-4"
      data-testid="ids-editor"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 id={`${id}-titel`} className="text-sm font-semibold text-violet-900">{t("Eigene IDS-Regeln")}</h3>
        <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-800" data-testid="ids-eigen-anzahl">
          <span className="sr-only">{t("Anzahl")}: </span>{specs.length}
        </span>
        <div className="ml-auto flex flex-wrap gap-2">
          <button
            type="button"
            className={KNOPF_RAHMEN}
            onClick={() => dateiInputRef.current?.click()}
            disabled={layerLaedt}
            data-testid="ids-hochladen"
          >
            <Upload className="h-4 w-4" aria-hidden="true" /> {t(".ids laden")}
          </button>
          <button type="button" className={KNOPF_RAHMEN} onClick={herunterladen} data-testid="ids-download">
            <Download className="h-4 w-4" aria-hidden="true" /> {t("Als .ids herunterladen")}
          </button>
          <button
            type="button"
            className={KNOPF_VOLL}
            onClick={() => onErneutPruefen?.()}
            disabled={!pruefungMoeglich}
            aria-describedby={pruefungMoeglich ? undefined : pruefenHinweisId}
            data-testid="ids-erneut-pruefen"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" /> {t("Erneut prüfen")}
          </button>
        </div>
        <input
          ref={dateiInputRef}
          type="file"
          accept=".ids,.xml"
          onChange={dateiGewaehlt}
          className="hidden"
          tabIndex={-1}
          aria-hidden="true"
          data-testid="ids-editor-datei"
        />
      </div>

      <p className="text-xs text-slate-600">
        {t("Schreiben Sie eine Prüfregel in vier Schritten: Klasse, Property-Set und Eigenschaft, Anforderung, Name. Die Vorschläge stammen aus dem geladenen Modell; eigene Eingaben gehen immer.")}
      </p>
      {!pruefungMoeglich && (
        <p id={pruefenHinweisId} className="text-xs text-slate-600" data-testid="ids-pruefen-hinweis">
          {t("„Erneut prüfen“ ist möglich, sobald ein Modell geladen ist und kein Prüflauf läuft.")}
        </p>
      )}
      {semantikFehlt && (
        <p className="text-xs text-amber-800" data-testid="ids-ohne-semantik">
          {t("Für dieses Modell liegen keine Property-Sets vor — eigene Regeln werden erst an einem Modell mit Semantik ausgewertet.")}
        </p>
      )}

      {/* The four steps. <fieldset disabled> blocks every control while the
          stored rules load (the guard would drop the input otherwise). */}
      <form onSubmit={regelHinzufuegen} noValidate data-testid="ids-formular">
        <fieldset disabled={layerLaedt} className="space-y-3">
          <legend className="sr-only">{t("Neue Regel")}</legend>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-1">
              <label htmlFor={`${id}-klasse`} className="block text-xs font-medium text-slate-700">
                1 · {t("Klasse (IFC-Typ)")}
              </label>
              <input
                {...steuerung("klasse")}
                type="text"
                list={`${id}-klassen`}
                value={eingabe.klasse}
                onChange={(e) => setText("klasse", e.target.value)}
                placeholder="IfcWall"
                autoComplete="off"
                spellCheck={false}
                className={feldKlasse(!!fehlerVon("klasse"))}
                data-testid="ids-klasse"
              />
              <datalist id={`${id}-klassen`} data-testid="ids-klassen-liste">
                {vor.klassen.map((k) => <option key={k} value={k} />)}
              </datalist>
              {fehlerText("klasse")}
            </div>
            <div className="space-y-1">
              <label htmlFor={`${id}-pset`} className="block text-xs font-medium text-slate-700">
                2 · {t("Property-Set")}
              </label>
              <input
                {...steuerung("pset")}
                type="text"
                list={`${id}-psets`}
                value={eingabe.pset}
                onChange={(e) => setText("pset", e.target.value)}
                placeholder="Pset_WallCommon"
                autoComplete="off"
                spellCheck={false}
                className={feldKlasse(!!fehlerVon("pset"))}
                data-testid="ids-pset"
              />
              <datalist id={`${id}-psets`} data-testid="ids-psets-liste">
                {psetListe.map((p) => <option key={p} value={p} />)}
              </datalist>
              {fehlerText("pset")}
            </div>
            <div className="space-y-1">
              <label htmlFor={`${id}-property`} className="block text-xs font-medium text-slate-700">
                2 · {t("Eigenschaft")}
              </label>
              <input
                {...steuerung("property")}
                type="text"
                list={`${id}-properties`}
                value={eingabe.property}
                onChange={(e) => setText("property", e.target.value)}
                placeholder="FireRating"
                autoComplete="off"
                spellCheck={false}
                className={feldKlasse(!!fehlerVon("property"))}
                data-testid="ids-property"
              />
              <datalist id={`${id}-properties`} data-testid="ids-properties-liste">
                {propertyListe.map((p) => <option key={p} value={p} />)}
              </datalist>
              {fehlerText("property")}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-1">
              <label htmlFor={`${id}-wertArt`} className="block text-xs font-medium text-slate-700">
                3 · {t("Die Eigenschaft muss …")}
              </label>
              <select
                {...steuerung("wertArt")}
                value={eingabe.wertArt}
                onChange={(e) => setEingabe((p) => ({ ...p, wertArt: /** @type {import("@ifc/lib/idsEditorKern").WertArt} */ (e.target.value) }))}
                className={feldKlasse(false)}
                data-testid="ids-wertart"
              >
                <option value="pflicht">{t("vorhanden sein")}</option>
                <option value="wert">{t("einen bestimmten Wert haben")}</option>
                <option value="aufzaehlung">{t("einen Wert aus einer Liste haben")}</option>
              </select>
            </div>
            {eingabe.wertArt === "wert" && (
              <div className="space-y-1">
                <label htmlFor={`${id}-wert`} className="block text-xs font-medium text-slate-700">
                  3 · {t("Erwarteter Wert")}
                </label>
                <input
                  {...steuerung("wert")}
                  type="text"
                  value={eingabe.wert}
                  onChange={(e) => setText("wert", e.target.value)}
                  placeholder="REI30"
                  autoComplete="off"
                  className={feldKlasse(!!fehlerVon("wert"))}
                  data-testid="ids-wert"
                />
                {fehlerText("wert")}
              </div>
            )}
            {eingabe.wertArt === "aufzaehlung" && (
              <div className="space-y-1">
                <label htmlFor={`${id}-aufzaehlung`} className="block text-xs font-medium text-slate-700">
                  3 · {t("Erlaubte Werte (durch Semikolon getrennt)")}
                </label>
                <input
                  {...steuerung("aufzaehlung")}
                  type="text"
                  value={eingabe.aufzaehlung}
                  onChange={(e) => setText("aufzaehlung", e.target.value)}
                  placeholder="REI30; REI60; REI90"
                  autoComplete="off"
                  className={feldKlasse(!!fehlerVon("aufzaehlung"))}
                  data-testid="ids-aufzaehlung"
                />
                {fehlerText("aufzaehlung")}
              </div>
            )}
            <div className="space-y-1">
              <label htmlFor={`${id}-kardinalitaet`} className="block text-xs font-medium text-slate-700">
                3 · {t("Kardinalität")}
              </label>
              <select
                {...steuerung("kardinalitaet", `${id}-kardinalitaet-hinweis`)}
                value={eingabe.kardinalitaet}
                onChange={(e) => {
                  const wert = /** @type {import("@ifc/lib/idsEditorKern").Kardinalitaet} */ (e.target.value);
                  setEingabe((p) => ({ ...p, kardinalitaet: wert }));
                  setFehler((f) => f.filter((x) => x.feld !== "kardinalitaet"));
                }}
                className={feldKlasse(!!fehlerVon("kardinalitaet"))}
                data-testid="ids-kardinalitaet"
              >
                <option value="required">{t("required — gilt für jedes Bauteil der Klasse")}</option>
                <option value="optional">{t("optional — nur prüfen, wo die Eigenschaft vorhanden ist")}</option>
                <option value="prohibited">{t("prohibited — darf nicht vorkommen")}</option>
              </select>
              <p id={`${id}-kardinalitaet-hinweis`} className="text-[11px] text-slate-600">
                {t("Ohne Eigenschaft gilt die Wahl für die Klasse: required = muss im Modell vorkommen, prohibited = darf nicht vorkommen.")}
              </p>
              {fehlerText("kardinalitaet")}
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[16rem] flex-1 space-y-1">
              <label htmlFor={`${id}-name`} className="block text-xs font-medium text-slate-700">
                4 · {t("Name der Regel (optional)")}
              </label>
              <input
                {...steuerung("name")}
                type="text"
                value={eingabe.name}
                onChange={(e) => setText("name", e.target.value)}
                placeholder={namensVorschlag || t("wird aus den Angaben gebildet")}
                autoComplete="off"
                className={feldKlasse(!!fehlerVon("name"))}
                data-testid="ids-name"
              />
              {fehlerText("name")}
            </div>
            <button type="submit" className={`${KNOPF_VOLL} h-9`} data-testid="ids-hinzufuegen">
              <Plus className="h-4 w-4" aria-hidden="true" /> {t("Regel hinzufügen")}
            </button>
          </div>
        </fieldset>
      </form>

      {specs.length > 0 ? (
        <ul className="space-y-1" aria-label={t("Eigene IDS-Regeln")} data-testid="ids-regel-liste">
          {specs.map((s, i) => {
            const kard = kardinalitaetVon(s);
            return (
              <li
                key={`${s.name}-${i}`}
                className="flex items-center gap-2 rounded-lg border border-violet-200 bg-white px-3 py-1.5 text-xs"
                data-testid={`ids-regel-${i}`}
              >
                <span className="shrink-0 rounded bg-violet-100 px-1.5 py-0.5 text-violet-800">{t("eigene Regel")}</span>
                <span className="shrink-0 font-medium text-slate-800">{s.name}</span>
                <span className="min-w-0 flex-1 truncate text-slate-600" title={regelText(s)}>{regelText(s)}</span>
                {kard !== "required" && (
                  <span className="shrink-0 rounded border border-slate-300 px-1.5 py-0.5 text-slate-700">{kard}</span>
                )}
                <button
                  type="button"
                  ref={(el) => { loeschRefs.current[i] = el; }}
                  onClick={() => regelLoeschen(i)}
                  aria-label={fuellen(t("Regel „{{name}}“ löschen"), "name", s.name)}
                  title={fuellen(t("Regel „{{name}}“ löschen"), "name", s.name)}
                  className={`shrink-0 rounded p-1 text-rose-600 hover:bg-rose-50 ${FOKUS}`}
                  data-testid={`ids-regel-loeschen-${i}`}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-xs text-slate-600" data-testid="ids-leer">
          {t("Noch keine eigenen Regeln. Die erste entsteht oben in vier Schritten.")}
        </p>
      )}
    </section>
  );
}
