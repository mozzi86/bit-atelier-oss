// 91-04: sustainability concept sheet — one page that gathers the figures the planners already compute
// (rainwater harvesting 91-01/02, green roof, photovoltaics, soil sealing) instead of a new module with
// its own inputs. Pure and deterministic; the card (NachhaltigkeitKarte) and the PDF read the same model.
//
// Sources (no own state, nothing guessed):
//   - rainwater:   regenwasserNutzung() result via useRegenwasser (same figures as the drainage planner)
//   - green roof:  the roof surfaces of that result (gruendachExtensiv / gruendachIntensiv)
//   - PV:          complexData.energy_systems of type "Photovoltaik" (EnergyPlanner); the roof potential
//                  is an ESTIMATE from the roof area and is labelled as such
//   - sealing:     footprint + drawn paved areas of aussenanlagen_layer against the plot area; the part of
//                  the plot nobody has drawn yet is shown as "nicht erfasst" — never counted as green
// A missing input is a gap ("luecken"), not zero.
//
// In:  { regenwasser, footArea_m2, dachform, plot_m2, flaechenSummen, energySystems }
// Out: { abschnitte: [{ key, titel, status, zeilen: [{ label, wert, einheit, geschaetzt? }], hinweise }], luecken }

/** PV rule of thumb [ASSUMED]: usable share of a flat roof (setbacks, technical units, maintenance paths),
 * module power per m² of roof and specific yield for Germany. Only for the potential, never for a design. */
export const PV_ANNAHMEN = Object.freeze({ nutzbarFlach: 0.5, nutzbarSteil: 0.35, kwpJeM2: 0.2, kwhJeKwp: 950 });
/** Orientation value for the sealed share, same as landscape.js aussenanlagenChecks (statutes may differ). */
export const VERSIEGELUNG_ORIENTIERUNG = 0.6;
/** Surface kinds of the site plan that are unsealed (pflanzen.js FLAECHEN_ARTEN gruen + water). */
const UNVERSIEGELT = new Set(["gruen", "beet", "wasser"]);

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const r1 = (v) => Math.round(num(v) * 10) / 10;
const r0 = (v) => Math.round(num(v));

/**
 * Status of a section: "umgesetzt" (measure planned and figures complete), "teilweise" (planned, with a
 * gap or a conflict), "offen" (not planned yet).
 * @typedef {"umgesetzt"|"teilweise"|"offen"} Status
 */

/**
 * @param {{regenwasser?: any, footArea_m2?: number, dachform?: string, plot_m2?: number|null,
 *   flaechenSummen?: Record<string, number>, energySystems?: Array<{type?: string, capacity_kw?: number}>}} p
 */
export function nachhaltigkeitsModell(p = {}) {
  const luecken = [];
  const footArea = Math.max(0, num(p.footArea_m2));
  const plot = num(p.plot_m2) > 0 ? num(p.plot_m2) : null;
  const rw = p.regenwasser || null;

  // --- Rainwater harvesting -------------------------------------------------------------------------
  const regen = { key: "regenwasser", titel: "Regenwassernutzung", status: /** @type {Status} */ ("offen"), zeilen: [], hinweise: [] };
  if (!rw) {
    luecken.push("Regenwasser: keine Berechnung vorhanden (Entwässerungsplaner öffnen).");
  } else if (!rw.nutzung?.aktiv) {
    regen.hinweise.push("Regenwassernutzung ist im Entwässerungsplaner ausgeschaltet.");
  } else {
    const sp = rw.speicher || {};
    const deckung = sp.deckung == null ? null : Math.round(sp.deckung * 100);
    regen.zeilen.push(
      { label: "Ertrag (Dachflächen)", wert: r0(rw.ertrag?.m3a), einheit: "m³/a", geschaetzt: Boolean(rw.ertrag?.niederschlagGeschaetzt) },
      { label: "Bedarf WC + Garten", wert: r0(rw.bedarf?.gesamt_m3a), einheit: "m³/a" },
      { label: "Zisterne", wert: r0(rw.zisterne?.volumen_m3), einheit: "m³" },
      { label: "Deckungsgrad", wert: deckung, einheit: "%" },
      { label: "Trinkwasser gespart", wert: r0(sp.einsparung_m3a), einheit: "m³/a" },
    );
    regen.hinweise.push(rw.zisterne?.lage === "unter_tg" ? "Zisterne unter der Bodenplatte der Tiefgarage." : "Zisterne im Erdreich (keine Tiefgarage).");
    if (rw.ertrag?.niederschlagGeschaetzt) regen.hinweise.push("Niederschlag geschätzt (kein Klimawert vom Standort).");
    regen.status = deckung === null ? "teilweise" : deckung < 50 ? "teilweise" : "umgesetzt";
    if (deckung !== null && deckung < 50) regen.hinweise.push(`Dachfläche deckt nur ${deckung} % des Betriebswassers — Rest über Trinkwasser-Nachspeisung.`);
  }

  // --- Green roof -----------------------------------------------------------------------------------
  const gd = { key: "gruendach", titel: "Gründach", status: /** @type {Status} */ ("offen"), zeilen: [], hinweise: [] };
  const dachFlaechen = Array.isArray(rw?.flaechen) ? rw.flaechen : [];
  const gruen = dachFlaechen.filter((f) => /^gruendach/.test(f.art)).reduce((s, f) => s + num(f.m2), 0);
  if (footArea > 0) {
    gd.zeilen.push({ label: "Dachfläche", wert: r0(footArea), einheit: "m²" }, { label: "davon begrünt", wert: r0(gruen), einheit: "m²" },
      { label: "Anteil begrünt", wert: footArea > 0 ? Math.round((gruen / footArea) * 100) : null, einheit: "%" });
    if (gruen > 0) {
      gd.status = "umgesetzt";
      if (rw?.nutzung?.aktiv) gd.hinweise.push("Zielkonflikt: Gründach hält Wasser zurück und senkt den Zisternen-Ertrag (e ca. 0,3).");
    } else gd.hinweise.push(p.dachform && p.dachform !== "flach" ? "Geneigtes Dach — Begrünung nur eingeschränkt möglich." : "Kein Gründach geplant.");
  } else luecken.push("Gründach: keine Dachfläche im Planmodell.");

  // --- Photovoltaics --------------------------------------------------------------------------------
  const pv = { key: "pv", titel: "Photovoltaik", status: /** @type {Status} */ ("offen"), zeilen: [], hinweise: [] };
  const pvAnlagen = (p.energySystems || []).filter((s) => /photovolt/i.test(String(s?.type || "")));
  const kwp = pvAnlagen.reduce((s, x) => s + Math.max(0, num(x.capacity_kw)), 0);
  const nutzbar = p.dachform && p.dachform !== "flach" ? PV_ANNAHMEN.nutzbarSteil : PV_ANNAHMEN.nutzbarFlach;
  const potenzialKwp = footArea > 0 ? r1(footArea * nutzbar * PV_ANNAHMEN.kwpJeM2) : null;
  if (kwp > 0) {
    pv.status = "umgesetzt";
    pv.zeilen.push({ label: "Geplante Leistung", wert: r1(kwp), einheit: "kWp" }, { label: "Ertrag (Schätzung)", wert: r0(kwp * PV_ANNAHMEN.kwhJeKwp), einheit: "kWh/a", geschaetzt: true });
  } else pv.hinweise.push("Keine PV-Anlage im Energieplaner eingetragen.");
  if (potenzialKwp !== null) {
    pv.zeilen.push({ label: "Dachpotenzial (Schätzung)", wert: potenzialKwp, einheit: "kWp", geschaetzt: true });
    if (kwp > 0 && kwp > potenzialKwp * 1.2) { pv.status = "teilweise"; pv.hinweise.push("Geplante Leistung liegt deutlich über dem geschätzten Dachpotenzial — Belegungsplan prüfen."); }
  }
  if (gruen > 0 && kwp > 0) pv.hinweise.push("Gründach und PV lassen sich als Solargründach kombinieren (aufgeständerte Module).");

  // --- Soil sealing ---------------------------------------------------------------------------------
  const vs = { key: "versiegelung", titel: "Versiegelung", status: /** @type {Status} */ ("offen"), zeilen: [], hinweise: [] };
  let versiegeltAussen = 0, unversiegelt = 0;
  for (const [art, m2] of Object.entries(p.flaechenSummen || {})) {
    if (UNVERSIEGELT.has(art)) unversiegelt += num(m2); else versiegeltAussen += num(m2);
  }
  if (plot === null) {
    luecken.push("Versiegelung: Grundstücksfläche fehlt (Projektdaten).");
  } else {
    const versiegelt = footArea + versiegeltAussen;
    const nichtErfasst = Math.max(0, plot - versiegelt - unversiegelt);
    const grad = versiegelt / plot;
    vs.zeilen.push(
      { label: "Grundstück", wert: r0(plot), einheit: "m²" },
      { label: "Gebäude", wert: r0(footArea), einheit: "m²" },
      { label: "Befestigte Außenflächen", wert: r0(versiegeltAussen), einheit: "m²" },
      { label: "Grün- und Wasserflächen", wert: r0(unversiegelt), einheit: "m²" },
      { label: "Noch nicht erfasst", wert: r0(nichtErfasst), einheit: "m²" },
      { label: "Versiegelungsgrad", wert: Math.round(grad * 100), einheit: "%" },
    );
    const ok = grad <= VERSIEGELUNG_ORIENTIERUNG;
    vs.status = nichtErfasst > plot * 0.05 ? "teilweise" : ok ? "umgesetzt" : "teilweise";
    if (!ok) vs.hinweise.push(`Über der Orientierung von ${Math.round(VERSIEGELUNG_ORIENTIERUNG * 100)} % — Bebauungsplan / Satzung beachten.`);
    if (nichtErfasst > plot * 0.05) vs.hinweise.push(`${r0(nichtErfasst)} m² des Grundstücks sind im Lageplan noch nicht als Fläche gezeichnet — zählen weder als grün noch als versiegelt.`);
    if (gruen > 0) vs.hinweise.push("Gründach ist im Versiegelungsgrad nicht abgezogen (Anrechnung regelt die Satzung).");
  }

  return { abschnitte: [regen, gd, pv, vs], luecken };
}

/** German number format for card and PDF ("—" for a gap). */
export function wertText(z) {
  if (z.wert === null || z.wert === undefined || Number.isNaN(z.wert)) return "—";
  return `${Number(z.wert).toLocaleString("de-DE")} ${z.einheit}`.trim();
}

export const STATUS_TEXT = Object.freeze({ umgesetzt: "geplant", teilweise: "mit Hinweisen", offen: "offen" });
