// W-1118-22: the client moves furniture — office page /Bauherrenzugang against the Express dev stack (local data path = preview).
// Proves on a neutral test project with one room (5 × 4 m) and one desk (1.60 × 0.80 m):
//   - the furnishing is a candidate of the page; ticked with "Vorschlag anfragen" it appears in the preview as a plan;
//   - dragging the desk moves it on the 5 cm grid; near two walls it is pulled flush into the corner; dragged out of the room it
//     stays where it last stood inside;
//   - "Drehen" turns it by a quarter turn and is refused with a plain sentence where the turned desk would leave the room;
//   - "Rückgängig" takes the steps back one by one (a whole drag is one step);
//   - the preview never sends: "Vorschlag senden" is disabled; and nothing of this touches the stored design record;
//   - the preview shows only what the whitelist lets through (no internal note of the project).
// Data: own Project, BimModel and BuildingComplex, created at the start and removed in finally. Touches no Testhaus.
import { test, expect, request } from "@playwright/test";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";

const API = `http://localhost:${Number(process.env.API_PORT) || 3001}/api/`;
const MARKE = "TW111822-Musterhaus";
const INTERN = "INTERNE-NOTIZ-W111822";
const GUID = "E2EMoebelRaum000000001"; // 22 characters, like an IFC GUID
const ARTEN = ["BauherrMoeblierung", "BauherrProjekt", "BauherrRueckmeldung"];

/** @param {import("@playwright/test").APIRequestContext} api */
async function resteLoeschen(api) {
  const projekte = await (await api.get("entities/Project")).json();
  const ids = new Set((Array.isArray(projekte) ? projekte : []).filter((p) => JSON.stringify(p).includes(MARKE)).map((p) => p.id));
  for (const e of ["BimModel", "BuildingComplex", ...ARTEN, "Project"]) {
    const alle = await (await api.get(`entities/${e}`)).json();
    for (const r of Array.isArray(alle) ? alle : []) if (ids.has(r.project_id) || (e === "Project" && ids.has(r.id))) await api.delete(`entities/${e}/${r.id}`);
  }
}

test("Möbelrücken in der Vorschau: ziehen, einrasten, drehen, rückgängig — nichts wird gesendet oder gespeichert", async ({ page }, testInfo) => {
  test.setTimeout(180000);
  const api = await request.newContext({ baseURL: API });
  await resteLoeschen(api);
  /** @type {string[]} */
  const meldungen = [];
  page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text())) meldungen.push(m.text()); });
  page.on("pageerror", (e) => meldungen.push(`pageerror ${e}`));
  try {
    const anlegen = async (/** @type {string} */ e, /** @type {object} */ data) => { const r = await api.post(`entities/${e}`, { data }); expect(r.ok(), `${e} anlegen`).toBeTruthy(); return (await r.json()).id; };
    const pid = await anlegen("Project", { name: MARKE, status: "concept", notes: INTERN });
    await anlegen("BimModel", { project_id: pid, name: `Modell ${MARKE}`, storeys: 1, storeyHeight: 3,
      footprintM: [{ x: -1, z: -1 }, { x: 6, z: -1 }, { x: 6, z: 5 }, { x: -1, z: 5 }],
      customZones: [{ _idx: 1, guid: GUID, name: "Arbeiten", level: 0, points: [{ x: 0, z: 0 }, { x: 5, z: 0 }, { x: 5, z: 4 }, { x: 0, z: 4 }] }] });
    const bc = await anlegen("BuildingComplex", { project_id: pid, name: MARKE, moeblierung: { [`guid:${GUID}`]: [{ id: "m1", typ: "schreibtisch", x: 2.5, y: 2, rot: 0 }] } });

    await nurLocalhost(page);
    await page.setViewportSize({ width: 1400, height: 1000 });
    await page.addInitScript((id) => { try { localStorage.setItem("currentProjectId", id); } catch { /* storage blocked */ } }, pid);
    await page.goto("/Bauherrenzugang");
    await expect(page.locator("h1")).toHaveText("Bauherrenzugang");
    const zeile = page.getByTestId("bz-art-BauherrMoeblierung");
    await expect(zeile).toBeVisible({ timeout: 30000 });
    await zeile.getByRole("checkbox").nth(1).check(); // "Vorschlag anfragen" ticks the row as well
    await expect(zeile.getByRole("checkbox").first()).toBeChecked();

    const vorschau = page.getByTestId("bz-vorschau");
    const plan = vorschau.getByTestId("bauherr-moebel-plan");
    await expect(plan).toBeVisible({ timeout: 30000 });
    await plan.scrollIntoViewIfNeeded();
    const tisch = vorschau.getByTestId("bauherr-moebel");
    await expect(tisch).toHaveCount(1);
    const lage = async () => [Number(await tisch.getAttribute("data-x")), Number(await tisch.getAttribute("data-y")), Number(await tisch.getAttribute("data-rot"))];
    expect(await lage()).toEqual([2.5, 2, 0]);
    // pixels per metre of the plan (its viewBox is the room plus a margin, drawn with equal scale in both directions)
    const pxJeM = await plan.evaluate((el) => /** @type {SVGSVGElement} */ (el).getScreenCTM()?.a || 0);
    expect(pxJeM).toBeGreaterThan(20);
    const ziehen = async (/** @type {number} */ dxM, /** @type {number} */ dyM) => {
      const b = await tisch.boundingBox();
      if (!b) throw new Error("Möbel nicht sichtbar");
      const x = b.x + b.width / 2, y = b.y + b.height / 2;
      await page.mouse.move(x, y); await page.mouse.down();
      await page.mouse.move(x + dxM * pxJeM, y + dyM * pxJeM, { steps: 10 }); await page.mouse.up();
    };
    const undo = vorschau.getByTestId("bauherr-moebel-undo");
    await expect(undo).toBeDisabled();

    // 1 m to the right: on the grid, free in the room
    await ziehen(1, 0);
    const nachEins = await lage();
    expect(Math.abs(nachEins[0] - 3.5)).toBeLessThanOrEqual(0.05);
    expect(nachEins[1]).toBe(2);
    await expect(vorschau.getByTestId("bauherr-moebel-anzahl")).toHaveAttribute("data-anzahl", "1");
    // turn in the middle of the room: fits
    await vorschau.getByTestId("bauherr-moebel-drehen").click();
    expect((await lage())[2]).toBe(90);
    await undo.click();
    expect((await lage())[2]).toBe(0);
    // towards the top-left corner: pulled flush to both walls (half sizes 0.80 / 0.40 m)
    await ziehen(-(nachEins[0] - 0.9), -(2 - 0.5));
    expect(await lage()).toEqual([0.8, 0.4, 0]);
    await vorschau.screenshot({ path: testInfo.outputPath("moebel-in-der-ecke.png") }); // for the eye; stays in test-results
    // turned it would stand through the wall: refused, with a sentence
    await vorschau.getByTestId("bauherr-moebel-drehen").click();
    expect((await lage())[2]).toBe(0);
    await expect(vorschau.getByText("Gedreht passt das Möbel hier nicht in den Raum")).toBeVisible();
    // dragged far out of the room: stays inside
    await ziehen(-3, -3);
    const [x, y] = await lage();
    expect(x).toBeGreaterThanOrEqual(0.8); expect(y).toBeGreaterThanOrEqual(0.4);
    // undo step by step back to the released place (each drag was one step)
    await undo.click();
    await undo.click();
    expect(await lage()).toEqual([2.5, 2, 0]);
    await expect(undo).toBeDisabled();
    await expect(vorschau.getByTestId("bauherr-moebel-anzahl")).toHaveAttribute("data-anzahl", "0");

    // preview: nothing is sent; the stored design record is untouched; no internal note leaks
    await ziehen(0.5, 0);
    await expect(vorschau.getByTestId("bauherr-moebel-senden")).toBeDisabled();
    await expect(vorschau).not.toContainText(INTERN);
    const gespeichert = await (await api.get(`entities/BuildingComplex/${bc}`)).json();
    expect(gespeichert.moeblierung[`guid:${GUID}`]).toEqual([{ id: "m1", typ: "schreibtisch", x: 2.5, y: 2, rot: 0 }]);
    expect((await (await api.get("entities/BauherrRueckmeldung")).json()).filter((/** @type {any} */ r) => r.project_id === pid)).toEqual([]);
    expect(meldungen, meldungen.join("\n")).toEqual([]);
  } finally {
    await resteLoeschen(api);
    await api.dispose();
  }
});
