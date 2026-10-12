// Headless-Nachweis 92-07 (Einstellungen: Datenordner + KI-Assistent verbinden): die Server-Routen werden über
// page.route simuliert (die Server-Seite deckt der Unit-Test systemRouter-9207 ab; ein echtes Explorer-Fenster
// soll im Testlauf nicht aufgehen).
//  1. „Daten & Sicherung“ zeigt den Datenordner; „Ordner öffnen“ schickt genau einen POST und meldet Erfolg.
//  2. „KI-Verbindungen“ zeigt den Claude-Code-Befehl und das Claude-Desktop-JSON mit den gelieferten Pfaden;
//     „Schreibrecht erlauben“ hängt --schreiben an; „Kopieren“ meldet einen Status. Konsole sauber.
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";

const ORDNER = "C:\\Users\\nutzer\\AppData\\Local\\BIT-Atelier\\daten";
const KI = { node: "C:\\Program Files\\nodejs\\node.exe", mcpServer: "C:\\Users\\nutzer\\AppData\\Local\\BIT-Atelier\\tools\\mcp-server.mjs", vorhanden: true, apiUrl: "http://127.0.0.1:3001/api", standardPort: true };

test.describe("92-07 Datenordner + KI-Assistent verbinden", () => {
  test.setTimeout(120000);

  test("Daten & Sicherung: Datenordner und „Ordner öffnen“", async ({ page }) => {
    await nurLocalhost(page);
    const warnungen = [];
    page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text())) warnungen.push(m.text()); });
    let posts = 0;
    await page.route("**/api/system/datenordner", (r) => r.fulfill({ json: { ordner: ORDNER, dateien: { db: `${ORDNER}\\db.json`, personal: `${ORDNER}\\personal.json` } } }));
    await page.route("**/api/system/datenordner/oeffnen", (r) => { posts += 1; return r.fulfill({ json: { ok: true, ordner: ORDNER } }); });
    await page.goto("/Settings?tab=data");
    await expect(page.getByTestId("daten-ordner-pfad")).toHaveText(ORDNER, { timeout: 20000 });
    await page.getByTestId("daten-ordner-oeffnen").click();
    await expect(page.getByTestId("daten-ordner-status")).not.toHaveText("");
    expect(posts).toBe(1);
    expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
  });

  test("KI-Verbindungen: fertiger MCP-Eintrag mit echten Pfaden", async ({ page, context }) => {
    await nurLocalhost(page);
    await context.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => {});
    const warnungen = [];
    page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text())) warnungen.push(m.text()); });
    await page.route("**/api/system/ki-anbindung", (r) => r.fulfill({ json: KI }));
    await page.goto("/Settings?tab=ai");
    const code = page.getByTestId("ki-mcp-code");
    await expect(code).toHaveText(`claude mcp add bit-atelier -- "${KI.node}" ${KI.mcpServer}`, { timeout: 20000 });
    const desktop = page.getByTestId("ki-mcp-desktop");
    expect(JSON.parse(await desktop.innerText()).mcpServers["bit-atelier"]).toEqual({ command: KI.node, args: [KI.mcpServer] });
    await page.getByTestId("ki-mcp-schreiben").check();
    await expect(code).toHaveText(/ --schreiben$/);
    await page.getByTestId("ki-mcp-code-kopieren").click();
    await expect(page.getByTestId("ki-mcp-status")).not.toHaveText("");
    expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
  });
});
