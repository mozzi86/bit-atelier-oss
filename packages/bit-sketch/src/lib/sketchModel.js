// Sketch-Modell nach FreeCAD-Sketcher-Vorbild (SketchObject: Geometrie + Constraints),
// gemappt auf den planegcs-Solver (FreeCADs GCS als WASM, @salusoft89/planegcs).
//
// Abweichung von FreeCAD mit Absicht: Referenzen sind stabile String-IDs statt
// GeoId-Array-Indizes (FreeCAD remappt Indizes beim Löschen — die Wurzel der
// Topological-Naming-Fehlerklasse). Punkte sind eigenständige Entities; eine
// Linie referenziert ihre Endpunkte per ID (das ist zugleich das planegcs-Format).
//
// PURE: kein DOM, kein Browser, kein WASM-Import. Das Solver-Mapping erzeugt
// nur Daten (buildSolverInput) bzw. konsumiert Ergebnisse (applySolution) —
// der GcsWrapper wird in solveCore.js per Dependency-Injection hereingereicht.

import { DocumentObject, nextId, bumpIdCounter } from "./document.js";

// planegcs-Enums als lokale Konstanten (Werte aus dist/planegcs_dist/enums.d.ts),
// damit die pure Lib keinen planegcs-Import braucht.
export const ALGORITHM = { BFGS: 0, LevenbergMarquardt: 1, DogLeg: 2 };
export const SOLVE_STATUS = { 0: "success", 1: "converged", 2: "failed", 3: "invalid" };

/** Constraint-Typen des Modells → Anzeige-Glyphe (UI) */
export const CONSTRAINT_GLYPHS = {
  coincident: "◉",
  horizontal: "—",
  vertical: "|",
  parallel: "∥",
  perpendicular: "⊥",
  distance: "↔",
  pointOnLine: "⊙",
  radius: "◯",
  angle: "∠",
  lock: "🔒",
};

export class Sketch {
  constructor() {
    /** @type {Map<string, {id:string,type:'point',x:number,y:number,fixed:boolean,construction:boolean}>} */
    this.points = new Map();
    /** @type {Map<string, {id:string,type:'line',p1:string,p2:string,construction:boolean}>} */
    this.lines = new Map();
    /** @type {Map<string, {id:string,type:'circle',center:string,radius:number,construction:boolean}>} */
    this.circles = new Map();
    /** @type {Map<string, object>} Constraints (siehe addConstraint) */
    this.constraints = new Map();
    /** @type {Map<string, number>} benannte Parameter (planegcs SketchParam) */
    this.params = new Map();
  }

  // ---------- Geometrie ----------

  addPoint(x, y, { fixed = false, construction = false, id = nextId("p") } = {}) {
    const p = { id, type: "point", x, y, fixed, construction };
    this.points.set(id, p);
    return p;
  }

  addLine(p1, p2, { construction = false, id = nextId("l") } = {}) {
    if (!this.points.has(p1) || !this.points.has(p2)) {
      throw new Error(`Linie ${id}: Endpunkt fehlt (${p1}, ${p2})`);
    }
    if (p1 === p2) throw new Error(`Linie ${id}: identische Endpunkte`);
    const l = { id, type: "line", p1, p2, construction };
    this.lines.set(id, l);
    return l;
  }

  /** Komfort: Linie mit zwei neuen Punkten. */
  addLineByCoords(x1, y1, x2, y2, opts = {}) {
    const a = this.addPoint(x1, y1, opts);
    const b = this.addPoint(x2, y2, opts);
    return { line: this.addLine(a.id, b.id, opts), a, b };
  }

  addCircle(center, radius, { construction = false, id = nextId("c") } = {}) {
    if (!this.points.has(center)) throw new Error(`Kreis ${id}: Mittelpunkt fehlt (${center})`);
    if (!(radius > 0)) throw new Error(`Kreis ${id}: Radius muss > 0 sein`);
    const c = { id, type: "circle", center, radius, construction };
    this.circles.set(id, c);
    return c;
  }

  getGeometry(id) {
    return this.points.get(id) ?? this.lines.get(id) ?? this.circles.get(id) ?? null;
  }

  // ---------- Constraints ----------

  /**
   * @param {object} c typisiert:
   *  {type:'coincident', a, b}            a/b = Punkt-IDs
   *  {type:'horizontal'|'vertical', line} Linien-ID
   *  {type:'parallel'|'perpendicular', a, b} Linien-IDs
   *  {type:'distance', a, b, value}       Punkt-IDs, Meter
   *  {type:'pointOnLine', point, line}
   *  {type:'radius', circle, value}
   *  {type:'angle', a, b, value}          Linien-IDs, Radiant
   *  {type:'lock', point}                 friert aktuelle Koordinaten ein
   *  value darf auch ein Parametername (string) sein → setParam().
   *  driving=false macht Maß-Constraints zu reinen Mess-/Referenzmaßen.
   */
  addConstraint(c) {
    const id = c.id ?? nextId("k");
    const full = { driving: true, ...c, id };
    for (const ref of constraintRefs(full)) {
      if (!this.getGeometry(ref)) throw new Error(`Constraint ${id} (${full.type}): Referenz ${ref} fehlt`);
    }
    if (typeof full.value === "string" && !this.params.has(full.value)) {
      throw new Error(`Constraint ${id}: Parameter "${full.value}" nicht definiert`);
    }
    // Wertebereich: der Solver akzeptiert radius<=0 klaglos und schreibt ihn
    // zurück (Kreis unsichtbar, per localStorage dauerhaft) — hier abfangen.
    if (typeof full.value === "number") {
      if (!Number.isFinite(full.value)) throw new Error(`Constraint ${id}: Wert ist keine Zahl`);
      if ((full.type === "radius" || full.type === "distance") && full.value <= 0) {
        throw new Error(`Constraint ${id} (${full.type}): Wert muss > 0 sein`);
      }
    }
    if (full.type === "lock") {
      // Koordinaten beim Anlegen einfrieren — sonst wandert der Anker mit
      // jedem Solve und das Ziehen des gesperrten Punkts erzeugt Konflikte.
      const p = this.points.get(full.point);
      full.x = full.x ?? p.x;
      full.y = full.y ?? p.y;
    }
    this.constraints.set(id, full);
    return full;
  }

  setParam(name, value) {
    this.params.set(name, value);
  }

  /** Alle Constraints, die eine Geometrie-ID referenzieren. */
  constraintsReferencing(geoId) {
    return [...this.constraints.values()].filter((c) => constraintRefs(c).includes(geoId));
  }

  /**
   * Löscht Geometrie samt abhängiger Constraints (nie Index-Remapping — IDs
   * bleiben stabil). Linien/Kreise nehmen verwaiste eigene Punkte mit.
   */
  deleteGeometry(id) {
    const deleted = new Set();
    const dropConstraintsFor = (gid) => {
      for (const c of this.constraintsReferencing(gid)) this.constraints.delete(c.id);
    };
    const isPointReferenced = (pid) =>
      [...this.lines.values()].some((l) => l.p1 === pid || l.p2 === pid) ||
      [...this.circles.values()].some((c) => c.center === pid);

    if (this.points.has(id)) {
      // Punkt löschen zieht referenzierende Linien/Kreise mit (FreeCAD löscht analog die Geometrie).
      for (const l of [...this.lines.values()]) {
        if (l.p1 === id || l.p2 === id) deleted.add(this.#deleteLine(l.id));
      }
      for (const c of [...this.circles.values()]) {
        if (c.center === id) {
          dropConstraintsFor(c.id);
          this.circles.delete(c.id);
          deleted.add(c.id);
        }
      }
      dropConstraintsFor(id);
      this.points.delete(id);
      deleted.add(id);
    } else if (this.lines.has(id)) {
      deleted.add(this.#deleteLine(id)); // räumt verwaiste Endpunkte selbst auf
    } else if (this.circles.has(id)) {
      const c = this.circles.get(id);
      dropConstraintsFor(id);
      this.circles.delete(id);
      deleted.add(id);
      if (!isPointReferenced(c.center) && this.constraintsReferencing(c.center).length === 0) {
        this.points.delete(c.center);
        deleted.add(c.center);
      }
    } else if (this.constraints.has(id)) {
      this.constraints.delete(id);
      deleted.add(id);
    }
    return [...deleted];
  }

  #deleteLine(id) {
    const l = this.lines.get(id);
    for (const c of this.constraintsReferencing(id)) this.constraints.delete(c.id);
    this.lines.delete(id);
    for (const pid of [l.p1, l.p2]) {
      const referenced =
        [...this.lines.values()].some((x) => x.p1 === pid || x.p2 === pid) ||
        [...this.circles.values()].some((x) => x.center === pid);
      if (!referenced && this.constraintsReferencing(pid).length === 0) this.points.delete(pid);
    }
    return id;
  }

  // ---------- Serialisierung ----------

  serialize() {
    return {
      points: [...this.points.values()],
      lines: [...this.lines.values()],
      circles: [...this.circles.values()],
      constraints: [...this.constraints.values()],
      params: [...this.params.entries()],
    };
  }

  static deserialize(data) {
    const s = new Sketch();
    for (const [name, value] of data.params ?? []) s.params.set(name, value);
    for (const p of data.points ?? []) s.points.set(p.id, { ...p });
    // Härtung gegen korrupten localStorage: Einträge mit toten Referenzen
    // überspringen statt später beim Solve/Render zu crashen.
    for (const l of data.lines ?? []) {
      if (s.points.has(l.p1) && s.points.has(l.p2)) s.lines.set(l.id, { ...l });
    }
    for (const c of data.circles ?? []) {
      if (s.points.has(c.center) && c.radius > 0) s.circles.set(c.id, { ...c });
    }
    for (const k of data.constraints ?? []) {
      try {
        const refsOk = constraintRefs(k).every((ref) => s.points.has(ref) || s.lines.has(ref) || s.circles.has(ref));
        const paramOk = typeof k.value !== "string" || s.params.has(k.value);
        if (refsOk && paramOk) s.constraints.set(k.id, { ...k });
      } catch {
        /* unbekannter Typ → überspringen */
      }
    }
    // ID-Zähler vorsetzen, damit nextId() nach einem Reload nie mit
    // geladenen IDs kollidiert (IDs werden NIE recycelt — siehe document.js).
    for (const id of [...s.points.keys(), ...s.lines.keys(), ...s.circles.keys(), ...s.constraints.keys()]) {
      const n = /(\d+)$/.exec(id);
      if (n) bumpIdCounter(Number(n[1]));
    }
    return s;
  }
}

/** Geometrie-IDs, die ein Constraint referenziert. */
export function constraintRefs(c) {
  switch (c.type) {
    case "coincident":
    case "parallel":
    case "perpendicular":
    case "distance":
    case "angle":
      return [c.a, c.b];
    case "horizontal":
    case "vertical":
      return [c.line];
    case "pointOnLine":
      return [c.point, c.line];
    case "radius":
      return [c.circle];
    case "lock":
      return [c.point];
    default:
      throw new Error(`Unbekannter Constraint-Typ: ${c.type}`);
  }
}

// ---------- Mapping Modell → planegcs ----------

/**
 * Erzeugt die planegcs-Primitive-Liste. Reihenfolge-Regel des Solvers:
 * referenzierte Objekte müssen VOR dem referenzierenden Objekt gepusht werden
 * (Params → Punkte → Linien/Kreise → Constraints).
 *
 * Ein Modell-Constraint kann mehrere Solver-Constraints erzeugen (lock, drag);
 * deren IDs bekommen ein "@"-Suffix. solverIdToModelId() mappt zurück.
 *
 * @param {Sketch} sketch
 * @param {Array<object>} extraConstraints z.B. Drag: {type:'drag', point, x, y}
 */
export function buildSolverInput(sketch, extraConstraints = []) {
  const prims = [];
  for (const [name, value] of sketch.params) prims.push({ type: "param", name, value });
  for (const p of sketch.points.values()) {
    prims.push({ id: p.id, type: "point", x: p.x, y: p.y, fixed: p.fixed });
  }
  for (const l of sketch.lines.values()) {
    prims.push({ id: l.id, type: "line", p1_id: l.p1, p2_id: l.p2 });
  }
  for (const c of sketch.circles.values()) {
    prims.push({ id: c.id, type: "circle", c_id: c.center, radius: c.radius });
  }
  for (const c of sketch.constraints.values()) {
    prims.push(...mapConstraint(c, sketch));
  }
  for (const c of extraConstraints) {
    if (c.type === "drag") {
      // FreeCAD-Drag-Muster: temporäre Koordinaten-Constraints; planegcs
      // schaltet bei temporary:true intern auf den Drag-tauglichen Modus um.
      prims.push({ id: `${c.point}@dragx`, type: "coordinate_x", p_id: c.point, x: c.x, temporary: true });
      prims.push({ id: `${c.point}@dragy`, type: "coordinate_y", p_id: c.point, y: c.y, temporary: true });
    } else {
      prims.push(...mapConstraint({ driving: true, ...c }, sketch));
    }
  }
  return prims;
}

function mapConstraint(c, sketch) {
  const d = { driving: c.driving !== false };
  switch (c.type) {
    case "coincident":
      return [{ id: c.id, type: "p2p_coincident", p1_id: c.a, p2_id: c.b }];
    case "horizontal":
      return [{ id: c.id, type: "horizontal_l", l_id: c.line }];
    case "vertical":
      return [{ id: c.id, type: "vertical_l", l_id: c.line }];
    case "parallel":
      return [{ id: c.id, type: "parallel", l1_id: c.a, l2_id: c.b }];
    case "perpendicular":
      return [{ id: c.id, type: "perpendicular_ll", l1_id: c.a, l2_id: c.b }];
    case "distance":
      return [{ id: c.id, type: "p2p_distance", p1_id: c.a, p2_id: c.b, distance: c.value, ...d }];
    case "pointOnLine":
      return [{ id: c.id, type: "point_on_line_pl", p_id: c.point, l_id: c.line }];
    case "radius":
      return [{ id: c.id, type: "circle_radius", c_id: c.circle, radius: c.value, ...d }];
    case "angle":
      return [{ id: c.id, type: "l2l_angle_ll", l1_id: c.a, l2_id: c.b, angle: c.value, ...d }];
    case "lock": {
      // eingefrorene Anlege-Koordinaten bevorzugen (addConstraint setzt c.x/c.y);
      // Fallback auf live nur für direkt konstruierte Alt-Daten
      const p = sketch.points.get(c.point);
      return [
        { id: `${c.id}@x`, type: "coordinate_x", p_id: c.point, x: c.x ?? p.x },
        { id: `${c.id}@y`, type: "coordinate_y", p_id: c.point, y: c.y ?? p.y },
      ];
    }
    default:
      throw new Error(`Unbekannter Constraint-Typ: ${c.type}`);
  }
}

/** Solver-Constraint-ID → Modell-Constraint-ID ("k3@x" → "k3"). */
export function solverIdToModelId(solverId) {
  const at = solverId.indexOf("@");
  return at === -1 ? solverId : solverId.slice(0, at);
}

/**
 * Gelöste Koordinaten aus dem Solver-Index zurück ins Modell schreiben.
 * @param {Sketch} sketch
 * @param {{get_sketch_point: (id:string)=>{x:number,y:number}, get_sketch_circle: (id:string)=>{radius:number}}} index
 */
export function applySolution(sketch, index) {
  for (const p of sketch.points.values()) {
    const solved = index.get_sketch_point(p.id);
    p.x = solved.x;
    p.y = solved.y;
  }
  for (const c of sketch.circles.values()) {
    c.radius = index.get_sketch_circle(c.id).radius;
  }
}

// ---------- Dokument-Integration (FreeCAD: Sketcher::SketchObject) ----------

export class SketchObject extends DocumentObject {
  constructor(id = nextId("sk")) {
    super(id, "sketch");
    this.sketch = new Sketch();
    /** @type {{status:number,statusName:string,dof:number,conflicting:string[],redundant:string[],applied:boolean}|null} */
    this.lastSolve = null;
    /** per Dependency-Injection gesetzter Solver-Runner: (sketch) => SolveResult */
    this.solverRun = null;
  }

  execute() {
    if (!this.solverRun) return; // ohne Solver (z.B. Server-seitig) bleibt das Modell wie es ist
    this.lastSolve = this.solverRun(this.sketch);
    if (this.lastSolve.conflicting.length) {
      throw new Error(`Sketch überbestimmt: Constraints ${this.lastSolve.conflicting.join(", ")}`);
    }
    if (this.lastSolve.statusName === "failed") {
      throw new Error("Sketch-Solve nicht konvergiert");
    }
  }
}
