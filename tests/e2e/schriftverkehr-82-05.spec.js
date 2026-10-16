// Phase 82 (82-05): correspondence against the Express dev stack. Replaces the
// planned headless proof n-82-05-schriftverkehr.mjs (no demo build since 83-02);
// the Express sample is relative to the seeding day, so numbers and dates are
// read from the API instead of the reference day 28.09.:
//  1. ?tab=postbuch → tab=register; PE-…-0001 with its reply deadline; the
//     deadline stands in /Deadlines before the reply;
//  2. "Antwort schreiben" → recipient with address from the address book,
//     subject "Ihr Schreiben vom … – Rückfrage Bemusterung Fassade", no [[fehlt mark;
//  3. "Festschreiben" → download, PDF text with subject and recipient; Document
//     Postausgang in 09_Schriftverkehr/Ausgang with data URL and SHA-256 of the bytes;
//  4. "Als versendet markieren" → next PA number with schreiben_id, pb-1
//     settled, the deadline is gone from /Deadlines;
//  5. reload → letter read-only, no delete;
//  6. free office letter to "Şahin" → "1 Zeichen ersetzt", PDF text "Sahin",
//     Document bereich 'schriftverkehr' without project; no area "Personal";
//  7. incoming mail with a scan → next PE number, Document in 09_Schriftverkehr/Eingang;
//  8. dunning letter from accounting → 79's text with the invoice number (skipped
//     with a note when the active project has no overdue invoice);
//  9. "Ansicht als" needs 82-02 — UEBERSPRUNGEN (Spur A, E-17); the export rows
//     are proven by tests/unit/exportBereiche.test.js, the Document rows need
//     dokumentBereiche of 82-02 — UEBERSPRUNGEN (dokumentBereiche, Spur A);
// 10. English, 375 px dark without horizontal scroll, console clean.
// Everything the spec creates is deleted in `finally`; pb-1 is reopened.
import { test, expect } from "@playwright/test";
import { Buffer } from "node:buffer";
import crypto from "node:crypto";
import fs from "node:fs";
import { ERLAUBT_OFFLINE, nurLocalhost } from "./fixtures/massing.js";

const API = "/api/entities";
const SAMMLUNGEN = ["Schreiben", "Postbucheintrag", "Document", "ProjectFolder", "Briefvorlage"];

/** @param {import("@playwright/test").APIRequestContext} request @param {string} e */
const liste = async (request, e) => { const r = await (await request.get(`${API}/${e}`)).json(); return Array.isArray(r) ? r : []; };

/** @param {string} iso 'YYYY-MM-DD' @returns {string} 'DD.MM.YYYY' */
const deDatum = (iso) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

/**
 * Collects console errors/warnings and page errors (offline noise excluded).
 * @param {import("@playwright/test").Page} page
 */
function konsoleSammeln(page) {
  const meldungen = [];
  page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !ERLAUBT_OFFLINE.test(m.text())) meldungen.push(m.text()); });
  page.on("pageerror", (e) => meldungen.push(`pageerror ${e}`));
  return meldungen;
}

/** Text of a PDF (all pages joined by "|"). @param {Buffer} bytes */
async function pdfText(bytes) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), standardFontDataUrl: "node_modules/pdfjs-dist/standard_fonts/", useSystemFonts: false }).promise;
  const teile = [];
  for (let n = 1; n <= doc.numPages; n++) teile.push(...(await (await doc.getPage(n)).getTextContent()).items.map((/** @type {any} */ i) => i.str));
  return teile.join("|");
}

/** Next number of a register range from the stored entries. */
function naechste(/** @type {any[]} */ eintraege, /** @type {string} */ praefix, /** @type {string} */ jahr) {
  const n = eintraege.map((e) => String(e.nummer || "")).filter((x) => x.startsWith(`${praefix}-${jahr}-`)).map((x) => Number(x.slice(-4))).reduce((a, b) => Math.max(a, b), 0);
  return `${praefix}-${jahr}-${String(n + 1).padStart(4, "0")}`;
}

/** @param {import("@playwright/test").Page} page */
async function festschreibenMitDownload(page) {
  await page.getByTestId("schreiben-festschreiben").click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("bestaetigung-ok").click()]);
  return fs.readFileSync(/** @type {string} */ (await download.path()));
}

test("Antwort, Festschreiben, Versand, Postbuch-Frist, Büro-Brief mit Umschrift, Posteingang mit Scan, Mahnung", async ({ page, request }) => {
  test.setTimeout(240000);
  /** @type {Record<string, Set<string>>} */
  const vorher = {};
  for (const e of SAMMLUNGEN) vorher[e] = new Set((await liste(request, e)).map((x) => x.id));
  const pb1 = (await liste(request, "Postbucheintrag")).find((x) => x.id === "pb-1");
  test.skip(!pb1, "Saat ohne pb-1 — npm run seed im Worktree");
  if (pb1.erledigt_am) await request.put(`${API}/Postbucheintrag/pb-1`, { data: { erledigt_am: null } });
  const kontakt = await (await request.get(`${API}/Contact/${pb1.partner_contact_id}`)).json();
  try {
    await nurLocalhost(page);
    const konsole = konsoleSammeln(page);

    // 1. Alias postbuch → register; the reply deadline of PE-…-0001; it stands in the agenda.
    await page.goto("/Deadlines");
    await expect(page.getByTestId("agenda").locator('[data-termin^="postbuch:pb-1:antwort"]')).toHaveCount(1, { timeout: 20000 });
    await page.goto("/Correspondence?tab=postbuch");
    await expect(page).toHaveURL(/tab=register/);
    const zeile = page.locator(`[data-testid="postbuch-zeile"][data-nummer="${pb1.nummer}"]`);
    await expect(zeile.getByTestId("postbuch-frist")).toHaveText(pb1.frist, { timeout: 20000 });

    // 2. Reply: recipient with address, subject from the incoming mail, no missing mark.
    await zeile.getByTestId("postbuch-antwort").click();
    const editor = page.getByTestId("schreiben-editor");
    await expect(editor).toBeVisible();
    await expect(editor.getByTestId("empfaenger-firma")).toHaveValue(kontakt.company);
    await expect(editor.getByTestId("empfaenger-strasse")).toHaveValue(kontakt.address);
    const betreff = `Ihr Schreiben vom ${deDatum(pb1.datum)} – Rückfrage Bemusterung Fassade`;
    await expect(editor.getByTestId("schreiben-betreff")).toHaveValue(betreff);
    await expect(editor.getByTestId("fehlt-marke")).toHaveCount(0);
    await expect(editor.getByTestId("schreiben-bereich").locator("option")).toHaveText(["Projekt", "Büro (ohne Projekt)", "Buchhaltung (ohne Projekt)"]);

    // 3. Freeze → download; filed with bytes and hash in 09_Schriftverkehr/Ausgang.
    const bytes = await festschreibenMitDownload(page);
    const text = await pdfText(bytes);
    expect(text).toContain(betreff);
    expect(text).toContain(kontakt.company);
    await expect(editor).toHaveAttribute("data-status", "festgeschrieben", { timeout: 15000 });
    const schreiben = (await liste(request, "Schreiben")).filter((s) => !vorher.Schreiben.has(s.id));
    expect(schreiben.length).toBe(1);
    const brief = schreiben[0];
    expect(brief.pdf_sha256).toBe(crypto.createHash("sha256").update(bytes).digest("hex"));
    const doc = await (await request.get(`${API}/Document/${brief.document_id}`)).json();
    expect(doc.type).toBe("Postausgang");
    expect(doc.bereich).toBe("projekt");
    expect(String(doc.data).startsWith("data:application/pdf;base64,")).toBe(true);
    expect(doc.sha256).toBe(brief.pdf_sha256);
    expect(Buffer.from(String(doc.data).split(",")[1], "base64").equals(bytes)).toBe(true);
    const ordner = await liste(request, "ProjectFolder");
    const ausgang = ordner.find((o) => o.id === doc.folder_id);
    expect(ausgang?.name).toBe("Ausgang");
    expect(ordner.find((o) => o.id === ausgang?.parent_id)?.name).toBe("09_Schriftverkehr");

    // 4. Sent → next PA number with the letter; pb-1 settled; the deadline is gone from the agenda.
    const paErwartet = naechste(await liste(request, "Postbucheintrag"), "PA", new Date().toISOString().slice(0, 4));
    await editor.getByTestId("versandweg").selectOption("brief");
    await editor.getByTestId("schreiben-versendet").click();
    await expect(editor).toHaveAttribute("data-status", "versendet", { timeout: 15000 });
    const pa = (await liste(request, "Postbucheintrag")).find((e) => e.schreiben_id === brief.id);
    expect(pa?.nummer).toBe(paErwartet);
    expect((await (await request.get(`${API}/Postbucheintrag/pb-1`)).json()).erledigt_am).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await page.keyboard.press("Escape");
    await page.goto("/Deadlines");
    await expect(page.getByTestId("agenda").locator("[data-termin]").first()).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId("agenda").locator('[data-termin^="postbuch:pb-1:antwort"]')).toHaveCount(0);

    // 5. Reload → read-only, no delete.
    await page.goto("/Correspondence?tab=letters");
    await page.getByTestId("schreiben-filter").selectOption("alle");
    await page.locator(`[data-schreiben="${brief.id}"]`).getByRole("button").click();
    await expect(editor).toHaveAttribute("data-status", "versendet");
    await expect(editor.getByTestId("schreiben-text")).toHaveCount(0);
    await expect(editor.getByRole("button", { name: "Löschen" })).toHaveCount(0);
    await page.keyboard.press("Escape");

    // 6. Free office letter to "Şahin": one character replaced, PDF says "Sahin", filed without project.
    await page.getByTestId("schreiben-neu").click();
    await editor.getByTestId("schreiben-bereich").selectOption("buero");
    await editor.getByTestId("empfaenger-name").fill("Şahin");
    await editor.getByTestId("empfaenger-strasse").fill("Musterweg 1");
    await editor.getByTestId("empfaenger-ort").fill("Musterstadt");
    await editor.getByTestId("schreiben-betreff").fill("E2E Büro-Brief 82-05");
    await expect(editor.getByTestId("zeichen-ersetzt")).toHaveText("1 Zeichen ersetzt");
    const bytes2 = await festschreibenMitDownload(page);
    expect(await pdfText(bytes2)).toContain("Sahin");
    await expect(editor).toHaveAttribute("data-status", "festgeschrieben", { timeout: 15000 });
    const buero = (await liste(request, "Schreiben")).find((s) => s.betreff === "E2E Büro-Brief 82-05");
    const doc2 = await (await request.get(`${API}/Document/${buero.document_id}`)).json();
    expect([doc2.bereich, doc2.project_id ?? null, doc2.folder_id ?? null]).toEqual(["schriftverkehr", null, null]);
    await page.keyboard.press("Escape");

    // 7. Incoming mail with a scan.
    const peErwartet = naechste(await liste(request, "Postbucheintrag"), "PE", new Date().toISOString().slice(0, 4));
    await page.goto("/Correspondence?tab=register");
    await page.getByTestId("posteingang-neu").click();
    const post = page.getByTestId("post-dialog");
    await post.getByTestId("post-partner").fill("Firma Beispiel");
    await post.getByTestId("post-betreff").fill("E2E Posteingang 82-05");
    await post.getByTestId("post-bereich").selectOption("projekt");
    await post.getByTestId("post-projekt").selectOption({ index: 1 });
    await post.getByTestId("post-scan").setInputFiles({ name: "scan-probe.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%E2E scan probe\n%%EOF\n") });
    await post.getByTestId("post-speichern").click();
    await expect(page.locator(`[data-testid="postbuch-zeile"][data-nummer="${peErwartet}"]`)).toHaveCount(1, { timeout: 15000 });
    const pe = (await liste(request, "Postbucheintrag")).find((e) => e.nummer === peErwartet);
    const scanDoc = await (await request.get(`${API}/Document/${pe.document_id}`)).json();
    expect(scanDoc.type).toBe("Posteingang");
    expect((await liste(request, "ProjectFolder")).find((o) => o.id === scanDoc.folder_id)?.name).toBe("Eingang");

    // 8. Dunning letter from accounting (79's text): an unpaid overdue invoice of the sample, its project selected.
    const heuteIso = new Date().toISOString().slice(0, 10);
    const offen = (await liste(request, "Ausgangsrechnung")).find((r) => r.status === "gestellt" && !(r.zahlungen || []).length && r.faellig_am && r.faellig_am < heuteIso && r.project_id);
    if (offen) {
      await page.goto(`/Accounting?tab=invoices&projekt=${offen.project_id}`);
      const mahnZeile = page.locator("tr", { hasText: offen.nummer }).filter({ has: page.getByTestId("mahnung-schriftverkehr") });
      await expect(mahnZeile).toHaveCount(1, { timeout: 20000 });
      const nummer = offen.nummer;
      await mahnZeile.getByTestId("mahnung-schriftverkehr").click();
      await expect(page).toHaveURL(/\/Correspondence/);
      await expect(editor).toBeVisible({ timeout: 20000 });
      // The dunning text is built once the books have loaded — slow in a long serial run.
      await expect(editor.getByTestId("schreiben-text")).toHaveValue(new RegExp(nummer), { timeout: 20000 });
      await expect(editor.getByTestId("fehlt-marke")).toHaveCount(0);
      await expect(editor.getByTestId("richtwert-hinweis")).toBeVisible();
      await page.keyboard.press("Escape");
    } else {
      test.info().annotations.push({ type: "SKIP_79", description: "keine unbezahlte überfällige Rechnung in der Saat" });
    }
    test.info().annotations.push({ type: "UEBERSPRUNGEN", description: "Ansicht als (Spur A, E-17); dokumentBereiche im Export (82-02)" });
    expect(konsole, `Konsole: ${konsole.join(" | ")}`).toEqual([]);
  } finally {
    for (const e of SAMMLUNGEN) {
      for (const x of await liste(request, e)) if (!vorher[e].has(x.id)) await request.delete(`${API}/${e}/${x.id}`);
    }
    await request.put(`${API}/Postbucheintrag/pb-1`, { data: { erledigt_am: null } });
  }
});

test("Englisch, 375 px dunkel ohne horizontales Scrollen", async ({ page }) => {
  test.setTimeout(120000);
  await nurLocalhost(page);
  const konsole = konsoleSammeln(page);
  await page.addInitScript(() => { try { localStorage.setItem("lang", "en"); localStorage.setItem("nc-theme", "dark"); } catch { /* storage blocked */ } });
  await page.setViewportSize({ width: 375, height: 800 });
  for (const tab of ["letters", "register", "templates"]) {
    await page.goto(`/Correspondence?tab=${tab}`);
    await expect(page.locator("h1")).toHaveText(/Correspondence/, { timeout: 20000 });
    await expect(page.getByRole("status").filter({ hasText: /Loading/ })).toHaveCount(0, { timeout: 20000 });
    const breite = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, sicht: document.documentElement.clientWidth }));
    expect(breite.scroll, `${tab}: horizontales Scrollen`).toBeLessThanOrEqual(breite.sicht + 1);
  }
  expect(konsole, `Konsole: ${konsole.join(" | ")}`).toEqual([]);
});
