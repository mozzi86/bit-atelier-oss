// Headless-Nachweis 107-07 (Inferenz, Arrays, Hilfslinien) im echten Browser. Modellierer: (1) Linie zeichnen → Körper;
// (2) der Spurstrahl trägt die Achse (0° = x, Token fehler, „X“ im Text; 270° = y, Token erfolg) — Farbe nie allein;
// (3) Umschalt gedrückt sperrt die Achse (ortho) nur für diesen Befehl, die Fang-Schalter bleiben unverändert; (4) Hilfslinie
// anlegen, weit weg von ihren Punkten einrasten, gespeichert in massing_layer.hilfslinien; (5) Rechteck um einen geklickten
// Drehpunkt drehen mit Strg+Enter (Kopie) und „*4“ — Vorschau der Reihe vor Enter, danach vier gedrehte Kopien;
// (6) F8/F10 schalten weiter wie bisher. Lageplan (SVG): Strg-Kopie, dann „*3“ getippt → Reihe, „/2“ im Eingabefeld →
// geteilte Reihe. Eigene Projekte, Aufräumen im finally, Konsole sauber.
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";

const NAME = "E2E Bauteilkern 10707";
const NAME_LP = "E2E Bauteilkern 10707 Lageplan";

/** Block 6 × 4 m at site (10, 10), 3 m high. */
const BLOCK = { id: "k1", name: "Block", profil: [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 4 }, { x: 0, y: 4 }], hoehe: 3, basis: 0, pos: { x: 10, y: 10 }, drehung: 0, gruppe: null };

/** @param {any} request @param {string} name */
async function altWeg(request, name) {
  for (const alt of await (await request.get(`/api/entities/Project?name=${encodeURIComponent(name)}`)).json()) {
    for (const c of await (await request.get(`/api/entities/BuildingComplex?project_id=${alt.id}`)).json()) await request.delete(`/api/entities/BuildingComplex/${c.id}`);
    for (const m of await (await request.get(`/api/entities/BimModel?project_id=${alt.id}`)).json()) await request.delete(`/api/entities/BimModel/${m.id}`);
    await request.delete(`/api/entities/Project/${alt.id}`);
  }
}

/** @param {import("@playwright/test").Page} page @returns {string[]} console errors / warnings that are not offline noise */
function konsole(page) {
  /** @type {string[]} */
  const w = [];
  page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text()) && !/WebGL|GPU stall|maplibre|tile|Failed to load resource|Style is not done loading/i.test(m.text())) w.push(m.text()); });
  page.on("pageerror", (e) => { if (!/WebGL|THREE|getUniforms/i.test(String(e.stack || e))) w.push(`pageerror ${e}`); });
  return w;
}

test("107-07 Modellierer: Linie, Achsfarbe, Umschalt-Sperre, Hilfslinie einrasten und speichern, Drehen mit *4, F3/F8/F10", async ({ page, request }) => {
  test.setTimeout(180000);
  await altWeg(request, NAME);
  const id = (await (await request.post("/api/entities/Project", { data: { name: NAME, build_kind: "neubau", status: "concept" } })).json()).id;
  await request.post("/api/entities/BimModel", { data: { project_id: id, massing_layer: { koerper: [BLOCK], gruppen: {}, naechsteId: 2 } } });
  try {
    await nurLocalhost(page);
    const warnungen = konsole(page);
    await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME)}&tab=studio`);
    await expect(page.getByTestId("mm-leiste")).toBeVisible({ timeout: 60000 });
    await expect(page.getByTestId("mm-koerper")).toHaveCount(1);
    await page.waitForFunction(() => !!(/** @type {any} */ (window).__bitBefehle));
    const befehl = (/** @type {string} */ b, /** @type {any} */ params = {}) => page.evaluate((a) => /** @type {any} */ (window).__bitBefehle.ausfuehren(a[0], a[1]), [b, params]);
    const modell = async () => (await befehl("modell")).result;

    // site metres → screen through the block outline (site 10…16 × 10…14) and the live screen matrix
    const pfad = page.locator('[data-testid=mm-koerper][data-id="k1"] path').first();
    await pfad.evaluate((el) => el.scrollIntoView({ block: "center" }));
    const bild = async (/** @type {number} */ x, /** @type {number} */ y) => pfad.evaluate((el, a) => {
      const p = /** @type {SVGPathElement} */ (el);
      const b = p.getBBox(), m = /** @type {DOMMatrix} */ (p.getScreenCTM());
      const proM = b.width / 6;
      const q = new window.DOMPoint(b.x + (a[0] - 10) * proM, b.y + (a[1] - 10) * proM).matrixTransform(m);
      return { x: q.x, y: q.y };
    }, [x, y]);
    const hin = async (/** @type {number} */ x, /** @type {number} */ y) => { const q = await bild(x, y); await page.mouse.move(q.x, q.y); };
    const klick = async (/** @type {number} */ x, /** @type {number} */ y) => { const q = await bild(x, y); await page.mouse.move(q.x, q.y); await page.mouse.click(q.x, q.y); await page.waitForTimeout(80); };
    const fang = page.getByTestId("mm-fang");

    // (1) a rectangle drawn with the line tool closes into a second body
    expect(await befehl("linie")).toMatchObject({ ok: true });
    for (const [x, y] of [[20, 10], [24, 10], [24, 13], [20, 13], [20, 10]]) await klick(x, y);
    await expect(page.getByTestId("mm-koerper")).toHaveCount(2);

    // (2) the tracking ray carries its axis: 0° = x (token fehler, "X" in the label, long dashes), 270° = y (token erfolg)
    expect(await befehl("linie")).toMatchObject({ ok: true });
    await klick(20, 20);
    await hin(26, 20.1);
    await expect(fang).toHaveAttribute("data-art", "polar");
    const strahl = page.getByTestId("mm-fang-strahl");
    await expect(strahl).toHaveAttribute("data-achse", "x");
    await expect(strahl).toHaveAttribute("data-token", "fehler");
    await expect(strahl).toHaveClass(/stroke-fehler/);
    await expect(page.getByTestId("mm-fang-text")).toHaveText("X 0°");
    const strichX = await strahl.getAttribute("stroke-dasharray");
    await hin(20.1, 26);
    await expect(strahl).toHaveAttribute("data-achse", "y");
    await expect(strahl).toHaveAttribute("data-token", "erfolg");
    await expect(page.getByTestId("mm-fang-text")).toHaveText("Y 270°");
    expect(await strahl.getAttribute("stroke-dasharray")).not.toBe(strichX); // a dash pattern of its own per axis

    // (2b) review 107-07: dark theme — the ray keeps at least 3:1 against the plan background (the canvas turns dark with the tokens)
    await hin(26, 20.1);
    await expect(strahl).toHaveAttribute("data-achse", "x");
    const kontrast = async () => strahl.evaluate((el) => {
      const rgb = (/** @type {string} */ s) => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
      const lum = (/** @type {number[]} */ c) => { const [r, g, b] = c.map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      const svg = /** @type {Element} */ (el.closest("svg"));
      const a = lum(rgb(getComputedStyle(el).stroke)), b = lum(rgb(getComputedStyle(svg).backgroundColor));
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    });
    expect(await kontrast(), "hell: Strahl x gegen Planfläche").toBeGreaterThanOrEqual(3);
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    expect(await kontrast(), "dunkel: Strahl x gegen Planfläche").toBeGreaterThanOrEqual(3);
    await hin(20.1, 26);
    await expect(strahl).toHaveAttribute("data-achse", "y");
    expect(await kontrast(), "dunkel: Strahl y gegen Planfläche").toBeGreaterThanOrEqual(3);
    await page.evaluate(() => document.documentElement.classList.remove("dark"));

    // (3) Shift held = axis lock for this command only; the shared switches stay as they were. Review 107-07: the press itself locks
    // (no pointer move needed), the direction is frozen (crossing 45° does not flip it to the other axis), the release frees it.
    await hin(26, 23); // ~27° — outside the polar tolerance: no ray
    await expect(fang).toHaveCount(0);
    await page.keyboard.down("Shift");
    await expect(fang).toHaveAttribute("data-art", "ortho"); // nearest axis from the base point: x
    await expect(strahl).toHaveAttribute("data-achse", "x");
    await hin(21, 26); // ~80° — free ortho would jump to the y axis, the lock stays on x
    await expect(strahl).toHaveAttribute("data-achse", "x");
    await page.keyboard.up("Shift");
    await expect(fang).toHaveCount(0); // released without moving: free again (~80° is outside polar 90° ± 5°)
    await hin(26, 23);
    await expect(fang).toHaveCount(0);
    await expect(page.getByTestId("mm-schalter-ortho")).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByTestId("mm-schalter-polar")).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");

    // (4) a guide line (infinite) through two clicked points, snapped to far away from them, saved in massing_layer.hilfslinien
    expect(await befehl("hilfslinie")).toMatchObject({ ok: true });
    await expect(page.getByTestId("mm-hilfslinie-zeile")).toBeVisible();
    await klick(10, 30);
    await klick(16, 30);
    await expect(page.getByTestId("mm-hilfslinie-plan")).toHaveCount(1);
    await expect(page.getByTestId("mm-hilfslinie-plan")).toHaveAttribute("data-art", "gerade");
    await expect(page.getByTestId("mm-meldung")).toHaveText("Hilfslinie gesetzt");
    expect((await modell()).hilfslinien).toEqual([{ id: expect.stringMatching(/^h[0-9]+$/), art: "gerade", a: { x: 10, y: 30 }, b: { x: 16, y: 30 } }]);
    expect(await befehl("linie")).toMatchObject({ ok: true });
    await hin(31.1, 30.2);
    await expect(fang).toHaveAttribute("data-art", "hilfsgerade");
    await page.keyboard.press("Escape");
    await expect.poll(async () => {
      const m = (await (await request.get(`/api/entities/BimModel?project_id=${id}`)).json())[0];
      return (m?.massing_layer?.hilfslinien || []).length;
    }, { timeout: 15000 }).toBe(1);

    // (4b) review 107-07: reference edge by resting the pointer > BEZUG_VERWEIL_MS (600 ms) on an oblique guide piece, then a
    // parallel track through the line's start point (∥ in the label, art parallel)
    expect(await befehl("hilfsstrecke")).toMatchObject({ ok: true });
    await klick(30, 30);
    await klick(34, 27); // direction (4, −3): 36.87° on screen, no polar angle
    await page.keyboard.press("Escape");
    expect(await befehl("linie")).toMatchObject({ ok: true });
    await klick(40, 40);
    await expect(page.getByTestId("mm-bezugskante")).toHaveCount(0);
    await hin(32, 28.5); // middle of the guide piece
    await page.waitForTimeout(900);
    await expect(page.getByTestId("mm-bezugskante")).toHaveCount(1);
    await hin(48.1, 34.1); // (40, 40) + 2 × (4, −3), a little off
    await expect(fang).toHaveAttribute("data-art", "parallel");
    await expect(page.getByTestId("mm-fang-text")).toContainText("∥");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("mm-bezugskante")).toHaveCount(0);

    // (4c) one-shot "verl": the extension of a body edge beyond its end (gap between the two blocks on y = 10)
    expect(await befehl("linie")).toMatchObject({ ok: true });
    expect(await befehl("verl")).toMatchObject({ ok: true });
    await hin(18, 10.1);
    await expect(fang).toHaveAttribute("data-art", "verlaengerung");
    await expect(page.getByTestId("mm-fang-text")).toContainText("→");
    await page.keyboard.press("Escape");

    // (4d) the origin (0;0 = "#0;0") is an endpoint snap — nothing else lies near it
    expect(await befehl("linie")).toMatchObject({ ok: true });
    await hin(0.15, 0.12);
    await expect(fang).toHaveAttribute("data-art", "endpunkt");
    await page.keyboard.press("Escape");

    // (5) rotate the block about a clicked centre: Ctrl+Enter = rotated copy, then "*4" — the row is previewed before Enter
    expect(await befehl("drehen")).toMatchObject({ ok: true });
    await klick(13, 12); // select the block
    await expect(page.getByTestId("mm-dreh-zeile")).toBeVisible();
    await klick(30, 12); // beside the bodies = centre
    await expect(page.getByTestId("mm-drehzentrum")).toHaveCount(1);
    await page.keyboard.type("90");
    await page.keyboard.press("Control+Enter");
    await expect(page.getByTestId("mm-koerper")).toHaveCount(3);
    await expect(page.getByTestId("mm-meldung")).toContainText("Gedrehte Kopie gesetzt");
    await page.keyboard.type("*4");
    await expect(page.getByTestId("mm-reihe-vorschau")).toHaveCount(4);
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("mm-koerper")).toHaveCount(6);
    await expect(page.getByTestId("mm-reihe-vorschau")).toHaveCount(0);
    const bloecke = (await modell()).koerper.filter((/** @type {any} */ k) => k.name === "Block");
    expect(bloecke.map((/** @type {any} */ k) => k.drehung).sort((/** @type {number} */ a, /** @type {number} */ b) => a - b)).toEqual([0, 0, 90, 180, 270]);
    // the copies stand on a circle about the centre (30, 12): the block origin (10, 10) is 20.1 m from it
    for (const k of bloecke) expect(Math.hypot(k.pos.x - 30, k.pos.y - 12)).toBeCloseTo(Math.hypot(20, 2), 3);

    // (6) F3 / F8 / F10 as before (F3 open since 104-05: the browser may keep it for "find" — the handler prevents that)
    await page.keyboard.press("F3");
    await expect(page.getByTestId("mm-schalter-objektfang")).toHaveAttribute("aria-pressed", "false");
    await page.keyboard.press("F3");
    await expect(page.getByTestId("mm-schalter-objektfang")).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("F8");
    await expect(page.getByTestId("mm-schalter-ortho")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("mm-schalter-polar")).toHaveAttribute("aria-pressed", "false");
    await page.keyboard.press("F10");
    await expect(page.getByTestId("mm-schalter-polar")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("mm-schalter-ortho")).toHaveAttribute("aria-pressed", "false");

    expect(warnungen).toEqual([]);
  } finally {
    for (const m of await (await request.get(`/api/entities/BimModel?project_id=${id}`)).json()) await request.delete(`/api/entities/BimModel/${m.id}`);
    await request.delete(`/api/entities/Project/${id}`);
  }
});

test("107-07 Lageplan (SVG): Strg-Kopie, getipptes *3 und /2 über dieselbe Eingabe wie im Modellierer", async ({ page, request }) => {
  test.setTimeout(150000);
  await altWeg(request, NAME_LP);
  const id = (await (await request.post("/api/entities/Project", { data: { name: NAME_LP, build_kind: "neubau", status: "concept" } })).json()).id;
  const bc = (await (await request.post("/api/entities/BuildingComplex", { data: {
    project_id: id, name: NAME_LP,
    site_parcel: { id: "site_parcel_main", type: "site_boundary", assumed: false, source: "gezeichnet", m_per_px: 1.25,
      points: [{ x: 300, y: 200 }, { x: 900, y: 200 }, { x: 900, y: 600 }, { x: 300, y: 600 }] },
    buildings: [{ id: "b1", x: 400, y: 300, width: 16, height: 8, floors: 3 }], // 20 × 10 m at 1.25 m/px
  } })).json()).id;
  try {
    await nurLocalhost(page);
    const warnungen = konsole(page);
    await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME_LP)}&tab=massing`);
    const plan = page.getByTestId("sd-plan");
    await plan.waitFor({ timeout: 60000 });
    await page.getByTestId("sd-modus-auswahl").click();
    const svg = plan.locator("svg").first();
    await svg.scrollIntoViewIfNeeded();
    const m = await svg.evaluate((el) => { const c = /** @type {SVGSVGElement} */ (el).getScreenCTM(); return { a: c.a, d: c.d, e: c.e, f: c.f }; });
    const pt = (/** @type {number} */ x, /** @type {number} */ y) => ({ x: m.e + x * m.a, y: m.f + y * m.d });
    const bloecke = () => plan.getByTestId("sd-block").evaluateAll((els) => els.map((e) => Number(String(e.getAttribute("data-mitte")).split(",")[0])).sort((a, b) => a - b));

    // Ctrl + Alt (no snapping) drag 20 px = 25 m to the right → one copy
    await page.keyboard.down("Control"); await page.keyboard.down("Alt");
    const p = pt(408, 304), q = pt(428, 304);
    await page.mouse.move(p.x, p.y); await page.mouse.down();
    await page.mouse.move(q.x, q.y, { steps: 8 }); await page.mouse.up();
    await page.keyboard.up("Alt"); await page.keyboard.up("Control");
    await expect.poll(bloecke).toEqual([510, 535]);
    await expect(page.getByTestId("sd-fang")).toContainText("Kopie gesetzt");
    await expect(page.getByTestId("sd-eingabe")).toBeEnabled();

    // typed "*3" + Enter (keys while the plan is visible) → three copies 25 m apart, the single copy replaced
    await page.keyboard.type("*3");
    await expect(page.getByTestId("sd-eingabe")).toHaveValue("*3");
    await page.keyboard.press("Enter");
    await expect.poll(bloecke).toEqual([510, 535, 560, 585]);
    await expect(page.getByTestId("sd-fang")).toHaveText("3 Kopien im Abstand");

    // "/2" in the command line field → two copies dividing the 25 m step
    await page.getByTestId("sd-eingabe").fill("/2");
    await page.getByTestId("sd-eingabe").press("Enter");
    await expect.poll(bloecke).toEqual([510, 522.5, 535]);
    await expect(page.getByTestId("sd-fang")).toHaveText("2 Kopien im geteilten Abstand");

    // review 107-07: the row works on the CURRENT blocks — the copies deleted (Entf), then "*3": refused with a message, the deleted
    // copies do not come back from an old snapshot
    await page.getByTestId("sd-eingabe").blur(); // plan keys act only while no field has the focus
    await page.keyboard.press("Delete");
    await expect.poll(bloecke).toEqual([510]);
    await page.keyboard.type("*3");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("sd-fang")).toContainText("Kopie oder Original gibt es nicht mehr");
    await expect.poll(bloecke).toEqual([510]);

    // review 107-07: the origin snap sits on the project location (canvas centre 600/400 = DXF 0;0), not on the canvas corner
    await page.getByTestId("sd-modus-riegel").click();
    await svg.scrollIntoViewIfNeeded();
    // the bar panel moves the plan: read its screen matrix again
    const m2 = await svg.evaluate((el) => { const c = /** @type {SVGSVGElement} */ (el).getScreenCTM(); return { a: c.a, d: c.d, e: c.e, f: c.f }; });
    const mitte = { x: m2.e + 600 * m2.a, y: m2.f + 400 * m2.d };
    await page.mouse.move(mitte.x + 30, mitte.y + 30);
    await page.mouse.move(mitte.x + 4, mitte.y + 3, { steps: 4 });
    await expect(plan.getByTestId("sd-objektfang")).toHaveAttribute("data-art", "endpunkt");
    const ecke = await plan.getByTestId("sd-objektfang").locator("rect").evaluate((el) => {
      const r = /** @type {SVGRectElement} */ (el);
      return { x: r.x.baseVal.value + r.width.baseVal.value / 2, y: r.y.baseVal.value + r.height.baseVal.value / 2 };
    });
    expect(Math.abs(ecke.x - 600) < 1e-3 && Math.abs(ecke.y - 400) < 1e-3, `Fangpunkt ${ecke.x};${ecke.y} = Projektstandort 600;400`).toBe(true);
    await page.keyboard.press("Escape");

    expect(warnungen).toEqual([]);
  } finally {
    await request.delete(`/api/entities/BuildingComplex/${bc}`);
    await request.delete(`/api/entities/Project/${id}`);
  }
});

test("107-07 Review BIM-Studio: Plan-Klick fängt am Wandende und in der Wandmitte, Strg+D + Pfeiltaste + *3 = Reihe im echten Versatz, Öffnungsreihe bleibt auf der Wand", async ({ page, request }) => {
  test.setTimeout(240000);
  const NAME_BIM = "E2E Bauteilkern 10707 BIM";
  const WAND = "0wandE2E10707Wand00001"; // stored GUID (22 characters)
  await page.setViewportSize({ width: 1500, height: 1000 });
  await altWeg(request, NAME_BIM);
  const id = (await (await request.post("/api/entities/Project", { data: { name: NAME_BIM, build_kind: "neubau", status: "concept" } })).json()).id;
  await request.post("/api/entities/BimModel", { data: {
    project_id: id, storeys: 1, storeyHeight: 3,
    customWalls: [{ a: { x: 2.1, z: 1.1 }, b: { x: 7.1, z: 1.1 }, level: 0, thickness: 0.3, height: 3, guid: WAND, _idx: 1 }],
    customWindows: [{ kind: "window", typeId: "double", wallIdx: 1, u: 1, width: 0.8, height: 1.2, sill: 0.9, _idx: 5 }],
  } });
  try {
    await nurLocalhost(page);
    const warnungen = konsole(page);
    await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME_BIM)}&tab=bim`);
    await page.waitForFunction(() => !!(/** @type {any} */ (window).__bitBefehle), null, { timeout: 60000 });
    await expect(page.locator("canvas:visible").first()).toBeVisible({ timeout: 60000 });
    const zeile = (/** @type {string} */ b, /** @type {any} */ p = {}) => page.evaluate(
      ([i, q]) => JSON.parse(/** @type {any} */ (window).__bitBefehle.zeileBearbeiten(JSON.stringify({ id: i, method: "ausfuehren", params: { befehl: i, params: q } }))),
      [b, p],
    );
    const stand = () => page.evaluate(() => /** @type {any} */ (window).__bitZeigen.bimAenderung.modell());
    await page.getByRole("button", { name: "Ansicht Grundriss" }).click();
    const flaeche = page.locator("[data-bim-plan2d] svg").first();
    await expect(flaeche).toBeVisible();
    await flaeche.scrollIntoViewIfNeeded();
    // plan metres → screen through the frame the plan publishes (data-plan-*) and the live screen matrix
    const bildschirm = (/** @type {number} */ x, /** @type {number} */ z) => flaeche.evaluate((el, a) => {
      const s = /** @type {SVGSVGElement} */ (el);
      const k = Number(s.dataset.planSkala), x0 = Number(s.dataset.planX0), z0 = Number(s.dataset.planZ0);
      const q = new window.DOMPoint((a[0] - x0) * k, (a[1] - z0) * k).matrixTransform(/** @type {DOMMatrix} */ (s.getScreenCTM()));
      return { x: q.x, y: q.y };
    }, [x, z]);
    const losFokus = () => page.evaluate(() => /** @type {HTMLElement|null} */ (document.activeElement)?.blur?.()); // studio keys skip fields
    const klickPlan = async (/** @type {number} */ x, /** @type {number} */ z) => { const q = await bildschirm(x, z); await page.mouse.move(q.x, q.y); await page.mouse.click(q.x, q.y); await page.waitForTimeout(80); };

    // (1) snap pre-step: a wall click 0.18 m off the end of wall 1 starts exactly on its end (7.1; 1.1) — the plan's own 0.25-m grid
    // would give (7.25; 1.25); the second click runs on the polar ray from there
    await page.getByRole("button", { name: "Wand", exact: true }).click();
    await klickPlan(7.25, 1.2);
    await klickPlan(7.15, 4.05);
    await page.keyboard.press("Escape");
    await expect.poll(async () => (await stand()).customWalls.length, { timeout: 15000 }).toBe(2);
    const neueWand = (await stand()).customWalls.find((/** @type {any} */ w) => w._idx !== 1);
    expect(neueWand.a).toEqual({ x: 7.1, z: 1.1 });
    expect(neueWand.b).toEqual({ x: 7.1, z: 4 });

    // (2) opening click near the middle of the new 2.9-m wall snaps to its midpoint (7.1; 2.55) → the window sits at u = 1.45 m (the
    // plan's own grid would give (7.25; 2.5) → u = 1.4 m)
    await page.getByRole("button", { name: "Fenster", exact: true }).click();
    await klickPlan(7.2, 2.6);
    await expect.poll(async () => (await stand()).customWindows.length, { timeout: 15000 }).toBe(2);
    const mitteFenster = (await stand()).customWindows.find((/** @type {any} */ o) => o._idx !== 5);
    expect(mitteFenster.wallIdx).toBe(neueWand._idx);
    expect(Math.abs(mitteFenster.u - 1.45), `u ${mitteFenster.u}`).toBeLessThan(1e-6);
    await losFokus();
    await page.keyboard.press("Escape");

    // (3) opening row: the 0.8-m window at u = 1 duplicated (Strg+D, +1 m) and "*5" — the copies stay on the 5-m wall: past its end
    // they are clamped, overlapping ones are left out and counted in the hint (never stacked on one spot)
    await page.evaluate(() => /** @type {any} */ (window).__bitZeigen.bimAenderung.oeffnungWaehlen(5, "custom"));
    await expect(page.getByText("Fenster · Attribute")).toBeVisible(); // the key handler is bound per render: wait for the selection
    await losFokus();
    await page.keyboard.press("Control+d");
    await expect.poll(async () => (await stand()).customWindows.length, { timeout: 15000 }).toBe(3);
    await page.keyboard.type("*5");
    await page.keyboard.press("Enter");
    await expect(page.locator("body")).toContainText("Öffnung(en) ausgelassen");
    const aufWand1 = async () => (await stand()).customWindows.filter((/** @type {any} */ o) => o.wallIdx === 1).map((/** @type {any} */ o) => o.u).sort((/** @type {number} */ a, /** @type {number} */ b) => a - b);
    const us = await aufWand1();
    for (let i = 1; i < us.length; i++) expect(us[i] - us[i - 1], `Öffnungen ${us.join(", ")} überlappen nicht`).toBeGreaterThanOrEqual(0.8 - 1e-6);
    for (const u of us) expect(u >= 0.5 - 1e-6 && u <= 4.5 + 1e-6, `u ${u} liegt in der Wand`).toBe(true);
    await page.keyboard.press("Escape");

    // (4) wall row in the real offset: Strg+D (+1 m), the copy nudged 0.1 m to the right, then "*3" → three copies 1.1 m / 1 m apart
    expect((await zeile("auswahl-guid", { guid: WAND })).ok).toBe(true);
    await expect(page.getByText("Wand · Attribute")).toBeVisible();
    const vorher = (await stand()).customWalls.length;
    await losFokus();
    await page.keyboard.press("Control+d");
    await expect.poll(async () => (await stand()).customWalls.length, { timeout: 15000 }).toBe(vorher + 1);
    await page.keyboard.press("ArrowRight");
    await expect.poll(async () => (await stand()).customWalls.at(-1).a.x, { timeout: 15000 }).toBeCloseTo(3.2, 6);
    await page.keyboard.type("*3");
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await stand()).customWalls.length, { timeout: 15000 }).toBe(vorher + 3);
    const kopien = (await stand()).customWalls.filter((/** @type {any} */ w) => w._idx !== 1 && w._idx !== neueWand._idx && Math.abs(w.b.x - w.a.x - 5) < 1e-6)
      .map((/** @type {any} */ w) => [Math.round(w.a.x * 1000) / 1000, Math.round(w.a.z * 1000) / 1000]).sort((/** @type {number[]} */ p, /** @type {number[]} */ q) => p[0] - q[0]);
    expect(kopien).toEqual([[3.2, 2.1], [4.3, 3.1], [5.4, 4.1]]);
    await page.keyboard.press("Escape");

    // (5) agents: "duplizieren" with {reihe: "*2"} makes the row at once (the state of a fresh single copy is not rendered yet)
    const vorAgent = (await stand()).customWalls.length;
    expect((await zeile("auswahl-guid", { guid: WAND })).ok).toBe(true);
    expect((await zeile("duplizieren", { reihe: "*2" })).ok).toBe(true);
    await expect.poll(async () => (await stand()).customWalls.length, { timeout: 15000 }).toBe(vorAgent + 2);
    const agentKopien = (await stand()).customWalls.slice(-2).map((/** @type {any} */ w) => [Math.round(w.a.x * 1000) / 1000, Math.round(w.a.z * 1000) / 1000]);
    expect(agentKopien).toEqual([[3.1, 2.1], [4.1, 3.1]]);

    expect(warnungen).toEqual([]);
  } finally {
    for (const m of await (await request.get(`/api/entities/BimModel?project_id=${id}`)).json()) await request.delete(`/api/entities/BimModel/${m.id}`);
    await request.delete(`/api/entities/Project/${id}`);
  }
});
