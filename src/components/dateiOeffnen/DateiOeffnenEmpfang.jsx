// DateiOeffnenEmpfang.jsx — receives a double-clicked .bitproj (plan 93-10) and shows THE import preview
// (ImportVorschauDialog from src/demo/speicherDialoge.jsx, extended — not a second dialog).
//
// Two sources, one flow:
//   - local edition (express data source): the launcher staged the file on the server and opened
//     /?import=<token>; this component loads it (src/lib/dateiOeffnenServer.js);
//   - desktop client (Tauri shell): the shell holds the path from its command line or from a second start
//     (src/client/dateiHuelle.js, loaded only inside the shell).
// "Aktualisieren"/"Laden und ersetzen" replaces the state (areas the file lacks stay) and links the file
// for "save back"; "Als Kopie" adds only the project data with fresh ids; "Abbrechen" drops the staged file.
// After a change the page reloads — every module holds loaded records in memory.
//
// In:  props {suche} (the query string at page load) / asks the shell. Out: the dialog, or an error dialog, or nothing.

import React from "react";
import { useI18n } from "@core/lib/i18n";
import { DATENQUELLE, SERVERLOS } from "@core/lib/umgebung";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@core/components/ui/dialog";
import { ImportVorschauDialog } from "@/demo/speicherDialoge.jsx";
import { vorschauAufbauen } from "@/lib/dateiOeffnen.js";
import { importAdapter, importTokenAusUrl } from "@/lib/dateiOeffnenServer.js";
import { inHuelle } from "@/client/huelle.js";
import { exportProjekt } from "@core/api/projektDatei";

/** Removes ?import=… from the address bar without a reload (a reload must not re-run a consumed token). */
function tokenAusAdresseEntfernen() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("import")) return;
  url.searchParams.delete("import");
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

/**
 * @param {{suche?: string}} props suche = location.search at page load (App.jsx captures it before the
 *   "/" → "/Dashboard" redirect drops it)
 * @returns {React.ReactElement|null}
 */
export default function DateiOeffnenEmpfang({ suche }) {
  const { t } = useI18n();
  const [adapter, setAdapter] = React.useState(/** @type {any} */ (null));
  const [vorschau, setVorschau] = React.useState(/** @type {any} */ (null));
  const [fehler, setFehler] = React.useState(/** @type {string|null} */ (null));
  const [beschaeftigt, setBeschaeftigt] = React.useState(false);
  const huelle = SERVERLOS && inHuelle();

  /** Loads the preview through an adapter. */
  const anzeigen = React.useCallback(async (a) => {
    try {
      const g = await a.laden();
      setAdapter(a);
      setVorschau(vorschauAufbauen(g.obj, g.lokalAnzahl, { wiederOeffnen: g.wiederOeffnen, quelle: g.quelle }));
    } catch (e) {
      tokenAusAdresseEntfernen();
      setFehler(e instanceof Error ? e.message : String(e));
    }
  }, []);

  // Local edition: the token in the URL.
  React.useEffect(() => {
    if (DATENQUELLE !== "express") return;
    const token = importTokenAusUrl(suche ?? window.location.search);
    if (token) anzeigen(importAdapter(token));
  }, [anzeigen, suche]);

  // Desktop client: the file the shell holds now, and every one handed over later.
  React.useEffect(() => {
    // SERVERLOS is a build-time literal: the office/cloud builds drop this branch and the shell chunk.
    if (!SERVERLOS || !huelle) return undefined;
    let aus = () => {};
    let aktiv = true;
    import("@/client/dateiHuelle.js").then(async (m) => {
      const naechste = async () => {
        const a = await m.importAdapterHuelle().catch((e) => { setFehler(String(e?.message || e)); return null; });
        if (a && aktiv) anzeigen(a);
      };
      await naechste();
      const ab = await m.beiNeuerDatei(naechste);
      if (aktiv) aus = ab; else ab();
    });
    return () => { aktiv = false; aus(); };
  }, [huelle, anzeigen]);

  const fertig = () => {
    tokenAusAdresseEntfernen();
    window.location.reload();
  };

  /** @param {(v: any) => Promise<void>} schritt */
  const ausfuehren = async (schritt) => {
    setBeschaeftigt(true);
    try {
      await schritt(vorschau);
      fertig();
    } catch (e) {
      setBeschaeftigt(false);
      setVorschau(null);
      tokenAusAdresseEntfernen();
      setFehler(e instanceof Error ? e.message : String(e));
    }
  };

  const abbrechen = () => {
    adapter?.abbrechen?.();
    setVorschau(null);
    tokenAusAdresseEntfernen();
  };

  const beschreibung = huelle
    ? undefined
    : `${t("Der aktuelle Stand auf diesem Rechner wird dabei vollständig ersetzt.")} ${t("Vorher wird eine Sicherungskopie im Datenordner angelegt (vor-import).")}`;

  return (
    <>
      <ImportVorschauDialog
        vorschau={vorschau}
        onAbbrechen={abbrechen}
        onUebernehmen={(vorherSichern) => ausfuehren(async (v) => {
          // Desktop client only ("Vorher sichern" is hidden for the local server, which copies db.json itself).
          if (vorherSichern) await exportProjekt();
          await adapter.ersetzen(v);
        })}
        onKopie={() => ausfuehren((v) => adapter.kopie(v))}
        ohneVorherSichern={!huelle}
        beschreibung={beschreibung}
        beschaeftigt={beschaeftigt}
        rueckfokus={(e) => e.preventDefault()}
      />
      <Dialog open={!!fehler} onOpenChange={(o) => { if (!o) setFehler(null); }}>
        <DialogContent className="max-w-md p-5" data-testid="datei-oeffnen-fehler">
          <DialogTitle className="text-base mb-1">{t("Projektdatei konnte nicht geöffnet werden")}</DialogTitle>
          <DialogDescription className="mb-3" role="alert">{fehler}</DialogDescription>
          <div className="flex justify-end">
            <button type="button" onClick={() => setFehler(null)} className="px-3 py-2 rounded-lg text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800">
              {t("Schließen")}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
