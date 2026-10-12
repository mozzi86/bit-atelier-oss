// sige.js — health & safety basics on construction sites (SiGe, 88-07, RE-06) under the
// Baustellenverordnung (BaustellV 1998, last amended 2023), decision D-RE-04: FORMS AND HINTS
// ONLY. The app prepares the prior notice (Vorankündigung, § 2 Abs. 2 + Anhang I) as a draft,
// shows the especially dangerous works of Anhang II as hints per trade and says when a
// coordinator (SiGeKo) must be appointed. It takes over no coordination task and no
// liability — the duties stay with the client (Bauherr) and the appointed coordinator.
//
// Data contract — entity `SiGe` (one record per project, schemaless, new):
//   {project_id, ort, bauherr, art, dritter, koordinator, beginn (ISO date), dauer_text,
//    arbeitstage, max_beschaeftigte, personentage, arbeitgeber_anzahl, ausgewaehlte,
//    gefaehrdungen: {"1": {zutreffend: true|false|null, notiz}, … "10": …}}
//
// In:  the record, the project's trades (ScheduleTask.trade). Out: duties (hints), matrix,
//      PDF bytes. Pure apart from the PDF builder's dynamic import of jspdf.

/**
 * Fields of the prior notice after BaustellV Anhang I (numbering as in the annex).
 * `key` = field of the SiGe record; `label` = German text (printed and i18n key).
 * @type {ReadonlyArray<{nr: number, key: string, label: string}>}
 */
export const ANHANG_I = Object.freeze([
  { nr: 1, key: "ort", label: "Ort der Baustelle" },
  { nr: 2, key: "bauherr", label: "Name und Anschrift des Bauherrn" },
  { nr: 3, key: "art", label: "Art des Bauvorhabens" },
  { nr: 4, key: "dritter", label: "Name und Anschrift des anstelle des Bauherrn verantwortlichen Dritten" },
  { nr: 5, key: "koordinator", label: "Name und Anschrift des Koordinators" },
  { nr: 6, key: "beginn_dauer", label: "Voraussichtlicher Beginn und voraussichtliche Dauer der Arbeiten" },
  { nr: 7, key: "max_beschaeftigte", label: "Voraussichtliche Höchstzahl der Beschäftigten auf der Baustelle" },
  { nr: 8, key: "arbeitgeber_anzahl", label: "Zahl der Arbeitgeber und Unternehmer ohne Beschäftigte, die voraussichtlich tätig werden" },
  { nr: 9, key: "ausgewaehlte", label: "Angabe der bereits ausgewählten Arbeitgeber und Unternehmer ohne Beschäftigte" },
]);

/**
 * Especially dangerous works after BaustellV Anhang II (short German texts, labels double as
 * i18n keys) and trade keywords that typically involve them. The keywords are an [ASSUMED]
 * rule of thumb to point at rows worth checking — not a risk assessment.
 * @type {ReadonlyArray<{nr: number, label: string, stichworte: RegExp}>}
 */
export const ANHANG_II = Object.freeze([
  { nr: 1, label: "Absturz aus mehr als 7 m, Verschütten in Gruben/Gräben tiefer als 5 m, Versinken", stichworte: /rohbau|erd|tief|dach|fassade|gerüst|abbruch|rückbau|stahlbau|zimmer/i },
  { nr: 2, label: "Biologische Arbeitsstoffe Risikogruppe 3/4, krebserzeugende oder erbgutverändernde Stoffe", stichworte: /abbruch|rückbau|schadstoff|asbest|sanierung|altlast/i },
  { nr: 3, label: "Ionisierende Strahlung mit Kontroll- oder Überwachungsbereich", stichworte: /strahl|röntgen/i },
  { nr: 4, label: "Arbeiten in weniger als 5 m Abstand von Hochspannungsleitungen", stichworte: /kran|freileitung|elektro.*hoch|tiefbau/i },
  { nr: 5, label: "Unmittelbare Gefahr des Ertrinkens", stichworte: /wasserbau|brücke|ufer|spund/i },
  { nr: 6, label: "Brunnenbau, unterirdische Erdarbeiten, Tunnelbau", stichworte: /brunnen|tunnel|verbau|bohr|spezialtiefbau/i },
  { nr: 7, label: "Arbeiten mit Tauchgeräten", stichworte: /taucher|unterwasser/i },
  { nr: 8, label: "Arbeiten in Druckluft", stichworte: /druckluft|caisson/i },
  { nr: 9, label: "Einsatz von Sprengstoff oder Sprengschnüren", stichworte: /spreng/i },
  { nr: 10, label: "Auf- oder Abbau von Massivbauelementen über 10 t Einzelgewicht", stichworte: /fertigteil|montage|stahlbau|rohbau|kran/i },
]);

const zahl = (v) => {
  if (v === null || v === undefined || (typeof v === "string" && v.trim() === "")) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Duties under BaustellV as hints. All warn/hinweis, never fail: the legal duty lies with
 * the client; the app neither coordinates nor decides — it points at what usually follows
 * from the figures entered (liability decision D-RE-04).
 * @param {Record<string, any>} s SiGe record
 * @returns {{vorankuendigung: boolean|null, koordinator: boolean|null, sigePlan: boolean|null,
 *   hinweise: Array<{code: string, stufe: 'warn'|'hinweis', text: string}>}} null = not decidable
 */
export function sigePflichten(s) {
  const tage = zahl(s?.arbeitstage);
  const max = zahl(s?.max_beschaeftigte);
  const pt = zahl(s?.personentage);
  const ag = zahl(s?.arbeitgeber_anzahl);
  // § 2 Abs. 2 BaustellV: > 30 working days AND > 20 employees at the same time, or > 500 person-days.
  const vorankuendigung = (tage !== null && max !== null && tage > 30 && max > 20) || (pt !== null && pt > 500)
    ? true : (tage === null || max === null) && pt === null ? null : false;
  const gefaehrlich = Object.values(s?.gefaehrdungen || {}).some((g) => g?.zutreffend === true);
  // § 3 Abs. 1: several employers on site → appoint one or more coordinators.
  const koordinator = ag === null ? null : ag > 1;
  // § 2 Abs. 3: several employers AND (prior notice or Anhang II works) → SiGe plan before site setup.
  const sigePlan = ag === null ? null : ag > 1 && (vorankuendigung === true || gefaehrlich);
  /** @type {Array<{code: string, stufe: 'warn'|'hinweis', text: string}>} */
  const hinweise = [];
  if (vorankuendigung) hinweise.push({ code: "vorankuendigung", stufe: "warn", text: "Vorankündigung nötig: spätestens zwei Wochen vor Einrichtung der Baustelle an die zuständige Behörde, sichtbar aushängen (§ 2 Abs. 2 BaustellV)" });
  if (koordinator) hinweise.push({ code: "sigeko", stufe: "warn", text: "SiGeKo bestellen: Beschäftigte mehrerer Arbeitgeber auf der Baustelle (§ 3 Abs. 1 BaustellV)" });
  if (sigePlan) hinweise.push({ code: "sige_plan", stufe: "warn", text: "SiGe-Plan vor Einrichtung der Baustelle erforderlich (§ 2 Abs. 3 BaustellV)" });
  if (gefaehrlich && ag !== null && ag <= 1) hinweise.push({ code: "gefaehrlich", stufe: "hinweis", text: "Besonders gefährliche Arbeiten nach Anhang II angegeben — Schutzmaßnahmen in der Gefährdungsbeurteilung des Arbeitgebers" });
  if (vorankuendigung === null || koordinator === null) hinweise.push({ code: "angaben", stufe: "hinweis", text: "Angaben unvollständig — Pflichten nicht entscheidbar" });
  hinweise.push({ code: "haftung", stufe: "hinweis", text: "BIT-Atelier übernimmt keine Koordination nach BaustellV; die Hinweise ersetzen nicht die Bewertung durch einen SiGeKo (RAB 30)" });
  return { vorankuendigung, koordinator, sigePlan, hinweise };
}

/**
 * Hazard matrix: Anhang II rows × project trades; a cell is "typisch" when the trade name
 * matches the row's keywords ([ASSUMED] rule of thumb), plus the record's own marking per row.
 * @param {string[]} gewerke trade names of the project (e.g. distinct ScheduleTask.trade)
 * @param {Record<string, any>} [gefaehrdungen] record.gefaehrdungen
 * @returns {Array<{nr: number, label: string, typisch: string[], zutreffend: boolean|null, notiz: string}>}
 *   typisch = trades for which the row is typical
 */
export function gefaehrdungsMatrix(gewerke, gefaehrdungen = {}) {
  const liste = [...new Set((gewerke || []).map((g) => String(g || "").trim()).filter(Boolean))];
  return ANHANG_II.map((z) => {
    const eigen = gefaehrdungen?.[String(z.nr)] || {};
    return {
      nr: z.nr, label: z.label,
      typisch: liste.filter((g) => z.stichworte.test(g)),
      zutreffend: eigen.zutreffend === true ? true : eigen.zutreffend === false ? false : null,
      notiz: String(eigen.notiz || ""),
    };
  });
}

/**
 * Record with defaults from the project (location, client) for a project without SiGe record.
 * @param {{id: string, name?: string, location?: string, client?: string}} projekt
 * @returns {Record<string, any>}
 */
export function sigeVorbelegung(projekt) {
  return {
    project_id: projekt.id, ort: projekt.location || "", bauherr: projekt.client || "", art: projekt.name || "",
    dritter: "", koordinator: "", beginn: "", dauer_text: "", arbeitstage: "", max_beschaeftigte: "",
    personentage: "", arbeitgeber_anzahl: "", ausgewaehlte: "", gefaehrdungen: {},
  };
}

/**
 * Value of an Anhang I field from the record (6 combines start and duration).
 * @param {Record<string, any>} s
 * @param {string} key
 * @returns {string}
 */
export function anhangIWert(s, key) {
  if (key === "beginn_dauer") {
    const b = s?.beginn ? new Date(s.beginn).toLocaleDateString("de-DE") : "";
    return [b && `Beginn ${b}`, s?.dauer_text || (s?.arbeitstage ? `${s.arbeitstage} Arbeitstage` : "")].filter(Boolean).join(", ");
  }
  return String(s?.[key] ?? "");
}

/**
 * Prior notice (Vorankündigung) as A4 PDF DRAFT: Anhang I fields, open fields as
 * "______", the duties as hints, signature line. No office data, no stamp.
 * @param {{s: Record<string, any>, projektName?: string, jetzt?: Date}} p
 * @returns {Promise<{bytes: Uint8Array, dateiname: string, offen: number}>} offen = empty fields
 */
export async function vorankuendigungPdf({ s, projektName = "", jetzt = new Date() }) {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const L = 20, B = 170;
  pdf.setFontSize(60); pdf.setTextColor(238); pdf.text("ENTWURF", 105, 160, { align: "center", angle: 35 }); pdf.setTextColor(0);
  let y = 22;
  pdf.setFont("helvetica", "bold"); pdf.setFontSize(14); pdf.text("Vorankündigung", L, y); y += 6;
  pdf.setFont("helvetica", "normal"); pdf.setFontSize(9);
  pdf.text("gemäß § 2 Abs. 2 Baustellenverordnung (BaustellV), Angaben nach Anhang I", L, y); y += 9;
  let offen = 0;
  for (const f of ANHANG_I) {
    const wert = anhangIWert(s, f.key);
    if (!wert) offen += 1;
    pdf.setFont("helvetica", "bold"); pdf.setFontSize(9);
    for (const z of pdf.splitTextToSize(`${f.nr}. ${f.label}`, B)) { pdf.text(z, L, y); y += 4.4; }
    pdf.setFont("helvetica", "normal"); pdf.setFontSize(10);
    for (const z of pdf.splitTextToSize(wert || "______", B - 6)) { pdf.text(z, L + 6, y); y += 5; }
    y += 2.5;
  }
  y += 3;
  pdf.setFontSize(8.5);
  const hinweise = [
    "Die Vorankündigung ist der zuständigen Behörde spätestens zwei Wochen vor Einrichtung der Baustelle zu übermitteln",
    "und sichtbar auf der Baustelle auszuhängen (§ 2 Abs. 2 BaustellV). Bei erheblichen Änderungen ist sie anzupassen.",
    "Entwurf aus BIT-Atelier — vom Bauherrn bzw. dem verantwortlichen Dritten zu prüfen und zu unterzeichnen.",
    "BIT-Atelier übernimmt keine Koordination nach BaustellV.",
  ];
  for (const h of hinweise) { pdf.text(h, L, y); y += 4.2; }
  y = Math.max(y + 16, 250);
  pdf.setLineWidth(0.2); pdf.line(L, y, L + 80, y);
  pdf.setFontSize(8); pdf.text("Ort, Datum, Unterschrift Bauherr / verantwortlicher Dritter", L, y + 4);
  pdf.setFontSize(7); pdf.setTextColor(120); pdf.text(`ENTWURF – erstellt ${jetzt.toLocaleDateString("de-DE")}`, L, 289); pdf.setTextColor(0);
  const safe = String(projektName || "Projekt").replace(/[^\p{L}\p{N}_-]+/gu, "_").slice(0, 40);
  return { bytes: new Uint8Array(pdf.output("arraybuffer")), dateiname: `Vorankuendigung_${safe}_Entwurf.pdf`, offen };
}
