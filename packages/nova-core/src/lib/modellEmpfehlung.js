// modellEmpfehlung.js — which local model fits THIS computer (plan 93-12 C).
//
// Input is the hardware probe of the local server (server/hardware.js) and the merged catalog
// (modellKatalog.js). Rules, in this order:
//   1. GPU tier — NVIDIA with known VRAM, or Apple Silicon (unified memory, ~75 % usable by the GPU):
//      a model qualifies when its Q4 size + 1.5 GB headroom fits into that memory.
//   2. CPU tier — no usable GPU memory (AMD/Intel: VRAM unknown, reported honestly) or nothing fits:
//      size + 4 GB (system + app) must fit into RAM, and only models with ≤ 8 B active parameters
//      count (a dense 9 B+ model on a CPU answers at a few tokens per second).
//   3. Disk: size + 2 GB must fit into the free space of the models folder (when known).
// Within a tier the score prefers tool use + thinking, German quality, newer generations and — as a
// proxy for answer quality — more parameters. The result is the top pick, the runner-up of the same
// tier, and one "langsamer, aber besser" candidate that only fits RAM (MoE preferred: it computes
// only its active parameters per token, so partial CPU offload stays usable).
//
// Reasons are i18n keys with {platzhalter} plus values, so the UI translates them with t().
// Pure: no network, no hardware access. In: Hardware, KatalogEintrag[]. Out: Empfehlung.

/** Headroom on the GPU beyond the model weights (KV cache, CUDA context), GB. [ASSUMED] common guide value. */
export const GPU_RESERVE_GB = 1.5;
/** RAM kept free for the operating system and the app when a model runs on the CPU, GB. [ASSUMED] */
export const RAM_RESERVE_GB = 4;
/** Disk headroom beyond the download size, GB (temporary blobs during the pull). [ASSUMED] */
export const PLATTE_RESERVE_GB = 2;
/** Share of unified memory macOS lets the GPU use by default. [ASSUMED] ~2/3 to 3/4 depending on RAM size. */
export const APPLE_GPU_ANTEIL = 0.75;
/** Largest active parameter count (billions) still recommended for CPU inference. [ASSUMED] */
export const CPU_MAX_AKTIVE_B = 8;

/**
 * @typedef {object} Hardware
 * @property {number} ramGesamtGb installed RAM, GB
 * @property {number} [ramFreiGb] free RAM right now, GB
 * @property {{modell: string, kerne: number}} [cpu]
 * @property {number|null} [plattenFreiGb] free disk space in the models folder, GB (null = unknown)
 * @property {{name: string|null, vramGb: number|null, vramFreiGb?: number|null, art: 'nvidia'|'apple'|'andere'|'keine'}} gpu
 */

/**
 * @typedef {{ text: string, werte?: Record<string, string|number> }} Grund
 * @typedef {{ eintrag: import('./modellKatalog.js').KatalogEintrag, gruende: Grund[], punkte: number }} Vorschlag
 * @typedef {{ stufe: 'gpu'|'apple'|'cpu', speicherGb: number|null, top: Vorschlag|null,
 *   alternativen: Vorschlag[], hinweise: Grund[] }} Empfehlung
 */

const eins = (n) => Math.round(n * 10) / 10;

/**
 * Memory the GPU can hold a model in, GB.
 * @param {Hardware} hw
 * @returns {number|null} null when there is no usable/known GPU memory
 */
export function gpuSpeicherGb(hw) {
  if (hw?.gpu?.art === 'nvidia' && Number(hw.gpu.vramGb) > 0) return Number(hw.gpu.vramGb);
  if (hw?.gpu?.art === 'apple' && Number(hw.ramGesamtGb) > 0) return eins(Number(hw.ramGesamtGb) * APPLE_GPU_ANTEIL);
  return null;
}

/**
 * Active parameters per token (MoE) or total parameters (dense), billions.
 * @param {import('./modellKatalog.js').KatalogEintrag} e
 * @returns {number}
 */
export function effektiveParameterB(e) {
  return e.moe && e.aktiveParameterB ? e.aktiveParameterB : e.parameterB;
}

/**
 * Preference score of a model regardless of hardware (higher = better).
 * tools 3, thinking 2, vision 1; German quality ×2 (unknown counts as 1); generation ordinal;
 * 1.5 × log2(parameters) as a quality proxy; installed +0.5 (no download needed).
 * @param {import('./modellKatalog.js').KatalogEintrag} e
 * @returns {number}
 */
export function punkte(e) {
  const f = e.faehigkeiten || [];
  return (f.includes('tools') ? 3 : 0) + (f.includes('thinking') ? 2 : 0) + (f.includes('vision') ? 1 : 0)
    + (e.deutsch ?? 1) * 2 + (e.generation || 0) + 1.5 * Math.log2(Math.max(e.parameterB || 0.5, 0.5))
    + (e.installiert ? 0.5 : 0);
}

/**
 * Size used for fitting: the real installed size when known, else the catalog value.
 * @param {import('./modellKatalog.js').KatalogEintrag} e
 * @returns {number} GB
 */
function groesse(e) {
  return Number(e.groesseInstalliertGb) > 0 ? Number(e.groesseInstalliertGb) : Number(e.groesseQ4Gb) || 0;
}

/**
 * Common reasons for a model (capabilities, German, installed).
 * @param {import('./modellKatalog.js').KatalogEintrag} e
 * @returns {Grund[]}
 */
function eigenschaftsGruende(e) {
  /** @type {Grund[]} */
  const g = [];
  const f = e.faehigkeiten || [];
  if (f.includes('tools') && f.includes('thinking')) g.push({ text: 'kann Werkzeuge nutzen und schrittweise denken' });
  else if (f.includes('tools')) g.push({ text: 'kann Werkzeuge nutzen' });
  if (e.deutsch === 3) g.push({ text: 'sehr gutes Deutsch' });
  else if (e.deutsch === 2) g.push({ text: 'gutes Deutsch' });
  if (e.installiert) g.push({ text: 'bereits installiert — kein Download' });
  return g;
}

/**
 * Recommend a local model for the given hardware.
 * @param {Hardware} hw hardware probe
 * @param {import('./modellKatalog.js').KatalogEintrag[]} eintraege merged catalog
 * @returns {Empfehlung}
 */
export function empfehlen(hw, eintraege) {
  /** @type {Grund[]} */
  const hinweise = [];
  const ram = Number(hw?.ramGesamtGb) || 0;
  const platte = hw?.plattenFreiGb == null ? null : Number(hw.plattenFreiGb);
  const speicher = gpuSpeicherGb(hw);
  const neueste = Math.max(0, ...eintraege.map((e) => e.generation || 0));

  if (hw?.gpu?.art === 'andere') hinweise.push({ text: 'Grafikkarte {name} erkannt, Grafikspeicher unbekannt — Empfehlung nach Arbeitsspeicher und Prozessor.', werte: { name: hw.gpu.name || '?' } });
  if (hw?.gpu?.art === 'keine') hinweise.push({ text: 'Keine geeignete Grafikkarte erkannt — das Modell rechnet auf dem Prozessor.' });
  if (hw?.gpu?.art === 'apple') hinweise.push({ text: 'Apple Silicon: Grafik und Prozessor teilen sich den Arbeitsspeicher (etwa {gb} GB für das Modell nutzbar).', werte: { gb: speicher ?? 0 } });

  const passtPlatte = (e) => platte == null || groesse(e) + PLATTE_RESERVE_GB <= platte;
  const passtGpu = (e) => speicher != null && groesse(e) + GPU_RESERVE_GB <= speicher;
  const passtRam = (e) => groesse(e) + RAM_RESERVE_GB <= ram;
  const cpuTauglich = (e) => effektiveParameterB(e) <= CPU_MAX_AKTIVE_B;
  const zuGross = eintraege.filter((e) => !passtPlatte(e)).length;
  if (platte != null && zuGross) hinweise.push({ text: '{n} Modelle passen nicht auf die Platte ({frei} GB frei) und sind ausgelassen.', werte: { n: zuGross, frei: eins(platte) } });

  /** @type {'gpu'|'apple'|'cpu'} */
  let stufe = hw?.gpu?.art === 'apple' ? 'apple' : 'gpu';
  let kandidaten = eintraege.filter((e) => passtPlatte(e) && passtGpu(e));
  if (!kandidaten.length) {
    if (speicher != null) hinweise.push({ text: 'Kein Katalogmodell passt ganz in den Grafikspeicher ({gb} GB) — Empfehlung für den Prozessor.', werte: { gb: speicher } });
    stufe = 'cpu';
    kandidaten = eintraege.filter((e) => passtPlatte(e) && passtRam(e) && cpuTauglich(e));
  }

  /** @param {import('./modellKatalog.js').KatalogEintrag} e @returns {Vorschlag} */
  const vorschlag = (e) => {
    /** @type {Grund[]} */
    const gruende = [];
    if (stufe === 'cpu') gruende.push({ text: 'läuft auf dem Prozessor ({gb} GB Arbeitsspeicher, {reserve} GB bleiben frei) — Antworten kommen langsamer', werte: { gb: eins(groesse(e)), reserve: eins(ram - groesse(e)) } });
    else gruende.push({ text: 'passt in {speicher} GB Grafikspeicher mit {reserve} GB Reserve', werte: { speicher: speicher ?? 0, reserve: eins((speicher ?? 0) - groesse(e)) } });
    if ((e.generation || 0) === neueste && neueste > 0) gruende.push({ text: 'neueste Modellgeneration im Katalog' });
    if (stufe === 'cpu' && e.moe) gruende.push({ text: 'MoE: rechnet je Wort nur etwa {b} Mrd. Parameter', werte: { b: effektiveParameterB(e) } });
    return { eintrag: e, gruende: [...gruende, ...eigenschaftsGruende(e)], punkte: eins(punkte(e) + (stufe === 'cpu' && e.moe ? 2 : 0)) };
  };

  const sortiert = kandidaten.map(vorschlag).sort((a, b) => b.punkte - a.punkte || groesse(a.eintrag) - groesse(b.eintrag));
  if (!sortiert.length) {
    hinweise.push({ text: 'Für diesen Rechner passt kein Modell aus dem Katalog (zu wenig Arbeitsspeicher oder Platte).' });
    return { stufe, speicherGb: speicher, top: null, alternativen: [], hinweise };
  }
  const [top, zweiter, dritter] = sortiert;

  // "langsamer, aber besser": better score, fits only RAM (partly CPU). MoE gets a bonus because only
  // its active parameters are computed per token.
  const imTier = new Set(sortiert.map((v) => v.eintrag.tag));
  const besser = eintraege
    .filter((e) => !imTier.has(e.tag) && passtPlatte(e) && passtRam(e) && punkte(e) > top.punkte)
    .map((e) => ({ e, p: punkte(e) + (e.moe ? 3 : 0) }))
    .sort((a, b) => b.p - a.p)[0];

  /** @type {Vorschlag[]} */
  const alternativen = [];
  if (zweiter) alternativen.push(zweiter);
  if (besser) {
    /** @type {Grund[]} */
    const g = [{ text: 'langsamer, aber besser: läuft teilweise auf dem Prozessor ({gb} GB)', werte: { gb: eins(groesse(besser.e)) } }];
    if (besser.e.moe) g.push({ text: 'MoE: rechnet je Wort nur etwa {b} Mrd. Parameter', werte: { b: effektiveParameterB(besser.e) } });
    alternativen.push({ eintrag: besser.e, gruende: [...g, ...eigenschaftsGruende(besser.e)], punkte: eins(besser.p) });
  } else if (dritter) {
    alternativen.push(dritter);
  }
  return { stufe, speicherGb: speicher, top, alternativen, hinweise };
}

/**
 * Verdict for a measured generation speed.
 * Thresholds [ASSUMED]: ≥ 15 tokens/s reads faster than a person reads; < 5 tokens/s feels sluggish.
 * @param {number} tokenProSekunde tokens per second
 * @returns {'flüssig'|'brauchbar'|'zäh'}
 */
export function benchmarkUrteil(tokenProSekunde) {
  const t = Number(tokenProSekunde) || 0;
  if (t >= 15) return 'flüssig';
  if (t >= 5) return 'brauchbar';
  return 'zäh';
}
