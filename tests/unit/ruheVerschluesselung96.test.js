// 96-01: personnel store encrypted at rest — codec, key file, migration of plain
// files, and the lock that keeps a missing/wrong key from overwriting ciphertext.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { Buffer } from "node:buffer";
import {
  istVerschluesselt, ladeSchluessel, MAGIC, standardSchluesselPfad, verschluesselteDatenVorhanden, verschluesselungsCodec,
} from "../../packages/nova-core/server/ruheVerschluesselung.js";
import { createDb } from "../../packages/nova-core/server/db.js";
import { createBlobStore } from "../../packages/nova-core/server/blobs.js";

/** Fresh temp directory per test. */
const ordner = () => fs.mkdtempSync(path.join(os.tmpdir(), "bit-96-01-"));
const key = () => crypto.randomBytes(32);

test("Codec: Rundlauf, kein Klartext in der Datei, Manipulation und falscher Schlüssel fallen auf", () => {
  const c = verschluesselungsCodec(key());
  const geheim = JSON.stringify({ gehalt: 4321, name: "Erika Muster" });
  const text = c.encode(geheim);
  assert.ok(text.startsWith(MAGIC));
  assert.ok(!text.includes("Erika") && !text.includes("4321"));
  assert.equal(c.decode(text), geheim);
  // Each write gets a fresh IV.
  assert.notEqual(c.encode(geheim), text);
  const roh = Buffer.from(text.slice(MAGIC.length), "base64");
  roh[roh.length - 1] ^= 1;
  assert.throws(() => c.decode(MAGIC + roh.toString("base64")), /Entschlüsseln fehlgeschlagen/);
  assert.throws(() => verschluesselungsCodec(key()).decode(text), /Entschlüsseln fehlgeschlagen/);
  // Plain text (pre-96-01 files) passes through for the migration.
  assert.equal(c.decode('{"a":1}'), '{"a":1}');
});

test("Schlüsseldatei: anlegen, wiederverwenden, ungültig → Fehler, ohne erzeugen → null", () => {
  const d = ordner();
  const p = path.join(d, "sub", "personal.key");
  assert.equal(ladeSchluessel(p), null);
  const k1 = ladeSchluessel(p, { erzeugen: true });
  assert.equal(k1.length, 32);
  assert.deepEqual(ladeSchluessel(p, { erzeugen: true }), k1);
  fs.writeFileSync(p, "kaputt");
  assert.throws(() => ladeSchluessel(p), /ungültig/);
});

test("Standardort liegt außerhalb des Datenordners, Umgebungsvariable gewinnt", () => {
  assert.equal(standardSchluesselPfad({ env: { APPDATA: "D:\\Profil\\Roaming" }, plattform: "win32", home: "D:\\Profil" }),
    path.join("D:\\Profil\\Roaming", "BIT-Atelier", "personal.key"));
  assert.equal(standardSchluesselPfad({ env: {}, plattform: "linux", home: "/srv/profil" }), path.join("/srv/profil", ".config", "bit-atelier", "personal.key"));
  assert.equal(standardSchluesselPfad({ env: { BIT_PERSONAL_SCHLUESSEL: "/tmp/k.key" }, plattform: "linux", home: "/srv/profil" }), path.resolve("/tmp/k.key"));
});

test("createDb: Klartext wird beim Start verschlüsselt (auch .bak), Daten bleiben lesbar", () => {
  const d = ordner();
  const p = path.join(d, "personal.json");
  fs.writeFileSync(p, JSON.stringify({ Mitarbeiter: [{ id: "m1", name: "Max" }] }));
  fs.writeFileSync(`${p}.bak`, JSON.stringify({ Mitarbeiter: [] }));
  const k = key();
  const db = createDb(p, { codec: verschluesselungsCodec(k) });
  assert.equal(db.gesperrt(), null);
  assert.equal(db.get("Mitarbeiter", "m1").name, "Max");
  assert.ok(istVerschluesselt(fs.readFileSync(p, "utf-8")));
  assert.ok(istVerschluesselt(fs.readFileSync(`${p}.bak`, "utf-8")));
  db.create("Mitarbeiter", { name: "Erika" });
  db.flush();
  const wieder = createDb(p, { codec: verschluesselungsCodec(k) });
  assert.equal(wieder.list("Mitarbeiter").length, 2);
  assert.ok(verschluesselteDatenVorhanden(p, path.join(d, "personal-blobs")));
});

test("createDb: falscher Schlüssel sperrt und überschreibt die verschlüsselte Datei nie", () => {
  const d = ordner();
  const p = path.join(d, "personal.json");
  const db = createDb(p, { codec: verschluesselungsCodec(key()) });
  db.create("Mitarbeiter", { name: "Max" });
  db.flush();
  const vorher = fs.readFileSync(p, "utf-8");
  const falsch = createDb(p, { codec: verschluesselungsCodec(key()) });
  assert.match(String(falsch.gesperrt()), /Entschlüsseln fehlgeschlagen/);
  assert.deepEqual(falsch.list("Mitarbeiter"), []);
  falsch.create("Mitarbeiter", { name: "Überschreiber" });
  falsch.flush();
  assert.equal(fs.readFileSync(p, "utf-8"), vorher);
});

test("createDb ohne Codec bleibt Klartext (Projektdatenbank unverändert)", () => {
  const d = ordner();
  const p = path.join(d, "db.json");
  const db = createDb(p);
  db.create("Project", { name: "A" });
  db.flush();
  assert.equal(JSON.parse(fs.readFileSync(p, "utf-8")).Project[0].name, "A");
  assert.equal(db.gesperrt(), null);
});

test("Blob-Store: verschlüsselt schreiben/lesen, Klartext migrieren, falscher Schlüssel wirft", () => {
  const d = ordner();
  fs.mkdirSync(path.join(d, "b"));
  fs.writeFileSync(path.join(d, "b", "alt.json"), JSON.stringify({ data: "data:application/pdf;base64,AAAA" }));
  const k = key();
  const blobs = createBlobStore(path.join(d, "b"), { codec: verschluesselungsCodec(k) });
  assert.equal(blobs.migriere(), 1);
  assert.equal(blobs.migriere(), 0);
  assert.ok(istVerschluesselt(fs.readFileSync(path.join(d, "b", "alt.json"), "utf-8")));
  assert.deepEqual(blobs.get("alt"), { data: "data:application/pdf;base64,AAAA" });
  blobs.put("neu", { x: 1 });
  assert.ok(istVerschluesselt(fs.readFileSync(path.join(d, "b", "neu.json"), "utf-8")));
  assert.deepEqual(blobs.get("neu"), { x: 1 });
  assert.equal(blobs.get("fehlt"), null);
  const falsch = createBlobStore(path.join(d, "b"), { codec: verschluesselungsCodec(key()) });
  assert.throws(() => falsch.get("neu"), /Entschlüsseln fehlgeschlagen/);
});
