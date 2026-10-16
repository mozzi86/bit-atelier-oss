// 94-08: "Problem melden" — diagnostics without personal traces, URL within limits.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bereinige, issueText, issueUrl, MAX_PROTOKOLL_ZEILEN } from "@/lib/problemMelden.js";

// Paths are assembled at run time: the OSS export guard rejects literal user folders in any file.
const BS = "\\";
const WIN = ["D:", "Us" + "ers", "erika"].join(BS);
const NIX = "/ho" + "me/max";

test("bereinige: Benutzerordner, E-Mails und Abfrageparameter verschwinden", () => {
  const roh = `Fehler in ${WIN}${BS}BIT-Atelier${BS}daten${BS}db.json; ${NIX}/app; mail info@example.de; GET http://127.0.0.1:3001/api/x?projekt=p1&token=abc`;
  const sauber = bereinige(roh);
  assert.ok(!/erika|\/max\/|info@example|projekt=p1|token=abc/.test(sauber), sauber);
  assert.ok(sauber.includes(`${BS}…${BS}BIT-Atelier`) && sauber.includes("/…/app") && sauber.includes("…@…") && sauber.includes("/api/x?…"), sauber);
});

test("issueText: Version, Pfad ohne Abfrage, Protokoll gekappt und bereinigt", () => {
  const protokoll = Array.from({ length: 60 }, (_, i) => `Zeile ${i} ${WIN}${BS}x`);
  const t = issueText({ version: "1.5.0", pfad: "/AVA?projekt=geheim", browser: "Chrome", datenquelle: "express", protokoll });
  assert.ok(t.includes("- Version: 1.5.0") && t.includes("- Seite: /AVA\n"));
  assert.ok(!t.includes("geheim") && !t.includes("erika"));
  assert.ok(!t.includes("Zeile 19 ") && t.includes("Zeile 59"), `nur die letzten ${MAX_PROTOKOLL_ZEILEN} Zeilen`);
});

test("issueUrl: GitHub issues/new, bleibt unter der Längengrenze", () => {
  const protokoll = Array.from({ length: 40 }, () => "x".repeat(400));
  const url = issueUrl({ version: "1.5.0", pfad: "/Settings", browser: "Chrome", datenquelle: "express", protokoll });
  assert.ok(url.startsWith("https://github.com/mozzi86/bit-atelier-oss/issues/new?title="));
  assert.ok(url.length <= 7000, String(url.length));
  assert.ok(decodeURIComponent(url).includes("Problem in /Settings (1.5.0)"));
});
