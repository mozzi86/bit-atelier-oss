// Fachlayer-Persistenz-Konvention (Phase 34, PW-04) — die KD-17-Regeln als
// wiederverwendbarer Hook, damit kein Fachplaner-Reiter die Guards nachbaut:
//
//   1. Je Reiter genau EIN eigenes Top-Level-Feld im BimModel (z.B.
//      "brandschutz_layer"). Der Server merged flach — zwei Schreiber auf
//      DEMSELBEN Feld überschreiben sich still. Feld-Registry (Stand 45):
//      Programmfelder (useBimModelSync; 86-07: + achseM, the centre line drawn in the
//      massing studio; 107-02: + geschosse; 107-13: + untergeschosse, the number of
//      basements 0 … 3, written only when not 0 or was not 0; 108-08: + footprintLageM, the
//      position of the massing body on the site in m, written only when the body was moved or
//      the field exists; since 108-08 the write-back sends only the changed programme fields) ·
//      Elementfelder (BitBimStudio) ·
//      brandschutz_layer (BrandschutzPlanner) · sketch_layer (BIT Sketcher via
//      useSketchLayer UND Grundriss-Sketch-Editor in BitBimStudio — beide über
//      saveBimModel, nie gleichzeitig gemountet [eigene Route vs. Tab]) ·
//      raumklima_layer (RaumklimaPlanner, Phase 45: northAngle + DIN-Optionen) ·
//      schallschutz_layer (SchallschutzPlanner, Phase 39: Pegel je Orientierung,
//      Raumarten je Zone, Adjazenz-Ausnahmen, Fenster-/Trennwand-R'w) ·
//      werkstatt_layer (WohnungsWerkstatt, Phase 61: Typologie, Einheiten-Liste,
//      angewendet-Flag; 61-06: keller { aktiv, optionen, mengen } — the basement
//      hand-over list for AVA / Phase 62 lives here, not in a second field; 75-12:
//      raumGrenzen { "<level>|<zoneA>|<zoneB>": m } — written by the workshop only, the
//      focus reaches it through the onRaumGrenzenChange callback; 86-04: zerlegung
//      "auto"|"rand" (86-07 "achse", 86-06 "skelett") + geschosseJeRiegel { "<k>": n }; 75-10:
//      bewertungsGewichte { "<dimension>": weight } via the proposals panel callback; 107-11 (v6):
//      per unit type optional dachschraege_quelle "geometrie"|"hand" + kniestock_m — all
//      written by the workshop) ·
//      netz_layer (TgaNetzEditor, Phase 41: knoten/kanten des TGA-Netzes je Gewerk,
//      mengen — Phase 63 erweitert dasselbe Feld additiv, kein zweites Leitungsmodell) ·
//      brandschutz_layer erweitert (Phase 38: brandabschnitte, symbole, melder neben fluchtwege) ·
//      statik_layer (TragwerkPlan, Phase 40: traeger + letzter Berechnungslauf `ergebnis`) ·
//      aussenanlagen_layer (AussenanlagenEditor, Phase 37: elemente [Pflanzen als Punkt-Elemente]
//      + flaechen [Grün/Beet/befestigt/Wasser] auf dem Lageplan-Kern lageplan.js — Phase 63 legt für
//      Mulden/Rigolen ein eigenes Feld an und nutzt denselben Kern) ·
//      entwaesserung_layer (EntwaesserungPlanner, Phase 63: rueckstau { ebene_m, massnahme,
//      kanalsohle_m } · regen { r5_100, r30_100, qAb_ls, dauer_min } · dach { ablaeufe,
//      notueberlaeufe, gefaelle_pct, dmin_m } · rueckhalt { elemente, flaechen } auf dem
//      Lageplan-Kern — die Leitungen selbst bleiben im netz_layer, Gewerk abwasser) ·
//      befunde_layer (ModelCheck/BcfIssues, Phase 71-04: importierte BCF-2.1-Topics vom
//      Generalplaner (Solibri/Catenda) + antworten je Topic-Guid — Schema in
//      @ifc/lib/befundSpur.js; PHASE 66 (Befund-Spur) übernimmt dieses Schema und baut
//      die Statuskette aus, kein zweites Feld anlegen) ·
//      lieferung_layer (ModelCheck/LieferpaketKarte, Phase 71-03: Modelllieferplan nach
//      LV-Position Modelllieferung — { fachsicht, lieferungen: [{ id, nr, termin, bauabschnitt, log, status,
//      dateiname, datum_ist, bemerkung, hinweis_ag, geschosse (66-15, v2) }] }; Schema + Soll/Ist in
//      @ifc/lib/lieferplan.js, Guards nachgebildet wie befunde_layer) ·
//      pruefung_layer (ModelCheck/IdsEditor, Phase 69-08: { eigene_specs: Spec[] } —
//      eigene IDS-Regeln in parse-Form (ids.js), geschrieben mit idsWriter.js (71-01);
//      Guards nachgebildet wie befunde_layer — der Hook liegt in @designer, das
//      @ifc nicht importieren darf) ·
//      bauaufnahme_layer (BauaufnahmePanel, Phase 73-09: { lieferungen[{ id, verfahren, genauigkeit,
//      dienstleister, bericht, datum, bemerkung }], georeferenz{ crs, nullpunkt_e, nullpunkt_n (m),
//      okff_eg_nhn (m ü. NHN), drehung_grad (°) } } — Schema in @designer/lib/bauaufnahme.js) ·
//      befunde_layer.bestand (BestandsBefundKarte im Reiter Bauaufnahme, 73-10: additive Liste
//      neben den BCF-Topics — zweiter Schreiber wie bei sketch_layer erlaubt, weil BcfIssues
//      [Route ModelCheck] und die Karte [Route ComplexDesigner] nie gleichzeitig gemountet sind) ·
//      brandschutz_vermerke_layer (BrandschutzPlanner, 73-13: { abweichungen[checkKey] } — eigenes Feld,
//      weil brandschutz_layer dem BrandschutzPlanEditor gehört) ·
//      barrierefreiheit_layer (BarrierefreiheitPlanner, 73-13: { abweichungen[checkKey] }) ·
//      schallschutz_vermerke_layer (SchallschutzPlanner-Zusammenfassung, 73-13: { abweichungen[checkKey] } —
//      eigenes Feld, schallschutz_layer bleibt bei der Plankarte) ·
//      aufbauten_layer (BitBimStudio via useFachlayer, 107-03/D-BK-22: { aufbauten: { "<id>": { name, skins[{name, material, thickness (mm),
//      funktion?, prioritaet?}] } } } — projektbezogene Wand-/Deckenaufbauten; Schema und Nachschlagen in @core/lib/bauteil/aufbauten.js,
//      die Leser (usePlanModel, AVA, Studio) übergeben den Layer an setzeProjektAufbauten) ·
//      csg_cache_layer (107-14/D-BK-08a: { eintraege: { "<guid>|<art>": { pruefsumme, ort, objekt_id, inhalt, groesse_bytes,
//      dreiecke, volumen_m3, quelle, warnung, erzeugt } } } — computed solids of the CSG core as a discardable CACHE, never a
//      source; ONE writer: useCsgCache (@designer/lib/useCsgCache.js), mounted in the BIM studio by the first caller (107-09),
//      with its own debounce, never inside the input effects of the element fields; schema in @core/lib/csg/cache.js) ·
//      solidrelationen_layer (BitBimStudio via useFachlayer, 107-10: { relationen: [{ id, ziel_guid, operator_guid, operation,
//      aktiv }] } — stored solid element operations; the target stays unchanged, the result is derived by @core/lib/bauteil/seo.js;
//      switching off = aktiv: false). massing_layer v6 (107-10): optional `dach` {form, neigung_grad, firstrichtung} per body.
//      ansicht_layer (BitBimStudio via useFachlayer, 107-12/D-BK-21: { ausschnitte: [{ id, name, type, level, scale, combo,
//      cutHeight, brille, sw, strukturdarstellung, optionen, regeln, ki_vermerk }], ebenen: [{ id, visible, locked, farbe?, linientyp?,
//      drucken? }], kombinationen: {} } — saved views (parameters only, never geometry, D-BK-08a); ONE writer: the BIM studio;
//      schema in @core/lib/plan/ansichtszustand.js; the lens choice in localStorage stays only the last used value).
//      Neue Layer hier ergänzen — UND in @core/lib/fachlayerSchema.js (LAYER_VERSION), in
//      @core/lib/abgleich/modellAbgleich.js (FELD_NAMEN, deutscher Name für die Konfliktkarte; Test in
//      fachlayerSchema.test.js) und .planning/FACHLAYER-SCHEMA.md (87-07: jeder Layer trägt `v` + `updatedAt`; Migration
//      und Stempel laufen in loadBimModel/saveBimModel, nicht hier).
//   2. Lesen NUR über loadBimModel, Schreiben NUR über saveBimModel (ein
//      serialisierter Schreibpfad, create-on-miss geschützt) — nie bitApi
//      direkt, sonst entstehen Duplikat-Datensätze.
//   3. loadingRef/lastSaved-Guard: sonst schreibt der Debounce den frisch
//      geladenen Stand sofort wieder zurück.
//   5. 106-09 review — another device changed the layer: while this tab has not changed it (local value = the base the
//      change started from) the layer follows live and the field is taken care of (aufFremdenStand). When this tab
//      changed it as well, it is NOT taken over: saveBimModel compares the next save of the field three ways against the
//      old base and shows a conflict card instead of overwriting (no silent loss in either direction).
//   4. Raum-verankerte Einträge nutzen roomKey aus @designer/lib/asr
//      (`level:name`). Dokumentierte Einschränkung wie dort: Umbenennen
//      eines Raums verwaist die Einträge, Namenskollision im selben Geschoss
//      teilt einen Key.
import { useCallback, useEffect, useRef, useState } from "react";
import { loadBimModel, saveBimModel, aufFremdenStand } from "@core/lib/useBimModelSync";
import { gleichWert } from "@core/lib/abgleich/dreiWege";
import { pendingNachSave } from "@designer/lib/fachlayerPending";

/** @param {any} x @returns {any} a layer without its schema stamp `v` (updatedAt is ignored by gleichWert anyway) */
const ohneStempel = (x) => (x && typeof x === "object" && !Array.isArray(x) ? { ...x, v: undefined } : x);

/**
 * Persistenter Fachlayer-State je Projekt.
 * @param projectId Projekt (null → nur lokaler State mit defaultValue)
 * @param feld      exklusives BimModel-Top-Level-Feld dieses Layers
 * @param defaultValue Startwert, solange nichts gespeichert ist
 * @returns [state, setState] — wie useState; Speichern läuft debounced (1,2 s),
 *          ungespeicherte Änderungen werden bei Unmount/Projektwechsel geflusht.
 */
export function useFachlayer(projectId, feld, defaultValue) {
  const defaultRef = useRef(defaultValue); // Objekt-Defaults nicht als Dep (neue Identität je Render)
  const [state, setState] = useState(defaultValue);
  const loadingRef = useRef(false);
  const lastSaved = useRef(JSON.stringify(defaultValue));
  // Letzter noch nicht gespeicherter Stand (pid/feld eingefroren) — wird bei
  // Unmount und Projektwechsel geflusht, damit der 1,2-s-Debounce Eingaben
  // kurz vor einem Tab-/Projektwechsel nicht verliert.
  const pendingRef = useRef(null);
  // 106-09 review: the current value for the live merge (read inside the holder callback, not in a stale closure)
  const stateRef = useRef(state);
  stateRef.current = state;

  // 106-09 review: another device changed this layer (change stream) - follow it while this tab has not changed it.
  useEffect(() => {
    if (!projectId) return undefined;
    return aufFremdenStand((pid, f) => {
      if (pid !== projectId || loadingRef.current || !(feld in f.patch)) return [];
      const lokal = stateRef.current;
      const fremd = f.patch[feld] ?? defaultRef.current;
      // the schema stamp (v, updatedAt) is set on save only, so it does not count as a change here
      const gleich = (/** @type {any} */ a, /** @type {any} */ b) => gleichWert(ohneStempel(a), ohneStempel(b));
      if (!gleich(lokal, f.vorher[feld] ?? defaultRef.current) && !gleich(lokal, fremd)) return []; // changed here too: the save compares
      lastSaved.current = JSON.stringify(fremd); // arrived, not changed here: nothing to write back
      pendingRef.current = null;
      stateRef.current = fremd;
      setState(fremd);
      return [feld];
    });
  }, [projectId, feld]);

  const setUser = useCallback((v) => {
    // Eingaben WÄHREND des Ladens ignorieren (Fenster = ein Netz-Request):
    // Der frühere dirtyRef-Ansatz behielt beim Load-Resolve den kompletten
    // prev-Stand (Default bzw. Layer des VORHERIGEN Projekts) statt zu
    // mergen — der nächste Edit persistierte dann fremde/Default-Daten in
    // das frisch geladene Projekt (Cross-Projekt-Korruption) und der
    // gespeicherte Layer wurde nie angezeigt. Blockieren ist das zum
    // Hook-Muster passende, deterministische Verhalten.
    if (loadingRef.current) return;
    setState(v);
  }, []);

  // Laden bei Projektwechsel.
  useEffect(() => {
    // Ungespeicherten Stand des VORHERIGEN Projekts flushen (pid ist im Ref
    // eingefroren — schreibt nie ins neue Projekt).
    const pend = pendingRef.current;
    if (pend && pend.pid !== projectId) {
      pendingRef.current = null;
      if (pend.sig !== lastSaved.current) {
        saveBimModel(pend.pid, { [pend.feld]: pend.state }).catch(() => {});
      }
    }
    if (!projectId) {
      setState(defaultRef.current);
      lastSaved.current = JSON.stringify(defaultRef.current);
      return undefined;
    }
    let cancelled = false;
    loadingRef.current = true;
    // Beim Projektwechsel SOFORT auf den Default zurücksetzen: sonst bleibt
    // der Layer des vorherigen Projekts sichtbar/editierbar, bis der Load
    // auflöst — und könnte in das neue Projekt gespeichert werden.
    setState(defaultRef.current);
    lastSaved.current = JSON.stringify(defaultRef.current);
    (async () => {
      try {
        const m = await loadBimModel(projectId);
        if (cancelled) return;
        const val = m && m[feld] != null ? m[feld] : defaultRef.current;
        lastSaved.current = JSON.stringify(val);
        // Eingaben während des Ladens sind blockiert (setUser) — der geladene
        // Stand kann bedenkenlos übernommen werden.
        setState(val);
      } catch {
        /* offline: Default/letzter Stand bleibt; Speichern versucht es später */
      } finally {
        loadingRef.current = false;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, feld]);

  // Debounced zurückschreiben — nur bei echter Änderung.
  useEffect(() => {
    if (!projectId || loadingRef.current) return undefined;
    const sig = JSON.stringify(state);
    if (sig === lastSaved.current) return undefined;
    pendingRef.current = { pid: projectId, feld, state, sig };
    const t = setTimeout(async () => {
      try {
        await saveBimModel(projectId, { [feld]: state });
        lastSaved.current = sig;
        // Neuere Eingabe während des Save-Awaits? Dann pendingRef behalten
        // (sonst verlöre der Unmount-Flush sie), s. pendingNachSave.
        pendingRef.current = pendingNachSave(pendingRef.current, sig);
      } catch {
        /* nächster Versuch beim nächsten Change; pendingRef bleibt für den Unmount-Flush */
      }
    }, 1200);
    return () => clearTimeout(t);
  }, [projectId, feld, state]);

  // Flush-on-Unmount: läuft der Debounce beim Tab-Wechsel noch, wäre die
  // Eingabe sonst weg (Radix-Tabs unmounten den Reiter komplett).
  useEffect(() => () => {
    const pend = pendingRef.current;
    if (pend && pend.sig !== lastSaved.current) {
      saveBimModel(pend.pid, { [pend.feld]: pend.state }).catch(() => {});
    }
  }, []);

  // 107-14 review: the third element tells an async writer (useCsgCache) whether the layer is loading right now — setUser
  // drops a value then, so the writer must not count it as written. Additive: callers that destructure two keep working.
  const istLadend = useCallback(() => loadingRef.current, []);

  return [state, setUser, istLadend];
}
