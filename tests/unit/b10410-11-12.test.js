// B-104-10-11: the update notice links only to a github.com https release page.
// B-104-10-12: a project file is read through one handle that must still be the checked file.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { neuesteVersion } from "../../server/selbstUpdate.js";
import { dateiEinlesen } from "../../server/dateiOeffnenRouter.js";

const antwort = (html_url) => async () => ({ ok: true, status: 200, json: async () => ({ tag_name: "v9.9.9", html_url, assets: [] }) });

describe("B-104-10-11 Release-Seite", () => {
  it("github.com https wird übernommen, alles andere verworfen", async () => {
    assert.equal((await neuesteVersion({ fetchFn: antwort("https://github.com/x/y/releases/tag/v9.9.9") })).seite, "https://github.com/x/y/releases/tag/v9.9.9");
    for (const boese of ["javascript:alert(1)", "http://github.com/x", "https://github.com.evil.example/x", "data:text/html,1"]) {
      assert.equal((await neuesteVersion({ fetchFn: antwort(boese) })).seite, null, boese);
    }
  });
});

describe("B-104-10-12 Datei über ein Handle", () => {
  it("ein Link statt der geprüften Datei wird abgewiesen (409)", async (t) => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "bit-b1012-"));
    try {
      const ziel = path.join(d, "ziel.bitproj");
      fs.writeFileSync(ziel, "{}");
      const link = path.join(d, "link.bitproj");
      try { fs.symlinkSync(ziel, link); } catch { t.skip("keine Rechte für symbolische Links auf diesem Rechner"); return; }
      await assert.rejects(dateiEinlesen(link), (e) => e.status === 409);
    } finally { fs.rmSync(d, { recursive: true, force: true }); }
  });
});
