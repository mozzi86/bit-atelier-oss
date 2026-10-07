// Headless-Nachweis 75-08 (MS-08): Iso-Kamera im Massing-3D.
//
// Test 1 — Iso-Rauchtest: im Default-Modus 2D steckt die Iso in der unteren
// Karte → [data-testid=mv-3d] vorhanden, darin ENTWEDER ein canvas ODER
// mv-fallback (nie beides, nie keins); mit Canvas steht data-iso-yaw = "45";
// Konsole/Warnungen sauber.
//
// Test 2 — Iso, Split, Presets: eine Instanz je Modus, Sonnen-Presets steuern
// die Kacheln, Hover-Tooltip, fokusgebundene Tasten (Pfeile im 3D bewegen KEINE
// 2D-Ecke, Strg+Z kommt durch), Rad + Maßstab-Chip, Leerlauf ohne rAF-Schleife,
// Nachbarn-Chip.
//
// GL-agnostisch: headless-Chromium hat je nach Build WebGL (SwiftShader) oder
// keins. Der Spec misst NUR DOM-Zustand — KEINE Pixel-/Screenshot-Assertion.
// Der Canvas-Teil (Punkte 4–8) läuft nur, wenn WebGL da ist; sonst annotiert
// der Spec den Sprung (beide Zweige sind grün — MSB-8-Prinzip).
//
// Netz: alles außer localhost wird geblockt (Muster produktreife-72-01); die
// OSM-Route wird NACH nurLocalhost registriert (spätere Handler gewinnen).
// massing-Specs laufen mit --workers=1 (geteilter persistierter Footprint in
// server/db.json, Wettlauf bei Parallelbetrieb — Lehre 75-06).

import { test, expect } from "@playwright/test";
import { ERLAUBT_OFFLINE, resetRechteck, punkte, nurLocalhost } from "./fixtures/massing.js";

const PROJEKT = "Review Testhaus";
const STUDIO = `/ComplexDesigner?projekt=${encodeURIComponent(PROJEKT)}&tab=studio`;

// GL-Driver noise filter — three.js in headless Chromium reports GPU stalls
// (WebGLProgram/getUniforms/WebGLRenderer), not app errors (Muster 75-01).
const GL_FILTER = /WebGLProgram|getUniforms|WebGLRenderer/;

/** Wires the console/pageerror guards used by both tests. */
function wachen(page) {
  const warnungen = [];
  page.on("pageerror", (e) => {
    const stack = e.stack || String(e);
    if (GL_FILTER.test(stack)) return;
    warnungen.push("[pageerror] " + stack.split(String.fromCharCode(10)).slice(0, 4).join(" | "));
  });
  page.on("console", (msg) => {
    if ((msg.type() === "error" || msg.type() === "warning") && !ERLAUBT_OFFLINE.test(msg.text())) {
      warnungen.push(`[${msg.type()}] ${msg.text()}`);
    }
  });
  return warnungen;
}

test.describe("75-08 — Iso-Kamera, Split, Sonnen-Presets", () => {
  test.describe.configure({ timeout: 240000 });

  test("Iso-Rauchtest: eine mv-3d-Instanz mit Canvas oder Fallback, yaw 45, Konsole sauber", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1800 });
    await nurLocalhost(page);
    const warnungen = wachen(page);

    await page.goto(STUDIO);
    await expect(page.getByRole("heading", { name: "Komplex-Designer" })).toBeVisible({ timeout: 30000 });
    await resetRechteck(page);

    // Im Default-Modus 2D rendert die untere Karte die Iso.
    const mv = page.getByTestId("mv-3d");
    await expect(mv.first()).toBeVisible({ timeout: 15000 });

    const canvasAnzahl = await mv.locator("canvas").count();
    const fallbackAnzahl = await mv.locator("[data-testid=mv-fallback]").count();
    // Entweder ein Canvas ODER der Klartext-Fallback — nie beides, nie keins.
    expect(canvasAnzahl + fallbackAnzahl, "weder Canvas noch Fallback").toBeGreaterThanOrEqual(1);
    expect(canvasAnzahl > 0 && fallbackAnzahl > 0, "Canvas UND Fallback zugleich").toBe(false);

    if (canvasAnzahl > 0) {
      await expect(mv).toHaveAttribute("data-iso-yaw", "45");
      await page.waitForTimeout(600);
      await expect(mv).toHaveAttribute("data-iso-schleife", "aus");
      test.info().annotations.push({ type: "gl", description: "WebGL vorhanden — Canvas-Zweig" });
    } else {
      await expect(mv.locator("[data-testid=mv-fallback]")).toBeVisible();
      await expect(mv.locator("[data-testid=mv-fallback]")).not.toHaveText(/^\s*$/);
      test.info().annotations.push({ type: "gl", description: "kein WebGL — Fallback-Zweig" });
    }

    expect(warnungen, `Konsolen-Warnungen: ${warnungen.join(" · ")}`).toEqual([]);
  });

  test("MS-08 Iso, Split, Presets: eine Instanz je Modus, Tooltip, Tasten, Rad, Leerlauf", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1800 });
    await nurLocalhost(page);

    // OSM-Route AFTER nurLocalhost (later handlers win): two 10 × 10 m blocks
    // 40 m east/west of the site, built from the request's own lat/lng so the
    // neighbour count is deterministic IF the project has a location.
    let osmAngefragt = false;
    await page.route("**/api/osm-buildings**", (route) => {
      osmAngefragt = true;
      const url = new URL(route.request().url());
      const lat = Number(url.searchParams.get("lat")) || 49.45;
      const lng = Number(url.searchParams.get("lng")) || 11.08;
      const mPerLat = 111320;
      const mPerLon = 111320 * Math.cos((lat * Math.PI) / 180);
      // A 10 × 10 m square 40 m east / west, expressed as lat/lon coords.
      const quad = (dLonM, dLatM) => ({
        coords: [
          { lat: lat + dLatM / mPerLat, lon: lng + dLonM / mPerLon },
          { lat: lat + (dLatM + 10) / mPerLat, lon: lng + dLonM / mPerLon },
          { lat: lat + (dLatM + 10) / mPerLat, lon: lng + (dLonM + 10) / mPerLon },
          { lat: lat + dLatM / mPerLat, lon: lng + (dLonM + 10) / mPerLon },
        ],
        height: 12,
      });
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ buildings: [quad(-45, -5), quad(35, -5)], offline: false }),
      });
    });

    const warnungen = wachen(page);
    await page.goto(STUDIO);
    await expect(page.getByRole("heading", { name: "Komplex-Designer" })).toBeVisible({ timeout: 30000 });
    await resetRechteck(page);

    const mv = page.getByTestId("mv-3d");
    // View-toggle buttons live in the card header. A real mouse click can be
    // intercepted by the LehrlingPalette (it follows the pointer while a plan
    // element is hovered, 75-04) — dispatch the click event directly instead
    // (same pattern as the Radix tab in massing-75-05).
    const ansicht = async (v) => {
      await page.locator(`[data-ansicht="${v}"]`).dispatchEvent("click");
      await page.waitForTimeout(300); // let the mode settle (iso remount)
    };

    // --- Punkt 1: genau EINE Instanz je Modus ---------------------------------
    // 2D (Default): die untere Karte rendert die Iso → 1 Instanz.
    await ansicht("2d");
    await expect(mv).toHaveCount(1);
    // Iso-Modus: das große Fenster rendert die Iso, die untere Karte zeigt den
    // Hinweissatz → weiterhin genau 1 Instanz.
    await ansicht("3d");
    await expect(mv).toHaveCount(1);
    await expect(page.getByTestId("ms-iso-hinweis")).toBeVisible();
    // Split: Plan links + Iso rechts, untere Karte = Hinweis → 1 Instanz, und
    // der 2D-Griff ist (neben der Iso) sichtbar.
    await ansicht("split");
    await expect(mv).toHaveCount(1);
    await expect(page.locator('polygon[data-griff="flaeche"]').first()).toBeVisible();
    await expect(page.getByTestId("ms-iso-hinweis")).toBeVisible();

    // --- Punkt 2: Presets (immer, GL-unabhängig) ------------------------------
    // 21.06. (Tag 172) + 12 h → Azimut exakt 180° (Sommersonnenwende Mittag).
    await page.locator('[data-testid=ms-sonne-preset][data-tag="172"]').click();
    await page.locator('[data-testid=ms-sonne-preset][data-stunde="12"]').click();
    await expect(page.getByTestId("ms-sonne-azimut")).toHaveText(/180/);
    const hoeheSommer = Number((await page.getByTestId("ms-sonne-hoehe").innerText()).replace(/[^0-9]/g, ""));
    // 21.12. (Tag 355) → tiefer.
    await page.locator('[data-testid=ms-sonne-preset][data-tag="355"]').click();
    await page.locator('[data-testid=ms-sonne-preset][data-stunde="12"]').click();
    const hoeheWinter = Number((await page.getByTestId("ms-sonne-hoehe").innerText()).replace(/[^0-9]/g, ""));
    // Differenz = 2 × 23.44° minus Rundung, breitengradunabhängig.
    expect(hoeheSommer - hoeheWinter, `Sommer ${hoeheSommer} − Winter ${hoeheWinter}`).toBeGreaterThanOrEqual(45);
    expect(hoeheSommer - hoeheWinter).toBeLessThanOrEqual(49);
    // Symmetrie: 9 h und 15 h am 21.06. → Azimut9 + Azimut15 = 360.
    await page.locator('[data-testid=ms-sonne-preset][data-tag="172"]').click();
    await page.locator('[data-testid=ms-sonne-preset][data-stunde="9"]').click();
    const az9 = Number((await page.getByTestId("ms-sonne-azimut").innerText()).replace(/[^0-9]/g, ""));
    await page.locator('[data-testid=ms-sonne-preset][data-stunde="15"]').click();
    const az15 = Number((await page.getByTestId("ms-sonne-azimut").innerText()).replace(/[^0-9]/g, ""));
    expect(Math.abs(az9 + az15 - 360), `Az9 ${az9} + Az15 ${az15}`).toBeLessThanOrEqual(2);

    // --- Punkt 3: GL-Zweig bestimmen -----------------------------------------
    const hatCanvas = (await mv.locator("canvas").count()) > 0;
    if (!hatCanvas) {
      await expect(mv.locator("[data-testid=mv-fallback]")).toBeVisible();
      test.info().annotations.push({ type: "gl", description: "kein WebGL — Canvas-Teil (Punkte 4–8) übersprungen" });
      // Konsole prüfen, Modus 2D zurücksetzen, dann Ende.
      await ansicht("2d");
      expect(warnungen, `Konsolen-Warnungen: ${warnungen.join(" · ")}`).toEqual([]);
      return;
    }
    test.info().annotations.push({ type: "gl", description: "WebGL vorhanden — Canvas-Teil ausgeführt" });

    // --- Punkt 4: Tooltip (Iso-Modus) ----------------------------------------
    await ansicht("3d");
    const canvasBox = await mv.locator("canvas").first().boundingBox();
    expect(canvasBox, "Iso-Canvas hat keine Box").toBeTruthy();
    // Bildmitte = Baukörpermitte (das Kamera-Ziel liegt auf der Bbox-Mitte).
    await page.mouse.move(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
    const tooltip = mv.locator("[data-testid=mv-tooltip]");
    await expect(tooltip).not.toHaveAttribute("hidden", "");
    await expect(tooltip).toContainText("Geschosse");
    await expect(tooltip).toContainText("BGF");
    // Die BGF-Zahl gleicht der KPI-Kachel: dritte Tooltip-Zeile „BGF 1.234 m²"
    // vs. KPI-Wert „1.234 m²" — gleiche Zahl, gleiche de-DE-Formatierung.
    const tooltipText = await tooltip.innerText();
    const tooltipBgf = (tooltipText.split(String.fromCharCode(10)).find((z) => z.includes("BGF")) || "")
      .replace(/\D/g, "");
    const kpiText = await page.getByTestId("ms-kpi-bgf").innerText();
    const kpiBgf = (kpiText.replace(/\D/g, ""));
    expect(tooltipBgf, `Tooltip „${tooltipText}" vs KPI „${kpiText}"`).toContain(kpiBgf);
    // Maus außerhalb des Wrappers → hidden.
    await page.mouse.move(2, 2);
    await expect(tooltip).toHaveAttribute("hidden", "");

    // --- Punkt 5: Tastatur fokusgebunden (Split-Modus) ------------------------
    await ansicht("split");
    const isoCanvas = mv.locator("canvas").first();
    await isoCanvas.click(); // fokussiert den Wrapper
    await page.keyboard.press("e");
    await expect(mv).toHaveAttribute("data-iso-yaw", "135", { timeout: 5000 });
    await page.keyboard.press("q");
    await page.keyboard.press("q");
    await expect(mv).toHaveAttribute("data-iso-yaw", "315", { timeout: 5000 });
    // Pfeile im FOKUSSIERTEN 3D verschieben KEINE 2D-Ecke.
    const vorher = await punkte(page);
    await isoCanvas.click();
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await page.waitForTimeout(200);
    const nachher = await punkte(page);
    expect(JSON.stringify(vorher.pts), "Pfeile im 3D haben eine 2D-Ecke bewegt")
      .toBe(JSON.stringify(nachher.pts));

    // --- Punkt 6: Rad und Chip -----------------------------------------------
    // Canvas-Box IM SPLIT-Modus neu messen (Position ≠ großer Iso-Modus).
    const splitBox = await isoCanvas.boundingBox();
    expect(splitBox, "Split-Canvas hat keine Box").toBeTruthy();
    const S0 = await mv.getAttribute("data-iso-massstab");
    await page.mouse.move(splitBox.x + splitBox.width / 2, splitBox.y + splitBox.height / 2);
    await page.mouse.wheel(0, -120); // Rad hoch = feiner
    await page.waitForTimeout(500);
    const S1 = await mv.getAttribute("data-iso-massstab");
    const leiter = [2000, 1000, 500, 200];
    const i0 = leiter.indexOf(Number(S0));
    if (Number(S0) !== 200) {
      // Nächstfeinere Stufe (kleinerer Nenner).
      expect(Number(S1), `Rad von ${S0} → ${S1}`).toBe(leiter[i0 + 1]);
    }
    // Maßstab-Chip 1:500 → die Iso geht auf genau diese Stufe.
    await page.locator("select[data-massstab]").selectOption("500");
    await page.waitForTimeout(500);
    await expect(mv).toHaveAttribute("data-iso-massstab", "500");

    // --- Punkt 7: Leerlauf ohne Schleife --------------------------------------
    await page.waitForTimeout(1000);
    await expect(mv).toHaveAttribute("data-iso-schleife", "aus");

    // --- Punkt 8: Nachbarn (bedingt — nur wenn das Projekt einen Standort hat)
    // Die OSM-Route lieferte 2 Gebäude; kam eine Anfrage an, zeigt das
    // data-iso-nachbarn = "2" und der Chip schaltet sie aus/an.
    if (osmAngefragt) {
      // In den Iso-Modus, damit die große Iso die Nachbarn rendert.
      await ansicht("3d");
      await page.waitForTimeout(400);
      await expect(mv).toHaveAttribute("data-iso-nachbarn", "2");
      const nachbarnChip = page.getByRole("checkbox", { name: /Nachbarn/i });
      await nachbarnChip.uncheck();
      await page.waitForTimeout(300);
      await expect(mv).toHaveAttribute("data-iso-nachbarn", "0");
      await nachbarnChip.check();
      await page.waitForTimeout(300);
      await expect(mv).toHaveAttribute("data-iso-nachbarn", "2");
    } else {
      test.info().annotations.push({ type: "osm", description: "keine OSM-Anfrage — Review Testhaus hat ggf. keinen Standort; Punkt 8 übersprungen" });
    }

    // --- Punkt 9: Konsole sauber, Modus + Nachbarn zurücksetzen ---------------
    await ansicht("2d");
    expect(warnungen, `Konsolen-Warnungen: ${warnungen.join(" · ")}`).toEqual([]);
  });
});
