#!/usr/bin/env node
// harness-pytest.mjs — runs the offline pytest suite of the Python harness (harness/) as a gate (plan 105-24).
//
// Why: the harness had ~300 pytest tests, but no gate ran them — "gates green" said nothing about harness/.
// This script is the one entry point used by the local gate run (scripts/gates-lokal.mjs, `npm run gates`),
// by `npm run test:harness`, and by the harness step of .github/workflows/gates.yml.
//
// Interpreter (first hit wins; nothing is installed by this script):
//   1. $HARNESS_PYTHON                                   explicit interpreter, e.g. a venv outside the repo
//   2. harness/.venv/bin/python | harness/.venv/Scripts/python.exe   the reference venv of harness/README.md
//   3. python3 (python on Windows)                       system interpreter
// The interpreter must have the test extras of harness/pyproject.toml: pytest + pytest-asyncio ([dev]),
// ifcopenshell ([ifc]) and elmonkey-core ([katalog]). A missing one is a RED gate with the install line — the
// conftest only prints a banner and pytest exits 0 when an extra is missing (H-1, review 67-03), which would be
// a green-looking run that tested nothing. HARNESS_PYTEST_OHNE_EXTRAS=1 relaxes this for ifcopenshell and
// elmonkey-core only (pytest and pytest-asyncio stay mandatory: without the latter every async test fails).
//
// Usage:
//   node scripts/harness-pytest.mjs              # run the suite, exit code = pytest's
//   node scripts/harness-pytest.mjs -k sperre    # extra arguments go to pytest
// In:  environment variables above. Out: pytest output on stdout/stderr, exit code (0 green, 1 red/missing).

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HARNESS = path.join(REPO, "harness");
const WINDOWS = process.platform === "win32";

/** Install line of the reference venv (same as harness/README.md and tests/conftest.py). */
export const INSTALLATION = 'python3 -m venv harness/.venv && harness/.venv/bin/python -m pip install -e "harness[dev,ifc,katalog]"';

/**
 * German setup hint printed whenever the gate is red for lack of an environment: where the venv goes,
 * the one command that creates it with the exact pins of harness/pyproject.toml, and the alternative
 * HARNESS_PYTHON. Python must be 3.11–3.13 (requires-python ">=3.11,<3.14").
 */
export const EINRICHTEN = [
  "So richtest du die Harness-Testumgebung ein (Python 3.11 bis 3.13, Netz für pip nötig):",
  "  Ort:    harness/.venv  (im Repo, von .gitignore ausgenommen; wird von diesem Skript automatisch gefunden)",
  `  Befehl: ${INSTALLATION}`,
  "  Oder ein venv an anderer Stelle mit demselben pip-Befehl anlegen und HARNESS_PYTHON=<pfad>/bin/python setzen.",
  "  Das Gate bleibt rot, bis die Umgebung vollständig ist — es wird nie still übersprungen.",
].join("\n");

/**
 * Python modules the gate needs, with the pyproject extra that provides them ("" = base dependency).
 * `pflicht: true` = always required; otherwise required unless HARNESS_PYTEST_OHNE_EXTRAS=1.
 * @type {{ modul: string, extra: string, pflicht: boolean }[]}
 */
export const MODULE = [
  { modul: "pytest", extra: "dev", pflicht: true },
  { modul: "pytest_asyncio", extra: "dev", pflicht: true },
  { modul: "fastapi", extra: "", pflicht: true },
  { modul: "ifcopenshell", extra: "ifc", pflicht: false },
  { modul: "elmonkey.katalog", extra: "katalog", pflicht: false },
];

/**
 * Picks the Python interpreter for the harness tests (see file header for the order).
 * @param {NodeJS.ProcessEnv} env process environment
 * @param {(p: string) => boolean} existiert file existence check (injectable for tests)
 * @returns {{ python: string, quelle: string }} interpreter command/path and where it came from
 */
export function waehlePython(env = process.env, existiert = fs.existsSync) {
  if (env.HARNESS_PYTHON) return { python: env.HARNESS_PYTHON, quelle: "HARNESS_PYTHON" };
  const venv = WINDOWS
    ? path.join(HARNESS, ".venv", "Scripts", "python.exe")
    : path.join(HARNESS, ".venv", "bin", "python");
  if (existiert(venv)) return { python: venv, quelle: "harness/.venv" };
  return { python: WINDOWS ? "python" : "python3", quelle: "System" };
}

/**
 * Lists the required modules the interpreter cannot import.
 * @param {string} python interpreter command/path
 * @param {boolean} ohneExtras true = ifcopenshell/elmonkey-core are optional
 * @returns {{ fehlend: typeof MODULE, startFehler: string | null }} missing modules; startFehler when the
 *   interpreter itself could not be started
 */
export function fehlendeModule(python, ohneExtras) {
  const pruefen = MODULE.filter((m) => m.pflicht || !ohneExtras);
  const code = [
    "import importlib.util, sys",
    `namen = ${JSON.stringify(pruefen.map((m) => m.modul))}`,
    "def da(n):",
    "    try:",
    "        return importlib.util.find_spec(n) is not None",
    "    except ModuleNotFoundError:",
    "        return False",
    "print('\\n'.join(n for n in namen if not da(n)))",
  ].join("\n");
  // Not isolated (-I): ifcopenshell may live in the user site-packages of a system interpreter; cwd = harness/
  // so the check sees the same import path as the pytest run.
  const r = spawnSync(python, ["-c", code], { cwd: HARNESS, encoding: "utf8" });
  if (r.error || r.status !== 0) {
    return { fehlend: [], startFehler: r.error ? r.error.message : (r.stderr || `Exit ${r.status}`).trim() };
  }
  const fehlt = new Set(r.stdout.split(/\r?\n/).filter(Boolean));
  return { fehlend: pruefen.filter((m) => fehlt.has(m.modul)), startFehler: null };
}

/**
 * Environment of the pytest run: like an activated venv. When `python` is a path (HARNESS_PYTHON or
 * harness/.venv), its directory goes first on PATH, so `python`/`pip` started by the tests resolve to
 * the same interpreter — test_allowlist/test_server run the shell tool with `python --version`, and
 * macOS has no `python` on the system PATH. A bare command name (system python3) leaves PATH alone.
 * @param {string} python interpreter command or path
 * @param {NodeJS.ProcessEnv} env base environment
 * @returns {NodeJS.ProcessEnv} new environment object (the input is not modified)
 */
export function pytestUmgebung(python, env = process.env) {
  const neu = { ...env, PYTHONDONTWRITEBYTECODE: "1" };
  if (python.includes("/") || python.includes("\\")) {
    const schluessel = Object.keys(neu).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
    const bisher = neu[schluessel];
    neu[schluessel] = bisher ? `${path.dirname(python)}${path.delimiter}${bisher}` : path.dirname(python);
  }
  return neu;
}

function main() {
  const { python, quelle } = waehlePython();
  const ohneExtras = process.env.HARNESS_PYTEST_OHNE_EXTRAS === "1";
  console.log(`harness-pytest: Interpreter ${python} (${quelle})`);

  const { fehlend, startFehler } = fehlendeModule(python, ohneExtras);
  if (startFehler) {
    console.error(`harness-pytest: ROT — Interpreter nicht startbar: ${startFehler}`);
    console.error(EINRICHTEN);
    return 1;
  }
  if (fehlend.length) {
    console.error("harness-pytest: ROT — dem Interpreter fehlen Test-Abhängigkeiten:");
    for (const m of fehlend) console.error(`  - ${m.modul} (${m.extra ? `Extra [${m.extra}]` : "Basis-Abhängigkeit"})`);
    console.error(EINRICHTEN);
    return 1;
  }

  // -p no:cacheprovider: no .pytest_cache in the repo (the tests themselves work under tmp_path).
  const r = spawnSync(python, ["-m", "pytest", "-q", "-p", "no:cacheprovider", ...process.argv.slice(2)], {
    cwd: HARNESS,
    stdio: "inherit",
    env: pytestUmgebung(python),
  });
  if (r.error) {
    console.error(`harness-pytest: ROT — ${r.error.message}`);
    return 1;
  }
  return r.status ?? 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
