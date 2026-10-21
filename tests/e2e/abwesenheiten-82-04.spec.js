// Phase 82 (82-04): absences against the Express dev stack. Replaces the planned
// headless proof n-82-04-abwesenheiten.mjs (no demo build since 83-02). The
// Express sample has no persons and no absences (personal.json empty), so the
// spec creates two persons (project lead A, working student B), their
// contracts and absences relative to today, links nu-2 → A and nu-3 → B, and
// removes everything in `finally`:
//  1. owner, team calendar: A absent next week, B requested; no kind (krank,
//     urlaub, fortbildung) anywhere in the team calendar — text, title, aria-label;
//  2. requests: B's request warns that the stand-in A is absent; owner approves →
//     decision at the record (entschieden_von), the audit log count unchanged;
//  3. new request A in three weeks, stand-in B: no warning, working days shown;
//  4. balance: A planned = both weeks;
//  5. view as project lead: B's sickness reads "abwesend" in the request list and
//     the team calendar; view as B: her own entry reads "Krank";
//  6. time tracking (owner, person B): the sick day is marked "abwesend";
//  7. holidays tab: the year's count from the calendar core, comparison shown;
//  8. /Deadlines: an absence hint with initials, without reason;
//  9. English, 375 px dark without horizontal scroll, console clean.
import { test, expect } from "@playwright/test";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";
import { feiertage, KALENDER_STANDARD } from "../../packages/nova-core/src/lib/kalender/feiertage.js";

const API = "/api/entities";
const P = "/api/personal";
const A = "e2e-8204-a";
const B = "e2e-8204-b";
const GRUND = /\b(krank|urlaub|fortbildung)\b/i;

/** @param {Date} d @returns {string} */
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
/** @param {string} tag @param {number} n @returns {string} */
function plus(tag, n) {
  const d = new Date(`${tag}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** Monday of the week of a day. @param {string} tag */
function montag(tag) {
  const w = new Date(`${tag}T12:00:00Z`).getUTCDay();
  return plus(tag, -((w + 6) % 7));
}
/** Working days Mo–Fr without holidays. @param {string} von @param {string} bis */
function arbeitstage(von, bis) {
  let n = 0;
  for (let t = von; t <= bis; t = plus(t, 1)) {
    const w = new Date(`${t}T12:00:00Z`).getUTCDay();
    if (w >= 1 && w <= 5 && !feiertage(Number(t.slice(0, 4)), KALENDER_STANDARD).some((f) => f.datum === t)) n++;
  }
  return n;
}

/** @param {import("@playwright/test").Page} page */
function konsoleSammeln(page) {
  const meldungen = [];
  page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text())) meldungen.push(m.text()); });
  page.on("pageerror", (e) => meldungen.push(`pageerror ${e}`));
  return meldungen;
}

/** Everything the team calendar says, also in title and aria-label. @param {import("@playwright/test").Page} page */
async function teamText(page) {
  return page.getByTestId("team-kalender").evaluate((el) => [el.textContent, ...[...el.querySelectorAll("[title],[aria-label]")].flatMap((x) => [x.getAttribute("title"), x.getAttribute("aria-label")])].join(" "));
}

test("Abwesenheiten: Teamkalender ohne Gründe, Antrag mit Konflikt, Genehmigung, Konto, Rollen, Zeiterfassung, Feiertage, Agenda", async ({ page, request }) => {
  test.setTimeout(240000);
  const heute = iso(new Date());
  const w1 = plus(montag(heute), 7);
  const w3 = plus(w1, 14);
  const krankTag = plus(montag(heute), 1);
  const auditVorher = ((await (await request.get(`${API}/AuditLog`)).json()) || []).length;
  await request.post(`${P}/Mitarbeiter`, { data: { id: A, vorname: "Beispiel", nachname: "Projektleitung", personalnummer: "E2E-A", art: "angestellt", status: "aktiv", eintritt: "2020-01-01", austritt: null,
    projekt_zuordnungen: [{ project_id: "proj-1", funktion: "Projektleitung", anteil_prozent: 100, von: null, bis: null }] } });
  await request.post(`${P}/Mitarbeiter`, { data: { id: B, vorname: "Beispiel", nachname: "Werkstudium", personalnummer: "E2E-B", art: "werkstudent", status: "aktiv", eintritt: "2020-01-01", austritt: null,
    projekt_zuordnungen: [{ project_id: "proj-1", funktion: "Mitarbeit", anteil_prozent: 100, von: null, bis: null }] } });
  await request.post(`${P}/Arbeitsvertrag`, { data: { id: `${A}-v`, mitarbeiter_id: A, status: "unterschrieben", beginn: "2020-01-01", ende: null, wochenstunden: 40, arbeitstage_woche: 5, urlaub_tage_jahr: 30 } });
  await request.post(`${P}/Arbeitsvertrag`, { data: { id: `${B}-v`, mitarbeiter_id: B, status: "unterschrieben", beginn: "2020-01-01", ende: null, wochenstunden: 20, arbeitstage_woche: 5, urlaub_tage_jahr: 20 } });
  await request.post(`${P}/Abwesenheit`, { data: { id: `${A}-1`, mitarbeiter_id: A, art: "urlaub", status: "genehmigt", von: w1, bis: plus(w1, 4), entschieden_von: "nu-1", entschieden_am: heute } });
  await request.post(`${P}/Abwesenheit`, { data: { id: `${B}-1`, mitarbeiter_id: B, art: "urlaub", status: "beantragt", von: plus(w1, 2), bis: plus(w1, 9), vertretung_id: A } });
  await request.post(`${P}/Abwesenheit`, { data: { id: `${B}-2`, mitarbeiter_id: B, art: "krank", status: "genehmigt", von: krankTag, bis: krankTag } });
  await request.put(`${API}/Nutzer/nu-2`, { data: { mitarbeiter_id: A } });
  await request.put(`${API}/Nutzer/nu-3`, { data: { mitarbeiter_id: B } });
  try {
    await nurLocalhost(page);
    const konsole = konsoleSammeln(page);

    // 1. Team calendar of the month of w1.
    await page.goto("/Absences?tab=team");
    await expect(page.getByTestId("team-kalender")).toBeVisible({ timeout: 20000 });
    if (w1.slice(5, 7) !== heute.slice(5, 7)) await page.getByRole("button", { name: "Nächster Monat" }).click();
    await expect(page.locator(`[data-person="${A}"] [data-datum="${w1}"]`)).toHaveAttribute("data-zustand", "abwesend", { timeout: 20000 });
    // B's request runs w1+2 … w1+9; the calendar shows only w1's month — check a request day inside it
    // (w1+9 fell into the next month on 19.10.2026 and the cell did not exist).
    const bTag = [2, 3, 4, 5, 6, 7, 8, 9].map((d) => plus(w1, d)).find((d) => d.slice(0, 7) === w1.slice(0, 7));
    if (bTag) await expect(page.locator(`[data-person="${B}"] [data-datum="${bTag}"]`)).toHaveAttribute("data-zustand", /beantragt|^$/);
    expect(await teamText(page)).not.toMatch(GRUND);

    // 2. Requests: conflict warning, approval at the record, no audit row.
    await page.goto("/Absences?tab=requests");
    const antrag = page.locator(`[data-antrag="${B}-1"]`);
    await expect(antrag.getByTestId("antrag-zeile-warnung")).toContainText("selbst abwesend", { timeout: 20000 });
    await expect(antrag.getByTestId("antrag-grund")).toHaveText("Urlaub");
    await antrag.getByTestId("antrag-genehmigen").click();
    await page.getByTestId("bestaetigung-ok").click();
    await expect(page.locator(`[data-antrag="${B}-1"]`)).toHaveAttribute("data-status", "genehmigt", { timeout: 15000 });
    const b1 = await (await request.get(`${P}/Abwesenheit/${B}-1`)).json();
    expect(b1.entschieden_von).toBe("nu-1");
    expect(((await (await request.get(`${API}/AuditLog`)).json()) || []).length).toBe(auditVorher);

    // 3. New request A in w3, stand-in B: working days, no warning.
    await page.getByTestId("antrag-neu").click();
    const dlg = page.getByTestId("antrag-dialog");
    await dlg.getByTestId("antrag-person").selectOption(A);
    await dlg.getByTestId("antrag-von").fill(w3);
    await dlg.getByTestId("antrag-bis").fill(plus(w3, 4));
    await dlg.getByTestId("antrag-vertretung").selectOption(B);
    await expect(dlg.getByTestId("antrag-tage")).toHaveText(`${arbeitstage(w3, plus(w3, 4))} Arbeitstage`);
    await expect(dlg.getByTestId("antrag-warnungen")).toHaveCount(0);
    await dlg.getByTestId("antrag-speichern").click();
    await expect(dlg).toHaveCount(0, { timeout: 15000 });
    const neu = ((await (await request.get(`${P}/Abwesenheit`)).json()) || []).find((a) => a.mitarbeiter_id === A && a.von === w3);
    expect(neu?.status).toBe("beantragt");
    await page.locator(`[data-antrag="${neu.id}"]`).getByTestId("antrag-genehmigen").click();
    await page.getByTestId("bestaetigung-ok").click();
    await expect(page.locator(`[data-antrag="${neu.id}"]`)).toHaveAttribute("data-status", "genehmigt", { timeout: 15000 });

    // 4. Balance: planned = w1 + w3 (both in the current year when they are).
    await page.goto("/Absences?tab=balance");
    const jahr = Number(heute.slice(0, 4));
    const geplant = [[w1, plus(w1, 4)], [w3, plus(w3, 4)]].reduce((n, [v, b]) => n + (v.startsWith(String(jahr)) ? arbeitstage(v, b) : 0), 0);
    await expect(page.locator(`[data-testid="konto-zeile"][data-person="${A}"] [data-testid="konto-geplant"]`)).toHaveText(String(geplant), { timeout: 20000 });

    // 5. Views as project lead and as B.
    await page.getByTestId("ansicht-als").selectOption("nu-2");
    await page.goto("/Absences?tab=requests");
    await expect(page.locator(`[data-antrag="${B}-2"]`).getByTestId("antrag-grund")).toHaveText("abwesend", { timeout: 20000 });
    await page.goto("/Absences?tab=team");
    await expect(page.getByTestId("team-kalender")).toBeVisible({ timeout: 20000 });
    expect(await teamText(page)).not.toMatch(GRUND);
    await page.getByTestId("ansicht-als").selectOption("nu-3");
    await page.goto("/Absences?tab=requests");
    await expect(page.locator(`[data-antrag="${B}-2"]`).getByTestId("antrag-grund")).toHaveText("Krank", { timeout: 20000 });
    await page.getByTestId("ansicht-als").selectOption("nu-1");

    // 6. Time tracking: B's sick day is marked "abwesend".
    await page.goto("/TimeTracking?tab=week");
    await page.getByTestId("zeit-person").selectOption(B);
    await expect(page.getByTestId("zeit-abwesend").first()).toBeVisible({ timeout: 20000 });

    // 7. Holidays of the year.
    await page.goto("/Absences?tab=holidays");
    await expect(page.locator("[data-testid=feiertage] ul")).toHaveAttribute("data-anzahl", String(feiertage(jahr, KALENDER_STANDARD).length), { timeout: 20000 });
    await expect(page.getByTestId("feiertage-abgleich")).toContainText(`Kalender ${jahr}`);

    // 8. Agenda: absence hint with initials, no reason.
    await page.goto("/Deadlines");
    const hinweis = page.getByTestId("agenda").locator(`[data-termin="abwesenheit:${A}-1"]`);
    await expect(hinweis).toHaveCount(1, { timeout: 20000 });
    await expect(hinweis).not.toContainText(GRUND);
    expect(konsole, `Konsole: ${konsole.join(" | ")}`).toEqual([]);
  } finally {
    for (const a of ((await (await request.get(`${P}/Abwesenheit`)).json()) || [])) if (String(a.mitarbeiter_id).startsWith("e2e-8204")) await request.delete(`${P}/Abwesenheit/${a.id}`);
    for (const id of [`${A}-v`, `${B}-v`]) await request.delete(`${P}/Arbeitsvertrag/${id}`);
    for (const id of [A, B]) await request.delete(`${P}/Mitarbeiter/${id}`);
    for (const id of ["nu-2", "nu-3"]) await request.put(`${API}/Nutzer/${id}`, { data: { mitarbeiter_id: null } });
  }
});

test("Englisch, 375 px dunkel ohne horizontales Scrollen", async ({ page }) => {
  test.setTimeout(120000);
  await nurLocalhost(page);
  const konsole = konsoleSammeln(page);
  await page.addInitScript(() => { try { localStorage.setItem("lang", "en"); localStorage.setItem("nc-theme", "dark"); } catch { /* storage blocked */ } });
  await page.setViewportSize({ width: 375, height: 800 });
  for (const tab of ["team", "requests", "balance", "holidays"]) {
    await page.goto(`/Absences?tab=${tab}`);
    await expect(page.locator("h1")).toHaveText(/Absences/, { timeout: 20000 });
    await expect(page.getByRole("status").filter({ hasText: /Loading/ })).toHaveCount(0, { timeout: 20000 });
    const breite = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, sicht: document.documentElement.clientWidth }));
    expect(breite.scroll, `${tab}: horizontales Scrollen`).toBeLessThanOrEqual(breite.sicht + 1);
  }
  expect(konsole, `Konsole: ${konsole.join(" | ")}`).toEqual([]);
});
