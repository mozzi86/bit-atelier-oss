// Schallschutz — reine, deterministische Faustformel-Funktionen für die
// Konzept-/Vorplanungsphase (analog src/lib/fire.js, src/lib/hvac.js).
// ALLE Werte sind bewusst Konzept-Richtwerte: KEIN prüffähiger Schallschutznachweis
// nach DIN 4109, KEINE bauakustische Messung — Nachweis durch Bauakustiker:in
// erforderlich. Normbezug (Orientierung): DIN 4109-1/-2 (Lärmpegelbereiche,
// Anforderungen Luft-/Trittschall), VDI 4100 (erhöhter Schallschutz, informativ).
// ABGRENZUNG: Anlagen-Auslegung (Heizung/Lüftung) liegt im Haustechnik-Tab
// (src/lib/hvac.js); Raum-Sollpegel für Arbeitsstätten im ASR-Raumdatenblatt —
// hier NUR bauakustische Konzept-Richtwerte der Gebäudehülle und Trennbauteile.
// Jede Division ist gegen 0/leer/negativ gehärtet (safeDiv), jede Eingabe
// defensiv coerced (num).

// Härtende Division: nie durch <0.1 teilen (gegen 0/leer/negativ).
const safeDiv = (a, b) => a / Math.max(0.1, b);
// Defensive, nicht-negative Zahl.
const num = (x) => Math.max(0, Number(x) || 0);
// de-DE-Zahlformat für Check-Detailtexte (ganzzahlig gerundet).
const de = (n) => Math.round(Number(n) || 0).toLocaleString("de-DE");

// --- Richtwert-Konstanten (Defaults, überschreibbar in der Komponente) ----------------

// Lärmpegelbereiche nach DIN 4109-1 Tab. 7 (vereinfachte Bänder, maßgeblicher
// Außenlärmpegel in dB(A)). [ASSUMED A1]
export const LAERMPEGELBEREICHE = [
  { bereich: "I", bis: 55 },
  { bereich: "II", bis: 60 },
  { bereich: "III", bis: 65 },
  { bereich: "IV", bis: 70 },
  { bereich: "V", bis: 75 },
  { bereich: "VI", bis: 80 },
  { bereich: "VII", bis: 999 },
];

// Erforderliches gesamt R'w,ges der Außenbauteile je Lärmpegelbereich und
// Raumart (dB). [ASSUMED A2]
export const ERF_RW_AUSSEN = {
  I: { wohnen: 30, buero: 30 },
  II: { wohnen: 30, buero: 30 },
  III: { wohnen: 35, buero: 30 },
  IV: { wohnen: 40, buero: 35 },
  V: { wohnen: 45, buero: 40 },
  VI: { wohnen: 50, buero: 45 },
  VII: { wohnen: 50, buero: 50 },
};

// Richtwerte R'w für Trennbauteile im Wohnungsbau (dB, DIN 4109-1). [ASSUMED A3]
export const TRENN_RICHTWERTE = {
  wand_wohnungstrennend: 53,
  decke_wohnungstrennend: 54,
  tuer_flur: 27,
};

// Trittschall-Anforderung L'n,w für Wohnungstrenndecken (dB). [ASSUMED A4]
export const TRITTSCHALL_GRENZE = 50;

// Erwarteter Trittschallpegel L'n,w je gewähltem Deckenaufbau (dB). [ASSUMED A5]
export const DECKENAUFBAU = {
  massiv_estrich: { label: "Massivdecke + schwimmender Estrich", lnw: 46 },
  holz: { label: "Holzbalkendecke", lnw: 53 },
  ohne: { label: "ohne besonderen Trittschallschutz", lnw: 63 },
};

// Max. Schalldruckpegel gebäudetechnischer Anlagen in schutzbedürftigen
// Räumen (dB(A), DIN 4109-1). [ASSUMED A6]
export const TGA_GRENZE = 30;

// Außenlärmquellen (für die Quelle-Auswahl, rein informativ — die Bänder A1
// gelten quellenunabhängig als Konzept-Näherung).
export const LAERMQUELLEN = {
  strasse: "Straßenverkehr",
  schiene: "Schienenverkehr",
  gewerbe: "Gewerbe / Industrie",
  flug: "Flugverkehr",
};

// Raumarten für die Anforderungstabelle ERF_RW_AUSSEN.
export const RAUMARTEN = {
  wohnen: "Wohnen / Schlafen",
  buero: "Büro / Verwaltung",
};

// --- Faustformeln (reine Werte, Formatierung in der Komponente) -----------------------

// Lärmpegelbereich I–VII aus maßgeblichem Außenlärmpegel dB(A). [ASSUMED A1]
// num-gehärtet: leere/negative Eingabe ⇒ 0 dB(A) ⇒ Bereich I.
export function laermpegelbereich(dbA) {
  const pegel = num(dbA);
  const hit = LAERMPEGELBEREICHE.find((b) => pegel <= b.bis);
  return hit ? hit.bereich : "VII";
}

// Erforderliches gesamt R'w,ges (dB) aus Lärmpegelbereich + Raumart.
// Fallbacks: unbekannter Bereich ⇒ I, unbekannte Raumart ⇒ wohnen. [ASSUMED A2]
export function erfRwGes(bereich, raumart) {
  const zeile = ERF_RW_AUSSEN[bereich] || ERF_RW_AUSSEN.I;
  const wert = zeile[raumart];
  return Number.isFinite(wert) ? wert : zeile.wohnen;
}

// Plausibilitäts-Checks (Konzept) — bewusst NUR "pass"/"warn", NIE "fail"
// (Haftung): Richtwerte dürfen nicht als prüffähiger Schallschutznachweis
// nach DIN 4109 erscheinen. Nachweis durch Bauakustiker:in erforderlich.
export function schallChecks({
  dbA = 0,
  raumart = "wohnen",
  rwAussenIst = 0,
  rwTrennIst = 0,
  rwDeckeIst = 0, // Default 0 wie rwAussenIst/rwTrennIst — kein pass ohne Eingabe (ME-04)
  deckenaufbau = "massiv_estrich",
  tgaPegel = 0,
} = {}) {
  const bereich = laermpegelbereich(dbA);
  const erf = erfRwGes(bereich, raumart);
  const aufbau = DECKENAUFBAU[deckenaufbau] || DECKENAUFBAU.ohne;
  const aussenOk = num(rwAussenIst) >= erf;
  const wandOk = num(rwTrennIst) >= TRENN_RICHTWERTE.wand_wohnungstrennend;
  const deckeOk = num(rwDeckeIst) >= TRENN_RICHTWERTE.decke_wohnungstrennend;
  const trittOk = num(aufbau.lnw) <= TRITTSCHALL_GRENZE;
  const tgaOk = num(tgaPegel) <= TGA_GRENZE;

  const items = [
    {
      key: "aussen",
      label: "Außenbauteile R'w,ges (Richtwert)",
      status: aussenOk ? "pass" : "warn",
      detail: aussenOk
        ? `R'w,ges ${de(rwAussenIst)} dB ≥ erforderlich ${de(erf)} dB (Lärmpegelbereich ${bereich})`
        : `R'w,ges ${de(rwAussenIst)} dB unter erforderlich ${de(erf)} dB (Lärmpegelbereich ${bereich}) — Fassaden-/Fensteraufbau prüfen`,
    },
    {
      key: "trennwand",
      label: "Wohnungstrennwand R'w (Richtwert)",
      status: wandOk ? "pass" : "warn",
      detail: wandOk
        ? `R'w ${de(rwTrennIst)} dB ≥ Richtwert ${de(TRENN_RICHTWERTE.wand_wohnungstrennend)} dB`
        : `R'w ${de(rwTrennIst)} dB unter Richtwert ${de(TRENN_RICHTWERTE.wand_wohnungstrennend)} dB — Wandaufbau prüfen`,
    },
    {
      key: "trenndecke",
      label: "Wohnungstrenndecke R'w (Richtwert)",
      status: deckeOk ? "pass" : "warn",
      detail: deckeOk
        ? `R'w ${de(rwDeckeIst)} dB ≥ Richtwert ${de(TRENN_RICHTWERTE.decke_wohnungstrennend)} dB`
        : `R'w ${de(rwDeckeIst)} dB unter Richtwert ${de(TRENN_RICHTWERTE.decke_wohnungstrennend)} dB — Deckenaufbau prüfen`,
    },
    {
      key: "trittschall",
      label: "Trittschall L'n,w (Richtwert)",
      status: trittOk ? "pass" : "warn",
      detail: trittOk
        ? `${aufbau.label}: L'n,w ≈ ${de(aufbau.lnw)} dB ≤ ${de(TRITTSCHALL_GRENZE)} dB`
        : `${aufbau.label}: L'n,w ≈ ${de(aufbau.lnw)} dB über ${de(TRITTSCHALL_GRENZE)} dB — schwimmender Estrich / Entkopplung empfohlen`,
    },
    {
      key: "tga",
      label: "Anlagengeräusche TGA (Richtwert)",
      status: tgaOk ? "pass" : "warn",
      detail: tgaOk
        ? `${de(tgaPegel)} dB(A) ≤ ${de(TGA_GRENZE)} dB(A) in schutzbedürftigen Räumen`
        : `${de(tgaPegel)} dB(A) über Richtwert ${de(TGA_GRENZE)} dB(A) — Körperschallentkopplung / Aufstellort prüfen`,
    },
  ];

  if (num(dbA) > 75) {
    items.push({
      key: "hoherAussenlaerm",
      label: "Hoher Außenlärm (Hinweis)",
      status: "warn",
      detail: `Außenlärmpegel ${de(dbA)} dB(A) — hoher Außenlärm, Einzelfallnachweis durch Bauakustiker:in erforderlich`,
    });
  }

  const score = Math.round(
    safeDiv(items.filter((i) => i.status === "pass").length, items.length) * 100
  );
  const warns = items.filter((i) => i.status === "warn").length;
  const verdict = warns > 0 ? "Konzept mit Hinweisen" : "Konzept plausibel";
  return { items, score, warns, verdict };
}
