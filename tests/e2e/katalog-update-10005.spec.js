// 100-05 (Argon review 18.10.2026): an office catalogue from before 97-02a (demolition under LB 040, no
// LB 084, no KG 212) shows a hint; the button changes nothing until it is confirmed, then moves the row
// to LB 084 and adds KG 212. The test makes the catalogue stale through the API and restores it in finally.
import { test, expect } from "./fixtures/base.js";

const API = "/api/entities";

test("100-05 Katalog-Update: Hinweis, Bestätigung, LB 084 + KG 212", async ({ page, request }) => {
  test.setTimeout(120000);
  const stlb = await (await request.get(`${API}/StlbKatalog`)).json();
  const din = await (await request.get(`${API}/Din276Katalog`)).json();
  // The demolition row of the office catalogue — LB 084 (new seed) or LB 040 (catalogue from before 97-02a).
  const lb084 = stlb.find((r) => !r.projekt_override_id && (String(r.lb) === "084" || (String(r.lb) === "040" && /abbruch/i.test(String(r.name || "")))));
  const kg212 = din.filter((r) => String(r.code) === "212");
  expect(lb084, "Büro-Katalog hat eine Abbruch-Zeile").toBeTruthy();
  try {
    // Stale catalogue: 084 back to 040 (as before 97-02a), KG 212 removed.
    await request.put(`${API}/StlbKatalog/${lb084.id}`, { data: { ...lb084, lb: "040" } });
    for (const r of kg212) await request.delete(`${API}/Din276Katalog/${r.id}`);

    await page.goto("/AVA?tab=mengenregeln");
    const hinweis = page.getByTestId("katalog-update");
    await expect(hinweis).toBeVisible({ timeout: 30000 });
    await page.getByTestId("katalog-update-knopf").click();
    await page.getByRole("button", { name: "Abbrechen" }).click();
    expect(String((await (await request.get(`${API}/StlbKatalog/${lb084.id}`)).json()).lb), "Abbrechen ändert nichts").toBe("040");

    await page.getByTestId("katalog-update-knopf").click();
    await page.getByRole("button", { name: "Übernehmen" }).click();
    await expect(hinweis).toHaveCount(0, { timeout: 20000 });
    expect(String((await (await request.get(`${API}/StlbKatalog/${lb084.id}`)).json()).lb)).toBe("084");
    const neu = await (await request.get(`${API}/Din276Katalog`)).json();
    expect(neu.some((r) => String(r.code) === "212" && String(r.fassung) === "2018")).toBe(true);
  } finally {
    // Restore: LB 084 row as seeded, exactly one KG 212 per original record.
    await request.put(`${API}/StlbKatalog/${lb084.id}`, { data: lb084 });
    const jetzt = await (await request.get(`${API}/Din276Katalog`)).json();
    for (const r of jetzt.filter((x) => String(x.code) === "212")) await request.delete(`${API}/Din276Katalog/${r.id}`);
    for (const r of kg212) { const { id, ...rest } = r; await request.post(`${API}/Din276Katalog`, { data: rest }); }
  }
});
