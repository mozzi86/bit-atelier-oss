// ModulFehlergrenze.jsx — error boundaries for routes and for the whole app (70-07).
//
// In:  children (a route element or the app), `pfad` (current route, shown in the
//      report), optional `sichern` (async fn that downloads the project as .bitproj —
//      passed only by serverless builds, where the data lives in the browser).
// Out: the children, or — after a render error / failed chunk import — a card in
//      place of the page. Sidebar and header stay, because the boundary sits
//      INSIDE <Layout>. The caller keys it by route, so navigating away resets it.
//
// Register no. 76: before this, one uncaught render error unmounted the whole
// React tree (white screen). Nothing is sent anywhere; the user copies the
// report if they want to. The error is also printed with console.error.

import React from "react";
import { useNavigate } from "react-router-dom";
import { useI18n } from "@core/lib/i18n";
import { istLadefehler, meldungVon, fehlerBerichtText } from "@core/lib/fehlerbericht";

/**
 * Card shown in place of a crashed page. Function component so it can use t().
 * @param {{fehler: unknown, pfad: string, sichern?: (() => Promise<unknown>)|null, onReset: () => void}} p
 */
export function Fehlerkarte({ fehler, pfad, sichern = null, onReset }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [kopiert, setKopiert] = React.useState(false);
  const [gesichert, setGesichert] = React.useState(/** @type {null|"ok"|"fehler"} */ (null));
  const laden = istLadefehler(fehler);

  const kopieren = async () => {
    const text = fehlerBerichtText({ fehler, pfad });
    try {
      await navigator.clipboard.writeText(text);
      setKopiert(true);
    } catch (e) {
      // Clipboard can be blocked (http, permissions) — show the text instead of failing silently.
      console.error("Fehlerbericht konnte nicht kopiert werden:", e);
      window.prompt(t("Fehlerbericht zum Kopieren"), text);
    }
  };
  const zurStartseite = () => {
    // On "/" itself navigating is a no-op; reset the boundary instead.
    if (pfad === "/" || pfad === "/Dashboard") onReset();
    else navigate("/");
  };
  const projektSichern = async () => {
    try { await sichern(); setGesichert("ok"); } catch (e) { console.error("Projekt sichern fehlgeschlagen:", e); setGesichert("fehler"); }
  };

  const knopf = "px-3 py-1.5 rounded-md text-sm border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800";
  return (
    <div role="alert" data-testid="fehlergrenze" data-fehler-art={laden ? "laden" : "programm"}
      className="m-6 max-w-2xl rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 p-5">
      <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
        {laden ? t("Dieses Modul konnte nicht geladen werden.") : t("Dieses Modul ist ausgestiegen.")}
      </h2>
      <p className="mt-2 text-sm text-slate-700 dark:text-slate-300">
        {laden
          ? t("Vermutlich gibt es eine neue Version. Neu laden holt sie — Ihre Daten bleiben erhalten.")
          : t("Der Rest der Anwendung läuft weiter. Ihre Daten sind nicht betroffen, solange Sie nicht neu laden, ohne zu sichern.")}
      </p>
      <p className="mt-2 text-xs font-mono text-slate-500 break-words" data-testid="fehlergrenze-meldung">{meldungVon(fehler)}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" className={`${knopf} bg-white dark:bg-slate-900 font-medium`} data-testid="fehlergrenze-neu-laden"
          onClick={() => window.location.reload()}>{t("Neu laden")}</button>
        <button type="button" className={knopf} data-testid="fehlergrenze-start" onClick={zurStartseite}>{t("Zur Startseite")}</button>
        <button type="button" className={knopf} data-testid="fehlergrenze-kopieren" onClick={kopieren}>
          {kopiert ? t("Fehlerbericht kopiert") : t("Fehlerbericht kopieren")}
        </button>
        {sichern && (
          <button type="button" className={knopf} data-testid="fehlergrenze-sichern" onClick={projektSichern}>
            {gesichert === "ok" ? t("Projekt gesichert") : gesichert === "fehler" ? t("Sichern fehlgeschlagen") : t("Projekt sichern (.bitproj)")}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Error boundary for one route. Key it by route path at the call site so a
 * navigation starts with a clean boundary.
 * @extends {React.Component<{children: React.ReactNode, pfad: string, sichern?: (() => Promise<unknown>)|null}, {hatFehler: boolean, fehler: unknown}>}
 */
export class ModulFehlergrenze extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hatFehler: false, fehler: null };
    this.zuruecksetzen = () => this.setState({ hatFehler: false, fehler: null });
  }

  // Explicit flag: `throw 0` or `throw ""` are legal and falsy — testing the thrown
  // value itself would re-render the crashed tree instead of the error card.
  static getDerivedStateFromError(fehler) {
    return { hatFehler: true, fehler: fehler ?? new Error("Unbekannter Fehler") };
  }

  componentDidCatch(fehler, info) {
    // Plain text in the console, never swallowed (CLAUDE.md: errors in clear text).
    console.error(`[Fehlergrenze ${this.props.pfad}]`, fehler, info?.componentStack || "");
  }

  render() {
    if (this.state.hatFehler) {
      return <Fehlerkarte fehler={this.state.fehler} pfad={this.props.pfad} sichern={this.props.sichern} onReset={this.zuruecksetzen} />;
    }
    return this.props.children;
  }
}

/**
 * Last-resort boundary around the whole app (outside router and I18nProvider):
 * no hooks, German and English side by side.
 * @extends {React.Component<{children: React.ReactNode}, {hatFehler: boolean, fehler: unknown}>}
 */
export class WurzelFehlergrenze extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hatFehler: false, fehler: null };
  }

  static getDerivedStateFromError(fehler) {
    return { hatFehler: true, fehler: fehler ?? new Error("Unbekannter Fehler") };
  }

  componentDidCatch(fehler, info) {
    console.error("[Fehlergrenze App]", fehler, info?.componentStack || "");
  }

  render() {
    if (!this.state.hatFehler) return this.props.children;
    return (
      <div role="alert" data-testid="fehlergrenze-wurzel" style={{ fontFamily: "system-ui, sans-serif", maxWidth: 560, margin: "15vh auto", padding: 24 }}>
        <h1 style={{ fontSize: 20, margin: "0 0 8px" }}>BIT-Atelier ist ausgestiegen. · BIT-Atelier stopped.</h1>
        <p style={{ color: "#475569" }}>Bitte neu laden. Ihre Daten sind nicht betroffen. · Please reload. Your data is not affected.</p>
        <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, color: "#64748b" }}>{meldungVon(this.state.fehler)}</pre>
        <button type="button" onClick={() => window.location.reload()} style={{ padding: "8px 14px", marginTop: 8 }}>
          Neu laden · Reload
        </button>
      </div>
    );
  }
}

export default ModulFehlergrenze;
