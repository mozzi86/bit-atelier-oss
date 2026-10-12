// Unit tests for 78-12 part 2 (KI ohne Leck): the project context of a model call is built on the server from
// exactly one project. Covers the recipes (pure), a sloppy source that returns rows of another project, the
// error statuses, the local invoke-llm route end to end on a real express app with a temp JSON db (offline
// mock echoes the prompt), and the byte copy for the Edge Function.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  projektKontext, mitProjektKontext, KONTEXT_REZEPTE, KONTEXT_KOPF, ENERGIE_HINWEIS, KontextFehler,
} from "../../packages/nova-core/server/llmKontext.js";
import { createDb } from "../../packages/nova-core/server/db.js";
import { llmRouter, lokaleKontextQuelle } from "../../packages/nova-core/server/routes.js";

const JETZT = Date.parse("2026-10-12T00:00:00Z");

/** In-memory source; `schlampig` returns every row regardless of project (simulates a broken adapter). */
function quelleAus(tabellen, { schlampig = false } = {}) {
  const gelesen = [];
  return {
    gelesen,
    projekt: async (id) => (tabellen.Project || []).find((p) => p.id === id) || null,
    liste: async (entity, projektId) => {
      gelesen.push([entity, projektId]);
      const alle = tabellen[entity] || [];
      return schlampig ? alle : alle.filter((r) => r.project_id === projektId);
    },
  };
}

const TABELLEN = {
  Project: [
    { id: "P1", name: "Testhaus Nord", client: "Bauherr A", status: "design", building_area: 1200 },
    { id: "P2", name: "Testhaus Süd", client: "Bauherr B" },
  ],
  Issue: [
    { project_id: "P1", title: "Kollision Lüftung", priority: "high", status: "open" },
    { project_id: "P1", title: "erledigt", priority: "low", status: "closed" },
    { project_id: "P2", title: "GEHEIM aus Süd", priority: "critical", status: "open" },
  ],
  LVPosition: [
    { project_id: "P1", quantity: 10, unit_price: 25 },
    { project_id: "P2", quantity: 1000, unit_price: 1000 },
  ],
  ScheduleTask: [{ project_id: "P1", end_date: "2026-01-01", progress: 40 }],
  EnergyScenario: [{ project_id: "P1", geg_compliance: { passes_geg: true, compliance_factor: 0.9 } }],
  Tender: [], Bid: [],
};

describe("78-12 project context from exactly one project", () => {
  it("projektAudit counts only the named project, ticket titles go to daten, energy is a screening", async () => {
    const q = quelleAus(TABELLEN);
    const k = await projektKontext({ projekt_id: "P1", kontext: "projektAudit" }, q, { jetzt: JETZT });
    const f = JSON.parse(k.text);
    assert.equal(f.projekt, "Testhaus Nord");
    assert.equal(f.kostenanschlag_eur, 250);
    assert.equal(f.offene_tickets, 1);
    assert.equal(f.kritische_tickets, 1);
    assert.equal(f.ueberfaellige_vorgaenge, 1);
    assert.deepEqual(f.energie_screening, { richtwert_eingehalten: true, faktor: 0.9, hinweis: ENERGIE_HINWEIS });
    assert.ok(!k.text.includes("Kollision"), "ticket titles are not part of the prompt text");
    assert.deepEqual(k.daten, [{ quelle: "Tickets (offen)", text: "high: Kollision Lüftung" }]);
    assert.ok(q.gelesen.every(([, pid]) => pid === "P1"), "every read names P1");
    assert.deepEqual(q.gelesen.map(([e]) => e).sort(), [...KONTEXT_REZEPTE.projektAudit.entitaeten].sort());
  });

  it("rows of another project are dropped even when the source returns them", async () => {
    const k = await projektKontext({ projekt_id: "P1", kontext: "projektAudit" }, quelleAus(TABELLEN, { schlampig: true }), { jetzt: JETZT });
    const alles = k.text + JSON.stringify(k.daten);
    assert.ok(!alles.includes("GEHEIM"), "no ticket of P2");
    assert.equal(JSON.parse(k.text).kostenanschlag_eur, 250, "no LV position of P2");
  });

  it("errors: missing recipe/id 400, unknown recipe 400, foreign or missing project 404, no source 503", async () => {
    const q = quelleAus(TABELLEN);
    const status = async (anfrage, quelle = q) => {
      try { await projektKontext(anfrage, quelle); return 0; } catch (e) { assert.ok(e instanceof KontextFehler); return e.status; }
    };
    assert.equal(await status({ projekt_id: "P1" }), 400);
    assert.equal(await status({ kontext: "projektStamm" }), 400);
    assert.equal(await status({ projekt_id: "P1", kontext: "alles" }), 400);
    assert.equal(await status({ projekt_id: "P1", kontext: "__proto__" }), 400);
    assert.equal(await status({ projekt_id: "P9", kontext: "projektStamm" }), 404);
    assert.equal(await status({ projekt_id: "P1", kontext: "projektStamm" }, null), 503);
  });

  it("mitProjektKontext: unchanged without a request, otherwise context appended and daten merged", async () => {
    const roh = { prompt: "Hallo", daten: [{ quelle: "mail", text: "x" }] };
    assert.equal(await mitProjektKontext(roh, null), roh, "same object, no source needed");
    const p = await mitProjektKontext({ prompt: "Bewerte.", projekt_id: "P1", kontext: "projektAudit", daten: roh.daten }, quelleAus(TABELLEN), { jetzt: JETZT });
    assert.ok(p.prompt.startsWith(`Bewerte.\n\n${KONTEXT_KOPF}\n{`));
    assert.equal(p.projekt_id, undefined);
    assert.equal(p.kontext, undefined);
    assert.deepEqual(p.daten.map((d) => d.quelle), ["mail", "Tickets (offen)"]);
  });

  it("the cloud edge function uses a byte copy (no drift)", () => {
    const lokal = fs.readFileSync(new URL("../../packages/nova-core/server/llmKontext.js", import.meta.url), "utf8");
    const cloud = fs.readFileSync(new URL("../../supabase/functions/_shared/llmKontext.js", import.meta.url), "utf8");
    assert.equal(cloud, lokal, "copy packages/nova-core/server/llmKontext.js to supabase/functions/_shared/");
    const edge = fs.readFileSync(new URL("../../supabase/functions/llm/index.ts", import.meta.url), "utf8");
    assert.match(edge, /mitProjektKontext\(/, "the edge function applies the context");
    assert.match(edge, /nutzerClient\(req\)/, "and reads as the caller (RLS), not with the service role");
    assert.match(edge, /daten: Array\.isArray\(body\.daten\)/, "daten reach the guards in the cloud too");
  });
});

describe("78-12 local invoke-llm route with projekt_id + kontext", () => {
  let tmp, server, basis, p1, p2;
  const alt = {};

  before(async () => {
    alt.a = process.env.ANTHROPIC_API_KEY; alt.o = process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY; delete process.env.OPENAI_API_KEY;
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bit-atelier-llmkontext-"));
    const db = createDb(path.join(tmp, "db.json"));
    p1 = db.create("Project", { name: "Testhaus Nord", status: "design" });
    p2 = db.create("Project", { name: "Testhaus Süd", status: "design" });
    db.create("Issue", { project_id: p2.id, title: "GEHEIM aus Süd", priority: "high", status: "open" });
    assert.equal((await lokaleKontextQuelle(db).liste("Issue", p1.id)).length, 0);
    const app = express();
    app.use(express.json());
    app.use("/api", llmRouter(db));
    await new Promise((resolve) => { server = app.listen(0, "127.0.0.1", resolve); });
    basis = `http://127.0.0.1:${server.address().port}/api/integrations/invoke-llm`;
  });

  after(() => {
    server?.close();
    fs.rmSync(tmp, { recursive: true, force: true });
    if (alt.a) process.env.ANTHROPIC_API_KEY = alt.a;
    if (alt.o) process.env.OPENAI_API_KEY = alt.o;
  });

  const senden = (body) => fetch(basis, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  it("the server reads the named project (offline mock echoes the built prompt)", async () => {
    const r = await senden({ prompt: "Kurz.", projekt_id: p1.id, kontext: "projektStamm" });
    assert.equal(r.status, 200);
    const text = await r.json();
    assert.match(text, /Testhaus Nord/);
    assert.doesNotMatch(text, /Testhaus Süd|GEHEIM/);
  });

  it("unknown project → 404, unknown recipe → 400 (plain text, no model call)", async () => {
    const a = await senden({ prompt: "x", projekt_id: "gibt-es-nicht", kontext: "projektStamm" });
    assert.equal(a.status, 404);
    assert.match((await a.json()).error, /Projekt nicht gefunden/);
    const b = await senden({ prompt: "x", projekt_id: p1.id, kontext: "alles" });
    assert.equal(b.status, 400);
  });

  it("without projekt_id/kontext the route behaves as before", async () => {
    const r = await senden({ prompt: "Hallo Welt" });
    assert.equal(r.status, 200);
    assert.match(await r.json(), /Hallo Welt/);
  });
});
