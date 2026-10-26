// 106-05: the speech field of a viewer - push-to-talk button, a line to type the same sentences, the answer in words, the help.
// What is heard appears as text FIRST; then the sentence runs through the flow (sprechAblauf.js): the grammar (no language model),
// else - only for a sentence nobody knows - the harness agent with the selection as context. Whatever comes out, a change is only a
// PROPOSAL that appears in the preview card (AenderungsVorschau); it runs after "ja" by the person (spoken, Alt+J, Strg+Enter, the
// button Übernehmen) - never because an agent or the model said so (decision D-IM-04).
// A SPOKEN confirmation ("ja", "übernehmen"; "ok"/"mach das" count only typed) does not run in the same moment it is heard: the transcript and
// the sentence it would apply stand on the screen for BESTAETIGUNG_FRIST_MS with an "Abbrechen" button first (review 106-05: a recognition
// error must not apply a change the person has not seen in words).
//
// Not tested on a device: the real microphone prompt and a real speech model (see 106-05-SUMMARY); the field is proved with Chromium's
// fake audio device and a stand-in for the recognition.
//
// In:  the viewer's command register, accessors for the selection (auswahlKontext record), the view directions and the pointed-at spot,
//      the project's NDA marker, the translator t. Out: DOM; data-testids sprech-feld, sprech-knopf, sprech-eingabe, sprech-gehoert,
//      sprech-antwort (data-art, data-ok, data-stufe), sprech-bestaetigung (+ -abbrechen), sprech-rueckfrage, sprech-cloud-ok, sprech-hilfe-knopf,
//      sprech-hilfe; 106-06: sprech-bild (aria-pressed, data-ziel lokal|extern|nie), sprech-bild-ziel, sprech-bild-zustimmung (+ -ja, -nein),
//      sprech-bild-zuruecknehmen.
// 106-06: the button "mit Bild" sends ONE image of the current view (selection highlighted) along with a free sentence - as context only. The
// line under it says where the image would go (provider and host; "verlässt diesen Rechner" in words and with the ↗ sign, not by colour); an
// NDA project shows "nie" and the button is off; the first image of a project to a model outside this computer asks once for the project,
// and after that consent the per-sentence question of 106-05 still follows (it names everything that leaves). An unknown target shows "?".
import React, { useEffect, useMemo, useRef, useState } from "react";
import { HelpCircle } from "lucide-react";
import SprechKnopf from "@core/components/SprechKnopf.jsx";
import { aufnahmeStarten } from "@core/lib/zeigen/aufnahme.js";
import { modellFragen } from "@core/lib/zeigen/sprachAgent.js";
import { antwortSatz, sprechAblauf } from "@core/lib/zeigen/sprechAblauf.js";
import { sprechDienst } from "@core/lib/zeigen/sprechDienst.js";
import { sprechTastenAnbinden } from "@core/lib/zeigen/sprechTasten.js";
import { sprechSteuerung } from "@core/lib/zeigen/sprechStart.js";
import { SATZ_HILFE, sprachbefehl } from "@core/lib/zeigen/sprachbefehl.js";
import { BILD_GRUENDE, bildZielText } from "@core/lib/zeigen/bildKontext.js";

/** How long a spoken "ja" stands on the screen before it applies, in ms [ASSUMED: long enough to read one line and hit "Abbrechen", short enough not to feel stuck]. */
export const BESTAETIGUNG_FRIST_MS = 1500;

/** Field sentence when the harness does not answer (same text as harnessClient SPRECH_OHNE_HARNESS; a key of the dictionary). */
const OHNE_HARNESS = "Spracheingabe braucht den KI-Harness (Einstellungen › KI)";

/**
 * Form of an answer, so colour is never the only carrier (guard rail 5): a refusal is a SOLID border with "✕", an open question a dotted border
 * with "?", a hint without effect (model answered without a proposal) a dotted border with "–", done a "✓" without border.
 */
const ANTWORT_FORM = {
  fehler: { rand: "border border-solid border-fehler-rand bg-fehler-flaeche text-fehler", zeichen: "✕" },
  frage: { rand: "border border-dotted border-border text-foreground", zeichen: "?" },
  hinweis: { rand: "border border-dotted border-border text-foreground", zeichen: "–" },
  ok: { rand: "text-foreground", zeichen: "✓" },
};

/**
 * @param {{register: ReturnType<typeof import("@core/lib/befehlsregister.js").befehlsRegister>, kontext: () => any,
 *   ansicht?: () => any, zeigepunkt?: () => any, nda?: boolean, projektId?: string|null, bild?: ((o: {kante: number, breite: number}) => {png_base64: string})|null,
 *   t?: (s: string) => string, className?: string, grob?: boolean}} props
 *   register: the viewer's command register; kontext: selection record (auswahlKontext); ansicht: {rechts, vorn} unit vectors of the view in the plan;
 *   zeigepunkt: {x, z} in m, the spot last pointed at; nda: the open project carries the NDA marker (Project.nda); projektId: the open project
 *   (106-06, consent and NDA are stored on it); bild: renders the current view as PNG (106-06; without it there is no "mit Bild" button);
 *   grob: tablet layout (106-07).
 */
export default function SprechFeld({ register, kontext, ansicht, zeigepunkt, nda = false, projektId = null, bild = null, t = (s) => s, className = "", grob = false }) {
  const [mitBild, setMitBild] = useState(false);
  /** @type {React.MutableRefObject<any>} */
  const neu = useRef({});
  neu.current = { kontext, ansicht, zeigepunkt, nda, projektId, bild: bild && mitBild && !nda ? bild : null };
  const [zustand, setZustand] = useState(/** @type {"bereit"|"aufnahme"|"erkennt"|"aus"} */ ("bereit"));
  const zustandRef = useRef(zustand);
  zustandRef.current = zustand;
  const [bereit, setBereit] = useState(/** @type {any} */ (null));
  const bereitRef = useRef(/** @type {any} */ (null));
  const [gehoert, setGehoert] = useState("");
  const [antwort, setAntwort] = useState(/** @type {{text: string, art: string, ok: boolean, stufe: keyof typeof ANTWORT_FORM}|null} */ (null));
  const [rueckfrage, setRueckfrage] = useState(/** @type {string|null} */ (null));
  const [cloud, setCloud] = useState(/** @type {{text: string, herkunft: "text"|"sprache", anbieter: string}|null} */ (null));
  /** 106-06: a sentence waiting for the project's consent to send an image outside this computer. */
  const [bildFrage, setBildFrage] = useState(/** @type {{text: string, herkunft: "text"|"sprache"}|null} */ (null));
  /** 106-06: what the store says about images of this project for the current target (shown under the button). */
  const [bildStand, setBildStand] = useState(/** @type {{ok: boolean, grund: string|null, text: string, zugestimmt?: boolean}|null} */ (null));
  const [halt, setHalt] = useState(/** @type {{text: string, was: string}|null} */ (null));
  const haltTimer = useRef(/** @type {any} */ (null));
  const [laeuft, setLaeuft] = useState(false);
  const [eingabe, setEingabe] = useState("");
  const [hilfe, setHilfe] = useState(false);
  /** Readiness check of the current press (runs while the microphone opens; awaited before anything is sent). */
  const pruefung = useRef(/** @type {Promise<any>|null} */ (null));

  const ablauf = useMemo(() => sprechAblauf({
    register,
    kontext: () => ({ auswahl: neu.current.kontext(), ansicht: neu.current.ansicht?.() ?? null, zeigepunkt: neu.current.zeigepunkt?.() ?? null }),
    modellFrage: (text, k, o) => modellFragen(text, k.auswahl, {
      cloudOk: o.cloudOk, nda: !!neu.current.nda, bild: neu.current.bild, projektId: neu.current.projektId, gesprochen: o.herkunft === "sprache",
    }),
  }), [register]);

  const bereitLesen = async () => {
    const d = sprechDienst();
    if (!d) return null;
    const b = await d.bereit().catch(() => null);
    bereitRef.current = b;
    setBereit(b);
    return b;
  };
  useEffect(() => { void bereitLesen(); }, []);

  /** 106-06: where an image would go right now, from the harness's readiness. */
  const bildZiel = bereit ? { lokal: !!bereit.providerLokal, anbieter: bereit.provider ?? null, host: bereit.providerZiel ?? null } : null;
  /** Reads the store's answer for images of this project (NDA, consent, switches) - shown under the button, re-read after a consent. */
  const bildStandLesen = async () => {
    const d = sprechDienst();
    if (!mitBild || nda || !projektId || !bildZiel || typeof d?.bildFreigabe !== "function") { setBildStand(null); return; }
    setBildStand(await d.bildFreigabe(projektId, bildZiel));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void bildStandLesen(); }, [mitBild, nda, projektId, bereit?.provider, bereit?.providerLokal, bereit?.providerZiel]);

  /** @param {any} b @returns {boolean} speech can record and be recognised right now */
  const sprechbereit = (b) => !!(sprechDienst() && b?.harness && b?.stt && b?.sttBereit);
  /** Shows in words why speech does not work now. @param {any} b */
  const nichtBereitZeigen = (b) => {
    if (!sprechDienst() || !b?.harness || !b?.stt) {
      setZustand("aus");
      setAntwort({ text: t(b?.sttHinweis || b?.hinweis || OHNE_HARNESS), art: "aus", ok: false, stufe: "fehler" });
    } else {
      setZustand("bereit");
      setAntwort({ text: t("Das Sprachmodell lädt noch — gleich noch einmal versuchen"), art: "aus", ok: false, stufe: "fehler" });
    }
  };

  /** Form of an answer of the flow. @param {any} r @returns {keyof typeof ANTWORT_FORM} */
  const stufeVon = (r) => {
    if (!r.ok || r.art === "modell-fehler") return "fehler";
    if (r.art === "modell-freigabe" || r.art === "rueckfrage" || r.art === "bild-zustimmung") return "frage";
    if (r.art === "modell" && !(r.vorschlaege > 0)) return "hinweis"; // the model only answered in words: nothing waits in the window
    return "ok";
  };

  /** Runs one sentence through the flow and shows the answer. @param {string} text @param {"text"|"sprache"} herkunft @param {boolean} [cloudOk] */
  const senden = async (text, herkunft, cloudOk = false) => {
    const satz = String(text).trim();
    if (!satz) return;
    setCloud(null);
    setBildFrage(null);
    setLaeuft(true);
    try {
      // 106-06 review fix: with "mit Bild" the target line is re-read before every sentence, so the button shows the target the check uses
      // (the harness profile may have changed since the field opened; modellFragen reads it fresh as well)
      if (neu.current.bild) await bereitLesen();
      const r = await ablauf.verarbeiten(satz, herkunft, { cloudOk });
      setRueckfrage(ablauf.rueckfrage()?.frage ?? null);
      if (r.art === "modell-freigabe") setCloud({ text: satz, herkunft, anbieter: r.anbieter ?? "" });
      if (r.art === "bild-zustimmung") setBildFrage({ text: satz, herkunft });
      const werkzeuge = "werkzeuge" in r && r.werkzeuge?.length ? ` (${r.werkzeuge.join(", ")})` : "";
      const mitBildText = r.art === "modell" && /** @type {any} */ (r).mitBild ? ` — ${t("mit Bild der Ansicht")}` : "";
      setAntwort({ text: antwortSatz(r, t) + (r.art === "modell" ? werkzeuge + mitBildText : ""), art: r.art, ok: !!r.ok && r.art !== "modell-fehler", stufe: stufeVon(r) });
    } catch (e) {
      setAntwort({ text: String(/** @type {any} */ (e)?.message || e), art: "fehler", ok: false, stufe: "fehler" });
    } finally {
      setLaeuft(false);
    }
  };

  const haltAbbrechen = () => {
    clearTimeout(haltTimer.current);
    haltTimer.current = null;
    setHalt(null);
  };

  /**
   * What a spoken confirmation would apply, in words - or null when it would apply nothing (then it runs at once and is refused in words).
   * @param {string} text @returns {string|null}
   */
  const bestaetigungZiel = (text) => {
    const g = sprachbefehl(text, { gesprochen: true });
    if (g?.art !== "befehl" || g.befehl !== "bestaetigen") return null;
    const frage = ablauf.rueckfrage()?.frage;
    if (frage) return frage;
    const v = register.ausfuehren("vorschlaege", {}, {});
    const offen = v.ok ? (v.result?.offen ?? []) : [];
    return offen.length === 1 ? String(offen[0].satz ?? "") : null;
  };

  const steuerung = useMemo(() => {
    const s = sprechSteuerung({
      vorbereiten: async () => {
        if (zustandRef.current === "erkennt") return false;
        haltAbbrechen(); // a new sentence drops a spoken "ja" that is still waiting
        const p = bereitLesen();
        pruefung.current = p;
        // known ready: the microphone opens at once (the start of the sentence is not cut off); the fresh check runs alongside - if it
        // says no, the recording is dropped and the reason shown, and stoppen() awaits it before anything is sent. Unknown or not ready: check first.
        if (sprechbereit(bereitRef.current)) {
          void p.then((b) => { if (pruefung.current === p && !sprechbereit(b)) { s.verwerfen(); nichtBereitZeigen(b); } });
          return true;
        }
        const b = await p;
        if (!sprechbereit(b)) { nichtBereitZeigen(b); return false; }
        return true;
      },
      aufnehmen: () => aufnahmeStarten(),
      beiAufnahme: () => { setZustand("aufnahme"); setAntwort(null); },
      beiFehler: (e) => setAntwort({ text: String(e?.message || e), art: "aus", ok: false, stufe: "fehler" }),
      // review 106-07: the release got lost (MAX_AUFNAHME_MS): end the recording as if the button had been let go - never an open microphone
      beiHoechst: () => { void neuHandler.current.stoppen(); },
    });
    return s;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stoppen = async () => {
    const rec = steuerung.stoppen();
    if (!rec) return; // nothing was recording (released before the microphone was open, or speech not available)
    setZustand("erkennt");
    try {
      const aufnahme = await rec;
      const b = await (pruefung.current ?? bereitLesen());
      if (!sprechbereit(b)) { nichtBereitZeigen(b); return; }
      if (!aufnahme) { setAntwort({ text: t("Aufnahme zu kurz — den Knopf halten, solange Sie sprechen"), art: "aus", ok: false, stufe: "fehler" }); return; }
      const d = sprechDienst();
      const r = await /** @type {NonNullable<typeof d>} */ (d).stt(aufnahme.blob);
      const text = String(r.text || "").trim();
      setGehoert(text);
      if (text.length < 2) { setAntwort({ text: t("Nichts verstanden"), art: "aus", ok: false, stufe: "fehler" }); return; }
      const was = bestaetigungZiel(text);
      if (was != null) {
        // shown first, applied after the delay unless cancelled (the timer runs after the render, so the transcript is on screen before the change)
        setAntwort(null);
        setHalt({ text, was });
        clearTimeout(haltTimer.current);
        haltTimer.current = setTimeout(() => { haltTimer.current = null; setHalt(null); void senden(text, "sprache"); }, BESTAETIGUNG_FRIST_MS);
        return;
      }
      await senden(text, "sprache");
    } catch (e) {
      setAntwort({ text: `${t("Spracherkennung fehlgeschlagen")}: ${/** @type {any} */ (e)?.message || e}`, art: "aus", ok: false, stufe: "fehler" });
    } finally {
      setZustand("bereit");
    }
  };

  /** Confirm / discard by key: the same commands as the buttons and the sentences, so one road and one check. @param {"bestaetigen"|"verwerfen"} id */
  const tasteBefehl = (id) => {
    haltAbbrechen();
    const r = register.ausfuehren(id, id === "bestaetigen" ? { durch: "tastatur" } : {}, {});
    setAntwort(r.ok
      ? { text: `${id === "bestaetigen" ? t("Übernommen") : t("Verworfen")}: ${r.result?.satz ?? ""}`, art: "taste", ok: true, stufe: "ok" }
      : { text: t(/** @type {{error: string}} */ (r).error), art: "taste", ok: false, stufe: "fehler" });
  };

  const neuHandler = useRef(/** @type {any} */ ({}));
  neuHandler.current = { starten: () => steuerung.starten(), stoppen, tasteBefehl };
  useEffect(() => sprechTastenAnbinden(window, {
    start: () => neuHandler.current.starten(), stopp: () => neuHandler.current.stoppen(),
    uebernehmen: () => neuHandler.current.tasteBefehl("bestaetigen"), verwerfen: () => neuHandler.current.tasteBefehl("verwerfen"),
  }), []);
  useEffect(() => () => { steuerung.abbrechen(); clearTimeout(haltTimer.current); }, [steuerung]);

  const knopfTitel = !bereit ? t("Halten zum Sprechen (Leertaste + V)")
    : !bereit.harness || !bereit.stt ? t(bereit.sttHinweis || bereit.hinweis || OHNE_HARNESS)
      : `${t("Halten zum Sprechen (Leertaste + V)")}`;
  const form = ANTWORT_FORM[antwort?.stufe ?? "ok"];
  // review 106-07: the button keeps ONE place in the tree (first child of the row); the tablet layout moves it to the outer right end with
  // CSS order only. Swapping its place in the tree would re-mount it - and the layout switches in the very pointerdown that starts a
  // recording (first finger after the mouse), so the pointer capture and the release would be lost and the microphone would stay open.
  const knopf = (
    <SprechKnopf zustand={zustand === "bereit" && bereit && (!bereit.harness || !bereit.stt) ? "aus" : zustand} t={t} title={knopfTitel} gross={grob}
      className={grob ? "order-last" : ""} onStart={() => { void steuerung.starten(); }} onStopp={() => { void stoppen(); }} />
  );

  /**
   * 106-06: the person agrees once for this project, then the waiting sentence runs again WITHOUT cloudOk (review fix): for a target outside
   * this computer the per-sentence question of 106-05 follows, which names everything that leaves (sentence, selection, image, and that the
   * model may read open proposals, earlier sentences and check results) - the consent text itself only speaks of the image.
   */
  const bildZustimmen = async () => {
    const f = bildFrage;
    const d = sprechDienst();
    if (!f || !projektId || typeof d?.bildZustimmen !== "function") return;
    const r = await d.bildZustimmen(projektId);
    if (!r.ok) { setBildFrage(null); setAntwort({ text: t(r.text || "Zustimmung nicht gespeichert"), art: "bild-zustimmung", ok: false, stufe: "fehler" }); return; }
    await bildStandLesen();
    await senden(f.text, f.herkunft, false);
  };
  const bildZuruecknehmen = async () => {
    const d = sprechDienst();
    if (!projektId || typeof d?.bildZuruecknehmen !== "function") return;
    const r = await d.bildZuruecknehmen(projektId);
    setAntwort(r.ok ? { text: t("Zustimmung für Bilder dieses Projekts zurückgenommen"), art: "bild-zustimmung", ok: true, stufe: "hinweis" }
      : { text: t(r.text || "Zurücknehmen fehlgeschlagen"), art: "bild-zustimmung", ok: false, stufe: "fehler" });
    await bildStandLesen();
  };
  /** "nie" (NDA), "lokal" (the model runs here), "extern" (the image would leave this computer), "" (unknown yet: shown with "?", never as local). */
  const bildZielArt = nda ? "nie" : bildZiel ? (bildZiel.lokal ? "lokal" : "extern") : "";

  return (
    // review 106-07: in the tablet layout the row with the big button is the LAST line on screen (flex-col-reverse, CSS only): answers,
    // questions and the help grow upwards, the button stays at the bottom edge where the thumb is
    <div data-testid="sprech-feld" data-grob={grob ? "ja" : "nein"} className={`rounded border border-border bg-card p-2 text-xs text-foreground shadow ${grob ? "flex flex-col-reverse gap-1" : ""} ${className}`}>
      <div data-testid="sprech-zeile" className={`flex items-center ${grob ? "gap-2" : "gap-1.5"}`}>
        {knopf}
        <input data-testid="sprech-eingabe" value={eingabe} disabled={laeuft} aria-label={t("Befehl sagen oder tippen")} placeholder={t("Befehl sagen oder tippen")}
          onChange={(e) => setEingabe(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && eingabe.trim()) { e.preventDefault(); const text = eingabe; setEingabe(""); setGehoert(""); haltAbbrechen(); void senden(text, "text"); } }}
          className={`min-w-0 flex-1 rounded border border-border bg-background px-1.5 text-foreground disabled:opacity-60 ${grob ? "py-2.5 text-sm" : "py-1"}`} />
        {bild ? (
          <button type="button" data-testid="sprech-bild" aria-pressed={mitBild && !nda} data-ziel={bildZielArt} disabled={nda}
            title={nda ? t(BILD_GRUENDE.nda) : t("Ein Bild der aktuellen Ansicht als Kontext mitschicken (nur bei freien Sätzen an das Sprachmodell)")}
            onClick={() => { const an = !mitBild; setMitBild(an); if (an) void bereitLesen(); }}
            className={`shrink-0 rounded border px-1.5 disabled:opacity-60 ${grob ? "py-2.5" : "py-1"} ${mitBild && !nda ? "border-solid border-foreground bg-muted font-semibold" : "border-dotted border-border hover:bg-muted"}`}>
            {nda ? t("Bild: nie (NDA)") : mitBild ? t("mit Bild ✓") : t("mit Bild")}
          </button>
        ) : null}
        <button type="button" data-testid="sprech-hilfe-knopf" aria-expanded={hilfe} title={t("Welche Sätze werden verstanden?")} aria-label={t("Welche Sätze werden verstanden?")}
          onClick={() => setHilfe((v) => !v)} className={`shrink-0 rounded border border-border hover:bg-muted ${grob ? "p-2.5" : "p-1"}`}><HelpCircle aria-hidden="true" className="h-3.5 w-3.5" /></button>
      </div>
      {bild && mitBild && !nda ? (
        <div data-testid="sprech-bild-ziel" data-ziel={bildZielArt} className="mt-1 flex items-center gap-1.5 text-muted-foreground">
          <span aria-hidden="true" className="shrink-0 font-bold">{bildZielArt === "extern" ? "↗" : bildZielArt === "lokal" ? "⌂" : "?"}</span>
          <span className="min-w-0 flex-1">
            {t("Bild geht")} {bildZiel ? bildZielText(bildZiel, t) : t("an das Modell des KI-Harness (noch unbekannt)")}
            {bildZielArt === "extern" ? ` — ${t("verlässt diesen Rechner")}` : ""}
            {bildStand && !bildStand.ok ? ` · ${t(bildStand.grund === "zustimmung" ? "noch keine Zustimmung für dieses Projekt" : bildStand.text)}` : ""}
            {bildStand?.ok && bildZielArt === "extern" ? ` · ${t("Zustimmung für dieses Projekt erteilt")}` : ""}
          </span>
          {bildStand?.zugestimmt ? (
            <button type="button" data-testid="sprech-bild-zuruecknehmen" onClick={() => { void bildZuruecknehmen(); }} className="rounded border border-border px-1.5 py-0.5 hover:bg-muted">{t("Zustimmung zurücknehmen")}</button>
          ) : null}
        </div>
      ) : null}
      {gehoert ? <div data-testid="sprech-gehoert" className="mt-1 text-muted-foreground">{t("Gehört")}: „{gehoert}“</div> : null}
      {laeuft ? <div data-testid="sprech-laeuft" className="mt-1 italic text-muted-foreground">{t("Sprachmodell arbeitet …")}</div> : null}
      {halt ? (
        <div data-testid="sprech-bestaetigung" role="status" className="mt-1 flex items-center gap-1.5 rounded border border-dotted border-border px-1 py-0.5">
          <span aria-hidden="true" className="shrink-0 font-bold">?</span>
          <span className="min-w-0 flex-1">{t("Wird gleich übernommen")}: {halt.was}</span>
          <button type="button" data-testid="sprech-bestaetigung-abbrechen" onClick={() => { haltAbbrechen(); setAntwort({ text: t("Nicht übernommen — der Vorschlag wartet weiter"), art: "abgebrochen", ok: true, stufe: "hinweis" }); }}
            className="rounded border border-border px-1.5 py-0.5 hover:bg-muted">{t("Abbrechen")}</button>
        </div>
      ) : null}
      {antwort ? (
        <div data-testid="sprech-antwort" data-art={antwort.art} data-ok={antwort.ok ? "ja" : "nein"} data-stufe={antwort.stufe} className={`mt-1 flex gap-1 rounded px-1 py-0.5 ${form.rand}`}>
          <span aria-hidden="true" className="shrink-0 font-bold">{form.zeichen}</span><span>{antwort.text}</span>
        </div>
      ) : null}
      {rueckfrage ? (
        <div data-testid="sprech-rueckfrage" className="mt-1 flex items-center gap-1.5 rounded border border-dotted border-border px-1 py-0.5">
          <span className="min-w-0 flex-1">{rueckfrage}</span>
          <button type="button" data-testid="sprech-rueckfrage-ja" onClick={() => { void senden("ja", "text"); }} className="rounded bg-primary px-1.5 py-0.5 text-primary-foreground">{t("Ja")}</button>
          <button type="button" data-testid="sprech-rueckfrage-nein" onClick={() => { void senden("nein", "text"); }} className="rounded border border-border px-1.5 py-0.5 hover:bg-muted">{t("Nein")}</button>
        </div>
      ) : null}
      {cloud ? (
        <div className="mt-1 flex gap-1.5">
          <button type="button" data-testid="sprech-cloud-ok" onClick={() => { const c = cloud; void senden(c.text, c.herkunft, true); }} className="rounded bg-primary px-1.5 py-0.5 text-primary-foreground">{t("Trotzdem senden")}</button>
          <button type="button" data-testid="sprech-cloud-nein" onClick={() => { setCloud(null); setAntwort(null); }} className="rounded border border-border px-1.5 py-0.5 hover:bg-muted">{t("Nicht senden")}</button>
        </div>
      ) : null}
      {bildFrage ? (
        <div data-testid="sprech-bild-zustimmung" className="mt-1 flex flex-wrap gap-1.5">
          <button type="button" data-testid="sprech-bild-zustimmung-ja" onClick={() => { void bildZustimmen(); }} className="rounded bg-primary px-1.5 py-0.5 text-primary-foreground">{t("Für dieses Projekt zustimmen und senden")}</button>
          <button type="button" data-testid="sprech-bild-zustimmung-nein" onClick={() => { setBildFrage(null); setAntwort({ text: t("Nicht gesendet — kein Bild, kein Satz"), art: "bild-zustimmung", ok: true, stufe: "hinweis" }); }}
            className="rounded border border-border px-1.5 py-0.5 hover:bg-muted">{t("Nicht senden")}</button>
        </div>
      ) : null}
      {hilfe ? (
        <div data-testid="sprech-hilfe" className="mt-1 max-h-56 overflow-y-auto rounded border border-dotted border-border p-1">
          <div className="font-semibold">{t("Diese Sätze versteht die Eingabe ohne Sprachmodell")}</div>
          <ul className="mt-0.5 space-y-0.5">
            {SATZ_HILFE.map((h) => (<li key={h.satz}><span className="font-medium">„{h.satz}“</span> — <span className="text-muted-foreground">{t(h.wirkung)}</span></li>))}
          </ul>
          <div className="mt-1 text-muted-foreground">{t("„dieses“, „diese“, „dort“ meinen das gewählte Bauteil. Tasten: Leertaste + V sprechen, Alt+J oder Strg+Enter übernehmen, Alt+N verwerfen.")}</div>
        </div>
      ) : null}
    </div>
  );
}
