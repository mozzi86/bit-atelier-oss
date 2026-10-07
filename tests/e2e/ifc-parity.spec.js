import fs from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";

/**
 * IFC-Parität, BROWSER-Pfad (Phase 33 / W2).
 *
 * ARBEITSTEILUNG — bitte vor dem Ändern lesen:
 *
 *   Die INHALTLICHE Parität auf allen **6038** Bauteilen des Referenzprojekts
 *   prüfen `parity/g5-elementwahrheit.test.mjs` und `parity/g6-mengen-nativ.test.mjs`
 *   im normalen `npm run parity`. Das ist möglich, weil `web-ifc` einen Node-Build
 *   mitbringt (`web-ifc-api-node.js` + `web-ifc-node.wasm`) und das 233-MB-IFC dort in
 *   ~1,6 s öffnet. Der Planentwurf hatte angenommen, WASM zwinge zu Playwright — das ist
 *   gemessen falsch; erzwungen hatte es allein der Vite-`?url`-Import im Modulkopf, der
 *   jetzt in `ifcWasm.js` liegt und dynamisch geladen wird.
 *
 *   DIESE Spec prüft genau das, was nur der Browser beweisen kann: dass der Vite-Pfad
 *   (WASM-Asset-URL, Alias-Auflösung, dynamischer Import) trägt und `parseIfcFile`
 *   dieselbe Elementwahrheit liefert. Grundlage ist ein kleines, im Repo liegendes
 *   IFC (`fixtures/mini.ifc`) — das Realprojekt-IFC gehört nicht ins Repo und 233 MB
 *   durch einen Browser zu schieben würde nichts zusätzlich beweisen.
 */

const MINI = fs.readFileSync(path.join(import.meta.dirname, "fixtures/mini.ifc"), "latin1");

// Vite serviert die Quellmodule im Dev-Server unter ihrem Pfad — inklusive @core-Aliasen.
const MODUL = "/packages/nova-ifc-viewer/src/lib/ifcImport.js";

async function extrahiere(page) {
  await page.goto("/");
  return page.evaluate(
    async ([modul, ifcText]) => {
      const { parseIfcFile } = await import(/* @vite-ignore */ modul);
      const bytes = new Uint8Array(ifcText.length);
      for (let i = 0; i < ifcText.length; i++) bytes[i] = ifcText.charCodeAt(i) & 0xff;
      const res = await parseIfcFile(bytes.buffer);
      // Nur Klardaten zurückgeben (die Psets enthalten keine Funktionen, sind aber groß).
      return {
        schema: res.schema,
        storeys: res.storeys,
        kennzahlen: res.kennzahlen,
        warnungen: res.warnungen,
        elements: res.elements.map((e) => ({
          id: e.id, guid: e.guid, ifc_klasse: e.ifc_klasse, name: e.name,
          geschoss: e.geschoss, material_layerset: e.material_layerset,
          material_layers: e.material_layers, classifications: e.classifications,
          status: e.status, qty: e.qty, mengen: e.mengen,
        })),
      };
    },
    [MODUL, MINI],
  );
}

test("web-ifc lädt im Browser und liefert die Elementwahrheit (L1–L10)", async ({ page }) => {
  const fehler = [];
  page.on("pageerror", (e) => fehler.push(String(e)));

  const res = await extrahiere(page);

  expect(res.schema).toBe("IFC4");
  expect(res.elements).toHaveLength(3);
  expect(res.storeys).toEqual(["EG"]);

  const wand = res.elements.find((e) => e.name === "Wand-Abbruch");
  const ohne = res.elements.find((e) => e.name === "Wand-ohne-Status");
  const raum = res.elements.find((e) => e.ifc_klasse === "IfcSpace");

  // L1: GlobalId ist die Identität — nicht die expressId.
  expect(wand.id).toBe("0WALL000000000000001");
  expect(wand.guid).toBe(wand.id);

  // L3: benannte BaseQuantities, Net ≠ Gross bleibt unterscheidbar.
  expect(wand.qty).toEqual({ NetSideArea: 12.5, GrossSideArea: 14.75, NetVolume: 3 });

  // L3 + L9: NetFloorArea wird NICHT verworfen und landet in der Alias-Projektion.
  expect(raum.qty.NetFloorArea).toBe(23.4567);
  expect(raum.mengen.area).toBe(23.4567);

  // L5: LayerSetName und Schichten mit Dicke.
  expect(wand.material_layerset).toBe("Bestand_Wand_24");
  expect(wand.material_layers).toEqual([{ name: "Beton", dicke: 0.24 }]);

  // L6: ALLE Klassifikationen, nicht nur die erste.
  expect(wand.classifications).toEqual(["10 Wand innen", "tragend"]);

  // L7: der Raum hängt über IFCRELAGGREGATES am Geschoss.
  expect(raum.geschoss).toBe("EG");

  // L8: kein Default — und die Warnung ist wirklich da.
  expect(wand.status).toBe("abbruch");
  expect(ohne.status).toBeNull();
  expect(res.kennzahlen.ohne_status).toBe(2);
  expect(res.kennzahlen.status.neubau).toBe(0);
  expect(res.warnungen.some((w) => /Umbau-Status nicht belegt/.test(w))).toBe(true);

  expect(fehler, `Seitenfehler:\n${fehler.join("\n")}`).toEqual([]);
});

test("der IFC-Import-Reiter nimmt .ifc-Dateien an und zeigt die Zustandszahlen", async ({ page }) => {
  const fehler = [];
  page.on("pageerror", (e) => fehler.push(String(e)));

  await page.goto("/AVA");
  const karte = page.getByText(/IFC-Import \(web-ifc\)/i).first();
  await expect(karte).toBeVisible({ timeout: 20_000 });

  const input = page.locator('input[type="file"][accept*=".ifc"]').first();
  await input.setInputFiles(path.join(import.meta.dirname, "fixtures/mini.ifc"));

  await expect(page.getByText(/3 Bauteile gelesen/)).toBeVisible({ timeout: 60_000 });
  // Bauteile ohne Umbau-Status müssen SICHTBAR sein, nicht still als Neubau zählen.
  await expect(page.getByText(/ohne Status · 2/)).toBeVisible();
  await expect(page.getByText(/Neubau · 0/)).toBeVisible();

  expect(fehler, `Seitenfehler:\n${fehler.join("\n")}`).toEqual([]);
});
