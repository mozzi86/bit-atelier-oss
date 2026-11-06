// Headless proof of 107-12 (view state) in a real browser (dev server), own project, cleaned up in finally:
// a drawn wall with a project build-up (insulation 100 mm + concrete 200 mm, core) and a thin plain wall (0.10 m, not load-bearing).
// (1) Floor plan, structure display "Nur Kern": the layered wall shows only its core strip, the plain wall stays (one layer = core).
// (2) The view is saved as "Schalplan" (structure "nur-kern-tragend"): the thin wall disappears; the record holds the view in
//     ansicht_layer with parameters only (no geometry key, under 8 KB).
// (3) Undo (bimHistorie) removes a second saved view again; redo brings it back.
// (4) Reload: the view survives, applying it restores the structure display; "PDF" at the view exports from it (download, %PDF,
//     the hint names the sheet) and the output line names the view. Console clean.
// Review 107-12 (second test): "PDF" at a section view while the plan storey differs and at an own-combination view while another
//     combination is set — both export (file name, title block) and the own view brings its layers back.
import { Buffer } from "node:buffer";
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";

const NAME = "E2E Bauteilkern 10712";
const GEOMETRIE = ["positionen", "indizes", "mesh", "geometrie", "dreiecke", "polygone", "ringe", "baender", "points", "punkte"];

/** @param {any} page */
function wache(page) {
  /** @type {string[]} */
  const warnungen = [];
  page.on("console", (/** @type {any} */ m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text()) && !/GPU stall|WebGL|wasm/i.test(m.text())) warnungen.push(m.text()); });
  page.on("pageerror", (/** @type {any} */ e) => { if (!/Error creating WebGL context|getUniforms/i.test(String(e.stack || e))) warnungen.push(`pageerror ${e}`); });
  return warnungen;
}

/** @param {any} request @param {string} name */
async function altWeg(request, name) {
  for (const alt of await (await request.get(`/api/entities/Project?name=${encodeURIComponent(name)}`)).json()) {
    for (const m of await (await request.get(`/api/entities/BimModel?project_id=${alt.id}`)).json()) await request.delete(`/api/entities/BimModel/${m.id}`);
    await request.delete(`/api/entities/Project/${alt.id}`);
  }
}

/** Band paths of a drawn wall in the plan (layer strips; hatch overlays and hidden hit areas do not count). */
const baender = (/** @type {any} */ wand) => wand.locator("path:not([data-schraffur-material]):not([data-struktur-verborgen])");

/** @param {any} page */
async function grundrissMitMappe(page) {
  await page.waitForFunction(() => !!(/** @type {any} */ (window).__bitBefehle), null, { timeout: 60000 });
  await expect(page.locator("canvas:visible").first()).toBeVisible({ timeout: 60000 });
  await page.getByRole("button", { name: "Mappe ein-/ausblenden" }).click();
  await page.getByRole("button", { name: "Ansicht Grundriss" }).click();
}

test("107-12 Ansichtszustand: Ausschnitt „Schalplan“ speichern, neu laden, anwenden, PDF aus dem Ausschnitt, nur Kern sichtbar", async ({ page, request }) => {
  test.setTimeout(240000);
  await page.setViewportSize({ width: 1500, height: 1000 });
  await altWeg(request, NAME);
  const id = (await (await request.post("/api/entities/Project", { data: { name: NAME, build_kind: "neubau", status: "concept" } })).json()).id;
  await request.post("/api/entities/BimModel", { data: {
    project_id: id, storeys: 1, storeyHeight: 3,
    aufbauten_layer: { v: 1, aufbauten: { "p-1": { name: "Dämmung + Beton (E2E)", skins: [
      { name: "Dämmung", material: "mw035", thickness: 100, funktion: "sonstig" }, { name: "Beton", material: "beton", thickness: 200, funktion: "kern" }] } } },
    customWalls: [
      { a: { x: 0, z: 0 }, b: { x: 4, z: 0 }, composite: "p-1", height: 2.5, level: 0, _idx: 1 },
      { a: { x: 0, z: 2 }, b: { x: 4, z: 2 }, thickness: 0.1, height: 2.5, level: 0, _idx: 2 },
    ],
  } });
  try {
    await nurLocalhost(page);
    const warnungen = wache(page);
    await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME)}&tab=bim`);
    await grundrissMitMappe(page);
    const wandA = page.locator('[data-bim-plan2d] [data-wand="1"]');
    const wandB = page.locator('[data-bim-plan2d] [data-wand="2"]');
    await expect(wandA).toBeVisible({ timeout: 20000 });
    await expect(baender(wandA)).toHaveCount(2); // whole build-up: insulation + concrete

    // ---- (1) structure display "Nur Kern": only the core strip; the plain wall stays ----
    const struktur = page.getByTestId("ansicht-struktur");
    await expect(struktur).toBeVisible({ timeout: 20000 }); // lazy block of the navigator
    await struktur.selectOption("nur-kern");
    await expect(baender(wandA)).toHaveCount(1);
    await expect(wandB).not.toHaveAttribute("data-struktur-verborgen", "1");

    // ---- (2) "nur Kern der tragenden Bauteile" saved as "Schalplan" ----
    await struktur.selectOption("nur-kern-tragend");
    await expect(wandB).toHaveAttribute("data-struktur-verborgen", "1");
    await expect(baender(wandA)).toHaveCount(1);
    await page.getByTestId("ausschnitt-name").fill("Schalplan");
    await page.getByTestId("ausschnitt-speichern").click();
    const zeile = page.getByTestId("ausschnitt").filter({ hasText: "Schalplan" });
    await expect(zeile).toHaveAttribute("data-aktiv", "1");
    /** @returns {Promise<any>} */
    const gespeichert = async () => (await (await request.get(`/api/entities/BimModel?project_id=${id}`)).json())[0]?.ansicht_layer;
    await expect.poll(async () => (await gespeichert())?.ausschnitte?.length ?? 0, { timeout: 20000 }).toBe(1);
    const layer = await gespeichert();
    const a = layer.ausschnitte[0];
    expect(a).toMatchObject({ name: "Schalplan", type: "grundriss", level: 0, strukturdarstellung: "nur-kern-tragend", brille: "eingabe" });
    expect(layer.v).toBe(1);
    const text = JSON.stringify(layer);
    for (const g of GEOMETRIE) expect(text.includes(`"${g}"`), `kein Geometrie-Feld ${g} im ansicht_layer`).toBe(false);
    expect(new TextEncoder().encode(JSON.stringify(a)).length).toBeLessThan(8192);

    // ---- (3) undo / redo of a saved view (drawing undo, bimHistorie) ----
    await struktur.selectOption("gesamt");
    await page.getByTestId("ausschnitt-name").fill("Zweiter");
    await page.getByTestId("ausschnitt-speichern").click();
    await expect(page.getByTestId("ausschnitt")).toHaveCount(2);
    await page.getByTestId("bim-undo").click();
    await expect(page.getByTestId("ausschnitt")).toHaveCount(1);
    await page.getByTestId("bim-redo").click();
    await expect(page.getByTestId("ausschnitt")).toHaveCount(2);
    await page.getByTestId("bim-undo").click();
    await expect(page.getByTestId("ausschnitt")).toHaveCount(1);
    await expect.poll(async () => (await gespeichert())?.ausschnitte?.length ?? 0, { timeout: 20000 }).toBe(1);

    // ---- (4) reload: the view survives; apply it; PDF from the view ----
    await page.reload();
    await grundrissMitMappe(page);
    await expect(baender(wandA)).toHaveCount(2, { timeout: 20000 }); // after the reload the state starts with the whole build-up
    const zeile2 = page.getByTestId("ausschnitt").filter({ hasText: "Schalplan" });
    await expect(zeile2).toBeVisible({ timeout: 20000 });
    await zeile2.getByTestId("ausschnitt-anwenden").click();
    await expect(zeile2).toHaveAttribute("data-aktiv", "1");
    await expect(page.getByTestId("ansicht-struktur")).toHaveValue("nur-kern-tragend");
    await expect(baender(wandA)).toHaveCount(1);
    await expect(wandB).toHaveAttribute("data-struktur-verborgen", "1");
    await expect(page.getByTestId("ausgabe-ausschnitt")).toContainText("Schalplan");
    const [download] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), zeile2.getByTestId("ausschnitt-pdf").click()]);
    expect(download.suggestedFilename()).toMatch(/Grundriss.*_1-100\.pdf$/);
    const pfad = await download.path();
    const fs = await import("node:fs");
    expect(fs.readFileSync(/** @type {string} */ (pfad)).subarray(0, 5).toString("latin1")).toBe("%PDF-");
    await expect(page.getByText(/PDF 1:100 \(A\d\) erstellt/)).toBeVisible({ timeout: 20000 });
    // review 107-12: the sheet came from the saved view (its parameters applied), not from the default state
    await expect(page.getByText(/Ohne gespeicherten Ausschnitt/)).toHaveCount(0);
    expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
  } finally {
    await altWeg(request, NAME);
  }
});

/**
 * Text of all deflated content streams of a PDF (latin1) — the title block is written as hex strings by pdf-lib.
 * @param {Buffer} b
 */
async function pdfText(b) {
  const zlib = await import("node:zlib");
  const t = b.toString("latin1");
  let out = "";
  const re = /stream\r?\n/g;
  let m;
  while ((m = re.exec(t))) {
    const s = m.index + m[0].length, e = t.indexOf("endstream", s);
    try { out += zlib.inflateSync(b.subarray(s, e)).toString("latin1"); } catch { out += t.slice(s, e); }
  }
  return out;
}
const hex = (/** @type {string} */ s) => Buffer.from(s, "latin1").toString("hex").toUpperCase();

// Review 107-12: "PDF" at a saved SECTION view while the plan storey differs, and at a view of an OWN layer combination ("Eigene")
// while another combination is set — both exported nothing before (the view never became active, the wish stayed pending).
test("107-12 Review: PDF am Schnitt-Ausschnitt bei anderem Geschoss und am Ausschnitt mit eigener Ebenen-Kombination", async ({ page, request }) => {
  test.setTimeout(240000);
  const NAME2 = "E2E Bauteilkern 10712 Review";
  await page.setViewportSize({ width: 1500, height: 1000 });
  await altWeg(request, NAME2);
  const id = (await (await request.post("/api/entities/Project", { data: { name: NAME2, build_kind: "neubau", status: "concept" } })).json()).id;
  await request.post("/api/entities/BimModel", { data: {
    project_id: id, storeys: 2, storeyHeight: 3,
    customWalls: [{ a: { x: 0, z: 2 }, b: { x: 4, z: 2 }, thickness: 0.1, height: 2.5, level: 0, _idx: 2 }],
  } });
  try {
    await nurLocalhost(page);
    const warnungen = wache(page);
    await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME2)}&tab=bim`);
    await grundrissMitMappe(page);
    const fs = await import("node:fs");
    /** @returns {Promise<any>} */
    const gespeichert = async () => (await (await request.get(`/api/entities/BimModel?project_id=${id}`)).json())[0]?.ansicht_layer;
    const kombination = page.getByLabel("Layer-Kombination");

    // ---- (1) own combination: dimensions hidden, saved with its layers ----
    await page.getByRole("button", { name: "Sichtbarkeit Bemaßung" }).click();
    await expect(kombination).toHaveValue("Eigene");
    await page.getByTestId("ausschnitt-name").fill("Ohne Maße");
    await page.getByTestId("ausschnitt-speichern").click();
    await expect.poll(async () => (await gespeichert())?.ausschnitte?.length ?? 0, { timeout: 20000 }).toBe(1);
    const eigen = (await gespeichert()).ausschnitte[0];
    expect(eigen.combo).toBe("Eigene");
    expect(eigen.ebenen_sichtbar).toContain("walls");
    expect(eigen.ebenen_sichtbar).not.toContain("dimensions");

    // ---- (2) section view saved on storey 0 ----
    await page.getByRole("button", { name: "Ansicht Schnitt" }).click();
    await page.getByTestId("ausschnitt-name").fill("Schnitt A");
    await page.getByTestId("ausschnitt-speichern").click();
    await expect(page.getByTestId("ausschnitt")).toHaveCount(2);

    // ---- (3) the state moves away: plan storey 1, a named combination ----
    await page.getByRole("button", { name: "Ansicht Grundriss" }).click();
    await page.getByLabel("Geschoss wählen").selectOption("1");
    await kombination.selectOption("Alle zeigen");
    await expect(page.getByTestId("ausschnitt").filter({ hasText: "Schnitt A" })).not.toHaveAttribute("data-aktiv", "1");

    // ---- (4) "PDF" at the section view: applied, exported as a section ----
    const schnittZeile = page.getByTestId("ausschnitt").filter({ hasText: "Schnitt A" });
    const [d1] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), schnittZeile.getByTestId("ausschnitt-pdf").click()]);
    expect(d1.suggestedFilename()).toMatch(/_Schnitt_A-A_1-100\.pdf$/); // 108-01: the stamp names the section axis (flat roof: A-A)
    const b1 = fs.readFileSync(/** @type {string} */ (await d1.path()));
    expect(b1.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect((await pdfText(b1)).includes(hex("Schnitt")), "Plankopf nennt den Schnitt").toBe(true);
    await expect(schnittZeile).toHaveAttribute("data-aktiv", "1");

    // ---- (5) "PDF" at the own-combination view: its layers come back, exported as the ground-floor plan ----
    const eigenZeile = page.getByTestId("ausschnitt").filter({ hasText: "Ohne Maße" });
    const [d2] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), eigenZeile.getByTestId("ausschnitt-pdf").click()]);
    expect(d2.suggestedFilename()).toMatch(/Grundriss.*_1-100\.pdf$/);
    await expect(eigenZeile).toHaveAttribute("data-aktiv", "1");
    await expect(kombination).toHaveValue("Eigene");
    await expect(page.getByRole("button", { name: "Sichtbarkeit Bemaßung" })).toHaveAttribute("title", "Ausgeblendet");
    await expect(page.getByRole("button", { name: "Sichtbarkeit Wände" })).toHaveAttribute("title", "Sichtbar");
    expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
  } finally {
    await altWeg(request, NAME2);
  }
});
