// Unit tests for plan 93-12, app server: the harness process manager with a fake child process (no Python
// is started), the hardware probe with injected system calls (nvidia-smi parsing, Apple, Windows CIM),
// the Ollama setup path (pull progress from a mocked stream, disk check, cancel, benchmark evaluation,
// catalog update with a mocked fetch) and the router's loopback/origin rules + harness environment.
// No test downloads anything, needs Ollama/LM Studio or touches harness/.venv.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import path from "node:path";
import express from "express";
import { harnessManager, venvPython, pythonKandidaten } from "../../server/harnessProzess.js";
import { nvidiaSmiLesen, hardwareErmitteln, freierPlatzGb, ollamaModellOrdner } from "../../server/hardware.js";
import {
  pullStart, pullZeileVerarbeiten, pullManager, benchmarkAuswerten, benchmarkAusfuehren, katalogHolen, katalogUrl, lokaleServerErkennen, KATALOG_PFAD,
} from "../../server/ollamaDienst.js";
import { harnessUmgebung, modellAlsVerbindung, kiLokalRouter } from "../../server/kiLokalRouter.js";

const HARNESS = path.join(path.sep, "app", "harness");

/** A fake child process: stdout/stderr streams, exit/error events, kill records. */
function fakeKind(pid = 4711) {
  const k = /** @type {any} */ (new EventEmitter());
  k.pid = pid;
  k.stdout = new PassThrough();
  k.stderr = new PassThrough();
  k.beenden = (code = 0) => k.emit("exit", code);
  return k;
}

/** Wait until a condition holds (polls every 5 ms, max 2 s). */
async function bis(fn) {
  const ende = Date.now() + 2000;
  while (Date.now() < ende) { if (fn()) return; await new Promise((r) => setTimeout(r, 5)); }
  throw new Error("Bedingung nicht erreicht");
}

describe("93-12 harness process manager (fake child)", () => {
  it("no venv and no BIT_HARNESS_PYTHON → nicht-eingerichtet; start does nothing", async () => {
    const spawns = [];
    const m = harnessManager({ harnessDir: HARNESS, env: {}, plattform: "win32", existsFn: () => false, spawnFn: (...a) => { spawns.push(a); return fakeKind(); }, erreichbarFn: async () => false });
    assert.equal(m.status().zustand, "nicht-eingerichtet");
    assert.equal((await m.start()).zustand, "nicht-eingerichtet");
    assert.equal(spawns.length, 0);
  });

  it("start: spawns venv python on 127.0.0.1 with the app environment, becomes 'laeuft' when /status answers", async () => {
    const venv = venvPython(HARNESS, "win32");
    let kind; let antwortet = false; const aufrufe = [];
    const m = harnessManager({
      harnessDir: HARNESS, env: { PATH: "x" }, plattform: "win32", existsFn: (p) => p === venv, pollMs: 5,
      spawnFn: (cmd, args, opt) => { aufrufe.push({ cmd, args, opt }); kind = fakeKind(); setTimeout(() => { kind.stdout.write("Uvicorn running\n"); antwortet = true; }, 20); return kind; },
      erreichbarFn: async () => antwortet && aufrufe.length > 0,
    });
    assert.equal(m.status().zustand, "gestoppt");
    const s = await m.start({ BIT_NUR_LOKAL: "1", BIT_LOKAL_MODELL: "gemma4:12b" });
    assert.equal(s.zustand, "laeuft");
    assert.equal(s.pid, 4711);
    assert.equal(aufrufe[0].cmd, venv);
    assert.deepEqual(aufrufe[0].args, ["-m", "harness", "serve", "--host", "127.0.0.1", "--port", "8765"]);
    assert.equal(aufrufe[0].opt.cwd, HARNESS);
    assert.equal(aufrufe[0].opt.env.BIT_NUR_LOKAL, "1");
    assert.equal(aufrufe[0].opt.env.BIT_LOKAL_MODELL, "gemma4:12b");
    assert.equal(aufrufe[0].opt.windowsHide, true);
    await bis(() => s.log.length > 0 || m.status().log.some((z) => z.includes("Uvicorn")));
    assert.equal((await m.start()).pid, 4711, "second start is a no-op");
  });

  it("something already answers on the port → 'extern', nothing spawned", async () => {
    let gespawnt = false;
    const m = harnessManager({ harnessDir: HARNESS, env: {}, existsFn: () => true, spawnFn: () => { gespawnt = true; return fakeKind(); }, erreichbarFn: async () => true });
    assert.equal((await m.start()).zustand, "extern");
    assert.equal(gespawnt, false);
  });

  it("child exits while starting → 'fehler' with the last lines", async () => {
    let kind;
    const m = harnessManager({
      harnessDir: HARNESS, env: {}, existsFn: () => true, pollMs: 5,
      spawnFn: () => { kind = fakeKind(); setTimeout(() => { kind.stderr.write("ModuleNotFoundError: No module named 'fastapi'\n"); setTimeout(() => kind.beenden(1), 5); }, 5); return kind; },
      erreichbarFn: async () => false,
    });
    const s = await m.start();
    assert.equal(s.zustand, "fehler");
    assert.match(s.fehler, /Code 1/);
    assert.ok(s.log.some((z) => z.includes("ModuleNotFoundError")));
  });

  it("no answer within startTimeoutMs → tree kill + 'fehler'", async () => {
    const killed = [];
    const m = harnessManager({ harnessDir: HARNESS, env: {}, existsFn: () => true, pollMs: 5, startTimeoutMs: 40, spawnFn: () => fakeKind(99), erreichbarFn: async () => false, killBaumFn: (pid) => killed.push(pid) });
    const s = await m.start();
    assert.equal(s.zustand, "fehler");
    assert.match(s.fehler, /nicht geantwortet/);
    assert.deepEqual(killed, [99]);
  });

  it("stop kills the process tree and returns to 'gestoppt'; beenden() is synchronous", async () => {
    let kind; let an = false; const killed = [];
    const m = harnessManager({
      harnessDir: HARNESS, env: {}, existsFn: () => true, pollMs: 5,
      spawnFn: () => { kind = fakeKind(1234); an = true; return kind; },
      erreichbarFn: async () => an,
      killBaumFn: (pid) => { killed.push(pid); setTimeout(() => kind.beenden(null), 5); },
    });
    await m.start();
    const s = await m.stop();
    assert.equal(s.zustand, "gestoppt");
    assert.deepEqual(killed, [1234]);
    an = false;
    const m2 = harnessManager({ harnessDir: HARNESS, env: {}, existsFn: () => true, pollMs: 5, spawnFn: () => { an = true; return fakeKind(55); }, erreichbarFn: async () => an, killBaumFn: (pid) => killed.push(pid) });
    await m2.start();
    m2.beenden();
    assert.equal(killed.at(-1), 55);
  });

  it("einrichten: finds Python, creates .venv, installs the pinned packages with pip install -e .", async () => {
    const befehle = [];
    let venvDa = false;
    const venv = venvPython(HARNESS, "win32");
    const m = harnessManager({
      harnessDir: HARNESS, env: {}, plattform: "win32", existsFn: (p) => p === venv && venvDa,
      spawnFn: (cmd, args) => {
        befehle.push([cmd, ...args].join(" "));
        const k = fakeKind();
        setTimeout(() => {
          if (args.includes("-c")) { k.stdout.write(cmd === "py" && args[0] === "-3.13" ? "False\n" : "True\n"); }
          if (args.includes("venv")) venvDa = true;
          if (args.includes("pip")) k.stdout.write("Successfully installed fastapi-0.141.1\n");
          setTimeout(() => k.beenden(0), 2);
        }, 2);
        return k;
      },
    });
    const ende = m.einrichten();
    assert.equal(m.status().zustand, "richtet-ein");
    const s = await ende;
    assert.equal(s.zustand, "gestoppt");
    assert.equal(s.eingerichtet, true);
    assert.match(befehle[0], /^py -3\.13 -c /);
    assert.match(befehle[1], /^py -3\.12 -c /, "3.13 said False → next candidate");
    assert.equal(befehle[2], "py -3.12 -m venv .venv");
    assert.equal(befehle[3], `${venv} -m pip install -e .`);
    assert.ok(s.log.some((z) => z.includes("Successfully installed")));
  });

  it("einrichten without any usable Python → plain sentence with the download page", async () => {
    const m = harnessManager({ harnessDir: HARNESS, env: {}, plattform: "linux", existsFn: () => false, spawnFn: () => { const k = fakeKind(); setTimeout(() => k.emit("error", Object.assign(new Error("spawn python3 ENOENT"), { code: "ENOENT" })), 2); return k; } });
    const s = await m.einrichten();
    assert.equal(s.zustand, "fehler");
    assert.match(s.fehler, /Python 3\.11, 3\.12 oder 3\.13 wurde nicht gefunden.*python\.org/);
  });

  it("pip failure → 'fehler', can be repeated", async () => {
    let venvDa = false;
    const m = harnessManager({ harnessDir: HARNESS, env: { BIT_HARNESS_PYTHON: "/opt/py/bin/python3" }, plattform: "linux", existsFn: (p) => venvDa && p.endsWith(path.join(".venv", "bin", "python")), spawnFn: (cmd, args) => {
      const k = fakeKind();
      setTimeout(() => { if (args.includes("-c")) k.stdout.write("True\n"); if (args.includes("venv")) venvDa = true; k.beenden(args.includes("pip") ? 1 : 0); }, 2);
      return k;
    } });
    const s = await m.einrichten();
    assert.equal(s.zustand, "fehler");
    assert.match(s.fehler, /Paketinstallation ist fehlgeschlagen \(Code 1\)/);
  });

  it("Python candidates per platform, configured interpreter first", () => {
    assert.deepEqual(pythonKandidaten({ BIT_HARNESS_PYTHON: "C:/py/python.exe" }, "win32")[0], ["C:/py/python.exe"]);
    assert.deepEqual(pythonKandidaten({}, "win32").slice(0, 3), [["py", "-3.13"], ["py", "-3.12"], ["py", "-3.11"]]);
    assert.deepEqual(pythonKandidaten({}, "darwin")[0], ["python3.13"]);
  });
});

describe("93-12 hardware probe", () => {
  it("nvidia-smi with and without units, several GPUs (largest first), N/A", () => {
    assert.deepEqual(nvidiaSmiLesen("NVIDIA GeForce RTX 3080, 10240 MiB, 9311 MiB\n"), [{ name: "NVIDIA GeForce RTX 3080", vramGb: 10, vramFreiGb: 9.1 }]);
    assert.deepEqual(nvidiaSmiLesen("NVIDIA GeForce RTX 4090, 24564, 23000\r\nNVIDIA T400, 2048, [N/A]\r\n").map((g) => [g.name, g.vramGb, g.vramFreiGb]), [["NVIDIA GeForce RTX 4090", 24, 22.5], ["NVIDIA T400", 2, null]]);
    assert.deepEqual(nvidiaSmiLesen(""), []);
    assert.deepEqual(nvidiaSmiLesen("Failed to initialize NVML: Driver/library version mismatch"), []);
  });

  const osApi = (ramGb, cpu = "Test CPU") => ({ totalmem: () => ramGb * 1024 ** 3, freemem: () => ramGb * 0.5 * 1024 ** 3, cpus: () => Array(8).fill({ model: cpu }), homedir: () => path.join(path.sep, "home", "test") });
  const execFake = (antworten) => (cmd, _args, _opt, cb) => { const a = antworten[cmd]; if (a === undefined) cb(Object.assign(new Error("ENOENT"), { code: "ENOENT" }), ""); else cb(null, a); };
  const statfs = async () => ({ bavail: 50 * 1024 ** 3 / 4096, bsize: 4096 });

  it("Windows with NVIDIA", async () => {
    const hw = await hardwareErmitteln({ osApi: osApi(32), plattform: "win32", arch: "x64", env: {}, statfsFn: statfs, execFileFn: execFake({ "nvidia-smi": "NVIDIA GeForce RTX 3080, 10240 MiB, 9000 MiB\n" }) });
    assert.equal(hw.gpu.art, "nvidia");
    assert.equal(hw.gpu.vramGb, 10);
    assert.equal(hw.ramGesamtGb, 32);
    assert.equal(hw.cpu.kerne, 8);
    assert.equal(hw.plattenFreiGb, 50);
  });
  it("Windows with an Intel/AMD GPU → name from CIM, VRAM unknown", async () => {
    const hw = await hardwareErmitteln({ osApi: osApi(16), plattform: "win32", arch: "x64", env: {}, statfsFn: statfs, execFileFn: execFake({ "powershell.exe": "Microsoft Basic Display Adapter\r\nAMD Radeon RX 7800 XT\r\n" }) });
    assert.deepEqual(hw.gpu, { name: "AMD Radeon RX 7800 XT", vramGb: null, vramFreiGb: null, art: "andere" });
  });
  it("Apple Silicon → unified memory, no nvidia-smi call", async () => {
    let gerufen = false;
    const hw = await hardwareErmitteln({ osApi: osApi(36, "Apple M3 Max"), plattform: "darwin", arch: "arm64", env: {}, statfsFn: statfs, execFileFn: (c, a, o, cb) => { gerufen = true; cb(new Error("x"), ""); } });
    assert.equal(hw.gpu.art, "apple");
    assert.equal(hw.gpu.name, "Apple M3 Max");
    assert.equal(gerufen, false);
  });
  it("Linux without NVIDIA → 'keine'", async () => {
    const hw = await hardwareErmitteln({ osApi: osApi(16), plattform: "linux", arch: "x64", env: {}, statfsFn: statfs, execFileFn: execFake({}) });
    assert.equal(hw.gpu.art, "keine");
  });
  it("models folder: OLLAMA_MODELS wins; free space walks up to an existing parent", async () => {
    assert.equal(ollamaModellOrdner({ OLLAMA_MODELS: path.join(path.sep, "daten", "modelle") }, "/h"), path.resolve(path.join(path.sep, "daten", "modelle")));
    assert.equal(ollamaModellOrdner({}, path.join(path.sep, "h")), path.join(path.sep, "h", ".ollama", "models"));
    const gesehen = [];
    const frei = await freierPlatzGb(path.join(path.sep, "a", "b", "c"), async (p) => { gesehen.push(p); if (p !== path.join(path.sep, "a")) throw new Error("ENOENT"); return { bavail: 2n * 1024n ** 3n / 4096n, bsize: 4096n }; });
    assert.equal(frei, 2);
    assert.equal(gesehen.at(-1), path.join(path.sep, "a"));
  });
});

describe("93-12 Ollama pull, benchmark, catalog", () => {
  const ZEILEN = [
    '{"status":"pulling manifest"}',
    '{"status":"pulling 6a0746a1ec1a","digest":"sha256:6a07","total":4000000000,"completed":0}',
    '{"status":"pulling 6a0746a1ec1a","digest":"sha256:6a07","total":4000000000,"completed":1000000000}',
    '{"status":"pulling 4fa551d4f938","digest":"sha256:4fa5","total":1000000000,"completed":1000000000}',
    "kein json",
    '{"status":"verifying sha256 digest"}',
    '{"status":"writing manifest"}',
    '{"status":"success"}',
  ];

  it("progress over several layers, unparsable lines ignored, success = 100 %", () => {
    let s = pullStart("qwen3.5:4b");
    s = pullZeileVerarbeiten(s, ZEILEN[0]);
    assert.equal(s.prozent, 0);
    s = pullZeileVerarbeiten(s, ZEILEN[2]);
    assert.equal(s.prozent, 25);
    s = pullZeileVerarbeiten(s, ZEILEN[3]);
    assert.equal(s.gesamtBytes, 5_000_000_000);
    assert.equal(s.fertigBytes, 2_000_000_000);
    assert.equal(s.prozent, 40);
    assert.equal(pullZeileVerarbeiten(s, ZEILEN[4]), s, "unparsable line → unchanged");
    s = pullZeileVerarbeiten(s, ZEILEN[7]);
    assert.equal(s.fertig, true);
    assert.equal(s.prozent, 100);
    const f = pullZeileVerarbeiten(pullStart("x"), '{"error":"pull model manifest: file does not exist"}');
    assert.match(f.fehler, /^Ollama: pull model manifest/);
  });

  it("pull manager: mocked stream, success → onFertig with the model; second start while running → 409", async () => {
    let fertig = null;
    let freigeben;
    const streamFn = async (url, o) => {
      assert.equal(url, "http://127.0.0.1:11434/api/pull");
      assert.deepEqual(JSON.parse(o.body), { model: "qwen3.5:4b", stream: true });
      await new Promise((r) => { freigeben = r; });
      for (const z of ZEILEN) o.onZeile(z);
      return { status: 200 };
    };
    const m = pullManager({ streamFn });
    m.start({ url: "http://127.0.0.1:11434/", modell: "qwen3.5:4b", benoetigtGb: 3.4, freiGb: 100, onFertig: (x) => { fertig = x; } });
    assert.throws(() => m.start({ url: "http://127.0.0.1:11434", modell: "gemma4:12b" }), (e) => e.status === 409);
    freigeben();
    await m.warten();
    assert.equal(m.status().fertig, true);
    assert.equal(fertig, "qwen3.5:4b");
  });

  it("disk check before the first byte, bad names and remote Ollama refused", () => {
    const m = pullManager({ streamFn: async () => { throw new Error("must not stream"); } });
    assert.throws(() => m.start({ url: "http://127.0.0.1:11434", modell: "qwen3.6:35b", benoetigtGb: 21, freiGb: 20 }), /Zu wenig Platz: qwen3\.6:35b braucht etwa 21 GB/);
    assert.throws(() => m.start({ url: "http://127.0.0.1:11434", modell: "../../etc", benoetigtGb: 1, freiGb: 100 }), /Ungültiger Modellname/);
    assert.throws(() => m.start({ url: "http://192.168.1.9:11434", modell: "qwen3.5:4b" }), /auf diesem Rechner/);
  });

  it("cancel aborts the stream; Ollama not running → plain sentence", async () => {
    const m = pullManager({ streamFn: (url, o) => new Promise((_, rej) => o.signal.addEventListener("abort", () => rej(Object.assign(new Error("Abgebrochen"), { name: "AbortError" })))) });
    m.start({ url: "http://127.0.0.1:11434", modell: "qwen3.5:4b" });
    assert.equal(m.abbrechen().abgebrochen, true);
    await m.warten();
    assert.equal(m.status().fehler, null);
    const tot = pullManager({ streamFn: async () => { throw Object.assign(new Error("x"), { code: "ECONNREFUSED" }); } });
    tot.start({ url: "http://127.0.0.1:11434", modell: "qwen3.5:4b" });
    await tot.warten();
    assert.match(tot.status().fehler, /^Ollama antwortet nicht/);
  });

  it("stream ends without success → error that says Ollama resumes", async () => {
    const m = pullManager({ streamFn: async (u, o) => { o.onZeile(ZEILEN[1]); return { status: 200 }; } });
    m.start({ url: "http://127.0.0.1:11434", modell: "qwen3.5:4b" });
    await m.warten();
    assert.match(m.status().fehler, /ohne Erfolgsmeldung/);
  });

  it("benchmark: tokens/s from eval_count/eval_duration (ns), first answer = load + prompt eval", async () => {
    assert.deepEqual(benchmarkAuswerten({ eval_count: 128, eval_duration: 7_111_111_111, load_duration: 2_000_000_000, prompt_eval_duration: 300_000_000 }), { tokenProSekunde: 18, ersteAntwortMs: 2300, tokens: 128, ladezeitMs: 2000 });
    assert.equal(benchmarkAuswerten({ response: "x" }), null);
    let body;
    const r = await benchmarkAusfuehren({ url: "http://127.0.0.1:11434", modell: "gemma4:12b", anfrageFn: async (url, o) => { body = JSON.parse(o.body); return { ok: true, status: 200, text: async () => "", json: async () => ({ eval_count: 64, eval_duration: 4e9 }) }; } });
    assert.equal(r.ok, true);
    assert.equal(r.ergebnis.tokenProSekunde, 16);
    assert.equal(body.stream, false);
    assert.equal(body.options.temperature, 0);
    assert.equal((await benchmarkAusfuehren({ url: "https://evil.example", modell: "m" })).ok, false);
  });

  it("catalog update: only raw.githubusercontent.com over https, validated, offline fallback in plain text", async () => {
    assert.equal(katalogUrl("o/r"), `https://raw.githubusercontent.com/o/r/main/${KATALOG_PFAD}`);
    let gerufen = false;
    const nie = async () => { gerufen = true; return new Response("{}"); };
    assert.match((await katalogHolen({ url: "https://evil.example/k.json", fetchFn: nie })).fehler, /nicht erlaubt/);
    assert.match((await katalogHolen({ url: "http://raw.githubusercontent.com/x", fetchFn: nie })).fehler, /nicht erlaubt/);
    assert.equal(gerufen, false);
    const gut = { schema: 1, stand: "2026-11-01", modelle: [{ tag: "neu:7b", parameterB: 7 }] };
    const r = await katalogHolen({ url: katalogUrl("o/r"), fetchFn: async () => new Response(JSON.stringify(gut)) });
    assert.equal(r.ok, true);
    assert.equal(r.katalog.stand, "2026-11-01");
    assert.match((await katalogHolen({ url: katalogUrl("o/r"), fetchFn: async () => new Response("<html>") })).fehler, /kein gültiges JSON/);
    assert.match((await katalogHolen({ url: katalogUrl("o/r"), fetchFn: async () => new Response(JSON.stringify({ schema: 1, stand: "x", modelle: [] })) })).fehler, /ungültig/);
    assert.match((await katalogHolen({ url: katalogUrl("o/r"), fetchFn: async () => new Response("x".repeat(300 * 1024)) })).fehler, /zu groß/);
    assert.match((await katalogHolen({ url: katalogUrl("o/r"), fetchFn: async () => { throw new TypeError("fetch failed"); } })).fehler, /offline\? Der mitgelieferte Katalog bleibt aktiv/);
  });

  it("detection of Ollama and LM Studio", async () => {
    const anfrageFn = async (url) => {
      if (url.endsWith("/api/version")) return { ok: true, status: 200, text: async () => "", json: async () => ({ version: "0.12.3" }) };
      throw Object.assign(new Error("x"), { code: "ECONNREFUSED" });
    };
    const e = await lokaleServerErkennen({ ollamaUrl: "http://127.0.0.1:11434/", lmstudioUrl: "http://127.0.0.1:1234/v1", anfrageFn });
    assert.deepEqual(e.ollama, { ok: true, url: "http://127.0.0.1:11434", version: "0.12.3" });
    assert.equal(e.lmstudio.ok, false);
    assert.match(e.lmstudio.fehler, /LM Studio antwortet nicht/);
  });
});

/** Minimal db for the router helpers. */
function fakeDb(zeilen = {}) {
  const t = JSON.parse(JSON.stringify(zeilen));
  let n = 0;
  return {
    list: (e) => [...(t[e] || [])],
    get: (e, id) => (t[e] || []).find((r) => r.id === id) || null,
    create: (e, r) => { const rec = { ...r, id: `n${++n}` }; (t[e] ||= []).push(rec); return rec; },
    update: (e, id, p) => { const r = (t[e] || []).find((x) => x.id === id); Object.assign(r, p); return r; },
  };
}

describe("93-12 harness environment and connection helper", () => {
  it("an active local connection is handed to the harness (OpenAI-compatible base), cloud ones are not", () => {
    const lm = fakeDb({ LlmConnection: [{ id: "a", provider: "openai", base_url: "http://127.0.0.1:1234/v1", model: "gemma-4-12b", active: true, api_key: "" }] });
    assert.deepEqual(harnessUmgebung(lm, ["http://localhost:3001"]), { BIT_NUR_LOKAL: "0", HARNESS_ALLOWED_ORIGINS: "http://localhost:3001", BIT_LOKAL_BASE_URL: "http://127.0.0.1:1234/v1", BIT_LOKAL_MODELL: "gemma-4-12b", BIT_LOKAL_ART: "openai" });
    const ol = fakeDb({ LlmConnection: [{ id: "b", provider: "ollama", base_url: "", model: "qwen3.5:9b", active: true }], KiEinstellung: [{ id: "k", nur_lokal: true }] });
    const env = harnessUmgebung(ol);
    assert.equal(env.BIT_NUR_LOKAL, "1");
    assert.equal(env.BIT_LOKAL_BASE_URL, "http://127.0.0.1:11434/v1");
    assert.equal(env.BIT_LOKAL_ART, "ollama");
    const cloud = fakeDb({ LlmConnection: [{ id: "c", provider: "openai", base_url: "https://api.openai.com/v1", model: "g", api_key: "sk-geheim", active: true }] });
    const ce = harnessUmgebung(cloud);
    assert.equal(ce.BIT_LOKAL_BASE_URL, undefined);
    assert.ok(!JSON.stringify(ce).includes("sk-geheim"), "never a key");
  });
  it("modellAlsVerbindung: updates the Ollama connection, creates one active only when nothing else is active or Nur lokal is on", () => {
    const db = fakeDb({ LlmConnection: [{ id: "cloud", provider: "anthropic", base_url: "", model: "c", active: true }] });
    const r1 = modellAlsVerbindung(db, { ollamaUrl: "http://127.0.0.1:11434", modell: "qwen3.5:4b", nurLokal: false });
    assert.equal(r1.neu, true);
    assert.equal(r1.aktiv, false, "a working cloud connection is not switched off behind the user's back");
    const r2 = modellAlsVerbindung(db, { ollamaUrl: "http://127.0.0.1:11434/", modell: "gemma4:12b", nurLokal: false });
    assert.equal(r2.neu, false);
    assert.equal(db.get("LlmConnection", r1.id).model, "gemma4:12b");
    const db2 = fakeDb({ LlmConnection: [{ id: "cloud", provider: "openai", base_url: "https://api.openai.com/v1", model: "g", active: true }] });
    const r3 = modellAlsVerbindung(db2, { ollamaUrl: "http://127.0.0.1:11434", modell: "m", nurLokal: true });
    assert.equal(r3.aktiv, true);
    assert.equal(db2.get("LlmConnection", "cloud").active, false);
  });
});

describe("93-12 /api/ki router rules", () => {
  let server; let basis;
  const starte = async (lokalGebunden) => {
    const app = express();
    app.use(express.json());
    app.use("/api", kiLokalRouter({
      db: fakeDb(), root: path.resolve("."), lokalGebunden, port: 3999, origins: ["http://localhost:5999"],
      harness: /** @type {any} */ ({ status: () => ({ zustand: "gestoppt", eingerichtet: true, log: [] }), start: async () => ({}), stop: async () => ({}), neustart: async () => ({}), einrichten: async () => ({}) }),
      hardwareFn: async () => /** @type {any} */ ({ ramGesamtGb: 16, plattenFreiGb: 100, gpu: { art: "keine" } }),
    }));
    await new Promise((r) => { server = app.listen(0, "127.0.0.1", r); });
    basis = `http://127.0.0.1:${server.address().port}/api`;
  };
  after(() => server?.close());

  it("LAN opt-out → every route 403", async () => {
    await starte(false);
    assert.equal((await fetch(`${basis}/ki/harness`)).status, 403);
    server.close();
  });
  it("loopback: GET allowed, POST only with the app's Origin", async () => {
    await starte(true);
    const g = await (await fetch(`${basis}/ki/harness`)).json();
    assert.equal(g.zustand, "gestoppt");
    assert.equal(g.nurLokal, false);
    assert.equal((await fetch(`${basis}/ki/harness/start`, { method: "POST" })).status, 403);
    assert.equal((await fetch(`${basis}/ki/harness/start`, { method: "POST", headers: { origin: "https://evil.example" } })).status, 403);
    assert.equal((await fetch(`${basis}/ki/harness/start`, { method: "POST", headers: { origin: "http://localhost:5999" } })).status, 200);
    assert.equal((await fetch(`${basis}/ki/harness/kaputt`, { method: "POST", headers: { origin: "http://localhost:3999" } })).status, 404);
    const k = await (await fetch(`${basis}/ki/katalog`)).json();
    assert.equal(k.stand >= "2026-10-12", true);
    assert.ok(k.modelle.length >= 20);
  });
});
