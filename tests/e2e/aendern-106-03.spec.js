// Headless proof 106-03: the change tools in the BIM studio, driven through the command register
// (window.__bitBefehle, like auswahl-106-02) and the preview buttons.
// A change is a PROPOSAL first: sentence in words, check, preview at the model; it runs only after Übernehmen
// (button) or "bestaetigen" (a person at the keyboard) - never through the agent channel. Every executed step
// carries its origin and goes back on its own. A blocked check (fehler) disables Übernehmen and refuses bestaetigen.
// Own project with three drawn walls (like auswahl-106-02: beside the default hull): the model is saved by the studio
// (auto-save), so each step is also proved against the stored record, not only against the screen.
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";
import fs from "node:fs";
import path from "node:path";

const TOKEN_DATEI = path.join(process.env.BIT_DATA_DIR || "server", "steuerung.token");
const KEINE_AUSWAHL = "Keine Auswahl — erst ein Bauteil zeigen oder mit auswahl-guid wählen";
const guid = (s) => s.padEnd(22, "x").slice(0, 22); // a stored 22-character GUID wins over the derived one
const GA = guid("AendernWandA10603");
const GB = guid("AendernWandB10603");
const GC = guid("AendernWandC10603");

function wache(page) {
  const warnungen = [];
  page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text()) && !/GPU stall|WebGL|wasm/i.test(m.text())) warnungen.push(m.text()); });
  page.on("pageerror", (e) => { if (!/Error creating WebGL context|getUniforms/i.test(String(e.stack || e))) warnungen.push(`pageerror ${e}`); });
  return warnungen;
}

/** One command through the register's JSON line (a person at the window: no control-channel marker). */
const befehl = (page, id, params = {}) => page.evaluate(
  ([i, p]) => JSON.parse(/** @type {any} */ (window).__bitBefehle.zeileBearbeiten(JSON.stringify({ id: i, method: "ausfuehren", params: { befehl: i, params: p } }))),
  [id, params],
);

/** One command through the HTTP control channel = an agent. 504 is retried (see auswahl-106-02); callers tolerate a repeat. */
const ueberKanal = async (request, id, befehlId, params = {}) => {
  const token = fs.readFileSync(TOKEN_DATEI, "utf-8").trim();
  let a = { status: 0, json: /** @type {any} */ (null) };
  for (let versuch = 0; versuch < 8; versuch++) {
    const r = await request.post("/api/steuerung", { data: { id, method: "ausfuehren", params: { befehl: befehlId, params } }, headers: { "x-bit-steuerung": token } });
    a = { status: r.status(), json: await r.json() };
    if (a.status !== 504) break;
  }
  return a;
};

/** The element arrays as the studio holds them right now. */
const modellStand = (page) => page.evaluate(() => /** @type {any} */ (window).__bitZeigen.bimAenderung.modell());
/** The previews as drawn in the scene (ghost group / outline / cut marker per proposal id). */
const vorschauen = (page) => page.evaluate(() => /** @type {any} */ (window).__bitZeigen.bimAenderung.vorschau());

test.describe("106-03 Änderungs-Werkzeuge: Vorschlag, Prüfung, Vorschau, Bestätigung, Herkunft, Rückweg", () => {
  test.setTimeout(300000);

  test("BIM-Studio: Eigenschaft, Verschieben, Teilen, gesperrter Vorschlag, Agent kann nicht bestätigen", async ({ page, request }) => {
    await page.setViewportSize({ width: 1400, height: 1000 });
    const NAME = "E2E Aendern 10603";
    let id = null;
    try {
      await nurLocalhost(page);
      const warnungen = wache(page);
      for (const alt of await (await request.get(`/api/entities/Project?name=${encodeURIComponent(NAME)}`)).json()) await request.delete(`/api/entities/Project/${alt.id}`);
      id = (await (await request.post("/api/entities/Project", { data: { name: NAME, build_kind: "neubau", status: "concept" } })).json()).id;
      await request.post("/api/entities/BimModel", { data: {
        project_id: id,
        customWalls: [
          { a: { x: 14, z: -16 }, b: { x: 26, z: -16 }, level: 0, height: 3, thickness: 0.3, _idx: 1, guid: GA, status: "neubau", kg: "341" },
          // load-bearing, no structural remark: demolishing it is the change the check must block
          { a: { x: 14, z: -22 }, b: { x: 26, z: -22 }, level: 0, height: 3, thickness: 0.3, _idx: 2, guid: GB, tragend: true, status: "bestand" },
          { a: { x: 14, z: -28 }, b: { x: 26, z: -28 }, level: 0, height: 3, thickness: 0.3, _idx: 3, guid: GC },
        ],
        // two windows in wall 3: one before the cut at the middle (u 2 m), one after it (u 9 m)
        customWindows: [
          { wallIdx: 3, u: 2, kind: "window", typeId: "double", _idx: 4 },
          { wallIdx: 3, u: 9, kind: "window", typeId: "double", _idx: 5 },
        ],
      } });
      /** The stored record, read from the API (the studio saves 1.2 s after a change). */
      const gespeichert = async () => (await (await request.get(`/api/entities/BimModel?project_id=${id}`)).json())[0];

      await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME)}&tab=bim`);
      await page.waitForFunction(() => !!(/** @type {any} */ (window).__bitBefehle), null, { timeout: 60000 });
      await expect(page.locator("canvas:visible").first()).toBeVisible({ timeout: 60000 });
      await expect.poll(async () => (await befehl(page, "modell")).result.bauteile.some((b) => b.guid === GA), { timeout: 30000 }).toBe(true);

      // the register knows the change words
      const liste = await page.evaluate(() => JSON.parse(/** @type {any} */ (window).__bitBefehle.zeileBearbeiten('{"id":1,"method":"befehle"}')));
      const ids = liste.result.map((b) => b.id);
      for (const w of ["eigenschaft-setzen", "transformieren", "teilen", "pruefen", "vorschlaege", "bestaetigen", "verwerfen", "rueckgaengig"]) expect(ids).toContain(w);

      // --- "dieses" without a selection is refused, not guessed; nothing is proposed ---
      expect(await befehl(page, "eigenschaft-setzen", { name: "feuerwiderstand", wert: "F90" })).toMatchObject({ ok: false, error: KEINE_AUSWAHL });
      await expect(page.getByTestId("aenderung-feld")).toHaveCount(0);

      // ============================================================ 1. property: Feuerwiderstand F90
      expect((await befehl(page, "auswahl-guid", { guid: GA })).ok).toBe(true);
      const eig = await befehl(page, "eigenschaft-setzen", { name: "feuerwiderstand", wert: "F90" }); // target = the selected wall
      expect(eig.ok, JSON.stringify(eig)).toBe(true);
      expect(eig.result).toMatchObject({ art: "eigenschaft", herkunft: "text", bestaetigung: "erforderlich", gesperrt: false });
      expect(eig.result.ziel.guid).toBe(GA);
      expect(eig.result.satz).toContain("F90");
      expect(eig.result.satz).toContain("Feuerwiderstand");
      // preview in words: sentence, check line, origin, buttons - nothing has changed yet
      const karte = page.getByTestId("aenderung-vorschau");
      await expect(karte).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId("aenderung-satz")).toContainText("F90");
      await expect(page.getByTestId("aenderung-herkunft")).toContainText("Textbefehl");
      await expect(page.getByTestId("aenderung-pruefzeile").first()).toBeVisible();
      await expect(page.getByTestId("aenderung-uebernehmen")).toBeEnabled();
      expect((await befehl(page, "auswahl-lesen")).result.bauteile[0].steckbrief.feuerwiderstand, "ohne Bestätigung ändert sich nichts").toBeNull();
      expect((await modellStand(page)).customWalls[0].feuerwiderstand).toBeUndefined();
      // preview at the model: the dashed 'warnung' outline on the wall (form, not only colour)
      await expect.poll(async () => (await vorschauen(page))[0]?.objekte.length ?? 0).toBeGreaterThan(0);
      const marken = (await vorschauen(page))[0].objekte;
      expect(marken.every((o) => o.umriss.some((u) => u.zustand === "warnung" && u.material === "LineDashedMaterial"))).toBe(true);
      // Übernehmen (button) -> the sheet shows F90, preview gone, the step is in the history with its origin
      await page.getByTestId("aenderung-uebernehmen").click();
      await expect(karte).toHaveCount(0);
      await expect.poll(async () => (await befehl(page, "auswahl-lesen")).result.bauteile[0].steckbrief.feuerwiderstand).toBe("F90");
      expect((await vorschauen(page))).toEqual([]);
      const schritt = page.getByTestId("aenderung-schritt").first();
      await expect(schritt).toContainText("F90");
      await expect(schritt).toHaveAttribute("data-herkunft", "text");
      await expect.poll(async () => (await gespeichert()).customWalls.find((w) => w._idx === 1).feuerwiderstand, { timeout: 20000 }).toBe("F90");
      // the origin stays on the stored element (review fix: it survives a reload), and the data sheet panel shows the value
      expect((await gespeichert()).customWalls.find((w) => w._idx === 1).geaendert_durch).toMatchObject({ herkunft: "text" });
      await expect(page.getByTestId("sb-feuerwiderstand")).toHaveText("F90");
      // rueckgaengig (command): the value is gone again, also in the stored record; the history marks it as undone
      const z1 = await befehl(page, "rueckgaengig");
      expect(z1.ok, JSON.stringify(z1)).toBe(true);
      await expect.poll(async () => (await befehl(page, "auswahl-lesen")).result.bauteile[0].steckbrief.feuerwiderstand).toBeNull();
      await expect.poll(async () => (await gespeichert()).customWalls.find((w) => w._idx === 1).feuerwiderstand ?? null, { timeout: 20000 }).toBeNull();
      expect((await gespeichert()).customWalls.find((w) => w._idx === 1).geaendert_durch ?? null, "die Marke geht mit dem Schritt zurück").toBeNull();
      await expect(page.getByTestId("aenderung-schritt").first()).toHaveAttribute("data-zurueckgenommen", "ja");
      expect((await befehl(page, "rueckgaengig")).ok, "nichts mehr zurückzunehmen").toBe(false);

      // ============================================================ 2. move by 0.5 m (command confirms)
      const vor = (await modellStand(page)).customWalls.find((w) => w._idx === 1);
      expect(vor.a.x).toBe(14);
      const tr = await befehl(page, "transformieren", { verschiebung_m: [0.5, 0, 0], herkunft: "sprache", befehl_text: "schieb die wand einen halben meter nach rechts" });
      expect(tr.ok, JSON.stringify(tr)).toBe(true);
      expect(tr.result.satz).toMatch(/0,5 m in x/);
      expect(tr.result.herkunft).toBe("sprache");
      await expect(page.getByTestId("aenderung-satz")).toContainText("0,5 m");
      await expect(page.getByTestId("aenderung-herkunft")).toContainText("Spracheingabe");
      // the ghost: a group with translucent clones, outlined dashed
      await expect.poll(async () => (await vorschauen(page))[0]?.objekte.some((o) => o.geist) ?? false).toBe(true);
      expect((await vorschauen(page))[0].objekte.find((o) => o.geist).umriss.every((u) => u.material === "LineDashedMaterial")).toBe(true);
      expect((await modellStand(page)).customWalls.find((w) => w._idx === 1).a.x, "der Geist ändert das Modell nicht").toBe(14);
      const best = await befehl(page, "bestaetigen", { vorschlag_id: tr.result.id, durch: "tastatur" });
      expect(best.ok, JSON.stringify(best)).toBe(true);
      expect(best.result.herkunft).toBe("sprache");
      await expect.poll(async () => (await modellStand(page)).customWalls.find((w) => w._idx === 1).a.x).toBe(14.5);
      expect((await modellStand(page)).customWalls.find((w) => w._idx === 1).b.x).toBe(26.5);
      await expect.poll(async () => (await gespeichert()).customWalls.find((w) => w._idx === 1).a.x, { timeout: 20000 }).toBe(14.5);
      expect((await vorschauen(page))).toEqual([]);
      const verlauf = (await befehl(page, "vorschlaege")).result.verlauf;
      expect(verlauf.at(-1)).toMatchObject({ art: "transformieren", herkunft: "sprache", befehl_text: "schieb die wand einen halben meter nach rechts", zurueckgenommen: null });
      // back with the button of exactly this step
      await page.getByTestId("aenderung-schritt").filter({ hasText: "0,5 m" }).getByTestId("aenderung-zurueck").click();
      await expect.poll(async () => (await modellStand(page)).customWalls.find((w) => w._idx === 1).a.x).toBe(14);
      await expect.poll(async () => (await gespeichert()).customWalls.find((w) => w._idx === 1).a.x, { timeout: 20000 }).toBe(14);

      // ============================================================ 3. split wall 3 at its middle: new GUIDs, openings assigned
      const vorModell = (await befehl(page, "modell", { klasse: "IfcWall" })).result;
      expect(vorModell.bauteile.some((b) => b.guid === GC)).toBe(true);
      const teilen = await befehl(page, "teilen", { guid: GC, anteil: 0.5 });
      expect(teilen.ok, JSON.stringify(teilen)).toBe(true);
      expect(teilen.result.satz).toMatch(/bei 6 m teilen → 6 m \+ 6 m/);
      await expect(page.getByTestId("aenderung-satz")).toContainText("bei 6 m teilen");
      await expect.poll(async () => (await vorschauen(page))[0]?.objekte.length ?? 0).toBeGreaterThan(0); // the cut marker
      expect((await vorschauen(page))[0].objekte[0].umriss[0].material).toBe("LineDashedMaterial");
      expect((await modellStand(page)).customWalls.length, "vor dem Übernehmen noch drei Wände").toBe(3);
      await page.getByTestId("aenderung-uebernehmen").click();
      await expect.poll(async () => (await modellStand(page)).customWalls.length).toBe(4);
      const geteilt = await modellStand(page);
      const teilA = geteilt.customWalls.find((w) => w._idx === 3);
      const teilB = geteilt.customWalls.find((w) => w._idx > 5);
      expect(teilA.guid).not.toBe(GC);
      expect(teilB.guid).not.toBe(GC);
      expect(teilA.guid).not.toBe(teilB.guid);
      expect(teilA.b.x).toBe(20);
      expect(teilB.a.x).toBe(20);
      // the opening at u 2 m stays on part A, the one at u 9 m goes to part B at u 3 m
      expect(geteilt.customWindows.find((o) => o._idx === 4)).toMatchObject({ wallIdx: 3, u: 2 });
      expect(geteilt.customWindows.find((o) => o._idx === 5)).toMatchObject({ wallIdx: teilB._idx, u: 3 });
      const nachModell = (await befehl(page, "modell", { klasse: "IfcWall" })).result;
      expect(nachModell.bauteile.some((b) => b.guid === GC), "die alte GUID gibt es nicht mehr").toBe(false);
      expect(nachModell.bauteile.some((b) => b.guid === teilA.guid) && nachModell.bauteile.some((b) => b.guid === teilB.guid)).toBe(true);
      await expect.poll(async () => (await gespeichert()).customWalls.length, { timeout: 20000 }).toBe(4);
      // undo the split: one wall again, the openings back where they were
      expect((await befehl(page, "rueckgaengig")).ok).toBe(true);
      await expect.poll(async () => (await modellStand(page)).customWalls.length).toBe(3);
      const zurueck = await modellStand(page);
      expect(zurueck.customWalls.find((w) => w._idx === 3).b.x).toBe(26);
      expect(zurueck.customWindows.find((o) => o._idx === 5)).toMatchObject({ wallIdx: 3, u: 9 });
      await expect.poll(async () => (await gespeichert()).customWalls.length, { timeout: 20000 }).toBe(3);

      // ============================================================ 4. blocked: demolishing a load-bearing wall without a note
      expect((await befehl(page, "auswahl-guid", { guid: GB })).ok).toBe(true);
      const gesperrt = await befehl(page, "eigenschaft-setzen", { name: "status", wert: "abbruch" });
      expect(gesperrt.ok, JSON.stringify(gesperrt)).toBe(true);
      expect(gesperrt.result.gesperrt).toBe(true);
      expect(gesperrt.result.pruefung.stufe).toBe("fehler");
      const sperre = page.getByTestId("aenderung-vorschau");
      await expect(sperre).toHaveAttribute("data-stufe", "fehler");
      await expect(page.getByTestId("aenderung-uebernehmen")).toBeDisabled();
      // form and words, not only colour: the line says "Fehler" and starts with the sign
      const zeile = page.getByTestId("aenderung-pruefzeile").filter({ hasText: "Gesperrt:" });
      await expect(zeile).toHaveAttribute("data-stufe", "fehler");
      await expect(zeile).toContainText("Fehler");
      await expect(zeile).toContainText("✕");
      expect((await vorschauen(page))[0].objekte.every((o) => o.umriss.some((u) => u.zustand === "fehler" && u.material === "LineBasicMaterial"))).toBe(true);
      const nein = await befehl(page, "bestaetigen", { vorschlag_id: gesperrt.result.id, durch: "hand" });
      expect(nein.ok).toBe(false);
      expect(nein.error).toMatch(/^Gesperrt:/);
      expect((await modellStand(page)).customWalls.find((w) => w._idx === 2).status, "gesperrt: nichts geändert").toBe("bestand");
      await page.getByTestId("aenderung-verwerfen").click();
      await expect(page.getByTestId("aenderung-vorschau")).toHaveCount(0);
      expect((await vorschauen(page))).toEqual([]);

      // ============================================================ 5. an agent proposes, only a person confirms
      expect((await befehl(page, "auswahl-aufheben")).ok).toBe(true);
      const agent = await ueberKanal(request, "a1", "eigenschaft-setzen", { guid: GA, name: "bauabschnitt", wert: "BA 2", herkunft: "hand" });
      expect(agent.status).toBe(200);
      expect(agent.json.ok, JSON.stringify(agent.json)).toBe(true);
      expect(agent.json.result.herkunft, "der Kanal entscheidet über die Herkunft").toBe("agent");
      expect(agent.json.result.bestaetigung).toBe("erforderlich");
      await expect(page.getByTestId("aenderung-herkunft").last()).toContainText("Agent");
      const offene = (await befehl(page, "vorschlaege")).result.offen.filter((v) => v.herkunft === "agent");
      expect(offene.length).toBeGreaterThan(0);
      const agentId = offene[0].id;
      const abgelehnt = await ueberKanal(request, "a2", "bestaetigen", { vorschlag_id: agentId, durch: "hand" });
      expect(abgelehnt.json).toMatchObject({ ok: false });
      expect(abgelehnt.json.error).toMatch(/Agent kann nicht bestätigen/);
      expect((await modellStand(page)).customWalls.find((w) => w._idx === 1).bauabschnitt, "ohne Bestätigung ändert sich nichts").toBeUndefined();
      expect((await ueberKanal(request, "a3", "rueckgaengig")).json.ok).toBe(false);
      // the person takes it over in the window; the history says who proposed it
      await page.locator(`[data-testid="aenderung-vorschau"][data-vorschlag-id="${agentId}"]`).getByTestId("aenderung-uebernehmen").click();
      await expect.poll(async () => (await modellStand(page)).customWalls.find((w) => w._idx === 1).bauabschnitt).toBe("BA 2");
      await expect(page.locator(`[data-testid="aenderung-schritt"][data-vorschlag-id="${agentId}"]`)).toHaveAttribute("data-herkunft", "agent");
      // leftovers of a repeated channel request (504 retry) are discarded
      for (const v of (await befehl(page, "vorschlaege")).result.offen) await befehl(page, "verwerfen", { vorschlag_id: v.id });

      // ============================================================ 6. order: a stale proposal is refused, steps go back one by one
      expect((await befehl(page, "auswahl-guid", { guid: GA })).ok).toBe(true);
      const f60 = await befehl(page, "eigenschaft-setzen", { name: "feuerwiderstand", wert: "F60" });
      const f90 = await befehl(page, "eigenschaft-setzen", { name: "feuerwiderstand", wert: "F90" }); // proposed on the same state as f60
      expect(f60.ok && f90.ok, JSON.stringify([f60, f90])).toBe(true);
      expect((await befehl(page, "bestaetigen", { vorschlag_id: f60.result.id, durch: "tastatur" })).ok).toBe(true);
      const veraltet = page.locator(`[data-testid="aenderung-vorschau"][data-vorschlag-id="${f90.result.id}"]`);
      await expect(veraltet).toHaveAttribute("data-stufe", "fehler");
      await expect(veraltet).toContainText("Veraltet:");
      await expect(veraltet.getByTestId("aenderung-uebernehmen")).toBeDisabled();
      const nein2 = await befehl(page, "bestaetigen", { vorschlag_id: f90.result.id, durch: "tastatur" });
      expect(nein2.ok).toBe(false);
      expect(nein2.error).toMatch(/^Veraltet:/);
      expect((await befehl(page, "verwerfen", { vorschlag_id: f90.result.id })).ok).toBe(true);
      // proposed again on the current state: the sentence says F60 -> F90 and it runs
      const f90b = await befehl(page, "eigenschaft-setzen", { name: "feuerwiderstand", wert: "F90" });
      expect(f90b.result.satz).toContain("F60 → F90");
      expect((await befehl(page, "bestaetigen", { vorschlag_id: f90b.result.id, durch: "tastatur" })).ok).toBe(true);
      await expect.poll(async () => (await modellStand(page)).customWalls.find((w) => w._idx === 1).feuerwiderstand).toBe("F90");
      // the OLDER step cannot go back first: refused in words, the newer one stays
      const altZuerst = await befehl(page, "rueckgaengig", { vorschlag_id: f60.result.id });
      expect(altZuerst.ok).toBe(false);
      expect(altZuerst.error).toMatch(/erst den neueren Schritt zurücknehmen/);
      expect((await modellStand(page)).customWalls.find((w) => w._idx === 1).feuerwiderstand).toBe("F90");
      await expect(page.locator(`[data-testid="aenderung-schritt"][data-vorschlag-id="${f60.result.id}"]`)).toHaveAttribute("data-zurueckgenommen", "nein");
      expect((await befehl(page, "rueckgaengig", { vorschlag_id: f90b.result.id })).ok).toBe(true);
      await expect.poll(async () => (await modellStand(page)).customWalls.find((w) => w._idx === 1).feuerwiderstand).toBe("F60");
      expect((await befehl(page, "rueckgaengig", { vorschlag_id: f60.result.id })).ok).toBe(true);
      await expect.poll(async () => (await modellStand(page)).customWalls.find((w) => w._idx === 1).feuerwiderstand).toBeUndefined();

      // ============================================================ 7. the preview in the plan (Grundriss) and back in 3D
      const imPlan = await befehl(page, "transformieren", { guid: GA, verschiebung_m: [1, 0, 0] });
      expect(imPlan.ok, JSON.stringify(imPlan)).toBe(true);
      await page.getByRole("button", { name: "Ansicht Grundriss" }).click();
      const planMarke = page.getByTestId("plan-vorschau").locator("polygon");
      await expect(planMarke).toHaveCount(1, { timeout: 15000 });
      await expect(planMarke).toHaveAttribute("data-form", "gestrichelt");
      await expect(planMarke).toHaveAttribute("stroke-dasharray", /\d/);
      // a blocked proposal draws a SOLID outline in the plan
      const planGesperrt = await befehl(page, "eigenschaft-setzen", { guid: GB, name: "status", wert: "abbruch" });
      expect(planGesperrt.result.gesperrt).toBe(true);
      await expect(page.getByTestId("plan-vorschau").locator('polygon[data-form="durchgezogen"]')).toHaveCount(1);
      await expect(page.getByTestId("plan-vorschau").locator('polygon[data-form="durchgezogen"]')).not.toHaveAttribute("stroke-dasharray", /\d/);
      // back to 3D: the previews are drawn again there (not only after a model change)
      await page.getByRole("button", { name: "Ansicht 3D" }).click();
      await expect.poll(async () => (await vorschauen(page)).filter((v) => v.objekte.length > 0).length, { timeout: 15000 }).toBe(2);
      for (const v of (await befehl(page, "vorschlaege")).result.offen) await befehl(page, "verwerfen", { vorschlag_id: v.id });

      expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
    } finally {
      if (id != null) {
        for (const m of await (await request.get(`/api/entities/BimModel?project_id=${id}`)).json()) await request.delete(`/api/entities/BimModel/${m.id}`);
        await request.delete(`/api/entities/Project/${id}`);
      }
    }
  });
  test("IFC-Viewer (musterprojekt.ifc): Eigenschaft über das Journal, Datei bleibt unverändert; Verschieben und Teilen sind verweigert", async ({ page, request }) => {
    await page.setViewportSize({ width: 1400, height: 1000 });
    let guidWand = null;
    try {
      await nurLocalhost(page);
      const warnungen = wache(page);
      await page.goto("/IfcViewer?beispiel=1");
      await expect(page.getByTestId("status-sichtbarkeit")).toBeVisible({ timeout: 180000 });
      await page.waitForFunction(() => !!(/** @type {any} */ (window).__bitBefehle), null, { timeout: 30000 });
      const waende = (await befehl(page, "modell", { klasse: "IfcWall" })).result.bauteile;
      const wand = waende.find((x) => x.name && x.geschoss);
      expect(wand).toBeTruthy();
      guidWand = wand.guid;
      const journal = async () => (await (await request.get("/api/entities/IfcAenderung")).json()).filter((e) => e.guid === guidWand);

      // only properties of imported elements: moving and splitting are refused with the reason
      for (const [bid, p] of [["transformieren", { guid: wand.guid, verschiebung_m: [1, 0, 0] }], ["teilen", { guid: wand.guid, anteil: 0.5 }]]) {
        const r = await befehl(page, bid, p);
        expect(r).toMatchObject({ ok: false, error: "Nur für gezeichnete Bauteile (BIM-Studio) — IFC-Dateien bleiben unverändert" });
      }
      // "dieses" without a selection is refused
      expect(await befehl(page, "eigenschaft-setzen", { pset: "Pset_WallCommon", name: "FireRating", wert: "F120" })).toMatchObject({ ok: false, error: KEINE_AUSWAHL });
      // an unknown GUID is refused, never guessed
      expect(await befehl(page, "eigenschaft-setzen", { guid: "0000000000000000000000", pset: "Pset_WallCommon", name: "FireRating", wert: "F120" }))
        .toMatchObject({ ok: false, error: "Bauteil nicht gefunden: 0000000000000000000000" });

      // (the sample's walls already carry F90: the same value is refused as "Keine Änderung", so the test sets F120)
      // proposal for the selected wall: sentence, check, mark on the element - no journal entry yet
      expect((await befehl(page, "auswahl-guid", { guid: wand.guid })).ok).toBe(true);
      const eig = await befehl(page, "eigenschaft-setzen", { pset: "Pset_WallCommon", name: "FireRating", wert: "F120", herkunft: "sprache" });
      expect(eig.ok, JSON.stringify(eig)).toBe(true);
      expect(eig.result.satz).toContain("Feuerwiderstand");
      expect(eig.result.satz).toContain("F120");
      expect(eig.result.herkunft).toBe("sprache");
      await expect(page.getByTestId("aenderung-satz")).toContainText("F120");
      await expect.poll(() => page.evaluate(() => /** @type {any} */ (window).__bitZeigen.ifc.markiert("warnung"))).toBeGreaterThan(0);
      expect(await journal(), "ohne Bestätigung kein Journal-Eintrag").toHaveLength(0);
      // confirm (button): one journal entry with old and new value, the mark is gone, the step has its origin
      await page.getByTestId("aenderung-uebernehmen").click();
      await expect(page.getByTestId("aenderung-vorschau")).toHaveCount(0);
      await expect.poll(async () => (await journal()).length, { timeout: 20000 }).toBe(1);
      const e = (await journal())[0];
      expect(e).toMatchObject({ guid: wand.guid, pset: "Pset_WallCommon", eigenschaft: "FireRating", wert: "F120" });
      await expect.poll(() => page.evaluate(() => /** @type {any} */ (window).__bitZeigen.ifc.markiert("warnung"))).toBe(0);
      await expect(page.getByTestId("aenderung-schritt").first()).toHaveAttribute("data-herkunft", "sprache");
      // the origin is part of the stored journal entry (review fix: it survives a reload)
      expect(e).toMatchObject({ herkunft: "sprache", bestaetigt_durch: "hand" });
      // "hand" and "bild" cannot be claimed in the command parameters
      expect((await befehl(page, "eigenschaft-setzen", { pset: "Pset_WallCommon", name: "FireRating", wert: "F150", herkunft: "hand" })).error).toMatch(/nur für Änderungen mit der Maus/);
      expect((await befehl(page, "eigenschaft-setzen", { pset: "Pset_WallCommon", name: "FireRating", wert: "F150", herkunft: "bild" })).error).toMatch(/Bildeingabe/);
      // two steps on the same property: the older one cannot go back first (the journal keeps both entries)
      const zwei = await befehl(page, "eigenschaft-setzen", { pset: "Pset_WallCommon", name: "FireRating", wert: "F150" });
      expect(zwei.result.satz).toContain("F120 → F150");
      expect((await befehl(page, "bestaetigen", { vorschlag_id: zwei.result.id })).ok).toBe(true);
      await expect.poll(async () => (await journal()).length, { timeout: 20000 }).toBe(2);
      const aeltester = (await befehl(page, "vorschlaege")).result.verlauf.find((v) => v.satz.includes("F120") && !v.satz.includes("F150"));
      const zuerst = await befehl(page, "rueckgaengig", { vorschlag_id: aeltester.vorschlag_id });
      expect(zuerst.ok).toBe(false);
      expect(zuerst.error).toMatch(/Spätere Änderung an FireRating im Journal/);
      expect(await journal(), "kein Eintrag gelöscht").toHaveLength(2);
      expect((await befehl(page, "rueckgaengig", { vorschlag_id: zwei.result.id })).ok).toBe(true);
      await expect.poll(async () => (await journal()).length, { timeout: 20000 }).toBe(1);
      expect((await journal())[0]).toMatchObject({ wert: "F120" }); // the entry of step 1 is still there, the one of step 2 went
      // back: the journal entry is deleted again, the file never changed
      const z = await befehl(page, "rueckgaengig");
      expect(z.ok, JSON.stringify(z)).toBe(true);
      await expect.poll(async () => (await journal()).length, { timeout: 20000 }).toBe(0);
      await expect(page.getByTestId("aenderung-schritt").first()).toHaveAttribute("data-zurueckgenommen", "ja");
      expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
    } finally {
      if (guidWand) {
        for (const e of (await (await request.get("/api/entities/IfcAenderung")).json()).filter((x) => x.guid === guidWand)) await request.delete(`/api/entities/IfcAenderung/${e.id}`);
      }
    }
  });
});
