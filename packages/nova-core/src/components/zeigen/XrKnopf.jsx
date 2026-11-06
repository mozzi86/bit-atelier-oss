// 106-08: the button "In VR ansehen" of a 3D viewer. It appears ONLY when the browser offers an immersive VR session (no dead button);
// the session code (xrSitzung.js, three's WebXRManager) is loaded by a dynamic import when the person presses it, so the viewer's chunk
// stays as small as before. A failed start is said in plain words (data-testid xr-fehler, solid outline + "✕", not only colour).
// The scale is chosen before the start (1:1 or table model) and can be switched on the floating panel in the headset.
//
// Not accepted on a device (D-IM-03 / D-AW-04): proved in the browser with a WebXR stand-in only.
//
// In:  quelle() - what the session needs from the viewer (renderer, scene, camera, pick/hover/select, speech handle, register, rights),
//      or null while no model is loaded; t; hook - name under window.__bitZeigen for the browser test (plain data only).
// Out: DOM; data-testids xr-knopf (wrapper), xr-start, xr-modus-11, xr-modus-tisch, xr-laeuft, xr-beenden, xr-fehler.
import React, { useEffect, useRef, useState } from "react";
import { xrVerfuegbarkeit } from "@core/lib/zeigen/xrVerfuegbar.js";

/** The session code, loaded once (review 106-08: preloaded as soon as the button appears, so the click goes straight to
 *  requestSession while the browser still counts it as the person's action). */
let sitzungModul = /** @type {Promise<typeof import("@core/lib/zeigen/xrSitzung.js")>|null} */ (null);
const sitzungLaden = () => {
  if (!sitzungModul) sitzungModul = import("@core/lib/zeigen/xrSitzung.js").catch((e) => { sitzungModul = null; throw e; });
  return sitzungModul;
};

/**
 * @param {{quelle: () => any, t?: (s: string) => string, hook?: string, className?: string, bereit?: boolean}} props
 *   quelle: returns {renderer, szene, kamera, quelle: XrQuelle, sprechen, befehle, darfAendern} (see xrSitzung.js) or null.
 *   bereit: a model is loaded (default true); false = the start button is off and says why (no dead button).
 */
export default function XrKnopf({ quelle, t = (s) => s, hook = "xr", className = "", bereit = true }) {
  const [verfuegbar, setVerfuegbar] = useState(/** @type {{ok: boolean, grund: string|null}|null} */ (null));
  const [modus, setModus] = useState(/** @type {"1:1"|"tisch"} */ ("1:1"));
  const [laeuft, setLaeuft] = useState(false);
  const [startet, setStartet] = useState(false);
  const [fehler, setFehler] = useState(/** @type {string|null} */ (null));
  const sitzungRef = useRef(/** @type {any} */ (null));
  const stand = useRef(/** @type {any} */ ({}));
  stand.current = { verfuegbar, modus, laeuft, fehler };

  // availability, again when a device comes or goes (navigator.xr "devicechange")
  useEffect(() => {
    let aktiv = true;
    const pruefen = () => { void xrVerfuegbarkeit(/** @type {any} */ (window)).then((v) => { if (aktiv) setVerfuegbar(v); }); };
    pruefen();
    const xr = /** @type {any} */ (navigator).xr;
    xr?.addEventListener?.("devicechange", pruefen);
    return () => { aktiv = false; xr?.removeEventListener?.("devicechange", pruefen); };
  }, []);

  // a session never outlives the viewer - also one that is still starting when the button goes away (review 106-08)
  const abgebaut = useRef(false);
  useEffect(() => {
    abgebaut.current = false;
    return () => { abgebaut.current = true; void sitzungRef.current?.beenden(); sitzungRef.current = null; };
  }, []);

  // preload the session code once a device is there (a failed preload is retried on the click and said in words there)
  useEffect(() => { if (verfuegbar?.ok) sitzungLaden().catch(() => {}); }, [verfuegbar?.ok]);

  const starten = async () => {
    setFehler(null);
    setStartet(true);
    try {
      const q = quelle();
      if (!q) throw new Error(t("Erst ein Modell laden — dann in VR ansehen"));
      /** @type {typeof import("@core/lib/zeigen/xrSitzung.js").xrSitzung} */
      let xrSitzung;
      try { ({ xrSitzung } = await sitzungLaden()); } catch {
        throw new Error(t("VR-Teil konnte nicht geladen werden — Seite neu laden"));
      }
      const s = await xrSitzung({
        ...q, modus, t,
        onEnde: () => { if (sitzungRef.current === s) sitzungRef.current = null; if (!abgebaut.current) setLaeuft(false); },
      });
      // the viewer went away while the headset asked for permission: end the session at once, nobody could end it later
      if (abgebaut.current) { await s.beenden(); return; }
      sitzungRef.current = s;
      setLaeuft(true);
    } catch (e) {
      if (!abgebaut.current) setFehler(String(/** @type {any} */ (e)?.message || e));
    } finally {
      if (!abgebaut.current) setStartet(false);
    }
  };

  // test hook: plain data only, under window.__bitZeigen[hook]
  useEffect(() => {
    const w = /** @type {any} */ (window);
    const api = {
      verfuegbarkeit: () => stand.current.verfuegbar,
      laeuft: () => !!sitzungRef.current,
      fehler: () => stand.current.fehler,
      modus: () => sitzungRef.current?.modus() ?? stand.current.modus,
      referenzraum: () => sitzungRef.current?.referenzraum ?? null,
      rig: () => sitzungRef.current?.steuerung.zustand().rig ?? null,
      letzte: () => sitzungRef.current?.steuerung.zustand().letzte ?? null,
      tafel: () => {
        const l = sitzungRef.current?.tafel();
        return l ? { zeilen: l.zeilen.map((/** @type {any} */ z) => ({ text: z.text, art: z.art, rahmen: z.rahmen ?? null })), knoepfe: l.knoepfe.map((/** @type {any} */ k) => ({ id: k.id, label: k.label, aktiv: k.aktiv })) } : null;
      },
      tafelDarstellung: () => sitzungRef.current?.tafelDarstellung() ?? null,
      weltZuReferenz: (/** @type {number[]} */ p) => sitzungRef.current?.weltZuReferenz(p) ?? null,
      knopfMitteReferenz: (/** @type {string} */ id) => sitzungRef.current?.knopfMitteReferenz(id) ?? null,
      beenden: () => sitzungRef.current?.beenden(),
    };
    w.__bitZeigen = { ...(w.__bitZeigen || {}), [hook]: api };
    return () => { if (w.__bitZeigen?.[hook] === api) delete w.__bitZeigen[hook]; };
  }, [hook]);

  if (!verfuegbar?.ok && !laeuft) return null; // no device, no button
  return (
    <div data-testid="xr-knopf" className={`rounded border border-border bg-card p-1.5 text-xs text-foreground shadow ${className}`}>
      {laeuft ? (
        <div className="flex items-center gap-1.5">
          <span data-testid="xr-laeuft" className="font-medium"><span aria-hidden="true">● </span>{t("VR läuft — Brille aufsetzen")}</span>
          <button type="button" data-testid="xr-beenden" onClick={() => { void sitzungRef.current?.beenden(); }}
            className="rounded border border-foreground px-1.5 py-0.5 hover:bg-muted">{t("VR beenden")}</button>
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          <button type="button" data-testid="xr-start" disabled={startet || !bereit} onClick={() => { void starten(); }}
            title={bereit ? undefined : t("Erst ein Modell laden — dann in VR ansehen")}
            className="rounded bg-primary px-2 py-1 font-medium text-primary-foreground disabled:opacity-60">{startet ? t("VR startet …") : t("In VR ansehen")}</button>
          {!bereit ? <span data-testid="xr-nicht-bereit" className="text-muted-foreground">{t("Erst ein Modell laden — dann in VR ansehen")}</span> : null}
          <span className="text-muted-foreground">{t("Maßstab")}:</span>
          {/** both choices with words and a pressed state (solid outline vs. dotted), not only colour */}
          {[["1:1", "xr-modus-11", "1:1"], ["tisch", "xr-modus-tisch", t("Tisch")]].map(([m, id, label]) => (
            <button key={m} type="button" data-testid={id} aria-pressed={modus === m} onClick={() => setModus(/** @type {"1:1"|"tisch"} */ (m))}
              className={`rounded border px-1.5 py-0.5 ${modus === m ? "border-solid border-foreground bg-muted font-semibold" : "border-dotted border-border hover:bg-muted"}`}>{label}</button>
          ))}
        </div>
      )}
      {fehler ? (
        <div data-testid="xr-fehler" role="alert" className="mt-1 flex gap-1 rounded border border-solid border-fehler-rand bg-fehler-flaeche px-1 py-0.5 text-fehler">
          <span aria-hidden="true" className="font-bold">✕</span><span>{fehler}</span>
        </div>
      ) : null}
    </div>
  );
}
