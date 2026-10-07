// kalenderFristen.test.js — Fristenlehre §§ 187, 188 BGB auf dem 79-Kalender-
// Kern (Plan 80-04, Task 1). Behavior 1 mit Rechenweg je Fall.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  fristEnde,
  fristEndeBeginn,
  monatsende,
  naechster15OderMonatsende,
  volleJahre,
  volleMonate,
} from "@core/lib/kalender/fristen.js";

describe("fristEndeBeginn — Beginnfrist § 187 Abs. 2, § 188 Abs. 2 Alt. 2 / Abs. 3", () => {
  it("2026-01-01 + 6 Monate: Zieltag 2026-07-01 existiert, Vortag = 2026-06-30", () => {
    assert.equal(fristEndeBeginn("2026-01-01", { monate: 6 }), "2026-06-30");
  });
  it("2026-03-15 + 6 Monate: Zieltag 2026-09-15 existiert, Vortag = 2026-09-14", () => {
    assert.equal(fristEndeBeginn("2026-03-15", { monate: 6 }), "2026-09-14");
  });
  it("2026-08-31 + 6 Monate: der 31. fehlt im Februar 2027 (28 Tage) — Abs. 3 klemmt direkt auf den 28., kein Vortag-Schritt", () => {
    assert.equal(fristEndeBeginn("2026-08-31", { monate: 6 }), "2027-02-28");
  });
  it("2026-04-21 + 6 Monate: Zieltag 2026-10-21 existiert, Vortag = 2026-10-20", () => {
    assert.equal(fristEndeBeginn("2026-04-21", { monate: 6 }), "2026-10-20");
  });
  it("ungültige Eingabe → null", () => {
    assert.equal(fristEndeBeginn("2026-13-01", { monate: 6 }), null);
  });
});

describe("fristEnde — Ereignisfrist § 187 Abs. 1, § 188 Abs. 2 Alt. 1 / Abs. 3 (82-01-Vertragssignatur)", () => {
  it("2026-10-01 + 3 Monate = 2027-01-01 (Tag gleicher Zahl)", () => {
    assert.equal(fristEnde("2026-10-01", { monate: 3 }), "2027-01-01");
  });
  it("2026-09-10 + 2 Wochen = 2026-09-24", () => {
    assert.equal(fristEnde("2026-09-10", { wochen: 2 }), "2026-09-24");
  });
  it("2026-01-31 + 1 Monat: Februar hat keinen 31., klemmt auf 2026-02-28", () => {
    assert.equal(fristEnde("2026-01-31", { monate: 1 }), "2026-02-28");
  });
  it("2028-01-31 + 1 Monat: 2028 ist Schaltjahr, klemmt auf 2028-02-29", () => {
    assert.equal(fristEnde("2028-01-31", { monate: 1 }), "2028-02-29");
  });
  it("2026-05-15 + 4 Jahre = 2030-05-15 (82-01-Vertragsprobe)", () => {
    assert.equal(fristEnde("2026-05-15", { jahre: 4 }), "2030-05-15");
  });
  it("2028-02-29 + 5 Jahre: 2033 ist kein Schaltjahr, klemmt auf 2033-02-28", () => {
    assert.equal(fristEnde("2028-02-29", { jahre: 5 }), "2033-02-28");
  });
  it("2022-10-14 + 48 Monate = 2026-10-14", () => {
    assert.equal(fristEnde("2022-10-14", { monate: 48 }), "2026-10-14");
  });
  it("ungültige Eingabe → null", () => {
    assert.equal(fristEnde("nicht-ein-datum", { monate: 3 }), null);
  });
});

describe("volleJahre — Jubiläumslogik", () => {
  it("2024-09-01 bis 2026-09-10: Jahrestag (09-01) längst erreicht → 2 volle Jahre", () => {
    assert.equal(volleJahre("2024-09-01", "2026-09-10"), 2);
  });
  it("2024-09-15 bis 2026-09-10: Jahrestag 2026-09-15 noch nicht erreicht → nur 1 volles Jahr", () => {
    assert.equal(volleJahre("2024-09-15", "2026-09-10"), 1);
  });
});

describe("volleMonate", () => {
  it("2026-07-15 bis 2026-12-31: Tag 31 ≥ 15 → 5 volle Monate", () => {
    assert.equal(volleMonate("2026-07-15", "2026-12-31"), 5);
  });
});

describe("monatsende", () => {
  it("2026-02-10 → 2026-02-28 (kein Schaltjahr)", () => {
    assert.equal(monatsende("2026-02-10"), "2026-02-28");
  });
});

describe("naechster15OderMonatsende — § 622 Abs. 1 BGB", () => {
  it("2026-10-08 (≤ 15.) → 2026-10-15", () => {
    assert.equal(naechster15OderMonatsende("2026-10-08"), "2026-10-15");
  });
  it("2026-10-16 (> 15.) → Monatsletzter 2026-10-31", () => {
    assert.equal(naechster15OderMonatsende("2026-10-16"), "2026-10-31");
  });
});

describe("kein zweites Datums-Modul", () => {
  it("kein toISOString in fristen.js (NB-11)", async () => {
    const fs = await import("node:fs/promises");
    const inhalt = await fs.readFile(new URL("../../packages/nova-core/src/lib/kalender/fristen.js", import.meta.url), "utf8");
    assert.equal((inhalt.match(/toISOString/g) || []).length, 0);
  });
});
