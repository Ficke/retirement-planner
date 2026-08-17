import { test, expect, type Page } from '@playwright/test';

/**
 * Smoke coverage for the 4-page sidebar IA: plan knobs and projections on
 * Plan, portfolio on Accounts, set-and-forget facts on Profile, and app/model
 * configuration on Settings.
 *
 * These run signed out, which is the app's LOCAL data mode: profile and
 * accounts live in localStorage, and no database or Firebase session is
 * involved. That keeps the suite runnable in CI without secrets.
 */

const PAGES = ['Plan', 'Accounts', 'Profile', 'Settings'] as const;

/** Navigate and wait past the bootstrap spinner. */
async function gotoApp(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Plan', level: 1 })).toBeVisible();
}

/** Sidebar nav buttons; scoped so page content with the same text can't match. */
function navItem(page: Page, name: string) {
  return page.getByRole('complementary').getByRole('button', { name, exact: true });
}

test('boots into Plan with the KPI row', async ({ page }) => {
  await gotoApp(page);

  for (const label of ['Chance of success', 'Typical outcome', 'Poor markets', 'Strong markets']) {
    await expect(page.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(page.getByText('Levers', { exact: true })).toBeVisible();
  await expect(page.getByText('Wealth over time', { exact: true })).toBeVisible();
});

test('Plan includes income outcome cohorts', async ({ page }) => {
  await gotoApp(page);

  // Exercise the worker response directly; a separately deployed cloud engine
  // may still be on the previous additive response shape during rollout.
  await navItem(page, 'Settings').click();
  await page.getByRole('combobox').click();
  await page.getByRole('option', { name: 'Local (never leaves device)' }).click();
  await navItem(page, 'Plan').click();

  await page.getByRole('tab', { name: 'Income', exact: true }).click();
  const outcomeSelectors = page.getByRole('combobox', { name: 'Outcome percentile' });
  await expect(outcomeSelectors).toHaveCount(2, { timeout: 15_000 });
  await expect(outcomeSelectors.first()).toContainText(
    'Median · 45th–55th',
  );
});

test('every sidebar page is reachable', async ({ page }) => {
  await gotoApp(page);

  for (const name of PAGES) {
    await navItem(page, name).click();
    await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
  }
});

test('signed out, the app runs in local mode and offers sign-in', async ({ page }) => {
  await gotoApp(page);

  await expect(page.getByText('Guest — data stays in this browser')).toBeVisible();
  await expect(navItem(page, 'Sign in')).toBeVisible();

  await navItem(page, 'Settings').click();
  // The storage badge reflects LOCAL mode when there is no auth user.
  await expect(page.getByText('This browser', { exact: true })).toBeVisible();
});

test('an account can be added locally and Plan remains reachable', async ({ page }) => {
  await gotoApp(page);
  await navItem(page, 'Accounts').click();

  await page.getByRole('button', { name: 'Add account' }).click();
  await page.getByLabel('Name').fill('Test Brokerage');
  await page.getByLabel('Institution').fill('Vanguard');
  await page.getByLabel('Balance').fill('250000');
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page.getByText('Test Brokerage')).toBeVisible();

  await navItem(page, 'Plan').click();
  await expect(page.getByRole('heading', { name: 'Plan', level: 1 })).toBeVisible();
});

test('accounts survive a reload in local mode', async ({ page }) => {
  await gotoApp(page);
  await navItem(page, 'Accounts').click();

  await page.getByRole('button', { name: 'Add account' }).click();
  await page.getByLabel('Name').fill('Persisted Account');
  await page.getByLabel('Balance').fill('12345');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText('Persisted Account')).toBeVisible();

  await page.reload();
  await navItem(page, 'Accounts').click();
  await expect(page.getByText('Persisted Account')).toBeVisible();
});

test('theme toggle switches to dark', async ({ page }) => {
  await gotoApp(page);

  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
});
