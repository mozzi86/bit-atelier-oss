// befundSpur.js — minimales Layer-Schema für importierte BCF-Issues
// (Phase 71-04). Rein funktional, keine UI-, keine Server-Abhängigkeit.
//
// In:  parseBcfZip-Ergebnis (bcfImport.js) bzw. ein befunde_layer-Objekt.
// Out: Layer-Form für das exklusive BimModel-Feld `befunde_layer`,
//      Statuskette mit Übergangsregeln und Antwort-Topics für buildBcfZip.
//      72-13 (N-12): befundZuIssue/ticketZuBefund map a finding onto the Issue
//      data contract (ticketLink.js) — the bridge finding → ticket. The only
//      write access to Issue for this chain lives in befundTicket.js.
//
// WICHTIG — Phase 66 (Befund-Spur) übernimmt dieses Schema (ROADMAP 66:
// „Depends on 71-04"). Kein zweites Schema daneben bauen; Erweiterungen
// (Rückmeldung an Catenda, Zuordnung je Gewerk) gehören dort hinein.
//
// Layer-Form (ein Feld, flach gemergt vom Server — deshalb NUR dieser
// eine Schreiber, Fachlayer-Regel useFachlayer.js:1-38):
//   befunde_layer = {
//     quelle: 'catenda' | 'eigen',     // woher der letzte Import kam
//     importiert: ISO-Datum | null,
//     version: '2.1' | … | null,       // BCF-Version des letzten Imports
//     topics: [ <topic aus parseBcfZip> ],
//     antworten: { [topicGuid]: { status, text, datum } }
//   }

import { mitBauteilGuid } from './ticketLink.js';

/**
 * Statuskette. [ASSUMED] Catenda-Standard (Open → InProgress → Resolved →
 * Closed, BCF-2.1-TopicStatus ist eine freie xs:string-SimpleType ohne
 * Werteliste — markup.xsd). Im Projekt mit dem Generalplaner abzustimmen;
 * deshalb über `uebergang(alt, neu, erlaubt)` überschreibbar.
 * @type {readonly string[]}
 */
export const STATUS = Object.freeze(['Open', 'InProgress', 'Resolved', 'Closed']);

/**
 * Prüft einen Statusübergang.
 *
 * Regel (Plan 71-04): alles erlaubt AUSSER Closed → Open ohne Kommentar —
 * ein geschlossener Befund wird nur mit Begründung wieder geöffnet.
 *
 * @param {string} alt aktueller Status (unbekannt → nur Ziel geprüft)
 * @param {string} neu Zielstatus
 * @param {{kommentar?: string, erlaubt?: string[]}} [opt]
 *   kommentar: Antworttext (leer/fehlt = kein Kommentar)
 *   erlaubt: eigene Statusliste überschreibt STATUS ([ASSUMED]-Auflösung)
 * @returns {{ok: boolean, grund: string}}
 */
export function uebergang(alt, neu, { kommentar = '', erlaubt = STATUS } = {}) {
  const liste = Array.isArray(erlaubt) && erlaubt.length ? erlaubt : STATUS;
  if (!liste.includes(neu)) {
    return { ok: false, grund: `Unbekannter Zielstatus „${neu}" (erlaubt: ${liste.join(', ')})` };
  }
  if (!alt || !liste.includes(alt)) {
    // Unbekannter Herkunftsstatus (fremder Container): Ziel allein entscheidet.
    return { ok: true, grund: '' };
  }
  if (alt === 'Closed' && neu === 'Open' && !String(kommentar).trim()) {
    return { ok: false, grund: 'Closed → Open nur mit Kommentar (Wiederöffnung begründen)' };
  }
  return { ok: true, grund: '' };
}

/**
 * Leeres Layer-Objekt (Feld-Erstanlage, kein Schreibpfad — das macht die UI
 * über saveBimModel).
 * @param {{quelle?: 'catenda'|'eigen'}} [opt]
 * @returns {{quelle: string, importiert: null, version: null, topics: [], antworten: {}}}
 */
export function leeresLayer({ quelle = 'eigen' } = {}) {
  return { quelle, importiert: null, version: null, topics: [], antworten: {} };
}

/**
 * parseBcfZip-Ergebnis → befunde_layer. Bestehende ANTWORTEN bleiben nur
 * erhalten, wenn die Topic-Guid im neuen Import wieder vorkommt — sonst
 * verwaist kein Eintrag (Guid ist der Schlüssel, bcf.js Ordnername).
 *
 * @param {ReturnType<import('./bcfImport.js').parseBcfZip>} parse
 *   { version, topics, warnungen }
 * @param {object|null} bisher vorhandenes Layer (oder null/undefined)
 * @param {{quelle?: 'catenda'|'eigen', datum?: string}} [opt]
 *   datum: ISO-String des Imports (Default: jetzt)
 * @returns {{layer: object, verwaist: string[]}}
 *   layer: neue Layer-Form; verwaist: Guids gelöschter Antworten
 */
export function topicsZuLayer(parse, bisher, { quelle = 'catenda', datum = new Date().toISOString() } = {}) {
  const topics = Array.isArray(parse?.topics) ? parse.topics : [];
  const guidMenge = new Set(topics.map((t) => String(t.guid || '').toLowerCase()));
  const antworten = {};
  const verwaist = [];
  for (const [guid, a] of Object.entries(bisher?.antworten || {})) {
    if (guidMenge.has(guid.toLowerCase())) antworten[guid] = a;
    else verwaist.push(guid);
  }
  return {
    layer: {
      quelle,
      importiert: datum,
      version: parse?.version ?? null,
      topics,
      antworten,
    },
    verwaist,
  };
}

/**
 * Layer → Topics für buildBcfZip (Antwort-BCF). NUR Topics mit Antwort —
 * der Export ist die Rückmeldung, kein Re-Export des ganzen Containers.
 *
 * Kommentar-Text-Form (Plan 71-04): „BIT-Atelier · <status>: <text>".
 * Importierte Originalkommentare werden MITGESCHICKEN (Historie bleibt im
 * Container — markup.xsd erlaubt Comment* beliebig oft), der Antwort-
 * kommentar kommt als letzter dazu.
 *
 * @param {object} layer befunde_layer-Form
 * @param {{autor?: string, praefix?: string}} [opt]
 *   autor: CreationAuthor/ModifiedAuthor der Antwort (Default 'BIT-Atelier')
 *   praefix: Text vor „<status>: <text>" (Default 'BIT-Atelier')
 * @returns {Array<object>} topics in buildBcfZip-Form (guid, titel, …,
 *   kommentare[], topicStatus = neuer Status, modifiedDate/modifiedAuthor)
 */
export function antwortTopics(layer, { autor = 'BIT-Atelier', praefix = 'BIT-Atelier', erlaubt = STATUS } = {}) {
  const antworten = layer?.antworten || {};
  // Review R-5 (10.09.): dieselbe Liste wie in uebergang() — eine projekteigene
  // Statuskette gilt damit auch beim Export, nicht nur bei der Übergangsprüfung.
  const liste = Array.isArray(erlaubt) && erlaubt.length ? erlaubt : STATUS;
  const out = [];
  for (const t of layer?.topics || []) {
    const a = antworten[String(t.guid || '').toLowerCase()] || antworten[t.guid];
    if (!a || !String(a.text || '').trim()) continue; // ohne Text keine Antwort
    const status = liste.includes(a.status) ? a.status : t.topicStatus || liste[0];
    const datum = a.datum || new Date().toISOString();
    const kommentare = [
      ...(Array.isArray(t.kommentare) ? t.kommentare : []),
      {
        datum,
        autor,
        // Im Text steht der ROHE Antwort-Status (auch projekt-eigene Werte);
        // topicStatus wird auf die bekannte Kette normalisiert.
        text: `${praefix} · ${a.status || status}: ${String(a.text).trim()}`,
      },
    ];
    out.push({
      guid: t.guid,
      titel: t.titel || 'Befund',
      beschreibung: t.beschreibung || '',
      topicType: t.topicType || 'Issue',
      topicStatus: status,
      ifcGuids: t.ifcGuids || [],
      kommentare,
      creationDate: t.creationDate || datum,
      creationAuthor: t.creationAuthor || autor,
      modifiedDate: datum,
      modifiedAuthor: autor,
    });
  }
  return out;
}

/**
 * Antwort eines Topics setzen/löschen (rein — liefert ein NEUES Layer).
 * text leer → Antwort entfernt. Statusübergang wird hier NICHT geprüft
 * (das macht die UI mit uebergang(), damit sie den Grund anzeigen kann).
 *
 * @param {object} layer
 * @param {string} guid Topic-Guid
 * @param {{status: string, text: string, datum?: string}|null} antwort
 * @param {{erlaubt?: string[]}} [opt] eigene Statusliste (Default STATUS) — deren
 *   erster Eintrag ist der Fallback, wenn `antwort.status` fehlt
 * @returns {object} neue Layer-Form (Antwort unter lowercase-Guid)
 */
export function setzeAntwort(layer, guid, antwort, { erlaubt = STATUS } = {}) {
  const key = String(guid || '').toLowerCase();
  const antworten = { ...(layer?.antworten || {}) };
  const liste = Array.isArray(erlaubt) && erlaubt.length ? erlaubt : STATUS;
  if (!antwort || !String(antwort.text || '').trim()) {
    delete antworten[key];
  } else {
    antworten[key] = {
      status: antwort.status || liste[0],
      text: String(antwort.text).trim(),
      datum: antwort.datum || new Date().toISOString(),
    };
  }
  return { ...layer, antworten };
}

/**
 * Effektiv angezeigter Status eines Topics: Antwort-Status schlägt den
 * Import-Status des Topics, der schlägt den Fallback. (Review R-5: vorher
 * kannte die Funktion das Topic nicht und lieferte '' — die UI rechnete es
 * deshalb selbst nach; jetzt ist dies die eine Stelle dafür.)
 * @param {object} layer
 * @param {{guid?: string, topicStatus?: string}|string} topic Topic oder Guid
 * @param {string} [fallback='Open']
 * @returns {string}
 */
export function statusVon(layer, topic, fallback = 'Open') {
  const guid = typeof topic === 'string' ? topic : topic?.guid;
  const a = layer?.antworten?.[String(guid || '').toLowerCase()];
  const importStatus = typeof topic === 'string' ? '' : topic?.topicStatus;
  return a?.status || importStatus || fallback;
}

// --- Befund → Ticket (72-13, N-12) -------------------------------------------

/** BCF TopicStatus (lowercase, without blanks/underscores) → Issue.status. */
const TICKET_STATUS_VON_BCF = {
  open: 'open',
  inprogress: 'in_progress',
  resolved: 'resolved',
  closed: 'closed',
};

// [ASSUMED] BCF 2.1 Priority is a free string (extension.xsd lists the values
// per project, markup.xsd only types it xs:string). The mapping follows the
// wording Solibri/BIMcollab ship by default (Critical/High/Normal/Low, some
// projects write Medium). Anything unknown becomes 'medium' — a finding of
// unknown weight should neither jump the queue nor sink to the bottom. The
// project's own extension.xsd is the way to a confirmed mapping.
/** BCF Priority (lowercase) → Issue.priority. */
const TICKET_PRIORITAET_VON_BCF = {
  critical: 'critical',
  high: 'high',
  normal: 'medium',
  medium: 'medium',
  low: 'low',
};

/**
 * Own-key lookup with a lowercase key; a value like "constructor" must not
 * resolve to an Object.prototype member.
 * @param {Record<string, string>} map
 * @param {string} schluessel already normalised key
 * @param {string} rueckfall value for unknown keys
 * @returns {string}
 */
function nachschlagen(map, schluessel, rueckfall) {
  return Object.prototype.hasOwnProperty.call(map, schluessel) ? map[schluessel] : rueckfall;
}

/**
 * Maps a BCF finding (topic from parseBcfZip, stored in befunde_layer) onto the
 * Issue data contract of ticketLink.js. Pure — the write happens in
 * befundTicket.js.
 *
 * - status: effective status via statusVon (answer status beats import status),
 *   Open/InProgress/Resolved/Closed → open/in_progress/resolved/closed
 *   (case-insensitive), anything else → 'open';
 * - priority: topic.prioritaet, [ASSUMED] mapping above, fallback 'medium';
 * - element_guid = element_id = first IFC GlobalId of the topic ('' without one),
 *   ifc_guids = all of them; location null (a BCF finding carries no model point
 *   the viewer could place — the BCF camera is not a position).
 *
 * @param {{guid?: string, titel?: string, beschreibung?: string,
 *   topicStatus?: string, prioritaet?: string|null, ifcGuids?: string[]}} topic
 * @param {{projectId?: string|null, layer?: object|null}} [opt]
 *   projectId: project the ticket belongs to; layer: befunde_layer with the
 *   answers (optional — without it the import status counts)
 * @returns {{project_id: string|null, title: string, description: string,
 *   status: string, priority: string, element_guid: string, element_id: string,
 *   ifc_guids: string[], bcf_topic_guid: string, quelle: string, location: null}}
 */
export function befundZuIssue(topic, { projectId = null, layer = null } = {}) {
  const guid = String(topic?.guid || '').trim();
  const titel = String(topic?.titel || '').trim();
  const beschreibung = String(topic?.beschreibung || '').trim();
  const herkunft = `Aus BCF-Befund ${guid}`;
  const statusRoh = statusVon(layer, topic || {}, '');
  const status = nachschlagen(TICKET_STATUS_VON_BCF, statusRoh.toLowerCase().replace(/[\s_-]/g, ''), 'open');
  const priority = nachschlagen(TICKET_PRIORITAET_VON_BCF, String(topic?.prioritaet || '').trim().toLowerCase(), 'medium');
  const ifcGuids = (Array.isArray(topic?.ifcGuids) ? topic.ifcGuids : [])
    .map((g) => String(g || '').trim())
    .filter(Boolean);
  const daten = {
    project_id: projectId || null,
    title: titel || 'BCF-Befund',
    description: beschreibung ? `${beschreibung}\n\n${herkunft}` : herkunft,
    status,
    priority,
    ifc_guids: ifcGuids,
    bcf_topic_guid: guid,
    quelle: 'bcf',
    location: null,
  };
  return mitBauteilGuid(daten, ifcGuids[0] || '');
}

/**
 * Finds the ticket created from a BCF finding. Topic guids are compared
 * case-insensitively (BIMcollab writes lowercase, Solibri mixes — bcfImport.js).
 * @param {Array<{bcf_topic_guid?: string}>|null|undefined} issues tickets of the project
 * @param {string|null|undefined} topicGuid BCF topic guid (UUID)
 * @returns {object|null} the first matching ticket, null without guid or match
 */
export function ticketZuBefund(issues, topicGuid) {
  const gesucht = String(topicGuid || '').trim().toLowerCase();
  if (!gesucht || !Array.isArray(issues)) return null;
  return issues.find((i) => String(i?.bcf_topic_guid || '').trim().toLowerCase() === gesucht) || null;
}
