import React, { useState } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Button } from "@core/components/ui/button";
import { Input } from "@core/components/ui/input";
import { Label } from "@core/components/ui/label";
import { Textarea } from "@core/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@core/components/ui/select";
import { Save } from "lucide-react";
import { CATEGORY_LABELS, labelFor } from "./labels";

// Rohwerte der Kategorie (DB-Werte) — Anzeige läuft über CATEGORY_LABELS.
const CATEGORIES = ["client", "engineer", "consultant", "manufacturer", "contractor", "internal"];

export default function ContactForm({ contact, onSubmit, onCancel }) {
  const [formData, setFormData] = useState(contact || {
    name: "",
    role: "",
    company: "",
    email: "",
    phone: "",
    category: "client",
    notes: ""
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(formData);
  };

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
    >
      <Card className="border-0 shadow-xl bg-white/90 backdrop-blur-sm">
        <CardHeader className="border-b">
          <CardTitle>{contact ? "Kontakt bearbeiten" : "Neuer Kontakt"}</CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label htmlFor="name">Name *</Label>
                <Input id="name" value={formData.name} onChange={(e) => handleChange('name', e.target.value)} required />
              </div>
              <div className="space-y-1">
                <Label htmlFor="email">E-Mail *</Label>
                <Input id="email" type="email" value={formData.email} onChange={(e) => handleChange('email', e.target.value)} required />
              </div>
              <div className="space-y-1">
                <Label htmlFor="company">Firma</Label>
                <Input id="company" value={formData.company} onChange={(e) => handleChange('company', e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="role">Funktion</Label>
                <Input id="role" value={formData.role} onChange={(e) => handleChange('role', e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="phone">Telefon</Label>
                <Input id="phone" value={formData.phone} onChange={(e) => handleChange('phone', e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Kategorie</Label>
                <Select value={formData.category} onValueChange={(v) => handleChange('category', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map(cat => (
                      <SelectItem key={cat} value={cat}>{labelFor(CATEGORY_LABELS, cat)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="notes">Notizen</Label>
              <Textarea id="notes" value={formData.notes} onChange={(e) => handleChange('notes', e.target.value)} />
            </div>
            <div className="flex justify-end gap-2 pt-4">
              <Button type="button" variant="ghost" onClick={onCancel}>Abbrechen</Button>
              <Button type="submit"><Save className="w-4 h-4 mr-2"/>Kontakt speichern</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </motion.div>
  );
}