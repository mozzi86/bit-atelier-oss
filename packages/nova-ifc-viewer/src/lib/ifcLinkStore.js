// Querschnitts-Store AVA ↔ IFC-Modell (Phase-30-Kopplung, beide Richtungen).
// Bewusst winzig: Modul-Zustand + Subscriber, kein Context nötig — die beiden
// Seiten leben in derselben SPA.
//
// Richtung 1  Position → Modell ("Im Modell zeigen"):
//   AVA setzt showPositionInModel(link), die IFC-Seite markiert + wählt aus.
// Richtung 2  Modell → Position ("Mengen aus Modell holen"):
//   AVA setzt setTakeoffTarget(position) und navigiert; die IFC-Seite zeigt die
//   Zielposition an und schreibt die gewählte Menge über die API zurück.

let current = null; // { label, guids: string[], expressIds: number[] }
const subs = new Set();

export function showPositionInModel(link) {
  current = link;
  for (const fn of subs) fn(link);
}
export function getPositionLink() {
  return current;
}
export function clearPositionLink() {
  current = null;
}
export function onPositionLink(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}

// --- Richtung 2: Zielposition für die Mengenübernahme ---------------------------
let takeoffTarget = null; // { id, oz, title, unit, trade }
const targetSubs = new Set();

export function setTakeoffTarget(pos) {
  takeoffTarget = pos
    ? { id: pos.id, oz: pos.oz || "", title: pos.title || "", unit: pos.unit || "", trade: pos.trade || "" }
    : null;
  for (const fn of targetSubs) fn(takeoffTarget);
}
export function getTakeoffTarget() {
  return takeoffTarget;
}
export function onTakeoffTarget(fn) {
  targetSubs.add(fn);
  return () => targetSubs.delete(fn);
}

// Dev-Zugang: erlaubt, eine GUID-Auswahl von außen (Browser-Konsole) zu
// markieren — z. B. „alle verknüpften Türen“. Nur im Dev-Build aktiv.
if (import.meta.env.DEV && typeof window !== "undefined") {
  window.__ifcLink = { showPositionInModel, getPositionLink };
}
