// W-1118-02 im echten Browser (Innenausbau, Geschossplan): Möbel bleiben in ihrem Raum, wenn die Räume neu aufgebaut werden.
// Eigenes neutrales Projekt per API (drei Räume mit gespeicherter GUID, BuildingComplex mit Name + Standort, damit das
// Auto-Speichern läuft):
//   (1) ein Datensatz im alten Format (`id:<_idx>`, Möbel liegen im Umriss dieses Raums) wird beim Öffnen auf
//       `guid:<guid>` gehoben und gespeichert (seit dem Nachgang F1 nur das Feld moeblierung, aus dem frischen Datensatz);
//   (2) ein absichtlich kaputter Eintrag (`id:<_idx>` eines Raums, die Möbel liegen aber in einem anderen) wird NICHT
//       verschoben und erscheint unter „Möbel ohne Raum“ — auch nach Neuaufbau und Neuladen;
//   (3) Möbel in zwei Räumen setzen, die Räume per API neu aufbauen (andere Reihenfolge, neue _idx, GUID bleibt), neu laden:
//       jedes Möbel steht weiter in seinem Raum;
//   (4) der kaputte Eintrag lässt sich zuweisen: der Raum, in dem er liegt, wird genannt und im Auswahlfeld markiert, aber nicht
//       vorbelegt (Review R-1); „Entfernen“ fragt vorher (Review R-3).
// Zweiter Test (Review R-W111802-1 + R-3): Räume übereinander (Geschoss kopieren), alte id:-Möbel; im Studio wird ein Raum über
// einem anderen gezeichnet und gespeichert, dann ohne Neuladen im Innenausbau möbliert.
// Nachgang (Final-Review): dritter Test = ein alter, unberührter Tab überschreibt den Entwurf nicht (F1); vierter Test = nach
// „Raum teilen“ stehen die Möbel im Teil, der den _idx behält (F-W111802-FINAL-1).
// Optional: W111802_FOTO_DIR=<ordner> legt zwei auf den Plan bzw. den Hinweis zugeschnittene Bilder ab.
import { test, expect } from "./fixtures/base.js";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";
// 115-05c (D-115-12, D-115-51): a drawn room and a confirmed split are a draft until "Speichern" (before: the studio autosave)
import { speichernUndWarten } from "./fixtures/entwurf.js";

const NAME = "E2E Möbel-Raum W-1118-02";
// stored GUIDs (22 characters, like guidsAnheften pins them)
const G_NORD = "0raumNordE2E1118020001";
const G_SUED = "0raumSuedE2E1118020002";
const G_LAGER = "0raumLagerE2E111802003";
/** Rectangle room outline in metres. @param {number} x0 @param {number} z0 @param {number} x1 @param {number} z1 */
const rechteck = (x0, z0, x1, z1) => [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }];
const NORD = rechteck(1, 1, 5, 5);
const SUED = rechteck(6, 1, 10, 5);
const LAGER = rechteck(11, 1, 14, 5);
const RAEUME_START = [
  { points: NORD, level: 0, name: "Raum Nord", _idx: 1, guid: G_NORD },
  { points: SUED, level: 0, name: "Raum Süd", _idx: 2, guid: G_SUED },
  { points: LAGER, level: 0, name: "Lager", _idx: 3, guid: G_LAGER },
];

/** Removes projects of earlier runs with their records. @param {any} request @param {string} name */
async function altWeg(request, name) {
  for (const alt of await (await request.get(`/api/entities/Project?name=${encodeURIComponent(name)}`)).json()) {
    for (const m of await (await request.get(`/api/entities/BimModel?project_id=${alt.id}`)).json()) await request.delete(`/api/entities/BimModel/${m.id}`);
    for (const c of await (await request.get(`/api/entities/BuildingComplex?project_id=${alt.id}`)).json()) await request.delete(`/api/entities/BuildingComplex/${c.id}`);
    await request.delete(`/api/entities/Project/${alt.id}`);
  }
}

test("W-1118-02: Möbel bleiben nach dem Neuaufbau der Räume im Raum, altes Format wird gehoben, Kaputtes steht unter „Möbel ohne Raum“", async ({ page, request }) => {
  test.setTimeout(240000);
  await page.setViewportSize({ width: 1500, height: 1100 });
  await altWeg(request, NAME);
  const id = (await (await request.post("/api/entities/Project", { data: { name: NAME, build_kind: "neubau", status: "concept" } })).json()).id;
  const bim = (await (await request.post("/api/entities/BimModel", { data: { project_id: id, storeys: 1, storeyHeight: 3, customZones: RAEUME_START } })).json()).id;
  const bc = (await (await request.post("/api/entities/BuildingComplex", { data: {
    project_id: id, name: NAME, location: { lat: 49.45, lng: 11.07, address: "Musterstraße 1, Musterstadt" },
    moeblierung: {
      // (1) old format: _idx 3 is the store room and the shelf lies in its outline → moves to guid:<G_LAGER>
      "id:3": [{ id: "alt-regal", typ: "regal", x: 12.5, y: 2, rot: 0 }],
      // (2) broken: keyed to the _idx of "Raum Süd", but the cabinet lies in the store room → stays, listed
      "id:2": [{ id: "kaputt-schrank", typ: "aktenschrank", x: 13, y: 4, rot: 0 }],
      // no room has _idx 99 → listed as "Den Raum gibt es nicht mehr", removed in (4) after the confirmation
      "id:99": [{ id: "weg-stuhl", typ: "stuhl", x: 30, y: 30, rot: 0 }],
    },
  } })).json()).id;
  const komplex = async () => /** @type {any} */ (await (await request.get(`/api/entities/BuildingComplex/${bc}`)).json());
  const fotoOrdner = process.env.W111802_FOTO_DIR || "";
  try {
    await nurLocalhost(page);
    /** @type {string[]} */
    const warnungen = [];
    page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text()) && !/WebGL|GPU stall|maplibre|tile|Failed to load resource|Style is not done loading/i.test(m.text())) warnungen.push(m.text()); });
    page.on("pageerror", (e) => { if (!/WebGL|THREE|getUniforms/i.test(String(e.stack || e))) warnungen.push(`pageerror ${e}`); });

    const oeffnen = async () => {
      await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME)}&tab=interiors`);
      await expect(page.getByTestId("moeblierungs-plan")).toBeVisible({ timeout: 60000 });
      await expect(page.locator('[data-testid="mp-raum"]')).toHaveCount(3, { timeout: 30000 });
    };
    const item = (/** @type {string} */ itemId) => page.locator(`[data-testid="mp-item"][data-id="${itemId}"]`);
    const raum = (/** @type {string} */ guid) => page.locator(`[data-testid="mp-raum"][data-key="guid:${guid}"]`);
    const ohneRaum = page.getByTestId("ia-verwaist");

    // (1) + (2) on open
    await oeffnen();
    await expect.poll(async () => Object.keys((await komplex()).moeblierung || {}).sort(), { timeout: 20000 }).toEqual(["guid:" + G_LAGER, "id:2", "id:99"]);
    await expect(item("alt-regal")).toHaveAttribute("data-key", `guid:${G_LAGER}`);
    await expect(item("kaputt-schrank")).toHaveCount(0); // not shown in "Raum Süd", where it does not lie
    await expect(ohneRaum).toContainText("Möbel ohne Raum");
    const kaputt = ohneRaum.locator('[data-testid="ia-ohne-raum-eintrag"][data-key="id:2"]');
    await expect(kaputt).toHaveAttribute("data-grund", "ausserhalb");
    await expect(kaputt).toContainText("Raum Süd");
    await expect(kaputt).toContainText("Sie liegen in Lager"); // review R-1: named, not preselected
    await expect(kaputt.locator("select")).toHaveValue("");

    // (3) furniture in two rooms through the plan: click the room, then the catalogue chip
    await raum(G_NORD).click();
    await page.getByRole("button", { name: "Schreibtisch", exact: true }).click();
    await raum(G_SUED).click();
    await page.getByRole("button", { name: "Garderobe", exact: true }).click();
    await expect.poll(async () => {
      const m = (await komplex()).moeblierung || {};
      return [(m[`guid:${G_NORD}`] || []).length, (m[`guid:${G_SUED}`] || []).length];
    }, { timeout: 20000 }).toEqual([1, 1]);
    const m1 = (await komplex()).moeblierung;
    const nordId = m1[`guid:${G_NORD}`][0].id, suedId = m1[`guid:${G_SUED}`][0].id;
    await expect(item(nordId)).toHaveAttribute("data-key", `guid:${G_NORD}`);
    await expect(item(suedId)).toHaveAttribute("data-key", `guid:${G_SUED}`);

    // rebuild the rooms from outside: other order, new _idx — Raum Süd now has the _idx Raum Nord had (1), the GUID stays
    const neu = [
      { points: SUED, level: 0, name: "Raum Süd", _idx: 1, guid: G_SUED },
      { points: NORD, level: 0, name: "Raum Nord", _idx: 2, guid: G_NORD },
      { points: LAGER, level: 0, name: "Lager", _idx: 7, guid: G_LAGER },
    ];
    expect((await request.put(`/api/entities/BimModel/${bim}`, { data: { customZones: neu } })).ok()).toBe(true);
    await oeffnen();
    // every piece of furniture is still in its room: key = its room's GUID, centre inside that room's outline
    await expect(item(nordId)).toHaveAttribute("data-key", `guid:${G_NORD}`);
    await expect(item(suedId)).toHaveAttribute("data-key", `guid:${G_SUED}`);
    await expect(item("alt-regal")).toHaveAttribute("data-key", `guid:${G_LAGER}`);
    expect(Number(await item(nordId).getAttribute("data-x"))).toBeGreaterThan(1);
    expect(Number(await item(nordId).getAttribute("data-x"))).toBeLessThan(5);
    expect(Number(await item(suedId).getAttribute("data-x"))).toBeGreaterThan(6);
    expect(Number(await item(suedId).getAttribute("data-x"))).toBeLessThan(10);
    // the broken entry was not guessed into a room by the rebuild (_idx 2 is "Raum Nord" now, the cabinet lies in the store room)
    await expect(kaputt).toHaveAttribute("data-grund", "ausserhalb");
    await expect(kaputt).toContainText("Raum Nord");
    await expect(item("kaputt-schrank")).toHaveCount(0);
    expect(Object.keys((await komplex()).moeblierung).sort()).toEqual(["guid:" + G_LAGER, "guid:" + G_NORD, "guid:" + G_SUED, "id:2", "id:99"]);
    if (fotoOrdner) {
      await page.getByTestId("moeblierungs-plan").locator("[data-bim-plan2d]").first().screenshot({ path: `${fotoOrdner}/plan-nach-neuaufbau.png` });
      await ohneRaum.screenshot({ path: `${fotoOrdner}/moebel-ohne-raum.png` });
    }

    // (4) review R-3: "Entfernen" asks first — dismissed nothing happens, confirmed the entry is gone
    const weg = ohneRaum.locator('[data-testid="ia-ohne-raum-eintrag"][data-key="id:99"]');
    await expect(weg).toHaveAttribute("data-grund", "kein-raum");
    /** @type {string[]} */
    const fragen = [];
    page.once("dialog", (d) => { fragen.push(d.message()); void d.dismiss(); });
    await weg.getByTestId("ia-ohne-raum-entfernen").click();
    await expect.poll(() => fragen.length).toBe(1);
    expect(fragen[0]).toContain("1 Möbel endgültig entfernen?");
    await expect(weg).toHaveCount(1);
    page.once("dialog", (d) => { void d.accept(); });
    await weg.getByTestId("ia-ohne-raum-entfernen").click();
    await expect(weg).toHaveCount(0);
    await expect.poll(async () => Object.keys((await komplex()).moeblierung).sort(), { timeout: 20000 })
      .toEqual(["guid:" + G_LAGER, "guid:" + G_NORD, "guid:" + G_SUED, "id:2"]);
    // review R-1: the room the cabinet lies in is marked in the choice, not preselected; the person picks it and assigns
    await expect(kaputt.locator("select")).toHaveValue("");
    await expect(kaputt.getByTestId("ia-ohne-raum-zuweisen")).toBeDisabled();
    await expect(kaputt.locator(`option[value="guid:${G_LAGER}"]`)).toContainText("Möbel liegen hier");
    await kaputt.locator("select").selectOption(`guid:${G_LAGER}`);
    await kaputt.getByTestId("ia-ohne-raum-zuweisen").click();
    await expect(ohneRaum).toHaveCount(0);
    await expect(item("kaputt-schrank")).toHaveAttribute("data-key", `guid:${G_LAGER}`);
    await expect.poll(async () => ((await komplex()).moeblierung[`guid:${G_LAGER}`] || []).map((/** @type {any} */ i) => i.id), { timeout: 20000 })
      .toEqual(["alt-regal", "kaputt-schrank"]);
    expect(Object.keys((await komplex()).moeblierung)).not.toContain("id:2");

    expect(warnungen).toEqual([]);
  } finally {
    await request.delete(`/api/entities/BuildingComplex/${bc}`);
    for (const m of await (await request.get(`/api/entities/BimModel?project_id=${id}`)).json()) await request.delete(`/api/entities/BimModel/${m.id}`);
    await request.delete(`/api/entities/Project/${id}`);
  }
});

const NAME_GESCHOSS = "E2E Möbel-Raum W-1118-02 Geschosse";

test("W-1118-02 Review: gestapelte Räume behalten ihre Möbel, ein im Studio gezeichneter Raum wird sofort unter seiner GUID möbliert", async ({ page, request }) => {
  test.setTimeout(240000);
  await page.setViewportSize({ width: 1500, height: 1100 });
  await altWeg(request, NAME_GESCHOSS);
  const id = (await (await request.post("/api/entities/Project", { data: { name: NAME_GESCHOSS, build_kind: "neubau", status: "concept" } })).json()).id;
  // ground floor: two rooms; upper floor: a copy of the first ("Geschoss kopieren": same outline, own _idx, no GUID yet)
  const raeume = [
    { points: NORD, level: 0, name: "Unten", _idx: 1 },
    { points: SUED, level: 0, name: "Lager unten", _idx: 2 },
    { points: NORD, level: 1, name: "Oben", _idx: 3 },
  ];
  const bim = (await (await request.post("/api/entities/BimModel", { data: { project_id: id, storeys: 2, storeyHeight: 3, customZones: raeume } })).json()).id;
  const bc = (await (await request.post("/api/entities/BuildingComplex", { data: {
    project_id: id, name: NAME_GESCHOSS, location: { lat: 49.45, lng: 11.07, address: "Musterstraße 1, Musterstadt" },
    // phase-43 format: one desk per stacked room under id:<_idx>, both at the same spot
    moeblierung: { "id:1": [{ id: "unten-tisch", typ: "schreibtisch", x: 3, y: 3, rot: 0 }], "id:3": [{ id: "oben-tisch", typ: "schreibtisch", x: 3, y: 3, rot: 0 }] },
  } })).json()).id;
  const komplex = async () => /** @type {any} */ (await (await request.get(`/api/entities/BuildingComplex/${bc}`)).json());
  const modell = async () => /** @type {any} */ (await (await request.get(`/api/entities/BimModel/${bim}`)).json());
  try {
    await nurLocalhost(page);
    /** @type {string[]} */
    const warnungen = [];
    page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text()) && !/WebGL|GPU stall|maplibre|tile|Failed to load resource|Style is not done loading/i.test(m.text())) warnungen.push(m.text()); });
    page.on("pageerror", (e) => { if (!/WebGL|THREE|getUniforms/i.test(String(e.stack || e))) warnungen.push(`pageerror ${e}`); });
    const item = (/** @type {string} */ itemId) => page.locator(`[data-testid="mp-item"][data-id="${itemId}"]`);

    // the studio: draw a room on the upper floor over "Lager unten" — the drawing is a change, so the studio saves and pins the GUIDs
    await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME_GESCHOSS)}&tab=bim`);
    await expect.poll(() => page.evaluate(() => (/** @type {any} */ (window)).__bitZeigen?.bimAenderung?.modell()?.customZones?.length ?? 0), { timeout: 60000 }).toBe(3);
    // the studio ignores changes for 50 ms after its load (loadingRef) — give it a moment so the drawing triggers the autosave
    await page.waitForTimeout(1000);
    const neu = await page.evaluate(() => (/** @type {any} */ (window)).bitApi.zone({ points: [{ x: 6, z: 1 }, { x: 10, z: 1 }, { x: 10, z: 5 }, { x: 6, z: 5 }], level: 1, name: "Neu oben" }));
    expect(neu.ok).toBe(true);
    await speichernUndWarten(page); // 115-05c (adapted)
    await expect.poll(async () => ((await modell()).customZones || []).filter((/** @type {any} */ z) => typeof z.guid === "string" && z.guid.length === 22).length, { timeout: 30000 }).toBe(4);
    const gespeichert = /** @type {any[]} */ ((await modell()).customZones);
    const guidVon = (/** @type {string} */ name) => gespeichert.find((z) => z.name === name)?.guid;
    // review R-W111802-1: the pinned GUIDs go back into the studio state (before: only into the record)
    await expect.poll(() => page.evaluate(() => ((/** @type {any} */ (window)).__bitZeigen?.bimAenderung?.modell()?.customZones || [])
      .filter((/** @type {any} */ z) => typeof z.guid === "string" && z.guid.length === 22).length), { timeout: 20000 }).toBe(4);

    // to the Innenausbau tab WITHOUT a reload (the page's own jump), so the rooms come from the studio's mirror of this session
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("werkstatt:goto-innenausbau")));
    await expect(page.getByTestId("moeblierungs-plan")).toBeVisible({ timeout: 60000 });
    // review R-3: the stacked id: entries were never renumbered (GUID derived from their own _idx) → moved to their GUID keys
    await expect.poll(async () => Object.keys((await komplex()).moeblierung || {}).sort(), { timeout: 20000 })
      .toEqual([`guid:${guidVon("Oben")}`, `guid:${guidVon("Unten")}`].sort());
    await expect(page.getByTestId("ia-verwaist")).toHaveCount(0);
    await expect(item("unten-tisch")).toHaveAttribute("data-key", `guid:${guidVon("Unten")}`);
    // the room drawn a moment ago: its key is its GUID already (before: id:<_idx> until a reload)
    await page.getByTestId("mp-level-1").click();
    await expect(item("oben-tisch")).toHaveAttribute("data-key", `guid:${guidVon("Oben")}`);
    const neuRaum = page.locator(`[data-testid="mp-raum"][data-key="guid:${guidVon("Neu oben")}"]`);
    await expect(neuRaum).toHaveCount(1);
    await neuRaum.click();
    await page.getByRole("button", { name: "Schreibtisch", exact: true }).click();
    await expect.poll(async () => ((await komplex()).moeblierung[`guid:${guidVon("Neu oben")}`] || []).length, { timeout: 20000 }).toBe(1);

    // reload: every desk is in its room on its storey, nothing under "Möbel ohne Raum"
    await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME_GESCHOSS)}&tab=interiors`);
    await expect(page.getByTestId("moeblierungs-plan")).toBeVisible({ timeout: 60000 });
    await expect(item("unten-tisch")).toHaveAttribute("data-key", `guid:${guidVon("Unten")}`);
    await page.getByTestId("mp-level-1").click();
    await expect(item("oben-tisch")).toHaveAttribute("data-key", `guid:${guidVon("Oben")}`);
    await expect(page.locator(`[data-testid="mp-item"][data-key="guid:${guidVon("Neu oben")}"]`)).toHaveCount(1);
    await expect(page.getByTestId("ia-verwaist")).toHaveCount(0);
    expect(Object.keys((await komplex()).moeblierung).sort()).toEqual([`guid:${guidVon("Neu oben")}`, `guid:${guidVon("Oben")}`, `guid:${guidVon("Unten")}`].sort());

    expect(warnungen).toEqual([]);
  } finally {
    await request.delete(`/api/entities/BuildingComplex/${bc}`);
    for (const m of await (await request.get(`/api/entities/BimModel?project_id=${id}`)).json()) await request.delete(`/api/entities/BimModel/${m.id}`);
    await request.delete(`/api/entities/Project/${id}`);
  }
});

const NAME_ALTER_TAB = "E2E Möbel-Raum W-1118-02 alter Tab";
const G_ALTER_TAB = "0raumAltTabE2E11180201";

// Nachgang (final review F1): the migration moved id: → guid: and then went through the full 95-01 autosave — a tab opened long ago
// and left alone on another tab wrote its whole old copy of the BuildingComplex as soon as another device saved the model (stream
// 106-09, the rooms get their GUID). Now a change that is ONLY the migration stores just the field moeblierung, migrated from the
// fresh record; what other tabs stored since stays.
test("W-1118-02 Nachgang: ein unberührter alter Tab überschreibt den Entwurf nicht, wenn ein anderes Gerät das Modell speichert", async ({ page, request }) => {
  test.setTimeout(180000);
  await page.setViewportSize({ width: 1400, height: 1000 });
  await altWeg(request, NAME_ALTER_TAB);
  const id = (await (await request.post("/api/entities/Project", { data: { name: NAME_ALTER_TAB, build_kind: "neubau", status: "concept" } })).json()).id;
  // a room WITHOUT a stored GUID (not saved by the studio since 107-08) and its desk under id:<_idx>, inside the room
  const bim = (await (await request.post("/api/entities/BimModel", { data: { project_id: id, storeys: 1, storeyHeight: 3,
    customZones: [{ points: NORD, level: 0, name: "Raum Nord", _idx: 1 }] } })).json()).id;
  const bc = (await (await request.post("/api/entities/BuildingComplex", { data: {
    project_id: id, name: NAME_ALTER_TAB, location: { lat: 49.45, lng: 11.07, address: "Musterstraße 1, Musterstadt" },
    moeblierung: { "id:1": [{ id: "tisch", typ: "schreibtisch", x: 3, y: 3, rot: 0 }] },
    interior_designs: [],
  } })).json()).id;
  const komplex = async () => /** @type {any} */ (await (await request.get(`/api/entities/BuildingComplex/${bc}`)).json());
  try {
    await nurLocalhost(page);
    /** @type {string[]} */
    const warnungen = [];
    page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text()) && !/WebGL|GPU stall|maplibre|tile|Failed to load resource|Style is not done loading/i.test(m.text())) warnungen.push(m.text()); });
    page.on("pageerror", (e) => { if (!/WebGL|THREE|getUniforms/i.test(String(e.stack || e))) warnungen.push(`pageerror ${e}`); });

    // the old tab: opens the project on the Massing tab (not Innenausbau) and is then left alone
    await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME_ALTER_TAB)}&tab=massing`);
    await expect.poll(() => page.evaluate(() => (/** @type {any} */ (window)).__bitAbgleich?.stand()?.verbindung?.status ?? null), { timeout: 60000 }).toBe("verbunden");
    await page.waitForTimeout(3000); // the page settles (load effects, a first autosave of its own, if any)
    expect(Object.keys((await komplex()).moeblierung)).toEqual(["id:1"]);

    // another tab stores a room concept in the BuildingComplex ...
    expect((await request.put(`/api/entities/BuildingComplex/${bc}`, { data: { interior_designs: [{ room: "Andere Sitzung", style: "Modern", area: 12, palette: "#e2e8f0" }] } })).ok()).toBe(true);
    // ... and another device saves the model in its studio: the room gets its GUID pinned, the stream tells the old tab
    expect((await request.put(`/api/entities/BimModel/${bim}`, { data: { customZones: [{ points: NORD, level: 0, name: "Raum Nord", _idx: 1, guid: G_ALTER_TAB }] } })).ok()).toBe(true);

    // the old tab migrates the desk to the GUID key (the room was never renumbered, the desk lies in it) ...
    await expect.poll(async () => Object.keys((await komplex()).moeblierung || {}), { timeout: 20000 }).toEqual([`guid:${G_ALTER_TAB}`]);
    // ... and the other tab's room concept is still there, also after the autosave delay (1.5 s)
    await page.waitForTimeout(4000);
    const nachher = await komplex();
    expect((nachher.interior_designs || []).map((/** @type {any} */ d) => d.room)).toEqual(["Andere Sitzung"]);
    expect(nachher.moeblierung[`guid:${G_ALTER_TAB}`].map((/** @type {any} */ i) => i.id)).toEqual(["tisch"]);

    expect(warnungen).toEqual([]);
  } finally {
    await request.delete(`/api/entities/BuildingComplex/${bc}`);
    for (const m of await (await request.get(`/api/entities/BimModel?project_id=${id}`)).json()) await request.delete(`/api/entities/BimModel/${m.id}`);
    await request.delete(`/api/entities/Project/${id}`);
  }
});

const NAME_TEILEN = "E2E Möbel-Raum W-1118-02 Teilen";

// Nachgang (final review F-W111802-FINAL-1): "Raum teilen" gives both parts a new GUID; the furniture lies under the old one. Part A
// keeps the _idx the old GUID was derived from — its furniture moves there on its own (main kept it there through id:<_idx>).
test("W-1118-02 Nachgang: nach „Raum teilen“ stehen die Möbel im Teil, der den Raum fortsetzt", async ({ page, request }) => {
  test.setTimeout(180000);
  await page.setViewportSize({ width: 1500, height: 1100 });
  await altWeg(request, NAME_TEILEN);
  const id = (await (await request.post("/api/entities/Project", { data: { name: NAME_TEILEN, build_kind: "neubau", status: "concept" } })).json()).id;
  /** @type {string[]} */
  const warnungen = [];
  page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text()) && !/WebGL|GPU stall|maplibre|tile|Failed to load resource|Style is not done loading/i.test(m.text())) warnungen.push(m.text()); });
  page.on("pageerror", (e) => { if (!/WebGL|THREE|getUniforms/i.test(String(e.stack || e))) warnungen.push(`pageerror ${e}`); });
  await nurLocalhost(page);
  await page.goto("/");
  // the GUID the studio's save pins for this record (bauteilGuid of project + "customZones" + _idx), as after any studio save
  const guid = await page.evaluate(async (pid) => (await import("/packages/nova-core/src/lib/bauteil/steckbrief.js")).bauteilGuid(pid, "customZones", { _idx: 1 }), id);
  const bim = (await (await request.post("/api/entities/BimModel", { data: { project_id: id, storeys: 1, storeyHeight: 3,
    customZones: [{ points: rechteck(0, 0, 8, 4), level: 0, name: "Wohnen", _idx: 1, guid }] } })).json()).id;
  const bc = (await (await request.post("/api/entities/BuildingComplex", { data: {
    project_id: id, name: NAME_TEILEN, location: { lat: 49.45, lng: 11.07, address: "Musterstraße 1, Musterstadt" },
    moeblierung: { [`guid:${guid}`]: [{ id: "tisch", typ: "schreibtisch", x: 2, y: 2, rot: 0 }] },
  } })).json()).id;
  const komplex = async () => /** @type {any} */ (await (await request.get(`/api/entities/BuildingComplex/${bc}`)).json());
  const modell = async () => /** @type {any} */ (await (await request.get(`/api/entities/BimModel/${bim}`)).json());
  /** One command through the register's JSON line (a person at the keyboard). @param {string} befehlId @param {any} params */
  const befehl = (befehlId, params) => page.evaluate(([i, p]) => JSON.parse((/** @type {any} */ (window)).__bitBefehle.zeileBearbeiten(
    JSON.stringify({ id: i, method: "ausfuehren", params: { befehl: i, params: p } }))), [befehlId, params]);
  try {
    await page.goto(`/ComplexDesigner?projekt=${encodeURIComponent(NAME_TEILEN)}&tab=bim`);
    await page.waitForFunction(() => !!(/** @type {any} */ (window)).__bitBefehle && !!(/** @type {any} */ (window)).__bitZeigen?.bimAenderung, null, { timeout: 60000 });
    await expect.poll(() => page.evaluate(() => (/** @type {any} */ (window)).__bitZeigen.bimAenderung.modell()?.customZones?.length ?? 0), { timeout: 30000 }).toBe(1);
    await page.waitForTimeout(1000); // the studio ignores changes for a moment after its load (loadingRef)
    const teilen = await befehl("teilen", { guid, linie: { a: { x: 4, z: -1 }, b: { x: 4, z: 5 } } });
    expect(teilen.ok, JSON.stringify(teilen)).toBe(true);
    expect((await befehl("bestaetigen", { vorschlag_id: teilen.result.id, durch: "tastatur" })).ok).toBe(true);
    await speichernUndWarten(page); // 115-05c (adapted)
    await expect.poll(async () => ((await modell()).customZones || []).length, { timeout: 30000 }).toBe(2);
    const teilA = (await modell()).customZones.find((/** @type {any} */ z) => z._idx === 1);
    expect(teilA.guid).not.toBe(guid);
    await expect.poll(async () => Object.keys((await komplex()).moeblierung || {}), { timeout: 20000 }).toEqual([`guid:${teilA.guid}`]);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("werkstatt:goto-innenausbau")));
    await expect(page.getByTestId("moeblierungs-plan")).toBeVisible({ timeout: 60000 });
    await expect(page.locator('[data-testid="mp-item"][data-id="tisch"]')).toHaveAttribute("data-key", `guid:${teilA.guid}`);
    await expect(page.getByTestId("ia-verwaist")).toHaveCount(0);
    expect(warnungen).toEqual([]);
  } finally {
    await request.delete(`/api/entities/BuildingComplex/${bc}`);
    for (const m of await (await request.get(`/api/entities/BimModel?project_id=${id}`)).json()) await request.delete(`/api/entities/BimModel/${m.id}`);
    await request.delete(`/api/entities/Project/${id}`);
  }
});
