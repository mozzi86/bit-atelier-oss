// Befundkarte.jsx — finding map per storey in the check suite (66-08).
//
// In:  befunde (clash findings in report order), elemente (geometry from
//      extractGeometry, with storey + tris), modellName, projektName, idsOhneLage.
// Out: a card with storey selector, the SVG map (numbers = report numbers) and a
//      button for the A3 PDF (all storeys, one page each).
//
// The SVG string comes from befundkarte.befundkarteSvg; every dynamic text in it
// (storey name, finding kind) is escaped there, numbers are integers — that is why
// it may be inserted as markup here.

import React from "react";
import { useI18n } from "@core/lib/i18n";
import {
  befundeJeGeschoss, umrissFuerGeschoss, kartenModell, befundkarteSvg, stilVon, BEFUND_STIL,
  OHNE_GESCHOSS, LAGE_HINWEIS, umrissHinweis,
} from "@ifc/lib/befundkarte";

/**
 * @param {{befunde: Array<object>, elemente: Array<object>, modellName?: string,
 *   projektName?: string, idsOhneLage?: number}} p
 */
export default function Befundkarte({ befunde, elemente, modellName = "", projektName = "", idsOhneLage = 0 }) {
  const { t } = useI18n();
  const { geschosse, ohneLage } = React.useMemo(() => befundeJeGeschoss(befunde, elemente), [befunde, elemente]);
  const namen = React.useMemo(() => [...geschosse.keys()], [geschosse]);
  const [wahl, setWahl] = React.useState(namen[0] || "");
  const [pdfLaeuft, setPdfLaeuft] = React.useState(false);
  const [pdfFehler, setPdfFehler] = React.useState("");
  const aktiv = namen.includes(wahl) ? wahl : namen[0];

  // Outline per storey is computed on demand and cached for the PDF. The cache lives
  // exactly as long as its inputs: a re-run of the check on the same model keeps
  // `elemente` but brings new findings (`geschosse`) — both must renew it, during
  // render, or the map would show the markers of the previous run.
  const cache = React.useMemo(() => new Map(), [elemente, geschosse]);
  const modellFuer = React.useCallback((g) => {
    if (!cache.has(g)) {
      cache.set(g, kartenModell({ umriss: umrissFuerGeschoss(elemente, g), marken: geschosse.get(g) || [], geschoss: g }));
    }
    return cache.get(g);
  }, [cache, elemente, geschosse]);
  const anzeige = (g) => (g === OHNE_GESCHOSS ? t(OHNE_GESCHOSS) : g);

  if (!namen.length) return null;
  const karte = modellFuer(aktiv);
  const svg = befundkarteSvg(karte, { breitePx: 900 });

  const pdf = async () => {
    setPdfLaeuft(true); setPdfFehler("");
    try {
      const { befundkartePdf } = await import("@ifc/lib/befundkartePdf");
      const basis = (projektName || modellName.replace(/\.ifc$/i, "") || "befundkarte").replace(/[^\wäöüÄÖÜß-]+/g, "_");
      await befundkartePdf(namen.map(modellFuer), {
        modell: modellName, projekt: projektName, idsOhneLage, dateiname: `${basis}_befundkarte.pdf`,
      });
    } catch (e) {
      console.error("Befundkarte-PDF fehlgeschlagen:", e);
      setPdfFehler(e?.message || String(e));
    } finally {
      setPdfLaeuft(false);
    }
  };

  return (
    <div className="rounded-xl bg-white dark:bg-slate-900 shadow-sm p-4" data-testid="befundkarte-karte">
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <h3 className="font-semibold text-slate-800 dark:text-slate-100">{t("Befundkarte")}</h3>
        <label className="text-sm text-slate-600 dark:text-slate-300 flex items-center gap-2">
          {t("Geschoss")}
          <select className="border rounded px-2 py-1 text-sm bg-white dark:bg-slate-800" value={aktiv}
            onChange={(e) => setWahl(e.target.value)} data-testid="befundkarte-geschoss">
            {namen.map((g) => <option key={g} value={g}>{anzeige(g)} ({(geschosse.get(g) || []).length})</option>)}
          </select>
        </label>
        <button type="button" onClick={pdf} disabled={pdfLaeuft} data-testid="befundkarte-pdf"
          className="ml-auto px-3 py-1.5 rounded-md text-sm border border-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50">
          {pdfLaeuft ? t("PDF wird erstellt…") : t("Befundkarte als PDF (A3)")}
        </button>
      </div>
      <div className="overflow-auto border rounded" data-testid="befundkarte-svg" role="img"
        aria-label={`${t("Befundkarte")} ${anzeige(aktiv)}: ${karte.marken.length} ${t("Befunde auf diesem Geschoss")}`}
        // eslint-disable-next-line react/no-danger -- escaped in befundkarteSvg (see file header)
        dangerouslySetInnerHTML={{ __html: svg }} />
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-300">
        {Object.keys(BEFUND_STIL).map((k) => (
          <span key={k} className="inline-flex items-center gap-1">
            <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: stilVon(k).farbe }} />{t(stilVon(k).label)}
          </span>
        ))}
      </div>
      <p className="mt-2 text-xs text-slate-500">
        {t("Nummer = laufende Nummer in der Befundliste.")} {t(LAGE_HINWEIS)}{" "}
        <span data-testid="befundkarte-umriss-quelle" data-quelle={karte.umrissQuelle || ""}>{t(umrissHinweis(karte.umrissQuelle))}</span>
        {ohneLage > 0 ? ` ${ohneLage} ${t("Befunde ohne Lage sind nicht eingezeichnet.")}` : ""}
        {idsOhneLage > 0 ? ` ${idsOhneLage} ${t("IDS-Befunde haben keine Lage und stehen nur in der Liste.")}` : ""}
      </p>
      {pdfFehler && <p className="mt-1 text-xs text-red-600" role="alert">{t("PDF fehlgeschlagen")}: {pdfFehler}</p>}
    </div>
  );
}
