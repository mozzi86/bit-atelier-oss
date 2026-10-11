// Headless-Nachweis 90-08 (Protokoll-Modul, Berichte › Protokolle): im Review-Testhaus ein neues Protokoll
// „E2E 9008 Jour fixe“ anlegen (ein Teilnehmer, eine Information, eine offene Aufgabe mit Frist), speichern
// → in der Liste mit 1 offenen Punkt; „Fortschreiben“ → Nr. 2 mit genau der offenen Aufgabe (Herkunft 1),
// Information nicht übernommen; speichern; PDF und CSV herunterladen. Aufräumen im finally, Konsole sauber.
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";
import fs from "node:fs";

const API = "/api/entities";
const TITEL = "E2E 9008 Jour fixe";

test.describe("90-08 Protokoll-Modul", () => {
  test.setTimeout(150000);

  test("anlegen, speichern, fortschreiben (nur offene Aufgaben), PDF + CSV", async ({ page, request }) => {
    const projekt = (await (await request.get(`${API}/Project?name=${encodeURIComponent("Review Testhaus")}`)).json())[0];
    try {
      await nurLocalhost(page);
      const warnungen = [];
      page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text())) warnungen.push(m.text()); });
      page.on("pageerror", (e) => warnungen.push(`pageerror ${e}`));
      await page.goto(`/Reports?projekt=${encodeURIComponent("Review Testhaus")}`);
      await page.getByRole("tab", { name: "Protokolle" }).click();

      await page.getByTestId("pb-neu").click();
      await page.getByTestId("pb-titel").fill(TITEL);
      await page.getByTestId("pb-ort").fill("Baustelle");
      await page.getByTestId("pb-tn-hinzu").click();
      await page.getByTestId("pb-tn-name").last().fill("E2E Teilnehmer");
      await page.getByTestId("pb-punkt-hinzu").click();
      await page.getByTestId("pb-punkt-art").last().selectOption("info");
      await page.getByTestId("pb-punkt-thema").last().fill("Termine");
      await page.getByTestId("pb-punkt-hinzu").click();
      await page.getByTestId("pb-punkt-thema").last().fill("Statik");
      await page.getByTestId("pb-punkt-text").last().fill("Durchbrüche freigeben");
      await page.getByTestId("pb-punkt-zust").last().fill("Tragwerk");
      await page.getByTestId("pb-punkt-frist").last().fill("2026-12-01");
      await page.getByTestId("pb-speichern").click();
      const eintrag = page.locator('[data-testid="pb-eintrag"]').filter({ hasText: TITEL });
      await expect(eintrag).toHaveAttribute("data-offen", "1", { timeout: 20000 });
      await expect(eintrag).toHaveAttribute("data-nummer", "1");

      await page.getByTestId("pb-fortschreiben").click();
      const ed = page.getByTestId("pb-editor");
      await expect(ed).toHaveAttribute("data-nummer", "2");
      await expect(page.getByTestId("pb-punkt")).toHaveCount(1);
      await expect(page.getByTestId("pb-punkt-thema")).toHaveValue("Statik");
      await page.getByTestId("pb-speichern").click();
      await expect(page.locator('[data-testid="pb-eintrag"]').filter({ hasText: TITEL })).toHaveCount(2, { timeout: 20000 });
      const gespeichert = (await (await request.get(`${API}/MeetingMinutes?project_id=${projekt.id}`)).json()).filter((m) => m.titel === TITEL);
      const nr2 = gespeichert.find((m) => m.nummer === 2);
      expect(nr2.punkte.map((p) => [p.thema, p.herkunft])).toEqual([["Statik", 1]]);

      const [pdf] = await Promise.all([page.waitForEvent("download"), page.getByTestId("pb-pdf").click()]);
      expect(pdf.suggestedFilename()).toMatch(/^Protokoll_02_E2E_9008_Jour_fixe_\d{4}-\d{2}-\d{2}\.pdf$/);
      expect(fs.readFileSync(await pdf.path()).toString("latin1")).toContain("Durchbr");
      const [csv] = await Promise.all([page.waitForEvent("download"), page.getByTestId("pb-csv").click()]);
      expect(fs.readFileSync(await csv.path(), "utf8")).toContain("Durchbrüche freigeben");
      expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
    } finally {
      const alle = await (await request.get(`${API}/MeetingMinutes?project_id=${projekt.id}`)).json();
      for (const m of alle.filter((x) => x.titel === TITEL)) await request.delete(`${API}/MeetingMinutes/${m.id}`);
    }
  });
});
