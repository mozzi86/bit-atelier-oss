// Unit tests for plan 92-04 (changelog → release notes → update banner, opt-out, "hold this version"):
// tools/changelog-abschnitt.mjs (section extraction + CLI exit codes), the real CHANGELOG.md has a section
// for the version in package.json, the release workflow uses the section and the marker the server cuts
// at, server helpers (aenderungenAusNotiz, updateCheckAus, settings file, hold date inclusive), the router
// (BIT_KEIN_UPDATECHECK never contacts GitHub, automatic check off, hold date blocks banner + install,
// settings PUT with Origin check and validation), and the banner's note parser (src/lib/updateNotizen.js).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import express from "express";

import { abschnitt, versionen, versionAusUeberschrift } from "../../tools/changelog-abschnitt.mjs";
import {
  NOTIZ_MARKE, aenderungenAusNotiz, updateCheckAus, einstellungenPruefen, einstellungenLesen, einstellungenSchreiben,
  istFestgehalten, heuteLokal,
} from "../../server/selbstUpdate.js";
import { updateRouter } from "../../server/updateRouter.js";
import { notizZeilen, ersteZeilen } from "@/lib/updateNotizen";

const WURZEL = process.cwd();
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "bit-upd4-"));

const BEISPIEL = [
  "# Änderungsliste", "", "## [Unveröffentlicht]", "", "### Neu", "", "- kommt noch", "",
  "## [1.2.0] - 2026-11-02", "", "### Neu", "", "- **GAEB** X86-Export", "  mit Zeilenumbruch", "- Zweiter Punkt", "",
  "### Behoben", "", "- Dritter Punkt", "",
  "## [1.1.0] – 2026-10-11", "", "- Alt", "",
  "[Unveröffentlicht]: https://example.com/compare", "[1.2.0]: https://example.com/v1.2.0", "",
].join("\n");

/** Fake GitHub release API with a counter. */
function fakeGithub({ version = "1.2.0", body = "" } = {}) {
  const f = async (url) => {
    f.aufrufe += 1;
    if (String(url).includes("/releases/latest")) {
      return new Response(JSON.stringify({
        tag_name: `v${version}`, published_at: "2026-11-02T10:00:00Z", body, html_url: `https://github.com/x/y/releases/tag/v${version}`,
        assets: [
          { name: "BIT-Atelier.zip", size: 10, browser_download_url: "https://github.com/x/y/releases/download/v/BIT-Atelier.zip" },
          { name: "BIT-Atelier.zip.sha256", size: 80, browser_download_url: "https://github.com/x/y/releases/download/v/BIT-Atelier.zip.sha256" },
        ],
      }), { status: 200 });
    }
    return new Response("nope", { status: 404 });
  };
  f.aufrufe = 0;
  return f;
}

async function mitServer(router, fn) {
  const app = express(); app.use("/api", router);
  const srv = app.listen(0, "127.0.0.1");
  await new Promise((r) => srv.once("listening", r));
  try { return await fn(`http://127.0.0.1:${/** @type {any} */ (srv.address()).port}`); } finally { srv.close(); }
}

describe("changelog-abschnitt.mjs", () => {
  it("extracts a version section without heading and link references", () => {
    assert.equal(abschnitt(BEISPIEL, "1.2.0"), "### Neu\n\n- **GAEB** X86-Export\n  mit Zeilenumbruch\n- Zweiter Punkt\n\n### Behoben\n\n- Dritter Punkt");
    assert.equal(abschnitt(BEISPIEL, "v1.2.0"), abschnitt(BEISPIEL, "1.2.0"));
    assert.equal(abschnitt(BEISPIEL, "1.1.0"), "- Alt", "en dash before the date, link block ends the last section");
    assert.equal(abschnitt(BEISPIEL, "Unveröffentlicht"), "### Neu\n\n- kommt noch");
    assert.equal(abschnitt(BEISPIEL, "9.9.9"), null);
    assert.deepEqual(versionen(BEISPIEL), ["unveröffentlicht", "1.2.0", "1.1.0"]);
    assert.equal(versionAusUeberschrift("### Neu"), null);
    assert.equal(abschnitt(BEISPIEL.replace(/\n/g, "\r\n"), "1.1.0"), "- Alt", "CRLF files work too");
  });

  it("the real CHANGELOG.md has a non-empty section for the version in package.json", () => {
    const text = fs.readFileSync(path.join(WURZEL, "CHANGELOG.md"), "utf8");
    const version = JSON.parse(fs.readFileSync(path.join(WURZEL, "package.json"), "utf8")).version;
    assert.ok(abschnitt(text, version), `CHANGELOG.md braucht einen Abschnitt „## [${version}] - <Datum>“`);
    for (const v of ["1.0.0", "1.0.1", "1.1.0"]) assert.ok(abschnitt(text, v), v);
  });

  it("CLI prints the section (exit 0) and stops a release without one (exit 1)", () => {
    const datei = path.join(tmp(), "CHANGELOG.md");
    fs.writeFileSync(datei, BEISPIEL);
    const ok = spawnSync(process.execPath, [path.join(WURZEL, "tools", "changelog-abschnitt.mjs"), "v1.2.0", "--datei", datei], { encoding: "utf8" });
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /^### Neu\n\n- \*\*GAEB\*\*/);
    const fehlt = spawnSync(process.execPath, [path.join(WURZEL, "tools", "changelog-abschnitt.mjs"), "3.0.0", "--datei", datei], { encoding: "utf8" });
    assert.equal(fehlt.status, 1);
    assert.match(fehlt.stderr, /no section for version 3\.0\.0/);
  });

  it("the release workflow builds its notes from the changelog with the marker the server cuts at", () => {
    // Private repo: oss/.github/…; public export: the overlay is the root.
    const privat = path.join(WURZEL, "oss", ".github", "workflows", "release.yml");
    const yml = fs.readFileSync(fs.existsSync(privat) ? privat : path.join(WURZEL, ".github", "workflows", "release.yml"), "utf8");
    assert.match(yml, /node tools\/changelog-abschnitt\.mjs "\$\{GITHUB_REF_NAME#v\}" > notes\.md/);
    assert.ok(yml.includes(NOTIZ_MARKE), "marker in release.yml = NOTIZ_MARKE");
    assert.match(yml, /--notes-file notes\.md/);
    assert.doesNotMatch(yml, /--notes "/);
  });
});

describe("selbstUpdate 92-04 helpers", () => {
  it("cuts the release note at the marker; old notes come back whole", () => {
    assert.equal(aenderungenAusNotiz(`### Neu\n\n- A\n\n${NOTIZ_MARKE}\n---\n**Installation** …`), "### Neu\n\n- A");
    assert.equal(aenderungenAusNotiz("Windows: download …"), "Windows: download …");
    assert.equal(aenderungenAusNotiz(null), "");
  });

  it("reads BIT_KEIN_UPDATECHECK", () => {
    assert.equal(updateCheckAus({ BIT_KEIN_UPDATECHECK: "1" }), true);
    assert.equal(updateCheckAus({ BIT_KEIN_UPDATECHECK: "true" }), true);
    assert.equal(updateCheckAus({ BIT_KEIN_UPDATECHECK: "0" }), false);
    assert.equal(updateCheckAus({}), false);
  });

  it("validates, stores and reads the settings file; a broken file gives the defaults", () => {
    assert.deepEqual(einstellungenPruefen({ festhaltenBis: "2026-12-01" }), { ok: true, werte: { festhaltenBis: "2026-12-01" } });
    assert.deepEqual(einstellungenPruefen({ festhaltenBis: "" }), { ok: true, werte: { festhaltenBis: null } });
    assert.equal(einstellungenPruefen({ festhaltenBis: "01.12.2026" }).ok, false);
    assert.equal(einstellungenPruefen({ automatisch: "nein" }).ok, false);
    assert.equal(einstellungenPruefen([]).ok, false);
    const datei = path.join(tmp(), "daten", "update-einstellungen.json");
    assert.deepEqual(einstellungenLesen(datei), { automatisch: true, festhaltenBis: null });
    einstellungenSchreiben(datei, { festhaltenBis: "2026-12-01" });
    assert.deepEqual(einstellungenSchreiben(datei, { automatisch: false }), { automatisch: false, festhaltenBis: "2026-12-01" });
    assert.deepEqual(einstellungenLesen(datei), { automatisch: false, festhaltenBis: "2026-12-01" });
    fs.writeFileSync(datei, "{kaputt");
    assert.deepEqual(einstellungenLesen(datei), { automatisch: true, festhaltenBis: null });
  });

  it("the hold date counts inclusively, in local calendar days", () => {
    const einst = { festhaltenBis: "2026-12-01" };
    assert.equal(istFestgehalten(einst, "2026-12-01"), true);
    assert.equal(istFestgehalten(einst, "2026-11-30"), true);
    assert.equal(istFestgehalten(einst, "2026-12-02"), false);
    assert.equal(istFestgehalten({ festhaltenBis: null }, "2026-12-01"), false);
    assert.equal(heuteLokal(new Date(2026, 0, 5, 23, 59)), "2026-01-05");
  });
});

describe("updateRouter 92-04", () => {
  it("BIT_KEIN_UPDATECHECK: no request to GitHub, no install", async () => {
    const fetchFn = fakeGithub();
    await mitServer(updateRouter({ root: tmp(), port: 4711, appModus: true, version: "1.1.0", fetchFn, deaktiviert: true, starteAnwenden: false }), async (basis) => {
      const info = await (await fetch(`${basis}/api/update?frisch=1`)).json();
      assert.equal(info.deaktiviert, true);
      assert.equal(info.verfuegbar, false);
      const post = await fetch(`${basis}/api/update/installieren`, { method: "POST", headers: { Origin: "http://localhost:4711" } });
      assert.equal(post.status, 409);
    });
    assert.equal(fetchFn.aufrufe, 0);
  });

  it("returns the changelog part of the note, the release page and the time of the last check", async () => {
    const fetchFn = fakeGithub({ body: `### Neu\n\n- Punkt A\n\n${NOTIZ_MARKE}\n---\nInstallation …` });
    await mitServer(updateRouter({ root: tmp(), port: 4711, appModus: true, version: "1.1.0", fetchFn, starteAnwenden: false }), async (basis) => {
      const info = await (await fetch(`${basis}/api/update`)).json();
      assert.equal(info.verfuegbar, true);
      assert.equal(info.aenderungen, "### Neu\n\n- Punkt A");
      assert.equal(info.seite, "https://github.com/x/y/releases/tag/v1.2.0");
      assert.ok(Date.parse(info.letztePruefung) > 0);
      assert.deepEqual(info.einstellungen, { automatisch: true, festhaltenBis: null });
    });
  });

  it("automatic check off: no GitHub request until the user asks; then the result stays visible", async () => {
    const root = tmp();
    einstellungenSchreiben(path.join(root, "daten", "update-einstellungen.json"), { automatisch: false });
    const fetchFn = fakeGithub();
    await mitServer(updateRouter({ root, port: 4711, appModus: true, version: "1.1.0", fetchFn, starteAnwenden: false }), async (basis) => {
      const still = await (await fetch(`${basis}/api/update`)).json();
      assert.equal(still.automatischAus, true);
      assert.equal(fetchFn.aufrufe, 0);
      const manuell = await (await fetch(`${basis}/api/update?frisch=1`)).json();
      assert.equal(manuell.verfuegbar, true);
      assert.equal(fetchFn.aufrufe, 1);
      const danach = await (await fetch(`${basis}/api/update`)).json();
      assert.equal(danach.neueste, "1.2.0");
      assert.equal(fetchFn.aufrufe, 1, "cached result, no new request");
    });
  });

  it("hold date: banner data says festgehalten, install refused; settings PUT checks Origin and input", async () => {
    const root = tmp();
    const jetzt = () => new Date(2026, 10, 20, 12, 0);
    await mitServer(updateRouter({ root, port: 4711, appModus: true, version: "1.1.0", fetchFn: fakeGithub(), starteAnwenden: false, jetzt }), async (basis) => {
      const put = (body, origin = "http://localhost:4711") => fetch(`${basis}/api/update/einstellungen`, { method: "PUT", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(body) });
      assert.equal((await put({ festhaltenBis: "2026-12-01" }, "https://evil.example")).status, 403);
      assert.equal((await put({ festhaltenBis: "1.12.2026" })).status, 400);
      const gespeichert = await (await put({ festhaltenBis: "2026-12-01" })).json();
      assert.equal(gespeichert.festhaltenBis, "2026-12-01");
      assert.ok(fs.existsSync(path.join(root, "daten", "update-einstellungen.json")));
      const info = await (await fetch(`${basis}/api/update`)).json();
      assert.equal(info.festgehalten, true);
      assert.equal(info.installierbar, false);
      assert.match(info.sperre, /festgehalten bis 01\.12\.2026/);
      const post = await fetch(`${basis}/api/update/installieren`, { method: "POST", headers: { Origin: "http://localhost:4711" } });
      assert.equal(post.status, 409);
      assert.match((await post.json()).error, /festgehalten/);
      await put({ festhaltenBis: null });
      const frei = await (await fetch(`${basis}/api/update`)).json();
      assert.equal(frei.festgehalten, false);
      assert.equal(frei.installierbar, true);
      const einst = await (await fetch(`${basis}/api/update/einstellungen`)).json();
      assert.deepEqual(einst, { automatisch: true, festhaltenBis: null, deaktiviert: false });
    });
  });
});

describe("updateNotizen (banner lines)", () => {
  it("parses headings, bullets with continuation lines and inline Markdown", () => {
    const z = notizZeilen("### Neu\n\n- **GAEB** X86-Export\n  mit `Zeilenumbruch`\n- [Link](https://x.y) Text\n\n<!-- k -->\n---\nFließtext");
    assert.deepEqual(z, [
      { art: "kopf", text: "Neu" },
      { art: "punkt", text: "GAEB X86-Export mit Zeilenumbruch" },
      { art: "punkt", text: "Link Text" },
      { art: "text", text: "Fließtext" },
    ]);
    assert.deepEqual(ersteZeilen(z, 2).map((x) => x.text), ["GAEB X86-Export mit Zeilenumbruch", "Link Text"]);
    assert.deepEqual(notizZeilen(""), []);
  });
});
