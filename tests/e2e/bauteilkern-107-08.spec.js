// Headless-Nachweis 107-08 (Instanz, GUID, Klassifizierung, Box → Bauteil) im echten Browser, Modellierer + BIM-Studio:
// (1) ein alter Körper ohne Typ bleibt untypisiert (Bestand, D-BK-09 Regel 2); (2) Box 5 × 0,3 m mit der Linie zeichnen
// (Geschosshöhe 3 m) → der Inspektor zeigt sofort „Tragende Innenwand“ mit „abgeleitet (Annahme)“; Strg+Z nimmt nur den Typ
// zurück („Bauteiltyp offen“), Wiederholen setzt ihn wieder; Push/Pull auf 2,5 m behält ihn; (3) „Automatik zurücknehmen“ per
// Klick → „Bauteiltyp offen“, auch nach einer Formänderung; „wieder zulassen“ rechnet neu; (4) Box 0,5 × 0,5 × 3 m wird
// „Stütze“; Steckbrief öffnen heftet die GUID an; „Als Bauteil übernehmen“ schreibt eine Stütze mit quelle_koerper in den
// BIM-Datensatz; Strg-Kopie + „*3“ → vier Stützen, im Zustand trägt nur das Original die GUID, gespeichert haben alle sechs Körper
// je eine eigene (Review 107-08: der Modellierer heftet beim Speichern an); (5) IFC-Export im BIM-Studio: vier verschiedene
// GlobalIds der Stützen-Körper, das übernommene Original nur noch als Proxy (kein zweites IfcColumn an derselben Stelle, Review
// 107-08) mit seiner gespeicherten GUID, genau ein IfcColumn je Stützenposition, die Wand-Box als IFCWALL; der Export heftet die
// GUID der übernommenen Stütze an; (6) „Übernahme zurücknehmen“ entfernt sie wieder.
// Eigenes Projekt, Aufräumen im finally, Konsole sauber.
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";
import fs from "node:fs";
import path from "node:path";

const NAME = "E2E Bauteilkern 10708";
const ORDNER = path.join("test-results", "bauteilkern-107-08");

/** Reference block 6 × 4 m at site (10, 10), 3 m high — an OLD body (no type fields) and the screen mapping of the specs. */
const BLOCK = { id: "k1", name: "Block", profil: [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 4 }, { x: 0, y: 4 }], hoehe: 3, basis: 0, pos: { x: 10, y: 10 }, drehung: 0, gruppe: null };

/** @param {any} request @param {string} name */
async function altWeg(request, name) {
  for (const alt of await (await request.get(`/api/entities/Project?name=${encodeURIComponent(name)}`)).json()) {
    for (const c of await (await request.get(`/api/entities/BuildingComplex?project_id=${alt.id}`)).json()) await request.delete(`/api/entities/BuildingComplex/${c.id}`);
    for (const m of await (await request.get(`/api/entities/BimModel?project_id=${alt.id}`)).json()) await request.delete(`/api/entities/BimModel/${m.id}`);
    await request.delete(`/api/entities/Project/${alt.id}`);
  }
}

/** @param {import("@playwright/test").Page} page @returns {string[]} console errors / warnings that are not offline noise */
function konsole(page) {
  /** @type {string[]} */
  const w = [];
  page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text()) && !/WebGL|GPU stall|maplibre|tile|Failed to load resource|Style is not done loading/i.test(m.text())) w.push(m.text()); });
  page.on("pageerror", (e) => { if (!/WebGL|THREE|getUniforms/i.test(String(e.stack || e))) w.push(`pageerror ${e}`); });
  return w;
}

test("107-08 Box → Bauteil: Typ automatisch und rücknehmbar, Stütze übernehmen, *3 mit neuen GUIDs, IFC", async ({ page, request }) => {
  test.setTimeout(240000);
  fs.mkdirSync(ORDNER, { recursive: true });
  await altWeg(request, NAME);
  const id = (await (await request.post("/api/entities/Project", { data: { name: NAME, build_kind: "neubau", status: "concept" } })).json()).id;
  await request.post("/api/entities/BimModel", { data: { project_id: id, storeys: 1, storeyHeight: 3, massing_layer: { v: 4, koerper: [BLOCK], gruppen: {}, naechsteId: 2 } } });
  const gespeichert = async () => (await (await request.get(`/api/entities/BimModel?project_id=${id}`)).json())[0];
  try {
    await nurLocalhost(page);
    const warnungen = konsole(page);
    await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME)}&tab=studio`);
    await expect(page.getByTestId("mm-leiste")).toBeVisible({ timeout: 60000 });
    await expect(page.getByTestId("mm-koerper")).toHaveCount(1);
    await page.waitForFunction(() => !!(/** @type {any} */ (window).__bitBefehle));
    const befehl = (/** @type {string} */ b, /** @type {any} */ params = {}) => page.evaluate((a) => /** @type {any} */ (window).__bitBefehle.ausfuehren(a[0], a[1]), [b, params]);
    const modell = async () => (await befehl("modell")).result;
    const eingabe = async (/** @type {string} */ text) => expect(await befehl("eingabe", { text })).toMatchObject({ ok: true });

    // site metres → screen through the block outline (site 10…16 × 10…14) and the live screen matrix
    const pfad = page.locator('[data-testid=mm-koerper][data-id="k1"] path').first();
    await pfad.evaluate((el) => el.scrollIntoView({ block: "center" }));
    const bild = async (/** @type {number} */ x, /** @type {number} */ y) => pfad.evaluate((el, a) => {
      const p = /** @type {SVGPathElement} */ (el);
      const b = p.getBBox(), m = /** @type {DOMMatrix} */ (p.getScreenCTM());
      const proM = b.width / 6;
      const q = new window.DOMPoint(b.x + (a[0] - 10) * proM, b.y + (a[1] - 10) * proM).matrixTransform(m);
      return { x: q.x, y: q.y };
    }, [x, y]);
    const hin = async (/** @type {number} */ x, /** @type {number} */ y) => { const q = await bild(x, y); await page.mouse.move(q.x, q.y); };
    const klick = async (/** @type {number} */ x, /** @type {number} */ y) => { const q = await bild(x, y); await page.mouse.move(q.x, q.y); await page.mouse.click(q.x, q.y); await page.waitForTimeout(80); };
    const inspektor = page.getByTestId("mm-bauteil");
    const typText = page.getByTestId("mm-bauteil-typ");

    // (1) the old body stays untyped while its form does not change
    expect(await befehl("auswahl")).toMatchObject({ ok: true });
    await klick(13, 12);
    await expect(inspektor).toHaveAttribute("data-typ", "");
    await expect(typText).toHaveText("Bauteiltyp offen");
    await page.keyboard.press("Escape");

    // (2) a 5 × 0,3 m box drawn with the line tool (typed lengths towards the pointer), 3 m storey height → load-bearing wall
    /** @param {number} x0 @param {number} y0 @param {number} w @param {number} d */
    const rechteck = async (x0, y0, w, d) => {
      expect(await befehl("linie")).toMatchObject({ ok: true });
      // the short side first: a chain whose last point comes within 0.4 m of its start closes at once (flaecheSchliessen)
      await klick(x0, y0);
      await hin(x0, y0 + d + 2); await eingabe(String(d).replace(".", ","));
      await hin(x0 + w + 2, y0 + d); await eingabe(String(w).replace(".", ","));
      await hin(x0 + w, y0 - 2); await eingabe(String(d).replace(".", ","));
      await klick(x0, y0);
    };
    await rechteck(20, 10, 5, 0.3);
    await expect(page.getByTestId("mm-koerper")).toHaveCount(2);
    await expect(inspektor).toHaveAttribute("data-typ", "wand-tragend");
    await expect(typText).toHaveText("Tragende Innenwand");
    await expect(page.getByTestId("mm-bauteil-abgeleitet")).toHaveText("abgeleitet (Annahme)");
    const wand = (await modell()).koerper.find((/** @type {any} */ k) => k.id !== "k1");
    expect(wand).toMatchObject({ bauteil_typ: "wand-tragend", bauteil_typ_quelle: "automatisch", hoehe: 3 });

    // Ctrl+Z takes only the type back (the body stays, "Bauteiltyp offen"); redo sets it again
    expect(await befehl("rueckgaengig")).toMatchObject({ ok: true });
    await expect(page.getByTestId("mm-koerper")).toHaveCount(2);
    await expect(inspektor).toHaveAttribute("data-quelle", "zurueckgenommen");
    await expect(typText).toHaveText("Bauteiltyp offen");
    expect(await befehl("wiederholen")).toMatchObject({ ok: true });
    await expect(inspektor).toHaveAttribute("data-typ", "wand-tragend");

    // push/pull to 2,5 m (a change of form): still a wall, still derived
    await eingabe("-0,5");
    await expect.poll(async () => (await modell()).koerper.find((/** @type {any} */ k) => k.id === wand.id).hoehe).toBe(2.5);
    await expect(inspektor).toHaveAttribute("data-quelle", "automatisch");

    // (3) one click takes the automatic back — and a later change of form does not set it again
    await page.getByTestId("mm-typ-zurueck").click();
    await expect(typText).toHaveText("Bauteiltyp offen");
    await expect(inspektor).toHaveAttribute("data-quelle", "zurueckgenommen");
    await eingabe("0,5");
    await expect.poll(async () => (await modell()).koerper.find((/** @type {any} */ k) => k.id === wand.id).hoehe).toBe(3);
    await expect(typText).toHaveText("Bauteiltyp offen");
    await page.getByTestId("mm-typ-zulassen").click();
    await expect(inspektor).toHaveAttribute("data-typ", "wand-tragend");
    await expect(page.getByTestId("mm-bauteil-abgeleitet")).toBeVisible();

    // (4) a 0,5 × 0,5 × 3 m box becomes a column (never a wall)
    await rechteck(30, 10, 0.5, 0.5);
    await expect(page.getByTestId("mm-koerper")).toHaveCount(3);
    await expect(typText).toHaveText("Stütze");
    const stuetze = (await modell()).koerper.find((/** @type {any} */ k) => k.bauteil_typ === "stuetze");
    expect(stuetze).toBeTruthy();
    // the full inspector belongs to the selection tool (a drawing tool shows only the compact type mark); the data sheet pins the GUID
    await expect(page.getByTestId("mm-steckbrief")).toHaveCount(0);
    expect(await befehl("auswahl")).toMatchObject({ ok: true });
    await page.getByTestId("mm-steckbrief").click();
    await expect(page.getByTestId("mm-steckbrief-guid")).toHaveText(/^[0-9A-Za-z_$]{22}$/);
    const stuetzeGuid = (await modell()).koerper.find((/** @type {any} */ k) => k.id === stuetze.id).guid;
    expect(stuetzeGuid).toHaveLength(22);
    // take over: a column with quelle_koerper in the BIM record, the button turns into "Übernahme zurücknehmen"
    await page.getByTestId("mm-als-bauteil").click();
    await expect(page.getByTestId("mm-uebernahme-zurueck")).toBeVisible();
    await expect.poll(async () => ((await gespeichert()).customColumns || []).filter((/** @type {any} */ c) => c.quelle_koerper === stuetze.id).length, { timeout: 20000 }).toBe(1);

    // Ctrl copy, then "*3" → three copies, none of them carries the stored guid
    expect(await befehl("verschieben")).toMatchObject({ ok: true });
    await klick(30.25, 10.25);
    await page.keyboard.down("Control");
    await klick(32.25, 10.25);
    await page.keyboard.up("Control");
    await eingabe("*3");
    await expect(page.getByTestId("mm-koerper")).toHaveCount(6);
    const stuetzen = (await modell()).koerper.filter((/** @type {any} */ k) => k.bauteil_typ === "stuetze");
    expect(stuetzen).toHaveLength(4);
    expect(stuetzen.filter((/** @type {any} */ k) => k.guid)).toEqual([expect.objectContaining({ id: stuetze.id, guid: stuetzeGuid })]);
    await expect.poll(async () => ((await gespeichert()).massing_layer?.koerper || []).length, { timeout: 20000 }).toBe(6);
    // review 107-08: every save of the modeller pins the GUID of each body — six stored GUIDs, all different, the original's unchanged
    await expect.poll(async () => ((await gespeichert()).massing_layer?.koerper || []).filter((/** @type {any} */ k) => String(k.guid || "").length === 22).length, { timeout: 20000 }).toBe(6);
    const gespeicherteGuids = ((await gespeichert()).massing_layer.koerper).map((/** @type {any} */ k) => k.guid);
    expect(new Set(gespeicherteGuids).size).toBe(6);
    expect(((await gespeichert()).massing_layer.koerper).find((/** @type {any} */ k) => k.id === stuetze.id).guid).toBe(stuetzeGuid);

    // (5) IFC export of the BIM studio: four different GlobalIds of the column bodies, the original with its stored guid
    await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME)}&tab=bim`);
    const knopf = page.getByRole("button", { name: "Als IFC exportieren" });
    await expect(knopf).toBeVisible({ timeout: 60000 });
    const [dl] = await Promise.all([page.waitForEvent("download"), knopf.click()]);
    const datei = path.join(ORDNER, "instanzen.ifc");
    await dl.saveAs(datei);
    const ifc = fs.readFileSync(datei, "utf8");
    const saeulen = [...ifc.matchAll(/=IFCCOLUMN\('([^']{22})',\$,'[^']*',\$,'Massing',#\d+,#\d+,'(k\d+)',\.COLUMN\.\)/g)].map((m) => ({ guid: m[1], id: m[2] }));
    // review 107-08: the taken-over original is no IfcColumn of its own any more (its column is the BIM element) — a proxy with its guid
    expect(saeulen).toHaveLength(3);
    expect(saeulen.some((s) => s.id === stuetze.id)).toBe(false);
    const original = ifc.match(new RegExp(`=IFCBUILDINGELEMENTPROXY\\('([^']{22})',\\$,'[^']*',\\$,'Massing',#\\d+,#\\d+,'${stuetze.id}',\\.ELEMENT\\.\\)`));
    expect(original?.[1]).toBe(stuetzeGuid);
    expect(new Set([...saeulen.map((s) => s.guid), stuetzeGuid]).size).toBe(4);
    for (const s of saeulen) expect(gespeicherteGuids).toContain(s.guid);
    // exactly one IfcColumn per column position: three copies + the taken-over column at the original's place
    expect((ifc.match(/=IFCCOLUMN\(/g) || []).length).toBe(4);
    expect(ifc).toContain("'Uebernommen_als_Bauteil',$,IFCBOOLEAN(.T.)");
    expect(ifc).toMatch(new RegExp(`=IFCWALL\\('[^']{22}',\\$,'[^']*',\\$,'Massing',#\\d+,#\\d+,'${wand.id}',\\.STANDARD\\.\\)`));
    expect(ifc).toContain("'Bauteiltyp_Herkunft',$,IFCLABEL('abgeleitet (Annahme)')");
    // the taken-over column is an element of the BIM model (no Massing object type) — and the export pinned its GUID
    expect(ifc).toMatch(/=IFCCOLUMN\('[^']{22}',\$,'St\\X2\\00FC\\X0\\tze',\$,\$,/);
    await expect.poll(async () => String(((await gespeichert()).customColumns || [])[0]?.guid || "").length, { timeout: 20000 }).toBe(22);

    // (6) back in the modeller: "Übernahme zurücknehmen" removes the column from the BIM record again; the body stays
    await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME)}&tab=studio`);
    await expect(page.getByTestId("mm-koerper")).toHaveCount(6, { timeout: 60000 });
    await page.waitForFunction(() => !!(/** @type {any} */ (window).__bitBefehle));
    await pfad.evaluate((el) => el.scrollIntoView({ block: "center" }));
    expect(await befehl("auswahl")).toMatchObject({ ok: true });
    await klick(30.25, 10.25);
    await expect(page.getByTestId("mm-uebernahme-zurueck")).toBeVisible();
    await page.getByTestId("mm-uebernahme-zurueck").click();
    await expect(page.getByTestId("mm-als-bauteil")).toBeVisible();
    await expect.poll(async () => ((await gespeichert()).customColumns || []).length, { timeout: 20000 }).toBe(0);
    await expect(page.getByTestId("mm-koerper")).toHaveCount(6);

    expect(warnungen, warnungen.join("\n")).toEqual([]);
  } finally {
    await altWeg(request, NAME);
  }
});
