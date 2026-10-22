// B-103-02: bars and perimeter blocks (complexData.riegel) stand on the terrain and count in the flood
// order — one body per straight path segment, band width as riegelLayout (corridor + unit depth).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { riegelKoerper, baukoerperListe, demRaster, flutReihenfolge } from "@designer/lib/gelaendeStudie";

const CD = (riegel) => ({ site_parcel: { m_per_px: 1 }, riegel, buildings: [] });
const breiteZ = (k) => Math.max(...k.ecken.map((p) => p.z)) - Math.min(...k.ecken.map((p) => p.z));

describe("B-103-02 Riegel im Gelände", () => {
  it("gerader Mittelflur-Riegel 40 m: ein Körper, Breite 2·(0,8 + 7) = 15,6 m, 5 Geschosse", () => {
    const [k, ...rest] = riegelKoerper(CD([{ punkte: [{ x: 580, y: 400 }, { x: 620, y: 400 }] }]), 3);
    assert.equal(rest.length, 0);
    assert.ok(Math.abs(breiteZ(k) - 15.6) < 1e-9, String(breiteZ(k)));
    assert.equal(k.geschosse, 5);
    assert.equal(k.geschossHoeheM, 3);
  });

  it("einhüftig: Breite Flur 1,6 + Tiefe 7 = 8,6 m", () => {
    const [k] = riegelKoerper(CD([{ punkte: [{ x: 580, y: 400 }, { x: 620, y: 400 }], opt: { art: "einhueftig", geschosse: 3 } }]), 3);
    assert.ok(Math.abs(breiteZ(k) - 8.6) < 1e-9, String(breiteZ(k)));
    assert.equal(k.geschosse, 3);
  });

  it("L-Pfad: zwei Abschnitte; Blockrand aus 4 Punkten: vier Abschnitte", () => {
    assert.equal(riegelKoerper(CD([{ punkte: [{ x: 560, y: 380 }, { x: 640, y: 380 }, { x: 640, y: 440 }] }]), 3).length, 2);
    assert.equal(riegelKoerper(CD([{ geschlossen: true, punkte: [{ x: 560, y: 360 }, { x: 640, y: 360 }, { x: 640, y: 440 }, { x: 560, y: 440 }] }]), 3).length, 4);
  });

  it("baukoerperListe enthält die Riegel; Flutreihenfolge kennt sie", () => {
    const cd = CD([{ punkte: [{ x: 580, y: 400 }, { x: 620, y: 400 }] }]);
    const liste = baukoerperListe(cd);
    assert.equal(liste.length, 1);
    assert.match(liste[0].name, /^Riegel 1/);
    const r = demRaster([[100, 100, 100], [100, 100, 100], [100, 100, 100]], 200);
    const reihe = flutReihenfolge(r, { baukoerper: liste });
    assert.ok(reihe.some((e) => String(e.name || e.label || "").startsWith("Riegel 1") || e.id === liste[0].id), JSON.stringify(reihe).slice(0, 300));
  });

  it("kaputter Riegel (1 Punkt) wird übergangen", () => {
    assert.deepEqual(riegelKoerper(CD([{ punkte: [{ x: 1, y: 1 }] }]), 3), []);
  });
});
