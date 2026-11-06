// Headless-Nachweis 107-14 (CSG-Kern) im echten Browser (Dev-Server):
// (1) BIM-Studio mit einer Wand und einem Fenster öffnen, 2D und 3D: auf dem Startpfad und im Studio ohne CSG-Aufruf wird
//     KEIN Modul des CSG-Kerns und keine der beiden Bibliotheken angefragt (lazy, eigener Chunk `csg`); Konsole sauber.
// (2) Gegentest im selben Browser: der Kern wird über seinen Einstieg nachgeladen (dynamischer Import, wie es der erste
//     Anwender 107-09 tun wird) und rechnet die Wand 4 × 2,5 × 0,3 m minus Öffnung 1,0 × 1,2 m (Brüstung 0,9 m) = 2,64 m³
//     (Handrechnung 3,0 − 1,0 · 1,2 · 0,3), Grundriss in 1,0 m Höhe = 0,9 m² (2 × 1,5 · 0,3); erst jetzt kommen die
//     Bibliotheken; keine Warnung „Multiple instances of Three.js“ (eine three-Instanz auch im Browser).
// 107-18: Bibliothek ist manifold-3d (D-BK-08c) — JS-Teil und WebAssembly-Datei werden erst beim Aufruf geladen, die
//     WebAssembly-Datei genau einmal, auch beim zweiten Aufruf nicht erneut.
// Eigenes Projekt, Aufräumen im finally; das Testhaus wird nicht beschrieben, csg_cache_layer wird nicht geschrieben.
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";

const NAME = "E2E Bauteilkern 10714";
const CSG_ANFRAGE = /manifold-3d|manifold[^/]*\.wasm|\/lib\/csg\/|\/csg-[A-Za-z0-9_-]+\.js/;
// the fetch of the binary itself (the `?url` module request of manifoldWasm.js carries a query and is not counted)
const WASM_ANFRAGE = /manifold[^/?]*\.wasm$/;

/** @param {any} request @param {string} name */
async function altWeg(request, name) {
  for (const alt of await (await request.get(`/api/entities/Project?name=${encodeURIComponent(name)}`)).json()) {
    for (const m of await (await request.get(`/api/entities/BimModel?project_id=${alt.id}`)).json()) await request.delete(`/api/entities/BimModel/${m.id}`);
    await request.delete(`/api/entities/Project/${alt.id}`);
  }
}

test("107-14 CSG-Kern: nicht auf dem Startpfad, bei Aufruf nachgeladen, Handrechnung im Browser, eine three-Instanz", async ({ page, request }) => {
  test.setTimeout(180000);
  await altWeg(request, NAME);
  const id = (await (await request.post("/api/entities/Project", { data: { name: NAME, build_kind: "neubau", status: "concept" } })).json()).id;
  await request.post("/api/entities/BimModel", { data: {
    project_id: id, storeys: 1, storeyHeight: 3,
    customWalls: [{ a: { x: -2, z: 0 }, b: { x: 2, z: 0 }, thickness: 0.3, height: 2.5, level: 0, _idx: 1 }],
    customWindows: [{ wallIdx: 1, u: 2, kind: "window", typeId: "single", width: 1, height: 1.2, sill: 0.9, _idx: 2 }],
  } });
  /** @type {string[]} */
  const warnungen = [];
  /** @type {string[]} */
  const alleWarnungen = [];
  /** @type {string[]} */
  const anfragen = [];
  try {
    await nurLocalhost(page);
    page.on("console", (m) => {
      if (m.type() === "warning" || m.type() === "error") alleWarnungen.push(m.text());
      if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text()) && !/GPU stall|WebGL|wasm/i.test(m.text())) warnungen.push(m.text());
    });
    page.on("pageerror", (e) => { if (!/Error creating WebGL context|getUniforms/i.test(String(e.stack || e))) warnungen.push(`pageerror ${e}`); });
    page.on("request", (r) => anfragen.push(r.url()));

    // ---- (1) start path and BIM studio without a CSG call ----
    await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME)}&tab=bim`);
    await page.waitForFunction(() => !!(/** @type {any} */ (window).__bitBefehle), null, { timeout: 60000 });
    await expect(page.locator("canvas:visible").first()).toBeVisible({ timeout: 60000 });
    await page.getByRole("button", { name: "Ansicht 3D" }).click();
    await page.waitForTimeout(1500);
    expect(anfragen.filter((u) => CSG_ANFRAGE.test(u)), "kein CSG-Modul auf dem Startpfad / im Studio ohne Aufruf").toEqual([]);

    // ---- (2) counter-test: loaded on demand, hand values in the browser ----
    const ergebnis = await page.evaluate(async () => {
      const csg = await import(/* @vite-ignore */ "/packages/nova-core/src/lib/csg/index.js");
      const wand = { a: { x: 0, z: 0 }, b: { x: 4, z: 0 }, thickness: 0.3, height: 2.5, level: 0 };
      const r = await csg.wandSolid(wand, [{ u: 2, width: 1.0, height: 1.2, sill: 0.9 }]);
      const s = r.geometrie ? csg.horizontalschnitt(r.geometrie, 1.0) : null;
      return { ok: r.ok, quelle: r.quelle, solid: r.volumen.solid_m3, menge: r.menge_m3, warnung: r.warnung, schleifen: s?.schleifen.length, flaeche: s?.flaeche_m2, dicht: r.geometrie ? csg.istWasserdicht(r.geometrie).ok : false };
    });
    expect(ergebnis.ok, JSON.stringify(ergebnis)).toBe(true);
    expect(ergebnis.quelle).toBe("solid");
    expect(Math.abs(ergebnis.solid - 2.64)).toBeLessThan(1e-5);
    expect(ergebnis.dicht).toBe(true);
    expect(ergebnis.schleifen).toBe(2);
    expect(Math.abs(ergebnis.flaeche - 0.9)).toBeLessThan(1e-5);
    expect(anfragen.some((u) => /manifold-3d/.test(u)), "Bibliothek erst jetzt geladen").toBe(true);
    expect(anfragen.filter((u) => WASM_ANFRAGE.test(u)).length, "WebAssembly-Datei erst jetzt, genau einmal").toBe(1);
    // a second call reuses the instantiated library: no further request of the binary
    const zweit = await page.evaluate(async () => {
      const csg = await import(/* @vite-ignore */ "/packages/nova-core/src/lib/csg/index.js");
      const r = await csg.wandSolid({ a: { x: 0, z: 0 }, b: { x: 3, z: 0 }, thickness: 0.2, height: 2.5, level: 0 }, []);
      return r.volumen.solid_m3;
    });
    expect(Math.abs(zweit - 1.5)).toBeLessThan(1e-5); // 3 · 2.5 · 0.2
    expect(anfragen.filter((u) => WASM_ANFRAGE.test(u)).length, "kein zweites Laden der WebAssembly-Datei").toBe(1);
    expect(alleWarnungen.filter((w) => /Multiple instances|maxLeafSize/i.test(w)), "eine three-Instanz, keine Bibliotheks-Warnung").toEqual([]);
    expect(warnungen, "Konsole sauber").toEqual([]);
  } finally {
    await altWeg(request, NAME);
  }
});
