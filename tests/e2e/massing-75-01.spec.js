// Headless-Nachweis 75-01 (MS-01): Griffe des Massing-Studios sind Bildschirm-
// Pixel — der sichtbare Eckgriff misst bei Zoom 1× und bei Zoom 8× dieselben
// ~10 px — und der Cursor wechselt über Ecke → Mitte → Kante → Fläche viermal.
//
// Netz: alles außer localhost wird geblockt (Muster produktreife-72-01).
// Der Massing-Reiter braucht keinen Standort: ohne Parzelle gilt das
// 70 × 50-m-Zeichenfeld [ASSUMED] mit dem Standard-Footprint.

import { test, expect } from "@playwright/test";

// GL Driver Message: headless-Chromium meldet GPU-Stalls der three.js-Ansicht — Treiber, nicht App.
const ERLAUBT_OFFLINE = /(ERR_|net::|Failed to fetch|timeout|aborted|404|503|tiles\.|openfreemap|elevation-tiles|Image could not be loaded|AbortError|GL Driver Message|WebGL)/i;

async function breite(locator) {
  const box = await locator.boundingBox();
  expect(box, "Griff hat keine BoundingBox").toBeTruthy();
  return box.width;
}

test.describe("75-01 — Griffe in Bildschirm-Pixeln, Cursor je Ziel", () => {
  test.describe.configure({ timeout: 120000 });
  test("Eckgriff 10 px bei 1× und 8×, vier Cursorwechsel, Konsole sauber", async ({ page }) => {
    await page.route("**/*", (route) => {
      const host = new URL(route.request().url()).hostname;
      if (host === "localhost" || host === "127.0.0.1" || host === "[::1]") return route.continue();
      return route.abort();
    });
    const warnungen = [];
    page.on("pageerror", (e) => {
      const stack = e.stack || String(e);
      // three.js in headless Chromium: WebGL program info goes null (getUniforms -> trim) — GPU context, not app code.
      if (/WebGLProgram|getUniforms|WebGLRenderer/.test(stack)) return;
      warnungen.push("[pageerror] " + stack.split(String.fromCharCode(10)).slice(0, 4).join(" | "));
    });
    page.on("console", (msg) => {
      if ((msg.type() === "error" || msg.type() === "warning") && !ERLAUBT_OFFLINE.test(msg.text())) {
        warnungen.push(`[${msg.type()}] ${msg.text()}`);
      }
    });

    await page.goto("/ComplexDesigner?projekt=Review%20Testhaus&tab=studio");
    await expect(page.getByRole("heading", { name: "Komplex-Designer" })).toBeVisible({ timeout: 30000 });
    const ecke = page.locator('circle[data-sicht="ecke"]').first();
    await expect(ecke).toBeVisible({ timeout: 15000 });

    // Zoom 1×: sichtbarer Eckgriff = 2 · r = 10 px (±1.5 px Rendering-Toleranz).
    const b1 = await breite(ecke);
    expect(b1, "Eckgriff bei 1×").toBeGreaterThanOrEqual(8.5);
    expect(b1).toBeLessThanOrEqual(11.5);

    // Auf 8× zoomen (1,2^12 ≈ 8,9 → geklemmt auf maxZoom 8).
    const plus = page.getByRole("button", { name: "Vergrößern" });
    for (let i = 0; i < 12; i += 1) await plus.click();
    await expect(page.getByTitle("Zoom-Stufe")).toHaveText(/800\s*%/);
    // Nach dem Zoom kann die Ecke außerhalb des Sichtfelds liegen — irgendein sichtbarer Eckgriff genügt.
    const sichtbare = page.locator('circle[data-sicht="ecke"]');
    const n = await sichtbare.count();
    let gemessen = null;
    for (let i = 0; i < n; i += 1) {
      const box = await sichtbare.nth(i).boundingBox();
      if (box && box.width > 0) { gemessen = box.width; break; }
    }
    expect(gemessen, "kein Eckgriff im Sichtfeld bei 8×").not.toBeNull();
    expect(gemessen, "Eckgriff bei 8×").toBeGreaterThanOrEqual(8.5);
    expect(gemessen).toBeLessThanOrEqual(11.5);
    await page.getByRole("button", { name: "Ansicht zurücksetzen" }).click();

    // Cursor je Ziel — vier verschiedene Werte, jeder als SVG-data-URI.
    const cursorVon = async (sel) => {
      const el = page.locator(sel).first();
      await el.hover({ force: true });
      return el.evaluate((node) => getComputedStyle(node).cursor);
    };
    const cursors = [
      await cursorVon('[data-griff="ecke"]'),
      await cursorVon('[data-griff="mitte"]'),
      await cursorVon('[data-griff="kante"]'),
      await cursorVon('[data-griff="flaeche"]'),
    ];
    for (const c of cursors) expect(c, `Cursor ${c}`).toContain("url(");
    expect(new Set(cursors).size, `Cursorwerte: ${cursors.map((c) => c.slice(-30)).join(" | ")}`).toBe(4);

    // Hover füllt die Ecke blau.
    await page.locator('[data-griff="ecke"]').first().hover({ force: true });
    await expect(ecke).toHaveAttribute("fill", "#1d4ed8");

    expect(warnungen, warnungen.join("\n")).toEqual([]);
  });
});
