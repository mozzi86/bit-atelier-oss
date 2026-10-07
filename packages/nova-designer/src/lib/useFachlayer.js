// Fachlayer-Persistenz-Konvention (Phase 34, PW-04) — die KD-17-Regeln als
// wiederverwendbarer Hook, damit kein Fachplaner-Reiter die Guards nachbaut:
//
//   1. Je Reiter genau EIN eigenes Top-Level-Feld im BimModel (z.B.
//      "brandschutz_layer"). Der Server merged flach — zwei Schreiber auf
//      DEMSELBEN Feld überschreiben sich still. Feld-Registry (Stand 45):
//      Programmfelder (useBimModelSync) · Elementfelder (BitBimStudio) ·
//      brandschutz_layer (BrandschutzPlanner) · sketch_layer (BIT Sketcher via
//      useSketchLayer UND Grundriss-Sketch-Editor in BitBimStudio — beide über
//      saveBimModel, nie gleichzeitig gemountet [eigene Route vs. Tab]) ·
//      raumklima_layer (RaumklimaPlanner, Phase 45: northAngle + DIN-Optionen) ·
//      schallschutz_layer (SchallschutzPlanner, Phase 39: Pegel je Orientierung,
//      Raumarten je Zone, Adjazenz-Ausnahmen, Fenster-/Trennwand-R'w) ·
//      werkstatt_layer (WohnungsWerkstatt, Phase 61: Typologie, Einheiten-Liste,
//      angewendet-Flag; 61-06: keller { aktiv, optionen, mengen } — the basement
//      hand-over list for AVA / Phase 62 lives here, not in a second field) ·
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
//      dateiname, datum_ist, bemerkung, hinweis_ag }] }; Schema + Soll/Ist in
//      @ifc/lib/lieferplan.js, Guards nachgebildet wie befunde_layer) ·
//      pruefung_layer (ModelCheck/IdsEditor, Phase 69-08: { eigene_specs: Spec[] } —
//      eigene IDS-Regeln in parse-Form (ids.js), geschrieben mit idsWriter.js (71-01);
//      Guards nachgebildet wie befunde_layer — der Hook liegt in @designer, das
//      @ifc nicht importieren darf).
//      Neue Layer hier ergänzen!
//   2. Lesen NUR über loadBimModel, Schreiben NUR über saveBimModel (ein
//      serialisierter Schreibpfad, create-on-miss geschützt) — nie bitApi
//      direkt, sonst entstehen Duplikat-Datensätze.
//   3. loadingRef/lastSaved-Guard: sonst schreibt der Debounce den frisch
//      geladenen Stand sofort wieder zurück.
//   4. Raum-verankerte Einträge nutzen roomKey aus @designer/lib/asr
//      (`level:name`). Dokumentierte Einschränkung wie dort: Umbenennen
//      eines Raums verwaist die Einträge, Namenskollision im selben Geschoss
//      teilt einen Key.
import { useCallback, useEffect, useRef, useState } from "react";
import { loadBimModel, saveBimModel } from "@core/lib/useBimModelSync";
import { pendingNachSave } from "@designer/lib/fachlayerPending";

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

  return [state, setUser];
}
