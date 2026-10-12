// Headless-Nachweis 92-04 (Änderungen im Update-Hinweis, Update-Einstellungen): der Update-Server wird über
// page.route simuliert (die Server-Seite deckt der Unit-Test selbstUpdate-9204 ab).
//  1. Banner zeigt die ersten drei Zeilen der Änderungen; „Alle Änderungen“ klappt die ganze Liste mit
//     Überschriften auf.
//  2. Eine festgehaltene Fassung zeigt kein Banner.
//  3. Einstellungen › System & Info: installierte/neueste Fassung, letzte Prüfung, „Jetzt prüfen“ fragt mit
//     ?frisch=1, „Fassung festhalten bis“ schickt das Datum per PUT. Konsole sauber.
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";

const AENDERUNGEN = "### Neu\n\n- Punkt eins\n- Punkt zwei\n- Punkt drei\n- Punkt vier\n\n### Behoben\n\n- Fehler weg";
const INFO = {
  aktuell: "1.1.0", neueste: "1.2.0", verfuegbar: true, installierbar: true, sperre: null, aenderungen: AENDERUNGEN,
  seite: "https://github.com/x/y/releases/tag/v1.2.0", datum: "2026-11-02T10:00:00Z", groesse: 10_000_000,
  festgehalten: false, letztePruefung: "2026-11-02T09:30:00Z", einstellungen: { automatisch: true, festhaltenBis: null }, deaktiviert: false,
};

test.describe("92-04 Änderungen im Update-Hinweis + Update-Einstellungen", () => {
  test.setTimeout(120000);

  test("Banner zeigt drei Zeilen, „Alle Änderungen“ klappt auf", async ({ page }) => {
    await nurLocalhost(page);
    const warnungen = [];
    page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text())) warnungen.push(m.text()); });
    await page.route("**/api/update", (r) => r.fulfill({ json: INFO }));
    await page.goto(`/AddressBook?projekt=${encodeURIComponent("Review Testhaus")}`);
    const liste = page.getByTestId("upd-aenderungen");
    await expect(liste).toBeVisible({ timeout: 20000 });
    await expect(liste.locator("li")).toHaveText(["Punkt eins", "Punkt zwei", "Punkt drei"]);
    await page.getByTestId("upd-alle-aenderungen").click();
    const voll = page.getByTestId("upd-aenderungen-voll");
    await expect(voll).toContainText("Punkt vier");
    await expect(voll).toContainText("Behoben");
    await expect(voll).toContainText("Fehler weg");
    await expect(page.getByTestId("upd-alle-aenderungen")).toHaveAttribute("aria-expanded", "true");
    expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
  });

  test("festgehaltene Fassung: kein Banner", async ({ page }) => {
    await nurLocalhost(page);
    let abgefragt = 0;
    await page.route("**/api/update", (r) => { abgefragt += 1; return r.fulfill({ json: { ...INFO, festgehalten: true, installierbar: false, sperre: "Fassung festgehalten bis 01.12.2026 (Einstellungen › System & Info)." } }); });
    await page.goto(`/AddressBook?projekt=${encodeURIComponent("Review Testhaus")}`);
    await expect.poll(() => abgefragt, { timeout: 20000 }).toBeGreaterThan(0);
    await page.waitForTimeout(1000);
    await expect(page.getByTestId("upd-banner")).toHaveCount(0);
  });

  test("Einstellungen: Fassung, letzte Prüfung, Jetzt prüfen, Festhalten per PUT", async ({ page }) => {
    await nurLocalhost(page);
    const warnungen = [];
    page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text())) warnungen.push(m.text()); });
    let frisch = 0;
    /** @type {any} */
    let gesendet = null;
    let einst = { automatisch: true, festhaltenBis: null };
    await page.route("**/api/update?frisch=1", (r) => { frisch += 1; return r.fulfill({ json: { ...INFO, einstellungen: einst } }); });
    await page.route("**/api/update", (r) => r.fulfill({ json: { ...INFO, einstellungen: einst, festgehalten: Boolean(einst.festhaltenBis) } }));
    await page.route("**/api/update/einstellungen", async (r) => {
      gesendet = r.request().postDataJSON();
      einst = { ...einst, ...gesendet };
      return r.fulfill({ json: { ...einst, deaktiviert: false } });
    });
    await page.goto("/Settings?tab=system");
    const karte = page.getByTestId("upd-einstellungen");
    await expect(karte).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId("upd-aktuell")).toContainText("1.1.0");
    await expect(page.getByTestId("upd-neueste")).toContainText("1.2.0");
    await expect(page.getByTestId("upd-letzte-pruefung")).not.toHaveText("noch nicht");
    await page.getByTestId("upd-jetzt-pruefen").click();
    await expect.poll(() => frisch).toBe(1);
    // The fresh check reloads the settings and resets the date field — wait until it is done before typing.
    await expect(page.getByTestId("upd-jetzt-pruefen")).toBeEnabled();
    await page.getByTestId("upd-festhalten-datum").fill("2026-12-01");
    await page.getByTestId("upd-festhalten-speichern").click();
    await expect.poll(() => gesendet?.festhaltenBis).toBe("2026-12-01");
    await expect(page.getByTestId("upd-festhalten-aufheben")).toBeVisible();
    // Controlled checkbox: it flips only after the server answered — click, then wait for the new state.
    await page.getByTestId("upd-automatisch").click();
    await expect.poll(() => gesendet?.automatisch).toBe(false);
    await expect(page.getByTestId("upd-automatisch")).not.toBeChecked();
    expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
  });
});
