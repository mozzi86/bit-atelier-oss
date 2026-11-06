// Headless-Nachweis 107-05 (Massing-Profil): (1) eine Ecke so ziehen, dass sich das Profil selbst schneidet → der Edit wird
// abgelehnt, die Meldung nennt den Grund, gespeichert bleibt das alte Profil; eine gültige Ecke geht weiter. (2) ein ungültiger
// Körper aus dem Bestand (Fliege) wird angezeigt und markiert (Plan: Fehlerfarbe + durchgezogener Umriss wie der Zustand
// „fehler“ aus 106-01 + „!“, gewählt zusätzlich ein Auswahl-Halo; Leiste: Grund, 3D-Zähler),
// nicht gelöscht. (3) „Folge mir“ mit geschlossenem Pfad (Startpunkt erneut klicken) legt einen Körper mit Hof an (loecher);
// nach dem Schließen hängt auch eine getippte Koordinate oder Länge keinen Punkt mehr an.
// Eigenes Projekt, Aufräumen im finally, Konsole sauber.
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";

const NAME = "E2E Bauteilkern 10705";

/** Bow-tie (crossed edges) at site (8, 8): an invalid body as an old project or the node graph could hold it. */
const FLIEGE = { id: "k1", name: "Fliege", profil: [{ x: 0, y: 0 }, { x: 6, y: 6 }, { x: 6, y: 0 }, { x: 0, y: 6 }], hoehe: 3, basis: 0, pos: { x: 8, y: 8 }, drehung: 0, gruppe: null };

test("107-05 Massing-Profil: Selbstschnitt abgelehnt, ungültiger Bestand markiert, Folge mir geschlossen mit Hof", async ({ page, request }) => {
  test.setTimeout(180000);
  let id = null;
  try {
    await nurLocalhost(page);
    const warnungen = [];
    page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text()) && !/WebGL|GPU stall/i.test(m.text())) warnungen.push(m.text()); });
    page.on("pageerror", (e) => { if (!/WebGL|THREE|getUniforms/i.test(String(e.stack || e))) warnungen.push(`pageerror ${e}`); });
    id = (await (await request.post("/api/entities/Project", { data: { name: NAME, build_kind: "neubau", status: "concept" } })).json()).id;
    await request.post("/api/entities/BimModel", { data: { project_id: id, massing_layer: { koerper: [FLIEGE], gruppen: {}, naechsteId: 2 } } });
    await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME)}&tab=studio`);
    await expect(page.getByTestId("mm-leiste")).toBeVisible({ timeout: 60000 });

    // (2) the stored bow-tie is drawn and marked, not dropped
    const fliege = page.locator('[data-testid=mm-koerper][data-id="k1"]');
    await expect(fliege).toHaveAttribute("data-ungueltig", "selbstschnitt");
    await expect(fliege.locator("text")).toHaveText(/^! /);
    // review 107-05: outline of the "fehler" state (zustaende.js: solid, "!"), dashed is reserved for "warnung"
    const umriss = fliege.locator("path:not([data-testid=mm-auswahl-halo])");
    await expect(umriss).toHaveAttribute("stroke", "#a91919");
    expect(await umriss.getAttribute("stroke-dasharray")).toBeNull();
    const mv = page.getByTestId("mv-3d").first();
    const gl = (await mv.locator("canvas").count()) > 0;
    test.info().annotations.push({ type: "gl", description: gl ? "WebGL vorhanden — 3D-Zähler geprüft" : "kein WebGL — 3D-Zähler nicht geprüft" });
    if (gl) await expect(mv).toHaveAttribute("data-mk-ungueltig", "1");

    await page.getByTestId("mm-auswahl").click();
    // Desktop Chrome is 1280×720. The studio chrome pushes the plan down, and the
    // command line is `position: sticky; bottom: 0`, so the bow-tie (near the top of
    // the canvas) sits under that bar or below the fold. The click then hits the bar
    // and the body stays unselected (CI 2026-10-31, three times, `mm-ungueltig` missing).
    // Centre the outline in the viewport before hitting the left lobe.
    await umriss.evaluate((el) => el.scrollIntoView({ block: "center", inline: "nearest" }));
    const bf = /** @type {any} */ (await umriss.boundingBox());
    expect(bf, "Umriss der Fliege im Viewport").toBeTruthy();
    // left lobe of the bow-tie (the crossing point is the middle)
    await page.mouse.click(bf.x + bf.width * 0.15, bf.y + bf.height / 2);
    const zeile = page.getByTestId("mm-ungueltig");
    await expect(zeile).toBeVisible();
    await expect(zeile).toHaveAttribute("data-grund", "selbstschnitt");
    await expect(zeile).toContainText("!");
    await expect(zeile).toContainText("Körper ungültig: Profil schneidet sich selbst");
    // selected AND invalid: the selection stays visible as a halo under the error outline
    await expect(fliege.getByTestId("mm-auswahl-halo")).toHaveCount(1);
    await page.keyboard.press("Delete");
    await expect(page.getByTestId("mm-koerper")).toHaveCount(0);

    // (1) draw a rectangle, then drag its top-right corner across the left edge → refused
    const flaeche = page.getByTestId("mm-flaeche");
    const at = async (fx, fy) => {
      await flaeche.scrollIntoViewIfNeeded();
      const box = /** @type {{x:number,y:number,width:number,height:number}} */ (await flaeche.boundingBox());
      return { x: box.x + box.width * fx, y: box.y + box.height * fy };
    };
    await page.getByTestId("mm-linie").click();
    for (const [fx, fy] of [[0.4, 0.4], [0.5, 0.4], [0.5, 0.55], [0.4, 0.55], [0.4, 0.4]]) {
      const p = await at(fx, fy);
      await page.mouse.move(p.x, p.y);
      await page.mouse.click(p.x, p.y);
    }
    const koerper = page.getByTestId("mm-koerper");
    await expect(koerper).toHaveCount(1);
    await expect(koerper.first()).toHaveAttribute("data-ungueltig", "");
    const kid = await koerper.first().getAttribute("data-id");
    const gespeichert = async () => {
      const m = (await (await request.get(`/api/entities/BimModel?project_id=${id}`)).json())[0];
      const k = m?.massing_layer?.koerper?.find((x) => x.id === kid);
      return k ? JSON.stringify(k.profil) : null;
    };
    await expect.poll(gespeichert, { timeout: 20000 }).not.toBeNull();
    const profilVorher = await gespeichert();

    await page.getByTestId("mm-auswahl").click();
    const pfad = koerper.first().locator("path");
    const b0 = /** @type {any} */ (await pfad.boundingBox());
    await page.mouse.click(b0.x + b0.width / 2, b0.y + b0.height / 2);
    const griffe = page.getByTestId("mm-eckgriff");
    await expect(griffe).toHaveCount(4);
    // the handle at the top right of the drawn rectangle (largest x, smallest y on screen)
    const boxen = await griffe.evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }));
    const oben = Math.min(...boxen.map((p) => p.y)), rechts = Math.max(...boxen.map((p) => p.x)), links = Math.min(...boxen.map((p) => p.x));
    const unten = Math.max(...boxen.map((p) => p.y));
    const g = boxen.find((p) => Math.abs(p.x - rechts) < 2 && Math.abs(p.y - oben) < 2);
    expect(g, "Griff oben rechts").toBeTruthy();
    // target: left of the left edge, at 60 % of the height → the moved top edge crosses the left edge
    await page.mouse.move(g.x, g.y);
    await page.mouse.down();
    await page.mouse.move(links - (rechts - links) * 0.4, oben + (unten - oben) * 0.6, { steps: 8 });
    await page.mouse.up();
    await expect(page.getByTestId("mm-meldung")).toContainText("Ecke nicht verschoben: Profil schneidet sich selbst");
    await expect(koerper.first()).toHaveAttribute("data-ungueltig", "");
    const b1 = /** @type {any} */ (await pfad.boundingBox());
    expect(Math.abs(b1.width - b0.width)).toBeLessThan(1);
    await page.waitForTimeout(1200); // past the save debounce: nothing may have been written
    expect(await gespeichert()).toBe(profilVorher);

    // a valid drag of the same corner still works (to the right)
    const g2 = /** @type {any} */ (await griffe.nth(0).boundingBox()); // handles re-render; find the top-right one again
    const boxen2 = await griffe.evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }));
    const h = boxen2.find((p) => Math.abs(p.x - rechts) < 2 && Math.abs(p.y - oben) < 2) || { x: g2.x, y: g2.y };
    await page.mouse.move(h.x, h.y);
    await page.mouse.down();
    await page.mouse.move(h.x + 40, h.y, { steps: 6 });
    await page.mouse.up();
    await expect.poll(async () => (/** @type {any} */ (await pfad.boundingBox())).width).toBeGreaterThan(b0.width + 10);
    await expect.poll(gespeichert, { timeout: 20000 }).not.toBe(profilVorher);

    // (3) Follow me along a closed path: four points, the first one again closes it; Enter = one body with a courtyard
    await page.getByTestId("mm-folgemir").click();
    await expect(page.getByTestId("mm-folge-profil")).toBeVisible();
    for (const [fx, fy] of [[0.15, 0.7], [0.3, 0.7], [0.3, 0.9], [0.15, 0.9], [0.15, 0.7]]) {
      const p = await at(fx, fy);
      await page.mouse.move(p.x, p.y);
      await page.mouse.click(p.x, p.y);
    }
    await expect(page.locator('[data-testid=mm-entwurf][data-zu="1"]')).toHaveCount(1);
    await expect(page.getByTestId("mm-folge-zeile")).toContainText("Pfad geschlossen");
    // a typed coordinate or length adds no point to the closed ring
    const entwurfVorher = await page.getByTestId("mm-entwurf").getAttribute("points");
    for (const getippt of ["@1;0", "2"]) {
      await page.keyboard.type(getippt);
      await page.keyboard.press("Enter");
      await expect(page.getByTestId("mm-meldung")).toContainText("Pfad geschlossen");
      expect(await page.getByTestId("mm-entwurf").getAttribute("points")).toBe(entwurfVorher);
    }
    await page.keyboard.type("0,4;3");
    await page.keyboard.press("Enter");
    await expect(koerper).toHaveCount(2);
    await expect(page.getByTestId("mm-meldung")).toContainText("Folge mir: 0,40 m × 3,00 m");
    const ring = koerper.nth(1);
    await expect(ring).toHaveAttribute("data-loecher", "1");
    await expect(ring).toHaveAttribute("data-ungueltig", "");
    if (gl) await expect(mv).toHaveAttribute("data-mk-loecher", "1");
    const rid = await ring.getAttribute("data-id");
    await expect.poll(async () => {
      const m = (await (await request.get(`/api/entities/BimModel?project_id=${id}`)).json())[0];
      const k = m?.massing_layer?.koerper?.find((x) => x.id === rid);
      return k ? `${k.loecher?.length}|${k.loecher?.[0]?.length}|${k.hoehe}` : null;
    }, { timeout: 20000 }).toBe("1|4|3");

    expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
  } finally {
    if (id) {
      const ms = await (await request.get(`/api/entities/BimModel?project_id=${id}`)).json();
      for (const m of Array.isArray(ms) ? ms : []) await request.delete(`/api/entities/BimModel/${m.id}`);
      await request.delete(`/api/entities/Project/${id}`);
    }
  }
});
