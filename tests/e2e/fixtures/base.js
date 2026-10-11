// 87-01: the `test` every spec that touches the "Review Testhaus" project imports.
// An automatic fixture restores the test house (footprint, storeys, every layer) to the
// start-of-run snapshot AFTER each test and fails the test when the restore does not
// land — instead of a per-spec `resetRechteck(...).catch(() => {})`.
//
// Specs that do not touch the house (smoke, ifc-parity, cloud-smoke …) keep importing
// from "@playwright/test" and pay nothing.
import { test as basis, expect } from "@playwright/test";
import { testhausLaden, testhausSoll, testhausZuruecksetzen, footprintAbweichung } from "./testhaus.js";

export const test = basis.extend({
  testhausReset: [async ({ request }, use, testInfo) => {
    await use();
    // A spec that leaves the house changed is repaired, but it says so in the report
    // (annotation + warning) — specs that set a shape through the API on purpose
    // (massing-75-06) rely on exactly this repair, so "dirty" is not red by itself.
    const soll = testhausSoll();
    const { modell } = await testhausLaden(request);
    const d = footprintAbweichung(modell.footprintM, soll.footprintM);
    const layerAnders = Object.keys(soll).filter((k) => !["id", "created_date", "updated_date", "footprintM"].includes(k)
      && JSON.stringify(modell[k] ?? null) !== JSON.stringify(soll[k] ?? null));
    if (d > 0.011 || layerAnders.length) {
      const was = `${d > 0.011 ? `Footprint ${d.toFixed(2)} m` : ""}${layerAnders.length ? ` Layer: ${layerAnders.join(", ")}` : ""}`.trim();
      testInfo.annotations.push({ type: "testhaus-veraendert", description: was });
      console.warn(`[testhaus] ${testInfo.title} hat das Haus verändert zurückgelassen (${was}) — wird zurückgesetzt`);
    }
    await testhausZuruecksetzen(request, soll); // throws = red when the restore does not land
  }, { auto: true }],
});

export { expect };
