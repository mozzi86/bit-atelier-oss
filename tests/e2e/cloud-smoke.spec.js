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
//   BASIS_URL        https://app.bit-atelier.de
//   SMOKE_USER_A     member of the office org      SMOKE_PASS_A
//   SMOKE_USER_B     signed in, NO membership      SMOKE_PASS_B
//
// Usage: BASIS_URL=https://app.bit-atelier.de npm run smoke:cloud

import { test, expect } from '@playwright/test';

const BASIS = process.env.BASIS_URL;
const USER_A = process.env.SMOKE_USER_A;
const PASS_A = process.env.SMOKE_PASS_A;
const USER_B = process.env.SMOKE_USER_B;
const PASS_B = process.env.SMOKE_PASS_B;

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

test('Aufräumen: Smoke-Projekt wieder löschen', async ({ page }) => {
  await anmelden(page, USER_A, PASS_A);
  await page.goto(`${BASIS}/Projects`);
  const karte = page.locator('div').filter({ hasText: PROJEKTNAME }).first();
  await expect(karte).toBeVisible({ timeout: 20000 });

  page.once('dialog', (d) => d.accept());
  await karte.getByRole('button', { name: /löschen/i }).first().click();

  await expect(page.getByText(PROJEKTNAME)).toHaveCount(0, { timeout: 20000 });
});
