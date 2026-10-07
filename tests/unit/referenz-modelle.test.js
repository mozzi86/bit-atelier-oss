// Phase 71-01: die erzeugte IDS am ECHTEN Modell des Referenzprojekts — und
// ihr Drift-Schutz.
//
// Drei Teile:
// 1. IMMER (ohne externe Daten): kein Projektmodell ist eingecheckt
//    (T-71-02, NDA).
// 2. NUR mit BIT_NDA_DIR (tools/nda.mjs): die archivierte IDS driftet nicht
//    gegen die Erzeugung (T-71-03, Muster beispielmodell.test.js:30-36). Die
//    LOI-Tabelle, die IDS und der BAP-Regelsatz sind Kundenmaterial und liegen
//    seit Plan 83-01 im NDA-Archiv, nicht mehr im Repo.
// 3. NUR mit BIT_NDA_DIR UND BIT_REFERENZ_MODELLE: Lauf der LOI-Spezifikationen
//    gegen das echte TX-Tragwerksmodell (web-ifc unter Node, Muster
//    beispielmodell.test.js:48-54). Fehlt eine Variable -> skip MIT Meldung —
//    niemals hart fehlschlagen.
//
// Die Spezifikationen kommen aus loiZuSpezifikationen, NICHT aus der IDS-Datei:
// parseIdsXml braucht einen DOMParser, den Node nicht hat (ids.js:234-238).
// Derselben Logik folgt die Prüf-Suite im Browser — die evaluateIds-Speiseform
// ist identisch (idsWriter.test.js beweist den Weg Writer -> evaluateIds).
//
// Start mit Modellen (PowerShell); der Modellordner steht im Archiv unter
// nda-konfig.json → werte.modellOrdnerHinweis:
//   $env:BIT_NDA_DIR = "C:/Users/<you>/bit-atelier-archiv/nda-2026-10-06"
//   $env:BIT_REFERENZ_MODELLE = "<Modellordner, Vorwärtsschrägstriche>"
//   npm run test:unit -- tests/unit/referenz-modelle.test.js
// WICHTIG: Vorwärtsschrägstriche im Pfad — "\0" in einem Ordnernamen wie
// "00_…" wird im JS-String sonst zum Null-Byte (71-RESEARCH §5).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';

import { parseLoiCsv, loiZuSpezifikationen } from '@ifc/lib/loiListe.js';
import { evaluateIds } from '@ifc/lib/ids.js';
import { loiZuIdsXml, ROHBAU_BLAETTER } from '../../tools/loi-zu-ids.mjs';
import { NDA_FEHLT, ndaPfad, ndaWert } from '../../tools/nda.mjs';

const require = createRequire(import.meta.url);
const REPO = path.resolve(import.meta.dirname, '../..');
const IDS_DATEI = ndaPfad('rohbauIds');
const LOI_CSV = ndaPfad('loiCsv');
// Pset prefix of the client's property scheme (a project value, not code).
const PSET = ndaWert('loiPset');

// Der Modellordner des Auftraggebers (NDA — nie ins Repo). Slash-Form ist Pflicht:
// process.env liefert den Pfad so, wie die Variable gesetzt wurde; ein
// Windows-Pfad mit "\0..." wäre schon beim Setzen ein Null-Byte-Problem.
const MODELLE = (process.env.BIT_REFERENZ_MODELLE || '').replace(/\\/g, '/');
const TX_DATEI = ndaWert('modellTx');
const AX_DATEI = ndaWert('modellAx');
const SKIP_MELDUNG = NDA_FEHLT || (MODELLE
  ? false
  : 'BIT_REFERENZ_MODELLE nicht gesetzt — der Modellordner steht im NDA-Archiv '
    + '(nda-konfig.json → werte.modellOrdnerHinweis); nie ins Repo kopieren. '
    + 'Variable mit Vorwärtsschrägstrichen setzen (71-RESEARCH §1.1).');

describe('Projektmodelle — NDA-Schutz (läuft immer)', () => {
  it('kein Projektmodell ist eingecheckt (T-71-02, NDA)', () => {
    const tracked = execSync('git ls-files', { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
      .split('\n')
      .filter(Boolean);
    // Files following the client's naming convention (discipline code + _FM_)
    // are project models by definition, whatever the building number is.
    const verdaechtig = tracked.filter((f) => /_TX_FM_|_AX_FM_|_AF_FM_|_GG_FM_/i.test(f));
    assert.deepEqual(verdaechtig, [], 'NDA-Modell im Repo: ' + verdaechtig.join(', '));
    // Alle eingecheckten .ifc sind bekannte SYNTHETISCHE Modelle/fixtures:
    // public/beispiel (Demo), tests/e2e/fixtures (mini.ifc), harness/examples
    // (efh.ifc aus 67-03, generiert). Alles andere wäre NDA-Material.
    const ifcs = tracked.filter((f) => f.toLowerCase().endsWith('.ifc'));
    for (const f of ifcs) {
      assert.ok(
        f.startsWith('public/beispiel/')
        || f.startsWith('tests/e2e/fixtures/')
        || f.startsWith('harness/examples/'),
        `unerwartete .ifc im Repo: ${f}`,
      );
    }
  });
});

describe('Archiv-IDS — Drift-Schutz (nur mit BIT_NDA_DIR)', { skip: NDA_FEHLT }, () => {
  it('die eingecheckte IDS ist byte-identisch mit der Erzeugung (T-71-03)', () => {
    assert.ok(fs.existsSync(LOI_CSV), `LOI-CSV fehlt: ${LOI_CSV}`);
    assert.ok(fs.existsSync(IDS_DATEI), `IDS fehlt: ${IDS_DATEI} — node tools/loi-zu-ids.mjs`);
    const csvText = fs.readFileSync(LOI_CSV, 'utf8');
    const { xml } = loiZuIdsXml(csvText, { lph: 5, blaetter: ROHBAU_BLAETTER, texte: ndaWert('loiIdsTexte') });
    assert.equal(
      fs.readFileSync(IDS_DATEI, 'utf8'),
      xml,
      'Die Archiv-IDS weicht vom Generator ab — neu erzeugen: node tools/loi-zu-ids.mjs',
    );
  });

  it('sieben Spezifikationen, jede mit GlobalId-Attribut und Projekt-Pset-Merkmalen', () => {
    const loi = parseLoiCsv(fs.readFileSync(LOI_CSV, 'utf8'));
    const { spezifikationen } = loiZuSpezifikationen(loi, { lph: 5, blaetter: ROHBAU_BLAETTER });
    assert.equal(spezifikationen.length, 7);
    // Reihenfolge = LOI-Blattreihenfolge (Fassade steht in der CSV zuerst).
    assert.deepEqual(
      spezifikationen.map((s) => s.name),
      ['Fassade', 'Wand', 'Stützen', 'Decken', 'Träger', 'Treppenpodeste', 'Treppen'],
    );
    for (const s of spezifikationen) {
      const namen = s.requirements.map((r) => (r.typ === 'attribute'
        ? r.name.wert : `${r.propertySet.wert}.${r.baseName.wert}`));
      assert.ok(namen.includes('GlobalId'), `${s.name}: GlobalId fehlt`);
      assert.ok(namen.some((n) => n.startsWith(`${PSET}.`)), `${s.name}: kein Projekt-Pset-Merkmal`);
    }
  });
});

describe('LOI-Prüfung am echten TX-Modell (nur mit BIT_NDA_DIR + BIT_REFERENZ_MODELLE)', { skip: SKIP_MELDUNG }, () => {
  let ergebnisse = null;
  let dauerMs = 0;

  it('TX-Modell öffnet, Spezifikationen werden ausgewertet, Zahlen protokolliert', async (t) => {
    const txPfad = `${MODELLE}/${TX_DATEI}`;
    assert.ok(fs.existsSync(txPfad), `TX-Modell fehlt: ${txPfad}`);

    const start = Date.now();
    const WebIFC = require('web-ifc');
    const api = new WebIFC.IfcAPI();
    await api.Init();
    const modelID = api.OpenModel(new Uint8Array(fs.readFileSync(txPfad)), {
      // Forschung §1.4: für den Einzelmodell-Lauf irrelevant, aber
      // unzentriert lässt die Koordinaten vergleichbar (D-P71-05 für 71-02).
      COORDINATE_TO_ORIGIN: false,
    });
    assert.ok(modelID >= 0, 'web-ifc konnte das TX-Modell nicht öffnen');

    const ifcImport = await import('@ifc/lib/ifcImport.js');
    const meta = ifcImport.extractFromModel(api, modelID);
    api.CloseModel(modelID);

    // Elementliste in die evaluateIds-Form mappen (derselbe Fix wie Task 3 in
    // ModelCheck.jsx: guid/klassifikation[] statt globalId/classification).
    const elemente = (meta.elements || []).map((el) => ({
      globalId: el.guid ?? undefined,
      ifcType: el.ifcType,
      name: el.name,
      attributes: {},
      psets: el.psets || {},
      classification: null,
      material: el.materials || [],
    }));

    const loi = parseLoiCsv(fs.readFileSync(LOI_CSV, 'utf8'));
    const { spezifikationen } = loiZuSpezifikationen(loi, { lph: 5, blaetter: ROHBAU_BLAETTER });
    ergebnisse = evaluateIds(spezifikationen, elemente);
    dauerMs = Date.now() - start;

    // Protokoll-Tabelle — diese Zahlen gehen in die SUMMARY (Arbeitsliste Referenzprojekt).
    console.log('\n  Spezifikation      anwendbar  verletzt  Verletzungen');
    for (const r of ergebnisse) {
      console.log(
        `  ${r.spec.name.padEnd(18)} ${String(r.anwendbar).padStart(8)}  ${r.bestanden ? '       –' : String(r.verletzungen.length).padStart(8)}`,
      );
    }
    console.log(`  Elemente gesamt: ${elemente.length} · Dauer: ${(dauerMs / 1000).toFixed(1)} s\n`);
    assert.ok(dauerMs < 60_000, `Laufzeit ${dauerMs} ms über 60 s`);
  });

  it('die Wand-Spec trifft IFCWALLSTANDARDCASE — 367 Elemente (71-RESEARCH §1.2)', () => {
    assert.ok(ergebnisse, 'Vorlauf fehlgeschlagen');
    const wand = ergebnisse.find((r) => r.spec.name === 'Wand');
    assert.ok(wand, 'Spec „Wand" fehlt');
    // IfcOpenShell zählte 367 IfcWallStandardCase (TX); extractFromModel
    // sammelt dieselbe Klasse — Abweichungen wären ein Import-Befund.
    assert.equal(wand.anwendbar, 367, 'anwendbare Wände ≠ Messwert 367');
  });

  it('mindestens eine Verletzung insgesamt — das ist die Arbeitsliste, kein Fehler', () => {
    assert.ok(ergebnisse, 'Vorlauf fehlgeschlagen');
    const gesamt = ergebnisse.reduce((n, r) => n + r.verletzungen.length, 0);
    assert.ok(gesamt >= 1, '0 Verletzungen insgesamt — unplausibel für ein Fremdmodell');
    // Die Plan-Wahrheit: viele Verstöße sind ERWARTET (die LOI ist strenger als
    // das Koordinationsmodell). Verletzungen tragen GlobalIds (Mapping-Fix):
    const mitGuid = ergebnisse.flatMap((r) => r.verletzungen)
      .filter((v) => typeof v.globalId === 'string' && v.globalId.length === 22);
    assert.ok(mitGuid.length > 0, 'keine Verletzung mit 22-stelliger GlobalId');
  });

  it('GlobalId-Attribut ist im TX-Modell erfüllt (IfcOpenShell: 112.755 GUIDs, keine Dubletten)', () => {
    assert.ok(ergebnisse, 'Vorlauf fehlgeschlagen');
    // Jede Spec fordert GlobalId; im TX-Modell trägt jedes Bauteil eine —
    // Verletzungen dagegen wären ein Import-Befund, kein Modell-Befund.
    for (const r of ergebnisse) {
      const guidFehler = r.verletzungen.filter((v) => v.facette === 'attribute');
      assert.equal(guidFehler.length, 0,
        `${r.spec.name}: ${guidFehler.length} GlobalId-Verletzungen — Import prüfenswert`);
    }
  });
});


// --- 71-02 Task 3: Zwei-Modell-Lauf am echten Paar TX + AX ------------------
// Die offene Frage aus 71-RESEARCH §1.5: das Placement des Koordinations-
// körpers differiert 1,5 m in z (TX −10,80 / AX −9,30). Ob die GEOMETRIE das
// ausgleicht, misst dieser Lauf — die Zahl geht in die 71-02-SUMMARY und ist
// der erste mögliche Befund an den Bauherrn.
//
// Beide Modelle UNZENTRIERT (D-P71-05) mit web-ifc OpenModel +
// extractFromModel-Äquivalent: hier direkt StreamAllMeshes wie in
// beispielmodell.test.js (extractGeometry selbst braucht den Vite-WASM-Pfad).

describe('Zwei-Modell-Lauf TX + AX (nur mit BIT_NDA_DIR + BIT_REFERENZ_MODELLE)', { skip: SKIP_MELDUNG }, () => {
  /**
   * Geometrie-Elemente eines Modells UNZENTRIERT per StreamAllMeshes.
   * @param {string} pfad
   * @returns {Promise<{elemente: Array, dauerMs: number, rssMb: number}>}
   */
  async function geometrieLaden(pfad) {
    const { aabbOf } = await import('@ifc/lib/clash.js');
    const WebIFC = require('web-ifc');
    const api = new WebIFC.IfcAPI();
    await api.Init();
    const start = Date.now();
    const modelID = api.OpenModel(new Uint8Array(fs.readFileSync(pfad)), {
      COORDINATE_TO_ORIGIN: false,   // D-P71-05: gemeinsames Koordinatensystem
    });
    assert.ok(modelID >= 0, `web-ifc konnte ${pfad} nicht öffnen`);
    const elemente = [];
    api.StreamAllMeshes(modelID, (mesh) => {
      const alle = [];
      for (let i = 0; i < mesh.geometries.size(); i++) {
        const platziert = mesh.geometries.get(i);
        const geo = api.GetGeometry(modelID, platziert.geometryExpressID);
        const verts = api.GetVertexArray(geo.GetVertexData(), geo.GetVertexDataSize());
        const idx = api.GetIndexArray(geo.GetIndexData(), geo.GetIndexDataSize());
        if (typeof geo.delete === 'function') geo.delete();
        const m = platziert.flatTransformation;
        for (let k = 0; k < idx.length; k++) {
          const v = idx[k] * 6;
          const x = verts[v], y = verts[v + 1], z = verts[v + 2];
          alle.push(
            m[0] * x + m[4] * y + m[8] * z + m[12],
            m[1] * x + m[5] * y + m[9] * z + m[13],
            m[2] * x + m[6] * y + m[10] * z + m[14],
          );
        }
      }
      if (alle.length < 9) return;
      let ifcType = '';
      let name = '';
      let globalId = '';
      try {
        const line = api.GetLine(modelID, mesh.expressID);
        globalId = String(line?.GlobalId?.value ?? line?.GlobalId ?? '');
        name = String(line?.Name?.value ?? line?.Name ?? '');
        ifcType = api.GetNameFromTypeCode(api.GetLineType(modelID, mesh.expressID)) || '';
      } catch { /* Geometrie trotzdem behalten */ }
      const tris = new Float32Array(alle);
      // aabb ist Pflicht für findeKoordinationskoerper/vergleicheLage und
      // clash.js (sonst rechnet aabbOf je Paar — hier einmal je Element).
      elemente.push({
        expressId: mesh.expressID, globalId, ifcType, name,
        tris, aabb: aabbOf(tris),
      });
    });
    api.CloseModel(modelID);
    return {
      elemente,
      dauerMs: Date.now() - start,
      rssMb: Math.round(process.memoryUsage().rss / 1e6),
    };
  }

  let daten = null;

  it('beide Modelle laden unzentriert — Koordinationskörper in beiden', async () => {
    const tx = `${MODELLE}/${TX_DATEI}`;
    const ax = `${MODELLE}/${AX_DATEI}`;
    assert.ok(fs.existsSync(tx) && fs.existsSync(ax), 'TX oder AX fehlt im Modellordner');

    const geoTx = await geometrieLaden(tx);
    const geoAx = await geometrieLaden(ax);
    daten = { geoTx, geoAx };

    console.log(`\n  TX: ${geoTx.elemente.length} Geometrien, ${(geoTx.dauerMs / 1000).toFixed(1)} s, RSS ${geoTx.rssMb} MB`);
    console.log(`  AX: ${geoAx.elemente.length} Geometrien, ${(geoAx.dauerMs / 1000).toFixed(1)} s, RSS ${geoAx.rssMb} MB`);

    const { findeKoordinationskoerper: finde } = await import('@ifc/lib/koordinationskoerper.js');
    const kTx = finde(geoTx.elemente);
    const kAx = finde(geoAx.elemente);
    assert.ok(kTx, 'Koordinationskörper im TX nicht gefunden');
    assert.ok(kAx, 'Koordinationskörper im AX nicht gefunden');
    console.log(`  Koordinationskörper TX: ${kTx.name} · AX: ${kAx.name}`);
    daten.kTx = kTx;
    daten.kAx = kAx;
  });

  it('Lagevergleich: die gemessene Abweichung in mm (die offene Research-Frage)', async () => {
    assert.ok(daten, 'Vorlauf fehlgeschlagen');
    const { vergleicheLage: vergleiche } = await import('@ifc/lib/koordinationskoerper.js');
    const r = vergleiche(daten.kTx, daten.kAx, 0);
    // ACHTUNG: Die AABB des Koordinationskörpers kommt aus StreamAllMeshes in
    // der web-ifc-Welt (Y-up): z-IFC ist y-Welt. Der Lagevergleich misst die
    // Achsen der gelieferten Geometrie konsistent für beide Modelle — die
    // Zuordnung der Achsen-Namen ist dafür zweitrangig, die BETRÄGE stimmen.
    console.log(`  LAGEVERGLEICH Koordinationskörper: max ${r.maxMm} mm`);
    console.log(`    x ${r.abweichungMm?.x} mm · y ${r.abweichungMm?.y} mm · z ${r.abweichungMm?.z} mm`);
    console.log(`    bestanden (0 mm): ${r.bestanden} — ${r.grund || 'Lage gleich'}`);
    // Der Test urteilt NICHT über bestanden/nicht — die Zahl ist der Befund für
    // den Bauherrn und steht in der SUMMARY. Geprüft wird nur: messbar.
    assert.ok(r.maxMm !== null, 'Abweichung nicht messbar');
  });

  it('BAP-Regelsatz läuft über beide Modelle (Zahlen für die SUMMARY)', async () => {
    assert.ok(daten, 'Vorlauf fehlgeschlagen');
    const { clashPairs: pruefe } = await import('@ifc/lib/clash.js');
    const { ladeRegelsatz: lade, regelnZuOptionen: zuOpt } = await import('@ifc/lib/clashRegeln.js');
    const bap = JSON.parse(fs.readFileSync(ndaPfad('rohbauBap'), 'utf8'));
    const { regeln } = lade(bap);

    const elemente = [
      ...daten.geoTx.elemente.map((el, i) => ({ ...el, expressId: i + 1, quelle: 'A' })),
      ...daten.geoAx.elemente.map((el, i) => ({ ...el, expressId: 1_000_000 + i, quelle: 'B' })),
    ];
    const start = Date.now();
    const ergebnis = pruefe(elemente, zuOpt(regeln, { tolerance: 0.001, maxPairs: 500_000 }));
    const dauerMs = Date.now() - start;
    const rssMb = Math.round(process.memoryUsage().rss / 1e6);

    const jeArt = {};
    for (const c of ergebnis.clashes) jeArt[c.kind] = (jeArt[c.kind] || 0) + 1;
    const jeRegel = {};
    for (const c of ergebnis.clashes) {
      if (!c.regel) continue;
      jeRegel[c.regel.id] = (jeRegel[c.regel.id] || 0) + 1;
    }
    console.log(`\n  BAP-Lauf TX×AX: ${elemente.length} Elemente, ${dauerMs / 1000}s, RSS ${rssMb} MB`);
    console.log(`  geprüft: ${ergebnis.geprueft} · übersprungen: ${ergebnis.uebersprungen} · ohne Geometrie: ${ergebnis.ohneGeometrie}`);
    console.log('  Befunde je Art: ' + JSON.stringify(jeArt));
    console.log('  Befunde je Regel: ' + JSON.stringify(jeRegel));

    // Der Lauf muss durchkommen (kein Crash, Befunde vorhanden oder ehrlich 0).
    assert.ok(dauerMs >= 0);
    // Fundamente-Regeln: TX hat keine IfcFooting (71-RESEARCH §1.2) — die Zeilen
    // FUND-01..03 laufen gegen IfcSlab; dass sie anwendbar sind, zeigen die
    // Zahlen, nicht dieser Assert.
  });
});
