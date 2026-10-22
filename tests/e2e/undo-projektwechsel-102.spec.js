// F1 (102): the undo history belongs to one project. Before, switching the current project in the header
// kept the massing modeller's stack — Ctrl+Z in project B brought project A's body back and the autosave
// stored it in B. Two own projects, cleanup in finally.
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";

const A = "E2E Undo Projekt A 102";
const B = "E2E Undo Projekt B 102";

test("102 F1: nach dem Projektwechsel ist Rückgängig leer und holt nichts aus dem alten Projekt", async ({ page, request }) => {
  test.setTimeout(150000);
  const ids = [];
  try {
    await nurLocalhost(page);
    const fehler = [];
    page.on("pageerror", (e) => { if (!/WebGL|THREE|getUniforms/i.test(String(e.stack || e))) fehler.push(`pageerror ${e}`); });
    page.on("console", (m) => { if (m.type() === "error" && !ERLAUBT_OFFLINE.test(m.text()) && !/WebGL|GPU stall/i.test(m.text())) fehler.push(m.text()); });
    for (const name of [A, B]) ids.push((await (await request.post("/api/entities/Project", { data: { name, build_kind: "neubau", status: "concept" } })).json()).id);

    await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(A)}&tab=studio`);
    await expect(page.getByTestId("mm-leiste")).toBeVisible({ timeout: 60000 });

    // Project A: draw one body with the line tool.
    await page.getByTestId("mm-linie").click();
    const flaeche = page.getByTestId("mm-flaeche");
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
    await expect(page.getByTestId("mm-koerper")).toHaveCount(1);
    await expect(page.getByTestId("mm-undo")).toBeEnabled();

    // Switch to project B in the header — same page, no reload.
    await page.getByRole("combobox", { name: "Aktuelles Projekt" }).click();
    await page.getByRole("option", { name: B }).click();
    await expect(page.getByTestId("mm-koerper")).toHaveCount(0, { timeout: 20000 });
    await expect(page.getByTestId("mm-undo")).toBeDisabled();

    // Ctrl+Z must not bring A's body into B, and B's stored layer stays empty after the autosave.
    await flaeche.click({ position: { x: 5, y: 5 } }).catch(() => {});
    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(1500); // autosave debounce is 0.8 s
    await expect(page.getByTestId("mm-koerper")).toHaveCount(0);
    const modelle = await (await request.get(`/api/entities/BimModel?project_id=${ids[1]}`)).json();
    const koerperB = (Array.isArray(modelle) ? modelle : []).flatMap((m) => m?.massing_layer?.koerper || []);
    expect(koerperB).toHaveLength(0);
    expect(fehler, fehler.join("\n")).toEqual([]);
  } finally {
    for (const id of ids) {
      const modelle = await (await request.get(`/api/entities/BimModel?project_id=${id}`)).json().catch(() => []);
      for (const m of Array.isArray(modelle) ? modelle : []) await request.delete(`/api/entities/BimModel/${m.id}`).catch(() => {});
      await request.delete(`/api/entities/Project/${id}`).catch(() => {});
    }
  }
});
