// ASR-Raumdatenblatt — reine, deterministische Katalog-/Regel-Funktionen für die
// Konzept-/Vorplanungsphase (analog src/lib/hvac.js und src/lib/fire.js).
// ALLE Werte sind bewusst Konzept-Richtwerte: KEIN arbeitsschutzrechtlicher Nachweis,
// KEINE Gefährdungsbeurteilung — Prüfung durch Fachkraft für Arbeitssicherheit /
// Betriebsarzt / zuständige Behörde erforderlich.
// Normbezug (Orientierung): ASR A3.4 (Beleuchtung), ASR A3.5 (Raumtemperatur /
// Hitzeschutz Sommerfall), ASR A3.6 (Lüftung), ASR A3.7 (Lärm), ASR A1.2
// (Bewegungsflächen).
// Einheiten: Beleuchtung lx, Raumtemperatur °C, Lüftung Luftwechsel 1/h,
// Lärm dB(A) Beurteilungspegel, Bewegungsfläche m.
// Alle Sollwerte sind [ASSUMED] und in der Komponente überschreibbar; null bedeutet
// "n. a." für die Nutzungsart (kein sinnvoller Sollwert, NICHT als Verstoß werten).
// Jede Division ist gegen 0/leer/negativ gehärtet (safeDiv), jede Eingabe defensiv
// coerced (num).

// Härtende Division: nie durch <0.1 teilen (gegen 0/leer/negativ).
const safeDiv = (a, b) => a / Math.max(0.1, b);
// Defensive, nicht-negative Zahl.
const num = (x) => Math.max(0, Number(x) || 0);
// de-DE-Zahlformat für Check-Detailtexte (ganzzahlig gerundet).
const de = (n) => Math.round(Number(n) || 0).toLocaleString("de-DE");

// --- Nutzungsart-Katalog (Defaults, überschreibbar in der Komponente) ------------------
// [ASSUMED A1] Beleuchtungs-Sollwerte lx je Nutzung (ASR A3.4): Flur/Lager ~100,
//              Sanitär/Pause/Technik ~200, Büro/Besprechung/Werkstatt/Labor ~500.
// [ASSUMED A2] Raumtemperatur °C je Tätigkeit (ASR A3.5): sitzend leicht 20,
//              stehend/gehend leicht 19, mittelschwer 17, Sozial-/Sanitärräume 21.
// [ASSUMED A3] Hitzeschutz Sommerfall hitzeschutz_c = 26 °C (ASR A3.5, alle Nutzungen).
// [ASSUMED A4] Luftwechselrate 1/h als Konzept-Basis (ASR A3.6 normiert Luftqualität,
//              keine feste Luftwechseltabelle) — bewusst überschreibbar.
// [ASSUMED A5] Lärm-Beurteilungspegel dB(A) (ASR A3.7): geistig ≤ 55, einfache /
//              mechanisierte Tätigkeit ≤ 70, sonstige ≤ 85.
export const NUTZUNGSARTEN = {
  buero:       { label: "Büro / Bildschirmarbeit",       beleuchtung_lx: 500, temp_soll_c: 20,   temp_min_c: 20,   hitzeschutz_c: 26, luftwechsel_1h: 4,    laerm_dbA: 55 },
  besprechung: { label: "Besprechung / Sitzung",         beleuchtung_lx: 500, temp_soll_c: 20,   temp_min_c: 20,   hitzeschutz_c: 26, luftwechsel_1h: 6,    laerm_dbA: 55 },
  lager:       { label: "Lager",                         beleuchtung_lx: 100, temp_soll_c: 17,   temp_min_c: 17,   hitzeschutz_c: 26, luftwechsel_1h: 2,    laerm_dbA: 85 },
  sanitaer:    { label: "Sanitär / WC / Waschraum",      beleuchtung_lx: 200, temp_soll_c: 21,   temp_min_c: 21,   hitzeschutz_c: 26, luftwechsel_1h: null, laerm_dbA: null },
  verkehr:     { label: "Verkehrsweg / Flur",            beleuchtung_lx: 100, temp_soll_c: 19,   temp_min_c: 19,   hitzeschutz_c: 26, luftwechsel_1h: null, laerm_dbA: null },
  werkstatt:   { label: "Werkstatt / leichte Tätigkeit", beleuchtung_lx: 500, temp_soll_c: 19,   temp_min_c: 19,   hitzeschutz_c: 26, luftwechsel_1h: 4,    laerm_dbA: 70 },
  labor:       { label: "Labor",                         beleuchtung_lx: 500, temp_soll_c: 20,   temp_min_c: 20,   hitzeschutz_c: 26, luftwechsel_1h: 8,    laerm_dbA: 70 },
  technik:     { label: "Technik (HLS / ELT)",           beleuchtung_lx: 200, temp_soll_c: null, temp_min_c: null, hitzeschutz_c: 26, luftwechsel_1h: null, laerm_dbA: 85 },
  pause:       { label: "Pausenraum / Kantine",          beleuchtung_lx: 200, temp_soll_c: 21,   temp_min_c: 21,   hitzeschutz_c: 26, luftwechsel_1h: 6,    laerm_dbA: 55 },
  sonstige:    { label: "Sonstige (neutral)",            beleuchtung_lx: 300, temp_soll_c: 20,   temp_min_c: 20,   hitzeschutz_c: 26, luftwechsel_1h: 4,    laerm_dbA: 70 },
};

// Sollwerte für eine Nutzungsart; Fallback "sonstige" bei unbekanntem Key.
export const sollwerteFuer = (nutzung) => NUTZUNGSARTEN[nutzung] || NUTZUNGSARTEN.sonstige;

// Stabiler per-Raum-Schlüssel (Pitfall 4: nicht Index-keyed; Kollision bei
// Namensgleichheit im selben Geschoss dokumentiert — Nutzer:in benennt um).
export const roomKey = (z) => `${z?.level ?? 0}:${z?.name ?? "Raum"}`;

// --- Belegung (ASR-03) ------------------------------------------------------------------

// [ASSUMED A6] Belegungsäquivalent = Arbeitsplätze (dauerhaft, bis 8h) · 1,0
//              + Arbeitsgelegenheiten (bis 3h) · 0,5.
export const belegungsAequivalent = (arbeitsplaetze, arbeitsgelegenheiten) =>
  num(arbeitsplaetze) + num(arbeitsgelegenheiten) * 0.5;

// Fläche je Belegungsäquivalent (m²/Pers.-Äq.) — safeDiv: endlich auch bei 0 Belegung.
export const flaecheJeAequivalent = (flaeche, aequivalent) =>
  safeDiv(num(flaeche), num(aequivalent));

// --- Konformitäts-Checkliste (ASR-05) ----------------------------------------------------

// Plausibilitäts-Checks (Konzept) — status bewusst NUR "pass" | "warn" | "offen",
// NIE "fail" (Haftung: keine automatische "nicht konform"-Rechtsbewertung).
// Ampel: pass = grün, warn = gelb, neutral = offen — NIE Auto-Rot.
export function asrChecks(room, soll = {}, ist = {}) {
  const items = [];

  // 1. Hitzeschutz Sommerfall (ASR A3.5): Sollwert über 26 °C nur als Hinweis.
  // Fehlender Sollwert = „offen" (analog Beleuchtung) — kein „0 °C eingehalten"-pass (ME-06).
  const hitzeGesetzt = soll.hitzeschutz_c != null && soll.hitzeschutz_c !== "";
  items.push({
    key: "hitzeschutz",
    label: "Hitzeschutz Sommerfall (ASR A3.5)",
    status: !hitzeGesetzt ? "offen" : num(soll.hitzeschutz_c) > 26 ? "warn" : "pass",
    detail: !hitzeGesetzt
      ? "Hitzeschutz-Sollwert (A3.5) pflegen"
      : num(soll.hitzeschutz_c) > 26
        ? "Hitzeschutz-Sollwert über 26 °C (Sommerfall ASR A3.5)"
        : `Hitzeschutz-Sollwert ${de(soll.hitzeschutz_c)} °C — Sommerfall-Orientierung 26 °C eingehalten`,
  });

  // 2. Beleuchtung (ASR A3.4): Sollwert gepflegt?
  items.push({
    key: "beleuchtung",
    label: "Beleuchtung (ASR A3.4)",
    status: num(soll.beleuchtung_lx) > 0 ? "pass" : "offen",
    detail: num(soll.beleuchtung_lx) > 0
      ? `Sollwert ${de(soll.beleuchtung_lx)} lx (Richtwert)`
      : "Beleuchtungs-Sollwert (A3.4) pflegen",
  });

  // 3. Raumtemperatur (ASR A3.5): nur prüfen, wenn für die Nutzungsart relevant (nicht null).
  if (soll.temp_soll_c != null) {
    items.push({
      key: "temperatur",
      label: "Raumtemperatur (ASR A3.5)",
      status: num(soll.temp_soll_c) > 0 ? "pass" : "offen",
      detail: num(soll.temp_soll_c) > 0
        ? `Heizung Soll ${de(soll.temp_soll_c)} °C (Richtwert)`
        : "Temperatur-Sollwert (A3.5) pflegen",
    });
  }

  // 4. Lärm (ASR A3.7): nur prüfen, wenn für die Nutzungsart relevant (nicht null).
  if (soll.laerm_dbA != null) {
    items.push({
      key: "laerm",
      label: "Lärm / Beurteilungspegel (ASR A3.7)",
      status: num(soll.laerm_dbA) > 0 ? "pass" : "offen",
      detail: num(soll.laerm_dbA) > 0
        ? `Beurteilungspegel ${de(soll.laerm_dbA)} dB(A) (Richtwert)`
        : "Lärm-Sollwert (A3.7) pflegen",
    });
  }

  // 5. Manuelle ASR-Konformität (ja/nein/offen) — Nutzer-Urteil, keine Auto-Bewertung.
  const konf = ist?.konformitaet;
  items.push({
    key: "konformitaet",
    label: "ASR-Konformität (manuelle Einschätzung)",
    status: konf === "ja" ? "pass" : konf === "nein" ? "warn" : "offen",
    detail: konf === "ja"
      ? "manuell als konform (Konzept) markiert"
      : konf === "nein"
        ? "manuell als nicht konform markiert"
        : "Konformität noch offen — Einschätzung ja/nein/offen treffen",
  });

  const offen = items.filter((i) => i.status === "offen").length;
  const warns = items.filter((i) => i.status === "warn").length;
  const ampel = offen > 0 ? "neutral" : warns > 0 ? "warn" : "pass";
  return { items, ampel, offen, warns };
}

// --- ASR-Checkliste je Raum (Vorlage aus einem Referenzprojekt, anonymisiert) ------------

// [ASSUMED A8] Checklisten-Katalog nach der Realprojekt-Vorlage: gruppierte Prüfzeilen
// mit ASR-Referenz, Titel und Erläuterung. Inhaltlich orientiert an ASR V3/V3a.2,
// A1.2/A1.3/A1.5–A1.8, A2.1–A2.3, A3.4–A3.7, A4.1–A4.4 sowie DIN 18040-1 und
// DGUV 215-410 — Konzept-Orientierung, KEIN arbeitsschutzrechtlicher Nachweis.
// `nurSanitaer: true` = Zeile erscheint nur bei Nutzungsart "sanitaer".
// Status je Zeile in der Komponente: "ok" (erfüllt) | "offen" | "nz" (nicht zutreffend).
export const ASR_CHECKLISTE = [
  { gruppe: "GRUNDLAGEN" },
  { ref: "ASR V3",      titel: "Gefährdungsbeurteilung",                 hinweis: "Gefährdungsbeurteilung für die Arbeitsstätte erstellt und dokumentiert." },
  { ref: "ASR V3a.2",   titel: "Barrierefreie Gestaltung",               hinweis: "Bei Beschäftigung von Menschen mit Behinderung: Türen ≥ 0,90 m, Flure ≥ 1,50 m, Bewegungsfläche 1,50 × 1,50 m, Rampen ≤ 6 %." },
  { ref: "DIN 18040-1", titel: "Barrierefreies Bauen (öffentlich)",      hinweis: "Türen ≥ 0,90 m, Flure ≥ 1,50 m, Aufzug ≥ 1,10 × 1,40 m, Bedienelemente 0,85 m hoch, Kontraste, 2-Sinne-Prinzip." },
  { gruppe: "BEWEGUNGSFLÄCHEN & BAUELEMENTE" },
  { ref: "ASR A1.2",    titel: "Raumabmessungen & Bewegungsflächen",     hinweis: "Arbeitsraum ≥ 8 m²; freie Bewegungsfläche je Arbeitsplatz ≥ 1,50 m² (Tiefe/Breite ≥ 1,00 m); lichte Höhe ≥ 2,50 m (≤ 50 m²)." },
  { ref: "ASR A1.3",    titel: "Sicherheitskennzeichnung",               hinweis: "Flucht-/Rettungszeichen, Verbots-/Warnschilder, Brandschutzkennzeichnung normgerecht angebracht." },
  { ref: "ASR A1.5",    titel: "Fußböden",                               hinweis: "Eben, trittsicher, rutschhemmend, keine Stolperstellen; Bodenöffnungen gesichert." },
  { ref: "ASR A1.6",    titel: "Fenster, Oberlichter, Glaswände",        hinweis: "Sicher zu reinigen/bedienen; Sichtverbindung nach außen; Absturzsicherung an Fenstern." },
  { ref: "ASR A1.7",    titel: "Türen & Tore",                           hinweis: "Glastüren markiert; kraftbetätigte Tore gesichert; Brandschutztüren selbstschließend, nicht verkeilt." },
  { ref: "ASR A1.8",    titel: "Verkehrswege",                           hinweis: "Lichte Breite nach Personenzahl (0,875–2,40 m); lichte Höhe ≥ 2,00 m; frei von Hindernissen." },
  { gruppe: "SCHUTZ & FLUCHT" },
  { ref: "ASR A2.1",    titel: "Schutz vor Absturz",                     hinweis: "Umwehrung/Geländer bei Absturzhöhe > 1,00 m; Treppen mit Handlauf; Brüstungshöhe ≥ 1,00 m." },
  { ref: "ASR A2.2",    titel: "Maßnahmen gegen Brände",                 hinweis: "Feuerlöscher in max. 20 m Wegstrecke; Brandschutzordnung; Löschmittel geeignet und geprüft." },
  { ref: "ASR A2.3",    titel: "Fluchtwege & Notausgänge",               hinweis: "Fluchtweglänge ≤ 35 m; Breite nach Personenzahl; 1. + 2. Fluchtweg; Türen in Fluchtrichtung; Flucht-/Rettungsplan." },
  { gruppe: "RAUMKLIMA" },
  { ref: "ASR A3.5",    titel: "Raumtemperatur",                         hinweis: "Bürotätigkeit: Lufttemperatur 20–22 °C, max. 26 °C (höher nur kurzfristig mit Maßnahmen)." },
  { ref: "ASR A3.6",    titel: "Lüftung",                                hinweis: "Ausreichend gesundheitlich zuträgliche Atemluft (freie oder RLT-Lüftung); CO₂-Niveau begrenzt." },
  { gruppe: "BELEUCHTUNG" },
  { ref: "ASR A3.4",    titel: "Beleuchtung & Sichtverbindung",          hinweis: "Büro ≥ 500 lx; Tageslicht/Sichtverbindung nach außen; Lichteintrittsfläche ≈ ≥ 1/10 der Raumgrundfläche." },
  { ref: "ASR A3.4/7",  titel: "Sicherheitsbeleuchtung / Leitsystem",    hinweis: "Sicherheitsbeleuchtung und optisches Sicherheitsleitsystem wo erforderlich (notwendige Flure, fensterlose Bereiche)." },
  { gruppe: "LÄRM" },
  { ref: "ASR A3.7",    titel: "Lärm",                                   hinweis: "Büro/überwiegend geistige Tätigkeit: Beurteilungspegel ≤ 55 dB(A); Mehrpersonenbüro ≤ 70 dB(A)." },
  { gruppe: "SOZIALEINRICHTUNGEN" },
  { ref: "ASR A4.1",    titel: "Sanitärräume",                           hinweis: "Toiletten getrennt nach Geschlecht, Anzahl nach Beschäftigtenzahl; Wasch-/Toilettenraum nah und gut erreichbar.", nurSanitaer: true },
  { ref: "ASR A4.2",    titel: "Pausen- & Bereitschaftsräume",           hinweis: "Bei > 10 Beschäftigten Pausenraum: ≥ 6 m², ≥ 1 m² je gleichzeitig anwesender Person, Sitzgelegenheiten." },
  { ref: "ASR A4.3",    titel: "Erste-Hilfe",                            hinweis: "Verbandkasten erreichbar und gekennzeichnet; ab 1000 Beschäftigten/erhöhter Gefährdung: Erste-Hilfe-Raum." },
  { gruppe: "ERGÄNZEND (KEINE ASR — EMPFEHLUNG)" },
  { ref: "DGUV 215-410", titel: "Bildschirm-/Büroarbeitsplatz",          hinweis: "Arbeitstisch ≥ 1,60 × 0,80 m (Empfehlung); Beinraum ≥ 0,85 m breit und ≥ 0,65 m hoch. Keine ASR-Pflicht, anerkannte Regel der Technik." },
];

// Checkliste für eine Nutzungsart: Sanitär-Zeilen (und deren Gruppen-Header, falls leer)
// nur bei Nutzungsart "sanitaer" — sonst ausblenden. Leere Gruppen werden entfernt.
export function checklistFuer(nutzung) {
  const rows = ASR_CHECKLISTE.filter((r) => !r.nurSanitaer || nutzung === "sanitaer");
  // Gruppen-Header ohne nachfolgende Punkte entfernen.
  return rows.filter((r, i) => !r.gruppe || (rows[i + 1] && !rows[i + 1].gruppe));
}

// Abgeleitete Konformität aus den Checklisten-Ständen (Vorlage-Logik):
// irgendein Punkt "offen" → "offen"; ALLE Punkte beantwortet und keiner offen
// (n. z. zählt nicht gegen) und mindestens einer "ok" → "ja"; sonst "offen".
// Bewusst NIE "nein" automatisch (Haftung — analog asrChecks: kein Auto-Rot).
export function konformitaetAusCheckliste(status = {}, punkte = []) {
  const refs = punkte.filter((p) => p.ref).map((p) => p.ref);
  if (refs.length === 0) return "offen";
  if (refs.some((r) => status[r] === "offen")) return "offen";
  const beantwortet = refs.every((r) => status[r] === "ok" || status[r] === "nz");
  const hatOk = refs.some((r) => status[r] === "ok");
  return beantwortet && hatOk ? "ja" : "offen";
}

// --- Bewegungsfläche (ASR A1.2, Draufsicht) ----------------------------------------------

// [ASSUMED A7] Freizuhaltende Bewegungsfläche Benutzerseite 1,00 m tief (ASR A1.2).
// Bounding-Box-Band an einer Raumseite — reine Konzept-Geometrie, KEINE Möbel.
// Rückgabe {x, z, w, d} in Metern; d === tiefe für nord/sued, w === tiefe für ost/west.
export function bewegungsflaeche(points, tiefe = 1.0, seite = "sued") {
  if (!points || points.length < 3) return null;
  const xs = points.map((p) => p.x);
  const zs = points.map((p) => p.z);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const t = Math.max(0, Number(tiefe) || 0);
  switch (seite) {
    case "nord": return { x: minX, z: minZ, w: maxX - minX, d: t };
    case "sued": return { x: minX, z: maxZ - t, w: maxX - minX, d: t };
    case "west": return { x: minX, z: minZ, w: t, d: maxZ - minZ };
    default:     return { x: maxX - t, z: minZ, w: t, d: maxZ - minZ }; // ost
  }
}
