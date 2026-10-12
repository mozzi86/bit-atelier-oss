// 72-07 + 72-20: chronicle of a project, recent projects, work focus of the sidebar.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chronik } from "@/lib/projektChronik.js";
import { lies, merke, zuletztSichtbar, ZULETZT_MAX } from "@/lib/zuletztProjekte.js";
import { fokusAusUrl, fokusEintraege, fokusGueltig } from "@/lib/arbeitsfokus.js";
import { baueZugriff } from "@core/lib/rechte.js";
import { navGroups, navSichtbar } from "@/navigation.js";

const quellen = {
  auditLog: [{ id: "a1", ts: "2026-10-01T08:00:00Z", actor: "Person Beispiel", action: "Plan freigegeben", unit_name: "P-101" }],
  prueflaeufe: [{ id: "l1", datum: "2026-10-03T09:00:00Z", modell: "Haus.ifc", anzahl: 4 }],
  dokumente: [{ id: "d1", project_id: "p1", name: "Bericht.pdf", created_date: "2026-10-02T10:00:00Z" }, { id: "d2", project_id: "p1", bereich: "buchhaltung", name: "Rechnung.pdf", created_date: "2026-10-04T10:00:00Z" }],
  modelle: [{ id: "m1", version: 2, message: "Stand Entwurf", author: "x@example.org", created_date: "2026-09-30T10:00:00Z" }],
  schreiben: [{ id: "s1", status: "versendet", betreff: "Behinderungsanzeige", versendet_am: "2026-10-05" }, { id: "s2", status: "entwurf", betreff: "Entwurf" }],
};

test("Chronik: neueste zuerst, keine Personennamen, Entwürfe nicht", () => {
  const z = chronik(quellen);
  assert.deepEqual(z.map((x) => x.id), ["brief:s1", "dok:d2", "lauf:l1", "dok:d1", "audit:a1", "stand:m1"]);
  assert.equal(JSON.stringify(z).includes("Person Beispiel"), false);
  assert.equal(JSON.stringify(z).includes("example.org"), false);
  assert.equal(z.find((x) => x.id === "audit:a1")?.ziel, "/Werkplanung");
});

test("Chronik nach Rechten: Mitarbeiter sieht keine Buchhaltungsdokumente", () => {
  const zugriff = baueZugriff({ nutzer: { id: "u", rolle: "mitarbeiter", mitarbeiter_id: "m" }, zuordnungen: [{ mitarbeiter_id: "m", alle: false, zuordnungen: [{ project_id: "p1" }] }] });
  const ids = chronik(quellen, { zugriff }).map((x) => x.id);
  assert.equal(ids.includes("dok:d2"), false);
  assert.equal(ids.includes("dok:d1"), true);
});

test("Zuletzt-Liste: höchstens fünf, neueste oben, nur sichtbare Projekte", () => {
  /** @type {Record<string, string>} */
  const daten = {};
  const speicher = /** @type {Storage} */ (/** @type {unknown} */ ({ getItem: (/** @type {string} */ k) => daten[k] ?? null, setItem: (/** @type {string} */ k, /** @type {string} */ v) => { daten[k] = v; } }));
  for (const id of ["p1", "p2", "p3", "p4", "p5", "p6", "p2"]) merke(id, speicher);
  assert.deepEqual(lies(speicher), ["p2", "p6", "p5", "p4", "p3"]);
  assert.equal(lies(speicher).length, ZULETZT_MAX);
  assert.deepEqual(zuletztSichtbar(lies(speicher), [{ id: "p3" }, { id: "p2" }]).map((p) => p.id), ["p2", "p3"]);
  daten["bit-atelier-zuletzt-projekte"] = "{kaputt";
  assert.deepEqual(lies(speicher), []);
});

test("Arbeitsfokus: URL, unbekannter Wert, Einträge in Fokus-Reihenfolge und nach Rechten", () => {
  assert.equal(fokusAusUrl("?rolle=bauleitung"), "bauleitung");
  assert.equal(fokusAusUrl("?rolle=chef"), "alle");
  assert.equal(fokusAusUrl("?x=1"), null);
  assert.equal(fokusGueltig("buero"), "buero");
  assert.equal(fokusEintraege(navGroups, "alle"), null);
  assert.deepEqual(fokusEintraege(navGroups, "bauleitung")?.map((i) => i.url), ["/Dashboard", "/Werkplanung", "/BimViewer", "/Reports", "/Deadlines"]);
  const zugriff = baueZugriff({ nutzer: { id: "u", rolle: "mitarbeiter" }, zuordnungen: [] });
  const sichtbar = navGroups.map((g) => ({ ...g, items: g.items.filter((i) => navSichtbar(i, { zugriff })) }));
  const buero = fokusEintraege(sichtbar, "buero")?.map((i) => i.url) || [];
  assert.equal(buero.includes("/Accounting"), false);
  assert.ok(buero.includes("/Deadlines"));
  // every focus URL exists in the navigation
  for (const f of ["entwurf", "ausschreibung", "bauleitung", "buero"]) {
    const urls = fokusEintraege(navGroups, f)?.length;
    assert.ok(urls && urls >= 5, f);
  }
});
