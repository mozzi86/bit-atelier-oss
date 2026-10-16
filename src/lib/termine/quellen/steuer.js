// Term source "steuer" (phase 82, 82-03): VAT returns and tax prepayments as
// computed by the books of phase 79 — 82 shows them, it never recomputes them
// (one way of calculation per deadline).
//   - ustTermine(jahr, daten, einst, saetze, heute) (src/lib/accounting/umsatzsteuer.js):
//     statutory and due day already moved by § 108 Abs. 3 AO; `bezahlt` = done.
//     The stable id uses the period (zeitraum.von, else nenn), not the date: a
//     later permanent extension moves the date and must keep the acknowledgement.
//   - vorauszahlungsTermine(jahr, art, saetze, einst.kalender) for the kinds steuerartenFuer(einst)
//     knows (legal form, E-04: a freelancer pays no trade tax); a paid
//     Steuerzahlung of the same kind and due day marks it done.
// Data through 79's ladeAlles (locked like the books), settings through
// wirksameEinstellungen, rates through saetzeZum. Dates are calendar days.
//
// In:  api, ctx {von, bis, heute}. Out: QUELLE for quellenRegistry.js.

import { terminId } from "@core/lib/kalender/termin.js";
import { ladeAlles } from "@/lib/accounting/speicher.js";
import { saetzeZum, wirksameEinstellungen } from "@/lib/accounting/einstellungen.js";
import { periodeLabel, ustTermine } from "@/lib/accounting/umsatzsteuer.js";
import { steuerartenFuer, vorauszahlungsTermine } from "@/lib/accounting/steuertermine.js";

/** Short names of the prepayment kinds (data names, not translated). */
const ART_KURZ = Object.freeze({ est: "ESt", kst: "KSt", gewst: "GewSt" });

/** @type {import("../quellenRegistry.js").TerminQuelle} */
export const QUELLE = Object.freeze({
  key: "steuer",
  label: "Steuertermine",
  modul: "buchhaltung",
  standardAn: true,
  laden: async (/** @type {any} */ api) => ladeAlles(api),
  berechnen: (/** @type {{daten: Record<string, any[]>, setting: any}} */ roh, /** @type {any} */ ctx) => {
    // 96: the office calendar of the deadlines page (ctx.kalender) decides the § 108 Abs. 3 AO shift.
    const einst = { ...wirksameEinstellungen(roh?.setting?.value ?? null), kalender: ctx.kalender ?? null };
    const daten = roh?.daten || {};
    const zahlungen = Array.isArray(daten.Steuerzahlung) ? daten.Steuerzahlung : [];
    const vonJahr = Number(String(ctx.von).slice(0, 4));
    const bisJahr = Number(String(ctx.bis).slice(0, 4));
    const aus = [];
    for (let jahr = vonJahr; jahr <= bisJahr; jahr++) {
      const saetze = saetzeZum(`${jahr}-01-01`);
      for (const u of ustTermine(jahr, daten, einst, saetze, ctx.heute)) {
        aus.push({
          id: terminId("steuer", u.art, u.zeitraum?.von ?? u.nenn),
          quelle: "steuer", art: "ust_voranmeldung", klasse: /** @type {"frist"} */ ("frist"), datum: u.faellig,
          project_id: null, modul: "buchhaltung", objekt: periodeLabel(u, (k) => k), ziel: "/Accounting?tab=vat",
          herkunft: "§ 18 Abs. 1 UStG", erledigt: Boolean(u.bezahlt),
        });
      }
      for (const art of steuerartenFuer(einst).filter((a) => a !== "ust")) {
        for (const v of vorauszahlungsTermine(jahr, art, saetze)) {
          const bezahlt = zahlungen.some((z) => z?.art === art && z.faellig_am === v.faellig && z.bezahlt_am);
          aus.push({
            id: terminId("steuer", art, v.nenn),
            quelle: "steuer", art: "steuer_vorauszahlung", klasse: /** @type {"frist"} */ ("frist"), datum: v.faellig,
            project_id: null, modul: "buchhaltung", objekt: `${ART_KURZ[/** @type {"est"|"kst"|"gewst"} */ (art)] || art} Q${v.quartal}/${jahr}`,
            ziel: "/Accounting?tab=liquidity", herkunft: art === "gewst" ? "§ 19 GewStG" : "§ 37 EStG", erledigt: bezahlt,
          });
        }
      }
    }
    return aus;
  },
});
