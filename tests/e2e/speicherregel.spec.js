// Headless-Nachweis Speicherregel (11.10.2026): im Reiter Berichte › Dokumente landet eine kleine Datei im
// Datensatz (data), eine Datei über 1 MB im Objektspeicher (data_blob, data leer); „Öffnen“ lädt sie aus
// dem Objektspeicher. Aufräumen im finally.
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";
import { Buffer } from "node:buffer";

const API = "/api/entities";

test("Dokumente: < 256 KB im Datensatz, > 1 MB im Objektspeicher, Öffnen lädt nach", async ({ page, request }) => {
  test.setTimeout(120000);
  const vorher = new Set((await (await request.get(`${API}/Document`)).json()).map((d) => d.id));
  try {
    await nurLocalhost(page);
    const warnungen = [];
    page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text())) warnungen.push(m.text()); });
    await page.goto(`/Reports?projekt=Review%20Testhaus`);
    await page.getByRole("tab", { name: /Dokumente/ }).click();
    const input = page.locator('input[type=file][accept="application/pdf,image/*"]');
    await input.setInputFiles({ name: "klein.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 klein") });
    await expect(page.getByText("klein.pdf").first()).toBeVisible({ timeout: 15000 });
    await input.setInputFiles({ name: "gross.pdf", mimeType: "application/pdf", buffer: Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(1200 * 1024, 65)]) });
    await expect(page.getByText("gross.pdf").first()).toBeVisible({ timeout: 30000 });

    const neu = (await (await request.get(`${API}/Document`)).json()).filter((d) => !vorher.has(d.id));
    const klein = neu.find((d) => d.name === "klein.pdf"), gross = neu.find((d) => d.name === "gross.pdf");
    expect(klein.data?.startsWith("data:application/pdf")).toBe(true);
    expect(klein.data_blob ?? null).toBe(null);
    expect(gross.data ?? null).toBe(null);
    expect(gross.data_blob).toMatch(/^dok-/);
    const blob = await (await request.get(`/api/blobs/${gross.data_blob}`)).json();
    expect(blob.inhalt.startsWith("data:application/pdf")).toBe(true);

    const [fenster] = await Promise.all([page.waitForEvent("popup"), page.getByText("gross.pdf").first().locator("xpath=ancestor::*[.//button[contains(., 'Öffnen')]][1]").getByRole("button", { name: /Öffnen/ }).click()]);
    await expect(fenster.locator("iframe")).toHaveAttribute("src", /^data:application\/pdf/, { timeout: 15000 });
    expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
  } finally {
    for (const d of await (await request.get(`${API}/Document`)).json()) {
      if (vorher.has(d.id)) continue;
      if (d.data_blob) await request.delete(`/api/blobs/${d.data_blob}`);
      await request.delete(`${API}/Document/${d.id}`);
    }
  }
});
