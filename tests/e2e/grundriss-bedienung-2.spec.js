// Grundriss-Bedienung Teil 2 im echten Browser (BIM-Studio, Grundriss): (1) Auswahl ziehen — Wand + Stütze am Wandende greifen,
// Raster/Objektfang (Fangzeichen „Endpunkt“ an einer fremden Stütze), Umschalt waagerecht, Esc stellt her, ein Zug = ein Rückgängig,
// eine einzeln gewählte Tür gleitet nur entlang ihrer Wand, unter 4 px bleibt es ein Klick; (2) Alt-Kopie — Hinweis „+ Kopie“ am
// Zeiger, Kopien mit neuen IDs (Tür auf der Wandkopie), Kopien ausgewählt, ein Rückgängig; Alt vor dem Loslassen gelöst = verschoben;
// (3) Maß tippen in der Wandkette — „3,5“ + Enter, zu kurz = Fehlerzustand, Rücktaste, Esc leert erst das Feld.
// Neutrale Prüfgeometrie, eigenes Projekt, Aufräumen im finally (Muster grundriss-bedienung-1.spec.js).
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";

const NAME = "E2E Grundriss-Bedienung 2";
const WAND = "0wandE2EGrundriss00002"; // stored GUID (22 characters)

/** @param {any} request @param {string} name */
async function altWeg(request, name) {
  for (const alt of await (await request.get(`/api/entities/Project?name=${encodeURIComponent(name)}`)).json()) {
    for (const m of await (await request.get(`/api/entities/BimModel?project_id=${alt.id}`)).json()) await request.delete(`/api/entities/BimModel/${m.id}`);
    await request.delete(`/api/entities/Project/${alt.id}`);
  }
}

test("Grundriss-Bedienung 2: Auswahl ziehen mit Fang, Umschalt, Esc und Rückgängig; Alt-Kopie; Maß tippen in der Wandkette", async ({ page, request }) => {
  test.setTimeout(300000);
  await page.setViewportSize({ width: 1500, height: 1000 });
  await altWeg(request, NAME);
  const id = (await (await request.post("/api/entities/Project", { data: { name: NAME, build_kind: "neubau", status: "concept" } })).json()).id;
  await request.post("/api/entities/BimModel", { data: {
    project_id: id, storeys: 1, storeyHeight: 3,
    customWalls: [
      { a: { x: 2, z: 1 }, b: { x: 8, z: 1 }, level: 0, thickness: 0.3, height: 3, guid: WAND, _idx: 1 },
      { a: { x: 2, z: 5 }, b: { x: 8, z: 5 }, level: 0, thickness: 0.3, height: 3, _idx: 2 },
    ],
    // door 2.00 m wide (wide enough to press it beside its grip at the plan's ~20 px/m), middle at u = 3 m → point (5, 1)
    customWindows: [{ kind: "door", typeId: "single", wallIdx: 1, u: 3, width: 2, _idx: 5 }],
    // column 7 is dragged with the wall, column 8 is a snap target (left of the walls: the attribute panel covers the plan's right)
    customColumns: [{ x: 10, z: 3, level: 0, size: 0.4, _idx: 7 }, { x: -4, z: 4, level: 0, size: 0.4, _idx: 8 }],
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
    const stuetze = async (/** @type {number} */ idx) => (await stand()).customColumns.find((/** @type {any} */ c) => c._idx === idx);
    const tuer = async () => (await stand()).customWindows.find((/** @type {any} */ o) => o._idx === 5);
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
    const rueckgaengig = async () => { await losFokus(); await page.keyboard.press("Control+z"); await page.waitForTimeout(150); };
    const klick = async (/** @type {number} */ x, /** @type {number} */ z, /** @type {any} */ opt = {}) => { const q = await bildschirm(x, z); await page.mouse.click(q.x, q.y, opt); await page.waitForTimeout(100); };
    /** Wall 1 + column 7 as multiple selection (GUID command, then Shift+click on the column). */
    const waehleWandUndStuetze = async () => {
      expect((await zeile("auswahl-guid", { guid: WAND })).ok).toBe(true);
      await expect(page.getByText("Wand · Attribute")).toBeVisible();
      await losFokus();
      const c = await stuetze(7);
      await page.keyboard.down("Shift"); await klick(c.x, c.z); await page.keyboard.up("Shift");
      await expect(page.locator("body")).toContainText("2 ausgewählt");
    };
    /** Drag from plan point `von` to `nach` in small steps (button held); `waehrend` runs before the release. */
    const ziehe = async (/** @type {number[]} */ von, /** @type {number[]} */ nach, /** @type {(() => Promise<void>)|null} */ waehrend = null) => {
      const p = await bildschirm(von[0], von[1]), q = await bildschirm(nach[0], nach[1]);
      await page.mouse.move(p.x, p.y);
      await page.mouse.down();
      await page.mouse.move(q.x, q.y, { steps: 10 });
      if (waehrend) await waehrend();
      await page.mouse.up();
      await page.waitForTimeout(150);
    };

    // ---- (1) drag the selection ----
    // (1a) grabbed near the wall end a (2, 1): the end is the carried point, the grid takes it to (4, 2) → offset (2, 1) for wall
    // and column; the door stays on its wall (same wallIdx, same u)
    await waehleWandUndStuetze();
    await ziehe([2.08, 1.03], [4.06, 2.04]);
    await expect.poll(async () => (await wand(1)).a, { timeout: 15000 }).toEqual({ x: 4, z: 2 });
    expect((await wand(1)).b).toEqual({ x: 10, z: 2 });
    expect(await stuetze(7)).toMatchObject({ x: 12, z: 4 });
    expect(await tuer()).toMatchObject({ wallIdx: 1, u: 3 });
    expect((await wand(2)).a).toEqual({ x: 2, z: 5 }); // not selected: stays
    // one drag = one undo step
    await rueckgaengig();
    await expect.poll(async () => (await wand(1)).a, { timeout: 15000 }).toEqual({ x: 2, z: 1 });
    expect(await stuetze(7)).toMatchObject({ x: 10, z: 3 });

    // (1b) object snap: the grabbed end a (2, 1) catches the middle of column 8 (−4, 4) — marker "Endpunkt" while held (the pointer
    // ends 0.15 m off, the grid alone would give (−4, 4.25)); the dragged elements themselves are no targets
    await ziehe([2.05, 1.04], [-3.93, 4.19], async () => {
      await expect(page.getByTestId("bim-fang-marke")).toHaveAttribute("data-art", "endpunkt");
    });
    await expect.poll(async () => (await wand(1)).a, { timeout: 15000 }).toEqual({ x: -4, z: 4 });
    expect((await wand(1)).b).toEqual({ x: 2, z: 4 });
    expect(await stuetze(7)).toMatchObject({ x: 4, z: 6 });
    await expect(page.getByTestId("bim-fang-marke")).toHaveCount(0);
    await rueckgaengig();
    await expect.poll(async () => (await wand(1)).a, { timeout: 15000 }).toEqual({ x: 2, z: 1 });

    // (1c) Shift: the offset is locked to the horizontal although the pointer drifts 0.6 m down
    await page.keyboard.down("Shift");
    await ziehe([2.08, 1.03], [5.1, 1.63]);
    await page.keyboard.up("Shift");
    const w1c = await wand(1);
    expect(w1c.a.z, JSON.stringify(w1c)).toBeCloseTo(1, 6);
    expect(w1c.b.z).toBeCloseTo(1, 6);
    expect(w1c.a.x).toBeGreaterThan(4);

    // (1d) Esc during the drag: back to the state at the press, and the cancelled drag is no undo step — the next Strg+Z undoes (1c)
    await ziehe([w1c.a.x + 0.05, 1.03], [w1c.a.x + 1.5, 4], async () => {
      await expect.poll(async () => (await wand(1)).a.z).not.toBe(1);
      await page.keyboard.press("Escape");
      await expect.poll(async () => (await wand(1)).a).toEqual(w1c.a);
    });
    expect((await wand(1)).a).toEqual(w1c.a);
    await rueckgaengig();
    await expect.poll(async () => (await wand(1)).a, { timeout: 15000 }).toEqual({ x: 2, z: 1 });
    expect(await stuetze(7)).toMatchObject({ x: 10, z: 3 });

    // ---- (2) Alt copy ----
    // (2a) Alt held at the release: originals stay, copies at the target (offset (0, 2)), the door comes along on the copied wall
    await waehleWandUndStuetze();
    await page.keyboard.down("Alt");
    await ziehe([2.08, 1.03], [2.04, 3.04], async () => { await expect(page.getByTestId("bim-zug-kopie")).toBeVisible(); });
    await page.keyboard.up("Alt");
    await expect.poll(async () => (await stand()).customWalls.length, { timeout: 15000 }).toBe(3);
    const s2 = await stand();
    expect(s2.customWalls.find((/** @type {any} */ w) => w._idx === 1)).toMatchObject({ a: { x: 2, z: 1 }, b: { x: 8, z: 1 } });
    const wk = s2.customWalls.find((/** @type {any} */ w) => w._idx !== 1 && w._idx !== 2);
    expect(wk.a.x).toBeCloseTo(2, 6); expect(wk.a.z).toBeCloseTo(3, 6); expect(wk.b.x).toBeCloseTo(8, 6); expect(wk.b.z).toBeCloseTo(3, 6);
    expect(wk.guid).not.toBe(WAND);
    const tk = s2.customWindows.find((/** @type {any} */ o) => o._idx !== 5);
    expect(tk).toMatchObject({ wallIdx: wk._idx, u: 3, kind: "door" });
    expect(s2.customColumns).toHaveLength(3);
    expect(s2.customColumns.find((/** @type {any} */ c) => c._idx === 7)).toMatchObject({ x: 10, z: 3 });
    await expect(page.locator("body")).toContainText("2 Objekt(e) dupliziert");
    await expect(page.getByTestId("bim-zug-kopie")).toHaveCount(0);
    // the copies are selected: Entf removes exactly them (and the door copy with its wall)
    await losFokus();
    await page.keyboard.press("Delete");
    await expect.poll(async () => (await stand()).customWalls.length, { timeout: 15000 }).toBe(2);
    expect((await stand()).customWindows.map((/** @type {any} */ o) => o._idx)).toEqual([5]);
    expect((await stand()).customColumns.map((/** @type {any} */ c) => c._idx).sort()).toEqual([7, 8]);
    await rueckgaengig(); // the delete
    await expect.poll(async () => (await stand()).customWalls.length, { timeout: 15000 }).toBe(3);
    await rueckgaengig(); // the copy: one step
    await expect.poll(async () => (await stand()).customWalls.length, { timeout: 15000 }).toBe(2);
    expect((await stand()).customColumns).toHaveLength(2);
    expect((await stand()).customWindows).toHaveLength(1);

    // (2b) Alt released before the release: the hint goes and the drag only moves
    await waehleWandUndStuetze();
    await page.keyboard.down("Alt");
    await ziehe([2.08, 1.03], [2.04, 3.04], async () => {
      await expect(page.getByTestId("bim-zug-kopie")).toBeVisible();
      await page.keyboard.up("Alt");
      await expect(page.getByTestId("bim-zug-kopie")).toHaveCount(0);
    });
    await expect.poll(async () => (await wand(1)).a, { timeout: 15000 }).toEqual({ x: 2, z: 3 });
    expect((await stand()).customWalls).toHaveLength(2);
    await rueckgaengig();
    await expect.poll(async () => (await wand(1)).a, { timeout: 15000 }).toEqual({ x: 2, z: 1 });

    // (1e) a door selected alone slides only along its wall: grabbed 0.75 m beside its middle (outside its grip), dragged by about
    // (1.5, 2) → u ≈ 4.5, the wall does not move
    await klick(5, 1);
    await expect(page.getByText("Wand · Attribute")).toHaveCount(0);
    const m = await bildschirm(5, 1), daneben = await bildschirm(5.75, 1);
    expect(Math.hypot(daneben.x - m.x, daneben.y - m.y), "Druckpunkt außerhalb des 9-px-Griffs").toBeGreaterThan(12);
    await ziehe([5.75, 1.01], [7.25, 3.01]);
    await expect.poll(async () => (await tuer()).u, { timeout: 15000 }).not.toBe(3);
    expect((await tuer()).u).toBeGreaterThan(4.3);
    expect((await tuer()).u).toBeLessThan(4.7);
    expect(await tuer()).toMatchObject({ wallIdx: 1 });
    expect(await wand(1)).toMatchObject({ a: { x: 2, z: 1 }, b: { x: 8, z: 1 } });
    await rueckgaengig();
    await expect.poll(async () => (await tuer()).u, { timeout: 15000 }).toBe(3);

    // (1f) under the 4-px threshold it stays a click: nothing moves, the click picks the wall alone
    await waehleWandUndStuetze();
    const k = await bildschirm(3.5, 1);
    await page.mouse.move(k.x, k.y); await page.mouse.down(); await page.mouse.move(k.x + 2, k.y + 1); await page.mouse.up();
    await page.waitForTimeout(150);
    expect(await wand(1)).toMatchObject({ a: { x: 2, z: 1 }, b: { x: 8, z: 1 } });
    expect(await stuetze(7)).toMatchObject({ x: 10, z: 3 });
    await expect(page.getByText("Wand · Attribute")).toBeVisible();
    await losFokus();
    await page.keyboard.press("Escape");

    // ---- (3) typed length in the wall chain ----
    await page.getByRole("button", { name: "Wand", exact: true }).click();
    await losFokus();
    await klick(3, 3);
    const zeiger = async (/** @type {number} */ x, /** @type {number} */ z) => { const q = await bildschirm(x, z); await page.mouse.move(q.x, q.y, { steps: 3 }); await page.waitForTimeout(80); };
    await zeiger(6, 3.02); // direction +x
    await page.keyboard.type("3,5");
    await expect(page.getByTestId("bim-mass-text")).toHaveText("3,5 m");
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await stand()).customWalls.length, { timeout: 15000 }).toBe(3);
    const neu1 = (await stand()).customWalls.find((/** @type {any} */ w) => w._idx !== 1 && w._idx !== 2);
    expect(neu1).toMatchObject({ a: { x: 3, z: 3 }, b: { x: 6.5, z: 3 } });
    await expect(page.getByTestId("bim-mass-feld")).toHaveCount(0);
    // too short: nothing is set, the field stays in its error state; Backspace removes characters
    await zeiger(6.52, 4.4); // direction +z from (6.5, 3)
    await page.keyboard.type("0,03");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("bim-mass-feld")).toHaveAttribute("data-fehler", "1");
    expect((await stand()).customWalls).toHaveLength(3);
    for (let i = 0; i < 4; i++) await page.keyboard.press("Backspace");
    await expect(page.getByTestId("bim-mass-feld")).toHaveCount(0);
    await page.keyboard.type("1.5");
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await stand()).customWalls.length, { timeout: 15000 }).toBe(4);
    const neu2 = (await stand()).customWalls.at(-1);
    expect(neu2.a).toEqual({ x: 6.5, z: 3 });
    expect(neu2.b.x).toBeCloseTo(6.5, 2);
    expect(neu2.b.z).toBeCloseTo(4.5, 2);
    // Esc first only empties the field (the chain stays open), the next Esc ends the chain
    await page.keyboard.type("2");
    await expect(page.getByTestId("bim-mass-feld")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("bim-mass-feld")).toHaveCount(0);
    await page.keyboard.type("1");
    await expect(page.getByTestId("bim-mass-feld")).toBeVisible(); // still in the chain: digits still fill the field
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await page.keyboard.type("1");
    await expect(page.getByTestId("bim-mass-feld")).toHaveCount(0); // chain ended: digits do nothing
    expect((await stand()).customWalls).toHaveLength(4);

    expect(warnungen).toEqual([]);
  } finally {
    for (const m of await (await request.get(`/api/entities/BimModel?project_id=${id}`)).json()) await request.delete(`/api/entities/BimModel/${m.id}`);
    await request.delete(`/api/entities/Project/${id}`);
  }
});
