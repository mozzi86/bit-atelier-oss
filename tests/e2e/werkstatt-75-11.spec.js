// Headless-Nachweis 75-11 (MSB-13 + MSB-5): Fenster je Raum + Labels in px.
// 1. Ausgangszustand: Regel-Schalter AUS -> wt-fenster count() === 0,
//    Badge wt-fenster-naeherung sichtbar.
// 2. Schalter an -> Ticks in der Wand (count() > 0, SVG-Linien gelten bei
//    Playwright als hidden -> zaehlen, nie toBeVisible), Badge verschwindet.
// 3. Kein Fenster ueber einer Trennwand: je Tick genau ein data-raum, jeder
//    Raumwert eine ·WT-Zone; mindestens zwei Raeume versorgt.
// 4. Labels (MSB-5): data-plan-label Schriftgroesse in CSS-px bei Zoom 1 und
//    nach 3x Vergroessern gleich (±1 px); paarweiser Bbox-Schnitt der
//    sichtbaren Labels leer; kein Label enthaelt "·WT" oder "(WE ".
// 5. Belichtungs-Check-Karte bleibt bedienbar (kein NaN).
// 6. Konsole sauber; Schalter am Ende zurueck (Lehre 75-07).
// Netz: alles ausser localhost geblockt (Muster 75-07).

import { test, expect } from "@playwright/test";
import { ERLAUBT_OFFLINE, schalteRegel } from "./fixtures/massing.js";

const SEITE = "/ComplexDesigner?projekt=Review%20Testhaus&tab=werkstatt";
const REGELN = ["mindestbreiten", "himmelsrichtung", "phi", "wandstaerken", "rettungsweg", "fensterJeRaum"];

test.describe("75-11 Fenster je Raum + Labels in px (Werkstatt)", () => {
  test.use({ viewport: { width: 1280, height: 1800 } });
  test.describe.configure({ timeout: 180000 });

  test("Schalter, Ticks je Raum, Naeherungs-Badge, px-Labels ohne Ueberlappung", async ({ page }) => {
    await page.route("**/*", (route) => {
      const host = new URL(route.request().url()).hostname;
      return host === "localhost" || host === "127.0.0.1" || host === "[::1]" ? route.continue() : route.abort();
    });
    const warnungen = [];
    page.on("console", (m) => {
      if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text())) warnungen.push(m.text());
    });
    page.on("pageerror", (e) => { if (!/WebGL|THREE/i.test(String(e))) warnungen.push(`pageerror ${e}`); });

    await page.goto(SEITE);
    await expect(page.getByTestId("wt-regeln")).toBeVisible({ timeout: 30000 });

    // Ausgangszustand: ALLE Regel-Schalter aus (ein abgebrochener Lauf kann
    // Schalter im Layer lassen — Lehre 75-07).
    for (const k of REGELN) {
      // useFachlayer verwirft Klicks, solange der Layer lädt — schalteRegel
      // wiederholt, bis der Zustand hält (Review 23.09., erster roter Lauf).
      await schalteRegel(page, k, false);
    }
    await page.waitForTimeout(500);

    // 1) Regel aus: keine Ticks, Badge sichtbar (Ehrlichkeit: Naeherung).
    await expect(page.getByTestId("wt-fenster")).toHaveCount(0);
    await expect(page.getByTestId("wt-fenster-naeherung")).toBeVisible();

    // 2) Schalter an: Ticks erscheinen, Badge verschwindet.
    await schalteRegel(page, "fensterJeRaum", true);
    await expect.poll(() => page.getByTestId("wt-fenster").count(), { timeout: 15000 }).toBeGreaterThan(0);
    await expect(page.getByTestId("wt-fenster-naeherung")).toHaveCount(0);

    // 3) Je Tick genau EIN data-raum (kein Fenster ueber einer Trennwand),
    //    Raumwerte sind ·WT-Zonen, mindestens zwei Raeume versorgt.
    const raeume = await page.getByTestId("wt-fenster").evaluateAll((els) =>
      els.map((e) => ({ raum: e.getAttribute("data-raum"), breite: Number(e.getAttribute("data-breite")) })));
    expect(raeume.length, "Ticks vorhanden").toBeGreaterThan(0);
    for (const r of raeume) {
      expect(r.raum, `data-raum fehlt: ${JSON.stringify(r)}`).toBeTruthy();
      expect(r.raum.endsWith("·WT"), `kein ·WT-Raum: ${r.raum}`).toBeTruthy();
      expect(Number.isFinite(r.breite) && r.breite >= 0.6 - 1e-9, `Breite unter Minimum: ${r.breite}`).toBeTruthy();
    }
    const eindeutig = new Set(raeume.map((r) => r.raum));
    expect(eindeutig.size, "versorgte Raeume").toBeGreaterThanOrEqual(2);

    // 4) Labels in Bildschirm-px (MSB-5): die GERENDERTE Hoehe bleibt
    //    zoomunabhaengig. getComputedStyle().fontSize liefert viewBox-Einheiten
    //    (px() schrumpft sie mit wachsendem Zoom) — deshalb die echte
    //    Client-Bbox messen: renderedHeight = viewBox-Hoehe · renderedScale,
    //    und die hebt den Zoom exakt auf (Beweis der px()-Konstruktion).
    //    WICHTIG: (a) die Werkstatt haelt einen ZWEITEN (versteckten)
    //    BimPlan2D der Fokusansicht gemountet — strikt auf SICHTBARE Labels
    //    eingrenzen (Radix-Falle); (b) data-plan-label sind SVG-<text> —
    //    KEIN HTMLElement, innerText() wirft „Node is not an HTMLElement";
    //    textContent/allTextContents verwenden.
    const labels = page.locator("[data-plan-label]:visible");
    const planSvg = page.locator("svg[viewBox]:visible").first();
    await planSvg.scrollIntoViewIfNeeded();
    await expect(labels.first()).toBeVisible({ timeout: 15000 });
    // Dasselbe Label vor/nach dem Zoom messen (die Kollisionspruefung kann die
    // SICHTBARE Menge aendern — .first() zeigt danach auf einen anderen Raum):
    // Label ueber seinen vollen Text fixieren (zweizeilig: Name + Flaeche,
    // textContent = eine Zeile ohne Umbruch).
    const messText = ((await labels.first().textContent()) || "").trim();
    expect(messText.length, "Label-Text gelesen").toBeGreaterThan(0);
    const messLabel = page.locator("[data-plan-label]:visible").filter({ hasText: messText }).first();
    await expect(messLabel).toBeVisible();
    const hoeheVorher = (await messLabel.boundingBox()).height;
    const vergroessern = page.getByRole("button", { name: "Vergrößern" }).locator("visible=true").first();
    for (let i = 0; i < 3; i += 1) { await vergroessern.click(); await page.waitForTimeout(250); }
    await expect(messLabel).toBeVisible();
    const hoeheNachher = (await messLabel.boundingBox()).height;
    expect(Math.abs(hoeheNachher - hoeheVorher), `Label-Hoehe ${hoeheVorher} -> ${hoeheNachher} px`).toBeLessThanOrEqual(1);

    // Kein Label enthaelt den ·WT-Marker oder das (WE …)-Suffix (MSB-12).
    const texte = await labels.allTextContents();
    expect(texte.length).toBeGreaterThan(0);
    for (const tx of texte) {
      expect(tx, `Marker im Label: ${tx}`).not.toContain("·WT");
      expect(tx, `WE-Suffix im Label: ${tx}`).not.toContain("(WE ");
    }

    // Paarweiser Bbox-Schnitt der SICHTBAREN Labels ist leer (Kollision).
    const boxes = [];
    for (let i = 0; i < texte.length; i += 1) {
      const b = await labels.nth(i).boundingBox();
      if (b && b.width > 0 && b.height > 0) boxes.push(b);
    }
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i], c = boxes[j];
        const ueberlappt = a.x < c.x + c.width && a.x + a.width > c.x && a.y < c.y + c.height && a.y + a.height > c.y;
        expect(ueberlappt, `Labels ${i}/${j} ueberlappen`).toBe(false);
      }
    }

    // 5) Belichtungs-Check-Karte bleibt bedienbar, kein NaN.
    const checkKarte = page.getByTestId("wt-check-card");
    await expect(checkKarte).toBeVisible();
    expect(await checkKarte.innerText()).not.toContain("NaN");

    // 6) Raeume ohne Regelfenster erscheinen als Hinweiszeilen (falls es sie
    //    gibt) — Form wie die 75-07-Hinweise: Raum + Grund, kein leerer Text.
    const fensterHinweise = await page.locator("[data-fenster-hinweis]").allInnerTexts();
    for (const h of fensterHinweise) expect(h.length).toBeGreaterThan(20);

    // Aufraeumen: Schalter zurueck (Layer des Testprojekts bleibt im
    // Ausgangszustand — Lehre 75-07), dann Konsole pruefen.
    await schalteRegel(page, "fensterJeRaum", false);
    await page.waitForTimeout(400);
    await expect(page.getByTestId("wt-fenster")).toHaveCount(0);
    await expect(page.getByTestId("wt-fenster-naeherung")).toBeVisible();

    expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
  });
});
