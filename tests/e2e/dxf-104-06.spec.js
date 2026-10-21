// Headless-Nachweis 104-06 + 101-03:
// 1. Lageplan → „DXF“ (sd-dxf) lädt eine DXF-R12-Datei herunter (AC1009, Ebene GRUNDSTUECK, Bezugs-Kommentar,
//    Windows-1252: „ü“ = 0xFC, CRLF, EOF). Dieselbe Datei wieder als Flurstück importiert ergibt dieselbe Grenze:
//    „Als Grundstück übernehmen“ schreibt exakt die Ausgangspunkte zurück (Rundlauf, 0,01 px).
// 2. DXF mit zwei aneinanderliegenden Flurstücken (eigenes Bezugsformat, Nummern als TEXT) auf ein Projekt mit
//    geschätztem Startquadrat → automatisch EINE Grenze (assumed false, source flurstuecke, 4 Ecken, 1 200 m²);
//    eine Datei mit Lücke → ehrliche Meldung, Grundstück unverändert.
// 3. BIM-Studio Grundriss → „Aktuellen Plan als DXF“ lädt <Projekt>_Grundriss_<Geschoss>.dxf mit A_WAND und SOLID.
// Eigene Projekte, Aufräumen im finally; Konsole sauber (ERLAUBT_OFFLINE).
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";
import fs from "node:fs";
import path from "node:path";

const ORT = { lat: 49.4521, lng: 11.0767, address: "Musterstraße 1, Musterstadt" };
const ORDNER = path.join("test-results", "dxf-104-06");

/** Collects console errors/warnings that are not expected offline noise. */
function konsole(/** @type {import("@playwright/test").Page} */ page) {
  /** @type {string[]} */
  const w = [];
  // maplibre's "Unable to perform style diff" while the site map is still loading is harmless (same filter as massing-75-06).
  page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text()) && !/WebGL|GPU stall|style diff|Style is not done loading/i.test(m.text())) w.push(m.text()); });
  page.on("pageerror", (e) => { if (!/WebGL|THREE|getUniforms/i.test(String(e.stack || e))) w.push(`pageerror ${e}`); });
  return w;
}

/** Minimal DXF in the own reference format: LWPOLYLINEs in metres around ORT, one number TEXT each. */
function dxfText(/** @type {Array<{nr: string, pts: number[][]}>} */ flurstuecke) {
  const z = ["999", `BIT-ATELIER-BEZUG ${ORT.lat.toFixed(7)} ${ORT.lng.toFixed(7)}`, "0", "SECTION", "2", "HEADER", "9", "$INSUNITS", "70", "6", "0", "ENDSEC", "0", "SECTION", "2", "ENTITIES"];
  for (const f of flurstuecke) {
    z.push("0", "LWPOLYLINE", "8", "FLURSTUECKE", "90", String(f.pts.length), "70", "1", ...f.pts.flatMap(([x, y]) => ["10", String(x), "20", String(y)]));
    const cx = f.pts.reduce((s, p) => s + p[0], 0) / f.pts.length, cy = f.pts.reduce((s, p) => s + p[1], 0) / f.pts.length;
    z.push("0", "TEXT", "8", "NUMMERN", "10", String(cx), "20", String(cy), "40", "1", "1", f.nr);
  }
  z.push("0", "ENDSEC", "0", "EOF");
  return z.join("\r\n") + "\r\n";
}

async function projektAnlegen(/** @type {any} */ request, /** @type {string} */ name, /** @type {any} */ complex) {
  for (const alt of await (await request.get(`/api/entities/Project?name=${encodeURIComponent(name)}`)).json()) await request.delete(`/api/entities/Project/${alt.id}`);
  const id = (await (await request.post("/api/entities/Project", { data: { name, build_kind: "neubau", status: "concept" } })).json()).id;
  const bc = complex ? (await (await request.post("/api/entities/BuildingComplex", { data: { project_id: id, name, location: ORT, ...complex } })).json()).id : null;
  return { id, bc };
}

test("104-06 Lageplan als DXF + Rundlauf über den eigenen Flurstück-Import", async ({ page, request }) => {
  test.setTimeout(180000);
  fs.mkdirSync(ORDNER, { recursive: true });
  const NAME = "E2E DXF Lageplan 10406";
  const grenze = [{ x: 560, y: 360 }, { x: 640.5, y: 362.25 }, { x: 650, y: 430.13 }, { x: 600, y: 455.75 }, { x: 555.01, y: 420 }];
  const { id, bc } = await projektAnlegen(request, NAME, {
    site_parcel: { id: "site_parcel_main", type: "site_boundary", assumed: false, source: "gezeichnet", m_per_px: 1.25, points: grenze },
    buildings: [{ id: "b1", x: 590, y: 390, width: 16, height: 12, floors: 3 }],
  });
  try {
    await nurLocalhost(page);
    const warnungen = konsole(page);
    await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME)}&tab=massing`);
    await page.getByTestId("sd-plan").waitFor({ timeout: 60000 });

    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("sd-dxf").click()]);
    expect(dl.suggestedFilename()).toBe("E2E_DXF_Lageplan_10406_Lageplan.dxf");
    const datei = path.join(ORDNER, "lageplan.dxf");
    await dl.saveAs(datei);
    const bytes = fs.readFileSync(datei);
    const text = bytes.toString("latin1");
    expect(text.startsWith("999\r\n")).toBe(true);
    expect(text.endsWith("0\r\nEOF\r\n")).toBe(true);
    expect(text).toContain("$ACADVER\r\n1\r\nAC1009");
    expect(text).toContain("\r\nGRUNDSTUECK\r\n");
    expect(text).toContain("BIT-ATELIER-BEZUG 49.4521000 11.0767000");
    expect(text).not.toContain("LWPOLYLINE");
    expect(bytes.includes(Uint8Array.from([0x47, 0x72, 0x75, 0x6e, 0x64, 0x73, 0x74, 0xfc, 0x63, 0x6b]))).toBe(true); // "Grundstück" in Windows-1252
    await expect(page.getByTestId("sd-dxf-hinweis")).toContainText("DXF exportiert");

    // Round trip: the own file back in as a parcel — the drawn plot stays until the user takes the union over.
    await page.getByTestId("sd-geojson").setInputFiles(datei);
    await expect(page.getByTestId("sd-flurstuecke").locator("div.flex")).toHaveCount(1, { timeout: 10000 });
    await expect(page.getByTestId("sd-dxf-ebenen")).toContainText("GRUNDSTUECK");
    await expect(page.getByTestId("sd-grenze-meldung")).toHaveAttribute("data-ok", "1");
    await expect(page.getByTestId("sd-grenze-meldung")).toContainText("gezeichnete Grundstück bleibt");
    await page.getByTestId("sd-flurstuecke-grenze").click();
    const schluessel = (/** @type {any[]} */ pts) => (pts || []).map((p) => `${Number(p.x).toFixed(2)}|${Number(p.y).toFixed(2)}`).sort().join(";");
    await expect.poll(async () => {
      const r = await (await request.get(`/api/entities/BuildingComplex/${bc}`)).json();
      return `${r.site_parcel?.assumed}|${r.site_parcel?.source}|${schluessel(r.site_parcel?.points)}`;
    }, { timeout: 20000 }).toBe(`false|flurstuecke|${schluessel(grenze)}`);
    expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
  } finally {
    if (bc) await request.delete(`/api/entities/BuildingComplex/${bc}`);
    await request.delete(`/api/entities/Project/${id}`);
  }
});

test("101-03 DXF-Flurstücke: zwei Flurstücke → eine Grenze; Lücke → ehrliche Meldung", async ({ page, request }) => {
  test.setTimeout(180000);
  fs.mkdirSync(ORDNER, { recursive: true });
  const NAME = "E2E DXF Flurstuecke 10103";
  const geschaetzt = [{ x: 360, y: 360 }, { x: 440, y: 360 }, { x: 440, y: 420 }, { x: 360, y: 420 }];
  const { id, bc } = await projektAnlegen(request, NAME, {
    site_parcel: { id: "site_parcel_main", type: "site_boundary", assumed: true, source: "geschaetzt", m_per_px: 1.25, geschaetzte_flaeche_m2: 7500, points: geschaetzt },
  });
  const zwei = path.join(ORDNER, "zwei-flurstuecke.dxf");
  fs.writeFileSync(zwei, dxfText([{ nr: "101/1", pts: [[-20, -15], [0, -15], [0, 15], [-20, 15]] }, { nr: "101/2", pts: [[0, -15], [20, -15], [20, 15], [0, 15]] }]), "latin1");
  const luecke = path.join(ORDNER, "luecke.dxf");
  fs.writeFileSync(luecke, dxfText([{ nr: "7", pts: [[-20, -15], [0, -15], [0, 15], [-20, 15]] }, { nr: "8", pts: [[3, -15], [20, -15], [20, 15], [3, 15]] }]), "latin1");
  try {
    await nurLocalhost(page);
    const warnungen = konsole(page);
    await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME)}&tab=massing`);
    await page.getByTestId("sd-plan").waitFor({ timeout: 60000 });

    // Gap first: honest message, the estimated plot stays.
    await page.getByTestId("sd-geojson").setInputFiles(luecke);
    await expect(page.getByTestId("sd-grenze-meldung")).toHaveAttribute("data-ok", "0", { timeout: 10000 });
    await expect(page.getByTestId("sd-grenze-meldung")).toContainText("hängen nicht zusammen");
    await expect(page.getByTestId("sd-grenze-meldung")).toContainText("3 m");
    await page.waitForTimeout(1500);
    expect((await (await request.get(`/api/entities/BuildingComplex/${bc}`)).json()).site_parcel?.assumed).toBe(true);

    // Two touching parcels: one boundary, drawn (assumed false), 40 × 30 m.
    await page.getByTestId("sd-geojson").setInputFiles(zwei);
    await expect(page.getByTestId("sd-grenze-meldung")).toHaveAttribute("data-ok", "1", { timeout: 10000 });
    await expect(page.getByTestId("sd-grenze-meldung")).toContainText("2 Flurstücke zu einer Grundstücksgrenze vereinigt (1.200 m²)");
    const zeilen = page.getByTestId("sd-flurstuecke").locator("div.flex");
    await expect(zeilen).toHaveCount(2);
    await expect(zeilen.first()).toContainText("101/");
    await expect.poll(async () => {
      const r = await (await request.get(`/api/entities/BuildingComplex/${bc}`)).json();
      return `${r.site_parcel?.assumed}|${r.site_parcel?.source}|${r.site_parcel?.points?.length}|${r.site_area}`;
    }, { timeout: 20000 }).toBe("false|flurstuecke|4|1200");
    expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
  } finally {
    if (bc) await request.delete(`/api/entities/BuildingComplex/${bc}`);
    await request.delete(`/api/entities/Project/${id}`);
  }
});

test("104-06 BIM-Studio: Grundriss als DXF (Ebenen je Bauteil, Poché als SOLID)", async ({ page, request }) => {
  test.setTimeout(180000);
  const NAME = "E2E DXF Grundriss 10406";
  const { id } = await projektAnlegen(request, NAME, null);
  let modellId = null;
  try {
    await nurLocalhost(page);
    const warnungen = konsole(page);
    const waende = [
      { a: { x: -4, z: -2 }, b: { x: 4, z: -2 }, level: 0, thickness: 0.24, _idx: 1 },
      { a: { x: -4, z: 2 }, b: { x: 4, z: 2 }, level: 0, thickness: 0.24, _idx: 2 },
    ];
    modellId = (await (await request.post("/api/entities/BimModel", { data: { project_id: id, customWalls: waende } })).json()).id;
    await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME)}&tab=bim`);
    await page.getByRole("button", { name: "Ansicht Grundriss" }).click({ timeout: 60000 });
    await expect(page.locator('[data-wand="1"]')).toHaveCount(1, { timeout: 15000 });
    await page.getByRole("button", { name: "Mappe ein-/ausblenden" }).click();
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("bim-plan-dxf").click()]);
    expect(dl.suggestedFilename()).toMatch(/^E2E_DXF_Grundriss_10406_Grundriss_.+\.dxf$/);
    const text = fs.readFileSync(await dl.path()).toString("latin1");
    expect(text).toContain("AC1009");
    expect(text).toContain("\r\nA_WAND\r\n");
    expect(text).toContain("\r\nSOLID\r\n");
    expect(text).toContain("\r\nA_WAND_POCHE\r\n");
    expect(text.endsWith("0\r\nEOF\r\n")).toBe(true);
    await expect(page.getByText(/Grundriss als DXF erstellt/)).toBeVisible();
    expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
  } finally {
    if (modellId) await request.delete(`/api/entities/BimModel/${modellId}`);
    await request.delete(`/api/entities/Project/${id}`);
  }
});
