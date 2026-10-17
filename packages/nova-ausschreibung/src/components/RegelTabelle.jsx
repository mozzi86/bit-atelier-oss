import React, { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Button } from "@core/components/ui/button";
import { Input } from "@core/components/ui/input";
import { Badge } from "@core/components/ui/badge";
import { Progress } from "@core/components/ui/progress";
import { AlertTriangle, Info, PlayCircle, Search } from "lucide-react";
import { buildIndex } from "@core/lib/rules/ruleEngine";
import { positionsMenge, sollWaechter } from "@ava/lib/mengenregeln";
import { fortschritt } from "@ava/lib/regelLauf";
import { vobMengenBewertung, hatVertragsmenge, VOB_STATUS } from "@ava/lib/vobMengen";
import { useI18n } from "@core/lib/i18n";
import { num } from "./avaUtils";

// RegelTabelle — alle Positionen mit Modus, Treffer, Menge, Δ Referenz.
//
// Die Kopfzeile ist der eigentliche Inhalt dieser Datei (Pitfall 7).
//
// „353 von 497 Positionen sind Übernahmen" ist ein ZUSTAND, kein Ziel. Ohne
// Gegengewicht wird daraus eine Endlagerung: die Zahl steht, niemand fasst sie an,
// und in zwei Jahren ist das Modell dreimal weitergelaufen, während die Mengen von
// 2020 unverändert im LV stehen. Deshalb hier drei Dinge, die die Endlagerung
// unbequem machen:
//
//   1. **GB-gewichteter Fortschritt** neben dem Stückanteil. 15 von 497 sieht nach
//      3 % aus; nach Geldwert ist der Anteil ein Vielfaches. Beide Zahlen stehen
//      nebeneinander — eine allein lügt in die eine oder andere Richtung.
//   2. **`modell_geprueft_am` als ALTER**, nicht als Datum. „vor 412 Tagen" tut
//      weh, „2025-06-18" nicht.
//   3. **Arbeitsliste nach GELDWERT**, nicht nach Ordnungszahl. Nach OZ sortiert
//      arbeitet man die Baustelleneinrichtung vor der Rohbaudecke ab.
//
// Dazu die Warnung „X Übernahmen seit 2 Modellständen ungeprüft" — der einzige
// Satz auf diesem Bildschirm, der von allein lauter wird.
const MODUS_LABEL = {
  filter: "Modell",
  modell: "Modell",
  uebernahme: "Übernahme",
  handeingabe: "Handeingabe",
  pauschal: "Pauschal",
  unbekannt: "—",
};

/**
 * 96-02: VOB/B § 2 Abs. 3 badge of one row. Information only (`warn`): the
 * price adjustment happens on request of a party, so nothing here blocks.
 * @param {{bewertung: import("@ava/lib/vobMengen").VobBewertung|null, einheit: string, t: (k: string) => string}} props
 *        bewertung = rating of the row (null = position without contracted quantity);
 *        einheit = unit of the position (m², m³, Stk, …)
 */
function VobBadge({ bewertung, einheit, t }) {
  if (!bewertung || bewertung.status === VOB_STATUS.OHNE_VERTRAGSMENGE || bewertung.status === VOB_STATUS.OHNE_ISTMENGE) {
    return <span className="text-muted-foreground">—</span>;
  }
  if (bewertung.status === VOB_STATUS.IM_TOLERANZBEREICH) {
    return (
      <span className="text-muted-foreground" title={t("§ 2 Abs. 3 Nr. 1 VOB/B: Abweichung bis 10 % von der Vertragsmenge — der vertragliche Einheitspreis gilt.")}>
        {t("im Toleranzbereich")}
      </span>
    );
  }
  const prozent = num(Math.abs(bewertung.abweichungProzent ?? 0));
  if (bewertung.status === VOB_STATUS.MEHRMENGE) {
    return (
      <Badge
        className="text-[10px] border bg-warnung-flaeche text-warnung border-warnung-rand whitespace-nowrap"
        title={t("§ 2 Abs. 3 Nr. 2 VOB/B: Für die über 110 % der Vertragsmenge hinausgehende Menge ist auf Verlangen ein neuer Einheitspreis zu vereinbaren. Hinweis, keine Sperre.")}
      >
        {t("Mehrmenge +{p} % (Spitze {m} {e})")
          .replace("{p}", prozent)
          .replace("{m}", num(bewertung.spitzenmenge, 3))
          .replace("{e}", einheit)}
      </Badge>
    );
  }
  return (
    <Badge
      className="text-[10px] border bg-warnung-flaeche text-warnung border-warnung-rand whitespace-nowrap"
      title={t("§ 2 Abs. 3 Nr. 3 VOB/B: Bei mehr als 10 % Unterschreitung der Vertragsmenge ist auf Verlangen der Einheitspreis für die ausgeführte Menge zu erhöhen. Hinweis, keine Sperre.")}
    >
      {t("Mindermenge −{p} %").replace("{p}", prozent)}
    </Badge>
  );
}

export default function RegelTabelle({
  positionen = [],
  regelnJePosition = null,
  elemente = [],
  snapshots = [],
  onSelect,
  selectedId = null,
  onRecompute,
  letzterLauf = null,
}) {
  const { t } = useI18n();
  const [suche, setSuche] = useState("");
  const [nurAuffaellig, setNurAuffaellig] = useState(false);

  const index = useMemo(() => buildIndex(elemente || []), [elemente]);
  const regelnVon = useMemo(() => {
    if (typeof regelnJePosition === "function") return regelnJePosition;
    if (regelnJePosition) return (p) => regelnJePosition[p?.id] || [];
    return (p) => p?.regeln || [];
  }, [regelnJePosition]);

  const zeilen = useMemo(() => {
    return (positionen || []).map((p) => {
      const regeln = regelnVon(p) || [];
      const res = regeln.length ? positionsMenge(regeln, index) : null;
      const referenz = p.quantity ?? p.menge_final ?? null;
      const delta =
        res && referenz != null ? Math.round((res.menge - referenz) * 100) / 100 : null;
      const soll = regeln.find((r) => r?.soll != null)?.soll ?? null;
      const waechter = res ? sollWaechter({ soll }, res.menge) : null;
      const treffer = res ? res.regeln.reduce((a, r) => a + (r.treffer || 0), 0) : null;
      // 96-02: the current quantity is the recomputed one (what the next run
      // writes), else the stored quantity; rated against the frozen contract quantity.
      const vob = hatVertragsmenge(p)
        ? vobMengenBewertung({ vertragsmenge: p.vertragsmenge, istmenge: res ? res.menge : referenz, einheitspreis: p.unit_price })
        : null;
      return {
        p,
        regeln,
        res,
        treffer,
        referenz,
        delta,
        waechter,
        vob,
        warnungen: res?.warnungen || [],
        modus: p.mengen_modus ?? (regeln.some((r) => r.art === "modell") ? "filter" : "unbekannt"),
      };
    });
  }, [positionen, regelnVon, index]);

  const fs = useMemo(() => fortschritt(positionen, { snapshots }), [positionen, snapshots]);

  const gefiltert = useMemo(() => {
    const t = suche.trim().toLowerCase();
    return zeilen
      .filter((z) => (nurAuffaellig ? (z.delta != null && z.delta !== 0) || z.warnungen.length > 0 : true))
      .filter((z) => !t || `${z.p.oz} ${z.p.title} ${z.p.trade}`.toLowerCase().includes(t))
      .slice(0, 600);
  }, [zeilen, suche, nurAuffaellig]);

  const alter = (tage) =>
    tage == null ? <span className="text-warnung">nie geprüft</span> : `vor ${tage} Tagen`;

  return (
    <Card className="border-border">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex flex-wrap items-center justify-between gap-2">
          <span>Mengenregeln — {positionen.length} Positionen</span>
          {onRecompute && (
            <Button size="sm" variant="outline" onClick={onRecompute}>
              <PlayCircle className="w-3 h-3 mr-1" /> Nachrechnen
            </Button>
          )}
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* --- Fortschritt gegen Pitfall 7 -------------------------------- */}
        <div className="rounded-lg border border-border bg-muted p-3 space-y-2">
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span>
              <strong>modellgebunden {fs.modellgebunden} / {fs.positionen} Positionen</strong>{" "}
              <span className="text-muted-foreground">({fs.anteil_positionen ?? "—"} % nach Stück)</span>
            </span>
            <span className="text-erfolg">
              <strong>gewichtet nach GB: {fs.anteil_gb ?? "—"} %</strong>{" "}
              <span className="text-muted-foreground">
                ({num(fs.gb_modellgebunden)} € von {num(fs.gb_gesamt)} €)
              </span>
            </span>
            <Badge variant="outline" className="text-[10px] border-border text-muted-foreground">
              {fs.uebernahmen} Übernahmen
            </Badge>
          </div>
          <Progress value={fs.anteil_gb ?? 0} className="h-2" />
          <p className="text-[10px] text-muted-foreground flex items-start gap-1">
            <Info className="w-3 h-3 mt-0.5 shrink-0" />
            {fs.hinweis} Die Zahl der Übernahmen ist ein <strong>Zustand, kein Ziel</strong>.
          </p>
          {fs.warnung && (
            <p className="rounded border border-warnung-rand bg-warnung-flaeche p-2 text-[11px] text-warnung flex items-start gap-1">
              <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" /> {fs.warnung}
            </p>
          )}
        </div>

        {/* --- Arbeitsliste nach GELDWERT --------------------------------- */}
        {fs.arbeitsliste.length > 0 && (
          <details className="rounded-lg border border-border p-2">
            <summary className="cursor-pointer text-xs font-semibold text-foreground">
              Arbeitsliste — nach Geldwert sortiert ({fs.arbeitsliste.length} Positionen ohne
              Modellbindung)
            </summary>
            <table className="mt-2 w-full text-xs">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="px-2 py-1">OZ</th>
                  <th className="px-2 py-1">Gewerk</th>
                  <th className="px-2 py-1">Modus</th>
                  <th className="px-2 py-1 text-right">GB</th>
                  <th className="px-2 py-1">zuletzt am Modell geprüft</th>
                  <th className="px-2 py-1 text-right">Modellstände seither</th>
                </tr>
              </thead>
              <tbody>
                {fs.arbeitsliste.slice(0, 50).map((z, i) => (
                  <tr key={z.position_id ?? i} className="border-b border-border">
                    <td className="px-2 py-1">{z.oz}</td>
                    <td className="px-2 py-1">{z.trade ?? "—"}</td>
                    <td className="px-2 py-1">{MODUS_LABEL[z.modus] ?? z.modus}</td>
                    <td className="px-2 py-1 text-right">
                      {z.ohne_preis ? <span className="text-muted-foreground">kein Preis belegt</span> : `${num(z.gb)} €`}
                    </td>
                    <td className="px-2 py-1">{alter(z.alter_tage)}</td>
                    <td className={`px-2 py-1 text-right ${z.staende_ungeprueft >= 2 ? "text-warnung font-semibold" : ""}`}>
                      {z.staende_ungeprueft}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        )}

        {/* --- Filterzeile ------------------------------------------------ */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-2 h-3 w-3 text-muted-foreground" />
            <Input
              className="h-8 w-64 pl-7 text-xs"
              placeholder="OZ, Kurztext, Gewerk"
              value={suche}
              onChange={(e) => setSuche(e.target.value)}
            />
          </div>
          <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <input type="checkbox" checked={nurAuffaellig} onChange={(e) => setNurAuffaellig(e.target.checked)} />
            nur Auffälligkeiten (Δ ≠ 0 oder Warnung)
          </label>
          {letzterLauf && (
            <span className="text-[11px] text-muted-foreground">
              letzter Lauf: {String(letzterLauf.zeitpunkt).slice(0, 16).replace("T", " ")} ·{" "}
              {letzterLauf.geaendert} geändert · {letzterLauf.warnungen?.length ?? 0} Warnungen
            </span>
          )}
        </div>

        {/* --- Tabelle ---------------------------------------------------- */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="px-2 py-1">OZ</th>
                <th className="px-2 py-1">Kurztext</th>
                <th className="px-2 py-1">Modus</th>
                <th className="px-2 py-1 text-right">Regeln</th>
                <th className="px-2 py-1 text-right">Treffer</th>
                <th className="px-2 py-1 text-right">Menge</th>
                <th className="px-2 py-1 text-right">Δ Referenz</th>
                <th className="px-2 py-1">soll-Ampel</th>
                <th className="px-2 py-1" title={t("Ist-Menge gegen die beim Zuschlag eingefrorene Vertragsmenge (§ 2 Abs. 3 VOB/B, ±10 %)")}>
                  {t("VOB/B § 2 Abs. 3")}
                </th>
                <th className="px-2 py-1">Hinweise</th>
              </tr>
            </thead>
            <tbody>
              {gefiltert.map((z) => (
                <tr
                  key={z.p.id ?? z.p.oz}
                  onClick={() => onSelect?.(z.p.id ?? null)}
                  className={`cursor-pointer border-b border-border hover:bg-muted ${
                    selectedId && z.p.id === selectedId ? "bg-erfolg-flaeche" : ""
                  }`}
                >
                  <td className="px-2 py-1 whitespace-nowrap">{z.p.oz}</td>
                  <td className="px-2 py-1 max-w-sm truncate" title={z.p.title}>{z.p.title}</td>
                  <td className="px-2 py-1">{MODUS_LABEL[z.modus] ?? z.modus}</td>
                  <td className="px-2 py-1 text-right">{z.regeln.length}</td>
                  <td className="px-2 py-1 text-right">
                    {z.treffer == null ? (
                      "—"
                    ) : z.treffer === 0 ? (
                      <span className="rounded bg-red-100 px-1 text-fehler">0 Treffer</span>
                    ) : (
                      z.treffer
                    )}
                  </td>
                  <td className="px-2 py-1 text-right">{z.res ? num(z.res.menge) : "—"}</td>
                  <td
                    className={`px-2 py-1 text-right ${
                      z.delta == null ? "text-muted-foreground" : z.delta === 0 ? "text-erfolg" : "text-fehler font-semibold"
                    }`}
                    title="Referenz = die aktuell gespeicherte Menge der Position. Δ ≠ 0 heißt: der Recompute liefert etwas anderes."
                  >
                    {z.delta == null ? "—" : num(z.delta)}
                  </td>
                  <td className="px-2 py-1">
                    {!z.waechter || z.waechter.ampel === "grau" ? (
                      <span className="text-muted-foreground">keine Vergleichsmenge</span>
                    ) : (
                      <Badge
                        className={`text-[10px] border ${
                          z.waechter.ampel === "gruen"
                            ? "bg-erfolg-flaeche text-erfolg border-erfolg-rand"
                            : z.waechter.ampel === "gelb"
                              ? "bg-warnung-flaeche text-warnung border-warnung-rand"
                              : "bg-red-100 text-fehler border-red-300"
                        }`}
                      >
                        {z.waechter.ampel}
                      </Badge>
                    )}
                  </td>
                  <td className="px-2 py-1">
                    <VobBadge bewertung={z.vob} einheit={z.p.unit ?? ""} t={t} />
                  </td>
                  <td className="px-2 py-1 text-warnung" title={z.warnungen.join(" · ")}>
                    {z.warnungen.length > 0 ? `${z.warnungen.length}` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {zeilen.length > gefiltert.length && (
            <p className="mt-1 text-[10px] text-muted-foreground">
              {zeilen.length - gefiltert.length} Zeile(n) durch Filter/Grenze ausgeblendet.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
