// 115-05c (§6.5–§6.7, D-115-12): the draft bar of the designer - state, "Speichern", "Verwerfen", the banners of the draft, the
// leave dialog and the hold of the project by ONE tab of this browser. Loaded LAZILY by ComplexDesigner (its chunk is at the size
// budget), together with the draft module (entwurfStand.js) and the i18n part entwurf-115-05.js.
//
//   - state: "Gespeichert" · "● Nicht gespeichert · {n} Änderungen" · "Speichert…" · "Teilweise gespeichert" · "Konflikt — bitte
//     entscheiden" · "Speicherfehler"; a refused local copy (store full) is said, never swallowed.
//   - the bar is ONE line of the header (it must not grow or jump, D-115-41): the status chip and "Speichern". The chip is a button:
//     the panel below it (absolute, over the page) holds the full status, the notes (restored, does not fit, not stored locally, save
//     error, no Web Locks), "Verwerfen" and "Was sofort gespeichert wird"; a new ALARM (does not fit, not stored locally,
//     unreadable entry, save error) opens it by itself, a press outside closes it.
//   - Strg/Cmd+S saves - a page-wide listener in the capture phase that also works inside text fields (editorKuerzel returns null
//     there, zeichnenModell.js) and stops the browser's "save page".
//   - leaving with unsaved changes asks: browser (beforeunload), project switch (verlassenWaechter, ProjectContext), an in-app link
//     (a capture click guard on a[href]). The dialog: Speichern · Als Entwurf behalten · Verwerfen · Abbrechen. What none of these
//     reach (browser back button, a programmatic navigate) keeps the draft locally and offers it again (gap, SUMMARY).
//   - K10: the project's draft is held by one tab of this browser (Web Lock bit-entwurf:<benutzerId>:<projektId>, taken when the
//     designer mounts). A second tab is locked (overlay) and offers "Hier übernehmen" (BroadcastChannel: the holder writes its draft
//     locally and gives up, the new tab takes the lock and reloads). Without navigator.locks the last writer wins locally (banner).
//
// In:  projectId. Out: the bar (and, when needed, the dialog / overlay).

import React, { useEffect, useRef, useState, useSyncExternalStore } from "react";
import * as E from "@core/lib/entwurf/entwurfStand.js";
import { verlassenWaechterSetzen } from "@core/lib/verlassenWaechter.js";
import { useI18n, englischErgaenzen } from "@core/lib/i18n";
import { Button } from "@core/components/ui/button";
import { EN } from "@core/lib/i18nTeile/entwurf-115-05.js";

englischErgaenzen(EN);

/** BroadcastChannel of the tabs of this browser (K10). */
const KANAL = "bit-modell-entwurf";
/** Time a tab waits for the holder's answer before it takes the lock anyway, milliseconds [ASSUMED: the holder writes locally in < 1 s]. */
const UEBERNAHME_MS = 1500;

/**
 * @param {{projectId: string}} props
 * @returns {React.ReactElement}
 */
export default function EntwurfLeiste({ projectId }) {
  const { t } = useI18n();
  const z = useSyncExternalStore(E.abonnieren, () => E.zustand(projectId));
  const [frage, setFrage] = useState(/** @type {null | {weiter: () => void, abbrechen?: () => void}} */ (null));
  const [verwerfenFrage, setVerwerfenFrage] = useState(false);
  const [andererTab, setAndererTab] = useState(false);
  const [ohneLocks, setOhneLocks] = useState(false);
  const uebernehmenRef = useRef(() => {});

  const speichern = () => E.speichern(projectId);

  // Strg/Cmd+S - also inside text fields
  useEffect(() => {
    /** @param {KeyboardEvent} ev */
    const taste = (ev) => {
      if (!(ev.ctrlKey || ev.metaKey) || ev.altKey || String(ev.key).toLowerCase() !== "s") return;
      ev.preventDefault();
      ev.stopPropagation();
      void E.speichern(projectId);
    };
    window.addEventListener("keydown", taste, true);
    return () => window.removeEventListener("keydown", taste, true);
  }, [projectId]);

  // leaving: browser, project switch, in-app links
  useEffect(() => {
    /** @param {BeforeUnloadEvent} ev */
    const vorEntladen = (ev) => {
      if (E.istSauber(projectId) || E.istGesperrt(projectId)) return;
      void E.sichernJetzt(projectId);
      ev.preventDefault();
      ev.returnValue = "";
    };
    window.addEventListener("beforeunload", vorEntladen);
    const ab = verlassenWaechterSetzen((weiter, ziel) => {
      if ((ziel.art === "projekt" && ziel.ziel === projectId) || E.istSauber(projectId) || E.istGesperrt(projectId)) return false;
      setFrage({ weiter });
      return true;
    });
    let durchlassen = false;
    /** @param {MouseEvent} ev */
    const klick = (ev) => {
      if (durchlassen || ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey) return;
      const a = /** @type {HTMLElement|null} */ (ev.target && typeof (/** @type {any} */ (ev.target)).closest === "function" ? (/** @type {any} */ (ev.target)).closest("a[href]") : null);
      if (!a || a.getAttribute("target") === "_blank" || E.istSauber(projectId) || E.istGesperrt(projectId)) return;
      // a download (IFC / PDF / DXF export: an <a download> with a blob: or data: URL, also clicked by code) leaves nothing - a blob
      // URL even has this page's origin, so it is let through here explicitly (bauteilkern-107-04 found the dialog on the IFC export)
      if (a.hasAttribute("download")) return;
      const ziel = new URL(/** @type {HTMLAnchorElement} */ (a).href, window.location.href);
      if (ziel.protocol === "blob:" || ziel.protocol === "data:") return;
      if (ziel.origin !== window.location.origin) return;
      if (ziel.pathname === window.location.pathname && ziel.hash === window.location.hash) return; // same page (query of a tab)
      ev.preventDefault();
      ev.stopPropagation();
      setFrage({ weiter: () => { durchlassen = true; try { a.click(); } finally { durchlassen = false; } } });
    };
    document.addEventListener("click", klick, true);
    // the browser's back button: while the draft holds unsaved work, a guard entry with the same address sits on top of the history
    // (below); "back" pops it - the address does not change, nothing unmounts - and the question comes up. Going on goes back once more.
    let zurueckDurchlassen = false;
    const zurueck = () => {
      if (zurueckDurchlassen) { zurueckDurchlassen = false; return; }
      if (window.history.state?.bitEntwurfWache === projectId || E.istSauber(projectId) || E.istGesperrt(projectId)) return;
      setFrage({
        weiter: () => { zurueckDurchlassen = true; window.history.back(); },
        abbrechen: () => { window.history.pushState({ ...(window.history.state || {}), bitEntwurfWache: projectId }, "", window.location.href); },
      });
    };
    window.addEventListener("popstate", zurueck);
    return () => { window.removeEventListener("beforeunload", vorEntladen); ab(); document.removeEventListener("click", klick, true); window.removeEventListener("popstate", zurueck); };
  }, [projectId]);
  // the guard entry of the back button (above): set once the draft holds unsaved work. It stays when the draft is saved (one more
  // "back" that changes nothing) - removing it would need a "back" of its own.
  useEffect(() => {
    if (z.sauber || andererTab) return;
    if (window.history.state?.bitEntwurfWache === projectId) return;
    window.history.pushState({ ...(window.history.state || {}), bitEntwurfWache: projectId }, "", window.location.href);
  }, [projectId, z.sauber, andererTab]);

  // K10: one tab of this browser holds the project's draft
  useEffect(() => {
    const locks = /** @type {any} */ (navigator).locks;
    const name = () => `bit-entwurf:${E.benutzerId()}:${projectId}`;
    /** @type {BroadcastChannel|null} */
    const kanal = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(KANAL) : null;
    let aus = false;
    /** @type {null | (() => void)} */ let freigeben = null;
    if (!locks) {
      setOhneLocks(true);
      return () => { kanal?.close(); };
    }
    const halten = (/** @type {boolean} */ stehlen) => locks.request(name(), stehlen ? { steal: true } : { ifAvailable: true }, (/** @type {any} */ lock) => {
      if (!lock) { E.sperren(projectId, true); setAndererTab(true); return undefined; }
      E.sperren(projectId, false);
      setAndererTab(false);
      return new Promise((r) => { freigeben = () => r(undefined); if (aus) r(undefined); });
    }).catch(() => {
      // the lock was taken by another tab ("Hier übernehmen" there): this tab rests, its draft was written locally before
      if (!aus) { E.sperren(projectId, true); setAndererTab(true); }
    });
    void E.benutzerBereit().then(() => { if (!aus) void halten(false); });
    if (kanal) {
      kanal.onmessage = async (ev) => {
        const m = ev.data || {};
        if (m.name !== name()) return;
        if (m.art === "abgeben" && !E.istGesperrt(projectId)) {
          await E.sichernJetzt(projectId);
          E.sperren(projectId, true);
          kanal.postMessage({ art: "abgegeben", name: name() });
        }
      };
    }
    uebernehmenRef.current = () => {
      if (!kanal) { void halten(true).then(() => window.location.reload()); return; }
      let fertig = false;
      const los = () => { if (fertig) return; fertig = true; void locks.request(name(), { steal: true }, () => { window.location.reload(); return new Promise(() => {}); }); };
      const alt = kanal.onmessage;
      kanal.onmessage = (ev) => { if (ev.data?.art === "abgegeben" && ev.data?.name === name()) los(); else alt?.call(kanal, ev); };
      kanal.postMessage({ art: "abgeben", name: name() });
      setTimeout(los, UEBERNAHME_MS);
    };
    return () => { aus = true; /** @type {any} */ (freigeben)?.(); kanal?.close(); E.sperren(projectId, false); };
  }, [projectId]);

  /** @param {"speichern"|"behalten"|"verwerfen"|"abbrechen"} wahl */
  const entscheiden = async (wahl) => {
    const weiter = frage?.weiter;
    const abbrechen = frage?.abbrechen;
    setFrage(null);
    if (!weiter || wahl === "abbrechen") { abbrechen?.(); return; }
    if (wahl === "speichern") {
      const s = await E.speichern(projectId);
      if (s !== "gespeichert") { abbrechen?.(); return; } // something stayed unsaved: the person stays and sees why
    } else if (wahl === "behalten") await E.sichernJetzt(projectId);
    else await E.verwerfen(projectId);
    weiter();
  };

  const statusText = z.status === "speichert" ? t("Speichert…")
    : z.status === "teilweise" ? t("Teilweise gespeichert")
      : z.status === "konflikt" ? t("Konflikt — bitte entscheiden")
        : z.status === "fehler" ? t("Speicherfehler")
          : z.sauber ? t("Gespeichert")
            : `● ${t("Nicht gespeichert")} · ${t("{{n}} Änderungen").replace("{{n}}", String(z.aenderungen))}`;
  const farbe = z.status === "fehler" || z.status === "konflikt" ? "text-fehler border-fehler-rand bg-fehler-flaeche"
    : z.sauber && z.status !== "teilweise" ? "text-erfolg border-erfolg-rand bg-erfolg-flaeche" : "text-warnung border-warnung bg-warnung-flaeche";

  // the notes of the draft (restored, does not fit, not stored locally, save error, no Web Locks) - shown in a panel BELOW the bar
  // (absolute), never in the header line itself: the header keeps one line and its height (D-115-41, efh-kleinbefunde-108-01).
  const wiederhergestellt = z.wiederhergestellt && !z.sauber;
  const fehlerText = z.status === "fehler" && z.meldung ? z.meldung : null;
  const hinweisSchluessel = [wiederhergestellt ? "w" : "", z.offen || "", z.sicherung || "", fehlerText || "", ohneLocks ? "l" : "", z.lesefehler || ""].join("|");
  const hatHinweis = hinweisSchluessel !== "|||||";
  // only a note that needs the person (a draft that does not fit, a local copy refused, an unreadable entry, a save error) opens the
  // panel by itself; "restored" and "no Web Locks" are information - the dot on the chip shows them (an auto-opened panel lies over
  // the tab line and took the clicks there, vorschlaege-86-05c / Runde 3)
  const alarmSchluessel = [z.offen || "", z.sicherung || "", fehlerText || "", z.lesefehler || ""].join("|");
  const hatAlarm = alarmSchluessel !== "|||";
  const lesefehlerText = z.lesefehler === "version" ? t("Lokal gesicherter Entwurf aus einer anderen Programmversion — nicht lesbar.")
    : z.lesefehler === "fremd" ? t("Lokal gesicherter Entwurf gehört nicht zu dieser Person oder diesem Projekt — nicht übernommen.")
      : z.lesefehler ? t("Lokal gesicherter Entwurf ist beschädigt — nicht lesbar.") : null;
  // "auto" (opened by an alarm; closes again when it is gone) or "hand" (the chip); closed stays closed until the next NEW alarm
  const [panel, setPanel] = useState(/** @type {null|"auto"|"hand"} */ (null));
  const [zuFuer, setZuFuer] = useState(/** @type {string|null} */ (null));
  useEffect(() => {
    if (hatAlarm && zuFuer !== alarmSchluessel) setPanel((p) => p ?? "auto");
    else if (!hatAlarm) setPanel((p) => (p === "auto" ? null : p));
  }, [hatAlarm, alarmSchluessel, zuFuer]);
  const panelOffen = panel !== null;
  const panelZu = () => { setPanel(null); setZuFuer(alarmSchluessel); };
  const panelRef = useRef(/** @type {HTMLDivElement|null} */ (null));
  const chipRef = useRef(/** @type {HTMLButtonElement|null} */ (null));
  useEffect(() => {
    if (!panelOffen) return undefined;
    const zu = () => { setPanel(null); setZuFuer(alarmSchluessel); };
    /** @param {KeyboardEvent} ev */
    const esc = (ev) => { if (ev.key === "Escape") zu(); };
    // a press anywhere outside the panel and the chip closes it (a popover, never a trap over the page)
    /** @param {PointerEvent} ev */
    const weg = (ev) => {
      const ziel = /** @type {Node|null} */ (ev.target);
      if (ziel && (panelRef.current?.contains(ziel) || chipRef.current?.contains(ziel))) return;
      zu();
    };
    window.addEventListener("keydown", esc);
    document.addEventListener("pointerdown", weg, true);
    return () => { window.removeEventListener("keydown", esc); document.removeEventListener("pointerdown", weg, true); };
  }, [panelOffen, alarmSchluessel]);

  // the chip's short word (the count stands beside it); the full sentence is its title and the panel's first line
  const kurz = z.status === "speichert" ? t("Speichert…")
    : z.status === "teilweise" ? t("Teilweise gespeichert")
      : z.status === "konflikt" ? t("Konflikt — bitte entscheiden")
        : z.status === "fehler" ? t("Speicherfehler")
          : z.sauber ? t("Gespeichert") : `● ${t("Nicht gespeichert")}`;

  return (
    // ONE line of the designer header: the status chip (a button: it opens the panel below) and "Speichern". basis-0 + grow +
    // min-width: the bar takes the free rest of the header line (it never wraps the line for its content, D-115-41) and keeps that
    // width in every state; the chip truncates when the line is narrow (full text in its title and in the panel).
    <div className="relative ml-auto flex min-w-[10rem] basis-0 grow flex-nowrap items-center justify-end gap-2 whitespace-nowrap" data-testid="entwurf-leiste">
      <button type="button" ref={chipRef} data-testid="entwurf-status" data-zustand={z.status} data-sauber={z.sauber ? "1" : "0"} data-aenderungen={z.aenderungen}
        aria-expanded={panelOffen} aria-haspopup="dialog" aria-label={`${statusText} — ${t("Hinweise zum Speichern")}`}
        title={z.meldung ? `${statusText} — ${t(z.meldung)}` : statusText} onClick={() => (panelOffen ? panelZu() : setPanel("hand"))}
        className={`relative flex min-w-0 shrink items-center gap-1 text-xs pl-2 pr-1.5 py-0.5 rounded-full border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${farbe}`}>
        <span className="min-w-0 truncate">{kurz}</span>
        {!z.sauber && z.aenderungen > 0 ? <span className="shrink-0 rounded-full bg-background/70 px-1.5 tabular-nums">{z.aenderungen}</span> : null}
        <span aria-hidden="true" className="shrink-0 opacity-70">▾</span>
        {hatHinweis ? <span aria-hidden="true" data-testid="entwurf-hinweis-punkt" className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-warnung" /> : null}
      </button>
      <Button size="sm" className="shrink-0" onClick={() => void speichern()} disabled={z.status === "speichert" || andererTab || Boolean(z.offen)}
        // its accessible name says WHAT is saved: the designer's tabs have "Speichern" buttons of their own (HOAI planner, settings),
        // two buttons with one name would be ambiguous for a screen reader (and for getByRole, controlling-81-05)
        data-testid="entwurf-speichern" aria-label={t("Modell speichern (Strg+S)")} title={t("Modell speichern (Strg+S)")}>
        {z.status === "speichert" ? t("Speichert…") : t("Speichern")}
      </Button>
      {panelOffen ? (
        <div ref={panelRef} data-testid="entwurf-hinweise" role="dialog" aria-label={t("Hinweise zum Speichern")}
          className="absolute right-0 top-full z-40 mt-1 w-[min(28rem,calc(100vw-2rem))] space-y-2 whitespace-normal rounded-lg border border-border bg-card p-3 text-xs shadow-lg">
          <div className="flex items-start justify-between gap-2">
            <p className="font-medium text-foreground">{statusText}</p>
            <button type="button" className="-mr-1 -mt-1 rounded px-1 text-muted-foreground hover:bg-muted" aria-label={t("Schließen")} data-testid="entwurf-hinweise-zu" onClick={panelZu}>×</button>
          </div>
          {wiederhergestellt ? (
            <p data-testid="entwurf-wiederhergestellt" className="text-muted-foreground">
              {t("Ungespeicherte Änderungen aus diesem Browser wiederhergestellt — „Speichern“ übernimmt sie, „Verwerfen“ verwirft sie.")}
            </p>
          ) : null}
          {z.offen ? (
            <div role="alert" data-testid="entwurf-offen" className="flex flex-wrap items-center gap-2 text-warnung">
              {t("Der lokale Entwurf passt nicht mehr zum gespeicherten Modell (ersetzt oder gelöscht). Er wird nicht automatisch fortgesetzt.")}
              <Button size="sm" variant="outline" data-testid="entwurf-trotzdem" onClick={() => { void E.trotzdemFortsetzen(projectId).then(() => window.location.reload()); }}>
                {t("Trotzdem fortsetzen")}
              </Button>
            </div>
          ) : null}
          {z.sicherung ? (
            <p role="alert" data-testid="entwurf-sicherung" className="text-fehler">{t("Entwurf nicht lokal gesichert")}: {t(z.sicherung)}</p>
          ) : null}
          {fehlerText ? (
            <p role="alert" data-testid="entwurf-fehler" className="text-fehler">{t(fehlerText)} — {t("Der Entwurf bleibt erhalten.")}</p>
          ) : null}
          {lesefehlerText ? (
            <p role="alert" data-testid="entwurf-lesefehler" className="text-warnung">
              {lesefehlerText} {t("Das gespeicherte Modell ist geöffnet; die nächste Änderung ersetzt den unlesbaren Eintrag.")}
            </p>
          ) : null}
          {ohneLocks ? <p className="text-muted-foreground">{t("Mehrere Tabs: der zuletzt gesicherte Entwurf gilt.")}</p> : null}
          <div className="flex flex-wrap items-center gap-2">
            {verwerfenFrage ? (
              <span className="flex items-center gap-2" role="group" aria-label={t("Entwurf verwerfen?")}>
                {t("Entwurf verwerfen?")}
                <Button size="sm" variant="destructive" data-testid="entwurf-verwerfen-ja" onClick={() => { setVerwerfenFrage(false); void E.verwerfen(projectId); }}>{t("Verwerfen")}</Button>
                <Button size="sm" variant="ghost" onClick={() => setVerwerfenFrage(false)}>{t("Abbrechen")}</Button>
              </span>
            ) : (
              <Button size="sm" variant="outline" data-testid="entwurf-verwerfen" disabled={(z.sauber && !z.offen) || andererTab} onClick={() => setVerwerfenFrage(true)}>{t("Verwerfen")}</Button>
            )}
          </div>
          {/* 115-05c: what is NOT a draft (115-05-PLAN §8: other editors' layers and the design-record fields outside the site group
              keep their autosave with the stand protection of 115-05a/b) - said where "Speichern" is, so the split is visible */}
          <div data-testid="entwurf-sofort" className="text-muted-foreground">
            <p className="font-medium text-foreground">{t("Was sofort gespeichert wird")}</p>
            <p className="mt-1">{t("Sofort gespeichert (kein Entwurf): Massing-Körper, Wohnungs-Werkstatt, Aufbauten, Fachplanung (Tragwerk, Brandschutz, Schallschutz, Raumklima, Barrierefreiheit, Entwässerung, TGA-Netz), Außenanlagen, Bauaufnahme mit Georeferenz, Bestandsbefunde, Möblierung und Innenausbau, Wohnungstypen, Stellplätze, Energiesysteme, Hochwasser, Kennzahlen von Hand, Name des Entwurfs, Ansichten und Ebenen, Skizze, Raumprogramm, Förderanträge, HOAI-Plan, ASR-Raumdatenblatt und Projektdaten. Im IFC-Viewer sofort: „Grundriss übernehmen“ (Grundriss und Geschosszahl), Lieferpaket, IDS-Regeln, Befunde (BCF). Gebäudemodell (Bauteile, Hülle, Attribute, Solid-Relationen), Geschosse, Grundstück und Lage werden erst mit „Speichern“ übernommen.")}</p>
          </div>
        </div>
      ) : null}
      {andererTab ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80" data-testid="entwurf-anderer-tab" role="dialog" aria-modal="true">
          <div className="max-w-md rounded-lg border border-border bg-card p-4 text-sm shadow-lg space-y-3">
            <p>{t("Dieses Projekt wird in einem anderen Tab dieses Browsers bearbeitet. Hier ist das Modell schreibgeschützt.")}</p>
            <Button size="sm" data-testid="entwurf-uebernehmen" onClick={() => uebernehmenRef.current()}>{t("Hier übernehmen")}</Button>
          </div>
        </div>
      ) : null}
      {frage ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/60" role="dialog" aria-modal="true" data-testid="entwurf-verlassen">
          <div className="max-w-md rounded-lg border border-border bg-card p-4 text-sm shadow-lg space-y-3">
            <p className="font-medium">{t("Ungespeicherte Änderungen am Modell")}</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => void entscheiden("speichern")}>{t("Speichern")}</Button>
              <Button size="sm" variant="outline" onClick={() => void entscheiden("behalten")}>{t("Als Entwurf behalten")}</Button>
              <Button size="sm" variant="destructive" onClick={() => void entscheiden("verwerfen")}>{t("Verwerfen")}</Button>
              <Button size="sm" variant="ghost" onClick={() => void entscheiden("abbrechen")}>{t("Abbrechen")}</Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
