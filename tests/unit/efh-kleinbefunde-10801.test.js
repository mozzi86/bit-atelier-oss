// 108-01: small visible findings of the single-family house with gable roof (108-RESEARCH §4, §5, §9). Proves the pure parts:
//  - 9c: dachSchnittLinie (gable 45° across the ridge = triangle, along it = horizontal line), schnittAchseQuerZumFirst,
//    modellImSchnitt (rotation, identity for "x"), globaleTraufhoehe_m = totalHeight, the PDF section with the roof plate and the
//    marks eaves / ridge, and WITHOUT a roof the PDF section and plan byte-identical to the state before 108-01 (golden
//    fixtures/vektorplan-10801-vorher.json, written once from vektorPlan.js of fa945693); the IFC goldens stay as they are
//    (ifcGolden-10701.test.js) and the global roof of the IFC sits on the same eaves;
//  - 4: eingangWirksam (four cases), the PDF plan without the entrance symbol when it is off;
//  - 5: the footprint rule (empty, same hash, other hash, drawn → ask) and the building envelope in the model frame.
// Review 108-01: the screen section (BimPlan2D, JSX) is rendered server-side through vite (helpers/jsxRender.mjs, no new package):
// WITHOUT a roof it is byte-identical to the state before 108-01 (golden fixtures/schnitt-bild-10801-vorher.json, made with BimPlan2D.jsx of
// fa945693), and with gable roof + parapet the parapet sits on the eaves (mark "OK Attika" = eaves + parapet, like the PDF section).
// Also: eingangDesDatensatzes (the entrance in effect for the readers outside the studio) and istKachelFehler (map note "offline").
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { globalesDach, dachSchnittLinie, schnittAchseQuerZumFirst, dachBerechnen, GLOBAL_DACH_DICKE_M } from "@core/lib/bauteil/dachGeometrie.js";
import { globaleTraufhoehe_m } from "@core/lib/bauteil/ebenen.js";
import { modellImSchnitt, huellSchnittWaende } from "@core/lib/bauteil/referenz.js";
import { flaecheImModellrahmen, footprintToMeters } from "@core/lib/buildingModel";
import { footprintQuelleBaufeldPlanung, footprintQuelleGezeichnet, footprintUebernahme, flaechenHash, footprintQuelleText } from "@core/lib/footprintQuelle";
import { eingangWirksam, eigeneEgTuer, autoEnvOpenings, ENTRANCE_START, ENTRANCE_DEFAULT, eingangDesDatensatzes } from "@designer/lib/autoOpenings";
import { istKachelFehler } from "@designer/lib/kartenStoerung";
import { jsxUmgebung } from "./helpers/jsxRender.mjs";
import { schnittGrafik, planGrafik } from "@designer/lib/vektorPlan";
import { exportIFC } from "@designer/lib/ifcExport";
import { efhModell, EFH_108, EFH_FOOTPRINT } from "./fixtures/efh-108.js";

const nah = (/** @type {number} */ a, /** @type {number} */ b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≠ ${b}`);
const vorher = JSON.parse(readFileSync(fileURLToPath(new URL("./fixtures/vektorplan-10801-vorher.json", import.meta.url)), "utf8"));
const schnittBildVorher = JSON.parse(readFileSync(fileURLToPath(new URL("./fixtures/schnitt-bild-10801-vorher.json", import.meta.url)), "utf8"));
const texte = (/** @type {any} */ g) => g.elemente.filter((e) => e.art === "text").map((e) => e.text);

describe("108-01 9c: Satteldach im Schnitt", () => {
  const model = efhModell();
  const dach = globalesDach(model, "sattel", 45);

  it("Traufe aus einer Funktion = totalHeight (KG unter ±0, EG 2,90 + DG 2,60 = 5,50 m)", () => {
    nah(model.totalHeight, 5.5);
    nah(globaleTraufhoehe_m(model), 5.5);
    // without totalHeight the storey source above ground decides (same number)
    nah(globaleTraufhoehe_m({ ...model, totalHeight: undefined }, EFH_108.geschosse), 5.5);
    assert.ok(dach && dach.ok);
    nah(/** @type {any} */ (dach).traufhoehe_m, 5.5);
  });

  it("globalesDach = der bisherige Aufruf dachBerechnen(footprint, {form}, {traufe, anstieg}); flach/ohne Form → null", () => {
    const alt = dachBerechnen(model.footprint, { form: "sattel" }, { traufhoehe_m: model.totalHeight, anstieg_m: /** @type {any} */ (dach).anstieg_m });
    assert.deepEqual(dach, alt);
    assert.equal(globalesDach(model, "flach", 30), null);
    assert.equal(globalesDach(model, null, 30), null);
  });

  it("First liegt bei 45° quer zum First Traufe + 5,10 · tan 45°; der Schnitt quer zum First ist ein Dreieck", () => {
    assert.equal(schnittAchseQuerZumFirst(dach), "z", "First entlang der 11,40-m-Seite (x) → Schnitt B-B entlang z");
    const l = /** @type {NonNullable<ReturnType<typeof dachSchnittLinie>>} */ (dachSchnittLinie(dach, "z", 0));
    assert.equal(l.punkte.length, 3);
    nah(l.traufe_m, 5.5);
    nah(l.first_m, 5.5 + 5.1 * Math.tan(Math.PI / 4), 1e-9);
    nah(l.punkte[0].s_m, -5.1); nah(l.punkte[0].h_m, 5.5);
    nah(l.punkte[1].s_m, 0); nah(l.punkte[1].h_m, 10.6, 1e-9);
    nah(l.punkte[2].s_m, 5.1); nah(l.punkte[2].h_m, 5.5);
  });

  it("längs zum First (A-A) ist die Dachlinie waagrecht auf Firsthöhe; die Plattenoberkante liegt dicke/cos α darüber", () => {
    const l = /** @type {any} */ (dachSchnittLinie(dach, "x", 0));
    assert.equal(l.punkte.length, 2);
    nah(l.punkte[0].s_m, -5.7); nah(l.punkte[1].s_m, 5.7);
    nah(l.punkte[0].h_m, 10.6, 1e-9); nah(l.punkte[1].h_m, 10.6, 1e-9);
    const oben = /** @type {any} */ (dachSchnittLinie(dach, "z", 0, { dicke_m: GLOBAL_DACH_DICKE_M }));
    nah(oben.punkte[0].h_m, 5.5 + GLOBAL_DACH_DICKE_M / Math.cos(Math.PI / 4), 1e-9);
    nah(oben.punkte[1].h_m, 10.6 + GLOBAL_DACH_DICKE_M / Math.cos(Math.PI / 4), 1e-9);
  });

  it("Walmdach: die Knicke der Walmflächen sind exakte Punkte (keine Abtastung)", () => {
    const w = /** @type {any} */ (dachSchnittLinie(globalesDach(model, "walm", 45), "x", 0));
    assert.equal(w.punkte.length, 4);
    // hip ridge inset 1/4 of the shorter side (10.20 m) = 2.55 m from each end → break at ±(5.70 − 2.55)
    nah(w.punkte[1].s_m, -3.15, 1e-9); nah(w.punkte[2].s_m, 3.15, 1e-9);
  });

  it("Achse quer zum First: tieferes als breites Haus → A-A; Flachdach/kein Dach → null; gedrehtes Rechteck → nähere Achse", () => {
    const tief = efhModell({ footprintM: EFH_FOOTPRINT.map((p) => ({ x: p.z, z: p.x })) });
    assert.equal(schnittAchseQuerZumFirst(globalesDach(tief, "sattel", 45)), "x");
    assert.equal(schnittAchseQuerZumFirst(null), null);
    assert.equal(schnittAchseQuerZumFirst(dachBerechnen(EFH_FOOTPRINT, { form: "flach" })), null);
    const c = Math.cos(Math.PI / 9), s = Math.sin(Math.PI / 9); // 20° turned, long side still mostly along x
    const gedreht = EFH_FOOTPRINT.map((p) => ({ x: p.x * c - p.z * s, z: p.x * s + p.z * c }));
    assert.equal(schnittAchseQuerZumFirst(dachBerechnen(gedreht, { form: "sattel", neigung_grad: 45 })), "z");
    assert.equal(dachSchnittLinie(null, "x"), null);
  });

  it("modellImSchnitt: \"x\" ist die Identität, \"z\" dreht (x, z) → (z, −x) ohne Spiegelung und schneidet die Längswände", () => {
    assert.equal(modellImSchnitt(model, "x"), model);
    assert.equal(modellImSchnitt(model, null), model);
    const r = modellImSchnitt(model, "z");
    assert.notEqual(r, model);
    assert.deepEqual(r.footprint, EFH_FOOTPRINT.map((p) => ({ x: p.z, z: -p.x })));
    assert.deepEqual(model.footprint, EFH_FOOTPRINT.map((p) => ({ ...p })), "Eingabe unverändert");
    // same winding sign (rotation, no mirror)
    const umlauf = (/** @type {any[]} */ f) => f.reduce((sum, p, i) => { const q = f[(i + 1) % f.length]; return sum + (p.x * q.z - q.x * p.z); }, 0);
    assert.equal(Math.sign(umlauf(r.footprint)), Math.sign(umlauf(model.footprint)));
    // B-B cuts the walls along x (edges 0 and 2) at x = 0: in the turned frame they sit at ±5.10
    const sw = huellSchnittWaende(r);
    assert.equal(sw.length, 2);
    nah((sw[0].von_m + sw[0].bis_m) / 2, -5.1, 1e-9);
    nah((sw[1].von_m + sw[1].bis_m) / 2, 5.1, 1e-9);
    // the first wall of each storey runs along the turned x (the wall seen behind the cut)
    const erste = r.walls.find((/** @type {any} */ w) => w.level === 0);
    assert.ok(Math.abs(erste.b.x - erste.a.x) > Math.abs(erste.b.z - erste.a.z));
    assert.equal(r.walls.length, model.walls.length);
    assert.equal(r.slabs[0].polygon[0].x, model.slabs[0].polygon[0].z);
  });

  it("PDF-Schnitt ohne Dach Zeichen für Zeichen gleich dem Stand vor 108-01 (drei Modelle)", () => {
    assert.equal(JSON.stringify(schnittGrafik({ model, storeyHeight: 2.9, massstab: 100 })), JSON.stringify(vorher.schnitt));
    assert.equal(JSON.stringify(schnittGrafik({ model, storeyHeight: 2.9, massstab: 100, dach: null, achse: "x" })), JSON.stringify(vorher.schnitt));
    assert.equal(JSON.stringify(schnittGrafik({ model: efhModell({ parapet: { enabled: true, height: 1 } }), storeyHeight: 2.9, massstab: 50 })), JSON.stringify(vorher.schnittAttika));
    assert.equal(JSON.stringify(schnittGrafik({ model: efhModell({ untergeschosse: 0, geschosse: null }), storeyHeight: 3, massstab: 100 })), JSON.stringify(vorher.schnittOhneUg));
  });

  it("PDF-Schnitt B-B mit Satteldach: Dachplatte auf Ebene „dach“, Koten Traufe und First statt „OK Dach“, bbox bis zum First", () => {
    // without the default parapet (an EFH with gable roof has none; with it the two parapet blocks would sit on layer "dach" as well)
    const ohneAttika = efhModell({ parapet: { enabled: false, height: 0 } });
    const g = schnittGrafik({ model: ohneAttika, storeyHeight: 2.9, massstab: 100, dach: globalesDach(ohneAttika, "sattel", 45), achse: "z" });
    const platte = g.elemente.filter((e) => e.ebene === "dach" && e.art === "poly");
    assert.equal(platte.length, 1);
    assert.equal(platte[0].pts.length, 6, "Dreieck unten + Dreieck oben");
    const t = texte(g);
    assert.ok(t.includes("+5,50  Traufe"), t.join(" | "));
    assert.ok(t.includes("+10,60  First"), t.join(" | "));
    assert.ok(!t.some((x) => x.endsWith("OK Dach")));
    assert.ok(/** @type {any} */ (g.bbox).z0 <= -(10.6 + GLOBAL_DACH_DICKE_M / Math.cos(Math.PI / 4)) + 1e-9, "bbox reicht bis zur Plattenoberkante am First");
    // B-B: the cut side walls are the long walls at ±5.10 (turned model)
    const waende = g.elemente.filter((e) => e.ebene === "wand");
    assert.ok(waende.some((e) => e.pts.some((/** @type {any} */ p) => Math.abs(p.x - 5.25) < 1e-9)));
  });
});

describe("108-01 4: Eingang Teil 1 (D-EFH-04)", () => {
  const tuer = [{ level: 0, edge: 1, kind: "door", u: 3, width: 1 }];
  it("eingangWirksam: false → aus, true → an, nicht gesetzt → aus bei EG-Hüllentür, sonst an", () => {
    assert.equal(eingangWirksam({ enabled: false }, []), false);
    assert.equal(eingangWirksam({ enabled: true }, tuer), true, "gespeichertes enabled:true bleibt (keine stille Migration)");
    assert.equal(eingangWirksam({ ...ENTRANCE_START }, tuer), false);
    assert.equal(eingangWirksam({ ...ENTRANCE_START }, []), true);
    assert.equal(eingangWirksam(null, null), true);
    // only doors on the ground floor count; a window or an upper-floor door does not
    assert.equal(eingangWirksam({}, [{ level: 1, kind: "door" }, { level: 0, kind: "window" }]), true);
    assert.equal(eigeneEgTuer(EFH_108.envOpenings), true);
    assert.equal("enabled" in ENTRANCE_START, false);
    assert.equal(ENTRANCE_DEFAULT.enabled, true, "die alte Vorgabe bleibt für alle anderen Leser");
  });

  it("autoEnvOpenings mit wirksamem Eingang: bei eigener EG-Tür keine automatische Eingangstür", () => {
    const model = efhModell();
    const cfg = { ...ENTRANCE_START };
    const an = autoEnvOpenings(model.walls, { entrance: { ...cfg, enabled: true } }, []);
    const aus = autoEnvOpenings(model.walls, { entrance: { ...cfg, enabled: eingangWirksam(cfg, EFH_108.envOpenings) } }, []);
    assert.equal(an.filter((o) => o.kind === "door").length, 1);
    assert.equal(aus.filter((o) => o.kind === "door").length, 0);
  });

  it("PDF-Grundriss: ohne Option wie vor 108-01, mit eingang null ohne Türsymbol des automatischen Eingangs", () => {
    const basis = { model: efhModell(), level: 0, customWalls: EFH_108.customWalls, envOpenings: EFH_108.envOpenings, massstab: 100 };
    const ansicht = { strukturdarstellung: "gesamt", optionen: null, regeln: null };
    assert.equal(JSON.stringify(planGrafik(basis)), JSON.stringify(vorher.grundriss));
    assert.equal(JSON.stringify(planGrafik({ ...basis, ansicht })), JSON.stringify(vorher.grundrissAnsicht));
    assert.equal(JSON.stringify(planGrafik({ ...basis, ansicht, eingang: { kind: "door" } })), JSON.stringify(vorher.grundrissAnsicht));
    const ohne = planGrafik({ ...basis, ansicht, eingang: null });
    const oeffnungen = (/** @type {any} */ g) => g.elemente.filter((e) => e.ebene === "oeffnung").length;
    assert.ok(oeffnungen(ohne) < oeffnungen(vorher.grundrissAnsicht), `${oeffnungen(ohne)} < ${oeffnungen(vorher.grundrissAnsicht)}`);
  });
});

describe("108-01 5: footprint-Schutz (D-EFH-05)", () => {
  const px = [{ x: 100, y: 100 }, { x: 214, y: 100 }, { x: 214, y: 202 }, { x: 100, y: 202 }];
  const parcel = { m_per_px: 0.1 };
  const fpNeu = footprintToMeters(px, parcel);
  const hash = flaechenHash(px, 0.1);

  it("Hash stabil, abhängig von Punkten und Maßstab", () => {
    assert.equal(flaechenHash(px, 0.1), hash);
    assert.match(hash, /^[0-9a-f]{8}$/);
    assert.notEqual(flaechenHash([...px.slice(0, 3), { x: 100, y: 203 }], 0.1), hash);
    assert.notEqual(flaechenHash(px, 0.2), hash);
  });

  it("leer → übernehmen; gleicher Hash → nichts; anderer Hash aus der Baufeld-Planung → übernehmen; gezeichnet → Rückfrage", () => {
    assert.equal(footprintUebernahme(null, hash, null, fpNeu), "uebernehmen");
    const q = footprintQuelleBaufeldPlanung(px, new Date("2026-11-01T10:00:00Z"), 0.1);
    assert.deepEqual(q, { art: "baufeld-planung", hash, datum: "2026-11-01T10:00:00.000Z" });
    assert.equal(footprintUebernahme(q, hash, [{ x: 0, z: 0 }], fpNeu), "gleich");
    assert.equal(footprintUebernahme({ ...q, hash: "00000000" }, hash, [{ x: 0, z: 0 }], fpNeu), "uebernehmen");
    const gezeichnet = [{ x: -4, z: -3 }, { x: 4, z: -3 }, { x: 4, z: 3 }, { x: -4, z: 3 }];
    assert.equal(footprintUebernahme(footprintQuelleGezeichnet(), hash, gezeichnet, fpNeu), "rueckfrage");
    assert.equal(footprintUebernahme({ art: "gemessen" }, hash, gezeichnet, fpNeu), "rueckfrage");
    // an old project whose outline was copied from the area (stamped "gezeichnet") and still equals it: nothing to ask
    assert.equal(footprintUebernahme(footprintQuelleGezeichnet(), hash, fpNeu, fpNeu), "gleich");
    assert.equal(footprintQuelleText(q), "Umriss: aus der Baufeld-Planung (1.11.2026)");
  });

  it("Baufeld im Modellrahmen der footprint-Fläche (Eckpunkt-Mittelwert × m/px wie footprintToMeters)", () => {
    const baufeld = [{ x: 90, y: 90 }, { x: 224, y: 90 }, { x: 224, y: 212 }, { x: 90, y: 212 }];
    const m = /** @type {any[]} */ (flaecheImModellrahmen(baufeld, px, parcel));
    nah(m[0].x, -6.7, 1e-9); nah(m[0].z, -6.1, 1e-9); nah(m[2].x, 6.7, 1e-9); nah(m[2].z, 6.1, 1e-9);
    assert.deepEqual(flaecheImModellrahmen(px, px, parcel), fpNeu, "die footprint-Fläche selbst ergibt genau footprintToMeters");
    assert.equal(flaecheImModellrahmen(baufeld.slice(0, 2), px, parcel), null);
  });
});

describe("108-01: IFC und Bildschirm-Schnitt", () => {
  it("IFC: das globale Dach sitzt auf globaleTraufhoehe_m (mit und ohne totalHeight gleiche Datei)", () => {
    const model = efhModell();
    const opt = { storeyHeight: 2.9, geschosse: EFH_108.geschosse, dachGlobal: { form: "sattel", neigung_grad: 45 } };
    const a = exportIFC(model, opt);
    assert.equal(exportIFC({ ...model, totalHeight: undefined }, opt), a);
    assert.match(a, /IFCROOF\(/);
  });
});

describe("108-01 Review: Bildschirm-Schnitt (BimPlan2D, serverseitig gerendert)", () => {
  /** @type {Awaited<ReturnType<typeof jsxUmgebung>>} */
  let u;
  /** @type {any} */
  let BimPlan2D;
  /** @type {any} */
  let createBuildingModel;
  /** @type {any} */
  let SCHNITT_FAELLE;
  before(async () => {
    u = await jsxUmgebung();
    BimPlan2D = (await u.laden("/packages/nova-designer/src/components/BimPlan2D.jsx")).default;
    ({ createBuildingModel } = await u.laden("/packages/nova-core/src/lib/buildingModel.js"));
    ({ SCHNITT_FAELLE } = await u.laden("/tests/unit/fixtures/schnitt-bild-10801.js"));
  });
  after(async () => { await u?.schliessen(); });

  it("ohne Dach Zeichen für Zeichen gleich dem Stand vor 108-01 (vier Modelle, auch mit achse \"x\")", () => {
    const faelle = SCHNITT_FAELLE(createBuildingModel);
    assert.deepEqual(Object.keys(faelle), Object.keys(schnittBildVorher));
    for (const [name, props] of Object.entries(faelle)) {
      assert.equal(u.rendern(BimPlan2D, props), schnittBildVorher[name], name);
      assert.equal(u.rendern(BimPlan2D, { ...props, achse: "x", dach: null }), schnittBildVorher[name], `${name}, achse x`);
    }
  });

  it("Satteldach + Attika an: Attika steht auf der Traufe, Kote „OK Attika“ = Traufe + Attika (wie der PDF-Schnitt), First darüber", () => {
    const model = createBuildingModel({ footprintM: EFH_FOOTPRINT.map((p) => ({ ...p })), storeys: 2, storeyHeight: 2.9, geschosse: EFH_108.geschosse,
      untergeschosse: 1, parapet: { enabled: true, height: 1 } });
    const dach = globalesDach(model, "sattel", 45);
    for (const achse of ["z", "x"]) {
      const svg = u.rendern(BimPlan2D, { model, mode: "schnitt", storeyHeight: 2.9, height: 520, dach, achse });
      assert.match(svg, /OK Attika \+6\.50</, `${achse}: Kote der Attika auf 5,50 + 1,00`);
      assert.doesNotMatch(svg, /OK Attika \+1[01]\./, `${achse}: keine Attika-Kote auf Firsthöhe`);
      assert.match(svg, /data-kote="first"[^>]*>First \+10\.60</);
      // the cut hull walls end at the eaves (y = Y(totalH)); each parapet block starts exactly there (y + height = top of the wall)
      const wandY = Number(/<rect[^>]*y="([-\d.e]+)"[^>]*data-schnittwand="0"/.exec(svg)?.[1]);
      const attiken = [...svg.matchAll(/<rect x="[-\d.e]+" y="([-\d.e]+)" width="[-\d.e]+" height="([-\d.e]+)" fill="url\(#hatch\)" stroke="#1e293b" stroke-width="0.6"\/?>/g)];
      assert.ok(Number.isFinite(wandY), `${achse}: Schnittwand gefunden`);
      assert.ok(attiken.length >= 2, `${achse}: zwei Attika-Blöcke (${attiken.length})`);
      for (const m of attiken) nah(Number(m[1]) + Number(m[2]), wandY, 1e-6);
    }
  });
});

describe("108-01 Review: Eingang eines Datensatzes außerhalb des Studios", () => {
  const tuer = [{ level: 0, edge: 0, kind: "door", u: 2.2, width: 1.01 }];
  it("ohne entranceCfg + EG-Tür → aus (wie das Studio); ohne Tür → an; gespeicherte Wahl bleibt; kein Datensatz → null", () => {
    assert.deepEqual(eingangDesDatensatzes({ envOpenings: tuer }), { ...ENTRANCE_START, enabled: false });
    assert.deepEqual(eingangDesDatensatzes({ envOpenings: [] }), { ...ENTRANCE_START, enabled: true });
    assert.deepEqual(eingangDesDatensatzes({ entranceCfg: { width: 1.4 }, envOpenings: tuer }), { ...ENTRANCE_START, width: 1.4, enabled: false });
    assert.equal(eingangDesDatensatzes({ entranceCfg: { ...ENTRANCE_START, enabled: true }, envOpenings: tuer })?.enabled, true);
    assert.equal(eingangDesDatensatzes({ entranceCfg: { enabled: false } })?.enabled, false);
    assert.equal(eingangDesDatensatzes(null), null);
  });
});

describe("108-01 Review: Karte offline (istKachelFehler)", () => {
  it("Kachelfehler zählen auch mit „image“ im Text; Sprite/Stilbilder, GeoJSON-Daten und Fehler ohne Quelle nicht", () => {
    const raster = { type: "raster" };
    // a captive portal answers a raster tile with HTML → maplibre cannot decode it
    assert.equal(istKachelFehler({ sourceId: "osm", source: raster, tile: {}, error: { message: "Could not load image. Please make sure to use a supported image type such as PNG or JPEG. Note that SVGs are not supported." } }), true);
    // HTTP error of the satellite source (its URL contains "World_Imagery")
    assert.equal(istKachelFehler({ sourceId: "sat", source: raster, tile: {}, error: { message: "AJAXError: Forbidden (403): https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/5/10/17" } }), true);
    // blocked network (fetch failed): vector tiles, and the TileJSON of a vector source without a tile
    assert.equal(istKachelFehler({ sourceId: "v", source: { type: "vector" }, tile: {}, error: { message: "Failed to fetch" } }), true);
    assert.equal(istKachelFehler({ sourceId: "v", source: { type: "vector" }, error: { message: "Failed to fetch" } }), true);
    // a tile error without serialized source still counts
    assert.equal(istKachelFehler({ sourceId: "x", tile: {}, error: { message: "Failed to fetch" } }), true);
    // sprite / style images: fired by the style, no sourceId
    assert.equal(istKachelFehler({ error: { message: "Unable to load sprite https://example.invalid/sprite.json" } }), false);
    assert.equal(istKachelFehler({ error: { message: "Image \"poi\" could not be loaded" } }), false);
    // data of the callers (invalid setData on a geojson source) is not "offline"
    assert.equal(istKachelFehler({ sourceId: "footprint", source: { type: "geojson" }, error: { message: "Input data is not a valid GeoJSON object." } }), false);
    // a source event without tile of an unknown type, null, undefined
    assert.equal(istKachelFehler({ sourceId: "y", error: { message: "x" } }), false);
    assert.equal(istKachelFehler(null), false);
    assert.equal(istKachelFehler(undefined), false);
  });
});
