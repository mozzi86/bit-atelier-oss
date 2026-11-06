// Bestands-Raumprogramm aus dem IFC ableiten — die Brücke, die bis 26.08.2026 fehlte.
//
// Warum es sie gibt: `BimSnapshot` trägt den echten Bestand (beim Referenzprojekt 156 IfcSpaces mit
// DIN-277-Klassifikation, Fläche und Geschoss), `SpaceProgram` trug für dasselbe Projekt
// GAR KEINEN Datensatz und fiel deshalb auf generische Wohn-Vorgaben (48 WE) zurück —
// bei einem reinen Bürobau. Die beiden Datensätze waren vollständig entkoppelt
// (Debug-Session `referenzprojekt-reiter-nicht-verbunden`).
//
// Grundsätze:
// - Es wird NICHTS geraten. Jeder Raum wird über seine DIN-277-Gruppe zugeordnet;
//   fehlt sie, landet er sichtbar unter `unklassifiziert` statt in einer Sammelgruppe.
// - Die Ableitung ist eine bewusste Aktion, kein stiller Auto-Sync: sie überschreibt
//   nur, was der Aufrufer ihr übergibt, und liefert ihre Herkunft mit.
// - Fläche ist NUF aus den BaseQuantities des Modells, nicht geschätzt.

import { guidKey } from "@ifc/lib/ifcGuid";
import { DIN277_ZU_NUTZUNG } from "@core/lib/bauteil/raeume.js";

// DIN 277 Nutzungsgruppen → Nutzungsarten des Raumprogramms (USES in spaceProgram.js).
// 107-11: the table moved to @core/lib/bauteil/raeume.js (the DIN 277 areas of the BIM studio need it in @core); it is
// imported and re-exported here, so every old import of DIN277_ZU_NUTZUNG from this file stays valid.
// Group 1 ("Wohnen und Aufenthalt") is mapped to `gemeinschaft`, see the comment at the table.
export { DIN277_ZU_NUTZUNG };

/** Erste DIN-277-Gruppe aus dem `klassifikation`-Feld — Position im Array variiert. */
export function dinGruppe(klassifikation) {
  for (const eintrag of Array.isArray(klassifikation) ? klassifikation : []) {
    const m = String(eintrag ?? "").match(/^(\d{2})\s/);
    if (m) return m[1];
  }
  return null;
}

/**
 * Raumprogramm aus einem BimSnapshot ableiten.
 *
 * @param {{elemente?: Array<object>, name?: string}|null} snapshot Bauteilstand (BimSnapshot-Entität)
 * @param {Array<object>} [asrRaeume] optionale Raumdatenblatt-Sätze; liefern über die
 *   GUID echte Raumnamen dazu (rein informativ — die Zuordnung entscheidet die DIN-Gruppe)
 * @returns {{items: Array<{use,area,count}>, gruppen: Array<object>,
 *            unklassifiziert: {anzahl:number, flaeche:number},
 *            kennzahlen: {raeume:number, flaeche:number, geschosse:Array<string>},
 *            herkunft: string}}
 */
export function programmAusBestand(snapshot, asrRaeume = []) {
  const elemente = Array.isArray(snapshot?.elemente) ? snapshot.elemente : [];
  const raeume = elemente.filter((e) => e?.ifc_klasse === "IfcSpace");

  const namenNachGuid = new Map();
  for (const r of Array.isArray(asrRaeume) ? asrRaeume : []) {
    if (r?.guid && r?.name) namenNachGuid.set(guidKey(r.guid), r.name);
  }

  const gruppen = new Map();
  const unklassifiziert = { anzahl: 0, flaeche: 0 };
  const geschosse = new Set();
  let flaecheGesamt = 0;

  for (const raum of raeume) {
    const flaeche = Number(raum?.mengen?.area) || 0;
    flaecheGesamt += flaeche;
    if (raum?.geschoss) geschosse.add(raum.geschoss);

    const gruppe = dinGruppe(raum?.klassifikation);
    const ziel = gruppe ? DIN277_ZU_NUTZUNG[gruppe] : null;
    if (!ziel) {
      unklassifiziert.anzahl += 1;
      unklassifiziert.flaeche += flaeche;
      continue;
    }
    if (!gruppen.has(gruppe)) {
      gruppen.set(gruppe, { gruppe, use: ziel.use, label: ziel.label, anzahl: 0, flaeche: 0, beispiele: [] });
    }
    const g = gruppen.get(gruppe);
    g.anzahl += 1;
    g.flaeche += flaeche;
    const name = namenNachGuid.get(guidKey(raum?.guid));
    if (name && g.beispiele.length < 5 && !g.beispiele.includes(name)) g.beispiele.push(name);
  }

  // Mehrere DIN-Gruppen können auf dieselbe Nutzungsart zeigen (z. B. 05/06/07 →
  // gemeinschaft). Für SpaceProgram je Nutzungsart EINE Zeile zusammenfassen, damit
  // die Summen stimmen und die Tabelle nicht doppelt zählt.
  const jeNutzung = new Map();
  for (const g of gruppen.values()) {
    if (!jeNutzung.has(g.use)) jeNutzung.set(g.use, { use: g.use, anzahl: 0, flaeche: 0 });
    const n = jeNutzung.get(g.use);
    n.anzahl += g.anzahl;
    n.flaeche += g.flaeche;
  }

  // area = mittlere Raumfläche, count = Raumanzahl ⇒ area × count = echte Gesamtfläche.
  const items = [...jeNutzung.values()]
    .filter((n) => n.anzahl > 0)
    .map((n) => ({ use: n.use, area: Math.round((n.flaeche / n.anzahl) * 100) / 100, count: n.anzahl }))
    .sort((a, b) => b.area * b.count - a.area * a.count);

  return {
    items,
    gruppen: [...gruppen.values()].sort((a, b) => b.flaeche - a.flaeche),
    unklassifiziert,
    kennzahlen: {
      raeume: raeume.length,
      flaeche: Math.round(flaecheGesamt * 10) / 10,
      geschosse: [...geschosse].sort(),
    },
    herkunft: snapshot?.name
      ? `IFC-Bestand „${snapshot.name}" — ${raeume.length} Räume, DIN-277-Gruppen`
      : "IFC-Bestand (BimSnapshot) — DIN-277-Gruppen",
  };
}
