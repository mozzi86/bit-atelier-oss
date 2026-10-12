// Headless-Nachweis 69-20: Prüf-Suite mit dem Musterprojekt (?beispiel=1 startet den Lauf), Lauf am
// Projekt speichern → als Basis wählen → Vergleich mit sich selbst = 0 neu / 0 behoben / alles unverändert.
// Dann eine Lauf-Datei mit einem erfundenen zusätzlichen Befund hochladen → genau dieser gilt als „behoben“.
// Aufräumen (PruefLauf) im finally, Konsole sauber.
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";
import { Buffer } from "node:buffer";

const API = "/api/entities";

test("69-20 Prüflauf speichern und vergleichen", async ({ page, request }) => {
  test.setTimeout(180000);
  const vorher = new Set((await (await request.get(`${API}/PruefLauf`)).json()).map((l) => l.id));
  try {
    await nurLocalhost(page);
    const warnungen = [];
    page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text()) && !/wasm|WebGL/i.test(m.text())) warnungen.push(m.text()); });
    page.on("pageerror", (e) => { if (!/WebGL|THREE/i.test(String(e))) warnungen.push(`pageerror ${e}`); });

    await page.goto(`/ModelCheck?projekt=Review%20Testhaus&beispiel=1`);
    const karte = page.getByTestId("lv-karte");
    await expect(karte).toBeVisible({ timeout: 120000 });
    await page.getByTestId("lv-speichern").click();
    await expect(karte.getByText("Prüflauf gespeichert.")).toBeVisible({ timeout: 15000 });
    const neu = (await (await request.get(`${API}/PruefLauf`)).json()).filter((l) => !vorher.has(l.id));
    expect(neu.length).toBe(1);
    expect(neu[0].befunde.length).toBeGreaterThan(0);
    expect(neu[0].modell).toBe("musterprojekt.ifc");

    await page.getByTestId("lv-auswahl").selectOption(neu[0].id);
    const erg = page.getByTestId("lv-ergebnis");
    await expect(erg).toHaveAttribute("data-neu", "0");
    await expect(erg).toHaveAttribute("data-behoben", "0");
    await expect(erg).toHaveAttribute("data-gleich", String(neu[0].befunde.length));

    const basis = { ...neu[0], befunde: [...neu[0].befunde, { schluessel: "hard|X|g1|g2", art: "hard", regel: "X", guids: ["g1", "g2"], stabil: true }] };
    delete basis.id; delete basis.project_id;
    await page.getByTestId("lv-datei").setInputFiles({ name: "lauf.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(basis)) });
    await expect(erg).toHaveAttribute("data-behoben", "1");
    await expect(erg).toHaveAttribute("data-hart", "-1");
    expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
  } finally {
    for (const l of await (await request.get(`${API}/PruefLauf`)).json()) if (!vorher.has(l.id)) await request.delete(`${API}/PruefLauf/${l.id}`);
  }
});
