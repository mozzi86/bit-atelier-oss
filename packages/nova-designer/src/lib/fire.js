// Brandschutz — reine, deterministische Faustformel-Funktionen für die
// Konzept-/Vorplanungsphase (analog src/lib/hvac.js, src/lib/landscape.js und
// src/lib/statics.js).
// ALLE Werte sind bewusst Konzept-Richtwerte: KEIN prüffähiges Brandschutzkonzept,
// KEINE Abnahme, KEIN Nachweis nach Landesbauordnung — Erstellung und Abnahme durch
// Prüfsachverständige:r / Fachplaner:in Brandschutz und Bauaufsicht erforderlich.
// Normbezug (Orientierung): MBO §2 (Gebäudeklassen) / §§26–35 (Bauteile, Rettungswege),
// DIN 14675 & DIN VDE 0833-2 (Brandmeldeanlagen/BMZ), DIN 14095 (Feuerwehrpläne).
// ABGRENZUNG: Feuerwehr-Aufstellflächen & Zufahrten nach DIN 14090 liegen im
// Landschaft-Tab (src/lib/landscape.js) — hier NUR DIN 14095 (Feuerwehrpläne/Dokumente).
// Jede Division ist gegen 0/leer/negativ gehärtet (safeDiv), jede Eingabe defensiv
// coerced (num). OKF (Fußbodenoberkante höchstes Geschoss) wird NIE mit der
// Gesamthöhe verwechselt — fire.js rechnet nur mit dem übergebenen okf-Wert.

// Härtende Division: nie durch <0.1 teilen (gegen 0/leer/negativ).
const safeDiv = (a, b) => a / Math.max(0.1, b);
// Defensive, nicht-negative Zahl.
const num = (x) => Math.max(0, Number(x) || 0);
// de-DE-Zahlformat für Check-Detailtexte (ganzzahlig gerundet).
const de = (n) => Math.round(Number(n) || 0).toLocaleString("de-DE");

// --- Richtwert-Konstanten (Defaults, überschreibbar in der Komponente) ----------------

export const HOCHHAUS_GRENZE = 22;          // [ASSUMED A4] OKF-Grenze Hochhaus (m, MBO/HHR)
export const DEFAULT_MAX_FLUCHTWEG = 35;    // [ASSUMED A5] max. zul. Fluchtweglänge (m, Stichmaß)
export const DEFAULT_FLAECHE_JE_TR = 1600;  // [ASSUMED A6] Fläche je notw. Treppenraum (m²)
export const ANLEITER_TRAGBAR = 8;          // [ASSUMED A7] max. Brüstung tragbare Leiter (m)
export const ANLEITER_DREHLEITER = 23;      // [ASSUMED A7] max. Brüstung Drehleiter (m)
export const NE_GRENZE_GK = 400;            // [ASSUMED A2] NE-Grenze Gebäudeklasse (m²)
export const VERKAUFSSTAETTE_GRENZE = 800;  // [ASSUMED A11] Verkaufsfläche Sonderbau (m², NICHT 400)
export const DEFAULT_FLAECHE_JE_MELDER = 40; // [ASSUMED A9] Fläche je Melder (m², Band 25–40)

// Feuerwiderstand tragender Bauteile je Gebäudeklasse (MBO §§26–27). [ASSUMED A3]
export const FEUERWIDERSTAND = {
  1: "keine besonderen Anforderungen",
  2: "feuerhemmend (F30 / REI 30)",
  3: "feuerhemmend (F30 / REI 30)",
  4: "hochfeuerhemmend (F60 / REI 60)",
  5: "feuerbeständig (F90 / REI 90)",
};

// Schutzumfang Brandmeldeanlage (DIN 14675). faktor = überwachter BGF-Anteil. [ASSUMED A8]
export const SCHUTZUMFANG = {
  kat1: { label: "Kat. 1 — Vollschutz", faktor: 1.0 },
  kat2: { label: "Kat. 2 — Teilschutz", faktor: 0.4 },
  kat3: { label: "Kat. 3 — Schutz der Rettungswege", faktor: 0.15 },
  kat4: { label: "Kat. 4 — Einrichtungsschutz", faktor: 0.05 },
};

// Nutzungsarten (für Sonderbau-Trigger).
export const NUTZUNGEN = {
  wohnen: "Wohnen",
  buero: "Büro / Verwaltung",
  verkauf: "Verkauf",
  versammlung: "Versammlung",
  beherbergung: "Beherbergung",
  sonstige: "Sonstige",
};

// Art des 2. Rettungswegs (Anleiterung).
export const ANLEITER_ARTEN = {
  drehleiter: "Drehleiter (≤ 23 m)",
  tragbar: "tragbare Leiter (≤ 8 m)",
  nein: "nein (baulicher 2. RW)",
};

// Bestandteile Feuerwehrplan (DIN 14095). Reihenfolge/Keys verbindlich. [ASSUMED A12]
export const FEUERWEHRPLAN_BESTANDTEILE = {
  uebersichtsplan: "Übersichtsplan (Lageplan)",
  geschossplaene: "Geschosspläne",
  legende: "Legende/Symbole DIN 14034-6",
  laufkarten: "Feuerwehr-Laufkarten (bei BMA)",
  abstimmung: "Mit Brandschutzdienststelle abgestimmt",
};

// --- Faustformeln (reine Werte, Formatierung in der Komponente) -----------------------

// Gebäudeklasse (MBO §2 Abs. 3, vereinfachte Zuordnung). [ASSUMED A2]
// okf > 13 ⇒ GK 5; 7 < okf ≤ 13 ⇒ NE ≤ 400 ? 4 : 5;
// okf ≤ 7 ⇒ NE ≤ 400 ? (freistehend ? 1 : 2) : 3.
export function gebaeudeklasse({ okf = 0, groessteNE = 0, freistehend = false } = {}) {
  const h = num(okf);
  const ne = num(groessteNE);
  if (h > 13) return 5;
  if (h > 7) return ne <= NE_GRENZE_GK ? 4 : 5;
  if (ne <= NE_GRENZE_GK) return freistehend ? 1 : 2;
  return 3;
}

// Feuerwiderstand tragender Bauteile für eine Gebäudeklasse (Fallback GK 5).
export function feuerwiderstand(gk) {
  return FEUERWIDERSTAND[gk] || FEUERWIDERSTAND[5];
}

// Hochhaus, wenn OKF höchstes Aufenthaltsgeschoss > 22 m (nicht ≥). [ASSUMED A4]
export function istHochhaus(okf) {
  return num(okf) > HOCHHAUS_GRENZE;
}

// Notwendige Treppenräume: Mindestzahl (Hochhaus ⇒ 2, sonst Anleiterung ? 1 : 2),
// zusätzlich flächenabhängig (1 je flaecheJeTr). safeDiv härtet flaecheJeTr = 0.
export function erfTreppenraeume({ footArea = 0, hochhaus = false, anleiterOk = false, flaecheJeTr = DEFAULT_FLAECHE_JE_TR } = {}) {
  const mind = hochhaus ? 2 : (anleiterOk ? 1 : 2);
  return Math.max(mind, Math.ceil(safeDiv(num(footArea), num(flaecheJeTr))));
}

// Fluchtweg zulässig, wenn längste geschätzte ≤ max. zulässige Länge (Stichmaß).
export function fluchtwegOk(laengste, maxZul = DEFAULT_MAX_FLUCHTWEG) {
  return num(laengste) <= num(maxZul);
}

// 2. Rettungsweg über Anleiterung zulässig? tragbar ≤ 8 m, drehleiter ≤ 23 m,
// sonst ("nein"/unbekannt) false. [ASSUMED A7]
export function anleiterZulaessig(bruestung, art) {
  const b = num(bruestung);
  if (art === "tragbar") return b <= ANLEITER_TRAGBAR;
  if (art === "drehleiter") return b <= ANLEITER_DREHLEITER;
  return false;
}

// Überwachte Fläche der BMA = BGF · Schutzumfang-Faktor (DIN 14675).
export function schutzumfangFlaeche(bgf, kat) {
  return num(bgf) * (SCHUTZUMFANG[kat]?.faktor ?? 1.0);
}

// Melderanzahl-Überschlag = ceil(überwachte Fläche / Fläche je Melder). safeDiv gehärtet.
export function melderAnzahl(ueberwachteFlaeche, flaecheJeMelder = DEFAULT_FLAECHE_JE_MELDER) {
  return Math.ceil(safeDiv(num(ueberwachteFlaeche), num(flaecheJeMelder)));
}

// Sonderbau-Trigger (Hinweis, kein Nachweis): Hochhaus, Verkaufsstätte > 800 m²,
// Versammlungsstätte, Beherbergung, sowie NE > 400 m² außer Wohnen.
export function sonderbauTrigger({ okf = 0, nutzung = "wohnen", groessteNE = 0 } = {}) {
  const ne = num(groessteNE);
  const gruende = [];
  if (istHochhaus(okf)) gruende.push("Hochhaus (OKF über 22 m)");
  if (nutzung === "verkauf" && ne > VERKAUFSSTAETTE_GRENZE) {
    gruende.push(`Verkaufsstätte über ${de(VERKAUFSSTAETTE_GRENZE)} m²`);
  }
  if (nutzung === "versammlung") gruende.push("Versammlungsstätte");
  if (nutzung === "beherbergung") gruende.push("Beherbergungsstätte");
  if (nutzung !== "wohnen" && ne > NE_GRENZE_GK) {
    gruende.push(`Nutzungseinheit über ${de(NE_GRENZE_GK)} m² (Nicht-Wohnen)`);
  }
  return { ist: gruende.length > 0, gruende };
}

// Feuerwehrplan erforderlich, wenn BMA vorhanden oder Sonderbau vorliegt.
export function feuerwehrplanErforderlich(bma, sonderbau) {
  return Boolean(bma) || Boolean(sonderbau);
}

// Status Feuerwehrplan-Checkliste (DIN 14095): zählt erfüllte Bestandteile
// (Wert true oder "ja") gegen die Gesamtzahl der FEUERWEHRPLAN_BESTANDTEILE.
export function feuerwehrplanStatus(bestandteile = {}) {
  const keys = Object.keys(FEUERWEHRPLAN_BESTANDTEILE);
  const erfuellt = keys.filter((k) => bestandteile[k] === true || bestandteile[k] === "ja").length;
  const gesamt = keys.length;
  return { erfuellt, gesamt, vollstaendig: erfuellt === gesamt };
}

// Plausibilitäts-Checks (Konzept) — bewusst NUR "pass"/"warn", NIE "fail" (Haftung):
// Richtwerte dürfen nicht als prüffähiges Brandschutzkonzept / bestandene Abnahme
// erscheinen (T-18-04). Genau 7 Items.
export function brandChecks({
  okf = 0, groessteNE = 0, freistehend = false, nutzung = "wohnen",
  laengsteFlucht = 0, maxFluchtweg = DEFAULT_MAX_FLUCHTWEG,
  anleiterArt = "drehleiter", bruestung, flaecheJeTr = DEFAULT_FLAECHE_JE_TR,
  footArea = 0, bmaMode = "auto", schutzumfang = "kat1",
  ueberwachteFlaeche = 0, flaecheJeMelder = DEFAULT_FLAECHE_JE_MELDER,
  fwpMode = "auto", feuerwehrBestandteile = {},
} = {}) {
  const gk = gebaeudeklasse({ okf, groessteNE, freistehend });
  const hochhaus = istHochhaus(okf);
  const sb = sonderbauTrigger({ okf, nutzung, groessteNE });
  // Brüstungshöhe: 0/fehlend = „keine Angabe" — dann OKF als Näherung; fehlt auch die,
  // ist die Anleiterbarkeit NICHT bewertbar (kein stiller pass, HI-02).
  const bru = Number(bruestung) > 0 ? Number(bruestung) : num(okf);
  const bruErfasst = bru > 0;
  // Zwei getrennte Flags (ME-02): rw2Ok = Check-Ampel 2. Rettungsweg (baulich zählt als ok);
  // anleiterErsetztTreppe = nur echte Anleiterung reduziert die Treppenraum-Mindestzahl —
  // ein baulicher 2. RW ist i. d. R. gerade ein ZWEITER Treppenraum (mind = 2).
  const anleiterErsetztTreppe = anleiterArt !== "nein" && bruErfasst && anleiterZulaessig(bru, anleiterArt);
  const rw2Ok = anleiterArt === "nein" ? true : (bruErfasst && anleiterZulaessig(bru, anleiterArt));
  const erfTr = erfTreppenraeume({ footArea, hochhaus, anleiterOk: anleiterErsetztTreppe, flaecheJeTr });
  const bmaErforderlich = bmaMode === "auto" ? (hochhaus || sb.ist) : bmaMode === "ja";
  const fwpErf = fwpMode === "auto" ? feuerwehrplanErforderlich(bmaErforderlich, sb.ist) : fwpMode === "ja";
  const fwStatus = feuerwehrplanStatus(feuerwehrBestandteile);

  const items = [
    {
      key: "gk",
      label: "Gebäudeklasse & Feuerwiderstand (Richtwert)",
      status: num(okf) > 0 ? "pass" : "warn",
      detail: num(okf) > 0
        ? `Gebäudeklasse GK ${gk} — ${feuerwiderstand(gk)} (nur größte NE geprüft — Summe/Anzahl NE offen)`
        : "OKF / Geschosse pflegen (Gebäudemodell)",
    },
    {
      key: "hochhaus",
      label: "Hochhaus-Erkennung (Richtwert)",
      status: hochhaus ? "warn" : "pass",
      detail: hochhaus
        ? "Hochhaus (OKF > 22 m) — MHHR/Sonderbau-Verfahren, Prüfsachverständige:r erforderlich"
        : "kein Hochhaus (OKF ≤ 22 m)",
    },
    {
      key: "fluchtweg",
      label: "Fluchtweglänge (Konzept)",
      status: fluchtwegOk(laengsteFlucht, maxFluchtweg) ? "pass" : "warn",
      detail: fluchtwegOk(laengsteFlucht, maxFluchtweg)
        ? `längste ≈ ${de(laengsteFlucht)} m ≤ ${de(maxFluchtweg)} m zulässig`
        : `Fluchtweglänge ≈ ${de(laengsteFlucht)} m über zulässigem Stichmaß (${de(maxFluchtweg)} m)`,
    },
    {
      key: "rettungsweg2",
      label: "2. Rettungsweg (Konzept)",
      status: rw2Ok ? "pass" : "warn",
      detail: rw2Ok
        ? "2. Rettungsweg baulich/über Anleiterung zulässig"
        : (anleiterArt !== "nein" && !bruErfasst
          ? "Brüstungshöhe/OKF pflegen — Anleiterbarkeit nicht bewertbar"
          : "2. Rettungsweg über Anleiterung unzulässig — baulicher 2. Rettungsweg erforderlich"),
    },
    {
      key: "treppenraeume",
      label: "Notwendige Treppenräume (Richtwert)",
      status: num(footArea) > 0 ? "pass" : "warn",
      detail: num(footArea) > 0
        ? `${de(erfTr)} notwendige Treppenräume`
        : "Grundfläche/Gebäudemodell pflegen",
    },
    {
      key: "bma",
      label: "Brandmeldeanlage / BMZ (Richtwert)",
      status: !bmaErforderlich || (bmaErforderlich && schutzumfang) ? "pass" : "warn",
      detail: !bmaErforderlich
        ? "keine BMA-Pflicht abgeleitet"
        : (schutzumfang
          ? `BMA erforderlich — ${SCHUTZUMFANG[schutzumfang]?.label || schutzumfang}, ≈ ${de(melderAnzahl(ueberwachteFlaeche, flaecheJeMelder))} Melder`
          : "BMA erforderlich — Schutzumfang festlegen"),
    },
    {
      key: "feuerwehrplaene",
      label: "Feuerwehrpläne DIN 14095 (Konzept)",
      status: !fwpErf || (fwpErf && fwStatus.vollstaendig) ? "pass" : "warn",
      detail: !fwpErf
        ? "keine Feuerwehrpläne erforderlich"
        : (fwStatus.vollstaendig
          ? `Feuerwehrpläne vollständig (${fwStatus.erfuellt}/${fwStatus.gesamt})`
          : `${fwStatus.erfuellt}/${fwStatus.gesamt} Bestandteile — erstellen/mit Brandschutzdienststelle abstimmen`),
    },
  ];

  const score = Math.round((items.filter((i) => i.status === "pass").length / Math.max(1, items.length)) * 100);
  const warns = items.filter((i) => i.status === "warn").length;
  const verdict = warns > 0 ? "Konzept mit Hinweisen" : "Konzept plausibel";
  return { items, score, warns, verdict };
}

/**
 * Länge eines gezeichneten Fluchtwegs (Polylinie in Metern, {x,z}-Punkte der
 * Plan-Werkstatt / BimPlan2D-Ebene). <2 Punkte → 0. (Phase 34 Beispiel-Layer)
 */
export function fluchtwegLaenge(points) {
  if (!Array.isArray(points) || points.length < 2) return 0;
  let len = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    len += Math.hypot((Number(b?.x) || 0) - (Number(a?.x) || 0), (Number(b?.z) || 0) - (Number(a?.z) || 0));
  }
  return len;
}
