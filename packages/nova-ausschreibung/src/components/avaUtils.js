// Shared helpers for the AVA module (Ausschreibung · Vergabe · Abrechnung).
// WICHTIG: relativer Import mit .js-Endung — hält die Datei node-smoke-testbar
// (der @/-Alias existiert nur im Vite-Build, nicht in `node -e`).
import { filterQuantity } from "../lib/avaFilters.js";

export const eur = (n) =>
  `€${(Math.round((n || 0) * 100) / 100).toLocaleString("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

export const eur0 = (n) => `€${Math.round(n || 0).toLocaleString("de-DE")}`;

export const num = (n, d = 2) =>
  (n || 0).toLocaleString("de-DE", { minimumFractionDigits: 0, maximumFractionDigits: d });

// Gesamtpreis of one position (Menge × Einheitspreis).
export const gp = (pos) => (pos.quantity || 0) * (pos.unit_price || 0);

// Sum of all positions' GP (Kostenanschlag / cost estimate).
export const lvTotal = (positions = []) => positions.reduce((s, p) => s + gp(p), 0);

// Group positions by trade (Los) preserving first-seen order.
export function groupByTrade(positions = []) {
  const map = new Map();
  for (const p of positions) {
    const key = p.trade || "Ohne Gewerk";
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(p);
  }
  // sort each group by OZ
  for (const arr of map.values()) arr.sort((a, b) => (a.oz || "").localeCompare(b.oz || "", "de", { numeric: true }));
  return [...map.entries()].map(([trade, items]) => ({ trade, items, total: lvTotal(items) }));
}

// --- DIN 276 -----------------------------------------------------------------------------
//
// Die Zehnerebene unten ist der EINGEBAUTE Notnagel. Real gerechnet wird DREISTELLIG:
// „394 Abbruchmaßnahmen" ist eine Kostengruppe, „390 Sonstige Baukonstruktionen" ist ein
// Sammeltopf. Im Referenz-LV tragen die 497 Positionen 394/353/351/354/391/344 — mit der
// Zehnerebene allein ist keine dieser Zuordnungen darstellbar.
//
// Die dreistelligen Codes stehen im Katalog `Din276Katalog` (Fassungen 2018 UND 2008,
// getrennt geführt: bei 352/353/354 ist die Reihe zwischen den Fassungen verschoben, ein
// Mapping wäre eine Falschaussage). `din276Optionen(katalog)` liefert die Auswahl fürs
// Formular; ohne Katalog bleibt die Zehnerebene übrig, damit die UI nie leer ist.

/** Auswahlliste fürs Formular: dreistellig aus dem Katalog, sonst die Zehnerebene. */
export function din276Optionen(katalogZeilen, fassung = null) {
  const rows = Array.isArray(katalogZeilen) ? katalogZeilen : [];
  const gefiltert = fassung ? rows.filter((r) => String(r.fassung) === String(fassung)) : rows;
  if (gefiltert.length === 0) {
    return Object.entries(DIN276).map(([code, name]) => ({
      code, name, fassung: null, label: `${code} – ${name}`,
    }));
  }
  return gefiltert
    .map((r) => ({
      code: String(r.code),
      name: r.name || "",
      fassung: r.fassung ? String(r.fassung) : null,
      label: `${r.code} – ${r.name}${r.fassung ? ` (${r.fassung})` : ""}`,
    }))
    .sort((a, b) => a.code.localeCompare(b.code) || String(a.fassung).localeCompare(String(b.fassung)));
}

/** Bezeichnung eines dreistelligen Codes aus dem Katalog (mit Fallback). */
export function din276Name(code, katalogZeilen, fassung = "2018") {
  const rows = Array.isArray(katalogZeilen) ? katalogZeilen : [];
  const treffer = rows.find((r) => String(r.code) === String(code) && (!fassung || String(r.fassung) === String(fassung)))
    || rows.find((r) => String(r.code) === String(code));
  if (treffer) return treffer.name || "";
  return DIN276[String(code)] || "";
}

// DIN 276 cost-group labels (top level) — Notnagel, s. oben.
export const DIN276 = {
  "300": "Bauwerk – Baukonstruktionen",
  "310": "Baugrube / Erdbau",
  "320": "Gründung, Unterbau",
  "330": "Außenwände / Vertikale Baukonstruktionen",
  "340": "Innenwände",
  "350": "Decken / Horizontale Baukonstruktionen",
  "360": "Dächer",
  "390": "Sonstige Baukonstruktionen",
  "400": "Bauwerk – Technische Anlagen",
  "410": "Abwasser / Wasser / Gas",
  "420": "Wärmeversorgung",
  "430": "Raumlufttechnik",
  "440": "Elektrische Anlagen",
  "450": "Kommunikationstechnik",
  "480": "Gebäudeautomation",
};

export const dinLabel = (kg, katalog = null) => {
  if (!kg) return "—";
  const name = din276Name(kg, katalog) || "Kostengruppe";
  return `${kg} – ${name}`;
};

// --- Die VIER Mengen-Modi ------------------------------------------------------------------
//
// `uebernahme` ist NICHT der Randfall, sondern mit 353 von 497 Positionen (71 %) die
// Mehrheit im Realprojekt. Die Unterscheidung zu `handeingabe` ist keine Kosmetik:
//   handeingabe = „jemand hat eine Zahl getippt"
//   uebernahme  = „belegt aus LV 2019, Datei X, Quell-OZ Y — das Modell KANN es nicht,
//                  und zwar aus dem festgehaltenen Grund Z"
// Verschmelzen kostet die Herkunft, den maschinell ermittelten Ausschlussgrund (der bei
// besserem Modell entfällt) und den einzigen Fortschrittsindikator, den es gibt: die
// Arbeitsliste „welche Position kann der Filter nach dem nächsten IFC-Update selbst?".
export const MENGEN_MODI = ["filter", "uebernahme", "handeingabe", "auswahl"];

export const MODUS_LABEL = {
  filter: "Filter (Modell)",
  uebernahme: "Übernahme (LV-Altstand)",
  handeingabe: "Handeingabe",
  auswahl: "Bauteilauswahl",
  manuell: "Handeingabe",
};

export const MODUS_BADGE = {
  filter: "bg-emerald-100 text-emerald-800",
  uebernahme: "bg-sky-100 text-sky-800",
  handeingabe: "bg-slate-100 text-slate-600",
  auswahl: "bg-amber-100 text-amber-800",
  manuell: "bg-slate-100 text-slate-600",
};

// Warum eine Position NICHT modellgebunden ist — maschinell ermittelt, nicht getippt.
// Entfällt der Grund (besseres Modell), wird die Position wieder filterfähig.
export const AUSSCHLUSS_LABEL = {
  nicht_modellierbar: "im Modell nicht darstellbar",
  keine_basisgroesse: "keine BaseQuantity am Bauteil",
  pauschal: "Pauschalposition",
  bauleistung_ohne_bauteil: "Leistung ohne Bauteilbezug",
  filter_geloescht: "Filter gelöscht — Menge eingefroren",
  vertrag: "Vertragsposition ohne LV-Bezug",
};

/**
 * Mengen-Modus einer Position — LAZY abgeleitet (RESEARCH §Pitfall 4).
 *
 * Ein EXPLIZITER `mengen_modus` hat immer Vorrang und wird NIE überstimmt. Das ist die
 * Gegenmaßnahme zu T-33-05: läge die Nachweis-GUID-Liste in `bim_element_ids`, würden
 * die 353 `uebernahme`- und die 15 `filter`-Positionen still auf „auswahl" kippen und
 * ihre Menge einfrieren, ohne dass irgendetwas rot wird. Nachweis-GUIDs gehören deshalb
 * in `nachweis_element_ids`, und die Ableitung greift ausschließlich für Altdaten OHNE
 * gesetzten Modus.
 */
export function positionMode(p) {
  if (p?.mengen_modus) return p.mengen_modus;
  return p?.bim_element_ids?.length ? "auswahl" : "manuell";
}

/**
 * Wird die Menge dieser Position aus dem Modell belegt?
 * - `filter`: live nachgerechnet (Phase 33).
 * - `modell`: JB-Konvention (Rückgabe 260821) — Menge stammt aus dem IFC
 *   (`ifc_menge` + `ifc_guids` als Nachweis), wird aber nicht live nachgerechnet.
 *   Zählt für den Bindungsgrad als modellgebunden; `positionQuantity` bleibt
 *   bewusst filter-exklusiv (kein AvaFilter-Äquivalent zu `ifc_filter`).
 */
export function istModellgebunden(p) {
  const m = positionMode(p);
  return m === "filter" || m === "modell";
}

/**
 * Fortschritt der Modellbindung, GEWICHTET NACH GELDWERT (Pitfall 7).
 * Nach Anzahl gezählt sähe „15 von 497" nach 3 % aus und würde nie priorisiert;
 * nach Geldwert ist sichtbar, welche Übernahme sich zu ersetzen lohnt.
 */
export function modellbindungsGrad(positions = []) {
  let gpGesamt = 0;
  let gpModell = 0;
  let anzahlModell = 0;
  const offen = [];
  for (const p of positions) {
    const wert = gp(p);
    gpGesamt += wert;
    if (istModellgebunden(p)) {
      gpModell += wert;
      anzahlModell += 1;
    } else if (positionMode(p) === "uebernahme") {
      offen.push({
        id: p.id, oz: p.oz, title: p.title, gp: wert,
        ausschluss_grund: p.ausschluss_grund || null,
        modell_geprueft_am: p.modell_geprueft_am || null,
      });
    }
  }
  offen.sort((a, b) => b.gp - a.gp); // teuerste Übernahme zuerst — das ist die Arbeitsliste
  return {
    anzahl_gesamt: positions.length,
    anzahl_modell: anzahlModell,
    gp_gesamt: gpGesamt,
    gp_modell: gpModell,
    grad_anzahl: positions.length ? anzahlModell / positions.length : 0,
    grad_wert: gpGesamt ? gpModell / gpGesamt : 0,
    offene_uebernahmen: offen,
  };
}

// Live-Menge einer filter-gekoppelten Position: löst filter_ref gegen die
// Filterbibliothek auf und summiert über die klassifizierten Elemente.
// Nicht-Filter-Modi → null (Aufrufer nutzt die bestehende quantity);
// Filter nicht gefunden → { menge: 0, treffer: 0 } (kein Throw).
export function positionQuantity(p, filters, els) {
  if (positionMode(p) !== "filter") return null;
  const f = (filters || []).find((x) => x.id === p?.filter_ref);
  if (!f) return { menge: 0, treffer: 0 };
  return filterQuantity(els, f, p?.mengenbasis || "area");
}

// A bid's line price for a position, plus its GP given the position's quantity.
export function bidUnitPrice(bid, positionId) {
  const li = (bid.line_items || []).find((l) => l.position_id === positionId);
  return li ? li.unit_price : null;
}

// Total of a bid over a set of positions (quantities come from the LV).
export function bidTotal(bid, positions = []) {
  return positions.reduce((s, p) => {
    const up = bidUnitPrice(bid, p.id);
    return s + (up != null ? up * (p.quantity || 0) : 0);
  }, 0);
}

export const TENDER_STATUS = {
  draft: { label: "Entwurf", color: "bg-slate-100 text-slate-700" },
  published: { label: "Veröffentlicht", color: "bg-blue-100 text-blue-800" },
  // "Submission" implied a sealed tender opening; the key stays `closed` so no
  // stored value moves, only the wording (57-06 Task 5b).
  closed: { label: "Angebotsfrist beendet", color: "bg-amber-100 text-amber-800" },
  awarded: { label: "Vergeben", color: "bg-emerald-100 text-emerald-800" },
};

export const BID_STATUS = {
  submitted: { label: "Eingegangen", color: "bg-blue-100 text-blue-800" },
  awarded: { label: "Zuschlag", color: "bg-emerald-100 text-emerald-800" },
  rejected: { label: "Abgelehnt", color: "bg-rose-100 text-rose-800" },
};

// Build a CSV (semicolon + BOM for German Excel) from rows of arrays.
export function toCsv(headerRow, rows) {
  const esc = (v) => {
    const s = v == null ? "" : String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headerRow, ...rows].map((r) => r.map(esc).join(";"));
  return "﻿" + lines.join("\r\n");
}

export function downloadCsv(filename, csv) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
