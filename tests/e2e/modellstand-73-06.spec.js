// Headless-Nachweis 73-06 (BEST-06): AVA › BIM-Mengen › IFC-Import liest das Musterprojekt, „Als
// Modellstand speichern“ legt BimSnapshot + Bauteil-Blob an (Kennzahl ohne Status sichtbar); nach dem
// Neuladen zeigt der Designer im Bestandsprojekt „Gemessen“ mit der Herkunft dieses Modellstands.
// Aufräumen (Snapshot, Blob, Projekt) im finally, Konsole sauber.
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";
import path from "node:path";

const API = "/api/entities";
const NAME = "E2E Modellstand 7306";

test("73-06 IFC-Import als Modellstand übersteht den Reload", async ({ page, request }) => {
  test.setTimeout(240000);
  let id = null;
  try {
    await nurLocalhost(page);
    const warnungen = [];
    page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text()) && !/wasm|WebGL/i.test(m.text())) warnungen.push(m.text()); });
    page.on("pageerror", (e) => warnungen.push(`pageerror ${e}`));
    id = (await (await request.post(`${API}/Project`, { data: { name: NAME, build_kind: "sanierung", status: "concept" } })).json()).id;

    await page.goto(`/AVA?projekt=${encodeURIComponent(NAME)}&tab=takeoff`);
    await page.locator('input[type=file][accept=".ifc"]').setInputFiles(path.resolve("public/beispiel/musterprojekt.ifc"));
    const knopf = page.getByTestId("ifc-modellstand");
    await expect(knopf).toBeEnabled({ timeout: 120000 });
    await knopf.click();
    await expect(page.getByTestId("ifc-modellstand-status")).toContainText("Modellstand gespeichert", { timeout: 60000 });
    await expect(page.getByTestId("ifc-modellstand-status")).toContainText("ohne Status");
    const snaps = await (await request.get(`${API}/BimSnapshot?project_id=${id}`)).json();
    expect(snaps.length).toBe(1);
    expect(snaps[0].anzahl).toBeGreaterThan(0);
    // Storage rule (speicherOrt.js): the small sample model keeps its elements in the record; a large one
    // would go to the blob store with snapshot_id.
    if (snaps[0].elemente_blob) {
      const blob = await (await request.get(`/api/blobs/${snaps[0].elemente_blob}`)).json();
      expect(blob.elemente.length).toBe(snaps[0].anzahl);
      expect(blob.snapshot_id).toBe(snaps[0].id);
    } else {
      expect(snaps[0].elemente.length).toBe(snaps[0].anzahl);
    }

    await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME)}&tab=bim`);
    await expect(page.getByTestId("panel-stand")).toHaveAttribute("data-stand", "gemessen", { timeout: 30000 });
    await expect(page.getByTestId("panel-herkunft")).toContainText("Bauaufnahme: musterprojekt");
    expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
  } finally {
    if (id) {
      for (const s of await (await request.get(`${API}/BimSnapshot?project_id=${id}`)).json()) {
        if (s.elemente_blob) await request.delete(`/api/blobs/${s.elemente_blob}`);
        await request.delete(`${API}/BimSnapshot/${s.id}`);
      }
      await request.delete(`${API}/Project/${id}`);
    }
  }
});
