// bcfImport.js — BCF-2.1-Container LESEN (Phase 71-04): Issues, die der
// Generalplaner in Solibri anlegt und über Catenda als .bcf ausgibt, kommen
// hier in die App. Gegenstück zu bcf.js (Schreiben) — dieselbe Topic-Form,
// damit Import → beantworten → Export ein Roundtrip ist.
//
// In:  ZIP-Bytes (.bcf/.bcfzip) — fflate.unzipSync wie xlsxRead.js (Root-Dep).
// Out: parseBcfZip(bytes) -> { version, topics, warnungen }
//      topics[]: { guid, titel, beschreibung, topicType, topicStatus,
//                  creationDate, creationAuthor, modifiedDate, modifiedAuthor,
//                  labels: [], prioritaet, kommentare: [{guid, datum, autor,
//                  text, viewpointGuid}], viewpoints: [{guid, datei, snapshot,
//                  ifcGuids: [], kamera}], dateien: [{name, ifcProject, datum}] }
//
// XML ohne DOMParser: @core/lib/xmlMini (71-04 dorthin gehoben — @ifc darf
// @ava nicht importieren, xlsxReads xmlDurchlaufen lag aber dort).
//
// Robustheit (ausländische Container): fehlendes markup.bcf -> Warnung, kein
// Wurf; Version ≠ 2.1 -> lesen + warnen; Components-IfcGuids werden auf 22
// Zeichen geprüft, kaputte -> Warnung; Ordnername = Topic-Guid,
// lowercase-tolerant (BIMcollab schreibt lowercase, Solibri mischt).
//
// T-71-07 (Zip-Bombe): Entpack-Grenze (64 MB Default) + Dateizahl-Grenze,
// Klartextfehler. T-71-08: Kommentar-Texte sind DATEN — die UI rendert sie
// als Text (React escaped), Snapshots sind PNG-Bytes ohne weitere Verarbeitung.

import { unzipSync } from 'fflate';

import { kind, kindText, kinder, xmlBaum } from '@core/lib/xmlMini';

/** Standard-Obergrenze der ENTPACKTEN Gesamtgröße (Zip-Bomb-Schutz, T-71-07). */
export const MAX_ENTPACKT = 64 * 1024 * 1024;

/** Obergrenze der Dateien im Container — ein BCF mit 100.000 Einträgen ist keins. */
export const MAX_DATEIEN = 2000;

/** 22-Zeichen-IFC-GlobalId (0-9 A-Z a-z _ $) — Components-Prüfung. */
const IFC_GUID_MUSTER = /^[0-9A-Za-z_$]{22}$/;

/** UUID 8-4-4-4-12 — Topic-/Comment-/Viewpoint-Guids. */
const UUID_MUSTER = /^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$/;

const dec = new TextDecoder('utf-8');

/**
 * Rohbytes -> Uint8Array (ArrayBuffer/TypedArray erlaubt, String nicht).
 * @param {Uint8Array|ArrayBuffer} daten
 * @returns {Uint8Array}
 */
function alsBytes(daten) {
  if (daten instanceof Uint8Array) return daten;
  if (daten && typeof daten === 'object' && 'byteLength' in daten) return new Uint8Array(daten);
  throw new Error('bcfImport: Rohbytes erwartet (Uint8Array/ArrayBuffer) — ein String kann kein ZIP sein.');
}

/**
 * Liest bcf.version -> '2.1' | '2.0' | … | null.
 * VersionId ist ein ATTRIBUT von <Version> (bcf.js:196-200 schreibt es so).
 * @param {string|null} xml
 * @returns {string|null}
 */
function versionLesen(xml) {
  if (!xml) return null;
  const wurzel = xmlBaum(xml);
  if (!wurzel || wurzel.name !== 'Version') return null;
  return wurzel.attrs?.VersionId || kindText(wurzel, 'DetailedVersion') || null;
}

/**
 * Kamera eines Viewpoints durchreichen (nicht interpretieren — die App kann
 * BCF-Kameras heute nicht nachfahren; der Wert bleibt für den Rückexport).
 * @param {object|null} vis VisualizationInfo-Wurzel
 * @returns {object|null}
 */
function kameraLesen(vis) {
  const cam = kind(vis, 'PerspectiveCamera') || kind(vis, 'OrthogonalCamera');
  if (!cam) return null;
  const typ = cam.name === 'PerspectiveCamera' ? 'perspektive' : 'orthogonal';
  const punkt = (name) => {
    const k = kind(cam, name);
    if (!k) return null;
    return { x: Number(kindText(k, 'X')), y: Number(kindText(k, 'Y')), z: Number(kindText(k, 'Z')) };
  };
  return {
    typ,
    position: punkt('CameraViewPoint'),
    richtung: punkt('CameraDirection'),
    oben: punkt('CameraUpVector'),
    fieldOfView: Number(kindText(cam, 'FieldOfView')) || null,
    scale: Number(kindText(cam, 'Scale')) || null,
  };
}

/**
 * Ein markup.bcf-XML in die Topic-Form bringen.
 * @param {string} xml
 * @param {string[]} warnungen Sammelbecken
 * @param {string} kontext Dateiname für Meldungen
 * @returns {object|null}
 */
function topicAusMarkup(xml, warnungen, kontext) {
  const wurzel = xmlBaum(xml);
  if (!wurzel || wurzel.name !== 'Markup') {
    warnungen.push(`${kontext}: Wurzelelement ist nicht <Markup> — Topic übersprungen`);
    return null;
  }
  const topicEl = kind(wurzel, 'Topic');
  if (!topicEl) {
    warnungen.push(`${kontext}: <Topic> fehlt — übersprungen`);
    return null;
  }
  const guid = (topicEl.attrs?.Guid || '').trim();
  if (!UUID_MUSTER.test(guid)) {
    warnungen.push(`${kontext}: Topic-Guid „${guid}" ist keine UUID — trotzdem gelesen`);
  }

  // Header-Dateien (ReferenceDocuments/Modelle) — für die Anzeige „aus welcher
  // Datei stammt das Issue".
  const dateien = kinder(kind(wurzel, 'Header'), 'File').map((f) => ({
    name: kindText(f, 'Filename'),
    datum: kindText(f, 'Date') || null,
    ifcProject: f.attrs?.IfcProject || null,
  }));

  const kommentare = kinder(wurzel, 'Comment').map((c) => ({
    guid: (c.attrs?.Guid || '').trim() || null,
    datum: kindText(c, 'Date') || null,
    autor: kindText(c, 'Author') || null,
    text: kindText(c, 'Comment'),
    viewpointGuid: kind(c, 'Viewpoint')?.attrs?.Guid || null,
  }));

  const viewpoints = kinder(wurzel, 'Viewpoints').map((v) => ({
    guid: (v.attrs?.Guid || '').trim() || null,
    datei: kindText(v, 'Viewpoint') || null,
    snapshot: kindText(v, 'Snapshot') || null,   // Dateiname im Topic-Ordner
    ifcGuids: [],                                 // gefüllt aus der .bcfv (unten)
    kamera: null,
  }));

  return {
    guid,
    titel: kindText(topicEl, 'Title'),
    beschreibung: kindText(topicEl, 'Description') || '',
    topicType: topicEl.attrs?.TopicType || '',
    topicStatus: topicEl.attrs?.TopicStatus || '',
    creationDate: kindText(topicEl, 'CreationDate') || null,
    creationAuthor: kindText(topicEl, 'CreationAuthor') || null,
    modifiedDate: kindText(topicEl, 'ModifiedDate') || null,
    modifiedAuthor: kindText(topicEl, 'ModifiedAuthor') || null,
    prioritaet: kindText(topicEl, 'Priority') || null,
    labels: kinder(topicEl, 'Labels').map((l) => l.text.trim()).filter(Boolean),
    kommentare,
    viewpoints,
    dateien,
  };
}

/**
 * Eine viewpoint.bcfv lesen: Components -> ifcGuids (22-Zeichen-Prüfung),
 * Kamera durchreichen.
 * @param {string} xml
 * @param {string[]} warnungen
 * @param {string} kontext
 * @returns {{ifcGuids: string[], kamera: object|null}}
 */
function viewpointLesen(xml, warnungen, kontext) {
  const wurzel = xmlBaum(xml);
  if (!wurzel || wurzel.name !== 'VisualizationInfo') {
    warnungen.push(`${kontext}: Wurzelelement ist nicht <VisualizationInfo>`);
    return { ifcGuids: [], kamera: null };
  }
  const ifcGuids = [];
  const components = kind(wurzel, 'Components');
  for (const gruppe of ['Selection', 'VisibilityExceptions', 'Coloring']) {
    const behaelter = kind(components, gruppe);
    if (!behaelter) continue;
    for (const comp of kinder(behaelter, 'Component')) {
      const g = (comp.attrs?.IfcGuid || '').trim();
      if (IFC_GUID_MUSTER.test(g)) {
        if (!ifcGuids.includes(g)) ifcGuids.push(g);
      } else if (g) {
        warnungen.push(`${kontext}: Component IfcGuid „${g}" hat nicht 22 Zeichen — übersprungen`);
      }
    }
  }
  return { ifcGuids, kamera: kameraLesen(wurzel) };
}

/**
 * BCF-Container lesen.
 *
 * @param {Uint8Array|ArrayBuffer} bytes .bcf/.bcfzip-Datei
 * @param {{maxEntpackt?: number}} [opt]
 * @returns {{version: string|null, topics: Array<object>, warnungen: string[],
 *   snapshots: Object<string, Uint8Array>}}
 *   snapshots: Topic-Guid -> PNG-Bytes des Haupt-Snapshots (Anzeige als
 *   Blob-URL, kein Parsen — T-71-08).
 * @throws {Error} Klartext bei ZIP-Fehlern oder Bomben-Grenzen (T-71-07)
 */
export function parseBcfZip(bytes, { maxEntpackt = MAX_ENTPACKT } = {}) {
  const raw = alsBytes(bytes);
  let files;
  try {
    files = unzipSync(raw);
  } catch (err) {
    throw new Error(`bcfImport: ZIP konnte nicht entpackt werden (${err?.message || err})`);
  }
  const namen = Object.keys(files);
  if (namen.length > MAX_DATEIEN) {
    throw new Error(`bcfImport: ${namen.length} Dateien im Container — über der Grenze ${MAX_DATEIEN} (Zip-Bomb-Schutz)`);
  }
  let summe = 0;
  for (const n of namen) {
    summe += files[n].length;
    if (summe > maxEntpackt) {
      throw new Error(`bcfImport: entpackte Größe übersteigt ${maxEntpackt} Byte (Zip-Bomb-Schutz)`);
    }
  }

  const warnungen = [];
  const version = versionLesen(files['bcf.version'] ? dec.decode(files['bcf.version']) : null);
  if (!version) warnungen.push('bcf.version fehlt oder unlesbar — Version unbekannt');
  else if (version !== '2.1') warnungen.push(`BCF-Version ${version} ≠ 2.1 — gelesen wird trotzdem, Abweichungen möglich`);

  const txt = (pfad) => (files[pfad] ? dec.decode(files[pfad]) : null);

  // Topic-Ordner sammeln: alle Pfade "<guid>/markup.bcf". GUID-Schlüssel
  // lowercase-tolerant; der Ordnername bleibt für die Dateisuche erhalten.
  const markups = namen.filter((n) => /\/markup\.bcf$/i.test(n));
  // Ordner OHNE markup.bcf: ein Topic-Ordner braucht es (Warnung, kein Wurf).
  const ordner = new Set(
    namen.map((n) => (n.includes('/') ? n.slice(0, n.indexOf('/')) : '')).filter(Boolean),
  );
  const mitMarkup = new Set(markups.map((n) => n.slice(0, n.indexOf('/'))));
  for (const o of ordner) {
    if (!mitMarkup.has(o)) warnungen.push(`Ordner „${o}" ohne markup.bcf — übersprungen`);
  }
  markups.sort(); // deterministische Topic-Reihenfolge

  const topics = [];
  const snapshots = {};
  for (const pfad of markups) {
    const ordnerName = pfad.slice(0, pfad.indexOf('/'));
    const topic = topicAusMarkup(txt(pfad), warnungen, pfad);
    if (!topic) continue;

    // Viewpoints des Topics: referenzierte .bcfv + Snapshot-PNG.
    for (const vp of topic.viewpoints) {
      const bcfvPfad = vp.datei ? `${ordnerName}/${vp.datei}` : null;
      if (bcfvPfad && files[bcfvPfad]) {
        const { ifcGuids, kamera } = viewpointLesen(txt(bcfvPfad), warnungen, bcfvPfad);
        vp.ifcGuids = ifcGuids;
        vp.kamera = kamera;
      } else if (bcfvPfad) {
        warnungen.push(`${pfad}: referenzierte Viewpoint-Datei „${vp.datei}" fehlt im Container`);
      }
      if (vp.snapshot) {
        const pngPfad = `${ordnerName}/${vp.snapshot}`;
        if (files[pngPfad] && !snapshots[topic.guid]) {
          snapshots[topic.guid] = files[pngPfad]; // Bytes durchreichen, nicht parsen
        }
      }
    }
    // GlobalIds aller Viewpoints zusammen — die UI zeigt sie als Chips.
    topic.ifcGuids = [...new Set(topic.viewpoints.flatMap((v) => v.ifcGuids))];
    topics.push(topic);
  }

  if (!topics.length && !warnungen.length) {
    warnungen.push('Kein Topic mit markup.bcf gefunden — ist das ein BCF-Container?');
  }
  return { version, topics, warnungen, snapshots };
}
