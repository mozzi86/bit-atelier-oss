// 90-05: award proposal (Vergabevorschlag) from the Preisspiegel. Council 10.10.2026
// (HANDOFF-SKILLS-INTEGRATION §3): the office skill "vergabepaket" writes the proposal by hand from the
// checked offer; the app had LV → tender → offers → check (90-03/90-04) and broke before the last document.
//
// In:  the tender, its LV positions (Preisspiegel rows; unit_price = cost-estimate EP), all bids of the
//      tender (line items, optional `pruefung` from 90-04), the project, the user's inputs (procedure,
//      VAT rate, optional cost calculation gross, proposed bid, chosen text blocks, free text).
// Out: pure model of the proposal — bidder list with ranking, cost comparison, the positions that carry
//      the justification, suggested text blocks (German: they are printed into the document), warnings —
//      plus the record stored on the tender (`vergabevorschlag`) and the rows of the contract LV.
//
// Haftung: the app proposes, it never awards. The award stays the separate "Zuschlag" button, the PDF is a
// draft without signature, and every text block that would state a legal conclusion (no abnormally low
// price, § 16d VOB/A) is written as an open item for the user to fill in — never as a finding of the app.
//
// Isomorph: kein window, keine Aliase.

import { angebotPruefen, pruefStatus } from "./angebotPruefung.js";

/** Procedures for construction work after VOB/A 2019 § 3 / § 3a (4) (Direktauftrag). */
export const VERFAHREN = Object.freeze(["Öffentliche Ausschreibung", "Beschränkte Ausschreibung", "Freihändige Vergabe", "Direktauftrag"]);

/** Default VAT rate [ASSUMED 19 % — German standard rate; editable in the dialog]. */
export const MWST_STANDARD = 0.19;

/** Deviation from the cost estimate up to which the offer "corresponds" to it, share [ASSUMED ±5 %]. */
export const ANSCHLAG_GLEICH = 0.05;

/** Deviation below the cost estimate from which clarification is named, share [ASSUMED 20 % — same threshold as 90-04]. */
export const ANSCHLAG_AUFKLAERUNG = 0.2;

const r2 = (v) => Math.round(Number(v) * 100) / 100;
const zahl = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

/** Euro in German notation, e.g. "13.790,00 €". */
export const euro = (v) => (zahl(v) === null ? "—" : Number(v).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €");
/** Percent in German notation with one decimal, sign kept, e.g. "-12,3 %". */
export const prozent = (anteil) => (zahl(anteil) === null ? "—" : (Number(anteil) * 100).toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " %");

/**
 * Build the proposal model.
 * @param {{tender: any, positionen: Array<any>, bids: Array<any>, projekt?: any, eingaben?: {verfahren?: string, mwst_satz?: number,
 *   kostenberechnung_brutto?: number|null, bid_id?: string|null, bausteine?: string[]|null, freitext?: string}, jetzt?: Date}} p
 *   mwst_satz as share (0.19); kostenberechnung_brutto in euro (null = take the cost estimate of the LV)
 */
export function vergabeModell({ tender, positionen, bids, projekt = null, eingaben = {}, jetzt = new Date() }) {
  const lv = Array.isArray(positionen) ? positionen : [];
  const alle = (Array.isArray(bids) ? bids : []).filter((b) => b && b.tender_id === tender?.id);
  const mwst = zahl(eingaben.mwst_satz) ?? MWST_STANDARD;

  // --- bidder list: every bid is checked (90-04); only complete offers are ranked ---------------
  const geprueft = alle.map((b) => {
    const erg = angebotPruefen({ bid: b, positionen: lv, andere: alle });
    return { bid: b, erg, status: pruefStatus(b, erg) };
  });
  const gewertet = geprueft.filter((g) => g.erg.vollstaendig).sort((a, b) => a.erg.summe - b.erg.summe || String(a.bid.bidder_name).localeCompare(String(b.bid.bidder_name), "de"));
  const minimum = gewertet.length ? gewertet[0].erg.summe : null;

  // Cost estimate: the user's cost calculation (gross → net) wins, else the LV estimate (Σ quantity × EP).
  const lvNetto = r2(lv.reduce((s, x) => s + (zahl(x.quantity) ?? 0) * (zahl(x.unit_price) ?? 0), 0));
  const kbBrutto = zahl(eingaben.kostenberechnung_brutto);
  const anschlag = kbBrutto !== null
    ? { netto: r2(kbBrutto / (1 + mwst)), brutto: r2(kbBrutto), quelle: /** @type {"kostenberechnung"|"lv"} */ ("kostenberechnung") }
    : { netto: lvNetto, brutto: r2(lvNetto * (1 + mwst)), quelle: /** @type {"kostenberechnung"|"lv"} */ ("lv") };

  const bieter = geprueft.map((g) => {
    const rang = gewertet.indexOf(g);
    return {
      bid_id: g.bid.id, name: String(g.bid.bidder_name || ""),
      rang: rang >= 0 ? rang + 1 : null,
      summe_netto: g.erg.summe, summe_brutto: r2(g.erg.summe * (1 + mwst)),
      zum_guenstigsten: rang >= 0 && minimum ? Math.round((g.erg.summe - minimum) / minimum * 10000) / 10000 : null,
      zum_anschlag: anschlag.netto > 0 && rang >= 0 ? Math.round((g.erg.summe - anschlag.netto) / anschlag.netto * 10000) / 10000 : null,
      vollstaendig: g.erg.vollstaendig, ohne_preis: g.erg.zaehler.ohne_preis,
      befunde: g.erg.befunde, hinweise: g.erg.hinweise, pruef_status: g.status,
      pruefung: g.bid.pruefung || null,
    };
  }).sort((a, b) => (a.rang ?? 999) - (b.rang ?? 999));

  // --- proposed bidder: the user's choice among the ranked ones, else rank 1 -------------------
  const wahl = gewertet.find((g) => g.bid.id === eingaben.bid_id) || gewertet[0] || null;
  const vorschlag = wahl ? (() => {
    const netto = wahl.erg.summe;
    return {
      bid_id: wahl.bid.id, name: String(wahl.bid.bidder_name || ""), rang: gewertet.indexOf(wahl) + 1,
      netto, mwst: r2(netto * mwst), brutto: r2(netto * (1 + mwst)),
      diff_anschlag: r2(netto - anschlag.netto),
      diff_anschlag_anteil: anschlag.netto > 0 ? Math.round((netto - anschlag.netto) / anschlag.netto * 10000) / 10000 : null,
    };
  })() : null;

  // --- positions that carry the justification: largest |GP bidder − GP estimate| ---------------
  const positionsvergleich = wahl ? wahl.erg.zeilen
    .map((z) => {
      const pos = lv.find((x) => x.id === z.position_id);
      const epA = zahl(pos?.unit_price);
      if (z.ep === null || epA === null || z.menge === null) return null;
      return { oz: z.oz, title: z.title, unit: z.unit, menge: z.menge, ep_bieter: z.ep, ep_anschlag: epA,
        diff_gp: r2((z.ep - epA) * z.menge), diff_anteil: epA > 0 ? Math.round((z.ep - epA) / epA * 10000) / 10000 : null };
    })
    .filter((x) => x && Math.abs(x.diff_gp) > 0.005)
    .sort((a, b) => Math.abs(b.diff_gp) - Math.abs(a.diff_gp))
    .slice(0, 3) : [];

  // --- warnings (shown in the dialog, printed as open items) ------------------------------------
  /** @type {string[]} */
  const warnungen = [];
  if (!gewertet.length) warnungen.push("kein_vollstaendiges");
  if (wahl) {
    const st = pruefStatus(wahl.bid, wahl.erg);
    if (st === "keine") warnungen.push("nicht_geprueft");
    if (st === "veraltet") warnungen.push("pruefung_veraltet");
    if (wahl.erg.befunde) warnungen.push("befunde");
    if (wahl.erg.gesamtCodes.includes("niedrig") || (vorschlag?.diff_anschlag_anteil ?? 0) < -ANSCHLAG_AUFKLAERUNG) warnungen.push("aufklaerung");
    if (gewertet.indexOf(wahl) > 0) warnungen.push("nicht_guenstigstes");
  }
  if (gewertet.length === 1) warnungen.push("einziges_angebot");

  const kopf = {
    projekt: String(projekt?.name || ""), bauherr: String(projekt?.client || ""),
    bauort: [projekt?.location?.address, projekt?.location?.city].filter(Boolean).join(", "),
    vergabe: String(tender?.name || ""), gewerk: String(tender?.trade || ""),
    verfahren: VERFAHREN.includes(String(eingaben.verfahren)) ? String(eingaben.verfahren) : VERFAHREN[1],
    datum: jetzt.toLocaleDateString("de-DE"),
    eingeladen: Array.isArray(tender?.invited_contact_ids) ? tender.invited_contact_ids.length : 0,
    eingegangen: alle.length, gewertet: gewertet.length, mwst_satz: mwst,
  };

  const bausteine = bausteineVorschlagen({ kopf, bieter, vorschlag, anschlag, positionsvergleich, warnungen, wahl });
  const gewaehlt = Array.isArray(eingaben.bausteine) ? bausteine.filter((b) => eingaben.bausteine?.includes(b.id)) : bausteine.filter((b) => b.vorgeschlagen);
  const begruendung = [...gewaehlt.map((b) => b.text), String(eingaben.freitext || "").trim()].filter(Boolean);

  return { kopf, bieter, anschlag, vorschlag, positionsvergleich, warnungen, bausteine, begruendung };
}

/** "Oberboden abtragen (4,50 €/m² statt 5,00 €/m²)" */
function posText(p) {
  return `${p.oz} ${p.title} (${euro(p.ep_bieter)}/${p.unit} statt ${euro(p.ep_anschlag)}/${p.unit})`;
}

/**
 * Text blocks for the justification. Each block has a stable id; `vorgeschlagen` = pre-ticked because
 * the data supports it. Blocks that need the user's judgement end in an open item ("…: ______").
 * @returns {Array<{id: string, titel: string, text: string, vorgeschlagen: boolean}>}
 */
function bausteineVorschlagen({ kopf, bieter, vorschlag, anschlag, positionsvergleich, warnungen, wahl }) {
  if (!vorschlag) return [];
  const out = [];
  const nGew = kopf.gewertet;
  out.push({ id: "wirtschaftlich", titel: "Wirtschaftlichstes Angebot", vorgeschlagen: vorschlag.rang === 1,
    text: nGew > 1
      ? `Das Angebot von ${vorschlag.name} ist nach rechnerischer Prüfung mit ${euro(vorschlag.netto)} netto das wirtschaftlichste der ${nGew} gewerteten Angebote. Zuschlagskriterium ist der Preis.`
      : `Das Angebot von ${vorschlag.name} ist nach rechnerischer Prüfung mit ${euro(vorschlag.netto)} netto das einzige wertbare Angebot. Zuschlagskriterium ist der Preis.` });
  out.push({ id: "beteiligung", titel: "Beteiligung", vorgeschlagen: true,
    text: `Zur Angebotsabgabe aufgefordert: ${kopf.eingeladen} Bieter; eingegangen: ${kopf.eingegangen} Angebot(e); gewertet: ${nGew}.` });
  const ausgeschlossen = bieter.filter((b) => b.rang === null);
  if (ausgeschlossen.length) out.push({ id: "nicht_gewertet", titel: "Nicht gewertete Angebote", vorgeschlagen: true,
    text: `Nicht gewertet: ${ausgeschlossen.map((b) => `${b.name} (${b.ohne_preis} Position(en) ohne Preis)`).join("; ")}. Nachforderung fehlender Preise nach § 16a VOB/A geprüft: ______.` });
  const pr = wahl?.bid?.pruefung;
  out.push({ id: "geprueft", titel: "Rechnerische Prüfung", vorgeschlagen: !!pr,
    text: pr
      ? `Das Angebot wurde am ${new Date(pr.datum).toLocaleDateString("de-DE")} von ${pr.pruefer} rechnerisch geprüft; ${wahl.erg.befunde ? `${wahl.erg.befunde} Befund(e) – Klärung: ______` : "ohne Befund"}.`
      : "Das Angebot wurde rechnerisch geprüft am ______ von ______." });
  const a = vorschlag.diff_anschlag_anteil;
  if (a !== null) {
    const ref = anschlag.quelle === "kostenberechnung" ? "der Kostenberechnung" : "dem Kostenanschlag des Leistungsverzeichnisses";
    const pos = positionsvergleich.length ? ` Die Abweichung ergibt sich vor allem aus: ${positionsvergleich.map(posText).join("; ")}.` : "";
    if (Math.abs(a) <= ANSCHLAG_GLEICH) out.push({ id: "anschlag", titel: "Kostenvergleich", vorgeschlagen: true,
      text: `Die Angebotssumme entspricht ${ref} (${euro(anschlag.netto)} netto; Abweichung ${prozent(a)}).` });
    else out.push({ id: "anschlag", titel: "Kostenvergleich", vorgeschlagen: true,
      text: `Die Angebotssumme liegt ${prozent(Math.abs(a))} ${a < 0 ? "unter" : "über"} ${ref} (${euro(anschlag.netto)} netto; ${a < 0 ? "Minderkosten" : "Mehrkosten"} ${euro(Math.abs(vorschlag.diff_anschlag))} netto).${pos}` });
  }
  if (warnungen.includes("aufklaerung")) out.push({ id: "aufklaerung", titel: "Aufklärung niedriger Preis", vorgeschlagen: true,
    text: "Wegen des deutlichen Preisabstands ist zu prüfen, ob ein ungewöhnlich niedriges Angebot nach § 16d Abs. 1 VOB/A vorliegt. Aufklärung beim Bieter am ______; Ergebnis: ______." });
  if (warnungen.includes("nicht_guenstigstes")) out.push({ id: "nicht_guenstigstes", titel: "Nicht das günstigste Angebot", vorgeschlagen: true,
    text: `Vorgeschlagen wird nicht das preislich günstigste Angebot (Rang ${vorschlag.rang}). Begründung: ______.` });
  out.push({ id: "empfehlung", titel: "Empfehlung", vorgeschlagen: true,
    text: `Es wird vorgeschlagen, den Auftrag an ${vorschlag.name} zum geprüften Angebotspreis von ${euro(vorschlag.netto)} netto (${euro(vorschlag.brutto)} brutto inkl. ${prozent(kopf.mwst_satz)} MwSt.) zu vergeben.` });
  return out;
}

/**
 * Record stored on the tender (`tender.vergabevorschlag`, new optional field) — the proposal as signed
 * off in the dialog; the award itself stays a separate step.
 * @param {ReturnType<typeof vergabeModell>} m
 * @param {{jetzt?: Date, bausteine?: string[], freitext?: string}} [o]
 * @returns {{datum: string, verfahren: string, bid_id: string, bieter: string, netto: number, brutto: number, mwst_satz: number,
 *   anschlag_netto: number, anschlag_quelle: string, bausteine: string[], freitext: string, begruendung: string[]}|null}
 */
export function vorschlagDatensatz(m, { jetzt = new Date(), bausteine = [], freitext = "" } = {}) {
  if (!m.vorschlag) return null;
  return {
    datum: jetzt.toISOString(), verfahren: m.kopf.verfahren, bid_id: m.vorschlag.bid_id, bieter: m.vorschlag.name,
    netto: m.vorschlag.netto, brutto: m.vorschlag.brutto, mwst_satz: m.kopf.mwst_satz,
    anschlag_netto: m.anschlag.netto, anschlag_quelle: m.anschlag.quelle,
    bausteine: [...bausteine], freitext: String(freitext || "").trim(), begruendung: [...m.begruendung],
  };
}

/**
 * Rows of the contract LV (Auftrags-LV) of the proposed bid: LV quantity × checked unit price.
 * @param {Array<any>} positionen LV positions of the tender
 * @param {any} bid proposed bid
 * @param {number} mwst_satz share
 * @returns {{zeilen: Array<{oz: string, title: string, menge: number|null, unit: string, ep: number|null, gp: number|null}>, netto: number, mwst: number, brutto: number}}
 */
export function auftragsLv(positionen, bid, mwst_satz = MWST_STANDARD) {
  const erg = angebotPruefen({ bid, positionen });
  const zeilen = erg.zeilen.map((z) => ({ oz: z.oz, title: z.title, menge: z.menge, unit: z.unit, ep: z.ep, gp: z.gp }));
  return { zeilen, netto: erg.summe, mwst: r2(erg.summe * mwst_satz), brutto: r2(erg.summe * (1 + mwst_satz)) };
}
