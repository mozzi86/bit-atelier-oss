// ExposePanel — the editor of the model layer `expose_layer` in the BIM studio (W-1118-28 step 3): what the exposé picture
// needs beyond the building elements. Roof overhang and gutter, chimney, outside stairs and the named views are edited in
// fields; the surroundings (surfaces, hedges, trees, neighbours …) are many small records and are edited as a list in JSON
// until they get tools on the site plan. A view is stored from the camera the studio shows right now.
//
// In:  the layer, a setter (useFachlayer — the studio persists it), the current camera, the hull doors, a render callback.
// Out: the panel. Side effects: only through the callbacks. All lengths in m, model axes (x east, y up, z south).

import React, { useState } from "react";
import { useI18n } from "@core/lib/i18n";
import { DACH_BILD, AUSSENTREPPE_STANDARD } from "@designer/lib/exposeSzene.js";

const feldCls = "w-16 rounded border border-border px-1 py-0.5 text-right bg-card";
const knopfCls = "rounded-md border border-border px-1.5 py-0.5 bg-card hover:bg-muted";

/**
 * A number field that writes on every valid input.
 * @param {{wert: number|undefined, vorgabe?: number, schritt?: number, min?: number, max?: number, label: string, testid?: string, onChange: (v: number) => void}} p
 */
function Zahl({ wert, vorgabe = 0, schritt = 0.05, min, max, label, testid, onChange }) {
  return <input type="number" className={feldCls} step={schritt} min={min} max={max} value={Number.isFinite(Number(wert)) ? Number(wert) : vorgabe} aria-label={label} data-testid={testid}
    onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) onChange(v); }} />;
}

/**
 * @param {object} p
 * @param {Record<string, any>|null} p.layer the model's expose_layer
 * @param {(next: Record<string, any>) => void} p.onChange
 * @param {() => ({pos: number[], ziel: number[], fov_grad: number}|null)} p.kamera the studio's current camera
 * @param {Array<{edge: number, u: number}>} [p.tueren] hull doors of the ground floor (a new stair starts in front of the first)
 * @param {(blick: Record<string, any>|null) => void} p.onBild renders one picture (a stored view, or null = the current view)
 * @param {() => void} p.onSchliessen
 */
export default function ExposePanel({ layer, onChange, kamera, tueren = [], onBild, onSchliessen }) {
  const { t } = useI18n();
  const L = layer && typeof layer === "object" ? layer : {};
  const setze = (/** @type {Record<string, any>} */ teil) => onChange({ ...L, ...teil });
  const dach = L.dach || {}, kamin = L.kamin || null, treppen = Array.isArray(L.aussentreppen) ? L.aussentreppen : [], blicke = Array.isArray(L.blicke) ? L.blicke : [];
  const [name, setName] = useState("");
  const [umfeldText, setUmfeldText] = useState(/** @type {string|null} */ (null));
  const [fehler, setFehler] = useState("");
  const U = L.umfeld || {};
  const anzahl = (/** @type {string} */ k) => (Array.isArray(U[k]) ? U[k].length : 0);
  const zeile = (/** @type {string} */ label, /** @type {React.ReactNode} */ inhalt) => <div className="flex items-center justify-between gap-2 py-0.5"><span className="text-muted-foreground">{label}</span><span className="flex items-center gap-1">{inhalt}</span></div>;
  const blickPatch = (/** @type {number} */ i, /** @type {Record<string, any>} */ pt) => setze({ blicke: blicke.map((b, k) => (k === i ? { ...b, ...pt } : b)) });

  return (
    <div data-testid="expose-panel" className="fixed right-4 top-28 z-50 w-80 max-h-[70vh] overflow-auto rounded-lg border border-border bg-card p-3 text-xs shadow-lg">
      <div className="mb-2 flex items-center justify-between">
        <b className="text-sm">{t("Exposé-Bild")}</b>
        <button type="button" className={knopfCls} onClick={onSchliessen} aria-label={t("Schließen")}>×</button>
      </div>

      <div className="mb-1 font-semibold">{t("Dach im Bild")}</div>
      {zeile(t("Traufüberstand (m)"), <Zahl wert={dach.traufueberstand_m} vorgabe={DACH_BILD.traufueberstand_m} min={0} max={2} label={t("Traufüberstand (m)")} testid="expose-traufe" onChange={(v) => setze({ dach: { ...dach, traufueberstand_m: v } })} />)}
      {zeile(t("Ortgangüberstand (m)"), <Zahl wert={dach.ortgangueberstand_m} vorgabe={DACH_BILD.ortgangueberstand_m} min={0} max={2} label={t("Ortgangüberstand (m)")} onChange={(v) => setze({ dach: { ...dach, ortgangueberstand_m: v } })} />)}
      {zeile(t("Rinnen und Fallrohre"), <input type="checkbox" className="accent-primary" checked={dach.rinne !== false} aria-label={t("Rinnen und Fallrohre")} onChange={(e) => setze({ dach: { ...dach, rinne: e.target.checked } })} />)}

      <div className="mb-1 mt-3 flex items-center justify-between font-semibold">{t("Kamin")}
        <input type="checkbox" className="accent-primary" checked={!!kamin} aria-label={t("Kamin")} data-testid="expose-kamin" onChange={(e) => setze({ kamin: e.target.checked ? { x: 0, z: 0, b_m: 0.4, t_m: 0.4, ueber_first_m: 0.8 } : null })} />
      </div>
      {kamin && <>
        {zeile(t("Lage x / z (m)"), <><Zahl wert={kamin.x} label={t("Lage x (m)")} onChange={(v) => setze({ kamin: { ...kamin, x: v } })} /><Zahl wert={kamin.z} label={t("Lage z (m)")} onChange={(v) => setze({ kamin: { ...kamin, z: v } })} /></>)}
        {zeile(t("Breite / Tiefe (m)"), <><Zahl wert={kamin.b_m} vorgabe={0.4} min={0.2} max={2} label={t("Breite (m)")} onChange={(v) => setze({ kamin: { ...kamin, b_m: v } })} /><Zahl wert={kamin.t_m} vorgabe={0.4} min={0.2} max={2} label={t("Tiefe (m)")} onChange={(v) => setze({ kamin: { ...kamin, t_m: v } })} /></>)}
        {zeile(t("über First (m)"), <Zahl wert={kamin.ueber_first_m} vorgabe={0.8} min={0.2} max={3} label={t("über First (m)")} onChange={(v) => setze({ kamin: { ...kamin, ueber_first_m: v } })} />)}
      </>}

      <div className="mb-1 mt-3 flex items-center justify-between font-semibold">{t("Außentreppen")}
        <button type="button" className={knopfCls} data-testid="expose-treppe-neu" onClick={() => {
          const tuer = tueren[0];
          setze({ aussentreppen: [...treppen, { edge: tuer ? tuer.edge : 0, u_von_m: tuer ? Math.round((tuer.u - 0.9) * 100) / 100 : 0, u_bis_m: tuer ? Math.round((tuer.u + 0.9) * 100) / 100 : 1.8, level: 0, podest_tiefe_m: AUSSENTREPPE_STANDARD.podest_tiefe_m, steigung_m: AUSSENTREPPE_STANDARD.steigung_m, auftritt_m: AUSSENTREPPE_STANDARD.auftritt_m, gelaender: true }] });
        }}>{t("vor der Haustür")}</button>
      </div>
      {treppen.map((tr, i) => {
        const patch = (/** @type {Record<string, any>} */ pt) => setze({ aussentreppen: treppen.map((x, k) => (k === i ? { ...x, ...pt } : x)) });
        return <div key={i} className="mb-1 rounded border border-border p-1.5">
          {zeile(t("Hüllwand / von / bis (m)"), <><Zahl wert={tr.edge} schritt={1} min={0} label={t("Hüllwand")} onChange={(v) => patch({ edge: Math.round(v) })} /><Zahl wert={tr.u_von_m} label={t("Lage von (m)")} onChange={(v) => patch({ u_von_m: v })} /><Zahl wert={tr.u_bis_m} label={t("Lage bis (m)")} onChange={(v) => patch({ u_bis_m: v })} /></>)}
          {zeile(t("Podesttiefe (m)"), <><Zahl wert={tr.podest_tiefe_m} vorgabe={AUSSENTREPPE_STANDARD.podest_tiefe_m} min={0.6} max={4} label={t("Podesttiefe (m)")} onChange={(v) => patch({ podest_tiefe_m: v })} />
            <label className="flex items-center gap-1"><input type="checkbox" className="accent-primary" checked={tr.gelaender !== false} onChange={(e) => patch({ gelaender: e.target.checked })} />{t("Geländer")}</label>
            <button type="button" className="text-destructive hover:underline" onClick={() => setze({ aussentreppen: treppen.filter((_, k) => k !== i) })}>{t("Löschen")}</button></>)}
        </div>;
      })}

      <div className="mb-1 mt-3 font-semibold">{t("Blickpunkte")}</div>
      <div className="mb-1 flex gap-1">
        <input className="min-w-0 flex-1 rounded border border-border px-1 py-0.5 bg-card" placeholder={t("Name des Blickpunkts")} value={name} aria-label={t("Name des Blickpunkts")} data-testid="expose-blick-name" onChange={(e) => setName(e.target.value)} />
        <button type="button" className={knopfCls} data-testid="expose-blick-neu" title={t("Die aktuelle 3D-Ansicht als Blickpunkt speichern")} onClick={() => {
          const k = kamera();
          if (!k) { setFehler(t("Blickpunkte lassen sich nur aus der 3D-Ansicht speichern.")); return; }
          const r2 = (/** @type {number} */ v) => Math.round(v * 100) / 100;
          setze({ blicke: [...blicke, { name: name.trim() || `${t("Blick")} ${blicke.length + 1}`, pos: k.pos.map(r2), ziel: k.ziel.map(r2), fov_grad: Math.round(k.fov_grad) }] });
          setName(""); setFehler("");
        }}>{t("Ansicht speichern")}</button>
      </div>
      {blicke.map((b, i) => <div key={i} className="mb-1 rounded border border-border p-1.5" data-testid="expose-blick">
        <div className="flex items-center justify-between gap-1">
          <input className="min-w-0 flex-1 rounded border border-border px-1 py-0.5 bg-card" value={b.name || ""} aria-label={t("Name des Blickpunkts")} onChange={(e) => blickPatch(i, { name: e.target.value })} />
          <button type="button" className={knopfCls} onClick={() => onBild(b)}>{t("Bild")}</button>
          <button type="button" className="text-destructive hover:underline" onClick={() => setze({ blicke: blicke.filter((_, k) => k !== i) })}>{t("Löschen")}</button>
        </div>
        {zeile(t("Augenhöhe über Gelände (m)"), <Zahl wert={b.augenhoehe_m} vorgabe={0} min={0} max={30} schritt={0.1} label={t("Augenhöhe über Gelände (m)")} onChange={(v) => blickPatch(i, { augenhoehe_m: v > 0 ? v : undefined })} />)}
        {zeile(t("Öffnungswinkel (°) / Linsenversatz"), <><Zahl wert={b.fov_grad} vorgabe={45} schritt={1} min={15} max={100} label={t("Öffnungswinkel (°)")} onChange={(v) => blickPatch(i, { fov_grad: v })} /><Zahl wert={b.shift} vorgabe={0} schritt={0.02} min={-0.5} max={0.5} label={t("Linsenversatz")} onChange={(v) => blickPatch(i, { shift: v || undefined })} /></>)}
        {zeile(t("Innenraum"), <input type="checkbox" className="accent-primary" checked={b.innen === true} aria-label={t("Innenraum")} onChange={(e) => blickPatch(i, { innen: e.target.checked || undefined })} />)}
      </div>)}

      <div className="mb-1 mt-3 font-semibold">{t("Umfeld")}</div>
      <p className="mb-1 text-muted-foreground" data-testid="expose-umfeld-zahl">{t("Flächen")} {anzahl("flaechen")} · {t("Hecken")} {anzahl("hecken")} · {t("Mauern")} {anzahl("mauern")} · {t("Bäume")} {anzahl("baeume")} · {t("Sträucher")} {anzahl("straeucher")} · {t("Nachbarn")} {anzahl("nachbarn")}</p>
      {umfeldText === null
        ? <button type="button" className={knopfCls} data-testid="expose-umfeld-bearbeiten" onClick={() => { setUmfeldText(JSON.stringify(U, null, 1)); setFehler(""); }}>{t("Umfeld als Liste bearbeiten")}</button>
        : <>
          <textarea className="h-40 w-full rounded border border-border bg-card p-1 font-mono text-[10px]" value={umfeldText} aria-label={t("Umfeld als Liste bearbeiten")} data-testid="expose-umfeld-text" onChange={(e) => setUmfeldText(e.target.value)} />
          <div className="mt-1 flex gap-1">
            <button type="button" className={knopfCls} data-testid="expose-umfeld-ok" onClick={() => {
              try {
                const neu = JSON.parse(umfeldText);
                if (!neu || typeof neu !== "object" || Array.isArray(neu)) throw new Error(t("Das Umfeld ist ein Objekt mit Listen (flaechen, hecken, baeume …)."));
                setze({ umfeld: neu }); setUmfeldText(null); setFehler("");
              } catch (e) { setFehler(`${t("Umfeld nicht übernommen:")} ${String(/** @type {any} */ (e)?.message || e)}`); }
            }}>{t("Übernehmen")}</button>
            <button type="button" className={knopfCls} onClick={() => { setUmfeldText(null); setFehler(""); }}>{t("Abbrechen")}</button>
          </div>
        </>}
      {fehler && <p role="alert" className="mt-1 text-warnung" data-testid="expose-fehler">{fehler}</p>}

      <div className="mt-3 flex gap-1 border-t border-border pt-2">
        <button type="button" className={knopfCls} data-testid="expose-bild-jetzt" onClick={() => onBild(null)}>{t("Bild der aktuellen Ansicht")}</button>
      </div>
    </div>
  );
}
