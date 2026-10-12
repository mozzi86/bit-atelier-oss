// 72-04 Nachweis-Härtung: a missing input in a concept check is "offen", never a silent "pass".
// Each case below was green for an empty form before 72-04.

import { test } from "node:test";
import assert from "node:assert/strict";
import { brandChecks } from "@designer/lib/fire";
import { bfChecks } from "@designer/lib/accessibility";
import { schallChecks } from "@designer/lib/acoustics";
import { aussenanlagenChecks } from "@designer/lib/landscape";
import { vorbemessungChecks } from "@designer/lib/statics";
import { tgaChecks } from "@designer/lib/hvac";
import { OFFEN, gesamtStatus, konzeptAuswertung } from "@designer/lib/pruefStatus";
import { STATUS_STYLE } from "@designer/lib/compliance";

const status = (r, key) => r.items.find((i) => i.key === key)?.status;

test("fire: no OKF → Hochhaus/BMA/Feuerwehrplan offen; no escape route length → offen", () => {
  const r = brandChecks({});
  for (const k of ["gk", "hochhaus", "fluchtweg", "treppenraeume", "bma", "feuerwehrplaene"]) {
    assert.equal(status(r, k), OFFEN, k);
  }
  assert.equal(r.items.filter((i) => i.status === "pass").length, 0, "no pass for an empty form");
  // A Sonderbau trigger from the use does not depend on the height → BMA is still required.
  assert.equal(status(brandChecks({ nutzung: "versammlung" }), "bma"), "pass");
});

test("accessibility: 0 WE and no storeys are offen, not 0/0 = pass", () => {
  const r = bfChecks({});
  for (const k of ["aufzug", "erreichbar", "bewegung", "tuer", "flur", "sanitaer"]) {
    assert.equal(status(r, k), OFFEN, k);
  }
  // Quota 0 % is a visible [ASSUMED] default with its own hint ("LBO prüfen"); with a quota > 0
  // and no WE the count of wheelchair flats cannot be derived → offen.
  assert.equal(status(bfChecks({ quotePct: 10 }), "rollstuhl"), OFFEN);
  assert.equal(status(r, "erschliessung"), "pass", "explicit select default stays");
});

test("acoustics: TGA level 0 and missing outdoor noise are offen", () => {
  const r = schallChecks({ rwAussenIst: 45, rwTrennIst: 55, rwDeckeIst: 55 });
  assert.equal(status(r, "aussen"), OFFEN);
  assert.equal(status(r, "tga"), OFFEN);
  assert.equal(status(r, "trennwand"), "pass");
});

test("landscape: 0 required / 0 provided parking is offen", () => {
  const r = aussenanlagenChecks({});
  assert.equal(status(r, "kfz"), OFFEN);
  assert.equal(status(r, "barrierefrei"), OFFEN);
  assert.equal(status(aussenanlagenChecks({ erfKfz: 4, vorhandenKfz: 4 }), "kfz"), "pass");
});

test("statics/hvac: missing inputs offen", () => {
  assert.equal(status(vorbemessungChecks({ sigma: 120, zulSohldruck: 0, footArea: 100, storeys: 3 }), "sohldruck"), OFFEN);
  assert.equal(status(tgaChecks({ qHeizlast: 0 }), "heizlast"), OFFEN);
});

test("gesamtStatus: warn beats offen beats pass; STATUS_STYLE knows offen", () => {
  assert.equal(gesamtStatus({ warns: 1, offen: 3 }), "warn");
  assert.equal(gesamtStatus({ warns: 0, offen: 1 }), OFFEN);
  assert.equal(gesamtStatus({ items: [{ status: "pass" }] }), "pass");
  assert.equal(gesamtStatus(null), "pass");
  assert.ok(STATUS_STYLE[OFFEN]?.dot);
  const a = konzeptAuswertung([{ status: "pass" }, { status: OFFEN }]);
  assert.deepEqual([a.score, a.warns, a.offen, a.verdict], [50, 0, 1, "Konzept unvollständig — Angaben fehlen"]);
});
