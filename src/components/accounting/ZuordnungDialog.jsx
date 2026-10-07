// Besitzer: 79-07. Manual reconciliation dialog for one bank transaction: the
// candidates abgleich.kandidaten() found (with its reason), plus a free search
// across open invoices, unpaid expenses, drawings (owners) and open tax
// payments for when no candidate fits or the automatic search missed it.
//
// In:  props bh, umsatz (one Bankumsatz), onClose. Out: confirming writes
//      through abgleich.zuordnungAnwenden + bh.speichereViele, then onClose().

import React from "react";
import { toast } from "sonner";
import FormModal from "@core/components/common/FormModal";
import { buttonVariants } from "@core/components/ui/button";
import { useI18n } from "@core/lib/i18n";
import { kandidaten, zuordnungAnwenden } from "@/lib/accounting/abgleich.js";
import { formatEuro } from "@/lib/accounting/geld.js";

const FELD = "h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-900";
const ZEILE = "flex w-full items-center justify-between gap-3 rounded-md border border-slate-200 px-3 py-2 text-left text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800";

/** @param {string} grund a Kandidat.grund value @param {(k: string) => string} t */
function grundText(grund, t) {
  switch (grund) {
    case "nummer_und_betrag": return t("Rechnungsnummer und Betrag passen");
    case "nummer": return t("Rechnungsnummer im Verwendungszweck");
    case "betrag": return t("Betrag weicht ab");
    case "fremdnummer": return t("Rechnungsnummer des Lieferanten im Verwendungszweck");
    case "lieferant": return t("Lieferant erkannt");
    case "finanzamt": return t("Finanzamt und Betrag passen");
    case "gesellschafter_iban": return t("IBAN gehört einem Gesellschafter");
    default: return grund;
  }
}

/**
 * Every other assignable target (open invoices, unpaid expenses, active
 * owners/partners, open tax payments), filtered by a free-text search — for
 * when no automatic candidate fits.
 * @param {Record<string, any[]>} daten
 * @param {string} suchbegriff
 * @returns {Array<{typ: string, id: string, titel: string, untertitel: string}>}
 */
function sucheZiele(daten, suchbegriff) {
  const q = suchbegriff.trim().toLowerCase();
  /** @type {Array<{typ: string, id: string, titel: string, untertitel: string}>} */
  const ziele = [];
  for (const r of daten.Ausgangsrechnung || []) {
    if (r.status !== "gestellt") continue;
    ziele.push({ typ: "Ausgangsrechnung", id: r.id, titel: r.nummer || r.id, untertitel: r.empfaenger?.name || r.project_name || "" });
  }
  for (const e of daten.Eingangsrechnung || []) {
    if (e.bezahlt_am) continue;
    ziele.push({ typ: "Eingangsrechnung", id: e.id, titel: e.lieferant, untertitel: e.fremd_nr || "" });
  }
  for (const g of daten.Gesellschafter || []) {
    if (g.aktiv === false) continue;
    ziele.push({ typ: "Entnahme", id: g.id, titel: g.name, untertitel: "" });
  }
  for (const s of daten.Steuerzahlung || []) {
    if (s.bezahlt_am) continue;
    ziele.push({ typ: "Steuerzahlung", id: s.id, titel: s.art?.toUpperCase() || s.id, untertitel: s.zeitraum ? `${s.zeitraum.von} – ${s.zeitraum.bis}` : "" });
  }
  if (!q) return ziele;
  return ziele.filter((z) => `${z.titel} ${z.untertitel}`.toLowerCase().includes(q));
}

/**
 * @param {{bh: import("./useBuchhaltung.js").Buchhaltung, umsatz: Record<string, any>, onClose: () => void}} props
 * @returns {React.ReactElement}
 */
export default function ZuordnungDialog({ bh, umsatz, onClose }) {
  const { t } = useI18n();
  const [suchbegriff, setSuchbegriff] = React.useState("");
  const [speichert, setSpeichert] = React.useState(false);

  const auto = React.useMemo(() => kandidaten(umsatz, bh.daten), [umsatz, bh.daten]);
  const suchtreffer = React.useMemo(() => {
    const autoIds = new Set(auto.map((k) => `${k.typ}:${k.id}`));
    return sucheZiele(bh.daten, suchbegriff).filter((z) => !autoIds.has(`${z.typ}:${z.id}`));
  }, [bh.daten, suchbegriff, auto]);

  const zuordnen = async (ziel) => {
    setSpeichert(true);
    try {
      await bh.speichereViele(zuordnungAnwenden(umsatz, { ...ziel, modus: "manuell" }, bh.daten));
      toast.success(t("Umsatz zugeordnet"));
      onClose();
    } catch (fehler) {
      toast.error(/** @type {any} */ (fehler)?.message || String(fehler));
    } finally {
      setSpeichert(false);
    }
  };

  return (
    <FormModal title={t("Umsatz zuordnen")} onClose={onClose} schuetzen={false}>
      <div className="space-y-4">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {umsatz.buchungstag} · {formatEuro(Math.round(umsatz.betrag * 100))} · {umsatz.zweck}
        </p>

        {auto.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium">{t("Vorschläge")}</h4>
            {auto.map((k) => {
              const ziel = sucheZiele(bh.daten, "").find((z) => z.typ === k.typ && z.id === k.id);
              return (
                <button key={`${k.typ}:${k.id}`} type="button" disabled={speichert} className={ZEILE} onClick={() => zuordnen(k)}>
                  <span>
                    <span className="font-medium">{ziel?.titel || k.id}</span>
                    {ziel?.untertitel && <span className="text-slate-500 dark:text-slate-400"> · {ziel.untertitel}</span>}
                  </span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">{grundText(k.grund, t)}</span>
                </button>
              );
            })}
          </div>
        )}

        <div className="space-y-2">
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">{t("Suche über Rechnungen, Ausgaben, Entnahmen, Steuerzahlungen")}</span>
            <input type="text" className={FELD} value={suchbegriff} onChange={(e) => setSuchbegriff(e.target.value)} />
          </label>
          <div className="max-h-64 space-y-1 overflow-y-auto">
            {suchtreffer.map((z) => (
              <button key={`${z.typ}:${z.id}`} type="button" disabled={speichert} className={ZEILE}
                onClick={() => zuordnen({ typ: z.typ, id: z.id, grund: "manuell" })}>
                <span>
                  <span className="font-medium">{z.titel}</span>
                  {z.untertitel && <span className="text-slate-500 dark:text-slate-400"> · {z.untertitel}</span>}
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400">{t(z.typ)}</span>
              </button>
            ))}
            {suchtreffer.length === 0 && <p className="text-sm text-slate-500 dark:text-slate-400">{t("Keine Treffer")}</p>}
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <button type="button" className={buttonVariants({ variant: "outline", size: "sm" })} onClick={onClose}>{t("Abbrechen")}</button>
        </div>
      </div>
    </FormModal>
  );
}
