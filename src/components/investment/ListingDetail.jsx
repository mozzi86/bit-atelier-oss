// Read-only listing dialog of /InvestmentPlatform. Own listings can be edited or deleted from here.
//
// In:  one LandListing, the signed-in user id, status label, callbacks.
// Out: a FormModal. Delete asks inside the dialog (no window.confirm).

import React, { useState } from "react";
import FormModal from "@core/components/common/FormModal";
import { Button } from "@core/components/ui/button";
import { useI18n } from "@core/lib/i18n";
import { ortZeile, zahl } from "@/lib/investment/inserate.js";

/**
 * @param {{ listing: any, userId?: string|null, statusText: string, onClose: () => void, onBid?: () => void, onEdit?: () => void, onDelete?: () => void }} props
 */
export default function ListingDetail({ listing, userId, statusText, onClose, onBid, onEdit, onDelete }) {
  const { t } = useI18n();
  const [loeschenFragen, setLoeschenFragen] = useState(false);
  const eigen = !!(userId && listing?.owner_id === userId);
  const ort = ortZeile(listing);
  const zeile = (label, wert) => (
    <div className="flex justify-between gap-4 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground text-right">{wert}</span>
    </div>
  );

  return (
    <FormModal title={listing?.title || t("Inserat")} onClose={onClose} schuetzen={false}>
      <div className="space-y-3" data-testid="inserat-detail">
        {zeile(t("Ort"), ort || "—")}
        {zeile(t("Status"), statusText || "—")}
        {zeile(t("Grundstücksfläche"), `${zahl(listing?.land_area).toLocaleString("de-DE")} m²`)}
        {zeile(t("Angebotspreis"), `${zahl(listing?.asking_price).toLocaleString("de-DE")} €`)}
        {zeile(t("Mindestinvestition"), `${zahl(listing?.minimum_investment).toLocaleString("de-DE")} €`)}
        {zeile(t("Gewinnbeteiligung"), `${zahl(listing?.profit_share_percentage).toLocaleString("de-DE")} %`)}
        <div className="flex flex-wrap gap-2 pt-2">
          {onBid && (
            <Button type="button" onClick={onBid} data-testid="inserat-detail-gebot">
              {t("Gebot abgeben")}
            </Button>
          )}
          {eigen && onEdit && (
            <Button type="button" variant="outline" onClick={onEdit} data-testid="inserat-detail-bearbeiten">
              {t("Inserat bearbeiten")}
            </Button>
          )}
          {eigen && onDelete && !loeschenFragen && (
            <Button type="button" variant="outline" onClick={() => setLoeschenFragen(true)} data-testid="inserat-detail-loeschen">
              {t("Inserat löschen")}
            </Button>
          )}
        </div>
        {loeschenFragen && (
          <div className="rounded-md border border-border p-3 space-y-2" data-testid="inserat-loeschen-frage">
            <p className="text-sm text-foreground">{t("Wirklich löschen? Das Inserat verschwindet von der Plattform.")}</p>
            <div className="flex gap-2">
              <Button type="button" variant="destructive" onClick={onDelete} data-testid="inserat-loeschen-ja">{t("Löschen")}</Button>
              <Button type="button" variant="outline" onClick={() => setLoeschenFragen(false)}>{t("Abbrechen")}</Button>
            </div>
          </div>
        )}
      </div>
    </FormModal>
  );
}
