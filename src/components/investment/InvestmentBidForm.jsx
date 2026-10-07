import React, { useState } from "react";
import FormModal from "@core/components/common/FormModal";
import { Button } from "@core/components/ui/button";
import { Input } from "@core/components/ui/input";
import { Label } from "@core/components/ui/label";
import { Textarea } from "@core/components/ui/textarea";
import { Gavel } from "lucide-react";

export default function InvestmentBidForm({ listing, onSubmit, onCancel }) {
  const [formData, setFormData] = useState({
    investment_amount: listing?.minimum_investment || 0,
    proposed_profit_share: listing?.profit_share_percentage || 10,
    message: "",
    status: "pending",
  });
  const [saving, setSaving] = useState(false);

  const change = (field, value) =>
    setFormData((prev) => ({ ...prev, [field]: value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    await onSubmit({
      ...formData,
      investment_amount: Number(formData.investment_amount) || 0,
      proposed_profit_share: Number(formData.proposed_profit_share) || 0,
    });
    setSaving(false);
  };

  return (
    <FormModal title={`Gebot abgeben — ${listing?.title || ""}`} onClose={onCancel}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {listing && (
          <div className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600 grid grid-cols-2 gap-2">
            <div>
              Angebotspreis:{" "}
              <span className="font-semibold text-slate-800">
                {Number(listing.asking_price).toLocaleString("de-DE")} €
              </span>
            </div>
            <div>
              Mindestinvestition:{" "}
              <span className="font-semibold text-slate-800">
                {Number(listing.minimum_investment).toLocaleString("de-DE")} €
              </span>
            </div>
          </div>
        )}
        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label htmlFor="amount">Investitionsbetrag (€) *</Label>
            <Input
              id="amount"
              type="number"
              step="any"
              min={listing?.minimum_investment || 0}
              value={formData.investment_amount}
              onChange={(e) => change("investment_amount", e.target.value)}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="share">Vorgeschlagene Gewinnbeteiligung (%)</Label>
            <Input
              id="share"
              type="number"
              step="any"
              value={formData.proposed_profit_share}
              onChange={(e) => change("proposed_profit_share", e.target.value)}
            />
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="msg">Nachricht an den Eigentümer</Label>
          <Textarea
            id="msg"
            value={formData.message}
            onChange={(e) => change("message", e.target.value)}
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onCancel}>
            Abbrechen
          </Button>
          <Button type="submit" disabled={saving}>
            <Gavel className="w-4 h-4 mr-2" />
            {saving ? "Senden..." : "Gebot abgeben"}
          </Button>
        </div>
      </form>
    </FormModal>
  );
}
