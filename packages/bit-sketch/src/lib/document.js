// Parametrisches Dokumentmodell nach FreeCAD-Vorbild (App::Document / DocumentObject).
//
// Nachgebaut sind die vier Kernideen aus FreeCADs src/App:
//   1. Ein Document ist ein Container benannter Objekte; alles Zustandsbehaftete
//      ist eine Property am Objekt.
//   2. Abhängigkeiten werden NICHT separat deklariert — sie ergeben sich aus
//      Link-Properties (outList = alle referenzierten Objekt-IDs). Der DAG ist
//      damit immer konsistent mit den Daten.
//   3. touch()/recompute(): Eine Property-Änderung markiert nur (touch);
//      Document.recompute() sammelt Touched + transitiv alle Abhängigen,
//      sortiert topologisch (Kahn) und ruft execute() in Reihenfolge.
//   4. Fehler bleiben als Status am Objekt (error) und überspringen die
//      Abhängigen-Kette — statt mit veralteter Eingabegeometrie weiterzurechnen.
//
// Bewusst NICHT nachgebaut (Begründung in .planning/ROADMAP.md Phase 34ff):
// FreeCADs GeoId-Array-Indizes (Topological-Naming-Fehlerklasse — hier sind alle
// Referenzen stabile String-IDs, nie recycelt), Undo-Transaktionen (Snapshots
// über serialize() sind im Web einfacher), Expressions-Engine.
//
// PURE: kein DOM, kein Browser, kein WASM — voll unter `node --test` testbar.

/** Fortlaufende, nie recycelte IDs (dokumentweit). */
let idCounter = 0;
export function nextId(prefix = "o") {
  idCounter += 1;
  return `${prefix}${idCounter}`;
}
/** Nur für Tests/Deserialisierung: Zähler vorsetzen, damit IDs eindeutig bleiben. */
export function bumpIdCounter(min) {
  if (min > idCounter) idCounter = min;
}

export class DocumentObject {
  /**
   * @param {string} id stabile ID (nextId())
   * @param {string} type Objekttyp (z.B. "sketch", "param")
   */
  constructor(id, type) {
    this.id = id;
    this.type = type;
    this.label = id;
    this.touched = true; // neu = touched (FreeCAD: StatusBits::New + Touch)
    this.error = null; // string | null
  }

  /** Ausgehende DAG-Kanten = IDs aller referenzierten Objekte (Link-Properties). */
  getOutList() {
    return [];
  }

  touch() {
    this.touched = true;
  }

  /**
   * Neuberechnung des Objekts. Wirft bei Fehler — Document.recompute() fängt
   * und setzt this.error. `_doc` liefert Zugriff auf verlinkte Objekte.
   * @param {Document} _doc
   */
  execute(_doc) {}
}

export class Document {
  constructor() {
    /** @type {Map<string, DocumentObject>} */
    this.objects = new Map();
  }

  /** @param {DocumentObject} obj */
  add(obj) {
    if (this.objects.has(obj.id)) throw new Error(`Objekt-ID doppelt: ${obj.id}`);
    // Zykluscheck VOR dem Einfügen (FreeCAD verbietet zyklische Links beim Setzen).
    this.objects.set(obj.id, obj);
    if (this.#hasCycle()) {
      this.objects.delete(obj.id);
      throw new Error(`Objekt ${obj.id} würde einen Abhängigkeits-Zyklus erzeugen`);
    }
    return obj;
  }

  remove(id) {
    // FreeCAD toucht beim Entfernen die InList: Abhängige laufen beim nächsten
    // recompute() gegen die fehlende Referenz und landen im Fehlerstatus,
    // statt still mit veraltetem Ergebnis weiterzuleben.
    for (const depId of this.getInList(id)) this.objects.get(depId)?.touch();
    return this.objects.delete(id);
  }

  get(id) {
    return this.objects.get(id) ?? null;
  }

  /** Eingehende Kanten: wer hängt von `id` ab. */
  getInList(id) {
    const result = [];
    for (const o of this.objects.values()) {
      if (o.getOutList().includes(id)) result.push(o.id);
    }
    return result;
  }

  /**
   * FreeCAD-Recompute: touched + transitiv Abhängige einsammeln, topologisch
   * sortieren, in Reihenfolge execute(); Fehler überspringen die Kette.
   * @returns {{ executed: string[], errors: Map<string, string> }}
   */
  recompute() {
    // 1) Dirty-Menge: alle touched plus (transitiv) alles, was von ihnen abhängt.
    const dirty = new Set();
    const stack = [...this.objects.values()].filter((o) => o.touched).map((o) => o.id);
    while (stack.length) {
      const id = stack.pop();
      if (dirty.has(id)) continue;
      dirty.add(id);
      stack.push(...this.getInList(id));
    }

    // 2) Kahn-Toposort NUR über den dirty-Teilgraphen (Kanten: Abhängigkeit → Abhängiger).
    const order = this.#topoSort(dirty);

    // 3) Ausführen; Fehler markieren und Abhängige der Fehlerquelle überspringen.
    const errors = new Map();
    const failed = new Set();
    const executed = [];
    for (const id of order) {
      const o = this.objects.get(id);
      if (o.getOutList().some((dep) => failed.has(dep))) {
        failed.add(id);
        o.error = "übersprungen: Abhängigkeit fehlgeschlagen";
        errors.set(id, o.error);
        continue;
      }
      try {
        o.execute(this);
        o.error = null;
        o.touched = false;
        executed.push(id);
      } catch (e) {
        o.error = e instanceof Error ? e.message : String(e);
        errors.set(id, o.error);
        failed.add(id);
      }
    }
    return { executed, errors };
  }

  /** @param {Set<string>} subset */
  #topoSort(subset) {
    // Eingangsgrad nur über Kanten innerhalb des Subsets zählen.
    const indeg = new Map();
    for (const id of subset) indeg.set(id, 0);
    for (const id of subset) {
      const o = this.objects.get(id);
      for (const dep of o.getOutList()) {
        if (subset.has(dep)) indeg.set(id, indeg.get(id) + 1);
      }
    }
    const queue = [...indeg.entries()].filter(([, d]) => d === 0).map(([id]) => id);
    const order = [];
    while (queue.length) {
      const id = queue.shift();
      order.push(id);
      for (const dependent of this.getInList(id)) {
        if (!subset.has(dependent)) continue;
        const d = indeg.get(dependent) - 1;
        indeg.set(dependent, d);
        if (d === 0) queue.push(dependent);
      }
    }
    if (order.length !== subset.size) {
      throw new Error("Abhängigkeits-Zyklus beim Recompute entdeckt");
    }
    return order;
  }

  #hasCycle() {
    try {
      this.#topoSort(new Set(this.objects.keys()));
      return false;
    } catch {
      return true;
    }
  }
}
