// Ordnerstruktur je Projekt — reine Logik, ohne React und ohne Server.
//
// Entität `ProjectFolder`: { id, project_id, parent_id (null = Wurzel), name, created_date }
// Dateien sind `Document`-Datensätze mit optionalem `folder_id`.
//
// Warum es das gibt (26.08.2026): Der Reiter „Cloud-Daten" in BIT Aegis zeigte fünf
// hartkodierte Fantasie-Dateien und hatte gar keine Ordner — jeder Knopf war tot.

/** Vorlage für ein neues Projekt: die Ablage-Systematik des Büros. */
export const ORDNER_VORLAGE = [
  { name: "01_Grundlagen", kinder: ["Bestandsunterlagen", "Gutachten", "Vermessung"] },
  { name: "02_Planung", kinder: ["Entwurf", "Genehmigung", "Ausführung"] },
  // Fachplanung spiegelt die Reiter des Komplex-Designers — ein Brandschutzplan gehört
  // in „Brandschutz", ein Schallschutznachweis in „Schallschutz". Weisung 26.08.2026.
  // Fachplanung spiegelt die Reiter des Komplex-Designers — VOLLSTÄNDIG, nicht nur die
  // ausdrücklich genannten (Weisung 26.08.2026: „und die ich nicht genannt habe").
  { name: "03_Fachplanung", kinder: [
    "Statik", "Landschaft / Außenanlagen", "Haustechnik (TGA)", "Brandschutz",
    "ASR-Arbeitsstätten", "Barrierefreiheit", "Schallschutz", "Wärmebrücken",
    "Bauphysik", "Raumklima", "Klima-Analyse", "Energie", "Hochwasser",
    "Förderungen", "Wohnungsplaner", "Innenausbau", "Gelände & Baufeld",
  ] },
  { name: "04_Zeichnungen", kinder: ["Aktuell", "IFC", "DWG", "_Archiv"] },
  { name: "05_Ausschreibung", kinder: ["Leistungsverzeichnisse", "Vergabe", "Nachträge"] },
  { name: "06_Kosten", kinder: ["Kostenberechnung", "Kostenkontrolle"] },
  { name: "07_Berichtswesen", kinder: ["Protokolle", "Wochenstatus"] },
  { name: "08_Behörden", kinder: [] },
  { name: "09_Schriftverkehr", kinder: [] },
];

// EINZIGE QUELLE der Ablage-Regel (Weisung 26.08.2026: „das Prinzip der einzigen Quelle,
// damit keine Fehler entstehen"). Jeder Export — Plan-PDF, Fachplanung, Bericht, LV,
// IFC-Verweis — fragt HIER, wohin er gehört. Kein Aufrufer entscheidet das selbst, sonst
// driften Ablagen auseinander und dieselbe Sache liegt an drei Orten in drei Ständen.
//
// Schlüssel = `Document.type`. Neue Dokumentart? Genau hier eine Zeile ergänzen.
export const ZIELORDNER = {
  // Fachplanung — jede Disziplin in ihren eigenen Ordner
  "Brandschutz": ["03_Fachplanung", "Brandschutz"],
  "Schallschutz": ["03_Fachplanung", "Schallschutz"],
  "Statik": ["03_Fachplanung", "Statik"],
  "TGA": ["03_Fachplanung", "Haustechnik (TGA)"],
  "Haustechnik": ["03_Fachplanung", "Haustechnik (TGA)"],
  "Bauphysik": ["03_Fachplanung", "Bauphysik"],
  "Wärmebrücken": ["03_Fachplanung", "Wärmebrücken"],
  "Raumklima": ["03_Fachplanung", "Raumklima"],
  "Barrierefreiheit": ["03_Fachplanung", "Barrierefreiheit"],
  "Landschaft": ["03_Fachplanung", "Landschaft / Außenanlagen"],
  "Hochwasser": ["03_Fachplanung", "Hochwasser"],
  "Energie": ["03_Fachplanung", "Energie"],
  "ASR": ["03_Fachplanung", "ASR-Arbeitsstätten"],
  "ASR-Raumdatenblatt": ["03_Fachplanung", "ASR-Arbeitsstätten"],
  // Planung
  "Entwurf": ["02_Planung", "Entwurf"],
  "Genehmigung": ["02_Planung", "Genehmigung"],
  "Ausführungsplanung": ["02_Planung", "Ausführung"],
  // Zeichnungen & Modelle
  "Plan": ["04_Zeichnungen", "Aktuell"],
  "Plan-PDF": ["04_Zeichnungen", "Aktuell"],
  "IFC-Modell": ["04_Zeichnungen", "IFC"],
  "DWG": ["04_Zeichnungen", "DWG"],
  // Ausschreibung, Kosten, Berichte, Behörden
  "Leistungsverzeichnis": ["05_Ausschreibung", "Leistungsverzeichnisse"],
  "Ausschreibung": ["05_Ausschreibung", "Vergabe"],
  "Nachtrag": ["05_Ausschreibung", "Nachträge"],
  "Kostenberechnung": ["06_Kosten", "Kostenberechnung"],
  "Kostenkontrolle": ["06_Kosten", "Kostenkontrolle"],
  "Bericht": ["07_Berichtswesen", "Protokolle"],
  "Protokoll": ["07_Berichtswesen", "Protokolle"],
  "Wochenstatus": ["07_Berichtswesen", "Wochenstatus"],
  "Nachweis": ["01_Grundlagen", "Gutachten"],
  "Gutachten": ["01_Grundlagen", "Gutachten"],
  "Behörde": ["08_Behörden"],
  "Schriftverkehr": ["09_Schriftverkehr"],
};

// Zweiter Zugang zur selben Regel: der Reiter-Schlüssel des Komplex-Designers.
// Ein Export dort muss nur wissen, WO er läuft — nicht, wie das Büro ablegt.
// Vollständig über alle 29 Reiter (Stand 26.08.2026); `null` heißt bewusst
// „erzeugt keine ablagefähigen Dokumente".
export const REITER_ZU_ORDNER = {
  site: ["01_Grundlagen", "Vermessung"],
  studio: ["02_Planung", "Entwurf"],
  program: ["02_Planung", "Entwurf"],
  compliance: ["02_Planung", "Genehmigung"],
  massing: ["03_Fachplanung", "Gelände & Baufeld"],
  terrain: ["03_Fachplanung", "Gelände & Baufeld"],
  bim: ["04_Zeichnungen", "Aktuell"],
  buildings: ["02_Planung", "Entwurf"],
  statics: ["03_Fachplanung", "Statik"],
  landscape: ["03_Fachplanung", "Landschaft / Außenanlagen"],
  haustechnik: ["03_Fachplanung", "Haustechnik (TGA)"],
  brandschutz: ["03_Fachplanung", "Brandschutz"],
  asr: ["03_Fachplanung", "ASR-Arbeitsstätten"],
  barrierefreiheit: ["03_Fachplanung", "Barrierefreiheit"],
  acoustics: ["03_Fachplanung", "Schallschutz"],
  waermebruecken: ["03_Fachplanung", "Wärmebrücken"],
  bauphysik: ["03_Fachplanung", "Bauphysik"],
  raumklima: ["03_Fachplanung", "Raumklima"],
  funding: ["03_Fachplanung", "Förderungen"],
  apartments: ["03_Fachplanung", "Wohnungsplaner"],
  interiors: ["03_Fachplanung", "Innenausbau"],
  analysis: ["03_Fachplanung", "Klima-Analyse"],
  generative: ["02_Planung", "Entwurf"],
  energy: ["03_Fachplanung", "Energie"],
  costs: ["06_Kosten", "Kostenberechnung"],
  flood_risk: ["03_Fachplanung", "Hochwasser"],
  planner: ["07_Berichtswesen", "Wochenstatus"],
  integrations: null,
  support: null,
};

/**
 * Wohin gehört ein Dokument dieses Typs? — die einzige Antwort im System.
 * @returns {Array<string>} Ordnerpfad; leer = Projektwurzel (Typ nicht in der Regel)
 */
export const zielPfadFuer = (typ) => ZIELORDNER[String(typ ?? "").trim()] || [];

/**
 * Wohin gehört ein Export aus diesem Designer-Reiter?
 * @returns {Array<string>} Ordnerpfad; leer = Projektwurzel oder Reiter ohne Ablage
 */
export const zielPfadFuerReiter = (reiter) => REITER_ZU_ORDNER[String(reiter ?? "").trim()] || [];

/**
 * Ordnerpfad auflösen und fehlende Ebenen anlegen — damit ein Export nie ins Leere
 * läuft, nur weil der Ordner noch nicht existiert.
 *
 * @param {Array<object>} ordner vorhandene ProjectFolder-Datensätze des Projekts
 * @param {Array<string>} pfad z. B. ["03_Fachplanung", "Brandschutz"]
 * @param {(daten:{parent_id:string|null,name:string})=>Promise<object>} anlegen legt EINEN Ordner an
 * @returns {Promise<{id: string|null, angelegt: Array<string>}>}
 */
export async function findeOderLegeAn(ordner, pfad, anlegen) {
  let elternId = null;
  const angelegt = [];
  const bestand = [...(ordner || [])];
  for (const name of pfad || []) {
    const treffer = bestand.find(
      (o) => (o.parent_id ?? null) === elternId
        && String(o.name).trim().toLowerCase() === String(name).trim().toLowerCase(),
    );
    if (treffer) { elternId = treffer.id; continue; }
    const neu = await anlegen({ parent_id: elternId, name });
    bestand.push(neu);
    angelegt.push(name);
    elternId = neu.id;
  }
  return { id: elternId, angelegt };
}

const norm = (s) => String(s ?? "").trim();

/**
 * Flache Ordnerliste zu einem Baum verknüpfen.
 * Waisen (parent_id zeigt ins Leere) hängen an der Wurzel, statt zu verschwinden —
 * lieber sichtbar falsch einsortiert als unauffindbar.
 * @param {Array<object>} ordner
 * @returns {Array<object>} Wurzelknoten mit `kinder`
 */
export function baueBaum(ordner = []) {
  const knoten = new Map();
  for (const o of ordner) knoten.set(o.id, { ...o, kinder: [] });
  const wurzel = [];
  for (const k of knoten.values()) {
    const eltern = k.parent_id ? knoten.get(k.parent_id) : null;
    if (eltern) eltern.kinder.push(k);
    else wurzel.push(k);
  }
  const sortiere = (liste) => {
    liste.sort((a, b) => norm(a.name).localeCompare(norm(b.name), "de", { numeric: true }));
    for (const k of liste) sortiere(k.kinder);
  };
  sortiere(wurzel);
  return wurzel;
}

/**
 * Pfad von der Wurzel bis zum Ordner (für die Brotkrumen-Navigation).
 * @returns {Array<object>} leer, wenn die id unbekannt ist
 */
export function pfadZu(ordner = [], id) {
  const nachId = new Map(ordner.map((o) => [o.id, o]));
  const pfad = [];
  let cur = nachId.get(id);
  const gesehen = new Set();
  while (cur && !gesehen.has(cur.id)) {
    gesehen.add(cur.id); // Zyklusschutz — ein defekter parent_id-Ring darf nicht hängen
    pfad.unshift(cur);
    cur = cur.parent_id ? nachId.get(cur.parent_id) : null;
  }
  return pfad;
}

/** Direkte Unterordner eines Ordners (null = Wurzelebene). */
export const kinderVon = (ordner = [], parentId = null) =>
  ordner
    .filter((o) => (o.parent_id ?? null) === (parentId ?? null))
    .sort((a, b) => norm(a.name).localeCompare(norm(b.name), "de", { numeric: true }));

/** Dateien in einem Ordner (null = Ablage ohne Ordner). */
export const dateienIn = (dokumente = [], folderId = null) =>
  dokumente
    .filter((d) => (d.folder_id ?? null) === (folderId ?? null))
    .sort((a, b) => norm(a.name).localeCompare(norm(b.name), "de", { numeric: true }));

/**
 * Alle Nachfahren eines Ordners — für das Löschen und für Bestandszähler.
 * @returns {Array<string>} ids der Nachfahren (ohne den Ordner selbst)
 */
export function nachfahren(ordner = [], id) {
  const kinderNachEltern = new Map();
  for (const o of ordner) {
    const p = o.parent_id ?? null;
    if (!kinderNachEltern.has(p)) kinderNachEltern.set(p, []);
    kinderNachEltern.get(p).push(o.id);
  }
  const out = [];
  const stapel = [...(kinderNachEltern.get(id) || [])];
  const gesehen = new Set();
  while (stapel.length) {
    const k = stapel.pop();
    if (gesehen.has(k)) continue;
    gesehen.add(k);
    out.push(k);
    stapel.push(...(kinderNachEltern.get(k) || []));
  }
  return out;
}

/**
 * Prüft einen Ordnernamen gegen die Geschwister.
 * @returns {string|null} Fehlertext oder null, wenn in Ordnung
 */
export function pruefeName(name, geschwister = []) {
  const n = norm(name);
  if (!n) return "Der Ordnername darf nicht leer sein.";
  if (n.length > 80) return "Der Ordnername ist zu lang (max. 80 Zeichen).";
  if (/[/\\]/.test(n)) return "Schrägstriche sind im Ordnernamen nicht erlaubt.";
  if (geschwister.some((g) => norm(g.name).toLowerCase() === n.toLowerCase())) {
    return `„${n}" existiert auf dieser Ebene bereits.`;
  }
  return null;
}
