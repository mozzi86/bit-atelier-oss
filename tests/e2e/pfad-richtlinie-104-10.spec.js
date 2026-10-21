// Headless-Nachweis 104-10 (Pfad-Richtlinie für Dokumentverweise), echte Kette ohne Attrappe:
//  1. Startprogramm tools/datei-oeffnen.mjs mit einem Netzwerkpfad, einer file:-Adresse mit Rechnernamen und
//     einem Gerätepfad: Abbruch mit Klartext-Grund, bevor die Platte (oder ein Server) gefragt wird.
//  2. Die Startprogramm-Route selbst (POST /api/datei/oeffnen mit dem Schlüssel aus dem Datenordner): ein
//     Netzwerkpfad wird mit 400 und demselben Klartext abgewiesen.
//  3. Berichte › Dokumente: ein gespeichertes Dokument, dessen Inhalt ein javascript:-Verweis ist, öffnet
//     ein Fenster mit dem Klartext-Grund statt den Verweis auszuführen; ein echtes PDF öffnet als iframe; eine
//     SVG-Zeichnung wird nicht dargestellt, aber als Download angeboten (bleibt erreichbar).
// Hosts sind .invalid (RFC 2606) — selbst ein Fehler im Code könnte keinen echten Rechner erreichen.
// Testprojekt und -dokumente werden am Ende wieder gelöscht.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { nurLocalhost, ERLAUBT_OFFLINE } from "./fixtures/massing.js";
import { anfrage, schluesselKandidaten } from "../../tools/datei-oeffnen.mjs";
import { PFAD_MELDUNGEN, PFAD_GRUND } from "../../packages/nova-core/src/lib/pfadRichtlinie.js";

const WURZEL = process.cwd();
const API_PORT = Number(process.env.API_PORT) || 3001;
const BASIS = `http://localhost:${Number(process.env.PORT) || 5173}`;
const PROJEKT = { id: "e2e10410projekt", name: "E2E Pfad-Richtlinie 104-10" };
// An SVG whose onload would rename the window — it must never be rendered in the app's origin.
const SVG = "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20onload%3D%22document.title%3D'gekapert'%22%2F%3E";
/** @param {string} s @returns {string} the text as a literal RegExp source */
const literal = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const UNC = "\\\\server.invalid\\freigabe\\Plan.bitproj";

/**
 * Runs the real launcher; it must stop before contacting the server.
 * @param {string} datei the argument as a user (or a crafted shortcut) would pass it
 * @returns {{status: number|null, stderr: string}}
 */
function starter(datei) {
  const r = spawnSync(process.execPath, ["tools/datei-oeffnen.mjs", datei, "--port", String(API_PORT), "--kein-browser", "--kein-start"], { cwd: WURZEL, encoding: "utf8", timeout: 30000 });
  return { status: r.status, stderr: String(r.stderr || "") };
}

test.describe("104-10 Pfad-Richtlinie", () => {
  test.setTimeout(180000);

  test("Startprogramm und Startprogramm-Route weisen Netzwerk-, URL- und Gerätepfade mit Klartext ab", async ({ page }) => {
    await expect.poll(async () => (await page.request.get(`${BASIS}/api/status`)).ok(), { timeout: 60000 }).toBe(true);

    for (const [datei, grund] of [
      [UNC, PFAD_GRUND.UNC],
      ["file://server.invalid/freigabe/Plan.bitproj", PFAD_GRUND.FILE_HOST],
      ["https://server.invalid/Plan.bitproj", PFAD_GRUND.URL_SCHEMA],
      ["\\\\.\\COM1", PFAD_GRUND.GERAET],
    ]) {
      const r = starter(datei);
      expect(r.status, datei).toBe(1);
      expect(r.stderr, datei).toContain(PFAD_MELDUNGEN[grund]);
    }

    // The route itself, with the launcher's secret: refused with 400 and the reason — the share is never asked.
    let antwort = null;
    for (const kandidat of schluesselKandidaten(WURZEL)) {
      let schluessel = "";
      try { schluessel = fs.readFileSync(kandidat, "utf8").trim(); } catch { continue; }
      const r = await anfrage({ port: API_PORT, methode: "POST", pfad: "/api/datei/oeffnen", kopf: { "Content-Type": "application/json", "x-bit-schluessel": schluessel }, body: JSON.stringify({ pfad: UNC }) });
      if (r.status !== 403) { antwort = r; break; }
    }
    expect(antwort, "launcher secret found in the data folder").not.toBeNull();
    expect(antwort?.status).toBe(400);
    expect(antwort?.json?.error).toBe(PFAD_MELDUNGEN[PFAD_GRUND.UNC]);
  });

  test("Berichte › Dokumente: javascript:-Verweis zeigt den Grund, PDF öffnet, SVG als Download", async ({ page, context }) => {
    await nurLocalhost(page);
    const warnungen = [];
    page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text())) warnungen.push(m.text()); });
    await expect.poll(async () => (await page.request.get(`${BASIS}/api/status`)).ok(), { timeout: 60000 }).toBe(true);
    const aufraeumen = async () => {
      for (const d of await (await page.request.get(`${BASIS}/api/entities/Document`)).json()) {
        if (d.project_id === PROJEKT.id) await page.request.delete(`${BASIS}/api/entities/Document/${d.id}`);
      }
      await page.request.delete(`${BASIS}/api/entities/Project/${PROJEKT.id}`);
    };
    await aufraeumen();
    try {
      expect((await page.request.post(`${BASIS}/api/entities/Project`, { data: PROJEKT })).ok()).toBe(true);
      const jetzt = new Date().toISOString();
      for (const doc of [
        { id: "e2e10410skript", name: "Verweis.pdf", data: "javascript:document.title='gekapert'", size: 10, uploaded_date: jetzt },
        { id: "e2e10410pdf", name: "Echt.pdf", data: "data:application/pdf;base64,JVBERi0xLjQKJSVFT0YK", size: 20, uploaded_date: "2026-01-01T00:00:00.000Z" },
        { id: "e2e10410svg", name: "Zeichnung.svg", data: SVG, size: 60, uploaded_date: "2025-12-01T00:00:00.000Z", mime: "image/svg+xml" },
      ]) {
        expect((await page.request.post(`${BASIS}/api/entities/Document`, { data: { mime: "application/pdf", ...doc, project_id: PROJEKT.id } })).ok()).toBe(true);
      }

      await page.goto(`/Reports?projekt=${encodeURIComponent(PROJEKT.name)}`);
      await page.getByRole("tab", { name: /Dokumente|Documents/ }).click();
      const zeile = (name) => page.locator("div.rounded-xl").filter({ hasText: name }).last();
      await expect(zeile("Verweis.pdf")).toBeVisible({ timeout: 30000 });

      let fenster = context.waitForEvent("page");
      await zeile("Verweis.pdf").getByRole("button", { name: /Öffnen|Open/ }).click();
      let neu = await fenster;
      await expect(neu.getByRole("alert")).toHaveText(
        new RegExp(`${PFAD_MELDUNGEN[PFAD_GRUND.INHALT_VERWEIS].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}|no embedded content`),
      );
      expect(await neu.title()).toBe("Verweis.pdf");
      expect(await neu.locator("iframe").count()).toBe(0);
      await neu.close();

      fenster = context.waitForEvent("page");
      await zeile("Echt.pdf").getByRole("button", { name: /Öffnen|Open/ }).click();
      neu = await fenster;
      await expect(neu.locator("iframe")).toHaveAttribute("src", /^data:application\/pdf;base64,/);
      await expect(neu.getByRole("alert")).toHaveCount(0);
      await neu.close();

      // SVG can carry script: never rendered in the app's origin, but reachable through a download link.
      fenster = context.waitForEvent("page");
      await zeile("Zeichnung.svg").getByRole("button", { name: /Öffnen|Open/ }).click();
      neu = await fenster;
      await expect(neu.getByRole("note")).toHaveText(new RegExp(`${literal(PFAD_MELDUNGEN[PFAD_GRUND.INHALT_TYP])}|not opened in the browser`));
      const link = neu.getByRole("link", { name: /Zeichnung\.svg/ });
      await expect(link).toHaveAttribute("download", "Zeichnung.svg");
      await expect(link).toHaveAttribute("href", SVG);
      expect(await neu.locator("img, iframe").count()).toBe(0);
      expect(await neu.title()).toBe("Zeichnung.svg");
      await expect(neu.getByRole("alert")).toHaveCount(0);
      await neu.close();
    } finally {
      await aufraeumen();
    }
    expect(warnungen).toEqual([]);
  });
});
