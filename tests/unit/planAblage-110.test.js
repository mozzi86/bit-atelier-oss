// "An Plan ablegen" (BIM studio): picker label, default plan by sheet title, file name, data URL.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { titelNorm, planWahlText, passenderPlan, planPdfDateiname, pdfDataUrl } from "@designer/lib/planAblage.js";

const PLAENE = [
  { id: "a", gewerk: "AR", nr: "101", titel: "Grundriss Kellergeschoss" },
  { id: "b", gewerk: "AR", nr: "102", titel: "Grundriss Erdgeschoss", index: "a" },
  { id: "c", gewerk: "AR", nr: "103", titel: "Grundriss DG" },
  { id: "d", gewerk: "AR", nr: "201", titel: "Schnitt A-A" },
  { id: "e", gewerk: "AR", nr: "202", titel: "Schnitt B-B" },
  { id: "f", gewerk: "AR", nr: "301", titel: "Ansicht Nord" },
];

test("titelNorm reduces storey names and punctuation", () => {
  assert.equal(titelNorm("Grundriss Erdgeschoss"), "grundriss eg");
  assert.equal(titelNorm("Grundriss UG"), "grundriss kg");
  assert.equal(titelNorm("Schnitt A-A"), "schnitt a a");
  assert.equal(titelNorm(null), "");
});

test("planWahlText shows gewerk-nr, title and index", () => {
  assert.equal(planWahlText(PLAENE[1]), "AR-102 Grundriss Erdgeschoss (a)");
  assert.equal(planWahlText({ id: "x", titel: "Lageplan" }), "Lageplan");
});

test("passenderPlan matches the sheet title, long or short storey names", () => {
  assert.equal(passenderPlan(PLAENE, "Grundriss EG")?.id, "b");
  assert.equal(passenderPlan(PLAENE, "Grundriss KG")?.id, "a");
  assert.equal(passenderPlan(PLAENE, "Grundriss Dachgeschoss")?.id, "c");
  assert.equal(passenderPlan(PLAENE, "Schnitt B-B")?.id, "e");
});

test("passenderPlan gives null when nothing or more than one fits", () => {
  assert.equal(passenderPlan(PLAENE, "Grundriss OG"), null);
  assert.equal(passenderPlan(PLAENE, "Schnitt"), null); // two sections contain it — the user picks
  assert.equal(passenderPlan(PLAENE, ""), null);
  assert.equal(passenderPlan(/** @type {any} */ (null), "Grundriss EG"), null);
});

test("planPdfDateiname keeps the studio download formula", () => {
  assert.equal(planPdfDateiname("Haus Muster", "Grundriss EG", 100), "Haus_Muster_Grundriss_EG_1-100.pdf");
  assert.equal(planPdfDateiname("", "Schnitt A-A", 50), "plan_Schnitt_A-A_1-50.pdf");
});

test("pdfDataUrl encodes bytes as base64, also beyond one chunk", () => {
  const klein = new TextEncoder().encode("%PDF-1.7");
  assert.equal(pdfDataUrl(klein), `data:application/pdf;base64,${Buffer.from(klein).toString("base64")}`);
  const gross = new Uint8Array(100000).map((_, i) => i % 251);
  assert.equal(pdfDataUrl(gross).slice("data:application/pdf;base64,".length), Buffer.from(gross).toString("base64"));
});
