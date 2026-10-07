// Projekt-Bundle-Import (Phase 33 / W3) — ein vollständiges Kostenberechnungsprojekt
// (Lose, LV-Positionen, Mengenregeln, Filter, Bauteile, Preisschichten, Verträge,
// Modell-Lücken) in EINEM Vorgang in die lokale DB bringen.
//
// DREI SCHRITTE, IN DIESER REIHENFOLGE — nicht verhandelbar:
//
//   parseBundle(json)     Struktur lesen, nichts prüfen, nichts schreiben
//   validateBundle(b)     ALLE Verstöße sammeln und BERICHTEN — immer noch nichts schreiben
//   applyBundle(b, io)    schreiben, in Fremdschlüssel-Reihenfolge, in Stapeln
//
// WARUM DER TROCKENLAUF PFLICHT IST (ASVS V5): der Import ist der teuerste Schreibpfad
// der App (~1.550 Entitäten + 6.038 Bauteile). Bricht er in der Mitte ab, bleibt ein
// halbes Projekt zurück: Positionen ohne Los, Regeln ohne Position, Mengen ohne Bezug —
// und niemand kann unterscheiden, was echt und was Trümmer ist. Deshalb wird ERST
// vollständig geprüft und der Bericht angezeigt, und nur bei ausdrücklicher Bestätigung
// geschrieben. Fällt beim Schreiben doch etwas aus, bricht `applyBundle` MIT BERICHT ab
// (`abgebrochen: true`) statt weiterzumachen.
//
// Die 6.038 Bauteile gehen in den BLOB-Store, nicht als 6.038 Entitäten: sie sind
// abgeleitete Daten (durch erneutes IFC-Lesen reproduzierbar) und würden db.json bei
// jedem Speichern einer einzelnen Position um Megabytes aufblähen (T-33-03).
//
// Isomorph: kein window, kein fetch im Modul, keine Aliase. Alle Seiteneffekte kommen
// als `io`-Objekt herein — damit ist der Importpfad in `node --test` prüfbar, ohne
// Server (Gate: parity/g8-modi.test.mjs).

/** Reihenfolge, in der geschrieben werden MUSS (Fremdschlüssel zeigen immer nach links). */
export const SCHREIB_REIHENFOLGE = [
  "kataloge",
  "project",
  "lose",
  "snapshot",
  "elemente",
  "filter",
  "positionen",
  "regeln",
  "preisschichten",
  "vertraege",
  "vertragspositionen",
  "aenderungen",
  "deckung",
  "luecken",
];

/** Entitätsname je Bundle-Abschnitt. */
export const ENTITAET = {
  lose: "Los",
  filter: "AvaFilter",
  positionen: "LVPosition",
  regeln: "MengenRegel",
  preisschichten: "PreisSchicht",
  vertraege: "ProjectContract",
  vertragspositionen: "VertragsPosition",
  aenderungen: "ChangeOrder",
  deckung: "Deckung",
  luecken: "ModellLuecke",
  snapshot: "BimSnapshot",
};

export const STAPEL = 500; // express.json steht auf 10 MB — 500 Sätze bleiben darunter

const arr = (x) => (Array.isArray(x) ? x : []);

/**
 * Bundle-JSON in die Abschnitte zerlegen. Reines Lesen: keine Prüfung, kein Wurf
 * (außer bei völlig unlesbarer Eingabe), damit `validateBundle` ALLE Mängel auf einmal
 * berichten kann statt beim ersten zu sterben.
 */
export function parseBundle(json) {
  const b = typeof json === "string" ? JSON.parse(json) : json;
  if (!b || typeof b !== "object") throw new Error("Bundle ist kein Objekt.");
  return {
    version: b.version ?? null,
    erzeugt_am: b.erzeugt_am ?? null,
    quelle: b.quelle ?? null,
    project: b.project ?? null,
    kataloge: b.kataloge && typeof b.kataloge === "object" ? b.kataloge : {},
    lose: arr(b.lose),
    positionen: arr(b.positionen),
    regeln: arr(b.regeln),
    filter: arr(b.filter),
    snapshot: b.snapshot ?? null,
    elemente: arr(b.elemente),
    preisschichten: arr(b.preisschichten),
    vertraege: arr(b.vertraege),
    vertragspositionen: arr(b.vertragspositionen),
    aenderungen: arr(b.aenderungen),
    deckung: arr(b.deckung),
    luecken: arr(b.luecken),
    // Was das Erzeugungswerkzeug selbst als unvollständig meldet, wird NICHT
    // verschwiegen — es landt im Trockenlauf-Bericht.
    unvollstaendig: arr(b.unvollstaendig),
    warnungen: arr(b.warnungen),
  };
}

/**
 * TROCKENLAUF. Sammelt ALLE Verstöße, bevor irgendetwas geschrieben wird.
 *
 * `fehler` blockiert den Import, `warnungen` nicht — die Unterscheidung ist bewusst:
 * eine Position ohne Los ist ein Datenfehler, eine Position ohne Einheitspreis ist im
 * Ausschreibungs-LV der Normalfall.
 *
 * @returns {{ok: boolean, fehler: string[], warnungen: string[], zusammenfassung: object}}
 */
export function validateBundle(bundle) {
  const b = bundle;
  const fehler = [];
  const warnungen = [...arr(b.warnungen)];

  // --- Kopf -------------------------------------------------------------------
  if (!b.version) fehler.push("Bundle ohne `version` — Herkunft nicht nachvollziehbar.");
  if (!b.project || typeof b.project !== "object") {
    fehler.push("Bundle ohne `project` — es gibt kein Ziel, in das importiert werden könnte.");
  } else if (!b.project.name) {
    fehler.push("Das Projekt im Bundle hat keinen Namen.");
  }

  // --- Referenzen: HART geprüft, nicht optimistisch --------------------------
  const losKeys = new Set(b.lose.map((l) => String(l.gewerk_nr ?? l.id ?? "")));
  const posKeys = new Set();
  const dubletten = [];
  for (const p of b.positionen) {
    const key = `${p.gewerk_nr ?? ""}/${p.oz ?? ""}`;
    if (posKeys.has(key)) dubletten.push(key);
    posKeys.add(key);
  }
  if (dubletten.length) {
    fehler.push(`${dubletten.length} doppelte Positions-Schlüssel (z. B. ${dubletten.slice(0, 3).join(", ")}).`);
  }

  const ohneLos = b.positionen.filter((p) => !losKeys.has(String(p.gewerk_nr ?? "")));
  if (ohneLos.length) {
    fehler.push(
      `${ohneLos.length} Positionen verweisen auf ein Los, das das Bundle nicht enthält ` +
      `(z. B. ${ohneLos.slice(0, 3).map((p) => `${p.gewerk_nr}/${p.oz}`).join(", ")}).`,
    );
  }

  const ohneTitel = b.positionen.filter((p) => !String(p.title ?? "").trim());
  if (ohneTitel.length) {
    // Genau der title/description-Bruch: früher landeten 497 namenlose Zeilen in der
    // Tabelle. Das ist ein FEHLER, keine Kosmetik.
    fehler.push(`${ohneTitel.length} Positionen ohne Titel — die LV-Tabelle würde sie namenlos zeigen.`);
  }

  const regelnOhnePosition = b.regeln.filter(
    (r) => !posKeys.has(`${r.gewerk_nr ?? ""}/${r.oz ?? ""}`),
  );
  if (regelnOhnePosition.length) {
    fehler.push(`${regelnOhnePosition.length} Mengenregeln zeigen auf Positionen, die es im Bundle nicht gibt.`);
  }

  const filterIds = new Set(b.filter.map((f) => String(f.id ?? f.key ?? "")));
  const posOhneFilter = b.positionen.filter(
    (p) => p.mengen_modus === "filter" && p.filter_ref && !filterIds.has(String(p.filter_ref)),
  );
  if (posOhneFilter.length) {
    fehler.push(`${posOhneFilter.length} Filter-Positionen verweisen auf einen fehlenden Filter.`);
  }

  // --- Mengen-Modi ------------------------------------------------------------
  const modi = {};
  for (const p of b.positionen) {
    const m = p.mengen_modus || "(nicht gesetzt)";
    modi[m] = (modi[m] || 0) + 1;
  }
  if (modi["(nicht gesetzt)"]) {
    fehler.push(
      `${modi["(nicht gesetzt)"]} Positionen ohne \`mengen_modus\` — der Modus würde aus ` +
      "`bim_element_ids` geraten und könnte still auf \"auswahl\" kippen (T-33-05).",
    );
  }

  // T-33-05: Nachweis-GUIDs gehören in `nachweis_element_ids`. Lägen sie in
  // `bim_element_ids`, würde `positionMode` sie zu „auswahl" umdeuten und die Menge
  // einfrieren — ohne jede Fehlermeldung.
  const guidsImFalschenFeld = b.positionen.filter((p) => arr(p.bim_element_ids).length > 0);
  if (guidsImFalschenFeld.length) {
    fehler.push(
      `${guidsImFalschenFeld.length} Positionen führen GUIDs in \`bim_element_ids\` — ` +
      "Nachweis-GUIDs gehören in `nachweis_element_ids` (T-33-05).",
    );
  }

  const uebernahmeOhneGrund = b.positionen.filter(
    (p) => p.mengen_modus === "uebernahme" && !p.ausschluss_grund,
  );
  if (uebernahmeOhneGrund.length) {
    warnungen.push(
      `${uebernahmeOhneGrund.length} Übernahme-Positionen ohne \`ausschluss_grund\` — ` +
      "ohne Grund ist nicht prüfbar, warum das Modell die Menge nicht liefert.",
    );
  }

  const ohnePreis = b.positionen.filter((p) => p.unit_price == null);
  if (ohnePreis.length) {
    warnungen.push(`${ohnePreis.length} Positionen ohne Einheitspreis (im Ausschreibungs-LV der Normalfall).`);
  }

  const ohneMenge = b.positionen.filter((p) => p.quantity == null);
  if (ohneMenge.length) {
    warnungen.push(`${ohneMenge.length} Positionen ohne Menge — sie werden mit null übernommen, nicht mit 0.`);
  }

  // --- Bauteile ---------------------------------------------------------------
  if (b.elemente.length > 0) {
    if (!b.snapshot) {
      fehler.push("Bauteile ohne `snapshot` — der Modellstand wäre nicht zuordenbar.");
    }
    const ohneGuid = b.elemente.filter((e) => !e.guid).length;
    if (ohneGuid) fehler.push(`${ohneGuid} Bauteile ohne GlobalId — keine stabile Bindung möglich.`);
    const guids = new Set(b.elemente.map((e) => e.guid));
    if (guids.size !== b.elemente.length) {
      fehler.push(`Bauteil-GUIDs sind nicht eindeutig (${b.elemente.length} Sätze, ${guids.size} GUIDs).`);
    }
    // Nachweis-GUIDs müssen im Modellstand vorkommen, sonst zeigt das LV ins Leere.
    let fehlend = 0;
    for (const p of b.positionen) {
      for (const g of arr(p.nachweis_element_ids)) if (!guids.has(g)) fehlend += 1;
    }
    if (fehlend) {
      warnungen.push(`${fehlend} Nachweis-GUIDs kommen im mitgelieferten Modellstand nicht vor.`);
    }
  }

  // --- Selbstauskunft des Erzeugers ------------------------------------------
  for (const u of arr(b.unvollstaendig)) {
    warnungen.push(`Das Bundle meldet sich selbst als unvollständig: ${typeof u === "string" ? u : JSON.stringify(u)}`);
  }

  const zusammenfassung = {
    projekt: b.project?.name ?? null,
    lose: b.lose.length,
    positionen: b.positionen.length,
    regeln: b.regeln.length,
    filter: b.filter.length,
    elemente: b.elemente.length,
    preisschichten: b.preisschichten.length,
    vertraege: b.vertraege.length,
    vertragspositionen: b.vertragspositionen.length,
    aenderungen: b.aenderungen.length,
    deckung: b.deckung.length,
    luecken: b.luecken.length,
    kataloge: Object.keys(b.kataloge).length,
    modi,
    schreibvorgaenge_geschaetzt: geschaetzteStapel(b),
  };

  return { ok: fehler.length === 0, fehler, warnungen, zusammenfassung };
}

/** Wie viele Stapel-Schreibvorgänge der Import braucht (für den Bericht). */
export function geschaetzteStapel(bundle) {
  let n = bundle.project ? 1 : 0;
  if (bundle.snapshot) n += 1;
  if (bundle.elemente.length) n += 1; // ein einziger Blob-Schreibvorgang
  for (const abschnitt of ["lose", "filter", "positionen", "regeln", "preisschichten",
    "vertraege", "vertragspositionen", "aenderungen", "deckung", "luecken"]) {
    n += Math.ceil(bundle[abschnitt].length / STAPEL);
  }
  for (const zeilen of Object.values(bundle.kataloge)) n += Math.ceil(arr(zeilen).length / STAPEL);
  return n;
}

/** Liste in Stapel à `groesse` schneiden. */
export function stapeln(liste, groesse = STAPEL) {
  const out = [];
  for (let i = 0; i < liste.length; i += groesse) out.push(liste.slice(i, i + groesse));
  return out;
}

/**
 * SCHREIBEN — erst nach bestandenem Trockenlauf und ausdrücklicher Bestätigung.
 *
 * @param {object} bundle Ergebnis von `parseBundle`
 * @param {{bulkCreate: (entity, records) => Promise<any>,
 *          createOne: (entity, record) => Promise<any>,
 *          putBlob: (id, json) => Promise<any>,
 *          onProgress?: (text: string, anteil: number) => void}} io
 * @param {{bestaetigt?: boolean, projektId?: string|null}} [opt]
 * @returns {Promise<{ok: boolean, abgebrochen: boolean, geschrieben: object,
 *                    fehler: string[], projektId: string|null, bericht: object}>}
 */
export async function applyBundle(bundle, io, opt = {}) {
  const bericht = validateBundle(bundle);
  if (!bericht.ok) {
    return {
      ok: false, abgebrochen: true, geschrieben: {}, projektId: null,
      fehler: ["Trockenlauf nicht bestanden — es wurde NICHTS geschrieben.", ...bericht.fehler],
      bericht,
    };
  }
  if (!opt.bestaetigt) {
    return {
      ok: false, abgebrochen: true, geschrieben: {}, projektId: null,
      fehler: ["Nicht bestätigt — es wurde NICHTS geschrieben."],
      bericht,
    };
  }

  const fortschritt = typeof io.onProgress === "function" ? io.onProgress : () => {};
  const geschrieben = {};
  const fehler = [];
  let projektId = opt.projektId ?? null;
  let schritt = 0;
  const schritte = SCHREIB_REIHENFOLGE.length;

  const melde = (text) => {
    schritt += 1;
    fortschritt(text, schritt / schritte);
  };

  try {
    // 1. Kataloge (büroweit, ohne project_id) — alles andere verweist darauf.
    melde("Kataloge…");
    for (const [entity, zeilen] of Object.entries(bundle.kataloge)) {
      let n = 0;
      for (const stapel of stapeln(arr(zeilen))) {
        await io.bulkCreate(entity, stapel);
        n += stapel.length;
      }
      if (n) geschrieben[entity] = (geschrieben[entity] || 0) + n;
    }

    // 2. Projekt — liefert die id, an der alles Weitere hängt.
    melde("Projekt…");
    const projekt = await io.createOne("Project", bundle.project);
    projektId = projekt?.id ?? projektId;
    if (!projektId) throw new Error("Das Projekt wurde ohne id angelegt — Abbruch vor allen Kindsätzen.");
    geschrieben.Project = 1;

    const mitProjekt = (rows) => rows.map((r) => ({ ...r, project_id: projektId }));

    // 3. Lose
    melde("Lose…");
    await schreibe("lose", mitProjekt(bundle.lose));

    // 4. Modellstand + Bauteile (Blob, NICHT als Entitäten)
    if (bundle.snapshot) {
      melde("Modellstand…");
      const blobId = `elemente-${projektId}`.replace(/[^A-Za-z0-9_-]/g, "-");
      const snap = await io.createOne("BimSnapshot", {
        ...bundle.snapshot,
        project_id: projektId,
        elemente_blob: bundle.elemente.length ? blobId : null,
        anzahl: bundle.elemente.length,
      });
      geschrieben.BimSnapshot = 1;
      if (bundle.elemente.length) {
        melde(`${bundle.elemente.length} Bauteile (Blob)…`);
        await io.putBlob(blobId, {
          snapshot_id: snap?.id ?? blobId,
          project_id: projektId,
          anzahl: bundle.elemente.length,
          elemente: bundle.elemente,
        });
        geschrieben.BimElementBlob = bundle.elemente.length;
      }
    } else {
      melde("Modellstand… (keiner im Bundle)");
    }

    // 5. Filter VOR den Positionen — `filter_ref` zeigt darauf.
    melde("Filter…");
    await schreibe("filter", mitProjekt(bundle.filter));

    // 6. Positionen
    melde("LV-Positionen…");
    await schreibe("positionen", mitProjekt(bundle.positionen));

    // 7. Regeln (zeigen auf Positionen)
    melde("Mengenregeln…");
    await schreibe("regeln", mitProjekt(bundle.regeln));

    // 8. Preisschichten
    melde("Preisschichten…");
    await schreibe("preisschichten", mitProjekt(bundle.preisschichten));

    // 9. Verträge, Vertragspositionen, Änderungen
    melde("Verträge…");
    await schreibe("vertraege", mitProjekt(bundle.vertraege));
    melde("Vertragspositionen…");
    await schreibe("vertragspositionen", mitProjekt(bundle.vertragspositionen));
    melde("Nachträge…");
    await schreibe("aenderungen", mitProjekt(bundle.aenderungen));

    // 10. Deckung und Modell-Lücken
    melde("Deckung…");
    await schreibe("deckung", mitProjekt(bundle.deckung));
    melde("Modell-Lücken…");
    await schreibe("luecken", mitProjekt(bundle.luecken));

    return { ok: true, abgebrochen: false, geschrieben, fehler, projektId, bericht };
  } catch (err) {
    // ABBRUCH MIT BERICHT statt stillem Teilzustand: der Aufrufer erfährt genau,
    // was schon in der DB steht, damit er es gezielt entfernen kann.
    fehler.push(String(err?.message || err));
    return { ok: false, abgebrochen: true, geschrieben, fehler, projektId, bericht };
  }

  async function schreibe(abschnitt, rows) {
    const entity = ENTITAET[abschnitt];
    if (!entity || rows.length === 0) return;
    let n = 0;
    for (const stapel of stapeln(rows)) {
      await io.bulkCreate(entity, stapel);
      n += stapel.length;
    }
    geschrieben[entity] = (geschrieben[entity] || 0) + n;
  }
}

/**
 * `io`-Implementierung gegen die lokale API. Bewusst NICHT im Modulkopf verdrahtet —
 * so bleibt `projectImport.js` isomorph und in `node --test` prüfbar.
 */
export function httpIo(basis = "/api", { onProgress = null } = {}) {
  const senden = async (pfad, methode, body) => {
    const res = await fetch(`${basis}${pfad}`, {
      method: methode,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      let text = "";
      try { text = (await res.json())?.error || ""; } catch { /* ohne Detail */ }
      throw new Error(`${methode} ${pfad} → HTTP ${res.status}${text ? `: ${text}` : ""}`);
    }
    return res.json();
  };
  return {
    // Der Bulk-Endpunkt braucht das Suffix `/bulk` — ohne trifft man die normale
    // Create-Route und schreibt EINEN Satz statt 500.
    bulkCreate: (entity, records) => senden(`/entities/${entity}/bulk`, "POST", { records }),
    createOne: (entity, record) => senden(`/entities/${entity}`, "POST", record),
    // 57-02 (key_link projectImport.js:437): Blobs laufen über bitApi.blobs —
    // EINE Datenschicht statt eines eigenen /blobs-fetch. Im Express-Weg ist das
    // derselbe PUT /api/blobs/:id (bitApi nutzt API_BASE=/api), im Cloud-Weg
    // landet der Blob im Supabase-Storage der eigenen Org. Lazy import, damit
    // dieses Modul weiterhin isomorph und bundlerfrei testbar bleibt.
    putBlob: async (id, json) => {
      const { bitApi } = await import("@core/api/bitApi");
      return bitApi.blobs.put(id, json);
    },
    onProgress,
  };
}
