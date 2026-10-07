// Headless-Nachweis für 72-01 Stufe A (Auftrag: REVIEW-NUTZBARKEIT §3).
//
// Ablauf: Review-Artefakt (gespeicherter BuildingComplex des Testprojekts mit
// drei 100.000-m²-Körpern) per lokaler API löschen, dann „Review Testhaus"
// (Gewerbe, 500 m²) im Komplex-Designer öffnen, Standort übernehmen, einen
// Baukörper setzen. Erwartet (Abnahme aus dem Auftrag):
//   - Parzellenfläche ~1.500 m² (500 m² × 3 [ASSUMED])
//   - BGF eines Baukörpers ~1.200 m² (20 × 15 m × 4 Geschosse [ASSUMED])
//   - Kennzahlen OHNE „Wohneinheiten" (Gewerbe), dafür „Arbeitsplätze"
//   - Karte sichtbar: Container-Höhe > 0
//   - Konsole ohne die N-21-Warnklassen
//
// Netz: ALLES außer localhost wird von page.route abgefangen — Tiles/Sprites
// werden geblockt, NUR der MapLibre-Style wird lokal mit einem Leer-Style
// beantwortet (route.fulfill = kein Netzwerk-Egress), damit die Karte offline
// initialisiert und der Klick-Handler sich anmeldet. „Entwurf speichern" wird
// NICHT geklickt; db.json bleibt ab dem Hash-Startpunkt unverändert.

import { test, expect, request } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const DB_PFAD = path.resolve("server/db.json");
// Trailing slash ist Pflicht: new URL("entities/…", base) schneidet ohne ihn
// das letzte Pfadsegment ("api") ab (WHATWG-Resolution).
const API = "http://localhost:3001/api/";
// Minimaler, gültiger MapLibre-Style (leer) — reicht, damit die Map "load"
// feuert und onLayersReady/click-Handler laufen. Keine Tiles, kein Netz.
const LEER_STYLE = JSON.stringify({ version: 8, sources: {}, layers: [] });

/** Die N-21-Warnklassen aus dem Review — davon darf KEINE auftreten. */
const VERBOTENE_KONSOLE = [
  /Expected value to be of type/i,
  /could not be loaded/i,
];
/** Netzwerk-/Tile-Fehler sind offline erwartet und zählen nicht. */
const ERLAUBT_OFFLINE = /(ERR_|net::|Failed to fetch|timeout|aborted|404|503|tiles\.|openfreemap|elevation-tiles|Image could not be loaded|AbortError)/i;

const hash = () => crypto.createHash("sha256").update(fs.readFileSync(DB_PFAD)).digest("hex");

test.describe("72-01 Stufe A — Review Testhaus", () => {
  test("Parzelle ~1.500 m², BGF ~1.200 m², keine WE-KPI, Karte > 0 px, Konsole sauber", async ({ page }) => {
    await page.route("**/*", (route) => {
      const url = route.request().url();
      const host = new URL(url).hostname;
      if (host === "localhost" || host === "127.0.0.1" || host === "[::1]") {
        return route.continue();
      }
      // MapLibre-Style lokal beantworten (kein Egress), alles Fremde blocken.
      if (url.includes("/styles/") || url.endsWith("style.json")) {
        return route.fulfill({ contentType: "application/json", body: LEER_STYLE });
      }
      return route.abort();
    });

    // --- Review-Artefakt aufräumen (REVIEW §4: Löschen nach A-11) ------------
    // Pfade RELATIV (ohne führendes /): Playwright löst "/entities" gegen den
    // Origin auf und würde das /api-Präfix der baseURL abschneiden.
    const api = await request.newContext({ baseURL: API });
    const projekte = await (await api.get("entities/Project")).json();
    const testhaus = projekte.find((p) => p.name === "Review Testhaus");
    expect(testhaus, "Testprojekt Review Testhaus fehlt in db.json").toBeTruthy();
    const complexe = await (await api.get("entities/BuildingComplex")).json();
    for (const c of complexe.filter((x) => x.project_id === testhaus.id)) {
      const res = await api.delete(`entities/BuildingComplex/${c.id}`);
      expect(res.ok(), `BuildingComplex ${c.id} löschen`).toBeTruthy();
    }
    // Express persistiert gebündelt (Debounce 120 ms) — kurz warten, dann Hash.
    await page.waitForTimeout(700);
    const hashStart = hash();

    const warnungen = [];
    page.on("console", (msg) => {
      const text = msg.text();
      if (msg.type() === "error" || msg.type() === "warning") {
        if (ERLAUBT_OFFLINE.test(text)) return;
        warnungen.push(`[${msg.type()}] ${text}`);
      }
    });

    // Testprojekt aktivieren: Deep-Link ?projekt=Review Testhaus.
    await page.goto("/ComplexDesigner?projekt=Review%20Testhaus");
    await expect(page.getByRole("heading", { name: "Komplex-Designer" })).toBeVisible({ timeout: 30000 });

    // Standort-Reiter (Start-Tab): Koordinaten setzen und übernehmen.
    await page.fill("#addr", "Nürnberg, Deutschland");
    await page.fill('input[type="number"] >> nth=0', "49.4521");
    await page.fill('input[type="number"] >> nth=1', "11.0767");
    await page.getByRole("button", { name: /Standort übernehmen/i }).click();
    // handleLocationUpdate wechselt auf den Baufeld-Reiter („massing").
    await expect(page.locator("xpath=//div[contains(text(),'Grundstücksfläche')]/b")).toBeVisible({ timeout: 15000 });

    // A-2: Parzelle ~1.500 m² (500 m² Gebäudefläche × 3).
    const flaecheText = await page.locator("xpath=//div[contains(text(),'Grundstücksfläche')]/b").first().innerText();
    const flaeche = Number(flaecheText.replace(/[^\d]/g, ""));
    expect(flaeche, `Parzellenfläche aus Panel: ${flaecheText}`).toBeGreaterThanOrEqual(1300);
    expect(flaeche).toBeLessThanOrEqual(1700);

    // A-1: map box inside the frame is actually sized (Nacharbeit 18.09.:
    // .maplibregl-map needs h-full w-full because maplibre-gl.css sets
    // position:relative itself - inset-0 did not apply). Acceptance: >= 420 px.
    const karte = page.locator("[role='tabpanel'] .maplibregl-map").locator("visible=true").first();
    await expect(karte).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(500); // let the forced resize after tab switch land
    const kartenHoehe = await karte.evaluate((el) => el.clientHeight);
    expect(kartenHoehe, "Kartencontainer-Höhe (.maplibregl-map)").toBeGreaterThanOrEqual(420);

    // Map settle lassen (Style geladen, Layer + click-Handler bereit).
    await page.waitForTimeout(1500);

    // A-3: einen Baukörper in die Kartenmitte setzen (Klick nur in sichtbarer Karte).
    const box = await karte.boundingBox();
    expect(box, "Karte hat keine BoundingBox").toBeTruthy();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(300);

    // BGF: ein Baukörper 20 × 15 m × 4 Geschosse ≈ 1.200 m².
    const bgfLocator = page.locator("xpath=//div[contains(text(),'BGF (Baukörper)')]/b").first();
    await expect(bgfLocator).toBeVisible({ timeout: 10000 });
    const bgfText = await bgfLocator.innerText();
    const bgf = Number(bgfText.replace(/[^\d]/g, ""));
    expect(bgf, `BGF aus Panel: ${bgfText}`).toBeGreaterThanOrEqual(900);
    expect(bgf).toBeLessThanOrEqual(1500);

    // A-5: Massing-Kennzahlen ohne „Wohneinheiten", mit „Arbeitsplätze".
    await page.getByRole("tab", { name: /Massing-Studio/i }).click();
    await expect(page.getByText("Kennzahlen").first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("Wohneinheiten")).toHaveCount(0);
    await expect(page.getByText("Arbeitsplätze").first()).toBeVisible();

    // A-12: Konsole ohne die N-21-Warnklassen.
    const verbotene = warnungen.filter((w) => VERBOTENE_KONSOLE.some((re) => re.test(w)));
    expect(verbotene, `Verbotene Konsolen-Meldungen: ${JSON.stringify(verbotene, null, 2)}`).toEqual([]);

    // Nichts persistiert (abzüglich des aufgeräumten Review-Artefakts).
    expect(hash(), "db.json wurde verändert — der Lauf darf nichts speichern").toBe(hashStart);

    console.log(`MESSWERTE 72-01: parzelle_m2=${flaeche} bgf_m2=${bgf} karte_h_px=${kartenHoehe} warnungen_gesamt=${warnungen.length} verbotene=0`);
  });
});
