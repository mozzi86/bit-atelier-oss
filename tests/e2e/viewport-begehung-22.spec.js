// Phase 22 evidence (designer viewport & 3D walk), the parts only a browser can show:
//  - VP-01: the massing studio is ONE viewport — 2D / Iso / 2D | Iso switch on the same footprint state, the Exposé button in
//           the iso view downloads a real PNG named Expose_<JJJJMMTT>.png.
//  - VP-02: the "Nachbarn" switch stays visible in every mode (no OSM call here: the network outside localhost is blocked).
//  - VP-04: walk in the terrain view — eye camera 1.7 m over the ground, W walks north (−z), S south, Esc ends the walk and the
//           orbit pose comes back unchanged (yaw, pitch, camera z as before).
//  - VP-05: the Exposé image of the terrain view is a PNG with the footer strip (taller than the canvas).
// Nothing is written to the DB: the terrain spec answers the elevation API and the BuildingComplex record by page.route
// (pattern gelaende-103.spec.js); the massing spec only switches views. Neutral placeholder site, invented flat-ish terrain.
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";

/** PNG file signature (8 bytes). */
const PNG_SIGNATUR = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** Height of a PNG from its IHDR chunk, px. @param {Buffer} b */
const pngHoehe = (b) => b.readUInt32BE(20);
/** Width of a PNG from its IHDR chunk, px. @param {Buffer} b */
const pngBreite = (b) => b.readUInt32BE(16);

/**
 * Collects console errors and page errors that are not offline noise.
 * @param {import("@playwright/test").Page} page
 */
function konsoleSammeln(page) {
  /** @type {string[]} */
  const fehler = [];
  page.on("console", (m) => { if (m.type() === "error" && (/WebGLProgram|Shader/i.test(m.text()) || !ERLAUBT_OFFLINE.test(m.text()))) fehler.push(m.text()); });
  page.on("pageerror", (e) => { const s = e.stack || String(e); if (!/WebGLProgram|getUniforms|WebGLRenderer/.test(s)) fehler.push(`pageerror ${s.split("\n")[0]}`); });
  return fehler;
}

/**
 * Clicks the Exposé button and returns the downloaded file.
 * @param {import("@playwright/test").Page} page
 * @param {import("@playwright/test").Locator} knopf
 */
async function exposeLaden(page, knopf) {
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 20000 }), knopf.click()]);
  const pfad = await download.path();
  const fs = await import("node:fs");
  return { name: download.suggestedFilename(), daten: fs.readFileSync(/** @type {string} */ (pfad)) };
}

test("22 Massing-Studio: ein Viewport 2D / Iso / 2D | Iso, Nachbarn in jedem Modus, Exposé-PNG aus der Iso", async ({ page }) => {
  test.setTimeout(120000);
  await nurLocalhost(page);
  const fehler = konsoleSammeln(page);

  await page.goto("/ComplexDesigner?projekt=Review%20Testhaus&tab=studio");
  const flaeche = page.locator('polygon[data-griff="flaeche"]');
  await expect(flaeche).toBeVisible({ timeout: 60000 });
  const umschalter = page.getByRole("group", { name: "Ansicht umschalten" });
  const knopf = (/** @type {string} */ a) => umschalter.locator(`button[data-ansicht="${a}"]`);
  await expect(knopf("2d")).toHaveAttribute("aria-pressed", "true");
  const nachbarn = page.getByRole("checkbox", { name: "Nachbarn" });
  await expect(nachbarn).toBeChecked(); // default on
  // R-22-01: the footprint coordinates in plain 2D before the round trip 2D → Iso → split → 2D
  const punkte2d = await flaeche.getAttribute("points");
  expect(punkte2d?.trim().split(/\s+/).length).toBeGreaterThanOrEqual(3);

  // Iso: the 3D view replaces the plan; the footprint handles are gone, a WebGL canvas stands in its place
  await knopf("3d").click();
  await expect(knopf("3d")).toHaveAttribute("aria-pressed", "true");
  const iso = page.getByTestId("mv-3d");
  await expect(iso).toBeVisible({ timeout: 30000 });
  await expect(iso.locator("canvas").first()).toBeVisible({ timeout: 30000 });
  await expect(flaeche).toHaveCount(0);
  await expect(iso, "eine Iso-Instanz in jedem Modus (75-08 H)").toHaveCount(1);
  await expect(page.getByTestId("ms-iso-hinweis")).toBeVisible();
  await expect(nachbarn).toBeVisible();

  // Exposé from the iso: a real PNG, today's name
  const bild = await exposeLaden(page, iso.getByRole("button", { name: "Exposé-Bild" }));
  expect(bild.name).toMatch(/^Expose_\d{8}\.png$/);
  expect([...bild.daten.subarray(0, 8)]).toEqual(PNG_SIGNATUR);
  expect(pngBreite(bild.daten)).toBeGreaterThan(0);

  // split: plan and iso side by side on the same state
  await knopf("split").click();
  await expect(knopf("split")).toHaveAttribute("aria-pressed", "true");
  await expect(flaeche).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId("mv-3d")).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId("mv-3d")).toHaveCount(1);
  await expect(nachbarn).toBeVisible();

  // back to 2D: the plan with the same footprint; the iso moves back into the lower card (still one instance, no hint)
  const punkteVorher = await flaeche.getAttribute("points");
  await knopf("2d").click();
  await expect(knopf("2d")).toHaveAttribute("aria-pressed", "true");
  await expect(flaeche).toBeVisible();
  await expect(page.getByTestId("mv-3d")).toHaveCount(1);
  await expect(page.getByTestId("ms-iso-hinweis")).toHaveCount(0);
  expect((await flaeche.getAttribute("points"))?.split(" ").length).toBe(punkteVorher?.split(" ").length);
  // R-22-01: same corners at the same plan coordinates as before the round trip, not only the same corner count
  expect(await flaeche.getAttribute("points"), "Grundriss-Koordinaten nach 2D → Iso → 2D | Iso → 2D").toBe(punkte2d);
  expect(fehler, `Konsole: ${fehler.join(" | ")}`).toEqual([]);
});

/** Placeholder site (no real address). */
const ORT = { lat: 49.45, lng: 11.08, address: "Musterweg 1, Musterstadt" };
/** Invented terrain, m a.s.l.: 300 m, +1 cm per metre north. @param {number} lat degrees */
const hoehe = (lat) => Math.round((300 + 0.01 * (lat - ORT.lat) * 111000) * 10) / 10;
const KOMPLEX = {
  id: "e2e-22-komplex",
  name: "Testanlage 22",
  location: ORT,
  site_parcel: { points: [{ x: 584, y: 388 }, { x: 616, y: 388 }, { x: 616, y: 412 }, { x: 584, y: 412 }], m_per_px: 1.25, assumed: false },
  buildings: [{ id: "b1", name: "Haus A", x: 592, y: 394, width: 16, height: 12, floors: 2 }],
};

test("22 Gelände 3D: Begehung auf Augenhöhe, W/S laufen Nord/Süd, Esc stellt die Orbit-Pose wieder her; Exposé mit Fußzeile", async ({ page }) => {
  test.setTimeout(150000);
  await nurLocalhost(page);
  const fehler = konsoleSammeln(page);
  await page.route("**/api/elevation**", (route) => {
    const u = new URL(route.request().url());
    const lats = (u.searchParams.get("lat") || "").split(",").map(Number);
    return route.fulfill({ json: { elevation: lats.map((la) => hoehe(la)) } });
  });
  await page.route(/\/api\/entities\/BuildingComplex(\?|\/|$)/, (route) => {
    const req = route.request();
    if (req.method() === "GET") return route.fulfill({ json: [KOMPLEX] });
    let body = {};
    try { body = JSON.parse(req.postData() || "{}"); } catch { /* no body */ }
    return route.fulfill({ json: { ...body, id: KOMPLEX.id } }); // autosave answered here, never reaches the DB
  });

  await page.goto("/ComplexDesigner?projekt=Review%20Testhaus&tab=terrain");
  const ansicht = page.getByTestId("gelaende-ansicht");
  await expect(ansicht).toBeVisible({ timeout: 60000 });
  await expect(page.getByTestId("gelaende-quelle")).toHaveAttribute("data-synthetisch", "nein", { timeout: 30000 });
  const begehung = page.getByTestId("gelaende-begehung");
  await expect(begehung).toBeEnabled({ timeout: 30000 });
  /** Camera state the view writes every frame (yaw/pitch in degrees, z and height over ground in metres). */
  const pose = async () => ({
    yaw: Number(await ansicht.getAttribute("data-yaw")),
    pitch: Number(await ansicht.getAttribute("data-pitch")),
    z: Number(await ansicht.getAttribute("data-kamera-z")),
    ueber: Number(await ansicht.getAttribute("data-kamera-ueber-gelaende")),
  });
  await expect.poll(async () => (await pose()).ueber).toBeGreaterThan(5);
  await page.waitForTimeout(300);
  const orbit = await pose();

  // start: eye camera at the south edge, looking north (yaw 0), 1.7 m over the ground
  await begehung.click();
  await expect(begehung).toHaveAttribute("title", "Begehung beenden (Esc)");
  await expect.poll(async () => (await pose()).ueber, { message: "Augenhöhe 1,7 m" }).toBeCloseTo(1.7, 1);
  const start = await pose();
  expect(start.yaw).toBe(0);
  expect(start.z, "Start am Südrand (+z = Süd)").toBeGreaterThan(0);

  // W held: walks north = z falls; the eye stays about 1.7 m over the (rising) ground
  await page.keyboard.down("w");
  await expect.poll(async () => (await pose()).z, { timeout: 10000, message: "W läuft nach Norden" }).toBeLessThan(start.z - 1);
  await page.keyboard.up("w");
  await page.waitForTimeout(400);
  const nachW = await pose();
  expect(nachW.ueber).toBeGreaterThan(1.2);
  expect(nachW.ueber).toBeLessThan(2.2);
  // S held: walks back south = z grows
  await page.keyboard.down("s");
  await expect.poll(async () => (await pose()).z, { timeout: 10000, message: "S läuft nach Süden" }).toBeGreaterThan(nachW.z + 0.5);
  await page.keyboard.up("s");
  // A/D strafe: z (north–south) does not change while looking north
  await page.waitForTimeout(200);
  const vorSeite = await pose();
  await page.keyboard.down("d");
  await page.waitForTimeout(600);
  await page.keyboard.up("d");
  await page.waitForTimeout(200);
  expect(Math.abs((await pose()).z - vorSeite.z), "D geht seitwärts, nicht nach Norden/Süden").toBeLessThan(0.05);

  // Esc ends the walk: the orbit pose is back exactly (the walk never touched it)
  await page.keyboard.press("Escape");
  await expect(begehung).toHaveAttribute("title", "Begehung auf Augenhöhe starten");
  await expect(page.getByText("Begehung aktiv", { exact: false })).toHaveCount(0);
  await expect.poll(async () => (await pose()).ueber).toBeGreaterThan(5);
  const zurueck = await pose();
  expect({ yaw: zurueck.yaw, pitch: zurueck.pitch, z: zurueck.z }).toEqual({ yaw: orbit.yaw, pitch: orbit.pitch, z: orbit.z });

  // keys outside the walk do not move the camera
  await page.keyboard.down("w");
  await page.waitForTimeout(400);
  await page.keyboard.up("w");
  expect((await pose()).z).toBe(orbit.z);

  // Exposé of the terrain: PNG with the footer strip below the canvas image (B-103-04)
  const canvas = ansicht.locator("canvas").first();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("kein Canvas in der Geländeansicht");
  const bild = await exposeLaden(page, page.getByRole("button", { name: "Exposé-Bild" }));
  expect(bild.name).toMatch(/^Expose_\d{8}\.png$/);
  expect([...bild.daten.subarray(0, 8)]).toEqual(PNG_SIGNATUR);
  const breite = pngBreite(bild.daten), hoeheBild = pngHoehe(bild.daten);
  // rendered at pixel ratio 2: width = 2 × canvas CSS width; the footer adds three lines below the 2× image
  expect(Math.abs(breite - 2 * box.width), `Breite ${breite} vs. 2 × ${box.width}`).toBeLessThan(3);
  expect(hoeheBild, "Fußzeile unter dem Bild").toBeGreaterThan(2 * box.height + 18);
  expect(fehler, `Konsole: ${fehler.join(" | ")}`).toEqual([]);
});
