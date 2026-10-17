// Form dialog "Honorarvertrag" of the outgoing-invoice tab (79-02, T5): HOAI
// 2021 fee contract, generic over the LEISTUNGSBILDER registry (E-13) — every
// one of the 14 service profiles is selectable, a profile whose table is not
// yet transferred (79-14) stays selectable and shows "Tafel fehlt" instead of
// computing (a Pauschale still works, see honorar.js).
//
// In:  props bh, modus ("neu"|"bearbeiten"), vertrag (edit), projektIdVorwahl.
// Out: writes through bh.speichere("Honorarvertrag", …); a per-client payment
//      term goes through bh.einstellungSpeichern. onClose when done. Since 96-03
//      "aus LV übernehmen" also freezes the costs (kosten_eingefroren_am + cents
//      snapshot), a hand-typed KG 300/400 drops it, and a yellow notice reports
//      an LV drift over 1 %.

import React from "react";
import FormModal from "@core/components/common/FormModal";
import { buttonVariants } from "@core/components/ui/button";
import { useI18n } from "@core/lib/i18n";
import { toast } from "sonner";
import { bitApi } from "@core/api/bitApi";
import { alleLeistungsbilder, leistungsbildInfo } from "@core/lib/hoai/leistungsbilder.js";
import { honorarVertrag, kostenAusLv, lphFuerLeistungsbild, lpStand } from "@core/lib/hoai/honorar.js";
import { restBisSchluss } from "@core/lib/hoai/abrechnung.js";
import { empfaengerAus } from "@/lib/accounting/ausgangsrechnungen.js";
import { bauherrSchluessel } from "@/lib/accounting/grundlagen.js";
import { formatEuro } from "@/lib/accounting/geld.js";
import { KOSTEN_SNAPSHOT_LEER, kostenEinfrieren } from "@core/lib/hoai/kostenDrift.js";
import { datumText, heuteLokal } from "@core/lib/kalender/datum.js";
import KostenDriftHinweis from "@/components/honorar/KostenDriftHinweis.jsx";

const FELD = "h-9 w-full rounded-md border border-border bg-card px-2 text-sm dark:border-slate-600 dark:bg-slate-900";
// Native <label> instead of the shadcn Label wrapper: same tsc-cost reason as
// the Card wrappers (RechnungenAbschnitt.jsx).
const LABEL = "text-sm font-medium leading-none";
const ZONEN_FALLBACK = ["I", "II", "III", "IV", "V"];

/**
 * @param {{
 *   bh: import("./useBuchhaltung.js").Buchhaltung,
 *   modus: "neu"|"bearbeiten",
 *   vertrag?: Record<string, any>|null,
 *   projektIdVorwahl?: string|null,
 *   onClose: () => void,
 * }} props
 * @returns {React.ReactElement}
 */
export default function HonorarvertragFormular({ bh, modus, vertrag = null, projektIdVorwahl = null, onClose }) {
  const { t, lang } = useI18n();
  const alleProfile = React.useMemo(() => alleLeistungsbilder(), []);

  const [projektId] = React.useState(vertrag?.project_id || projektIdVorwahl || bh.projekte[0]?.id || "");
  const [leistungsbild, setLeistungsbild] = React.useState(vertrag?.leistungsbild || "gebaeude");
  const info = leistungsbildInfo(leistungsbild);
  const zonen = info?.zonen?.length ? info.zonen : ZONEN_FALLBACK;
  const lphZeilen = info?.lph?.length ? info.lph : Array.from({ length: 9 }, (_, i) => ({ nr: i + 1, bezeichnung: `LP ${i + 1}`, prozent: 0 }));

  const [kg300, setKg300] = React.useState(vertrag?.kg300_euro ?? 0);
  const [kg400, setKg400] = React.useState(vertrag?.kg400_euro ?? 0);
  const [sonstige, setSonstige] = React.useState(vertrag?.sonstige_euro ?? 0);
  const [lvQuelle, setLvQuelle] = React.useState("");
  // 96-03: frozen LV snapshot (day + cents); undefined = untouched in this dialog (record keeps what it has).
  const [snapshot, setSnapshot] = React.useState(/** @type {{kosten_eingefroren_am: string|null, kosten_eingefroren: any}|undefined} */ (undefined));
  const kgManuell = () => { if (vertrag?.kosten_eingefroren || snapshot?.kosten_eingefroren) setSnapshot({ ...KOSTEN_SNAPSHOT_LEER }); };
  const [bezugswertManuell, setBezugswertManuell] = React.useState(vertrag?.bezugswert ?? 0);
  const [honorarzone, setHonorarzone] = React.useState(vertrag?.honorarzone || zonen[Math.min(2, zonen.length - 1)]);
  const [satzPosition, setSatzPosition] = React.useState(vertrag?.satz_position_prozent ?? 0);
  const [lph, setLph] = React.useState(() => lphZeilen.map((z, i) => ({
    beauftragt: vertrag?.lph?.[i]?.beauftragt ?? true,
    prozent: vertrag?.lph?.[i]?.prozent ?? z.prozent,
  })));
  const [umbauProzent, setUmbauProzent] = React.useState(vertrag?.umbauzuschlag_prozent ?? 0);
  const [nebenkostenProzent, setNebenkostenProzent] = React.useState(vertrag?.nebenkosten_prozent ?? bh.einst.nebenkosten_prozent);
  const [pauschale, setPauschale] = React.useState(vertrag?.pauschal_euro ?? null);
  const [ustSatz, setUstSatz] = React.useState(vertrag?.ust_satz ?? bh.einst.ust_satz);
  // A NEW contract starts with the invoices' recipient chain (empfaengerAus:
  // Project.client — a matching Contact would only repeat that company name);
  // an edited one keeps its own.
  const [bauherrName, setBauherrName] = React.useState(() => (vertrag
    ? vertrag.bauherr_name || ""
    : empfaengerAus(null, [], bh.projekte.find((p) => p.id === projektId) || null).name));
  const [bauherrAnschrift, setBauherrAnschrift] = React.useState(vertrag?.bauherr_anschrift || "");
  const [bauherrUstIdnr, setBauherrUstIdnr] = React.useState(vertrag?.bauherr_ust_idnr || "");
  const [bauherrArt, setBauherrArt] = React.useState(vertrag?.bauherr_art || "unternehmer");
  // 93-01: routing ID of a public client (XRechnung BT-10/BT-49), frozen into the invoice recipient on "Stellen".
  const [bauherrLeitwegId, setBauherrLeitwegId] = React.useState(vertrag?.bauherr_leitweg_id || "");
  const [zahlungszielVertrag, setZahlungszielVertrag] = React.useState(vertrag?.zahlungsziel_tage ?? "");
  const [zahlungszielBauherr, setZahlungszielBauherr] = React.useState("");
  const [leistungsstand, setLeistungsstand] = React.useState(/** @type {{stand: Record<number, number>, quelle: string}|null} */ (null));
  const [speichert, setSpeichert] = React.useState(false);

  const projekt = bh.projekte.find((p) => p.id === projektId) || null;

  React.useEffect(() => {
    if (!projekt) return;
    /** @type {any} */ (bitApi).entities.HoaiPlan.filter({ project_id: projekt.id }).then((rows) => {
      const plan = Array.isArray(rows) ? rows[0] : null;
      setLeistungsstand(lpStand(plan || null, projekt, leistungsbild));
    }).catch(() => setLeistungsstand(lpStand(null, projekt, leistungsbild)));
  }, [projekt, leistungsbild]);

  /**
   * Switches the Leistungsbild INSIDE this open dialog (H-2, BEFUNDE-79 §1 (H-2, behoben in §7)):
   * the LP percentages, the zone list and the LP count follow the new
   * profile — `lph` is rebuilt from scratch via lphFuerLeistungsbild instead
   * of keeping the previous profile's stale values. Fields that still apply
   * regardless of the profile (bezugswert, Satzposition, Umbauzuschlag,
   * Nebenkosten) are untouched here. If the current Honorarzone is not one of
   * the new profile's zones, it is reset to the first valid one and the user
   * is told why.
   * @param {string} neuesLeistungsbild registry key just selected
   */
  const leistungsbildAendern = (neuesLeistungsbild) => {
    setLeistungsbild(neuesLeistungsbild);
    setLph(lphFuerLeistungsbild(neuesLeistungsbild));
    const neueInfo = leistungsbildInfo(neuesLeistungsbild);
    const neueZonen = neueInfo?.zonen?.length ? neueInfo.zonen : ZONEN_FALLBACK;
    if (!neueZonen.includes(honorarzone)) {
      const ersteGueltige = neueZonen[0];
      setHonorarzone(ersteGueltige);
      toast(t("Honorarzone auf {zone} zurückgesetzt, weil sie für dieses Leistungsbild nicht gilt.").replace("{zone}", ersteGueltige));
    }
  };

  const uebernehmen = async () => {
    if (!projekt) return;
    try {
      const positionen = await /** @type {any} */ (bitApi).entities.LVPosition.filter({ project_id: projekt.id });
      const { kg300_euro, kg400_euro } = kostenAusLv(Array.isArray(positionen) ? positionen : []);
      setKg300(kg300_euro);
      setKg400(kg400_euro);
      setLvQuelle(Array.isArray(positionen) && positionen.length ? "lv" : "");
      if (Array.isArray(positionen) && positionen.length) {
        // 96-03: taking over = freezing; sonstige stay as typed (no LV source).
        const patch = kostenEinfrieren({ kg300_euro, kg400_euro, sonstige_euro: sonstige }, heuteLokal());
        setSnapshot({ kosten_eingefroren_am: patch.kosten_eingefroren_am, kosten_eingefroren: patch.kosten_eingefroren });
      } else {
        kgManuell();
        toast(t("Dieses Projekt hat noch keine LV-Positionen — 0 € übernommen."));
      }
    } catch (fehler) {
      toast.error(/** @type {any} */ (fehler)?.message || String(fehler));
    }
  };

  const vertragEntwurf = {
    id: vertrag?.id,
    project_id: projektId,
    leistungsbild,
    kg300_euro: kg300,
    kg400_euro: kg400,
    sonstige_euro: sonstige,
    bezugswert: bezugswertManuell,
    honorarzone,
    satz_position_prozent: satzPosition,
    lph,
    umbauzuschlag_prozent: umbauProzent,
    nebenkosten_prozent: nebenkostenProzent,
    pauschal_euro: pauschale === null || pauschale === "" ? undefined : Number(pauschale),
    ust_satz: ustSatz,
    bauherr_name: bauherrName,
    bauherr_anschrift: bauherrAnschrift,
    bauherr_ust_idnr: bauherrUstIdnr,
    bauherr_art: bauherrArt,
    bauherr_leitweg_id: bauherrLeitwegId.trim() || undefined,
    zahlungsziel_tage: zahlungszielVertrag === "" ? undefined : Number(zahlungszielVertrag),
    anrechenbare_quelle: lvQuelle || vertrag?.anrechenbare_quelle,
    // Only written when this dialog froze or dropped a snapshot — a record without one stays as before.
    ...(snapshot ? snapshot : {}),
  };
  /** Snapshot as it would be saved, for the drift notice. */
  const snapshotAnzeige = snapshot || { kosten_eingefroren_am: vertrag?.kosten_eingefroren_am ?? null, kosten_eingefroren: vertrag?.kosten_eingefroren ?? null };
  const berechnet = honorarVertrag(vertragEntwurf);
  const rest = restBisSchluss(vertragEntwurf, bh.daten.Ausgangsrechnung || []);
  const kostenregel = info?.kostenregel === "p33" ? "p33" : "manuell";

  const speichern = async () => {
    setSpeichert(true);
    try {
      const gespeichert = await bh.speichere("Honorarvertrag", vertragEntwurf);
      if (zahlungszielBauherr !== "") {
        const schluessel = bauherrSchluessel(/** @type {any} */ (vertragEntwurf), projekt);
        if (schluessel) {
          await bh.einstellungSpeichern({
            zahlungsziel_je_bauherr: { ...bh.einst.zahlungsziel_je_bauherr, [schluessel]: Number(zahlungszielBauherr) },
          });
        }
      }
      toast.success(t("Honorarvertrag gespeichert"));
      onClose();
      void gespeichert;
    } catch (fehler) {
      toast.error(/** @type {any} */ (fehler)?.message || String(fehler));
    } finally {
      setSpeichert(false);
    }
  };

  return (
    <FormModal title={vertrag ? t("Honorarvertrag bearbeiten") : t("Neuer Honorarvertrag")} onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className={LABEL} htmlFor="hv-leistungsbild">{t("Leistungsbild")}</label>
          <select id="hv-leistungsbild" className={FELD} value={leistungsbild} onChange={(e) => leistungsbildAendern(e.target.value)}>
            {alleProfile.map((p) => (
              <option key={p.key} value={p.key}>
                {t(p.label)} — § {p.tafelParagraf}{p.status === "fehlt" ? ` (${t("Tafel fehlt")})` : ""}
              </option>
            ))}
          </select>
        </div>

        {kostenregel === "p33" ? (
          <fieldset className="space-y-2 rounded-lg border border-border p-3 dark:border-slate-700">
            <legend className="px-1 text-sm font-medium">{t("Anrechenbare Kosten")} (§ 33)</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              <label className="flex flex-col gap-1 text-xs">{t("KG 300 (€)")}
                <input type="number" className={FELD} value={kg300} onChange={(e) => { setKg300(Number(e.target.value)); kgManuell(); }} /></label>
              <label className="flex flex-col gap-1 text-xs">{t("KG 400 (€)")}
                <input type="number" className={FELD} value={kg400} onChange={(e) => { setKg400(Number(e.target.value)); kgManuell(); }} /></label>
              <label className="flex flex-col gap-1 text-xs">{t("Sonstige (€)")}
                <input type="number" className={FELD} value={sonstige} onChange={(e) => setSonstige(Number(e.target.value))} /></label>
            </div>
            <button type="button" className={buttonVariants({ variant: "outline", size: "sm" })} onClick={uebernehmen}>{t("aus LV übernehmen")}</button>
            {lvQuelle === "lv" && <p className="text-xs text-muted-foreground">{t("Quelle")}: {t("aus dem Leistungsverzeichnis")}</p>}
            {snapshotAnzeige.kosten_eingefroren_am && (
              <p className="text-xs text-muted-foreground" data-testid="hv-kosten-eingefroren-am">{t("eingefroren am {datum}").replace("{datum}", datumText(snapshotAnzeige.kosten_eingefroren_am, lang === "en" ? "en" : "de"))}</p>
            )}
            {projekt && <KostenDriftHinweis vertrag={snapshotAnzeige} projektId={projekt.id} hinweis={t("Mit „aus LV übernehmen“ den neuen Stand einfrieren.")} />}
          </fieldset>
        ) : (
          <div>
            <label className={LABEL} htmlFor="hv-bezugswert">{info?.einheit === "ha" ? t("Fläche (ha)") : t("Anrechenbare Kosten (€)")}</label>
            <input id="hv-bezugswert" type="number" className={FELD} value={bezugswertManuell} onChange={(e) => setBezugswertManuell(Number(e.target.value))} />
            <p className="text-xs text-muted-foreground">§ {info?.tafelParagraf ?? "—"}</p>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className={LABEL} htmlFor="hv-zone">{t("Honorarzone")}</label>
            <select id="hv-zone" className={FELD} value={honorarzone} onChange={(e) => setHonorarzone(e.target.value)}>
              {zonen.map((z) => <option key={z} value={z}>{z}</option>)}
            </select>
          </div>
          <div>
            <label className={LABEL} htmlFor="hv-satzposition">{t("Satzposition (%)")}</label>
            <input id="hv-satzposition" type="number" min={0} max={100} className={FELD} value={satzPosition} onChange={(e) => setSatzPosition(Number(e.target.value))} />
            <p className="text-xs text-muted-foreground">{t("0 = Basishonorarsatz, § 7 Abs. 1")}</p>
          </div>
          <div>
            <label className={LABEL} htmlFor="hv-umbau">{t("Umbauzuschlag (%)")}</label>
            <input id="hv-umbau" type="number" min={0} className={FELD} value={umbauProzent} onChange={(e) => setUmbauProzent(Number(e.target.value))} />
            <p className="text-xs text-muted-foreground">
              {t("20 % gelten ohne Textform ab Zone III, § 6 Abs. 2")}
              {typeof info?.umbau_max_prozent === "number" ? ` · ${t("höchstens")} ${info.umbau_max_prozent} %` : ""}
            </p>
          </div>
        </div>

        <fieldset className="space-y-1 rounded-lg border border-border p-3 dark:border-slate-700">
          <legend className="px-1 text-sm font-medium">{t("Leistungsphasen")}</legend>
          {lphZeilen.map((z, i) => (
            <div key={z.nr} className="flex flex-wrap items-center gap-2 text-sm">
              <label className="flex items-center gap-1">
                <input type="checkbox" checked={lph[i]?.beauftragt ?? false}
                  onChange={(e) => setLph((liste) => liste.map((p, j) => (j === i ? { ...p, beauftragt: e.target.checked } : p)))} />
                {t("LP")} {z.nr}
              </label>
              <input type="number" min={0} max={100} className={`${FELD} w-20`} value={lph[i]?.prozent ?? 0}
                onChange={(e) => setLph((liste) => liste.map((p, j) => (j === i ? { ...p, prozent: Number(e.target.value) } : p)))} />
              <span className="text-muted-foreground">%</span>
              {leistungsstand && (
                <span className="text-xs text-muted-foreground">{t("Stand")}: {leistungsstand.stand[z.nr] ?? 0} % ({t(leistungsstandQuelle(leistungsstand.quelle))})</span>
              )}
            </div>
          ))}
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className={LABEL} htmlFor="hv-nebenkosten">{t("Nebenkosten (%)")}</label>
            <input id="hv-nebenkosten" type="number" min={0} className={FELD} value={nebenkostenProzent} onChange={(e) => setNebenkostenProzent(Number(e.target.value))} />
          </div>
          <div>
            <label className={LABEL} htmlFor="hv-ust">{t("USt-Satz")}</label>
            <select id="hv-ust" className={FELD} value={ustSatz} onChange={(e) => setUstSatz(Number(e.target.value))}>
              {[19, 7, 0].map((s) => <option key={s} value={s}>{s} %</option>)}
            </select>
          </div>
          <div>
            <label className={LABEL} htmlFor="hv-pauschale">{t("Pauschale (€, optional)")}</label>
            <input id="hv-pauschale" type="number" className={FELD} value={pauschale ?? ""} onChange={(e) => setPauschale(e.target.value === "" ? null : Number(e.target.value))} />
          </div>
        </div>

        <fieldset className="space-y-2 rounded-lg border border-border p-3 dark:border-slate-700">
          <legend className="px-1 text-sm font-medium">{t("Bauherr")}</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs">{t("Name")}
              <input className={FELD} value={bauherrName} onChange={(e) => setBauherrName(e.target.value)} /></label>
            <label className="flex flex-col gap-1 text-xs">{t("USt-IdNr.")}
              <input className={FELD} value={bauherrUstIdnr} onChange={(e) => setBauherrUstIdnr(e.target.value)} /></label>
            <label className="flex flex-col gap-1 text-xs sm:col-span-2">{t("Anschrift")}
              <input className={FELD} value={bauherrAnschrift} onChange={(e) => setBauherrAnschrift(e.target.value)} /></label>
            <label className="flex flex-col gap-1 text-xs">{t("Art")}
              <select className={FELD} value={bauherrArt} onChange={(e) => setBauherrArt(e.target.value)}>
                <option value="unternehmer">{t("Unternehmer")}</option>
                <option value="verbraucher">{t("Verbraucher")}</option>
                <option value="oeffentlich">{t("Öffentlich")}</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs">{t("Leitweg-ID (für XRechnung)")}
              <input className={FELD} value={bauherrLeitwegId} placeholder="991-12345-67" data-testid="hv-leitweg-id"
                onChange={(e) => setBauherrLeitwegId(e.target.value)} /></label>
          </div>
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={LABEL} htmlFor="hv-ziel-projekt">{t("Zahlungsziel je Projekt (Tage)")}</label>
            <input id="hv-ziel-projekt" type="number" min={0} className={FELD} placeholder={String(bh.einst.zahlungsziel_tage)} value={zahlungszielVertrag}
              onChange={(e) => setZahlungszielVertrag(e.target.value)} />
          </div>
          <div>
            <label className={LABEL} htmlFor="hv-ziel-bauherr">{t("Zahlungsziel je Bauherr (Tage)")}</label>
            <input id="hv-ziel-bauherr" type="number" min={0} className={FELD} value={zahlungszielBauherr} onChange={(e) => setZahlungszielBauherr(e.target.value)} />
          </div>
        </div>

        <div className="rounded-lg bg-muted px-3 py-2 text-sm dark:bg-slate-800">
          {berechnet.netto == null ? (
            <p className="text-muted-foreground dark:text-slate-300">
              {berechnet.quelle === "tafel_fehlt"
                ? t("Tafel fehlt — HOAI § {nr} noch nicht amtlich übertragen").replace("{nr}", String(info?.tafelParagraf ?? ""))
                : t("frei vereinbar")}
            </p>
          ) : (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 tabular-nums sm:grid-cols-3">
              <dt className="text-muted-foreground">{t("Grundhonorar")}</dt><dd>{formatEuro(Math.round((berechnet.grund || 0) * 100))}</dd>
              <dt className="text-muted-foreground">{t("Netto")}</dt><dd>{formatEuro(Math.round(berechnet.netto * 100))}</dd>
              <dt className="text-muted-foreground">{t("Brutto")}</dt><dd>{formatEuro(Math.round((berechnet.brutto || 0) * 100))}</dd>
              <dt className="text-muted-foreground">{t("Rest bis Schlussrechnung")}</dt><dd>{rest == null ? "—" : formatEuro(Math.round(rest * 100))}</dd>
            </dl>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            {t("HOAI 2021, Orientierungswerte § {nr} (Quelle und Abrufdatum der Tafel) — vor Vertragsverwendung gegenlesen, keine Rechtsberatung").replace("{nr}", String(info?.tafelParagraf ?? ""))}
          </p>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className={buttonVariants({ variant: "ghost" })} onClick={onClose}>{t("Abbrechen")}</button>
          <button type="button" disabled={speichert || !projektId} className={buttonVariants({})} onClick={speichern}>{t("Speichern")}</button>
        </div>
      </div>
    </FormModal>
  );
}

/** @param {string} quelle lpStand() quelle @returns {string} DICT key */
function leistungsstandQuelle(quelle) {
  switch (quelle) {
    case "hoaiplan": return "Planer im Komplex-Designer";
    case "projektphase": return "aus der Projektphase geschätzt";
    default: return "unbekannt";
  }
}
