// ChangeOrderForm — create or edit a change order (Nachtrag) on the Finance page
// (72-14, N-13).
//
// In:  the active project (a new change order belongs to it; shown, not chosen),
//      optionally the change order to edit, or a prefill for a new one
//      (vorbelegung, e.g. nachtragAusTicket from @core/lib/nachtraege — N-14).
// Out: onSubmit({title, description, cost_impact, submission_date, <review path fields>[, status][, issue_id]})
//      — the page adds project_id/project_name and writes the record.
// 88-03: section "Prüfpfad (VOB/B § 2)" — kind, announcement, demanded/checked/
// released amounts, original-calculation reference (@core/lib/nachtragPruefpfad).
// Once an amount is given, cost_impact is derived from it and the field is read-only.
// Status changes of an existing change order go through the list actions
// (approve/reject), so the edit mode has no status field; a new change order
// starts undecided (pending or in_progress).
import React, { useState } from "react";
import { Link } from "react-router-dom";
import FormModal from "@core/components/common/FormModal";
import { Button } from "@core/components/ui/button";
import { Input } from "@core/components/ui/input";
import { Label } from "@core/components/ui/label";
import { Textarea } from "@core/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@core/components/ui/select";
import { Save } from "lucide-react";
import { useI18n } from "@core/lib/i18n";
import { BEARBEITBARE_STATUS, nachtragStatusLabel } from "@core/lib/nachtraege";
import { ticketUrl } from "@ifc/lib/ticketLink";
import { NACHTRAG_ARTEN, pruefpfadFelder, pruefHinweise, wirksamerBetrag } from "@core/lib/nachtragPruefpfad";

/** Amount (euros or null) → form text. */
const betragText = (v) => (v == null || v === "" ? "" : String(v));

/** yyyy-mm-dd of an ISO timestamp for <input type="date">, today as fallback. */
function tagAus(iso) {
  const d = iso ? new Date(iso) : new Date();
  return Number.isNaN(d.getTime()) ? new Date().toISOString().slice(0, 10) : d.toISOString().slice(0, 10);
}

/**
 * Amount field → euros or null. Empty means "not quantified yet" (null), not 0 €.
 * @param {string|number} roh
 * @returns {number|null} euros
 */
function betragAus(roh) {
  const s = String(roh ?? "").trim();
  if (s === "") return null;
  const zahl = Number(s);
  return Number.isFinite(zahl) ? zahl : null;
}

/**
 * @param {object} props
 * @param {{id: string, name?: string}|null} [props.aktivesProjekt] project a new change order belongs to
 * @param {Record<string, any>|null} [props.nachtrag] change order to edit; absent = create
 * @param {{title?: string, description?: string, issue_id?: string|null,
 *   cost_impact?: number|null, ticket_titel?: string}|null} [props.vorbelegung]
 *   prefill of a new change order (ignored in edit mode); cost_impact in euros,
 *   ticket_titel only labels the reference line
 * @param {(daten: Record<string, any>) => Promise<void>|void} props.onSubmit
 * @param {() => void} props.onCancel
 */
export default function ChangeOrderForm({ aktivesProjekt = null, nachtrag = null, vorbelegung = null, onSubmit, onCancel }) {
  const { t } = useI18n();
  const bearbeiten = !!nachtrag;
  // Edit mode starts from the stored record, create mode from the prefill (if any).
  const quelle = /** @type {Record<string, any>|null} */ (bearbeiten ? nachtrag : vorbelegung);
  const [formData, setFormData] = useState(() => ({
    title: quelle?.title || "",
    description: quelle?.description || "",
    cost_impact: quelle?.cost_impact == null ? "" : String(quelle.cost_impact),
    status: "pending",
    submission_date: tagAus(nachtrag?.submission_date),
    // 88-03 review path (additive fields; legacy records start empty).
    art: quelle?.art || "",
    angekuendigt_am: quelle?.angekuendigt_am || "",
    ankuendigung_vor_ausfuehrung: quelle?.ankuendigung_vor_ausfuehrung === true ? "ja"
      : quelle?.ankuendigung_vor_ausfuehrung === false ? "nein" : "",
    betrag_gefordert: betragText(quelle?.betrag_gefordert),
    betrag_geprueft: betragText(quelle?.betrag_geprueft),
    betrag_freigegeben: betragText(quelle?.betrag_freigegeben),
    urkalkulation_ref: quelle?.urkalkulation_ref || "",
  }));
  const [saving, setSaving] = useState(false);

  // Edit mode shows the change order's own project (it may be a foreign one in
  // the "all projects" view); create mode the active project.
  const projektName = bearbeiten ? nachtrag.project_name : aktivesProjekt?.name;
  const ohneProjekt = !bearbeiten && !aktivesProjekt;
  // Ticket the change order refers to. In edit mode it is kept by the merge update
  // (the payload leaves issue_id out), in create mode it is written with the record.
  const issueId = quelle?.issue_id || null;
  const ticketTitel = bearbeiten ? "" : vorbelegung?.ticket_titel || "";

  const change = (field, value) =>
    setFormData((prev) => ({ ...prev, [field]: value }));

  // Status the record will have after saving — decides the effective amount.
  const zielStatus = bearbeiten ? nachtrag.status : formData.status;
  const pfad = pruefpfadFelder(formData, zielStatus);
  const abgeleitet = Object.prototype.hasOwnProperty.call(pfad, "cost_impact");
  const hinweise = pruefHinweise({ ...pfad, status: zielStatus });

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (ohneProjekt) return;
    setSaving(true);
    try {
      const daten = {
        title: formData.title.trim(),
        description: formData.description,
        cost_impact: betragAus(formData.cost_impact),
        // Review path last: its derived cost_impact (if any) overrides the field.
        ...pfad,
        submission_date: formData.submission_date
          ? new Date(formData.submission_date).toISOString()
          : (nachtrag?.submission_date || new Date().toISOString()),
      };
      if (bearbeiten) await onSubmit(daten);
      else await onSubmit({ ...daten, status: formData.status, ...(issueId ? { issue_id: issueId } : {}) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormModal title={bearbeiten ? t("Nachtrag bearbeiten") : t("Neuer Nachtrag")} onClose={onCancel}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {issueId && (
          <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700" data-testid="nachtrag-bezug">
            {t("Bezug:")}{" "}
            <Link to={ticketUrl(issueId)} className="font-medium text-blue-700 underline-offset-4 hover:underline">
              {ticketTitel ? t("Ticket „{titel}“").replace("{titel}", ticketTitel) : t("Ticket öffnen")}
            </Link>
          </p>
        )}
        <div className="space-y-1">
          <Label htmlFor="nachtrag-titel">{t("Titel")} *</Label>
          <Input
            id="nachtrag-titel"
            value={formData.title}
            onChange={(e) => change("title", e.target.value)}
            placeholder={t("z. B. Zusätzliche Tiefgaragenstellplätze")}
            required
            autoFocus
          />
        </div>

        <div className="space-y-1">
          <p className="text-sm font-medium leading-none">{t("Projekt")}</p>
          {projektName ? (
            <p className="text-sm text-slate-700" data-testid="nachtrag-projekt">{projektName}</p>
          ) : (
            <p className="text-sm text-amber-700" role="alert">
              {t("Kein aktives Projekt – bitte wählen Sie oben in der Kopfzeile ein Projekt.")}
            </p>
          )}
          {!bearbeiten && projektName && (
            <p className="text-xs text-slate-500">
              {t("Der Nachtrag wird dem aktiven Projekt zugeordnet. Ein anderes Projekt wählen Sie oben in der Kopfzeile.")}
            </p>
          )}
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label htmlFor="nachtrag-kosten">{t("Kostenwirkung (€)")}</Label>
            <Input
              id="nachtrag-kosten"
              type="number"
              step="any"
              value={abgeleitet ? betragText(wirksamerBetrag({ ...pfad, status: zielStatus })) : formData.cost_impact}
              onChange={(e) => change("cost_impact", e.target.value)}
              placeholder={t("leer = noch nicht beziffert, negativ = Einsparung")}
              readOnly={abgeleitet}
            />
            {abgeleitet && (
              <p className="text-xs text-slate-500">{t("Folgt dem Prüfpfad (freigegeben, sonst geprüft, sonst gefordert).")}</p>
            )}
          </div>
          {bearbeiten ? (
            <div className="space-y-1">
              <p className="text-sm font-medium leading-none">{t("Status")}</p>
              <p className="text-sm text-slate-700">{t(nachtragStatusLabel(nachtrag.status))}</p>
              <p className="text-xs text-slate-500">
                {t("Über Genehmigen oder Ablehnen entscheiden Sie in der Liste.")}
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              <Label htmlFor="nachtrag-status">{t("Status")}</Label>
              <Select
                value={formData.status}
                onValueChange={(v) => change("status", v)}
              >
                <SelectTrigger id="nachtrag-status" aria-label={t("Status")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BEARBEITBARE_STATUS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {t(nachtragStatusLabel(s))}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor="nachtrag-datum">{t("Einreichungsdatum")}</Label>
            <Input
              id="nachtrag-datum"
              type="date"
              value={formData.submission_date}
              onChange={(e) => change("submission_date", e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-1">
          <Label htmlFor="nachtrag-beschreibung">{t("Beschreibung")}</Label>
          <Textarea
            id="nachtrag-beschreibung"
            value={formData.description}
            onChange={(e) => change("description", e.target.value)}
          />
        </div>


        <fieldset className="space-y-3 rounded-md border border-slate-200 p-3" data-testid="nachtrag-pruefpfad">
          <legend className="px-1 text-sm font-medium">{t("Prüfpfad (VOB/B § 2)")}</legend>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label htmlFor="nachtrag-art">{t("Art des Nachtrags")}</Label>
              <select id="nachtrag-art" className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
                value={formData.art} onChange={(e) => change("art", e.target.value)}>
                <option value="">{t("— nicht zugeordnet —")}</option>
                {NACHTRAG_ARTEN.map((a) => (
                  <option key={a.key} value={a.key}>{t(a.label)}{a.quelle ? ` (${a.quelle})` : ""}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="nachtrag-urkalkulation">{t("Bezug Urkalkulation / Vertragsposition")}</Label>
              <Input id="nachtrag-urkalkulation" value={formData.urkalkulation_ref}
                onChange={(e) => change("urkalkulation_ref", e.target.value)}
                placeholder={t("z. B. Urkalkulation Pos. 02.0010")} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="nachtrag-angekuendigt">{t("Angekündigt am")}</Label>
              <Input id="nachtrag-angekuendigt" type="date" value={formData.angekuendigt_am}
                onChange={(e) => change("angekuendigt_am", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="nachtrag-vor-ausfuehrung">{t("Ankündigung vor Ausführung?")}</Label>
              <select id="nachtrag-vor-ausfuehrung" className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
                value={formData.ankuendigung_vor_ausfuehrung} onChange={(e) => change("ankuendigung_vor_ausfuehrung", e.target.value)}>
                <option value="">{t("unbekannt")}</option>
                <option value="ja">{t("ja")}</option>
                <option value="nein">{t("nein")}</option>
              </select>
            </div>
          </div>
          <div className="grid md:grid-cols-3 gap-4">
            <div className="space-y-1">
              <Label htmlFor="nachtrag-gefordert">{t("Gefordert (€ netto)")}</Label>
              <Input id="nachtrag-gefordert" type="number" step="any" value={formData.betrag_gefordert}
                onChange={(e) => change("betrag_gefordert", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="nachtrag-geprueft">{t("Geprüft (€ netto)")}</Label>
              <Input id="nachtrag-geprueft" type="number" step="any" value={formData.betrag_geprueft}
                onChange={(e) => change("betrag_geprueft", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="nachtrag-freigegeben">{t("Freigegeben (€ netto)")}</Label>
              <Input id="nachtrag-freigegeben" type="number" step="any" value={formData.betrag_freigegeben}
                onChange={(e) => change("betrag_freigegeben", e.target.value)} />
            </div>
          </div>
          {hinweise.length > 0 && (
            <ul className="space-y-1 text-xs" data-testid="nachtrag-hinweise">
              {hinweise.map((h) => (
                <li key={h.code} data-stufe={h.stufe} className={h.stufe === "warn" ? "text-amber-700" : "text-slate-600"}>
                  {h.stufe === "warn" ? "⚠ " : "ℹ "}{t(h.text)}
                </li>
              ))}
            </ul>
          )}
        </fieldset>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t("Abbrechen")}
          </Button>
          <Button type="submit" disabled={saving || ohneProjekt}>
            <Save className="w-4 h-4 mr-2" />
            {saving ? t("Speichern…") : t("Nachtrag speichern")}
          </Button>
        </div>
      </form>
    </FormModal>
  );
}
