// fester-zeitpunkt.mjs — preload for the seeder and the private API server of the visual
// baseline (Plan 72-06). Several seed parts compute their sample data relative to "today"
// (accounting, time & fees, deadlines); with a real clock the screenshots would change
// every day. Loaded through `node --import`, this module moves the clock of the Node
// process to a fixed instant (VISUELL_ZEIT, default 2026-10-01 09:00 UTC). The clock still
// runs forward from there, so order of creation and timers behave as usual.
//
// In:  process.env.VISUELL_ZEIT (ISO date, optional). Out: replaces globalThis.Date.

const FIX = Date.parse(process.env.VISUELL_ZEIT || "2026-10-01T09:00:00Z");
const Echt = Date;
const START = Echt.now();
/** @returns {number} fixed instant plus the real time elapsed since start, in ms */
const jetzt = () => FIX + (Echt.now() - START);

class FesteZeit extends Echt {
  /** @param {...any} args same as Date */
  constructor(...args) {
    if (args.length === 0) super(jetzt());
    else super(...(/** @type {[any]} */ (args)));
  }

  static now() {
    return jetzt();
  }
}

globalThis.Date = /** @type {DateConstructor} */ (/** @type {unknown} */ (FesteZeit));
