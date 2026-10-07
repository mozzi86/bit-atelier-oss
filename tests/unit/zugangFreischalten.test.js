// Unit tests for scripts/zugang-freischalten.mjs (Plan 83-02): manual approval of
// an access request. Runs against an in-memory stub of the Supabase client — no
// network, no real project. Covers: success (invite + new office + membership),
// idempotence (second run writes nothing), missing key (plain text, no secret in
// the message), dry run (no write method is ever called), and the argument rules.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { argsLesen, berichtZeilen, freischalten, umgebungLesen } from '../../scripts/zugang-freischalten.mjs';

const ORG_A = '11111111-1111-4111-8111-111111111111';

/**
 * In-memory stand-in for the parts of supabase-js the script uses:
 * auth.admin.listUsers / inviteUserByEmail and from(table) with
 * select/eq/maybeSingle/single/insert/update.
 * @param {{ nutzer?: Array<{id: string, email: string}>, orgs?: Array<{id: string, name: string}>,
 *   mitglieder?: Array<{user_id: string, org_id: string, role: string}>, nurLesen?: boolean,
 *   einladungMeldetVorhanden?: boolean }} [start]
 */
function stubClient(start = {}) {
  const daten = {
    nutzer: [...(start.nutzer || [])],
    orgs: [...(start.orgs || [])],
    org_members: [...(start.mitglieder || [])],
  };
  /** every write call, in order — the idempotence and dry-run tests count these */
  const schreibvorgaenge = [];
  let laufendeNr = 0;
  const schreiben = (was) => {
    if (start.nurLesen) throw new Error(`Schreibzugriff im Probelauf: ${was}`);
    schreibvorgaenge.push(was);
  };

  const auth = {
    admin: {
      async listUsers({ page = 1, perPage = 50 } = {}) {
        const von = (page - 1) * perPage;
        return { data: { users: daten.nutzer.slice(von, von + perPage) }, error: null };
      },
      async inviteUserByEmail(email, optionen) {
        schreiben(`invite ${email}`);
        if (start.einladungMeldetVorhanden) {
          daten.nutzer.push({ id: 'u-parallel', email });
          return { data: { user: null }, error: { code: 'email_exists', message: 'A user with this email address has already been registered' } };
        }
        const user = { id: `u-${++laufendeNr}`, email, user_metadata: optionen?.data || {} };
        daten.nutzer.push(user);
        auth.letzteEinladung = { email, optionen };
        return { data: { user }, error: null };
      },
    },
    /** @type {{email: string, optionen: any}|null} */
    letzteEinladung: null,
  };

  /** @param {'orgs'|'org_members'} tabelle */
  const from = (tabelle) => {
    const filter = [];
    let art = 'select';
    let eingefuegt = null;
    let aenderung = null;
    const passt = (zeile) => filter.every(([k, v]) => zeile[k] === v);
    const ergebnis = (einzeln) => {
      if (art === 'insert') return { data: einzeln ? eingefuegt : [eingefuegt], error: null };
      if (art === 'update') {
        for (const zeile of daten[tabelle]) if (passt(zeile)) Object.assign(zeile, aenderung);
        return { data: null, error: null };
      }
      const zeilen = daten[tabelle].filter(passt).map((z) => ({ ...z }));
      return { data: einzeln ? (zeilen[0] || null) : zeilen, error: null };
    };
    const q = {
      select() { return q; },
      eq(k, v) { filter.push([k, v]); return q; },
      insert(obj) {
        schreiben(`insert ${tabelle}`);
        art = 'insert';
        eingefuegt = tabelle === 'orgs' ? { id: `org-${++laufendeNr}`, ...obj } : { ...obj };
        daten[tabelle].push(eingefuegt);
        return q;
      },
      update(obj) {
        schreiben(`update ${tabelle}`);
        art = 'update';
        aenderung = obj;
        return q;
      },
      maybeSingle() { return Promise.resolve(ergebnis(true)); },
      single() { return Promise.resolve(ergebnis(true)); },
      then(ok, nein) { return Promise.resolve(ergebnis(false)).then(ok, nein); },
    };
    return q;
  };

  return { auth, from, daten, schreibvorgaenge };
}

describe('zugang-freischalten — Ablauf', () => {
  it('Erfolg: lädt ein, legt das neue Büro an und schreibt die Mitgliedschaft', async () => {
    const c = stubClient();
    const b = await freischalten(c, {
      email: 'neu@buero.example', name: 'Neue Person', neuesBuero: 'Büro Muster', rolle: 'mitglied',
      weiterleitung: 'https://app.example/passwort-zuruecksetzen?type=einladung',
    });
    assert.equal(b.nutzer, 'eingeladen');
    assert.equal(b.org, 'angelegt');
    assert.equal(b.mitgliedschaft, 'angelegt (mitglied)');
    assert.equal(b.geaendert, true);
    assert.deepEqual(c.schreibvorgaenge, ['invite neu@buero.example', 'insert orgs', 'insert org_members']);
    assert.deepEqual(c.daten.org_members, [{ user_id: b.nutzerId, org_id: b.orgId, role: 'mitglied' }]);
    // The invitation carries the name and the landing page that offers "set password".
    assert.deepEqual(c.auth.letzteEinladung.optionen.data, { full_name: 'Neue Person' });
    assert.match(c.auth.letzteEinladung.optionen.redirectTo, /passwort-zuruecksetzen\?type=einladung$/);
  });

  it('idempotent: der zweite Lauf mit denselben Angaben schreibt nichts', async () => {
    const c = stubClient();
    const optionen = { email: 'neu@buero.example', neuesBuero: 'Büro Muster', rolle: 'admin' };
    await freischalten(c, optionen);
    const nachErstemLauf = c.schreibvorgaenge.length;
    const zweiter = await freischalten(c, optionen);
    assert.equal(c.schreibvorgaenge.length, nachErstemLauf, 'zweiter Lauf hat geschrieben');
    assert.equal(zweiter.nutzer, 'vorhanden');
    assert.equal(zweiter.org, 'vorhanden');
    assert.equal(zweiter.mitgliedschaft, 'vorhanden (admin)');
    assert.equal(zweiter.geaendert, false);
    assert.equal(c.daten.orgs.length, 1, 'kein zweites Büro gleichen Namens');
  });

  it('bestehender Nutzer und bestehendes Büro (--org): keine Einladung, nur die Mitgliedschaft', async () => {
    const c = stubClient({
      nutzer: [{ id: 'u-alt', email: 'Alt@Buero.example' }],
      orgs: [{ id: ORG_A, name: 'Büro A' }],
    });
    const b = await freischalten(c, { email: 'alt@buero.example', orgId: ORG_A, rolle: 'mitglied' });
    assert.equal(b.nutzer, 'vorhanden', 'E-Mail-Vergleich ohne Groß-/Kleinschreibung');
    assert.deepEqual(c.schreibvorgaenge, ['insert org_members']);
  });

  it('andere Rolle beim zweiten Lauf: die Rolle wird geändert, nicht verdoppelt', async () => {
    const c = stubClient({
      nutzer: [{ id: 'u-alt', email: 'alt@buero.example' }],
      orgs: [{ id: ORG_A, name: 'Büro A' }],
      mitglieder: [{ user_id: 'u-alt', org_id: ORG_A, role: 'mitglied' }],
    });
    const b = await freischalten(c, { email: 'alt@buero.example', orgId: ORG_A, rolle: 'admin' });
    assert.equal(b.mitgliedschaft, 'Rolle geändert: mitglied → admin');
    assert.equal(c.daten.org_members.length, 1);
    assert.equal(c.daten.org_members[0].role, 'admin');
  });

  it('Einladung meldet „bereits registriert“ (paralleler Lauf): der Nutzer wird nachgeschlagen und weiterverwendet', async () => {
    const c = stubClient({ orgs: [{ id: ORG_A, name: 'Büro A' }], einladungMeldetVorhanden: true });
    const b = await freischalten(c, { email: 'race@buero.example', orgId: ORG_A, rolle: 'mitglied' });
    assert.equal(b.nutzer, 'vorhanden');
    assert.equal(b.nutzerId, 'u-parallel');
    assert.equal(b.mitgliedschaft, 'angelegt (mitglied)');
  });

  it('unbekannte --org bricht im Klartext ab', async () => {
    const c = stubClient();
    await assert.rejects(
      () => freischalten(c, { email: 'x@buero.example', orgId: ORG_A, rolle: 'mitglied' }),
      /Ein Büro mit der ID 11111111-1111-4111-8111-111111111111 gibt es nicht/,
    );
  });

  it('zwei Büros gleichen Namens: Abbruch mit der Bitte um --org', async () => {
    const c = stubClient({ orgs: [{ id: 'o1', name: 'Doppelt' }, { id: 'o2', name: 'Doppelt' }] });
    await assert.rejects(
      () => freischalten(c, { email: 'x@buero.example', neuesBuero: 'Doppelt', rolle: 'mitglied' }),
      /Mehrere Büros heißen „Doppelt“.*--org/,
    );
  });
});

describe('zugang-freischalten — Probelauf (--pruefen)', () => {
  it('schreibt nichts (jede Schreibmethode würfe) und sagt, was passieren würde', async () => {
    const c = stubClient({ nurLesen: true });
    const b = await freischalten(c, { email: 'neu@buero.example', neuesBuero: 'Büro Muster', rolle: 'mitglied', pruefen: true });
    assert.equal(b.nutzer, 'würde eingeladen');
    assert.equal(b.org, 'würde angelegt');
    assert.equal(b.mitgliedschaft, 'würde angelegt (mitglied)');
    assert.equal(b.geaendert, false);
    assert.deepEqual(c.schreibvorgaenge, []);
    assert.equal(berichtZeilen(b, { email: 'neu@buero.example', pruefen: true })[0], 'PROBELAUF — es wurde nichts geschrieben.');
  });

  it('mit vorhandenem Nutzer und Büro: liest die Mitgliedschaft, schreibt sie aber nicht', async () => {
    const c = stubClient({
      nurLesen: true,
      nutzer: [{ id: 'u-alt', email: 'alt@buero.example' }],
      orgs: [{ id: ORG_A, name: 'Büro A' }],
      mitglieder: [{ user_id: 'u-alt', org_id: ORG_A, role: 'mitglied' }],
    });
    const b = await freischalten(c, { email: 'alt@buero.example', orgId: ORG_A, rolle: 'admin', pruefen: true });
    assert.equal(b.mitgliedschaft, 'Rolle würde geändert: mitglied → admin');
    assert.equal(c.daten.org_members[0].role, 'mitglied');
  });
});

describe('zugang-freischalten — Umgebung', () => {
  it('fehlender Schlüssel: Abbruch im Klartext, der Name der Variable steht drin', () => {
    assert.throws(
      () => umgebungLesen({ SUPABASE_URL: 'https://projekt.supabase.co' }),
      /Umgebungsvariable fehlt: SUPABASE_SERVICE_ROLE_KEY/,
    );
    assert.throws(() => umgebungLesen({}), /SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY/);
  });

  it('die Fehlermeldung enthält nie einen Schlüsselwert', () => {
    const geheim = 'sb_secret_DARF_NIE_IM_TEXT_STEHEN';
    try {
      umgebungLesen({ SUPABASE_SERVICE_ROLE_KEY: geheim });
      assert.fail('hätte werfen müssen');
    } catch (fehler) {
      assert.match(fehler.message, /SUPABASE_URL/);
      assert.equal(fehler.message.includes(geheim), false);
    }
  });

  it('liest URL, Schlüssel und die optionale App-Adresse (ohne Schrägstrich am Ende)', () => {
    const u = umgebungLesen({
      SUPABASE_URL: 'https://projekt.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k', BIT_APP_URL: 'https://app.example/',
    });
    assert.deepEqual(u, { url: 'https://projekt.supabase.co', schluessel: 'k', appUrl: 'https://app.example' });
  });
});

describe('zugang-freischalten — Argumente', () => {
  it('Standardrolle mitglied; --pruefen und --name werden gelesen', () => {
    const o = argsLesen(['--email', 'a@b.de', '--name', 'A B', '--neues-buero', 'Büro', '--pruefen']);
    assert.equal(o.rolle, 'mitglied');
    assert.equal(o.pruefen, true);
    assert.equal(o.name, 'A B');
    assert.equal(o.neuesBuero, 'Büro');
  });

  it('genau eines von --org und --neues-buero', () => {
    assert.throws(() => argsLesen(['--email', 'a@b.de']), /Genau eines angeben/);
    assert.throws(() => argsLesen(['--email', 'a@b.de', '--org', ORG_A, '--neues-buero', 'X']), /Genau eines angeben/);
  });

  it('ungültige Rolle, E-Mail, UUID und unbekannte Argumente brechen ab', () => {
    assert.throws(() => argsLesen(['--email', 'a@b.de', '--org', ORG_A, '--rolle', 'chef']), /--rolle muss mitglied oder admin sein/);
    assert.throws(() => argsLesen(['--email', 'kein-at', '--org', ORG_A]), /keine gültige E-Mail/);
    assert.throws(() => argsLesen(['--email', 'a@b.de', '--org', 'abc']), /keine UUID/);
    assert.throws(() => argsLesen(['--email', 'a@b.de', '--org', ORG_A, '--force']), /Unbekanntes Argument: --force/);
    assert.throws(() => argsLesen(['--email']), /--email braucht einen Wert/);
  });

  it('--hilfe braucht keine weiteren Angaben', () => {
    assert.equal(argsLesen(['--hilfe']).hilfe, true);
  });
});
