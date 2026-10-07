import React from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@core/components/ui/select";
import { Filter } from "lucide-react";
import { STATUS_LABELS, CLIMATE_ZONE_LABELS, ENERGY_TARGET_LABELS, labelFor } from "./labels";

const STATUS_OPTIONS = [
  { value: "all", label: "Alle Status" },
  { value: "concept", label: labelFor(STATUS_LABELS, "concept") },
  { value: "design_development", label: labelFor(STATUS_LABELS, "design_development") },
  { value: "technical_design", label: labelFor(STATUS_LABELS, "technical_design") },
  { value: "construction", label: labelFor(STATUS_LABELS, "construction") },
  { value: "completed", label: labelFor(STATUS_LABELS, "completed") }
];

const CLIMATE_ZONE_OPTIONS = [
  { value: "all", label: "Alle Klimazonen" },
  { value: "tropical", label: labelFor(CLIMATE_ZONE_LABELS, "tropical") },
  { value: "subtropical", label: labelFor(CLIMATE_ZONE_LABELS, "subtropical") },
  { value: "temperate", label: labelFor(CLIMATE_ZONE_LABELS, "temperate") },
  { value: "continental", label: labelFor(CLIMATE_ZONE_LABELS, "continental") },
  { value: "polar", label: labelFor(CLIMATE_ZONE_LABELS, "polar") },
  { value: "mediterranean", label: labelFor(CLIMATE_ZONE_LABELS, "mediterranean") },
  { value: "arid", label: labelFor(CLIMATE_ZONE_LABELS, "arid") }
];

const ENERGY_TARGET_OPTIONS = [
  { value: "all", label: "Alle Energiestandards" },
  { value: "passive_house", label: labelFor(ENERGY_TARGET_LABELS, "passive_house") },
  { value: "kfw_55", label: labelFor(ENERGY_TARGET_LABELS, "kfw_55") },
  { value: "kfw_40", label: labelFor(ENERGY_TARGET_LABELS, "kfw_40") },
  { value: "net_zero", label: labelFor(ENERGY_TARGET_LABELS, "net_zero") },
  { value: "plus_energy", label: labelFor(ENERGY_TARGET_LABELS, "plus_energy") }
];

export default function ProjectFilters({ filters, onFilterChange }) {
  const handleFilterChange = (filterType, value) => {
    onFilterChange({
      ...filters,
      [filterType]: value
    });
  };

  return (
    <div className="flex flex-wrap gap-4 items-center">
      <div className="flex items-center gap-2">
        <Filter className="w-4 h-4 text-slate-500" />
        <span className="text-sm text-slate-600">Filter:</span>
      </div>
      
      <Select
        value={filters.status}
        onValueChange={(value) => handleFilterChange("status", value)}
      >
        <SelectTrigger className="w-40 border-slate-200 focus:border-emerald-500">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {STATUS_OPTIONS.map(option => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={filters.climate_zone}
        onValueChange={(value) => handleFilterChange("climate_zone", value)}
      >
        <SelectTrigger className="w-44 border-slate-200 focus:border-emerald-500">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {CLIMATE_ZONE_OPTIONS.map(option => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={filters.energy_target}
        onValueChange={(value) => handleFilterChange("energy_target", value)}
      >
        <SelectTrigger className="w-44 border-slate-200 focus:border-emerald-500">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ENERGY_TARGET_OPTIONS.map(option => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}