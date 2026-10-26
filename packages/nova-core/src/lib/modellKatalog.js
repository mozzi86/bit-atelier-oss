// modellKatalog.js — the curated catalog of local models (lokaleModelle.json, plan 93-12 B).
//
// The catalog ships with the app; "Katalog aktualisieren" fetches the same file from the public
// repository (server/ollamaDienst.js). Everything that comes from outside passes `katalogPruefen`
// first — a schema check, not trust. The newer `stand` wins; installed models (Ollama /api/tags)
// are merged in so a model the user already has always shows, even when the catalog does not know it.
//
// Pure: no network, no file access (the server reads the JSON and passes the object in).
// In:  catalog objects, /api/tags answers. Out: validated catalogs, merged entry lists, size estimates.

/** Capabilities a catalog entry may name. */
export const FAEHIGKEITEN = Object.freeze(['tools', 'vision', 'thinking']);

/** Upper bound for entries — a remote file with more is refused (no memory blow-up from a bad file). */
const MAX_EINTRAEGE = 500;

/** Ollama model tag: name[:variant], lower-case letters, digits, dot, dash, underscore, optional namespace. */
const TAG = /^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)?(:[a-z0-9][a-z0-9._-]*)?$/i;

/**
 * @typedef {object} KatalogEintrag
 * @property {string} tag Ollama tag, e.g. "gemma4:12b"
 * @property {string} familie model family, e.g. "gemma4"
 * @property {number} parameterB parameters in billions (for MoE: total)
 * @property {number|null} aktiveParameterB active parameters per token in billions (MoE), else null
 * @property {boolean} moe mixture-of-experts model
 * @property {number} groesseQ4Gb approximate download size of the Q4 build in GB (10^9 bytes)
 * @property {boolean} groesseGeschaetzt true when the size is derived from the parameter count
 * @property {number} minVramGb VRAM needed to run fully on the GPU (size + 1.5 GB headroom), GB
 * @property {number} minRamGb RAM needed to run on the CPU (size + ~4 GB for system and app), GB
 * @property {string[]} faehigkeiten subset of FAEHIGKEITEN
 * @property {number|null} deutsch German quality 1 (weak) … 3 (very good); null = unknown
 * @property {string} deutschHinweis one German sentence on language quality
 * @property {string} lizenz licence name as published
 * @property {number} generation newer = higher (ordinal, [ASSUMED] from release order)
 * @property {boolean} [installiert] set by mitInstallierten()
 * @property {number|null} [groesseInstalliertGb] real size on disk from /api/tags, GB
 * @property {string} [quelle] 'katalog' | 'installiert'
 */

/**
 * @typedef {object} Katalog
 * @property {number} schema format version (1)
 * @property {string} stand date of the catalog, YYYY-MM-DD
 * @property {string} [quelle] where the data were read
 * @property {string} [hinweis] caveat shown in the UI
 * @property {KatalogEintrag[]} modelle
 */

/**
 * Conservative Q4 size estimate from the parameter count.
 * Rule [ASSUMED, Stand 12.10.2026]: ≈ 0.6 GB per billion parameters (4-bit weights plus
 * embedding/quantisation overhead) + 1 GB (tokenizer, projector, metadata). Public guides give
 * 0.5–0.65 GB/B for Q4_K_M; the upper end is used so a disk check is not too optimistic.
 * @param {number} parameterB parameters in billions
 * @returns {number} size in GB, one decimal
 */
export function geschaetzteGroesseGb(parameterB) {
  const b = Number(parameterB);
  if (!Number.isFinite(b) || b <= 0) return 0;
  return Math.round((0.6 * b + 1) * 10) / 10;
}

const istZahl = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Validate one catalog object. Unknown fields are dropped; invalid entries are reported and left out;
 * a catalog without a valid `stand` or without any valid entry is refused as a whole.
 * @param {unknown} roh parsed JSON
 * @returns {{ ok: boolean, fehler: string[], katalog: Katalog|null }}
 */
export function katalogPruefen(roh) {
  /** @type {string[]} */
  const fehler = [];
  /** @type {any} */
  const k = roh;
  if (!k || typeof k !== 'object' || Array.isArray(k)) return { ok: false, fehler: ['Katalog ist kein Objekt'], katalog: null };
  if (k.schema !== 1) fehler.push(`Unbekannte Schema-Version ${JSON.stringify(k.schema)}`);
  if (typeof k.stand !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(k.stand)) fehler.push('Feld „stand“ fehlt oder ist kein Datum (JJJJ-MM-TT)');
  if (!Array.isArray(k.modelle)) fehler.push('Feld „modelle“ ist keine Liste');
  else if (k.modelle.length > MAX_EINTRAEGE) fehler.push(`Mehr als ${MAX_EINTRAEGE} Einträge`);
  if (fehler.length) return { ok: false, fehler, katalog: null };

  /** @type {KatalogEintrag[]} */
  const modelle = [];
  const gesehen = new Set();
  k.modelle.forEach((/** @type {any} */ e, i) => {
    const wo = `Eintrag ${i + 1}`;
    if (!e || typeof e !== 'object') { fehler.push(`${wo}: kein Objekt`); return; }
    if (typeof e.tag !== 'string' || !TAG.test(e.tag)) { fehler.push(`${wo}: ungültiger Tag`); return; }
    if (gesehen.has(e.tag)) { fehler.push(`${wo}: Tag ${e.tag} doppelt`); return; }
    if (!istZahl(e.parameterB) || e.parameterB <= 0 || e.parameterB > 2000) { fehler.push(`${wo} (${e.tag}): parameterB ungültig`); return; }
    if (e.groesseQ4Gb != null && (!istZahl(e.groesseQ4Gb) || e.groesseQ4Gb <= 0 || e.groesseQ4Gb > 2000)) { fehler.push(`${wo} (${e.tag}): groesseQ4Gb ungültig`); return; }
    const faehigkeiten = Array.isArray(e.faehigkeiten) ? e.faehigkeiten.filter((f) => FAEHIGKEITEN.includes(f)) : [];
    const groesse = istZahl(e.groesseQ4Gb) ? e.groesseQ4Gb : geschaetzteGroesseGb(e.parameterB);
    gesehen.add(e.tag);
    modelle.push({
      tag: e.tag,
      familie: typeof e.familie === 'string' && e.familie ? e.familie.slice(0, 60) : e.tag.split(':')[0],
      parameterB: e.parameterB,
      aktiveParameterB: istZahl(e.aktiveParameterB) && e.aktiveParameterB > 0 ? e.aktiveParameterB : null,
      moe: e.moe === true,
      groesseQ4Gb: groesse,
      groesseGeschaetzt: e.groesseGeschaetzt === true || !istZahl(e.groesseQ4Gb),
      minVramGb: istZahl(e.minVramGb) ? e.minVramGb : Math.round((groesse + 1.5) * 10) / 10,
      minRamGb: istZahl(e.minRamGb) ? e.minRamGb : Math.ceil(groesse + 4),
      faehigkeiten,
      deutsch: [1, 2, 3].includes(e.deutsch) ? e.deutsch : null,
      deutschHinweis: typeof e.deutschHinweis === 'string' ? e.deutschHinweis.slice(0, 300) : '',
      lizenz: typeof e.lizenz === 'string' ? e.lizenz.slice(0, 120) : '',
      generation: Number.isInteger(e.generation) && e.generation >= 0 ? e.generation : 0,
      quelle: 'katalog',
    });
  });
  if (!modelle.length) return { ok: false, fehler: [...fehler, 'Kein gültiger Eintrag'], katalog: null };
  return {
    ok: true,
    fehler,
    katalog: {
      schema: 1,
      stand: k.stand,
      quelle: typeof k.quelle === 'string' ? k.quelle.slice(0, 300) : '',
      hinweis: typeof k.hinweis === 'string' ? k.hinweis.slice(0, 1000) : '',
      modelle,
    },
  };
}

/**
 * The newer of two catalogs by `stand` (ISO dates compare as strings). On a tie the first wins —
 * pass the bundled catalog second so an equal remote copy does not replace it needlessly.
 * @param {Katalog|null} a
 * @param {Katalog|null} b
 * @returns {Katalog|null}
 */
export function neuererKatalog(a, b) {
  if (!a) return b;
  if (!b) return a;
  return b.stand > a.stand ? b : a;
}

/**
 * Does an installed Ollama name match a catalog tag? "gemma4" and "gemma4:latest" are the same model.
 * @param {string} installiert name from /api/tags
 * @param {string} tag catalog tag
 * @returns {boolean}
 */
export function tagGleich(installiert, tag) {
  const norm = (s) => { const t = String(s || '').trim().toLowerCase(); return t.includes(':') ? t : `${t}:latest`; };
  return norm(installiert) === norm(tag);
}

/**
 * Parameter count from Ollama's details.parameter_size ("8.0B", "567M").
 * @param {unknown} text
 * @returns {number|null} billions
 */
export function parameterAusText(text) {
  const m = String(text ?? '').trim().match(/^([\d.]+)\s*([BM])$/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  return m[2].toUpperCase() === 'M' ? Math.round(n / 100) / 10 : n;
}

/**
 * Merge the catalog with the models Ollama has installed (/api/tags). Catalog entries gain
 * `installiert` and the real size; installed models unknown to the catalog are appended with what
 * /api/tags tells (size real, capabilities unknown).
 * @param {Katalog} katalog validated catalog
 * @param {unknown} tags /api/tags answer ({models: [{name, size, details: {family, parameter_size}}]})
 * @returns {KatalogEintrag[]} new list, catalog order first, then the extra installed ones
 */
export function mitInstallierten(katalog, tags) {
  /** @type {any[]} */
  const installiert = Array.isArray(/** @type {any} */ (tags)?.models) ? /** @type {any} */ (tags).models.filter((m) => m && typeof m.name === 'string') : [];
  const gb = (bytes) => (istZahl(bytes) && bytes > 0 ? Math.round((bytes / 1e9) * 10) / 10 : null);
  const benutzt = new Set();
  const liste = katalog.modelle.map((e) => {
    const treffer = installiert.find((m) => tagGleich(m.name, e.tag));
    if (treffer) benutzt.add(treffer.name);
    return { ...e, installiert: Boolean(treffer), groesseInstalliertGb: treffer ? gb(treffer.size) : null };
  });
  for (const m of installiert) {
    if (benutzt.has(m.name)) continue;
    const parameterB = parameterAusText(m.details?.parameter_size) ?? 0;
    const groesse = gb(m.size) ?? geschaetzteGroesseGb(parameterB);
    liste.push({
      tag: m.name,
      familie: String(m.details?.family || m.name.split(':')[0]),
      parameterB,
      aktiveParameterB: null,
      moe: false,
      groesseQ4Gb: groesse,
      groesseGeschaetzt: gb(m.size) == null,
      minVramGb: Math.round((groesse + 1.5) * 10) / 10,
      minRamGb: Math.ceil(groesse + 4),
      faehigkeiten: [],
      deutsch: null,
      deutschHinweis: '',
      lizenz: '',
      generation: 0,
      installiert: true,
      groesseInstalliertGb: gb(m.size),
      quelle: 'installiert',
    });
  }
  return liste;
}

// --- 106-06: can a model read images? --------------------------------------------------------------------------------------------
// An image of the view goes only to a model that understands images (plan 106-06 Task 2): "vision" is mandatory, a model without it gets
// a sentence instead of a silently dropped image. Local models: the catalog's `faehigkeiten` decide. Models the catalog does not list
// (connections outside this computer, local chat-completions servers with their own ids): a short list of model-id patterns whose
// vendors document image input. Unknown = no - better a sentence than an image the model cannot read.

/**
 * Model-id patterns (case-insensitive, matched against the id after its last "/") of models that read images.
 * [ASSUMED, Stand 25.10.2026] from the vendors' public model pages; model line-ups change monthly. The patterns are kept narrow (review
 * fix 106-06): text-only members of a family are excluded - claude-2/instant, o3-mini, gemma3 1b/270m, the audio/realtime/tts/search
 * and embedding variants. A pattern can still miss a new text-only variant: then the provider answers with an error instead of the
 * promised sentence (no privacy effect - the image checks of the project ran before). A missing model only means "no image".
 * The harness keeps the SAME list (harness/harness/bilder.py BILD_MODELL_MUSTER); a unit test compares both.
 */
export const BILD_MODELL_MUSTER = Object.freeze([
  "^claude-(3|sonnet|opus|haiku)",
  "^gpt-4o(?!.*(audio|realtime|transcribe|tts|search))",
  "^gpt-4\\.1",
  "^gpt-5(?!.*(audio|realtime|transcribe|tts))",
  "^o3(?!-mini)",
  "^o4-mini",
  "^gemini-(?!.*(embedding|tts|audio))",
  "^gemma-?3n",
  "^gemma-?3[-:._]?(4|12|27)b",
  "^gemma-?4",
  "^qwen[0-9.]*-?vl",
  "^pixtral",
  "^llava",
  "^llama-?3\\.2-?vision",
  "^llama-?4",
  "^minicpm-v",
  "^moondream",
]);

/**
 * Whether a model reads images: the catalog first (local tags), then BILD_MODELL_MUSTER.
 * @param {{modell?: string|null, katalog?: {modelle: Array<{tag: string, faehigkeiten: string[]}>}|null}} o
 *   modell: model id or local model tag ("" = the provider's default, unknown); katalog: validated catalog (null = only the patterns).
 * @returns {{ja: boolean, quelle: "katalog"|"muster"|"unbekannt", text: string}}  text: German sentence when ja is false ("" otherwise).
 */
export function bildFaehig({ modell, katalog = null }) {
  const id = String(modell ?? "").trim();
  const nein = (/** @type {"katalog"|"unbekannt"} */ quelle, /** @type {string} */ text) => ({ ja: false, quelle, text });
  if (!id) return nein("unbekannt", "Kein Modell gewählt — ob es Bilder versteht, ist unbekannt; nichts wurde gesendet");
  const eintrag = katalog?.modelle?.find((e) => tagGleich(id, e.tag));
  if (eintrag) {
    return eintrag.faehigkeiten.includes("vision")
      ? { ja: true, quelle: "katalog", text: "" }
      : nein("katalog", `Das Modell „${id}“ versteht laut Katalog keine Bilder — nichts wurde gesendet. Ohne Bild senden oder ein Bildmodell wählen (Einstellungen › KI)`);
  }
  const kurz = id.slice(id.lastIndexOf("/") + 1);
  if (BILD_MODELL_MUSTER.some((m) => new RegExp(m, "i").test(kurz))) return { ja: true, quelle: "muster", text: "" };
  return nein("unbekannt", `Vom Modell „${id}“ ist nicht bekannt, dass es Bilder versteht — nichts wurde gesendet. Ohne Bild senden oder ein Bildmodell wählen (Einstellungen › KI)`);
}
