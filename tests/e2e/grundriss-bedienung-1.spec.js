// Grundriss-Bedienung Teil 1 im echten Browser (BIM-Studio, Grundriss): (1) Entf an einer Wand nimmt ihre Tür mit, ein Strg+Z holt
// beide zurück; (2) Wandende a ziehen hält die Tür an ihrer Stelle im Raum (u neu ab dem neuen Anfang); (3) Wandende b fängt die
// Stützenmitte (Fangzeichen „Endpunkt“ sichtbar während des Ziehens), Umschalt hält 45° zum anderen Ende; (4) ⌘A/Strg+A wählt das
// Geschoss; (5) Tür setzen schlägt zur geklickten Wandseite auf. Neutrale Prüfgeometrie, eigenes Projekt, Aufräumen im finally.
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";

const NAME = "E2E Grundriss-Bedienung 1";
const WAND = "0wandE2EGrundriss00001"; // stored GUID (22 characters)

/** @param {any} request @param {string} name */
async function altWeg(request, name) {
  for (const alt of await (await request.get(`/api/entities/Project?name=${encodeURIComponent(name)}`)).json()) {
    for (const m of await (await request.get(`/api/entities/BimModel?project_id=${alt.id}`)).json()) await request.delete(`/api/entities/BimModel/${m.id}`);
    await request.delete(`/api/entities/Project/${alt.id}`);
  }
}

test("Grundriss-Bedienung 1: Löschen mit Öffnungen, Wandende ziehen, Griff-Fang, Umschalt 45°, ⌘A, Türaufschlag zur Klickseite", async ({ page, request }) => {
  test.setTimeout(240000);
  await page.setViewportSize({ width: 1500, height: 1000 });
  await altWeg(request, NAME);
  const id = (await (await request.post("/api/entities/Project", { data: { name: NAME, build_kind: "neubau", status: "concept" } })).json()).id;
  await request.post("/api/entities/BimModel", { data: {
    project_id: id, storeys: 1, storeyHeight: 3,
    customWalls: [
      { a: { x: 2, z: 1 }, b: { x: 8, z: 1 }, level: 0, thickness: 0.3, height: 3, guid: WAND, _idx: 1 },
      { a: { x: 2, z: 5 }, b: { x: 8, z: 5 }, level: 0, thickness: 0.3, height: 3, _idx: 2 },
    ],
    // door 1.00 m wide, middle at u = 3 m → point (5, 1)
    customWindows: [{ kind: "door", typeId: "single", wallIdx: 1, u: 3, width: 1, _idx: 5 }],
    customColumns: [{ x: 10, z: 3, level: 0, size: 0.4, _idx: 7 }],
  } });
  try {
    await nurLocalhost(page);
    /** @type {string[]} */
    const warnungen = [];
    page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text()) && !/WebGL|GPU stall|maplibre|tile|Failed to load resource|Style is not done loading/i.test(m.text())) warnungen.push(m.text()); });
    page.on("pageerror", (e) => { if (!/WebGL|THREE|getUniforms/i.test(String(e.stack || e))) warnungen.push(`pageerror ${e}`); });
    await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME)}&tab=bim`);
    await page.waitForFunction(() => !!(/** @type {any} */ (window).__bitBefehle), null, { timeout: 60000 });
    await expect(page.locator("canvas:visible").first()).toBeVisible({ timeout: 60000 });
    const zeile = (/** @type {string} */ b, /** @type {any} */ p = {}) => page.evaluate(
      ([i, q]) => JSON.parse(/** @type {any} */ (window).__bitBefehle.zeileBearbeiten(JSON.stringify({ id: i, method: "ausfuehren", params: { befehl: i, params: q } }))),
      [b, p],
    );
    const stand = () => page.evaluate(() => /** @type {any} */ (window).__bitZeigen.bimAenderung.modell());
    const wand = async (/** @type {number} */ idx) => (await stand()).customWalls.find((/** @type {any} */ w) => w._idx === idx);
    await page.getByRole("button", { name: "Ansicht Grundriss" }).click();
    const flaeche = page.locator("[data-bim-plan2d] svg").first();
    await expect(flaeche).toBeVisible();
    await flaeche.scrollIntoViewIfNeeded();
    const bildschirm = (/** @type {number} */ x, /** @type {number} */ z) => flaeche.evaluate((el, a) => {
      const s = /** @type {SVGSVGElement} */ (el);
      const k = Number(s.dataset.planSkala), x0 = Number(s.dataset.planX0), z0 = Number(s.dataset.planZ0);
      const q = new window.DOMPoint((a[0] - x0) * k, (a[1] - z0) * k).matrixTransform(/** @type {DOMMatrix} */ (s.getScreenCTM()));
      return { x: q.x, y: q.y };
    }, [x, z]);
    const losFokus = () => page.evaluate(() => /** @type {HTMLElement|null} */ (document.activeElement)?.blur?.());
    const waehleWand = async () => {
      expect((await zeile("auswahl-guid", { guid: WAND })).ok).toBe(true);
      await expect(page.getByText("Wand · Attribute")).toBeVisible();
      await losFokus();
    };
    /** Grip drag from plan point `von` to `nach` in small steps (pointer held), `waehrend` runs before the release. */
    const ziehe = async (/** @type {number[]} */ von, /** @type {number[]} */ nach, /** @type {(() => Promise<void>)|null} */ waehrend = null) => {
      const p = await bildschirm(von[0], von[1]), q = await bildschirm(nach[0], nach[1]);
      await page.mouse.move(p.x, p.y);
      await page.mouse.down();
      await page.mouse.move(q.x, q.y, { steps: 8 });
      if (waehrend) await waehrend();
      await page.mouse.up();
      await page.waitForTimeout(100);
    };

    // (2) end a from (2, 1) to (4, 1): the door middle stays at x = 5 → u = 1 (from the new start)
    await waehleWand();
    await ziehe([2, 1], [4.04, 1.03]);
    await expect.poll(async () => (await wand(1)).a, { timeout: 15000 }).toEqual({ x: 4, z: 1 });
    expect((await stand()).customWindows.find((/** @type {any} */ o) => o._idx === 5).u).toBeCloseTo(1, 6);

    // (3a) end b near the column middle (10, 3): object snap "Endpunkt" — marker with its name while the grip is held
    await waehleWand();
    await ziehe([8, 1], [10.06, 3.05], async () => {
      await expect(page.getByTestId("bim-fang-marke")).toHaveAttribute("data-art", "endpunkt");
      await expect(page.getByTestId("bim-fang-name")).toHaveText("Endpunkt");
    });
    await expect.poll(async () => (await wand(1)).b, { timeout: 15000 }).toEqual({ x: 10, z: 3 });
    await expect(page.getByTestId("bim-fang-marke")).toHaveCount(0); // gone after the release
    expect((await stand()).customWindows.find((/** @type {any} */ o) => o._idx === 5).u).toBeCloseTo(1, 6); // end b: u stays

    // (3b) Shift held: end b keeps 45° to the other end (4, 1) although the pointer is off the diagonal
    await waehleWand();
    await page.keyboard.down("Shift");
    await ziehe([10, 3], [6.6, 3.9]);
    await page.keyboard.up("Shift");
    const w45 = await wand(1);
    expect(Math.abs(Math.abs(w45.b.x - w45.a.x) - Math.abs(w45.b.z - w45.a.z)), `b ${JSON.stringify(w45.b)}`).toBeLessThan(2e-3);
    expect(w45.b.x).toBeGreaterThan(w45.a.x);

    // (5) door on wall 2 (a → b along +x, +normal = +z): click on the +z side → default swing, click on the −z side → "aussen"
    await page.getByRole("button", { name: "Tür", exact: true }).click();
    // The door tool opens its library beside the plan; the plan gets narrower and re-fits a moment later. A screen position
    // read before that lands somewhere else at the click (seen: (3.5, 5.4) became (2.77, 4.30)) — wait until the plan rests.
    await expect(page.getByText("Tür-Bibliothek")).toBeVisible();
    let planVorher = "";
    await expect.poll(async () => { const q = JSON.stringify(await bildschirm(0, 0)); const ruht = q === planVorher; planVorher = q; return ruht; }, { intervals: [150], timeout: 10000 }).toBe(true);
    const klick = async (/** @type {number} */ x, /** @type {number} */ z) => { const q = await bildschirm(x, z); await page.mouse.move(q.x, q.y); await page.mouse.click(q.x, q.y); await page.waitForTimeout(80); };
    await klick(3.5, 5.4);
    await klick(6.5, 4.6);
    await expect.poll(async () => (await stand()).customWindows.filter((/** @type {any} */ o) => o.wallIdx === 2).length, { timeout: 15000 }).toBe(2);
    const tueren = (await stand()).customWindows.filter((/** @type {any} */ o) => o.wallIdx === 2).sort((/** @type {any} */ p, /** @type {any} */ q) => p.u - q.u);
    expect(tueren[0].aufschlag).toBeUndefined();
    expect(tueren[1].aufschlag).toBe("aussen");
    const seiten = await page.locator(`[data-oeffnung="${tueren[0]._idx}"] [data-tuer-seite], [data-oeffnung="${tueren[1]._idx}"] [data-tuer-seite]`).evaluateAll((els) => els.map((e) => e.getAttribute("data-tuer-seite")));
    expect(seiten).toEqual(["1", "-1"]);
    await losFokus();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");

    // (4) Strg+A: all drawn elements of the storey (2 walls, 1 column, 3 doors) → hint with the count
    await losFokus();
    await page.keyboard.press("Control+a");
    await expect(page.locator("body")).toContainText("6 Objekt(e) ausgewählt");
    await page.keyboard.press("Escape");

    // (1) Entf on wall 1 takes its door; one Strg+Z brings both back
    await waehleWand();
    await page.keyboard.press("Delete");
    await expect.poll(async () => (await stand()).customWalls.length, { timeout: 15000 }).toBe(1);
    expect((await stand()).customWindows.some((/** @type {any} */ o) => o._idx === 5)).toBe(false);
    await losFokus();
    await page.keyboard.press("Control+z");
    await expect.poll(async () => (await stand()).customWalls.length, { timeout: 15000 }).toBe(2);
    expect((await stand()).customWindows.some((/** @type {any} */ o) => o._idx === 5)).toBe(true);

    expect(warnungen).toEqual([]);
  } finally {
    for (const m of await (await request.get(`/api/entities/BimModel?project_id=${id}`)).json()) await request.delete(`/api/entities/BimModel/${m.id}`);
    await request.delete(`/api/entities/Project/${id}`);
  }
});
