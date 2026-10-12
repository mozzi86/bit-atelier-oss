// hardware.js — what this computer offers a local AI model (plan 93-12 C). Read by GET /api/ki/hardware
// (loopback only) and fed into modellEmpfehlung.js.
//
//   RAM and CPU      node:os
//   free disk        fs.statfs on the Ollama models folder (OLLAMA_MODELS, else ~/.ollama/models; the
//                    nearest existing parent when it does not exist yet)
//   GPU              NVIDIA: `nvidia-smi --query-gpu=name,memory.total,memory.free --format=csv,noheader`
//                    (Windows/Linux). Apple Silicon: unified memory (os.totalmem = sysctl hw.memsize).
//                    Windows without NVIDIA: the adapter name via CIM, VRAM reported as unknown — the
//                    CIM AdapterRAM field is a 32-bit value and wrong above 4 GB, so it is not used.
//
// Memory sizes are GiB (2^30 bytes) because that is what "10 GB VRAM" / "32 GB RAM" means on the box;
// model download sizes in the catalog are GB (10^9) — the ~7 % difference errs on the safe side.
//
// In:  injectable { execFileFn, osApi, statfsFn, env, plattform, arch, homedir }. Out: Hardware object.

import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';

const GIB = 1024 ** 3;
const eins = (n) => Math.round(n * 10) / 10;

/**
 * Parse `nvidia-smi --query-gpu=name,memory.total,memory.free --format=csv,noheader[,nounits]`.
 * One line per GPU: "NVIDIA GeForce RTX 3080, 10240 MiB, 9311 MiB" (or without units).
 * "[N/A]" values become null.
 * @param {string} text stdout
 * @returns {Array<{ name: string, vramGb: number|null, vramFreiGb: number|null }>} sorted by VRAM, largest first
 */
export function nvidiaSmiLesen(text) {
  const mib = (s) => {
    const m = String(s ?? '').trim().match(/^([\d.]+)\s*(MiB|GiB)?$/i);
    if (!m) return null;
    const n = Number(m[1]);
    if (!Number.isFinite(n)) return null;
    return eins((m[2] || 'MiB').toLowerCase() === 'gib' ? n : n / 1024);
  };
  return String(text ?? '').split(/\r?\n/).map((z) => z.trim()).filter(Boolean).map((z) => {
    const teile = z.split(',').map((t) => t.trim());
    if (teile.length < 2) return null;
    return { name: teile[0], vramGb: mib(teile[1]), vramFreiGb: mib(teile[2]) };
  }).filter((g) => g && g.name).sort((a, b) => (b.vramGb ?? 0) - (a.vramGb ?? 0));
}

/**
 * Ollama's model folder. [CITED] https://docs.ollama.com/faq — OLLAMA_MODELS, default ~/.ollama/models
 * (macOS, Windows: %USERPROFILE%\.ollama\models; Linux service installs may use /usr/share/ollama).
 * @param {Record<string, string|undefined>} env
 * @param {string} homedir
 * @returns {string}
 */
export function ollamaModellOrdner(env, homedir) {
  return env.OLLAMA_MODELS ? path.resolve(env.OLLAMA_MODELS) : path.join(homedir, '.ollama', 'models');
}

/**
 * Free space of the disk that holds `ordner` (nearest existing parent), GiB.
 * @param {string} ordner
 * @param {(p: string) => Promise<{ bavail: number|bigint, bsize: number|bigint }>} statfsFn
 * @returns {Promise<number|null>} null when unknown
 */
export async function freierPlatzGb(ordner, statfsFn) {
  let p = ordner;
  for (let i = 0; i < 30; i += 1) {
    try {
      const s = await statfsFn(p);
      return eins((Number(s.bavail) * Number(s.bsize)) / GIB);
    } catch {
      const hoch = path.dirname(p);
      if (hoch === p) return null;
      p = hoch;
    }
  }
  return null;
}

/**
 * Run a program, resolve its stdout ('' on any failure — a missing nvidia-smi is the normal case).
 * @param {typeof execFile} execFileFn
 * @param {string} cmd
 * @param {string[]} args
 * @returns {Promise<string>}
 */
function lesen(execFileFn, cmd, args) {
  return new Promise((resolve) => {
    try {
      execFileFn(cmd, args, { timeout: 6000, windowsHide: true }, (err, stdout) => resolve(err ? '' : String(stdout || '')));
    } catch {
      resolve('');
    }
  });
}

/**
 * Probe this computer.
 * @param {{ execFileFn?: any, osApi?: { totalmem: () => number, freemem: () => number, cpus: () => Array<{model: string}>, homedir: () => string },
 *   statfsFn?: (p: string) => Promise<any>, env?: Record<string, string|undefined>, plattform?: NodeJS.Platform, arch?: string }} [deps]
 * @returns {Promise<import('../packages/nova-core/src/lib/modellEmpfehlung.js').Hardware & { plattform: string, modellOrdner: string }>}
 */
export async function hardwareErmitteln(deps = {}) {
  const osApi = deps.osApi ?? os;
  const execFileFn = deps.execFileFn ?? execFile;
  const statfsFn = deps.statfsFn ?? ((p) => fs.promises.statfs(p));
  const env = deps.env ?? process.env;
  const plattform = deps.plattform ?? process.platform;
  const arch = deps.arch ?? process.arch;
  const cpus = osApi.cpus() || [];
  const cpuModell = String(cpus[0]?.model || '').trim();
  const modellOrdner = ollamaModellOrdner(env, osApi.homedir());

  /** @type {{ name: string|null, vramGb: number|null, vramFreiGb: number|null, art: 'nvidia'|'apple'|'andere'|'keine' }} */
  let gpu = { name: null, vramGb: null, vramFreiGb: null, art: 'keine' };
  if (plattform === 'darwin' && arch === 'arm64') {
    gpu = { name: cpuModell || 'Apple Silicon', vramGb: null, vramFreiGb: null, art: 'apple' };
  } else {
    const nvidia = nvidiaSmiLesen(await lesen(execFileFn, 'nvidia-smi', ['--query-gpu=name,memory.total,memory.free', '--format=csv,noheader']));
    if (nvidia.length) {
      gpu = { ...nvidia[0], art: 'nvidia' };
    } else if (plattform === 'win32') {
      const namen = (await lesen(execFileFn, 'powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '(Get-CimInstance Win32_VideoController).Name']))
        .split(/\r?\n/).map((z) => z.trim()).filter((z) => z && !/basic (display|render)|remote display|virtual/i.test(z));
      if (namen.length) gpu = { name: namen[0], vramGb: null, vramFreiGb: null, art: 'andere' };
    }
  }

  return {
    plattform,
    ramGesamtGb: eins(osApi.totalmem() / GIB),
    ramFreiGb: eins(osApi.freemem() / GIB),
    cpu: { modell: cpuModell, kerne: cpus.length },
    plattenFreiGb: await freierPlatzGb(modellOrdner, statfsFn),
    modellOrdner,
    gpu,
  };
}
