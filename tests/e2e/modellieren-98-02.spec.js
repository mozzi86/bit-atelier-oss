// Headless-Nachweis 98-02…05: Massing-Studio als Modellierer — Linie zeichnen und am Startpunkt schließen
// (Körper mit Geschosshöhe), Push/Pull per Maßeingabe, Verschieben mit Strg = Kopie, danach „*3“ (drei Kopien im
// Abstand), Gruppe bilden: eine Instanz ändern ändert alle mit derselben Nummer; alles im Feld massing_layer
// gespeichert. Eigenes Projekt, Aufräumen im finally, Konsole sauber.
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";

const NAME = "E2E Modellieren 9802";

test("98 Modellieren: Linie → Fläche → Push/Pull → Kopie *3 → Gruppe → Folge mir → Drehen → Skalieren", async ({ page, request }) => {
  test.setTimeout(180000);
  let id = null;
  try {
    await nurLocalhost(page);
    const warnungen = [];
    page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text()) && !/WebGL|GPU stall/i.test(m.text())) warnungen.push(m.text()); });
    page.on("pageerror", (e) => { if (!/WebGL|THREE|getUniforms/i.test(String(e.stack || e))) warnungen.push(`pageerror ${e}`); });
    id = (await (await request.post("/api/entities/Project", { data: { name: NAME, build_kind: "neubau", status: "concept" } })).json()).id;
    await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME)}&tab=studio`);
    await expect(page.getByTestId("mm-leiste")).toBeVisible({ timeout: 60000 });

    // Line tool: four corners, then the first corner again → closed face → one body.
    await page.getByTestId("mm-linie").click();
    const flaeche = page.getByTestId("mm-flaeche");
    await flaeche.scrollIntoViewIfNeeded();
    // Measured before every click: tool buttons scroll the page, stale coordinates would miss.
    const at = async (fx, fy) => {
      await flaeche.scrollIntoViewIfNeeded();
      const box = /** @type {{x:number,y:number,width:number,height:number}} */ (await flaeche.boundingBox());
      return { x: box.x + box.width * fx, y: box.y + box.height * fy };
    };
    for (const [fx, fy] of [[0.3, 0.55], [0.38, 0.55], [0.38, 0.65], [0.3, 0.65], [0.3, 0.55]]) {
      const p = await at(fx, fy);
      await page.mouse.move(p.x, p.y);
      await page.mouse.click(p.x, p.y);
    }
    const koerper = page.getByTestId("mm-koerper");
    await expect(koerper).toHaveCount(1);
    await expect(page.getByTestId("mm-leiste")).toHaveAttribute("data-werkzeug", "pushpull");
    await expect(page.getByTestId("mm-schritt-flaeche")).toHaveAttribute("data-erledigt", "1");
    const h0 = Number(await koerper.first().getAttribute("data-hoehe"));
    expect(h0).toBeGreaterThan(2);

    // Push/Pull: type 6 + Enter → +6 m.
    await page.keyboard.type("6");
    await expect(page.getByTestId("mm-eingabe")).toHaveValue("6");
    await page.keyboard.press("Enter");
    await expect(koerper.first()).toHaveAttribute("data-hoehe", String(+(h0 + 6).toFixed(6)));

    // Ctrl+Enter = stack a new body on top (SketchUp Ctrl push/pull), then undo it again.
    await page.keyboard.type("3");
    await page.keyboard.press("Control+Enter");
    await expect(koerper).toHaveCount(2);
    await expect(koerper.nth(1)).toHaveAttribute("data-hoehe", "3");
    await page.getByTestId("mm-undo").click();
    await expect(koerper).toHaveCount(1);

    // Move with Ctrl = copy, then *3 → three copies at that distance (4 bodies).
    await page.getByTestId("mm-verschieben").click();
    const a = await at(0.34, 0.58), b = await at(0.46, 0.58);
    await page.mouse.click(a.x, a.y);
    await page.mouse.move(b.x, b.y);
    await page.keyboard.down("Control");
    await page.mouse.click(b.x, b.y);
    await page.keyboard.up("Control");
    await expect(koerper).toHaveCount(2);
    await page.keyboard.type("*3");
    await page.keyboard.press("Enter");
    await expect(koerper).toHaveCount(4);
    for (const sch of ["pushpull", "kopie", "reihe"]) await expect(page.getByTestId(`mm-schritt-${sch}`)).toHaveAttribute("data-erledigt", "1");

    // Group: select all four (Shift), group 1; push/pull ONE instance → all four change.
    await page.getByTestId("mm-auswahl").click();
    const ids = await koerper.evaluateAll((els) => els.map((e) => e.getAttribute("data-id")));
    for (const [i, kid] of ids.entries()) {
      await page.locator(`[data-testid=mm-koerper][data-id="${kid}"] path`).scrollIntoViewIfNeeded();
      const r = /** @type {any} */ (await page.locator(`[data-testid=mm-koerper][data-id="${kid}"] path`).boundingBox());
      if (i) await page.keyboard.down("Shift");
      await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2 + 6);
      if (i) await page.keyboard.up("Shift");
    }
    await page.getByTestId("mm-gruppe").click();
    await expect(page.getByTestId("mm-erste-schritte")).toHaveAttribute("data-fertig", "5");
    await expect(page.locator('[data-testid=mm-koerper][data-gruppe="1"]')).toHaveCount(4);
    await page.getByTestId("mm-pushpull").click();
    await page.locator(`[data-testid=mm-koerper][data-id="${ids[2]}"] path`).scrollIntoViewIfNeeded();
    const r0 = /** @type {any} */ (await page.locator(`[data-testid=mm-koerper][data-id="${ids[2]}"] path`).boundingBox());
    await page.mouse.click(r0.x + r0.width / 2, r0.y + r0.height / 2 + 6);
    await page.keyboard.type("2");
    await page.keyboard.press("Enter");
    const hoehen = await koerper.evaluateAll((els) => els.map((e) => e.getAttribute("data-hoehe")));
    expect(new Set(hoehen).size).toBe(1);
    expect(Number(hoehen[0])).toBeCloseTo(h0 + 8, 5);

    // Reshape: drag a corner of ONE instance — the group definition changes, all four bodies follow.
    const flaechenVorher = await koerper.evaluateAll((els) => els.map((e) => e.querySelector("path").getBBox().width));
    await page.getByTestId("mm-auswahl").click();
    const k3 = page.locator(`[data-testid=mm-koerper][data-id="${ids[3]}"] path`);
    await k3.scrollIntoViewIfNeeded();
    const b3 = /** @type {any} */ (await k3.boundingBox());
    await page.mouse.click(b3.x + b3.width / 2, b3.y + b3.height / 2 + 6);
    const griffe = page.getByTestId("mm-eckgriff");
    await expect(griffe).toHaveCount(4);
    const g2 = /** @type {any} */ (await griffe.nth(2).boundingBox());
    await page.mouse.move(g2.x + g2.width / 2, g2.y + g2.height / 2);
    await page.mouse.down();
    await page.mouse.move(g2.x + g2.width / 2 + 40, g2.y + g2.height / 2, { steps: 6 });
    await page.mouse.up();
    await expect.poll(async () => {
      const w = await koerper.evaluateAll((els) => els.map((e) => e.querySelector("path").getBBox().width));
      return w.every((x, i) => x > flaechenVorher[i] + 1);
    }).toBe(true);

    // Follow me: three path points, Enter with "0,4;2,5" → one swept body; then rotate 90° and scale ×2.
    await page.getByTestId("mm-folgemir").click();
    for (const [fx, fy] of [[0.3, 0.8], [0.5, 0.8], [0.5, 0.9]]) { const p = await at(fx, fy); await page.mouse.move(p.x, p.y); await page.mouse.click(p.x, p.y); }
    await page.keyboard.type("0,4;2,5");
    await page.keyboard.press("Enter");
    await expect(koerper).toHaveCount(5);
    const folge = koerper.nth(4);
    await expect(folge).toHaveAttribute("data-hoehe", "2.5");
    const fid = await folge.getAttribute("data-id");
    await page.getByTestId("mm-drehen").click();
    await expect(page.getByTestId("mm-leiste")).toHaveAttribute("data-werkzeug", "drehen");
    await page.keyboard.type("90");
    await page.keyboard.press("Enter");
    await page.getByTestId("mm-skalieren").click();
    await page.keyboard.type("2");
    await page.keyboard.press("Enter");

    // Saved in the ONE model record (debounced).
    await expect.poll(async () => {
      const m = (await (await request.get(`/api/entities/BimModel?project_id=${id}`)).json())[0];
      const l = m?.massing_layer;
      const f = l?.koerper.find((k) => k.id === fid);
      return l ? `${l.koerper.length}|${Object.keys(l.gruppen).join(",")}|${f?.drehung}|${f?.profil?.length}` : null;
    }, { timeout: 20000 }).toBe("5|1|90|6");
    expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
  } finally {
    if (id) {
      const ms = await (await request.get(`/api/entities/BimModel?project_id=${id}`)).json();
      for (const m of Array.isArray(ms) ? ms : []) await request.delete(`/api/entities/BimModel/${m.id}`);
      await request.delete(`/api/entities/Project/${id}`);
    }
  }
});

// 98-07: node editor — example graph (rectangle → grid → attractor → extrude) gives a dashed
// preview; changing a slider value changes the count; removing a wire shows the error on the node;
// dragging from an output port to an input port reconnects; "Backen" turns the preview into bodies.
test("98-07 Parametrik: Knoten verbinden, Vorschau, Backen", async ({ page, request }) => {
  test.setTimeout(180000);
  const NAME2 = "E2E Parametrik 9807";
  let id = null;
  try {
    await nurLocalhost(page);
    const warnungen = [];
    page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text()) && !/WebGL|GPU stall/i.test(m.text())) warnungen.push(m.text()); });
    page.on("pageerror", (e) => { if (!/WebGL|THREE|getUniforms/i.test(String(e.stack || e))) warnungen.push(`pageerror ${e}`); });
    id = (await (await request.post("/api/entities/Project", { data: { name: NAME2, build_kind: "neubau", status: "concept" } })).json()).id;
    await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME2)}&tab=studio`);
    await page.getByTestId("parametrik").locator("summary").click({ timeout: 60000 });
    await page.getByTestId("knoten-beispiel").click();
    await expect(page.getByTestId("knoten")).toHaveCount(4);
    const ergebnis = page.getByTestId("knoten-ergebnis");
    await expect(ergebnis).toHaveAttribute("data-anzahl", "6");
    await expect(page.getByTestId("mm-vorschau")).toHaveCount(6);

    // Grid nx 3 → 4: eight bodies.
    await page.getByLabel("Raster nx").fill("4");
    await expect(ergebnis).toHaveAttribute("data-anzahl", "8");

    // Remove the wire grid → extrude: error on the extrude node, nothing in the preview.
    const kanten = page.getByTestId("knoten-kante");
    await expect(kanten).toHaveCount(4);
    const n4ein = page.locator('[data-testid=knoten-port][data-richtung=ein][data-knoten=n4][data-port=profile]');
    const ziel = /** @type {any} */ (await n4ein.boundingBox());
    // Clicking the connected input port releases its wire.
    await n4ein.click();
    await expect(kanten).toHaveCount(3);
    await expect(page.locator('[data-testid=knoten][data-id=n4] [data-testid=knoten-fehler]')).toContainText("Profile fehlen");
    await expect(ergebnis).toHaveAttribute("data-anzahl", "0");

    // Reconnect by dragging from grid.profile (output) to extrude.profile (input).
    const quelle = /** @type {any} */ (await page.locator('[data-testid=knoten-port][data-richtung=aus][data-knoten=n2][data-port=profile]').boundingBox());
    await page.mouse.move(quelle.x + quelle.width / 2, quelle.y + quelle.height / 2);
    await page.mouse.down();
    await page.mouse.move(ziel.x + ziel.width / 2, ziel.y + ziel.height / 2, { steps: 8 });
    await page.mouse.up();
    await expect(kanten).toHaveCount(4);
    await expect(ergebnis).toHaveAttribute("data-anzahl", "8");

    // Bake into the model.
    await page.getByTestId("knoten-backen").click();
    await expect(page.getByTestId("mm-koerper")).toHaveCount(8);
    await expect.poll(async () => {
      const m = (await (await request.get(`/api/entities/BimModel?project_id=${id}`)).json())[0];
      return `${m?.massing_layer?.koerper?.length}|${m?.massing_layer?.parametrik?.knoten?.length}`;
    }, { timeout: 20000 }).toBe("8|4");
    expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
  } finally {
    if (id) {
      const ms = await (await request.get(`/api/entities/BimModel?project_id=${id}`)).json();
      for (const m of Array.isArray(ms) ? ms : []) await request.delete(`/api/entities/BimModel/${m.id}`);
      await request.delete(`/api/entities/Project/${id}`);
    }
  }
});

// 98-06: sandbox — raise the terrain twice, stamp a drawn body flat (cut volume reported), saved.
test("98-06 Sandbox: Gelände formen und Körper stempeln", async ({ page, request }) => {
  test.setTimeout(180000);
  const NAME3 = "E2E Sandbox 9806";
  let id = null;
  try {
    await nurLocalhost(page);
    const warnungen = [];
    page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text()) && !/WebGL|GPU stall/i.test(m.text())) warnungen.push(m.text()); });
    page.on("pageerror", (e) => { if (!/WebGL|THREE|getUniforms/i.test(String(e.stack || e))) warnungen.push(`pageerror ${e}`); });
    id = (await (await request.post("/api/entities/Project", { data: { name: NAME3, build_kind: "neubau", status: "concept" } })).json()).id;
    await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME3)}&tab=studio`);
    await page.getByTestId("mm-linie").click({ timeout: 60000 });
    const flaeche = page.getByTestId("mm-flaeche");
    await flaeche.scrollIntoViewIfNeeded();
    const at = async (fx, fy) => { await flaeche.scrollIntoViewIfNeeded(); const b = /** @type {any} */ (await flaeche.boundingBox()); return { x: b.x + b.width * fx, y: b.y + b.height * fy }; };
    for (const [fx, fy] of [[0.3, 0.55], [0.4, 0.55], [0.4, 0.68], [0.3, 0.68], [0.3, 0.55]]) { const p = await at(fx, fy); await page.mouse.move(p.x, p.y); await page.mouse.click(p.x, p.y); }
    await expect(page.getByTestId("mm-koerper")).toHaveCount(1);

    await page.keyboard.press("g");
    await expect(page.getByTestId("mm-leiste")).toHaveAttribute("data-werkzeug", "gelaende");
    for (let i = 0; i < 2; i++) { const p = await at(0.35, 0.6); await page.mouse.click(p.x, p.y); }
    await expect.poll(async () => Number(await page.getByTestId("mm-gelaende-zellen").getAttribute("data-anzahl"))).toBeGreaterThan(20);

    await page.getByTestId("mm-gelaende-modus").selectOption("stempeln");
    const p = await at(0.35, 0.6);
    await page.mouse.click(p.x, p.y);
    await expect(page.getByTestId("mm-meldung")).toContainText("Gestempelt: Abtrag");
    await expect.poll(async () => {
      const m = (await (await request.get(`/api/entities/BimModel?project_id=${id}`)).json())[0];
      const g = m?.massing_layer?.gelaende;
      return g ? g.h.length === g.nx * g.ny && g.h.some((h) => h > 0) : false;
    }, { timeout: 20000 }).toBe(true);
    expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
  } finally {
    if (id) {
      const ms = await (await request.get(`/api/entities/BimModel?project_id=${id}`)).json();
      for (const m of Array.isArray(ms) ? ms : []) await request.delete(`/api/entities/BimModel/${m.id}`);
      await request.delete(`/api/entities/Project/${id}`);
    }
  }
});

// 98-09: residential bar along an L path (user video) — double-loaded, coloured unit mix, the unit
// count scales with the storeys, the mix preset changes the types, saved in massing_layer.riegel.
test("98-09 Riegel entlang Pfad mit Wohnungsmix", async ({ page, request }) => {
  test.setTimeout(180000);
  const NAME4 = "E2E Riegel 9809";
  let id = null;
  try {
    await nurLocalhost(page);
    const warnungen = [];
    page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text()) && !/WebGL|GPU stall/i.test(m.text())) warnungen.push(m.text()); });
    page.on("pageerror", (e) => { if (!/WebGL|THREE|getUniforms/i.test(String(e.stack || e))) warnungen.push(`pageerror ${e}`); });
    // Leftovers of an aborted run (same name) would be picked by ?projekt= — remove them first.
    for (const alt of await (await request.get(`/api/entities/Project?name=${encodeURIComponent(NAME4)}`)).json()) {
      for (const m of await (await request.get(`/api/entities/BimModel?project_id=${alt.id}`)).json()) await request.delete(`/api/entities/BimModel/${m.id}`);
      await request.delete(`/api/entities/Project/${alt.id}`);
    }
    id = (await (await request.post("/api/entities/Project", { data: { name: NAME4, build_kind: "neubau", status: "concept" } })).json()).id;
    await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME4)}&tab=studio`);
    await page.getByTestId("mm-riegel").click({ timeout: 60000 });
    const flaeche = page.getByTestId("mm-flaeche");
    const at = async (fx, fy) => { await flaeche.scrollIntoViewIfNeeded(); const b = /** @type {any} */ (await flaeche.boundingBox()); return { x: b.x + b.width * fx, y: b.y + b.height * fy }; };
    for (const [fx, fy] of [[0.15, 0.3], [0.7, 0.3], [0.7, 0.85]]) { const p = await at(fx, fy); await page.mouse.move(p.x, p.y); await page.mouse.click(p.x, p.y); }
    await page.keyboard.press("Enter");
    const plan = page.getByTestId("mm-riegel-plan");
    await expect(plan).toHaveCount(1);
    const w5 = Number(await plan.getAttribute("data-wohnungen"));
    expect(w5).toBeGreaterThan(20);
    expect(w5 % 5).toBe(0);
    await expect(plan.locator('[data-typ="Ecke"]')).toHaveCount(2);
    await page.getByTestId("mm-riegel-geschosse").fill("8");
    await expect(plan).toHaveAttribute("data-wohnungen", String((w5 / 5) * 8));
    const vorher = await plan.locator("[data-typ='4-Zi']").count();
    await page.getByTestId("mm-riegel-mix").selectOption("familie");
    await expect.poll(async () => plan.locator("[data-typ='4-Zi']").count()).toBeGreaterThan(vorher);
    if (process.env.RIEGEL_BILD) {
      await page.locator("svg").filter({ has: plan }).first().screenshot({ path: process.env.RIEGEL_BILD });
      const t0 = Date.now();
      await page.locator('[data-ansicht="3d"]').click();
      await page.locator("canvas").first().waitFor({ timeout: 20000 });
      await page.waitForTimeout(1500);
      console.log(`[98-09] 3D nach ${Date.now() - t0} ms`);
      await page.locator("canvas").first().screenshot({ path: process.env.RIEGEL_BILD.replace(".png", "-3d.png"), timeout: 20000 });
      await page.locator('[data-ansicht="2d"]').click();
    }
    await expect.poll(async () => {
      const m = (await (await request.get(`/api/entities/BimModel?project_id=${id}`)).json())[0];
      const r = m?.massing_layer?.riegel?.[0];
      return r ? `${r.pfad.length}|${r.opt.geschosse}|${r.opt.mix}` : null;
    }, { timeout: 20000 }).toBe("3|8|familie");
    expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
  } finally {
    if (id) {
      const ms = await (await request.get(`/api/entities/BimModel?project_id=${id}`)).json();
      for (const m of Array.isArray(ms) ? ms : []) await request.delete(`/api/entities/BimModel/${m.id}`);
      await request.delete(`/api/entities/Project/${id}`);
    }
  }
});
