// 94-02 (B-ABN-02): one office name. Accounting › Einstellungen no longer has
// its own "Büroname" input; it shows the letterhead's name read-only. With only
// the legacy accounting name set, one click moves it into the letterhead.
// Restores both Setting rows in `finally`.
import { test, expect } from "@playwright/test";

const API = "/api/entities";

/** @returns {Promise<any|null>} first Setting row of the key */
async function settingZeile(request, key) {
  const zeilen = await (await request.get(`${API}/Setting?key=${encodeURIComponent(key)}`)).json();
  return Array.isArray(zeilen) && zeilen[0] ? zeilen[0] : null;
}

test("Buchhaltung zeigt den Büronamen aus dem Briefkopf (94-02)", async ({ page, request }) => {
  const buchVorher = await settingZeile(request, "buchhaltung");
  const kopfVorher = await settingZeile(request, "briefkopf");
  /** @type {string[]} Setting ids created by this test */
  const angelegt = [];
  const setze = async (vorher, key, wert) => {
    if (vorher) { await request.put(`${API}/Setting/${vorher.id}`, { data: { value: wert } }); return vorher; }
    const neu = await (await request.post(`${API}/Setting`, { data: { key, value: wert } })).json();
    angelegt.push(neu.id);
    return neu;
  };

  try {
    const buch = await setze(buchVorher, "buchhaltung", { ...(buchVorher?.value || {}), buero: { ...(buchVorher?.value?.buero || {}), name: "Alter Buchhaltungsname" } });
    const kopf = await setze(kopfVorher, "briefkopf", { ...(kopfVorher?.value || {}), office: "E2E Büro 94-02" });

    // 1. Letterhead set: the dialog shows it, there is no name input any more.
    await page.goto("/Accounting");
    await page.getByRole("button", { name: "Einstellungen" }).first().click();
    const feld = page.getByTestId("bh-buero-name");
    await expect(feld).toContainText("E2E Büro 94-02");
    await expect(feld).not.toContainText("Alter Buchhaltungsname");
    await expect(page.locator("#bh-buero-name")).toHaveCount(0);
    await expect(page.getByTestId("bh-name-uebernehmen")).toHaveCount(0);

    // 2. Letterhead still the placeholder: the old name shows and can be moved over.
    await request.put(`${API}/Setting/${kopf.id}`, { data: { value: { ...(kopfVorher?.value || {}), office: "Architekturbüro" } } });
    await page.reload();
    await page.getByRole("button", { name: "Einstellungen" }).first().click();
    await expect(page.getByTestId("bh-buero-name")).toContainText("Alter Buchhaltungsname");
    await page.getByTestId("bh-name-uebernehmen").click();
    await expect.poll(async () => (await settingZeile(request, "briefkopf"))?.value?.office).toBe("Alter Buchhaltungsname");
    await expect(page.getByTestId("bh-name-uebernehmen")).toHaveCount(0);
    expect(buch.id).toBeTruthy();
  } finally {
    if (buchVorher) await request.put(`${API}/Setting/${buchVorher.id}`, { data: { value: buchVorher.value } });
    if (kopfVorher) await request.put(`${API}/Setting/${kopfVorher.id}`, { data: { value: kopfVorher.value } });
    for (const id of angelegt) await request.delete(`${API}/Setting/${id}`);
  }
});

// 94-02 (B-ABN-01): tax number, VAT ID and IBAN in Einstellungen › Büro & Briefkopf,
// written into the same record the accounting dialog reads.
test("Steuer- und Bankdaten unter Büro & Briefkopf (94-02)", async ({ page, request }) => {
  const buchVorher = await settingZeile(request, "buchhaltung");
  try {
    await page.goto("/Settings?tab=office");
    const form = page.getByTestId("steuer-bank");
    await expect(form).toBeVisible({ timeout: 20000 });
    await expect(page.locator("#office-iban")).toBeEnabled();
    await page.locator("#office-steuernr").fill("000/000/00094");
    await page.locator("#office-ust-idnr").fill("de 000 000 094");
    await page.locator("#office-iban").fill("de02 1203 0000 0000 2020 51");
    await form.getByRole("button", { name: "Speichern" }).click();
    await expect.poll(async () => (await settingZeile(request, "buchhaltung"))?.value?.buero?.iban).toBe("DE02120300000000202051");
    const buero = (await settingZeile(request, "buchhaltung")).value.buero;
    expect(buero.ust_idnr).toBe("DE000000094");
    expect(buero.steuernr).toBe("000/000/00094");
    // Accounting rates and the legacy name are untouched by the merge.
    if (buchVorher?.value?.buero?.name !== undefined) expect(buero.name).toBe(buchVorher.value.buero.name);
  } finally {
    if (buchVorher) await request.put(`${API}/Setting/${buchVorher.id}`, { data: { value: buchVorher.value } });
    else for (const z of await (await request.get(`${API}/Setting?key=buchhaltung`)).json()) await request.delete(`${API}/Setting/${z.id}`);
  }
});
