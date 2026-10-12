// Headless-Nachweis 73-01 (Bauart wird gelesen): ein Sanierungsprojekt trägt auf der Kachel „Bestand /
// Sanierung“, sein Startpfad beginnt mit „Bauaufnahme laden“ statt „Entwurf beginnen“; ein Projekt ohne
// build_kind zeigt „Neubau (nicht gesetzt)“ und das Formular wählt beim Bearbeiten „Neubau“ vor. Aufräumen
// im finally, Konsole sauber.
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";

const API = "/api/entities/Project";

test("73-01 Bauart: Kachel-Badge, Startpfad Bestand, Formular-Vorbelegung", async ({ page, request }) => {
  test.setTimeout(120000);
  const ids = [];
  try {
    await nurLocalhost(page);
    const warnungen = [];
    page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text())) warnungen.push(m.text()); });
    page.on("pageerror", (e) => warnungen.push(`pageerror ${e}`));
    const san = await (await request.post(API, { data: { name: "E2E Bestand 7301", build_kind: "sanierung", status: "concept" } })).json();
    const alt = await (await request.post(API, { data: { name: "E2E Ohne Bauart 7301", status: "concept" } })).json();
    ids.push(san.id, alt.id);

    await page.goto(`/Projects?start=${san.id}`);
    await expect(page.getByText("Bauaufnahme laden")).toBeVisible({ timeout: 20000 });
    await expect(page.getByText("Entwurf beginnen")).toHaveCount(0);
    const kachelSan = page.getByRole("button", { name: /Projekt E2E Bestand 7301 aktivieren/ });
    await expect(kachelSan.getByTestId("projekt-bauart")).toHaveAttribute("data-bauart", "bestand");
    const kachelAlt = page.getByRole("button", { name: /Projekt E2E Ohne Bauart 7301 aktivieren/ });
    await expect(kachelAlt.getByTestId("projekt-bauart")).toHaveAttribute("data-gesetzt", "0");
    await expect(kachelAlt.getByTestId("projekt-bauart")).toContainText("nicht gesetzt");

    await kachelAlt.getByRole("button", { name: "Bearbeiten: E2E Ohne Bauart 7301" }).click();
    await expect(page.getByText("Vorhabentyp *")).toBeVisible();
    await expect(page.locator("button[role=combobox]").filter({ hasText: "Neubau" }).first()).toBeVisible();
    expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
  } finally {
    for (const id of ids) await request.delete(`${API}/${id}`);
  }
});
