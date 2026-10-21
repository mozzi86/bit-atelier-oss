// Headless-Nachweis 104-02 (Teil 2): Befehle tippen im Massing-Studio — ohne laufenden Befehl gehen Buchstaben in
// die Befehlszeile; „pp“ + Enter startet Push/Pull, im Leerlauf wiederholt Enter den letzten Befehl, ein unbekannter
// Befehl meldet sich im Klartext; die Befehlszeile schlägt Befehlsnamen vor. Testhaus, nichts wird gespeichert.
import { test, expect } from "./fixtures/base.js";
import { nurLocalhost } from "./fixtures/massing.js";

test("104-02 Befehl tippen: pp → Push/Pull, Enter wiederholt, xyz → unbekannt", async ({ page }) => {
  test.setTimeout(120000);
  await nurLocalhost(page);
  await page.goto("/ComplexDesigner?projekt=Review%20Testhaus&tab=studio");
  await expect(page.getByTestId("mm-leiste")).toBeVisible({ timeout: 60000 });
  const zeile = page.getByTestId("befehlszeile");
  const beenden = async () => {
    const flaeche = page.getByTestId("mm-flaeche");
    await flaeche.scrollIntoViewIfNeeded();
    await flaeche.click({ button: "right", position: { x: 40, y: 40 } });
    await page.getByTestId("mm-kontextmenue").getByRole("menuitem", { name: /Befehl beenden/ }).click();
    await expect(page.getByTestId("mm-leiste")).toHaveAttribute("data-werkzeug", "aus");
    await page.evaluate(() => /** @type {HTMLElement} */ (document.activeElement)?.blur());
  };

  await page.getByTestId("mm-linie").click();
  await beenden();
  await expect(page.getByTestId("mm-eingabe")).toHaveAttribute("list", "mm-eingabe-vorschlaege");
  await page.keyboard.type("pp");
  await expect(page.getByTestId("mm-eingabe")).toHaveValue("pp");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("mm-leiste")).toHaveAttribute("data-werkzeug", "pushpull");
  await expect(zeile).toHaveAttribute("data-befehl", /Push/);

  await beenden();
  await page.keyboard.press("Enter"); // idle: repeat the last command
  await expect(page.getByTestId("mm-leiste")).toHaveAttribute("data-werkzeug", "pushpull");

  await beenden();
  await page.keyboard.type("xyz");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("mm-meldung")).toContainText("Befehl unbekannt");
});
