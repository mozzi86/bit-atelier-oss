// 115-04 (D-115-13) in a real browser (BIM studio, floor plan turned in 90° steps, own sheet orientation of the PDF / DXF output).
// Checked against known truth, not against the implementation's own matrices:
//  (1) the buttons "Plan drehen 90° links / rechts" exist only in the floor plan view (not in 3D, not in the section) and carry an
//      aria-label;
//  (2) after one "links" click a known model point lies where a quarter turn to the left puts it — model +x points UP on the screen,
//      model +z points RIGHT, north (−z) points LEFT — measured through the rotation group's getScreenCTM and cross-checked against
//      the rendered wall (bounding box) and the north arrow; a click on a wall at its turned screen position selects exactly that
//      wall (GUID); dragging a wall end grip by a screen vector moves the model point by the back-turned vector (2 cm); the arrow
//      keys move the selection the way the pressed arrow points on the screen (review finding N-01);
//  (3) room and storey labels stay upright on the screen (effective rotation 0° ± 1°), every plan text stays readable;
//  (4) the rotation survives a reload (ansicht_layer.plan_drehung = 90 in the stored record);
//  (5) the section is not turned (no rotation group, no rotated geometry, same markup as with the plan at 0°);
//  (6) sheet orientation "wie am Bildschirm" → the DXF names the rotation in a comment line, has the layer A_NORDPFEIL and turned
//      coordinates; "0°" → neither, model coordinates, the screen stays turned;
//  (7) no console errors (same filter as grundriss-bedienung-1).
// Neutral test geometry, own project created through the API, cleaned up in finally (pattern grundriss-bedienung-1.spec.js).
// E2E_BILDER=<folder> (optional) writes two pictures of the drawing area (0° and 90° left) for a look by eye; without it none.
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";
import fs from "node:fs";
import path from "node:path";

const NAME = "E2E Plan drehen 11504";
const WAND1 = "0wandE2EPlanDrehen0001"; // stored GUIDs (22 characters)
const WAND2 = "0wandE2EPlanDrehen0002";
const BILDER = process.env.E2E_BILDER || null; // folder for the two pictures of the drawing area, null = none

/** @param {any} request @param {string} name */
async function altWeg(request, name) {
  for (const alt of await (await request.get(`/api/entities/Project?name=${encodeURIComponent(name)}`)).json()) {
    for (const m of await (await request.get(`/api/entities/BimModel?project_id=${alt.id}`)).json()) await request.delete(`/api/entities/BimModel/${m.id}`);
    await request.delete(`/api/entities/Project/${alt.id}`);
  }
}

/**
 * Points of the given DXF layers (group codes 10–13 / 20–23 of every entity on them), metres.
 * @param {string} text DXF R12 text (CRLF)
 * @param {string[]} ebenen layer names
 * @returns {Array<{x: number, y: number}>}
 */
function dxfPunkte(text, ebenen) {
  const z = text.split("\r\n");
  /** @type {Array<{x: number, y: number}>} */
  const pts = [];
  let ebene = "", /** @type {Record<number, number>} */ xs = {};
  for (let i = 0; i + 1 < z.length; i += 2) {
    const code = Number(z[i].trim()), wert = z[i + 1];
    if (code === 0) { ebene = ""; xs = {}; continue; }
    if (code === 8) ebene = wert.trim();
    if (!ebenen.includes(ebene)) continue;
    if (code >= 10 && code <= 13) xs[code] = Number(wert);
    if (code >= 20 && code <= 23 && xs[code - 10] !== undefined) pts.push({ x: xs[code - 10], y: Number(wert) });
  }
  return pts;
}

test("115-04 Plan drehen: Knöpfe nur im Grundriss, Zeiger/Griffe im gedrehten Plan, Texte aufrecht, gemerkt, Schnitt ungedreht, Blattausrichtung im DXF", async ({ page, request }) => {
  test.setTimeout(300000);
  await page.setViewportSize({ width: 1500, height: 1300 });
  await altWeg(request, NAME);
  const id = (await (await request.post("/api/entities/Project", { data: { name: NAME, build_kind: "neubau", status: "concept" } })).json()).id;
  await request.post("/api/entities/BimModel", { data: {
    project_id: id, storeys: 2, storeyHeight: 3,
    customWalls: [
      { a: { x: 2, z: 1 }, b: { x: 8, z: 1 }, level: 0, thickness: 0.3, height: 3, guid: WAND1, _idx: 1 },
      { a: { x: 2, z: 5 }, b: { x: 8, z: 5 }, level: 0, thickness: 0.3, height: 3, guid: WAND2, _idx: 2 },
    ],
    // one room between the walls (label "Raum A"); the upper storey has none, so its storey label shows there
    customZones: [{ points: [{ x: 2, z: 1 }, { x: 8, z: 1 }, { x: 8, z: 5 }, { x: 2, z: 5 }], level: 0, name: "Raum A", _idx: 3 }],
  } });
  const datensatz = async () => (await (await request.get(`/api/entities/BimModel?project_id=${id}`)).json())[0];
  try {
    await nurLocalhost(page);
    /** @type {string[]} */
    const warnungen = [];
    page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text()) && !/WebGL|GPU stall|maplibre|tile|Failed to load resource|Style is not done loading/i.test(m.text())) warnungen.push(m.text()); });
    page.on("pageerror", (e) => { if (!/WebGL|THREE|getUniforms/i.test(String(e.stack || e))) warnungen.push(`pageerror ${e}`); });
    const oeffnen = async () => {
      await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME)}&tab=bim`);
      await page.waitForFunction(() => !!(/** @type {any} */ (window).__bitBefehle), null, { timeout: 60000 });
      await expect(page.locator("canvas:visible").first()).toBeVisible({ timeout: 60000 });
    };
    await oeffnen();
    const zeile = (/** @type {string} */ b, /** @type {any} */ p = {}) => page.evaluate(
      ([i, q]) => JSON.parse(/** @type {any} */ (window).__bitBefehle.zeileBearbeiten(JSON.stringify({ id: i, method: "ausfuehren", params: { befehl: i, params: q } }))),
      [b, p],
    );
    const stand = () => page.evaluate(() => /** @type {any} */ (window).__bitZeigen.bimAenderung.modell());
    const wand = async (/** @type {number} */ idx) => (await stand()).customWalls.find((/** @type {any} */ w) => w._idx === idx);
    const auswahlGuids = async () => ((await zeile("auswahl-lesen")).result?.bauteile || []).map((/** @type {any} */ b) => b.guid);
    const losFokus = () => page.evaluate(() => /** @type {HTMLElement|null} */ (document.activeElement)?.blur?.());
    const links = page.getByTestId("plan-drehen-links"), rechts = page.getByTestId("plan-drehen-rechts");

    // (1) 3D view: no rotation buttons
    await expect(page.getByRole("button", { name: "Ansicht Grundriss" })).toBeVisible();
    await expect(links).toHaveCount(0);
    await expect(rechts).toHaveCount(0);
    await page.getByRole("button", { name: "Ansicht Grundriss" }).click();
    const plan = page.locator("[data-bim-plan2d]").first();
    const flaeche = plan.locator("svg[data-testid=bim-plan]").first();
    await expect(flaeche).toBeVisible();
    await flaeche.scrollIntoViewIfNeeded();
    await expect(links).toBeVisible();
    await expect(rechts).toBeVisible();
    await expect(links).toHaveAttribute("aria-label", "Plan drehen 90° links");
    await expect(rechts).toHaveAttribute("aria-label", "Plan drehen 90° rechts");
    await expect(page.getByTestId("plan-drehen")).toHaveAttribute("data-drehung", "0");
    await expect(flaeche).not.toHaveAttribute("data-plan-drehung", /.*/);
    await expect(plan.locator("[data-plan-drehgruppe]")).toHaveCount(0);

    /**
     * Screen position (CSS px) of a model point (m). In a turned plan the frame of data-plan-* lies INSIDE the rotation group, so
     * the point goes through that group's getScreenCTM; `gruppe` false = through the svg's (only right for an unturned plan).
     */
    const bildschirm = (/** @type {number} */ x, /** @type {number} */ z, gruppe = true) => flaeche.evaluate((el, a) => {
      const s = /** @type {SVGSVGElement} */ (el);
      const g = /** @type {SVGGraphicsElement|null} */ (s.querySelector("[data-plan-drehgruppe]"));
      if (a[2] && s.dataset.planDrehung && !g) throw new Error("turned plan without its rotation group");
      const k = Number(s.dataset.planSkala), x0 = Number(s.dataset.planX0), z0 = Number(s.dataset.planZ0);
      const ctm = /** @type {DOMMatrix} */ ((a[2] && g ? g : s).getScreenCTM());
      const q = new window.DOMPoint((Number(a[0]) - x0) * k, (Number(a[1]) - z0) * k).matrixTransform(ctm);
      return { x: q.x, y: q.y };
    }, [x, z, gruppe]);
    /** Waits until the plan rests (a panel opening beside it re-fits the plan a moment later). */
    const ruhe = async () => {
      let vorher = "";
      await expect.poll(async () => { const q = JSON.stringify(await bildschirm(0, 0)); const r = q === vorher; vorher = q; return r; }, { intervals: [150], timeout: 10000 }).toBe(true);
    };
    const nah = (/** @type {number} */ a, /** @type {number} */ b, /** @type {number} */ tol) => Math.abs(a - b) <= tol;
    /** Effective screen rotation of an element, degrees clockwise as seen (from its getScreenCTM). */
    const winkel = (/** @type {import("@playwright/test").Locator} */ loc) => loc.evaluateAll((els) => els.map((e) => {
      const m = /** @type {DOMMatrix} */ (/** @type {SVGGraphicsElement} */ (e).getScreenCTM());
      return { text: e.textContent, grad: (Math.atan2(m.b, m.a) * 180) / Math.PI };
    }));

    // Unturned baseline: model +x right, model +z down (P1 = wall 1 end a, P2 = its end b, P3 = wall 2 end a)
    await ruhe();
    {
      const p1 = await bildschirm(2, 1), p2 = await bildschirm(8, 1), p3 = await bildschirm(2, 5);
      const k0 = (p2.x - p1.x) / 6;
      expect(k0, "px per metre at 0°").toBeGreaterThan(5);
      expect(nah(p2.y, p1.y, 0.5) && nah(p3.x, p1.x, 0.5) && nah(p3.y - p1.y, 4 * k0, 0.5), JSON.stringify({ p1, p2, p3 })).toBe(true);
    }
    if (BILDER) await flaeche.screenshot({ path: path.join(BILDER, "plan-0.png") });

    // (2) one quarter turn to the left
    await links.click();
    await expect(flaeche).toHaveAttribute("data-plan-drehung", "90");
    await expect(page.getByTestId("plan-drehen")).toHaveAttribute("data-drehung", "90");
    await expect(plan.locator("[data-plan-drehgruppe]")).toHaveCount(1);
    await ruhe();
    /** Checks the screen frame of a plan turned 90° to the left; returns px per metre. */
    const pruefeLinks = async () => {
      const p1 = await bildschirm(2, 1), p2 = await bildschirm(8, 1), p3 = await bildschirm(2, 5), n = await bildschirm(2, 0);
      const k = Math.hypot(p2.x - p1.x, p2.y - p1.y) / 6;
      const lage = JSON.stringify({ p1, p2, p3, n, k });
      expect(k, `px per metre ${lage}`).toBeGreaterThan(5);
      // model +x (6 m along wall 1) points UP on the screen
      expect(nah(p2.x, p1.x, 0.5) && nah(p2.y - p1.y, -6 * k, 0.5), `+x nach oben ${lage}`).toBe(true);
      // model +z (4 m from wall 1 to wall 2) points RIGHT, same scale (no shear, no mirror)
      expect(nah(p3.y, p1.y, 0.5) && nah(p3.x - p1.x, 4 * k, 0.5), `+z nach rechts ${lage}`).toBe(true);
      // north (model −z) points LEFT: the west side of the plan lies at the bottom (D-115-13)
      expect(nah(n.y, p1.y, 0.5) && nah(n.x - p1.x, -k, 0.5), `Nord nach links ${lage}`).toBe(true);
      return { p1, p2, p3, k };
    };
    const g90 = await pruefeLinks();
    // the svg's own CTM no longer gives the point (the test above really goes through the group)
    const ohneGruppe = await bildschirm(2, 1, false);
    expect(Math.hypot(ohneGruppe.x - g90.p1.x, ohneGruppe.y - g90.p1.y), "svg-CTM ≠ group CTM in a turned plan").toBeGreaterThan(5);
    // the RENDERED wall 1 stands upright at the predicted place: box centre = middle of P1–P2, 6 m high, 0.3 m wide
    const box = await plan.locator('path[data-wand="1"], g[data-wand="1"]').first().evaluate((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
    const mitte = { x: (g90.p1.x + g90.p2.x) / 2, y: (g90.p1.y + g90.p2.y) / 2 };
    expect(nah(box.x + box.w / 2, mitte.x, 1.5) && nah(box.y + box.h / 2, mitte.y, 1.5), `Wandbox ${JSON.stringify({ box, mitte })}`).toBe(true);
    expect(box.h, `Wandbox hoch ${JSON.stringify(box)}`).toBeGreaterThan(5.8 * g90.k);
    expect(box.h).toBeLessThan(6.5 * g90.k);
    expect(box.w, `Wandbox schmal ${JSON.stringify(box)}`).toBeLessThan(0.6 * g90.k);
    // the north arrow points where model north lies on the screen (left), its "N" stays upright
    const pfeil = await plan.locator("[data-nordpfeil-winkel] path").first().evaluate((e) => {
      const m = /** @type {RegExpMatchArray} */ (String(e.getAttribute("d")).match(/^M\s*(-?[\d.]+)[ ,](-?[\d.]+)/));
      const ctm = /** @type {DOMMatrix} */ (/** @type {SVGGraphicsElement} */ (e).getScreenCTM());
      const spitze = new window.DOMPoint(Number(m[1]), Number(m[2])).matrixTransform(ctm), zentrum = new window.DOMPoint(Number(m[1]), Number(m[2]) + 10).matrixTransform(ctm);
      const l = Math.hypot(spitze.x - zentrum.x, spitze.y - zentrum.y);
      return { x: (spitze.x - zentrum.x) / l, y: (spitze.y - zentrum.y) / l };
    });
    expect(nah(pfeil.x, -1, 0.02) && nah(pfeil.y, 0, 0.02), `Nordpfeil ${JSON.stringify(pfeil)}`).toBe(true);
    for (const w of await winkel(plan.locator("[data-nordpfeil-winkel] text"))) expect(Math.abs(w.grad), `N ${JSON.stringify(w)}`).toBeLessThan(1);

    // (3) room label upright; every text of the turned drawing readable (from below or from the right: [−90°, 90°) as seen)
    const raum = await winkel(plan.locator("[data-plan-label]"));
    expect(raum.map((w) => w.text).join("|")).toContain("Raum A");
    for (const w of raum) expect(Math.abs(w.grad), `Raumtext ${JSON.stringify(w)}`).toBeLessThan(1);
    const alle = await winkel(plan.locator("[data-plan-drehgruppe] text"));
    expect(alle.length).toBeGreaterThan(3);
    for (const w of alle) expect(w.grad >= -91 && w.grad < 89, `lesbar ${JSON.stringify(w)}`).toBe(true);
    // storey label (upper storey has no room): upright as well
    await page.getByTestId("bim-geschoss").selectOption("1");
    await expect(plan.locator("[data-plan-label]").first()).toBeVisible();
    const geschoss = await winkel(plan.locator("[data-plan-label]"));
    expect(geschoss.map((w) => w.text).join("|")).not.toContain("Raum A");
    for (const w of geschoss) expect(Math.abs(w.grad), `Geschosstext ${JSON.stringify(w)}`).toBeLessThan(1);
    await page.getByTestId("bim-geschoss").selectOption("0");
    await expect(plan.locator("[data-plan-label]", { hasText: "Raum A" })).toHaveCount(1);
    await ruhe();

    // (2b) a click on a wall at its turned screen position selects exactly that wall
    await losFokus();
    await page.keyboard.press("Escape");
    expect(await auswahlGuids()).toEqual([]);
    const klick = async (/** @type {number} */ x, /** @type {number} */ z) => { const q = await bildschirm(x, z); await page.mouse.move(q.x, q.y); await page.mouse.click(q.x, q.y); await page.waitForTimeout(150); };
    await klick(6.5, 5.05);
    await expect.poll(auswahlGuids, { timeout: 10000 }).toEqual([WAND2]);
    await ruhe();
    await klick(3.5, 0.95);
    await expect.poll(auswahlGuids, { timeout: 10000 }).toEqual([WAND1]);
    await expect(page.getByText("Wand · Attribute")).toBeVisible();
    await ruhe();

    // (2c) grip of end a dragged by a SCREEN vector: 2 m to the right and 3 m down as seen → model Δ = (−3, +2) after turning back
    {
      const { p1, k } = await pruefeLinks();
      const ziel = { x: p1.x + 2 * k, y: p1.y + 3 * k };
      await page.mouse.move(p1.x, p1.y);
      await page.mouse.down();
      await page.mouse.move(ziel.x, ziel.y, { steps: 10 });
      await page.mouse.up();
      await expect.poll(async () => { const a = (await wand(1)).a; return nah(a.x, -1, 0.02) && nah(a.z, 3, 0.02); }, { timeout: 15000, message: "Wandende a nach (−1, 3)" }).toBe(true);
      const w1 = await wand(1);
      expect(w1.b).toEqual({ x: 8, z: 1 }); // the other end stays
      await losFokus();
      await page.keyboard.press("Control+z");
      await expect.poll(async () => (await wand(1)).a, { timeout: 15000 }).toEqual({ x: 2, z: 1 });
    }

    // (2d) arrow keys on the turned plan (review finding N-01): the selected wall moves the way the pressed arrow points ON THE
    // SCREEN, 1 m with Shift. Truth on the screen: the rendered box of wall 1 relative to the unmoved wall 2, in metres (scale-free,
    // so a re-fit of the plan does not matter); truth in the model: right = +z, up = +x, left = −z, down = −x (frame of pruefeLinks).
    // The four steps lead back to the start.
    {
      await klick(3.5, 0.95);
      await expect.poll(auswahlGuids, { timeout: 10000 }).toEqual([WAND1]);
      await ruhe();
      /** Centre of wall 1's rendered box minus wall 2's, as seen, in metres (x right, y down). */
      const relativ = async () => {
        const mitteVon = (/** @type {number} */ n) => plan.locator(`path[data-wand="${n}"], g[data-wand="${n}"]`).first().evaluate((e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
        const a = await bildschirm(2, 1), b = await bildschirm(8, 1), k = Math.hypot(b.x - a.x, b.y - a.y) / 6;
        const m1 = await mitteVon(1), m2 = await mitteVon(2);
        return { x: (m1.x - m2.x) / k, y: (m1.y - m2.y) / k };
      };
      /** @type {Array<[string, {x: number, y: number}, {x: number, z: number}]>} key, direction as seen, wall 1 end a afterwards */
      const schritte = [
        ["Shift+ArrowRight", { x: 1, y: 0 }, { x: 2, z: 2 }],
        ["Shift+ArrowUp", { x: 0, y: -1 }, { x: 3, z: 2 }],
        ["Shift+ArrowLeft", { x: -1, y: 0 }, { x: 3, z: 1 }],
        ["Shift+ArrowDown", { x: 0, y: 1 }, { x: 2, z: 1 }],
      ];
      for (const [taste, richtung, a] of schritte) {
        const vorher = await relativ();
        await losFokus();
        await page.waitForTimeout(300); // the key handler reads the selection of the last render
        await page.keyboard.press(taste);
        await expect.poll(async () => (await wand(1)).a, { timeout: 15000, message: `${taste}: Wandende a` }).toEqual(a);
        expect((await wand(1)).b, `${taste}: Wandende b`).toEqual({ x: a.x + 6, z: a.z });
        await ruhe();
        const nachher = await relativ();
        const lage = JSON.stringify({ taste, vorher, nachher });
        expect(nah(nachher.x - vorher.x, richtung.x, 0.05) && nah(nachher.y - vorher.y, richtung.y, 0.05), `am Bildschirm in Pfeilrichtung ${lage}`).toBe(true);
      }
      expect(await auswahlGuids()).toEqual([WAND1]);
    }

    // (4) stored as a view property of the project, survives a reload
    await expect.poll(async () => (await datensatz())?.ansicht_layer?.plan_drehung, { timeout: 15000 }).toBe(90);
    await expect.poll(async () => (await datensatz())?.customWalls?.find((/** @type {any} */ w) => w._idx === 1)?.a, { timeout: 15000 }).toEqual({ x: 2, z: 1 });
    await page.reload();
    await page.waitForFunction(() => !!(/** @type {any} */ (window).__bitBefehle), null, { timeout: 60000 });
    await page.getByRole("button", { name: "Ansicht Grundriss" }).click();
    await expect(flaeche).toBeVisible();
    await flaeche.scrollIntoViewIfNeeded();
    await expect(flaeche).toHaveAttribute("data-plan-drehung", "90", { timeout: 15000 });
    await expect(page.getByTestId("plan-drehen")).toHaveAttribute("data-drehung", "90");
    await ruhe();
    await pruefeLinks();
    if (BILDER) await flaeche.screenshot({ path: path.join(BILDER, "plan-90-links.png") });

    // (5) section: no buttons, no rotation group, no turned geometry, and the same markup as with the plan at 0°
    const schnittMarkup = async () => {
      await page.getByRole("button", { name: "Ansicht Schnitt" }).click();
      const s = plan.locator("svg").first();
      await expect(s).toBeVisible();
      await expect(links).toHaveCount(0);
      await expect(rechts).toHaveCount(0);
      await expect(plan.locator("[data-plan-drehgruppe]")).toHaveCount(0);
      await expect(s).not.toHaveAttribute("data-plan-drehung", /.*/);
      await page.waitForTimeout(500);
      // drawn geometry only: the content of a hatch <pattern> carries its own rotate(45) in every view
      const gedreht = await s.evaluate((el) => [...el.querySelectorAll("path, rect, line, polygon, polyline")].filter((e) => !e.closest("pattern, defs")).filter((e) => {
        const m = /** @type {SVGGraphicsElement} */ (e).getScreenCTM();
        return !m || Math.abs(m.b) > 1e-6 || Math.abs(m.c) > 1e-6 || m.a <= 0 || m.d <= 0;
      }).length);
      expect(gedreht, "turned geometry in the section").toBe(0);
      return s.evaluate((el) => el.outerHTML);
    };
    const schnitt90 = await schnittMarkup();
    await page.getByRole("button", { name: "Ansicht Grundriss" }).click();
    await rechts.click();
    await expect(page.getByTestId("plan-drehen")).toHaveAttribute("data-drehung", "0");
    await expect(flaeche).not.toHaveAttribute("data-plan-drehung", /.*/);
    const schnitt0 = await schnittMarkup();
    expect(schnitt90 === schnitt0, "section markup independent of the plan rotation").toBe(true);
    await page.getByRole("button", { name: "Ansicht Grundriss" }).click();
    await links.click();
    await expect(flaeche).toHaveAttribute("data-plan-drehung", "90");
    await ruhe();

    // (6) sheet orientation: "wie am Bildschirm" (start value) → turned DXF with north arrow; 0° → the sheet as before
    if (!(await page.getByTestId("bim-plan-dxf").isVisible())) await page.getByRole("button", { name: "Mappe ein-/ausblenden" }).click();
    const blatt = page.getByTestId("bim-blatt-drehung");
    await expect(blatt).toBeVisible();
    await expect(blatt).toHaveValue("bild");
    await expect(blatt.locator("option:checked")).toHaveText("wie am Bildschirm (90°)");
    const dxf = async () => {
      const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("bim-plan-dxf").click()]);
      return fs.readFileSync(/** @type {string} */ (await dl.path())).toString("latin1");
    };
    /** Is there a point of wall 1 (centre line ± half thickness) near (x, y) of the DXF? */
    const bei = (/** @type {Array<{x: number, y: number}>} */ pts, /** @type {number} */ x, /** @type {number} */ y) => pts.some((p) => Math.hypot(p.x - x, p.y - y) <= 0.2);
    const t90 = await dxf();
    expect(t90).toContain("Blattausrichtung: Zeichnung um 90 Grad gegen den Uhrzeigersinn um den Modellursprung gedreht");
    expect(t90).toContain("\r\nA_NORDPFEIL\r\n");
    // sheet coordinates turned 90° to the left about the model origin: model (x, z) → DXF (z, x) (DXF y = −z of the sheet)
    const w90 = dxfPunkte(t90, ["A_WAND", "A_WAND_POCHE"]);
    expect(w90.length, "wall points in the DXF").toBeGreaterThan(0);
    expect(bei(w90, 1, 2) && bei(w90, 1, 8), `Wand 1 gedreht ${JSON.stringify(w90.slice(0, 40))}`).toBe(true);
    expect(bei(w90, 2, -1) || bei(w90, 8, -1), "no unturned wall 1").toBe(false);
    await blatt.selectOption("0");
    await expect(blatt).toHaveValue("0");
    const t0 = await dxf();
    expect(t0).not.toContain("Blattausrichtung");
    expect(t0).not.toContain("A_NORDPFEIL");
    // model coordinates as before 115-04: DXF (x, −z)
    const w0 = dxfPunkte(t0, ["A_WAND", "A_WAND_POCHE"]);
    expect(bei(w0, 2, -1) && bei(w0, 8, -1), `Wand 1 ungedreht ${JSON.stringify(w0.slice(0, 40))}`).toBe(true);
    expect(bei(w0, 1, 2) || bei(w0, 1, 8), "no turned wall 1").toBe(false);
    // the screen keeps its rotation; the own sheet orientation is stored beside it
    await expect(flaeche).toHaveAttribute("data-plan-drehung", "90");
    await expect.poll(async () => { const l = (await datensatz())?.ansicht_layer; return `${l?.plan_drehung}|${l?.blatt_drehung}`; }, { timeout: 15000 }).toBe("90|0");

    // (7) console clean
    expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
  } finally {
    for (const m of await (await request.get(`/api/entities/BimModel?project_id=${id}`)).json()) await request.delete(`/api/entities/BimModel/${m.id}`);
    await request.delete(`/api/entities/Project/${id}`);
  }
});
