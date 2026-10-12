// 74-01 Task 14: the bidder portal, CLIENT side, against a simulated Supabase.
//
// What this proves: in the cloud build an external role (bidder) is routed to
// the portal instead of the office shell; the portal shows the released
// tender and quantities; a bid goes out in the price-comparison shape; and the
// portal never ASKS for originals (Contact, LVPosition, Tender, ChangeOrder).
// What it does NOT prove: the database rules — the answers here are scripted.
// Those are supabase/tests/74-01_zugriff.sql against a throwaway project.
//
// Runs only against a LOCAL cloud build whose Supabase URL is the placeholder
// http://127.0.0.1:9 (every call to it is intercepted below; nothing leaves
// the machine):
//   $env:VITE_SUPABASE_URL = 'http://127.0.0.1:9'; $env:VITE_SUPABASE_ANON_KEY = 'platzhalter'
//   npm run build:cloud
//   npx vite preview --port 5194 --strictPort
//   $env:BASIS_URL = 'http://localhost:5194'; npm run test:e2e:cloud -- tests/e2e/bieterportal-74-01.spec.js

import { Buffer } from 'node:buffer';
import { test, expect } from '@playwright/test';

const BASIS = process.env.BASIS_URL || '';
test.skip(!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(BASIS),
  'nur gegen einen lokalen Cloud-Build mit Platzhalter-Supabase (siehe Kopf)');

const SUPABASE = 'http://127.0.0.1:9';
const ORG = '11111111-1111-4111-8111-111111111111';
const USER = { id: '00000000-0000-4000-8000-0000000000b1', email: 'bieter@example.invalid', aud: 'authenticated', role: 'authenticated', user_metadata: { full_name: 'Bieter Eins' } };

/** base64url of a JSON value. */
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jetzt = () => Math.floor(Date.now() / 1000);
const JWT = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: USER.id, role: 'authenticated', aud: 'authenticated', exp: jetzt() + 3600 })}.x`;

/** The released rows of the scripted database (what 0011 would return to bidder1). */
function startZeilen() {
  const zeile = (id, entity, data) => ({ id, entity, org_id: ORG, data, created_date: '2026-10-12T08:00:00Z', updated_date: '2026-10-12T08:00:00Z' });
  const frist = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
  return [
    // Office originals — the portal must never ask for them (checked below).
    zeile('P1', 'Project', { name: 'Projekt Eins', project_type: 'Gewerbe' }),
    zeile('T1', 'Tender', { name: 'Rohbau', trade: 'Beton', project_id: 'P1', status: 'published', position_ids: [], invited_contact_ids: [] }),
    zeile('tf1', 'TenderFreigabe', { tender_id: 'T1', project_id: 'P1', name: 'Rohbau', trade: 'Beton', frist }),
    zeile('mf1', 'MengenFreigabe', { tender_id: 'T1', lv_id: 'lv-1', oz: '01.01', kurztext: 'Beton C25/30', quantity: 10, unit: 'm3' }),
    zeile('mf2', 'MengenFreigabe', { tender_id: 'T1', lv_id: 'lv-2', oz: '01.02', kurztext: 'Bewehrung', quantity: 2, unit: 't' }),
  ];
}

/**
 * Intercepts every call to the placeholder Supabase and answers like
 * PostgREST/GoTrue would for bidder1. Records every records query.
 */
async function supabaseNachstellen(page, mitgliedschaft = 'bieter') {
  const zeilen = startZeilen();
  const abfragen = [];
  const gesendet = [];
  await page.route(`${SUPABASE}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const objekt = (req.headers().accept || '').includes('vnd.pgrst.object');
    const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (url.pathname === '/auth/v1/token') {
      return json(200, { access_token: JWT, token_type: 'bearer', expires_in: 3600, expires_at: jetzt() + 3600, refresh_token: 'r', user: USER });
    }
    if (url.pathname === '/auth/v1/user') return json(200, USER);
    if (url.pathname === '/auth/v1/logout') return route.fulfill({ status: 204, body: '' });
    if (url.pathname === '/rest/v1/org_members') {
      // 'bieter': 0006 schema, external role. 'alt-admin': TODAY's live schema
      // (role admin, no flag columns). 'keine': signed in, no membership.
      if (mitgliedschaft === 'keine') return json(200, objekt ? null : []);
      const m = mitgliedschaft === 'alt-admin'
        ? { user_id: USER.id, org_id: ORG, role: 'admin' }
        : mitgliedschaft === 'owner-neu'
        ? { user_id: USER.id, org_id: ORG, role: 'owner', stufe: 'enterprise', can_edit_model: true, can_export_ifc: true, can_view_audit_reports: true, can_submit_bid: false, kontakt_id: null }
        : { user_id: USER.id, org_id: ORG, role: 'bidder', stufe: 'free', can_edit_model: false, can_export_ifc: false, can_view_audit_reports: false, can_submit_bid: true, kontakt_id: 'c1' };
      return json(200, objekt ? m : [m]);
    }
    if (url.pathname === '/rest/v1/records' && req.method() === 'GET') {
      const entity = (url.searchParams.get('entity') || '').replace(/^eq\./, '');
      abfragen.push(entity);
      const treffer = zeilen.filter((z) => z.entity === entity);
      return json(200, objekt ? (treffer[0] || null) : treffer);
    }
    if (url.pathname === '/rest/v1/records' && req.method() === 'POST') {
      const body = JSON.parse(req.postData() || '{}');
      gesendet.push(body);
      // The server replaces the id and owns the row (0008) — scripted here.
      const neu = { id: 'srv-1', entity: body.entity, org_id: body.org_id, data: body.data, created_date: new Date().toISOString(), updated_date: new Date().toISOString() };
      zeilen.push(neu);
      return json(201, objekt ? neu : [neu]);
    }
    // No submission yet for any tender (0009 table).
    if (url.pathname === '/rest/v1/submission') return json(200, objekt ? null : []);
    if (url.pathname === '/rest/v1/rpc/gebot_zuruecknehmen') {
      const z = zeilen.find((r) => r.id === 'srv-1');
      if (z) z.data = { ...z.data, status: 'zurueckgezogen' };
      return route.fulfill({ status: 204, body: '' });
    }
    // Anything else would be a request the portal should not make.
    abfragen.push(`UNERWARTET ${req.method()} ${url.pathname}`);
    return json(404, { message: 'nicht nachgestellt' });
  });
  return { abfragen, gesendet };
}

test('Bieter landet im Portal, gibt ein Angebot ab und zieht es zurück — ohne je Originale anzufragen', async ({ page }) => {
  const konsolenfehler = [];
  page.on('console', (m) => { if (m.type() === 'error') konsolenfehler.push(m.text()); });
  const { abfragen, gesendet } = await supabaseNachstellen(page);

  await page.goto('/anmeldung');
  await page.getByLabel('E-Mail').fill(USER.email);
  await page.getByLabel('Passwort').fill('egal');
  await page.getByRole('button', { name: 'Anmelden' }).click();

  // Routed to the portal — not the office dashboard, also on an office route.
  await expect(page.getByTestId('bieterportal')).toBeVisible({ timeout: 20000 });
  await page.goto('/AVA');
  await expect(page.getByTestId('bieterportal')).toBeVisible({ timeout: 20000 });
  await expect(page.getByRole('heading', { name: 'Bieterportal' })).toBeVisible();
  await expect(page.getByText('Ein technischer Verschluss gegenüber dem Betreiber der Plattform findet nicht statt.')).toBeVisible();

  const karte = page.getByTestId('portal-vergabe');
  await expect(karte).toContainText('Rohbau');
  await expect(karte).toContainText('Beton C25/30');
  const abgeben = karte.getByRole('button', { name: 'Angebot abgeben' });
  await expect(abgeben).toBeDisabled();

  await karte.getByLabel('Einheitspreis 01.01').fill('120,50');
  await expect(abgeben).toBeDisabled(); // second position still without price
  await karte.getByLabel('Einheitspreis 01.02').fill('1.000');
  await expect(karte).toContainText('3.205,00 €');
  await abgeben.click();

  await expect(page.getByTestId('portal-eigenes-gebot')).toContainText('eingegangen', { timeout: 20000 });
  expect(gesendet).toHaveLength(1);
  expect(gesendet[0].entity).toBe('Bid');
  expect(gesendet[0].data).toMatchObject({
    tender_id: 'T1', status: 'submitted', total: 3205,
    line_items: [{ position_id: 'lv-1', unit_price: 120.5 }, { position_id: 'lv-2', unit_price: 1000 }],
  });

  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Angebot zurückziehen' }).click();
  await expect(page.getByTestId('portal-eigenes-gebot')).toContainText('zurückgezogen', { timeout: 20000 });

  const verboten = abfragen.filter((e) => /^(Contact|LVPosition|Tender|ChangeOrder)$/.test(e) || e.startsWith('UNERWARTET'));
  expect(verboten, `angefragt: ${abfragen.join(', ')}`).toEqual([]);
  expect(konsolenfehler, konsolenfehler.join(' | ')).toEqual([]);
});

// Before migration 0006 the live schema knows only admin/mitglied and no flag
// columns. A push of main must not change anything for the office there.
for (const [fall, erwartung] of [['alt-admin', 'Büro-Shell'], ['keine', 'Büro-Shell']]) {
  test(`heutiges Live-Schema: Mitgliedschaft "${fall}" → ${erwartung}, nie das Bieterportal`, async ({ page }) => {
    await supabaseNachstellen(page, fall);
    await page.goto('/anmeldung');
    await page.getByLabel('E-Mail').fill(USER.email);
    await page.getByLabel('Passwort').fill('egal');
    await page.getByRole('button', { name: 'Anmelden' }).click();
    await page.waitForURL((u) => !u.pathname.includes('/anmeldung'), { timeout: 20000 });
    // The office shell renders its sidebar; give the portal a fair chance to appear.
    await expect(page.getByTestId('huellen-hinweise')).toBeAttached({ timeout: 20000 });
    await expect(page.getByTestId('bieterportal')).toHaveCount(0);
  });
}

// The office side of 74-01: the deadline/release panel in AVA › Ausschreibung
// appears only when the 0006 schema is live (flag columns present) — never on
// today's schema, where its RPCs do not exist.
for (const [fall, sichtbar] of [['owner-neu', true], ['alt-admin', false]]) {
  test(`AVA › Ausschreibung: Bedienfeld Zugriffstrennung bei "${fall}" ${sichtbar ? 'sichtbar' : 'unsichtbar'}`, async ({ page }) => {
    await supabaseNachstellen(page, fall);
    await page.goto('/anmeldung');
    await page.getByLabel('E-Mail').fill(USER.email);
    await page.getByLabel('Passwort').fill('egal');
    await page.getByRole('button', { name: 'Anmelden' }).click();
    await page.waitForURL((u) => !u.pathname.includes('/anmeldung'), { timeout: 20000 });
    await page.goto('/AVA?tab=tender');
    // The tender card is there in both cases …
    await expect(page.getByRole('button', { name: /Preisspiegel/ }).first()).toBeVisible({ timeout: 20000 });
    if (sichtbar) {
      // … the panel only with the 0006 schema; no deadline yet → set it (disabled until a date is typed).
      await expect(page.getByTestId('vergabe-zugriff')).toBeVisible({ timeout: 20000 });
      await expect(page.getByRole('button', { name: 'Angebotsfrist festlegen' })).toBeDisabled();
      await page.getByLabel('Angebotsfrist', { exact: true }).fill('2099-01-15T10:00');
      await expect(page.getByRole('button', { name: 'Angebotsfrist festlegen' })).toBeEnabled();
    } else {
      await expect(page.getByTestId('vergabe-zugriff')).toHaveCount(0);
    }
  });
}
