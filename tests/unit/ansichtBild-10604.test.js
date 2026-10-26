// 106-04: ansichtAlsPng (view as PNG) and the register command ansicht-bild, with a fake renderer and a fake 2D canvas.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ansichtAlsPng, bildBreite, BILD_BREITE_STANDARD, BILD_BREITE_MAX, BILD_BREITE_MIN } from "@core/lib/zeigen/ansichtBild.js";
import { auswahlBefehleRegistrieren } from "@core/lib/zeigen/auswahlBefehle.js";
import { befehlsRegister } from "@core/lib/befehlsregister.js";

/** Fake three.js handles: a canvas of the given pixel size; `ablauf` records render / drawImage in order. */
function fake(breite, hoehe, ablauf = /** @type {string[]} */ ([])) {
  const gezeichnet = [];
  const three = {
    scene: {}, camera: {},
    renderer: { domElement: { width: breite, height: hoehe }, render: () => ablauf.push("render") },
  };
  const erzeugeCanvas = (/** @type {number} */ w, /** @type {number} */ h) => ({
    width: w, height: h,
    getContext: () => ({ drawImage: (/** @type {any[]} */ ...a) => { ablauf.push("drawImage"); gezeichnet.push(a.slice(1)); } }),
    toDataURL: () => "data:image/png;base64,iVBORw0KGgoAAAA",
  });
  return { three, erzeugeCanvas, gezeichnet, ablauf };
}

describe("bildBreite", () => {
  it("Standard, Klammern und Fehler", () => {
    assert.equal(bildBreite(undefined), BILD_BREITE_STANDARD);
    assert.equal(bildBreite(""), BILD_BREITE_STANDARD);
    assert.equal(bildBreite(5000), BILD_BREITE_MAX);
    assert.equal(bildBreite(10), BILD_BREITE_MIN);
    assert.equal(bildBreite("1000,4"), 1000);
    assert.throws(() => bildBreite("breit"), /breite: eine Zahl in Pixel/);
    assert.throws(() => bildBreite(-5), /breite/);
  });
});

describe("ansichtAlsPng", () => {
  it("rendert zuerst, zeichnet dann herunterskaliert (Seitenverhältnis bleibt) und liefert base64 ohne data:-Kopf", () => {
    const f = fake(2800, 1400);
    const r = ansichtAlsPng(f.three, { breite: 800, erzeugeCanvas: f.erzeugeCanvas });
    assert.deepEqual(f.ablauf, ["render", "drawImage"], "the buffer is read right after render()");
    assert.deepEqual(r, { png_base64: "iVBORw0KGgoAAAA", breite: 800, hoehe: 400, format: "image/png" });
    assert.deepEqual(f.gezeichnet[0], [0, 0, 2800, 1400, 0, 0, 800, 400]);
  });

  it("vergrößert nie: ein kleines Fenster liefert seine echte Breite", () => {
    const f = fake(500, 300);
    const r = ansichtAlsPng(f.three, { erzeugeCanvas: f.erzeugeCanvas });
    assert.deepEqual([r.breite, r.hoehe], [500, 300]);
  });

  it("Standard 800 px, Obergrenze 1600 px", () => {
    assert.equal(ansichtAlsPng(fake(3000, 1500).three, { erzeugeCanvas: fake(3000, 1500).erzeugeCanvas }).breite, 800);
    const f = fake(4000, 2000);
    assert.equal(ansichtAlsPng(f.three, { breite: 9999, erzeugeCanvas: f.erzeugeCanvas }).breite, 1600);
  });

  it("ohne 3D-Ansicht, ohne Größe oder ohne PNG: Klartext, kein Bild", () => {
    assert.throws(() => ansichtAlsPng(null), /Keine 3D-Ansicht bereit/);
    assert.throws(() => ansichtAlsPng({ renderer: {}, scene: {} }), /Keine 3D-Ansicht bereit/);
    const leer = fake(0, 0);
    assert.throws(() => ansichtAlsPng(leer.three, { erzeugeCanvas: leer.erzeugeCanvas }), /keine Größe/);
    const f = fake(100, 100);
    assert.throws(() => ansichtAlsPng(f.three, { erzeugeCanvas: () => ({ getContext: () => ({ drawImage() {} }), toDataURL: () => "data:," }) }), /kein PNG/);
    assert.throws(() => ansichtAlsPng(f.three, { erzeugeCanvas: () => ({ getContext: () => null }) }), /2D-Zeichenfeld/);
  });
});

describe("Befehl ansicht-bild", () => {
  it("ruft die Fläche mit der Breite auf; eine Fläche ohne Bild verweigert in Worten", () => {
    const reg = befehlsRegister();
    /** @type {any} */
    let fl = { kontext: () => ({}), waehleGuid: () => null, aufheben() {}, ansichtAufAuswahl() {}, modell: () => ({}),
      ansichtBild: (/** @type {any} */ o) => ({ png_base64: "x", breite: o.breite, hoehe: 1, format: "image/png" }) };
    auswahlBefehleRegistrieren(reg, () => fl);
    // 106-06: the answer names the open project (null = none), for the consent check of the MCP server
    assert.deepEqual(reg.ausfuehren("ansicht-bild", { breite: 640 }), { ok: true, result: { png_base64: "x", breite: 640, hoehe: 1, format: "image/png", projekt_id: null } });
    assert.ok(reg.alle().some((b) => b.id === "ansicht-bild" && b.parameter?.breite === "zahl"));
    fl = { ...fl, ansichtBild: undefined };
    const r = reg.ausfuehren("ansicht-bild", {});
    assert.equal(r.ok, false);
    assert.match(/** @type {any} */ (r).error, /kein Bild/);
    fl = { ...fl, ansichtBild: () => { throw new Error("Ein Bild gibt es nur in der 3D-Ansicht"); } };
    assert.match(/** @type {any} */ (reg.ausfuehren("ansicht-bild", {})).error, /nur in der 3D-Ansicht/);
  });
});
