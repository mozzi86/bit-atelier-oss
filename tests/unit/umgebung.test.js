// Unit-Tests für packages/nova-core/src/lib/umgebung.js (Phase 70-01, 57-02, 83-02).
//
// Die exportierten Konstanten sind Compile-Zeit-Werte aus Vites `MODE` und unter
// node nicht variierbar. Getestet wird deshalb die reine Regel dahinter
// (`flaggenFuer`) — genau die Zuordnung, die im Build die Konstanten setzt:
//   lokal → serverlos (Client-Build: PWA/Tauri)
//   sonst → Server-Build (express oder supabase)
// Den Modus `demo` gibt es seit 83-02 nicht mehr — er ist jetzt ein ganz
// normaler unbekannter Modus und darf nichts Besonderes mehr auslösen.
//
// 57-02 (D-P57-06): Rückgabewert `datenquelle` — EINE Weiche für den
// Datenweg: 'serverlos' (lokal), 'supabase' (VITE_SUPABASE_URL gesetzt),
// sonst 'express'. Serverlos GEWINNT gegen eine gesetzte Supabase-URL: die
// lokale Fassung spricht nie mit der Cloud.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import * as umgebung from "@core/lib/umgebung";

const { flaggenFuer, SERVERLOSE_MODI, IST_LOKAL, SERVERLOS, DATENQUELLE } = umgebung;

describe("flaggenFuer — die Regel hinter den Konstanten", () => {
  it("lokal: serverlos, Datenquelle serverlos", () => {
    assert.deepEqual(flaggenFuer("lokal"), {
      istLokal: true, serverlos: true, datenquelle: "serverlos",
    });
  });

  it("production ohne URL: nicht serverlos — Datenquelle express", () => {
    assert.deepEqual(flaggenFuer("production"), {
      istLokal: false, serverlos: false, datenquelle: "express",
    });
  });

  it("development, undefined und der entfernte Modus demo verhalten sich wie production", () => {
    for (const modus of ["development", undefined, "", "demo", "Demo", "LOKAL"]) {
      const f = flaggenFuer(modus);
      assert.equal(f.serverlos, false, `Modus ${String(modus)} darf nicht serverlos sein`);
      assert.equal(f.datenquelle, "express");
      assert.equal("istDemo" in f, false, "istDemo ist mit der Demo entfallen (83-02)");
    }
  });

  it("SERVERLOSE_MODI und die Regel sagen dasselbe", () => {
    for (const modus of SERVERLOSE_MODI) {
      assert.equal(flaggenFuer(modus).serverlos, true, `${modus} fehlt in der Regel`);
    }
    assert.deepEqual(SERVERLOSE_MODI, ["lokal"]);
  });
});

describe("flaggenFuer — datenquelle (57-02, D-P57-06)", () => {
  const URL = "https://example.supabase.co";

  it("normaler Modus MIT VITE_SUPABASE_URL → supabase", () => {
    assert.equal(flaggenFuer("production", URL).datenquelle, "supabase");
    assert.equal(flaggenFuer("development", URL).datenquelle, "supabase");
  });

  it("normaler Modus OHNE URL → express", () => {
    assert.equal(flaggenFuer("production", undefined).datenquelle, "express");
    assert.equal(flaggenFuer("production", "").datenquelle, "express");
  });

  it("lokal gewinnt gegen eine gesetzte URL — die lokale Fassung spricht nie Cloud", () => {
    assert.equal(flaggenFuer("lokal", URL).datenquelle, "serverlos");
  });

  it("die übrigen Flaggen bleiben von der URL unberührt", () => {
    const mit = flaggenFuer("production", URL);
    const ohne = flaggenFuer("production");
    assert.equal(mit.istLokal, ohne.istLokal);
    assert.equal(mit.serverlos, ohne.serverlos);
  });
});

describe("die exportierten Konstanten", () => {
  it("sind unter node alle falsch — dort gibt es kein import.meta.env, und das darf nicht werfen", () => {
    assert.equal(IST_LOKAL, false);
    assert.equal(SERVERLOS, false);
  });

  it("die Demo-Konstante gibt es nicht mehr (83-02)", () => {
    assert.equal("IST_" + "DEMO" in umgebung, false);
  });

  it("SERVERLOS ist genau IST_LOKAL", () => {
    assert.equal(SERVERLOS, IST_LOKAL);
  });

  it("DATENQUELLE ist unter node 'express' (kein import.meta.env, keine URL)", () => {
    // Unter node gibt es weder lokal noch eine Supabase-URL — die Weiche
    // fällt auf den Entwicklungsweg, genau wie `npm run dev` ohne .env.
    assert.equal(DATENQUELLE, "express");
  });

  it("die Konstanten und flaggenFuer sagen dasselbe (eine Regel, zwei Schreibweisen)", () => {
    // DATENQUELLE ist für das Tree-Shaking als faltbare Literal-Kette
    // geschrieben, flaggenFuer ist die getestete Regel dahinter (57-02
    // Kommentar in umgebung.js). Unter node: beide müssen auf 'express'
    // kommen — weichen sie ab, ist die Baum-Regel kaputt.
    assert.equal(DATENQUELLE, flaggenFuer(undefined, undefined).datenquelle);
    assert.equal(SERVERLOS, flaggenFuer(undefined).serverlos);
  });
});
