// Headless-Nachweis 104-03: ein Befehlsregister im Massing-Studio, per JSON-Zeilen steuerbar (Grundlage für Agenten,
// 104-04) — Befehle auflisten (mit „aktiv“), Linie starten, Koordinaten eingeben, Fläche schließt zum Körper,
// Modell auslesen, unbekannter Befehl / nicht aktiver Befehl antworten mit ok:false statt zu werfen.
import { test, expect } from "./fixtures/base.js";
import { nurLocalhost } from "./fixtures/massing.js";

const NAME = "E2E Befehlsregister 10403";

test("104-03 Studio per JSON steuern: befehle → linie → eingabe ×5 → modell", async ({ page, request }) => {
  test.setTimeout(150000);
  for (const alt of await (await request.get(`/api/entities/Project?name=${encodeURIComponent(NAME)}`)).json()) await request.delete(`/api/entities/Project/${alt.id}`);
  const id = (await (await request.post("/api/entities/Project", { data: { name: NAME, build_kind: "neubau", status: "concept" } })).json()).id;
  try {
    await nurLocalhost(page);
    await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME)}&tab=studio`);
    await expect(page.getByTestId("mm-leiste")).toBeVisible({ timeout: 60000 });
    await page.waitForFunction(() => !!(/** @type {any} */ (window).__bitBefehle));
    const zeile = (/** @type {any} */ anfrage) => page.evaluate((z) => JSON.parse(/** @type {any} */ (window).__bitBefehle.zeileBearbeiten(z)), JSON.stringify(anfrage));

    const liste = await zeile({ id: 1, method: "befehle" });
    expect(liste.ok).toBe(true);
    const ids = liste.result.map((b) => b.id);
    for (const erwartet of ["linie", "pushpull", "beenden", "rueckgaengig", "eingabe", "modell"]) expect(ids).toContain(erwartet);
    expect(liste.result.find((b) => b.id === "loeschen").aktiv).toBe(false);

    expect(await zeile({ id: 2, method: "ausfuehren", params: { befehl: "loeschen" } })).toMatchObject({ id: 2, ok: false });
    expect(await zeile({ id: 3, method: "ausfuehren", params: { befehl: "gibtsnicht" } })).toMatchObject({ ok: false, error: "Befehl unbekannt: gibtsnicht" });
    expect(await zeile({ id: 4, method: "ausfuehren", params: { befehl: "linie" } })).toMatchObject({ ok: true, result: "linie" });
    await expect(page.getByTestId("mm-leiste")).toHaveAttribute("data-werkzeug", "linie");
    for (const text of ["#0;0", "@10;0", "@0;6", "@-10;0", "#0;0"]) {
      expect(await zeile({ id: text, method: "ausfuehren", params: { befehl: "eingabe", params: { text } } })).toMatchObject({ ok: true });
    }
    await expect(page.getByTestId("mm-koerper")).toHaveCount(1);
    const modell = await zeile({ id: 9, method: "ausfuehren", params: { befehl: "modell" } });
    const p = modell.result.koerper[0].profil;
    const xs = p.map((q) => q.x), ys = p.map((q) => q.y);
    expect([Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)]).toEqual([10, 6]);
  } finally {
    for (const m of await (await request.get(`/api/entities/BimModel?project_id=${id}`)).json()) await request.delete(`/api/entities/BimModel/${m.id}`);
    await request.delete(`/api/entities/Project/${id}`);
  }
});
