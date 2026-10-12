// 89-07 (BW-09, D-BW-05) part 2: one door system and the workshop components derived on load.
//
// Door system: the zone door IS the door component — one geometry (@core tuerLage, the designer's
// tuerGeometrie delegates), one GUID (same key as the swing override), and the focus furniture reads
// the component's swing (checks, movement-area count, auto-furnishing, catalogue without doors).
// Derivation: the AVA gets the workshop components from the saved record (werkstatt_layer +
// building programme) without a workshop session — deterministic, nothing stored twice.
//
// In: the 70 × 16 test house of 89-02 (tesseliere, mittelflur, three standard types).
// Out: assertions only.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { werkstattTueren, tuerLage, tuerGuid, tuerSchluessel, werkstattBauteile, stabileGuid } from "@core/lib/werkstattBauteile";
import {
  registriereWerkstattAbleitung, hatWerkstattAbleitung, programmAusDatensatz, werkstattZonenAusDatensatz, ableitungsSignatur,
} from "@core/lib/werkstattAbleitung";
import { classifiedElements } from "@core/lib/bimClassification";
import { tesseliere, TUERBREITEN } from "@designer/lib/tesselierung";
import { tuerGeometrie } from "@designer/lib/wohnungsErschliessung";
import { werkstattZonenAusLayer } from "@designer/lib/useWerkstattRehydrate";
import { WERKSTATT_DEFAULT } from "@designer/lib/werkstattDefaults";
import { WERKSTATT_TYPEN } from "@designer/lib/wohnungsTypen";
import {
  bauteilTuerAufschlag, bauteilTuerenFuerZone, wohnMoebelChecks, autoMoeblierung, fokusKatalog, bewegungsNachweis,
  BAUTEIL_TUER_TEXTE, rechteckTrifftAufschlag,
} from "@designer/lib/wohnMoebel";
import { itemRect } from "@designer/lib/moebel";

const STD = WERKSTATT_TYPEN.filter((t) => t.gruppe === "standard").slice(0, 3);
const FP = [{ x: -35, z: -8 }, { x: 35, z: -8 }, { x: 35, z: 8 }, { x: -35, z: 8 }];
const ZONEN = tesseliere({ footprintM: FP, storeys: 1, typ: "mittelflur", einheiten: STD, raumzonen: true }).zonen;
const WE = ZONEN.find((z) => z.we)?.we;
const WE_ZONEN = ZONEN.filter((z) => z.we === WE && z.raumart !== "balkon");

describe("89-07 — ein Türsystem: Zonentür = Tür-Bauteil", () => {
  it("eine Geometrie: tuerGeometrie (Plansymbol) ist tuerLage des Bauteils, Feld für Feld", () => {
    let n = 0;
    for (const z of ZONEN) {
      (z.tueren || []).forEach((t) => {
        assert.deepEqual(tuerGeometrie(z, t), tuerLage(z, t, TUERBREITEN.zimmer));
        n += 1;
      });
    }
    assert.ok(n > 50, `Türen geprüft: ${n}`);
  });

  it("eine GUID: Plansymbol-Schlüssel = Aufschlag-Schlüssel = Bauteil-GUID (seit 89-02 unverändert)", () => {
    const tb = werkstattTueren(ZONEN);
    for (const t of tb) {
      const z = ZONEN.find((x) => x.name === t.zone);
      const idx = Number(t.schluessel.split("|").pop());
      assert.equal(t.schluessel, `${Math.round(z.level ?? 0)}|${z.name}|${idx}`, "Schlüssel wie werkstatt_layer.tuerAufschlaege");
      assert.equal(t.guid, tuerGuid(z.level, z.name, idx));
      assert.equal(t.guid, stabileGuid(`tuer|${tuerSchluessel(z.level, z.name, idx)}`));
    }
    assert.equal(new Set(tb.map((t) => t.guid)).size, tb.length, "eindeutig");
  });

  it("das Bauteil trägt den Aufschlag des Plansymbols (Scharnier, offenes Blattende, Normale)", () => {
    for (const t of werkstattTueren(WE_ZONEN)) {
      const z = WE_ZONEN.find((x) => x.name === t.zone);
      const rec = z.tueren[Number(t.schluessel.split("|").pop())];
      const g = tuerGeometrie(z, rec);
      assert.ok(Math.abs(t.schwenk.scharnier.x - g.scharnier.x) < 1e-3 && Math.abs(t.schwenk.scharnier.z - g.scharnier.z) < 1e-3);
      assert.ok(Math.abs(t.schwenk.offen.x - g.offen.x) < 1e-3 && Math.abs(t.schwenk.offen.z - g.offen.z) < 1e-3);
      assert.equal(t.aufschlag, rec.aufschlag === "rechts" ? "rechts" : "links");
      assert.equal(t.nachAussen, rec.nachAussen === true);
    }
  });

  it("Aufschlag-Zuordnung: Zimmertür schwenkt in ihr Zimmer, Badtür (nachAussen) in die Diele", () => {
    const tb = werkstattTueren(WE_ZONEN);
    const bad = tb.find((t) => t.nachAussen);
    const zimmer = tb.find((t) => !t.nachAussen && t.nach);
    assert.ok(bad && zimmer, "Bad- und Zimmertür vorhanden");
    const diele = WE_ZONEN.find((z) => z.name === bad.nach);
    const badZone = WE_ZONEN.find((z) => z.name === bad.zone);
    assert.ok(bauteilTuerenFuerZone(diele, [bad]).length === 1, "Badtür schwenkt in die Diele");
    assert.equal(bauteilTuerenFuerZone(badZone, [bad]).length, 0, "nicht ins Bad");
    const zz = WE_ZONEN.find((z) => z.name === zimmer.zone);
    assert.equal(bauteilTuerenFuerZone(zz, [zimmer]).length, 1, "Zimmertür ins Zimmer");
  });

  it("Möbel lesen den Bauteil-Aufschlag: Möbel im Schwenkbereich → Warnung; ohne Option wie vorher", () => {
    const tb = werkstattTueren(WE_ZONEN);
    const t = tb.find((x) => !x.nachAussen && x.nach);
    const zone = WE_ZONEN.find((z) => z.name === t.zone);
    const a = bauteilTuerAufschlag(t);
    // A night table right in the swing (centre = swing point `mitte`).
    const item = { id: "n1", typ: "nachttisch", x: a.mitte.x, y: a.mitte.y, rot: 0 };
    assert.ok(rechteckTrifftAufschlag(itemRect(item), a));
    const tueren = bauteilTuerenFuerZone(zone, tb);
    const mit = wohnMoebelChecks([item], zone.points, "standard", { tueren });
    assert.ok(mit.some((w) => w.art === "bauteil_tuer_moebel" && w.tuerGuid === t.guid && w.text === BAUTEIL_TUER_TEXTE.moebel));
    const ohne = wohnMoebelChecks([item], zone.points, "standard");
    assert.deepEqual(ohne, wohnMoebelChecks([item], zone.points, "standard", {}), "Default = altes Verhalten");
    assert.ok(!ohne.some((w) => w.art.startsWith("bauteil_")));
  });

  it("Bewegungsnachweis zählt Bänder, die ein Bauteil-Aufschlag schneidet (alte Auto-Möblierung)", () => {
    const tb = werkstattTueren(ZONEN);
    let mehr = 0;
    for (const z of ZONEN.filter((x) => x.we && x.raumart !== "balkon")) {
      const tueren = bauteilTuerenFuerZone(z, tb);
      const items = autoMoeblierung(z, { personen: 3 }).items; // placed WITHOUT reading the doors
      const ohne = bewegungsNachweis([{ zone: z, items }], "standard");
      const mit = bewegungsNachweis([{ zone: z, items, tueren }], "standard");
      assert.equal(mit.anzahl, ohne.anzahl);
      assert.ok(mit.konflikte.length >= ohne.konflikte.length);
      if (mit.konflikte.length > ohne.konflikte.length) {
        mehr += 1;
        assert.ok(mit.konflikte.some((k) => k.text === BAUTEIL_TUER_TEXTE.bewegung));
      }
    }
    assert.ok(mehr > 0, "mindestens ein Raum, in dem die Tür ein Band schneidet");
  });

  it("Katalogtür in einer Bauteil-Wohnung = zweites Türsystem → Warnung „doppelt“, nie still gelöscht", () => {
    const zone = WE_ZONEN.find((z) => z.art === "aufenthalt") || WE_ZONEN[0];
    const tuer = { id: "alt-1", typ: "tuer_885", x: zone.points[0].x + 1, y: zone.points[0].z, rot: 0, aufschlag: "links" };
    const w = wohnMoebelChecks([tuer], zone.points, "standard", { mitBauteilTueren: true });
    assert.ok(w.some((x) => x.art === "tuer_doppelt" && x.itemId === "alt-1"));
    assert.ok(!wohnMoebelChecks([tuer], zone.points, "standard").some((x) => x.art === "tuer_doppelt"));
  });

  it("Auto-Möblierung weicht den Bauteil-Aufschlägen aus: 0 Bauteil-Warnungen; ohne Option byte-gleich", () => {
    let warn = 0, items = 0;
    const tb = werkstattTueren(WE_ZONEN);
    for (const z of WE_ZONEN) {
      const tueren = bauteilTuerenFuerZone(z, tb);
      const r = autoMoeblierung(z, { personen: 3, tueren });
      items += r.items.length;
      warn += wohnMoebelChecks(r.items, z.points, "standard", { tueren }).filter((x) => x.art.startsWith("bauteil_")).length;
      assert.deepEqual(autoMoeblierung(z, { personen: 3 }), autoMoeblierung(z, { personen: 3, tueren: [] }));
    }
    assert.equal(warn, 0);
    assert.ok(items > 0, "Wohnung wird möbliert");
  });

  it("Fokus-Katalog ohne Türen, wenn die Türen Bauteile sind; Default unverändert", () => {
    const ids = (k) => k.flatMap((g) => g.typen.map((t) => t.id));
    assert.ok(ids(fokusKatalog([])).includes("tuer_885"));
    assert.deepEqual(fokusKatalog([]), fokusKatalog([], {}));
    const ohne = ids(fokusKatalog([], { ohneTueren: true }));
    assert.ok(!ohne.includes("tuer_885") && !ohne.includes("tuer_1010") && ohne.includes("doppelbett"));
  });
});

describe("89-07 — Werkstatt-Bauteile aus dem gespeicherten Datensatz (D-BW-05: ableiten statt doppelt speichern)", () => {
  const layer = { ...WERKSTATT_DEFAULT, einheiten: STD, angewendet: true, updatedAt: "2026-10-12T10:00:00.000Z" };
  const datensatz = { footprintM: FP, storeys: 2, storeyHeight: 3, werkstatt_layer: layer };

  it("Programm mit denselben Defaults wie useBimModelSync (4 Geschosse, 3 m, Achse erst ab 2 Punkten)", () => {
    assert.deepEqual(programmAusDatensatz({}), { footprintM: null, storeys: 4, storeyHeight: 3, achseM: null });
    assert.equal(programmAusDatensatz({ achseM: [{ x: 0, z: 0 }] }).achseM, null);
  });

  it("deterministisch: Datensatz → dieselben Zonen wie die Werkstatt-Ableitung, dieselben GUIDs bei jedem Laden", () => {
    const a = werkstattZonenAusDatensatz(datensatz, werkstattZonenAusLayer);
    const b = werkstattZonenAusDatensatz(JSON.parse(JSON.stringify(datensatz)), werkstattZonenAusLayer);
    assert.ok(a.length > 50);
    assert.deepEqual(a, werkstattZonenAusLayer(layer, programmAusDatensatz(datensatz)));
    const ga = werkstattBauteile(a, { storeyHeight: 3 }), gb = werkstattBauteile(b, { storeyHeight: 3 });
    assert.deepEqual([...ga.waende, ...ga.tueren, ...ga.raeume].map((x) => x.guid), [...gb.waende, ...gb.tueren, ...gb.raeume].map((x) => x.guid));
  });

  it("nichts angewendet, kein Grundriss oder keine Ableitung registriert → keine Zonen", () => {
    assert.deepEqual(werkstattZonenAusDatensatz({ ...datensatz, werkstatt_layer: { ...layer, angewendet: false } }, werkstattZonenAusLayer), []);
    assert.deepEqual(werkstattZonenAusDatensatz({ ...datensatz, footprintM: null }, werkstattZonenAusLayer), []);
    assert.deepEqual(werkstattZonenAusDatensatz(datensatz, null), []);
    assert.deepEqual(werkstattZonenAusDatensatz(null, werkstattZonenAusLayer), []);
  });

  it("Signatur ignoriert den Speicher-Stempel (updatedAt), reagiert auf Layer und Programm", () => {
    const s0 = ableitungsSignatur(datensatz);
    assert.equal(s0, ableitungsSignatur({ ...datensatz, werkstatt_layer: { ...layer, updatedAt: "2026-10-12T11:00:00.000Z" } }));
    assert.notEqual(s0, ableitungsSignatur({ ...datensatz, storeys: 3 }));
    assert.notEqual(s0, ableitungsSignatur({ ...datensatz, werkstatt_layer: { ...layer, typ: "laubengang" } }));
  });

  it("AVA: abgeleitete Zonen ergeben dieselben klassifizierten Elemente wie die Sitzungs-Zonen", () => {
    const abgeleitet = werkstattZonenAusDatensatz(datensatz, werkstattZonenAusLayer);
    const sitzung = werkstattZonenAusLayer(layer, { footprintM: FP, storeys: 2, storeyHeight: 3, achseM: null });
    const m = { storeyHeight: 3 };
    const e1 = classifiedElements(m, null, { werkstattZonen: abgeleitet });
    const e2 = classifiedElements(m, null, { werkstattZonen: sitzung });
    assert.deepEqual(e1, e2);
    assert.ok(e1.filter((e) => String(e.id).startsWith("wt-wall-")).length > 20);
    assert.ok(e1.filter((e) => String(e.id).startsWith("wt-door-")).length > 20);
  });

  it("Registrierung: ohne Ableitung (Spiegel ohne Designer) bleibt der Sitzungsweg, mit ihr wird abgeleitet", async () => {
    const abmelden = registriereWerkstattAbleitung(async () => werkstattZonenAusLayer);
    assert.equal(hatWerkstattAbleitung(), true);
    abmelden();
    assert.equal(hatWerkstattAbleitung(), false);
  });
});
