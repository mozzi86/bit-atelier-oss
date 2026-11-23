// 108-10: example of the two terrain layers for the IFC export tests — existing ground on a slope (falls 1 m per 10 m towards
// west, ±0,00 on the east side of the house) and new ground with a levelled pad west of the house. Rasters in model metres
// (gelaendeEbenen.js), 2-m cells over 24 × 20 m around the origin. Neutral data, no project.
import { erdmassenZwischen } from "@core/lib/massing/gelaendeEbenen.js";

/**
 * @returns {{bestand: import("@core/lib/massing/gelaende.js").Gelaende, neu: import("@core/lib/massing/gelaende.js").Gelaende,
 *   quelleBestand: "aufnahme", erdmassen: {abtrag_m3: number, auftrag_m3: number, flaeche_m2: number}|null}}
 */
export function gelaendeBeispiel() {
  const nx = 13, ny = 11, zelle = 2, x0 = -12, y0 = -10;
  /** @type {number[]} */
  const hBestand = [], hNeu = [];
  for (let j = 0; j < ny; j += 1) for (let i = 0; i < nx; i += 1) {
    const x = x0 + i * zelle, z = y0 + j * zelle;
    const h = Math.round(Math.min(0, (x - 6) * 0.1) * 100) / 100;
    hBestand.push(h);
    // pad: 8 × 8 m west of the house levelled to −1,40 m (fill on the low side, cut on the high side)
    hNeu.push(x >= -12 && x <= -4 && Math.abs(z) <= 4 ? -1.4 : h);
  }
  const bestand = { nx, ny, zelle, x0, y0, h: hBestand }, neu = { nx, ny, zelle, x0, y0, h: hNeu };
  return { bestand, neu, quelleBestand: "aufnahme", erdmassen: erdmassenZwischen(bestand, neu) };
}
