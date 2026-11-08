// Appearance catalogue: the studio reads the harness JSON, it does not keep a copy.
// Parquet and tile resolve to the two vendored colour maps; anything else stays a colour.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  baustoff, bodenBelag, bodenBelaege, wandOberflaechen, rahmenBaustoffe, glasBaustoffe, musterBild,
} from "@core/lib/bauteil/erscheinung.js";

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("Erscheinung aus dem Harness-Katalog", () => {
  it("liest Parkett und Fliese aus der Katalogdatei, nicht aus einer Kopie", () => {
    const datei = JSON.parse(fs.readFileSync(path.join(WURZEL, "harness/harness/bauteilkatalog/daten/baustoffe.json"), "utf8"));
    const parkett = datei.baustoffe.find((b) => b.schluessel === "parkett-350");
    const fliese = datei.baustoffe.find((b) => b.schluessel === "fliesen-anthrazit-350");
    assert.equal(parkett.textur, "ambientcg:Wood051");
    assert.equal(fliese.textur, "ambientcg:Tiles074");
    assert.equal(baustoff("parkett-350").farbe, parkett.farbe);
    assert.equal(baustoff("fliesen-anthrazit-350").name, fliese.name);
    assert.equal(baustoff("gibt-es-nicht"), null);
    assert.equal(baustoff(""), null);
  });

  it("Parkett und Fliese haben eine geprüfte Strukturkarte, andere URNs nicht", () => {
    const parkett = bodenBelag("estrich-parkett-15-cm");
    const fliese = bodenBelag("estrich-fliesen-15-cm");
    assert.equal(parkett.muster, "Wood051");
    assert.equal(fliese.muster, "Tiles074");
    assert.equal(parkett.sicht.schluessel, "parkett-350");
    assert.equal(fliese.sicht.schluessel, "fliesen-anthrazit-350");
    for (const id of ["Wood051", "Tiles074"]) {
      const bild = path.join(WURZEL, "public/erscheinung", `${id}_Color.jpg`);
      const stat = fs.statSync(bild);
      assert.ok(stat.size > 8000, `${id} ist keine flache Platzhalterdatei`);
    }
    assert.equal(musterBild("ambientcg:Plaster001"), null);
    assert.equal(musterBild("klasse:glas"), null);
    assert.equal(bodenBelag("kein-belag"), null);
  });

  it("die Auswahllisten kommen aus dem Katalog und lassen den Standard zu", () => {
    assert.ok(wandOberflaechen().some((s) => s.schluessel === "kalkzementputz-370"));
    assert.equal(wandOberflaechen().some((s) => s.schluessel === "parkett-350"), false);
    assert.ok(wandOberflaechen().every((s) => s.werkstoffklasse !== "glas"));
    assert.ok(rahmenBaustoffe().some((s) => s.schluessel === "aluminium-760"));
    assert.ok(glasBaustoffe().some((s) => s.schluessel === "normalglas-530"));
    const ids = bodenBelaege().map((b) => b.id);
    assert.ok(ids.includes("estrich-parkett-15-cm"));
    assert.ok(ids.includes("estrich-fliesen-15-cm"));
    assert.equal(ids.includes("ks-24-cm-beidseitig-gipsputz"), false);
  });
});
