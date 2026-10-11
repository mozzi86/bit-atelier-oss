// 90-05: the two award documents as A4 PDF drafts, drawn with jspdf (existing dependency, imported
// dynamically so the AVA page does not pay for it until a button is pressed):
//   vergabevorschlagPdf — header, bidder ranking, cost comparison, positions, justification, proposal,
//                         open items, blank signature lines ("aufgestellt" / "geprüft");
//   auftragsLvPdf       — contract LV of the proposed bidder: OZ, text, quantity, unit, EP, GP, net/VAT/gross.
// Both carry "ENTWURF" and no signature or office stamp: the app produces the draft, the office signs it
// outside (the skill's signature step stays a human step — Haftung).
//
// In:  the model of vergabevorschlag.vergabeModell and, for the LV, auftragsLv(...) of the proposed bid.
// Out: { bytes: Uint8Array, dateiname } — the caller downloads; tests read the uncompressed text.

import { euro, prozent } from "./vergabevorschlag.js";

/** A4 portrait in mm and the page layout [ASSUMED 20 mm left (punching margin), 15 mm elsewhere]. */
export const SEITE = Object.freeze({ w: 210, h: 297, links: 20, rechts: 15, oben: 15, unten: 18 });

/** Readable labels of the warning codes (printed under "Offene Punkte"). */
export const WARNUNG_TEXT = Object.freeze({
  kein_vollstaendiges: "Kein vollständiges Angebot – kein Vorschlag möglich.",
  nicht_geprueft: "Das vorgeschlagene Angebot hat noch keinen Prüfvermerk.",
  pruefung_veraltet: "Der Prüfvermerk ist veraltet – die Preise haben sich seit der Prüfung geändert.",
  befunde: "Die rechnerische Prüfung hat Befunde ergeben – vor der Vergabe klären.",
  aufklaerung: "Deutlicher Preisabstand – Aufklärung nach § 16d Abs. 1 VOB/A dokumentieren.",
  nicht_guenstigstes: "Vorgeschlagen wird nicht das günstigste Angebot – Begründung erforderlich.",
  einziges_angebot: "Nur ein wertbares Angebot.",
});

const safeName = (s) => String(s || "").replace(/[^\p{L}\p{N}_-]+/gu, "_").replace(/_+/g, "_").replace(/^_|_$/g, "").slice(0, 60);

/** New A4 document with the shared page frame helpers. */
async function neuesDokument() {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const breite = SEITE.w - SEITE.links - SEITE.rechts;
  const st = { y: SEITE.oben };
  // Draft watermark, light and diagonal, so a printout can never pass for the signed document. Drawn
  // FIRST on every page (under the content) — drawn last it covered digits of the amounts.
  const wasserzeichen = () => {
    pdf.setFont("helvetica", "normal"); pdf.setFontSize(60); pdf.setTextColor(238);
    pdf.text("ENTWURF", SEITE.w / 2, SEITE.h / 2, { align: "center", angle: 35 });
    pdf.setTextColor(0);
  };
  const neueSeite = () => { pdf.addPage(); st.y = SEITE.oben; wasserzeichen(); };
  wasserzeichen();
  const fuss = () => {
    const n = pdf.getNumberOfPages();
    for (let i = 1; i <= n; i += 1) {
      pdf.setPage(i);
      pdf.setFontSize(7); pdf.setTextColor(120);
      pdf.text(`ENTWURF – ohne Unterschrift · erstellt ${new Date().toLocaleDateString("de-DE")} · Seite ${i} / ${n}`, SEITE.links, SEITE.h - 8);
    }
    pdf.setTextColor(0);
  };
  /** Ensure `h` mm are left on the page, else start a new one. */
  const platz = (h) => { if (st.y + h > SEITE.h - SEITE.unten) neueSeite(); };
  const titel = (t) => { platz(12); pdf.setFont("helvetica", "bold"); pdf.setFontSize(11); pdf.text(t, SEITE.links, st.y + 5); st.y += 8; pdf.setFont("helvetica", "normal"); };
  const absatz = (t, size = 9.5) => {
    pdf.setFontSize(size);
    const zeilen = pdf.splitTextToSize(t, breite);
    for (const z of zeilen) { platz(5); pdf.text(z, SEITE.links, st.y + 4); st.y += size * 0.45; }
    st.y += 1.5;
  };
  /**
   * Simple table: columns { t: header, w: mm, rechts?: bool }, rows of strings; long cells are cut.
   * @param {Array<{t: string, w: number, rechts?: boolean}>} spalten
   * @param {string[][]} zeilen
   * @param {{fettLetzte?: number}} [o] number of trailing rows printed bold (sums)
   */
  const tabelle = (spalten, zeilen, { fettLetzte = 0 } = {}) => {
    const kopf = () => {
      platz(8);
      pdf.setFont("helvetica", "bold"); pdf.setFontSize(8);
      let x = SEITE.links;
      for (const s of spalten) { pdf.text(s.t, s.rechts ? x + s.w - 1 : x + 1, st.y + 4, s.rechts ? { align: "right" } : undefined); x += s.w; }
      pdf.setDrawColor(80); pdf.setLineWidth(0.3); pdf.line(SEITE.links, st.y + 5.5, SEITE.links + breite, st.y + 5.5);
      st.y += 7; pdf.setFont("helvetica", "normal");
    };
    kopf();
    zeilen.forEach((z, i) => {
      if (st.y + 5 > SEITE.h - SEITE.unten) { neueSeite(); kopf(); }
      const fett = i >= zeilen.length - fettLetzte;
      pdf.setFont("helvetica", fett ? "bold" : "normal"); pdf.setFontSize(8);
      let x = SEITE.links;
      spalten.forEach((s, k) => {
        let txt = String(z[k] ?? "");
        while (txt.length > 1 && pdf.getTextWidth(txt) > s.w - 2) txt = txt.slice(0, -2) + "…";
        pdf.text(txt, s.rechts ? x + s.w - 1 : x + 1, st.y + 3.5, s.rechts ? { align: "right" } : undefined);
        x += s.w;
      });
      st.y += 5;
    });
    pdf.setFont("helvetica", "normal");
    st.y += 3;
  };
  const kopfblock = (titelText, felder) => {
    pdf.setFont("helvetica", "bold"); pdf.setFontSize(15); pdf.text(titelText, SEITE.links, st.y + 6); st.y += 11;
    pdf.setFontSize(9);
    for (const [k, v] of felder) {
      if (!v) continue;
      pdf.setFont("helvetica", "bold"); pdf.text(`${k}:`, SEITE.links, st.y + 4);
      pdf.setFont("helvetica", "normal"); pdf.text(pdf.splitTextToSize(String(v), breite - 40)[0], SEITE.links + 40, st.y + 4);
      st.y += 5;
    }
    st.y += 3;
  };
  const ausgabe = (dateiname) => { fuss(); return { bytes: new Uint8Array(pdf.output("arraybuffer")), dateiname }; };
  return { pdf, st, platz, titel, absatz, tabelle, kopfblock, ausgabe, breite };
}

/**
 * Award proposal as PDF draft.
 * @param {ReturnType<typeof import("./vergabevorschlag.js").vergabeModell>} m model
 * @returns {Promise<{bytes: Uint8Array, dateiname: string}>}
 */
export async function vergabevorschlagPdf(m) {
  const d = await neuesDokument();
  const k = m.kopf;
  d.kopfblock("Vergabevorschlag", [
    ["Projekt", k.projekt], ["Bauort", k.bauort], ["Bauherr", k.bauherr],
    ["Vergabe", k.vergabe], ["Gewerk / Los", k.gewerk], ["Verfahren", k.verfahren], ["Datum", k.datum],
  ]);

  d.titel("1. Angebote und Wertung");
  d.absatz(`Aufgefordert: ${k.eingeladen} · eingegangen: ${k.eingegangen} · gewertet: ${k.gewertet}. Wertung nach dem Preis (nachgerechnete Angebotssumme mit den Mengen des Leistungsverzeichnisses).`);
  d.tabelle(
    [{ t: "Rang", w: 12 }, { t: "Bieter", w: 58 }, { t: "netto", w: 28, rechts: true }, { t: "brutto", w: 28, rechts: true },
      { t: "zum 1.", w: 18, rechts: true }, { t: "Prüfung", w: 31 }],
    m.bieter.map((b) => [
      b.rang ? String(b.rang) : "–", b.name, euro(b.summe_netto), euro(b.summe_brutto),
      b.rang ? (b.rang === 1 ? "–" : "+" + prozent(b.zum_guenstigsten)) : "",
      b.rang === null ? `nicht gewertet (${b.ohne_preis} o. Preis)` : b.pruef_status === "aktuell" ? (b.befunde ? `${b.befunde} Befund(e)` : "geprüft") : b.pruef_status === "veraltet" ? "veraltet" : "offen",
    ]),
  );

  d.titel("2. Kostenvergleich");
  const ref = m.anschlag.quelle === "kostenberechnung" ? "Kostenberechnung" : "Kostenanschlag LV";
  const zeilen = [[ref, euro(m.anschlag.netto), euro(m.anschlag.brutto), ""]];
  if (m.vorschlag) zeilen.push([`Angebot ${m.vorschlag.name}`, euro(m.vorschlag.netto), euro(m.vorschlag.brutto), prozent(m.vorschlag.diff_anschlag_anteil)]);
  d.tabelle([{ t: "", w: 85 }, { t: "netto", w: 30, rechts: true }, { t: "brutto", w: 30, rechts: true }, { t: "Abweichung", w: 30, rechts: true }], zeilen);
  if (m.positionsvergleich.length) {
    d.absatz("Positionen mit der größten Abweichung zum Kostenanschlag:", 9);
    d.tabelle(
      [{ t: "OZ", w: 22 }, { t: "Position", w: 62 }, { t: "EP Angebot", w: 28, rechts: true }, { t: "EP Anschlag", w: 28, rechts: true }, { t: "Diff. GP", w: 35, rechts: true }],
      m.positionsvergleich.map((p) => [p.oz, p.title, `${euro(p.ep_bieter)}/${p.unit}`, `${euro(p.ep_anschlag)}/${p.unit}`, euro(p.diff_gp)]),
    );
  }

  d.titel("3. Begründung");
  if (m.begruendung.length) for (const b of m.begruendung) d.absatz(`• ${b}`);
  else d.absatz("______");

  d.titel("4. Vorschlag");
  d.absatz(m.vorschlag
    ? `Vergabe an ${m.vorschlag.name} zum geprüften Angebotspreis von ${euro(m.vorschlag.netto)} netto, ${euro(m.vorschlag.mwst)} MwSt. (${prozent(k.mwst_satz)}), ${euro(m.vorschlag.brutto)} brutto.`
    : "Kein Vorschlag – es liegt kein vollständiges Angebot vor.", 10);

  const offen = m.warnungen.filter((w) => w !== "einziges_angebot").map((w) => WARNUNG_TEXT[w] || w);
  if (offen.length) { d.titel("Offene Punkte vor der Vergabe"); for (const o of offen) d.absatz(`[ ] ${o}`, 9); }

  // Signature lines — filled by hand; the app never signs.
  d.platz(30); d.st.y += 12;
  const { pdf, st } = d;
  pdf.setDrawColor(0); pdf.setLineWidth(0.2);
  pdf.line(SEITE.links, st.y, SEITE.links + 75, st.y); pdf.line(SEITE.links + 95, st.y, SEITE.links + 170, st.y);
  pdf.setFontSize(8); pdf.text("Ort, Datum, aufgestellt (Planer)", SEITE.links, st.y + 4); pdf.text("Ort, Datum, geprüft / freigegeben (Bauherr)", SEITE.links + 95, st.y + 4);
  st.y += 8;

  return d.ausgabe(`Vergabevorschlag_${safeName(k.vergabe || k.gewerk)}_${safeName(m.vorschlag?.name)}_Entwurf.pdf`);
}

/**
 * Contract LV (Auftrags-LV) of the proposed bidder as PDF draft.
 * @param {{kopf: any, vorschlag: {name: string}|null}} m model (header + proposed bidder)
 * @param {ReturnType<typeof import("./vergabevorschlag.js").auftragsLv>} lv
 * @returns {Promise<{bytes: Uint8Array, dateiname: string}>}
 */
export async function auftragsLvPdf(m, lv) {
  const d = await neuesDokument();
  const k = m.kopf;
  d.kopfblock("Auftrags-Leistungsverzeichnis", [
    ["Projekt", k.projekt], ["Bauherr", k.bauherr], ["Vergabe", k.vergabe], ["Gewerk / Los", k.gewerk],
    ["Auftragnehmer", m.vorschlag?.name || ""], ["Stand", k.datum],
  ]);
  const zeilen = lv.zeilen.map((z) => [z.oz, z.title, z.menge === null ? "" : z.menge.toLocaleString("de-DE", { maximumFractionDigits: 3 }), z.unit, euro(z.ep), euro(z.gp)]);
  zeilen.push(["", "Summe netto", "", "", "", euro(lv.netto)]);
  zeilen.push(["", `MwSt. ${prozent(k.mwst_satz)}`, "", "", "", euro(lv.mwst)]);
  zeilen.push(["", "Summe brutto", "", "", "", euro(lv.brutto)]);
  d.tabelle([{ t: "OZ", w: 24 }, { t: "Kurztext", w: 70 }, { t: "Menge", w: 18, rechts: true }, { t: "Einh.", w: 12 }, { t: "EP", w: 24, rechts: true }, { t: "GP", w: 27, rechts: true }], zeilen, { fettLetzte: 3 });
  d.absatz("Mengen nach Leistungsverzeichnis, Einheitspreise nach geprüftem Angebot. Abrechnung nach Aufmaß.", 8.5);
  return d.ausgabe(`Auftrags-LV_${safeName(k.vergabe || k.gewerk)}_${safeName(m.vorschlag?.name)}_Entwurf.pdf`);
}
