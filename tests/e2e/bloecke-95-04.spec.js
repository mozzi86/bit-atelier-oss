// Headless-Nachweis 95-04…06: Blöcke der Baufeld-Planung als Objekte — Auswahl (Klick, Umschalt,
// Fenster/Kreuzen), Verschieben, Strg-Kopie, Rückgängig/Wiederholen, Pfeiltasten, Drehgriff,
// Entf, und die Prüfung (GRZ/GFZ, Überlappung) nach jeder Bewegung. SVG-Plan (ohne Standort) für
// genaue Koordinaten; die Karte (mit Standort) bekommt einen Kurztest der Verdrahtung.
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";

const NAME = "E2E Bloecke 9504";
const NAME_KARTE = "E2E Bloecke 9504 Karte";
const PARZELLE = [{ x: 300, y: 200 }, { x: 900, y: 200 }, { x: 900, y: 600 }, { x: 300, y: 600 }];
// 16 × 8 px = 20 × 10 m at 1.25 m/px
const BLOECKE = [
  { id: "b1", x: 400, y: 300, width: 16, height: 8, floors: 3 },
  { id: "b2", x: 600, y: 300, width: 16, height: 8, floors: 3 },
];

async function anlegen(request, name, mitStandort) {
  for (const alt of await (await request.get(`/api/entities/Project?name=${encodeURIComponent(name)}`)).json()) {
    for (const c of await (await request.get(`/api/entities/BuildingComplex?project_id=${alt.id}`)).json()) await request.delete(`/api/entities/BuildingComplex/${c.id}`);
    await request.delete(`/api/entities/Project/${alt.id}`);
  }
  const id = (await (await request.post("/api/entities/Project", { data: { name, build_kind: "neubau", status: "concept" } })).json()).id;
  const bc = (await (await request.post("/api/entities/BuildingComplex", { data: {
    project_id: id, name,
    ...(mitStandort ? { location: { lat: 49.4521, lng: 11.0767, address: "Musterstraße 1, Musterstadt" } } : {}),
    site_parcel: { id: "site_parcel_main", type: "site_boundary", assumed: false, source: "gezeichnet", m_per_px: 1.25, points: PARZELLE },
    buildings: BLOECKE,
  } })).json()).id;
  return { id, bc };
}

function konsole(page) {
  const w = [];
  page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text()) && !/WebGL|GPU stall|maplibre|tile|Failed to load resource|Style is not done loading/i.test(m.text())) w.push(m.text()); });
  page.on("pageerror", (e) => w.push(String(e)));
  return w;
}

test("95-04…06 Blöcke im SVG-Plan: Auswahl, Verschieben, Kopie, Undo, Drehen, Prüfung", async ({ page, request }) => {
  test.setTimeout(180000);
  const { id, bc } = await anlegen(request, NAME, false);
  try {
    await nurLocalhost(page);
    const warnungen = konsole(page);
    await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME)}&tab=massing`);
    const plan = page.getByTestId("sd-plan");
    await plan.waitFor({ timeout: 60000 });
    await page.getByTestId("sd-modus-auswahl").click();
    const svg = plan.locator("svg").first();
    await svg.scrollIntoViewIfNeeded();
    const box = /** @type {{x: number, y: number, width: number, height: number}} */ (await svg.boundingBox());
    const pt = (x, y) => ({ x: box.x + (x / 1200) * box.width, y: box.y + (y / 800) * box.height });
    const klick = async (x, y) => { const p = pt(x, y); await page.mouse.click(p.x, p.y); };
    const ziehen = async (a, b, schritte = 8) => {
      const p = pt(a.x, a.y), q = pt(b.x, b.y);
      await page.mouse.move(p.x, p.y); await page.mouse.down();
      await page.mouse.move(q.x, q.y, { steps: schritte }); await page.mouse.up();
    };
    const auswahl = () => plan.getAttribute("data-auswahl");
    // Without a location the complex is not autosaved (name + location are required) — the plan's
    // block elements carry centre (site metres) and rotation instead.
    const bloecke = () => plan.getByTestId("sd-block").evaluateAll((els) => els.map((e) => {
      const [x, y] = String(e.getAttribute("data-mitte")).split(",").map(Number);
      return { id: e.getAttribute("data-id"), x, y, drehung: Number(e.getAttribute("data-drehung")) };
    }));
    const block = async (id) => (await bloecke()).find((b) => b.id === id);

    // click, Shift+click, click on empty ground
    await klick(408, 304);
    await expect(plan).toHaveAttribute("data-auswahl", "b1");
    await page.keyboard.down("Shift"); await klick(608, 304); await page.keyboard.up("Shift");
    await expect(plan).toHaveAttribute("data-auswahl", "b1,b2");
    await klick(500, 500);
    await expect(plan).toHaveAttribute("data-auswahl", "");
    // window (left → right) catches only the fully enclosed b1; crossing (right → left) touches b2
    await ziehen({ x: 390, y: 290 }, { x: 610, y: 320 });
    await expect(plan).toHaveAttribute("data-auswahl", "b1");
    await ziehen({ x: 610, y: 320 }, { x: 500, y: 290 });
    await expect(plan).toHaveAttribute("data-auswahl", "b2");

    // move b1 by 40 px (= 50 m) with Alt = no snapping → stored in canvas units + metre mirror
    await page.keyboard.down("Alt");
    await ziehen({ x: 408, y: 304 }, { x: 448, y: 304 });
    await page.keyboard.up("Alt");
    await expect.poll(async () => (await block("b1"))?.x).toBe(560); // (400 + 8 + 40) px × 1.25
    expect((await block("b1")).y).toBe(380);

    // Ctrl+drag = copy; undo / redo
    await page.keyboard.down("Control"); await page.keyboard.down("Alt");
    await ziehen({ x: 448, y: 304 }, { x: 448, y: 354 });
    await page.keyboard.up("Alt"); await page.keyboard.up("Control");
    await expect.poll(async () => (await bloecke()).length).toBe(3);
    await page.keyboard.press("Control+z");
    await expect.poll(async () => (await bloecke()).length).toBe(2);
    await page.keyboard.press("Control+y");
    await expect.poll(async () => (await bloecke()).length).toBe(3);

    // arrows: 0.1 m and Shift = 1 m on the selected copy
    const kopie = (await auswahl()) || "";
    expect(kopie).toMatch(/^bld_/);
    const vorher = await block(kopie);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Shift+ArrowDown");
    await expect.poll(async () => {
      const b = await block(kopie);
      return `${(b.x - vorher.x).toFixed(2)}|${(b.y - vorher.y).toFixed(2)}`;
    }).toBe("0.10|1.00");

    // rotate handle: drag from above the block to its right → +90°, 15° steps
    const griff = plan.getByTestId("sd-drehgriff");
    await expect(griff).toBeVisible();
    const g = /** @type {any} */ (await griff.boundingBox());
    const k = await block(kopie);
    const mitte = pt(k.x / 1.25, k.y / 1.25);
    await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2); await page.mouse.down();
    await page.mouse.move(mitte.x + 40, mitte.y + 2, { steps: 10 }); await page.mouse.up();
    await expect.poll(async () => (await block(kopie))?.drehung).toBe(90);

    // check: no conflicts yet; drag b2 onto b1 → overlap is reported
    await expect(page.getByTestId("sd-pruefung")).toContainText("GRZ");
    await expect(page.getByTestId("sd-konflikte")).toHaveCount(0);
    await page.keyboard.down("Alt");
    await ziehen({ x: 608, y: 304 }, { x: 452, y: 304 });
    await page.keyboard.up("Alt");
    await expect(page.getByTestId("sd-konflikte")).toContainText("überlappt");

    // Delete removes the selection
    await page.keyboard.press("Delete");
    await expect.poll(async () => (await bloecke()).map((b) => b.id).includes("b2")).toBe(false);
    expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
  } finally {
    await request.delete(`/api/entities/BuildingComplex/${bc}`);
    await request.delete(`/api/entities/Project/${id}`);
  }
});

test("95-04 Blöcke auf der Karte: Auswahlmodus setzt keine Blöcke, Rahmen, Strg+A, Entf, Strg+Z", async ({ page, request }) => {
  test.setTimeout(150000);
  const { id, bc } = await anlegen(request, NAME_KARTE, true);
  const anzahl = async () => ((await (await request.get(`/api/entities/BuildingComplex/${bc}`)).json()).buildings || []).length;
  try {
    await nurLocalhost(page);
    const warnungen = konsole(page);
    await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME_KARTE)}&tab=massing`);
    const plan = page.getByTestId("sd-plan");
    await plan.waitFor({ timeout: 60000 });
    const karte = plan.locator(".maplibregl-canvas").first();
    await karte.waitFor({ timeout: 60000 });
    await page.getByTestId("sd-modus-auswahl").click();
    await karte.scrollIntoViewIfNeeded();
    const kb = /** @type {any} */ (await karte.boundingBox());
    // click on the map: selects nothing, adds nothing
    await page.mouse.click(kb.x + 30, kb.y + 30);
    await page.waitForTimeout(2000);
    expect(await anzahl()).toBe(2);
    // drag right → left shows the dashed crossing frame
    await page.mouse.move(kb.x + kb.width - 40, kb.y + 40); await page.mouse.down();
    await page.mouse.move(kb.x + kb.width - 200, kb.y + 120, { steps: 6 });
    await expect(plan.getByTestId("sd-rahmen")).toHaveAttribute("data-modus", "kreuzen");
    await page.mouse.up();
    await expect(plan.getByTestId("sd-rahmen")).toHaveCount(0);
    // Ctrl+A, Delete, Ctrl+Z
    await page.keyboard.press("Control+a");
    await expect(plan).toHaveAttribute("data-auswahl", "b1,b2");
    await expect(plan.getByTestId("sd-drehgriff")).toBeVisible();
    await page.keyboard.press("Delete");
    await expect.poll(anzahl, { timeout: 20000 }).toBe(0);
    await page.keyboard.press("Control+z");
    await expect.poll(anzahl, { timeout: 20000 }).toBe(2);
    expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
  } finally {
    await request.delete(`/api/entities/BuildingComplex/${bc}`);
    await request.delete(`/api/entities/Project/${id}`);
  }
});
