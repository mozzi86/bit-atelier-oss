// Headless-Nachweis 104-16: Drohnenscan als Gaussian Splats in der 3D-Geländeansicht (eigener Renderer, keine
// Bibliothek) — „Beispiel“ lädt 20.000 Splats, die Schieber platzieren, „Entfernen“ räumt auf; ein .splat-Scan
// aus dem Dateidialog wird gelesen; kaputte Datei → Klartext-Fehler. Shader-Fehler (THREE.WebGLProgram) machen den
// Test ausdrücklich rot. Testhaus, nur Ansicht (nichts wird gespeichert).
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";
import { Buffer } from "node:buffer";

/** One splat file with n splats in the 32-byte .splat layout. */
function splatDatei(n) {
  const buf = Buffer.alloc(n * 32);
  for (let i = 0; i < n; i++) {
    buf.writeFloatLE(i * 0.5, i * 32); buf.writeFloatLE(1, i * 32 + 4); buf.writeFloatLE(0, i * 32 + 8);
    for (let k = 0; k < 3; k++) buf.writeFloatLE(0.2, i * 32 + 12 + k * 4);
    buf.writeUInt8(200, i * 32 + 24); buf.writeUInt8(80, i * 32 + 25); buf.writeUInt8(40, i * 32 + 26); buf.writeUInt8(255, i * 32 + 27);
    buf.writeUInt8(255, i * 32 + 28); buf.writeUInt8(128, i * 32 + 29); buf.writeUInt8(128, i * 32 + 30); buf.writeUInt8(128, i * 32 + 31);
  }
  return buf;
}

test("104-16 Gaussian Splats: Beispiel, Platzieren, Entfernen, .splat-Datei, kaputte Datei", async ({ page }) => {
  test.setTimeout(150000);
  await nurLocalhost(page);
  const fehler = [];
  page.on("console", (m) => { if (m.type() === "error" && (/WebGLProgram|Shader/i.test(m.text()) || !ERLAUBT_OFFLINE.test(m.text()))) fehler.push(m.text()); });
  page.on("pageerror", (e) => fehler.push(`pageerror ${e}`));
  await page.goto("/ComplexDesigner?projekt=Review%20Testhaus&tab=terrain");
  const leiste = page.getByTestId("splat-steuerung");
  await expect(leiste).toBeVisible({ timeout: 60000 });

  await page.getByTestId("splat-beispiel").click();
  await expect(page.getByTestId("splat-info")).toContainText("20.000");
  await page.getByTestId("splat-massstab").fill("85");
  await expect(leiste).toContainText("×");
  await page.getByTestId("splat-umkehren").check();
  await page.waitForTimeout(800); // a few frames: sorting in the worker, shader compiled and drawn
  await page.getByTestId("splat-entfernen").click();
  await expect(page.getByTestId("splat-info")).toHaveCount(0);

  await page.getByTestId("splat-datei").setInputFiles({ name: "scan.splat", mimeType: "application/octet-stream", buffer: splatDatei(500) });
  await expect(page.getByTestId("splat-info")).toContainText("scan.splat · 500");
  await page.getByTestId("splat-datei").setInputFiles({ name: "kaputt.splat", mimeType: "application/octet-stream", buffer: Buffer.alloc(33) });
  await expect(page.getByTestId("splat-fehler")).toContainText("Scan nicht lesbar");
  expect(fehler, `Konsole: ${fehler.join(" | ")}`).toEqual([]);
});
