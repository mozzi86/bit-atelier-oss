// harnessProzess.js — the Python AI harness (harness/, phase 67) as a child process of the local server
// (plan 93-12, "Harness im Programm").
//
// States (status().zustand):
//   nicht-eingerichtet  no harness/.venv and no BIT_HARNESS_PYTHON → only "Einrichten" is offered
//   gestoppt            set up, not running
//   startet             child spawned, waiting until http://127.0.0.1:<port>/status answers
//   laeuft              our child answers
//   extern              something else already answers on the port (e.g. `python -m harness serve` by hand)
//   richtet-ein         "Einrichten" runs: find Python 3.11–3.13 → python -m venv .venv → pip install -e .
//   fehler              start or setup failed; `fehler` holds the plain-German reason, `log` the last lines
//
// Setup runs ONLY on an explicit call (the user's click) and installs exactly the pinned dependencies of
// harness/pyproject.toml — nothing else. The child always binds 127.0.0.1. Stop kills the whole process
// tree (taskkill /T on Windows: a venv's python.exe is a launcher that starts the real interpreter as
// its own child — killing only the launcher would orphan the server). `beenden()` is synchronous for
// process 'exit' handlers.
//
// In:  { harnessDir, port?, env?, plattform?, spawnFn?, spawnSyncFn?, existsFn?, erreichbarFn?, killBaumFn?,
//        startTimeoutMs?, pollMs? } — everything with side effects is injectable (tests use a fake child).
// Out: a manager object { status, start, stop, neustart, einrichten, beenden }.

import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';

/** Default port of the harness service (harness/config.example.yaml, src/lib/harnessClient.js). */
export const HARNESS_PORT = 8765;
/** Number of log lines kept for the settings page. */
const LOG_ZEILEN = 60;

/**
 * Path of the interpreter inside harness/.venv.
 * @param {string} harnessDir absolute path of harness/
 * @param {NodeJS.Platform} plattform
 * @returns {string}
 */
export function venvPython(harnessDir, plattform = process.platform) {
  return plattform === 'win32' ? path.join(harnessDir, '.venv', 'Scripts', 'python.exe') : path.join(harnessDir, '.venv', 'bin', 'python');
}

/**
 * Python candidates for the setup, in order. BIT_HARNESS_PYTHON first (an absolute path); then the
 * Windows launcher with the supported versions; elsewhere the versioned binaries.
 * pyproject.toml: requires-python = ">=3.11,<3.14".
 * @param {Record<string, string|undefined>} env
 * @param {NodeJS.Platform} plattform
 * @returns {string[][]} command + leading arguments
 */
export function pythonKandidaten(env, plattform) {
  /** @type {string[][]} */
  const liste = [];
  if (env.BIT_HARNESS_PYTHON) liste.push([env.BIT_HARNESS_PYTHON]);
  if (plattform === 'win32') liste.push(['py', '-3.13'], ['py', '-3.12'], ['py', '-3.11'], ['python']);
  else liste.push(['python3.13'], ['python3.12'], ['python3.11'], ['python3']);
  return liste;
}

/** Probe run by every candidate: prints True for a supported version. */
const VERSIONS_PROBE = 'import sys;print(sys.version_info[:2]>=(3,11) and sys.version_info[:2]<(3,14))';

/**
 * Is a TCP service answering GET /status on 127.0.0.1:port?
 * @param {number} port
 * @param {number} [timeoutMs] milliseconds
 * @returns {Promise<boolean>}
 */
export function harnessErreichbar(port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/status', timeout: timeoutMs }, (res) => {
      res.resume();
      resolve((res.statusCode || 0) < 500);
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

/**
 * Kill a process and its children.
 * @param {number} pid
 * @param {NodeJS.Platform} plattform
 * @param {typeof spawnSync} [spawnSyncFn]
 */
export function prozessBaumBeenden(pid, plattform = process.platform, spawnSyncFn = spawnSync) {
  if (!pid) return;
  if (plattform === 'win32') {
    spawnSyncFn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  } else {
    try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ }
  }
}

/**
 * @typedef {object} HarnessStatus
 * @property {'nicht-eingerichtet'|'gestoppt'|'startet'|'laeuft'|'extern'|'richtet-ein'|'fehler'} zustand
 * @property {boolean} eingerichtet a usable interpreter exists
 * @property {string|null} python interpreter path (null when not set up)
 * @property {number|null} pid child process id while running
 * @property {number} port
 * @property {string} url http://127.0.0.1:<port>
 * @property {string|null} fehler plain-German reason in state "fehler"
 * @property {string|null} schritt setup step: python-suchen | venv | pakete
 * @property {string[]} log last output lines (harness and setup)
 * @property {string|null} gestartetUm ISO time of the last start
 */

/**
 * Create the manager.
 * @param {{ harnessDir: string, port?: number, env?: Record<string, string|undefined>, plattform?: NodeJS.Platform,
 *   spawnFn?: (cmd: string, args: string[], opt: object) => any, spawnSyncFn?: typeof spawnSync,
 *   existsFn?: (p: string) => boolean, erreichbarFn?: () => Promise<boolean>, killBaumFn?: (pid: number) => void,
 *   startTimeoutMs?: number, pollMs?: number }} o
 *   startTimeoutMs: how long "startet" may last (default 60 000 ms); pollMs: readiness poll interval (default 500 ms)
 */
export function harnessManager(o) {
  const port = o.port ?? HARNESS_PORT;
  const env = o.env ?? process.env;
  const plattform = o.plattform ?? process.platform;
  const spawnFn = o.spawnFn ?? spawn;
  const existsFn = o.existsFn ?? fs.existsSync;
  const erreichbar = o.erreichbarFn ?? (() => harnessErreichbar(port));
  const killBaum = o.killBaumFn ?? ((pid) => prozessBaumBeenden(pid, plattform, o.spawnSyncFn));
  const startTimeoutMs = o.startTimeoutMs ?? 60_000;
  const pollMs = o.pollMs ?? 500;

  /** @type {HarnessStatus['zustand']|null} null = derive from disk */
  let zustand = null;
  /** @type {any} */
  let kind = null;
  let stoppGewollt = false;
  /** @type {string|null} */
  let fehler = null;
  /** @type {string|null} */
  let schritt = null;
  /** @type {string|null} */
  let gestartetUm = null;
  /** @type {string[]} */
  const log = [];

  const zeile = (text) => {
    for (const z of String(text).split(/\r?\n/)) {
      if (!z.trim()) continue;
      log.push(z.slice(0, 400));
      if (log.length > LOG_ZEILEN) log.shift();
    }
  };

  /** @returns {string|null} usable interpreter: venv first, then BIT_HARNESS_PYTHON */
  const python = () => {
    const venv = venvPython(o.harnessDir, plattform);
    if (existsFn(venv)) return venv;
    if (env.BIT_HARNESS_PYTHON && existsFn(env.BIT_HARNESS_PYTHON)) return env.BIT_HARNESS_PYTHON;
    return null;
  };

  /** @returns {HarnessStatus} */
  const status = () => {
    const py = python();
    const z = zustand ?? (py ? 'gestoppt' : 'nicht-eingerichtet');
    return {
      zustand: z, eingerichtet: Boolean(py), python: py, pid: kind?.pid ?? null, port,
      url: `http://127.0.0.1:${port}`, fehler: z === 'fehler' ? fehler : null, schritt: z === 'richtet-ein' ? schritt : null,
      log: [...log], gestartetUm,
    };
  };

  const pipe = (k) => {
    k.stdout?.on('data', zeile);
    k.stderr?.on('data', zeile);
  };

  /**
   * Run one setup command to completion.
   * @param {string} cmd @param {string[]} args
   * @param {{ mitAusgabe?: boolean }} [opt] mitAusgabe = return stdout instead of logging it
   * @returns {Promise<{ code: number, ausgabe: string }>}
   */
  const ausfuehren = (cmd, args, opt = {}) => new Promise((resolve) => {
    let ausgabe = '';
    let k;
    try {
      k = spawnFn(cmd, args, { cwd: o.harnessDir, env: { ...env, PYTHONIOENCODING: 'utf-8', PIP_DISABLE_PIP_VERSION_CHECK: '1' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      resolve({ code: -1, ausgabe: String(/** @type {any} */ (e)?.message || e) });
      return;
    }
    k.stdout?.on('data', (d) => { if (opt.mitAusgabe) ausgabe += String(d); else zeile(d); });
    k.stderr?.on('data', (d) => { if (!opt.mitAusgabe) zeile(d); });
    k.once('error', (e) => resolve({ code: -1, ausgabe: String(e?.message || e) }));
    k.once('exit', (code) => resolve({ code: code ?? -1, ausgabe }));
  });

  /**
   * Start the harness. `umgebung` carries the app's local AI connection and "Nur lokale KI"
   * (see harnessUmgebung in kiLokalRouter.js).
   * @param {Record<string, string>} [umgebung] extra environment variables
   * @returns {Promise<HarnessStatus>}
   */
  const start = async (umgebung = {}) => {
    const jetzt = status().zustand;
    if (jetzt === 'startet' || jetzt === 'laeuft' || jetzt === 'richtet-ein') return status();
    const py = python();
    if (!py) { zustand = null; return status(); }
    if (await erreichbar()) { zustand = 'extern'; return status(); }
    stoppGewollt = false;
    fehler = null;
    zustand = 'startet';
    gestartetUm = new Date().toISOString();
    zeile(`[bit] Starte Harness auf 127.0.0.1:${port}`);
    try {
      kind = spawnFn(py, ['-m', 'harness', 'serve', '--host', '127.0.0.1', '--port', String(port)], {
        cwd: o.harnessDir,
        env: { ...env, ...umgebung, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' },
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      zustand = 'fehler';
      fehler = `Python konnte nicht gestartet werden: ${/** @type {any} */ (e)?.message || e}`;
      return status();
    }
    const dieses = kind;
    pipe(dieses);
    dieses.once('error', (e) => {
      if (kind !== dieses) return;
      zustand = 'fehler';
      fehler = `Python konnte nicht gestartet werden: ${e?.message || e}`;
      kind = null;
    });
    dieses.once('exit', (code) => {
      if (kind !== dieses) return;
      kind = null;
      if (stoppGewollt) { zustand = null; return; }
      zustand = 'fehler';
      fehler = `Der Harness hat sich beendet (Code ${code ?? '?'}). Die letzten Zeilen unten nennen meist den Grund (z. B. Port ${port} belegt oder ein Fehler in harness/config.yaml).`;
    });
    // Ready when /status answers; give up after startTimeoutMs.
    const ende = Date.now() + startTimeoutMs;
    while (Date.now() < ende) {
      if (kind !== dieses || zustand !== 'startet') return status();
      if (await erreichbar()) { zustand = 'laeuft'; zeile('[bit] Harness läuft'); return status(); }
      await new Promise((r) => setTimeout(r, pollMs));
    }
    if (kind === dieses && zustand === 'startet') {
      stoppGewollt = true;
      killBaum(dieses.pid);
      kind = null;
      zustand = 'fehler';
      fehler = `Der Harness hat innerhalb von ${Math.round(startTimeoutMs / 1000)} s nicht geantwortet und wurde beendet.`;
    }
    return status();
  };

  /**
   * Stop our child (an external harness is not touched).
   * @returns {Promise<HarnessStatus>}
   */
  const stop = async () => {
    const k = kind;
    if (!k) {
      if (zustand === 'extern' || zustand === 'fehler') zustand = null;
      return status();
    }
    stoppGewollt = true;
    const beendet = new Promise((r) => { k.once('exit', r); setTimeout(r, 5000); });
    killBaum(k.pid);
    await beendet;
    if (kind === k) kind = null;
    zustand = null;
    zeile('[bit] Harness gestoppt');
    return status();
  };

  /**
   * Restart with a new environment (e.g. after "Nur lokale KI" changed).
   * @param {Record<string, string>} [umgebung]
   * @returns {Promise<HarnessStatus>}
   */
  const neustart = async (umgebung = {}) => {
    await stop();
    return start(umgebung);
  };

  /**
   * Set up harness/.venv with the pinned dependencies. Only ever called from the user's click.
   * Resolves when done (the route answers right away and the page polls status()).
   * @returns {Promise<HarnessStatus>}
   */
  const einrichten = async () => {
    const jetzt = status().zustand;
    if (jetzt === 'richtet-ein' || jetzt === 'startet' || jetzt === 'laeuft') return status();
    zustand = 'richtet-ein';
    fehler = null;
    schritt = 'python-suchen';
    zeile('[bit] Einrichtung: suche Python 3.11–3.13');
    /** @type {string[]|null} */
    let basis = null;
    for (const kandidat of pythonKandidaten(env, plattform)) {
      const r = await ausfuehren(kandidat[0], [...kandidat.slice(1), '-c', VERSIONS_PROBE], { mitAusgabe: true });
      if (r.code === 0 && r.ausgabe.trim() === 'True') { basis = kandidat; break; }
    }
    if (!basis) {
      zustand = 'fehler';
      fehler = 'Python 3.11, 3.12 oder 3.13 wurde nicht gefunden. Bitte Python von https://www.python.org/downloads/ installieren (unter Windows den Haken „Add python.exe to PATH“ setzen) und danach erneut auf „Einrichten“ klicken.';
      return status();
    }
    zeile(`[bit] Python gefunden: ${basis.join(' ')}`);
    schritt = 'venv';
    const venv = await ausfuehren(basis[0], [...basis.slice(1), '-m', 'venv', '.venv']);
    if (venv.code !== 0) {
      zustand = 'fehler';
      fehler = `Die virtuelle Umgebung harness/.venv konnte nicht angelegt werden (Code ${venv.code}). Details in den Zeilen unten.`;
      return status();
    }
    schritt = 'pakete';
    zeile('[bit] Installiere die festgelegten Pakete aus harness/pyproject.toml (einige Minuten, braucht Internet)');
    const pip = await ausfuehren(venvPython(o.harnessDir, plattform), ['-m', 'pip', 'install', '-e', '.']);
    if (pip.code !== 0) {
      zustand = 'fehler';
      fehler = `Die Paketinstallation ist fehlgeschlagen (Code ${pip.code}). Häufige Gründe: keine Internetverbindung, Proxy, Virenscanner. Details in den Zeilen unten; „Einrichten“ kann gefahrlos wiederholt werden.`;
      return status();
    }
    zeile('[bit] Einrichtung abgeschlossen');
    zustand = null;
    schritt = null;
    return status();
  };

  /** Synchronous kill for process 'exit' handlers. */
  const beenden = () => {
    if (!kind) return;
    stoppGewollt = true;
    try { killBaum(kind.pid); } catch { /* exiting anyway */ }
    kind = null;
  };

  return { status, start, stop, neustart, einrichten, beenden };
}
