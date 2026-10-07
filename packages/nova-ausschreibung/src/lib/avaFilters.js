// Filter-Engine (Phase 25 — AVA filter-basierte Mengenermittlung).
// Leitprinzip (NOVA-AVA, Referenzprojekt, anonymisiert):
//   Menge = WAS-Filter (KG / Gewerk / Schicht) ∩ ZUSTAND-Filter (Status).
//
// Filter-Form: { id, project_id, name,
//                was: { kg:string[], gewerk:string[], schicht:string[] },
//                zustand: { status:string[] },
//                mengenbasis?: string }
//
// Wildcard-Semantik (RESEARCH §Pattern 2 / §Pitfall 5):
// - Eine LEERE (oder fehlende) Achse matcht ALLES (Wildcard).
// - Innerhalb einer Achse gilt ODER (Wert ∈ Auswahl), über die Achsen gilt UND.
// - Die schicht-Achse des Elements ist ein Array → sie matcht, wenn die
//   Schnittmenge mit der Auswahl nicht leer ist.
// - Ein Filter ohne jedes Kriterium (istWildcard) matcht ALLE Bauteile —
//   Doppelzählungs-Gefahr über mehrere Positionen, die UI warnt sichtbar.
//
// Self-contained: KEINE @/-Alias-Imports (node-Smoke-Testbarkeit).
// Härtung: leere Element-Listen / fehlende mengen → 0 (kein NaN/Infinity),
// undefined-Achsen (Filter ohne was/zustand-Objekt) werfen nicht.

// ---------------------------------------------------------------------------
// Phase 33 / W1 — ADDITIVE Erweiterung. Signaturen und Semantik der bestehenden
// Funktionen bleiben unverändert; Aufrufer (avaUtils.positionQuantity, AVA.jsx)
// laufen unberührt weiter.
//
// Neu sind drei optionale Achsen:
//   was.ifc_klasse : []                     — IFC-Klasse des Bauteils
//   muster.{name,typ,material,geschoss,klassifikation} — delegiert an den
//       VALIDIERTEN Matcher aus @core (Glob-Default, Regex nur nach Prüfung).
//       Kein rohes new RegExp() hier — ReDoS-Schutz liegt in patternMatch.
//   bereich.qty : [{ key, min, max }]       — Größen-Fenster
//
// `faktor` und `soll` gehören an die REGEL (@ava/lib/mengenregeln.js), nicht an
// den Filter. Am Filter stehen nur `name` und `selektor`.
// ---------------------------------------------------------------------------
import { matchPattern } from '@core/lib/rules/patternMatch.js';

// Achsen-Prädikat: leere/fehlende Auswahl = Wildcard; Element-Wert darf Skalar
// (kg/gewerk/status) ODER Array (schicht) sein — einheitliche Behandlung.
// `["*"]` ist ebenfalls Wildcard (Selektor-Schema Phase 33).
const inAxis = (sel, val) => {
  if (!sel || sel.length === 0) return true;
  if (sel.length === 1 && sel[0] === "*") return true;
  const vals = Array.isArray(val) ? val : [val];
  return vals.some((v) => sel.includes(v));
};

// Der Text, gegen den name-/typ-Muster prüfen: `(typ||"") + "|" + (name||"")`.
// Im Referenzprojekt ist `typ` durchweg null — die Unterscheidung steckt im Namen.
const typNameText = (el) => `${el?.typ || ""}|${el?.name || ""}`;

// Muster-Achsen (alle optional; fehlend = kein Filter).
const musterTrifft = (filter, el) => {
  const m = filter?.muster;
  if (!m) return true;
  if (m.typ != null && !matchPattern(typNameText(el), m.typ)) return false;
  if (m.name != null && !matchPattern(typNameText(el), m.name)) return false;
  if (m.material != null && !matchPattern(el?.material || "", m.material)) return false;
  if (m.geschoss != null && !matchPattern(el?.geschoss || "", m.geschoss)) return false;
  if (m.klassifikation != null) {
    const kl = el?.klassifikation;
    const texte = Array.isArray(kl) ? kl : [kl || ""];
    if (!texte.some((t) => matchPattern(t || "", m.klassifikation))) return false;
  }
  return true;
};

// bereich.qty: jedes Fenster muss passen. Fehlende Größe ⇒ kein Treffer
// (ein Fenster auf eine nicht vorhandene Größe darf nicht versehentlich matchen).
const bereichTrifft = (filter, el) => {
  const fenster = filter?.bereich?.qty;
  if (!Array.isArray(fenster) || fenster.length === 0) return true;
  return fenster.every((b) => {
    if (!b?.key) return true;
    const v = el?.qty?.[b.key] ?? el?.mengen?.[b.key];
    if (typeof v !== "number" || !Number.isFinite(v)) return false;
    if (b.min != null && v < b.min) return false;
    if (b.max != null && v > b.max) return false;
    return true;
  });
};

// Trifft der Filter das Element? WAS-Achsen ∩ ZUSTAND-Achse (UND über Achsen).
export function matchElement(filter, el) {
  return (
    inAxis(filter?.was?.kg, el?.kg) &&
    inAxis(filter?.was?.gewerk, el?.gewerk) &&
    inAxis(filter?.was?.schicht, el?.schicht) &&
    inAxis(filter?.was?.ifc_klasse, el?.ifc_klasse ?? el?.klasse) &&
    inAxis(filter?.zustand?.status, el?.status) &&
    musterTrifft(filter, el) &&
    bereichTrifft(filter, el)
  );
}

// Summe der gewählten Mengenbasis über alle Treffer.
// → { menge: Number (2 Nachkommastellen), treffer: Anzahl Bauteile }
export function filterQuantity(els = [], filter, basis = "area") {
  const hit = (els || []).filter((e) => matchElement(filter, e));
  const sum = hit.reduce((s, e) => s + (Number(e?.mengen?.[basis]) || 0), 0);
  return { menge: Math.round(sum * 100) / 100, treffer: hit.length };
}

// Anzahl der getroffenen Bauteile (Lücken-Erkennung: 0 Treffer ⇒ Baustoff /
// Klassifizierung fehlt im Modell → amber Plausibilitätswarnung in der UI).
export function filterTreffer(els = [], filter) {
  return (els || []).filter((e) => matchElement(filter, e)).length;
}

// Wildcard-Filter: KEINE Achse schränkt ein ⇒ matcht ALLE Bauteile.
// Phase 33: die neuen Achsen (ifc_klasse, muster.*, bereich.qty) zählen mit —
// sonst würde ein Filter, der NUR ein Muster setzt, fälschlich als Wildcard
// gelten und die UI-Doppelzählungswarnung würde ausbleiben.
export function istWildcard(filter) {
  const leer = (a) => !a || a.length === 0 || (a.length === 1 && a[0] === "*");
  const musterLeer = (m) =>
    !m || ["name", "typ", "material", "geschoss", "klassifikation"].every((k) => m[k] == null);
  return (
    leer(filter?.was?.kg) &&
    leer(filter?.was?.gewerk) &&
    leer(filter?.was?.schicht) &&
    leer(filter?.was?.ifc_klasse) &&
    leer(filter?.zustand?.status) &&
    musterLeer(filter?.muster) &&
    (!Array.isArray(filter?.bereich?.qty) || filter.bereich.qty.length === 0)
  );
}
