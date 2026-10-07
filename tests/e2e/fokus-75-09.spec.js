// Headless-Nachweis 75-09 (Blatt 07, MS-09): Wohnung 1:50 im WohnungsFokus.
//
// Ablauf der vier Tests (je Task einer, in Plan-Reihenfolge):
//   1. "Innenausbau-Rauchtest" (Task 4) — die geteilte Möbel-Ebene MoebelSchicht
//      rendert den Innenausbau-Reiter unverändert: moeblierungs-plan sichtbar,
//      mp-raum > 0, genau EIN mp-overlay, Konsole sauber.
//   2. "1:50 und Labels" (Task 5) — Chip 1:50|Auto, data-px-je-m ≈ 75,59,
//      5-m-Balken, zoomkonstante Labels in Bildschirm-px (MSB-12/MSB-16).
//   3. "Möbel" (Task 6) — Auto-Möblierung, sperrende Kollision, Tür mit Aufschlag,
//      Querprobe Innenausbau, Reload ohne Speichern = Ausgangszustand.
//   4. "Kennzahlen und Iso" (Task 7) — WoFlV/Bewegungsnachweis/Proportion/
//      Belichtung + Iso der WE (genau EINE mv-3d-Instanz).
//
// Regeln (Lehren 75-05/07/08/11): --workers=1 (die Werkstatt-Specs teilen
// server/db.json) · GL-agnostisch (Canvas ODER mv-fallback, keine Pixelprüfung) ·
// Chips/Umschalter unter der Lehrling-Palette per dispatchEvent("click") ·
// SVG-<line> gelten als hidden → count()/Attribute, nie toBeVisible · SVG-<text>
// → textContent (nicht innerText) · zwei gemountete Pläne (Radix/Fokus) →
// :visible eingrenzen · Werkstatt-Regeln nur über schalteRegel (useFachlayer-
// Ladesperre) · nach dem Spec aufräumen (eigene Möbel entfernen, Regeln zurück) ·
// NIE "Entwurf speichern" klicken (Review Testhaus hat keinen BuildingComplex-
// Datensatz, ComplexDesigner.jsx braucht Name + Standort).

import { test, expect } from "@playwright/test";
import { ERLAUBT_OFFLINE, schalteRegel } from "./fixtures/massing.js";

const SEITE_WERKSTATT = "/ComplexDesigner?projekt=Review%20Testhaus&tab=werkstatt";
const SEITE_INNENAUSBAU = "/ComplexDesigner?projekt=Review%20Testhaus&tab=interiors";

/**
 * Register the offline route guard + console/pageerror watchers.
 * Everything non-localhost is aborted (no network); WebGL/THREE noise is allowed.
 * @param {import("@playwright/test").Page} page
 * @returns {Promise<string[]>} the collected warnings array (empty = clean)
 */
async function wacheAuf(page) {
  await page.route("**/*", (route) => {
    const host = new URL(route.request().url()).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]" ? route.continue() : route.abort();
  });
  const warnungen = [];
  page.on("console", (m) => {
    if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text())) warnungen.push(m.text());
  });
  page.on("pageerror", (e) => { if (!/WebGL|THREE/i.test(String(e))) warnungen.push(`pageerror ${e}`); });
  return warnungen;
}

/**
 * Open the workshop tab and make sure the storey plan is ready:
 * wt-regeln visible, "fenster je Raum" OFF (so the 1/8 daylight check stays an
 * approximation — the focus KPI shows the badge), unit zones present (apply the
 * tesselation when a previous run left them missing), then wait out the
 * useFachlayer save debounce.
 * @param {import("@playwright/test").Page} page
 */
async function werkstattBereit(page) {
  await page.goto(SEITE_WERKSTATT);
  await expect(page.getByTestId("wt-regeln")).toBeVisible({ timeout: 30000 });
  await schalteRegel(page, "fensterJeRaum", false);

  if (!(await page.getByTestId("wt-we").count())) {
    // Store zones are gone after a reload although the layer says "applied":
    // remove first, then re-apply (pattern massing-75-05).
    const anwenden = page.getByRole("button", { name: /Tesselierung anwenden/ });
    await expect(anwenden).toBeVisible({ timeout: 15000 });
    const entfernen = page.getByRole("button", { name: /entfernen/i }).first();
    if ((await anwenden.isDisabled()) && (await entfernen.count())) {
      await entfernen.click();
      await page.waitForTimeout(800);
    }
    for (let i = 0; i < 3 && !(await anwenden.isDisabled()); i += 1) {
      await anwenden.click();
      await page.waitForTimeout(1200);
    }
    await page.waitForTimeout(800);
  }
  // useFachlayer saves debounced ~1.2 s — wait before anything reloads.
  await page.waitForTimeout(1600);
  expect(await page.getByTestId("wt-we").count(), "WE-Zonen vorhanden").toBeGreaterThan(0);
}

/**
 * Open the focus view of the FIRST unit via its deep link (?we=…) — a real click
 * on wt-we would start a drag (the zones are draggable), so the deep link is the
 * reliable way in. Waits for the "Fokusansicht: <we>" heading.
 * @param {import("@playwright/test").Page} page
 * @returns {Promise<string>} the unit key (we)
 */
async function fokusOeffnen(page) {
  await page.waitForTimeout(1500); // storey plan + zones render after the deep-link goto below
  const we = await page.getByTestId("wt-we").first().getAttribute("data-we");
  expect(we, "data-we der ersten WE").toBeTruthy();
  await page.goto(`${SEITE_WERKSTATT}&we=${encodeURIComponent(we)}`);
  await expect(page.getByTestId("wt-regeln")).toBeVisible({ timeout: 30000 });
  await expect(page.getByText(`Fokusansicht: ${we}`).first()).toBeVisible({ timeout: 20000 });
  return we;
}

test.describe("75-09 Wohnung 1:50 im WohnungsFokus", () => {
  test.use({ viewport: { width: 1280, height: 1800 } });
  test.describe.configure({ timeout: 180000 });

  test("Innenausbau-Rauchtest: die geteilte Möbel-Ebene rendert wie vorher", async ({ page }) => {
    const warnungen = await wacheAuf(page);
    await werkstattBereit(page);

    // Interior fit-out tab: the shared layer (MoebelSchicht, prefix "mp") draws
    // the storey plan exactly like the Phase-43 inline version did.
    await page.goto(SEITE_INNENAUSBAU);
    await expect(page.getByTestId("moeblierungs-plan")).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId("mp-overlay")).toHaveCount(1);
    expect(await page.getByTestId("mp-raum").count(), "Räume als Klickflächen").toBeGreaterThan(0);

    expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
  });

  test("1:50 und Labels: Chip fährt den Maßstab an, px-Labels bleiben zoomkonstant", async ({ page }) => {
    const warnungen = await wacheAuf(page);
    await werkstattBereit(page);
    await fokusOeffnen(page);

    const overlay = page.getByTestId("fk-overlay").locator("visible=true").first();

    // Auto is the state on open (today's fit-the-unit view).
    await expect(overlay).toHaveAttribute("data-massstab-fokus", "auto");

    // Labels (MSB-12): at least two, no workshop markers, pairwise non-overlapping.
    const labels = page.locator("[data-testid=wt-fokus] [data-fokus-label]:visible");
    const anzahlLabels = await labels.count();
    expect(anzahlLabels, "zweizeilige Labels").toBeGreaterThanOrEqual(2);
    for (const txt of await labels.evaluateAll((els) => els.map((e) => e.textContent || ""))) {
      expect(txt, `Marker im Label: ${txt}`).not.toContain("·WT");
      expect(txt, `WE-Kürzel im Label: ${txt}`).not.toContain("(WE ");
    }
    const boxen = await labels.evaluateAll((els) => els.map((e) => {
      const r = e.getBoundingClientRect();
      return { x0: r.left, y0: r.top, x1: r.right, y1: r.bottom };
    }));
    for (let i = 0; i < boxen.length; i += 1) {
      for (let j = i + 1; j < boxen.length; j += 1) {
        const a = boxen[i], b = boxen[j];
        const ueber = a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
        expect(ueber, `Labels ${i}/${j} überlappen`).toBe(false);
      }
    }

    // Chip 1:50 (under the Lehrling palette — dispatchEvent, never .click()).
    const chip50 = page.locator('[data-testid="fk-massstab"] button[data-wert="50"]');
    await chip50.dispatchEvent("click");
    await page.waitForTimeout(600); // scale effect + tween-free zoom settle

    // data-px-je-m ≈ pxJeMeter(50) = 96/0.0254/50 ≈ 75.59 (±1.5 %).
    const pxJeM = Number((await overlay.getAttribute("data-px-je-m")).replace(",", "."));
    expect(Math.abs(pxJeM - 75.59) / 75.59, `data-px-je-m ${pxJeM}`).toBeLessThanOrEqual(0.015);

    // 5-m bar: text "5 m" + line length = 5 × pxJeM ± 3 px (attributes are
    // viewBox units → multiply by the live screen scale; SVG <line> counts,
    // never toBeVisible).
    const balken = page.locator('[data-testid="fk-balken"]:visible');
    await expect(balken).toHaveCount(1);
    expect(await balken.locator("text").textContent(), "Balken-Text").toContain("5 m");
    const balkenMasse = await balken.locator("line").evaluateAll((els) => els.map((l) => {
      const r = l.getBoundingClientRect();
      return { breite: r.width, hoehe: r.height };
    }));
    const waagerecht = balkenMasse.filter((m) => m.breite > m.hoehe);
    expect(waagerecht.length, "waagerechte Balkenlinie").toBe(1);
    expect(Math.abs(waagerecht[0].breite - 5 * pxJeM), `Balken ${waagerecht[0].breite}px vs 5×${pxJeM}px`).toBeLessThanOrEqual(3);

    // Zoom-constant labels (MSB-5/12): remember a label's screen height, press
    // BimPlan2D's zoom-in button, assert px/m grew ≈ ×1.2 and the label height
    // stayed the same (±1 px) — boundingBox, NOT computed fontSize (viewBox
    // units shrink with zoom, 75-11 lesson). Pin the label by its ATTRIBUTE
    // (one <text> carries both tspans, so textContent = name + area).
    const label0 = labels.first();
    const attr0 = await label0.getAttribute("data-fokus-label");
    const hoeheVorher = (await label0.boundingBox())?.height;
    expect(hoeheVorher, "Labelhöhe messbar").toBeTruthy();
    await page.locator('[data-testid="wt-fokus"] button[aria-label="Vergrößern"]:visible').dispatchEvent("click");
    await page.waitForTimeout(400);
    const pxJeM2 = Number((await overlay.getAttribute("data-px-je-m")).replace(",", "."));
    expect(Math.abs(pxJeM2 / pxJeM - 1.2), `Zoom-Faktor ${pxJeM2 / pxJeM}`).toBeLessThanOrEqual(0.02);
    const labelNachZoom = page.locator(`[data-testid="wt-fokus"] [data-fokus-label="${attr0}"]:visible`).first();
    const hoeheNachher = (await labelNachZoom.boundingBox())?.height;
    expect(Math.abs((hoeheNachher || 0) - (hoeheVorher || 0)), `Labelhöhe ${hoeheVorher} → ${hoeheNachher} px`).toBeLessThanOrEqual(1);

    // Free zoom ⇒ the honest readout shows "≈ 1:…".
    await expect(page.getByTestId("fk-massstab-ist")).toContainText("≈ 1:");

    // Chip 1:50 again ⇒ back to the chip scale.
    await chip50.dispatchEvent("click");
    await page.waitForTimeout(600);
    const pxJeM3 = Number((await overlay.getAttribute("data-px-je-m")).replace(",", "."));
    expect(Math.abs(pxJeM3 - 75.59) / 75.59, `zurück bei 1:50: ${pxJeM3}`).toBeLessThanOrEqual(0.015);

    expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
  });

  test("Möbel: Auto-Möblierung, Sperre, Tür, Innenausbau-Querprobe, Reload", async ({ page }) => {
    const warnungen = await wacheAuf(page);
    await werkstattBereit(page);
    const we = await fokusOeffnen(page);

    const overlay = page.getByTestId("fk-overlay").locator("visible=true").first();
    const ebene = page.getByTestId("fk-moebel").locator("visible=true").first();

    // Ausgangszustand: die WE hat noch keine Möbel.
    const n0 = await page.getByTestId("fk-item").count();

    // Auto-Möblierung füllt leere Räume deterministisch.
    await page.getByTestId("fk-auto").dispatchEvent("click");
    await page.waitForTimeout(1200);
    const n1 = await page.getByTestId("fk-item").count();
    expect(n1, "Auto legt Möbel an").toBeGreaterThan(n0);
    const bettCount = await page.locator('[data-testid="fk-item"][data-typ="doppelbett"], [data-testid="fk-item"][data-typ="einzelbett"]').count();
    expect(bettCount, "mindestens ein Bett").toBeGreaterThanOrEqual(1);
    await expect(page.getByTestId("fk-warnungen")).toHaveCount(0);
    await expect(page.getByTestId("fk-speicher-hinweis")).toContainText("Entwurf speichern");

    // --- Sperre AN: ein Möbel auf die Bett-Mitte ziehen wird verworfen ---
    const bett = page.locator('[data-testid="fk-item"][data-typ="doppelbett"]').first();
    const ziehAufBett = async () => {
      const quelle = page.locator('[data-testid="fk-item"][data-typ="nachttisch"]').first();
      const b1 = await bett.boundingBox();
      const b2 = await quelle.boundingBox();
      await page.mouse.move(b2.x + b2.width / 2, b2.y + b2.height / 2);
      await page.mouse.down();
      for (let i = 1; i <= 10; i += 1) {
        await page.mouse.move(
          b2.x + b2.width / 2 + ((b1.x + b1.width / 2 - (b2.x + b2.width / 2)) * i) / 10,
          b2.y + b2.height / 2 + ((b1.y + b1.height / 2 - (b2.y + b2.height / 2)) * i) / 10,
        );
        await page.waitForTimeout(25);
      }
      await page.mouse.up();
      await page.waitForTimeout(400);
      return { b1, b2, quelle };
    };

    await ziehAufBett();
    // Das gezogene Möbel steht NICHT auf der Bett-Mitte, keine Kollision markiert,
    // der Sperr-Hinweis nennt den Grund.
    const bettMitte = await bett.boundingBox();
    const ntNachSperre = await page.locator('[data-testid="fk-item"][data-typ="nachttisch"]').first().boundingBox();
    const dist = Math.hypot(
      (ntNachSperre.x + ntNachSperre.width / 2) - (bettMitte.x + bettMitte.width / 2),
      (ntNachSperre.y + ntNachSperre.height / 2) - (bettMitte.y + bettMitte.height / 2),
    );
    expect(dist, `Nachttisch blieb vor dem Bett (Distanz ${dist}px)`).toBeGreaterThan(4);
    await expect(ebene.locator('[data-kollision="1"]')).toHaveCount(0);
    await expect(page.getByTestId("fk-sperre-hinweis")).not.toHaveCount(0);

    // --- Sperre AUS: derselbe Zug landet auf dem Bett → 2 Kollisionen, Warnung ---
    await page.getByTestId("fk-sperre").dispatchEvent("click");
    await page.waitForTimeout(200);
    await ziehAufBett();
    expect(await ebene.locator('[data-kollision="1"]').count(), "beide Möbel rot").toBeGreaterThanOrEqual(2);
    expect(await page.getByTestId("fk-warnungen").count(), "Warnung sichtbar").toBeGreaterThanOrEqual(1);
    // Sperre wieder an (Ausgangszustand für die Folge-Prüfungen).
    await page.getByTestId("fk-sperre").dispatchEvent("click");
    await page.waitForTimeout(200);

    // --- Geometrie bei 1:50: der Bett-Körper misst data-breite/tiefe-m × pxJeM ± 3 px ---
    await page.locator('[data-testid="fk-massstab"] button[data-wert="50"]').dispatchEvent("click");
    await page.waitForTimeout(700);
    const pxJeM = Number((await overlay.getAttribute("data-px-je-m")).replace(",", "."));
    const bettAttrs = await bett.evaluate((e) => ({
      b: Number(e.getAttribute("data-breite-m")),
      t: Number(e.getAttribute("data-tiefe-m")),
    }));
    const koerper = await bett.locator("[data-koerper]").boundingBox();
    expect(Math.abs(koerper.width - bettAttrs.b * pxJeM), `Breite ${koerper.width} vs ${bettAttrs.b * pxJeM}`).toBeLessThanOrEqual(3);
    expect(Math.abs(koerper.height - bettAttrs.t * pxJeM), `Höhe ${koerper.height} vs ${bettAttrs.t * pxJeM}`).toBeLessThanOrEqual(3);

    // --- Tür (MSB-14): Raum anklicken, Katalog-Chip tuer_885 ---
    const bettKey = await bett.getAttribute("data-key");
    await page.locator(`[data-testid="fk-raum"][data-key="${bettKey}"]`).first().dispatchEvent("click");
    await page.waitForTimeout(200);
    await page.locator('button:has([data-katalog-typ="tuer_885"])').first().dispatchEvent("click");
    await page.waitForTimeout(400);
    await expect(ebene.locator("[data-tuer]")).toHaveCount(1);
    await expect(page.locator("[data-tuer-bogen]")).toHaveCount(1);
    const tuerAttrs = await ebene.locator("[data-tuer]").first().evaluate((e) => ({
      tuer: e.getAttribute("data-tuer"), lichte: e.getAttribute("data-lichte"),
    }));
    expect(tuerAttrs.tuer, "Aufschlag links").toBe("links");
    // D-P75-09-A: lichte_m = Rohbaumaß 885 − 25 mm Zargen-/Falzabzug = 0,86.
    expect(tuerAttrs.lichte, "lichte Breite").toBe("0.86");
    // Tür antippen (echter Maus-Tap auf den Tür-Körper-Rect: Auswahl läuft über
    // useSvgDrag onTap = pointerdown/pointerup ohne Bewegung; die <g>-Bbox-Mitte
    // kann im leeren Raum des Aufschlagbogens liegen — SVG-<g> hat keine
    // Trefferfläche, nur seine Kinder; dispatchEvent("click") selektiert NICHT)
    // → Anschlag wechseln → rechts.
    const tuerBox = await ebene.locator("[data-tuer] [data-koerper]").first().boundingBox();
    await page.mouse.move(tuerBox.x + tuerBox.width / 2, tuerBox.y + tuerBox.height / 2);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(300);
    await expect(page.getByTestId("fk-aktionen")).toBeVisible();
    await page.getByTestId("fk-anschlag").dispatchEvent("click");
    await page.waitForTimeout(300);
    await expect(ebene.locator('[data-tuer="rechts"]')).toHaveCount(1);

    // --- Querprobe Innenausbau: jede fk-id existiert als mp-item ---
    const fkIds = await page.getByTestId("fk-item").evaluateAll((els) => els.map((e) => e.getAttribute("data-id")));
    expect(fkIds.length, "fk-Items vorhanden").toBeGreaterThan(0);
    await page.getByTestId("wt-fokus-innenausbau").dispatchEvent("click");
    await expect(page.getByTestId("moeblierungs-plan")).toBeVisible({ timeout: 20000 });
    for (const id of fkIds) {
      expect(await page.locator(`[data-testid="mp-item"][data-id="${id}"]`).count(), `mp-item ${id}`).toBeGreaterThan(0);
    }

    // --- Reload ohne Speichern: WE wieder im Ausgangszustand (ehrlicher Hinweis) ---
    // The spec is now on the interiors tab — go straight back into the focus via
    // the deep link (the workshop zones reload with it; nothing was saved).
    await page.goto(`${SEITE_WERKSTATT}&we=${encodeURIComponent(we)}`);
    await expect(page.getByTestId("wt-regeln")).toBeVisible({ timeout: 30000 });
    await expect(page.getByText(`Fokusansicht: ${we}`).first()).toBeVisible({ timeout: 20000 });
    const n2 = await page.getByTestId("fk-item").count();
    expect(n2, "nach Reload ohne Speichern = Ausgangszahl").toBe(n0);

    expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
  });

  test("Kennzahlen und Iso: WoFlV, Bewegungsnachweis, Proportion, Belichtung, eine mv-3d", async ({ page }) => {
    const warnungen = await wacheAuf(page);
    await werkstattBereit(page); // fensterJeRaum is OFF → daylight stays an approximation
    await fokusOeffnen(page);

    const ebene = page.getByTestId("fk-moebel").locator("visible=true").first();

    // Auto-furnish so the movement-area KPI has content.
    await page.getByTestId("fk-auto").dispatchEvent("click");
    await page.waitForTimeout(1200);

    // WoFlV from the prop (same list as the workshop table — one calc path).
    const woflv = page.getByTestId("fk-kpi-woflv");
    const woflvWert = Number((await woflv.getAttribute("data-wert")).replace(/\./g, "").replace(",", "."));
    expect(woflvWert, "WoFlV > 0").toBeGreaterThan(0);
    expect(await woflv.textContent(), "WoFlV-Text mit m²").toContain("m²");

    // Movement-area compliance: areas > 0, no conflicts after auto-furnishing.
    const bewegung = page.getByTestId("fk-kpi-bewegung");
    expect(Number(await bewegung.getAttribute("data-anzahl")), "Flächen > 0").toBeGreaterThan(0);
    expect(await bewegung.getAttribute("data-konflikte"), "keine Konflikte").toBe("0");

    // Level R deepens the bed's movement area 0.9 → 1.5 (data-tiefe on the band).
    const bettId = await page.locator('[data-testid="fk-item"][data-typ="doppelbett"]').first().getAttribute("data-id");
    const bandVorher = page.locator(`[data-testid="fk-moebel"] [data-bewegung][data-item="${bettId}"]`).first();
    expect(await bandVorher.getAttribute("data-tiefe"), "Standard-Tiefe 0.9").toBe("0.9");
    await page.locator('[data-testid="fk-stufe"] button[data-wert="R"]').dispatchEvent("click");
    await page.waitForTimeout(300);
    expect(await bewegung.getAttribute("data-stufe"), "Stufe R").toBe("R");
    const bandR = page.locator(`[data-testid="fk-moebel"] [data-bewegung][data-item="${bettId}"]`).first();
    expect(await bandR.getAttribute("data-tiefe"), "R-Tiefe 1.5").toBe("1.5");

    // Proportion: one row per focus room; corridor/bath show "—".
    const proportion = page.getByTestId("fk-kpi-proportion");
    const raumZeilen = await proportion.locator("[data-raum]").count();
    const fkRaeume = await page.getByTestId("fk-raum").count();
    expect(raumZeilen, "Proportion-Zeilen = fk-raum").toBe(fkRaeume);
    const ausnahmeZeilen = await proportion.locator('[data-raum="Flur"], [data-raum="Bad"]').all();
    for (const zeile of ausnahmeZeilen) {
      expect((await zeile.textContent()).trim(), "Ausnahme-Raum zeigt —").toContain("—");
    }

    // Daylight KPI present + the approximation badge (window rule OFF).
    await expect(page.getByTestId("fk-kpi-belichtung")).toBeVisible();
    await expect(page.getByTestId("fk-fenster-naeherung")).toBeVisible();

    // Iso: EXACTLY ONE mv-3d on the workshop tab, inside data-iso-fokus, with
    // canvas XOR fallback, and data-iso-fokus-zonen = number of focus rooms.
    await expect(page.getByTestId("mv-3d")).toHaveCount(1);
    const iso = page.locator('[data-iso-fokus="1"]');
    await expect(iso).toHaveCount(1);
    expect(await iso.getByTestId("mv-3d").count(), "mv-3d im Iso-Container").toBe(1);
    const canvas = await iso.locator("canvas").count();
    const fallback = await iso.getByTestId("mv-fallback").count();
    expect(canvas + fallback, "Canvas XOR Fallback").toBe(1);
    // Record which GL branch ran (headless Chromium usually has WebGL via
    // SwiftShader → the canvas branch; the fallback branch stays code-proven).
    test.info().annotations.push({
      type: "gl-zweig",
      description: canvas === 1 ? "WebGL canvas (SwiftShader)" : "mv-fallback (kein WebGL)",
    });
    const zonenZahl = Number(await iso.getByTestId("mv-3d").getAttribute("data-iso-fokus-zonen"));
    expect(zonenZahl, "data-iso-fokus-zonen = fk-raum").toBe(fkRaeume);

    // Clean up: remove the auto items → back to the start count (nothing saved).
    await page.getByTestId("fk-auto-entfernen").dispatchEvent("click");
    await page.waitForTimeout(600);
    expect(await page.getByTestId("fk-item").count(), "Auto-Möbel entfernt").toBe(0);

    expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
  });
});
