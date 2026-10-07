// Headless-Nachweis 75-06 (MS-06): Flurstueck != Baufeld != Baukoerper.
// 1. MSB-9: nach echtem page.reload() auf ?tab=studio sind die WE-Labels da,
//    OHNE "Tesselierung anwenden" zu druecken; der amber Streifen fehlt.
// 2. GeoJSON-Import der Flurstuecke im Baufeld-Planung-Reiter (sd-geojson).
// 3. Ebenen-Reiter: Griffe wandern auf das Baufeld (5 Ecken) und zurueck (4).
// 4. Ausserhalb: Baukörper ragt ueber die Baufeld-Kante -> data-ausserhalb +
//    KPI mit Zahl > 0 (Handrechnung ~325 m²); rote Schraffur (konvexes Baufeld).
// 5. Raster-Chip dreht NUR die Rastergruppe — Polygon-points byte-gleich.
// 6. Nordwinkel: Layer-Wert 0 gewinnt (D-P75-05) -> Projektfeld disabled.
// 7. Konsole sauber (ERLAUBT_OFFLINE).
//
// Zustand: das Testprojekt hat KEINEN BuildingComplex-Datensatz — die Spec
// legt einen per API an (Standort + generische Parzelle + Baufeld-Polygon)
// und loescht ihn im finally wieder (server/db.json bleibt im Ausgangszustand;
// Reload-Tests persistieren ueber die API, nie per Datei-Edit).

import { test, expect } from "@playwright/test";
import path from "node:path";
import { ERLAUBT_OFFLINE, resetRechteck, messen, nurLocalhost } from "./fixtures/massing.js";

const PROJEKT = "Review Testhaus";
const STUDIO = `/ComplexDesigner?projekt=${encodeURIComponent(PROJEKT)}&tab=studio`;
const BAUFELD_REITER = `/ComplexDesigner?projekt=${encodeURIComponent(PROJEKT)}&tab=massing`;
const GEOJSON_DATEI = path.join("tests", "e2e", "fixtures", "flurstueck.geojson");

// Standort Nuernberg — dieselben Koordinaten wie die Fixture-Datei.
const LOC = { lat: 49.4521, lng: 11.0767 };

// Generisches Startquadrat (Canvas-Px um 600/400, m_per_px 1.25 wie
// buildSiteParcel). 80 px Kante = 100 m -> Diagonale 141 m -> Auto-Massstab
// 1:200 (WE-Labels sichtbar, lodFuer). Wird durch den GeoJSON-Import von der
// Flurstuecks-Huelle ersetzt (source "generisch" != "gezeichnet").
const START_PARZELLE = {
  id: "site_parcel_main",
  type: "site_boundary",
  assumed: true,
  source: "generisch",
  m_per_px: 1.25,
  points: [
    { x: 560, y: 360 }, { x: 640, y: 360 }, { x: 640, y: 440 }, { x: 560, y: 440 },
  ],
};

// Baufeld-Pentagon in Canvas-Px (konvex — echte m²-Differenz moeglich).
// Nach dem Import liegt die Flurstuecks-Huelle bei px 571..629 x 355..445
// (Site-Meter 72.5 x 112.5, Zentroid 600/400); das Pentagon deckt in
// Site-Metern (20,16.25)-(45,43.75) ab. Der per resetRechteck gesetzte
// Baukörper (10,10)-(40,30) ragt links und unten heraus:
// Schnitt = x[20,40]·y[16.25,30] = 275 m² -> ausserhalb = 600 − 275 = 325 m².
const BAUFELD_PX = [
  { x: 587, y: 368 }, { x: 607, y: 368 }, { x: 607, y: 384 }, { x: 597, y: 390 }, { x: 587, y: 384 },
];

test.describe("75-06 — Flurstueck, Baufeld, Baukoerper (MS-06)", () => {
  test.use({ viewport: { width: 1280, height: 1800 } });
  test.describe.configure({ timeout: 240000 });

  test("MSB-9 Reload, GeoJSON-Import, Ebenen, Ausserhalb-KPI, Raster-Chip", async ({ page }) => {
    await nurLocalhost(page);
    const warnungen = [];
    page.on("pageerror", (e) => {
      const stack = e.stack || String(e);
      if (/WebGLProgram|getUniforms|WebGLRenderer/.test(stack)) return;
      warnungen.push(`[pageerror] ${stack.split("\n").slice(0, 4).join(" | ")}`);
    });
    page.on("console", (m) => {
      // "Unable to perform style diff: Style is not done loading" ist eine
      // MapLibre-interne Warnung der Lageplan-Karte, weil der Route-Guard den
      // Kartenstil blockt (offline) — kein App-Fehler (Muster 75-05/07:
      // ERLAUBT_OFFLINE + Karten-Stil-Rauschen).
      const text = m.text();
      if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(text) && !/style diff|Style is not done loading/i.test(text)) warnungen.push(text);
    });

    // --- Setup: Projekt-ID aufloesen, BuildingComplex per API anlegen --------
    const projekte = await (await page.request.get("api/entities/Project")).json();
    const projekt = projekte.find((p) => p?.name === PROJEKT);
    expect(projekt?.id, `Projekt ${PROJEKT} in der db`).toBeTruthy();
    const angelegt = await page.request.post("api/entities/BuildingComplex", {
      data: {
        project_id: projekt.id,
        name: PROJEKT,
        location: { ...LOC, address: "Nuernberg" },
        site_parcel: START_PARZELLE,
        designated_areas: [{ id: "bf_test_7506", type: "baufeld", points: BAUFELD_PX }],
        map_context: { center: [LOC.lat, LOC.lng], zoom: 16, style: "normal" },
      },
    });
    expect(angelegt.ok(), "BuildingComplex anlegen").toBeTruthy();
    const datensatzId = (await angelegt.json())?.id;
    expect(datensatzId, "Datensatz-ID").toBeTruthy();

    try {
      // --- 1) MSB-9: echter Reload auf ?tab=studio --------------------------
      // werkstatt_layer.angewendet ist true (db.json), die Zonen leben nur im
      // Store — nach dem Reload muessen die WE-Labels OHNE Klick da sein.
      await page.goto(STUDIO);
      await expect(page.getByRole("heading", { name: "Komplex-Designer" })).toBeVisible({ timeout: 30000 });
      await page.locator('polygon[data-griff="flaeche"]').scrollIntoViewIfNeeded();
      await page.reload();
      await expect(page.locator('polygon[data-griff="flaeche"]')).toBeVisible({ timeout: 30000 });
      await page.locator('polygon[data-griff="flaeche"]').scrollIntoViewIfNeeded();
      await expect.poll(() => page.locator("[data-we-label]").count(), {
        timeout: 20000,
        message: "MSB-9: WE-Labels nach Reload ohne 'Tesselierung anwenden'",
      }).toBeGreaterThan(0);
      await expect(page.locator("[data-msb9-hinweis]")).toHaveCount(0);

      // --- 2) GeoJSON-Import im Baufeld-Planung-Reiter ----------------------
      await page.goto(BAUFELD_REITER);
      await expect(page.getByTestId("sd-geojson")).toBeVisible({ timeout: 30000 });
      await page.getByTestId("sd-geojson").setInputFiles(GEOJSON_DATEI);
      const zeilen = page.getByTestId("sd-flurstuecke").locator("div.flex");
      await expect(zeilen).toHaveCount(1, { timeout: 10000 });
      await expect(zeilen.first()).toContainText("1234/5");
      await expect(zeilen.first()).toContainText("Nürnberg"); // Gemarkung aus der Fixture
      // Saubere Datei -> keine Warnbox.
      await expect(page.getByTestId("sd-geojson-warnung")).toHaveCount(0);
      // Ehrlichkeits-Satz: Import ist erst mit "Entwurf speichern" dauerhaft.
      await expect(page.getByTestId("sd-geojson-block")).toContainText("Entwurf speichern");
      // Speichern (Pflichtfelder Name + Standort sind gesetzt).
      await page.getByRole("button", { name: /Entwurf speichern/ }).click();
      await page.waitForTimeout(800);

      // --- Zurueck ins Studio: Ebene + KPIs nach dem Import -----------------
      await page.goto(STUDIO);
      await expect(page.locator('polygon[data-griff="flaeche"]')).toBeVisible({ timeout: 30000 });
      await page.locator('polygon[data-griff="flaeche"]').scrollIntoViewIfNeeded();

      // KPI Grundstueck nennt die Quelle "Flurstuecke" (MSB-2: Polygonbezug).
      const kpiGrund = page.getByTestId("ms-kpi-grundstueck");
      await expect(kpiGrund).toContainText("Flurstücke");
      // Huelle 72.5 x 112.5 m = 8156 m² (Handrechnung, gerundet). de-DE
      // thousand separator "." must go before Number().
      const grundText = await kpiGrund.innerText();
      const grundZahl = Number((((grundText.match(/([\d.]+)\s*m²/) || [])[1] || "0").replace(/\./g, "")));
      expect(Math.abs(grundZahl - 8156), `Grundstuecksflaeche ${grundZahl}`).toBeLessThan(50);

      // --- 3) Ebenen-Reiter: Griffe wandern --------------------------------
      await expect(page.locator("[data-baufeld]")).toHaveCount(1);
      // Baukoerper aktiv (Default): 4 Eckgriffe, kein data-ebene-aktiv-Polygon.
      await expect(page.locator('[data-griff="ecke"]')).toHaveCount(4);
      await expect(page.locator("[data-ebene-aktiv]")).toHaveCount(0);
      // Baufeld-Ebene: aktives Polygon ist das Pentagon (5 Ecken).
      await page.locator('[data-ebene="baufeld"]').click();
      await expect(page.locator('[data-ebene-aktiv="baufeld"]')).toHaveCount(1);
      await expect(page.locator('[data-griff="ecke"]')).toHaveCount(5);
      // Grundstueck-Ebene: ein Flurstueck -> direkt editierbar (4 Ecken).
      await page.locator('[data-ebene="grundstueck"]').click();
      await expect(page.locator('[data-ebene-aktiv="grundstueck"]')).toHaveCount(1);
      await expect(page.locator('[data-griff="ecke"]')).toHaveCount(4);
      // Zurueck zum Baukoerper.
      await page.locator('[data-ebene="baukoerper"]').click();
      await expect(page.locator("[data-ebene-aktiv]")).toHaveCount(0);
      await expect(page.locator('[data-griff="ecke"]')).toHaveCount(4);

      // --- 4) Ausserhalb: Baukörper ueber die Baufeld-Kante -----------------
      const m0 = await resetRechteck(page); // (10,10)-(40,30) = 30 x 20 m
      expect(m0.n).toBe(4);
      await expect(page.locator("[data-ausserhalb]")).toHaveCount(1);
      const kpiAussen = page.getByTestId("ms-kpi-ausserhalb");
      await expect(kpiAussen).toBeVisible();
      const aussenText = await kpiAussen.innerText();
      const aussenZahl = Number((((aussenText.match(/([\d.]+)\s*m²/) || [])[1] || "0").replace(/\./g, "")));
      expect(aussenZahl, `KPI ausserhalb: ${aussenText}`).toBeGreaterThan(100);
      expect(Math.abs(aussenZahl - 325), `ausserhalb ${aussenZahl} statt ~325`).toBeLessThan(15);
      await expect(kpiAussen).toContainText("ragt über das Baufeld");

      // --- 5) Raster-Chip: Darstellung, nie Geometrie -----------------------
      // Beweis "byte-gleich": das gerenderte Polygon ist die einzige sichtbare
      // Repraesentation von footprintM — points-Attribut vor/nach identisch.
      const koerperPoly = page.locator('polygon[data-griff="flaeche"]');
      const pointsVorher = await koerperPoly.getAttribute("points");
      const vor = await messen(page);
      const chip = page.getByTestId("ms-raster");
      await chip.selectOption("grundstueck");
      await page.waitForTimeout(200);
      // Laengste Hullenkante ist die vertikale (112.5 m) -> 90°.
      const rasterG = page.locator("g[data-raster]");
      await expect(rasterG).toHaveAttribute("transform", /rotate\(90 /);
      expect(await koerperPoly.getAttribute("points"), "footprintM byte-gleich").toBe(pointsVorher);
      const nach = await messen(page);
      expect(Math.abs(nach.w - vor.w), `Raster-Drehung aendert Breite`).toBeLessThan(0.001);
      expect(Math.abs(nach.d - vor.d), `Raster-Drehung aendert Tiefe`).toBeLessThan(0.001);
      await chip.selectOption("nord");
      await page.waitForTimeout(200);
      const transform = await rasterG.getAttribute("transform");
      expect(transform === null || !/rotate/.test(transform), `Raster zurueck: ${transform}`).toBeTruthy();
      expect(await koerperPoly.getAttribute("points")).toBe(pointsVorher);

      // --- 6) Nordwinkel: Layer-Wert gewinnt (D-P75-05) ---------------------
      // werkstatt_layer.nordwinkel = 0 ist GESETZT -> Projektfeld disabled,
      // Nordpfeil ohne Drehung. Genau das ist die Vorrangregel.
      const nordFeld = page.getByTestId("ms-nordwinkel");
      await expect(nordFeld).toBeVisible();
      await expect(nordFeld).toBeDisabled();
      await expect(nordFeld).toHaveValue("0");
      await expect(page.locator("[data-nordpfeil] g")).toHaveAttribute("transform", "rotate(0)");

      // --- 7) Konsole sauber ------------------------------------------------
      expect(warnungen, warnungen.join("\n")).toEqual([]);
    } finally {
      // --- Abbauen: Datensatz loeschen (db.json zurueck im Ausgangszustand) --
      const del = await page.request.delete(`api/entities/BuildingComplex/${datensatzId}`);
      expect(del.ok(), "BuildingComplex loeschen").toBeTruthy();
    }
  });
});
