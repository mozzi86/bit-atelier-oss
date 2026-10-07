// personalKuendigung.test.js — gesetzliche Kündigungsfrist (Plan 80-06, Task
// 2): Behavior 2 mit Rechenweg. `regelWert` liest die echte Staffel aus
// HR_REGELN (personal.kuendigung_staffel) über den Regelwerk-Kern.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { regelWerteAus } from "@core/lib/regelwerk.js";
import { HR_REGELN } from "@/lib/people/hrRegeln.js";
import { kuendigungsfristGesetzlich } from "@/lib/people/kuendigung.js";

/** @type {import("@core/lib/regelwerk.js").RegelGruppe} */
const HR_GRUPPE = { gruppe: "personal", titel: "Personal", regeln: HR_REGELN, sichtbar: () => true, speicher: { art: "zeilen" } };
const { wert: regelWert } = regelWerteAus([HR_GRUPPE], []);

const ZUGANG = "2026-09-10";

describe("kuendigungsfristGesetzlich — Behavior 2 (§ 622 BGB), Zugang 2026-09-10", () => {
  it("Probezeit: Eintritt 2026-05-01, Probezeitende 2026-10-31 → 2026-09-24, § 622 Abs. 3 BGB", () => {
    const f = kuendigungsfristGesetzlich({ eintritt: "2026-05-01", zugang: ZUGANG, seite: "ag", probezeitEnde: "2026-10-31" }, regelWert);
    assert.equal(f.letzterTag, "2026-09-24");
    assert.equal(f.regel, "probezeit");
    assert.equal(f.norm, "§ 622 Abs. 3 BGB");
  });

  it("Grundfrist: Eintritt 2024-09-15 (1 Jahr) → 2026-10-15 (09-10 + 4 Wochen = 10-08 → zum 15.)", () => {
    const f = kuendigungsfristGesetzlich({ eintritt: "2024-09-15", zugang: ZUGANG, seite: "ag" }, regelWert);
    assert.equal(f.jahre, 1);
    assert.equal(f.letzterTag, "2026-10-15");
    assert.equal(f.regel, "grundfrist");
  });

  it("Staffel: Eintritt 2024-09-01 (2 Jahre) → 2026-10-31 (1 Monat zum Monatsende)", () => {
    const f = kuendigungsfristGesetzlich({ eintritt: "2024-09-01", zugang: ZUGANG, seite: "ag" }, regelWert);
    assert.equal(f.jahre, 2);
    assert.equal(f.letzterTag, "2026-10-31");
    assert.equal(f.regel, "staffel");
  });

  it("Staffel: Eintritt 2015-03-01 (11 Jahre) → 2027-01-31 (4 Monate zum Monatsende)", () => {
    const f = kuendigungsfristGesetzlich({ eintritt: "2015-03-01", zugang: ZUGANG, seite: "ag" }, regelWert);
    assert.equal(f.jahre, 11);
    assert.equal(f.letzterTag, "2027-01-31");
    assert.equal(f.regel, "staffel");
  });

  it("Dieselbe Person (11 Jahre) mit seite:'an' → Grundfrist 2026-10-15, § 622 Abs. 1 BGB", () => {
    const f = kuendigungsfristGesetzlich({ eintritt: "2015-03-01", zugang: ZUGANG, seite: "an" }, regelWert);
    assert.equal(f.letzterTag, "2026-10-15");
    assert.equal(f.regel, "grundfrist");
    assert.equal(f.norm, "§ 622 Abs. 1 BGB");
  });

  it("Staffel 2/5/8/10/12/15/20 Jahre → 1/2/3/4/5/6/7 Monate zum Monatsende", () => {
    const erwartet = [[2, 1], [5, 2], [8, 3], [10, 4], [12, 5], [15, 6], [20, 7]];
    for (const [jahre, monate] of erwartet) {
      const eintritt = `${2026 - jahre}-09-10`;
      const f = kuendigungsfristGesetzlich({ eintritt, zugang: ZUGANG, seite: "ag" }, regelWert);
      assert.equal(f.jahre, jahre, `Betriebszugehörigkeit für Eintritt ${eintritt}`);
      // Monatsende von (Zugang + `monate` Monate) — derselbe Rechenweg wie kuendigung.js selbst.
      const monatsIndex = new Date(Date.UTC(2026, 8 + monate, 1));
      const letzterTagMonat = new Date(Date.UTC(monatsIndex.getUTCFullYear(), monatsIndex.getUTCMonth() + 1, 0));
      const erwarteterTag = `${letzterTagMonat.getUTCFullYear()}-${String(letzterTagMonat.getUTCMonth() + 1).padStart(2, "0")}-${String(letzterTagMonat.getUTCDate()).padStart(2, "0")}`;
      assert.equal(f.letzterTag, erwarteterTag, `${monate} Monate ab ${ZUGANG}`);
    }
  });

  it("jede Antwort enthält die 3 festen Warnungen (Sonderkündigungsschutz, KSchG, § 623 BGB)", () => {
    const f = kuendigungsfristGesetzlich({ eintritt: "2024-09-15", zugang: ZUGANG, seite: "ag" }, regelWert);
    assert.equal(f.warnungen.length, 3);
    assert.ok(f.warnungen.some((w) => w.norm.includes("MuSchG")));
    assert.ok(f.warnungen.some((w) => w.norm.includes("KSchG")));
    assert.ok(f.warnungen.some((w) => w.norm === "§ 623 BGB"));
    assert.ok(f.warnungen.every((w) => w.schwere === "warn"));
  });

  it("§ 622 Abs. 6 BGB: eine längere vertragliche Arbeitnehmerfrist warnt zusätzlich", () => {
    const f = kuendigungsfristGesetzlich({ eintritt: "2024-09-15", zugang: ZUGANG, seite: "an", vertraglich: "2027-01-31" }, regelWert);
    assert.equal(f.warnungen.length, 4);
    assert.ok(f.warnungen.some((w) => w.norm === "§ 622 Abs. 6 BGB"));
  });
});
