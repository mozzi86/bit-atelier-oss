// English dictionary part of plan 96-02 (VOB/B § 2 Abs. 3 rating of the
// current quantity against the contracted quantity frozen at award): the
// column and badges in the AVA quantity-rule table (RegelTabelle.jsx) and the
// error toast of the freeze in AVA.jsx. {p}/{m}/{e} slots are filled after t().
//
// In:  nothing. Out: EN, merged into DICT.en through ./index.js.

/** @type {Record<string, string>} */
export const EN = {
  "VOB/B § 2 Abs. 3": "VOB/B § 2 (3)",
  "Ist-Menge gegen die beim Zuschlag eingefrorene Vertragsmenge (§ 2 Abs. 3 VOB/B, ±10 %)":
    "Current quantity against the contracted quantity frozen at award (VOB/B § 2 (3), ±10 %)",
  "im Toleranzbereich": "within tolerance",
  "Mehrmenge +{p} % (Spitze {m} {e})": "Excess quantity +{p} % (above 110 %: {m} {e})",
  "Mindermenge −{p} %": "Shortfall −{p} %",
  "§ 2 Abs. 3 Nr. 1 VOB/B: Abweichung bis 10 % von der Vertragsmenge — der vertragliche Einheitspreis gilt.":
    "VOB/B § 2 (3) no. 1: deviation of up to 10 % from the contracted quantity — the contract unit price applies.",
  "§ 2 Abs. 3 Nr. 2 VOB/B: Für die über 110 % der Vertragsmenge hinausgehende Menge ist auf Verlangen ein neuer Einheitspreis zu vereinbaren. Hinweis, keine Sperre.":
    "VOB/B § 2 (3) no. 2: for the quantity exceeding 110 % of the contracted quantity a new unit price is to be agreed on request. Notice, not a block.",
  "§ 2 Abs. 3 Nr. 3 VOB/B: Bei mehr als 10 % Unterschreitung der Vertragsmenge ist auf Verlangen der Einheitspreis für die ausgeführte Menge zu erhöhen. Hinweis, keine Sperre.":
    "VOB/B § 2 (3) no. 3: if the contracted quantity is undercut by more than 10 %, the unit price for the quantity performed is to be increased on request. Notice, not a block.",
  "Vertragsmengen nicht eingefroren:": "Contracted quantities not frozen:",
};
