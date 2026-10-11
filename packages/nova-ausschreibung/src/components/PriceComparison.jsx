import React, { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Button } from "@core/components/ui/button";
import { Badge } from "@core/components/ui/badge";
import { Input } from "@core/components/ui/input";
import { Label } from "@core/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@core/components/ui/select";
import FormModal from "@core/components/common/FormModal";
import { Plus, Gavel, Award, Download, TrendingDown, FileUp, ClipboardCheck, FileText } from "lucide-react";
// 90-03: import a bidder's GAEB offer (X84) instead of typing the prices.
import AngebotImportDialog from "./AngebotImportDialog";
// 90-04: deterministic offer check (quantity × EP = GP, sums, missing/0,00 € prices) + Prüfvermerk.
import AngebotPruefungDialog from "./AngebotPruefungDialog";
import { angebotPruefen, pruefStatus } from "@ava/lib/angebotPruefung";
import { useI18n } from "@core/lib/i18n";
// 90-05: award proposal (ranking, justification blocks, proposal + contract LV as PDF drafts).
import VergabevorschlagDialog from "./VergabevorschlagDialog";
// 90-06: fill a blank VHB form (user's own folder) as a draft, with a mandatory check step.
import VhbFormularDialog from "./VhbFormularDialog";
import { eur, eur0, num, gp, bidUnitPrice, bidTotal, BID_STATUS, toCsv, downloadCsv } from "./avaUtils";
import { benchmarkFor, korridorText } from "@ava/lib/priceReference";

// Quelle-Label für den Marktkontext-Block (Attribution je Zahl, 2011/833/EU).
const SOURCE_LABELS = { ted: "TED (© EU)", doee: "DÖE (CC0)", demo: "Demo" };
const deDate = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("de-DE");
};

// Grauer First-Class-Zustand: fehlende Referenz ist kein Fehler — nie 0,00 € rendern.
const NoBenchmarkBadge = ({ reason }) => (
  <Badge className="bg-slate-100 text-slate-500 font-normal whitespace-normal">
    Kein Referenzpreis (n=0) — Grund: {reason || "zu wenige Zuschläge (n < 5)"}. Quelle abrufen
    oder Demo-Daten laden (Panel unten).
  </Badge>
);

// Preisspiegel: compare bids per position, mark the cheapest, award the contract.
export default function PriceComparison({
  tender, positions, bids, contacts, onCreateBid, onUpdateBid, onAward, priceRefs = [], projekt = null, onUpdateTender,
}) {
  const { t } = useI18n();
  const [showVergabe, setShowVergabe] = useState(false);
  const [showVhb, setShowVhb] = useState(false);
  const [showBid, setShowBid] = useState(false);
  const [showImport, setShowImport] = useState(false);
  // Doppel-Submit-Schutz (HI-03): Button während laufendem await deaktivieren.
  const [busy, setBusy] = useState(false);
  const [pruefBidId, setPruefBidId] = useState(/** @type {string|null} */ (null));

  const tps = useMemo(
    () => positions
      .filter((p) => tender?.position_ids?.includes(p.id))
      .sort((a, b) => (a.oz || "").localeCompare(b.oz || "", "de", { numeric: true })),
    [positions, tender]
  );
  const tenderBids = bids.filter((b) => b.tender_id === tender?.id);
  const estimateTotal = tps.reduce((s, p) => s + gp(p), 0);

  // cheapest unit price per position
  const minByPos = {};
  for (const p of tps) {
    const prices = tenderBids.map((b) => bidUnitPrice(b, p.id)).filter((v) => v != null);
    minByPos[p.id] = prices.length ? Math.min(...prices) : null;
  }
  const totals = tenderBids.map((b) => ({ bid: b, total: bidTotal(b, tps) }));
  // 90-04: live check of every bid — marks cells and shows whether a stored Prüfvermerk is still valid.
  const pruefung = Object.fromEntries(tenderBids.map((b) => {
    const erg = angebotPruefen({ bid: b, positionen: tps, andere: tenderBids });
    return [b.id, { erg, status: pruefStatus(b, erg), codes: Object.fromEntries(erg.zeilen.map((z) => [z.position_id, z.codes])) }];
  }));
  // 90-04: only COMPLETE offers compete for "cheapest" — an offer with missing prices is cheap by omission.
  const vollstaendige = totals.filter((x) => pruefung[x.bid.id]?.erg.vollstaendig);
  const minTotal = vollstaendige.length ? Math.min(...vollstaendige.map((x) => x.total)) : null;

  // Phase 28: Marktkontext Losebene — bewusst getrennt vom Preisspiegel,
  // damit Lossummen nie als Einheitspreise gelesen werden.
  const trade = tps[0]?.trade || tender?.trade || "Sonstige";
  const bm = benchmarkFor(priceRefs, { trade, region: undefined, year: new Date().getFullYear() });
  const bmText = bm.cell ? korridorText(bm.cell) : null;
  const inKorridor = bmText && minTotal != null && bm.cell.n >= 20
    ? (bm.cell.q1 <= minTotal && minTotal <= bm.cell.q3)
    : null;

  // --- bid form ---
  const invited = contacts.filter((c) => tender?.invited_contact_ids?.includes(c.id));
  const others = contacts.filter((c) => ["contractor", "manufacturer", "engineer"].includes(c.category) && !tender?.invited_contact_ids?.includes(c.id));
  const [contactId, setContactId] = useState("");
  const [prices, setPrices] = useState({});
  const [note, setNote] = useState("");
  const [summeBieter, setSummeBieter] = useState("");

  const openBid = () => {
    setContactId(invited[0]?.id || others[0]?.id || "");
    setPrices(Object.fromEntries(tps.map((p) => [p.id, ""])));
    setNote("");
    setSummeBieter("");
    setShowBid(true);
  };

  const simulate = () => {
    // plausible offers: estimate EP varied ±12%, indexed by bidder count for spread
    const factor = 0.94 + tenderBids.length * 0.05;
    setPrices(Object.fromEntries(tps.map((p) => [p.id, Math.round((p.unit_price || 0) * factor * 100) / 100])));
  };

  const submitBid = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const c = contacts.find((x) => x.id === contactId);
      // 90-04 (Befund 90-03): an empty EP field stays MISSING — it used to be written as 0, an invented
      // zero price that made the bidder cheaper. A typed "0" is a real 0,00 € and stays (flagged by the check).
      const gefuellt = (v) => String(v ?? "").trim() !== "" && Number.isFinite(Number(v));
      const lineItems = tps.filter((p) => gefuellt(prices[p.id])).map((p) => ({ position_id: p.id, unit_price: Number(prices[p.id]) }));
      const fehlend = tps.length - lineItems.length;
      await onCreateBid({
      tender_id: tender.id,
      project_id: tender.project_id,
      contact_id: contactId,
      bidder_name: c?.company || c?.name || "Bieter",
      submitted_date: new Date().toISOString(),
      status: "submitted",
      note: [note.trim(), fehlend ? `${fehlend} Position(en) ohne Preis` : ""].filter(Boolean).join(" · "),
      // The bidder's own total from the offer letter (optional) — the check compares it with the recomputed sum.
      angebotssumme_bieter: gefuellt(summeBieter) ? Number(summeBieter) : null,
        line_items: lineItems,
      });
      setShowBid(false);
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = () => {
    const header = ["OZ", "Position", "Menge", "Einheit", "Kostenanschlag EP", ...tenderBids.map((b) => b.bidder_name)];
    const rows = tps.map((p) => [
      p.oz, p.title, p.quantity, p.unit, p.unit_price,
      ...tenderBids.map((b) => bidUnitPrice(b, p.id) ?? ""),
    ]);
    rows.push(["", "Angebotssumme", "", "", estimateTotal.toFixed(2), ...totals.map((t) => t.total.toFixed(2))]);
    downloadCsv(`preisspiegel_${tender.name}.csv`, toCsv(header, rows));
  };

  if (!tender) {
    return (
      <Card><CardContent className="p-8 text-center text-slate-400">
        Wähle im Reiter „Ausschreibung" eine Ausschreibung, um den Preisspiegel zu öffnen.
      </CardContent></Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-slate-800">Preisspiegel — {tender.name}</h3>
          <p className="text-sm text-slate-500">{tps.length} Positionen · {tenderBids.length} Angebote · Kostenanschlag {eur0(estimateTotal)}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportCsv} disabled={!tenderBids.length}>
            <Download className="w-4 h-4 mr-2" /> Export
          </Button>
          <Button variant="outline" onClick={() => setShowImport(true)} disabled={!tps.length} data-testid="pv-gaeb-import">
            <FileUp className="w-4 h-4 mr-2" /> GAEB-Angebot importieren
          </Button>
          <Button variant="outline" onClick={() => setShowVergabe(true)} disabled={!tenderBids.length || !onUpdateTender} data-testid="pv-vergabe">
            <FileText className="w-4 h-4 mr-2" /> {t("Vergabevorschlag")}
          </Button>
          <Button variant="outline" onClick={() => setShowVhb(true)} disabled={!onUpdateTender} data-testid="pv-vhb">
            <FileText className="w-4 h-4 mr-2" /> {t("VHB-Formular")}
          </Button>
          <Button onClick={openBid} className="bg-gradient-to-r from-emerald-600 to-teal-600">
            <Plus className="w-4 h-4 mr-2" /> Angebot erfassen
          </Button>
        </div>
      </div>

      {/* Marktvergleich Losebene (Phase 28) — nie €/Einheit, keine EP-Vorbelegung */}
      <div className="bg-blue-50/50 border border-blue-100 rounded-lg p-3 italic text-sm text-blue-900">
        {bmText ? (
          <span>
            Marktvergleich Losebene · CPV {bm.cell.cpv_group}xxxx {bm.cell.cpv_label}: {bmText} ·{" "}
            {bm.cell.region} {bm.cell.year} · Quelle {SOURCE_LABELS[bm.cell.source] || bm.cell.source},
            Stand {deDate(bm.cell.fetched_at)} — kein Einheitspreis
            {inKorridor !== null && (
              inKorridor ? (
                <Badge className="bg-emerald-100 text-emerald-800 ml-2 not-italic">im Korridor</Badge>
              ) : (
                <Badge
                  className="bg-slate-100 text-slate-600 ml-2 not-italic"
                  title="Losgrößen streuen stark — nur Plausibilitätshinweis"
                >
                  außerhalb Q1–Q3
                </Badge>
              )
            )}
          </span>
        ) : (
          <NoBenchmarkBadge reason={bm.reason} />
        )}
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400 border-b">
                <th className="py-2 px-3">OZ</th>
                <th className="py-2 px-3">Position</th>
                <th className="py-2 px-3 text-right">Menge</th>
                <th className="py-2 px-3 text-right">Anschlag EP</th>
                {tenderBids.map((b) => (
                  <th key={b.id} className="py-2 px-3 text-right">
                    <div className="font-medium text-slate-700">{b.bidder_name}</div>
                    <Badge className={`${(BID_STATUS[b.status] || {}).color} text-[10px]`}>{(BID_STATUS[b.status] || {}).label}</Badge>
                    <PruefKnopf pr={pruefung[b.id]} t={t} onClick={() => setPruefBidId(b.id)} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tps.map((p) => (
                <tr key={p.id} className="border-b last:border-0 hover:bg-slate-50">
                  <td className="py-2 px-3 font-mono text-xs text-slate-500">{p.oz}</td>
                  <td className="py-2 px-3">
                    <div className="font-medium text-slate-800">{p.title}</div>
                    <div className="text-xs text-slate-400">{num(p.quantity)} {p.unit}</div>
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums text-slate-500">{num(p.quantity)}</td>
                  <td className="py-2 px-3 text-right tabular-nums">{eur(p.unit_price)}</td>
                  {tenderBids.map((b) => {
                    const up = bidUnitPrice(b, p.id);
                    const isMin = up != null && minByPos[p.id] != null && up === minByPos[p.id] && tenderBids.length > 1;
                    const codes = pruefung[b.id]?.codes[p.id] || [];
                    // 0,00 €, arithmetic findings and outliers get a ring; a missing price shows "—" in red.
                    const auffaellig = codes.some((c) => c !== "ohne_preis");
                    return (
                      <td key={b.id} title={codes.length ? codes.join(", ") : undefined}
                        className={`py-2 px-3 text-right tabular-nums ${isMin ? "bg-emerald-50 font-semibold text-emerald-700" : ""} ${auffaellig ? "ring-1 ring-inset ring-amber-300" : ""}`}>
                        {up != null ? eur(up) : <span className="text-rose-600">—</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 font-semibold">
                <td className="py-2 px-3" colSpan={3}>Angebotssumme (netto)</td>
                <td className="py-2 px-3 text-right tabular-nums text-slate-500">{eur0(estimateTotal)}</td>
                {totals.map(({ bid, total }) => {
                  const isMin = total === minTotal && totals.length > 1 && !!pruefung[bid.id]?.erg.vollstaendig;
                  return (
                    <td key={bid.id} className={`py-2 px-3 text-right tabular-nums ${isMin ? "text-emerald-700" : ""}`}>
                      {isMin && <TrendingDown className="inline w-3.5 h-3.5 mr-1" />}{eur0(total)}
                      {!pruefung[bid.id]?.erg.vollstaendig && (
                        <div className="text-[10px] font-normal text-rose-600" data-testid="pv-unvollstaendig">
                          {pruefung[bid.id]?.erg.zaehler.ohne_preis} {t("ohne Preis")}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
              <tr>
                <td colSpan={4}></td>
                {tenderBids.map((b) => (
                  <td key={b.id} className="py-2 px-3 text-right">
                    {b.status === "awarded" ? (
                      <Badge className="bg-emerald-100 text-emerald-800"><Award className="w-3 h-3 mr-1" /> Zuschlag</Badge>
                    ) : tender.status !== "awarded" ? (
                      <Button size="sm" variant="outline" onClick={() => onAward(tender, b)}>
                        <Gavel className="w-3.5 h-3.5 mr-1" /> Zuschlag
                      </Button>
                    ) : null}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </CardContent>
      </Card>

      {showImport && (
        <AngebotImportDialog tender={tender} tps={tps} contacts={contacts} onCreateBid={onCreateBid} onClose={() => setShowImport(false)} />
      )}

      {showVhb && (
        <VhbFormularDialog tender={tender} bids={tenderBids} contacts={contacts} projekt={projekt}
          onUpdateTender={onUpdateTender} onClose={() => setShowVhb(false)} />
      )}

      {showVergabe && (
        <VergabevorschlagDialog tender={tender} tps={tps} bids={tenderBids} projekt={projekt}
          onUpdateTender={onUpdateTender} onClose={() => setShowVergabe(false)} />
      )}

      {pruefBidId && tenderBids.some((b) => b.id === pruefBidId) && (
        <AngebotPruefungDialog tender={tender} bid={tenderBids.find((b) => b.id === pruefBidId)} tps={tps} andere={tenderBids}
          onUpdateBid={onUpdateBid} onClose={() => setPruefBidId(null)} />
      )}

      {showBid && (
        <FormModal title="Angebot erfassen" onClose={() => setShowBid(false)}>
          <form onSubmit={submitBid} className="space-y-4">
            <div className="flex items-end gap-3">
              <div className="flex-1">
                <Label className="text-xs">Bieter</Label>
                <Select value={contactId} onValueChange={setContactId}>
                  <SelectTrigger><SelectValue placeholder="Bieter…" /></SelectTrigger>
                  <SelectContent>
                    {invited.length > 0 && invited.map((c) => <SelectItem key={c.id} value={c.id}>★ {c.company || c.name}</SelectItem>)}
                    {others.map((c) => <SelectItem key={c.id} value={c.id}>{c.company || c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <Button type="button" variant="outline" onClick={simulate}>Plausibel ausfüllen</Button>
            </div>
            <div className="max-h-64 overflow-y-auto space-y-2">
              {tps.map((p) => (
                <div key={p.id} className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{p.oz} · {p.title}</div>
                    <div className="text-xs text-slate-400">{num(p.quantity)} {p.unit} · Anschlag {eur(p.unit_price)}</div>
                  </div>
                  <div className="w-32">
                    <Input type="number" step="any" placeholder="EP" value={prices[p.id] ?? ""}
                      onChange={(e) => setPrices((pr) => ({ ...pr, [p.id]: e.target.value }))} />
                  </div>
                </div>
              ))}
            </div>
            <div>
              <Label className="text-xs">Bemerkung</Label>
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="z.B. Nachlass, Lieferzeit…" />
            </div>
            <div>
              <Label className="text-xs">{t("Angebotssumme laut Bieter (netto, optional)")}</Label>
              <Input type="number" step="any" value={summeBieter} onChange={(e) => setSummeBieter(e.target.value)} data-testid="pv-summe-bieter" />
              <div className="mt-1 text-[11px] text-slate-400">{t("Leere EP-Felder bleiben leer (kein Preis) — sie werden nicht als 0 gespeichert.")}</div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setShowBid(false)}>Abbrechen</Button>
              <Button type="submit" disabled={!contactId || busy} className="bg-gradient-to-r from-emerald-600 to-teal-600">{busy ? "Speichern…" : "Angebot speichern"}</Button>
            </div>
          </form>
        </FormModal>
      )}
    </div>
  );
}

/**
 * 90-04: "Prüfen" button in a bid's column header with the state of its Prüfvermerk
 * (none / current / outdated) and the finding count of the live check.
 * @param {{pr: {erg: ReturnType<typeof angebotPruefen>, status: "keine"|"aktuell"|"veraltet"}|undefined, t: (k: string) => string, onClick: () => void}} props
 */
function PruefKnopf({ pr, t, onClick }) {
  if (!pr) return null;
  const { erg, status } = pr;
  const farbe = status === "aktuell" ? (erg.befunde ? "text-rose-700" : "text-emerald-700") : status === "veraltet" ? "text-amber-700" : "text-slate-500";
  const text = status === "aktuell" ? t("geprüft") : status === "veraltet" ? t("Prüfung veraltet") : t("prüfen");
  return (
    <button type="button" onClick={onClick} className={`mt-1 flex w-full items-center justify-end gap-1 text-[10px] hover:underline ${farbe}`}
      data-testid="pv-pruefen" data-status={status} data-befunde={erg.befunde}>
      <ClipboardCheck className="h-3 w-3" /> {text}{erg.befunde ? ` · ${erg.befunde} ${t("Befund(e)")}` : ""}
    </button>
  );
}
