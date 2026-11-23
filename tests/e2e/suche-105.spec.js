// 105-28 / 111-13 / 105-14: the command palette finds a meeting-minutes record by full text with typos and jumps to it;
// the shortcut help "?" is never empty (global commands from the register) and lists the keys of a mounted surface.
// Neutral test data, created and removed by the spec. Console must stay free of errors and warnings.

// Own neutral projects only (no shared test house) — plain Playwright test, no test-house fixture.
import { test, expect } from "@playwright/test";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";

const API = "/api/entities";
const NAME = "E2E Suche 105";

test.describe("105-28 Palette mit Datensätzen, 105-14 Tastenhilfe", () => {
  test.describe.configure({ timeout: 120000 });

  test("Volltext mit Tippfehlern findet ein Protokoll, Enter springt auf den Protokoll-Reiter; ? ist nie leer", async ({ page, request }) => {
    for (const alt of await (await request.get(`${API}/Project?name=${encodeURIComponent(NAME)}`)).json()) await request.delete(`${API}/Project/${alt.id}`);
    const projekt = await (await request.post(`${API}/Project`, { data: { name: NAME, status: "concept" } })).json();
    const protokoll = await (await request.post(`${API}/MeetingMinutes`, { data: {
      project_id: projekt.id, nummer: 1, titel: "Probebesprechung", datum: "2026-01-05",
      punkte: [{ art: "aufgabe", thema: "Zwischenstand Fassadenmuster", text: "", zustaendig: "", frist: "", status: "offen" }],
    } })).json();
    const position = await (await request.post(`${API}/LVPosition`, { data: { project_id: projekt.id, oz: "99.0105", short_text: "Probeposition Wandputz" } })).json();
    try {
      await nurLocalhost(page);
      const warnungen = [];
      page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text())) warnungen.push(m.text()); });
      page.on("pageerror", (e) => warnungen.push(`pageerror ${e}`));
      await page.goto("/Dashboard");
      await expect(page.locator("#hauptinhalt")).toBeVisible({ timeout: 30000 });

      // 105-14: "?" on a page without registered actions — the global section from the register.
      await page.locator("body").click({ position: { x: 5, y: 5 } });
      await page.keyboard.press("Shift+?");
      const hilfe = page.getByTestId("kuerzel-hilfe");
      await expect(hilfe).toBeVisible();
      await expect(hilfe.getByTestId("kuerzel-abschnitt-global")).toBeVisible();
      await expect(hilfe.getByTestId("kuerzel-befehl-palette")).toContainText("K");
      await page.keyboard.press("Escape");
      await expect(hilfe).toBeHidden();

      // 105-28 + 111-13: words in another order, one typo each ("Fasade", "Zwischenstnad") — the minutes are found.
      await page.keyboard.press("Control+k");
      const palette = page.getByTestId("befehlspalette");
      await expect(palette.locator("input")).toBeFocused();
      await expect(palette.getByTestId("palette-laedt")).toBeHidden({ timeout: 20000 });
      await page.keyboard.type("Fasade Zwischenstnad");
      const gruppe = palette.getByTestId("palette-gruppe-Protokolle");
      await expect(gruppe).toBeVisible();
      await expect(gruppe).toContainText("Probebesprechung");
      // The minutes group holds the best hit → it is the active row, Enter opens it.
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/\/Reports\?tab=protokolle/);
      await expect(page.getByTestId("pb-eintrag").filter({ hasText: "Probebesprechung" })).toBeVisible({ timeout: 20000 });

      // A bill-of-quantities position by a word inside its short text, umlaut-free spelling irrelevant here.
      await page.keyboard.press("Control+k");
      await expect(palette.getByTestId("palette-laedt")).toBeHidden({ timeout: 20000 });
      await page.keyboard.type("wandputz probe");
      await expect(palette.getByTestId("palette-gruppe-LV-Positionen")).toContainText("99.0105");
      await page.keyboard.press("Escape");

      expect(warnungen, warnungen.join("\n")).toEqual([]);
    } finally {
      await request.delete(`${API}/LVPosition/${position.id}`);
      await request.delete(`${API}/MeetingMinutes/${protokoll.id}`);
      await request.delete(`${API}/Project/${projekt.id}`);
    }
  });

  test("105-14: ? im Massenmodell listet die Tasten des Zeichenflächen-Registers", async ({ page, request }) => {
    const name = "E2E Suche 105 Massenmodell";
    for (const alt of await (await request.get(`${API}/Project?name=${encodeURIComponent(name)}`)).json()) await request.delete(`${API}/Project/${alt.id}`);
    const projekt = await (await request.post(`${API}/Project`, { data: { name, build_kind: "neubau", status: "concept" } })).json();
    try {
      await nurLocalhost(page);
      await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(name)}&tab=studio`);
      await expect(page.getByTestId("mm-leiste")).toBeVisible({ timeout: 60000 });
      // Focus outside any text field, then "?" — the modeller's register is published while it is mounted.
      await page.evaluate(() => /** @type {HTMLElement|null} */ (document.activeElement)?.blur());
      await page.keyboard.press("Shift+?");
      await expect(page.getByTestId("kuerzel-hilfe")).toBeVisible();
      await expect(page.getByTestId("kuerzel-abschnitt-register-0")).toBeVisible();
      await expect(page.getByTestId("kuerzel-befehl-linie")).toContainText("L");
      await expect(page.getByTestId("kuerzel-abschnitt-global")).toBeVisible();
    } finally {
      const modelle = await (await request.get(`${API}/BimModel?project_id=${projekt.id}`)).json().catch(() => []);
      for (const m of Array.isArray(modelle) ? modelle : []) await request.delete(`${API}/BimModel/${m.id}`).catch(() => {});
      await request.delete(`${API}/Project/${projekt.id}`).catch(() => {});
    }
  });
});
