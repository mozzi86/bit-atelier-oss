// Headless-Nachweis 73-10 (BEST-12): im Reiter Bauaufnahme einen Bestandsbefund (Bauteilöffnung) an der
// angenommenen Wand w-04 anlegen, mit Foto → Foto liegt als verkleinertes JPEG in der Projektablage
// (Document „Bestandsfoto“), der Befund additiv in befunde_layer.bestand; erst der Klick „Erfassungsgrad
// anheben“ schreibt w-04 im Modellstand auf „gemessen“. Aufräumen im finally, Konsole sauber.
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";
import { Buffer } from "node:buffer";
import { bimSnapshots } from "../../packages/nova-core/server/seed-data.js";

const API = "/api/entities";
const NAME = "E2E Bestandsbefund 7310";
// 2×2 px red PNG
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==", "base64");

test("73-10 Bestandsbefund mit Foto, Anheben nur auf Klick", async ({ page, request }) => {
  test.setTimeout(150000);
  let id = null;
  try {
    await nurLocalhost(page);
    const warnungen = [];
    page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text())) warnungen.push(m.text()); });
    page.on("pageerror", (e) => { if (!/WebGL|THREE|getUniforms/i.test(String(e.stack || e))) warnungen.push(`pageerror ${e}`); });
    id = (await (await request.post(`${API}/Project`, { data: { name: NAME, build_kind: "sanierung", status: "concept" } })).json()).id;
    const { id: _s, project_id: _p, ...snap } = bimSnapshots[0];
    const snapId = (await (await request.post(`${API}/BimSnapshot`, { data: { ...snap, project_id: id } })).json()).id;

    await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME)}&tab=bauaufnahme`);
    await expect(page.getByTestId("bb-element")).toBeVisible({ timeout: 30000 });
    await page.getByTestId("bb-element").selectOption("w-04");
    await page.getByTestId("bb-methode").selectOption("oeffnung");
    await page.getByTestId("bb-kategorie").selectOption("aufbau");
    await page.getByTestId("bb-text").fill("Mauerwerk 36,5 cm, keine Dämmung");
    await page.getByTestId("bb-foto").setInputFiles({ name: "oeffnung.png", mimeType: "image/png", buffer: PNG });
    await page.getByTestId("bb-speichern").click();
    await expect(page.getByTestId("bb-status")).toHaveText("Befund gespeichert.", { timeout: 15000 });

    const docs = await (await request.get(`${API}/Document?project_id=${id}`)).json();
    const foto = docs.find((d) => d.type === "Bestandsfoto");
    expect(foto?.data_url?.startsWith("data:image/jpeg")).toBe(true);
    await expect.poll(async () => {
      const m = (await (await request.get(`${API}/BimModel?project_id=${id}`)).json())[0];
      return m?.befunde_layer?.bestand?.[0]?.foto_dokument_id ?? null;
    }, { timeout: 15000 }).toBe(foto.id);
    // Not raised yet — only the finding exists.
    let s = await (await request.get(`${API}/BimSnapshot/${snapId}`)).json();
    expect(s.elemente.find((e) => e.guid === "w-04").erfassung).toBe("angenommen");

    await page.locator('[data-testid^="bb-anheben-"]').first().click();
    await expect(page.getByTestId("bb-status")).toContainText("Erfassungsgrad angehoben", { timeout: 15000 });
    s = await (await request.get(`${API}/BimSnapshot/${snapId}`)).json();
    expect(s.elemente.find((e) => e.guid === "w-04").erfassung).toBe("gemessen");
    await expect(page.locator('[data-testid^="bb-anheben-"]')).toHaveCount(0);
    expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
  } finally {
    if (id) {
      for (const e of ["BimSnapshot", "BimModel", "Document", "ProjectFolder"]) {
        for (const r of await (await request.get(`${API}/${e}?project_id=${id}`)).json()) await request.delete(`${API}/${e}/${r.id}`);
      }
      await request.delete(`${API}/Project/${id}`);
    }
  }
});
