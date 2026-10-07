// MitarbeiterTabelle.jsx — Liste der Mitarbeitenden (Plan 80-04, Task 6).
// Muster: src/components/finance/ChangeOrderTable.jsx:31-149 (native <table>,
// TH/TD-Klassen, scope="col", aria-label je Aktion, data-*, kein Zeilen-onClick).
//
// "Eintrag entfernen" nur ohne abhängige Arbeitsvertrag-/Gehaltsaenderung-/
// Personalvorgang-/Personaldokument-Datensätze (Fehleingabe); die Rückfrage
// läuft über useBestaetigung, danach liegt der Fokus auf der Nachbarzeile.
//
// In:  {mitarbeiterListe, vertraege, gehaltsaenderungen, vorgaenge, dokumente,
//      onOeffnen(id), onBearbeiten(m), neuLaden}.
// Out: UI; löscht über bitApi.personal.Mitarbeiter.delete.

import React from "react";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp, ArrowUpDown, Pencil, Trash2 } from "lucide-react";
import { useI18n } from "@core/lib/i18n";
import { bitApi } from "@core/api/bitApi";
import { useBestaetigung } from "@core/lib/useBestaetigung";
import { PERSONENARTEN, STATUS, sucheMitarbeiter, anzeigeName } from "@/lib/people/mitarbeiter.js";
import { bauePersonalLink } from "@/lib/people/personalLink.js";

/** @param {string} text @param {Record<string, string|number>} werte @returns {string} */
function fuellen(text, werte) {
  return text.replace(/\{(\w+)\}/g, (_, k) => String(werte[k] ?? ""));
}

const TH = "h-10 px-2 text-left align-middle font-medium text-muted-foreground";
const TD = "p-2 align-middle";
const TR = "border-b transition-colors hover:bg-muted/50";

/** @param {string|null|undefined} iso @returns {string} */
const fmtDatum = (iso) => (iso ? new Date(iso).toLocaleDateString("de-DE", { day: "2-digit", month: "short", year: "numeric" }) : "—");

const SPALTEN = [
  { feld: "personalnummer", label: "Personalnummer" },
  { feld: "name", label: "Name" },
  { feld: "art", label: "Art" },
  { feld: "funktion", label: "Funktion" },
  { feld: "status", label: "Status" },
  { feld: "eintritt", label: "Eintritt" },
];

const FILTER = [
  { key: "alle", label: "Alle" },
  { key: "aktiv", label: "Aktiv" },
  { key: "ausgeschieden", label: "Ausgeschieden" },
  { key: "entnahme", label: "Inhaber & Gesellschafter" },
];

/**
 * @param {{
 *   mitarbeiterListe: object[], vertraege: object[], gehaltsaenderungen: object[],
 *   vorgaenge: object[], dokumente: object[], onBearbeiten: (m: object) => void, neuLaden: () => void,
 * }} props
 * @returns {React.ReactElement}
 */
export default function MitarbeiterTabelle({ mitarbeiterListe, vertraege, gehaltsaenderungen, vorgaenge, dokumente, onBearbeiten, neuLaden }) {
  const { t } = useI18n();
  const bestaetige = useBestaetigung();
  const [suchtext, setSuchtext] = React.useState("");
  const [filterKey, setFilterKey] = React.useState("alle");
  const [sortFeld, setSortFeld] = React.useState("name");
  const [sortRichtung, setSortRichtung] = React.useState(/** @type {'asc'|'desc'} */ ("asc"));
  const [fokusNachId, setFokusNachId] = React.useState(/** @type {string|null} */ (null));
  const [loeschendId, setLoeschendId] = React.useState(/** @type {string|null} */ (null));
  const containerRef = React.useRef(/** @type {HTMLDivElement|null} */ (null));

  const filterOptionen = filterKey === "aktiv" ? { status: "aktiv" } : filterKey === "ausgeschieden" ? { status: "ausgeschieden" } : filterKey === "entnahme" ? { entnahme: true } : {};
  const gefiltert = React.useMemo(
    () => sucheMitarbeiter(mitarbeiterListe, suchtext, filterOptionen),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- filterOptionen ist ein neues Objekt je Render, filterKey trägt seinen Inhalt
    [mitarbeiterListe, suchtext, filterKey],
  );

  const sortiert = React.useMemo(() => {
    const kopie = [...gefiltert];
    const wert = (m) => {
      if (sortFeld === "name") return anzeigeName(m).toLowerCase();
      if (sortFeld === "art") return t(PERSONENARTEN.find((p) => p.key === m.art)?.label || m.art);
      if (sortFeld === "status") return t(STATUS.find((s) => s.key === m.status)?.label || m.status);
      return String(m[sortFeld] ?? "");
    };
    kopie.sort((a, b) => {
      const va = wert(a), vb = wert(b);
      const cmp = va < vb ? -1 : va > vb ? 1 : 0;
      return sortRichtung === "asc" ? cmp : -cmp;
    });
    return kopie;
  }, [gefiltert, sortFeld, sortRichtung, t]);

  React.useEffect(() => {
    if (!fokusNachId) return;
    const el = containerRef.current?.querySelector(`[data-mitarbeiter="${fokusNachId}"] a[data-aktion="oeffnen"]`);
    if (el) { /** @type {HTMLElement} */ (el).focus(); setFokusNachId(null); }
  }, [sortiert, fokusNachId]);

  const sortieren = (feld) => {
    if (sortFeld === feld) setSortRichtung((r) => (r === "asc" ? "desc" : "asc"));
    else { setSortFeld(feld); setSortRichtung("asc"); }
  };
  const ariaSort = (feld) => (sortFeld !== feld ? "none" : sortRichtung === "asc" ? "ascending" : "descending");
  const pfeil = (feld) => (sortFeld !== feld ? <ArrowUpDown className="h-3 w-3" aria-hidden="true" /> : sortRichtung === "asc" ? <ArrowUp className="h-3 w-3" aria-hidden="true" /> : <ArrowDown className="h-3 w-3" aria-hidden="true" />);

  /** @param {object} m @returns {string|null} Grund, warum "Eintrag entfernen" gesperrt ist, oder null wenn löschbar. */
  const sperrGrund = (m) => {
    const hat = (liste) => liste.some((r) => r.mitarbeiter_id === m.id);
    if (hat(vertraege) || hat(gehaltsaenderungen) || hat(vorgaenge) || hat(dokumente)) {
      // 80-10: die Aufbewahrungsprüfung (Löschen/Sperren mit Plan) steht jetzt
      // wirklich bereit, im Detail — dorthin verweist der Sperrgrund.
      return t("Löschen mit Aufbewahrungsprüfung: Detail › Datenschutz");
    }
    return null;
  };

  const entfernen = async (m) => {
    const grund = sperrGrund(m);
    if (grund) return;
    const ok = await bestaetige({
      titel: fuellen(t("„{name}“ entfernen?"), { name: anzeigeName(m) }),
      text: t("Der Eintrag wird endgültig gelöscht — nur für Fehleingaben ohne Verträge oder Vorgänge."),
      bestaetigen: t("Entfernen"),
      gefahr: true,
    });
    if (!ok) return;
    const index = sortiert.findIndex((x) => x.id === m.id);
    const nachbar = sortiert[index + 1] || sortiert[index - 1] || null;
    setFokusNachId(nachbar?.id ?? null);
    setLoeschendId(m.id);
    try {
      await /** @type {any} */ (bitApi.personal).Mitarbeiter.delete(m.id);
      neuLaden();
    } finally {
      setLoeschendId(null);
    }
  };

  return (
    <div data-testid="mitarbeiter-tabelle">
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="mt-suche" className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">{t("Suche")}</label>
          <input id="mt-suche" type="search" value={suchtext} onChange={(e) => setSuchtext(e.target.value)}
            placeholder={t("Name, Funktion oder Personalnummer")}
            className="h-9 w-64 rounded-md border border-slate-300 px-3 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100" />
        </div>
        <div className="flex flex-wrap gap-1" role="group" aria-label={t("Filter")}>
          {FILTER.map((f) => (
            <button key={f.key} type="button" onClick={() => setFilterKey(f.key)} aria-pressed={filterKey === f.key}
              className={`rounded-md px-3 py-1.5 text-sm ${filterKey === f.key ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200"}`}>
              {t(f.label)}
            </button>
          ))}
        </div>
        <span role="status" className="ml-auto text-sm text-slate-500 dark:text-slate-400">
          {fuellen(t("{n} von {m}"), { n: sortiert.length, m: mitarbeiterListe.length })}
        </span>
      </div>

      <div ref={containerRef} className="relative w-full overflow-auto rounded-lg border border-slate-200 dark:border-slate-700">
        <table className="w-full caption-bottom text-sm" aria-label={t("Mitarbeitende")}>
          <thead className="[&_tr]:border-b">
            <tr className={TR}>
              {SPALTEN.map((s) => (
                <th key={s.feld} scope="col" className={TH} aria-sort={ariaSort(s.feld)}>
                  <button type="button" onClick={() => sortieren(s.feld)} className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-slate-100">
                    {t(s.label)} {pfeil(s.feld)}
                  </button>
                </th>
              ))}
              <th scope="col" className={TH}>{t("Aktionen")}</th>
            </tr>
          </thead>
          <tbody className="[&_tr:last-child]:border-0">
            {sortiert.map((m) => {
              const grund = sperrGrund(m);
              const art = PERSONENARTEN.find((p) => p.key === m.art);
              const status = STATUS.find((s) => s.key === m.status);
              return (
                <tr key={m.id} className={TR} data-mitarbeiter={m.id}>
                  <td className={TD}>{m.personalnummer}</td>
                  <td className={TD}>
                    <Link to={`/People${bauePersonalLink({ tab: "staff", mitarbeiter: m.id })}`} data-aktion="oeffnen"
                      className="font-medium text-emerald-700 underline-offset-4 hover:underline dark:text-emerald-400">
                      {anzeigeName(m)}
                    </Link>
                  </td>
                  <td className={TD}>{t(art?.label || m.art)}</td>
                  <td className={TD}>{m.funktion || "—"}</td>
                  <td className={TD}>{t(status?.label || m.status)}</td>
                  <td className={TD}>{fmtDatum(m.eintritt)}</td>
                  <td className={TD}>
                    <div className="flex flex-wrap items-center gap-1">
                      <button type="button" onClick={() => onBearbeiten(m)}
                        aria-label={fuellen(t("„{name}“ bearbeiten"), { name: anzeigeName(m) })}
                        className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                      </button>
                      <button type="button" data-aktion="loeschen" onClick={() => entfernen(m)} disabled={Boolean(grund) || loeschendId === m.id}
                        aria-label={fuellen(t("„{name}“ entfernen"), { name: anzeigeName(m) })}
                        title={grund || undefined}
                        className="rounded-md p-1.5 text-rose-600 hover:bg-rose-50 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent dark:text-rose-400 dark:hover:bg-rose-950/40 dark:disabled:text-slate-600">
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                      {grund && <span className="text-xs text-slate-400">{grund}</span>}
                    </div>
                  </td>
                </tr>
              );
            })}
            {sortiert.length === 0 && (
              <tr>
                <td className={TD} colSpan={SPALTEN.length + 1}>{t("Keine Treffer.")}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
