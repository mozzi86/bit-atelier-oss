// Headless proof 106-01: ONE pick core (strahlPick) behind click and hover in the IFC viewer and in
// the BIM studio. The pointer over an element shows it in words (overlay "zeigen-hover") and as the
// 'fokus' highlight (dotted outline + colour); a click still selects and the selection stays drawn
// (blue, solid outline); the hover never paints over the selected element and the overlay then says
// "Ausgewählt"; leaving the canvas removes hover and highlight. A miss shows nothing. A section plane
// that cuts everything away also removes the hover. The four pointing states carry form, not only
// colour: in the IFC viewer warnung (dashed) and fehler (solid + "!" symbol) are set by GUID and read
// back from the real scene graph. Hover state is read through window.__bitZeigen.ifc / .bim, the
// selection through the panel and the scene graph — never through an image.
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";

/**
 * Console watch. Only the known headless WebGL messages are tolerated (software GL warnings, the
 * wasm notice); everything else, including any three.js error thrown by the new hover code, fails.
 */
function wache(page) {
  const warnungen = [];
  page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text()) && !/GPU stall|WebGL|wasm/i.test(m.text())) warnungen.push(m.text()); });
  page.on("pageerror", (e) => { if (!/Error creating WebGL context|getUniforms/i.test(String(e.stack || e))) warnungen.push(`pageerror ${e}`); });
  return warnungen;
}

/** Calls window.__bitZeigen[viewer][fn](...args) in the page. */
const zeigen = (page, viewer, fn, ...args) => page.evaluate(([v, f, a]) => /** @type {any} */ (window).__bitZeigen[v][f](...a), [viewer, fn, args]);

/**
 * Move the mouse over a grid inside the canvas until the viewer reports something under the pointer.
 * @param {import("@playwright/test").Page} page
 * @param {import("@playwright/test").Locator} canvas
 * @param {string} viewer  "ifc" | "bim"
 * @param {(hover: any) => boolean} [passt]  Accept only a matching hover (default: any).
 * @returns {Promise<{x: number, y: number, hover: any}>}
 */
async function hoverSuchen(page, canvas, viewer, passt = () => true) {
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas hat keine Groesse");
  for (let zeile = 0; zeile < 9; zeile += 1) {
    for (let spalte = 0; spalte < 13; spalte += 1) {
      const x = box.x + box.width * (0.15 + (0.7 * spalte) / 12);
      const y = box.y + box.height * (0.15 + (0.7 * zeile) / 8);
      await page.mouse.move(x, y);
      // one pick per animation frame: give the next frame time to run
      await page.waitForTimeout(70);
      const hover = await zeigen(page, viewer, "hover");
      if (hover && passt(hover)) return { x, y, hover };
    }
  }
  throw new Error("Kein passendes Bauteil unter dem Zeiger gefunden (Gitter 13 x 9 ueber der Zeichenflaeche)");
}

/** Types of all elements the pointer finds on a grid over the canvas (the viewer reports what is hoverable). */
async function hoverTypen(page, canvas, viewer) {
  const box = await canvas.boundingBox();
  const typen = new Set();
  for (let zeile = 0; zeile < 9; zeile += 1) {
    for (let spalte = 0; spalte < 13; spalte += 1) {
      await page.mouse.move(box.x + box.width * (0.15 + (0.7 * spalte) / 12), box.y + box.height * (0.15 + (0.7 * zeile) / 8));
      await page.waitForTimeout(60);
      const hover = await zeigen(page, viewer, "hover");
      if (hover) typen.add(hover.typ);
    }
  }
  return [...typen];
}

/** The state table is the same in both viewers: colour AND form. */
async function zustaendeMitForm(page, viewer) {
  const z = await zeigen(page, viewer, "zustaende");
  expect(Object.keys(z).sort()).toEqual(["auswahl", "fehler", "fokus", "warnung"]);
  expect(z.warnung.umriss).toBe("gestrichelt");
  expect(z.warnung.strich).toBeTruthy();
  expect(z.fehler.symbol).toBe("!");
  expect(z.fokus.umriss).toBe("gepunktet");
  expect(z.auswahl.umriss).toBe("durchgezogen");
  // no two states share colour AND form
  const schluessel = Object.values(z).map((s) => `${s.hex}|${s.umriss}|${s.symbol ?? ""}`);
  expect(new Set(schluessel).size).toBe(4);
}

/** Pointer in a corner of the canvas: nothing is under it (sky / ground), so the hover shows nothing. */
async function ins_leere(page, canvas, viewer) {
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + 4, box.y + 4);
  await page.waitForTimeout(150);
  await page.mouse.move(box.x + 7, box.y + 6);
  await page.waitForTimeout(150);
  expect(await zeigen(page, viewer, "hover"), "ein Fehltreffer zeigt nichts an").toBeNull();
  expect(await zeigen(page, viewer, "markiert")).toBe(0);
  await expect(page.getByTestId("zeigen-hover")).toBeHidden();
}

test.describe("106-01 Zeigen: Strahl-Pick, Hover und Hervorheben", () => {
  test.setTimeout(300000);

  test("IFC-Viewer: Hover in Worten, Auswahl bleibt sichtbar, Schnittebene, Zustaende mit Form", async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 1000 });
    await nurLocalhost(page);
    const warnungen = wache(page);

    await page.goto("/IfcViewer?beispiel=1");
    await expect(page.getByTestId("status-sichtbarkeit")).toBeVisible({ timeout: 180000 });
    await page.waitForFunction(() => !!(/** @type {any} */ (window).__bitZeigen?.ifc), null, { timeout: 30000 });
    const canvas = page.locator("canvas:visible").first();
    const overlay = page.getByTestId("zeigen-hover");

    await zustaendeMitForm(page, "ifc");

    // --- Hover: the element in words, GUID from the ray, drawn as 'fokus' (dotted outline) ---
    const { x, y, hover } = await hoverSuchen(page, canvas, "ifc");
    expect(hover.quelle).toBe("ifc");
    expect(hover.guid).toMatch(/^[0-9A-Za-z_$]{22}$/); // ground truth: the GlobalId of the ray hit
    expect(hover.zustand).toBe("fokus");
    await expect(overlay).toBeVisible();
    await expect(page.getByTestId("zeigen-hover-text")).toContainText(hover.typ);
    await expect(overlay).toContainText("Unter dem Zeiger");
    expect(await zeigen(page, "ifc", "markiert", "fokus")).toBeGreaterThan(0);
    const formenFokus = await zeigen(page, "ifc", "formen");
    expect(formenFokus.every((f) => f.zustand === "fokus" && f.umriss === "LineDashedMaterial")).toBe(true); // dotted = dashed material with short dashes
    // the outline really exists in the scene graph and is cut away with the section plane (same plane objects)
    const hilfe = await zeigen(page, "ifc", "hilfsobjekte");
    expect(hilfe.length).toBeGreaterThan(0);
    expect(hilfe.every((h) => h.typ === "LineSegments" && h.zustand === "fokus" && h.geschnitten)).toBe(true);

    // --- Click selects the same element; the selection stays drawn: blue mesh + solid outline ---
    await page.mouse.click(x, y);
    await expect(page.getByTestId("ifc-auswahl-guid")).toContainText(hover.guid, { timeout: 15000 });
    const auswahl = await zeigen(page, "ifc", "auswahl");
    expect(auswahl).not.toBeNull();
    expect(auswahl.sichtbar).toBe(true);
    expect(auswahl.umriss).toEqual([{ zustand: "auswahl", material: "LineBasicMaterial" }]); // solid = LineBasicMaterial
    expect(await zeigen(page, "ifc", "markiert")).toBe(0); // the click cleared the hover

    // --- Hover over the SELECTED element: overlay says "Ausgewählt", nothing is painted over it ---
    const aufGewaehlt = await hoverSuchen(page, canvas, "ifc", (h) => h.guid === hover.guid);
    expect(aufGewaehlt.hover.zustand).toBe("auswahl");
    await expect(overlay).toContainText("Ausgewählt");
    expect(await zeigen(page, "ifc", "markiert")).toBe(0);
    expect((await zeigen(page, "ifc", "auswahl")).sichtbar).toBe(true);

    // --- Hover over ANOTHER element: fokus again, selection still drawn ---
    const anderes = await hoverSuchen(page, canvas, "ifc", (h) => h.guid !== hover.guid);
    expect(anderes.hover.zustand).toBe("fokus");
    await expect(overlay).toContainText("Unter dem Zeiger");
    expect(await zeigen(page, "ifc", "markiert", "fokus")).toBeGreaterThan(0);
    expect((await zeigen(page, "ifc", "auswahl")).umriss.length).toBe(1);

    // --- Marks by GUID: warnung dashed, fehler solid + "!" symbol, read from the real scene graph ---
    expect(await zeigen(page, "ifc", "zustandSetzen", hover.guid, "warnung")).toBe(true);
    expect(await zeigen(page, "ifc", "zustandSetzen", hover.guid, "fehler")).toBe(true);
    expect(await zeigen(page, "ifc", "zustandSetzen", "0000000000000000000000", "fehler"), "unbekannte GUID wird verweigert").toBe(false);
    const formen = await zeigen(page, "ifc", "formen");
    expect(formen.some((f) => f.zustand === "warnung" && f.umriss === "LineDashedMaterial" && !f.symbol)).toBe(true);
    expect(formen.some((f) => f.zustand === "fehler" && f.umriss === "LineBasicMaterial" && f.symbol)).toBe(true);
    const szene = await zeigen(page, "ifc", "hilfsobjekte");
    expect(szene.some((h) => h.zustand === "warnung" && h.material === "LineDashedMaterial")).toBe(true);
    expect(szene.some((h) => h.zustand === "fehler" && h.material === "LineBasicMaterial")).toBe(true);
    expect(szene.some((h) => h.typ === "Sprite"), "Fehler-Symbol (Sprite) steht im Szenengraph").toBe(true);
    await zeigen(page, "ifc", "zustandLoeschen", hover.guid, "warnung");
    await zeigen(page, "ifc", "zustandLoeschen", hover.guid, "fehler");
    expect(await zeigen(page, "ifc", "markiert", "warnung")).toBe(0);
    expect(await zeigen(page, "ifc", "markiert", "fehler")).toBe(0);
    expect((await zeigen(page, "ifc", "hilfsobjekte")).some((h) => h.typ === "Sprite")).toBe(false);

    // --- A miss shows nothing ---
    await ins_leere(page, canvas, "ifc");

    // --- Section plane: a plane that cuts everything away leaves nothing to hover (hover respects the plane) ---
    await page.locator("select:has(option[value=schraeg])").selectOption("h");
    await page.getByText(/^Lage \d+ %/).locator("xpath=following-sibling::input").fill("0");
    const beiNull = await hoverTypen(page, canvas, "ifc");
    expect(beiNull.length, "auch unten bleibt etwas hoverbar (Bodenplatten an der Schnittkante)").toBeGreaterThan(0);
    expect(beiNull.every((typ) => typ === "IfcSlab"), `bei Lage 0 % nur Platten, war: ${beiNull.join(",")}`).toBe(true);
    await page.getByText(/^Lage \d+ %/).locator("xpath=following-sibling::input").fill("100");
    expect((await hoverTypen(page, canvas, "ifc")).includes("IfcWall"), "bei Lage 100 % sind Waende wieder hoverbar").toBe(true);

    // --- Leaving the canvas removes hover, highlight and overlay ---
    await page.mouse.move(2, 2);
    await expect.poll(() => zeigen(page, "ifc", "hover")).toBeNull();
    expect(await zeigen(page, "ifc", "markiert")).toBe(0);
    await expect(overlay).toBeHidden();

    expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
  });

  test("BIM-Studio: Hover auf Wand und Huellwand, Auswahl bleibt blau, Klick waehlt wie bisher", async ({ page, request }) => {
    await page.setViewportSize({ width: 1400, height: 1000 });
    const NAME = "E2E Zeigen 10601";
    let id = null, modellId = null;
    try {
      await nurLocalhost(page);
      const warnungen = wache(page);
      id = (await (await request.post("/api/entities/Project", { data: { name: NAME, build_kind: "neubau", status: "concept" } })).json()).id;
      modellId = (await (await request.post("/api/entities/BimModel", { data: {
        project_id: id,
        // beside the default hull (about 20 m wide around the origin), so the drawn wall is not hidden behind it
        customWalls: [{ a: { x: 14, z: -16 }, b: { x: 26, z: -16 }, level: 0, height: 3, composite: "cavity", _idx: 1 }],
      } })).json()).id;

      await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME)}&tab=bim`);
      await page.waitForFunction(() => !!(/** @type {any} */ (window).__bitZeigen?.bim), null, { timeout: 60000 });
      const canvas = page.locator("canvas:visible").first();
      await expect(canvas).toBeVisible({ timeout: 60000 });
      const overlay = page.getByTestId("zeigen-hover");
      // The studio turns the model slowly until the first pointer press: a press on an empty corner
      // stops it, so a position found by hovering stays valid for the click that follows.
      await canvas.click({ position: { x: 4, y: 4 } });

      await zustaendeMitForm(page, "bim");

      // --- Hover on the drawn wall: words, GUID, 'fokus' with dotted outline in the scene graph ---
      const { x, y, hover } = await hoverSuchen(page, canvas, "bim", (h) => h.kind === "wall");
      expect(hover.quelle).toBe("bim");
      expect(hover.id).toBe(1);
      expect(hover.guid).toMatch(/^[0-9A-Za-z_$]{22}$/); // derived GUID of the drawn wall (bauteilGuid)
      expect(hover.zustand).toBe("fokus");
      await expect(overlay).toBeVisible();
      await expect(page.getByTestId("zeigen-hover-text")).toContainText(hover.typ);
      await expect(overlay).toContainText("Unter dem Zeiger");
      expect(await zeigen(page, "bim", "markiert", "fokus")).toBeGreaterThan(0);
      const hilfe = await zeigen(page, "bim", "hilfsobjekte");
      expect(hilfe.some((h) => h.zustand === "fokus" && h.material === "LineDashedMaterial")).toBe(true);

      // --- A generated hull wall is addressable too: it has the GUID the export gives it, not null ---
      const huelle = await hoverSuchen(page, canvas, "bim", (h) => h.kind === "wallShell");
      expect(huelle.hover.guid).toMatch(/^[0-9A-Za-z_$]{22}$/);
      expect(huelle.hover.guid).not.toBe(hover.guid);

      // --- Click selects as before; the selection is drawn blue with a solid aura (not teal like fokus) ---
      await page.mouse.move(x, y);
      await page.waitForTimeout(120);
      await page.mouse.click(x, y);
      await expect(page.getByText(`${hover.typ} · Attribute`)).toBeVisible();
      const auswahl = await zeigen(page, "bim", "auswahl");
      expect(auswahl.aura.length).toBeGreaterThan(0);
      expect(auswahl.aura.every((a) => a.material === "LineBasicMaterial" && a.farbe === 0x3b82f5)).toBe(true);
      expect(auswahl.emissiv).toContain("wall");
      expect((await zeigen(page, "bim", "hilfsobjekte")).filter((h) => h.zustand === "auswahl").length).toBeGreaterThan(0);

      // --- Select a hull wall too (the attribute panel floats over the right of the canvas and covers the
      //     drawn wall; the hull wall lies in the middle of the picture). Hover over the SELECTED element:
      //     the overlay says "Ausgewählt", the hover tint is NOT painted over it ---
      await page.mouse.move(huelle.x, huelle.y);
      await page.waitForTimeout(120);
      await page.mouse.click(huelle.x, huelle.y);
      await expect.poll(async () => (await zeigen(page, "bim", "auswahl")).aura.length).toBeGreaterThan(0);
      const schluesselHuelle = huelle.hover.schluessel;
      const aufGewaehlt = await hoverSuchen(page, canvas, "bim", (h) => h.schluessel === schluesselHuelle);
      expect(aufGewaehlt.hover.zustand).toBe("auswahl");
      await expect(overlay).toContainText("Ausgewählt");
      expect(await zeigen(page, "bim", "markiert")).toBe(0);
      expect((await zeigen(page, "bim", "auswahl")).aura.length).toBeGreaterThan(0);

      // --- Another element: fokus again, selection aura stays ---
      const anderes = await hoverSuchen(page, canvas, "bim", (h) => h.schluessel !== schluesselHuelle);
      expect(anderes.hover.zustand).toBe("fokus");
      await expect(overlay).toContainText("Unter dem Zeiger");
      expect(await zeigen(page, "bim", "markiert", "fokus")).toBeGreaterThan(0);
      expect((await zeigen(page, "bim", "auswahl")).aura.length).toBeGreaterThan(0);

      // --- A miss shows nothing; leaving the canvas clears the hover ---
      await ins_leere(page, canvas, "bim");
      await page.mouse.move(2, 2);
      await expect.poll(() => zeigen(page, "bim", "hover")).toBeNull();
      expect(await zeigen(page, "bim", "markiert")).toBe(0);
      await expect(overlay).toBeHidden();

      expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
    } finally {
      if (modellId) await request.delete(`/api/entities/BimModel/${modellId}`);
      if (id) await request.delete(`/api/entities/Project/${id}`);
    }
  });
});
