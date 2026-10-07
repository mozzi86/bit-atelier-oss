// personalLeck.test.js — the leak guard for the "personal" storage class
// (Plan 80-02, DS-07/DS-08): everywhere the four HR-only names
// (bitApi.personal, PERSONAL_ENTITAETEN, personalDb, personalDatei) may
// legitimately appear is an explicit allowlist; every other source file that
// mentions one of them is a leak — most dangerously into the AI/harness/
// telemetry/integrations/command-palette/error-report code, which is exactly
// the code that sends data somewhere else (Art. 22 DSGVO — no automated
// decision on a person; KI-VO Anh. III Nr. 4 — no AI employment scoring).
//
// A file that does not exist yet is not a leak (80-01 builds Settings in
// parallel; 80-04/80-06/80-08/80-09 build the people/** UI after this plan) —
// every scan below tolerates missing directories.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REPO = path.resolve(import.meta.dirname, '../..');
const CODE_EXT = /\.(jsx?|mjs)$/;
/** The four HR-only names. */
const MUSTER = /bitApi\.personal|PERSONAL_ENTITAETEN|personalDb|personalDatei/;

/** Paths (relative, POSIX-slashed, repo-root-relative) allowed to mention the pattern. */
const ALLOWLIST_MUSTER = [
  /^src\/components\/people\//,
  /^src\/lib\/people\//,
  /^src\/pages\/People\.jsx$/,
  /^src\/components\/settings\/PersonalBereich\.jsx$/,
  /^packages\/nova-core\/src\/api\/(bitApi|demoIdb|personalEntitaeten|personalDb|personalDatei)\.js$/,
  /^packages\/nova-core\/server\/(routes|personalRouter)\.js$/,
  /^server\/index\.js$/,
  /^scripts\/supabase-import\.mjs$/,
];

/** @param {string} relPosix @returns {boolean} */
function istErlaubt(relPosix) {
  return ALLOWLIST_MUSTER.some((m) => m.test(relPosix));
}

/**
 * Every js/jsx/mjs file under one directory, recursively. `[]` when the
 * directory does not exist (never an error — see file header).
 * @param {string} absOrdner
 * @returns {string[]} absolute paths
 */
function dateienUnter(absOrdner) {
  if (!fs.existsSync(absOrdner)) return [];
  const dateien = [];
  const laufe = (ordner) => {
    for (const eintrag of fs.readdirSync(ordner, { withFileTypes: true })) {
      if (eintrag.name === 'node_modules') continue;
      const p = path.join(ordner, eintrag.name);
      if (eintrag.isDirectory()) laufe(p);
      else if (CODE_EXT.test(eintrag.name)) dateien.push(p);
    }
  };
  laufe(absOrdner);
  return dateien;
}

/**
 * Every source file the scan covers: src/**, packages/*\/src/**,
 * packages/nova-core/server/**, server/**, scripts/** (js/jsx/mjs).
 * @param {string} root repo root (a real repo, or a synthetic temp tree for the self-test)
 * @returns {string[]} absolute paths
 */
function alleQuelldateien(root) {
  const dateien = [
    ...dateienUnter(path.join(root, 'src')),
    ...dateienUnter(path.join(root, 'server')),
    ...dateienUnter(path.join(root, 'scripts')),
    ...dateienUnter(path.join(root, 'packages', 'nova-core', 'server')),
  ];
  const paketeOrdner = path.join(root, 'packages');
  if (fs.existsSync(paketeOrdner)) {
    for (const paket of fs.readdirSync(paketeOrdner)) {
      dateien.push(...dateienUnter(path.join(paketeOrdner, paket, 'src')));
    }
  }
  return dateien;
}

/**
 * Files outside the allowlist whose text matches MUSTER.
 * @param {string} root
 * @returns {string[]} paths relative to `root`, POSIX-slashed
 */
function nichtErlaubteTreffer(root) {
  const treffer = [];
  for (const abs of alleQuelldateien(root)) {
    const rel = path.relative(root, abs).replace(/\\/g, '/');
    if (istErlaubt(rel)) continue;
    if (MUSTER.test(fs.readFileSync(abs, 'utf8'))) treffer.push(rel);
  }
  return treffer;
}

describe('personalLeck — Allowlist-Wächter (DS-07/DS-08)', () => {
  it('0 Treffer außerhalb der Allowlist', () => {
    const treffer = nichtErlaubteTreffer(REPO);
    assert.deepEqual(treffer, [], 'Personal-Bezug außerhalb der Allowlist:\n' + treffer.join('\n'));
  });

  it('0 Treffer in den ausdrücklich verbotenen Pfaden (KI, Harness, Telemetrie, Integrationen, Palette, Fehlerbericht)', () => {
    const VERBOTENE_PFADE = [
      'src/components/ai',
      'src/components/kitool',
      'src/lib/harnessClient.js',
      'src/lib/telemetry.js',
      'packages/nova-core/src/integrations',
      'src/components/Befehlspalette.jsx',
      'packages/nova-core/src/lib/fehlerbericht.js',
      // The demo usage log (src/demo) went with the demo in 83-02.
      'packages/nova-core/src/lib/feedback.js',
    ];
    const treffer = [];
    for (const rel of VERBOTENE_PFADE) {
      const abs = path.join(REPO, rel);
      if (!fs.existsSync(abs)) continue;
      const dateien = fs.statSync(abs).isDirectory() ? dateienUnter(abs) : (CODE_EXT.test(abs) ? [abs] : []);
      for (const d of dateien) {
        if (MUSTER.test(fs.readFileSync(d, 'utf8'))) treffer.push(path.relative(REPO, d).replace(/\\/g, '/'));
      }
    }
    assert.deepEqual(treffer, []);
  });

  it('src/{components,lib}/people/**: 0× AuditLog, 0× fetch( — Personal schreibt kein Projekt-Audit und sendet nichts direkt', () => {
    const dateien = [
      ...dateienUnter(path.join(REPO, 'src', 'components', 'people')),
      ...dateienUnter(path.join(REPO, 'src', 'lib', 'people')),
    ];
    const auditTreffer = [];
    const fetchTreffer = [];
    for (const abs of dateien) {
      const rel = path.relative(REPO, abs).replace(/\\/g, '/');
      const text = fs.readFileSync(abs, 'utf8');
      if (/AuditLog/.test(text)) auditTreffer.push(rel);
      if (/fetch\(/.test(text)) fetchTreffer.push(rel);
    }
    assert.deepEqual(auditTreffer, []);
    assert.deepEqual(fetchTreffer, []);
  });

  // Plan 80-08, Task 6, Behavior 11: keine KI-Bewertung von Bewerbungen
  // (Art. 22 DSGVO, KI-VO Anh. III Nr. 4) und kein Versand aus der App heraus
  // (externe Kommunikation bräuchte eine eigene Freigabe) — Muster wie oben,
  // eigener Regex für den Recruiting-Reiter.
  it('Personal-Pfade: 0× invokeLLM/InvokeLLM, 0 Importe aus KI-/Harness-/Integrations-Modulen, 0× mailto: (DS-08)', () => {
    const KI_MUSTER = /invokeLLM|InvokeLLM/;
    const IMPORT_MUSTER = /@core\/integrations|src\/components\/ai|src\/lib\/harnessClient/;
    const MAILTO_MUSTER = /mailto:/;
    const dateien = [
      ...dateienUnter(path.join(REPO, 'src', 'components', 'people')),
      ...dateienUnter(path.join(REPO, 'src', 'lib', 'people')),
    ];
    /** @type {string[]} */
    const treffer = [];
    for (const abs of dateien) {
      const rel = path.relative(REPO, abs).replace(/\\/g, '/');
      const text = fs.readFileSync(abs, 'utf8');
      if (KI_MUSTER.test(text) || IMPORT_MUSTER.test(text) || MAILTO_MUSTER.test(text)) treffer.push(rel);
    }
    assert.deepEqual(treffer, [], 'KI-/Harness-/Integrations-Bezug oder mailto: in Personal-Pfaden:\n' + treffer.join('\n'));
  });

  it('Selbsttest: der DS-08-Scanner findet einen Fixture-Treffer (mailto:) in src/components/people', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bit-atelier-ds08-selbsttest-'));
    try {
      const zielOrdner = path.join(tmp, 'src', 'components', 'people');
      fs.mkdirSync(zielOrdner, { recursive: true });
      fs.writeFileSync(path.join(zielOrdner, 'x.jsx'), 'const href = "mailto:test@example.org";\n', 'utf-8');
      const abs = path.join(zielOrdner, 'x.jsx');
      const text = fs.readFileSync(abs, 'utf8');
      assert.match(text, /mailto:/, 'der Scanner muss den Fixture-Treffer finden, sonst ist er wertlos');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('src/{components,lib}/people: kein @hello-pangea/dnd (Objective 80-08 — kein Drag&Drop in v1)', () => {
    const dateien = [
      ...dateienUnter(path.join(REPO, 'src', 'components', 'people')),
      ...dateienUnter(path.join(REPO, 'src', 'lib', 'people')),
    ];
    const treffer = dateien
      .filter((abs) => /@hello-pangea\/dnd/.test(fs.readFileSync(abs, 'utf8')))
      .map((abs) => path.relative(REPO, abs).replace(/\\/g, '/'));
    assert.deepEqual(treffer, []);
  });

  it('Selbsttest: ein Treffer außerhalb der Allowlist (z. B. src/components/ai/x.jsx) wird gemeldet', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bit-atelier-personal-leck-selbsttest-'));
    try {
      const zielOrdner = path.join(tmp, 'src', 'components', 'ai');
      fs.mkdirSync(zielOrdner, { recursive: true });
      fs.writeFileSync(
        path.join(zielOrdner, 'x.jsx'),
        "import { personalDb } from '@core/api/personalDb.js';\n",
        'utf-8'
      );
      const treffer = nichtErlaubteTreffer(tmp);
      assert.equal(treffer.length, 1, 'der Scanner muss den Fixture-Treffer finden, sonst ist er wertlos');
      assert.match(treffer[0], /x\.jsx$/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
