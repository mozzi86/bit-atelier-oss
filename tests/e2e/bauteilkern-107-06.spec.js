// Headless-Nachweis 107-06 (Flächen-Push/Pull) im echten Browser: (1) in der 3D-Ansicht die Westseite eines Körpers anklicken
// und nach außen ziehen → die Profilkante wandert entlang der Außennormalen (Betrag = Zeigerweg projiziert auf die Bildschirm-
// richtung der Normalen, 5 cm gerundet); (2) mit Alt die Unterseite ziehen → basis sinkt, Oberkante bleibt; (3) an einer dünnen
// Wand eine Seite anklicken, „B;H“ tippen (Teilfläche) und „-0,3“ → Öffnung statt Geometriebruch (Plan, 3D, gespeichert);
// (4) dasselbe an einem dicken Körper mit 1 m → abgelehnt mit der Meldung zum CSG-Kern. Review 107-06: (3b) ein Teilrechteck
// per Maus-Zug durchgedrückt wird ebenfalls Öffnung; (5) Stufe über die volle Höhe, danach trifft die nächste getippte Tiefe das
// verschobene Stück; nach „Auswahl aufheben“ verändert eine getippte Tiefe nichts mehr. Eigenes Projekt, Aufräumen im finally,
// Konsole sauber. Die Bildschirmpunkte der Flächen kommen aus der echten Kamera (Hook __planZuBildschirm am 3D-Wrapper).
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";

const NAME = "E2E Bauteilkern 10706";

/** Block 6 × 4 m at site (10, 10), 3 m high; thin wall 5 × 0,30 m at site (10, 25), 3 m high. */
const BLOCK = { id: "k1", name: "Block", profil: [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 4 }, { x: 0, y: 4 }], hoehe: 3, basis: 0, pos: { x: 10, y: 10 }, drehung: 0, gruppe: null };
const WAND = { id: "k2", name: "Wand", profil: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 0.3 }, { x: 0, y: 0.3 }], hoehe: 3, basis: 0, pos: { x: 10, y: 25 }, drehung: 0, gruppe: null };

test("107-06 Flächen-Push/Pull: Seite ziehen, Unterseite ziehen, Durchbruch an dünner Wand wird Öffnung (getippt und gezogen), Teil-Durchbruch abgelehnt, Stufe mit neuer Wahl", async ({ page, request }) => {
  test.setTimeout(180000);
  let id = null;
  try {
    await nurLocalhost(page);
    const warnungen = [];
    page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text()) && !/WebGL|GPU stall/i.test(m.text())) warnungen.push(m.text()); });
    page.on("pageerror", (e) => { if (!/WebGL|THREE|getUniforms/i.test(String(e.stack || e))) warnungen.push(`pageerror ${e}`); });
    id = (await (await request.post("/api/entities/Project", { data: { name: NAME, build_kind: "neubau", status: "concept" } })).json()).id;
    await request.post("/api/entities/BimModel", { data: { project_id: id, massing_layer: { koerper: [BLOCK, WAND], gruppen: {}, naechsteId: 3 } } });
    await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME)}&tab=studio`);
    await expect(page.getByTestId("mm-leiste")).toBeVisible({ timeout: 60000 });
    await expect(page.getByTestId("mm-koerper")).toHaveCount(2);
    const split = page.locator('[data-ansicht="split"]');
    if (await split.count()) await split.first().click();
    const mv = page.getByTestId("mv-3d").first();
    await expect(mv).toBeVisible({ timeout: 20000 });
    const gl = (await mv.locator("canvas").count()) > 0;
    test.skip(!gl, "kein WebGL im Browser — die 3D-Gesten lassen sich hier nicht belegen");
    await page.getByTestId("mm-pushpull").click();
    await expect(page.getByTestId("mm-leiste")).toHaveAttribute("data-werkzeug", "pushpull");
    const canvas = mv.locator("canvas").first();
    await canvas.scrollIntoViewIfNeeded();

    /** Screen point (page px) of a site point (m; z up) through the live camera. */
    const bild = async (/** @type {{x: number, y: number, z: number}} */ p) => {
      const r = /** @type {{x: number, y: number, width: number, height: number}} */ (await canvas.boundingBox());
      const s = await mv.evaluate((el, q) => /** @type {any} */ (el).__planZuBildschirm(q), p);
      return { x: r.x + s.sx, y: r.y + s.sy, innen: s.sx > 4 && s.sy > 4 && s.sx < r.width - 4 && s.sy < r.height - 4 };
    };
    /** Bring a site point into the canvas: zoom out step by step (key "-" zooms only outside push/pull, so the wheel). */
    const sichtbar = async (/** @type {{x: number, y: number, z: number}} */ p) => {
      for (let i = 0; i < 6 && !(await bild(p)).innen; i++) {
        const r = /** @type {any} */ (await canvas.boundingBox());
        await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
        await page.mouse.wheel(0, 400);
        await page.waitForTimeout(500);
      }
      expect((await bild(p)).innen, `Punkt ${JSON.stringify(p)} im Bild`).toBe(true);
    };
    /** Drag from a face point along its outward normal by `meter` m (screen projection of the normal through the camera). */
    const ziehe = async (/** @type {{x: number, y: number, z: number}} */ p, /** @type {{x: number, y: number, z: number}} */ n, /** @type {number} */ meter, alt = false) => {
      const a = await bild(p), b = await bild({ x: p.x + n.x, y: p.y + n.y, z: p.z + n.z });
      if (alt) await page.keyboard.down("Alt");
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      await page.mouse.move(a.x + (b.x - a.x) * meter, a.y + (b.y - a.y) * meter, { steps: 8 });
      await page.mouse.up();
      if (alt) await page.keyboard.up("Alt");
    };
    const modell = async () => page.evaluate(() => /** @type {any} */ (window).__bitBefehle.ausfuehren("modell").result);
    const koerper = async (/** @type {string} */ kid) => (await modell()).koerper.find((/** @type {any} */ k) => k.id === kid);

    // (1) west face of the block (x = 10, normal −x), dragged 2 m outwards → the stored profile starts at x = −2 (site x = 8)
    const west = { x: 10, y: 12, z: 1.5 };
    await sichtbar(west);
    await sichtbar({ x: 12.5, y: 25.3, z: 1.5 });
    await ziehe(west, { x: -1, y: 0, z: 0 }, 2);
    const wahl = page.getByTestId("mm-flaeche-wahl");
    await expect(wahl).toHaveAttribute("data-art", "seite");
    await expect(wahl).toHaveAttribute("data-kante", "3");
    await expect(page.getByTestId("mm-flaeche-kante")).toHaveCount(1);
    await expect(mv).toHaveAttribute("data-mk-flaeche", /^seite:aussen:3$/);
    await expect.poll(async () => Math.min(...(await koerper("k1")).profil.map((/** @type {any} */ q) => q.x))).toBeLessThan(-1.85);
    const minX = Math.min(...(await koerper("k1")).profil.map((/** @type {any} */ q) => q.x));
    expect(minX).toBeGreaterThan(-2.15);
    expect(Math.max(...(await koerper("k1")).profil.map((/** @type {any} */ q) => q.x))).toBe(6); // the east face stayed
    expect((await koerper("k1")).hoehe).toBe(3);

    // (2) Alt + drag on the block = its bottom face; 1 m down → basis −1, height 4 (top stays at 3)
    await ziehe({ x: 13, y: 12, z: 3 }, { x: 0, y: 0, z: -1 }, 1, true);
    await expect(wahl).toHaveAttribute("data-art", "unten");
    await expect.poll(async () => (await koerper("k1")).basis).toBeLessThan(-0.9);
    const b = await koerper("k1");
    expect(b.basis).toBeGreaterThan(-1.1);
    expect(b.basis + b.hoehe).toBeCloseTo(3, 6);

    // (3) thin wall: click its south face (y = 25.3, normal +y), part rectangle 1,2 × 1,5 m, push 0,30 m in → opening
    const sued = { x: 12.5, y: 25.3, z: 1.5 };
    const s = await bild(sued);
    await page.mouse.click(s.x, s.y);
    await expect(wahl).toHaveAttribute("data-art", "seite");
    await expect(wahl).toHaveAttribute("data-kante", "2");
    const zeile = page.getByTestId("mm-eingabe");
    await zeile.fill("1,2;1,5");
    await zeile.press("Enter");
    await expect(wahl).toHaveAttribute("data-teil", "1");
    await expect(page.getByTestId("mm-meldung")).toContainText("Teilfläche 1,20 m × 1,50 m");
    const profilVorher = JSON.stringify((await koerper("k2")).profil);
    await zeile.fill("-0,3");
    await zeile.press("Enter");
    await expect(page.getByTestId("mm-meldung")).toContainText("Öffnung angelegt: 1,20 m × 1,50 m");
    const w = await koerper("k2");
    expect(w.oeffnungen?.length).toBe(1);
    expect(w.oeffnungen[0].kante).toBe(2);
    expect(w.oeffnungen[0].width).toBe(1.2);
    expect(w.oeffnungen[0].height).toBe(1.5);
    expect(Math.abs(w.oeffnungen[0].u - 2.5)).toBeLessThan(0.15);
    expect(JSON.stringify(w.profil)).toBe(profilVorher); // no geometry change
    await expect(page.locator('[data-testid=mm-koerper][data-id="k2"] [data-testid=mm-oeffnung][data-ok="1"]')).toHaveCount(1);
    await expect(mv).toHaveAttribute("data-mk-oeffnungen", "1");

    // (3b) review 107-06: the same through a MOUSE drag — click the south face at x 11,2 (u 3,8), part 0,8 × 1 m, then drag that
    // face 0,4 m inwards (5 cm rounding; overshoot counts as through) → a second opening, the profile stays
    const sued2 = { x: 11.2, y: 25.3, z: 1.5 };
    await sichtbar(sued2);
    const s2 = await bild(sued2);
    await page.mouse.click(s2.x, s2.y);
    await expect(wahl).toHaveAttribute("data-kante", "2");
    await zeile.fill("0,8;1");
    await zeile.press("Enter");
    await expect(wahl).toHaveAttribute("data-teil", "1");
    await ziehe(sued2, { x: 0, y: 1, z: 0 }, -0.4);
    await expect(page.getByTestId("mm-meldung")).toContainText("Öffnung angelegt: 0,80 m × 1,00 m");
    const w2 = await koerper("k2");
    expect(w2.oeffnungen?.length).toBe(2);
    expect(w2.oeffnungen[1].kante).toBe(2);
    expect(Math.abs(w2.oeffnungen[1].u - 3.8)).toBeLessThan(0.15);
    expect(JSON.stringify(w2.profil)).toBe(profilVorher);
    await expect(page.locator('[data-testid=mm-koerper][data-id="k2"] [data-testid=mm-oeffnung][data-ok="1"]')).toHaveCount(2);
    await expect(mv).toHaveAttribute("data-mk-oeffnungen", "2");

    // (4) the thick block: part rectangle 1 × 1 m on its south face (y = 14), pushed 1 m in → refused (CSG core)
    const blockSued = { x: 12, y: 14, z: 1.5 };
    await sichtbar(blockSued);
    const bs = await bild(blockSued);
    await page.mouse.click(bs.x, bs.y);
    await expect(wahl).toHaveAttribute("data-kante", "2");
    await zeile.fill("1;1");
    await zeile.press("Enter");
    await zeile.fill("-1");
    await zeile.press("Enter");
    await expect(page.getByTestId("mm-meldung")).toContainText("Teil-Durchbruch im Volumen nicht verfügbar: folgt mit dem CSG-Kern");
    expect((await koerper("k1")).oeffnungen).toBeUndefined();

    // (5) review 107-06: the block (now 4 m high, basis −1) — part 2 × 4 m = full height around u 4 of its south face, +0,5 m → a step;
    // the pick follows the moved piece, so a second "0,5" moves the step to y 5 (local), not the rest of the old edge
    await zeile.fill("2;4");
    await zeile.press("Enter");
    await expect(wahl).toHaveAttribute("data-teil", "1");
    await zeile.fill("0,5");
    await zeile.press("Enter");
    await expect.poll(async () => Math.max(...(await koerper("k1")).profil.map((/** @type {any} */ q) => q.y))).toBe(4.5);
    const stufe = (await koerper("k1")).profil;
    const iStufe = stufe.findIndex((/** @type {any} */ q, /** @type {number} */ i) => q.y === 4.5 && stufe[(i + 1) % stufe.length].y === 4.5);
    await expect(wahl).toHaveAttribute("data-kante", String(iStufe));
    await expect(wahl).toHaveAttribute("data-teil", "");
    await zeile.fill("0,5");
    await zeile.press("Enter");
    await expect.poll(async () => Math.max(...(await koerper("k1")).profil.map((/** @type {any} */ q) => q.y))).toBe(5);
    const nachStufe = (await koerper("k1")).profil;
    expect(nachStufe.filter((/** @type {any} */ q) => q.y === 5).map((/** @type {any} */ q) => q.x).sort()).toEqual([1, 3]);
    expect(nachStufe.some((/** @type {any} */ q) => q.x === 6 && q.y === 4)).toBe(true); // the rest of the old edge stayed

    // after "Auswahl aufheben" a typed distance no longer reaches the picked face
    await page.evaluate(() => /** @type {any} */ (window).__bitBefehle.ausfuehren("auswahl-aufheben"));
    await zeile.fill("0,5");
    await zeile.press("Enter");
    await page.waitForTimeout(300);
    expect(JSON.stringify((await koerper("k1")).profil)).toBe(JSON.stringify(nachStufe));

    // saved through the one write path (debounced)
    await expect.poll(async () => {
      const m = (await (await request.get(`/api/entities/BimModel?project_id=${id}`)).json())[0];
      const k1 = m?.massing_layer?.koerper?.find((x) => x.id === "k1");
      const k2 = m?.massing_layer?.koerper?.find((x) => x.id === "k2");
      return k1 && k2 ? `${k1.basis < -0.9}|${k2.oeffnungen?.length}` : null;
    }, { timeout: 20000 }).toBe("true|2");

    expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
  } finally {
    if (id) {
      const ms = await (await request.get(`/api/entities/BimModel?project_id=${id}`)).json();
      for (const m of Array.isArray(ms) ? ms : []) await request.delete(`/api/entities/BimModel/${m.id}`);
      await request.delete(`/api/entities/Project/${id}`);
    }
  }
});
