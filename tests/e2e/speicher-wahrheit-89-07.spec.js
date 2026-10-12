// Headless-Nachweis 89-07 (D-BW-05): „Daten & Sicherung" nennt die Wahrheit dieser Fassung —
// im Dev-Stack (Express) die lokale Datei, nie die Cloud. Konsole sauber.
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";

test("89-07 Einstellungen nennen die lokale Datei als Wahrheit", async ({ page }) => {
  test.setTimeout(90000);
  await nurLocalhost(page);
  const warnungen = [];
  page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text())) warnungen.push(m.text()); });
  await page.goto("/Settings?tab=data");
  const zeile = page.getByTestId("daten-wahrheit");
  await expect(zeile).toContainText("Lokale Datei", { timeout: 20000 });
  await expect(zeile).toHaveAttribute("data-quelle", "lokale-datei");
  await expect(zeile).not.toContainText("Supabase");
  expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
});
