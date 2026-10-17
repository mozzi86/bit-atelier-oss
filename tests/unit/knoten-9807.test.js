// 98-07: parametric node graph — typed ports, topological evaluation, errors stay at the node,
// cycles detected, attractor heights, starter graph yields bodies.
import { test } from "node:test";
import assert from "node:assert/strict";
import { KNOTEN_TYPEN, auswerten, passt, beispielGraph } from "@core/lib/massing/knoten.js";

test("Beispielgraph: 3 × 2 Raster, Höhen vom Attraktor (am Punkt am höchsten)", () => {
  const r = auswerten(beispielGraph({ x: 50, y: 40 }));
  assert.equal(r.fehler.size, 0, [...r.fehler.values()].join());
  assert.equal(r.koerper.length, 6);
  assert.equal(r.koerper[0].hoehe, Math.max(...r.koerper.map((k) => k.hoehe)), "nächster am Attraktor = höchster");
  assert.ok(r.koerper.every((k) => k.hoehe >= 6 && k.hoehe <= 24));
});

test("Fehler bleiben am Knoten, Folgeknoten melden 'Eingang fehlt', Zyklus erkannt", () => {
  const g = { knoten: [{ id: "a", typ: "rechteck", werte: { breite: -1 } }, { id: "b", typ: "reihe" }, { id: "c", typ: "extrudieren" }],
    kanten: [{ von: "a", aus: "profil", nach: "b", ein: "profil" }, { von: "b", aus: "profile", nach: "c", ein: "profile" }] };
  const r = auswerten(g);
  assert.match(r.fehler.get("a"), /> 0/);
  assert.match(r.fehler.get("b"), /Eingang fehlt/);
  assert.equal(r.koerper.length, 0);
  const z = auswerten({ knoten: [{ id: "x", typ: "reihe" }, { id: "y", typ: "reihe" }], kanten: [{ von: "x", aus: "profile", nach: "y", ein: "profil" }, { von: "y", aus: "profile", nach: "x", ein: "profil" }] });
  assert.match(z.fehler.get("x"), /Zyklus/);
});

test("Typen: Profil passt in Profile, Zahl in Liste; Höhenliste nach Index, letzte wiederholt", () => {
  assert.ok(passt("profil", "profile") && passt("zahl", "liste") && !passt("liste", "profil"));
  const g = { knoten: [{ id: "a", typ: "rechteck" }, { id: "b", typ: "reihe", werte: { anzahl: 3 } }, { id: "h", typ: "hoehenreihe", werte: { start: 3, schritt: 3, anzahl: 2 } }, { id: "c", typ: "extrudieren" }],
    kanten: [{ von: "a", aus: "profil", nach: "b", ein: "profil" }, { von: "b", aus: "profile", nach: "c", ein: "profile" }, { von: "h", aus: "liste", nach: "c", ein: "hoehe" }] };
  assert.deepEqual(auswerten(g).koerper.map((k) => k.hoehe), [3, 6, 6]);
  for (const [k, t] of Object.entries(KNOTEN_TYPEN)) assert.ok(t.label && Array.isArray(t.ein) && Array.isArray(t.aus), k);
});
