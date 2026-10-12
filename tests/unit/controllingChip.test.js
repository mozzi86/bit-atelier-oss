// Phase 81 (81-05): the controlling chip of "Aktives Projekt" (src/lib/controlling/ampelChip.js)
// — no query at all on a locked data path (Supabase build without release, E-03),
// project-filtered reads otherwise, no chip without a contract, office rate
// without personnel access; plus source checks that the chip, the page and the
// cost-rate tab name the personnel API nowhere (leak guard 80-02).
//
// In:  the chip loader with fake APIs; source text of the UI files. Out: assertions only.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { AMPEL_CHIP_ENTITAETEN, ampelChipZustand, ladeAmpelChipDaten } from "@/lib/controlling/ampelChip.js";
import { setzeDatenquelleZH } from "@/lib/zeitHonorar/speicher.js";
import { lphFuerLeistungsbild } from "@core/lib/hoai/honorar.js";

/** Fake bitApi counting every call. */
function attrappe(listen = {}) {
  const aufrufe = [];
  const entities = new Proxy({}, {
    get: (_, name) => ({
      list: async () => { aufrufe.push(["list", name]); return listen[name] || []; },
      filter: async (f) => { aufrufe.push(["filter", name, f]); return (listen[name] || []).filter((r) => r.project_id === f.project_id); },
    }),
  });
  const personal = new Proxy({}, { get: (_, name) => ({ list: async () => { aufrufe.push(["personal", name]); return []; } }) });
  return { api: { entities, personal }, aufrufe };
}

const VERTRAG = { id: "hv-1", project_id: "p1", leistungsbild: "gebaeude", kg300_euro: 2399716, kg400_euro: 281000, honorarzone: "III", satz_position_prozent: 0, lph: lphFuerLeistungsbild("gebaeude").map((l, i) => ({ ...l, beauftragt: i < 8 })) };

test("Supabase ohne Freigabe: keine einzige Abfrage, kein Chip", async () => {
  const { api, aufrufe } = attrappe({ Honorarvertrag: [VERTRAG] });
  const r = await ladeAmpelChipDaten({ api, datenquelle: "supabase", cloudFreigabe: false, rolle: "admin", projectId: "p1" }, { personalApi: api });
  assert.equal(r, null);
  assert.equal(aufrufe.length, 0);
  assert.equal(ampelChipZustand(r, { regeln: {}, heute: "2026-09-28" }), null);
  const ohneProjekt = await ladeAmpelChipDaten({ api, datenquelle: "serverlos", projectId: null });
  assert.equal(ohneProjekt, null);
  assert.equal(aufrufe.length, 0);
});

test("lokal: genau die vier Sammlungen des Projekts per Filter; ohne Personal-Zugang kein Personalaufruf, Bürosatz", async () => {
  setzeDatenquelleZH("serverlos");
  const buchung = { id: "z1", project_id: "p1", mitarbeiter_id: "inhaber", lph: 5, minuten: 600, status: "freigegeben", datum: "2026-09-10" };
  const { api, aufrufe } = attrappe({ Honorarvertrag: [VERTRAG, { ...VERTRAG, id: "hv-x", project_id: "p2" }], Zeitbuchung: [buchung], HoaiPlan: [{ project_id: "p1", progress: [100, 100, 100, 100, 60, 0, 0, 0, 0] }] });
  const r = await ladeAmpelChipDaten({ api, datenquelle: "serverlos", rolle: null, projectId: "p1" }, { personalApi: api });
  assert.ok(r);
  assert.deepEqual(aufrufe.filter((a) => a[0] === "filter").map((a) => a[1]).sort(), [...AMPEL_CHIP_ENTITAETEN].sort());
  assert.ok(aufrufe.every((a) => a[0] !== "list"), "never the whole collection");
  assert.equal(r?.daten.Honorarvertrag.length, 1);
  // Office rate 95 by rule: 10 h × 95 = 950 € on LPH 5 (69.192,66 €) at 60 % → green.
  assert.deepEqual(ampelChipZustand(r, { regeln: { ampel_gelb: 0, ampel_rot: 10, buerosatz: 95 }, heute: "2026-09-28" }), { ampel: "gruen", tafelFehlt: false });
  const ohneVertrag = { ...r, daten: { ...r.daten, Honorarvertrag: [] } };
  assert.equal(ampelChipZustand(/** @type {any} */ (ohneVertrag), { regeln: {}, heute: "2026-09-28" }), null);
});

test("Leck-Wächter: Chip, Seite, Reiter und Lib nennen die Personal-API nicht", () => {
  for (const p of ["src/components/projects/AktivesProjekt.jsx", "src/pages/Controlling.jsx", "src/components/controlling/AmpelChip.jsx", "src/components/controlling/KostensatzReiter.jsx",
    "src/components/controlling/ProjektControlling.jsx", "src/components/controlling/PortfolioTabelle.jsx", "src/components/controlling/MonatsAnsicht.jsx", "src/lib/controlling/ampelChip.js", "src/lib/controlling/controlling.js"]) {
    const quelle = fs.readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
    assert.doesNotMatch(quelle, /bitApi\.personal|PERSONAL_ENTITAETEN|personalDb|personalDatei/, p);
    assert.doesNotMatch(quelle, /saetzeZum|src\/lib\/accounting\/hoai|ag_kostenfaktor|src\/lib\/personal\/|umbau_prozent/, p);
  }
  const chip = fs.readFileSync(new URL("../../src/components/controlling/AmpelChip.jsx", import.meta.url), "utf8");
  assert.match(chip, /ladeAmpelChipDaten/);
});
