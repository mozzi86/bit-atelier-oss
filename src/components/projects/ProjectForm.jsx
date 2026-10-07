import React, { useState } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Button } from "@core/components/ui/button";
import { Input } from "@core/components/ui/input";
import { Label } from "@core/components/ui/label";
import { Textarea } from "@core/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@core/components/ui/select";
import { X, Save } from "lucide-react";
import { TYPE_LABELS, STATUS_LABELS, CLIMATE_ZONE_LABELS, ENERGY_TARGET_LABELS, labelFor } from "./labels";
import { klimazoneAusStandort } from "@core/lib/labels";

const PROJECT_TYPES = [
  "residential", "commercial", "institutional", 
  "mixed_use", "heritage_conservation", "urban_development"
];

const CLIMATE_ZONES = [
  "tropical", "subtropical", "temperate", 
  "continental", "polar", "mediterranean", "arid"
];

const STATUS_OPTIONS = [
  "concept", "design_development", "technical_design", "construction", "completed"
];

const ENERGY_TARGETS = [
  "passive_house", "kfw_55", "kfw_40", "net_zero", "plus_energy"
];

export default function ProjectForm({ project, onSubmit, onCancel }) {
  const [formData, setFormData] = useState(project || {
    name: "",
    type: "",
    location: "",
    climate_zone: "",
    status: "concept",
    hoai_phase: 1,
    energy_target: "",
    building_area: "",
    estimated_cost: "",
    completion_date: "",
    sustainability_rating: "",
    notes: "",
    build_kind: "neubau",
    scan_3d_url: "",
    as_built_url: "",
    existing_building_notes: ""
  });

  const isSanierung = formData.build_kind === "sanierung";

  const handleSubmit = (e) => {
    e.preventDefault();

    // 72-01 A-8 (Befund N-12): Klimazone ist OPTIONAL — bei leerem Wert wird
    // sie aus dem Standort abgeleitet (DE/AT/CH → gemäßigtes Klima). Für einen
    // deutschen Standort musste man das Feld früher von Hand richtig ausfüllen.
    const klimazone = formData.climate_zone || klimazoneAusStandort(formData.location) || "";

    const processedData = {
      ...formData,
      climate_zone: klimazone,
      building_area: formData.building_area ? parseFloat(formData.building_area) : null,
      estimated_cost: formData.estimated_cost ? parseFloat(formData.estimated_cost) : null,
      hoai_phase: parseInt(formData.hoai_phase),
      sustainability_rating: formData.sustainability_rating ? parseFloat(formData.sustainability_rating) : null
    };
    
    onSubmit(processedData);
  };

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.3 }}
    >
      <Card className="border-0 shadow-xl bg-white/90 backdrop-blur-sm">
        <CardHeader className="flex flex-row items-center justify-between border-b border-slate-100">
          <CardTitle className="text-xl font-bold text-slate-800">
            {project ? 'Projekt bearbeiten' : 'Neues Projekt'}
          </CardTitle>
          <Button variant="ghost" size="icon" onClick={onCancel}>
            <X className="w-4 h-4" />
          </Button>
        </CardHeader>
        
        <CardContent className="p-6">
          <form onSubmit={handleSubmit} className="space-y-6">
            
            {/* Basic Information */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label htmlFor="name">Projektname *</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => handleChange('name', e.target.value)}
                  placeholder="Projektname eingeben"
                  required
                  className="border-slate-200 focus:border-emerald-500"
                />
              </div>
              
              <div className="space-y-2">
                <Label>Projekttyp *</Label>
                <Select 
                  value={formData.type} 
                  onValueChange={(value) => handleChange('type', value)}
                  required
                >
                  <SelectTrigger className="border-slate-200 focus:border-emerald-500">
                    <SelectValue placeholder="Projekttyp auswählen" />
                  </SelectTrigger>
                  <SelectContent>
                    {PROJECT_TYPES.map(type => (
                      <SelectItem key={type} value={type}>
                        {labelFor(TYPE_LABELS, type)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="location">Standort *</Label>
                <Input
                  id="location"
                  value={formData.location}
                  onChange={(e) => handleChange('location', e.target.value)}
                  placeholder="Stadt, Land"
                  required
                  className="border-slate-200 focus:border-emerald-500"
                />
              </div>
              
              <div className="space-y-2">
                {/* 72-01 A-8 (Befund N-12): optional — leer wird beim Speichern
                    aus dem Standort abgeleitet (DE/AT/CH → gemäßigt). */}
                <Label>Klimazone</Label>
                <Select 
                  value={formData.climate_zone} 
                  onValueChange={(value) => handleChange('climate_zone', value)}
                >
                  <SelectTrigger className="border-slate-200 focus:border-emerald-500">
                    <SelectValue placeholder="automatisch (DE/AT/CH: gemäßigt)" />
                  </SelectTrigger>
                  <SelectContent>
                    {CLIMATE_ZONES.map(zone => (
                      <SelectItem key={zone} value={zone}>
                        {labelFor(CLIMATE_ZONE_LABELS, zone)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Neubau / Sanierung */}
            <div className="space-y-4 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label>Vorhabentyp *</Label>
                  <Select
                    value={formData.build_kind}
                    onValueChange={(value) => handleChange('build_kind', value)}
                  >
                    <SelectTrigger className="border-slate-200 focus:border-emerald-500">
                      <SelectValue placeholder="Neubau oder Sanierung" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="neubau">Neubau</SelectItem>
                      <SelectItem value="sanierung">Sanierung / Umbau im Bestand</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-slate-500">
                    Bei einer Sanierung können Bestandsdaten (3D-Scans, As-Built-Pläne) hinterlegt werden.
                  </p>
                </div>
              </div>

              {isSanierung && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 border-t border-slate-200 pt-4">
                  <div className="space-y-2">
                    <Label htmlFor="scan_3d_url">3D-Scans (Link / Pfad)</Label>
                    <Input
                      id="scan_3d_url"
                      value={formData.scan_3d_url}
                      onChange={(e) => handleChange('scan_3d_url', e.target.value)}
                      placeholder="z. B. Punktwolke (.e57 / .rcp), Matterport-Link …"
                      className="border-slate-200 focus:border-emerald-500"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="as_built_url">As-Built-Pläne (Link / Pfad)</Label>
                    <Input
                      id="as_built_url"
                      value={formData.as_built_url}
                      onChange={(e) => handleChange('as_built_url', e.target.value)}
                      placeholder="z. B. Bestandspläne (.pdf / .dwg / IFC) …"
                      className="border-slate-200 focus:border-emerald-500"
                    />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="existing_building_notes">Bestand — Hinweise</Label>
                    <Textarea
                      id="existing_building_notes"
                      value={formData.existing_building_notes}
                      onChange={(e) => handleChange('existing_building_notes', e.target.value)}
                      placeholder="Baujahr, vorhandene Substanz, Aufmaßgüte, bekannte Schadstoffe/Tragwerksbesonderheiten …"
                      className="h-20 border-slate-200 focus:border-emerald-500"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Project Details */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="space-y-2">
                <Label>Status</Label>
                <Select 
                  value={formData.status} 
                  onValueChange={(value) => handleChange('status', value)}
                >
                  <SelectTrigger className="border-slate-200 focus:border-emerald-500">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map(status => (
                      <SelectItem key={status} value={status}>
                        {labelFor(STATUS_LABELS, status)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="hoai_phase">HOAI-Phase</Label>
                <Select 
                  value={formData.hoai_phase?.toString()} 
                  onValueChange={(value) => handleChange('hoai_phase', parseInt(value))}
                >
                  <SelectTrigger className="border-slate-200 focus:border-emerald-500">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[1,2,3,4,5,6,7,8,9].map(phase => (
                      <SelectItem key={phase} value={phase.toString()}>
                        Phase {phase}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              <div className="space-y-2">
                <Label>Energiestandard</Label>
                <Select 
                  value={formData.energy_target} 
                  onValueChange={(value) => handleChange('energy_target', value)}
                >
                  <SelectTrigger className="border-slate-200 focus:border-emerald-500">
                    <SelectValue placeholder="Energiestandard auswählen" />
                  </SelectTrigger>
                  <SelectContent>
                    {ENERGY_TARGETS.map(target => (
                      <SelectItem key={target} value={target}>
                        {labelFor(ENERGY_TARGET_LABELS, target)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Numeric Fields */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <div className="space-y-2">
                <Label htmlFor="building_area">Gebäudefläche (m²)</Label>
                {/* 72-01 A-12 (Befund N-20): explizite Obergrenze — ein number-
                    Input OHNE max meldet im Barrierefreiheits-Baum valuemax=0
                    und der Screenreader liest „Maximum 0". [ASSUMED] 10 Mio. m²
                    als reine Technik-Obergrenze (kein Fachwert). */}
                <Input
                  id="building_area"
                  type="number"
                  min="0"
                  max="10000000"
                  value={formData.building_area}
                  onChange={(e) => handleChange('building_area', e.target.value)}
                  placeholder="0"
                  className="border-slate-200 focus:border-emerald-500"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="estimated_cost">Kostenschätzung (EUR)</Label>
                {/* 72-01 A-12: [ASSUMED] 10 Mrd. EUR als Technik-Obergrenze,
                    damit der Screenreader kein „Maximum 0" liest. */}
                <Input
                  id="estimated_cost"
                  type="number"
                  min="0"
                  max="10000000000"
                  value={formData.estimated_cost}
                  onChange={(e) => handleChange('estimated_cost', e.target.value)}
                  placeholder="0"
                  className="border-slate-200 focus:border-emerald-500"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="sustainability_rating">Nachhaltigkeit (%)</Label>
                <Input
                  id="sustainability_rating"
                  type="number"
                  min="0"
                  max="100"
                  value={formData.sustainability_rating}
                  onChange={(e) => handleChange('sustainability_rating', e.target.value)}
                  placeholder="0"
                  className="border-slate-200 focus:border-emerald-500"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="completion_date">Fertigstellung</Label>
                <Input
                  id="completion_date"
                  type="date"
                  value={formData.completion_date}
                  onChange={(e) => handleChange('completion_date', e.target.value)}
                  className="border-slate-200 focus:border-emerald-500"
                />
              </div>
            </div>

            {/* Notes */}
            <div className="space-y-2">
              <Label htmlFor="notes">Projektnotizen</Label>
              <Textarea
                id="notes"
                value={formData.notes}
                onChange={(e) => handleChange('notes', e.target.value)}
                placeholder="Weitere Projektdetails, Ziele oder Randbedingungen ergänzen …"
                className="h-24 border-slate-200 focus:border-emerald-500"
              />
            </div>

            {/* Submit Buttons */}
            <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
              <Button type="button" variant="outline" onClick={onCancel}>
                Abbrechen
              </Button>
              <Button 
                type="submit" 
                className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700"
              >
                <Save className="w-4 h-4 mr-2" />
                {project ? 'Projekt aktualisieren' : 'Projekt anlegen'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </motion.div>
  );
}