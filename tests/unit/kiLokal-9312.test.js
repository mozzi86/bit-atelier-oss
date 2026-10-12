// Unit tests for plan 93-12, pure part: loopback detection, model-list URLs and parsing, plain errors
// (kiLokal.js), the model catalog (modellKatalog.js + the bundled lokaleModelle.json) and the
// recommendation rules (modellEmpfehlung.js) for six hardware fixtures. No network, no hardware access.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  istLoopbackHost, istLoopbackUrl, modellListenUrl, modelleAusAntwort, openaiBasis, lokalerFehlerText, nurLokalMeldung,
} from "../../packages/nova-core/src/lib/kiLokal.js";
import {
  katalogPruefen, geschaetzteGroesseGb, neuererKatalog, mitInstallierten, tagGleich, parameterAusText,
} from "../../packages/nova-core/src/lib/modellKatalog.js";
import { empfehlen, benchmarkUrteil, gpuSpeicherGb, GPU_RESERVE_GB } from "../../packages/nova-core/src/lib/modellEmpfehlung.js";

const BUNDLED = JSON.parse(fs.readFileSync(new URL("../../packages/nova-core/src/lib/lokaleModelle.json", import.meta.url), "utf8"));

describe("93-12 loopback detection", () => {
  for (const url of [
    "http://127.0.0.1:1234/v1", "http://localhost:11434", "http://LOCALHOST", "http://127.8.9.10:80/x",
    "http://[::1]:1234/v1", "http://[0:0:0:0:0:0:0:1]:1", "http://[::ffff:127.0.0.1]:1234", "https://api.localhost/v1",
    "http://2130706433/", // decimal form of 127.0.0.1 — the URL parser normalises it
  ]) {
    it(`accepts ${url}`, () => assert.equal(istLoopbackUrl(url), true));
  }
  for (const url of [
    "https://api.openai.com/v1", "http://127.0.0.1.evil.example/", "http://127.0.0.1@evil.example/",
    "http://localhost.evil.example", "http://10.0.0.1:1234", "http://192.168.178.20:11434", "http://[::2]/",
    "http://[::ffff:10.0.0.1]/", "ftp://127.0.0.1/", "file:///etc/passwd", "", "kein url", "http://128.0.0.1/",
  ]) {
    it(`refuses ${JSON.stringify(url)}`, () => assert.equal(istLoopbackUrl(url), false));
  }
  it("host rules directly", () => {
    assert.equal(istLoopbackHost("[::1]"), true);
    assert.equal(istLoopbackHost("::ffff:7f00:1"), true);
    assert.equal(istLoopbackHost("127.0.0.256"), false);
    assert.equal(istLoopbackHost(""), false);
  });
});

describe("93-12 model discovery parsing", () => {
  it("model list URL per connection type", () => {
    assert.equal(modellListenUrl("openai", "http://127.0.0.1:1234/v1"), "http://127.0.0.1:1234/v1/models");
    assert.equal(modellListenUrl("custom", "http://127.0.0.1:1234/v1/chat/completions"), "http://127.0.0.1:1234/v1/models");
    assert.equal(modellListenUrl("ollama", "http://127.0.0.1:11434"), "http://127.0.0.1:11434/api/tags");
    assert.equal(modellListenUrl("ollama", "http://127.0.0.1:11434/v1/"), "http://127.0.0.1:11434/api/tags");
    assert.equal(modellListenUrl("openai", "https://api.openai.com"), "https://api.openai.com/v1/models");
    assert.equal(modellListenUrl("anthropic", "https://api.anthropic.com"), "");
    assert.equal(modellListenUrl("openai", ""), "");
  });
  it("OpenAI-compatible base for the harness", () => {
    assert.equal(openaiBasis("ollama", "http://127.0.0.1:11434"), "http://127.0.0.1:11434/v1");
    assert.equal(openaiBasis("openai", "http://127.0.0.1:1234/v1/"), "http://127.0.0.1:1234/v1");
  });
  it("LM Studio /v1/models (data[].id), embeddings left out, sorted, unique", () => {
    const lm = { object: "list", data: [{ id: "qwen3.5-9b", object: "model" }, { id: "text-embedding-nomic-embed-text-v1.5" }, { id: "gemma-4-12b" }, { id: "gemma-4-12b" }, { id: "" }, null] };
    assert.deepEqual(modelleAusAntwort(lm), ["gemma-4-12b", "qwen3.5-9b"]);
  });
  it("Ollama /api/tags (models[].name, model as fallback)", () => {
    const ol = { models: [{ name: "qwen3.5:4b", size: 3400000000 }, { model: "gemma4:12b" }, { name: 7 }] };
    assert.deepEqual(modelleAusAntwort(ol), ["gemma4:12b", "qwen3.5:4b"]);
  });
  it("anything else → []", () => {
    for (const x of [null, 42, "text", {}, { data: "x" }, []]) assert.deepEqual(modelleAusAntwort(x), []);
  });
});

describe("93-12 plain-text errors", () => {
  it("ECONNREFUSED on fetch (cause.code) and on node:http (code) name the server and how to start it", () => {
    const fetchFehler = Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    assert.match(lokalerFehlerText(fetchFehler, { provider: "openai", url: "http://127.0.0.1:1234/v1/models" }), /^LM Studio antwortet nicht unter 127\.0\.0\.1:1234 — läuft er\?.*Server starten/);
    const httpFehler = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    assert.match(lokalerFehlerText(httpFehler, { provider: "ollama", url: "http://127.0.0.1:11434/api/chat" }), /^Ollama antwortet nicht.*ollama serve/);
    assert.match(lokalerFehlerText(httpFehler, { provider: "custom", url: "http://127.0.0.1:8080/v1" }), /^Der lokale KI-Server antwortet nicht/);
  });
  it("timeout explains that the first call loads the model", () => {
    const t = lokalerFehlerText(Object.assign(new Error("x"), { name: "AbortError" }), { url: "http://127.0.0.1:1234/v1", timeoutS: 600 });
    assert.match(t, /\(600 s\).*Minuten/);
  });
  it("refusal sentence names the host", () => {
    assert.match(nurLokalMeldung("https://api.openai.com/v1/chat/completions"), /Anfragen an api\.openai\.com werden nicht gesendet/);
    assert.match(nurLokalMeldung(""), /einen Cloud-Anbieter/);
  });
});

describe("93-12 model catalog", () => {
  it("the bundled catalog validates completely, with date and every family of 12.10.2026", () => {
    const { ok, fehler, katalog } = katalogPruefen(BUNDLED);
    assert.equal(ok, true);
    assert.deepEqual(fehler, []);
    assert.equal(katalog.stand, "2026-10-12");
    const familien = new Set(katalog.modelle.map((m) => m.familie));
    for (const f of ["gemma4", "qwen3.5", "qwen3.6", "qwen3.8", "gpt-oss", "mistral-small", "llama3.2"]) assert.ok(familien.has(f), f);
    for (const m of katalog.modelle) {
      assert.ok(m.groesseQ4Gb > 0, m.tag);
      assert.ok(m.minVramGb >= m.groesseQ4Gb + GPU_RESERVE_GB - 0.05, `${m.tag}: minVram = Größe + Reserve`);
      if (m.groesseGeschaetzt && !/^gemma4:e/.test(m.tag)) assert.equal(m.groesseQ4Gb, geschaetzteGroesseGb(m.parameterB), `${m.tag}: Schätzregel`);
    }
  });
  it("documented sizes from the guides stay as given (not estimated)", () => {
    const g = Object.fromEntries(katalogPruefen(BUNDLED).katalog.modelle.map((m) => [m.tag, m]));
    assert.equal(g["qwen3.5:9b"].groesseQ4Gb, 6.6);
    assert.equal(g["gemma4:12b"].groesseQ4Gb, 7);
    assert.equal(g["qwen3.6:35b"].moe, true);
    assert.equal(g["qwen3.6:35b"].groesseGeschaetzt, false);
  });
  it("size estimate: 0.6 GB per billion + 1 GB, one decimal", () => {
    assert.equal(geschaetzteGroesseGb(27), 17.2);
    assert.equal(geschaetzteGroesseGb(0.8), 1.5);
    assert.equal(geschaetzteGroesseGb(0), 0);
    assert.equal(geschaetzteGroesseGb(NaN), 0);
  });
  it("refuses broken files and drops broken entries", () => {
    assert.equal(katalogPruefen(null).ok, false);
    assert.equal(katalogPruefen({ schema: 1, stand: "gestern", modelle: [] }).ok, false);
    assert.equal(katalogPruefen({ schema: 2, stand: "2026-10-12", modelle: [] }).ok, false);
    assert.equal(katalogPruefen({ schema: 1, stand: "2026-10-12", modelle: Array(501).fill({}) }).ok, false);
    const r = katalogPruefen({ schema: 1, stand: "2026-10-13", modelle: [
      { tag: "gut:1b", parameterB: 1, faehigkeiten: ["tools", "fliegen"], deutsch: 5 },
      { tag: "../../evil", parameterB: 1 },
      { tag: "gut:1b", parameterB: 2 },
      { tag: "riesig:1b", parameterB: 1, groesseQ4Gb: -3 },
    ] });
    assert.equal(r.ok, true);
    assert.equal(r.katalog.modelle.length, 1);
    assert.equal(r.fehler.length, 3);
    const e = r.katalog.modelle[0];
    assert.deepEqual(e.faehigkeiten, ["tools"]);
    assert.equal(e.deutsch, null);
    assert.equal(e.groesseQ4Gb, 1.6);
    assert.equal(e.groesseGeschaetzt, true);
  });
  it("newer stand wins, a tie keeps the first", () => {
    const a = { stand: "2026-10-12" }; const b = { stand: "2026-11-01" }; const c = { stand: "2026-10-12" };
    assert.equal(neuererKatalog(/** @type {any} */ (a), /** @type {any} */ (b)), b);
    assert.equal(neuererKatalog(/** @type {any} */ (b), /** @type {any} */ (a)), b);
    assert.equal(neuererKatalog(/** @type {any} */ (a), /** @type {any} */ (c)), a);
    assert.equal(neuererKatalog(null, /** @type {any} */ (a)), a);
  });
  it("merge with /api/tags: installed catalog models marked with real size, unknown ones appended", () => {
    const k = katalogPruefen(BUNDLED).katalog;
    const liste = mitInstallierten(k, { models: [
      { name: "qwen3.5:9b", size: 6_550_000_000, details: { family: "qwen35", parameter_size: "9.0B" } },
      { name: "mein-modell:latest", size: 2_000_000_000, details: { family: "llama", parameter_size: "3.2B" } },
      { name: "llama3.2", size: 2_019_000_000 },
    ] });
    const q = liste.find((m) => m.tag === "qwen3.5:9b");
    assert.equal(q.installiert, true);
    assert.equal(q.groesseInstalliertGb, 6.6);
    assert.equal(liste.find((m) => m.tag === "gemma4:12b").installiert, false);
    const eigen = liste.find((m) => m.tag === "mein-modell:latest");
    assert.equal(eigen.quelle, "installiert");
    assert.equal(eigen.parameterB, 3.2);
    assert.equal(eigen.groesseQ4Gb, 2);
    assert.equal(liste.length, k.modelle.length + 2, "llama3.2 = llama3.2:latest is not in the catalog (catalog has :1b/:3b)");
  });
  it("tag and parameter helpers", () => {
    assert.equal(tagGleich("gemma4", "gemma4:latest"), true);
    assert.equal(tagGleich("Gemma4:12B", "gemma4:12b"), true);
    assert.equal(tagGleich("gemma4:12b", "gemma4:31b"), false);
    assert.equal(parameterAusText("8.0B"), 8);
    assert.equal(parameterAusText("567M"), 0.6);
    assert.equal(parameterAusText("viel"), null);
  });
});

/** @param {Partial<import("../../packages/nova-core/src/lib/modellEmpfehlung.js").Hardware>} hw */
const HW = (hw) => /** @type {any} */ ({ ramGesamtGb: 16, plattenFreiGb: 200, cpu: { modell: "x", kerne: 8 }, gpu: { name: null, vramGb: null, art: "keine" }, ...hw });
const KATALOG = katalogPruefen(BUNDLED).katalog.modelle;
const passtGpu = (e, gb) => e.groesseQ4Gb + GPU_RESERVE_GB <= gb;

describe("93-12 recommendation rules", () => {
  it("RTX 3080, 10 GB VRAM, 32 GB RAM → a 9–12 B model fully on the GPU, plus a 'slower but better' MoE", () => {
    const r = empfehlen(HW({ ramGesamtGb: 32, gpu: { name: "NVIDIA GeForce RTX 3080", vramGb: 10, art: "nvidia" } }), KATALOG);
    assert.equal(r.stufe, "gpu");
    assert.ok(["gemma4:12b", "qwen3.5:9b"].includes(r.top.eintrag.tag), r.top.eintrag.tag);
    assert.ok(r.top.eintrag.parameterB >= 9 && r.top.eintrag.parameterB <= 12);
    assert.ok(passtGpu(r.top.eintrag, 10));
    assert.equal(r.top.gruende[0].text, "passt in {speicher} GB Grafikspeicher mit {reserve} GB Reserve");
    assert.equal(r.alternativen.length, 2);
    const besser = r.alternativen[1];
    assert.match(besser.gruende[0].text, /^langsamer, aber besser/);
    assert.ok(besser.eintrag.groesseQ4Gb + 4 <= 32, "fits RAM");
    assert.ok(!passtGpu(besser.eintrag, 10), "does not fit VRAM");
  });
  it("RTX 4090, 24 GB → a 27 B+ model of the newest generation", () => {
    const r = empfehlen(HW({ ramGesamtGb: 64, gpu: { name: "NVIDIA GeForce RTX 4090", vramGb: 24, art: "nvidia" } }), KATALOG);
    assert.equal(r.stufe, "gpu");
    assert.ok(r.top.eintrag.parameterB >= 20, r.top.eintrag.tag);
    assert.ok(passtGpu(r.top.eintrag, 24));
    assert.ok(r.top.gruende.some((g) => g.text === "neueste Modellgeneration im Katalog"));
  });
  it("Apple M3, 36 GB unified memory → ~27 GB usable, a large model, Apple hint", () => {
    const hw = HW({ ramGesamtGb: 36, gpu: { name: "Apple M3 Max", vramGb: null, art: "apple" } });
    assert.equal(gpuSpeicherGb(hw), 27);
    const r = empfehlen(hw, KATALOG);
    assert.equal(r.stufe, "apple");
    assert.ok(r.top.eintrag.parameterB >= 20);
    assert.ok(r.hinweise.some((h) => /^Apple Silicon/.test(h.text)));
  });
  it("laptop with a 6 GB GPU → a small model with headroom", () => {
    const r = empfehlen(HW({ ramGesamtGb: 16, gpu: { name: "NVIDIA GeForce RTX 3060 Laptop GPU", vramGb: 6, art: "nvidia" } }), KATALOG);
    assert.equal(r.stufe, "gpu");
    assert.ok(passtGpu(r.top.eintrag, 6));
    assert.ok(r.top.eintrag.parameterB <= 4);
  });
  it("laptop with an integrated GPU (VRAM unknown), 8 GB RAM → CPU tier, honest hint", () => {
    const r = empfehlen(HW({ ramGesamtGb: 8, gpu: { name: "Intel(R) Iris(R) Xe Graphics", vramGb: null, art: "andere" } }), KATALOG);
    assert.equal(r.stufe, "cpu");
    assert.ok(r.hinweise.some((h) => /Grafikspeicher unbekannt/.test(h.text)));
    assert.ok(r.top.eintrag.groesseQ4Gb + 4 <= 8);
    assert.match(r.top.gruende[0].text, /^läuft auf dem Prozessor/);
  });
  it("CPU only, 16 GB RAM → ≤ 8 B active parameters, fits RAM", () => {
    const r = empfehlen(HW({ ramGesamtGb: 16 }), KATALOG);
    assert.equal(r.stufe, "cpu");
    const e = r.top.eintrag;
    assert.ok((e.moe ? e.aktiveParameterB : e.parameterB) <= 8, e.tag);
    assert.ok(e.groesseQ4Gb + 4 <= 16);
  });
  it("too little disk → models left out with a hint; nothing fits → no pick, plain hint", () => {
    const r = empfehlen(HW({ ramGesamtGb: 32, plattenFreiGb: 6, gpu: { name: "RTX", vramGb: 24, art: "nvidia" } }), KATALOG);
    assert.ok(r.top.eintrag.groesseQ4Gb + 2 <= 6);
    assert.ok(r.hinweise.some((h) => /passen nicht auf die Platte/.test(h.text)));
    const leer = empfehlen(HW({ ramGesamtGb: 4, plattenFreiGb: 1 }), KATALOG);
    assert.equal(leer.top, null);
    assert.ok(leer.hinweise.some((h) => /kein Modell aus dem Katalog/.test(h.text)));
  });
  it("benchmark verdict thresholds", () => {
    assert.equal(benchmarkUrteil(18), "flüssig");
    assert.equal(benchmarkUrteil(15), "flüssig");
    assert.equal(benchmarkUrteil(7.5), "brauchbar");
    assert.equal(benchmarkUrteil(2), "zäh");
    assert.equal(benchmarkUrteil(NaN), "zäh");
  });
});
