// BCF-2.1-Export (BIM Collaboration Format) — self-contained, node-lauffaehig, KEINE Dependency.
//
// Baut aus Pruef-Befunden (Clashes, IDS-Verletzungen) einen .bcf-Container:
//   bcf.version                 (Pflicht, Root)
//   {topicGuid}/markup.bcf      (Pflicht je Topic; Ordnername = Topic-Guid, lowercase UUID)
//   {topicGuid}/viewpoint.bcfv  (Haupt-Viewpoint, Name ist von der Spez fixiert)
//
// Eigener ZIP-Writer (nur STORE, kein Deflate) + CRC32 — bewusst ohne npm-Paket.
// Die drei BCF-2.1-XSDs (version.xsd, markup.xsd, visinfo.xsd) haben KEINEN
// targetNamespace, daher wird bewusst kein xmlns geschrieben.
//
// Exporte: crc32, xmlEscape, zipStore, buildBcfZip, newTopicGuid

// ---------------------------------------------------------------------------
// CRC-32 (reflektiert, Polynom 0xEDB88320, Init 0xFFFFFFFF, Final-XOR 0xFFFFFFFF)
// Standard-Anker: crc32("123456789") === 0xCBF43926
// Eingefrorener Smoke-Referenzwert: crc32("IHDR-Test") === 0xFF1A65A7
// ---------------------------------------------------------------------------

const CRC_TABELLE = (() => {
  const tab = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tab[n] = c >>> 0;
  }
  return tab;
})();

const TEXT_ENCODER = new TextEncoder();

/** CRC-32 ueber Uint8Array oder String (Strings werden UTF-8-encodiert). Ergebnis: uint32. */
export function crc32(eingabe) {
  const bytes = typeof eingabe === "string" ? TEXT_ENCODER.encode(eingabe) : eingabe;
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABELLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------------------
// XML-Escaping — fuer Textinhalt UND Attributwerte (Clash-Titel enthalten '<'!)
// ---------------------------------------------------------------------------

/** Escaped & < > " ' — fuer Element-Text und Attributwerte gleichermassen sicher. */
export function xmlEscape(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ---------------------------------------------------------------------------
// ZIP-Writer (nur STORE): Local File Header + Central Directory + EOCD.
// Alles Little-Endian; extra field und comment bleiben stets leer.
// UTF-8-Flag Bit 11 (0x0800) identisch in Local Header UND Central Directory.
// ---------------------------------------------------------------------------

/** DOS-Zeit: Sekunden werden halbiert gespeichert. */
function dosZeit(d) {
  return ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff;
}

/** DOS-Datum: Jahre vor 1980 sind unzulaessig -> clampen. */
function dosDatum(d) {
  const jahr = Math.max(d.getFullYear(), 1980);
  return (((jahr - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff;
}

/**
 * Packt Eintraege unkomprimiert (STORE) in ein ZIP.
 * @param {Array<{name: string, data: Uint8Array|string}>} eintraege
 *        name: ZIP-Pfad mit Forward-Slashes, ohne fuehrenden Slash;
 *        data: Rohdaten (Strings werden UTF-8-encodiert).
 * @param {Date} [datum] Zeitstempel fuer alle Eintraege (Default: jetzt).
 * @returns {Uint8Array} fertige ZIP-Bytes.
 */
export function zipStore(eintraege, datum = new Date()) {
  const zeit = dosZeit(datum);
  const tag = dosDatum(datum);

  // Normalisieren: Namen als UTF-8-BYTES (nameLen = Bytelaenge, nicht String-Laenge!)
  const norm = eintraege.map((e) => {
    const daten = typeof e.data === "string" ? TEXT_ENCODER.encode(e.data) : e.data;
    return { nameBytes: TEXT_ENCODER.encode(e.name), daten, crc: crc32(daten) };
  });

  const lokalGroesse = norm.reduce((s, e) => s + 30 + e.nameBytes.length + e.daten.length, 0);
  const cdGroesse = norm.reduce((s, e) => s + 46 + e.nameBytes.length, 0);
  const puffer = new Uint8Array(lokalGroesse + cdGroesse + 22);
  const sicht = new DataView(puffer.buffer);
  let pos = 0;

  // 1) Local File Header (30 Bytes + Name), direkt gefolgt von den Rohdaten
  const lfhOffsets = [];
  for (const e of norm) {
    lfhOffsets.push(pos);
    sicht.setUint32(pos + 0, 0x04034b50, true); // Signatur "PK\x03\x04"
    sicht.setUint16(pos + 4, 20, true); // version needed to extract = 2.0
    sicht.setUint16(pos + 6, 0x0800, true); // Flags: Bit 11 = UTF-8-Dateinamen
    sicht.setUint16(pos + 8, 0, true); // Methode 0 = STORE
    sicht.setUint16(pos + 10, zeit, true);
    sicht.setUint16(pos + 12, tag, true);
    sicht.setUint32(pos + 14, e.crc, true); // CRC ueber die unkomprimierten Rohdaten
    sicht.setUint32(pos + 18, e.daten.length, true); // compressed == uncompressed (STORE)
    sicht.setUint32(pos + 22, e.daten.length, true);
    sicht.setUint16(pos + 26, e.nameBytes.length, true);
    sicht.setUint16(pos + 28, 0, true); // extra field length
    puffer.set(e.nameBytes, pos + 30);
    puffer.set(e.daten, pos + 30 + e.nameBytes.length);
    pos += 30 + e.nameBytes.length + e.daten.length;
  }

  // 2) Central Directory File Header (46 Bytes + Name), hintereinander
  const cdOffset = pos;
  for (let i = 0; i < norm.length; i++) {
    const e = norm[i];
    sicht.setUint32(pos + 0, 0x02014b50, true); // Signatur
    sicht.setUint16(pos + 4, 20, true); // version made by
    sicht.setUint16(pos + 6, 20, true); // version needed
    sicht.setUint16(pos + 8, 0x0800, true); // Flags identisch zum Local Header
    sicht.setUint16(pos + 10, 0, true); // STORE
    sicht.setUint16(pos + 12, zeit, true);
    sicht.setUint16(pos + 14, tag, true);
    sicht.setUint32(pos + 16, e.crc, true);
    sicht.setUint32(pos + 20, e.daten.length, true);
    sicht.setUint32(pos + 24, e.daten.length, true);
    sicht.setUint16(pos + 28, e.nameBytes.length, true);
    sicht.setUint16(pos + 30, 0, true); // extra len
    sicht.setUint16(pos + 32, 0, true); // comment len
    sicht.setUint16(pos + 34, 0, true); // disk number start
    sicht.setUint16(pos + 36, 0, true); // internal attrs
    sicht.setUint32(pos + 38, 0, true); // external attrs
    sicht.setUint32(pos + 42, lfhOffsets[i], true); // Offset des Local File Headers
    puffer.set(e.nameBytes, pos + 46);
    pos += 46 + e.nameBytes.length;
  }

  // 3) End of Central Directory (22 Bytes, ganz am Ende)
  sicht.setUint32(pos + 0, 0x06054b50, true); // Signatur
  sicht.setUint16(pos + 4, 0, true); // this disk
  sicht.setUint16(pos + 6, 0, true); // disk mit CD-Start
  sicht.setUint16(pos + 8, norm.length, true); // Eintraege auf dieser Disk
  sicht.setUint16(pos + 10, norm.length, true); // Eintraege gesamt
  sicht.setUint32(pos + 12, cdGroesse, true); // Bytelaenge des Central Directory
  sicht.setUint32(pos + 16, cdOffset, true); // Byte-Offset des CD-Starts
  sicht.setUint16(pos + 20, 0, true); // comment length
  return puffer;
}

// ---------------------------------------------------------------------------
// GUIDs — ACHTUNG, zwei verschiedene Formate:
//  * Topic-/Viewpoint-Guid: UUID (hex 8-4-4-4-12, hier konsequent lowercase)
//  * Component-IfcGuid: 22-Zeichen-IFC-Base64-GlobalId (0-9 A-Z a-z _ $) aus dem Modell
// NIEMALS mischen — XSD-validierende Tools (BIMcollab, Solibri) lehnen das ab.
// ---------------------------------------------------------------------------

const UUID_MUSTER = /^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$/;
const IFC_GUID_MUSTER = /^[0-9A-Za-z_$]{22}$/;

/** 16 Bytes -> UUID-String mit Version-4- und RFC-4122-Varianten-Bits, lowercase. */
function uuidAusBytes(b) {
  b[6] = (b[6] & 0x0f) | 0x40; // Version 4
  b[8] = (b[8] & 0x3f) | 0x80; // Variante RFC 4122
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Wrapper fuer neue Topic-Guids (UUID v4). Der Kern (buildBcfZip) nimmt Topics
 * MIT fertigen Guids entgegen und bleibt damit deterministisch testbar —
 * Zufall lebt NUR hier. rng kann fuer Tests durch einen Seeded-PRNG ersetzt werden.
 */
export function newTopicGuid(rng = Math.random) {
  const b = new Uint8Array(16);
  for (let i = 0; i < 16; i++) b[i] = Math.floor(rng() * 256) & 0xff;
  return uuidAusBytes(b);
}

/** Deterministische UUID-Ableitung (LCG, Seed = crc32(basis:salz)) — z. B. Viewpoint-Guid aus Topic-Guid. */
function abgeleiteteGuid(basis, salz) {
  let zustand = crc32(`${basis}:${salz}`) || 1;
  const b = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    zustand = (Math.imul(zustand, 1664525) + 1013904223) >>> 0; // LCG (Numerical Recipes)
    b[i] = (zustand >>> 16) & 0xff;
  }
  return uuidAusBytes(b);
}

// ---------------------------------------------------------------------------
// XML-Bausteine (BCF 2.1) — kein Namespace, Reihenfolgen gemaess xs:sequence!
// ---------------------------------------------------------------------------

// bcf.version: VersionId ist Pflicht-ATTRIBUT, DetailedVersion optionales Kind.
const BCF_VERSION_XML =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<Version VersionId="2.1">\n' +
  "  <DetailedVersion>2.1</DetailedVersion>\n" +
  "</Version>\n";

/**
 * markup.bcf je Topic. Kindreihenfolge ist fixe xs:sequence — GEGEN DIE
 * ECHTE markup.xsd (BCF-XML release_2_1, buildingSMART GitHub) geprüft:
 *   Markup  = Header?, Topic, Comment*, Viewpoints*
 *   Topic   = ReferenceLink*, Title, Priority?, Index?, Labels*,
 *             CreationDate, CreationAuthor, ModifiedDate?, ModifiedAuthor?,
 *             DueDate?, AssignedTo?, Stage?, Description?, BimSnippet?,
 *             DocumentReference*, RelatedTopic*
 *   Comment = Date, Author, Comment, Viewpoint?, ModifiedDate?, ModifiedAuthor?
 * CreationDate ist xs:dateTime MIT Zeitzone (toISOString() ist gueltig,
 * reines Datum NICHT). Viewpoint-Verweis heisst 'Viewpoints' (Plural!);
 * dessen Guid MUSS identisch mit der VisualizationInfo-Guid der referenzierten
 * .bcfv-Datei sein. KEIN <Snapshot>: der Plan sieht keine PNGs vor, tote
 * Verweise crashen Viewer.
 *
 * 71-04 additiv: topic.kommentare[] -> <Comment>-Elemente ZWISCHEN Topic und
 * Viewpoints (Sequence-Position s. o.); topic.modifiedDate/modifiedAuthor ->
 * Topic-Kinder NACH CreationAuthor (DueDate/AssignedTo/Stage schreiben wir
 * nicht). Bestehende Aufrufer (ohne diese Felder) erzeugen byte-identisch
 * das bisherige Markup.
 */
function markupXml(topic, meta) {
  const teile = [];
  teile.push('<?xml version="1.0" encoding="UTF-8"?>');
  teile.push("<Markup>");

  // Header ist komplett optional — nur schreiben, wenn ein Modellname bekannt ist.
  if (meta.modellName) {
    // IfcProject-Attribut nur setzen, wenn eine ECHTE 22er-IFC-GlobalId vorliegt
    // (niemals eine UUID einsetzen — falsche Laenge = schema-invalid).
    const ifcProjekt = IFC_GUID_MUSTER.test(meta.ifcProjectGuid || "")
      ? ` IfcProject="${meta.ifcProjectGuid}"`
      : "";
    teile.push("  <Header>");
    teile.push(`    <File${ifcProjekt} isExternal="true">`);
    teile.push(`      <Filename>${xmlEscape(meta.modellName)}</Filename>`);
    teile.push(`      <Date>${xmlEscape(meta.datum)}</Date>`);
    teile.push("    </File>");
    teile.push("  </Header>");
  }

  teile.push(
    `  <Topic Guid="${topic.guid}" TopicType="${xmlEscape(topic.topicType)}" TopicStatus="${xmlEscape(topic.topicStatus)}">`
  );
  teile.push(`    <Title>${xmlEscape(topic.titel)}</Title>`);
  teile.push(`    <CreationDate>${xmlEscape(topic.creationDate || meta.datum)}</CreationDate>`);
  teile.push(`    <CreationAuthor>${xmlEscape(topic.creationAuthor || meta.autor)}</CreationAuthor>`);
  // Sequence-Position: ModifiedDate/ModifiedAuthor stehen NACH CreationAuthor
  // und VOR AssignedTo/Description (markup.xsd Topic-Type).
  if (topic.modifiedDate) teile.push(`    <ModifiedDate>${xmlEscape(topic.modifiedDate)}</ModifiedDate>`);
  if (topic.modifiedAuthor) teile.push(`    <ModifiedAuthor>${xmlEscape(topic.modifiedAuthor)}</ModifiedAuthor>`);
  if (topic.beschreibung) teile.push(`    <Description>${xmlEscape(topic.beschreibung)}</Description>`);
  teile.push("  </Topic>");

  // Comments NACH Topic, VOR Viewpoints (Markup-Sequence). Comment-Sequence:
  // Date, Author, Comment, Viewpoint? (optionaler Verweis auf eine .bcfv).
  for (const k of topic.kommentare || []) {
    const kGuid = UUID_MUSTER.test(String(k.guid || "").toLowerCase())
      ? String(k.guid).toLowerCase() : abgeleiteteGuid(topic.guid, `comment:${k.datum || meta.datum}:${k.text || ""}`);
    teile.push(`  <Comment Guid="${kGuid}">`);
    teile.push(`    <Date>${xmlEscape(k.datum || meta.datum)}</Date>`);
    teile.push(`    <Author>${xmlEscape(k.autor || meta.autor)}</Author>`);
    teile.push(`    <Comment>${xmlEscape(k.text || "")}</Comment>`);
    if (k.viewpointGuid && UUID_MUSTER.test(String(k.viewpointGuid))) {
      teile.push(`    <Viewpoint Guid="${String(k.viewpointGuid).toLowerCase()}" />`);
    }
    teile.push("  </Comment>");
  }

  teile.push(`  <Viewpoints Guid="${topic.viewpointGuid}">`);
  teile.push("    <Viewpoint>viewpoint.bcfv</Viewpoint>");
  teile.push("  </Viewpoints>");
  teile.push("</Markup>");
  return teile.join("\n") + "\n";
}

/**
 * viewpoint.bcfv je Topic. Guid MUSS identisch mit der Viewpoints-Guid im Markup sein.
 * Components-Sequenz: ViewSetupHints? -> Selection? -> Visibility(PFLICHT!) -> Coloring?.
 * Visibility ist Pflicht, SOBALD <Components> existiert (minOccurs=1 in visinfo.xsd).
 * Component-IfcGuid ist ein ATTRIBUT (22er-IFC-GlobalId, kein Kind-Element).
 * FieldOfView ist im 2.1-XSD auf 45..60 Grad restringiert -> neutraler Wert 60.
 */
function viewpointXml(topic) {
  const teile = [];
  teile.push('<?xml version="1.0" encoding="UTF-8"?>');
  teile.push(`<VisualizationInfo Guid="${topic.viewpointGuid}">`);

  // Nur ECHTE 22er-IFC-GlobalIds als Components schreiben; ohne gueltige Ids
  // entfaellt der komplette Components-Block (dann ist auch keine Visibility noetig).
  const ifcGuids = (topic.ifcGuids || []).filter((g) => IFC_GUID_MUSTER.test(g || ""));
  if (ifcGuids.length > 0) {
    teile.push("  <Components>");
    teile.push("    <Selection>");
    for (const g of ifcGuids) teile.push(`      <Component IfcGuid="${g}" />`);
    teile.push("    </Selection>");
    teile.push('    <Visibility DefaultVisibility="true" />');
    teile.push("  </Components>");
  }

  // Neutrale Perspektiv-Kamera: schaut von (10,-10,10) Richtung Ursprung, Z nach oben.
  // Alle vier Kinder (ViewPoint/Direction/UpVector/FieldOfView) sind Pflicht.
  teile.push("  <PerspectiveCamera>");
  teile.push("    <CameraViewPoint><X>10.0</X><Y>-10.0</Y><Z>10.0</Z></CameraViewPoint>");
  teile.push(
    "    <CameraDirection><X>-0.5773502691896258</X><Y>0.5773502691896258</Y><Z>-0.5773502691896258</Z></CameraDirection>"
  );
  teile.push("    <CameraUpVector><X>0.0</X><Y>0.0</Y><Z>1.0</Z></CameraUpVector>");
  teile.push("    <FieldOfView>60</FieldOfView>");
  teile.push("  </PerspectiveCamera>");
  teile.push("</VisualizationInfo>");
  return teile.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Haupt-Export: Topics -> fertiger .bcf-Container (Uint8Array)
// ---------------------------------------------------------------------------

/**
 * Baut einen BCF-2.1-Container (.bcf, ZIP mit STORE) aus fertigen Topics.
 *
 * @param {Array<Object>} topics Topics MIT fertigen Guids (deterministisch, s. newTopicGuid):
 *   guid          Pflicht: Topic-Guid als UUID (wird lowercase normalisiert; auch ZIP-Ordnername)
 *   viewpointGuid optional: UUID des Haupt-Viewpoints (Default: deterministisch aus guid abgeleitet)
 *   titel         Topic-Titel (wird xml-escaped, z. B. "IfcWall<->IfcPipeSegment ...")
 *   beschreibung  optional: Beschreibung des Befunds
 *   topicType     optional (Default "Issue"), topicStatus optional (Default "Open") — frei wählbar
 *                 (71-04: importierte Stati wie "Resolved" laufen unverändert durch)
 *   ifcGuids      optional: 22er-IFC-GlobalIds der betroffenen Bauteile (-> Viewpoint-Components)
 *   kommentare    optional (71-04): [{ guid?, datum?, autor?, text, viewpointGuid? }]
 *                 -> <Comment>-Elemente, Guid fehlt = deterministisch abgeleitet
 *   creationDate / creationAuthor / modifiedDate / modifiedAuthor optional (71-04):
 *   importierte Werte bleiben erhalten; Defaults kommen aus meta
 * @param {Object} [meta]
 *   autor        CreationAuthor (Default "BIT-Atelier" — renamed 22.09.2026, RC-08 trademark)
 *   modellName   optional: Dateiname des geprueften IFC-Modells (-> Markup-Header)
 *   ifcProjectGuid optional: 22er-IFC-GlobalId des IfcProject (sonst Attribut weglassen)
 *   datum        optional: ISO-8601-dateTime MIT Zeitzone (Default: new Date().toISOString())
 * @returns {Uint8Array} ZIP-Bytes; Download-Dateiendung ".bcf" (seit 2.1 offiziell).
 */
export function buildBcfZip(topics, meta = {}) {
  const datum =
    typeof meta.datum === "string" && meta.datum ? meta.datum : new Date().toISOString();
  const vollMeta = {
    autor: meta.autor || "BIT-Atelier",
    modellName: meta.modellName || "",
    ifcProjectGuid: meta.ifcProjectGuid || "",
    datum,
  };

  const eintraege = [{ name: "bcf.version", data: BCF_VERSION_XML }];

  for (const roh of topics || []) {
    // Topic-Guid validieren + lowercase normalisieren (Ordnername MUSS exakt der Guid entsprechen).
    const guid = String(roh.guid || "").toLowerCase();
    if (!UUID_MUSTER.test(guid)) {
      throw new Error(`buildBcfZip: ungueltige Topic-Guid "${roh.guid}" (UUID 8-4-4-4-12 erwartet)`);
    }
    const viewpointGuid = UUID_MUSTER.test(roh.viewpointGuid || "")
      ? String(roh.viewpointGuid).toLowerCase()
      : abgeleiteteGuid(guid, "viewpoint");

    const topic = {
      guid,
      viewpointGuid,
      titel: roh.titel ?? roh.title ?? "Befund",
      beschreibung: roh.beschreibung ?? roh.description ?? "",
      topicType: roh.topicType || "Issue",
      topicStatus: roh.topicStatus || "Open",
      ifcGuids: roh.ifcGuids || [],
      // 71-04 additiv: Kommentare und Änderungs-Herkunft für den Antwort-BCF.
      // Ohne diese Felder bleibt die Ausgabe byte-identisch (Bestand).
      kommentare: Array.isArray(roh.kommentare) ? roh.kommentare : [],
      creationDate: roh.creationDate || "",
      creationAuthor: roh.creationAuthor || "",
      modifiedDate: roh.modifiedDate || "",
      modifiedAuthor: roh.modifiedAuthor || "",
    };

    // ZIP-Pfade: Forward-Slashes, ohne fuehrenden Slash (Windows-Falle: keine Backslashes!)
    eintraege.push({ name: `${guid}/markup.bcf`, data: markupXml(topic, vollMeta) });
    eintraege.push({ name: `${guid}/viewpoint.bcfv`, data: viewpointXml(topic) });
  }

  // Zeitstempel der ZIP-Eintraege aus dem Meta-Datum ableiten (Fallback: jetzt).
  const zipDatum = new Date(datum);
  return zipStore(eintraege, isNaN(zipDatum.getTime()) ? new Date() : zipDatum);
}
