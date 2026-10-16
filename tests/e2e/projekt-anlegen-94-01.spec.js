// 94-01 (B-ABN-06, regression of N-06): a project created under /Projects?neu=1
// must become the ACTIVE project — top bar, ?projekt= and localStorage — and the
// form must close, even when the page was opened with ?projekt=<other id>.
// Does not touch the Review Testhaus; creates its own project and deletes it.
import { test, expect } from "@playwright/test";

const API = "/api"; // through the Vite proxy, like the other specs
const NAME = "E2E 94-01 Neues Projekt";

/** Deletes leftovers of earlier runs (a timeout never reaches `finally`). */
async function resteLoeschen(request) {
  const res = await request.get(`${API}/entities/Project`);
  const liste = res.ok() ? await res.json() : [];
  for (const p of liste.filter((x) => x.name === NAME)) {
    await request.delete(`${API}/entities/Project/${p.id}`);
  }
  return liste.filter((x) => x.name !== NAME);
}

test("neu angelegtes Projekt wird aktiv, Formular schließt (94-01)", async ({ page, request }) => {
  const vorher = await resteLoeschen(request);
  const alt = vorher.find((p) => !p.archiviert_am);
  test.skip(!alt, "needs at least one existing project to start from");

  try {
    await page.goto(`/Projects?projekt=${encodeURIComponent(alt.id)}&neu=1`);
    await expect(page.locator("#name")).toBeVisible();

    await page.locator("#name").fill(NAME);
    await page.getByRole("combobox", { name: "Projekttyp" }).click();
    await page.getByRole("option").first().click();
    await page.locator("#location").fill("Musterstadt");
    await page.getByRole("button", { name: "Projekt anlegen" }).click();

    // The new id from the API — the only project with this name.
    await expect.poll(async () => {
      const r = await request.get(`${API}/entities/Project`);
      return (await r.json()).filter((p) => p.name === NAME).length;
    }).toBe(1);
    const neu = (await (await request.get(`${API}/entities/Project`)).json()).find((p) => p.name === NAME);

    // Form closed.
    await expect(page.locator("#name")).toHaveCount(0);
    // Active project: URL, storage and top bar all show the new one — and stay there
    // after the context's project reload has run.
    await expect.poll(() => new URL(page.url()).searchParams.get("projekt")).toBe(neu.id);
    await page.waitForTimeout(1500);
    expect(new URL(page.url()).searchParams.get("projekt")).toBe(neu.id);
    expect(await page.evaluate(() => localStorage.getItem("currentProjectId"))).toBe(neu.id);
    await expect(page.getByRole("combobox", { name: "Aktuelles Projekt" })).toContainText(NAME);
  } finally {
    await resteLoeschen(request);
  }
});
