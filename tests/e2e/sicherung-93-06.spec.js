// Phase 93 (93-06, lever 161): automatic local backup in Settings › "Daten & Sicherung" against the REAL
// Express dev stack (server/sicherung.js writes into server/sicherungen/ of this checkout, gitignored).
//  1. The card shows the folder and the retention; "Jetzt sichern" sends the real POST, the status names
//     the new zip, the "last backup" line is filled and the server lists one more backup.
//  2. The wrong pointer to backup-export.ps1 (operator script, not in the open-source app) is gone; the
//     restore hint is there. English labels, console clean.
// Zips created by this test are removed in `finally` (those of the server's own start-up backup stay).
import fs from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";

test("Automatische Sicherung: Karte, „Jetzt sichern“, kein Verweis auf backup-export.ps1, Englisch", async ({ page, request }) => {
  test.setTimeout(120000);
  const vorher = await (await request.get("/api/system/sicherung")).json();
  expect(vorher.ordner, "Sicherungsstatus fehlt").toBeTruthy();
  const zipsVorher = new Set(fs.existsSync(vorher.ordner) ? fs.readdirSync(vorher.ordner) : []);

  try {
    await nurLocalhost(page);
    const konsole = [];
    page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text())) konsole.push(m.text()); });
    page.on("pageerror", (e) => konsole.push(`pageerror ${e}`));

    await page.goto("/Settings?tab=data");
    const karte = page.getByTestId("auto-sicherung");
    await expect(karte).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId("auto-sicherung-ordner")).toHaveText(vorher.ordner);
    await expect(karte).toContainText("7 tägliche und 4 wöchentliche");
    await expect(page.getByTestId("bereich-data")).not.toContainText("backup-export.ps1");
    await expect(page.getByTestId("daten-sicherung-hinweis")).toContainText("in den Datenordner entpacken");

    await page.getByTestId("auto-sicherung-jetzt").click();
    await expect(page.getByTestId("auto-sicherung-status")).toContainText("bit-atelier-", { timeout: 20000 });
    await expect(page.getByTestId("auto-sicherung-letzte")).not.toContainText("noch keine");
    const nachher = await (await request.get("/api/system/sicherung")).json();
    expect(nachher.letzte?.name).toMatch(/^bit-atelier-\d{4}-\d{2}-\d{2}T[\d-]+Z\.zip$/);
    expect(fs.existsSync(path.join(nachher.ordner, nachher.letzte.name))).toBe(true);
    expect(nachher.letzterFehler).toBeNull();

    await page.addInitScript(() => { try { localStorage.setItem("lang", "en"); } catch { /* storage blocked */ } });
    await page.reload();
    await expect(page.getByTestId("auto-sicherung")).toContainText("Automatic backup", { timeout: 20000 });
    await expect(page.getByTestId("auto-sicherung-jetzt")).toHaveText("Back up now");

    expect(konsole, `Konsole: ${konsole.join(" | ")}`).toEqual([]);
  } finally {
    if (fs.existsSync(vorher.ordner)) {
      for (const name of fs.readdirSync(vorher.ordner)) {
        if (!zipsVorher.has(name) && name.startsWith("bit-atelier-")) fs.rmSync(path.join(vorher.ordner, name), { force: true });
      }
    }
  }
});
