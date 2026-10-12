// FensterTabelle.jsx — a table that draws only its visible rows (72-21, register no. 134).
//
// Thin shell around useFenster: scroll container, sticky head while the window is on,
// spacer rows above and below the drawn slice. Up to `ab` rows (default 60) it renders
// exactly like a plain table; in print every row is drawn (see useFenster).
//
// In:  liste (rows, already filtered), kopf (<tr> of the head), zeile(item, index) →
//      <tr> (index = position in `liste`), spalten (column count for the spacers),
//      tabelleKlasse, testId, ab.
// Out: the rendered table.

import React from "react";
import { useFenster } from "@core/hooks/useFenster";

/**
 * Windowed table.
 * @template T
 * @param {{
 *   liste: T[],
 *   kopf: React.ReactNode,
 *   zeile: (item: T, index: number) => React.ReactNode,
 *   spalten: number,
 *   tabelleKlasse?: string,
 *   rahmenKlasse?: string,
 *   testId?: string,
 *   ab?: number,
 * }} props
 *   liste — rows to show (the caller filters the DATA, never hidden DOM rows);
 *   kopf — the head row(s), rendered inside <thead>;
 *   zeile — renders one row; `index` is the position in `liste`;
 *   spalten — number of columns (colSpan of the spacer cells);
 *   rahmenKlasse — extra classes of the scroll container (e.g. "overflow-x-auto").
 */
export default function FensterTabelle({ liste, kopf, zeile, spalten, tabelleKlasse = "w-full text-xs", rahmenKlasse = "overflow-x-auto", testId, ab }) {
  const f = useFenster({ anzahl: liste.length, ab });
  const { className: scrollKlasse, ...scrollRest } = f.scrollProps;
  return (
    <div {...scrollRest} className={[rahmenKlasse, scrollKlasse].filter(Boolean).join(" ")} data-testid={testId}
      data-zeilen={liste.length}>
      <table className={tabelleKlasse}>
        <thead className={f.aktiv ? "sticky top-0 z-[1] bg-white" : undefined}>{kopf}</thead>
        <tbody ref={f.koerperRef}>
          {f.vorher > 0 && (
            <tr data-fenster-abstand="" aria-hidden="true" style={{ height: f.vorher }}><td colSpan={spalten} /></tr>
          )}
          {liste.slice(f.start, f.ende).map((item, k) => zeile(item, f.start + k))}
          {f.nachher > 0 && (
            <tr data-fenster-abstand="" aria-hidden="true" style={{ height: f.nachher }}><td colSpan={spalten} /></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
