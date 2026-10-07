// Headless-Nachweis 75-14 (MS-07/MS-09, MSB-14/17…21): Diele, Türen, Erschließungsgraph,
// Raumqualität in Werkstatt und WohnungsFokus.
//
// Ablauf: Werkstatt öffnen (Regel „wohnungsgrundriss" AUS → keine Türöffnungen, keine
// Qualitätskarte = Default byte-gleich), Regel AN → Türöffnungen `wt-tuer` im Geschoss-
// plan, Qualitätskarte `wt-qualitaet` mit Zählern, 0 Erschließungs-fail (jede WE hat
// Diele + Türen zu allen Räumen), Fokus der ersten WE: `fk-tuer` mit Blatt + Bogen,
// Diele-Label, Klick auf eine Tür dreht den Aufschlag, Rückgängig stellt ihn zurück,
// `fk-qualitaet` vorhanden. Am Ende Regel wieder AUS (Aufräumen).
//
// Regeln (Lehren 75-05/07/09/11): --workers=1 · Chips/Umschalter per dispatchEvent ·
// SVG-Elemente über count()/Attribute, nie toBeVisible · Werkstatt-Regeln nur über
// schalteRegel (useFachlayer-Ladesperre) · three.js-WebGL-pageerror ignorieren.
// Die Zahlen des Review-Testhauses (30 × 20 m) werden als Annotation protokolliert —
// Seitenverhältnis-warn/-fail sind dort ehrlich zu erwarten (Bandtiefe 9,1 m).

import { test, expect } from "@playwright/test";
import { ERLAUBT_OFFLINE, schalteRegel } from "./fixtures/massing.js";
import { BILD_PROGRAMM } from "./fixtures/bildWohnung.js";

const SEITE_WERKSTATT = "/ComplexDesigner?projekt=Review%20Testhaus&tab=werkstatt";

async function wacheAuf(page) {
  await page.route("**/*", (route) => {
    const host = new URL(route.request().url()).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]" ? route.continue() : route.abort();
  });
  const warnungen = [];
  page.on("console", (m) => {
    if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text())) warnungen.push(m.text());
  });
  page.on("pageerror", (e) => { if (!/WebGL|THREE/i.test(String(e))) warnungen.push(`pageerror ${e}`); });
  return warnungen;
}

async function werkstattBereit(page) {
  await page.goto(SEITE_WERKSTATT);
  await expect(page.getByTestId("wt-regeln")).toBeVisible({ timeout: 30000 });
  await schalteRegel(page, "wohnungsgrundriss", false);
  if (!(await page.getByTestId("wt-we").count())) {
    const anwenden = page.getByRole("button", { name: /Tesselierung anwenden/ });
    await expect(anwenden).toBeVisible({ timeout: 15000 });
    const entfernen = page.getByRole("button", { name: /entfernen/i }).first();
    if ((await anwenden.isDisabled()) && (await entfernen.count())) { await entfernen.click(); await page.waitForTimeout(800); }
    for (let i = 0; i < 3 && !(await anwenden.isDisabled()); i += 1) { await anwenden.click(); await page.waitForTimeout(1200); }
    await page.waitForTimeout(800);
  }
  await page.waitForTimeout(1600);
  expect(await page.getByTestId("wt-we").count(), "WE-Zonen vorhanden").toBeGreaterThan(0);
}

test.describe("75-14 Diele, Türen, Erschließung, Raumqualität", () => {
  test.use({ viewport: { width: 1280, height: 1800 } });
  test.describe.configure({ timeout: 240000 });

  test("Regel aus = keine Türen/Qualität; Regel an = Türöffnungen, Qualitätskarte, 0 Erschließungs-fail; Fokus zeigt Türen, Diele, Aufschlag-Undo", async ({ page }) => {
    const warnungen = await wacheAuf(page);
    await werkstattBereit(page);

    // --- Default (rule OFF): nothing of 75-14 is drawn — the plan is the Phase-61/75-07 plan.
    await expect(page.getByTestId("wt-tuer")).toHaveCount(0);
    await expect(page.getByTestId("wt-qualitaet")).toHaveCount(0);

    // --- Rule ON: door openings in the storey plan + quality card with counters.
    await schalteRegel(page, "wohnungsgrundriss", true);
    await page.waitForTimeout(600);
    const tuerenMassing = await page.getByTestId("wt-tuer").count();
    expect(tuerenMassing, "Türöffnungen im Geschossplan").toBeGreaterThan(0);
    // Massing = opening only (no leaf, no arc).
    await expect(page.locator('[data-testid="wt-tuer"] [data-tuer-blatt]')).toHaveCount(0);
    const karte = page.getByTestId("wt-qualitaet");
    await expect(karte).toBeVisible();
    const weZeilen = page.getByTestId("wt-qualitaet-we");
    const weAnzahl = await weZeilen.count();
    expect(weAnzahl, "eine Qualitätszeile je WE").toBeGreaterThan(0);
    // Every unit: a hall and doors to every room → no access fail anywhere.
    const erschliessungFails = await page.locator('[data-testid="wt-qualitaet-we"] [data-regel="erschliessung"][data-stufe="fail"], [data-testid="wt-qualitaet-we"] [data-regel="diele"][data-stufe="fail"]').count();
    expect(erschliessungFails, "kein Raum ohne Zugang, jede WE mit Diele").toBe(0);
    const zaehler = {
      ok: Number(await karte.getAttribute("data-ok")), warn: Number(await karte.getAttribute("data-warn")), fail: Number(await karte.getAttribute("data-fail")),
    };
    expect(await page.getByTestId("wt-qualitaet-zaehler").textContent()).toContain(`${zaehler.fail} fail`);
    test.info().annotations.push({ type: "raumqualitaet-review-testhaus", description: `${weAnzahl} WE · ${zaehler.ok} ok · ${zaehler.warn} warn · ${zaehler.fail} fail · ${tuerenMassing} Türöffnungen` });
    // Honest expectation: ratio findings on a 9,1 m band are allowed, access findings are not.
    const andereFails = await page.locator('[data-testid="wt-qualitaet-we"] [data-stufe="fail"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-regel")));
    for (const r of andereFails) expect(["seitenverhaeltnis", "raumMin", "mindestbreite", "tuer", "bad_vom_wohnraum"], `fail-Regel ${r}`).toContain(r);
    expect(andereFails, "keine Zugangs-/Bad-Fehler").not.toContain("bad_vom_wohnraum");
    expect(andereFails).not.toContain("tuer");

    // --- Focus of the first unit via the quality card's jump button.
    const ersteWe = await weZeilen.first().getAttribute("data-we");
    await weZeilen.first().getByTestId("wt-qualitaet-fokus").dispatchEvent("click");
    await expect(page.getByText(`Fokusansicht: ${ersteWe}`).first()).toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(800);
    // Count inside the VISIBLE focus overlay only (a hidden duplicate plan would double the counts — 75-11 lesson).
    const fokus = page.getByTestId("fk-overlay").locator("visible=true").first();

    // Doors of the unit: one per room + the entrance door (data-tueren on the toolbar).
    const leiste = page.getByTestId("fk-tueren-leiste");
    await expect(leiste).toBeVisible();
    const tuerenSoll = Number(await leiste.getAttribute("data-tueren"));
    const tueren = fokus.locator('[data-testid="fk-tuer"]');
    expect(await tueren.count(), "fk-tuer = Türen der WE").toBe(tuerenSoll);
    expect(tuerenSoll).toBeGreaterThanOrEqual(3);
    // Leaf + arc per door (1:50 symbol, Auflage 13), opening polygon present.
    expect(await fokus.locator('[data-testid="fk-tuer"] [data-tuer-blatt]').count()).toBe(tuerenSoll);
    expect(await fokus.locator('[data-testid="fk-tuer"] [data-tuer-bogen]').count()).toBe(tuerenSoll);
    expect(await fokus.locator('[data-testid="fk-tuer"] [data-tuer-oeffnung]').count()).toBe(tuerenSoll);
    // Exactly one entrance door, raw width 0,985 (CITED DIN 18100).
    const eingang = fokus.locator('[data-testid="fk-tuer"][data-typ="wohnung"]');
    await expect(eingang).toHaveCount(1);
    expect(await eingang.getAttribute("data-breite")).toBe("0.985");
    // Hall present: the entrance door belongs to the zone "Diele …" (label may yield to collision).
    expect(await eingang.getAttribute("data-tuer-zone"), "Wohnungstür in der Diele").toMatch(/^Diele/);
    // Quality card in the sidebar with the same counters as the workshop row.
    const fq = page.getByTestId("fk-qualitaet");
    await expect(fq).toBeVisible();
    expect(await fq.locator('[data-regel="erschliessung"][data-stufe="ok"]').count(), "Erschließung ok").toBe(1);

    // --- Click a room door → swing flips; undo → back; redo → flipped again.
    const zimmerTuer = fokus.locator('[data-testid="fk-tuer"][data-typ="zimmer"]').first();
    const zone = await zimmerTuer.getAttribute("data-tuer-zone");
    const vorher = await zimmerTuer.getAttribute("data-tuer");
    expect(vorher).toBe("links");
    await zimmerTuer.dispatchEvent("click");
    await page.waitForTimeout(500);
    const nachKlick = fokus.locator(`[data-testid="fk-tuer"][data-tuer-zone="${zone}"]`).first();
    expect(await nachKlick.getAttribute("data-tuer"), "Aufschlag gedreht").toBe("rechts");
    await page.getByTestId("fk-tuer-undo").dispatchEvent("click");
    await page.waitForTimeout(500);
    expect(await fokus.locator(`[data-testid="fk-tuer"][data-tuer-zone="${zone}"]`).first().getAttribute("data-tuer"), "Undo").toBe("links");
    await page.getByTestId("fk-tuer-redo").dispatchEvent("click");
    await page.waitForTimeout(500);
    expect(await fokus.locator(`[data-testid="fk-tuer"][data-tuer-zone="${zone}"]`).first().getAttribute("data-tuer"), "Redo").toBe("rechts");
    await page.getByTestId("fk-tuer-undo").dispatchEvent("click");
    await page.waitForTimeout(500);

    // --- Clean up: rule back OFF (layer persists), wait out the debounce.
    await page.goto(SEITE_WERKSTATT);
    await expect(page.getByTestId("wt-regeln")).toBeVisible({ timeout: 30000 });
    await schalteRegel(page, "wohnungsgrundriss", false);
    await page.waitForTimeout(1600);
    await expect(page.getByTestId("wt-tuer")).toHaveCount(0);

    // Fixture sanity: the picture apartment's programme is the one the unit tests use.
    expect(BILD_PROGRAMM.map((r) => r.raum)).toContain("Kind 2/Büro");
    expect(warnungen, `Konsole: ${warnungen.join(" | ")}`).toEqual([]);
  });
});
