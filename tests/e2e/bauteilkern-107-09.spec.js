// Headless proof of 107-09 (priority-based connections) in a real browser (dev server), own project, cleaned up in finally:
// two walls with a project build-up (insulation 100 mm, priority 320 as proposal; concrete 200 mm, core 850) form the corner of 107-14
// (A x 0 … 4, B from z = −0.15 on A's outer face); A has a window 1.0 × 1.2 m (sill 0.9 m).
// (1) Switch off (default, field missing): plan as before (two layer strips per wall, no "intersected" mark), the 3D body of wall A
//     ends at x = 4.0, B starts at z = −0.15; NO module of the intersection, of the CSG core or of the libraries is requested.
// (2) Switch on: the module and the library chunk are loaded (counter test to the E2E of 107-14); plan and 3D come from the solid
//     (data-verschneidung "solid"); A's core runs through to B's outer face (3D up to x = 4.15), B abuts with its core (3D from
//     z = 0.05); at the cut height 1.1 m the plan shows the gap of the window (two rings per layer of A); data sheet: volume of A from
//     the 3D solid = 3.0625 − 0.36 = 2.7025 m³, split per layer (review 107-09: core 2.075 − 0.24 = 1.835, insulation 0.9875 − 0.12 =
//     0.8675 m³), intersection group default 1; the field `verschneidung: true` is stored. Console clean.
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";

const NAME = "E2E Bauteilkern 10709";
const MODUL_ANFRAGE = /manifold-3d|manifold[^/]*\.wasm|\/lib\/csg\/|\/csg-[A-Za-z0-9_-]+\.js|solidAbleitung|bauteil\/verschneidung/;
const BIBLIOTHEK = /manifold-3d/; // 107-18: the CSG library (JS part; its WebAssembly binary follows)

/** @param {any} page */
function wache(page) {
  /** @type {string[]} */
  const warnungen = [];
  page.on("console", (/** @type {any} */ m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text()) && !/GPU stall|WebGL|wasm/i.test(m.text())) warnungen.push(m.text()); });
  page.on("pageerror", (/** @type {any} */ e) => { if (!/Error creating WebGL context|getUniforms/i.test(String(e.stack || e))) warnungen.push(`pageerror ${e}`); });
  return warnungen;
}
const befehl = (/** @type {any} */ page, /** @type {string} */ id, params = {}) => page.evaluate(
  ([i, p]) => JSON.parse(/** @type {any} */ (window).__bitBefehle.zeileBearbeiten(JSON.stringify({ id: i, method: "ausfuehren", params: { befehl: i, params: p } }))),
  [id, params],
);
const waende3d = (/** @type {any} */ page) => page.evaluate(() => /** @type {any} */ (window).__bitZeigen.bimAenderung.waende3d());

/** @param {any} request @param {string} name */
async function altWeg(request, name) {
  for (const alt of await (await request.get(`/api/entities/Project?name=${encodeURIComponent(name)}`)).json()) {
    for (const m of await (await request.get(`/api/entities/BimModel?project_id=${alt.id}`)).json()) await request.delete(`/api/entities/BimModel/${m.id}`);
    await request.delete(`/api/entities/Project/${alt.id}`);
  }
}

test("107-09 Verschneidung: Standard aus = alter Plan ohne Nachladen; ein = Kern läuft durch, Dämmung stößt an, Solid aus dem CSG-Kern", async ({ page, request }) => {
  test.setTimeout(240000);
  await page.setViewportSize({ width: 1500, height: 1000 });
  await altWeg(request, NAME);
  const id = (await (await request.post("/api/entities/Project", { data: { name: NAME, build_kind: "neubau", status: "concept" } })).json()).id;
  await request.post("/api/entities/BimModel", { data: {
    project_id: id, storeys: 1, storeyHeight: 3,
    aufbauten_layer: { v: 1, aufbauten: { "p-1": { name: "Dämmung + Beton (E2E)", skins: [
      { name: "Dämmung", material: "mw035", thickness: 100 }, { name: "Beton", material: "beton", thickness: 200, funktion: "kern" }] } } },
    customWalls: [
      { a: { x: 0, z: 0 }, b: { x: 4, z: 0 }, composite: "p-1", height: 2.5, level: 0, _idx: 1 },
      { a: { x: 4, z: -0.15 }, b: { x: 4, z: 3.85 }, composite: "p-1", height: 2.5, level: 0, _idx: 2 },
    ],
    customWindows: [{ wallIdx: 1, u: 2, kind: "window", typeId: "single", width: 1, height: 1.2, sill: 0.9, _idx: 3 }],
  } });
  /** @type {string[]} */
  const anfragen = [];
  try {
    await nurLocalhost(page);
    const warnungen = wache(page);
    page.on("request", (/** @type {any} */ r) => anfragen.push(r.url()));
    await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME)}&tab=bim`);
    await page.waitForFunction(() => !!(/** @type {any} */ (window).__bitBefehle), null, { timeout: 60000 });
    await expect(page.locator("canvas:visible").first()).toBeVisible({ timeout: 60000 });

    // ---- (1) switch off (default): today's plan and 3D, nothing loaded ----
    // the switch sits in the navigator ("Mappe") next to the cut height of the plan
    await page.getByRole("button", { name: "Mappe ein-/ausblenden" }).click();
    const schalter = page.getByTestId("verschneidung-schalter");
    await expect(schalter).not.toBeChecked();
    await page.getByRole("button", { name: "Ansicht 3D" }).click();
    await expect.poll(async () => (await waende3d(page))[1]?.max?.[0] ?? null, { timeout: 20000 }).not.toBeNull();
    const vorher = await waende3d(page);
    expect(Math.abs(vorher[1].max[0] - 4.0)).toBeLessThan(0.005);
    expect(Math.abs(vorher[2].min[2] - -0.15)).toBeLessThan(0.005);
    await page.getByRole("button", { name: "Ansicht Grundriss" }).click();
    const wandA = page.locator('[data-bim-plan2d] [data-wand="1"]');
    await expect(wandA).toBeVisible({ timeout: 20000 });
    await expect(wandA).not.toHaveAttribute("data-verschneidung", /.+/);
    await expect(wandA.locator("path:not([data-schraffur-material])")).toHaveCount(2);
    expect(anfragen.filter((u) => MODUL_ANFRAGE.test(u)), "ohne Schalter weder Verschneidung noch CSG geladen").toEqual([]);

    // ---- (2) switch on: module and library chunk loaded, plan and 3D from the solid ----
    await schalter.check();
    await expect(wandA).toHaveAttribute("data-verschneidung", "solid", { timeout: 60000 });
    await expect(page.locator('[data-bim-plan2d] [data-wand="2"]')).toHaveAttribute("data-verschneidung", "solid");
    expect(anfragen.some((u) => BIBLIOTHEK.test(u)), "Bibliothek erst mit dem Schalter nachgeladen").toBe(true);
    // the cut at 1.1 m crosses the window (0.9 … 2.1 m): each layer of A in two rings (one "M" per ring)
    for (const s of ["0", "1"]) {
      const d = await wandA.locator(`path[data-schicht="${s}"]`).first().getAttribute("d");
      expect((d || "").split("M").length - 1, `Schicht ${s} von A`).toBe(2);
    }
    // 3D: A's core runs through to B's far face (x = 4.15), B abuts with its core (z = 0.05)
    await page.getByRole("button", { name: "Ansicht 3D" }).click();
    await expect.poll(async () => Math.round(((await waende3d(page))[1]?.max?.[0] ?? 0) * 1000) / 1000, { timeout: 20000 }).toBe(4.15);
    const nachher = await waende3d(page);
    expect(Math.abs(nachher[2].min[2] - 0.05)).toBeLessThan(0.005);
    // data sheet of A: quantity from the solid, group default 1
    const guid = (await befehl(page, "modell")).result.bauteile.find((/** @type {any} */ b) => b.klasse === "IfcWall" && b.name !== "Außenwand").guid;
    expect((await befehl(page, "auswahl-guid", { guid })).ok).toBe(true);
    const menge = page.getByTestId("sb-verschneidung-menge");
    await expect(menge).toHaveAttribute("data-quelle", "solid", { timeout: 20000 });
    const wert = Number(((await menge.textContent()) || "").split(" m³")[0].replace(/\./g, "").replace(",", "."));
    expect(Math.abs(wert - 2.7025)).toBeLessThanOrEqual(0.0015); // 3.0625 − 1.0 · 1.2 · 0.3, shown with 3 decimals
    // review 107-09: the volume per layer reaches the data sheet (plan task 5), same source as the total
    const schichten = page.getByTestId("sb-verschneidung-schicht");
    await expect(schichten).toHaveCount(2);
    const jeSchicht = (await schichten.allTextContents()).map((t) => Number(t.split(" m³")[0].replace(/\./g, "").replace(",", ".")));
    expect(Math.abs(jeSchicht[0] - 0.8675)).toBeLessThanOrEqual(0.0015); // insulation 0.395 · 2.5 − 1.0 · 1.2 · 0.1
    expect(Math.abs(jeSchicht[1] - 1.835)).toBeLessThanOrEqual(0.0015); // core 0.83 · 2.5 − 1.0 · 1.2 · 0.2
    await expect(page.getByTestId("sb-gruppe")).toHaveAttribute("data-herkunft", "offen");
    await expect(page.getByTestId("sb-gruppe")).toHaveAttribute("placeholder", "1");
    // the switch is stored as the element field `verschneidung`
    await expect.poll(async () => (await (await request.get(`/api/entities/BimModel?project_id=${id}`)).json())[0]?.verschneidung, { timeout: 20000 }).toBe(true);
    expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
  } finally {
    await altWeg(request, NAME);
  }
});
