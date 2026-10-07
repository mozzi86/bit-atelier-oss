import React, { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Badge } from "@core/components/ui/badge";
import { Button } from "@core/components/ui/button";
import { Input } from "@core/components/ui/input";
import { Label } from "@core/components/ui/label";
import { Info, Lock, Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@core/lib/i18n";
import { rangfolge } from "@core/lib/rules/priceStack";
import { kgVorschlaege } from "@ava/lib/kgVorschlag";
import { kennzahlen, zaehler, schwellenAus, AMPEL_NA, summen } from "@ava/lib/preisschichten";
import { eur, num, dinLabel } from "./avaUtils";

// Kostenberechnung — drei Spaltenblöcke, drei Gruppierungen, EIN Preisstand-Regler.
//
// Der Aufbau folgt der Excel, die im Büro tatsächlich benutzt wird:
//   2020 (grau, eingefroren)  |  heute  |  Δ (Analyse)
// Der 2020er-Block ist Literalwert aus dem Kostenanschlag 17.12.2020 und wird
// NIE neu gerechnet. Das ist keine Faulheit, sondern die Anforderung: ein
// Kostenanschlag ist ein Dokumentenstand.
//
// Der Regler ist ein DATUM, kein Faktor. Wer einen Faktor schiebt, dreht an
// einer Zahl; wer ein Datum wählt, sagt „Preisstand Mai 2026" — und die
// Index-Schichten rechnen nach, weil ihr ep nie gespeichert wird.
//
// Die Ampelspalte heißt „Δ EP vs. Index (mengenneutral)" und zeigt bei
// indexbasierten Positionen „n/a — Index gegen Index". NICHT grün: grün wäre
// die Behauptung einer Prüfung, die nicht stattgefunden hat (Pitfall 8).

const AMPEL_KLASSE = {
  gruen: "bg-emerald-100 text-emerald-800",
  gelb: "bg-amber-100 text-amber-800",
  rot: "bg-red-100 text-red-800",
};

const GRUPPIERUNGEN = [
  { key: "trade", label: "Gewerk" },
  { key: "din276_2018", label: "DIN 276-2018" },
  { key: "din276_2008", label: "DIN 276-2008" },
];

const pct = (v) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(0)} %`);

export default function KostenberechnungTabelle({
  positionen = [],
  schichtenJePosition = null,
  reihen = null,
  kataloge = {},
  vertraege = [],
  deckungJePosition = null,
  preisstand = "2026-05",
  preisstandBasis = "2020-11",
  onPreisstand = null,
  // Zeilenauswahl (Phase 33 / W6): der Preisstapel der gewählten Position wird
  // daneben eingeblendet. Ein Einheitspreis ohne einsehbare Herkunft ist im
  // Kostenanschlag von einem belegten nicht zu unterscheiden.
  onSelect = null,
  selectedId = null,
  // 76-03: Kostengruppen-Vorschlag annehmen → Position schreiben (Speicherweg der Seite).
  onUpdate = null,
}) {
  const rf = useMemo(() => rangfolge(kataloge.PreisRangfolge || []), [kataloge.PreisRangfolge]);
  const schwellen = useMemo(() => schwellenAus(kataloge.AmpelSchwelle || []), [kataloge.AmpelSchwelle]);
  const dinKatalog = kataloge.Din276Katalog || [];
  const [gruppierung, setGruppierung] = useState("trade");
  const [datum, setDatum] = useState(preisstand);
  const { t } = useI18n();

  // --- Kostengruppen-Vorschlag über TypeSafe (Phase 76-03) --------------------
  // Vorschläge liegen NUR im UI-Zustand (positionId → Vorschlag). Geschrieben
  // wird eine Position erst durch den Klick auf ihren Chip — nie alle auf einmal
  // (T-33-23: eine Kostengruppe bewegt Geld, der Nutzer bleibt Verantwortlicher).
  const [kgVorschlag, setKgVorschlag] = useState({});
  const [kgBusy, setKgBusy] = useState(false);
  const ohneKg = useMemo(() => positionen.filter((p) => !(p.din276 || p.kg2018) && p.id != null), [positionen]);

  const fehlendeVorschlagen = async () => {
    setKgBusy(true);
    try {
      const jeGewerk = new Map();
      for (const p of ohneKg) {
        const g = p.trade || "";
        if (!jeGewerk.has(g)) jeGewerk.set(g, []);
        jeGewerk.get(g).push(p);
      }
      const neu = {};
      for (const [gewerk, ps] of jeGewerk) {
        const texte = ps.map((p) => p.short_text || p.title || "");
        const r = await kgVorschlaege(texte, dinKatalog, gewerk || null);
        for (const v of r.vorschlaege) {
          const p = ps[v.nr - 1];
          if (p) neu[p.id] = v;
        }
      }
      setKgVorschlag((alt) => ({ ...alt, ...neu }));
    } catch (e) {
      toast.error(e?.message || String(e));
    }
    setKgBusy(false);
  };

  const vorschlagAnnehmen = async (p, v) => {
    if (!onUpdate || v?.kg2018 == null) return;
    await onUpdate(p.id, {
      din276: v.kg2018,
      din276_fassung: "2018",
      din276_confidence: v.confidence,
      din276_hinweis: `TypeSafe-Vorschlag · ${v.begruendung}`,
    });
    setKgVorschlag((alt) => { const n = { ...alt }; delete n[p.id]; return n; });
  };

  const CHIP_KLASSE = {
    hoch: "bg-emerald-100 text-emerald-800 border-emerald-200",
    mittel: "bg-amber-100 text-amber-800 border-amber-200",
    niedrig: "bg-slate-100 text-slate-600 border-slate-200",
  };
  const pKomma = (x) => (Math.round(x * 100) / 100).toFixed(2).replace(".", ",");

  const holeSchichten = (p) =>
    typeof schichtenJePosition === "function"
      ? schichtenJePosition(p) || []
      : (schichtenJePosition?.[p?.id] || p?.schichten || []);

  const zeilen = useMemo(
    () =>
      positionen.map((p) => {
        const sch = holeSchichten(p);
        const k = kennzahlen(p, sch, reihen, schwellen, rf);
        const menge = p.menge_final ?? p.quantity ?? null;
        const gesperrt = p.im_vertrag_enthalten === true;
        return {
          p,
          k,
          menge,
          gesperrt,
          gb_heute: gesperrt ? 0 : (k.ep_aktiv != null && menge != null ? menge * k.ep_aktiv : null),
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [positionen, schichtenJePosition, reihen, schwellen, rf],
  );

  const zaehlerStand = useMemo(
    () => zaehler(positionen, schichtenJePosition, reihen, schwellen, rf),
    [positionen, schichtenJePosition, reihen, schwellen, rf],
  );

  const summe = useMemo(
    () => summen(positionen, { schichtenJePosition, reihen, rangfolge: rf, vertraege, deckungJePosition }),
    [positionen, schichtenJePosition, reihen, rf, vertraege, deckungJePosition],
  );

  const gruppen = useMemo(() => {
    const m = new Map();
    for (const z of zeilen) {
      const key =
        gruppierung === "trade"
          ? (z.p.trade || "Ohne Gewerk")
          : gruppierung === "din276_2018"
            ? (z.p.din276 || z.p.kg2018 || "?")
            : (z.p.din276_2008 || z.p.kg2008 || "?");
      if (!m.has(key)) m.set(key, []);
      m.get(key).push(z);
    }
    return [...m.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]), "de"));
  }, [zeilen, gruppierung]);

  return (
    <Card className="border-slate-200">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">Kostenberechnung — Kostenanschlag 2020 (fix) vs. Kostenstand heute</CardTitle>
          {ohneKg.length > 0 && (
            <Button
              type="button" variant="outline" size="sm" onClick={fehlendeVorschlagen} disabled={kgBusy}
              aria-label={t("Fehlende KG vorschlagen")} data-testid="kg-fehlende-vorschlagen"
            >
              {kgBusy ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Sparkles className="w-3 h-3 mr-1" />}
              {t("Fehlende KG vorschlagen")} ({ohneKg.length})
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* --- Preisstand-Regler: ein DATUM ------------------------------- */}
        <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3 space-y-2">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label className="text-xs">Preisstand (Datum, nicht Faktor)</Label>
              <Input
                type="month"
                value={datum}
                onChange={(e) => { setDatum(e.target.value); onPreisstand?.(e.target.value); }}
                className="w-40"
              />
            </div>
            <p className="text-xs text-slate-600 max-w-2xl">
              Basis {preisstandBasis}. Die Index-Schichten rechnen bei jeder Anzeige neu —
              ihr Einheitspreis wird <strong>nie gespeichert</strong>. Ein Datum ändern lässt
              alle indexbasierten Einheitspreise nachrechnen.
            </p>
          </div>
          <p className="text-xs text-amber-800 flex items-start gap-1">
            <Info className="w-3 h-3 mt-0.5 shrink-0" />
            <span>
              <strong>[ASSUMED]</strong> Die zugrunde liegende Preisindexreihe (destatis-Baupreisindex,
              2021=100) ist in keiner Sitzung gegen destatis geprüft worden. Sie ist eine
              <strong> editierbare Reihe</strong> im Katalog <code>Preisindexreihe</code>; Punkte ab
              06/2026 sind ausdrücklich <strong>Prognose</strong> (+5 % p. a.). Der Kostenstand ist
              damit eine Preisstand-Angabe, kein Messwert.
            </span>
          </p>
        </div>

        {/* --- Zähler: Fortschritt, kein Gütesiegel ---------------------- */}
        <div className="flex flex-wrap gap-2 text-xs">
          <Badge variant="outline">{zaehlerStand.gesamt} Positionen</Badge>
          <Badge variant="outline">
            {zaehlerStand.preisquelle_ueber_index} mit Preisquelle oberhalb des Index
          </Badge>
          <Badge variant="outline">{zaehlerStand.aktiv_ueber_index} davon wirksam</Badge>
          <Badge variant="outline">{zaehlerStand.ampel[AMPEL_NA]} × Ampel „n/a"</Badge>
          {summe.ungeklaert > 0 && (
            <Badge className="bg-amber-100 text-amber-800 border-amber-200">
              ungeklärt: {summe.ungeklaert}
            </Badge>
          )}
          <span className="text-slate-500 self-center">
            Der Zähler ist eine <strong>Fortschrittsanzeige</strong>, kein Gütesiegel.
          </span>
        </div>

        {/* --- Gruppierung ---------------------------------------------- */}
        <div className="flex gap-1">
          {GRUPPIERUNGEN.map((g) => (
            <Button
              key={g.key}
              size="sm"
              variant={gruppierung === g.key ? "default" : "outline"}
              onClick={() => setGruppierung(g.key)}
            >
              {g.label}
            </Button>
          ))}
        </div>

        {/* --- Tabelle -------------------------------------------------- */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left">
                <th colSpan={4} className="px-2 py-1" />
                <th colSpan={3} className="px-2 py-1 bg-slate-200 text-slate-700">
                  <span className="inline-flex items-center gap-1"><Lock className="w-3 h-3" /> Kostenanschlag 17.12.2020 (fix)</span>
                </th>
                <th colSpan={3} className="px-2 py-1 bg-emerald-50 text-emerald-800">Kostenstand heute</th>
                <th colSpan={3} className="px-2 py-1">Analyse</th>
              </tr>
              <tr className="text-left border-b border-slate-300">
                <th className="px-2 py-1">OZ</th>
                <th className="px-2 py-1">Kurztext</th>
                <th className="px-2 py-1">KG</th>
                <th className="px-2 py-1">ME</th>
                <th className="px-2 py-1 bg-slate-100">Menge 2020</th>
                <th className="px-2 py-1 bg-slate-100">EP 2020</th>
                <th className="px-2 py-1 bg-slate-100">GB 2020</th>
                <th className="px-2 py-1">Menge heute</th>
                <th className="px-2 py-1">EP heute</th>
                <th className="px-2 py-1">GB heute</th>
                <th className="px-2 py-1">Δ Menge</th>
                <th className="px-2 py-1">Δ EP vs. Index (mengenneutral)</th>
                <th className="px-2 py-1">Δ GB ges.</th>
              </tr>
            </thead>
            <tbody>
              {gruppen.map(([key, zs]) => (
                <React.Fragment key={key}>
                  <tr className="bg-slate-50 font-medium">
                    <td colSpan={13} className="px-2 py-1">
                      {gruppierung === "trade" ? key : dinLabel(key, dinKatalog)} · {zs.length}
                    </td>
                  </tr>
                  {zs.map((z, i) => {
                    const a = z.k.delta_ep_index;
                    return (
                      <tr
                      key={z.p.id ?? `${key}-${i}`}
                      onClick={onSelect ? () => onSelect(z.p.id ?? null) : undefined}
                      className={`border-b border-slate-100 ${onSelect ? "cursor-pointer hover:bg-slate-50" : ""} ${
                        selectedId && z.p.id === selectedId ? "bg-emerald-50" : ""
                      }`}
                    >
                        <td className="px-2 py-1 font-mono">{z.p.oz}</td>
                        <td className="px-2 py-1 max-w-[22rem] truncate" title={z.p.title || z.p.short_text}>
                          {z.p.title || z.p.short_text}
                          {z.gesperrt && (
                            <Badge className="ml-1 bg-slate-200 text-slate-700 border-slate-300">
                              im Vertrag enthalten — GB 0
                            </Badge>
                          )}
                        </td>
                        <td className="px-2 py-1" onClick={(e) => e.stopPropagation()}>
                          {z.p.din276 || z.p.kg2018 || (() => {
                            const v = kgVorschlag[z.p.id];
                            if (!v) return "—";
                            if (v.kg2018 == null) {
                              return (
                                <span className="text-xs text-slate-400" title={v.begruendung} data-testid="kg-chip-leer">
                                  {t("kein Vorschlag")}
                                </span>
                              );
                            }
                            return (
                              <button
                                type="button"
                                className={`rounded border px-1.5 py-0.5 text-xs ${CHIP_KLASSE[v.confidence] || CHIP_KLASSE.niedrig}`}
                                title={`${v.begruendung} — ${t("Vorschlag")} übernehmen`}
                                onClick={() => vorschlagAnnehmen(z.p, v)}
                                disabled={!onUpdate}
                                data-testid="kg-chip"
                              >
                                {t("Vorschlag")} {v.kg2018} ({pKomma(v.wahrscheinlichkeit)})
                              </button>
                            );
                          })()}
                        </td>
                        <td className="px-2 py-1">{z.p.unit}</td>
                        {/* 2020 grau + eingefroren: keine Eingabe, keine Formel */}
                        <td className="px-2 py-1 bg-slate-100 tabular-nums">{z.p.menge_kostenanschlag == null ? "—" : num(z.p.menge_kostenanschlag)}</td>
                        <td className="px-2 py-1 bg-slate-100 tabular-nums">{z.p.ep_kostenanschlag == null ? "—" : eur(z.p.ep_kostenanschlag)}</td>
                        <td className="px-2 py-1 bg-slate-100 tabular-nums">{z.p.gb_kostenanschlag == null ? "—" : eur(z.p.gb_kostenanschlag)}</td>
                        <td className="px-2 py-1 tabular-nums">{z.menge == null ? "—" : num(z.menge)}</td>
                        <td className="px-2 py-1 tabular-nums" title={z.k.schicht_aktiv?.index_formel || z.k.schicht_aktiv?.herkunft?.beleg || ""}>
                          {z.k.ep_aktiv == null ? "—" : eur(z.k.ep_aktiv)}
                          {z.k.art_aktiv && <span className="ml-1 text-slate-400">{z.k.art_aktiv}</span>}
                        </td>
                        <td className="px-2 py-1 tabular-nums">{z.gb_heute == null ? "—" : eur(z.gb_heute)}</td>
                        <td className="px-2 py-1 tabular-nums">{pct(z.k.delta_menge)}</td>
                        <td className="px-2 py-1">
                          {a.ampel === AMPEL_NA ? (
                            <span className="text-slate-500" title={a.grund || ""}>
                              n/a — {a.grund || "nicht vergleichbar"}
                            </span>
                          ) : (
                            <span className={`px-1.5 py-0.5 rounded ${AMPEL_KLASSE[a.ampel] || ""}`}>
                              {pct(a.wert)}
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-1 tabular-nums text-slate-500">{pct(z.k.delta_gb)}</td>
                      </tr>
                    );
                  })}
                </React.Fragment>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-300 font-semibold">
                <td colSpan={9} className="px-2 py-1 text-right">Σ Positionen netto</td>
                <td className="px-2 py-1 tabular-nums">{eur(summe.gb_positionen)}</td>
                <td colSpan={3} />
              </tr>
              {summe.gb_vertraege > 0 && (
                <>
                  <tr className="font-semibold">
                    <td colSpan={9} className="px-2 py-1 text-right">+ Σ Verträge (Auftrag + Nachträge)</td>
                    <td className="px-2 py-1 tabular-nums">{eur(summe.gb_vertraege)}</td>
                    <td colSpan={3} />
                  </tr>
                  <tr className="font-bold border-t border-slate-300">
                    <td colSpan={9} className="px-2 py-1 text-right">Σ Kostenstand netto</td>
                    <td className="px-2 py-1 tabular-nums">{eur(summe.gb_gesamt)}</td>
                    <td colSpan={3} className="px-2 py-1 text-xs font-normal text-slate-500">
                      Vertragssperre ist Σ-invariant: was an der Position auf 0 fällt, trägt der Vertrag.
                    </td>
                  </tr>
                </>
              )}
            </tfoot>
          </table>
        </div>

        {summe.ungeklaert > 0 && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs">
            <strong>ungeklärt: {summe.ungeklaert}</strong> — im Auftrags-LV nicht auffindbar
            (eigener OZ-Raum, kein OZ-Join). Sie werden ausgewiesen, nicht stumm mitgezählt:
            <ul className="mt-1 list-disc pl-5">
              {summe.ungeklaert_liste.map((u, i) => (
                <li key={i}>OZ {u.oz}{u.grund ? ` — ${u.grund}` : ""}</li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
