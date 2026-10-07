// Wärmebrücken — reine, deterministische Konzept-Funktionen für die Vor-/Entwurfsplanung
// (analog packages/nova-designer/src/lib/hvac.js und .../asr.js).
// Rechtsrahmen (nur Orientierung): GEG § 24 i. V. m. DIN 4108 Beiblatt 2:2019-06;
// detaillierte Berechnung von ψ nach DIN EN ISO 10211.
//
// ABGRENZUNG: KEIN Wärmebrückennachweis, KEIN GEG-Nachweis, KEINE Gleichwertigkeitsprüfung
// nach DIN 4108 Beiblatt 2, KEINE Feuchte-/Schimmelbewertung (DIN 4108-2/-3).
// Alle ψ-Werte sind Konzept-Richtwerte und projektspezifisch durch die Fachplanung
// (Wärmebrückenberechnung) zu bestimmen.
//
// Einheiten: ΔU_WB in W/(m²K), ψ in W/(mK), Längen in m, Flächen in m²,
// G_t in kKh/a, Q in kWh/a, Heizlast in kW, H_WB in W/K.
//
// Härtung: jede Division gegen 0/leer/negativ (safeDiv), jede Längen-/Flächen-/Zähl-
// Eingabe defensiv nicht-negativ coerced (num).
// ψ-VORZEICHEN: ψ und ΔU werden mit psiNum() coerced — VORZEICHENERHALTEND.
// Bei Außenmaßbezug sind negative ψ (Gebäudekante/Außenecke) physikalisch korrekt;
// eine num()-Härtung auf ψ würde ΔU_WB systematisch überschätzen und die Rechnung
// verfälschen. num() darf daher NIEMALS auf ψ oder ΔU angewendet werden.

// Härtende Division: nie durch <0.1 teilen (gegen 0/leer/negativ).
const safeDiv = (a, b) => a / Math.max(0.1, b);
// Defensive, nicht-negative Zahl — für Längen, Flächen, Anzahlen, G_t, ΔT, Bezugsflächen.
const num = (x) => Math.max(0, Number(x) || 0);
// Defensive, VORZEICHENERHALTENDE Zahl — ausschließlich für ψ und ΔU_WB.
const psiNum = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0);

// de-DE-Zahlformate, nur für die Detailtexte der Checks.
const de = (n) => Math.round(Number(n) || 0).toLocaleString("de-DE");
const de1 = (n) => (Number(n) || 0).toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const de3 = (n) => (Number(n) || 0).toLocaleString("de-DE", { minimumFractionDigits: 3, maximumFractionDigits: 3 });

// --- Verfahren zur Berücksichtigung von Wärmebrücken ----------------------------------
// dU in W/(m²K). Werte [VERIFIED A1] GEG § 24 i. V. m. DIN 4108 Beiblatt 2:2019-06.
export const VERFAHREN = {
  pauschal: {
    label: "Pauschal ohne Nachweis (0,10)",
    dU: 0.10,
    hinweis: "immer zulässig, konservativ",
  },
  innendaemmung: {
    label: "Pauschal, Innendämmung Bestand (0,15)",
    dU: 0.15,
    hinweis: "Innendämmung > 50 % der Außenwandfläche UND einbindende Massivdecken",
  },
  gleichwertigkeit_a: {
    label: "Gleichwertigkeit Kategorie A (0,05)",
    dU: 0.05,
    hinweis: "Details nach DIN 4108 Bbl 2:2019-06 Kategorie A — Nachweis je Detail erforderlich",
  },
  gleichwertigkeit_b: {
    label: "Gleichwertigkeit Kategorie B (0,03)",
    dU: 0.03,
    hinweis: "höherwertige Kriterien Kategorie B",
  },
  detailliert: {
    label: "Detaillierte Berechnung (ψ · l)",
    dU: null,
    hinweis: "ΔU_WB = Σ(ψ·l)/A_Hüll — read-only berechnet",
  },
};

// --- Ausführungsqualität der Anschlussdetails ------------------------------------------
export const AUSFUEHRUNG = {
  unkritisch: { label: "unkritisch / optimiert — thermisch getrennt, Dämmung durchlaufend" },
  standard: { label: "Standard — regelkonform ausgeführt" },
  kritisch: { label: "kritisch — Dämmung unterbrochen / durchbetoniert / Bestand" },
};

// --- ψ-Katalog: 14 typische Anschlüsse × 3 Ausführungsqualitäten ------------------------
// Konzept-Richtwerte, KEIN Wärmebrückenkatalog — verbindliche ψ aus DIN 4108 Bbl 2,
// Planungsatlas Hochbau, KS-/Ziegel-Katalog oder Berechnung nach DIN EN ISO 10211.
// herkunft: "modell" (aus Gebäudemodell), "anteil" (über Fensterflächenanteil genähert),
// "eingabe" (reine Nutzereingabe).
export const PSI_KATALOG = {
  sockel: {
    label: "Sockel / Anschluss Bodenplatte",
    herkunft: "modell",
    regel: "Gebäudeumfang P",
    aktivDefault: true,
    bedingung: null,
    psi: { unkritisch: 0.10, standard: 0.25, kritisch: 0.45 }, // [ASSUMED A2]
  },
  kelleraussenwand: {
    label: "Kelleraußenwand / Anschluss Kellerdecke",
    herkunft: "modell",
    regel: "Gebäudeumfang P (nur wenn Keller vorhanden)",
    aktivDefault: false,
    bedingung: "keller",
    psi: { unkritisch: 0.15, standard: 0.30, kritisch: 0.50 }, // [ASSUMED A2]
  },
  fensterlaibung: {
    label: "Fensterlaibung seitlich (umlaufend)",
    herkunft: "anteil",
    regel: "Fensteranzahl · 2 · Fensterhöhe",
    aktivDefault: true,
    bedingung: null,
    psi: { unkritisch: 0.01, standard: 0.04, kritisch: 0.10 }, // [ASSUMED A2]
  },
  fenstersturz: {
    label: "Fenstersturz",
    herkunft: "anteil",
    regel: "Fensteranzahl · Fensterbreite",
    aktivDefault: true,
    bedingung: null,
    psi: { unkritisch: 0.02, standard: 0.08, kritisch: 0.15 }, // [ASSUMED A2]
  },
  fensterbruestung: {
    label: "Fensterbrüstung / Rollladenkasten",
    herkunft: "anteil",
    regel: "Fensteranzahl · Fensterbreite",
    aktivDefault: true,
    bedingung: null,
    psi: { unkritisch: 0.03, standard: 0.10, kritisch: 0.20 }, // [ASSUMED A2]
  },
  attika: {
    label: "Attika / Dachrand (Flachdach)",
    herkunft: "modell",
    regel: "Gebäudeumfang P (nur Flachdach)",
    aktivDefault: true,
    bedingung: "flachdach",
    psi: { unkritisch: 0.10, standard: 0.25, kritisch: 0.45 }, // [ASSUMED A2]
  },
  traufe: {
    label: "Traufe (Steildach)",
    herkunft: "eingabe",
    regel: "≈ P/2 (Näherung, überschreibbar)",
    aktivDefault: false,
    bedingung: "steildach",
    psi: { unkritisch: 0.05, standard: 0.12, kritisch: 0.25 }, // [ASSUMED A2]
  },
  ortgang: {
    label: "Ortgang / Giebel (Steildach)",
    herkunft: "eingabe",
    regel: "≈ P/2 (Näherung, überschreibbar)",
    aktivDefault: false,
    bedingung: "steildach",
    psi: { unkritisch: 0.04, standard: 0.10, kritisch: 0.20 }, // [ASSUMED A2]
  },
  balkonplatte: {
    label: "Auskragende Balkonplatte",
    herkunft: "eingabe",
    regel: "Anzahl Balkone · Balkonbreite",
    aktivDefault: false,
    bedingung: "eingabe",
    psi: { unkritisch: 0.05, standard: 0.15, kritisch: 0.70 }, // [ASSUMED A2]
  },
  deckenauflager: {
    label: "Deckenauflager Außenwand (Geschossdecke)",
    herkunft: "modell",
    regel: "(Geschosse − 1) · P",
    aktivDefault: true,
    bedingung: null,
    psi: { unkritisch: 0.00, standard: 0.02, kritisch: 0.10 }, // [ASSUMED A2]
  },
  geschossdecke_bestand: {
    label: "Geschossdecke im Bestand bei Innendämmung",
    herkunft: "modell",
    regel: "(Geschosse − 1) · P (nur Bestand mit Innendämmung)",
    aktivDefault: false,
    bedingung: "bestand_innendaemmung",
    psi: { unkritisch: 0.20, standard: 0.35, kritisch: 0.60 }, // [ASSUMED A2]
  },
  innenwand: {
    label: "Innenwand-Einbindung in Außenwand",
    herkunft: "eingabe",
    regel: "Eingabe (Gesamtlänge)",
    aktivDefault: false,
    bedingung: "eingabe",
    psi: { unkritisch: 0.00, standard: 0.02, kritisch: 0.08 }, // [ASSUMED A2]
  },
  stuetze: {
    label: "Stahlbetonstütze in der Fassade",
    herkunft: "eingabe",
    regel: "Anzahl · Geschosshöhe · Geschosse",
    aktivDefault: false,
    bedingung: "eingabe",
    psi: { unkritisch: 0.05, standard: 0.15, kritisch: 0.35 }, // [ASSUMED A2]
  },
  gebaeudekante: {
    label: "Gebäudekante vertikal (Außenecke)",
    herkunft: "modell",
    regel: "Eckenanzahl · Gesamthöhe",
    aktivDefault: true,
    bedingung: null,
    // [ASSUMED A13] Bei Außenmaßbezug sind ψ <= 0 physikalisch korrekt — psiNum erhält das Vorzeichen, NIE num() anwenden.
    psi: { unkritisch: -0.05, standard: 0.00, kritisch: 0.05 }, // [ASSUMED A2]
  },
};

// --- Default-Randbedingungen ------------------------------------------------------------
export const DEFAULT_GT_KKH = 84; // kKh/a, GTZ 20/15 ≈ 3.500 Kd/a // [ASSUMED A4] Alternative 66 kKh/a (Heizperiodenbilanz) ⇒ −21 %
export const DEFAULT_DELTA_T = 32; // K, −12/+20 °C // [ASSUMED A5]
export const DEFAULT_HT_MAX = 0.50; // W/(m²K) // [ASSUMED A8] GEG-kategorieabhängig (0,40/0,45/0,50/0,65) — nur Vergleichs-KPI
export const DEFAULT_FENSTER_ANTEIL_PCT = 20; // [ASSUMED A6]
export const DEFAULT_FENSTER_B = 1.30; // m // [ASSUMED A7]
export const DEFAULT_FENSTER_H = 1.40; // m // [ASSUMED A7]
export const DEFAULT_BALKON_BREITE = 4.0; // m // [ASSUMED A14]

// --- Verfahren / Zuschlag ----------------------------------------------------------------

// Pauschaler ΔU_WB des gewählten Verfahrens. Innendämmung hebt den Pauschalwert auf 0,15,
// verändert die Kategorien A/B aber NICHT. "detailliert" ⇒ null (wird gerechnet).
export function pauschalWert(verfahrenKey, innendaemmung) {
  if (verfahrenKey === "pauschal" && innendaemmung === "ja") return 0.15;
  if (verfahrenKey === "detailliert") return null;
  return VERFAHREN[verfahrenKey]?.dU ?? 0.10;
}

// --- Geometrie ---------------------------------------------------------------------------

// Echter Polygonumfang (Kantensumme inkl. Schlusskante) in m.
// Bounding-Box `2·(w+d)` unterschätzt eingeschnittene Grundrisse (U-/Hof-Formen)
// — z. B. U-Footprint: echter Umfang 124 m gegenüber 100 m Bounding-Box.
// `footprintWD` dient nur als Hinweis-Fallback im Panel, NIE als Umfangsquelle.
export function umfangM(fp) {
  if (!Array.isArray(fp) || fp.length < 3) return 0;
  let p = 0;
  for (let i = 0; i < fp.length; i += 1) {
    const a = fp[i];
    const b = fp[(i + 1) % fp.length];
    p += Math.hypot(num(b?.x) - num(a?.x), num(b?.z) - num(a?.z));
  }
  return p;
}

// Anzahl der vertikalen Gebäudekanten = Anzahl der Polygonpunkte.
export function eckenAnzahl(fp) {
  return Array.isArray(fp) ? fp.length : 0;
}

// Wärmeübertragende Hüllfläche A_Hüll (m²).
// [ASSUMED A10] Außenmaßbezug, ohne Attika/Dachüberstand/Laibungstiefe.
export function huellflaeche({ umfang, hoehe, grundflaeche, dach = true, boden = true } = {}) {
  return (
    num(umfang) * num(hoehe) +
    (dach ? num(grundflaeche) : 0) +
    (boden ? num(grundflaeche) : 0)
  );
}

// Außenwandfläche brutto (m²) — Öffnungen nicht abgezogen (konsistent zum Außenmaßbezug).
export function aussenwandflaeche({ umfang, hoehe } = {}) {
  return num(umfang) * num(hoehe);
}

// Rechnerische Fensteranzahl (nicht gerundet).
// envOpenings/customWindows liegen NICHT im Store (Pitfall 5) ⇒ Näherung über Flächenanteil.
export function fensterAnzahl(geo, ein) {
  const aw = aussenwandflaeche(geo || {});
  const flaeche = (num(ein?.fensterAnteilPct) / 100) * aw;
  return safeDiv(flaeche, num(ein?.fensterB) * num(ein?.fensterH));
}

// Flache Map { detailKey: laengeM } mit ALLEN 14 Keys (nicht anwendbar ⇒ 0).
export function laengenAusGeometrie(geo, ein) {
  const g = geo || {};
  const e = ein || {};
  const P = num(g.umfang);
  const nF = fensterAnzahl(g, e);
  const geschosse = Math.max(0, num(g.storeys) - 1); // [ASSUMED A12]
  const bestandInnen = e.bauzustand === "bestand" && e.innendaemmung === "ja";
  return {
    sockel: P,
    kelleraussenwand: e.keller === "ja" ? P : 0,
    fensterlaibung: nF * 2 * num(e.fensterH),
    fenstersturz: nF * num(e.fensterB),
    fensterbruestung: nF * num(e.fensterB),
    attika: e.dachform === "flach" ? P : 0,
    traufe: e.dachform === "steil" ? P / 2 : 0, // [ASSUMED A11]
    ortgang: e.dachform === "steil" ? P / 2 : 0, // [ASSUMED A11]
    balkonplatte: num(e.balkonAnzahl) * num(e.balkonBreite),
    deckenauflager: geschosse * P, // [ASSUMED A12]
    geschossdecke_bestand: bestandInnen ? geschosse * P : 0,
    innenwand: num(e.innenwandLaenge),
    stuetze: num(e.stuetzenAnzahl) * num(g.storeyHeight) * num(g.storeys),
    gebaeudekante: num(g.ecken) * num(g.hoehe), // [ASSUMED A12]
  };
}

// --- ψ · l ---------------------------------------------------------------------------------

// Richtwert-ψ eines Details je Ausführungsqualität — Vorzeichen bleibt erhalten (kein num).
export function psiDefault(detailKey, qualitaet) {
  return PSI_KATALOG[detailKey]?.psi?.[qualitaet] ?? 0;
}

// Punktueller Verlustkoeffizient einer Katalogzeile in W/K (vorzeichenerhaltend).
export function psiL(row) {
  return psiNum(row?.psi) * num(row?.laenge);
}

// Σ(ψ·l) über alle aktiven Zeilen (W/K).
export function summePsiL(rows) {
  if (!Array.isArray(rows)) return 0;
  return rows.filter((r) => r?.aktiv !== false).reduce((s, r) => s + psiL(r), 0);
}

// ΔU_WB aus der detaillierten Berechnung: Σ(ψ·l) / A_Hüll (W/(m²K)).
// Leerer Katalog ⇒ exakt 0 (nicht NaN); negatives Σ bleibt negativ.
export function deltaUwbDetailliert(rows, aHuell) {
  if (!Array.isArray(rows) || rows.length === 0) return 0;
  return safeDiv(summePsiL(rows), num(aHuell));
}

// --- Wirkung -------------------------------------------------------------------------------

// Jahres-Wärmeverlust der Wärmebrücken in kWh/a.
// Einheitenkette: ΔU [W/(m²K)] · A [m²] = H_WB [W/K]; × G_t [kKh/a]
// = W · 1000 Kh / 1000 = kWh/a ⇒ KEIN zusätzlicher Faktor.
export function waermebrueckenVerlust(dU, aHuell, gT) {
  return psiNum(dU) * num(aHuell) * num(gT);
}

// Heizlast-Anteil der Wärmebrücken in kW (/1000: W → kW).
export function heizlastZuschlag(dU, aHuell, dT) {
  return (psiNum(dU) * num(aHuell) * num(dT)) / 1000;
}

// ΔH'_T = ΔU_WB exakt 1:1, weil ΔU·A_Hüll / A_Hüll = ΔU.
export function htZuschlag(dU) {
  return psiNum(dU);
}

// Anteil in % (gehärtet gegen Division durch 0).
export function anteilPct(teil, ganzes) {
  return safeDiv(psiNum(teil), num(ganzes)) * 100;
}

// Einsparpotenzial in kWh/a (positiv = Einsparung).
export function einsparpotenzial(dUvon, dUnach, aHuell, gT) {
  return (psiNum(dUvon) - psiNum(dUnach)) * num(aHuell) * num(gT);
}

// Gesamtwirkung eines ΔU_WB. JEDER Wert endlich, auch bei wirkung({}).
export function wirkung({
  deltaUwb = 0,
  aHuell = 0,
  gT = DEFAULT_GT_KKH,
  qRef = 0,
  dT = DEFAULT_DELTA_T,
  bgf = 0,
  htMax = DEFAULT_HT_MAX,
} = {}) {
  const hWb = psiNum(deltaUwb) * num(aHuell);
  const qWb = waermebrueckenVerlust(deltaUwb, aHuell, gT);
  return {
    hWb,
    qWb,
    spezQwb: safeDiv(qWb, num(bgf)),
    anteilPct: anteilPct(qWb, qRef),
    heizlastKw: heizlastZuschlag(deltaUwb, aHuell, dT),
    htZuschlag: htZuschlag(deltaUwb),
    htAnteilPct: anteilPct(deltaUwb, htMax),
  };
}

// Vergleich der Verfahren untereinander. Die Differenz ist die belastbarste Aussage,
// weil sich Kennwert-Unsicherheiten in der Differenz herauskürzen.
export function verfahrensvergleich({
  aHuell = 0,
  gT = DEFAULT_GT_KKH,
  qRef = 0,
  dT = DEFAULT_DELTA_T,
  bgf = 0,
  deltaUwbDet = 0,
} = {}) {
  const keys = ["innendaemmung", "pauschal", "gleichwertigkeit_a", "gleichwertigkeit_b"];
  const referenzDU = VERFAHREN.pauschal.dU;
  const zeile = (key, label, deltaUwb) => {
    const w = wirkung({ deltaUwb, aHuell, gT, qRef, dT, bgf });
    // Darf NEGATIV sein = schlechter als der Pauschalwert (z. B. Innendämmung 0,15).
    const einsparungKwh = einsparpotenzial(referenzDU, deltaUwb, aHuell, gT);
    return {
      key,
      label,
      deltaUwb,
      hWb: w.hWb,
      qWb: w.qWb,
      spezQwb: w.spezQwb,
      anteilPct: w.anteilPct,
      heizlastKw: w.heizlastKw,
      einsparungKwh,
      einsparungPct: anteilPct(einsparungKwh, qRef),
    };
  };
  const zeilen = keys.map((k) => zeile(k, VERFAHREN[k].label, VERFAHREN[k].dU));
  if (psiNum(deltaUwbDet) > 0) {
    zeilen.push(zeile("detailliert", VERFAHREN.detailliert.label, psiNum(deltaUwbDet)));
  }
  const einsparPotenzialKwh = einsparpotenzial(
    VERFAHREN.pauschal.dU,
    VERFAHREN.gleichwertigkeit_a.dU,
    aHuell,
    gT,
  );
  return {
    zeilen,
    einsparPotenzialKwh,
    einsparPotenzialPct: anteilPct(einsparPotenzialKwh, qRef),
    referenzDU,
  };
}

// --- Checkliste ------------------------------------------------------------------------------
// Status ausschließlich "pass" | "warn" | "offen" — NIE "fail" (Haftung: das Panel
// führt keinen Nachweis und darf deshalb nichts als "nicht erfüllt" bewerten).
export function wbChecks({
  verfahren = "pauschal",
  innendaemmung = "nein",
  aHuell = 0,
  deltaUwb = 0,
  deltaUwbDet = 0,
  htMax = DEFAULT_HT_MAX,
  gT = DEFAULT_GT_KKH,
  rows = [],
  balkonAnzahl = 0,
  einsparPotenzialKwh = 0,
} = {}) {
  void gT;
  const aktive = (Array.isArray(rows) ? rows : []).filter((r) => r?.aktiv !== false);
  const ohneLaenge = aktive.filter((r) => num(r?.laenge) <= 0);
  const kritische = aktive.filter((r) => r?.qualitaet === "kritisch");
  const balkonZeile = aktive.find((r) => r?.key === "balkonplatte");

  const items = [];

  // 1
  const verfahrenPass = verfahren === "gleichwertigkeit_a" || verfahren === "gleichwertigkeit_b" || verfahren === "detailliert";
  items.push({
    key: "verfahren",
    label: "Verfahrenswahl (Richtwert)",
    status: verfahrenPass ? "pass" : "warn",
    detail: verfahrenPass
      ? `Verfahren „${VERFAHREN[verfahren]?.label || verfahren}“ gewählt — Nachweisführung liegt bei der Fachplanung.`
      : `Einsparpotenzial durch Gleichwertigkeitsnachweis nach Beiblatt 2 ≈ ${de(einsparPotenzialKwh)} kWh/a`,
  });

  // 2 — strukturell immer offen
  items.push({
    key: "gleichwertigkeit",
    label: "Gleichwertigkeitsnachweis (Hinweis)",
    status: "offen",
    detail: "Gleichwertigkeit ist je Detail nach DIN 4108 Beiblatt 2:2019-06 nachzuweisen — hier nicht geführt.",
  });

  // 3
  items.push({
    key: "huellflaeche",
    label: "Hüllfläche erfasst",
    status: num(aHuell) > 0 ? "pass" : "offen",
    detail: num(aHuell) > 0
      ? `A_Hüll ≈ ${de(aHuell)} m²`
      : "Gebäudemodell pflegen (Footprint zeichnen) oder Hüllfläche eingeben",
  });

  // 4
  let laengenStatus = "pass";
  let laengenDetail = `${aktive.length} aktive Detailzeile(n) mit Länge erfasst`;
  if (aktive.length === 0) {
    laengenStatus = "offen";
    laengenDetail = "Detailkatalog noch nicht erfasst";
  } else if (ohneLaenge.length > 0) {
    laengenStatus = "warn";
    laengenDetail = `${ohneLaenge.length} Zeile(n) ohne Länge — ΔU_WB zu niedrig`;
  }
  items.push({ key: "laengen_vollstaendig", label: "Längen im Detailkatalog", status: laengenStatus, detail: laengenDetail });

  // 5
  let balkonStatus = "pass";
  let balkonDetail = `${de(balkonAnzahl)} auskragende Balkonplatte(n) berücksichtigt`;
  if (num(balkonAnzahl) === 0) {
    balkonStatus = "offen";
    balkonDetail = "Balkone nicht erfasst";
  } else if (balkonZeile?.qualitaet === "kritisch") {
    balkonStatus = "warn";
    balkonDetail = "ψ ≈ 0,70 W/(mK) — thermische Trennung (Dämmelement) prüfen";
  }
  items.push({ key: "balkon", label: "Auskragende Balkonplatte", status: balkonStatus, detail: balkonDetail });

  // 6
  items.push({
    key: "kritische_details",
    label: "Kritische Ausführungsqualität",
    status: kritische.length > 0 ? "warn" : "pass",
    detail: kritische.length > 0
      ? `${kritische.length} Detail(s) kritisch — Optimierungspotenzial`
      : "keine kritisch ausgeführten Details im Katalog",
  });

  // 7
  items.push({
    key: "innendaemmung",
    label: "Innendämmung Bestand",
    status: innendaemmung === "ja" ? "warn" : "pass",
    detail: innendaemmung === "ja"
      ? "Zuschlag 0,15 W/(m²K); Feuchteschutz/Tauwasser nach DIN 4108-3 gesondert prüfen — hier kein Nachweis"
      : "keine Innendämmung angesetzt",
  });

  // 8
  let plausStatus = "pass";
  let plausDetail = "nicht angewendet (pauschales Verfahren gewählt)";
  if (verfahren === "detailliert") {
    const d = psiNum(deltaUwbDet);
    if (d >= 0.01 && d <= 0.10) {
      plausStatus = "pass";
      plausDetail = `ΔU_WB ≈ ${de3(d)} W/(m²K) — plausibel und besser als der Pauschalwert 0,10`;
    } else if (d > 0.10) {
      plausStatus = "warn";
      plausDetail = `${de3(d)} W/(m²K) — schlechter als der Pauschalwert 0,10: Details optimieren oder pauschal ansetzen`;
    } else {
      plausStatus = "warn";
      plausDetail = `${de3(d)} W/(m²K) — unplausibel niedrig: Vollständigkeit der Längen prüfen`;
    }
  }
  items.push({ key: "plausibilitaet_detail", label: "Plausibilität detaillierte Berechnung", status: plausStatus, detail: plausDetail });

  // 9
  let htStatus = "offen";
  let htDetail = "Höchstwert eingeben (GEG-Kategorie)";
  if (num(htMax) > 0) {
    const p = anteilPct(deltaUwb, htMax);
    htStatus = p <= 20 ? "pass" : "warn";
    htDetail = p <= 20
      ? `Wärmebrücken beanspruchen ${de1(p)} % des H'_T-Budgets`
      : `Wärmebrücken verbrauchen ${de1(p)} % des H'_T-Budgets`;
  }
  items.push({ key: "ht_budget", label: "H'_T-Anteil (Richtwert)", status: htStatus, detail: htDetail });

  // 10 — strukturell immer offen
  items.push({
    key: "mindestwaermeschutz",
    label: "Mindestwärmeschutz / Schimmelfreiheit",
    status: "offen",
    detail: "f_Rsi ≥ 0,70 (DIN 4108-2) und Tauwasser (DIN 4108-3) werden hier nicht geprüft — Bauphysik/Fachplanung.",
  });

  // TB-01: Nenner = tatsächlich bewertete Items. „offen" heißt „nicht bewertbar"
  // und darf den Score nicht deckeln (zwei Items sind strukturell immer offen —
  // sonst wären nie mehr als 80 % erreichbar). Gleiche Konvention wie
  // compliance.js: score === null, wenn nichts bewertet werden konnte.
  const bewertet = items.filter((i) => i.status !== "offen");
  const pass = bewertet.filter((i) => i.status === "pass").length;
  const warns = bewertet.filter((i) => i.status === "warn").length;
  const offen = items.length - bewertet.length;
  const ampel = offen > 0 ? "neutral" : warns > 0 ? "warn" : "pass";
  const verdict = offen > 0 ? "Konzept offen" : warns > 0 ? "Konzept mit Hinweisen" : "Konzept plausibel";

  return {
    items,
    score: bewertet.length === 0 ? null : Math.round((pass / bewertet.length) * 100),
    bewertet: bewertet.length,
    total: items.length,
    warns,
    offen,
    ampel,
    verdict,
  };
}
