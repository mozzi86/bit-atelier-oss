// Förderprogramme — reine, deterministische Konzept-Funktionen für die
// Frühphase (analog src/lib/fire.js und src/lib/accessibility.js, self-contained,
// KEINE @/-Imports). ALLE Katalogwerte sind bewusst [ASSUMED]-Orientierungswerte:
// KEINE Förderrechts-/Rechtsberatung, KEIN Nachweis der Förderfähigkeit —
// verbindlich sind allein die aktuellen Programmbedingungen der Fördergeber
// (KfW, BAFA, Land, Kommune). Sätze/Deckel sind in der Komponente überschreibbar.
// Jede Eingabe wird defensiv coerced (num), Divisionen sind gehärtet (safeDiv).
// fristStatus ist deterministisch: „heute" kommt IMMER als Parameter herein —
// kein Date.now()/new Date() in dieser Lib (nur die Komponente erzeugt „heute").

// Härtende Division: nie durch <0.1 teilen (gegen 0/leer/negativ).
const safeDiv = (a, b) => a / Math.max(0.1, b);
// Defensive, nicht-negative Zahl.
const num = (x) => Math.max(0, Number(x) || 0);
// de-DE-Zahlformat für Check-Detailtexte (ganzzahlig gerundet).
const de = (n) => Math.round(Number(n) || 0).toLocaleString("de-DE");

// --- Programmkatalog (Konzept-Defaults, überschreibbar) -------------------------------
// typ: "zuschuss" (nicht rückzahlbar) | "kredit" (satz_pct ≈ Zinsvorteil-Äquivalent)
//      | "pflicht" (Kunst am Bau: kein Zuschuss, sondern übliche Verpflichtung).
// satz_pct: Fördersatz in % der förderfähigen Kosten (null = kein pauschaler Satz).
// max_betrag: Deckel in € (null = ohne Deckel).
export const PROGRAMM_KATALOG = {
  kfw_beg_wg: {
    label: "KfW / BEG Wohngebäude",
    traeger: "KfW",
    typ: "kredit",
    satz_pct: 5,          // [ASSUMED A1] Zinsvorteil-Äquivalent ≈ 5 % der förderfähigen Kosten
    max_betrag: 150000,   // [ASSUMED A1] Kredithöchstbetrag je Wohneinheit
    hinweis: "Förderkredit für Effizienzhaus-Neubau/-Sanierung; Satz als Zinsvorteil-Äquivalent angesetzt.",
  },
  beg_em: {
    label: "BEG Einzelmaßnahmen",
    traeger: "BAFA",
    typ: "zuschuss",
    satz_pct: 15,         // [ASSUMED A2] Basiszuschuss Einzelmaßnahmen (Gebäudehülle/Anlagentechnik)
    max_betrag: 60000,    // [ASSUMED A2] förderfähige Kosten-Deckelung je Wohneinheit/Jahr
    hinweis: "Zuschuss für Einzelmaßnahmen an Hülle und Anlagentechnik (BEG EM).",
  },
  kfw_kfn: {
    label: "KfW Klimafreundlicher Neubau",
    traeger: "KfW",
    typ: "kredit",
    satz_pct: null,       // [ASSUMED A3] kein pauschaler Satz — zinsverbilligter Kredit
    max_betrag: 100000,   // [ASSUMED A3] Kredithöchstbetrag je Wohneinheit
    hinweis: "Zinsverbilligter Kredit für klimafreundlichen Neubau (KFN/QNG-Kontext).",
  },
  bafa_heizung: {
    label: "BAFA Heizungsförderung",
    traeger: "BAFA / KfW",
    typ: "zuschuss",
    satz_pct: 30,         // [ASSUMED A4] Grundförderung Heizungstausch (Boni möglich)
    max_betrag: 21000,    // [ASSUMED A4] 30 % von max. 30.000 € förderfähigen Kosten + Boni-Reserve
    hinweis: "Zuschuss für Heizungstausch (Wärmepumpe, Biomasse, Fernwärme-Anschluss).",
  },
  landesprogramm: {
    label: "Landesprogramm (generisch)",
    traeger: "Land",
    typ: "zuschuss",
    satz_pct: 10,         // [ASSUMED A5] generischer Landeszuschuss-Satz
    max_betrag: null,     // [ASSUMED A5] ohne Deckel (programmabhängig)
    hinweis: "Platzhalter für landesspezifische Programme (z. B. Wohnraumförderung) — Werte anpassen.",
  },
  kommunal: {
    label: "Kommunale Förderung (generisch)",
    traeger: "Kommune",
    typ: "zuschuss",
    satz_pct: 5,          // [ASSUMED A6] generischer kommunaler Zuschuss-Satz
    max_betrag: 50000,    // [ASSUMED A6] typischer kommunaler Deckel
    hinweis: "Platzhalter für kommunale Programme (z. B. Begrünung, PV, Stellplatzablöse-Bonus).",
  },
  kunst_am_bau: {
    label: "Kunst am Bau",
    traeger: "Bund / Land (Bauherr)",
    typ: "pflicht",
    satz_pct: 1,          // [ASSUMED A7] üblicher %-Satz der Bausumme (Band 0,5–2 %)
    max_betrag: null,
    hinweis: "Bei öffentlichen Bauvorhaben üblich; %-Satz der Bausumme (0,5–2 %), RBBau-Kontext — keine Förderung, sondern einzuplanende Verpflichtung.",
  },
};

// Typ-Labels für Badges/Anzeigen.
export const TYP_LABEL = {
  zuschuss: "Zuschuss",
  kredit: "Kredit",
  pflicht: "Pflicht/Regelung",
};

// Antragsstatus (Entität FoerderAntrag.status) — Reihenfolge = Workflow.
export const ANTRAG_STATUS = {
  geplant: "geplant",
  eingereicht: "eingereicht",
  bewilligt: "bewilligt",
  abgelehnt: "abgelehnt",
};

// Kunst-am-Bau-%-Band (Slider/NumberField-Grenzen in der Komponente). [ASSUMED A7]
export const KUNST_PCT_MIN = 0.5;
export const KUNST_PCT_MAX = 2;
export const KUNST_PCT_DEFAULT = 1;

// --- Faustformeln (reine Werte, Formatierung in der Komponente) -----------------------

// Fördersummen-Schätzung: förderfähige Kosten × Satz, gedeckelt auf max_betrag
// (null/leer = ohne Deckel). Ergebnis immer endlich und ≥ 0.
export function foerderSchaetzung(kosten, satzPct, maxBetrag) {
  const basis = safeDiv(num(kosten) * num(satzPct), 100);
  const deckel = (maxBetrag === null || maxBetrag === undefined || maxBetrag === "")
    ? Infinity
    : num(maxBetrag);
  const v = Math.min(basis, deckel);
  return Number.isFinite(v) ? Math.max(0, v) : 0;
}

// FU-01: Degressive Staffel des Bundes nach Bauwerkskosten (KG 300+400).
// [CITED] BMWSB „Verbindliche Vorgaben zu Kunst am Bau" A 3.7, Stand 07/2024:
// < 20 Mio € → 1,5 % · 20 bis 100 Mio € → 1,0 % · > 100 Mio € → 0,5 %.
// Grenzen inklusiv nach unten gelesen: genau 20 Mio ⇒ 1,0 %, genau 100 Mio ⇒ 1,0 %.
// Grenzen exakt nach Wortlaut: „unter 20 Mio" ist ausschließend, „20 bis 100 Mio"
// schließt BEIDE Enden ein, „über 100 Mio" ist ausschließend. Deshalb je Stufe ein
// eigenes Prädikat statt einer gemeinsamen `<`-Kette (genau 100 Mio ⇒ 1,0 %).
export const KUNST_STAFFEL = [
  { pct: 1.5, label: "unter 20 Mio. € Bauwerkskosten", trifft: (k) => k < 20_000_000 },
  { pct: 1.0, label: "20 bis 100 Mio. € Bauwerkskosten", trifft: (k) => k >= 20_000_000 && k <= 100_000_000 },
  { pct: 0.5, label: "über 100 Mio. € Bauwerkskosten", trifft: (k) => k > 100_000_000 },
];

// Vorschlags-Satz aus der Staffel. Gibt null zurück, wenn keine Bauwerkskosten
// vorliegen — kein stiller Default, damit das Panel „nicht ermittelbar" zeigen kann.
export function kunstAmBauSatzVorschlag(bauwerkskosten) {
  const k = num(bauwerkskosten);
  if (!(k > 0)) return null;
  const stufe = KUNST_STAFFEL.find((s) => s.trifft(k));
  return stufe ? { pct: stufe.pct, label: stufe.label } : null;
}

// Kunst-am-Bau-Betrag = Bausumme × %-Satz. Ohne expliziten Satz wird der
// Staffel-Vorschlag verwendet, sonst der Default (Bund-Staffel schlägt Pauschale).
export function kunstAmBauBetrag(bausumme, pct) {
  const vorschlag = kunstAmBauSatzVorschlag(bausumme);
  const satz = pct === null || pct === undefined || pct === ""
    ? (vorschlag ? vorschlag.pct : KUNST_PCT_DEFAULT)
    : num(pct);
  return safeDiv(num(bausumme) * satz, 100);
}

// Frist-Status — DETERMINISTISCH: „heute" kommt als ISO-String herein (Pflicht-
// parameter, kein Date.now hier). Vergleich auf Datums-Ebene (Zeitanteil wird
// abgeschnitten): keine Frist/unparsebar → "keine"; überschritten → "abgelaufen";
// < 30 Tage → "bald"; sonst → "ok".
export const FRIST_WARN_TAGE = 30; // [ASSUMED A8] Vorwarnzeit „Frist bald"
export function fristStatus(fristIso, heuteIso) {
  if (!fristIso || !heuteIso) return "keine";
  const f = Date.parse(String(fristIso).slice(0, 10));
  const h = Date.parse(String(heuteIso).slice(0, 10));
  if (!Number.isFinite(f) || !Number.isFinite(h)) return "keine";
  const tage = Math.floor((f - h) / 86400000);
  if (tage < 0) return "abgelaufen";
  if (tage < FRIST_WARN_TAGE) return "bald";
  return "ok";
}

// Plausibilitäts-Checks (Konzept) — bewusst NUR "pass"/"warn", NIE "fail"
// (Haftung: Orientierungswerte dürfen nicht als geprüfte Förderfähigkeit oder
// verpasste Rechtspflicht erscheinen). Genau 3 Items.
// antraege: Array von FoerderAntrag-Objekten ({programm_key, foerderfaehige_kosten,
// frist, status, …}); ctx: {oeffentlich, bausumme}; heuteIso: ISO-Datum (Pflicht).
export function fundingChecks(antraege = [], { oeffentlich = false, bausumme = 0 } = {}, heuteIso) {
  const liste = Array.isArray(antraege) ? antraege : [];

  // Kunst am Bau: bei öffentlichem Bauherrn sollte ein Eintrag erfasst sein.
  const kunstErfasst = liste.some((a) => a?.programm_key === "kunst_am_bau");

  // Fristen: nur OFFENE Anträge (geplant/eingereicht) zählen — bewilligt/abgelehnt
  // sind entschieden, eine abgelaufene Frist ist dort kein Hinweis mehr. [ASSUMED A8]
  const offen = liste.filter((a) => a?.status === "geplant" || a?.status === "eingereicht");
  const kritisch = offen.filter((a) => {
    const s = fristStatus(a?.frist, heuteIso);
    return s === "bald" || s === "abgelaufen";
  });

  // Kosten: Anträge ohne förderfähige Kosten (0/leer) sind nicht schätzbar.
  const ohneKosten = liste.filter((a) => num(a?.foerderfaehige_kosten) <= 0);

  const items = [
    {
      key: "kunst_am_bau",
      label: "Kunst am Bau (RBBau-Kontext)",
      status: oeffentlich && !kunstErfasst ? "warn" : "pass",
      detail: !oeffentlich
        ? "kein öffentlicher Bauherr — keine Kunst-am-Bau-Regelung abgeleitet"
        : (() => {
          // FU-01: Satz aus der Bundes-Staffel nennen, nicht pauschal „1 %" bzw. „0,5–2 %".
          const st = kunstAmBauSatzVorschlag(bausumme);
          const satzText = st
            ? `${st.pct.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} % (${st.label})`
            : "Satz nicht ermittelbar — Bauwerkskosten fehlen";
          const betrag = st ? `Richtwert ≈ ${de(kunstAmBauBetrag(bausumme))} € bei ${satzText}` : satzText;
          return kunstErfasst
            ? `Kunst am Bau erfasst (${betrag})`
            : `Öffentlicher Bauherr — Kunst am Bau prüfen und als Antrag/Position erfassen (${betrag})`;
        })(),
    },
    {
      key: "fristen",
      label: "Antragsfristen (Konzept)",
      status: kritisch.length > 0 ? "warn" : "pass",
      detail: kritisch.length > 0
        ? `${de(kritisch.length)} offene${kritisch.length === 1 ? "r Antrag" : " Anträge"} mit Frist bald/abgelaufen — Einreichung prüfen`
        : (offen.length > 0
          ? `keine kritischen Fristen bei ${de(offen.length)} offenen Anträgen`
          : "keine offenen Anträge mit Fristen"),
    },
    {
      key: "kosten",
      label: "Förderfähige Kosten je Antrag",
      status: ohneKosten.length > 0 ? "warn" : "pass",
      detail: ohneKosten.length > 0
        ? `${de(ohneKosten.length)} ${ohneKosten.length === 1 ? "Antrag" : "Anträge"} ohne förderfähige Kosten — Schätzung nicht möglich, Beträge pflegen`
        : (liste.length > 0
          ? `alle ${de(liste.length)} Anträge mit förderfähigen Kosten hinterlegt`
          : "noch keine Anträge erfasst"),
    },
  ];

  const score = Math.round((items.filter((i) => i.status === "pass").length / Math.max(1, items.length)) * 100);
  const warns = items.filter((i) => i.status === "warn").length;
  const verdict = warns > 0 ? "Konzept mit Hinweisen" : "Konzept plausibel";
  return { items, score, warns, verdict };
}
