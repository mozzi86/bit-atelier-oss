import test from "node:test";
import assert from "node:assert/strict";
import { dokumentAblegen, pfadText } from "@core/lib/ablage";

// Test-API: merkt sich, was angelegt wurde — kein Server, keine DB.
function fakeApi({ ordner = [], fehler = null } = {}) {
  const angelegteOrdner = [];
  const angelegteDokumente = [];
  let n = 0;
  return {
    angelegteOrdner,
    angelegteDokumente,
    entities: {
      ProjectFolder: {
        filter: async () => {
          if (fehler === "filter") throw new Error("DB weg");
          return ordner;
        },
        create: async (daten) => {
          if (fehler === "createFolder") throw new Error("Ordner-Anlage fehlgeschlagen");
          const neu = { ...daten, id: `f${++n}` };
          angelegteOrdner.push(neu);
          ordner.push(neu);
          return neu;
        },
      },
      Document: {
        create: async (daten) => {
          if (fehler === "createDoc") throw new Error("Dokument-Anlage fehlgeschlagen");
          const neu = { ...daten, id: `d${++n}` };
          angelegteDokumente.push(neu);
          return neu;
        },
      },
    },
  };
}

test("dokumentAblegen — Fachplanung landet in ihrer Disziplin, Ordner entstehen", async () => {
  const api = fakeApi();
  const r = await dokumentAblegen(
    { projectId: "p1", name: "Brandschutzkonzept.pdf", typ: "Brandschutz" }, api,
  );
  assert.equal(r.ok, true);
  assert.deepEqual(r.pfad, ["03_Fachplanung", "Brandschutz"]);
  assert.deepEqual(r.angelegt, ["03_Fachplanung", "Brandschutz"], "beide Ebenen neu");
  assert.equal(api.angelegteDokumente[0].folder_id, api.angelegteOrdner[1].id);
  assert.equal(api.angelegteDokumente[0].type, "Brandschutz");
});

test("dokumentAblegen — vorhandene Ordner werden wiederverwendet, nicht dupliziert", async () => {
  const api = fakeApi({ ordner: [{ id: "vorhanden", name: "03_Fachplanung", parent_id: null }] });
  const r = await dokumentAblegen(
    { projectId: "p1", name: "Schallschutz.pdf", typ: "Schallschutz" }, api,
  );
  assert.deepEqual(r.angelegt, ["Schallschutz"], "der Hauptordner existierte schon");
  assert.equal(api.angelegteOrdner.length, 1);
  assert.equal(api.angelegteOrdner[0].parent_id, "vorhanden");
});

test("dokumentAblegen — der Designer-Reiter ist der zweite Zugang zur selben Regel", async () => {
  const api = fakeApi();
  const r = await dokumentAblegen(
    { projectId: "p1", name: "Akustik.pdf", reiter: "acoustics" }, api,
  );
  assert.deepEqual(r.pfad, ["03_Fachplanung", "Schallschutz"]);
});

test("dokumentAblegen — `typ` hat Vorrang vor `reiter`", async () => {
  const api = fakeApi();
  const r = await dokumentAblegen(
    { projectId: "p1", name: "x.pdf", typ: "Plan-PDF", reiter: "brandschutz" }, api,
  );
  assert.deepEqual(r.pfad, ["04_Zeichnungen", "Aktuell"]);
});

test("dokumentAblegen — unbekannter Typ landet in der Projektwurzel, nicht im Nirgendwo", async () => {
  const api = fakeApi();
  const r = await dokumentAblegen({ projectId: "p1", name: "x.pdf", typ: "gibt-es-nicht" }, api);
  assert.equal(r.ok, true);
  assert.deepEqual(r.pfad, []);
  assert.equal(api.angelegteDokumente[0].folder_id, null);
  assert.equal(api.angelegteOrdner.length, 0, "kein Ordner auf Verdacht");
});

test("dokumentAblegen — ohne Projekt oder Namen wird nichts angelegt", async () => {
  const api = fakeApi();
  assert.equal((await dokumentAblegen({ name: "x.pdf" }, api)).ok, false);
  assert.equal((await dokumentAblegen({ projectId: "p1" }, api)).ok, false);
  assert.equal(api.angelegteDokumente.length, 0);
});

test("dokumentAblegen — Fehler kippen den Export nicht, sondern melden sich", async () => {
  // Das PDF liegt beim Nutzer; nur der Nachweis fehlt. Kein Wurf nach oben.
  for (const fehler of ["filter", "createFolder", "createDoc"]) {
    const r = await dokumentAblegen(
      { projectId: "p1", name: "x.pdf", typ: "Bericht" }, fakeApi({ fehler }),
    );
    assert.equal(r.ok, false, `Fehler „${fehler}" wird gemeldet`);
    assert.ok(r.grund, "mit Begründung");
  }
});

test("pfadText — lesbarer Ablageort, auch für die Wurzel", () => {
  assert.equal(pfadText(["03_Fachplanung", "Brandschutz"]), "03_Fachplanung / Brandschutz");
  assert.equal(pfadText([]), "Projektwurzel");
  assert.equal(pfadText(undefined), "Projektwurzel");
});
