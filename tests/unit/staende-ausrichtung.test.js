// Unit tests Stände core, step 3: alignment (staende/ausrichtung.js). Simple coordinates,
// artificial texts ("Text A" …), hand-computed expectations.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  TRANSFORM_EINS, ausrichtungOffen, transformAnwenden, transformUmkehren, transformVerketten,
  textSchluessel, autoAusrichtung, passpunktAusrichtung, nachschiebSchritt, nachschieben, MELDUNG_ZU_WENIGE_TEXTE,
} from "@core/lib/staende/ausrichtung.js";

const nah = (/** @type {number} */ a, /** @type {number} */ b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≠ ${b}`);
const nahPkt = (/** @type {{x:number,y:number}} */ p, /** @type {number} */ x, /** @type {number} */ y, eps = 1e-9) => { nah(p.x, x, eps); nah(p.y, y, eps); };

describe("Transformation", () => {
  const t = { dx: 10, dy: -5, drehung: Math.PI / 2, massstab: 2 };

  it("anwenden: (1,0) → 2·R90°·(1,0) + (10,−5) = (10,−3)", () => {
    nahPkt(transformAnwenden(t, { x: 1, y: 0 }), 10, -3);
    assert.deepEqual(transformAnwenden(TRANSFORM_EINS, { x: 3, y: 4 }), { x: 3, y: 4 });
  });

  it("umkehren: Hin und zurück ergibt den Ausgangspunkt", () => {
    const u = transformUmkehren(t);
    for (const p of [{ x: 0, y: 0 }, { x: 1, y: 2 }, { x: -7, y: 3.5 }]) {
      const q = transformAnwenden(u, transformAnwenden(t, p));
      nahPkt(q, p.x, p.y);
    }
    nah(u.massstab, 0.5); nah(u.drehung, -Math.PI / 2);
  });

  it("verketten: erst a, dann b = b(a(p))", () => {
    const b = { dx: 1, dy: 1, drehung: -Math.PI / 4, massstab: 0.5 };
    const k = transformVerketten(t, b);
    for (const p of [{ x: 0, y: 0 }, { x: 2, y: -1 }]) {
      const soll = transformAnwenden(b, transformAnwenden(t, p));
      nahPkt(transformAnwenden(k, p), soll.x, soll.y);
    }
    // with the inverse: identity
    const e = transformVerketten(t, transformUmkehren(t));
    nah(e.dx, 0); nah(e.dy, 0); nah(e.drehung, 0); nah(e.massstab, 1);
  });

  it("offen = Identität, Art 'offen'", () => {
    assert.deepEqual(ausrichtungOffen(), { art: "offen", transform: { dx: 0, dy: 0, drehung: 0, massstab: 1 } });
  });
});

describe("textSchluessel", () => {
  it("klein, Leerraum vereinheitlicht; zu lang, leer und kurze reine Zahlen fallen weg", () => {
    assert.equal(textSchluessel("  Text   A\n"), "text a");
    assert.equal(textSchluessel(""), null);
    assert.equal(textSchluessel("x".repeat(61)), null);
    assert.equal(textSchluessel("x".repeat(60)), "x".repeat(60));
    assert.equal(textSchluessel("12"), null);
    assert.equal(textSchluessel("2,51"), null);
    assert.equal(textSchluessel("12345"), "12345"); // longer numbers stay (e.g. object numbers)
    assert.equal(textSchluessel("R 12"), "r 12");
  });
});

describe("autoAusrichtung — über gemeinsame Texte", () => {
  const ref = [
    { text: "Text A", x: 0, y: 0 }, { text: "Text B", x: 10, y: 0 }, { text: "Text C", x: 0, y: 8 },
    { text: "Text D", x: 5, y: 5 }, { text: "Text E", x: 2, y: 9 },
  ];
  /** state = reference shifted by (−100, −50) */
  const stand = ref.map((t) => ({ ...t, x: t.x - 100, y: t.y - 50 }));

  it("reine Verschiebung wird gefunden, alle Texte treffen, sicher", () => {
    const r = autoAusrichtung(stand, ref);
    assert.equal(r.ok, true);
    assert.equal(r.art, "auto");
    nah(r.transform.dx, 100); nah(r.transform.dy, 50);
    assert.equal(r.transform.drehung, 0); assert.equal(r.transform.massstab, 1);
    assert.equal(r.gemeinsam, 5); assert.equal(r.treffer, 5); assert.equal(r.sicher, true);
  });

  it("Ausreißer (verschobener Text) zählt nicht; Mittelwert der nahen Verschiebungen (±2 cm)", () => {
    const s = stand.map((t, i) => (i === 3 ? { ...t, x: t.x + 7 } : i === 1 ? { ...t, x: t.x + 0.02 } : t));
    const r = autoAusrichtung(s, ref);
    assert.equal(r.treffer, 4);
    nah(r.transform.dx, 100 - 0.02 / 4, 1e-12);
    nah(r.transform.dy, 50);
  });

  it("nur Texte, die in BEIDEN Ständen genau einmal vorkommen", () => {
    const s = [...stand, { text: "Text A", x: 0, y: 0 }]; // "Text A" twice in the state → out
    const r = autoAusrichtung(s, [...ref, { text: "nur hier", x: 1, y: 1 }]);
    assert.equal(r.gemeinsam, 4);
  });

  it("Groß-/Kleinschreibung und Leerraum egal", () => {
    const s = stand.map((t) => ({ ...t, text: `  ${t.text.toUpperCase()} ` }));
    assert.equal(autoAusrichtung(s, ref).gemeinsam, 5);
  });

  it("unter 3 gemeinsamen Texten: Fehlertext, Art offen", () => {
    const r = autoAusrichtung(stand.slice(0, 2), ref);
    assert.equal(r.ok, false);
    assert.equal(r.art, "offen");
    assert.equal(r.gemeinsam, 2);
    if (!r.ok) assert.equal(r.fehler, "Zu wenige gemeinsame Texte – bitte mit zwei Passpunkten ausrichten.");
    assert.equal(MELDUNG_ZU_WENIGE_TEXTE, "Zu wenige gemeinsame Texte – bitte mit zwei Passpunkten ausrichten.");
  });

  it("nicht sicher: 3 Treffer, aber unter 25 % der gemeinsamen Texte", () => {
    // 3 texts agree on (100, 50); 10 more scatter to different shifts
    const r0 = ref.slice(0, 3);
    const s0 = stand.slice(0, 3);
    const zusatzRef = Array.from({ length: 10 }, (_, i) => ({ text: `Text Z${i}`, x: i * 3, y: 0 }));
    const zusatzStand = zusatzRef.map((t, i) => ({ ...t, x: t.x + i * 11 + 1, y: t.y + 2 * i + 1 }));
    const r = autoAusrichtung([...s0, ...zusatzStand], [...r0, ...zusatzRef]);
    assert.equal(r.gemeinsam, 13);
    assert.equal(r.treffer, 3);
    nah(r.transform.dx, 100); nah(r.transform.dy, 50);
    assert.equal(r.sicher, false); // 3 < 0.25 · 13 = 3.25
  });

  it("ungültige Eingaben brechen nicht", () => {
    assert.equal(autoAusrichtung(/** @type {any} */ (null), /** @type {any} */ (undefined)).ok, false);
    assert.equal(autoAusrichtung([{ text: "Text A", x: NaN, y: 0 }], ref).gemeinsam, 0);
  });
});

describe("passpunktAusrichtung", () => {
  it("Drehung 90° und Verschiebung aus zwei Punktpaaren, Maßstab 1", () => {
    const r = passpunktAusrichtung([{ von: { x: 0, y: 0 }, nach: { x: 5, y: 5 } }, { von: { x: 10, y: 0 }, nach: { x: 5, y: 15 } }]);
    assert.equal(r.ok, true);
    assert.equal(r.art, "manuell");
    nah(r.transform.drehung, Math.PI / 2); nah(r.transform.massstab, 1);
    nahPkt(transformAnwenden(r.transform, { x: 0, y: 0 }), 5, 5);
    nahPkt(transformAnwenden(r.transform, { x: 10, y: 0 }), 5, 15);
  });

  it("freier Maßstab: Längenverhältnis; ohne: Fehler gleichmäßig auf beide Punkte verteilt", () => {
    const paare = /** @type {[{von:{x:number,y:number},nach:{x:number,y:number}},{von:{x:number,y:number},nach:{x:number,y:number}}]} */ ([
      { von: { x: 0, y: 0 }, nach: { x: 0, y: 0 } }, { von: { x: 10, y: 0 }, nach: { x: 20, y: 0 } },
    ]);
    const frei = passpunktAusrichtung(paare, { freierMassstab: true });
    nah(frei.transform.massstab, 2);
    nahPkt(transformAnwenden(frei.transform, { x: 10, y: 0 }), 20, 0);
    const fest = passpunktAusrichtung(paare);
    nah(fest.transform.massstab, 1);
    nahPkt(transformAnwenden(fest.transform, { x: 0, y: 0 }), 5, 0);
    nahPkt(transformAnwenden(fest.transform, { x: 10, y: 0 }), 15, 0);
  });

  it("zusammenfallende oder fehlende Punkte: Fehler, Art offen", () => {
    const r = passpunktAusrichtung([{ von: { x: 1, y: 1 }, nach: { x: 0, y: 0 } }, { von: { x: 1, y: 1 }, nach: { x: 3, y: 0 } }]);
    assert.equal(r.ok, false);
    assert.equal(r.art, "offen");
    assert.equal(passpunktAusrichtung(/** @type {any} */ ([])).ok, false);
  });
});

describe("Nachschieben", () => {
  it("Schrittweite nach Zoom: >40 px/m 1 cm, >8 px/m 10 cm, sonst 1 m (Grenzen exklusiv)", () => {
    assert.equal(nachschiebSchritt(100), 0.01);
    assert.equal(nachschiebSchritt(40), 0.1);
    assert.equal(nachschiebSchritt(9), 0.1);
    assert.equal(nachschiebSchritt(8), 1);
    assert.equal(nachschiebSchritt(0.5), 1);
  });

  it("verschiebt um einen Schritt, Art wird manuell, Drehung/Maßstab bleiben", () => {
    const a = { art: /** @type {const} */ ("auto"), transform: { dx: 1, dy: 2, drehung: 0.1, massstab: 1 } };
    assert.deepEqual(nachschieben(a, "rechts", 50), { art: "manuell", transform: { dx: 1.01, dy: 2, drehung: 0.1, massstab: 1 } });
    assert.deepEqual(nachschieben(a, "oben", 10).transform, { dx: 1, dy: 2.1, drehung: 0.1, massstab: 1 });
    assert.deepEqual(nachschieben(a, "unten", 1).transform.dy, 1);
    assert.deepEqual(nachschieben(null, "links", 1), { art: "manuell", transform: { dx: -1, dy: 0, drehung: 0, massstab: 1 } });
    assert.equal(a.transform.dx, 1); // input unchanged
  });

  it("zehnmal 1 cm = genau 10 cm (kein Rundungsrauschen)", () => {
    /** @type {any} */
    let a = ausrichtungOffen();
    for (let i = 0; i < 10; i++) a = nachschieben(a, "rechts", 100);
    assert.equal(a.transform.dx, 0.1);
  });

  it("unbekannte Richtung ändert nichts", () => {
    const a = ausrichtungOffen();
    assert.deepEqual(nachschieben(a, /** @type {any} */ ("schraeg"), 50), a);
  });
});
