import { test, expect, type Page } from '@playwright/test';

/**
 * This suite covers the four-page sidebar: plan controls and projections on
 * Plan, portfolio data on Accounts, personal details on Profile, and model
 * configuration on Settings.
 *
 * These run signed out, which is the app's LOCAL data mode: profile and
 * accounts live in localStorage, and no database or Firebase session is
 * involved. That keeps the suite runnable in CI without secrets.
 */

const PAGES = ['Plan', 'Accounts', 'Profile', 'Settings'] as const;

/** Navigates to the app and waits for bootstrap to finish. */
async function gotoApp(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Plan', level: 1 })).toBeVisible();
}

/** Returns a sidebar button without matching duplicate text in page content. */
function navItem(page: Page, name: string) {
  return page.getByRole('complementary').getByRole('button', { name, exact: true });
}

test('boots into Plan with outcomes, controls, and projection charts in order', async ({ page }) => {
  await gotoApp(page);

  for (const label of [
    'Current wealth',
    'Chance of success',
    'Projected wealth at retirement',
  ]) {
    await expect(page.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(page.getByText(/Projected wealth at age \d+/)).toBeVisible();
  await expect(page.getByText('Levers', { exact: true })).toHaveCount(0);

  const sections = [
    page.getByText('Current wealth', { exact: true }),
    page.getByText('Retirement age', { exact: true }).first(),
    page.getByText('Wealth over time', { exact: true }),
    page.getByText('Cash flow', { exact: true }),
    page.getByText('Year by year', { exact: true }),
  ];
  const boxes = await Promise.all(sections.map((section) => section.boundingBox()));
  const yPositions = boxes.map((box) => {
    expect(box).not.toBeNull();
    return box!.y;
  });
  expect(yPositions).toEqual([...yPositions].sort((a, b) => a - b));
});

test('Plan includes income outcome cohorts', async ({ page }) => {
  await gotoApp(page);

  // Exercises the worker response directly: a separately deployed cloud engine
  // may still be on the previous additive response shape during rollout. Signed
  // out there is nothing to switch — cloud compute needs an account.

  const outcomeSelectors = page.getByRole('combobox', { name: 'Outcome percentile' });
  await expect(outcomeSelectors).toHaveCount(2, { timeout: 15_000 });
  await expect(outcomeSelectors.first()).toContainText(
    'Median · 45th–55th',
  );

  await expect(page.getByRole('img', {
    name: 'Average annual income by source for the selected outcome range',
  })).toBeVisible();
});

test('Plan labels sensitivity axes without repeating age in every tick', async ({ page }) => {
  await gotoApp(page);

  const retirementChart = page.getByRole('img', {
    name: 'Retirement age sensitivity: chance of success by retirement age',
  });
  await expect(retirementChart).toBeVisible({ timeout: 15_000 });
  await expect(retirementChart.getByText('45', { exact: true })).toBeVisible();
  await expect(retirementChart.getByText('Age 45', { exact: true })).toHaveCount(0);
  await expect(page.getByText(/success at Age/)).toHaveCount(0);

  await expect(page.getByRole('img', {
    name: 'Projected wealth by age, showing the median and 25th to 75th percentile range',
  })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Middle 50%' })).toBeVisible();
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

  await expect(page.getByText('Guest. Data stays in this browser.')).toBeVisible();
  await expect(navItem(page, 'Sign in')).toBeVisible();

  await navItem(page, 'Settings').click();
  // The storage badge reflects LOCAL mode when there is no auth user.
  await expect(page.getByText('This browser', { exact: true })).toBeVisible();

  // Cloud compute needs an account, so signed out there is no engine to pick
  // between — offering the choice would advertise a mode that cannot run.
  await expect(page.getByText('Local', { exact: true })).toBeVisible();
  await expect(page.getByRole('combobox')).toHaveCount(0);
  await expect(page.getByText('Cloud (fast, nothing stored)')).toHaveCount(0);
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
