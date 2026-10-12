// Phase 82 (82-01): the role core (@core/lib/rechte.js) — standard matrix,
// floors, the sub-right of the time approval, reversible server mapping,
// intersection in the cloud, project view (E-17), document areas, absence
// reasons, last owner, the cloud lock with and without the release E-20, and
// the gate helpers of the shell (huellenZustand rule 0, navSichtbar,
// personalZugang).
//
// In:  rechte.js, huellenZustand.js, navigation.js, people/zugang.js. Out: assertions only.

import { test } from "node:test";
import assert from "node:assert/strict";
import * as rechte from "@core/lib/rechte.js";
import { huellenZustand, modulFuer } from "@/huellenZustand.js";
import { navFlach, navSichtbar } from "@/navigation.js";
import { personalZugang } from "@/lib/people/zugang.js";

const { baueZugriff, bereinigeUeberschreibungen, cloudGesperrt, darf, darfGrundSehen, letzterInhaberGeschuetzt, matrixFuer, MODULE, projekteNachZugriff, ROLLEN, rolleAusServerRolle, schnittStufen, serverAbbildung, sichtbareDokumente } = rechte;
const z = (rolle, extra = {}) => baueZugriff({ rolle, datenquelle: "express", ...extra });

test("vier Rollen, Standard-Matrix", () => {
  assert.deepEqual([...ROLLEN], ["inhaber", "projektleitung", "mitarbeiter", "buchhaltung"]);
  assert.equal(darf(z("mitarbeiter"), "buchhaltung"), false);
  assert.equal(darf(z("mitarbeiter"), "personal"), false);
  assert.equal(darf(z("mitarbeiter"), "zeiterfassung", "voll"), true);
  assert.equal(darf(z("buchhaltung"), "controlling", "lesen"), true);
  assert.equal(darf(z("buchhaltung"), "controlling", "voll"), false);
  assert.equal(darf(z("buchhaltung"), "ava"), false);
  for (const m of MODULE) assert.equal(darf(z("inhaber"), m, "voll"), true, m);
});

test("Böden und Bestandsmodule", () => {
  const b = bereinigeUeberschreibungen({ ueberschreibungen: { inhaber: { einstellungen: "aus" }, mitarbeiter: { personal: "voll", "zeiterfassung:freigabe": "voll" }, projektleitung: { ava: "lesen" }, gast: { ava: "voll" } } });
  assert.deepEqual(b.ueberschreibungen, { projektleitung: { ava: "voll" } });
  assert.equal(matrixFuer("inhaber", { ueberschreibungen: { inhaber: { einstellungen: "aus" } } }).einstellungen, "voll");
  assert.equal(darf(z("mitarbeiter", { einstellung: { ueberschreibungen: { mitarbeiter: { "zeiterfassung:freigabe": "voll" } } } }), "zeiterfassung:freigabe"), false);
  assert.equal(letzterInhaberGeschuetzt([{ id: "a", rolle: "inhaber" }]), true);
  assert.equal(letzterInhaberGeschuetzt([{ id: "a", rolle: "inhaber" }, { id: "b", rolle: "inhaber" }]), false);
  assert.equal(letzterInhaberGeschuetzt([{ id: "a", rolle: "inhaber" }, { id: "b", rolle: "inhaber", aktiv: false }], "a"), true);
});

test("Unterrecht zeiterfassung:freigabe nie über dem Elternmodul", () => {
  assert.equal(darf(z("projektleitung"), "zeiterfassung:freigabe", "voll"), true);
  assert.equal(darf(z("mitarbeiter"), "zeiterfassung:freigabe"), false);
  assert.equal(darf(z("buchhaltung"), "zeiterfassung:freigabe", "lesen"), true);
  assert.equal(darf(z("buchhaltung"), "zeiterfassung:freigabe", "voll"), false);
  const ohneEltern = z("projektleitung", { einstellung: { ueberschreibungen: { projektleitung: { zeiterfassung: "aus" } } } });
  assert.equal(darf(ohneEltern, "zeiterfassung:freigabe"), false);
});

test("Server-Abbildung umkehrbar; Rückweg; Schnitt im Supabase-Build", () => {
  for (const r of ROLLEN) assert.equal(rolleAusServerRolle(serverAbbildung(r)), r, r);
  assert.deepEqual(serverAbbildung("buchhaltung"), { role: "planner", buero_rolle: "buchhaltung", can_view_personal: true, can_view_buchhaltung: true });
  assert.equal(rolleAusServerRolle({ role: "admin" }), "inhaber");
  assert.equal(rolleAusServerRolle({ role: "mitglied" }), "projektleitung");
  assert.equal(rolleAusServerRolle({ role: "leser" }), "mitarbeiter");
  for (const r of ["bidder", "investor", "gast", "xyz", undefined]) assert.equal(rolleAusServerRolle({ role: r }), null);
  assert.deepEqual(schnittStufen("buchhaltung", { role: "owner" }), matrixFuer("buchhaltung"));
  assert.equal(schnittStufen("buchhaltung", serverAbbildung("buchhaltung")).buchhaltung, "voll");
  assert.deepEqual(schnittStufen("inhaber", { role: "mitglied" }), matrixFuer("projektleitung"));
  assert.deepEqual(schnittStufen("mitarbeiter", { role: "owner" }), matrixFuer("mitarbeiter"));
  assert.equal(schnittStufen("mitarbeiter", { role: "leser" }).zeiterfassung, "lesen");
  assert.ok(Object.values(schnittStufen("inhaber", { role: "gast" })).every((s) => s === "aus"));
});

test("Projektsicht (E-17): Zuordnung, Person ohne Zuordnung = alle, Nutzer ohne Mitarbeiter = keine", () => {
  const P = ["proj-1", "proj-2", "proj-3", "proj-4"].map((id) => ({ id }));
  const proj = [{ mitarbeiter_id: "P-004", alle: false, zuordnungen: [{ project_id: "proj-1" }, { project_id: "proj-2" }] }, { mitarbeiter_id: "P-003", alle: true, zuordnungen: [] }];
  const ma = baueZugriff({ nutzer: { id: "nu-3", rolle: "mitarbeiter", mitarbeiter_id: "P-004" }, zuordnungen: proj, datenquelle: "express" });
  assert.deepEqual(projekteNachZugriff(P, ma).map((p) => p.id), ["proj-1", "proj-2"]);
  const pl = baueZugriff({ nutzer: { id: "nu-2", rolle: "projektleitung", mitarbeiter_id: "P-003" }, zuordnungen: proj, datenquelle: "express" });
  assert.equal(pl.projektIds, null);
  assert.equal(projekteNachZugriff(P, pl).length, 4);
  const alle = baueZugriff({ nutzer: { id: "nu-3", rolle: "mitarbeiter", mitarbeiter_id: "P-004" }, zuordnungen: proj, einstellung: { projektsicht: { mitarbeiter: "alle" } }, datenquelle: "express" });
  assert.equal(projekteNachZugriff(P, alle).length, 4);
  assert.equal(projekteNachZugriff(P, z("inhaber")).length, 4);
  assert.equal(projekteNachZugriff(P, baueZugriff({ nutzer: { id: "nu-4", rolle: "buchhaltung" }, datenquelle: "express" })).length, 4);
  const ohne = baueZugriff({ nutzer: { id: "nu-x", rolle: "projektleitung" }, datenquelle: "express" });
  assert.deepEqual(projekteNachZugriff(P, ohne), []);
  assert.equal(ohne.hinweisOhneMitarbeiter, true);
  assert.equal(baueZugriff({ datenquelle: "express" }).rolle, "inhaber", "solo owner without user records");
  assert.ok(!Object.keys(rechte).includes("sichtbareProjekte"), "name belongs to 81-06 projektArchiv.js");
});

test("Dokument-Bereiche und Abwesenheitsgrund", () => {
  const docs = [{ id: "a" }, { id: "b", bereich: "projekt", project_id: "proj-3" }, { id: "c", bereich: "buero", project_id: "proj-1" }, { id: "d", bereich: "schriftverkehr" }, { id: "e", bereich: "buchhaltung" }, { id: "f", bereich: "personal" }, { id: "g", bereich: "neu" }];
  const ma = baueZugriff({ nutzer: { rolle: "mitarbeiter", mitarbeiter_id: "P-004" }, zuordnungen: [{ mitarbeiter_id: "P-004", alle: false, zuordnungen: [{ project_id: "proj-1" }] }], datenquelle: "express" });
  assert.deepEqual(sichtbareDokumente(docs, ma).map((d) => d.id), ["a", "d"]);
  assert.deepEqual(sichtbareDokumente(docs, z("inhaber")).map((d) => d.id), ["a", "b", "c", "d", "e", "f", "g"]);
  assert.deepEqual(sichtbareDokumente(docs, z("buchhaltung")).map((d) => d.id), ["a", "b", "c", "d", "e", "f"]);
  assert.equal(darfGrundSehen(z("inhaber"), "P-004"), true);
  assert.equal(darfGrundSehen(z("buchhaltung"), "P-004"), true);
  assert.equal(darfGrundSehen(baueZugriff({ nutzer: { rolle: "projektleitung", mitarbeiter_id: "P-003" }, datenquelle: "express" }), "P-004"), false);
  assert.equal(darfGrundSehen(ma, "P-004"), true);
});

test("Cloud-Sperre E-03 nur ohne Freigabe E-20; Böden gelten dort nicht", () => {
  for (const m of ["buchhaltung", "personal", "kostensatz", "zeiterfassung", "auftrag", "controlling", "abwesenheiten", "schriftverkehr", "rechte"]) {
    assert.equal(cloudGesperrt(m, "supabase", false), true, m);
    assert.equal(cloudGesperrt(m, "supabase", true), false, m);
    assert.equal(cloudGesperrt(m, "express", false), false, m);
    assert.equal(cloudGesperrt(m, "serverlos", false), false, m);
  }
  for (const m of ["fristen", "projekte", "berichte"]) assert.equal(cloudGesperrt(m, "supabase", false), false, m);
  const cloud = baueZugriff({ rolle: "inhaber", datenquelle: "supabase", freigabe: false });
  assert.equal(darf(cloud, "rechte"), false, "floors do not apply in the locked cloud");
  assert.equal(darf(cloud, "fristen"), true);
  assert.equal(darf(baueZugriff({ rolle: "inhaber", datenquelle: "supabase", freigabe: true }), "buchhaltung"), true);
  assert.equal(darf(z("projektleitung", { lesemodus: true }), "fristen", "voll"), false);
});

test("Hülle: Regel 0 gesperrt, navSichtbar und personalZugang mit Zugriff", () => {
  const darfModul = (m) => m !== "buchhaltung";
  for (const zustand of [{}, { fehler: "x" }, { loading: true }, { projektAnzahl: 0 }]) {
    assert.equal(huellenZustand({ ...zustand, pathname: "/Accounting", eintraege: navFlach, darfModul }), "gesperrt");
  }
  assert.equal(huellenZustand({ pathname: "/Accounting", eintraege: navFlach }), "inhalt");
  assert.equal(huellenZustand({ pathname: "/Unbekannt", eintraege: navFlach, darfModul: () => false, projektAnzahl: 1 }), "inhalt");
  assert.equal(modulFuer("/accounting", navFlach), "buchhaltung");
  const buchhaltung = navFlach.find((e) => e.url === "/Accounting");
  assert.equal(navSichtbar(buchhaltung, { personalZugang: "erlaubt", zugriff: z("mitarbeiter") }), false);
  assert.equal(navSichtbar(buchhaltung, { personalZugang: "erlaubt" }), true);
  const personal = navFlach.find((e) => e.url === "/People");
  assert.equal(navSichtbar(personal, { personalZugang: "keine-berechtigung" }), false);
  assert.equal(personalZugang({ datenquelle: "serverlos", rolle: "admin", zugriff: z("projektleitung") }), "keine-berechtigung");
  assert.equal(personalZugang({ datenquelle: "serverlos", rolle: "gast", zugriff: z("buchhaltung") }), "erlaubt");
  assert.equal(personalZugang({ datenquelle: "supabase", rolle: "admin", zugriff: z("inhaber") }), "nur-lokal");
  assert.equal(personalZugang({ datenquelle: "express", rolle: "admin" }), "erlaubt");
  for (const e of navFlach) assert.ok(MODULE.includes(e.modul), `${e.title}: modul ${e.modul}`);
});
