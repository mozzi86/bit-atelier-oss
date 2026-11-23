// Unit tests for plan 105-24: the harness pytest suite is part of the gate run — the interpreter choice of
// scripts/harness-pytest.mjs (HARNESS_PYTHON > harness/.venv > system), the missing-module report (a fake
// interpreter name that cannot start is a red gate, never a silent pass), the step list of scripts/gates-lokal.mjs
// (all gates, harness last, build into build.log), the npm scripts, and the harness step in gates.yml.
// No Python is started for a real test run here.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { EINRICHTEN, MODULE, fehlendeModule, pytestUmgebung, waehlePython } from "../../scripts/harness-pytest.mjs";
import { SCHRITTE } from "../../scripts/gates-lokal.mjs";

const WURZEL = fileURLToPath(new URL("../../", import.meta.url));

describe("harness-pytest: Interpreter-Wahl", () => {
  it("HARNESS_PYTHON gewinnt vor venv und System", () => {
    const r = waehlePython({ HARNESS_PYTHON: "/opt/py/bin/python" }, () => true);
    assert.deepEqual(r, { python: "/opt/py/bin/python", quelle: "HARNESS_PYTHON" });
  });

  it("ohne Variable: harness/.venv, wenn vorhanden", () => {
    const r = waehlePython({}, (p) => p.includes(`${path.sep}.venv${path.sep}`));
    assert.equal(r.quelle, "harness/.venv");
    assert.ok(r.python.startsWith(path.join(WURZEL, "harness", ".venv")));
  });

  it("ohne venv: System-Python", () => {
    const r = waehlePython({}, () => false);
    assert.equal(r.quelle, "System");
    assert.match(r.python, /^python3?$/);
  });
});

describe("harness-pytest: fehlende Abhängigkeiten sind rot", () => {
  it("pytest und pytest-asyncio sind immer Pflicht, die IFC-/Katalog-Extras abschaltbar", () => {
    const pflicht = MODULE.filter((m) => m.pflicht).map((m) => m.modul);
    assert.ok(pflicht.includes("pytest") && pflicht.includes("pytest_asyncio"));
    const extras = MODULE.filter((m) => !m.pflicht).map((m) => m.modul);
    assert.deepEqual(extras.sort(), ["elmonkey.katalog", "ifcopenshell"]);
  });

  it("ein nicht startbarer Interpreter meldet einen Startfehler statt 'nichts fehlt'", () => {
    const r = fehlendeModule("kein-python-interpreter-105-24", false);
    assert.ok(r.startFehler, "Startfehler erwartet");
    assert.deepEqual(r.fehlend, []);
  });
});

describe("gates-lokal: Schrittliste", () => {
  it("enthält alle Gates in fester Reihenfolge, Harness-pytest zuletzt", () => {
    assert.deepEqual(SCHRITTE.map((s) => s.id), ["lint", "tsc", "farben", "unit", "build", "budget", "harness"]);
  });

  it("Build schreibt nach build.log mit 4 GB Heap", () => {
    const build = SCHRITTE.find((s) => s.id === "build");
    assert.equal(build?.log, "build.log");
    assert.equal(build?.env?.NODE_OPTIONS, "--max-old-space-size=4096");
  });

  it("npm-Skripte gates und test:harness zeigen auf die Skripte", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(WURZEL, "package.json"), "utf8"));
    assert.equal(pkg.scripts.gates, "node scripts/gates-lokal.mjs");
    assert.equal(pkg.scripts["test:harness"], "node scripts/harness-pytest.mjs");
  });

  it("gates.yml hat den Harness-pytest-Schritt mit allen Test-Extras", () => {
    const yml = fs.readFileSync(path.join(WURZEL, ".github", "workflows", "gates.yml"), "utf8");
    assert.match(yml, /name: Harness-pytest/);
    assert.match(yml, /pip install -e "harness\[dev,ifc,katalog\]"/);
    assert.match(yml, /node scripts\/harness-pytest\.mjs/);
  });
});

describe("harness-pytest: Umgebung wie ein aktiviertes venv", () => {
  it("das Verzeichnis eines Interpreter-Pfads steht vorn im PATH (der Shell-Test ruft `python`)", () => {
    const py = path.join(path.sep, "opt", "venv", "bin", "python");
    const env = pytestUmgebung(py, { PATH: ["/usr/bin", "/bin"].join(path.delimiter) });
    assert.equal(env.PATH.split(path.delimiter)[0], path.dirname(py));
    assert.equal(env.PYTHONDONTWRITEBYTECODE, "1");
  });

  it("ein nackter Befehlsname (System-python3) lässt PATH unverändert", () => {
    const env = pytestUmgebung("python3", { PATH: "/usr/bin" });
    assert.equal(env.PATH, "/usr/bin");
  });
});

describe("harness-pytest: Einrichtungshinweis", () => {
  it("nennt auf Deutsch den venv-Pfad, genau einen Befehl und die Python-Version", () => {
    assert.match(EINRICHTEN, /harness\/\.venv/);
    assert.match(EINRICHTEN, /pip install -e "harness\[dev,ifc,katalog\]"/);
    assert.match(EINRICHTEN, /Python 3\.11/);
    assert.match(EINRICHTEN, /HARNESS_PYTHON/);
  });
});
