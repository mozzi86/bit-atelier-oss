// 57-06: legal pages and the access request work WITHOUT a session in the
// cloud build. Runs only with BASIS_URL (playwright.cloud.config.js): against a
// local cloud build (vite preview) or, after a deploy, against the live site.
// Under the default config (Express dev stack) the auth gate never applies, so
// this file skips itself there - a green run in that mode would prove nothing.
//
// No account, no login, no write: every check is what an anonymous visitor
// sees. The mailto navigation of the request form is aborted on purpose to
// reproduce an office PC without a mail program.

import { test, expect } from '@playwright/test';

const BASIS = process.env.BASIS_URL;

test.skip(!BASIS, 'BASIS_URL nötig (Cloud-Build, siehe playwright.cloud.config.js) — lokal übersprungen');

const RECHTSSEITEN = [
  ['/impressum', /Angaben gemäß § 5 DDG/],
  ['/datenschutz', /Widerspruchsrecht nach Art\. 21 DSGVO/],
  ['/nutzungsbedingungen', /Nutzungsbedingungen/],
  ['/rueckerstattung', /Rückerstattung/],
  ['/cookies', /Cookie/],
  ['/barrierefreiheit', /Stand der Vereinbarkeit/],
];

test('Vorbedingung: das Anmelde-Tor ist aktiv (sonst beweist dieser Lauf nichts)', async ({ page }) => {
  await page.goto('/Dashboard');
  await expect(page).toHaveURL(/\/anmeldung$/);
});

for (const [pfad, kennsatz] of RECHTSSEITEN) {
  test(`${pfad} lädt ohne Anmeldung und leitet nicht um`, async ({ page }) => {
    await page.goto(pfad);
    await expect(page.getByText(kennsatz).first()).toBeVisible({ timeout: 20000 });
    await expect(page).not.toHaveURL(/anmeldung/);
  });
}

test('von der Anmeldung führen Links zu Impressum und Datenschutz', async ({ page }) => {
  await page.goto('/anmeldung');
  await page.getByRole('link', { name: 'Impressum' }).click();
  await expect(page).toHaveURL(/\/impressum$/);
  await expect(page.getByText('Angaben gemäß § 5 DDG')).toBeVisible();
  await page.goto('/anmeldung');
  await page.getByRole('link', { name: 'Datenschutz' }).click();
  await expect(page).toHaveURL(/\/datenschutz$/);
});

test('375 px: Impressum ohne waagerechten Seitenlauf', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/impressum');
  await expect(page.getByText('Angaben gemäß § 5 DDG')).toBeVisible({ timeout: 20000 });
  const ueberstand = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(ueberstand).toBeLessThanOrEqual(0);
});

test('/registrieren: Vergabe-Abgrenzung sichtbar ohne Klick, Anfrage geht nicht still verloren', async ({ page }) => {
  // Office PC without a mail program: the mailto navigation leads nowhere.
  await page.route(/^mailto:/, (r) => r.abort());
  await page.goto('/registrieren');

  const umfang = page.getByTestId('angebots-umfang');
  await expect(umfang).toBeVisible({ timeout: 20000 });
  await expect(umfang).toContainText('ein Verschluss der Angebote gegenüber dem Betreiber der Instanz findet technisch nicht statt');
  await expect(umfang).toContainText('§ 14 BGB');

  await page.getByLabel('Name', { exact: true }).fill('Testperson Probe');
  await page.getByLabel('Büro / Firma').fill('Büro Probe');
  await page.getByLabel('E-Mail').fill('probe@example.invalid');
  await page.getByLabel('Rolle').selectOption('architektur');
  await page.getByLabel('Nachricht (optional)').fill('Eine Nachricht, die nicht verloren gehen darf.');
  await page.getByRole('button', { name: 'Zugang anfragen' }).click();

  const wortlaut = page.getByTestId('registrieren-wortlaut');
  await expect(wortlaut).toBeVisible();
  await expect(wortlaut).toHaveValue(/Name: Testperson Probe/);
  await expect(wortlaut).toHaveValue(/Eine Nachricht, die nicht verloren gehen darf\./);
  await expect(page.getByTestId('registrieren-empfaenger')).toHaveText(/@/);
  await expect(page).not.toHaveURL(/anmeldung/);

  // Back to the form: the values are still there.
  await page.getByRole('button', { name: 'Angaben ändern' }).click();
  await expect(page.getByLabel('Büro / Firma')).toHaveValue('Büro Probe');
  await expect(page.getByLabel('Nachricht (optional)')).toHaveValue('Eine Nachricht, die nicht verloren gehen darf.');
});
