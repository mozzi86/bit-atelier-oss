// 71-06 (ROHB-06): attribute editor for ONE selected element of an imported IFC model.
//
// Shows the element's property sets with the journal laid over them (attributJournal.js),
// lets the user change a value or add a property, and writes every edit as one entity
// IfcAenderung of the project — so the journal travels in every .bitproj backup. The IFC
// file is never rewritten here: "Journal als JSON" hands the journal to the harness writer
// (`/ifc schreibe journal=…`, 71-05), which writes a NEW file with all GlobalIds kept.
//
// In:  element (ifcImport element: guid, psets), modell (loaded file name), projectId; 106-03: aktualisierung (a
//      counter that reloads the journal when the change commands wrote to it), onEintraege (gets the loaded journal).
// Out: panel; data-testids ae-oeffnen, ae-pset, ae-zeile (data-eigenschaft, data-geaendert),
//      ae-bearbeiten, ae-eingabe, ae-uebernehmen, ae-zurueck, ae-neu-name, ae-neu-wert,
//      ae-neu, ae-anzahl, ae-json, ae-meldung.
import React, { useEffect, useMemo, useState } from "react";
import { bitApi } from "@core/api/bitApi";
import { useI18n } from "@core/lib/i18n";
import {
  editorZeilen, eintragBauen, journalDateiname, journalExport, letzterEintrag, wertTypisieren,
} from "@ifc/lib/attributJournal";

/** @param {any} w */
const anzeige = (w) => (w == null || w === "" ? "—" : String(w));

/**
 * @param {{element: {guid?: string, globalId?: string, psets?: Record<string, Record<string, any>>}|null,
 *   modell: string, projectId?: string|null, aktualisierung?: number, onEintraege?: (eintraege: any[]) => void}} props
 */
export default function AttributEditor({ element, modell, projectId = null, aktualisierung = 0, onEintraege = undefined }) {
  const { t } = useI18n();
  const [offen, setOffen] = useState(false);
  const [eintraege, setEintraege] = useState(/** @type {any[]} */ ([]));
  const [pset, setPset] = useState("");
  const [bearbeitet, setBearbeitet] = useState(/** @type {string|null} */ (null));
  const [eingabe, setEingabe] = useState("");
  const [neuName, setNeuName] = useState("");
  const [neuWert, setNeuWert] = useState("");
  const [meldung, setMeldung] = useState({ text: "", fehler: false });
  const guid = element?.guid || element?.globalId || "";

  const laden = async () => {
    if (!projectId || !modell) { setEintraege([]); return; }
    const r = await bitApi.entities.IfcAenderung.filter({ project_id: projectId, modell }).catch(() => []);
    setEintraege(r || []);
    onEintraege?.(r || []); // 106-03: the viewer keeps the same list for the change commands
  };
  useEffect(() => {
    if (offen) laden();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- laden only reads the props listed here
  }, [offen, projectId, modell, aktualisierung]);
  useEffect(() => { setBearbeitet(null); setMeldung({ text: "", fehler: false }); }, [guid]);

  const zeilen = useMemo(() => editorZeilen(element?.psets || {}, eintraege, modell, guid), [element, eintraege, modell, guid]);
  const psetNamen = useMemo(() => [...new Set(zeilen.map((z) => z.pset))], [zeilen]);
  const aktiverPset = psetNamen.includes(pset) ? pset : (psetNamen[0] || "");
  const imJournal = eintraege.filter((e) => e.modell === modell).length;

  /** @param {string} psetName @param {string} eigenschaft @param {any} alt @param {any} wert */
  const speichern = async (psetName, eigenschaft, alt, wert) => {
    try {
      const eintrag = eintragBauen({ projectId, modell, guid, pset: psetName, eigenschaft, alt, wert });
      await bitApi.entities.IfcAenderung.create(eintrag);
      setMeldung({ text: t("Gespeichert"), fehler: false });
      setBearbeitet(null);
      await laden();
      return true;
    } catch (e) {
      setMeldung({ text: `${t("Speichern fehlgeschlagen")}: ${e?.message || e}`, fehler: true });
      return false;
    }
  };

  /** @param {{pset: string, eigenschaft: string, wert: any}} z */
  const uebernehmen = async (z) => {
    let wert;
    try { wert = wertTypisieren(eingabe, z.wert); } catch (e) { setMeldung({ text: String(e?.message || e), fehler: true }); return; }
    await speichern(z.pset, z.eigenschaft, z.wert, wert);
  };

  /** @param {{pset: string, eigenschaft: string}} z */
  const zuruecknehmen = async (z) => {
    const letzter = letzterEintrag(eintraege, modell, guid, z.pset, z.eigenschaft);
    if (!letzter?.id) return;
    try { await bitApi.entities.IfcAenderung.delete(letzter.id); await laden(); } catch (e) {
      setMeldung({ text: `${t("Speichern fehlgeschlagen")}: ${e?.message || e}`, fehler: true });
    }
  };

  const hinzufuegen = async () => {
    const name = neuName.trim();
    if (!aktiverPset || !name) return;
    if (await speichern(aktiverPset, name, null, neuWert.trim())) { setNeuName(""); setNeuWert(""); }
  };

  const alsJson = () => {
    const daten = journalExport(eintraege, modell);
    const url = URL.createObjectURL(new Blob([JSON.stringify(daten, null, 1)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url; a.download = journalDateiname(modell); a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  if (!offen) {
    return (
      <button type="button" data-testid="ae-oeffnen" onClick={() => setOffen(true)}
        className="mt-2 w-full rounded border border-slate-300 px-2 py-1 text-slate-700 hover:bg-slate-50">
        {t("Attribute bearbeiten")}
      </button>
    );
  }

  return (
    <div className="mt-2 border-t border-slate-200 pt-2" data-testid="ae-panel">
      <div className="mb-1 flex items-center justify-between">
        <b className="text-slate-700">{t("Attribute bearbeiten")}</b>
        <button type="button" onClick={() => setOffen(false)} aria-label={t("Abbrechen")} className="text-slate-400">✕</button>
      </div>
      {!guid && <p className="text-amber-700">{t("Bauteil ohne GlobalId — Änderungen lassen sich nicht zuordnen.")}</p>}
      {!projectId && <p className="text-amber-700">{t("Erst ein Projekt wählen.")}</p>}
      {psetNamen.length === 0 ? (
        <p className="text-slate-500">{t("Keine Eigenschaften am Bauteil")}</p>
      ) : (
        <>
          <label className="mb-1 block text-slate-500">{t("Eigenschaftssatz")}
            <select data-testid="ae-pset" value={aktiverPset} onChange={(e) => { setPset(e.target.value); setBearbeitet(null); }}
              className="mt-0.5 h-7 w-full rounded border border-slate-200 px-1 text-slate-700">
              {psetNamen.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <ul className="max-h-48 space-y-0.5 overflow-y-auto">
            {zeilen.filter((z) => z.pset === aktiverPset).map((z) => {
              const k = `${z.pset}\u0000${z.eigenschaft}`;
              return (
                <li key={k} data-testid="ae-zeile" data-eigenschaft={z.eigenschaft} data-geaendert={z.geaendert ? "1" : "0"}
                  className={z.geaendert ? "rounded bg-amber-50 px-1" : "px-1"}>
                  <div className="flex items-start justify-between gap-1">
                    <span className="break-all text-slate-500">{z.eigenschaft}</span>
                    {bearbeitet !== k && (
                      <span className="flex shrink-0 items-center gap-1">
                        <b className="break-all text-slate-800">{anzeige(z.wert)}</b>
                        <button type="button" data-testid="ae-bearbeiten" disabled={!guid || !projectId}
                          title={t("Wert ändern")} aria-label={t("Wert ändern")}
                          onClick={() => { setBearbeitet(k); setEingabe(z.wert == null ? "" : String(z.wert)); }}
                          className="text-sky-700 disabled:text-slate-300">✎</button>
                      </span>
                    )}
                  </div>
                  {bearbeitet === k && (
                    <div className="mt-0.5 flex gap-1">
                      <input data-testid="ae-eingabe" autoFocus value={eingabe} onChange={(e) => setEingabe(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") uebernehmen(z); if (e.key === "Escape") setBearbeitet(null); }}
                        className="h-6 min-w-0 flex-1 rounded border border-slate-300 px-1" />
                      <button type="button" data-testid="ae-uebernehmen" onClick={() => uebernehmen(z)}
                        className="rounded bg-blue-600 px-1.5 text-white">{t("Übernehmen")}</button>
                    </div>
                  )}
                  {z.geaendert && (
                    <div className="flex items-center justify-between text-[10px] text-amber-800">
                      <span>{t("vorher")}: {anzeige(z.original)}</span>
                      <button type="button" data-testid="ae-zurueck" onClick={() => zuruecknehmen(z)}
                        title={t("Letzte Änderung zurücknehmen")} aria-label={t("Letzte Änderung zurücknehmen")}>↶</button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="mt-1 flex gap-1">
            <input data-testid="ae-neu-name" placeholder={t("Name der Eigenschaft")} value={neuName} onChange={(e) => setNeuName(e.target.value)}
              className="h-6 min-w-0 flex-1 rounded border border-slate-200 px-1" />
            <input data-testid="ae-neu-wert" placeholder={t("Wert")} value={neuWert} onChange={(e) => setNeuWert(e.target.value)}
              className="h-6 w-16 rounded border border-slate-200 px-1" />
            <button type="button" data-testid="ae-neu" disabled={!guid || !projectId || !neuName.trim()} onClick={hinzufuegen}
              title={t("Eigenschaft hinzufügen")} className="rounded border border-slate-300 px-1.5 disabled:text-slate-300">{t("Hinzufügen")}</button>
          </div>
        </>
      )}
      <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-1">
        <span data-testid="ae-anzahl" data-anzahl={imJournal} className="text-slate-500">{imJournal} {t("Änderungen im Journal")}</span>
        <button type="button" data-testid="ae-json" disabled={!imJournal} onClick={alsJson}
          className="text-sky-700 underline disabled:text-slate-300 disabled:no-underline">{t("Journal als JSON")}</button>
      </div>
      <p className="mt-1 text-[10px] text-slate-400">{t("Das IFC bleibt unverändert — der KI-Harness schreibt das Journal mit „/ifc schreibe“ in eine neue Datei, alle GlobalIds bleiben.")}</p>
      {meldung.text && <p data-testid="ae-meldung" className={meldung.fehler ? "text-red-600" : "text-emerald-700"}>{meldung.text}</p>}
    </div>
  );
}
