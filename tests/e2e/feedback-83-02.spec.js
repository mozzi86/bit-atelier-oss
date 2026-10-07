// Headless proof 83-02: feedback for every build and the registration page.
//
// 1. The header's feedback button opens the dialog; the "Per E-Mail senden" link is a
//    mailto to the app mail with subject "BIT-Atelier Feedback (<version> …)" and a body
//    that carries the typed text plus version and page; unticking the box removes the
//    technical block; "Auf GitHub melden" points at the repository's new-issue page.
//    Nothing is clicked that would leave the app — and no foreign host is contacted.
// 2. /registrieren in the express (dev) build says that the local edition needs no
//    account and links into the app; /anmeldung links to /registrieren.
// 3. The check suite with the sample project (?beispiel=1) offers "Befund besprechen",
//    which opens the same dialog pre-filled with the run's key figures.
//
// Rules (lessons 75-05…75-14): --workers=1 · everything but localhost is blocked ·
// three.js/WebGL page errors are ignored.
//
// Run: npx playwright test tests/e2e/feedback-83-02.spec.js --workers=1

import fs from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";
import { ERLAUBT_OFFLINE } from "./fixtures/massing.js";

const VERSION = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "../../package.json"), "utf8")).version;
const LOKAL = ["localhost", "127.0.0.1", "[::1]"];

/**
 * Block every host but localhost, collect console problems, page errors and
 * every request that tried to reach a foreign host.
 * @param {import("@playwright/test").Page} page
 * @returns {Promise<{warnungen: string[], fremd: string[]}>}
 */
async function wacheAuf(page) {
  const fremd = [];
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (/^(blob|data):/.test(url)) return route.continue();
    if (LOKAL.includes(new URL(url).hostname)) return route.continue();
    fremd.push(url);
    return route.abort();
  });
  const warnungen = [];
  page.on("console", (m) => {
    if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text())) warnungen.push(m.text());
  });
  page.on("pageerror", (e) => { if (!/WebGL|THREE/i.test(String(e))) warnungen.push(`pageerror ${e}`); });
  return { warnungen, fremd };
}

/**
 * Splits a mailto URL into recipient, subject and body (decoded).
 * @param {string} href
 * @returns {{an: string, betreff: string, text: string}}
 */
function mailto(href) {
  const [kopf, abfrage = ""] = href.split("?");
  const p = new URLSearchParams(abfrage.replace(/\+/g, "%2B"));
  return { an: kopf.replace(/^mailto:/, ""), betreff: p.get("subject") || "", text: p.get("body") || "" };
}

test.describe("83-02 Feedback und Registrierung", () => {
  test.use({ viewport: { width: 1400, height: 1000 } });

  test("Feedback-Dialog: mailto mit Version und Seite, GitHub-Link, Häkchen steuert den Technik-Block", async ({ page }) => {
    const { warnungen, fremd } = await wacheAuf(page);
    await page.goto("/Dashboard");

    await page.getByTestId("feedback-knopf").click();
    const dialog = page.getByTestId("feedback-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "Feedback geben" })).toBeVisible();

    await page.getByTestId("feedback-text").fill("Der Knopf X fehlt\nzweite Zeile");
    const vorschau = page.getByTestId("feedback-technik-vorschau");
    await expect(vorschau).toContainText(`Version: ${VERSION}`);
    await expect(vorschau).toContainText("Seite: /Dashboard");

    const mail = mailto(await page.getByTestId("feedback-mail").getAttribute("href"));
    expect(mail.an).toBe("me@bit-atelier.de");
    expect(mail.betreff).toBe(`BIT-Atelier Feedback (${VERSION} (server))`);
    expect(mail.text).toContain("Der Knopf X fehlt\nzweite Zeile");
    expect(mail.text).toContain(`Version: ${VERSION} (server)`);
    expect(mail.text).toContain("Seite: /Dashboard");
    expect(mail.text).toMatch(/Browser: (Chrome|Edge|Firefox|Safari|Opera)/);
    expect(mail.text).toMatch(/Betriebssystem: \S+/);

    const github = await page.getByTestId("feedback-github").getAttribute("href");
    expect(github.startsWith("https://github.com/mozzi86/bit-atelier-oss/issues/new?title=")).toBe(true);
    const gp = new URL(github).searchParams;
    expect(gp.get("title")).toBe("Der Knopf X fehlt");
    expect(gp.get("body")).toContain("Seite: /Dashboard");
    await expect(page.getByTestId("feedback-github")).toHaveAttribute("target", "_blank");
    await expect(page.getByTestId("feedback-github")).toHaveAttribute("rel", /noopener/);

    // Unticked: nothing technical travels, the preview disappears.
    await page.getByTestId("feedback-technik").uncheck();
    await expect(vorschau).toHaveCount(0);
    const ohne = mailto(await page.getByTestId("feedback-mail").getAttribute("href"));
    expect(ohne.text).toBe("Der Knopf X fehlt\nzweite Zeile");
    expect(new URL(await page.getByTestId("feedback-github").getAttribute("href")).searchParams.get("body"))
      .toBe("Der Knopf X fehlt\nzweite Zeile");

    // A different page names itself.
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await page.goto("/Projects");
    await page.getByTestId("feedback-knopf").click();
    await expect(page.getByTestId("feedback-technik-vorschau")).toContainText("Seite: /Projects");

    expect(fremd, "keine Netzanfrage nach außen").toEqual([]);
    expect(warnungen, warnungen.join("\n")).toEqual([]);
  });

  test("/registrieren in der express-Fassung: Hinweis statt Formular, kein Netzaufruf nach außen", async ({ page }) => {
    const { warnungen, fremd } = await wacheAuf(page);
    await page.goto("/registrieren");
    const hinweis = page.getByTestId("registrieren-lokal");
    await expect(hinweis).toBeVisible();
    await expect(hinweis).toContainText("Die lokale Fassung braucht kein Konto — einfach loslegen.");
    await expect(page.getByTestId("registrieren-formular")).toHaveCount(0);
    await expect(page).toHaveTitle(/Registrieren/);

    await hinweis.getByRole("link", { name: "Zur Startseite" }).click();
    await expect(page).toHaveURL(/\/Dashboard$/);

    // The login page links to the registration.
    await page.goto("/anmeldung");
    await page.getByTestId("anmeldung-registrieren").getByRole("link", { name: "Registrieren" }).click();
    await expect(page).toHaveURL(/\/registrieren$/);
    await expect(page.getByTestId("registrieren-lokal")).toBeVisible();

    expect(fremd, "keine Netzanfrage nach außen").toEqual([]);
    expect(warnungen, warnungen.join("\n")).toEqual([]);
  });

  test("Prüf-Suite mit Musterprojekt: „Befund besprechen“ öffnet den Feedback-Dialog mit den Kennzahlen", async ({ page }) => {
    test.setTimeout(180000);
    const { warnungen, fremd } = await wacheAuf(page);
    await page.goto("/ModelCheck?beispiel=1");

    const knopf = page.getByTestId("befund-besprechen");
    await expect(knopf).toBeVisible({ timeout: 120000 });
    await knopf.click();
    await expect(page.getByTestId("feedback-dialog")).toBeVisible();
    const text = await page.getByTestId("feedback-text").inputValue();
    expect(text).toContain("Ich möchte ein Ergebnis der Prüf-Suite besprechen.");
    expect(text).toMatch(/Bauteile mit Geometrie: [1-9]\d*/);
    expect(text).toContain("(Musterprojekt)");
    await expect(page.getByTestId("feedback-technik-vorschau")).toContainText("Seite: /ModelCheck");

    expect(fremd, "keine Netzanfrage nach außen").toEqual([]);
    expect(warnungen, warnungen.join("\n")).toEqual([]);
  });
});
