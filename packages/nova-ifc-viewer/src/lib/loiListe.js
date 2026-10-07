// loiListe.js — eine LOI-Tabelle (Level of Information) des Bauherrn als
// CSV-Extrakt (ein Blatt je Bauteilgruppe) als maschinenlesbare Merkmalliste
// (Phase 71-01).
//
// In:  CSV-Text (Semikolon-getrennt, UTF-8 mit BOM, Spalten pro Blatt:
//      A Blattname · B Merkmal · H Ifc Property Set · I Ifc Variable ·
//      J Ifc Datentyp · L..O LPH2/3/5/8 Pflicht-„x").
//      Aufbau je Blatt (71-RESEARCH §1.3): Zeile 1 Name + active|inactive in
//      Spalte C; Zeile 2 „ifcType" in Spalte G + Klassenliste in Spalte I mit
//      WECHSELNDEN Trennern (Leerzeichen, Semikolon, Komma); Zeile 3
//      Überschrift; ab Zeile 4 Merkmale; am Ende Legenden-Zeilen.
// Out: parseLoiCsv(text) -> { blaetter: [{ name, aktiv, ifcTypen, merkmale }] }
//      loiZuSpezifikationen(loi, { lph, blaetter, quelle }) -> { spezifikationen,
//      warnungen, nichtPruefbar } als Eingabe für idsWriter.schreibeIds.
//
// REIN und DOM-FREI, keine Imports (Boundary-Regel: Pakete nur @core + sich
// selbst — dieses Modul braucht nichts davon).
//
// Entscheidungen aus 71-RESEARCH §3:
// - D-P71-02: Entity-Facette als enumeration UPPERCASE; Beispielwerte
//   (Spalte G) werden NICHT zu Restriktionen — das sind Beispiele. Ausnahme
//   „true;false": kein Wert, nur dataType IFCBOOLEAN.
// - D-P71-03: Pflicht nach LPH-Spalte, Default LPH5.
// - `automatisch`+GlobalId -> attribute-Facette; Site/Building/Storey-Name ->
//   nicht_pruefbar (partOf wertet ids.js nicht aus — README nennt es).
// - Sonderfall „RG:BaseQuantities/BG:PRJ" -> RG-Teil (Rechnergebäude, unsere
//   Fachsicht D-P71-10) + Warnung. Allgemeiner: erster Teil vor „/".

/** Pflicht-Spaltenindex je LPH: LPH2=11, LPH3=12, LPH5=13, LPH8=14 (0-basiert, Spalte L..O). */
const LPH_SPALTEN = { 2: 11, 3: 12, 5: 13, 8: 14 };

/**
 * Mini-CSV-Parser: Semikolon-Trenner, doppelte Quotes (auch mit Trenner im
 * Feld, z. B. „true;false"), BOM entfernen, CRLF/LF. Bewusst eigene 40 Zeilen
 * statt einer npm-Abhängigkeit (keine neuen Dependencies, CLAUDE.md).
 * @param {string} text
 * @returns {string[][]} Zeilen aus Feldern
 */
export function parseCsvSemikolon(text) {
  const t = String(text ?? "").replace(/^\uFEFF/, "");
  const zeilen = [];
  let zeile = [];
  let feld = "";
  let inQuotes = false;
  for (let i = 0; i < t.length; i++) {
    const z = t[i];
    if (inQuotes) {
      if (z === '"') {
        if (t[i + 1] === '"') { feld += '"'; i++; } else inQuotes = false;
      } else feld += z;
    } else if (z === '"') {
      inQuotes = true;
    } else if (z === ";") {
      zeile.push(feld); feld = "";
    } else if (z === "\n" || z === "\r") {
      if (z === "\r" && t[i + 1] === "\n") i++;
      zeile.push(feld); feld = "";
      zeilen.push(zeile); zeile = [];
    } else feld += z;
  }
  zeile.push(feld);
  if (zeile.some((f) => f !== "")) zeilen.push(zeile);
  return zeilen;
}

/**
 * Klassenliste mit den drei Trennern der LOI-Tabelle zerlegen (71-RESEARCH §5):
 * „IfcMember IfcPlate" · „IfcWall; IfcWallStandardCase" · „IfcStair, IfcStairFlight".
 * @param {string} roh
 * @returns {string[]} Klassen in Ifc-Schreibweise, in Listenreihenfolge
 */
export function klassenAusListe(roh) {
  return String(roh ?? "")
    .split(/[\s;,]+/)
    .map((s) => s.trim())
    .filter((s) => /^Ifc[A-Za-z]+$/.test(s));
}

/**
 * LOI-CSV-Text -> Blätter mit Merkmalen.
 * @param {string} text CSV-Inhalt der LOI-Tabelle
 * @returns {{blaetter: Array<{name: string, aktiv: boolean, ifcTypen: string[],
 *   merkmale: Array<{merkmal: string, pset: string, variable: string, datentyp: string,
 *     lph: {2: boolean, 3: boolean, 5: boolean, 8: boolean},
 *     quelle: 'attribut'|'qto'|'pset'|'nicht_pruefbar'}>}>}}
 */
export function parseLoiCsv(text) {
  const zeilen = parseCsvSemikolon(text);
  /** @type {Array} */
  const blaetter = [];
  let blatt = null;

  for (const z of zeilen) {
    const status = String(z[2] ?? "").trim().toLowerCase();
    // Blatt-Kopf: Zeile 1 trägt active|inactive in Spalte C.
    if (status === "active" || status === "inactive") {
      blatt = {
        name: String(z[0] ?? "").trim(),
        aktiv: status === "active",
        ifcTypen: [],
        merkmale: [],
      };
      blaetter.push(blatt);
      continue;
    }
    if (!blatt) continue;
    // Zeile 2: ifcType-Deklaration, Klassenliste in Spalte I (Index 8).
    if (String(z[6] ?? "").trim() === "ifcType") {
      blatt.ifcTypen = klassenAusListe(z[8]);
      continue;
    }
    // Zeile „2": ifcTypeObject (nur Treppenpodeste: „Landing"). Bewusst NICHT
    // als PredefinedType-Facette geschrieben — ob die Revit-Modelle den Typ
    // wirklich setzen, ist unbelegt (71-RESEARCH misst ihn nicht); eine zu
    // enge Facette würde die ganze Spec „nicht anwendbar" melden statt echte
    // Merkmalslücken. Im README als Einschränkung dokumentiert.
    if (String(z[6] ?? "").trim() === "ifcTypeObject") continue;
    // Zeile 3: Überschrift — überspringen.
    if (String(z[1] ?? "").trim() === "Merkmal") continue;

    const merkmal = String(z[1] ?? "").trim();
    const beispiel = String(z[6] ?? "").trim();
    const psetRoh = String(z[7] ?? "").trim();
    const variable = String(z[8] ?? "").trim();
    const datentyp = String(z[9] ?? "").trim();
    // Legenden-Zeilen und leere Zeilen: kein Merkmal oder kein Pset.
    if (!merkmal || merkmal === "Legende" || !psetRoh) continue;

    const lph = {
      2: String(z[11] ?? "").trim().toLowerCase() === "x",
      3: String(z[12] ?? "").trim().toLowerCase() === "x",
      5: String(z[13] ?? "").trim().toLowerCase() === "x",
      8: String(z[14] ?? "").trim().toLowerCase() === "x",
    };
    blatt.merkmale.push({ merkmal, beispiel, pset: psetRoh, variable, datentyp, lph,
      quelle: quelleVon(psetRoh, variable, datentyp, beispiel) });
  }
  return { blaetter };
}

/** UUID-/GUID-Muster — Beweis für „Element ID = GlobalId" bei Datenlücken
 *  (Blätter Treppen/Treppenpodeste tragen in der Variablen-Spalte „zu
 *  definieren", aber in Spalte G dasselbe GUID-Beispiel wie die anderen). */
const GUID_MUSTER = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Quelle eines Merkmals bestimmen: attribut (automatisch+GlobalId), qto
 * (BaseQuantities), pset, oder nicht_pruefbar (Site/Building/Storey-Name als
 * partOf-Facette — von ids.js nicht ausgewertet; „zu definieren"/„tbd" als
 * Platzhalter der LOI-Tabelle selbst — Ausnahme: GUID-Beispiel beweist GlobalId).
 * @param {string} pset
 * @param {string} variable
 * @param {string} datentyp
 * @param {string} [beispiel] Beispielwert Spalte G (nur zur Intent-Erkennung)
 * @returns {'attribut'|'qto'|'pset'|'nicht_pruefbar'}
 */
function quelleVon(pset, variable, datentyp, beispiel = "") {
  if (pset.toLowerCase() === "automatisch") {
    if (variable === "GlobalId") return "attribut";
    // Datenlücke: Variable „zu definieren", aber das Beispiel ist eine GUID —
    // dieselbe Zeile heißt in allen anderen Blättern GlobalId (71-RESEARCH
    // §1.3: „automatisch (SiteName, BuildingName, BuildingStoreyName,
    // GlobalId)"). Als attribut behandeln; loiZuSpezifikationen warnt.
    if (!variable || variable === "zu definieren") {
      return GUID_MUSTER.test(beispiel) ? "attribut" : "nicht_pruefbar";
    }
    return "nicht_pruefbar";  // SiteName/BuildingName/BuildingStoreyName
  }
  if (!variable || variable === "zu definieren" || datentyp === "tbd") return "nicht_pruefbar";
  if (psetNormiert(pset).pset === "BaseQuantities") return "qto";
  return "pset";
}

/**
 * Pset-Sonderfälle der LOI-Tabelle auflösen: „RG:BaseQuantities/BG:PRJ" -> RG-
 * Teil (Rechnergebäude = unsere Fachsicht, D-P71-10); „BaseQuantities/PRJ" ->
 * erster Teil. Gibt zurück { pset, mehrdeutig }.
 * @param {string} psetRoh
 * @returns {{pset: string, mehrdeutig: boolean}}
 */
export function psetNormiert(psetRoh) {
  const roh = String(psetRoh ?? "").trim();
  const rg = roh.match(/^RG:\s*([^/]+)\s*(?:\/\s*BG:\s*(.+))?$/i);
  if (rg) return { pset: rg[1].trim(), mehrdeutig: true };
  if (roh.includes("/")) return { pset: roh.split("/")[0].trim(), mehrdeutig: true };
  return { pset: roh, mehrdeutig: false };
}

/**
 * Variable-Sonderfall „Width / Thickness" (Stützen: RG Width, BG Thickness):
 * erster Name gewinnt, Rest als Warnung.
 * @param {string} variable
 * @returns {{name: string, mehrdeutig: boolean}}
 */
function variableNormiert(variable) {
  const roh = String(variable ?? "").trim();
  if (roh.includes("/")) return { name: roh.split("/")[0].trim(), mehrdeutig: true };
  return { name: roh, mehrdeutig: false };
}

/**
 * LOI-Blätter -> IDS-Spezifikationen (eine je Blatt) für idsWriter.schreibeIds.
 *
 * Regeln (Plan 71-01 <interfaces>):
 * - Entity-Facette: enumeration der UPPERCASE-Klassen aus Zeile 2 (D-P71-02).
 * - `automatisch`+GlobalId -> attribute-Facette GlobalId (Existenz, nie leer).
 * - BaseQuantities -> property-Facette propertySet „BaseQuantities",
 *   dataType aus Spalte J UPPERCASE.
 * - sonst property-Facette propertySet = Spalte H (RG-Teil bei Sonderfällen),
 *   baseName = Spalte I.
 * - Beispielwerte (Spalte G) werden KEINE Restriktionen; „true;false" bleibt
 *   beim dataType IFCBOOLEAN (Existenzprüfung genügt).
 * - Pflicht = „x" in der gewählten LPH-Spalte (Default 5, D-P71-03).
 * - nicht_pruefbar-Merkmale (Site/Building/Storey-Name) kommen in die
 *   Rückgabe-Liste, nicht in die Spezifikation.
 *
 * @param {{blaetter: Array}} loi - Ausgabe von parseLoiCsv
 * @param {{lph?: 2|3|5|8, blaetter?: string[], quelle?: string}} [opt] - lph Pflichtspalte,
 *   blaetter Filter auf Blattnamen (alle aktiven, wenn weggelassen), quelle
 *   Herkunftsangabe am Anfang jeder Spezifikationsbeschreibung (Default
 *   "LOI-Tabelle"). Projektbezogene Herkunft (Bauherr, Stand) gibt der Aufrufer
 *   mit — dieses Modul wird an Kunden ausgeliefert und nennt kein Projekt.
 * @returns {{spezifikationen: Array<object>, warnungen: string[],
 *   nichtPruefbar: Array<{blatt: string, merkmal: string, grund: string}>}}
 */
export function loiZuSpezifikationen(loi, opt = {}) {
  const lph = opt.lph ?? 5;
  const quelle = typeof opt.quelle === "string" && opt.quelle.trim() ? opt.quelle.trim() : "LOI-Tabelle";
  if (!(lph in LPH_SPALTEN)) throw new Error(`loiZuSpezifikationen: LPH ${lph} unbekannt (2|3|5|8)`);
  const filter = Array.isArray(opt.blaetter) && opt.blaetter.length
    ? new Set(opt.blaetter.map((s) => s.trim()))
    : null;

  /** @type {string[]} */
  const warnungen = [];
  /** @type {Array} */
  const nichtPruefbar = [];
  /** @type {Array} */
  const spezifikationen = [];

  for (const blatt of (loi?.blaetter) || []) {
    if (!blatt.aktiv) continue;                      // inactive-Blätter: keine Prüfung
    if (filter && !filter.has(blatt.name)) continue;
    if (!blatt.ifcTypen.length) {
      warnungen.push(`Blatt „${blatt.name}": keine IFC-Klassen in Zeile 2 — übersprungen`);
      continue;
    }

    const requirements = [];
    const gesehen = new Set(); // doppelte (pset, variable)-Paare nur einmal
    for (const m of blatt.merkmale) {
      if (m.quelle === "nicht_pruefbar") {
        nichtPruefbar.push({
          blatt: blatt.name, merkmal: m.merkmal,
          grund: m.pset.toLowerCase() === "automatisch"
            ? "räumliche Zuordnung (partOf) — von ids.js nicht ausgewertet"
            : "LOI-Platzhalter („zu definieren“/„tbd“) — kein prüfbarer Name",
        });
        continue;
      }
      if (!m.lph[lph]) continue;                     // Pflicht nur nach LPH-Spalte

      const { pset, mehrdeutig: psetMehrdeutig } = psetNormiert(m.pset);
      const { name: variable, mehrdeutig: varMehrdeutig } = variableNormiert(m.variable);
      if (psetMehrdeutig) {
        warnungen.push(`Blatt „${blatt.name}", Merkmal „${m.merkmal}": Pset-Angabe „${m.pset}" `
          + `mehrdeutig — RG-Teil „${pset}" verwendet (D-P71-10 Fachsicht TX/RG)`);
      }
      if (varMehrdeutig) {
        warnungen.push(`Blatt „${blatt.name}", Merkmal „${m.merkmal}": Variablen-Angabe „${m.variable}" `
          + `mehrdeutig — erster Name „${variable}" verwendet`);
      }
      const dedupe = `${m.quelle}|${pset}|${variable}`.toLowerCase();
      if (gesehen.has(dedupe)) continue;
      gesehen.add(dedupe);

      if (m.quelle === "attribut") {
        // Variable ist normalerweise „GlobalId"; bei den Datenlücken-Blättern
        // (Treppen, Treppenpodeste) steht dort „zu definieren" und die GUID im
        // Beispiel beweist die Absicht — Name dann fest „GlobalId" + Warnung.
        let attributName = variable;
        if (!m.variable || m.variable === "zu definieren") {
          attributName = "GlobalId";
          warnungen.push(`Blatt „${blatt.name}", Merkmal „${m.merkmal}": Ifc Variable fehlt `
            + "(„zu definieren“) — GUID-Beispielwert beweist GlobalId, als Attribut GlobalId geschrieben");
        }
        requirements.push({
          typ: "attribute",
          name: { art: "simple", wert: attributName },
          value: null,                                // Existenz + nicht-leer (ids.js:486-492)
          cardinality: "required",
        });
        continue;
      }
      // property (qto und pset): dataType aus Spalte J UPPERCASE. Die Prüfung
      // des Typs greift nur, wenn das Modell psetTypes liefert (ids.js:517) —
      // für Qto-Properties ist der IFC-Typ (IFCQUANTITYLENGTH) ohnehin kein
      // Property-Typ, also unschädlich; für Psets (IFCLABEL/IFCBOOLEAN) passt er.
      requirements.push({
        typ: "property",
        propertySet: { art: "simple", wert: pset },
        baseName: { art: "simple", wert: variable },
        value: null,                                  // Beispielwerte sind keine Wertelisten (D-P71-02)
        dataType: m.datentyp ? m.datentyp.toUpperCase() : null,
        cardinality: "required",
      });
    }

    spezifikationen.push({
      name: blatt.name,
      identifier: `LOI-${blatt.name.replace(/\s+/g, "_")}-LPH${lph}`,
      beschreibung: `${quelle}, Blatt „${blatt.name}", `
        + `Pflichtmerkmale LPH${lph}. Erzeugt mit tools/loi-zu-ids.mjs — nicht von Hand ändern.`,
      ifcVersions: ["IFC2X3", "IFC4"],
      kardinalitaet: "required",
      applicability: [{
        typ: "entity",
        // D-P71-02: enumeration UPPERCASE — ids.js normalisiert beim Vergleich
        // (matchIdsWertUppercase), die Form muss aber zur XSD passen.
        name: { art: "restriction", base: "xs:string",
          enumeration: blatt.ifcTypen.map((k) => k.toUpperCase()),
          pattern: null, patternQuelle: null, patternFehler: null, bounds: null, length: null },
        predefinedType: null,
      }],
      requirements,
    });
  }

  return { spezifikationen, warnungen, nichtPruefbar };
}
