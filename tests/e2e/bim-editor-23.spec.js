// Phase 23 evidence (BIM editor A–F, today BitBimStudio.jsx) in the real browser — the clusters no other spec pins:
//  - D shortcuts: the help popover lists the central SHORTCUTS map, closes again; W / S / D / V switch the tool, Esc returns to the arrow.
//  - B selection: Shift+click toggles a second wall into / out of the selection, the status bar counts "N ausgewählt", the
//    attribute panel follows the selection ("(1 von N)").
//  - E attributes: thickness typed into the panel lands in the stored wall record.
//  - C navigation: F frames the selected wall in the floor plan (it grows and moves to the middle of the plan).
//  - A edit: Strg+D copies the selected wall +1 m in x and z (the arrow-key nudge and the rows are pinned by
//    bauteilkern-107-04 / 107-07 and plan-drehen-11504 and are not repeated here).
//  - F favourites: ★ stores tool + build-up in localStorage nc-bim-favs, at most 6 (oldest goes), a chip re-selects the tool,
//    and the chips survive a reload.
// Own project with two neutral walls inside the default hull (20 × 14 m around the origin, so both are on the plan), deleted in finally; no other record is touched.
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";

const NAME = "E2E Editor 23";
const G1 = "0wandE2E23000Wand00001"; // stored GUIDs (22 characters)
const G2 = "0wandE2E23000Wand00002";

/** @param {any} request @param {string} name */
async function altWeg(request, name) {
  for (const alt of await (await request.get(`/api/entities/Project?name=${encodeURIComponent(name)}`)).json()) {
    for (const m of await (await request.get(`/api/entities/BimModel?project_id=${alt.id}`)).json()) await request.delete(`/api/entities/BimModel/${m.id}`);
    await request.delete(`/api/entities/Project/${alt.id}`);
  }
}

test("23 BIM-Editor: Kürzel-Popover, Werkzeug-Tasten, Shift-Mehrfachauswahl, Attribute, Zoom auf Auswahl (F), Strg+D, Favoriten", async ({ page, request }) => {
  test.setTimeout(240000);
  await page.setViewportSize({ width: 1500, height: 1000 });
  await altWeg(request, NAME);
  const id = (await (await request.post("/api/entities/Project", { data: { name: NAME, build_kind: "neubau", status: "concept" } })).json()).id;
  await request.post("/api/entities/BimModel", { data: {
    project_id: id, storeys: 1, storeyHeight: 3,
    customWalls: [
      { a: { x: 0, z: 0 }, b: { x: 4, z: 0 }, level: 0, thickness: 0.3, height: 3, guid: G1, _idx: 1 },
      { a: { x: -8, z: 4 }, b: { x: -4, z: 4 }, level: 0, thickness: 0.3, height: 3, guid: G2, _idx: 2 },
    ],
  } });
  try {
    await nurLocalhost(page);
    /** @type {string[]} */
    const warnungen = [];
    page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text()) && !/WebGL|GPU stall|maplibre|tile|Failed to load resource|Style is not done loading/i.test(m.text())) warnungen.push(m.text()); });
    page.on("pageerror", (e) => { if (!/WebGL|THREE|getUniforms/i.test(String(e.stack || e))) warnungen.push(`pageerror ${e}`); });

    // six favourites from an earlier session, stored before the studio mounts (then a reload reads them)
    await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME)}&tab=bim`);
    await page.evaluate(() => localStorage.setItem("nc-bim-favs", JSON.stringify(
      [1, 2, 3, 4, 5, 6].map((n) => ({ tool: "column", composite: null, typeId: `t${n}`, label: `Fav ${n}` })))));
    await page.reload();
    await page.waitForFunction(() => !!(/** @type {any} */ (window).__bitBefehle), null, { timeout: 60000 });
    const stand = () => page.evaluate(() => /** @type {any} */ (window).__bitZeigen.bimAenderung.modell());
    const studio = page.getByTestId("bim-studio");
    await expect(studio).toBeVisible({ timeout: 60000 });
    await page.getByRole("button", { name: "Ansicht Grundriss" }).click();
    const flaeche = page.locator("[data-bim-plan2d] svg").first();
    await expect(flaeche).toBeVisible();
    await flaeche.scrollIntoViewIfNeeded();
    const losFokus = () => page.evaluate(() => /** @type {HTMLElement|null} */ (document.activeElement)?.blur?.()); // studio keys skip fields
    /** plan metres → screen through the frame the plan publishes (data-plan-*) and the live screen matrix */
    const bildschirm = (/** @type {number} */ x, /** @type {number} */ z) => flaeche.evaluate((el, a) => {
      const s = /** @type {SVGSVGElement} */ (el);
      const k = Number(s.dataset.planSkala), x0 = Number(s.dataset.planX0), z0 = Number(s.dataset.planZ0);
      const q = new window.DOMPoint((a[0] - x0) * k, (a[1] - z0) * k).matrixTransform(/** @type {DOMMatrix} */ (s.getScreenCTM()));
      return { x: q.x, y: q.y };
    }, [x, z]);
    const klickPlan = async (/** @type {number} */ x, /** @type {number} */ z, /** @type {string[]} */ modifiers = []) => {
      const q = await bildschirm(x, z);
      await page.mouse.move(q.x, q.y);
      for (const m of modifiers) await page.keyboard.down(m);
      await page.mouse.click(q.x, q.y);
      for (const m of modifiers) await page.keyboard.up(m);
      await page.waitForTimeout(120);
    };
    const werkzeug = (/** @type {string} */ t) => page.getByTestId(`bim-werkzeug-${t}`);

    // ---- D: shortcut popover = the SHORTCUTS map (19 rows incl. F3, F-23-01), closes again ----
    await page.getByRole("button", { name: "Tastaturkürzel anzeigen" }).click();
    const popover = studio.locator("div.absolute").filter({ hasText: "Kürzel pausieren" });
    await expect(popover).toBeVisible();
    const tasten = await popover.locator("kbd").allTextContents();
    expect(tasten).toHaveLength(19);
    for (const k of ["V", "W", "S", "D", "F", "F3", "Strg+D", "Pfeiltasten", "Shift+Pfeil", "Shift+Klick", "Esc"]) expect(tasten, `Kürzel ${k}`).toContain(k);
    await popover.getByRole("button", { name: "Schließen" }).click();
    await expect(popover).toHaveCount(0);

    // ---- D: tool keys (the same table in the popover) ----
    await losFokus();
    for (const [taste, tool] of [["w", "wall"], ["s", "column"], ["d", "slab"], ["v", "arrow"], ["w", "wall"]]) {
      await page.keyboard.press(taste);
      await expect(werkzeug(tool), `Taste ${taste}`).toHaveAttribute("aria-pressed", "true");
    }
    await page.keyboard.press("Escape");
    await expect(werkzeug("arrow")).toHaveAttribute("aria-pressed", "true");

    // ---- B: Shift+click toggles; the badge counts; the attribute panel follows ("1 von N") ----
    const zaehler = studio.getByText(/^\d+ ausgewählt$/);
    await klickPlan(2, 0);
    await expect(page.getByText(/^Wand · Attribute$/)).toBeVisible({ timeout: 15000 });
    await klickPlan(-6, 4, ["Shift"]);
    await expect(zaehler).toHaveText("2 ausgewählt");
    await expect(page.getByText("Wand · Attribute (1 von 2)")).toBeVisible();
    await klickPlan(-6, 4, ["Shift"]);
    await expect(zaehler).toHaveText("1 ausgewählt");
    await expect(page.getByText(/^Wand · Attribute$/)).toBeVisible();

    // ---- E: thickness typed into the panel lands in the record of the selected wall ----
    const dicke = page.getByTestId("wand-dicke-feld");
    await dicke.fill("0.36");
    await dicke.press("Enter");
    await expect.poll(async () => (await stand()).customWalls.find((/** @type {any} */ w) => w._idx === 1)?.thickness, { timeout: 15000 }).toBe(0.36);
    expect((await stand()).customWalls.find((/** @type {any} */ w) => w._idx === 2)?.thickness).toBe(0.3);

    // ---- C: F frames the selected wall: it grows on screen and moves to the middle of the plan ----
    await page.keyboard.press("Escape");
    await klickPlan(-6, 4);
    await expect(zaehler).toHaveText("1 ausgewählt");
    const wandBox = () => flaeche.locator('[data-wand="2"]').first().evaluate((e) => { const r = e.getBoundingClientRect(); return { w: r.width, x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    const planMitte = async () => { const r = await flaeche.boundingBox(); if (!r) throw new Error("kein Plan"); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width }; };
    const vorher = await wandBox();
    await losFokus();
    await page.keyboard.press("f");
    await expect.poll(async () => (await wandBox()).w, { timeout: 10000, message: "F zoomt auf die Wand" }).toBeGreaterThan(vorher.w * 1.5);
    await page.waitForTimeout(400); // the eased zoom settles
    const nachher = await wandBox(), mitte = await planMitte();
    expect(Math.abs(nachher.x - mitte.x), `Wandmitte ${JSON.stringify(nachher)} vs. Planmitte ${JSON.stringify(mitte)}`).toBeLessThan(mitte.w * 0.1);

    // ---- A: Strg+D copies the selected wall +1 m in x and z ----
    await losFokus();
    await page.keyboard.press("Control+d");
    await expect.poll(async () => (await stand()).customWalls.length, { timeout: 15000 }).toBe(3);
    const kopie = (await stand()).customWalls.at(-1);
    expect({ a: kopie.a, b: kopie.b, thickness: kopie.thickness }).toEqual({ a: { x: -7, z: 5 }, b: { x: -3, z: 5 }, thickness: 0.3 });
    expect(kopie.guid, "die Kopie ist ein neues Bauteil").not.toBe(G2);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");

    // ---- F: favourites — the six stored chips, ★ adds the wall tool (oldest goes), a chip re-selects, a reload keeps them ----
    const chips = () => studio.locator('button[title^="Favorit anwenden: "]');
    await expect(chips()).toHaveText(["Fav 1", "Fav 2", "Fav 3", "Fav 4", "Fav 5", "Fav 6"]);
    await losFokus();
    await page.keyboard.press("w");
    await expect(werkzeug("wall")).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Favorit speichern", exact: true }).click();
    await expect(chips()).toHaveCount(6);
    await expect(chips().first()).toHaveText("Fav 2");
    await expect(chips().last()).toHaveText(/^Wand( · .+)?$/);
    const gespeichert = await page.evaluate(() => JSON.parse(localStorage.getItem("nc-bim-favs") || "[]"));
    expect(gespeichert).toHaveLength(6);
    expect(gespeichert.at(-1)).toMatchObject({ tool: "wall", typeId: null });
    // R-23-01: the same favourite twice is not stored twice — it moves to the END. Put the column behind it first, so the
    // move is visible: [Fav 3..6, Wand, Stütze] → ★ on the wall again → [Fav 3..6, Stütze, Wand], still 6 in total.
    await losFokus();
    await page.keyboard.press("s");
    await expect(werkzeug("column")).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Favorit speichern", exact: true }).click();
    await expect(chips()).toHaveText(["Fav 3", "Fav 4", "Fav 5", "Fav 6", /^Wand( · .+)?$/, "Stütze"]);
    await losFokus();
    await page.keyboard.press("w");
    await expect(werkzeug("wall")).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Favorit speichern", exact: true }).click();
    await expect(chips()).toHaveText(["Fav 3", "Fav 4", "Fav 5", "Fav 6", "Stütze", /^Wand( · .+)?$/]);
    const nachDoppel = await page.evaluate(() => JSON.parse(localStorage.getItem("nc-bim-favs") || "[]"));
    expect(nachDoppel).toHaveLength(6);
    expect(nachDoppel.map((/** @type {any} */ f) => f.tool).slice(4)).toEqual(["column", "wall"]);
    expect(nachDoppel.filter((/** @type {any} */ f) => f.tool === "wall")).toHaveLength(1);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect(werkzeug("arrow")).toHaveAttribute("aria-pressed", "true");
    await chips().last().click();
    await expect(werkzeug("wall")).toHaveAttribute("aria-pressed", "true");
    await page.reload();
    await expect(page.getByTestId("bim-studio")).toBeVisible({ timeout: 60000 });
    await expect(chips()).toHaveCount(6);
    await expect(chips().last()).toHaveText(/^Wand/);

    expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
  } finally {
    for (const m of await (await request.get(`/api/entities/BimModel?project_id=${id}`)).json()) await request.delete(`/api/entities/BimModel/${m.id}`);
    await request.delete(`/api/entities/Project/${id}`);
  }
});
