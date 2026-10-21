// Headless-Nachweis 104-05 Objektfang: im Massing-Modellierer zeigt die Glyphe Endpunkt (mit dem alten Eck-Marker
// mm-fang-ecke) und Mitte, Polar spurt vom letzten Punkt, „ortho“ per Befehl schaltet Ortho (Polar aus), Kontextmenü-
// Gruppe „Fang“ als menuitemcheckbox, F8 schaltet, „polar 45“ in der Befehlszeile, Einmal-Fang „nae“ über das
// Eingabefeld; im Lageplan (SVG-Plan ohne Standort) fangen Polygonpunkte Ecken und Kantenmitte eines Baufelds und
// spuren polar — das gespeicherte Polygon liegt exakt auf den Fangpunkten. Eigene Projekte, Aufräumen im finally.
import { test, expect } from "./fixtures/base.js";
import { nurLocalhost } from "./fixtures/massing.js";

const NAME = "E2E Objektfang 10405";
const NAME_LP = "E2E Objektfang 10405 Lageplan";

/** @param {any} request @param {string} name */
async function altWeg(request, name) {
  for (const alt of await (await request.get(`/api/entities/Project?name=${encodeURIComponent(name)}`)).json()) {
    for (const c of await (await request.get(`/api/entities/BuildingComplex?project_id=${alt.id}`)).json()) await request.delete(`/api/entities/BuildingComplex/${c.id}`);
    for (const m of await (await request.get(`/api/entities/BimModel?project_id=${alt.id}`)).json()) await request.delete(`/api/entities/BimModel/${m.id}`);
    await request.delete(`/api/entities/Project/${alt.id}`);
  }
}

test("104-05 Modellierer: Endpunkt/Mitte/Polar/Ortho, Kontextmenü-Fang, F8, polar 45, Einmal-Fang", async ({ page, request }) => {
  test.setTimeout(150000);
  await altWeg(request, NAME);
  const id = (await (await request.post("/api/entities/Project", { data: { name: NAME, build_kind: "neubau", status: "concept" } })).json()).id;
  try {
    await nurLocalhost(page);
    await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME)}&tab=studio`);
    await expect(page.getByTestId("mm-leiste")).toBeVisible({ timeout: 60000 });
    await page.waitForFunction(() => !!(/** @type {any} */ (window).__bitBefehle));
    const zeile = (/** @type {any} */ anfrage) => page.evaluate((z) => JSON.parse(/** @type {any} */ (window).__bitBefehle.zeileBearbeiten(z)), JSON.stringify(anfrage));
    const befehl = (/** @type {string} */ b, /** @type {any} */ params = {}) => zeile({ id: b, method: "ausfuehren", params: { befehl: b, params } });

    // a body in the middle of the plan (clicked like 98-02: the plan's top-left corner sits under the hint bar)
    expect(await befehl("linie")).toMatchObject({ ok: true });
    const flaeche = page.getByTestId("mm-flaeche");
    const at = async (/** @type {number} */ fx, /** @type {number} */ fy) => {
      await flaeche.evaluate((el) => el.scrollIntoView({ block: "center" }));
      const box = /** @type {{x:number,y:number,width:number,height:number}} */ (await flaeche.boundingBox());
      return { x: box.x + box.width * fx, y: box.y + box.height * fy };
    };
    for (const [fx, fy] of [[0.3, 0.5], [0.42, 0.5], [0.42, 0.62], [0.3, 0.62], [0.3, 0.5]]) {
      const q = await at(fx, fy);
      await page.mouse.move(q.x, q.y);
      await page.mouse.click(q.x, q.y);
    }
    await expect(page.getByTestId("mm-koerper")).toHaveCount(1);
    const profil = (await befehl("modell")).result.koerper[0].profil;
    const breiteM = Math.max(...profil.map((q) => q.x)) - Math.min(...profil.map((q) => q.x));
    expect(breiteM).toBeGreaterThan(3);
    const register = await zeile({ id: "l", method: "befehle" });
    for (const b of ["fang", "ortho", "polar", "raster", "end", "mit", "sch", "lot", "nae"]) expect(register.result.map((x) => x.id)).toContain(b);

    // screen point of a plan position given as a fraction of the body's outline box (+ offset in metres)
    const pfad = page.locator("[data-testid=mm-koerper] path").first();
    await pfad.scrollIntoViewIfNeeded();
    const bild = async (/** @type {number} */ fx, /** @type {number} */ fy, dxM = 0, dyM = 0) => pfad.evaluate((el, a) => {
      const p = /** @type {SVGPathElement} */ (el);
      p.scrollIntoView({ block: "center" });
      const b = p.getBBox(), m = /** @type {DOMMatrix} */ (p.getScreenCTM());
      const proM = b.width / a[4]; // user units per metre (body width in metres from the model)
      const q = new window.DOMPoint(b.x + b.width * a[0] + a[2] * proM, b.y + b.height * a[1] + a[3] * proM).matrixTransform(m);
      return { x: q.x, y: q.y };
    }, [fx, fy, dxM, dyM, breiteM]);
    const fang = page.getByTestId("mm-fang");

    expect(await befehl("linie")).toMatchObject({ ok: true });
    const ecke = await bild(0, 0, 0.1, 0.05);
    await page.mouse.move(ecke.x, ecke.y);
    await expect(fang).toHaveAttribute("data-art", "endpunkt");
    await expect(page.getByTestId("mm-fang-ecke")).toBeVisible(); // 98-02 marker kept
    const mitte = await bild(0.5, 0, 0.15, 0.1);
    await page.mouse.move(mitte.x, mitte.y);
    await expect(fang).toHaveAttribute("data-art", "mitte");

    // first point on the corner, then polar tracking 0° (pointer 1° off the axis, far from the body)
    await page.mouse.move(ecke.x, ecke.y);
    await page.mouse.click(ecke.x, ecke.y);
    const weit = await bild(0, 0, breiteM + 12, -0.2);
    await page.mouse.move(weit.x, weit.y);
    await expect(fang).toHaveAttribute("data-art", "polar");
    await expect(fang).toContainText("0°");

    // ortho by command: polar switches off, a 30° pointer is forced onto the axis
    expect(await befehl("ortho")).toMatchObject({ ok: true, result: true });
    await expect(page.getByTestId("mm-schalter-ortho")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("mm-schalter-polar")).toHaveAttribute("aria-pressed", "false");
    const schraeg = await bild(0, 0, breiteM + 8, -(breiteM + 8) * 0.58);
    await page.mouse.move(schraeg.x, schraeg.y);
    await expect(fang).toHaveAttribute("data-art", "ortho");

    // right-click menu: group "Fang" with checkbox entries; unticking Ortho switches it off
    await page.mouse.click(schraeg.x, schraeg.y, { button: "right" });
    const menue = page.getByTestId("mm-kontextmenue");
    await expect(menue.getByRole("menuitemcheckbox", { name: /Ortho/ })).toHaveAttribute("aria-checked", "true");
    await expect(menue.getByRole("menuitemcheckbox", { name: /Objektfang/ })).toHaveAttribute("aria-checked", "true");
    await menue.getByRole("menuitemcheckbox", { name: /Ortho/ }).click();
    await expect(page.getByTestId("mm-schalter-ortho")).toHaveAttribute("aria-pressed", "false");

    // F8 toggles ortho on and off again
    await page.keyboard.press("F8");
    await expect(page.getByTestId("mm-schalter-ortho")).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("F8");
    await expect(page.getByTestId("mm-schalter-ortho")).toHaveAttribute("aria-pressed", "false");

    // one-shot "nae" (nearest, off by default) through the input field of the running command
    expect(await befehl("linie")).toMatchObject({ ok: true });
    const kante = await bild(0.23, 0, 0, -0.15);
    await page.mouse.move(kante.x, kante.y);
    await expect(fang).toHaveCount(0); // grid only: no glyph
    await page.getByTestId("mm-eingabe").fill("nae");
    await page.getByTestId("mm-eingabe").press("Enter");
    await expect(page.getByTestId("mm-meldung")).toHaveText("Einmal-Fang: Nächster");
    await page.mouse.move(kante.x + 1, kante.y);
    await expect(fang).toHaveAttribute("data-art", "naechster");
    // Esc drops the armed one-shot snap and its message (review 104-05), the command keeps running
    await page.getByTestId("mm-eingabe").blur();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("mm-meldung")).toHaveText("");
    await page.mouse.move(kante.x, kante.y);
    await expect(fang).toHaveCount(0);
    // so does a tool change: armed again, then "linie" anew → grid only
    await page.getByTestId("mm-eingabe").fill("nae");
    await page.getByTestId("mm-eingabe").press("Enter");
    await page.mouse.move(kante.x + 1, kante.y);
    await expect(fang).toHaveAttribute("data-art", "naechster");
    expect(await befehl("linie")).toMatchObject({ ok: true });
    await page.mouse.move(kante.x, kante.y);
    await expect(fang).toHaveCount(0);

    // idle command line: "polar 45" + Enter
    expect(await befehl("beenden")).toMatchObject({ ok: true });
    await page.mouse.move(5, 5);
    await page.keyboard.type("polar 45");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("mm-schalter-polar")).toHaveAttribute("aria-pressed", "true");
    const gespeichert = await page.evaluate(() => JSON.parse(window.localStorage.getItem("bit.fang") || "null"));
    expect(gespeichert).toMatchObject({ polar: true, polarSchritt_grad: 45, ortho: false, objektfang: true });
  } finally {
    for (const m of await (await request.get(`/api/entities/BimModel?project_id=${id}`)).json()) await request.delete(`/api/entities/BimModel/${m.id}`);
    await request.delete(`/api/entities/Project/${id}`);
  }
});

test("104-05 Lageplan (SVG): Polygon fängt Baufeld-Ecke, Kantenmitte, polar; Fang aus per Kontextmenü", async ({ page, request }) => {
  test.setTimeout(150000);
  await altWeg(request, NAME_LP);
  const id = (await (await request.post("/api/entities/Project", { data: { name: NAME_LP, build_kind: "neubau", status: "concept" } })).json()).id;
  const bc = (await (await request.post("/api/entities/BuildingComplex", { data: {
    project_id: id, name: NAME_LP,
    site_parcel: { id: "site_parcel_main", type: "site_boundary", assumed: false, source: "gezeichnet", m_per_px: 1.25,
      points: [{ x: 300, y: 200 }, { x: 900, y: 200 }, { x: 900, y: 600 }, { x: 300, y: 600 }] },
    designated_areas: [{ id: "bf_10405", type: "baufeld", points: [{ x: 600, y: 300 }, { x: 700, y: 300 }, { x: 700, y: 400 }, { x: 600, y: 400 }] }],
  } })).json()).id;
  try {
    await nurLocalhost(page);
    await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME_LP)}&tab=massing`);
    const plan = page.getByTestId("sd-plan");
    await plan.waitFor({ timeout: 60000 });
    await expect(plan.getByTestId("sd-area")).toHaveCount(1);
    await page.getByRole("button", { name: "Polygon-Zeichenmodus" }).click();
    const svg = plan.locator("svg").first();
    await svg.scrollIntoViewIfNeeded();
    const m = await svg.evaluate((el) => { const c = /** @type {SVGSVGElement} */ (el).getScreenCTM(); return { a: c.a, d: c.d, e: c.e, f: c.f }; });
    const bild = (/** @type {number} */ x, /** @type {number} */ y) => ({ x: m.e + x * m.a, y: m.f + y * m.d });
    const fang = plan.getByTestId("sd-objektfang");
    const hin = async (/** @type {number} */ x, /** @type {number} */ y) => { const p = bild(x, y); await page.mouse.move(p.x, p.y); };
    const klick = async (/** @type {number} */ x, /** @type {number} */ y) => { const p = bild(x, y); await page.mouse.move(p.x, p.y); await page.mouse.click(p.x, p.y); await page.waitForTimeout(120); };

    await hin(602, 302);
    await expect(fang).toHaveAttribute("data-art", "endpunkt");
    await hin(650, 303);
    await expect(fang).toHaveAttribute("data-art", "mitte");
    await klick(602, 302); // → (600, 300) corner of the envelope
    await hin(800, 302);
    await expect(fang).toHaveAttribute("data-art", "polar");
    await klick(800, 302); // → (800, 300) polar 0°
    await klick(802, 400); // → (800, 400) polar 270°
    await klick(601, 401); // → (600, 400) corner
    await klick(600, 300); // start point = close
    await expect(plan.getByTestId("sd-area")).toHaveCount(2);
    // corners exact (object snap), y of the 2nd/3rd point exact (polar), x on the 0.25 m grid (= 0.2 canvas units)
    const punkte = ((await plan.getByTestId("sd-area").nth(1).getAttribute("points")) || "").split(" ").map((q) => q.split(",").map(Number));
    expect(punkte).toHaveLength(4);
    expect(punkte[0]).toEqual([600, 300]);
    expect(punkte[3]).toEqual([600, 400]);
    expect([punkte[1][1], punkte[2][1], punkte[2][0]]).toEqual([300, 400, punkte[1][0]]);
    expect(Math.abs(punkte[1][0] - 800)).toBeLessThan(1.5);
    expect(Math.abs(Math.round(punkte[1][0] * 1.25 * 4) - punkte[1][0] * 1.25 * 4)).toBeLessThan(1e-6);

    // right-click menu: object snap off → near the corner only the grid applies (no glyph)
    const p = bild(500, 500);
    await page.mouse.click(p.x, p.y, { button: "right" });
    const menue = page.getByTestId("sd-kontextmenue");
    await expect(menue.getByRole("menuitemcheckbox", { name: /Objektfang/ })).toHaveAttribute("aria-checked", "true");
    await menue.getByRole("menuitemcheckbox", { name: /Objektfang/ }).click();
    await expect(page.getByTestId("sd-schalter-objektfang")).toHaveAttribute("aria-pressed", "false");
    await hin(602, 302);
    await page.waitForTimeout(200);
    await expect(fang).toHaveCount(0);
  } finally {
    await request.delete(`/api/entities/BuildingComplex/${bc}`);
    await request.delete(`/api/entities/Project/${id}`);
  }
});

test("104-05 Lageplan (Karte): Polar-Glyphe im Overlay, zweiter Punkt liegt exakt auf der Achse", async ({ page, request }) => {
  test.setTimeout(150000);
  const name = `${NAME_LP} Karte`;
  await altWeg(request, name);
  const id = (await (await request.post("/api/entities/Project", { data: { name, build_kind: "neubau", status: "concept" } })).json()).id;
  const bc = (await (await request.post("/api/entities/BuildingComplex", { data: {
    project_id: id, name, location: { lat: 49.4521, lng: 11.0767, address: "Musterstraße 1, Musterstadt" },
    // estimated start square (as in 101-02): clicks are not limited to a drawn plot
    site_parcel: { id: "site_parcel_main", type: "site_boundary", assumed: true, source: "geschaetzt", m_per_px: 1.25, geschaetzte_flaeche_m2: 7500,
      points: [{ x: 360, y: 360 }, { x: 440, y: 360 }, { x: 440, y: 420 }, { x: 360, y: 420 }] },
  } })).json()).id;
  try {
    await nurLocalhost(page);
    await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(name)}&tab=massing`);
    const plan = page.getByTestId("sd-plan");
    await plan.waitFor({ timeout: 60000 });
    await page.getByRole("button", { name: "Polygon-Zeichenmodus" }).click();
    // the map only takes clicks after its style loaded (review 104-05: a click before that went nowhere)
    await expect(plan.locator(".maplibregl-map[data-klick-bereit='1']")).toHaveCount(1, { timeout: 60000 });
    const canvas = plan.locator("canvas.maplibregl-canvas");
    await canvas.scrollIntoViewIfNeeded();
    const k = /** @type {any} */ (await canvas.boundingBox());
    const cx = k.x + k.width / 2, cy = Math.min(k.y + k.height / 2, (page.viewportSize()?.height ?? 720) - 140);
    await page.mouse.click(cx - 60, cy);
    await page.waitForTimeout(150);
    await page.mouse.move(cx + 60, cy - 2);
    const fang = plan.getByTestId("sd-objektfang");
    await expect(fang).toHaveAttribute("data-art", "polar");
    await page.mouse.click(cx + 60, cy - 2);
    await page.waitForTimeout(150);
    await page.mouse.move(cx + 61, cy + 60);
    await expect(fang).toHaveAttribute("data-art", "polar");
    await page.mouse.click(cx + 61, cy + 60);
    await page.waitForTimeout(150);
    await page.getByRole("button", { name: "Polygon schließen" }).click();
    // stored in canvas units: the 2nd point shares the 1st point's y (polar 0°), the 3rd the 2nd point's x (270°)
    await expect.poll(async () => ((await (await request.get(`/api/entities/BuildingComplex/${bc}`)).json()).designated_areas || []).length, { timeout: 20000 }).toBe(1);
    const pts = (await (await request.get(`/api/entities/BuildingComplex/${bc}`)).json()).designated_areas[0].points;
    expect(pts).toHaveLength(3);
    expect(pts[1].y).toBe(pts[0].y);
    expect(pts[2].x).toBe(pts[1].x);
    expect(pts[1].x - pts[0].x).toBeGreaterThan(5);
  } finally {
    await request.delete(`/api/entities/BuildingComplex/${bc}`);
    await request.delete(`/api/entities/Project/${id}`);
  }
});
