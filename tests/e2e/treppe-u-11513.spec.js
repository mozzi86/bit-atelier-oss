// 115-13 (D-115-49, W-1118-03) im echten Browser: eine zweiläufige Treppe mit Zwischenpodest in einem zweigeschossigen Testmodell.
// Eigenes neutrales Projekt per API (2 Geschosse à 2,80 m, keine Treppe), am Ende gelöscht; das Testhaus wird nicht berührt.
//   (1) Grundriss EG: „Treppe einfügen“ legt eine gerade Treppe an, im Inspektor wird die Art „zweiläufig mit Zwischenpodest“
//       gewählt (Vorschau-Knopf) — das Auto-Speichern schreibt art "podest_u" in den Datensatz (bestehender Speicherweg).
//   (2) Grundriss EG zeigt das Symbol mit „auf“ und dem Text „16 Stg 17,5/28,0“ (2,80 / 16 = 0,175; 0,63 − 0,35 = 0,28),
//       Grundriss OG das Symbol mit „ab“ (gestrichelt, mit Deckenloch).
//   (3) Neu laden: beide Geschosse zeigen die Treppe weiter, der Inspektor zeigt „8 + 8“ Läufe.
//   (4) Konsole ohne Fehler und Warnungen (außer den bekannten Offline-/WebGL-Meldungen).
//   Nachgang Review 20.11.: (2) prüft auch den Drehsinn („links“ = Lauf 2 links vom Hinaufgehenden, im Grundriss oben); ein zweiter Test
//   lässt das Nachladen des Treppen-Inspektors scheitern — der Hinweis erscheint, „Löschen“ im Inspektor funktioniert weiter.
import { test, expect } from "@playwright/test";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";
import { speichernUndWarten } from "./fixtures/entwurf.js";

const NAME = "E2E Treppe U 11513";
const RECHT = (/** @type {number} */ x0, /** @type {number} */ x1, /** @type {number} */ z0, /** @type {number} */ z1) => [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }];

/** Removes projects of earlier runs with their records. @param {any} request */
async function altWeg(request) {
  for (const alt of await (await request.get(`/api/entities/Project?name=${encodeURIComponent(NAME)}`)).json()) {
    for (const m of await (await request.get(`/api/entities/BimModel?project_id=${alt.id}`)).json()) await request.delete(`/api/entities/BimModel/${m.id}`);
    await request.delete(`/api/entities/Project/${alt.id}`);
  }
}

test("115-13: U-Treppe einfügen, Art wählen, beide Geschosse zeigen sie — auch nach dem Neuladen", async ({ page, request }) => {
  test.setTimeout(240000);
  await page.setViewportSize({ width: 1500, height: 1000 });
  await altWeg(request);
  const id = (await (await request.post("/api/entities/Project", { data: { name: NAME, build_kind: "neubau", status: "concept" } })).json()).id;
  await request.post("/api/entities/BimModel", { data: {
    project_id: id, storeys: 2, storeyHeight: 2.8,
    customZones: [{ points: RECHT(-5, 5, -4, 4), level: 0, name: "Diele", _idx: 1 }],
  } });
  const gespeichert = async () => (await (await request.get(`/api/entities/BimModel?project_id=${id}`)).json())[0];
  try {
    await nurLocalhost(page);
    /** @type {string[]} */
    const warnungen = [];
    page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text()) && !/GPU stall|WebGL|wasm/i.test(m.text())) warnungen.push(m.text()); });
    page.on("pageerror", (e) => { if (!/Error creating WebGL context|getUniforms/i.test(String(e.stack || e))) warnungen.push(`pageerror ${e}`); });

    const oeffnen = async () => {
      await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME)}&tab=bim`);
      await page.waitForFunction(() => !!(/** @type {any} */ (window).__bitBefehle), null, { timeout: 60000 });
      await page.getByRole("button", { name: "Ansicht Grundriss" }).click();
    };
    const geschoss = (/** @type {string} */ lvl) => page.getByLabel("Geschoss wählen").selectOption(lvl);
    const symbolText = (/** @type {string} */ t) => page.locator("[data-treppe] text", { hasText: new RegExp(`^${t}$`) });

    // (1) insert and switch the type
    await oeffnen();
    await geschoss("0");
    await page.getByTestId("treppe-einfuegen").click();
    await page.getByTestId("treppe-art-podest_u").click({ timeout: 30000 });
    await expect(page.getByTestId("treppe-art-podest_u")).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("treppe-laeufe")).toContainText("8 + 8");
    // 115-05c (adapted): stair edits of the inspector (patchStair) are a draft like every model edit - nothing stored before
    // "Speichern" (stricter than before: the stored record is checked to stay without the stair), then "Speichern" writes the type
    await expect(page.getByTestId("entwurf-status")).toHaveAttribute("data-sauber", "0", { timeout: 10000 });
    await page.waitForTimeout(3000);
    expect((await gespeichert()).customStairs || [], "nothing stored before Speichern").toEqual([]);
    expect(await speichernUndWarten(page)).toBe("gespeichert");
    await expect.poll(async () => ((await gespeichert()).customStairs || []).map((/** @type {any} */ t) => t.art), { timeout: 20000, message: "Speichern schreibt die Art" }).toEqual(["podest_u"]);

    // (2) both storeys
    const pruefen = async () => {
      await geschoss("0");
      await expect(symbolText("auf")).toHaveCount(1, { timeout: 15000 });
      await expect(symbolText("16 Stg 17,5/28,0")).toHaveCount(1);
      // review 20.11. (finding 1): "links" (default), ascent +x (screen right): flight 2 lies on the walker's LEFT = higher on the screen —
      // the arrow head at the austritt of flight 2 has a smaller SVG y than the antritt circle of flight 1
      const lage = await page.locator("[data-treppe]").first().evaluate((g) => {
        const kreis = /** @type {Element} */ (g.querySelector("circle"));
        const spitze = String(g.querySelector("polyline")?.getAttribute("points")).trim().split(/\s+/)[1].split(",").map(Number);
        return { kreisY: Number(kreis.getAttribute("cy")), pfeilY: spitze[1] };
      });
      expect(lage.pfeilY, JSON.stringify(lage)).toBeLessThan(lage.kreisY - 10);
      await geschoss("1");
      await expect(symbolText("ab")).toHaveCount(1, { timeout: 15000 });
      await expect(symbolText("auf")).toHaveCount(0);
      // storey above: dashed outline and the slab opening, no solid stair lines
      expect(await page.locator("[data-treppe] path[stroke-dasharray]").count()).toBeGreaterThanOrEqual(2);
    };
    await pruefen();

    // (3) reload
    await oeffnen();
    await pruefen();
    await geschoss("0");
    await page.locator("[data-treppe]").first().click();
    await expect(page.getByTestId("treppe-laeufe")).toContainText("8 + 8", { timeout: 30000 });

    // (4) console clean
    expect(warnungen, warnungen.join("\n")).toEqual([]);
  } finally {
    await altWeg(request);
  }
});

test("115-13 Nachgang: scheitert das Nachladen des Treppen-Inspektors, bleibt der Inspektor bedienbar", async ({ page, request }) => {
  test.setTimeout(240000);
  await page.setViewportSize({ width: 1500, height: 1000 });
  await altWeg(request);
  const id = (await (await request.post("/api/entities/Project", { data: { name: NAME, build_kind: "neubau", status: "concept" } })).json()).id;
  await request.post("/api/entities/BimModel", { data: {
    project_id: id, storeys: 2, storeyHeight: 2.8,
    customZones: [{ points: RECHT(-5, 5, -4, 4), level: 0, name: "Diele", _idx: 1 }],
  } });
  try {
    await nurLocalhost(page);
    // the module of the stair rows cannot be loaded (deploy / offline); everything else loads normally
    await page.route(/TreppeInspektor\.jsx/, (r) => r.abort());
    await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME)}&tab=bim`);
    await page.waitForFunction(() => !!(/** @type {any} */ (window).__bitBefehle), null, { timeout: 60000 });
    await page.getByRole("button", { name: "Ansicht Grundriss" }).click();
    await page.getByLabel("Geschoss wählen").selectOption("0");
    await page.getByTestId("treppe-einfuegen").click();
    await expect(page.getByTestId("teil-fehlergrenze")).toHaveText("Treppen-Eingaben nicht verfügbar – neu laden", { timeout: 30000 });
    await expect(page.getByTestId("fehlergrenze")).toHaveCount(0);
    await expect(page.locator("[data-treppe]")).toHaveCount(1);
    // the rest of the inspector: delete the stair
    await page.getByRole("button", { name: /Löschen \(Entf\)/ }).click();
    await expect(page.locator("[data-treppe]")).toHaveCount(0);
  } finally {
    await altWeg(request);
  }
});
