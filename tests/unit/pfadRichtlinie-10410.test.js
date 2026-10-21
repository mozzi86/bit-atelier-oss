// Unit tests for plan 104-10: the path rule for document references (@core/lib/pfadRichtlinie.js).
// One case per reason, in Windows and POSIX notation, plus file: URLs, roots and embedded content.
// Pure — no file system.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  pfadRichtlinie, pfadErzwingen, dateiUrlZuPfad, imOrdner, inhaltPruefen,
  PFAD_GRUND, PFAD_MELDUNGEN, MAX_PFAD_ZEICHEN,
} from "@core/lib/pfadRichtlinie.js";

const WIN = { plattform: /** @type {const} */ ("win32") };
const POSIX = { plattform: /** @type {const} */ ("posix") };

/** @param {unknown} p @param {object} [o] @returns {string} the reason, or "ok:<path>" */
const grund = (p, o = WIN) => {
  const e = pfadRichtlinie(p, o);
  return e.ok ? `ok:${e.pfad}` : e.grund;
};

describe("pfadRichtlinie — allowed local paths (104-10)", () => {
  it("Windows drive paths, both separators, normalised to backslashes", () => {
    assert.equal(grund("C:\\Projekte\\Musterhaus.bitproj"), "ok:C:\\Projekte\\Musterhaus.bitproj");
    assert.equal(grund("d:/Projekte//Ordner mit Leerzeichen/./a.bitproj"), "ok:d:\\Projekte\\Ordner mit Leerzeichen\\a.bitproj");
    assert.equal(grund("C:\\"), "ok:C:\\");
    assert.equal(grund("C:\\Users\\user\\APPDAT~1\\Local\\Temp\\x.bitproj"), "ok:C:\\Users\\user\\APPDAT~1\\Local\\Temp\\x.bitproj", "8.3 short names");
    assert.equal(grund("C:\\Bauakte\\Ä Ö Ü ß — Plan (Kopie 2026-10-21 0930).bitproj"), "ok:C:\\Bauakte\\Ä Ö Ü ß — Plan (Kopie 2026-10-21 0930).bitproj");
  });

  it("POSIX absolute paths keep backslashes and colons as plain characters", () => {
    assert.equal(grund("/home/nutzer/Projekte/a.bitproj", POSIX), "ok:/home/nutzer/Projekte/a.bitproj");
    assert.equal(grund("/home//nutzer/./a:b.bitproj", POSIX), "ok:/home/nutzer/a:b.bitproj");
    assert.equal(grund("/", POSIX), "ok:/");
  });

  it("auto: a drive letter or a backslash reads as Windows, a slash path as POSIX", () => {
    assert.equal(grund("C:\\x.bitproj", {}), "ok:C:\\x.bitproj");
    assert.equal(grund("/Users/user/x.bitproj", {}), "ok:/Users/user/x.bitproj");
    assert.equal(pfadRichtlinie("C:/x", {}).ok && pfadRichtlinie("C:/x", {}).art, "windows");
  });

  it("file: URLs without a host (or with localhost) become local paths", () => {
    assert.equal(grund("file:///C:/Projekte/Plan%20A.bitproj"), "ok:C:\\Projekte\\Plan A.bitproj");
    assert.equal(grund("FILE:///c:/x.bitproj"), "ok:c:\\x.bitproj");
    assert.equal(grund("file:C:/x.bitproj"), "ok:C:\\x.bitproj");
    assert.equal(grund("file://localhost/C:/x.bitproj"), "ok:C:\\x.bitproj");
    assert.equal(grund("file:///home/user/Plan%C3%A4.bitproj", POSIX), "ok:/home/user/Planä.bitproj");
    assert.equal(grund("file:/home/user/x.bitproj", POSIX), "ok:/home/user/x.bitproj");
  });
});

describe("pfadRichtlinie — refusals, one per reason (104-10)", () => {
  it("empty, not a string, too long", () => {
    for (const p of ["", null, undefined, 42, {}, ["C:\\x"]]) assert.equal(grund(p), PFAD_GRUND.LEER);
    assert.equal(grund(`C:\\${"a".repeat(MAX_PFAD_ZEICHEN)}`), PFAD_GRUND.ZU_LANG);
    assert.equal(grund(`/${"a".repeat(MAX_PFAD_ZEICHEN)}`, POSIX), PFAD_GRUND.ZU_LANG);
  });

  it("control and invisible characters, also percent-encoded in a file: URL", () => {
    assert.equal(grund("C:\\a\u0000b.bitproj"), PFAD_GRUND.STEUERZEICHEN);
    assert.equal(grund("C:\\a\nb.bitproj"), PFAD_GRUND.STEUERZEICHEN);
    assert.equal(grund("/home/user\tb", POSIX), PFAD_GRUND.STEUERZEICHEN);
    assert.equal(grund("/home/user\u007f", POSIX), PFAD_GRUND.STEUERZEICHEN);
    assert.equal(grund("C:\\rechnung\u202efdp.exe"), PFAD_GRUND.STEUERZEICHEN, "right-to-left override");
    assert.equal(grund("C:\\a\u200bb"), PFAD_GRUND.STEUERZEICHEN, "zero width space");
    assert.equal(grund("file:///C:/a%00b.bitproj"), PFAD_GRUND.STEUERZEICHEN);
    assert.equal(grund("file:///home/user%0Ab", POSIX), PFAD_GRUND.STEUERZEICHEN);
  });

  it("other URL schemes", () => {
    for (const p of [
      "http://example.org/x.bitproj", "https://example.org/x.pdf", "smb://server/share/x.bitproj",
      "javascript:alert(1)", "JavaScript:alert(1)", "data:text/html,<b>x</b>", "vbscript:x", "ftp://h/x",
      "ms-word:ofe|u|https://h/x.docx", "search-ms:query=x", "mailto:a@b.c",
    ]) {
      assert.equal(grund(p), PFAD_GRUND.URL_SCHEMA, p);
      assert.equal(grund(p, POSIX), PFAD_GRUND.URL_SCHEMA, `${p} (posix)`);
    }
  });

  it("file: URLs with a host point into the network", () => {
    assert.equal(grund("file://server/share/x.bitproj"), PFAD_GRUND.FILE_HOST);
    assert.equal(grund("file://192.168.0.10/c$/x.bitproj"), PFAD_GRUND.FILE_HOST);
    assert.equal(grund("file:\\\\server\\share\\x.bitproj"), PFAD_GRUND.FILE_HOST, "backslashes count as slashes");
    assert.equal(grund("file://server/share/x", POSIX), PFAD_GRUND.FILE_HOST);
  });

  it("file: URLs that hide a UNC path or are badly encoded", () => {
    assert.equal(grund("file:////server/share/x.bitproj"), PFAD_GRUND.UNC);
    assert.equal(grund("file:///%5C%5Cserver%5Cshare%5Cx.bitproj"), PFAD_GRUND.UNC);
    assert.equal(grund("file:///C:/a%E0%A4%A.bitproj"), PFAD_GRUND.URL_KODIERUNG);
    assert.equal(grund("file:///C:/a%ZZ"), PFAD_GRUND.URL_KODIERUNG);
  });

  it("UNC paths in both notations, refused unless the network is allowed", () => {
    for (const p of ["\\\\server\\share\\x.bitproj", "//server/share/x.bitproj", "\\/server/share", "\\\\192.168.0.10\\c$\\x"]) {
      assert.equal(grund(p), PFAD_GRUND.UNC, p);
      assert.equal(grund(p, POSIX), PFAD_GRUND.UNC, `${p} (posix)`);
      assert.equal(grund(p, {}), PFAD_GRUND.UNC, `${p} (auto)`);
    }
    assert.equal(grund("\\\\server\\share\\Sicherung", { ...WIN, netzwerkErlaubt: true }), "ok:\\\\server\\share\\Sicherung");
    assert.equal(grund("//nas/backup/bit", { ...POSIX, netzwerkErlaubt: true }), "ok:\\\\nas\\backup\\bit");
    assert.equal(grund("\\\\server", { ...WIN, netzwerkErlaubt: true }), PFAD_GRUND.UNC, "server without share");
  });

  it("device and namespace paths, never allowed — not even with the network allowed", () => {
    for (const p of ["\\\\?\\C:\\x.bitproj", "\\\\.\\COM1", "\\\\.\\pipe\\x", "//?/C:/x", "//./PhysicalDrive0", "\\??\\C:\\x", "\\\\?\\UNC\\server\\share\\x", "\\\\?\\GLOBALROOT\\Device\\x"]) {
      assert.equal(grund(p, { ...WIN, netzwerkErlaubt: true }), PFAD_GRUND.GERAET, p);
      assert.equal(grund(p, POSIX), PFAD_GRUND.GERAET, `${p} (posix)`);
    }
    for (const p of ["/dev/zero", "/dev/tcp/1.2.3.4/80", "/proc/self/environ", "/sys/kernel", "/dev"]) {
      assert.equal(grund(p, POSIX), PFAD_GRUND.GERAET, p);
    }
    assert.equal(grund("file:///dev/zero", POSIX), PFAD_GRUND.GERAET);
    assert.equal(grund("/devices/x", POSIX), "ok:/devices/x", "only the tree /dev itself");
  });

  it("Windows device names in any component and with any extension", () => {
    for (const p of ["C:\\CON", "C:\\Projekte\\nul.bitproj", "C:\\x\\COM1\\a", "C:\\LPT9.txt", "C:\\aux .log", "C:\\COM\u00b9", "C:\\conin$", "c:/prn.tar.gz"]) {
      assert.equal(grund(p), PFAD_GRUND.RESERVIERT, p);
    }
    assert.equal(grund("C:\\Console\\nullwert.bitproj"), "ok:C:\\Console\\nullwert.bitproj", "only whole names");
    assert.equal(grund("/home/user/nul.bitproj", POSIX), "ok:/home/user/nul.bitproj", "POSIX has no device names");
  });

  it("characters Windows forbids in names, alternate data streams included", () => {
    for (const p of ["C:\\a<b", "C:\\a>b", "C:\\a\"b", "C:\\a|b", "C:\\a?b", "C:\\a*b", "C:\\x.bitproj:zone.identifier", "C:\\x\\y:$DATA"]) {
      assert.equal(grund(p), PFAD_GRUND.ZEICHEN, p);
    }
  });

  it("names ending in a dot or a space (Windows strips them)", () => {
    assert.equal(grund("C:\\x.bitproj."), PFAD_GRUND.NAME_ENDE);
    assert.equal(grund("C:\\Ordner \\x.bitproj"), PFAD_GRUND.NAME_ENDE);
    assert.equal(grund("/home/user/a./b ", POSIX), "ok:/home/user/a./b ", "legal on POSIX");
  });

  it("drive-relative, drive-less and relative paths", () => {
    assert.equal(grund("C:foo.bitproj"), PFAD_GRUND.LAUFWERK_RELATIV);
    assert.equal(grund("C:"), PFAD_GRUND.LAUFWERK_RELATIV);
    assert.equal(grund("C:..\\x"), PFAD_GRUND.LAUFWERK_RELATIV);
    assert.equal(grund("\\Projekte\\x.bitproj"), PFAD_GRUND.OHNE_LAUFWERK);
    assert.equal(grund("/Projekte/x.bitproj"), PFAD_GRUND.OHNE_LAUFWERK, "a slash path on Windows has no drive");
    for (const p of ["x.bitproj", ".\\x.bitproj", "..\\x", "Projekte/x.bitproj"]) {
      assert.equal(grund(p), PFAD_GRUND.RELATIV, p);
      assert.equal(grund(p, POSIX), PFAD_GRUND.RELATIV, `${p} (posix)`);
    }
    assert.equal(grund("C:\\x", POSIX), PFAD_GRUND.RELATIV, "a Windows path means nothing on POSIX");
    assert.equal(grund("~/x.bitproj", POSIX), PFAD_GRUND.RELATIV, "no shell expansion");
  });

  it("'..' components in every notation", () => {
    assert.equal(grund("C:\\Projekte\\..\\Windows\\x"), PFAD_GRUND.ZURUECK);
    assert.equal(grund("C:/Projekte/../x"), PFAD_GRUND.ZURUECK);
    assert.equal(grund("/home/user/../../etc/passwd", POSIX), PFAD_GRUND.ZURUECK);
    assert.equal(grund("file:///C:/a/%5C..%5Cb"), PFAD_GRUND.ZURUECK, "encoded backslashes reveal '..'");
    assert.equal(grund("C:\\a\\..x\\b..c"), "ok:C:\\a\\..x\\b..c", "dots inside a name are fine");
  });
});

describe("pfadRichtlinie — roots (path traversal)", () => {
  it("inside a root passes, outside is refused, Windows case-insensitive", () => {
    const o = { ...WIN, wurzeln: ["C:\\IFC\\Modelle"] };
    assert.equal(grund("C:\\IFC\\Modelle\\Haus.ifc", o), "ok:C:\\IFC\\Modelle\\Haus.ifc");
    assert.equal(grund("c:/ifc/modelle/haus.ifc", o), "ok:c:\\ifc\\modelle\\haus.ifc");
    assert.equal(grund("C:\\IFC\\Modelle", o), "ok:C:\\IFC\\Modelle", "the root itself");
    assert.equal(grund("C:\\IFC\\Modelle2\\x.ifc", o), PFAD_GRUND.AUSSERHALB, "prefix of a name is not inside");
    assert.equal(grund("D:\\x.ifc", o), PFAD_GRUND.AUSSERHALB);
    assert.equal(grund("C:\\IFC\\Modelle\\..\\Geheim\\x.ifc", o), PFAD_GRUND.ZURUECK, "traversal stops before the root check");
  });

  it("POSIX roots are case-sensitive; several roots; a root on a share", () => {
    const o = { ...POSIX, wurzeln: ["/srv/daten/", "/home/user"] };
    assert.equal(grund("/srv/daten/x", o), "ok:/srv/daten/x");
    assert.equal(grund("/home/user/b/c", o), "ok:/home/user/b/c");
    assert.equal(grund("/SRV/daten/x", o), PFAD_GRUND.AUSSERHALB);
    assert.equal(grund("/srv/datenbank/x", o), PFAD_GRUND.AUSSERHALB);
    assert.equal(grund("\\\\nas\\ifc\\a.ifc", { ...WIN, netzwerkErlaubt: true, wurzeln: ["\\\\NAS\\ifc"] }), "ok:\\\\nas\\ifc\\a.ifc");
    assert.equal(grund("/x", { ...POSIX, wurzeln: ["relativ/ordner"] }), PFAD_GRUND.AUSSERHALB, "an invalid root contains nothing");
  });

  it("imOrdner handles the drive root and the POSIX root", () => {
    assert.equal(imOrdner("C:\\a\\b", "C:\\", true), true);
    assert.equal(imOrdner("/a/b", "/", false), true);
    assert.equal(imOrdner("/ab", "/a", false), false);
  });
});

describe("pfadRichtlinie — messages and helpers", () => {
  it("every reason has a German plain-text message", () => {
    for (const g of Object.values(PFAD_GRUND)) {
      assert.equal(typeof PFAD_MELDUNGEN[g], "string", g);
      assert.ok(PFAD_MELDUNGEN[g].length > 15, g);
    }
    const e = pfadRichtlinie("\\\\server\\share\\x.bitproj", WIN);
    assert.equal(e.ok, false);
    assert.match(/** @type {any} */ (e).meldung, /Netzwerkpfade/);
  });

  it("pfadErzwingen returns the normalised path or throws with the reason", () => {
    assert.equal(pfadErzwingen("C:/a/b", WIN), "C:\\a\\b");
    assert.throws(() => pfadErzwingen("http://x", WIN), (e) => /** @type {any} */ (e).grund === PFAD_GRUND.URL_SCHEMA && /file:-Adressen/.test(e.message));
  });

  it("dateiUrlZuPfad strips the slash before a drive letter", () => {
    assert.deepEqual(dateiUrlZuPfad("file:///C:/a%20b"), { ok: true, pfad: "C:/a b" });
    assert.deepEqual(dateiUrlZuPfad("file:///home/user"), { ok: true, pfad: "/home/user" });
    assert.equal(dateiUrlZuPfad("http://x").ok, false);
  });
});

describe("inhaltPruefen — embedded document content (104-10)", () => {
  it("data: URLs of allowed types and blob: URLs pass", () => {
    assert.deepEqual(inhaltPruefen("data:application/pdf;base64,JVBERi0="), { ok: true, url: "data:application/pdf;base64,JVBERi0=", typ: "application/pdf" });
    assert.equal(inhaltPruefen("data:image/png;base64,iVBORw0=").ok, true);
    assert.equal(inhaltPruefen("DATA:Image/JPEG;base64,/9j/").ok, true);
    assert.equal(inhaltPruefen("blob:http://localhost:5215/0b6f2c9e-1111-2222-3333-444455556666").ok, true);
    assert.equal(inhaltPruefen("data:application/xml;base64,PD94", { typen: ["application/xml"] }).ok, true);
  });

  it("other types, script schemes, paths and web addresses are refused with a reason", () => {
    assert.equal(inhaltPruefen("data:text/html;base64,PHNjcmlwdD4=").grund, PFAD_GRUND.INHALT_TYP);
    assert.equal(inhaltPruefen("data:image/svg+xml,<svg onload=alert(1)>").grund, PFAD_GRUND.INHALT_TYP, "SVG can carry script");
    assert.equal(inhaltPruefen("data:,hallo").grund, PFAD_GRUND.INHALT_TYP);
    assert.equal(inhaltPruefen("data:application/xml;base64,PD94").grund, PFAD_GRUND.INHALT_TYP, "not in the default list");
    for (const p of ["javascript:alert(1)", "\" onload=\"alert(1)", "https://example.org/x.pdf", "file:///C:/x.pdf", "C:\\x.pdf", "\\\\server\\share\\x.pdf"]) {
      assert.equal(inhaltPruefen(p).grund, PFAD_GRUND.INHALT_VERWEIS, p);
    }
    assert.equal(inhaltPruefen(null).grund, PFAD_GRUND.LEER);
  });

  it("nurHerunterladen: any data: media type for a download link, still no reference", () => {
    const D = { nurHerunterladen: true };
    assert.deepEqual(inhaltPruefen("data:image/tiff;base64,SUkq", D), { ok: true, url: "data:image/tiff;base64,SUkq", typ: "image/tiff" });
    assert.equal(inhaltPruefen("data:application/octet-stream;base64,AA==", D).ok, true);
    for (const p of ["javascript:alert(1)", "https://example.org/x.pdf", "file:///C:/x.pdf", "\\\\server\\share\\x.tif"]) {
      assert.equal(inhaltPruefen(p, D).grund, PFAD_GRUND.INHALT_VERWEIS, p);
    }
  });
});
