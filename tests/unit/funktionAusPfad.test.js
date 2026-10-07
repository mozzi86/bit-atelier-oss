// Unit-Tests für die Pfad→Function-Tabelle in supabaseDb.js (57-04 Task 5).
//
// funktionAusPfad ist pure (kein Netz, kein Supabase-Client im Aufrufweg) —
// hier wird die ÜBERSETZUNG der alten Express-Pfade in die drei Edge-Function-
// Aufrufe gemessen: llm (POST-Aktionen), preise (ted-search),
// geo (GET ?dienst=… mit Query-Weitergabe). Dazu: Normalisierung (/api-Präfix,
// volle URL), unbekannte Pfade → null (der Rufer macht daraus den
// Klartext-Fehler „Route im Cloud-Modus nicht verfügbar").
//
// Hinweis: supabaseDb.js importiert statisch supabaseClient.js →
// @supabase/supabase-js. Das ist unter node importierbar (normales npm-Paket);
// der Client wird NIE erzeugt (funktionAusPfad ruft ihn nicht).

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { funktionAusPfad } from "@core/api/supabaseDb";

describe("funktionAusPfad — llm-Routen (routes.js llmRouter)", () => {
  it("POST /integrations/invoke-llm → llm aktion:invoke mit Payload", () => {
    const r = funktionAusPfad("/api/integrations/invoke-llm", {
      method: "POST",
      body: JSON.stringify({ prompt: "Hallo", response_json_schema: { type: "object" } }),
    });
    assert.equal(r.funktion, "llm");
    assert.equal(r.invokeName, "llm");
    assert.deepEqual(r.invokeOptionen.body, {
      aktion: "invoke",
      prompt: "Hallo",
      response_json_schema: { type: "object" },
    });
  });

  it("GET /llm/connections → connections.list", () => {
    const r = funktionAusPfad("/api/llm/connections");
    assert.deepEqual(r.invokeOptionen.body, { aktion: "connections.list" });
  });

  it("POST /llm/connections → connections.create mit Formularfeldern", () => {
    const r = funktionAusPfad("/api/llm/connections", {
      method: "POST",
      body: JSON.stringify({ provider: "anthropic", name: "K", api_key: "sk-x", active: true }),
    });
    assert.equal(r.invokeOptionen.body.aktion, "connections.create");
    assert.equal(r.invokeOptionen.body.provider, "anthropic");
    assert.equal(r.invokeOptionen.body.api_key, "sk-x");
  });

  it("PUT /llm/connections/:id → connections.update mit id aus dem Pfad", () => {
    const r = funktionAusPfad("/api/llm/connections/abc123", {
      method: "PUT",
      body: JSON.stringify({ model: "neu" }),
    });
    assert.equal(r.invokeOptionen.body.aktion, "connections.update");
    assert.equal(r.invokeOptionen.body.id, "abc123");
    assert.equal(r.invokeOptionen.body.model, "neu");
  });

  it("DELETE /llm/connections/:id → connections.delete", () => {
    const r = funktionAusPfad("/api/llm/connections/abc123", { method: "DELETE" });
    assert.deepEqual(r.invokeOptionen.body, { aktion: "connections.delete", id: "abc123" });
  });

  it("POST /llm/test → test", () => {
    const r = funktionAusPfad("/api/llm/test", { method: "POST", body: JSON.stringify({ id: "x" }) });
    assert.deepEqual(r.invokeOptionen.body, { aktion: "test", id: "x" });
  });

  it("GET /llm/defaults → defaults", () => {
    const r = funktionAusPfad("/api/llm/defaults");
    assert.deepEqual(r.invokeOptionen.body, { aktion: "defaults" });
  });

  it("url-codierte Connection-id wird dekodiert", () => {
    const r = funktionAusPfad("/api/llm/connections/a%2Fb", { method: "DELETE" });
    assert.equal(r.invokeOptionen.body.id, "a/b");
  });
});

describe("funktionAusPfad — preise-Routen (pricesRouter)", () => {
  it("POST /prices/ted-search → preise aktion:ted-search mit Query-Feldern", () => {
    const r = funktionAusPfad("/api/prices/ted-search", {
      method: "POST",
      body: JSON.stringify({ query: "Bau", page: 2, limit: 250 }),
    });
    assert.equal(r.funktion, "preise");
    assert.deepEqual(r.invokeOptionen.body, { aktion: "ted-search", query: "Bau", page: 2, limit: 250 });
  });

});

describe("funktionAusPfad — geo-Routen (GET mit Query)", () => {
  it("/weather?lat&lng → geo?dienst=weather mit allen Parametern", () => {
    const r = funktionAusPfad("/api/weather?lat=49.5&lng=11.0");
    assert.equal(r.funktion, "geo");
    assert.equal(r.invokeOptionen.method, "GET");
    // functions.invoke baut `${functionsUrl}/${name}` — die Query reitet im
    // Namen mit; dienst wird ergänzt, die Rest-Parameter bleiben erhalten.
    const q = new URLSearchParams(r.invokeName.split("?")[1]);
    assert.equal(q.get("dienst"), "weather");
    assert.equal(q.get("lat"), "49.5");
    assert.equal(q.get("lng"), "11.0");
  });

  it("alle fünf Dienste landen auf geo", () => {
    for (const d of ["weather", "elevation", "climate", "osm-buildings", "osm-environment"]) {
      const r = funktionAusPfad(`/api/${d}?lat=1&lng=2`);
      assert.equal(r?.funktion, "geo", `${d} fehlt in der Tabelle`);
      const q = new URLSearchParams(r.invokeName.split("?")[1]);
      assert.equal(q.get("dienst"), d);
    }
  });

  it("Komma-Listen (Elevation-Grid) überleben die URLSearchParams-Runde", () => {
    const r = funktionAusPfad("/api/elevation?lat=49.1,49.2&lng=11.1,11.2");
    const q = new URLSearchParams(r.invokeName.split("?")[1]);
    assert.equal(q.get("lat"), "49.1,49.2");
  });

  it("ein bereits gesetzter dienst-Parameter wird nicht verdoppelt", () => {
    const r = funktionAusPfad("/api/weather?dienst=weather&lat=1");
    const q = new URLSearchParams(r.invokeName.split("?")[1]);
    assert.equal(q.getAll("dienst").length, 1);
  });
});

describe("funktionAusPfad — Normalisierung und unbekannte Pfade", () => {
  it("/api-Präfix, kein Präfix und volle URL sind gleichwertig", () => {
    const a = funktionAusPfad("/api/llm/defaults");
    const b = funktionAusPfad("/llm/defaults");
    const c = funktionAusPfad("https://app.bit-atelier.de/api/llm/defaults");
    assert.deepEqual(a.invokeOptionen, b.invokeOptionen);
    assert.deepEqual(a.invokeOptionen, c.invokeOptionen);
  });

  it("Methode ist Teil der Route: GET /llm/connections ≠ POST", () => {
    assert.equal(funktionAusPfad("/api/llm/connections", { method: "GET" }).invokeOptionen.body.aktion, "connections.list");
    assert.equal(funktionAusPfad("/api/llm/connections", { method: "POST" }).invokeOptionen.body.aktion, "connections.create");
  });

  it("archicad/status hat KEINE Cloud-Route (bleibt lokal, Task 3)", () => {
    assert.equal(funktionAusPfad("/api/archicad/status?port=19723"), null);
  });

  it("Entity-/Blob-/Auth-Pfade sind keine Integrations-Routen → null", () => {
    assert.equal(funktionAusPfad("/api/entities/Project"), null);
    assert.equal(funktionAusPfad("/api/blobs/x"), null);
    assert.equal(funktionAusPfad("/api/auth/me"), null);
    assert.equal(funktionAusPfad("/api/catalogs"), null);
  });

  it("unbekannter Geo-artiger Pfad → null (Klartext-Fehler beim Rufer)", () => {
    assert.equal(funktionAusPfad("/api/wetter"), null);
    assert.equal(funktionAusPfad("/api/osm-buildings", { method: "POST" }), null);
  });

  it("kaputter JSON-Body wirft nicht — er wird ignoriert (leeres Objekt)", () => {
    const r = funktionAusPfad("/api/llm/test", { method: "POST", body: "{kaputt" });
    assert.deepEqual(r.invokeOptionen.body, { aktion: "test" });
  });
});
