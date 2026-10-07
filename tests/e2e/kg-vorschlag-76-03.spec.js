// Headless-Nachweis 76-03: Kostengruppen-Vorschlag über TypeSafe — im Formular
// und in der Kostenberechnungstabelle, als Vorschlag, der erst durch Klick wirkt.
//
// Netz: alles außer localhost geblockt; /api/integrations/typesafe wird per
// Route-Mock beantwortet (kein Schlüssel, kein Egress). Zweiter Test: der Server
// antwortet 503 (kein Schlüssel) → Toast mit Klartext, nichts geschrieben.
//
// Daten: eine LV-Position ohne Kostengruppe wird per lokaler API am Testprojekt
// „Review Testhaus" angelegt und am Ende wieder gelöscht (db.json ist nicht
// git-getrackt, aber das Testprojekt soll sauber bleiben).

import { test, expect, request } from "@playwright/test";

const API = "http://localhost:3001/api/";
const PROJEKT = "Review Testhaus";
const KURZTEXT = "Bauzaun H 2m aufstellen und raeumen (76-03 Test)";

const ERLAUBT_OFFLINE = /(ERR_|net::|Failed to fetch|timeout|aborted|404|503|tiles\.|openfreemap|AbortError|WebGL|THREE)/i;
// Vorbestehend (Nebenbefund KGB-1, 76-03-SUMMARY): der Din276Katalog trägt Code 311
// zweimal in der Fassung 2018 → React warnt im DIN-Select vor doppeltem Key `311-2018`.
// Nicht Teil dieses Plans; hier ausgeblendet, damit die Spec das Feature prüft.
const VORBESTEHEND = /Encountered two children with the same key/;

function antwortFuer(body) {
  const answers = {};
  for (const id of Object.keys(body.questions || {})) {
    answers[id] = { type: "choice", choice: "391", probabilities: { 391: 0.91, 591: 0.05, 341: 0.02, unbekannt: 0.02 }, confidence: 0.9 };
  }
  return { model: "jev-mock", answers, usage: { input_tokens: 10, output_tokens: 1 } };
}

async function netzBlocken(page, typesafeHandler) {
  await page.route("**/*", (route) => {
    const url = route.request().url();
    const host = new URL(url).hostname;
    if (url.includes("/api/integrations/typesafe")) return typesafeHandler(route);
    if (host === "localhost" || host === "127.0.0.1" || host === "[::1]") return route.continue();
    return route.abort();
  });
}

async function testprojekt(api) {
  const projekte = await (await api.get("entities/Project")).json();
  const p = projekte.find((x) => x.name === PROJEKT);
  expect(p, `Testprojekt ${PROJEKT} fehlt in db.json`).toBeTruthy();
  return p;
}

async function positionOhneKg(api, projectId) {
  const res = await api.post("entities/LVPosition", {
    data: {
      project_id: projectId, oz: "76.03", trade: "Rohbau", title: KURZTEXT, short_text: KURZTEXT,
      unit: "m", quantity: 10, din276: "", din276_fassung: "2018", din276_confidence: null, din276_hinweis: "",
    },
  });
  expect(res.ok(), "LVPosition anlegen").toBeTruthy();
  return (await res.json()).id;
}

async function aufraeumen(api, id) {
  if (id) await api.delete(`entities/LVPosition/${id}`);
}

test.describe("76-03 Kostengruppen-Vorschlag (TypeSafe)", () => {
  test("Formular: KG vorschlagen füllt Select + Hinweis; Tabelle: Chip → Klick schreibt 391", async ({ page }) => {
    const api = await request.newContext({ baseURL: API });
    const projekt = await testprojekt(api);
    const posId = await positionOhneKg(api, projekt.id);
    const warnungen = [];
    page.on("console", (m) => {
      if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text()) && !VORBESTEHEND.test(m.text())) warnungen.push(m.text());
    });
    try {
      let aufrufe = 0;
      await netzBlocken(page, (route) => {
        aufrufe += 1;
        const body = route.request().postDataJSON();
        expect(body.questions, "Fragen im Request").toBeTruthy();
        return route.fulfill({ contentType: "application/json", body: JSON.stringify(antwortFuer(body)) });
      });

      await page.goto(`/AVA?projekt=${encodeURIComponent(PROJEKT)}`);
      await page.getByRole("tab", { name: /Leistungsverzeichnis/ }).waitFor({ timeout: 30000 });

      // --- Formular ---------------------------------------------------------
      // LVTable.jsx:143 — der Anlege-Knopf heißt schlicht „Position".
      await page.getByRole("button", { name: /^\s*Position\s*$/ }).first().click();
      const dialog = page.getByRole("dialog").or(page.locator("form").filter({ hasText: "DIN 276 Kostengruppe" })).first();
      await dialog.getByPlaceholder("Beton Bodenplatte C25/30").fill("Bauzaun");
      await dialog.getByPlaceholder("Stahlbeton Bodenplatte, d=40cm").fill("Bauzaun H 2m aufstellen");
      await dialog.getByTestId("kg-vorschlagen").click();
      await expect(dialog.getByTestId("kg-hinweis")).toContainText("p = 0,91", { timeout: 10000 });
      await expect(dialog.locator("button[role='combobox']").first()).toContainText("391");
      expect(aufrufe).toBe(1);
      await dialog.getByRole("button", { name: "Abbrechen" }).click();

      // --- Tabelle -----------------------------------------------------------
      await page.getByRole("tab", { name: /Kostenberechnung/ }).dispatchEvent("mousedown");
      await page.getByRole("tab", { name: /Kostenberechnung/ }).click();
      const knopf = page.getByTestId("kg-fehlende-vorschlagen");
      await expect(knopf).toBeVisible({ timeout: 15000 });
      await knopf.click();
      const chip = page.getByTestId("kg-chip").first();
      await expect(chip).toContainText("Vorschlag 391 (0,91)", { timeout: 10000 });
      // Noch nichts geschrieben:
      let pos = await (await api.get(`entities/LVPosition/${posId}`)).json();
      expect(pos.din276 || "").toBe("");
      await chip.click();
      await expect(page.getByTestId("kg-chip")).toHaveCount(0, { timeout: 10000 });
      pos = await (await api.get(`entities/LVPosition/${posId}`)).json();
      expect(pos.din276).toBe("391");
      // 76-04: Stufen hoch/mittel sind nach der Messung abgeschaltet — jeder
      // angenommene Vorschlag trägt „niedrig" plus seine Wahrscheinlichkeit.
      expect(pos.din276_confidence).toBe("niedrig");
      expect(pos.din276_hinweis).toMatch(/TypeSafe-Vorschlag/);

      // Reload zeigt den Code in der Zelle.
      await page.reload();
      await page.getByRole("tab", { name: /Kostenberechnung/ }).waitFor({ timeout: 30000 });
      await page.getByRole("tab", { name: /Kostenberechnung/ }).dispatchEvent("mousedown");
      await page.getByRole("tab", { name: /Kostenberechnung/ }).click();
      await expect(page.locator("tr", { hasText: KURZTEXT }).locator("td").nth(2)).toHaveText("391", { timeout: 15000 });

      expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
    } finally {
      await aufraeumen(api, posId);
    }
  });

  test("Server 503 (kein Schlüssel): Toast mit Klartext, nichts geschrieben, kein Chip", async ({ page }) => {
    const api = await request.newContext({ baseURL: API });
    const projekt = await testprojekt(api);
    const posId = await positionOhneKg(api, projekt.id);
    try {
      await netzBlocken(page, (route) =>
        route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "TYPESAFE_API_KEY fehlt in .env — Urteile werden nicht simuliert" }) }),
      );
      await page.goto(`/AVA?projekt=${encodeURIComponent(PROJEKT)}`);
      await page.getByRole("tab", { name: /Kostenberechnung/ }).waitFor({ timeout: 30000 });
      await page.getByRole("tab", { name: /Kostenberechnung/ }).dispatchEvent("mousedown");
      await page.getByRole("tab", { name: /Kostenberechnung/ }).click();
      await page.getByTestId("kg-fehlende-vorschlagen").click();
      await expect(page.getByText(/TYPESAFE_API_KEY fehlt/)).toBeVisible({ timeout: 10000 });
      await expect(page.getByTestId("kg-chip")).toHaveCount(0);
      const pos = await (await api.get(`entities/LVPosition/${posId}`)).json();
      expect(pos.din276 || "").toBe("");
    } finally {
      await aufraeumen(api, posId);
    }
  });
});
