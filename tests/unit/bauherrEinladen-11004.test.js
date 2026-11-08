// 110-04: scripts/bauherr-einladen.mjs — arguments and the invitation flow
// against a fake service client (no network). The live run is the user's.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { STANDARD_WEITERLEITUNG, argumenteLesen, einladen } from '../../scripts/bauherr-einladen.mjs';

const ORG = '11111111-1111-4111-8111-111111111111';

/**
 * A minimal fake of the supabase-js calls the script uses.
 * @param {{ projekt?: object|null, rolle?: string|null, vorhanden?: boolean }} lage
 */
function attrappe(lage) {
  const geschrieben = { org_members: [], projekt_zugang: [], rpc: [], links: [] };
  const abfrage = (tabelle) => {
    const q = {
      select: () => q, eq: () => q,
      maybeSingle: async () => ({ data: tabelle === 'records' ? (lage.projekt ?? null) : (lage.rolle ? { role: lage.rolle } : null), error: null }),
      upsert: async (zeile) => { geschrieben[tabelle].push(zeile); return { error: null }; },
    };
    return q;
  };
  return {
    geschrieben,
    from: abfrage,
    rpc: async (name, args) => { geschrieben.rpc.push({ name, args }); return { error: null }; },
    auth: { admin: { generateLink: async (opt) => {
      geschrieben.links.push(opt);
      if (opt.type === 'invite' && lage.vorhanden) return { data: null, error: { message: 'A user with this email address has already been registered' } };
      return { data: { user: { id: 'u-1' }, properties: { action_link: `https://x.supabase.co/auth/v1/verify?type=${opt.type}` } }, error: null };
    } } },
  };
}

describe('bauherr-einladen — Argumente', () => {
  it('gültig: E-Mail klein, Standard-Weiterleitung, ja-prod erkannt', () => {
    const r = argumenteLesen(['--email', 'Kunde@Example.de', '--projekt', 'P1', '--org', ORG, '--ja-prod']);
    assert.equal(r.ok, true);
    assert.equal(r.daten.email, 'kunde@example.de');
    assert.equal(r.daten.weiterleitung, STANDARD_WEITERLEITUNG);
    assert.equal(r.daten.jaProd, true);
  });
  it('Fehler im Klartext: fehlendes Projekt, kaputte Org, http-Weiterleitung, fehlender Wert', () => {
    assert.match(argumenteLesen(['--email', 'a@b.de', '--org', ORG]).fehler, /projekt_id fehlt/);
    assert.match(argumenteLesen(['--email', 'a@b.de', '--projekt', 'P1', '--org', 'x']).fehler, /org_id/);
    assert.match(argumenteLesen(['--email', 'a@b.de', '--projekt', 'P1', '--org', ORG, '--weiterleitung', 'http://x']).fehler, /https/);
    assert.match(argumenteLesen(['--email']).fehler, /Wert fehlt/);
  });
});

describe('bauherr-einladen — Ablauf', () => {
  const d = { orgId: ORG, email: 'kunde@example.de', projektId: 'P1', weiterleitung: STANDARD_WEITERLEITUNG };
  it('neu: Einladelink, Rolle bauherr ohne interne Rechte, Zugang nur zu P1, Protokoll', async () => {
    const a = attrappe({ projekt: { id: 'P1', data: { name: 'Haus' } } });
    const e = await einladen(d, /** @type {any} */ (a));
    assert.equal(e.neu, true);
    assert.match(e.link, /type=invite/);
    assert.equal(a.geschrieben.org_members[0].role, 'bauherr');
    assert.equal(a.geschrieben.org_members[0].can_edit_model || a.geschrieben.org_members[0].can_submit_bid, false);
    assert.deepEqual(a.geschrieben.projekt_zugang, [{ org_id: ORG, user_id: 'u-1', projekt_id: 'P1', rolle: 'bauherr' }]);
    assert.equal(a.geschrieben.rpc[0].args.p_aktion, 'einladung');
  });
  it('bestehendes Konto: Link zum Passwort-Setzen (recovery)', async () => {
    const a = attrappe({ projekt: { id: 'P1', data: {} }, vorhanden: true });
    const e = await einladen(d, /** @type {any} */ (a));
    assert.equal(e.neu, false);
    assert.match(e.link, /type=recovery/);
    assert.match(a.geschrieben.links[1].options.redirectTo, /type=recovery/);
  });
  it('nie: unbekanntes Projekt, internes Büromitglied', async () => {
    await assert.rejects(einladen(d, /** @type {any} */ (attrappe({ projekt: null }))), /gibt es in diesem Büro nicht/);
    const a = attrappe({ projekt: { id: 'P1', data: {} }, rolle: 'owner' });
    await assert.rejects(einladen(d, /** @type {any} */ (a)), /internes Mitglied/);
    assert.equal(a.geschrieben.org_members.length, 0, 'nichts geschrieben');
  });
});
