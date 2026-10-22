// IFC import reads the georeference (gap found 21.10.2026): IfcMapConversion + IfcProjectedCRS wins,
// IfcSite RefLatitude/RefLongitude is the fallback, none → warning. web-ifc is proxied to inject lines.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { georefAusModell, extractFromModel } from "@ifc/lib/ifcImport.js";
import { nachUtm } from "@core/lib/utmEtrs89";

const require = createRequire(import.meta.url);
const IFC = path.join(path.resolve(import.meta.dirname, "../.."), "public/beispiel/musterprojekt.ifc");
let W, api, modelID;
before(async () => {
  W = require("web-ifc");
  api = new W.IfcAPI();
  await api.Init();
  modelID = api.OpenModel(new Uint8Array(fs.readFileSync(IFC)), { COORDINATE_TO_ORIGIN: true });
});

/** api whose GetLineIDsWithType/GetLine also know the given fake lines {typ, id, line}. */
function mitZeilen(zeilen) {
  return new Proxy(api, {
    get(ziel, prop) {
      if (prop === "GetLineIDsWithType") return (mid, typ) => {
        const extra = zeilen.filter((z) => z.typ === typ).map((z) => z.id);
        if (!extra.length) return ziel.GetLineIDsWithType(mid, typ);
        return { size: () => extra.length, get: (i) => extra[i] };
      };
      if (prop === "GetLine") return (mid, id, ...r) => zeilen.find((z) => z.id === id)?.line ?? ziel.GetLine(mid, id, ...r);
      const v = ziel[prop];
      return typeof v === "function" ? v.bind(ziel) : v;
    },
  });
}
const v = (value) => ({ type: 4, value });

describe("IFC-Import — Georeferenz", () => {
  it("Musterprojekt ohne Georeferenz: art null + Warnung", () => {
    assert.equal(georefAusModell(api, modelID).art, null);
    const meta = extractFromModel(api, modelID);
    assert.ok(meta.warnungen.some((w) => /Keine Georeferenz/.test(w)));
    assert.equal(meta.kennzahlen.georef.art, null);
  });

  it("IfcMapConversion in EPSG:25832 → Grad, auch mit Zonen-Präfix im Ostwert", () => {
    const soll = { lat: 49.4521, lng: 11.0767 }; // a point in zone 32
    const { ost, nord } = nachUtm(soll.lat, soll.lng, 32);
    for (const e of [ost, 32e6 + ost]) {
      const a = mitZeilen([
        { typ: W.IFCMAPCONVERSION, id: 900001, line: { Eastings: v(e), Northings: v(nord), OrthogonalHeight: v(310.5), XAxisAbscissa: v(0), XAxisOrdinate: v(1), TargetCRS: { value: 900002 } } },
        { typ: W.IFCPROJECTEDCRS, id: 900002, line: { Name: v("EPSG:25832") } },
      ]);
      const g = georefAusModell(a, modelID);
      assert.equal(g.art, "mapconversion");
      assert.ok(Math.abs(g.lat - soll.lat) < 1e-6 && Math.abs(g.lng - soll.lng) < 1e-6, JSON.stringify(g));
      assert.equal(g.hoehe, 310.5);
      assert.ok(Math.abs(g.drehung_grad - 90) < 1e-9);
    }
  });

  it("anderes Koordinatensystem: Ost/Nord übernommen, Grad null, Hinweis", () => {
    const a = mitZeilen([
      { typ: W.IFCMAPCONVERSION, id: 900011, line: { Eastings: v(4432000), Northings: v(5480000), TargetCRS: { value: 900012 } } },
      { typ: W.IFCPROJECTEDCRS, id: 900012, line: { Name: v("EPSG:31468") } },
    ]);
    const g = georefAusModell(a, modelID);
    assert.equal(g.lat, null);
    assert.match(g.hinweis, /EPSG:31468/);
  });

  it("IfcSite RefLatitude/RefLongitude (Grad, Minuten, Sekunden, Millionstel)", () => {
    const sites = api.GetLineIDsWithType(modelID, W.IFCSITE);
    const id = sites.get(0);
    const echt = api.GetLine(modelID, id);
    const a = mitZeilen([{ typ: W.IFCSITE, id, line: { ...echt, RefLatitude: [v(49), v(27), v(7), v(500000)], RefLongitude: [v(11), v(4), v(36), v(0)], RefElevation: v(309) } }]);
    const g = georefAusModell(a, modelID);
    assert.equal(g.art, "site");
    assert.ok(Math.abs(g.lat - (49 + 27 / 60 + 7.5 / 3600)) < 1e-9);
    assert.ok(Math.abs(g.lng - (11 + 4 / 60 + 36 / 3600)) < 1e-9);
    assert.equal(g.hoehe, 309);
  });
});
