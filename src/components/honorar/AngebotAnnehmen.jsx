// "Annehmen" of a sent fee offer (phase 81-04, HON-03): after a confirmation the
// offer becomes 79's Honorarvertrag (angebotZuVertrag — flat fields 1:1, number,
// stage, remuneration snapshot) through the CREATE case of speichereZH (only with
// angebot_id, 81-01); the offer turns "angenommen" with honorarvertrag_id, other
// open versions of the same number "ersetzt", special services become
// commissioned fee amendments. An accepted offer cannot be accepted twice — the
// button exists only for sent, unexpired versions.
//
// In:  props zh, wert, angebot. Out: one button (and the writes).

import React from "react";
import { toast } from "sonner";
import { CheckCircle2 } from "lucide-react";
import { buttonVariants } from "@core/components/ui/button";
import { useI18n } from "@core/lib/i18n";
import { useBestaetigung } from "@core/lib/useBestaetigung";
import { naechsteNummer } from "@core/lib/nummernkreis.js";
import { effektiverStatus } from "@/lib/honorar/angebot.js";
import { angebotZuVertrag } from "@/lib/honorar/vertrag.js";

/**
 * @param {{zh: import("@/components/zeitHonorar/useZeitHonorar.js").ZeitHonorar, wert: (id: string) => any, angebot: Record<string, any>}} props
 * @returns {React.ReactElement|null}
 */
export default function AngebotAnnehmen({ zh, wert, angebot }) {
  const { t } = useI18n();
  const bestaetige = useBestaetigung();
  const [busy, setBusy] = React.useState(false);
  if (angebot.status !== "versendet" || effektiverStatus(angebot, zh.heute) === "abgelaufen") return null;

  const annehmen = async () => {
    const vorschau = naechsteNummer(wert("zeit_honorar.nummer_vertrag") || "AV-{jahr}-{nr3}", zh.daten.Honorarvertrag.map((v) => v?.nummer).filter(Boolean), zh.heute);
    const ok = await bestaetige({
      titel: t("Honorarangebot annehmen?"),
      text: t("Aus Honorarangebot {a} wird der Architektenvertrag {v}.").replace("{a}", angebot.nummer).replace("{v}", vorschau),
      bestaetigen: t("Annehmen"),
    });
    if (!ok) return;
    setBusy(true);
    try {
      const r = angebotZuVertrag(angebot, zh.daten.Honorarvertrag, { heuteIso: zh.heute, wert });
      const vertrag = await zh.speichere("Honorarvertrag", r.vertrag);
      const andere = zh.daten.Honorarangebot.filter((x) => x.id !== angebot.id && x.nummer === angebot.nummer && (x.status === "entwurf" || x.status === "versendet"));
      await zh.schreibeStapel([
        { art: "speichern", entitaet: "Honorarangebot", obj: { ...r.angebot, honorarvertrag_id: vertrag.id } },
        ...andere.map((x) => ({ art: /** @type {const} */ ("speichern"), entitaet: "Honorarangebot", obj: { ...x, status: "ersetzt" } })),
        ...r.nachtraege.map((n) => ({ art: /** @type {const} */ ("speichern"), entitaet: "Honorarnachtrag", obj: { ...n, honorarvertrag_id: vertrag.id } })),
      ]);
      toast.success(t("Architektenvertrag {v} angelegt").replace("{v}", vertrag.nummer || vorschau));
    } catch (err) {
      toast.error(`${t("Annehmen fehlgeschlagen")}: ${/** @type {any} */ (err)?.message || String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button type="button" className={buttonVariants({ variant: "outline", size: "sm" })} onClick={annehmen} disabled={busy}>
      <CheckCircle2 aria-hidden="true" /> {t("Annehmen")}
    </button>
  );
}
