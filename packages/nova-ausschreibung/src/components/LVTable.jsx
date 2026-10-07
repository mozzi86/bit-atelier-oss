import React, { useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Button, buttonVariants } from "@core/components/ui/button";
import { Badge } from "@core/components/ui/badge";
import { cn } from "@core/lib/utils";
import { useI18n } from "@core/lib/i18n";
import {
  Plus, Pencil, Trash2, Download, Boxes, ChevronDown, ChevronRight, FileText, FileDown, FileUp,
  Filter as FilterIcon, AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import {
  eur, eur0, num, gp, groupByTrade, lvTotal, dinLabel, toCsv, downloadCsv,
  positionMode, MODUS_LABEL, MODUS_BADGE, AUSSCHLUSS_LABEL, modellbindungsGrad,
} from "./avaUtils";
import { filterTreffer } from "@ava/lib/avaFilters";
import { downloadGaeb, detectAndParse, buildX83Dateien } from "@ava/lib/gaeb";
import LVPositionForm from "./LVPositionForm";

// Leistungsverzeichnis editor: positions grouped by trade (Los), with totals,
// CRUD, BIM-link indicator, CSV/GAEB-Export und GAEB/CSV-Import.
// 72-15 (N-16): the empty state offers both ways in ("Erste Position anlegen",
// "Mengen aus dem BIM-Modell" via onZuBimMengen), the trade toggle announces its
// state (aria-expanded), row icons carry the OZ in their name, and deleting a
// position asks inline ("Wirklich löschen?" Ja/Nein) instead of acting on one click.
export default function LVTable({
  positions, onCreate, onUpdate, onDelete, onShowDetail = null, onImport,
  filters = [], elements = [], dinKatalog = [],
  // Phase 33 / W4: Zeilenauswahl für den Preisstapel-Einblick.
  onSelect = null, selectedId = null,
  // 72-15: switches the page to the BIM quantities tab; without it the empty state
  // offers only the manual way.
  onZuBimMengen = null,
}) {
  const { t } = useI18n();
  const fileInputRef = useRef(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [defaultTrade, setDefaultTrade] = useState("");
  const [collapsed, setCollapsed] = useState({});
  // Id of the position whose delete icon was pressed once; null = no question open.
  const [loeschFrage, setLoeschFrage] = useState(null);
  const loeschKnopfRef = useRef(null);
  // Native buttons with the shadcn classes: <Button> costs a tsc error per use.
  const iconKnopf = cn(buttonVariants({ variant: "ghost", size: "icon" }), "h-7 w-7");
  const kleinerKnopf = "inline-flex h-7 items-center rounded-md border px-2 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400";

  const frageAbbrechen = () => {
    setLoeschFrage(null);
    loeschKnopfRef.current?.focus();
  };

  const groups = groupByTrade(positions);
  const total = lvTotal(positions);
  const bindung = modellbindungsGrad(positions);

  const openNew = (trade) => { setEditing(null); setDefaultTrade(trade || ""); setShowForm(true); };
  const openEdit = (pos) => { setEditing(pos); setShowForm(true); };

  const submit = async (data) => {
    if (editing) await onUpdate(editing.id, data);
    else await onCreate(data);
    setShowForm(false);
    setEditing(null);
  };

  const exportCsv = () => {
    const header = ["OZ", "Gewerk", "DIN276", "Titel", "Kurztext", "Einheit", "Menge", "EP", "GP"];
    const rows = positions
      .slice()
      .sort((a, b) => (a.oz || "").localeCompare(b.oz || "", "de", { numeric: true }))
      .map((p) => [p.oz, p.trade, p.din276, p.title, p.short_text, p.unit, p.quantity, p.unit_price, gp(p).toFixed(2)]);
    downloadCsv("leistungsverzeichnis.csv", toCsv(header, rows));
  };

  // GAEB-Export: eine X83-Datei JE GEWERK (DA83/3.3). Nicht eine Sammeldatei —
  // ein Leistungsverzeichnis wird gewerksweise ausgeschrieben, und der
  // Ziel-Import erwartet genau das.
  const exportGaeb = () => {
    const kg = {};
    for (const p of positions) {
      kg[`${p.trade || ""}|${p.oz}`] = { kg2018: p.din276 || null, kg2008: p.din276_2008 || null };
    }
    const dateien = buildX83Dateien({
      positionen: positions.map((p) => ({
        gewerk_nr: p.trade || "",
        oz: p.oz,
        kurztext: p.short_text || p.title || "",
        langtext: p.long_text || "",
        menge_final: p.quantity,
        einheit: p.unit,
        titel: p.titel_pfad || [p.trade || "", p.title || ""],
        titel_oz: p.titel_oz || [String(p.oz || "").slice(0, 2), String(p.oz || "").slice(2, 4)],
      })),
      lvs: [...new Set(positions.map((p) => p.trade))].filter(Boolean).map((t) => ({ gewerk_nr: t, lv_name: t })),
      kg,
      meta: { datum: new Date().toISOString().slice(0, 10) },
      projektNr: "LV",
    });
    for (const d of dateien) downloadGaeb(d.dateiname, d.xml);
  };

  const handleImportFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      // arrayBuffer() statt text(): GAEB 90 ist CP437-codiert, und `file.text()`
      // dekodiert immer UTF-8 — jedes Umlaut-Byte wäre unwiederbringlich zerstört.
      const bytes = await file.arrayBuffer();
      const rows = detectAndParse(file.name, bytes);
      if (rows.length > 0) {
        onImport?.(rows);
        toast.success(`${rows.length} Positionen aus "${file.name}" gelesen`);
      } else {
        toast.error(
          "Keine Positionen erkannt — Datei prüfen (GAEB 90 .d83, GAEB-XML .x83 oder Semikolon-CSV mit Headerzeile)",
        );
      }
    } catch (err) {
      console.error("LV-Import fehlgeschlagen:", err);
      toast.error(err?.message || "Datei konnte nicht gelesen werden");
    }
  };

  const toggle = (trade) => setCollapsed((c) => ({ ...c, [trade]: !c[trade] }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-slate-800">Leistungsverzeichnis</h3>
          <p className="text-sm text-slate-500">{positions.length} Positionen · Kostenanschlag {eur0(total)}</p>
          {/* Modellbindung GEWICHTET NACH GELDWERT: nach Anzahl gezählt sähe „15 von 497"
              nach 3 % aus und würde nie priorisiert. Das ist der einzige Fortschritts-
              indikator, den es gibt — ohne ihn wird `uebernahme` zur Endlagerung. */}
          {positions.length > 0 && (
            <p className="text-xs text-slate-400">
              Modellgebunden: {bindung.anzahl_modell}/{bindung.anzahl_gesamt} Positionen ·{" "}
              {Math.round(bindung.grad_wert * 100)} % des Geldwerts
              {bindung.offene_uebernahmen.length > 0 && (
                <> · {bindung.offene_uebernahmen.length} Übernahmen offen (größte: {eur0(bindung.offene_uebernahmen[0].gp)})</>
              )}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".d81,.d83,.d84,.p83,.x81,.x82,.x83,.x84,.x86,.xml,.csv"
            className="hidden"
            onChange={handleImportFile}
          />
          <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()}>
            <FileUp className="w-4 h-4 mr-2" /> Import
          </Button>
          <Button size="sm" variant="outline" onClick={exportGaeb} disabled={!positions.length}>
            <FileDown className="w-4 h-4 mr-2" /> GAEB-Export
          </Button>
          <Button variant="outline" onClick={exportCsv} disabled={!positions.length}>
            <Download className="w-4 h-4 mr-2" /> CSV-Export
          </Button>
          <Button onClick={() => openNew("")} className="bg-gradient-to-r from-emerald-600 to-teal-600">
            <Plus className="w-4 h-4 mr-2" /> {t("Position anlegen")}
          </Button>
        </div>
      </div>

      {groups.length === 0 && (
        <Card><CardContent className="p-8 text-center space-y-4">
          <p className="text-slate-500">
            {t("Noch keine Positionen. Legen Sie die erste Position an oder übernehmen Sie Mengen aus dem BIM-Modell.")}
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <button
              type="button"
              onClick={() => openNew("")}
              className={cn(buttonVariants(), "bg-gradient-to-r from-emerald-600 to-teal-600")}
            >
              <Plus className="w-4 h-4" /> {t("Erste Position anlegen")}
            </button>
            {onZuBimMengen && (
              <button type="button" onClick={onZuBimMengen} className={buttonVariants({ variant: "outline" })}>
                <Boxes className="w-4 h-4" /> {t("Mengen aus dem BIM-Modell")}
              </button>
            )}
          </div>
        </CardContent></Card>
      )}

      {groups.map((grp) => (
        <Card key={grp.trade}>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => toggle(grp.trade)}
                aria-expanded={!collapsed[grp.trade]}
                className="flex items-center gap-2 text-left"
              >
                {collapsed[grp.trade] ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                {/* span, not the default h3: a button may only hold phrasing content. */}
                <CardTitle as="span" className="text-base">{grp.trade}</CardTitle>
                <Badge className="bg-slate-100 text-slate-600">{grp.items.length}</Badge>
              </button>
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold text-slate-700">{eur0(grp.total)}</span>
                <Button
                  size="icon" variant="ghost" className="h-7 w-7"
                  title={t("Position in diesem Gewerk anlegen")}
                  aria-label={t("Position im Gewerk {gewerk} anlegen").replace("{gewerk}", grp.trade || "")}
                  onClick={() => openNew(grp.trade)}
                >
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </CardHeader>
          {!collapsed[grp.trade] && (
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-slate-400 border-b">
                      <th className="py-2 px-3">OZ</th>
                      <th className="py-2 px-3">Position</th>
                      <th className="py-2 px-3 text-right">Menge</th>
                      <th className="py-2 px-3">Einheit</th>
                      <th className="py-2 px-3 text-right">EP</th>
                      <th className="py-2 px-3 text-right">GP</th>
                      <th className="py-2 px-3 text-right">Aktion</th>
                    </tr>
                  </thead>
                  <tbody>
                    {grp.items.map((p) => (
                      <tr
                        key={p.id}
                        onClick={onSelect ? () => onSelect(p.id === selectedId ? null : p.id) : undefined}
                        className={[
                          "border-b last:border-0 hover:bg-slate-50",
                          onSelect ? "cursor-pointer" : "",
                          p.id === selectedId ? "bg-emerald-50/70" : "",
                        ].join(" ")}
                      >
                        <td className="py-2 px-3 font-mono text-xs text-slate-500">{p.oz}</td>
                        <td className="py-2 px-3">
                          <div className="font-medium text-slate-800 flex items-center gap-2">
                            {p.title}
                            {p.bim_element_ids?.length > 0 && (
                              <span title={`${p.bim_element_ids.length} Bauteile verknüpft`}>
                                <Boxes className="w-3.5 h-3.5 text-amber-500" />
                              </span>
                            )}
                            {(() => {
                              // Mengen-Modus sichtbar machen — alle VIER Modi, mit Grund.
                              // Ohne diese Anzeige ist nicht erkennbar, ob eine Menge aus
                              // dem Modell kommt, belegt übernommen oder getippt ist.
                              const mode = positionMode(p);
                              const badge = (
                                <span
                                  className={`${MODUS_BADGE[mode] || MODUS_BADGE.manuell} inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium`}
                                  title={
                                    mode === "uebernahme"
                                      ? [
                                        p.ausschluss_grund
                                          ? `Grund: ${AUSSCHLUSS_LABEL[p.ausschluss_grund] || p.ausschluss_grund}`
                                          : null,
                                        p.menge_herkunft?.quelle ? `Herkunft: ${p.menge_herkunft.quelle}` : null,
                                        p.menge_herkunft?.quell_oz ? `Quell-OZ: ${p.menge_herkunft.quell_oz}` : null,
                                        p.menge_herkunft?.lv_datum ? `Stand: ${p.menge_herkunft.lv_datum}` : null,
                                      ].filter(Boolean).join(" · ") || undefined
                                      : mode === "handeingabe"
                                        ? p.handeingabe_grund || undefined
                                        : undefined
                                  }
                                >
                                  {MODUS_LABEL[mode] || mode}
                                </span>
                              );

                              if (mode === "filter") {
                                const f = (filters || []).find((x) => x.id === p.filter_ref);
                                const treffer = f ? filterTreffer(elements || [], f) : 0;
                                return (
                                  <>
                                    {badge}
                                    <span title={f ? `Filter: ${f.name}` : "Filter nicht gefunden"}>
                                      <FilterIcon className="w-3.5 h-3.5 text-amber-500" />
                                    </span>
                                    {treffer === 0 && (
                                      <Badge
                                        className="bg-amber-100 text-amber-800 gap-1"
                                        title="Filter trifft kein Bauteil — Baustoff/Klassifizierung im Modell fehlt?"
                                      >
                                        <AlertTriangle className="w-3 h-3" /> 0 Treffer
                                      </Badge>
                                    )}
                                  </>
                                );
                              }
                              if (mode === "uebernahme") {
                                return (
                                  <>
                                    {badge}
                                    {p.ausschluss_grund && (
                                      <span className="text-[11px] text-slate-400">
                                        {AUSSCHLUSS_LABEL[p.ausschluss_grund] || p.ausschluss_grund}
                                      </span>
                                    )}
                                  </>
                                );
                              }
                              return badge;
                            })()}
                          </div>
                          <div className="text-xs text-slate-400">{p.short_text} · {dinLabel(p.din276, dinKatalog)}</div>
                        </td>
                        <td className="py-2 px-3 text-right tabular-nums">{num(p.quantity)}</td>
                        <td className="py-2 px-3 text-slate-500">{p.unit}</td>
                        <td className="py-2 px-3 text-right tabular-nums">{eur(p.unit_price)}</td>
                        <td className="py-2 px-3 text-right tabular-nums font-semibold">{eur(gp(p))}</td>
                        {/* Clicks here must not reach the row, which selects the
                            position for the price stack below the table. */}
                        <td className="py-2 px-3" onClick={(e) => e.stopPropagation()}>
                          <div className="flex flex-wrap items-center justify-end gap-1">
                            {loeschFrage === p.id && (
                              <div
                                role="group"
                                aria-label={t("Löschen von Position {oz} bestätigen").replace("{oz}", p.oz || "")}
                                className="flex items-center gap-2 rounded-md bg-rose-50 px-2 py-1 text-xs text-rose-800"
                                onKeyDown={(e) => {
                                  if (e.key === "Escape") {
                                    e.stopPropagation();
                                    frageAbbrechen();
                                  }
                                }}
                              >
                                <span className="font-medium whitespace-nowrap">{t("Wirklich löschen?")}</span>
                                <button
                                  type="button"
                                  className={`${kleinerKnopf} border-rose-300 bg-rose-600 text-white hover:bg-rose-700`}
                                  onClick={() => {
                                    setLoeschFrage(null);
                                    onDelete(p.id);
                                  }}
                                >
                                  {t("Ja")}
                                </button>
                                {/* Focus lands on "Nein": the safe answer is the default one. */}
                                <button
                                  type="button"
                                  autoFocus
                                  className={`${kleinerKnopf} border-slate-300 bg-white text-slate-700 hover:bg-slate-50`}
                                  onClick={frageAbbrechen}
                                >
                                  {t("Nein")}
                                </button>
                              </div>
                            )}
                            {onShowDetail && (
                              <button
                                type="button"
                                className={iconKnopf}
                                title={t("Position {oz} Details").replace("{oz}", p.oz || "")}
                                aria-label={t("Position {oz} Details").replace("{oz}", p.oz || "")}
                                onClick={() => onShowDetail(p)}
                              >
                                <FileText className="w-3.5 h-3.5" />
                              </button>
                            )}
                            <button
                              type="button"
                              className={iconKnopf}
                              title={t("Position {oz} bearbeiten").replace("{oz}", p.oz || "")}
                              aria-label={t("Position {oz} bearbeiten").replace("{oz}", p.oz || "")}
                              onClick={() => openEdit(p)}
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              ref={loeschFrage === p.id ? loeschKnopfRef : undefined}
                              className={cn(iconKnopf, "text-rose-500")}
                              title={t("Position {oz} löschen").replace("{oz}", p.oz || "")}
                              aria-label={t("Position {oz} löschen").replace("{oz}", p.oz || "")}
                              aria-expanded={loeschFrage === p.id}
                              onClick={() => setLoeschFrage(p.id)}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          )}
        </Card>
      ))}

      {positions.length > 0 && (
        <Card className="bg-slate-900 text-white">
          <CardContent className="p-4 flex items-center justify-between">
            <span className="text-sm text-slate-300">Kostenanschlag gesamt (netto)</span>
            <span className="text-2xl font-bold">{eur0(total)}</span>
          </CardContent>
        </Card>
      )}

      {showForm && (
        <LVPositionForm
          position={editing}
          defaultTrade={defaultTrade}
          dinKatalog={dinKatalog}
          onSubmit={submit}
          onCancel={() => { setShowForm(false); setEditing(null); }}
        />
      )}
    </div>
  );
}
