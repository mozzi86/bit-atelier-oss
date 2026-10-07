// Deckungsreport — welche Bauteile trägt überhaupt eine LV-Position?
// Phase 33 / W5 (Plan 33-03, ENGINE-06). Neue Fähigkeit: das gab es nirgends.
//
// DIE DECKUNGSDEFINITION IST DER GANZE STREITPUNKT — deshalb steht sie hier
// oben, benannt und begründet, statt als stille Annahme im Code:
//
//   direkt gedeckt   := die GlobalId des Bauteils steht in `nachweis_element_ids`
//                       einer LV-Position. Das ist die EINZIGE im Datenmodell
//                       belegte Verknüpfung — alles andere wäre geraten.
//   gruppengedeckt   := mindestens EIN Bauteil derselben Feinaggregat-Gruppe
//                       (IFC-Klasse × Zustand × Bauteiltyp) ist direkt gedeckt.
//                       Fachliche Lesart: „für diesen Bauteiltyp GIBT es eine
//                       Position, nur die Verknüpfung am Einzelbauteil fehlt."
//
// Der Deckungsgrad wird auf ZWEI Ebenen ausgewiesen — Gruppen UND Elemente —
// und nie ohne Angabe der Ebene genannt. Grund: die 353 statischen und 129
// pauschalen Positionen decken fachlich sehr wohl Bauteile ab, tragen aber keine
// GUID. Eine einzige Prozentzahl „Deckung" würde deshalb entweder die
// Pauschalpositionen unterschlagen (Elementebene) oder eine Verknüpfung
// behaupten, die es nicht gibt (naives Hochrechnen). Beide Zahlen nebeneinander
// sagen die Wahrheit; eine allein tut es nicht.
//
// Der Report ist ein Arbeitsmittel („welche Bauteile muss ich noch verknüpfen"),
// KEIN Vollständigkeitsnachweis des Leistungsverzeichnisses.
//
// Isomorph: kein window, kein DOMParser, keine Aliase.

import { OHNE_WERT, gruppenKey, statusKey } from '@core/lib/rules/elementIndex.js';

/** Die Deckungsdefinition als Text — geht in jeden Export mit. */
export const DECKUNG_DEFINITION =
  'gedeckt = GlobalId steht in nachweis_element_ids einer LV-Position (direkt) bzw. ' +
  'die Feinaggregat-Gruppe (IFC-Klasse × Zustand × Bauteiltyp) enthält mindestens ein ' +
  'direkt gedecktes Bauteil (gruppengedeckt). Ausgewiesen auf Gruppen- UND Elementebene.';

/**
 * IFC-Klassen auf deutsche Bauteilbegriffe. Bewusst NICHT vollständig
 * „automatisch" (z. B. via Kamel-Case-Trennung): `IfcBuildingElementProxy` heißt
 * auf Deutsch nicht „Gebäude-Element-Stellvertreter", sondern ist der Hinweis
 * „der Übersetzer hat das Bauteil nicht klassifiziert". Unbekanntes bleibt beim
 * IFC-Namen — eine erfundene Übersetzung wäre schlimmer als der Fachbegriff.
 */
export const KLASSE_DE = Object.freeze({
  IfcWall: 'Wand',
  IfcWallStandardCase: 'Wand',
  IfcSlab: 'Decke / Bodenplatte',
  IfcDoor: 'Tür',
  IfcWindow: 'Fenster',
  IfcColumn: 'Stütze',
  IfcBeam: 'Unterzug / Träger',
  IfcCovering: 'Bekleidung / Belag',
  IfcRailing: 'Geländer',
  IfcStair: 'Treppe',
  IfcStairFlight: 'Treppenlauf',
  IfcRoof: 'Dach',
  IfcCurtainWall: 'Vorhangwand / Fassade',
  IfcSpace: 'Raum',
  IfcOpeningElement: 'Öffnung',
  IfcPlate: 'Platte',
  IfcMember: 'Stab / Profil',
  IfcFurnishingElement: 'Einrichtung',
  IfcFurniture: 'Möbel',
  IfcLightFixture: 'Leuchte',
  IfcBuildingElementProxy: 'nicht klassifiziertes Bauteil (Proxy)',
});
export const klasseDe = (k) => KLASSE_DE[k] || k || OHNE_WERT;

/**
 * Zielgewerk-Vorschlag über den Katalog `KgRegel` — Kostengruppe zuerst, dann
 * das Gewerk, das diese Kostengruppe am häufigsten bedient.
 *
 * Es ist ein VORSCHLAG, kein Ergebnis. Deshalb kommt er mit `sicherheit` und
 * darf `null` sein: „kein Vorschlag" ist eine ehrlichere Auskunft als ein
 * geratenes Gewerk, das jemand ungeprüft übernimmt.
 */
export function zielgewerkVorschlag(el, { kgRegeln = [], kgZuGewerk = new Map() } = {}) {
  const klasse = el?.klasse ?? null;
  const status = String(statusKey(el)).toLowerCase();
  const text = `${el?.typ || ''}|${el?.name || ''}`;
  const passend = (kgRegeln || [])
    .filter((r) => {
      if (r.ifc_klasse && r.ifc_klasse !== klasse) return false;
      if (r.status && String(r.status).toLowerCase() !== status) return false;
      if (r.muster?.value) {
        const v = String(r.muster.value);
        if (r.muster.op === 'glob') {
          const re = new RegExp(`^${v.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`, 'i');
          if (!re.test(text)) return false;
        } else if (!text.toLowerCase().includes(v.toLowerCase())) return false;
      }
      return true;
    })
    .sort((a, b) => (a.prio ?? 999) - (b.prio ?? 999));
  const treffer = passend[0] || null;
  if (!treffer) return { kg2018: null, gewerk: null, regel: null, sicherheit: 'kein Vorschlag' };
  const gewerk = kgZuGewerk.get(treffer.kg2018) || null;
  return {
    kg2018: treffer.kg2018,
    gewerk,
    regel: treffer.name || null,
    sicherheit: passend.length === 1 ? 'eindeutig' : `${passend.length} Regeln passen — Vorschlag mit höchster Priorität`,
  };
}

/** Zuordnung KG 2018 → häufigstes Gewerk, aus den vorhandenen LV-Positionen. */
export function kgZuGewerkAus(positionen = []) {
  const zaehler = new Map();
  for (const p of positionen || []) {
    const kg = p?.din276 ?? p?.kg2018 ?? null;
    const gewerk = p?.trade ?? null;
    if (!kg || !gewerk) continue;
    if (!zaehler.has(kg)) zaehler.set(kg, new Map());
    const m = zaehler.get(kg);
    m.set(gewerk, (m.get(gewerk) || 0) + 1);
  }
  const out = new Map();
  for (const [kg, m] of zaehler) {
    out.set(kg, [...m.entries()].sort((a, b) => b[1] - a[1])[0][0]);
  }
  return out;
}

const r2 = (n) => (n == null ? null : Math.round(n * 100) / 100);

/** Summe einer Mengengröße über eine Gruppe (nur endliche Zahlen). */
function summe(elemente, keys) {
  let s = 0;
  let getroffen = false;
  for (const e of elemente) {
    for (const k of keys) {
      const v = e?.qty?.[k];
      if (typeof v === 'number' && Number.isFinite(v)) { s += v; getroffen = true; break; }
    }
  }
  return getroffen ? r2(s) : null;
}

/**
 * Der Deckungsreport — in BEIDE Richtungen.
 *
 * Richtung 1 („welches Bauteil hat keine Position?"): `gruppen`, sortiert nach
 * Anzahl ungedeckter Bauteile — das ist die Arbeitsliste.
 * Richtung 2 („welche Position hat keine Bauteile?"): `positionen_ohne_bauteile`
 * — Positionen im Modus `filter`/`uebernahme`, die keine GUID tragen.
 *
 * @param {Array} elemente Engine-Elementform ({guid, klasse, status, typ, name, geschoss, qty})
 * @param {Array} positionen LV-Positionen
 * @param {object} opt
 * @returns {object} Report
 */
export function deckungsReport(elemente = [], positionen = [], {
  kgRegeln = [],
  guidsAusPosition = null,
} = {}) {
  const holeGuids = typeof guidsAusPosition === 'function'
    ? guidsAusPosition
    : (p) => p?.nachweis_element_ids || p?.guids || [];

  // GUID → die Positionen, die sie nachweisen (n:m, eine GUID darf mehrfach
  // genutzt werden — im Realprojekt sind 336 Bauteile in zwei Positionen).
  const guidZuPos = new Map();
  for (const p of positionen || []) {
    for (const g of holeGuids(p) || []) {
      if (!guidZuPos.has(g)) guidZuPos.set(g, []);
      guidZuPos.get(g).push(p);
    }
  }
  const gedeckteGuids = new Set(guidZuPos.keys());
  const kgZuGewerk = kgZuGewerkAus(positionen);

  // --- Gruppen bilden -------------------------------------------------
  const gruppen = new Map();
  for (const el of elemente || []) {
    const key = gruppenKey(el);
    if (!gruppen.has(key)) gruppen.set(key, { key, elemente: [], direkt: 0 });
    const g = gruppen.get(key);
    g.elemente.push(el);
    if (gedeckteGuids.has(el?.guid)) g.direkt += 1;
  }

  const zeilen = [];
  const jeStatus = new Map();
  for (const g of gruppen.values()) {
    const erst = g.elemente[0];
    const status = statusKey(erst);
    const gruppengedeckt = g.direkt > 0;
    const geschosse = [...new Set(g.elemente.map((e) => e?.geschoss || OHNE_WERT))].sort();
    const vorschlag = zielgewerkVorschlag(erst, { kgRegeln, kgZuGewerk });
    // Die Einschätzung ist bewusst nur ZWEIWERTIG. Ein dritter Wert
    // („wahrscheinlich abgedeckt") wäre eine Vermutung, die wie ein Befund aussieht.
    const einschaetzung = gruppengedeckt
      ? 'Position vorhanden — Verknüpfung fehlt'
      : 'Position prüfen';
    const beispiel = g.elemente.find((e) => !gedeckteGuids.has(e?.guid))?.guid ?? erst?.guid ?? null;
    const zeile = {
      key: g.key,
      status,
      klasse: erst?.klasse ?? OHNE_WERT,
      klasse_de: klasseDe(erst?.klasse),
      typ: String(erst?.typ ?? erst?.name ?? OHNE_WERT),
      geschosse: geschosse.join(', '),
      anzahl: g.elemente.length,
      gedeckt: g.direkt,
      ungedeckt: g.elemente.length - g.direkt,
      gruppengedeckt,
      flaeche: summe(g.elemente, ['NetSideArea', 'NetArea', 'NetFloorArea', 'GrossSideArea', 'GrossArea']),
      volumen: summe(g.elemente, ['NetVolume', 'GrossVolume']),
      laenge: summe(g.elemente, ['Length', 'Perimeter']),
      zielgewerk: vorschlag.gewerk,
      zielgewerk_kg: vorschlag.kg2018,
      zielgewerk_regel: vorschlag.regel,
      zielgewerk_sicherheit: vorschlag.sicherheit,
      einschaetzung,
      beispiel_guid: beispiel,
    };
    zeilen.push(zeile);

    if (!jeStatus.has(status)) {
      jeStatus.set(status, {
        status, elemente: 0, elemente_direkt: 0, elemente_gruppengedeckt: 0,
        gruppen: 0, gruppen_gedeckt: 0,
      });
    }
    const st = jeStatus.get(status);
    st.elemente += zeile.anzahl;
    st.elemente_direkt += zeile.gedeckt;
    if (gruppengedeckt) { st.elemente_gruppengedeckt += zeile.anzahl; st.gruppen_gedeckt += 1; }
    st.gruppen += 1;
  }

  for (const st of jeStatus.values()) {
    st.deckung_elemente_prozent = st.elemente ? r2((st.elemente_direkt / st.elemente) * 100) : 0;
    st.deckung_gruppen_prozent = st.gruppen ? r2((st.gruppen_gedeckt / st.gruppen) * 100) : 0;
    st.deckung_elemente_gruppenbasiert_prozent = st.elemente
      ? r2((st.elemente_gruppengedeckt / st.elemente) * 100)
      : 0;
  }

  // --- Richtung 2: Positionen ohne Bauteile ---------------------------
  const modellPflicht = (p) => ['filter', 'auswahl'].includes(p?.mengen_modus);
  const positionenOhneBauteile = (positionen || [])
    .filter((p) => (holeGuids(p) || []).length === 0)
    .map((p) => ({
      oz: p?.oz ?? null,
      trade: p?.trade ?? null,
      title: p?.title ?? p?.short_text ?? null,
      mengen_modus: p?.mengen_modus ?? null,
      // Ohne Modellbindung ist „keine GUID" der NORMALFALL (Pauschalposition),
      // nicht ein Fehler. Nur bei Modellmodi ist es ein Befund.
      befund: modellPflicht(p) ? 'Modellbindung erwartet, aber keine Bauteile' : 'ohne Modellbezug (Pauschal-/Übernahmeposition)',
    }));

  zeilen.sort((a, b) => b.ungedeckt - a.ungedeckt || String(a.key).localeCompare(String(b.key)));

  return {
    definition: DECKUNG_DEFINITION,
    gruppen: zeilen,
    gruppen_gesamt: zeilen.length,
    gruppen_ohne_position: zeilen.filter((z) => !z.gruppengedeckt).length,
    gruppen_teilweise: zeilen.filter((z) => z.gedeckt > 0 && z.gedeckt < z.anzahl).length,
    elemente_gesamt: (elemente || []).length,
    elemente_gedeckt: gedeckteGuids.size ? (elemente || []).filter((e) => gedeckteGuids.has(e?.guid)).length : 0,
    guids_distinct: gedeckteGuids.size,
    guids_summe_ueber_positionen: [...guidZuPos.values()].reduce((a, l) => a + l.length, 0),
    je_status: Object.fromEntries([...jeStatus.entries()].map(([k, v]) => [k, v])),
    positionen_ohne_bauteile: positionenOhneBauteile,
    positionen_gesamt: (positionen || []).length,
  };
}
