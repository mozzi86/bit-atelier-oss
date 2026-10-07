import React, { useState } from "react";
import FormModal from "@core/components/common/FormModal";
import { Button } from "@core/components/ui/button";
import { Input } from "@core/components/ui/input";
import { Label } from "@core/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@core/components/ui/select";
import { Save } from "lucide-react";

const STATUSES = ["active", "in_negotiation", "under_contract", "completed", "cancelled"];

const STATUS_LABELS = {
  active: "Aktiv",
  in_negotiation: "In Verhandlung",
  under_contract: "Unter Vertrag",
  completed: "Abgeschlossen",
  cancelled: "Storniert",
};

export default function LandListingForm({ onSubmit, onCancel }) {
  const [formData, setFormData] = useState({
    title: "",
    address: "",
    city: "",
    land_area: 0,
    asking_price: 0,
    minimum_investment: 0,
    profit_share_percentage: 10,
    status: "active",
  });
  const [saving, setSaving] = useState(false);

  const change = (field, value) =>
    setFormData((prev) => ({ ...prev, [field]: value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    const { address, city, ...rest } = formData;
    await onSubmit({
      ...rest,
      land_area: Number(rest.land_area) || 0,
      asking_price: Number(rest.asking_price) || 0,
      minimum_investment: Number(rest.minimum_investment) || 0,
      profit_share_percentage: Number(rest.profit_share_percentage) || 0,
      location: { address, city },
    });
    setSaving(false);
  };

  const numField = (id, label, placeholder) => (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        step="any"
        value={formData[id]}
        onChange={(e) => change(id, e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );

  return (
    <FormModal title="Grundstück inserieren" onClose={onCancel}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1">
          <Label htmlFor="title">Titel *</Label>
          <Input
            id="title"
            value={formData.title}
            onChange={(e) => change("title", e.target.value)}
            placeholder="z. B. Gewerbegrundstück A66"
            required
          />
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label htmlFor="address">Adresse</Label>
            <Input
              id="address"
              value={formData.address}
              onChange={(e) => change("address", e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="city">Stadt</Label>
            <Input
              id="city"
              value={formData.city}
              onChange={(e) => change("city", e.target.value)}
            />
          </div>
          {numField("land_area", "Grundstücksfläche (m²)")}
          {numField("asking_price", "Angebotspreis (€)")}
          {numField("minimum_investment", "Mindestinvestition (€)")}
          {numField("profit_share_percentage", "Gewinnbeteiligung (%)")}
        </div>
        <div className="space-y-1">
          <Label>Status</Label>
          <Select value={formData.status} onValueChange={(v) => change("status", v)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {STATUS_LABELS[s] || s.replace("_", " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onCancel}>
            Abbrechen
          </Button>
          <Button type="submit" disabled={saving}>
            <Save className="w-4 h-4 mr-2" />
            {saving ? "Speichern..." : "Inserat speichern"}
          </Button>
        </div>
      </form>
    </FormModal>
  );
}
