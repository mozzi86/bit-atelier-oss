// W-1118-28 step 1: the pure parts of the exposé picture (packages/nova-designer/src/lib/exposeBild.js) — which look a studio
// mesh gets from its userData, the texture coordinates in metres, the sun direction. The rendering itself needs WebGL and is
// checked in the browser.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { exposeMaterialFuer, texturKoordinaten, sonnenRichtung, linsenVersatz, EXPOSE_BILD, EXPOSE_QUALITAET, GELAENDE_FERN_M } from "@designer/lib/exposeBild.js";
import { aussentreppeStufen, exposeSzeneBauen } from "@designer/lib/exposeSzene.js";
import { globalesDach } from "@core/lib/bauteil/dachGeometrie.js";
import { efhModellMitKniestock, efhGeschosseMitKniestock } from "./fixtures/efh-108.js";

describe("W-1118-28 exposeMaterialFuer", () => {
  it("hull: plaster above ground, dark plinth for the basement storeys", () => {
    assert.equal(exposeMaterialFuer({ kind: "wallShell", layer: "shell", level: 0 }), "putz");
    assert.equal(exposeMaterialFuer({ kind: "wallShell", layer: "shell", level: 1 }), "putz");
    assert.equal(exposeMaterialFuer({ kind: "wallShell", layer: "shell", level: -1 }), "sockel");
  });
  it("roof and dormer: tiles on the roof faces, timber on the dormer front and cheeks, glass in its window", () => {
    assert.equal(exposeMaterialFuer({ kind: "globalroof" }), "ziegel");
    assert.equal(exposeMaterialFuer({ kind: "croof" }), "ziegel");
    assert.equal(exposeMaterialFuer({ kind: "gaube", teil: "dach" }), "ziegel");
    assert.equal(exposeMaterialFuer({ kind: "gaube", teil: "front" }), "holz");
    assert.equal(exposeMaterialFuer({ kind: "gaube", teil: "fenster", layer: "openings" }), "glas");
  });
  it("openings: the transparent part is the pane, the rest the frame", () => {
    assert.equal(exposeMaterialFuer({ kind: "window", layer: "openings" }, { transparent: true, opacity: 0.4 }), "glas");
    assert.equal(exposeMaterialFuer({ kind: "window", layer: "openings" }, { transparent: false, opacity: 1 }), "rahmen");
    assert.equal(exposeMaterialFuer({ kind: "door", layer: "openings", scope: "auto" }, null), "rahmen");
    assert.equal(exposeMaterialFuer({ kind: "door", layer: "openings" }, null), "tuerInnen", "a door in a drawn inner wall is white");
  });
  it("canopy: clear glass plate, steel brackets", () => {
    assert.equal(exposeMaterialFuer({ kind: "vordach", teil: "platte", layer: "shell" }), "klarglas");
    assert.equal(exposeMaterialFuer({ kind: "vordach", teil: "konsole", layer: "shell" }), "stahl");
  });
  it("inner walls, slabs, stairs, surroundings; unknown meshes keep their material", () => {
    assert.equal(exposeMaterialFuer({ kind: "wall" }), "innenwand");
    assert.equal(exposeMaterialFuer({ kind: "slab" }), "beton");
    assert.equal(exposeMaterialFuer({ kind: "stair" }), "beton");
    assert.equal(exposeMaterialFuer({ layer: "context" }), "nachbar");
    assert.equal(exposeMaterialFuer({}), null);
    assert.equal(exposeMaterialFuer(/** @type {any} */ (null)), null);
  });
});

describe("W-1118-28 texturKoordinaten", () => {
  it("level face reads (x, z)", () => {
    assert.deepEqual(texturKoordinaten({ x: 3, y: 9, z: -2 }, { x: 0, y: 1, z: 0 }), [3, -2]);
  });
  it("wall facing −x: u runs along the wall (z), v is the height", () => {
    const [u, v] = texturKoordinaten({ x: -5.7, y: 2.5, z: 1.5 }, { x: -1, y: 0, z: 0 });
    assert.equal(Math.abs(u), 1.5);
    assert.equal(v, 2.5);
  });
  it("roof face 45° falling to −z: u along the eave (x), v the slope length", () => {
    const n = { x: 0, y: Math.SQRT1_2, z: -Math.SQRT1_2 };
    const [u0, v0] = texturKoordinaten({ x: 0, y: 4, z: -5 }, n);
    const [u1, v1] = texturKoordinaten({ x: 2, y: 5, z: -4 }, n);
    assert.ok(Math.abs(Math.abs(u1 - u0) - 2) < 1e-9, "2 m along the eave");
    assert.ok(Math.abs((v1 - v0) - Math.SQRT2) < 1e-9, "1 m of rise at 45° is 1.414 m of slope");
  });
});

describe("W-1118-28 constants", () => {
  it("sun from the south-west, 36° high (model axes x east, y up, z south)", () => {
    const s = sonnenRichtung();
    assert.ok(Math.abs(s.length() - 1) < 1e-9);
    assert.ok(s.x < 0 && s.z > 0, "from the west and the south");
    assert.ok(Math.abs(s.y - Math.sin((36 * Math.PI) / 180)) < 1e-9);
  });
  it("picture 3200 × 2000 (16:10), terrain cut-off 20 m", () => {
    assert.deepEqual({ ...EXPOSE_BILD }, { breite: 3200, hoehe: 2000 });
    assert.equal(GELAENDE_FERN_M, 20);
    // above the renderings made outside the app: 512 px, anisotropy 8, shadow map 4096, 4 samples, 16 occlusion samples
    assert.ok(EXPOSE_QUALITAET.textur_px > 512 && EXPOSE_QUALITAET.anisotropie > 8 && EXPOSE_QUALITAET.schatten_px > 4096 && EXPOSE_QUALITAET.kantenglaettung > 4 && EXPOSE_QUALITAET.verschattung_proben > 16 && EXPOSE_QUALITAET.schaerfen > 0 && EXPOSE_QUALITAET.schaerfen_grenze > 0);
  });
});

describe("W-1118-28 aussentreppeStufen / linsenVersatz", () => {
  it("1.20 m to climb: 8 risers of 15 cm; 1.00 m: 7 risers of 14.3 cm; nothing to climb: one riser", () => {
    assert.deepEqual(aussentreppeStufen(1.2), { stufen: 8, steigung_m: 0.15 });
    const t = aussentreppeStufen(1.0);
    assert.equal(t.stufen, 7);
    assert.ok(Math.abs(t.steigung_m - 1 / 7) < 1e-12);
    assert.deepEqual(aussentreppeStufen(0), { stufen: 1, steigung_m: 0.15 });
  });
  it("shifted lens: the picture is the upper part of a taller frame; without a shift nothing changes", () => {
    const ohne = linsenVersatz(40, 0, 2000);
    assert.ok(Math.abs(ohne.fov_grad - 40) < 1e-9);
    assert.equal(ohne.vollHoehe_px, 2000);
    const mit = linsenVersatz(40, 0.24, 2000);
    assert.ok(Math.abs(mit.vollHoehe_px - 2960) < 1e-6, "2000 × (1 + 2 × 0.24)");
    assert.equal(mit.versatz_px, 0);
    assert.ok(mit.fov_grad > 40);
    assert.ok(Math.abs(linsenVersatz(40, -0.1, 2000).versatz_px - 400) < 1e-6, "a downward shift cuts the lower part");
  });
});

describe("W-1118-28 exposeSzeneBauen (test house, gable roof 45°)", () => {
  const gs = efhGeschosseMitKniestock(1), model = efhModellMitKniestock(1), dach = globalesDach(model, "sattel", 45, gs);
  const mat = new Proxy({}, { get: () => ({ map: null }) });
  const bauen = (/** @type {any} */ mehr = {}) => exposeSzeneBauen({ model, dach, gs, hoehe: () => -1.2, mat: /** @type {any} */ (mat), ...mehr });
  const ecken = (/** @type {any} */ gruppe) => gruppe.children.reduce((/** @type {number} */ n, /** @type {any} */ m) => n + (m.geometry?.attributes?.position?.count || 0), 0);
  it("without a layer: the roof body with gutters and ridge is derived; roof plane, dormer roofs, placed openings and slabs are left out", () => {
    const b = bauen();
    assert.ok(b.gruppe.children.length > 5, "roof faces, 2 gutters, 4 × 2 downpipe parts, ridge");
    assert.equal(b.ersetzt({ kind: "globalroof" }), true);
    assert.equal(b.ersetzt({ kind: "slab" }), true);
    assert.equal(b.ersetzt({ kind: "window", layer: "openings", scope: "env" }), true);
    assert.equal(b.ersetzt({ kind: "window", layer: "openings", scope: "auto" }), false);
    assert.equal(b.ersetzt({ kind: "wallShell" }), false);
    b.frei();
  });
  it("a flat roof builds no roof body and keeps the studio roof", () => {
    const b = exposeSzeneBauen({ model, dach: null, gs, hoehe: () => 0, mat: /** @type {any} */ (mat) });
    assert.equal(b.ersetzt({ kind: "globalroof" }), false);
    b.frei();
  });
  it("layer: chimney, outside stair, a door leaf and surroundings add geometry", () => {
    const leer = ecken(bauen().gruppe);
    const voll = bauen({
      envOpenings: [{ kind: "door", edge: 3, u: 5.1, level: 0, width: 1.1, height: 2.2, sill: 0 }, { kind: "window", edge: 0, u: 3, level: 0, width: 1.4, height: 1.3, sill: 0.9 }],
      layer: { kamin: { x: 0.7, z: 0.5, b_m: 0.4, t_m: 0.4 }, aussentreppen: [{ edge: 3, u_von_m: 4.2, u_bis_m: 6, level: 0 }],
        umfeld: { flaechen: [{ art: "asphalt", x0: -20, x1: -13, z0: -30, z1: 30 }], hecken: [{ x0: -11, x1: -10.5, z0: 2, z1: 20, hoehe_m: 0.6 }], baeume: [{ x: -7, z: 8, hoehe_m: 9, krone_m: 3 }], nachbarn: [{ x0: -6, x1: 5, z0: -26, z1: -17, first: "x" }] } },
    });
    assert.ok(ecken(voll.gruppe) > leer + 2000, "many more vertices with the layer");
    assert.ok(voll.gruppe.children.some((/** @type {any} */ m) => m.isInstancedMesh), "the tree crown is one instanced mesh");
    voll.frei();
  });
});
