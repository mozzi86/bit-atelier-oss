// Headless-Nachweis 101-07: Rechtsklick auf dem Plan des Massing-Studios und auf der Karte der Baufeld-Planung öffnet das
// eigene Kontextmenü (nicht das Browser-Menü); Einträge mit Tastenkürzel; Esc schließt; „Befehl beenden“ beendet das
// aktive Werkzeug. Testhaus, nur Lesen/Werkzeugwechsel (nichts wird gespeichert).
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";

const NAME = "E2E Kontextmenue 10107";

test("101-07 Rechtsklick: eigenes Menü im Massing-Studio und in der Baufeld-Planung", async ({ page, request }) => {
  test.setTimeout(150000);
  await nurLocalhost(page);
  const warnungen = [];
  page.on("console", (m) => { if (m.type() === "error" && !ERLAUBT_OFFLINE.test(m.text()) && !/WebGL|GPU stall|maplibre|tile|Failed to load resource|Style is not done loading/i.test(m.text())) warnungen.push(m.text()); });
  page.on("pageerror", (e) => { if (!/WebGL|THREE|getUniforms/i.test(String(e.stack || e))) warnungen.push(`pageerror ${e}`); });

  await page.goto("/ComplexDesigner?projekt=Review%20Testhaus&tab=studio");
  await expect(page.getByTestId("mm-leiste")).toBeVisible({ timeout: 60000 });
  await page.getByTestId("mm-linie").click();
  await expect(page.getByTestId("befehlszeile")).toHaveAttribute("data-befehl", "Linie");
  const flaeche = page.getByTestId("mm-flaeche");
  await flaeche.scrollIntoViewIfNeeded();
  await flaeche.click({ button: "right", position: { x: 40, y: 40 } });
  const menue = page.getByTestId("mm-kontextmenue");
  await expect(menue).toBeVisible();
  await expect(menue.getByRole("menuitem", { name: /Befehl beenden/ })).toContainText("Esc");
  await expect(menue.getByRole("menuitem", { name: /Wiederholen: Linie/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menue).toHaveCount(0);
  await flaeche.click({ button: "right", position: { x: 40, y: 40 } });
  await page.getByTestId("mm-kontextmenue").getByRole("menuitem", { name: /Befehl beenden/ }).click();
  await expect(page.getByTestId("mm-leiste")).toHaveAttribute("data-werkzeug", "aus");
  await expect(page.getByTestId("befehlszeile")).toHaveAttribute("data-befehl", "Bereit");

  // Site plan: own project with location + drawn parcel (the test house may have none).
  for (const alt of await (await request.get(`/api/entities/Project?name=${encodeURIComponent(NAME)}`)).json()) await request.delete(`/api/entities/Project/${alt.id}`);
  const id = (await (await request.post("/api/entities/Project", { data: { name: NAME, build_kind: "neubau", status: "concept" } })).json()).id;
  const bc = (await (await request.post("/api/entities/BuildingComplex", { data: { project_id: id, name: NAME,
    location: { lat: 49.4521, lng: 11.0767, address: "Musterstraße 1, Musterstadt" },
    site_parcel: { id: "site_parcel_main", type: "site_boundary", assumed: false, source: "gezeichnet", m_per_px: 1.25, points: [{ x: 360, y: 360 }, { x: 440, y: 360 }, { x: 440, y: 420 }, { x: 360, y: 420 }] } } })).json()).id;
  try {
  await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME)}&tab=massing`);
  const plan = page.getByTestId("sd-plan");
  await plan.waitFor({ timeout: 60000 });
  const ziel = plan.locator(".maplibregl-canvas, svg").first();
  await ziel.waitFor({ timeout: 60000 });
  await ziel.click({ button: "right", position: { x: 60, y: 60 } });
  const sdMenue = page.getByTestId("sd-kontextmenue");
  await expect(sdMenue).toBeVisible();
  await expect(sdMenue.getByRole("menuitem", { name: /Rückgängig/ })).toContainText("Strg+Z");
  await page.mouse.click(5, 5);
  await expect(sdMenue).toHaveCount(0);
  await expect(page.getByTestId("sd-befehlszeile")).toBeVisible();
  expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
  } finally {
    await request.delete(`/api/entities/BuildingComplex/${bc}`);
    await request.delete(`/api/entities/Project/${id}`);
  }
});
