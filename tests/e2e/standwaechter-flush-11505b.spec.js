// Headless proof 115-05b review part 2 (finding 1): a focus check of the design record that is still reading while the person leaves
// the designer (page change) or opens another project must NOT move the base of the project left. The pending autosave flushed on
// leaving then runs into the server's 409 and the 409 path refuses it with its note - the field another writer changed meanwhile
// stays as that writer left it. Before the fix the check moved the base to the foreign stand without card or lock, the flush got a
// 200 on it and overwrote the foreign value silently (reviewer repro review-bc-flush-11505b.spec.js, basis of this file).
//   Stream blocked; another writer sets kennzahlen_hand.stellplaetze = 9 (API); the person types 4 (pending autosave, 1.5 s); a
//   window `focus` starts the check whose GET is held on the wire; the person leaves (SPA navigation) or opens project B; the GET is
//   released. Expected: stored 9, the browser's PUT of A answered 409, toast "Entwurf nicht gespeichert …".
//   Control without focus check (the path that already held before part 2).
// Own neutral projects per test (API), cleaned up in `finally`.
import { test, expect } from "@playwright/test";
import { nurLocalhost } from "./fixtures/massing.js";

const API = "/api/entities";

/** @param {import("@playwright/test").APIRequestContext} request @param {string|null} id */
async function aufraeumen(request, id) {
  if (!id) return;
  for (const ent of ["BuildingComplex", "BimModel"]) {
    for (const r of await (await request.get(`${API}/${ent}?project_id=${id}`)).json().catch(() => [])) await request.delete(`${API}/${ent}/${r.id}`).catch(() => {});
  }
  await request.delete(`${API}/Project/${id}`).catch(() => {});
}

/** A neutral project with a model and a design record (stellplaetze 1). @param {import("@playwright/test").APIRequestContext} request @param {string} name */
async function anlegen(request, name) {
  for (const alt of await (await request.get(`${API}/Project?name=${encodeURIComponent(name)}`)).json()) await aufraeumen(request, alt.id);
  const id = (await (await request.post(`${API}/Project`, { data: { name, build_kind: "neubau", status: "concept" } })).json()).id;
  await request.post(`${API}/BimModel`, { data: { project_id: id, footprintM: [{ x: -6, z: -5 }, { x: 6, z: -5 }, { x: 6, z: 5 }, { x: -6, z: 5 }], storeys: 2, storeyHeight: 3, unit: "m" } });
  const k = await (await request.post(`${API}/BuildingComplex`, { data: { project_id: id, name, location: { lat: 0, lng: 0, address: "Testadresse" }, kennzahlen_hand: { stellplaetze: 1 } } })).json();
  return { id, kid: k.id };
}

const FAELLE = [
  { name: "Seitenwechsel ohne Prüfung (Kontrolle)", fokus: false, weg: "seite" },
  { name: "Seitenwechsel während der Prüfung", fokus: true, weg: "seite" },
  { name: "Projektwechsel A→B während der Prüfung", fokus: true, weg: "projekt" },
];

test.describe("115-05b Review Teil 2: Fokus-Prüfung verschiebt beim Verlassen keine Basis", () => {
  for (const fall of FAELLE) {
    test(fall.name, async ({ page, request }) => {
      test.setTimeout(180000);
      await page.setViewportSize({ width: 1400, height: 1000 });
      const NAME = `E2E Fokusflush 11505b ${fall.fokus ? "F" : "O"}${fall.weg === "projekt" ? "P" : "S"}`;
      const NAME_B = `${NAME} B`;
      let p = { id: null, kid: null };
      let b = { id: null, kid: null };
      try {
        await nurLocalhost(page);
        await page.route("**/api/aenderungen**", (r) => r.abort()); // no change stream
        p = await anlegen(request, NAME);
        if (fall.weg === "projekt") b = await anlegen(request, NAME_B);
        /** @type {string[]} */ const schreiben = [];
        page.on("response", (r) => {
          if (/BuildingComplex/.test(r.url()) && r.request().method() !== "GET") schreiben.push(`${r.request().method()} ${r.status()} ${r.url().replace(/^.*BuildingComplex/, "")}`);
        });
        /** @type {() => void} */ let freigeben = () => {};
        let halten = false;
        let gehalten = 0;
        await page.route(`**/api/entities/BuildingComplex/${p.kid}`, async (route) => {
          if (route.request().method() === "GET" && halten) { gehalten += 1; await new Promise((r) => { freigeben = () => r(undefined); }); }
          await route.continue();
        });
        const geladen = page.waitForResponse((r) => /\/api\/entities\/BuildingComplex\?project_id=/.test(r.url()), { timeout: 90000 });
        await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME)}&tab=studio`);
        await geladen;
        await expect(page.getByTestId("ms-stpl-hand")).toBeVisible({ timeout: 90000 });
        await page.waitForTimeout(1000);
        // another writer changes the same field (not streamed)
        expect((await request.put(`${API}/BuildingComplex/${p.kid}`, { data: { kennzahlen_hand: { stellplaetze: 9 } } })).ok()).toBe(true);
        await page.getByTestId("ms-stpl-hand").fill("4"); // pending autosave (1.5 s)
        if (fall.fokus) {
          halten = true;
          await page.evaluate(() => window.dispatchEvent(new Event("focus")));
          await expect.poll(() => gehalten, { timeout: 5000 }).toBe(1); // the check's GET is on the wire
        }
        if (fall.weg === "seite") {
          await page.evaluate(() => { history.pushState({}, "", "/Dashboard"); window.dispatchEvent(new window.PopStateEvent("popstate")); });
        } else {
          await page.getByRole("combobox", { name: "Aktuelles Projekt" }).click();
          await page.getByRole("option", { name: NAME_B, exact: true }).click();
        }
        await page.waitForTimeout(500);
        halten = false;
        freigeben();
        await expect.poll(() => schreiben.length, { timeout: 15000 }).toBeGreaterThan(0);
        await page.waitForTimeout(3000);
        const rec = (await (await request.get(`${API}/BuildingComplex?project_id=${p.id}`)).json())[0];
        const toasts = await page.locator("[data-sonner-toast]").allInnerTexts().catch(() => []);
        const beleg = `writes ${JSON.stringify(schreiben)} toasts ${JSON.stringify(toasts)}`;
        expect(rec.kennzahlen_hand?.stellplaetze, `the other writer's 9 stays (${beleg})`).toBe(9);
        expect(schreiben.filter((s) => s.includes(String(p.kid))).some((s) => s.startsWith("PUT 409")), `the flush of A was refused by the server (${beleg})`).toBe(true);
        expect(schreiben.filter((s) => s.includes(String(p.kid)) && / 20\d /.test(s)), `no write of A got through (${beleg})`).toEqual([]);
        expect(toasts.some((t) => t.includes("Entwurf nicht gespeichert")), `the person is told (${beleg})`).toBe(true);
        if (b.kid) {
          const recB = (await (await request.get(`${API}/BuildingComplex?project_id=${b.id}`)).json())[0];
          expect(recB.kennzahlen_hand?.stellplaetze, "B unchanged").toBe(1);
        }
      } finally {
        await aufraeumen(request, p.id);
        await aufraeumen(request, b.id);
      }
    });
  }
});
