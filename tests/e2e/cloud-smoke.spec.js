// Smoke test against the deployed cloud app (57-05).
//
// Runs against a LIVE url with REAL accounts, so it is opt-in: without
// BASIS_URL the whole file skips and `npm run test:e2e` stays green locally.
//
// It proves the two things a deploy can break silently: the data path (login,
// create, reload, delete) and the tenant boundary (a signed-in user of another
// org sees nothing). Everything it creates, it removes again.
//
// Environment:
//   BASIS_URL           https://bit-atelier.pages.dev
//   SMOKE_USER_A        member of the office org      SMOKE_PASS_A
//   SMOKE_USER_B        signed in, NO membership      SMOKE_PASS_B
//   SMOKE_SUPABASE_URL  optional, enables the object-storage step; same value
//   SMOKE_SUPABASE_ANON as VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (both public)
//
// Usage (PowerShell; the last line matters - a BASIS_URL left in the session
// silently points the next e2e run at the live site):
//   $env:BASIS_URL = 'https://bit-atelier.pages.dev'; $env:SMOKE_USER_A = '…'; $env:SMOKE_PASS_A = '…'
//   npm run smoke:cloud
//   Remove-Item Env:BASIS_URL, Env:SMOKE_USER_A, Env:SMOKE_PASS_A

import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const BASIS = process.env.BASIS_URL;
const USER_A = process.env.SMOKE_USER_A;
const PASS_A = process.env.SMOKE_PASS_A;
const USER_B = process.env.SMOKE_USER_B;
const PASS_B = process.env.SMOKE_PASS_B;
const SB_URL = process.env.SMOKE_SUPABASE_URL;
const SB_ANON = process.env.SMOKE_SUPABASE_ANON;

test.skip(!BASIS || !USER_A || !PASS_A, 'BASIS_URL und SMOKE_USER_A/PASS_A nötig — lokal übersprungen');

/** Unique name so parallel or repeated runs never collide. */
const PROJEKTNAME = `Smoke ${new Date().toISOString().replace(/[:.]/g, '-')}`;

/**
 * Signs a user in through the real login form.
 * @param {import('@playwright/test').Page} page
 * @param {string} mail
 * @param {string} passwort
 */
async function anmelden(page, mail, passwort) {
  await page.goto(`${BASIS}/anmeldung`);
  await page.getByLabel('E-Mail').fill(mail);
  await page.getByLabel('Passwort').fill(passwort);
  await page.getByRole('button', { name: 'Anmelden' }).click();
}

test.describe.configure({ mode: 'serial' });

test('Kernpfad: anmelden, Projekt anlegen, neu laden, abmelden', async ({ page }) => {
  const konsolenfehler = [];
  page.on('console', (m) => { if (m.type() === 'error') konsolenfehler.push(m.text()); });

  // 1. Ohne Sitzung landet jeder Aufruf auf der Anmeldung.
  await page.goto(BASIS);
  await expect(page).toHaveURL(/\/anmeldung/);

  // 2. Falsches Passwort nennt den Grund im Klartext.
  await page.getByLabel('E-Mail').fill(USER_A);
  await page.getByLabel('Passwort').fill('definitiv-falsch');
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page.getByRole('alert')).toContainText(/falsch/i);

  // 3. Richtige Daten führen in die App.
  await page.getByLabel('Passwort').fill(PASS_A);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page.getByRole('heading', { name: /Projektübersicht/ })).toBeVisible({ timeout: 20000 });
  await expect(page.getByText(USER_A)).toBeVisible();

  // 4. Projekt anlegen — der Schreibweg durch RLS hindurch.
  await page.goto(`${BASIS}/Projects?neu=1`);
  await page.getByLabel(/Projektname/).fill(PROJEKTNAME);
  await page.getByLabel(/Standort/).fill('Nürnberg');
  await page.getByRole('combobox', { name: /Projekttyp/ }).click();
  await page.getByRole('option', { name: 'Gewerbe' }).click();
  await page.getByRole('button', { name: 'Projekt anlegen' }).click();
  await expect(page.getByText(PROJEKTNAME)).toBeVisible({ timeout: 20000 });

  // 5. Neu laden — die Daten kommen aus der Datenbank, nicht aus dem Speicher.
  await page.reload();
  await expect(page.getByText(PROJEKTNAME)).toBeVisible({ timeout: 20000 });

  // 6. Abmelden führt zurück zur Anmeldung.
  await page.getByRole('button', { name: 'Abmelden' }).click();
  await expect(page).toHaveURL(/\/anmeldung/, { timeout: 15000 });

  expect(konsolenfehler, `Konsolenfehler: ${konsolenfehler.join(' | ')}`).toHaveLength(0);
});

test('Mandantengrenze: Nutzer ohne Mitgliedschaft sieht das Projekt nicht', async ({ page }) => {
  test.skip(!USER_B || !PASS_B, 'SMOKE_USER_B/PASS_B nötig');

  await anmelden(page, USER_B, PASS_B);
  await page.waitForURL((u) => !u.pathname.includes('/anmeldung'), { timeout: 20000 });
  await page.goto(`${BASIS}/Projects`);
  // Nicht „irgendwie leer", sondern: genau dieses Projekt ist unsichtbar.
  await expect(page.getByText(PROJEKTNAME)).toHaveCount(0);
});

/**
 * A fresh supabase-js client signed in as one smoke account. Node side, no
 * browser: the storage path is the same one the app uses (bucket `blobs`,
 * `<org_id>/<id>.json`, supabaseDb.js blobsSupabase), measured without the UI.
 * @param {string} mail
 * @param {string} passwort
 */
async function sbAnmelden(mail, passwort) {
  const client = createClient(/** @type {string} */ (SB_URL), /** @type {string} */ (SB_ANON), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({ email: mail, password: passwort });
  if (error) throw new Error(`Anmeldung ${mail} fehlgeschlagen: ${error.message}`);
  return client;
}

test('Objektspeicher: Datei ablegen, lesen, für Fremde unsichtbar, löschen', async () => {
  test.skip(!SB_URL || !SB_ANON, 'SMOKE_SUPABASE_URL/ANON nötig');
  const a = await sbAnmelden(/** @type {string} */ (USER_A), /** @type {string} */ (PASS_A));
  const { data: mitglied, error: fm } = await a.from('org_members').select('org_id').limit(1).maybeSingle();
  expect(fm, fm?.message).toBeNull();
  expect(mitglied?.org_id, 'Konto A hat keine Büro-Mitgliedschaft').toBeTruthy();

  const pfad = `${mitglied.org_id}/smoke-${Date.now()}.json`;
  const inhalt = JSON.stringify({ smoke: true, am: new Date().toISOString() });
  try {
    const hoch = await a.storage.from('blobs').upload(pfad, new Blob([inhalt], { type: 'application/json' }), {
      contentType: 'application/json',
    });
    expect(hoch.error, hoch.error?.message).toBeNull();

    const zurueck = await a.storage.from('blobs').download(pfad);
    expect(zurueck.error, zurueck.error?.message).toBeNull();
    expect(await zurueck.data.text()).toBe(inhalt);

    if (USER_B && PASS_B) {
      const b = await sbAnmelden(USER_B, PASS_B);
      const fremd = await b.storage.from('blobs').download(pfad);
      // Not "empty" but refused: the storage policy checks ist_mitglied on the
      // first path segment, and B is a member of no office.
      expect(fremd.data, 'Konto B konnte die Datei von Konto A lesen').toBeNull();
      expect(fremd.error).not.toBeNull();
      await b.auth.signOut();
    }
  } finally {
    const weg = await a.storage.from('blobs').remove([pfad]);
    expect(weg.error, weg.error?.message).toBeNull();
    await a.auth.signOut();
  }
});

test('Aufräumen: Smoke-Projekt wieder löschen', async ({ page }) => {
  await anmelden(page, USER_A, PASS_A);
  await page.goto(`${BASIS}/Projects`);
  const karte = page.locator('div').filter({ hasText: PROJEKTNAME }).first();
  await expect(karte).toBeVisible({ timeout: 20000 });

  page.once('dialog', (d) => d.accept());
  await karte.getByRole('button', { name: /löschen/i }).first().click();

  await expect(page.getByText(PROJEKTNAME)).toHaveCount(0, { timeout: 20000 });
});
