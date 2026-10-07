// Katalog-Snapshot + HARTE Referenzvalidierung (Phase 33 / W0).
//
// T-33-07 / Pitfall 13 — „stille 0":
//   Ein Tippfehler in `mengenbasis` ("NetSideAre") liefert bei jedem Element
//   `undefined`, wird zu 0 addiert und ergibt eine Menge von 0,00 — die aussieht
//   wie ein echtes Ergebnis. Deshalb wird eine Regel mit unbekannter Mengenbasis,
//   Kostengruppe oder Einheit beim SPEICHERN **ABGEWIESEN**, nicht toleriert.
//
// Isomorph: keine Aliase, keine Browser-Globalen (die Zusicherung ist absichtlich
// ohne die verbotenen Zeichenfolgen formuliert — die Isomorphie-Gates sind
// literale greps).

import { catalogSeed, KATALOG_ENTITAETEN } from '../../../server/catalog-seed.js';

export { KATALOG_ENTITAETEN };

/**
 * Snapshot aus DB-Zeilen bauen; fehlt eine Entität, greifen die Bürostandard-
 * Startdaten. So ist die Validierung auch ohne laufende DB (node --test) scharf.
 */
export function katalogSnapshot(dbRows = {}) {
  const defaults = catalogSeed();
  const out = {};
  for (const entity of Object.keys(defaults)) {
    const rows = Array.isArray(dbRows[entity]) && dbRows[entity].length ? dbRows[entity] : defaults[entity];
    out[entity] = rows;
  }
  return out;
}

/** Erlaubte Mengenbasis-Schlüssel (inkl. "Count"). */
export function erlaubteMengenbasis(snapshot) {
  return new Set((snapshot?.MengenbasisKatalog || []).map((r) => r.key));
}

/** Erlaubte Einheiten-Codes. */
export function erlaubteEinheiten(snapshot) {
  return new Set((snapshot?.EinheitenKatalog || []).map((r) => r.code));
}

/** Erlaubte Kostengruppen-Codes (alle Fassungen). */
export function erlaubteKg(snapshot) {
  return new Set((snapshot?.Din276Katalog || []).map((r) => String(r.code)));
}

/**
 * Prüft eine Mengenregel gegen die Kataloge.
 * @returns {{gueltig: boolean, fehler: string[]}}
 */
export function validiereRegel(regel, snapshot) {
  const snap = snapshot || katalogSnapshot();
  const fehler = [];

  const mb = regel?.mengenbasis;
  if (regel?.art === 'modell') {
    if (!mb) {
      fehler.push('mengenbasis fehlt (art "modell" verlangt eine Mengenbasis)');
    } else if (!erlaubteMengenbasis(snap).has(mb)) {
      fehler.push(`mengenbasis "${mb}" ist im MengenbasisKatalog unbekannt`);
    }
  }

  if (regel?.einheit != null && !erlaubteEinheiten(snap).has(regel.einheit)) {
    fehler.push(`einheit "${regel.einheit}" ist im EinheitenKatalog unbekannt`);
  }

  const kgs = regel?.selektor?.was?.kg;
  if (Array.isArray(kgs)) {
    const erlaubt = erlaubteKg(snap);
    for (const kg of kgs) {
      if (kg === '*' ) continue;
      if (!erlaubt.has(String(kg))) fehler.push(`Kostengruppe "${kg}" ist im Din276Katalog unbekannt`);
    }
  }

  if (regel?.faktor != null && (typeof regel.faktor !== 'number' || !Number.isFinite(regel.faktor))) {
    fehler.push('faktor ist keine endliche Zahl');
  }

  return { gueltig: fehler.length === 0, fehler };
}

/**
 * Wie `validiereRegel`, wirft aber. An der SPEICHER-Kante zu benutzen —
 * eine ungültige Referenz darf nie in die DB gelangen.
 */
export function pruefeRegelOderWirf(regel, snapshot) {
  const { gueltig, fehler } = validiereRegel(regel, snapshot);
  if (!gueltig) {
    const err = /** @type {Error & {code?: string, fehler?: Array<any>}} */ (
      new Error(`Mengenregel abgewiesen: ${fehler.join('; ')}`)
    );
    err.code = 'KATALOG_REFERENZ';
    err.fehler = fehler;
    throw err;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Pflege-Schnittstelle (Phase 33 / W6, Plan 33-04)
//
// Ab hier geht es nicht mehr nur um die Import-Kante, sondern um den EDITOR:
// ein Mensch tippt eine Regel, und die Kataloge sind die einzige Typprüfung,
// die dieses Programm hat. Deshalb liefert `validiereReferenzen` FELDBEZOGENE
// Fehler (`{feld, text}`) — eine Sammelmeldung „irgendwas ist falsch" hilft am
// Formular niemandem, und ein Formular, das nicht sagt WO der Fehler steckt,
// wird umgangen statt benutzt.
// ---------------------------------------------------------------------------

/** Erlaubte Ausschlussgrund-Codes. */
export function erlaubteAusschlussGruende(snapshot) {
  return new Set((snapshot?.AusschlussGrund || []).map((r) => r.code));
}

/** Verlangt dieser Ausschlussgrund einen Pflichttext (`sonstiges`)? */
export function ausschlussGrundBrauchtText(snapshot, code) {
  const z = (snapshot?.AusschlussGrund || []).find((r) => r.code === code);
  return z?.text_pflicht === true;
}

/**
 * Die WIRKSAMEN Zeilen eines Katalogs für ein Projekt.
 *
 * Ein Projekt darf eine büroweite Zeile überschreiben, ohne den Bürostandard zu
 * verändern: die Override-Zeile trägt `projekt_override_id: <projektId>` und den
 * Schlüssel der Zeile, die sie ersetzt. Regel: **Override schlägt büroweit** —
 * aber nur für dieses Projekt, und nur wenn der Schlüssel wirklich passt.
 *
 * @param {object} snapshot Katalog-Snapshot
 * @param {string} entity Katalogname
 * @param {string|null} projektId aktuelles Projekt (null ⇒ nur Bürostandard)
 * @param {string} schluesselFeld Feld, über das Override und Standard sich finden
 */
export function wirksameZeilen(snapshot, entity, projektId = null, schluesselFeld = null) {
  const alle = snapshot?.[entity] || [];
  const feld = schluesselFeld || SCHLUESSELFELD[entity] || 'code';
  const buero = alle.filter((r) => !r?.projekt_override_id);
  if (!projektId) return buero;
  const overrides = alle.filter((r) => r?.projekt_override_id === projektId);
  const ersetzt = new Set(overrides.map((r) => String(r?.[feld])));
  return [...buero.filter((r) => !ersetzt.has(String(r?.[feld]))), ...overrides];
}

/** Das Schlüsselfeld je Katalog — womit eine Zeile identifiziert wird. */
export const SCHLUESSELFELD = Object.freeze({
  Din276Katalog: 'code',
  KgRegel: 'name',
  MengenMuster: 'nr',
  AusschlussGrund: 'code',
  MengenbasisKatalog: 'key',
  EinheitenKatalog: 'code',
  // NICHT `intern`: die Zeile „unbekannt" führt bewusst `intern: null` (ein
  // fehlender Status IST ein Zustand). `pipeline` ist an allen vier Zeilen belegt.
  StatusKonvention: 'pipeline',
  BaustoffKonvention: 'intern',
  Preisindexreihe: 'reihe',
  PreisRangfolge: 'art',
  AmpelSchwelle: 'kontext',
  StlbKatalog: 'lb',
  ReferenzpreisPool: 'kurztext',
  PreisUebernahmeRegel: 'name',
});

/**
 * Referenzvalidierung für den REGEL-EDITOR — feldbezogen.
 *
 * Geprüft wird, was eine stille 0 oder einen stillen Fehlbetrag erzeugen kann:
 *   `mengenbasis` · `einheit` · `selektor.was.kg` · `ausschluss_grund`
 *   · `faktor` (Zahl) · **`faktor_grund` als PFLICHTTEXT bei `faktor !== 1`**
 *   · `op` · `art`.
 *
 * @param {object} regel
 * @param {object} kataloge Katalog-Snapshot (oder DB-Zeilen)
 * @returns {{ok: boolean, fehler: Array<{feld: string, text: string}>}}
 */
export function validiereReferenzen(regel, kataloge = null) {
  const snap = kataloge && kataloge.MengenbasisKatalog ? kataloge : katalogSnapshot(kataloge || {});
  const fehler = [];
  const f = (feld, text) => fehler.push({ feld, text });

  const art = regel?.art ?? 'modell';
  if (!['modell', 'uebernahme', 'pauschal', 'einzel'].includes(art)) {
    f('art', `art "${art}" ist unbekannt (modell|uebernahme|pauschal|einzel)`);
  }
  const op = regel?.op ?? 'add';
  if (!['add', 'sub'].includes(op)) f('op', `op "${op}" ist unbekannt (add|sub)`);

  // --- mengenbasis: DER Tippfehler-Kandidat (Pitfall 13) -------------------
  const mb = regel?.mengenbasis;
  if (art === 'modell' || art === 'einzel') {
    if (mb == null || mb === '') {
      f('mengenbasis', `art "${art}" verlangt eine Mengenbasis aus dem MengenbasisKatalog`);
    } else if (!erlaubteMengenbasis(snap).has(mb)) {
      f('mengenbasis', `"${mb}" steht nicht im MengenbasisKatalog — Tippfehler? (eine unbekannte Größe ergäbe Menge 0)`);
    }
  } else if (mb != null && mb !== '' && !erlaubteMengenbasis(snap).has(mb)) {
    f('mengenbasis', `"${mb}" steht nicht im MengenbasisKatalog`);
  }

  // --- einheit -------------------------------------------------------------
  if (regel?.einheit != null && regel.einheit !== '' && !erlaubteEinheiten(snap).has(regel.einheit)) {
    f('einheit', `Einheit "${regel.einheit}" steht nicht im EinheitenKatalog`);
  }

  // --- Kostengruppen im Selektor ------------------------------------------
  const kgs = regel?.selektor?.was?.kg;
  if (Array.isArray(kgs)) {
    const erlaubt = erlaubteKg(snap);
    for (const kg of kgs) {
      if (kg === '*') continue;
      if (!erlaubt.has(String(kg))) f('selektor.was.kg', `Kostengruppe "${kg}" steht nicht im Din276Katalog`);
    }
  }

  // --- Ausschlussgrund ----------------------------------------------------
  const ag = regel?.ausschluss_grund;
  if (ag != null && ag !== '') {
    if (!erlaubteAusschlussGruende(snap).has(ag)) {
      f('ausschluss_grund', `Grund "${ag}" steht nicht im Katalog AusschlussGrund`);
    } else if (ausschlussGrundBrauchtText(snap, ag) && !String(regel?.ausschluss_text || '').trim()) {
      f('ausschluss_text', `Grund "${ag}" verlangt eine Begründung im Klartext`);
    }
  }

  // --- faktor + PFLICHTGRUND ----------------------------------------------
  const faktor = regel?.faktor;
  if (faktor != null) {
    if (typeof faktor !== 'number' || !Number.isFinite(faktor)) {
      f('faktor', 'faktor ist keine endliche Zahl');
    } else if (faktor !== 1 && !String(regel?.faktor_grund || '').trim()) {
      // Ein Faktor ohne Grund ist in einem halben Jahr nicht mehr erklärbar —
      // und er verdoppelt oder halbiert Geld.
      f('faktor_grund', `faktor ${faktor} weicht von 1 ab und verlangt eine Begründung (faktor_grund)`);
    }
  }

  return { ok: fehler.length === 0, fehler };
}

/**
 * Referenzvalidierung für den KATALOG-EDITOR: eine Katalogzeile gegen die
 * Kataloge, auf die sie selbst verweist.
 *
 * Beispiele: ein `MengenMuster` mit unbekannter `mengenbasis` oder Einheit
 * würde jede daraus abgeleitete Regel auf 0 setzen; eine `KgRegel` mit
 * unbekannter `kg2018` würde die Kostengruppe still verschlucken.
 *
 * @returns {{ok: boolean, fehler: Array<{feld, text}>}}
 */
export function validiereKatalogZeile(entity, zeile, kataloge = null) {
  const snap = kataloge && kataloge.MengenbasisKatalog ? kataloge : katalogSnapshot(kataloge || {});
  const fehler = [];
  const f = (feld, text) => fehler.push({ feld, text });

  if (!KATALOG_ENTITAETEN.includes(entity)) {
    f('_entity', `"${entity}" ist keiner der ${KATALOG_ENTITAETEN.length} Kataloge`);
    return { ok: false, fehler };
  }

  const schluessel = SCHLUESSELFELD[entity];
  if (schluessel && (zeile?.[schluessel] == null || zeile[schluessel] === '')) {
    f(schluessel, `Schlüsselfeld "${schluessel}" fehlt`);
  }

  if (zeile?.mengenbasis != null && zeile.mengenbasis !== '' && !erlaubteMengenbasis(snap).has(zeile.mengenbasis)) {
    f('mengenbasis', `"${zeile.mengenbasis}" steht nicht im MengenbasisKatalog`);
  }
  for (const feld of ['einheit', 'me']) {
    const v = zeile?.[feld];
    if (v != null && v !== '' && !erlaubteEinheiten(snap).has(v)) {
      f(feld, `Einheit "${v}" steht nicht im EinheitenKatalog`);
    }
  }
  // NUR die ausdrücklichen KG-Felder. `code` ist bewusst NICHT dabei: in
  // `EinheitenKatalog`/`AusschlussGrund` ist `code` etwas völlig anderes, und der
  // `Din276Katalog` DEFINIERT die Codes, statt sie zu referenzieren.
  for (const feld of ['kg2018', 'kg2008', 'kg']) {
    const v = zeile?.[feld];
    if (v != null && v !== '' && !erlaubteKg(snap).has(String(v))) {
      f(feld, `Kostengruppe "${v}" steht nicht im Din276Katalog`);
    }
  }
  if (zeile?.faktor != null && (typeof zeile.faktor !== 'number' || !Number.isFinite(zeile.faktor))) {
    f('faktor', 'faktor ist keine endliche Zahl');
  }
  if (zeile?.projekt_override_id != null && zeile.projekt_override_id !== '' && zeile?.scope === 'buero') {
    f('scope', 'eine Projekt-Override-Zeile darf nicht als büroweit („scope: buero") geführt werden');
  }

  return { ok: fehler.length === 0, fehler };
}

/** Wie `validiereReferenzen`, wirft aber — für die SPEICHER-Kante. */
export function pruefeReferenzenOderWirf(regel, kataloge = null) {
  const { ok, fehler } = validiereReferenzen(regel, kataloge);
  if (!ok) {
    const err = /** @type {Error & {code?: string, fehler?: Array<any>}} */ (
      new Error(`Regel abgewiesen: ${fehler.map((x) => `${x.feld}: ${x.text}`).join('; ')}`)
    );
    err.code = 'KATALOG_REFERENZ';
    err.fehler = fehler;
    throw err;
  }
  return true;
}
