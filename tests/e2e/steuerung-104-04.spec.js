// Headless-Nachweis 104-04: ein lokaler Agent steuert das offene Massing-Studio über POST /api/steuerung (Token aus
// <Datenordner>/steuerung.token) — Linie starten, Koordinaten, Körper 8 × 5 m, Modell lesen; ohne Token 401; ist keine
// Zeichenfläche offen, antwortet der Server nach der Wartezeit mit status "not-run". Eigenes Projekt, Aufräumen.
import { test, expect } from "./fixtures/base.js";
import { nurLocalhost } from "./fixtures/massing.js";
import fs from "node:fs";
import path from "node:path";

const NAME = "E2E Steuerung 10404";
// dev / E2E server: data folder = server/ (BIT_DATA_DIR unset)
const TOKEN_DATEI = path.join(process.env.BIT_DATA_DIR || "server", "steuerung.token");

test("104-04 Agent steuert das Studio per HTTP: linie → Koordinaten → Körper 8 × 5 m; ohne Studio not-run", async ({ page, request }) => {
  test.setTimeout(180000);
  const token = fs.readFileSync(TOKEN_DATEI, "utf-8").trim();
  const agent = async (body, mitToken = true) => {
    const r = await request.post("/api/steuerung", { data: body, headers: mitToken ? { "x-bit-steuerung": token } : {} });
    return { status: r.status(), json: await r.json() };
  };
  for (const alt of await (await request.get(`/api/entities/Project?name=${encodeURIComponent(NAME)}`)).json()) await request.delete(`/api/entities/Project/${alt.id}`);
  const id = (await (await request.post("/api/entities/Project", { data: { name: NAME, build_kind: "neubau", status: "concept" } })).json()).id;
  try {
    expect((await agent({ id: 0, method: "befehle" }, false)).status).toBe(401);
    await nurLocalhost(page);
    await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME)}&tab=studio`);
    await expect(page.getByTestId("mm-leiste")).toBeVisible({ timeout: 60000 });
    await page.waitForFunction(() => !!(/** @type {any} */ (window).__bitBefehle));

    const liste = await agent({ id: 1, method: "befehle" });
    expect(liste.status).toBe(200);
    expect(liste.json.result.map((b) => b.id)).toContain("linie");
    expect((await agent({ id: 2, method: "ausfuehren", params: { befehl: "linie" } })).json).toMatchObject({ id: 2, ok: true });
    for (const text of ["#0;0", "@8;0", "@0;5", "@-8;0", "#0;0"]) {
      const a = await agent({ id: text, method: "ausfuehren", params: { befehl: "eingabe", params: { text } } });
      expect(a.json.ok, JSON.stringify(a)).toBe(true);
    }
    await expect(page.getByTestId("mm-koerper")).toHaveCount(1);
    const p = (await agent({ id: 3, method: "ausfuehren", params: { befehl: "modell" } })).json.result.koerper[0].profil;
    const xs = p.map((q) => q.x), ys = p.map((q) => q.y);
    expect([Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)]).toEqual([8, 5]);

    // studio closed → nobody picks the request up
    await page.goto("/");
    // behind the Vite dev proxy the closed tab's last long poll lives until it expires (10 s, see steuerungRouter);
    // a request handed to it would correctly answer "may-have-run" — wait it out
    await page.waitForTimeout(11000);
    const ohne = await agent({ id: 4, method: "befehle" });
    expect(ohne.status).toBe(504);
    expect(ohne.json).toMatchObject({ id: 4, ok: false, status: "not-run" });
  } finally {
    for (const m of await (await request.get(`/api/entities/BimModel?project_id=${id}`)).json()) await request.delete(`/api/entities/BimModel/${m.id}`);
    await request.delete(`/api/entities/Project/${id}`);
  }
});
