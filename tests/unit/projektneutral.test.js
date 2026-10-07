// Phase 78 hotfix (23.09.2026): nothing that ships may point to a real project,
// client or employer. Three guards:
// 1. building numbers are project data — validated by pattern, not by one
//    client's list (the office's own delivery names keep working);
// 2. stored Werkstatt units with the old preset name are pulled to the
//    catalogue name on load, a name the user chose is kept;
// 3. no tracked file — content or name — carries a real project, client,
//    person or employer name, nor a real IBAN. Since Plan 83-01 the block
//    list is hashed (sperrliste.sha256.json) and the guard scans the WHOLE
//    repository, not only public/** and the shipped sources.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { KATALOG, gebaeudeGueltig, pruefeDateiname } from '@ifc/lib/dateiname.js';
import { einheitenAnreichern } from '@designer/lib/werkstattDefaults.js';
import { WERKSTATT_TYPEN } from '@designer/lib/wohnungsTypen.js';
import { VERBOTENE_FELDER } from '@core/api/personalEntitaeten.js';
import {
  hashEintrag, findeTreffer, scanneDateien, offeneTreffer, getrackteDateien, echteIbans, NUR_DATEINAME,
} from '../../tools/sperrliste.mjs';

const REPO = path.resolve(import.meta.dirname, '../..');

describe('Gebäudenummer = Projektdatum (Muster statt Liste)', () => {
  it('Muster: fünf Ziffern, Bindestrich, zwei Ziffern oder XX', () => {
    for (const ok of ['00000-01', '12345-00', '98765-XX']) assert.equal(gebaeudeGueltig(ok), true, ok);
    for (const nein of ['1234-01', '12345-1', '12345-xx', '12345_01', '', null, undefined]) {
      assert.equal(gebaeudeGueltig(nein), false, String(nein));
    }
  });

  it('der mitgelieferte Katalog enthält nur neutrale Beispiele', () => {
    for (const g of KATALOG.gebaeude) {
      assert.match(g.wert, /^00000-/, g.wert);
      assert.match(g.text, /Beispiel/, g.text);
    }
  });

  it('jede musterkonforme Nummer ergibt einen gültigen Dateinamen', () => {
    const p = pruefeDateiname('P5_24680-02_TX_FM_XX_P_01.ifc');
    assert.equal(p.gueltig, true, p.fehler.join(' · '));
    const falsch = pruefeDateiname('P5_2468-02_TX_FM_XX_P_01.ifc');
    assert.equal(falsch.gueltig, false);
    assert.match(falsch.fehler.join(' '), /fünf Ziffern/);
  });
});

describe('Werkstatt: gespeicherte Alt-Einheiten bekommen den Katalognamen', () => {
  const typ = WERKSTATT_TYPEN.find((t) => t.key === 'hd-2zi');

  it('Alt-Gruppe + nur anderer Klammerzusatz → Katalogname und -gruppe', () => {
    const [e] = einheitenAnreichern([{ key: 'hd-2zi', name: '2-Zi/2P (Altname)', gruppe: 'altgruppe', flaeche_m2: 55 }]);
    assert.equal(e.name, typ.name);
    assert.equal(e.gruppe, typ.gruppe);
    assert.equal(e.flaeche_m2, 55, 'Nutzereingaben bleiben');
  });

  it('ein vom Nutzer vergebener Name bleibt stehen', () => {
    const [e] = einheitenAnreichern([{ key: 'hd-2zi', name: 'Gartenwohnung West', gruppe: 'altgruppe' }]);
    assert.equal(e.name, 'Gartenwohnung West');
    assert.equal(e.gruppe, typ.gruppe);
  });

  it('aktuelle Daten (Gruppe = Katalog) werden nicht angefasst', () => {
    const [e] = einheitenAnreichern([{ key: 'hd-2zi', name: '2-Zi/2P (Süd)', gruppe: typ.gruppe }]);
    assert.equal(e.name, '2-Zi/2P (Süd)');
  });
});

describe('Sperrliste: kein echter Projekt-, Kunden-, Personen- oder Arbeitgebername in irgendeiner getrackten Datei (83-01)', () => {
  // The block list is HASHED (sperrliste.sha256.json next to this file): per
  // entry the SHA-256 of the NFKC-normalised, lower-cased fragment, its length,
  // a 32-bit rolling hash as pre-filter and a whole-word flag. The plain list
  // and the replacement pairs live outside the repo
  // (.planning/tools/projektnamen.local.json, gitignored; copy in the NDA
  // archive). Extend it, never shorten — then regenerate the hash file with
  //   node .planning/tools/projektnamen-anwenden.mjs --hashes
  // Scanned: EVERY tracked file (git ls-files) — file name always, content of
  // every file except binary/compressed formats (tools/sperrliste.mjs →
  // NUR_DATEINAME: images, fonts, wasm, archives, pdf/xlsx), no size limit.
  const SPERRLISTE = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'sperrliste.sha256.json'), 'utf8'));

  /** @param {{datei: string, zeile: number, nr: number, art: string}} t */
  const zeile = (t) => `${t.datei}:${t.zeile || '-'} — Eintrag #${t.nr}${t.art === 'dateiname' ? ' (Dateiname)' : ''}`;

  it('die Hash-Datei trägt keinen Klartext: nur Nummer, Länge, SHA-256, Vorfilter, Wort-Flag', () => {
    assert.ok(SPERRLISTE.eintraege.length >= 42, `nur ${SPERRLISTE.eintraege.length} Einträge — Liste gekürzt?`);
    for (const e of SPERRLISTE.eintraege) {
      assert.deepEqual(Object.keys(e).sort(), ['laenge', 'nr', 'rk', 'sha256', 'wort'], `Eintrag #${e.nr}`);
      assert.match(e.sha256, /^[0-9a-f]{64}$/, `Eintrag #${e.nr}: kein SHA-256`);
      assert.ok(Number.isInteger(e.laenge) && e.laenge >= 3, `Eintrag #${e.nr}: Länge`);
      assert.ok(Number.isInteger(e.rk) && e.rk >= 0 && e.rk < 2 ** 32, `Eintrag #${e.nr}: Vorfilter`);
    }
    for (const a of SPERRLISTE.ausnahmen) {
      assert.ok(a.grund && a.grund.length > 20, `Ausnahme ${a.datei} #${a.nr} ohne Begründung`);
    }
  });

  it('alle getrackten Dateien (Inhalt und Dateiname) sind frei von der Sperrliste', () => {
    const dateien = getrackteDateien(REPO);
    // Sanity floor against a silently failing `git ls-files`: it must hold for the private
    // repository (~2,300 files) AND the public export (~1,100 files, Plan 83-04).
    assert.ok(dateien.length > 900, `nur ${dateien.length} getrackte Dateien gelesen — git ls-files prüfen`);
    const offen = offeneTreffer(scanneDateien(REPO, dateien, SPERRLISTE.eintraege), SPERRLISTE.ausnahmen);
    assert.deepEqual(
      offen.map(zeile), [],
      'Echter Name im Repo (Klartext steht in der lokalen Liste; ersetzen mit '
      + '`node .planning/tools/projektnamen-anwenden.mjs --anwenden`):\n' + offen.map(zeile).join('\n'),
    );
  });

  it('jede Ausnahme wird noch gebraucht (sonst aus der lokalen Liste streichen)', () => {
    for (const a of SPERRLISTE.ausnahmen) {
      const treffer = scanneDateien(REPO, [a.datei], SPERRLISTE.eintraege).filter((t) => t.nr === a.nr);
      assert.equal(treffer.length, a.anzahl, `Ausnahme ${a.datei} #${a.nr}: ${treffer.length} statt ${a.anzahl} Treffer`);
    }
  });

  it('keine IBAN mit gültiger Prüfsumme außer veröffentlichten Testwerten', () => {
    const funde = [];
    for (const datei of getrackteDateien(REPO)) {
      if (NUR_DATEINAME.test(datei)) continue;
      for (const iban of echteIbans(fs.readFileSync(path.join(REPO, datei), 'utf8'))) {
        funde.push(`${datei}: ${iban.slice(0, 4)}…${iban.slice(-4)}`);
      }
    }
    assert.deepEqual(funde, [], 'IBAN im Repo (keine Testwert-IBAN):\n' + funde.join('\n'));
  });

  // Counter-check with a harmless invented word whose hash the test builds
  // itself — never with a real name.
  const KUNSTWORT = 'Quarzwiebelturm';

  it('Gegenprobe: das Kunstwort wird gefunden — groß/klein, NFKC, mehrzeilig', () => {
    const e = hashEintrag({ nr: 999, fragment: KUNSTWORT });
    assert.deepEqual(findeTreffer('Zeile eins\nIm QUARZWIEBELTURM steht', [e]).map((t) => t.nr), [999]);
    assert.equal(findeTreffer('ｑｕａｒｚｗｉｅｂｅｌｔｕｒｍ', [e]).length, 1, 'Vollbreite-Zeichen falten per NFKC');
    assert.equal(findeTreffer('Quarzwiebelturmspitze', [e]).length, 1, 'Teilstring-Eintrag trifft auch im Wort');
    assert.equal(findeTreffer('Quarz wiebelturm', [e]).length, 0);
  });

  it('Gegenprobe: Wort-Einträge brauchen Wortgrenzen (kein Treffer in längeren Wörtern oder Base64)', () => {
    const w = hashEintrag({ nr: 998, fragment: 'Qzx', wort: true });
    assert.equal(findeTreffer('a-Qzx_b', [w]).length, 1);
    assert.equal(findeTreffer('xQzxy', [w]).length, 0);
    assert.equal(findeTreffer('sha512-ab+cQzx9Kd==', [w]).length, 0, 'Base64: Buchstabe→Ziffer ist keine Grenze');
    const n = hashEintrag({ nr: 997, fragment: '97531', wort: true });
    assert.equal(findeTreffer('preise_p97531_x', [n]).length, 1, 'Zahl direkt nach Buchstaben zählt');
    assert.equal(findeTreffer('1975310', [n]).length, 0);
  });

  it('Gegenprobe: der Wächter wird rot, sobald eine Probe-Datei das Fragment trägt (Inhalt und Dateiname)', () => {
    const liste = { eintraege: [hashEintrag({ nr: 999, fragment: KUNSTWORT })], ausnahmen: [] };
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sperrliste-probe-'));
    try {
      fs.writeFileSync(path.join(tmp, 'sauber.md'), '# nichts Auffälliges\n');
      assert.deepEqual(offeneTreffer(scanneDateien(tmp, ['sauber.md'], liste.eintraege), liste.ausnahmen), [], 'grün ohne Fragment');
      fs.writeFileSync(path.join(tmp, 'probe.json'), JSON.stringify({ ort: 'am quarzwiebelturm' }));
      fs.writeFileSync(path.join(tmp, 'Quarzwiebelturm.png'), new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
      const rot = offeneTreffer(scanneDateien(tmp, ['sauber.md', 'probe.json', 'Quarzwiebelturm.png'], liste.eintraege), liste.ausnahmen);
      assert.deepEqual(rot.map((t) => `${t.datei}:${t.art}`), ['probe.json:inhalt', 'Quarzwiebelturm.png:dateiname']);
      // an exception with the exact count turns the content hit green again
      const mitAusnahme = offeneTreffer(
        scanneDateien(tmp, ['probe.json'], liste.eintraege),
        [{ datei: 'probe.json', nr: 999, anzahl: 1, grund: 'Probe' }],
      );
      assert.deepEqual(mitAusnahme, []);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('Gegenprobe IBAN: gültige Prüfsumme wird gemeldet, Testwerte und Tippfehler nicht', () => {
    assert.deepEqual(echteIbans('IBAN DE89 3704 0044 0532 0130 00'), [], 'Lehrbuch-Testwert');
    assert.deepEqual(echteIbans('DE89370400440532013001'), [], 'Prüfsumme falsch');
    // a checksum-valid IBAN built here from an invented account number
    const konto = 'DE00' + '1234567890' + '0000000042';
    const rest = BigInt([...(konto.slice(4) + 'DE00')].map((c) => (/[A-Z]/.test(c) ? c.charCodeAt(0) - 55 : c)).join('')) % 97n;
    const iban = `DE${String(98n - rest).padStart(2, '0')}${konto.slice(4)}`;
    assert.deepEqual(echteIbans(`Konto: ${iban}`), [iban]);
  });
});

// Plan 80-02 (DS-06/DS-14): the personal (HR) sample data is fictional and
// carries none of the fields E-14 forbids — the same betreiberhoheit rule as
// above, plus the data-minimisation guard that has no equivalent for
// accounting/project data.
describe('Personal-Seed: erfunden und frei von VERBOTENE_FELDER (E-14, DS-06/DS-14)', () => {
  const PLATZHALTER_NACHNAMEN = ['Beispiel', 'Probe', 'Muster', 'Platzhalter', 'Vorlage', 'Testfall', 'Entwurf'];
  // P-001 is the 79 seed's owner "Inhaberin A" (bsp-g1) — the one deliberate
  // exception, carried over so the two seeds refer to the SAME person (80-02
  // Task 3, Abgleich mit 79).
  const ERLAUBTE_NACHNAMEN = [...PLATZHALTER_NACHNAMEN, 'A'];

  const personalSeed = JSON.parse(
    fs.readFileSync(path.join(REPO, 'packages/nova-core/src/api/personalSeed.json'), 'utf8')
  );

  /**
   * Every string in the seed that looks like an email address.
   * @param {unknown} wert
   * @returns {string[]}
   */
  function emailAdressen(wert) {
    if (typeof wert === 'string') return /@/.test(wert) ? [wert] : [];
    if (Array.isArray(wert)) return wert.flatMap(emailAdressen);
    if (wert && typeof wert === 'object') return Object.values(wert).flatMap(emailAdressen);
    return [];
  }

  /**
   * Keys anywhere in `wert` that match VERBOTENE_FELDER — case-insensitive
   * (`schwerbehinderung` AND `Schwerbehinderung` both count), so the guard
   * catches a field regardless of how it was capitalised.
   * @param {unknown} wert
   * @param {Set<string>} verbotenLower lower-cased VERBOTENE_FELDER
   * @param {string} pfad for the failure message
   * @returns {string[]}
   */
  function verboteneSchluesselTreffer(wert, verbotenLower, pfad = '') {
    if (Array.isArray(wert)) return wert.flatMap((v, i) => verboteneSchluesselTreffer(v, verbotenLower, `${pfad}[${i}]`));
    if (!wert || typeof wert !== 'object') return [];
    const treffer = [];
    for (const [k, v] of Object.entries(wert)) {
      if (verbotenLower.has(k.toLowerCase())) treffer.push(`${pfad}.${k}`);
      treffer.push(...verboteneSchluesselTreffer(v, verbotenLower, `${pfad}.${k}`));
    }
    return treffer;
  }

  it('alle E-Mails enden auf @example.org', () => {
    const adressen = emailAdressen(personalSeed);
    assert.ok(adressen.length > 5, `nur ${adressen.length} E-Mail-Adressen gefunden — Seed geändert?`);
    const falsche = adressen.filter((a) => !a.endsWith('@example.org'));
    assert.deepEqual(falsche, []);
  });

  it('jeder Nachname stammt aus der Platzhalterliste (plus „A" aus dem 79-Seed)', () => {
    const nachnamen = [
      ...personalSeed.Mitarbeiter.map((m) => m.nachname),
      ...personalSeed.Bewerbung.map((b) => b.nachname),
    ];
    assert.ok(nachnamen.length >= 8, `nur ${nachnamen.length} Nachnamen gefunden — Seed geändert?`);
    const fremde = nachnamen.filter((n) => !ERLAUBTE_NACHNAMEN.includes(n));
    assert.deepEqual(fremde, []);
  });

  it('0 Schlüssel aus VERBOTENE_FELDER im gesamten Seed (Tiefensuche, case-insensitive)', () => {
    const verbotenLower = new Set(VERBOTENE_FELDER.map((f) => f.toLowerCase()));
    const treffer = verboteneSchluesselTreffer(personalSeed, verbotenLower);
    assert.deepEqual(treffer, [], 'Verbotenes Feld im Personal-Seed:\n' + treffer.join('\n'));
  });

  it('Selbsttest: ein Fixture mit {privat:{schwerbehinderung:true}} wird gemeldet (der Scanner ist nicht wertlos)', () => {
    const verbotenLower = new Set(VERBOTENE_FELDER.map((f) => f.toLowerCase()));
    const treffer = verboteneSchluesselTreffer({ privat: { Schwerbehinderung: true } }, verbotenLower);
    assert.equal(treffer.length, 1);
    assert.match(treffer[0], /Schwerbehinderung/);
  });
});
