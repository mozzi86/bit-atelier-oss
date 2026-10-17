// Headless-Nachweis 93-10 (Dateizuordnung .bitproj), echte Kette ohne Attrappe:
//   Startprogramm tools/datei-oeffnen.mjs (--kein-start --kein-browser) → POST /api/datei/oeffnen mit dem
//   Schlüssel aus dem Datenordner → App unter /?import=<token> → Import-Vorschau.
//  1. Erstes Öffnen einer Übergabedatei (nur ein unbekanntes Projekt): Vorschau mit Dateiname und den Knöpfen
//     „Abbrechen / Als Kopie hinzufügen / Laden und ersetzen“; Abbrechen verwirft den Token (danach 404).
//  2. Datei mit dem ganzen Stand + Testprojekt: Hinweis „schon vorhanden“, „Aktualisieren“ → Projekt da,
//     Datei verknüpft (Einstellungen › Daten & Sicherung zeigt den Pfad).
//  3. Wieder öffnen (nur Testprojekt): „Als Kopie“ → zweites Projekt „… (Kopie)“ mit neuer ID.
//  4. „Zurück in die Datei speichern“ → Datei enthält jetzt auch die Kopie; Datei von außen geändert →
//     Konfliktdialog → „Als Kopie speichern“ (Original bleibt) → Kopie fremd geändert → „Überschreiben“.
// Der Lauf ersetzt die Entwicklungs-DB (server/db.json) — am Ende wird der Ausgangsstand über dieselbe
// Funktion („Laden und ersetzen“ einer Datei mit dem alten Stand) zurückgeholt und die Verknüpfung gelöscht.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import { nurLocalhost, ERLAUBT_OFFLINE } from "./fixtures/massing.js";

const WURZEL = process.cwd();
const API_PORT = Number(process.env.API_PORT) || 3001;
const BASIS = `http://localhost:${Number(process.env.PORT) || 5173}`;
const ORDNER = path.join(WURZEL, "test-results", "datei-oeffnen-93-10");
const PROJEKT = { id: "e2e9310projekt", name: "E2E Dateizuordnung 93-10" };

/** @param {object} daten @param {string} name @returns {string} path of the written .bitproj */
function bitproj(daten, name) {
  const obj = { schema: 1, app: "bit-atelier-demo", exportiert: new Date().toISOString(), projektname: "E2E 93-10", daten };
  const ziel = path.join(ORDNER, name);
  fs.writeFileSync(ziel, zlib.gzipSync(Buffer.from(JSON.stringify(obj))));
  return ziel;
}

/** Runs the real launcher and returns the app URL it would open. */
function starter(datei) {
  const aus = execFileSync(process.execPath, ["tools/datei-oeffnen.mjs", datei, "--port", String(API_PORT), "--app-url", BASIS, "--kein-browser", "--kein-start"], { cwd: WURZEL, encoding: "utf8" });
  return JSON.parse(aus.trim().split("\n").pop()).url;
}

/** Reads a written .bitproj back (gzip JSON). */
const lesen = (datei) => JSON.parse(zlib.gunzipSync(fs.readFileSync(datei)).toString("utf8"));

test.describe("93-10 Doppelklick auf .bitproj", () => {
  test.setTimeout(240000);

  test("Startprogramm → Vorschau → Wieder öffnen → Zurückspeichern mit Konflikt", async ({ page }) => {
    await nurLocalhost(page);
    const warnungen = [];
    page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text())) warnungen.push(m.text()); });
    fs.rmSync(ORDNER, { recursive: true, force: true });
    fs.mkdirSync(ORDNER, { recursive: true });
    // The dev server keeps the DB in memory and writes db.json with a short delay — wait for it to answer first.
    await expect.poll(async () => (await page.request.get(`${BASIS}/api/status`)).ok(), { timeout: 60000 }).toBe(true);
    // Leftovers of an aborted earlier run (the restore in `finally` never ran): the test project and its copies.
    for (const p of await (await page.request.get(`${BASIS}/api/entities/Project`)).json()) {
      if (p.id === PROJEKT.id || String(p.name || "").startsWith(PROJEKT.name)) await page.request.delete(`${BASIS}/api/entities/Project/${p.id}`);
    }
    await page.waitForTimeout(400); // db.json is written with a 120 ms debounce — read it after the delete landed
    const basis = JSON.parse(fs.readFileSync(path.join(WURZEL, "server", "db.json"), "utf8"));
    const projekte = async () => (await (await page.request.get(`${BASIS}/api/entities/Project`)).json()).map((p) => p.name);

    try {
      // 1. First open of a handover file, cancelled.
      const uebergabe = bitproj({ Project: [PROJEKT] }, "Uebergabe.bitproj");
      let url = starter(uebergabe);
      expect(url).toMatch(/\/\?import=[a-f0-9]{64}$/);
      await page.goto(url);
      const dialog = page.getByTestId("import-dialog");
      await expect(dialog).toBeVisible({ timeout: 30000 });
      await expect(page.getByTestId("import-quelle")).toHaveText("Uebergabe.bitproj");
      await expect(page.getByTestId("import-wieder-hinweis")).toHaveCount(0);
      await expect(page.getByTestId("import-als-kopie")).toHaveText(/Als Kopie hinzufügen|Add as a copy/);
      await expect(page.getByTestId("import-vorher-sichern")).toHaveCount(0);
      await page.getByTestId("import-abbrechen").click();
      await expect(dialog).toBeHidden();
      expect(page.url()).not.toContain("import=");
      expect((await page.request.get(`${BASIS}/api/datei/import/${url.split("=")[1]}`)).status()).toBe(404);

      // 2. Full state + test project: recognised as re-open, "Aktualisieren" links the file.
      const voll = bitproj({ ...basis, Project: [...(basis.Project || []), PROJEKT] }, "Arbeitsstand.bitproj");
      url = starter(voll);
      await page.goto(url);
      await expect(page.getByTestId("import-wieder-hinweis")).toBeVisible({ timeout: 30000 });
      await page.getByTestId("import-aktualisieren").click();
      await page.waitForLoadState("load");
      await expect.poll(projekte, { timeout: 20000 }).toContain(PROJEKT.name);

      // 3. Re-open the handover file: the project exists → "Als Kopie".
      url = starter(uebergabe);
      await page.goto(url);
      await expect(page.getByTestId("import-wieder-hinweis")).toContainText(PROJEKT.name, { timeout: 30000 });
      await page.getByTestId("import-als-kopie").click();
      await expect.poll(projekte, { timeout: 20000 }).toContain(`${PROJEKT.name} (Kopie)`);
      const alle = await (await page.request.get(`${BASIS}/api/entities/Project`)).json();
      const kopie = alle.find((p) => p.name === `${PROJEKT.name} (Kopie)`);
      expect(kopie.id).not.toBe(PROJEKT.id);

      // 4. Save back from Settings › Daten & Sicherung. The import reloads the app after "Als Kopie" —
      // a goto racing that reload ends in net::ERR_ABORTED (full run 17.10.), so settle and retry once.
      await page.waitForLoadState("networkidle").catch(() => {});
      await page.goto("/Settings?tab=data").catch(async (e) => {
        if (!/ERR_ABORTED/.test(String(e))) throw e;
        await page.waitForLoadState("networkidle").catch(() => {});
        await page.goto("/Settings?tab=data");
      });
      await expect(page.getByTestId("datei-quelle-pfad")).toContainText("Arbeitsstand.bitproj", { timeout: 30000 });
      await page.getByTestId("datei-zurueckschreiben").click();
      await expect(page.getByTestId("datei-quelle-status")).toHaveText(/In die Datei gespeichert|Saved to the file/, { timeout: 20000 });
      expect(lesen(voll).daten.Project.map((p) => p.name)).toContain(`${PROJEKT.name} (Kopie)`);
      expect(fs.existsSync(`${voll}.tmp`)).toBe(false);

      // Changed from outside → conflict → save as copy; the original stays as the other program left it.
      const fremd = bitproj({ Project: [{ id: "fremd", name: "Fremd geändert" }] }, "Arbeitsstand.bitproj");
      await page.getByTestId("datei-zurueckschreiben").click();
      await expect(page.getByTestId("datei-konflikt-dialog")).toBeVisible();
      await page.getByTestId("datei-konflikt-kopie").click();
      await expect(page.getByTestId("datei-quelle-status")).toContainText("Arbeitsstand (Kopie ", { timeout: 20000 });
      expect(lesen(fremd).daten.Project.map((p) => p.name)).toEqual(["Fremd geändert"]);
      const kopieDatei = fs.readdirSync(ORDNER).find((n) => n.startsWith("Arbeitsstand (Kopie "));
      expect(lesen(path.join(ORDNER, kopieDatei)).daten.Project.map((p) => p.name)).toContain(PROJEKT.name);
      await expect(page.getByTestId("datei-quelle-pfad")).toContainText(kopieDatei);

      // The copy changed from outside too → conflict → overwrite.
      fs.writeFileSync(path.join(ORDNER, kopieDatei), "fremd");
      await page.getByTestId("datei-zurueckschreiben").click();
      await page.getByTestId("datei-konflikt-ueberschreiben").click();
      await expect(page.getByTestId("datei-quelle-status")).toHaveText(/In die Datei gespeichert|Saved to the file/, { timeout: 20000 });
      expect(lesen(path.join(ORDNER, kopieDatei)).daten.Project.map((p) => p.name)).toContain(PROJEKT.name);
      expect(fs.readdirSync(ORDNER).filter((n) => n.endsWith(".tmp"))).toEqual([]);
      expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
    } finally {
      // Back to the starting state through the same route, then drop the link and the test files.
      const zurueck = bitproj(basis, "Ausgangsstand.bitproj");
      const token = starter(zurueck).split("=")[1];
      // 96-04: a browser-like write (Origin) carries the session token, as the app's fetch wrapper does.
      const sitzung = (await (await page.request.get(`${BASIS}/api/sitzung`)).json()).token;
      const r = await page.request.post(`${BASIS}/api/datei/import/${token}/uebernehmen`, { headers: { Origin: BASIS, "X-Bit-Session": sitzung }, data: { modus: "ersetzen" } });
      expect(r.ok(), await r.text()).toBe(true);
      fs.rmSync(path.join(WURZEL, "server", "dateiquelle.json"), { force: true });
      fs.rmSync(ORDNER, { recursive: true, force: true });
    }
  });
});
