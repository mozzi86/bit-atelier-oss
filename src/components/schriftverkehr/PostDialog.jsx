// Dialog of incoming mail (phase 82, 82-05): date, partner (address book or
// free), subject, channel, sender's reference, reply deadline, person in
// charge, area/project, scan upload (at most 5 MB, plain-text message above).
// The number is given on saving (next free PE number, re-checked). Unsaved
// input is protected (FormModal).
//
// In:  props eintrag (stored or null), kontakte, projekte, nutzer, bereiche, heute, onSpeichern, onClose. Out: the dialog.

import React, { useState } from "react";
import FormModal from "@core/components/common/FormModal";
import { Button } from "@core/components/ui/button";
import { Input } from "@core/components/ui/input";
import { useI18n } from "@core/lib/i18n";
import { fileToDataUrl } from "@core/lib/pdf";
import { BEREICHE, POST_KANAL } from "@core/lib/brief/status.js";
import { SCAN_MAX_BYTES } from "@/lib/schriftverkehr/aktionen.js";

/**
 * @param {{
 *   eintrag: Record<string, any>|null, kontakte: any[], projekte: Array<{id: string, name?: string}>, nutzer: any[], bereiche: string[],
 *   heute: string, aktivesProjekt: string|null,
 *   onSpeichern: (e: Record<string, any>, scan: {name: string, dataUrl: string, bytes: number}|null) => Promise<boolean>,
 *   onClose: () => void,
 * }} props
 * @returns {React.ReactElement}
 */
export default function PostDialog({ eintrag, kontakte, projekte, nutzer, bereiche, heute, aktivesProjekt, onSpeichern, onClose }) {
  const { t } = useI18n();
  const [f, setF] = useState(/** @type {Record<string, any>} */ ({
    datum: heute, partner_contact_id: null, partner_name: "", betreff: "", kanal: "brief", ihr_zeichen: "", unser_zeichen: "", frist: "", zustaendig: "",
    bereich: aktivesProjekt ? "projekt" : "buero", project_id: aktivesProjekt, notiz: "", erledigt_am: null, document_id: null, schreiben_id: null,
    ...(eintrag || {}),
  }));
  const [scan, setScan] = useState(/** @type {{name: string, dataUrl: string, bytes: number}|null} */ (null));
  const [scanFehler, setScanFehler] = useState("");
  const [busy, setBusy] = useState(false);
  const setze = (/** @type {string} */ k, /** @type {any} */ v) => setF((x) => ({ ...x, [k]: v }));
  const fertig = /^\d{4}-\d{2}-\d{2}$/.test(f.datum) && String(f.betreff).trim() && String(f.partner_name).trim() && (f.bereich !== "projekt" || f.project_id);

  const datei = async (/** @type {File|undefined} */ d) => {
    setScanFehler("");
    setScan(null);
    if (!d) return;
    if (d.size > SCAN_MAX_BYTES) { setScanFehler(t("Der Scan ist größer als 5 MB.")); return; }
    setScan({ name: d.name, dataUrl: /** @type {string} */ (await fileToDataUrl(d)), bytes: d.size });
  };
  const speichern = async () => {
    setBusy(true);
    try {
      const obj = { ...f, frist: f.frist || null, zustaendig: f.zustaendig || null, project_id: f.bereich === "projekt" ? f.project_id : null };
      if (await onSpeichern(obj, scan)) onClose();
    } finally {
      setBusy(false);
    }
  };
  const feld = "block text-xs text-slate-600 dark:text-slate-300";
  const auswahl = "mt-1 h-9 w-full rounded border border-slate-300 bg-white px-2 dark:border-slate-600 dark:bg-slate-900";
  return (
    <FormModal title={eintrag?.id ? `${t("Posteingang")} ${eintrag.nummer || ""}` : t("Posteingang erfassen")} onClose={onClose} schuetzen>
      <div className="space-y-3 text-sm" data-testid="post-dialog">
        <div className="grid gap-2 sm:grid-cols-2">
          <label className={feld}>{t("Eingangsdatum")}<Input type="date" value={f.datum} onChange={(e) => setze("datum", e.target.value)} data-testid="post-datum" /></label>
          <label className={feld}>{t("Kanal")}
            <select className={auswahl} value={f.kanal} onChange={(e) => setze("kanal", e.target.value)}>
              {Object.entries(POST_KANAL).map(([k, v]) => <option key={k} value={k}>{t(v.label)}</option>)}
            </select>
          </label>
        </div>
        <label className={feld}>{t("Absender aus dem Adressbuch")}
          <select className={auswahl} value={f.partner_contact_id || ""} data-testid="post-kontakt"
            onChange={(e) => { const k = kontakte.find((x) => x.id === e.target.value); setF((x) => ({ ...x, partner_contact_id: k?.id || null, partner_name: k ? k.company || k.name || "" : x.partner_name })); }}>
            <option value="">{t("frei eingeben")}</option>
            {kontakte.map((k) => <option key={k.id} value={k.id}>{[k.company, k.name].filter(Boolean).join(" · ")}</option>)}
          </select>
        </label>
        <label className={feld}>{t("Absender")}<Input value={f.partner_name} onChange={(e) => setze("partner_name", e.target.value)} data-testid="post-partner" /></label>
        <label className={feld}>{t("Betreff")}<Input value={f.betreff} onChange={(e) => setze("betreff", e.target.value)} data-testid="post-betreff" /></label>
        <div className="grid gap-2 sm:grid-cols-3">
          <label className={feld}>{t("Ihr Zeichen")}<Input value={f.ihr_zeichen} onChange={(e) => setze("ihr_zeichen", e.target.value)} /></label>
          <label className={feld}>{t("Antwortfrist")}<Input type="date" value={f.frist || ""} onChange={(e) => setze("frist", e.target.value)} data-testid="post-frist" /></label>
          <label className={feld}>{t("zuständig")}
            <select className={auswahl} value={f.zustaendig || ""} onChange={(e) => setze("zustaendig", e.target.value)}>
              <option value="">—</option>
              {nutzer.map((n) => <option key={n.id} value={n.id}>{n.name || n.kuerzel || n.id}</option>)}
            </select>
          </label>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className={feld}>{t("Bereich")}
            <select className={auswahl} value={f.bereich} onChange={(e) => setze("bereich", e.target.value)} data-testid="post-bereich">
              {bereiche.map((b) => <option key={b} value={b}>{t(/** @type {any} */ (BEREICHE)[b]?.label || b)}</option>)}
            </select>
          </label>
          {f.bereich === "projekt" && (
            <label className={feld}>{t("Projekt")}
              <select className={auswahl} value={f.project_id || ""} onChange={(e) => setze("project_id", e.target.value || null)} data-testid="post-projekt">
                <option value="">{t("Projekt wählen")}</option>
                {projekte.map((p) => <option key={p.id} value={p.id}>{p.name || p.id}</option>)}
              </select>
            </label>
          )}
        </div>
        {!eintrag?.document_id && (
          <label className={feld}>{t("Scan (PDF oder Bild, höchstens 5 MB)")}
            <input type="file" accept="application/pdf,image/*" className="mt-1 block text-sm" onChange={(e) => datei(e.target.files?.[0])} data-testid="post-scan" />
          </label>
        )}
        {scanFehler && <p role="alert" className="text-xs text-rose-700 dark:text-rose-300">{scanFehler}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>{t("Abbrechen")}</Button>
          <Button type="button" disabled={!fertig || busy} onClick={speichern} data-testid="post-speichern">{t("Speichern")}</Button>
        </div>
      </div>
    </FormModal>
  );
}
