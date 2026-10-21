// Headless-Nachweis 104-02: CAD-Koordinaten im Massing-Studio — ein Körper nur per Tastatur: „#0;0“ absolut, dann
// „@12;0“, „@0;8“, „@-12;0“ relativ, „#0;0“ schließt die Fläche → Grundriss genau 12 × 8 m; Polar „@5<90“ im
// Verschieben-Werkzeug ist abgedeckt durch die Unit-Tests. Eigenes Projekt, Aufräumen im finally.
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";

const NAME = "E2E Koordinaten 10402";

test("104-02 Linie nur per Koordinaten: #0;0 → @12;0 → @0;8 → @-12;0 → #0;0 = Körper 12 × 8 m", async ({ page, request }) => {
  test.setTimeout(150000);
  for (const alt of await (await request.get(`/api/entities/Project?name=${encodeURIComponent(NAME)}`)).json()) await request.delete(`/api/entities/Project/${alt.id}`);
  const id = (await (await request.post("/api/entities/Project", { data: { name: NAME, build_kind: "neubau", status: "concept" } })).json()).id;
  try {
    await nurLocalhost(page);
    const warnungen = [];
    page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text()) && !/WebGL|GPU stall/i.test(m.text())) warnungen.push(m.text()); });
    await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME)}&tab=studio`);
    await expect(page.getByTestId("mm-leiste")).toBeVisible({ timeout: 60000 });
    await page.getByTestId("mm-linie").click();
    await page.evaluate(() => /** @type {HTMLElement} */ (document.activeElement)?.blur());
    for (const eingabe of ["#0;0", "@12;0", "@0;8", "@-12;0", "#0;0"]) {
      await page.keyboard.type(eingabe);
      await expect(page.getByTestId("mm-eingabe")).toHaveValue(eingabe);
      await page.keyboard.press("Enter");
    }
    await expect(page.getByTestId("mm-koerper")).toHaveCount(1);
    await expect.poll(async () => {
      const m = (await (await request.get(`/api/entities/BimModel?project_id=${id}`)).json())[0];
      const p = m?.massing_layer?.koerper?.[0]?.profil;
      if (!p) return null;
      const xs = p.map((q) => q.x), ys = p.map((q) => q.y);
      return `${p.length}|${Math.max(...xs) - Math.min(...xs)}|${Math.max(...ys) - Math.min(...ys)}`;
    }, { timeout: 20000 }).toBe("4|12|8");
    expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
  } finally {
    for (const m of await (await request.get(`/api/entities/BimModel?project_id=${id}`)).json()) await request.delete(`/api/entities/BimModel/${m.id}`);
    await request.delete(`/api/entities/Project/${id}`);
  }
});
