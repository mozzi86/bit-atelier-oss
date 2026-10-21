// Headless proof of phase 103 (terrain study): orientation overlays (data source, north arrow,
// scale bar, spot heights), the orbit camera never goes below the terrain (drag ±600 px, 20× zoom),
// the vertical exaggeration slider, and the water level study (0 m² / 100 %, monotone flooded area,
// "what floods first" with data-nass, an HQ mark sets the level), and the HQ list of the flood tab
// (stored in complexData.hochwasser, shown as a new mark). Shader errors (THREE.WebGLProgram)
// make the test red explicitly.
//
// Nothing is written to the DB: the elevation API and the BuildingComplex record of the test house are
// answered by page.route (plot, one building body, one HQ value); a save attempt of the autosave is
// answered locally as well. The terrain is an invented plane rising to the north-east.
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";

/** Placeholder site (no real address). */
const ORT = { lat: 49.45, lng: 11.08, address: "Musterweg 1, Musterstadt" };

/**
 * Invented terrain, m a.s.l.: 310 m at the site, +3 cm per metre north, +1 cm per metre east.
 * @param {number} lat degrees @param {number} lng degrees
 */
function hoehe(lat, lng) {
  const nordM = (lat - ORT.lat) * 111000;
  const ostM = (lng - ORT.lng) * 111000 * Math.cos((ORT.lat * Math.PI) / 180);
  return Math.round((310 + 0.03 * nordM + 0.01 * ostM) * 10) / 10;
}

/** BuildingComplex of the test house as the stub delivers it: canvas px, 1.25 m per px, origin (600, 400). */
const KOMPLEX = {
  id: "e2e-103-komplex",
  name: "Testanlage 103",
  location: ORT,
  // 40 × 30 m plot around the site, NOT estimated (an estimated parcel would not be drawn).
  site_parcel: { points: [{ x: 584, y: 388 }, { x: 616, y: 388 }, { x: 616, y: 412 }, { x: 584, y: 412 }], m_per_px: 1.25, assumed: false },
  // 20 × 15 m body in the middle, 3 storeys.
  buildings: [{ id: "b1", name: "Haus A", x: 592, y: 394, width: 16, height: 12, floors: 3 }],
  hochwasser: { hq: [{ id: "hq1", name: "HQ100", pegelNHN: "310,2", quelle: "Testwert" }] },
};

test("103 Gelände: Orientierung, Kamera über Gelände, Überhöhung, Wasserpegel", async ({ page }) => {
  test.setTimeout(150000);
  await nurLocalhost(page);
  const fehler = [];
  page.on("console", (m) => { if (m.type() === "error" && (/WebGLProgram|Shader/i.test(m.text()) || !ERLAUBT_OFFLINE.test(m.text()))) fehler.push(m.text()); });
  page.on("pageerror", (e) => fehler.push(`pageerror ${e}`));

  let hoehenAbfragen = 0;
  await page.route("**/api/elevation**", (route) => {
    const u = new URL(route.request().url());
    const lats = (u.searchParams.get("lat") || "").split(",").map(Number);
    const lngs = (u.searchParams.get("lng") || "").split(",").map(Number);
    hoehenAbfragen += 1;
    return route.fulfill({ json: { elevation: lats.map((la, k) => hoehe(la, lngs[k])) } });
  });
  let komplexGeladen = 0;
  /** @type {any} */
  let gespeichert = null;
  await page.route(/\/api\/entities\/BuildingComplex(\?|\/|$)/, (route) => {
    const req = route.request();
    if (req.method() === "GET") { komplexGeladen += 1; return route.fulfill({ json: [KOMPLEX] }); }
    // Autosave or explicit save: answered here, never reaches the DB.
    let body = {};
    try { body = JSON.parse(req.postData() || "{}"); } catch { /* no body */ }
    gespeichert = body;
    return route.fulfill({ json: { ...body, id: KOMPLEX.id } });
  });

  await page.goto("/ComplexDesigner?projekt=Review%20Testhaus&tab=terrain");
  const ansicht = page.getByTestId("gelaende-ansicht");
  await expect(ansicht).toBeVisible({ timeout: 60000 });
  expect(komplexGeladen, "BuildingComplex-GET wurde nicht abgefangen — Lade-URL geändert?").toBeGreaterThan(0);

  // --- 103-01 orientation overlays -------------------------------------------------------------
  const quelle = page.getByTestId("gelaende-quelle");
  await expect(quelle).toHaveAttribute("data-synthetisch", "nein", { timeout: 30000 });
  expect(hoehenAbfragen).toBeGreaterThan(0);
  await expect(quelle).toContainText("Copernicus DEM GLO-90");
  await expect(quelle).toContainText("m ü. NHN (näherungsweise)");
  await expect(page.getByTestId("gelaende-nord")).toBeVisible();
  await expect(page.getByTestId("gelaende-massstab")).toContainText(/\d m/);
  await expect(page.getByTestId("gelaende-massstab")).toContainText("≈ in Bildmitte");
  for (const art of ["tief", "hoch", "mitte"]) {
    await expect(page.getByTestId(`gelaende-kote-${art}`)).toContainText(/\d{3},\d m ü\. NHN/);
  }
  await expect(page.getByTestId("gelaende-kote-mitte")).toBeVisible();
  // Camera starts SOUTH of the target (+z = south) and above the terrain.
  await expect.poll(async () => Number(await ansicht.getAttribute("data-kamera-z"))).toBeGreaterThan(0);
  await expect.poll(async () => Number(await ansicht.getAttribute("data-kamera-ueber-gelaende"))).toBeGreaterThan(0);

  // --- Orbit: drag ±600 px and zoom in 20× — the camera stays above the terrain ------------------
  const canvas = ansicht.locator("canvas").first();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("kein Canvas in der Geländeansicht");
  const mx = box.x + box.width / 2, my = box.y + box.height / 2;
  const pruefeKamera = async (wann) => {
    await page.waitForTimeout(150); // a few frames
    const ueber = Number(await ansicht.getAttribute("data-kamera-ueber-gelaende"));
    const pitch = Number(await ansicht.getAttribute("data-pitch"));
    expect(ueber, `Kamera unter dem Gelände (${wann})`).toBeGreaterThan(0);
    expect(pitch, `Pitch außerhalb [12°, 85°] (${wann})`).toBeGreaterThanOrEqual(12);
    expect(pitch, `Pitch außerhalb [12°, 85°] (${wann})`).toBeLessThanOrEqual(85);
  };
  for (const [dx, dy] of [[600, 600], [-600, -600], [-600, 600], [600, -600]]) {
    await page.mouse.move(mx, my);
    await page.mouse.down();
    await page.mouse.move(mx + dx / 2, my + dy / 2, { steps: 12 });
    await page.mouse.up();
    await pruefeKamera(`Ziehen ${dx}/${dy}`);
  }
  await page.mouse.move(mx, my);
  for (let k = 0; k < 20; k++) await page.mouse.wheel(0, -400);
  await pruefeKamera("20× hineingezoomt");
  for (let k = 0; k < 20; k++) await page.mouse.wheel(0, 400);
  await pruefeKamera("20× herausgezoomt");

  // --- 103-02 exaggeration --------------------------------------------------------------------
  const ue = page.getByTestId("gelaende-ueberhoehung");
  await ue.fill("5");
  await expect(ansicht).toHaveAttribute("data-ueberhoehung", "5");
  await expect(page.getByTestId("gelaende-ueberhoehung-badge")).toHaveText("Überhöhung 5×");
  await ue.fill("1");
  await expect(page.getByTestId("gelaende-ueberhoehung-badge")).toHaveText("Überhöhung 1× (echt)");
  await pruefeKamera("Überhöhung 1×");

  // --- 103-03 water level ---------------------------------------------------------------------
  await page.getByTestId("gelaende-wasser").check();
  const flaeche = page.getByTestId("gelaende-flut-flaeche");
  const zahl = page.getByTestId("gelaende-pegel-zahl");
  const min = Number(await zahl.getAttribute("min"));
  const max = Number(await zahl.getAttribute("max"));
  expect(max).toBeGreaterThan(min);
  await zahl.fill(String(min));
  await expect(flaeche).toHaveAttribute("data-m2", "0");
  await expect(flaeche).toHaveAttribute("data-anteil", "0");
  const reihen = page.getByTestId("gelaende-flut-reihenfolge").locator("li[data-art]");
  await expect(reihen).toHaveCount(3);
  for (const li of await reihen.all()) await expect(li).toHaveAttribute("data-nass", "nein");
  // Order: plot first (its lowest point), then the body, then the ground floor (OKFF).
  const arten = await reihen.evaluateAll((els) => els.map((e) => e.getAttribute("data-art")));
  expect(arten).toEqual(["grundstueck", "baukoerper", "eg"]);
  const pegelWerte = await reihen.evaluateAll((els) => els.map((e) => Number(e.getAttribute("data-pegel"))));
  expect([...pegelWerte].sort((a, b) => a - b)).toEqual(pegelWerte);

  // Flooded area grows monotonically with the level.
  let vorher = -1;
  for (const p of [309.4, 309.7, 310.0, 310.3, 310.6]) {
    await zahl.fill(String(p));
    await expect(ansicht).toHaveAttribute("data-pegel", p.toFixed(2));
    const m2 = Number(await flaeche.getAttribute("data-m2"));
    expect(m2, `Fläche nicht monoton bei ${p}`).toBeGreaterThanOrEqual(vorher);
    vorher = m2;
  }
  expect(vorher).toBeGreaterThan(0);
  await zahl.fill(String(max));
  await expect(flaeche).toHaveAttribute("data-anteil", "100");
  for (const li of await reihen.all()) await expect(li).toHaveAttribute("data-nass", "ja");
  await expect(page.getByTestId("gelaende-flut-hinweis")).toContainText("Badewannen-Modell");

  // HQ mark from complexData.hochwasser sets the level.
  await page.getByTestId("gelaende-hq-HQ100").click();
  await expect(ansicht).toHaveAttribute("data-pegel", "310.20");
  await expect(page.getByTestId("gelaende-pegel")).toHaveAttribute("aria-valuetext", "310,20 m ü. NHN");
  await page.waitForTimeout(500); // shader with the flood tint compiled and drawn

  // HQ list in the flood tab: stored additively in complexData.hochwasser (the save goes to the stub).
  await page.getByRole("tab", { name: "Hochwasser" }).click();
  await expect(page.getByTestId("hq-liste")).toBeVisible();
  await expect(page.getByTestId("hq-pegel-0")).toHaveValue("310,2");
  await page.getByTestId("hq-hinzufuegen").click();
  await page.getByTestId("hq-name-1").fill("HQextrem");
  await page.getByTestId("hq-pegel-1").fill("311,0");
  await expect.poll(() => gespeichert?.hochwasser?.hq?.length ?? 0, { timeout: 10000 }).toBe(2);
  expect(gespeichert.hochwasser.hq[1]).toMatchObject({ name: "HQextrem", pegelNHN: "311,0" });
  await page.getByRole("tab", { name: "Gelände 3D" }).click();
  await page.getByTestId("gelaende-wasser").check();
  await page.getByTestId("gelaende-hq-HQextrem").click();
  await expect(page.getByTestId("gelaende-ansicht")).toHaveAttribute("data-pegel", "311.00");

  // 104-16 stays reachable below the view.
  await expect(page.getByTestId("splat-steuerung")).toBeVisible();
  expect(fehler, `Konsole: ${fehler.join(" | ")}`).toEqual([]);
});
