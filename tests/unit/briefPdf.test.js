// 82-05 Task 4: the letter core with 82's options — reply letter with fixed id
// (same bytes, same SHA-256), DIN 5008 positions read back through pdfjs, office
// line on every page, page numbers on follow pages, protocol variant with
// distribution list and a TOP table split with repeated head, transliteration
// of 81-03. Text snapshot (line, position rounded to mm, page) — never a byte
// snapshot. BRIEF_SNAPSHOT_SCHREIBEN=1 renews the snapshot and fails once.
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { briefLayout, DIN5008 } from "@core/lib/brief/briefLayout.js";
import { erzeugeBriefPdf } from "@core/lib/brief/briefPdf.js";
import { ersetzeNichtWinAnsi } from "@core/lib/brief/winAnsi.js";
import { briefModell, dateiIdAus } from "@core/lib/brief/schreiben.js";
import { fuellePlatzhalter } from "@core/lib/brief/platzhalter.js";
import { BRIEFARTEN } from "@core/lib/brief/vorlagen.js";

const SNAPSHOT = new URL("./snapshots/brief-antwort.txt", import.meta.url);
const sha = (/** @type {Uint8Array} */ b) => crypto.createHash("sha256").update(b).digest("hex");
const BRIEFKOPF = { office: "Büro Beispiel", tagline: "", address: "Beispielweg 1\n90000 Musterstadt", contact: "Tel. 0000 000000" };

/**
 * Text items with positions in mm, y measured from the top edge.
 * @param {Uint8Array} bytes
 * @returns {Promise<Array<{seite: number, text: string, x: number, y: number}>>}
 */
async function pdfTexte(bytes) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: bytes.slice(), standardFontDataUrl: "node_modules/pdfjs-dist/standard_fonts/", useSystemFonts: false }).promise;
  const aus = [];
  const mm = (/** @type {number} */ pt) => (pt * 25.4) / 72;
  for (let n = 1; n <= doc.numPages; n++) {
    const inhalt = await (await doc.getPage(n)).getTextContent();
    for (const item of /** @type {any[]} */ (inhalt.items)) {
      if (!item.str || !item.str.trim()) continue;
      aus.push({ seite: n, text: item.str, x: mm(item.transform[4]), y: 297 - mm(item.transform[5]) });
    }
  }
  return aus;
}

/** The reply to PE-2026-0001 as the editor builds it (template antwort, recipient snapshot of c-3). */
function antwortSchreiben() {
  const v = BRIEFARTEN.antwort;
  const daten = { postbuch: { datum: "2026-09-21", betreff: "Rückfrage Bemusterung Fassade" } };
  return {
    betreff: fuellePlatzhalter(v.betreff, daten).text,
    text: fuellePlatzhalter(v.text, daten).text.replace("\n\n\n\n", "\n\nWir melden uns zur Bemusterung bis Ende der Woche.\n\n"),
    empfaenger: { firma: "Stadtwerke Musterstadt", name: "Kontakt Beispiel", strasse: "Am Werk 3", plz: "90001", ort: "Musterstadt" },
    anlagen: [],
  };
}

const FIX = async () => ({ erstelltAm: "2026-09-28T09:15:00+02:00", dateiId: await dateiIdAus("sc-test") });

test("Antwortbrief: zweimal mit fixiert → identischer SHA-256; DIN-5008-Lagen; Büro-Fußzeile", async () => {
  const modell = briefModell(antwortSchreiben(), { briefkopf: BRIEFKOPF, datumText: "28.09.2026" });
  const fixiert = await FIX();
  const a = await erzeugeBriefPdf(briefLayout(/** @type {any} */ (modell)), { fixiert });
  const b = await erzeugeBriefPdf(briefLayout(/** @type {any} */ (modell)), { fixiert });
  assert.equal(sha(a), sha(b));

  const texte = await pdfTexte(a);
  const A = DIN5008.anschrift;
  for (const z of ["Stadtwerke Musterstadt", "Kontakt Beispiel", "Am Werk 3", "90001 Musterstadt"]) {
    const t = texte.find((x) => x.text === z);
    assert.ok(t, z);
    assert.ok(t.x >= A.x - 0.5 && t.x <= A.x + A.w, `${z}: x ${t.x}`);
    assert.ok(t.y >= A.y - 0.5 && t.y <= A.y + A.h, `${z}: y ${t.y}`);
  }
  const betreff = texte.find((x) => x.text === "Ihr Schreiben vom 21.09.2026 – Rückfrage Bemusterung Fassade");
  assert.ok(betreff, "Betreff");
  assert.ok(betreff.y > A.y + A.h, "Betreff unter dem Anschriftfeld");
  const fuss = texte.filter((x) => x.text.startsWith("Büro Beispiel · ") && x.y > 297 - DIN5008.randUnten);
  assert.equal(fuss.length, 1);
  assert.ok(fuss[0].y > 297 - DIN5008.randUnten, "Büro-Zeile im unteren Rand");
});

test("80 Absätze mit Seitenzahlen: ≥ 2 Seiten, „Seite n von n“, Büro-Zeile auf jeder Seite, unterhalb der Grenze nur Fußzeilen", async () => {
  const s = { ...antwortSchreiben(), text: Array.from({ length: 80 }, (_, i) => `Absatz ${i + 1} mit etwas Text.`).join("\n") };
  const layout = briefLayout(/** @type {any} */ (briefModell(s, { briefkopf: BRIEFKOPF, datumText: "28.09.2026" })));
  const n = layout.seiten.length;
  assert.ok(n >= 2);
  const texte = await pdfTexte(await erzeugeBriefPdf(layout));
  assert.ok(texte.some((x) => x.seite === n && x.text === `Seite ${n} von ${n}`));
  for (let i = 1; i <= n; i++) assert.ok(texte.some((x) => x.seite === i && x.y > 280 && x.text.startsWith("Büro Beispiel · ")), `Seite ${i}`);
  const grenze = 297 - DIN5008.randUnten;
  for (const x of texte.filter((t) => t.y > grenze + 0.5)) assert.ok(x.text.startsWith("Büro Beispiel · ") || /^Seite \d+ von \d+$/.test(x.text), x.text);
});

test("Variante verteiler: kein Anschriftfeld, „Verteiler:“ mit Liste, TOP-Tabelle mit wiederholtem Kopf auf der Folgeseite", async () => {
  const kopf = ["TOP", "Thema", "Wer", "Bis"];
  const zeilen = Array.from({ length: 70 }, (_, i) => [String(i + 1), `Thema ${i + 1}`, "Bauleitung", "30.09.2026"]);
  const layout = briefLayout({ absender: ["Büro Beispiel"], empfaenger: ["Darf nicht erscheinen"], datum: "28.09.2026", betreff: "Protokoll Jour fixe",
    absaetze: ["Projekt: Beispielprojekt"], variante: "verteiler", verteiler: ["Bauherr", "Tragwerksplanung"],
    tabelle: { kopf, zeilen, spalten: [{ breite_mm: 15, ausrichtung: "links" }, { breite_mm: 90, ausrichtung: "links" }, { breite_mm: 35, ausrichtung: "links" }, { breite_mm: 25, ausrichtung: "rechts" }] },
    seitenzahlen: true });
  assert.deepEqual(layout.empfaenger, []);
  assert.equal(layout.variante, "verteiler");
  assert.deepEqual(layout.seiten[0].zeilen.slice(0, 3), ["Verteiler:", "- Bauherr", "- Tragwerksplanung"]);
  const mitTabelle = layout.seiten.filter((s) => s.tabelle);
  assert.ok(mitTabelle.length >= 2);
  for (const s of mitTabelle) assert.deepEqual(s.tabelle?.kopf, kopf);
  const texte = await pdfTexte(await erzeugeBriefPdf(layout));
  assert.ok(!texte.some((x) => x.text === "Darf nicht erscheinen"));
  const folge = mitTabelle[1].nummer;
  assert.ok(texte.some((x) => x.seite === folge && x.text === "Thema"), "Kopf auf der Folgeseite");
});

test("ohne die 82-Optionen bleibt das Modell unverändert (keine neuen Schlüssel)", () => {
  const ein = { absender: ["A"], empfaenger: ["B", "C"], datum: "1", betreff: "x", absaetze: ["y"], seitenzahlen: true };
  const ohne = briefLayout(ein);
  const leer = briefLayout({ ...ein, variante: null, verteiler: [], fusszeileLinks: "" });
  assert.deepEqual(leer, ohne);
  assert.ok(!("variante" in ohne) && !("verteiler" in ohne));
  assert.ok(ohne.seiten.every((s) => !("fussLinks" in s)));
});

test("Umschrift aus 81-03: mit Option transliteriert, ohne Option das 79-Verhalten", () => {
  assert.deepEqual(ersetzeNichtWinAnsi("Şahin → Łódź, Müller", { umschrift: true }), { text: "Sahin -> Lódz, Müller", ersetzt: 4, zeichen: ["Ş", "→", "Ł", "ź"] });
  const ohne = ersetzeNichtWinAnsi("Şahin");
  assert.deepEqual(ohne, { text: "?ahin", ersetzt: 1 });
});

test("Text-Snapshot brief-antwort.txt (Zeile, Lage auf mm gerundet, Seite)", async () => {
  const modell = briefModell(antwortSchreiben(), { briefkopf: BRIEFKOPF, datumText: "28.09.2026" });
  const texte = await pdfTexte(await erzeugeBriefPdf(briefLayout(/** @type {any} */ (modell)), { fixiert: await FIX() }));
  const ist = texte.map((t) => `${t.seite}|${Math.round(t.x)}|${Math.round(t.y)}|${t.text}`).join("\n") + "\n";
  if (process.env.BRIEF_SNAPSHOT_SCHREIBEN === "1" || !fs.existsSync(SNAPSHOT)) {
    fs.mkdirSync(new URL("./snapshots/", import.meta.url), { recursive: true });
    fs.writeFileSync(SNAPSHOT, ist);
    assert.fail("Snapshot brief-antwort.txt neu geschrieben — Lauf ohne BRIEF_SNAPSHOT_SCHREIBEN wiederholen");
  }
  assert.equal(ist, fs.readFileSync(SNAPSHOT, "utf8"));
});
