// Headless-Nachweis 72-05 (Variante a): die Skizze ist ein echtes Skizzenwerkzeug — Freihand mit Maus und
// Stift (Druck über CDP `Input.dispatchMouseEvent` mit pointerType "pen" + force), Stiftbreite/-farbe,
// Radierer; der Constraint-Solver ist ein Modus derselben Seite. Projekt „Review Testhaus": die Skizze liegt im
// BimModel-Feld sketch_layer — daraus wird der gespeicherte Druck gelesen; die Testhaus-Fixture setzt den
// Datensatz (alle *_layer) nach dem Test zurück. Konsole sauber.
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";

const API = "/api/entities";

async function ziehen(page, box, von, bis, schritte = 12) {
  await page.mouse.move(box.x + von[0], box.y + von[1]);
  await page.mouse.down();
  for (let i = 1; i <= schritte; i++) {
    await page.mouse.move(box.x + von[0] + ((bis[0] - von[0]) * i) / schritte, box.y + von[1] + ((bis[1] - von[1]) * i) / schritte);
  }
  await page.mouse.up();
}

async function stiftStrich(cdp, box, von, bis, force, schritte = 12) {
  const ev = (type, x, y, extra = {}) => cdp.send("Input.dispatchMouseEvent", { type, x, y, pointerType: "pen", button: "left", clickCount: 1, force, ...extra });
  await ev("mouseMoved", box.x + von[0], box.y + von[1], { button: "none", buttons: 0 });
  await ev("mousePressed", box.x + von[0], box.y + von[1], { buttons: 1 });
  for (let i = 1; i <= schritte; i++) {
    await ev("mouseMoved", box.x + von[0] + ((bis[0] - von[0]) * i) / schritte, box.y + von[1] + ((bis[1] - von[1]) * i) / schritte, { buttons: 1 });
  }
  await ev("mouseReleased", box.x + bis[0], box.y + bis[1], { buttons: 0 });
}

test("72-05 Skizze: Freihand mit Maus und Stiftdruck, Radierer, Constraint-Modus", async ({ page, request }) => {
  test.setTimeout(120000);
  await nurLocalhost(page);
  const warnungen = [];
  page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text()) && !/wasm|planegcs/i.test(m.text())) warnungen.push(m.text()); });
  page.on("pageerror", (e) => warnungen.push(`pageerror ${e}`));
  const projekt = (await (await request.get(`${API}/Project?name=${encodeURIComponent("Review Testhaus")}`)).json())[0];
  const bm = async () => (await (await request.get(`${API}/BimModel?project_id=${projekt.id}`)).json())[0];
  const ausgang = await bm();
  const vorher = ausgang?.sketch_layer?.strokes?.length || 0;
  try {

  await page.goto(`/SketchStudio?projekt=${encodeURIComponent("Review Testhaus")}`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Skizze", { timeout: 30000 });
  await expect(page.getByTestId("modus-freihand")).toHaveAttribute("aria-pressed", "true");
  const flaeche = page.locator("svg[data-werkzeug]");
  await expect(flaeche).toHaveAttribute("data-werkzeug", "freihand");
  const box = await flaeche.boundingBox();

  // 1) Mouse stroke, red, broad.
  await page.getByTestId("stift-breite-breit").click();
  await page.getByTestId("stift-farbe-dc2626").click();
  await ziehen(page, box, [box.width * 0.2, box.height * 0.3], [box.width * 0.6, box.height * 0.35]);
  await expect(page.getByTestId("stift-info")).toHaveAttribute("data-striche", String(vorher + 1));
  await expect(page.locator("path[data-strich]")).toHaveCount(vorher + 1);
  await expect(page.locator("path[data-strich]").last()).toHaveAttribute("fill", "#dc2626");

  // 2) Pen stroke with pressure 0.9 (CDP), default colour.
  await page.getByTestId("stift-farbe-1e293b").click();
  const cdp = await page.context().newCDPSession(page);
  await stiftStrich(cdp, box, [box.width * 0.2, box.height * 0.7], [box.width * 0.6, box.height * 0.72], 0.9);
  await expect(page.getByTestId("stift-info")).toHaveAttribute("data-striche", String(vorher + 2));
  // Stored in the project record: mouse stroke = 0.5 (no sensor), pen stroke carries its pressure.
  await expect.poll(async () => ((await bm())?.sketch_layer?.strokes || []).length, { timeout: 10000 }).toBe(vorher + 2);
  const gespeichert = (await bm()).sketch_layer.strokes.slice(-2).map((st) => Math.max(...st.punkte.map((q) => q[2])));
  expect(gespeichert[0], "Maus ohne Drucksensor").toBe(0.5);
  expect(gespeichert[1], "Stiftdruck gespeichert").toBeGreaterThan(0.7);

  // 3) Eraser across the first stroke removes it, the pen stroke stays.
  await page.getByTestId("werkzeug-radierer").click();
  await ziehen(page, box, [box.width * 0.4, box.height * 0.2], [box.width * 0.4, box.height * 0.45], 8);
  await expect(page.getByTestId("stift-info")).toHaveAttribute("data-striche", String(vorher + 1));
  await expect(page.locator("path[data-strich]").last()).toHaveAttribute("fill", "#1e293b");

  // 4) Constraint mode of the same editor: constraint tools, ink stays visible.
  await page.getByTestId("modus-constraint").click();
  await expect(page.getByTestId("werkzeug-line")).toBeVisible();
  await expect(page.getByTestId("stift-karte")).toHaveCount(0);
  await expect(page.locator("path[data-strich]")).toHaveCount(vorher + 1);

  // Reload keeps the ink (project record).
  await expect.poll(async () => ((await bm())?.sketch_layer?.strokes || []).length, { timeout: 10000 }).toBe(vorher + 1);
  await page.reload();
  await expect(page.locator("path[data-strich]")).toHaveCount(vorher + 1, { timeout: 30000 });
  expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
  } finally {
    // Leave the house as found: the sketch layer back to its state before the test.
    await page.goto("about:blank");
    if (ausgang?.id) await request.put(`${API}/BimModel/${ausgang.id}`, { data: { sketch_layer: ausgang.sketch_layer ?? null } });
  }
});
