// Phase 81 (81-06): invariants of the phase-81 sample across the 79 accounting
// sample and the 80 personnel sample (shifted to "today" like the app does) —
// checked with the libraries of the phases, not with copied rules: Bavarian
// working days inside the eight-week window, the slots kept free for phase 82,
// persons and bookable work stages, resolving references, offers with the flat
// 79 fields and the payment term of 79's chain, unique HA-/AV- numbers per year,
// the traffic lights of SEED_AMPELN, and the sole-owner legal form (E-17) — for
// three different "today"s.
//
// In:  the seed modules of 79/80/81, 79's payment-term chain, 81's controlling core. Out: assertions only.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { beispielDatensaetze } from "@/lib/accounting/beispielDaten.js";
import { zahlungszielTage } from "@/lib/accounting/grundlagen.js";
import { beispielDatensaetzeZeitHonorar, SEED_AMPELN } from "@/lib/zeitHonorar/beispielDaten.js";
import { hauptvertrag, portfolio } from "@/lib/controlling/controlling.js";
import { INHABER_ID } from "@/lib/zeit/personalQuelle.js";
import { personalSeedVerschieben } from "@core/api/personalDb.js";
import { istArbeitstag } from "@core/lib/kalender/arbeitstage.js";
import { plusTage, wochentag } from "@core/lib/kalender/datum.js";
import { leistungsbildInfo } from "@core/lib/hoai/leistungsbilder.js";

const PERSONAL_SEED = JSON.parse(fs.readFileSync(new URL("../../packages/nova-core/src/api/personalSeed.json", import.meta.url), "utf8"));
const TAGE = ["2026-09-28", "2026-06-30", "2027-01-15"];
const FLACHE_FELDER = ["leistungsbild", "bauherr_art", "zahlungsziel_tage", "zahlungsziel_vertraglich", "kg300_euro", "kg400_euro", "honorarzone", "satz_position_prozent", "lph", "umbauzuschlag_prozent", "nebenkosten_prozent", "ust_satz"];

/**
 * The combined sample of one day: 79 rows with the 81 patches applied.
 * @param {string} heute
 * @param {boolean} mitPersonal
 */
function saat(heute, mitPersonal) {
  const bh = beispielDatensaetze(heute);
  const personal = mitPersonal ? personalSeedVerschieben(PERSONAL_SEED, heute) : null;
  const zh = beispielDatensaetzeZeitHonorar(heute, { buchhaltung: bh, personal });
  const vertraege = bh.Honorarvertrag.map((v) => ({ ...v, ...(zh.honorarvertragPatch[v.id] || {}) }));
  const hoaiPlaene = bh.HoaiPlan.map((h) => ({ ...h, verlauf: zh.hoaiPlanVerlauf[h.project_id] || [] }));
  return { bh, zh, personal, vertraege, hoaiPlaene };
}

/** Monday of the week of `heute` and the start of the eight-week window. */
function fenster(heute) {
  const wt = /** @type {number} */ (wochentag(heute));
  const montag = /** @type {string} */ (plusTage(heute, -((wt === 0 ? 7 : wt) - 1)));
  return { montag, start: /** @type {string} */ (plusTage(montag, -56)) };
}

for (const heute of TAGE) {
  for (const mitPersonal of [false, true]) {
    const name = `${heute} ${mitPersonal ? "mit 80-Saat" : "ohne Personal"}`;

    test(`${name}: Buchungen an BY-Arbeitstagen im Fenster, frei gehaltene Tage für 82 bleiben frei`, () => {
      const { zh, personal } = saat(heute, mitPersonal);
      const { montag, start } = fenster(heute);
      const m1 = personal ? personal.Mitarbeiter.find((m) => m.art === "inhaber" && m.status === "aktiv")?.id : INHABER_ID;
      const m3 = mitPersonal ? "P-004" : null;
      const woche = (/** @type {number} */ k) => [0, 1, 2, 3, 4, 5, 6].map((d) => /** @type {string} */ (plusTage(montag, -7 * k + d)));
      const frei = new Set([...woche(7), ...woche(6)].map((t) => `${m1}|${t}`));
      if (m3) for (const t of woche(2).slice(0, 2)) frei.add(`${m3}|${t}`);
      for (const b of zh.Zeitbuchung) {
        if (b.quelle === "import") { assert.ok(b.datum < start, `${b.id} Übertrag vor dem Fenster`); continue; }
        assert.ok(b.datum >= start && b.datum < montag, `${b.id} ${b.datum} im Fenster`);
        assert.ok(istArbeitstag(b.datum), `${b.id} ${b.datum} ist ein bayerischer Arbeitstag`);
        assert.ok(!frei.has(`${b.mitarbeiter_id}|${b.datum}`), `${b.id} liegt in einem für 82 frei gehaltenen Tag`);
      }
    });

    test(`${name}: Personen, buchbare LPH, Verweise lösen auf`, () => {
      const { zh, personal, vertraege } = saat(heute, mitPersonal);
      const personen = new Set(personal ? personal.Mitarbeiter.map((m) => m.id) : [INHABER_ID]);
      const nachtraege = new Set(zh.Honorarnachtrag.map((n) => n.id));
      const vertragIds = new Set(vertraege.map((v) => v.id));
      for (const b of zh.Zeitbuchung) {
        assert.ok(personen.has(b.mitarbeiter_id), `${b.id}: Person ${b.mitarbeiter_id}`);
        if (b.honorarnachtrag_id) assert.ok(nachtraege.has(b.honorarnachtrag_id), `${b.id}: Honorarnachtrag`);
        if (!b.project_id) { assert.ok(b.kategorie_intern, `${b.id}: Bürozeit mit Kategorie`); continue; }
        if (b.leistung === "akquise") { assert.equal(b.lph, null, `${b.id}: Akquise ohne LPH`); continue; }
        const v = hauptvertrag(vertraege.filter((x) => x.project_id === b.project_id));
        assert.ok(v, `${b.id}: Vertrag für ${b.project_id}`);
        const anzahl = leistungsbildInfo(v.leistungsbild)?.lph.length ?? 9;
        assert.ok(Number.isInteger(b.lph) && b.lph >= 1 && b.lph <= anzahl, `${b.id}: LPH ${b.lph} von ${anzahl}`);
        assert.equal(v.lph[b.lph - 1]?.beauftragt, true, `${b.id}: LPH ${b.lph} beauftragt`);
      }
      for (const n of zh.Honorarnachtrag) {
        assert.ok(vertragIds.has(n.honorarvertrag_id), `${n.id}: Vertrag`);
        if (typeof n.lph === "number") assert.equal(vertraege.find((v) => v.id === n.honorarvertrag_id)?.lph[n.lph - 1]?.beauftragt, true, `${n.id}: LPH beauftragt`);
      }
      const angebote = new Set(zh.Honorarangebot.map((a) => a.id));
      for (const a of zh.Honorarangebot) {
        if (a.honorarvertrag_id) assert.ok(vertragIds.has(a.honorarvertrag_id), `${a.id}: Vertrag`);
        if (a.ersetzt_id) assert.ok(angebote.has(a.ersetzt_id), `${a.id}: ersetzte Fassung`);
      }
      for (const v of vertraege) if (v.angebot_id) assert.ok(angebote.has(v.angebot_id), `${v.id}: Angebot`);
      for (const k of zh.Kostensatz) assert.ok(personen.has(k.mitarbeiter_id), `${k.id}: Person`);
      for (const az of zh.Arbeitszeit) assert.ok(personen.has(az.mitarbeiter_id), `${az.id}: Person`);
    });

    test(`${name}: Angebote mit flachen 79-Feldern und Zahlungsziel aus 79s Kette; HA-/AV-Nummern je Jahr eindeutig; Ampeln = SEED_AMPELN; Rechtsform einzelunternehmen`, () => {
      const { bh, zh, personal, vertraege, hoaiPlaene } = saat(heute, mitPersonal);
      for (const a of zh.Honorarangebot) {
        for (const f of FLACHE_FELDER) assert.ok(f in a, `${a.id}: ${f}`);
        assert.ok(Number.isInteger(a.zahlungsziel_tage) && a.zahlungsziel_tage > 0, `${a.id}: zahlungsziel_tage`);
        const v = vertraege.find((x) => x.id === a.honorarvertrag_id);
        if (v) assert.equal(a.zahlungsziel_tage, zahlungszielTage({ vertrag: v }), `${a.id}: Zahlungsziel wie 79`);
        assert.match(a.nummer, /^HA-\d{4}-\d{3}$/);
      }
      // A number belongs to ONE offer chain (versions share it via ersetzt_id).
      const wurzel = (/** @type {any} */ a) => { let x = a; while (x?.ersetzt_id) x = zh.Honorarangebot.find((y) => y.id === x.ersetzt_id); return x?.id; };
      const ketten = new Map();
      for (const a of zh.Honorarangebot) {
        const k = ketten.get(a.nummer) || new Set();
        k.add(wurzel(a));
        ketten.set(a.nummer, k);
      }
      for (const [nummer, k] of ketten) assert.equal(k.size, 1, `${nummer} in mehreren Angeboten`);
      const av = vertraege.map((v) => v.nummer).filter(Boolean);
      for (const n of av) assert.match(n, /^AV-\d{4}-\d{3}$/);
      assert.equal(new Set(av).size, av.length, "AV-Nummern eindeutig");

      const reihen = portfolio([], {
        vertraege, nachtraege: zh.Honorarnachtrag, hoaiPlaene, buchungen: zh.Zeitbuchung, kostensaetze: zh.Kostensatz,
        mitarbeiter: personal ? personal.Mitarbeiter : [], angebote: zh.Honorarangebot, regeln: { ampel_gelb: 0, ampel_rot: 10, buerosatz: null },
      }, { stichtagIso: heute });
      for (const s of SEED_AMPELN) {
        const c = reihen.find((r) => r.project_id === s.project_id)?.c;
        assert.equal(c?.lph.find((z) => z.lph === s.lph)?.ampel, s.ampel, `${s.schluessel}`);
      }
      assert.equal(bh.Setting.find((s) => s.key === "buchhaltung")?.value?.rechtsform, "einzelunternehmen");
    });
  }
}
