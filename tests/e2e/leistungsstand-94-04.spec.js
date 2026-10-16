// 94-04 (B-ABN-08): the Leistungsstand can be kept in the contract account,
// without the designer. It writes the project's HoaiPlan (the designer's record),
// and the "estimated from the project phase" label disappears once recorded.
// Own project + contract; deletes HoaiPlan, contract and project in `finally`.
import { test, expect } from "@playwright/test";

const API = "/api/entities";
const NAME = "E2E Projekt 94-04 Stand";

async function aufraeumen(request) {
  for (const p of await (await request.get(`${API}/Project`)).json()) {
    if (p.name !== NAME) continue;
    for (const h of await (await request.get(`${API}/HoaiPlan?project_id=${p.id}`)).json()) await request.delete(`${API}/HoaiPlan/${h.id}`);
    for (const v of await (await request.get(`${API}/Honorarvertrag`)).json()) if (v.project_id === p.id) await request.delete(`${API}/Honorarvertrag/${v.id}`);
    await request.delete(`${API}/Project/${p.id}`);
  }
}

test("Leistungsstand im Vertragskonto pflegen → HoaiPlan (94-04)", async ({ page, request }) => {
  await aufraeumen(request);
  try {
    const projekt = await (await request.post(`${API}/Project`, { data: { name: NAME, status: "design_development", hoai_phase: 2, build_kind: "neubau" } })).json();
    const vertrag = await (await request.post(`${API}/Honorarvertrag`, { data: {
      project_id: projekt.id, nummer: "E2E-AV-9404S", status: "beauftragt", bauherr_name: "E2E Bauherr Stand", leistungsbild: "gebaeude",
      kg300_euro: 900000, kg400_euro: 400000, sonstige_euro: 0, honorarzone: "III", satz_position_prozent: 0,
      lph: [1, 2, 3, 4, 5, 6, 7, 8, 9].map((nr) => ({ nr, beauftragt: nr <= 8 })), umbauzuschlag_prozent: 0, nebenkosten_prozent: 5, ust_satz: 19, pauschal_euro: null,
    } })).json();

    await page.goto(`/Fees?tab=contracts&projekt=${encodeURIComponent(projekt.id)}`);
    await page.locator(`[data-testid="vertrag-zeile"][data-nummer="${vertrag.nummer}"]`).getByRole("button", { name: vertrag.nummer }).click();
    const konto = page.getByTestId("vertragskonto");
    await expect(konto).toBeVisible({ timeout: 30000 });
    await expect(konto.getByTestId("stand-geschaetzt")).toBeVisible();

    await konto.getByTestId("stand-pflegen").click();
    const pflege = konto.getByTestId("stand-pflege");
    await pflege.getByLabel("LPH 1 (%)").fill("100");
    await pflege.getByLabel("LPH 2 (%)").fill("40");
    await pflege.getByRole("button", { name: "Speichern" }).click();

    await expect.poll(async () => (await (await request.get(`${API}/HoaiPlan?project_id=${projekt.id}`)).json())[0]?.progress?.slice(0, 2)).toEqual([100, 40]);
    await expect(konto.getByTestId("stand-geschaetzt")).toHaveCount(0);
    await expect(konto).toContainText("LPH 2: 40 %");
  } finally {
    await aufraeumen(request);
  }
});
