// 96-02 / 96-03 in the browser (the plans were built and unit-tested in worktrees).
//  - 96-02: an LV position with a frozen contract quantity 100 and a current quantity 125
//    shows "Mehrmenge +25 % (Spitze 15 m²)" in AVA › Mengenregeln.
//  - 96-03: a commissioned contract whose frozen KG 300 (90.000 €) differs from the LV
//    (100.000 €) shows the drift notice; "Als Honorarnachtrag übernehmen" opens the
//    amendment dialog prefilled (nothing is saved).
// Own project, positions and contract; all deleted in `finally`.
import { test, expect } from "@playwright/test";

const API = "/api/entities";
const NAME = "E2E Projekt 96-02-03";

async function aufraeumen(request) {
  for (const p of await (await request.get(`${API}/Project`)).json()) {
    if (p.name !== NAME) continue;
    for (const e of ["LVPosition", "Honorarvertrag", "Honorarnachtrag"]) {
      for (const r of await (await request.get(`${API}/${e}`)).json()) if (r.project_id === p.id) await request.delete(`${API}/${e}/${r.id}`);
    }
    await request.delete(`${API}/Project/${p.id}`);
  }
}

test("VOB/B-Spalte und Kosten-Drift mit Nachtrag (96-02, 96-03)", async ({ page, request }) => {
  test.setTimeout(120000);
  await aufraeumen(request);
  try {
    const projekt = await (await request.post(`${API}/Project`, { data: { name: NAME, status: "construction", hoai_phase: 8, build_kind: "neubau" } })).json();
    await request.post(`${API}/LVPosition`, { data: {
      project_id: projekt.id, oz: "01.0010", short_text: "E2E Mauerwerk", unit: "m²", quantity: 125, unit_price: 800, din276: "331",
      vertragsmenge: 100, vertragsmenge_am: "2026-10-01",
    } });
    const vertrag = await (await request.post(`${API}/Honorarvertrag`, { data: {
      project_id: projekt.id, nummer: "E2E-AV-9603", status: "beauftragt", bauherr_name: "E2E Bauherr 9603", leistungsbild: "gebaeude",
      kg300_euro: 90000, kg400_euro: 0, sonstige_euro: 0, anrechenbare_quelle: "lv", honorarzone: "III", satz_position_prozent: 0,
      lph: [1, 2, 3, 4, 5, 6, 7, 8, 9].map((nr) => ({ nr, beauftragt: nr <= 8 })), umbauzuschlag_prozent: 0, nebenkosten_prozent: 5, ust_satz: 19, pauschal_euro: null,
      kosten_eingefroren_am: "2026-10-01", kosten_eingefroren: { kg300_cent: 9000000, kg400_cent: 0, sonstige_cent: 0 },
    } })).json();

    // 96-02: AVA › Mengenregeln.
    await page.goto(`/AVA?projekt=${encodeURIComponent(projekt.id)}&tab=mengenregeln`);
    await expect(page.getByText("VOB/B § 2 Abs. 3").first()).toBeVisible({ timeout: 60000 });
    await expect(page.getByText(/Mehrmenge \+25 % \(Spitze 15 m²\)/)).toBeVisible();

    // 96-03: drift notice on the commissioned contract (LV 125 × 800 = 100.000 € vs. frozen 90.000 €).
    await page.goto(`/Fees?tab=contracts&projekt=${encodeURIComponent(projekt.id)}`);
    await page.locator(`[data-testid="vertrag-zeile"][data-nummer="${vertrag.nummer}"]`).getByRole("button", { name: vertrag.nummer }).click();
    const hinweis = page.getByTestId("kosten-drift-hinweis");
    await expect(hinweis).toBeVisible({ timeout: 30000 });
    await expect(hinweis).toContainText("11,1 %");
    await hinweis.getByTestId("kosten-drift-nachtrag").click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("dialog")).toContainText("§ 10");
  } finally {
    await aufraeumen(request);
  }
});
