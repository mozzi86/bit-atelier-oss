// Headless proof 107-04: the opening chain. A rectangle pushed through a wall face in 3D (two clicks, tool "Öffnung") becomes an opening WITHOUT
// filling (position, sill, width, height from the corners in wall coordinates, host by GUID); in the IFC it is an IfcOpeningElement with
// IfcRelVoidsElement and no filling. Move the wall: the opening follows (3D hole, IFC placement relative to the wall). A click with the tool
// "Fenster" on a wall face places a window through the same setter as the click in the plan; own width/height/sill and the height anchor OKFF
// are inputs and reach 3D, the Sturz display and the IFC; a too tight opening is reported in the hint (no silent clamp). A hull wall with a
// build-up is drawn layer by layer and the hole of a new opening is cut through EVERY layer. Penetrations of the openings planning: an executed
// one is a hole in 3D and an IfcOpeningElement in the host, a requested one an IfcBuildingElementProxy PROVISIONFORVOID; one off its host
// is named by check 12. A rectangle on a drawn slab in 3D is a hole of the slab (3D, plan, IFC).
// Own project, the studio saves by itself; the 3D numbers come from the test hook window.__bitZeigen.bimAenderung (waende3d, loecher3d,
// kamera, bildpunkt3d, ...), the IFC values from the downloaded text.
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";
import fs from "node:fs";
import path from "node:path";

const NAME = "E2E Bauteilkern 10704";
const ORDNER = path.join("test-results", "bauteilkern-107-04");
const WAND1 = "0wandE2E10704Wand00001"; // stored GUIDs (22 characters): the hosts keep them in every export
const WAND3 = "0wandE2E10704Wand00003";

function wache(page) {
  const warnungen = [];
  page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text()) && !/GPU stall|WebGL|wasm/i.test(m.text())) warnungen.push(m.text()); });
  page.on("pageerror", (e) => { if (!/Error creating WebGL context|getUniforms/i.test(String(e.stack || e))) warnungen.push(`pageerror ${e}`); });
  return warnungen;
}

const befehl = (page, id, params = {}) => page.evaluate(
  ([i, p]) => JSON.parse(/** @type {any} */ (window).__bitBefehle.zeileBearbeiten(JSON.stringify({ id: i, method: "ausfuehren", params: { befehl: i, params: p } }))),
  [id, params],
);
const hook = (page, name, ...args) => page.evaluate(([n, a]) => /** @type {any} */ (window).__bitZeigen.bimAenderung[n](...a), [name, args]);
const modellStand = (page) => hook(page, "modell");

/** Rows of the STEP text by id. */
function zeilenMap(ifc) {
  const m = new Map();
  for (const l of ifc.split("\n")) { const r = l.match(/^#(\d+)=([A-Z0-9]+)\((.*)\);$/); if (r) m.set(`#${r[1]}`, { typ: r[2], args: r[3] }); }
  return m;
}
const anzahl = (ifc, k) => (ifc.match(new RegExp(`=${k}\\(`, "g")) || []).length;
/** Placement point [x, y, z] of a placement row id (IFCLOCALPLACEMENT → IFCAXIS2PLACEMENT3D → IFCCARTESIANPOINT). */
function punktVon(rows, plRef) {
  const a2p = rows.get(rows.get(plRef).args.split(",")[1]).args.split(",")[0];
  return rows.get(a2p).args.match(/^\(([-\d.]+),([-\d.]+),([-\d.]+)\)$/).slice(1, 4).map(Number);
}
/** Elements of one IFC class by GUID or name: placement ref, local point, profile sizes, extrusion depth. */
function elemente(ifc, klasse) {
  const rows = zeilenMap(ifc);
  const out = [];
  for (const [id, r] of rows) {
    if (r.typ !== klasse) continue;
    const p = r.args.split(",");
    const pl = p[5], pds = p[6];
    if (!/^#\d+$/.test(pl)) continue;
    const name = r.args.match(/^'[^']*',\$,'([^']*)'/)?.[1] ?? "";
    const sr = rows.get(pds)?.args.match(/\(\s*(#\d+)\s*\)/)?.[1];
    const solid = sr ? rows.get(rows.get(sr).args.match(/'SweptSolid',\((#\d+)\)/)[1]) : null;
    const prof = solid ? rows.get(solid.args.split(",")[0]) : null;
    out.push({ id, name, guid: r.args.match(/^'([^']*)'/)[1], plRef: pl, lokal: punktVon(rows, pl), eltern: rows.get(pl).args.split(",")[0],
      profilTyp: prof?.typ, profil: prof ? prof.args.split(",").slice(3).map(Number) : [], tiefe: solid ? Number(solid.args.split(",").at(-1)) : NaN, args: r.args });
  }
  return out;
}
/** Wall (by stored GUID) the IfcRelVoidsElement of an opening element points to. */
function wirtGuidDer(ifc, oeffnungId) {
  const rows = zeilenMap(ifc);
  const rel = [...rows.values()].find((r) => r.typ === "IFCRELVOIDSELEMENT" && r.args.endsWith(`,${oeffnungId}`));
  const wand = rows.get(rel.args.split(",").at(-2));
  return { klasse: wand.typ, guid: wand.args.match(/^'([^']*)'/)[1] };
}

test.describe("107-04 Öffnungskette: Wirt, Maße, Höhenanker, fülllose Öffnung, Durchbrüche, Deckenöffnung", () => {
  test.setTimeout(480000);

  test("Rechteck auf der Wandfläche in 3D, Öffnung folgt der Wand, Fensterklick, Maße und OKFF, Hüllwand schichtweise, Durchbrüche, Deckenloch", async ({ page, request }) => {
    await page.setViewportSize({ width: 1500, height: 1000 });
    fs.mkdirSync(ORDNER, { recursive: true });
    let id = null;
    const created = [];
    try {
      await nurLocalhost(page);
      const warnungen = wache(page);
      for (const alt of await (await request.get(`/api/entities/Project?name=${encodeURIComponent(NAME)}`)).json()) await request.delete(`/api/entities/Project/${alt.id}`);
      id = (await (await request.post("/api/entities/Project", { data: { name: NAME, build_kind: "neubau", status: "concept" } })).json()).id;
      const RECHT = (x0, x1, z0, z1) => [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }];
      await request.post("/api/entities/BimModel", { data: {
        project_id: id, storeys: 2, storeyHeight: 3, envComposite: "cavity",
        customWalls: [
          { a: { x: -9, z: -5 }, b: { x: -4, z: -5 }, level: 0, thickness: 0.3, height: 3, guid: WAND1, _idx: 1 },
          { a: { x: 2, z: -5 }, b: { x: 8, z: -5 }, level: 0, thickness: 0.24, height: 3, guid: WAND3, _idx: 3 },
        ],
        customSlabs: [{ points: RECHT(12, 18, -3, 3), level: 0, _idx: 4 }], // outside the hull (±10 × ±7), so nothing covers it from above
      } });
      // penetrations of the openings planning on the wall 3 (axis z = −5, from x = 2 to 8, 24 cm, 3 m high)
      const dur = (nr, extra) => ({ project_id: id, nr, art: "durchbruch", form: "rechteck", b: 0.3, h: 0.4, y: -5, z: 1.5, bauteil_guid: WAND3, feuerwiderstand: "ohne", pruefung: { statik: null, architekt: null }, ...extra });
      for (const d of [
        dur("D-001", { x: 3, b: 0.2, h: 0.2, status: "beantragt" }),
        dur("D-002", { x: 5, status: "ausgefuehrt" }),
        dur("D-003", { x: 7, y: -4.2, status: "ausgefuehrt" }), // 0,8 m off the wall axis: not in its host
        dur("D-004", { x: 6, y: -4.91, t: 0.06, art: "schlitz", status: "ausgefuehrt" }), // slot 6 cm deep, 9 cm off the axis: a recess, not a hole
      ]) created.push((await (await request.post("/api/entities/Durchbruch", { data: d })).json()).id);

      await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME)}&tab=bim`);
      await page.waitForFunction(() => !!(/** @type {any} */ (window).__bitBefehle), null, { timeout: 60000 });
      const canvas = page.locator("canvas:visible").first();
      await expect(canvas).toBeVisible({ timeout: 60000 });
      await canvas.scrollIntoViewIfNeeded();
      const gespeichert = async () => (await (await request.get(`/api/entities/BimModel?project_id=${id}`)).json())[0];
      const ifcLaden = async (name) => {
        const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Als IFC exportieren" }).click()]);
        const datei = path.join(ORDNER, name);
        await dl.saveAs(datei);
        return fs.readFileSync(datei, "utf8");
      };
      const klickAuf = async (p) => {
        const px = await hook(page, "bildpunkt3d", p);
        await page.mouse.click(px.x, px.y);
      };
      const kamera = (ziel, radius = 6) => hook(page, "kamera", { theta: Math.PI / 2, phi: 1.35, radius, ziel });
      const werkzeug = (name) => page.getByRole("button", { name, exact: true }).click();

      // ---- hull wall with a build-up is drawn layer by layer (before: one body, coloured by layer 1) ----
      await expect.poll(async () => Object.keys(await hook(page, "huellwandSchichten3d")).length, { timeout: 30000 }).toBeGreaterThan(0);
      const schichten = (await hook(page, "huellwandSchichten3d"))["0:0"];
      expect(schichten, "Hüllwand 0:0 hat mehrere Schichtkörper (Aufbau cavity)").toBeGreaterThan(2);

      // ---- 3D rectangle on the wall 1 (face z = −5 + 0,15, seen from inside the hull): two clicks → opening WITHOUT filling ----
      await werkzeug("Öffnung");
      await kamera({ x: -6.5, y: 1.5, z: -5 });
      await klickAuf({ x: -8, y: 0.8, z: -4.85 });
      await expect(page.locator("body")).toContainText("zweite Ecke");
      await klickAuf({ x: -6.5, y: 2.0, z: -4.85 });
      await expect.poll(async () => (await modellStand(page)).customWindows?.length, { timeout: 15000 }).toBe(1);
      const o1 = (await modellStand(page)).customWindows[0];
      expect(o1).toMatchObject({ kind: "oeffnung", wallIdx: 1, wirt_guid: WAND1 });
      expect(Math.abs(o1.u - 1.75), `u ${o1.u}`).toBeLessThan(0.06);       // corners at u = 1,0 and 2,5 of the wall from x = −9
      expect(Math.abs(o1.width - 1.5), `Breite ${o1.width}`).toBeLessThan(0.08);
      expect(Math.abs(o1.sill - 0.8), `Brüstung ${o1.sill}`).toBeLessThan(0.06);
      expect(Math.abs(o1.height - 1.2), `Höhe ${o1.height}`).toBeLessThan(0.08);
      await expect.poll(async () => ((await hook(page, "loecher3d")).wand[1] || []).reduce((s, n) => s + n, 0), { timeout: 20000, message: "3D: die Wand hat ein Loch" }).toBe(1);
      await page.screenshot({ path: path.join(ORDNER, "oeffnung-3d.png") });

      // IFC: IfcOpeningElement + IfcRelVoidsElement at the wall, NO filling
      let ifc = await ifcLaden("oeffnung-ohne-fuellung.ifc");
      let op = elemente(ifc, "IFCOPENINGELEMENT").filter((e) => /\\X2\\00D6\\X0\\ffnung/.test(e.name));
      expect(op.length, "eine Öffnung ohne Füllung im IFC").toBe(1);
      // (the hull has rule windows and an entrance door of its own, so count the fillings of THIS opening)
      expect([...zeilenMap(ifc).values()].filter((r) => r.typ === "IFCRELFILLSELEMENT" && r.args.includes(`,${op[0].id},`)).length, "keine Füllung").toBe(0);
      expect(wirtGuidDer(ifc, op[0].id)).toEqual({ klasse: "IFCWALL", guid: WAND1 });
      expect(Math.abs(op[0].profil[0] - o1.width)).toBeLessThan(1e-3);          // IFC = record = 3D
      expect(Math.abs(op[0].profil[1] - (0.3 + 0.04))).toBeLessThan(1e-3);
      expect(Math.abs(op[0].tiefe - o1.height)).toBeLessThan(1e-3);
      expect(Math.abs(op[0].lokal[0] - (o1.u - 2.5)), "Void-Mitte relativ zur Wandmitte (Wand 5 m)").toBeLessThan(1e-3);
      expect(Math.abs(op[0].lokal[2] - o1.sill)).toBeLessThan(1e-3);
      const wandMitte = (e) => punktVon(zeilenMap(ifc), e.eltern);
      expect(wandMitte(op[0])[0], "Wandmitte vor dem Verschieben (a −9, b −4)").toBeCloseTo(-6.5, 3);

      // ---- move the wall: the opening follows (it hangs on the wall) ----
      expect((await befehl(page, "auswahl-guid", { guid: WAND1 })).ok).toBe(true);
      await expect(page.getByRole("button", { name: /Auswahl löschen/ })).toBeVisible(); // the selection is rendered (the key handler is bound per render)
      await page.waitForTimeout(300);
      await page.keyboard.press("Shift+ArrowRight"); // +1 m
      await expect.poll(async () => (await modellStand(page)).customWalls.find((w) => w._idx === 1)?.a.x, { timeout: 15000 }).toBe(-8);
      await expect.poll(async () => { const b = (await hook(page, "waende3d"))[1]; return b ? Math.round(b.min[0] * 100) : null; }, { timeout: 20000, message: "3D: Wand liegt ab x = −8" }).toBe(-800);
      expect(((await hook(page, "loecher3d")).wand[1] || []).reduce((s, n) => s + n, 0), "3D: das Loch ist noch da").toBe(1);
      expect((await modellStand(page)).customWindows[0].u, "u ist an die Wand gebunden, nicht an den Raum").toBe(o1.u);
      ifc = await ifcLaden("oeffnung-nach-verschieben.ifc");
      op = elemente(ifc, "IFCOPENINGELEMENT").filter((e) => /\\X2\\00D6\\X0\\ffnung/.test(e.name));
      expect(wandMitte(op[0])[0], "Wandmitte nach dem Verschieben (a −8, b −3)").toBeCloseTo(-5.5, 3);
      expect(Math.abs(op[0].lokal[0] - (o1.u - 2.5)), "Void-Lage relativ zur Wand unverändert: sie folgt").toBeLessThan(1e-3);

      // ---- click in the plan with the tool "Öffnung": same setter, type size (1,00 × 2,10), host by GUID ----
      await page.getByRole("button", { name: "Ansicht Grundriss" }).click();
      await werkzeug("Wand");
      const flaeche = page.locator("[data-bim-plan2d] svg").first();
      await expect(flaeche).toBeVisible();
      await flaeche.click({ position: { x: 380, y: 300 } });
      await flaeche.click({ position: { x: 560, y: 330 } });
      await page.keyboard.press("Escape");
      await expect.poll(async () => (await modellStand(page)).customWalls.length, { timeout: 15000 }).toBe(3);
      const neueWand = (await modellStand(page)).customWalls.find((w) => ![1, 3].includes(w._idx));
      await werkzeug("Öffnung");
      await flaeche.click({ position: { x: 470, y: 315 } });
      await expect.poll(async () => (await modellStand(page)).customWindows.length, { timeout: 15000 }).toBe(2);
      const o2 = (await modellStand(page)).customWindows.find((o) => o._idx !== o1._idx);
      expect(o2).toMatchObject({ kind: "oeffnung", typeId: "oeffnung", wallIdx: neueWand._idx });
      expect(o2.width, "Plan-Klick: kein eigenes Maß, es gilt das Typmaß").toBeUndefined();
      expect(o2.wirt_guid, "Plan-Klick setzt den Wirt wie der 3D-Klick").toMatch(/^[0-9A-Za-z_$]{22}$/);
      await page.getByRole("button", { name: "Pfeil", exact: true }).click();

      // ---- window with the tool "Fenster" on the wall face in 3D (type size at the clicked position) ----
      await page.getByRole("button", { name: "Ansicht 3D" }).click();
      await werkzeug("Fenster");
      await kamera({ x: -5.5, y: 1.5, z: -5 });
      await klickAuf({ x: -4.2, y: 1.5, z: -4.85 });
      await expect.poll(async () => (await modellStand(page)).customWindows.filter((o) => o.kind === "window").length, { timeout: 15000 }).toBe(1);
      const fenster = (await modellStand(page)).customWindows.find((o) => o.kind === "window");
      expect(fenster).toMatchObject({ wallIdx: 1, typeId: "double", wirt_guid: WAND1 });
      expect(Math.abs(fenster.u - 3.8), `u ${fenster.u}`).toBeLessThan(0.08); // x = −4,2 on the wall from x = −8
      await page.getByRole("button", { name: "Pfeil", exact: true }).click();

      // ---- inspector: own sizes (empty = type), lintel, height anchor OKFF ----
      await hook(page, "oeffnungWaehlen", fenster._idx);
      await expect(page.getByTestId("oeffnung-width")).toHaveAttribute("placeholder", "1.8");
      await expect(page.getByTestId("oeffnung-sturz")).toHaveText("2.30");
      await page.getByTestId("oeffnung-width").fill("1.2");
      await page.getByTestId("oeffnung-height").fill("1");
      await page.getByTestId("oeffnung-sill").fill("0.5");
      await expect.poll(async () => (await modellStand(page)).customWindows.find((o) => o._idx === fenster._idx)?.height).toBe(1);
      await expect(page.getByTestId("oeffnung-sturz")).toHaveText("1.50");
      await page.getByTestId("oeffnung-bezug").selectOption("okff");
      await expect(page.getByTestId("oeffnung-sturz"), "OKFF = Oberkante Bodenplatte 0,25 m: Sturz 0,5 + 0,25 + 1,0").toHaveText("1.75");
      ifc = await ifcLaden("fenster-okff.ifc");
      const fensterAnWand1 = (text) => elemente(text, "IFCOPENINGELEMENT").filter((e) => /Fenster/.test(e.name) && wirtGuidDer(text, e.id).guid === WAND1); // (the hull has rule windows of its own)
      const fo = fensterAnWand1(ifc)[0];
      expect(fensterAnWand1(ifc).length, "das Fenster steht im IFC").toBe(1);
      expect(Math.abs(fo.profil[0] - 1.2)).toBeLessThan(1e-3);
      expect(Math.abs(fo.tiefe - 1)).toBeLessThan(1e-3);
      expect(Math.abs(fo.lokal[2] - 0.75), "Void ab Wand-Unterkante: 0,5 + 0,25").toBeLessThan(1e-3);
      expect(ifc).toMatch(/'Bruestung_Bezug',\$,IFCLABEL\('OKFF'\)/);
      // a too tight opening: named in the hint (3D clamps it, the IFC leaves it out), no silent clamp
      await page.getByTestId("oeffnung-width").fill("9");
      await expect(page.locator("body")).toContainText("passt nicht in die Wand", { timeout: 10000 });
      await expect(page.locator("body")).toContainText("im 3D auf die Wand begrenzt");
      const meldIfc = await ifcLaden("fenster-zu-breit.ifc");
      expect(fensterAnWand1(meldIfc).length, "der Export lässt sie aus").toBe(0);
      await expect(page.locator("body")).toContainText("NICHT enthalten");
      await page.getByTestId("oeffnung-width").fill("1.2");
      await expect(page.locator("body")).not.toContainText("im 3D auf die Wand begrenzt", { timeout: 10000 });

      // ---- hull wall with build-up: a new opening's hole goes through EVERY layer ----
      const vorHuelle = (await hook(page, "loecher3d")).huelle["0:0"];
      await werkzeug("Öffnung");
      await kamera({ x: -2, y: 1.5, z: -7 });
      await klickAuf({ x: -2.8, y: 1.0, z: -6.77 });
      await klickAuf({ x: -1.2, y: 2.2, z: -6.77 });
      await expect.poll(async () => (await modellStand(page)).envOpenings?.length, { timeout: 15000 }).toBe(1);
      expect((await modellStand(page)).envOpenings[0]).toMatchObject({ kind: "oeffnung", level: 0, edge: 0 });
      await expect.poll(async () => (await hook(page, "loecher3d")).huelle["0:0"].every((n, i) => n === vorHuelle[i] + 1), { timeout: 20000, message: "3D: in jeder Schicht der Hüllwand ein Loch mehr" }).toBe(true);
      expect((await hook(page, "loecher3d")).huelle["0:0"].length, "die Schichten sind einzelne Körper").toBe(schichten);

      // ---- the opening without a filling on a hull wall has no 3D mesh: the plan is where it is picked, edited and deleted (107-04 review) ----
      await page.getByRole("button", { name: "Ansicht Grundriss" }).click();
      await page.getByRole("button", { name: "Pfeil", exact: true }).click();
      await page.locator("[data-huell-oeffnung]").first().click();
      await expect(page.getByTestId("oeffnung-width")).toBeVisible({ timeout: 10000 });
      await page.getByTestId("oeffnung-width").fill("1.1");
      await expect.poll(async () => (await modellStand(page)).envOpenings[0]?.width, { timeout: 15000 }).toBe(1.1);
      await page.getByRole("button", { name: /Auswahl löschen/ }).click();
      await expect.poll(async () => (await modellStand(page)).envOpenings.length, { timeout: 15000 }).toBe(0);
      await page.getByRole("button", { name: "Ansicht 3D" }).click();

      // ---- penetrations of the openings planning ----
      const lo = await hook(page, "loecher3d");
      expect((lo.wand[3] || []).reduce((s, n) => s + n, 0), "ausgeführter Durchbruch D-002 ist ein Loch in der Wand 3 (D-003 liegt nicht im Wirt: kein Loch)").toBe(1);
      expect(lo.vormerkungen, "beantragter D-001, der Durchbruch D-003 neben seinem Wirt und der Schlitz D-004 (Teiltiefe: Marker, kein Durchgangsloch) als Vormerkung sichtbar").toBe(3);
      ifc = await ifcLaden("durchbrueche.ifc");
      const proxies = elemente(ifc, "IFCBUILDINGELEMENTPROXY").filter((e) => /PROVISIONFORVOID/.test(e.args));
      expect(proxies.map((e) => e.name).sort()).toEqual(["Durchbruch D-001", "Durchbruch D-003"]);
      const d2 = elemente(ifc, "IFCOPENINGELEMENT").find((e) => /Durchbruch D-002/.test(e.name));
      expect(d2, "ausgeführter Durchbruch ist eine Öffnung").toBeTruthy();
      expect(wirtGuidDer(ifc, d2.id)).toEqual({ klasse: "IFCWALL", guid: WAND3 });
      expect(Math.abs(d2.lokal[2] - 1.3), "Brüstung = z 1,5 − h/2 0,2").toBeLessThan(1e-3);
      expect(Math.abs(d2.profil[1] - (0.24 + 0.04)), "D-002 geht durch: Wanddicke + 4 cm").toBeLessThan(1e-3);
      // the slot D-004 (t 6 cm) is a void of depth t + 2 cm at the nearest wall face — not through the whole wall
      const d4 = elemente(ifc, "IFCOPENINGELEMENT").find((e) => /Durchbruch D-004/.test(e.name));
      expect(d4, "Schlitz ist eine Öffnung am Wirt").toBeTruthy();
      expect(Math.abs(d4.profil[1] - 0.08), `Tiefe ${d4.profil[1]}`).toBeLessThan(1e-3);
      expect(Math.abs(d4.lokal[1] - 0.1), "Mitte quer: +0,12 − 0,03 + 0,01 zur +n-Fläche").toBeLessThan(1e-3);
      expect(ifc).toMatch(/'Tiefe',\$,IFCREAL\(0\.0600\)/);
      await expect(page.locator("body")).toContainText("Durchbruch D-003: liegt nicht im Wirt");
      // check 12 names the penetration off its host in the plan views
      await page.getByRole("button", { name: "Ansicht Grundriss" }).click();
      await page.getByTestId("fehlplanung").getByRole("button").click();
      await expect(page.locator('[data-testid="fehlplanung-befund"][data-code="durchbruch_ausserhalb_wirt"]')).toContainText("D-003: Durchbruch liegt nicht im zugeordneten Bauteil", { timeout: 15000 });
      await expect(page.locator('[data-testid="fehlplanung-befund"][data-code="durchbruch_ausserhalb_wirt"]'), "nur D-003, D-002 liegt in der Wand").toHaveCount(1);
      await page.getByTestId("fehlplanung").getByRole("button").click();

      // ---- slab: a rectangle on its top face in 3D → hole in 3D, plan and IFC ----
      await page.getByRole("button", { name: "Ansicht 3D" }).click();
      await werkzeug("Öffnung");
      await hook(page, "kamera", { theta: Math.PI / 2, phi: 0.2, radius: 10, ziel: { x: 15, y: 3, z: 0 } });
      await klickAuf({ x: 13.5, y: 3.0, z: -1 });
      await expect(page.locator("body")).toContainText("zweite Ecke");
      await klickAuf({ x: 16, y: 3.0, z: 1.5 });
      await expect.poll(async () => (await modellStand(page)).customSlabs[0]?.oeffnungen?.length, { timeout: 15000 }).toBe(1);
      const loch = (await modellStand(page)).customSlabs[0].oeffnungen[0].points;
      expect(Math.abs(Math.min(...loch.map((p) => p.x)) - 13.5)).toBeLessThan(0.1);
      expect(Math.abs(Math.max(...loch.map((p) => p.z)) - 1.5)).toBeLessThan(0.1);
      await expect.poll(async () => (await hook(page, "loecher3d")).decke[4], { timeout: 20000, message: "3D: die Decke hat ein Loch" }).toBe(1);
      ifc = await ifcLaden("deckenoeffnung.ifc");
      const dl = elemente(ifc, "IFCOPENINGELEMENT").find((e) => /Decken\\X2\\00F6\\X0\\ffnung/.test(e.name));
      expect(dl, "Deckenöffnung im IFC").toBeTruthy();
      expect(wirtGuidDer(ifc, dl.id).klasse).toBe("IFCSLAB");
      expect(Math.abs(dl.tiefe - (0.22 + 0.04))).toBeLessThan(1e-3);
      await page.getByRole("button", { name: "Pfeil", exact: true }).click();
      await page.getByRole("button", { name: "Ansicht Grundriss" }).click();
      await expect(page.locator('[data-bim-plan2d] svg path[fill-rule="evenodd"]').first(), "Plan: die Decke ist mit Loch gezeichnet").toBeVisible({ timeout: 15000 });
      await page.screenshot({ path: path.join(ORDNER, "plan-deckenloch.png") });

      // ---- persisted: after a reload the openings, the hole and the penetrations are all there ----
      await expect.poll(async () => { const g = await gespeichert(); return `${g.customWindows?.length}|${g.envOpenings?.length}|${g.customSlabs?.[0]?.oeffnungen?.length}`; }, { timeout: 20000 }).toBe("3|0|1");

      expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
    } finally {
      for (const d of created) await request.delete(`/api/entities/Durchbruch/${d}`).catch(() => {});
      if (id) {
        for (const m of await (await request.get(`/api/entities/BimModel?project_id=${id}`)).json()) await request.delete(`/api/entities/BimModel/${m.id}`);
        await request.delete(`/api/entities/Project/${id}`);
      }
    }
  });
});
