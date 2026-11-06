// 106-09: what the person sees of the sync between devices - one small store for the whole page:
//   verbindung  state of the change stream (aus / verbinde / verbunden / getrennt) for the project
//   hinweise    "arrived from another device" notes (the newest few): what changed, from where, with which origin
//   konflikte   two devices changed the same thing: both versions side by side and the two ways out
//                (keep mine / take the other device's) - nothing is written until the person picks one (D-IM-04)
//
// Pure store without React or DOM; the snapshot is replaced on every change, so a component can read it with
// useSyncExternalStore(abonnieren, stand). Module-level singleton: the viewers and the sync module share it.
// A conflict carries its two resolver functions (`loesen`); `fuerTest()` gives the plain data without them.
//
// Review 106-09: a conflict belongs to a source (quelle: "bim" = BIM studio, "ifc" = IFC viewer, "modell" = the save
// path, "programm" = the program fields). A viewer that shows the cards of its source registers that (anzeigeMelden),
// so a page-wide card (Layout) shows only the conflicts no mounted viewer shows - a conflict is never invisible.
// `leeren` takes a source filter: the IFC viewer clears only its own cards, never the studio's of the same project.
// The test hook is READ-ONLY: deciding a conflict is a step of the person at the card (role check, origin "hand").
//
// In:  calls from useBimModelSync.js, the viewers and the stream client. Out: abgleichStand (singleton), HINWEISE_MAX.

/** Notes kept at once [ASSUMED: the newest five fit beside the model view; older ones are history, not news]. */
export const HINWEISE_MAX = 5;

/**
 * @typedef {{status: "aus"|"verbinde"|"verbunden"|"getrennt", projekt: string|null, grund?: string|null,
 *   rolle?: "leiter"|"folger"|"einzeln"|null}} Verbindung
 *   rolle = how this tab holds the stream: leiter = it holds the one connection of this browser and shares it,
 *   folger = it hears the leader's tab, einzeln = own connection (browser without Web Locks / BroadcastChannel)
 * @typedef {{name: string, id?: string, unbekannt?: boolean}|null} Geraet  null = another window on this computer;
 *   unbekannt = another tab or device whose name is not known (a refused save tells only that someone was faster)
 * @typedef {{id: string, zeit: string, geraet: Geraet, zeilen: Array<{text: string, herkunft?: string[]|null, bestaetigt_durch?: string|null}>,
 *   veraltet?: number}} Hinweis
 *   zeilen: one line per changed thing (German data text built by the caller from the record); herkunft: origin list of the step
 *   (hand / text / sprache / agent / bild) when the record says it; veraltet: own open proposals that became stale by it.
 * @typedef {{schluessel: string|null, name: string, mein: string, fremd: string}} KonfliktZeile
 *   name = element in words; mein / fremd = the two versions as short text
 * @typedef {{id: string, zeit: string, quelle: string, projektId: string|null, feld: string, titel: string, geraet: Geraet,
 *   zeilen: KonfliktZeile[], loesen: {mein: () => (void|Promise<void>), fremd: () => (void|Promise<void>)},
 *   fremdHinweis?: string|null}} Konflikt
 *   id = quelle + feld (a new conflict of the same field replaces the old one); titel = what in words ("Wände", German key,
 *   the card translates it); fremdHinweis = German key of a line under the buttons (e.g. that an editor shows the taken
 *   version only after reopening)
 * @typedef {{verbindung: Verbindung, hinweise: ReadonlyArray<Hinweis>, konflikte: ReadonlyArray<Konflikt>}} Stand
 */

/** German key of the error when a conflict was decided meanwhile (translated by the card). */
export const SCHON_GEKLAERT = "Dieser Konflikt ist schon geklärt";

let laufend = 0;
/** @param {string} p @returns {string} */
const neueId = (p) => `${p}-${Date.now().toString(36)}-${(laufend += 1)}`;

function erzeugen() {
  /** @type {Stand} */
  let s = { verbindung: { status: "aus", projekt: null, grund: null, rolle: null }, hinweise: [], konflikte: [] };
  /** @type {Set<() => void>} */
  const hoerer = new Set();
  /** sources whose cards a mounted viewer shows, with a mount count @type {Map<string, number>} */
  const angezeigt = new Map();
  /** @param {Stand} neu */
  const setze = (neu) => { s = neu; hoerer.forEach((f) => { try { f(); } catch { /* a listener must not break the others */ } }); };
  return {
    /** @returns {Stand} the same object until something changes */
    stand: () => s,
    /** @param {() => void} fn @returns {() => void} unsubscribe */
    abonnieren(fn) { hoerer.add(fn); return () => { hoerer.delete(fn); }; },
    /** @param {Verbindung} v */
    verbindungSetzen(v) {
      const n = { ...v, grund: v.grund ?? null, rolle: v.rolle ?? null };
      const a = s.verbindung;
      if (a.status === n.status && a.projekt === n.projekt && (a.grund ?? null) === n.grund && (a.rolle ?? null) === n.rolle) return;
      setze({ ...s, verbindung: n });
    },
    /**
     * Adds a note (newest first, at most HINWEISE_MAX).
     * @param {Omit<Hinweis, "id"|"zeit"> & {zeit?: string}} h @returns {string} its id
     */
    hinweisHinzu(h) {
      const id = neueId("h");
      setze({ ...s, hinweise: [{ ...h, id, zeit: h.zeit || new Date().toISOString() }, ...s.hinweise].slice(0, HINWEISE_MAX) });
      return id;
    },
    /** @param {string} id */
    hinweisWeg(id) { if (s.hinweise.some((h) => h.id === id)) setze({ ...s, hinweise: s.hinweise.filter((h) => h.id !== id) }); },
    /**
     * Reports a conflict; one of the same source and field is replaced (the newest versions count).
     * @param {Omit<Konflikt, "id"|"zeit"> & {zeit?: string}} k @returns {string} its id
     */
    konfliktMelden(k) {
      const id = `${k.quelle}:${k.feld}`;
      const neu = { ...k, id, zeit: k.zeit || new Date().toISOString() };
      setze({ ...s, konflikte: [...s.konflikte.filter((x) => x.id !== id), neu] });
      return id;
    },
    /** @param {string} id @returns {Konflikt|null} */
    konflikt: (id) => s.konflikte.find((k) => k.id === id) ?? null,
    /**
     * The person picked a version: runs its resolver, then removes the conflict (also when the resolver throws - the
     * error goes to the caller, the conflict stays so the person can try again). Called only from the card's buttons.
     * @param {string} id @param {"mein"|"fremd"} wahl
     */
    async konfliktLoesen(id, wahl) {
      const k = s.konflikte.find((x) => x.id === id);
      if (!k) throw new Error(SCHON_GEKLAERT);
      await k.loesen[wahl]();
      setze({ ...s, konflikte: s.konflikte.filter((x) => x.id !== id) });
    },
    /** Removes a conflict without resolving it (its field changed again, the caller reports anew). @param {string} id */
    konfliktWeg(id) { if (s.konflikte.some((k) => k.id === id)) setze({ ...s, konflikte: s.konflikte.filter((k) => k.id !== id) }); },
    /**
     * All notes and the conflicts of one project go (viewer closed, project switch). The sync module releases the
     * save locks of the removed conflicts (it listens to this store), so no field stays held back without a card.
     * @param {string|null} [projektId] null = every project
     * @param {{quellen?: ReadonlyArray<string>|null, ausser?: boolean}} [o] quellen = only conflicts of these sources;
     *   ausser = the opposite: conflicts of every project EXCEPT projektId go (a newly opened project drops the old ones)
     */
    leeren(projektId = null, { quellen = null, ausser = false } = {}) {
      const trifft = (/** @type {Konflikt} */ k) => (projektId == null || (ausser ? k.projektId !== projektId : k.projektId === projektId))
        && (!quellen || quellen.includes(k.quelle));
      const konflikte = s.konflikte.filter((k) => !trifft(k));
      const hinweise = ausser ? s.hinweise : [];
      if (konflikte.length === s.konflikte.length && hinweise.length === s.hinweise.length) return;
      setze({ ...s, hinweise, konflikte });
    },
    /**
     * A viewer shows the cards of its source (mount); the returned function ends that (unmount).
     * @param {string} quelle @returns {() => void}
     */
    anzeigeMelden(quelle) {
      angezeigt.set(quelle, (angezeigt.get(quelle) || 0) + 1);
      setze({ ...s });
      let aktiv = true;
      return () => {
        if (!aktiv) return;
        aktiv = false;
        const n = (angezeigt.get(quelle) || 1) - 1;
        if (n > 0) angezeigt.set(quelle, n); else angezeigt.delete(quelle);
        setze({ ...s });
      };
    },
    /** @param {string} quelle @returns {boolean} whether a mounted viewer shows the cards of this source */
    angezeigt: (quelle) => (angezeigt.get(quelle) || 0) > 0,
    /** Plain data for test hooks (no functions). */
    fuerTest() {
      return { verbindung: { ...s.verbindung }, hinweise: s.hinweise.map((h) => ({ ...h })),
        konflikte: s.konflikte.map(({ loesen: _l, ...rest }) => ({ ...rest, zeilen: rest.zeilen.map((z) => ({ ...z })) })) };
    },
  };
}

/**
 * The conflicts a card shows: those of the given sources (null = all).
 * @param {Stand} s @param {ReadonlyArray<string>|null} quellen @returns {Konflikt[]}
 */
export function sichtbareKonflikte(s, quellen) {
  return s.konflikte.filter((k) => !quellen || quellen.includes(k.quelle));
}

/**
 * Whether a viewer's sync card has something to show (decides whether the lazy card is loaded at all).
 * @param {Stand} s @param {ReadonlyArray<string>|null} quellen sources of the conflicts this viewer shows
 * @returns {boolean}
 */
export function abgleichZeigen(s, quellen) {
  return s.hinweise.length > 0 || sichtbareKonflikte(s, quellen).length > 0 || s.verbindung.status === "getrennt";
}

/** The one store of the page. */
export const abgleichStand = erzeugen();

/** A fresh store (unit tests). */
export const abgleichStandNeu = erzeugen;

/**
 * Publishes the READ-ONLY test and agent hook window.__bitAbgleich while a viewer with the change stream is open:
 * `stand()` (plain data: connection, notes, conflicts). Deciding a conflict is not offered here - it is the person's
 * step at the card (role check, origin "hand"; guard rails 1 and 2, D-IM-04).
 * Side effect: sets a property on window (no-op outside a browser).
 */
export function abgleichTesthaken() {
  const w = /** @type {any} */ (globalThis).window;
  if (!w) return;
  w.__bitAbgleich = { stand: () => abgleichStand.fuerTest() };
}
