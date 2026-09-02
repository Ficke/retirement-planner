import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

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
const PAGE_PATHS = ['/plan', '/accounts', '/profile', '/settings'] as const;

/** Navigates to the app and waits for bootstrap to finish. */
async function gotoApp(page: Page) {
  await page.goto('/');
  await expect(page).toHaveURL(/\/plan$/);
  await expect(page.getByRole('heading', { name: 'Plan', level: 1 })).toBeVisible();
}

/** Returns a sidebar link without matching duplicate text in page content. */
function navItem(page: Page, name: string) {
  return page.getByRole('complementary').getByRole('link', { name, exact: true });
}

test('boots into Plan with outcomes, controls, and projection charts in order', async ({ page }) => {
  await gotoApp(page);

  for (const label of [
    'Current wealth',
    'Modeled plan success',
    'Median wealth at retirement',
  ]) {
    await expect(page.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(page.getByText(/Median wealth at age \d+/)).toBeVisible();
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

test('Plan includes cash-flow outcome cohorts', async ({ page }) => {
  await gotoApp(page);

  // Nobody is signed in, so cloud compute is off and the plan runs on local
  // Wasm without asking the server. This verifies the local result shape.

  const outcomeSelectors = page.getByRole('combobox', { name: 'Outcome percentile' });
  await expect(outcomeSelectors).toHaveCount(2, { timeout: 15_000 });
  await expect(outcomeSelectors.first()).toContainText(
    'Median · 45th–55th',
  );

  const cashFlowChart = page.getByRole('img', {
    name: 'Average annual money in by source and money out by category for the selected outcome range',
  });
  await expect(cashFlowChart).toBeVisible();
  await expect(cashFlowChart.locator('.recharts-wrapper')).toHaveCount(1);
  await expect(cashFlowChart.getByText('RMD', { exact: true })).toBeVisible();
  await expect(page.getByText('Money in — what it clears is saved')).toHaveCount(0);
});

test('Plan exports the completed simulation as compact JSON', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'retirement-planner:preferences',
      JSON.stringify({ useServerSideCalculations: false, cloudSyncEnabled: true }),
    );
  });
  await gotoApp(page);

  const exportButton = page.getByRole('button', { name: 'Export simulation' });
  await expect(exportButton).toBeEnabled({ timeout: 15_000 });
  const downloadPromise = page.waitForEvent('download');
  await exportButton.click();
  const download = await downloadPromise;
  const downloadPath = await download.path();

  expect(download.suggestedFilename()).toMatch(/^retirement-simulation-\d{4}-\d{2}-\d{2}\.json$/);
  expect(downloadPath).not.toBeNull();
  const exported = JSON.parse(await readFile(downloadPath!, 'utf8')) as Record<string, unknown>;
  expect(exported).toMatchObject({
    version: 1,
    paths: 5000,
    output: {
      successProbability: expect.any(Number),
      yearlyProjections: expect.any(Array),
    },
  });
  expect(Object.keys(exported)).toEqual(['version', 'exportedAt', 'paths', 'input', 'output']);
  const input = exported.input as { accounts: Array<Record<string, unknown>> };
  expect(input.accounts.length).toBeGreaterThan(0);
  expect(input.accounts[0]).not.toHaveProperty('id');
  expect(input.accounts[0]).not.toHaveProperty('name');
  expect(input.accounts[0]).not.toHaveProperty('institution');
});

test('local simulation loads the Rust Wasm module without runtime errors', async ({ page }) => {
  const runtimeErrors: string[] = [];
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') runtimeErrors.push(message.text());
  });
  await page.addInitScript(() => {
    localStorage.setItem(
      'retirement-planner:preferences',
      JSON.stringify({ useServerSideCalculations: false, cloudSyncEnabled: true }),
    );
  });

  const wasmResponsePromise = page.waitForResponse((response) =>
    response.request().resourceType() === 'fetch'
      && new URL(response.url()).pathname.endsWith('.wasm'),
  );
  await gotoApp(page);

  const wasmResponse = await wasmResponsePromise;
  expect(wasmResponse.ok()).toBe(true);
  expect(wasmResponse.headers()['content-type']).toContain('application/wasm');
  await expect(page.getByText('Local engine', { exact: true })).toBeVisible({ timeout: 15_000 });
  expect(runtimeErrors).toEqual([]);
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
    name: 'Modeled wealth by age, showing the median and 25th to 75th percentile range',
  })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Middle 50%' })).toBeVisible();
});

test('every sidebar page is reachable', async ({ page }) => {
  await gotoApp(page);

  for (const [index, name] of PAGES.entries()) {
    await navItem(page, name).click();
    await expect(page).toHaveURL(new RegExp(`${PAGE_PATHS[index]}$`));
    await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
    await expect(page).toHaveTitle(`${name} · RetirePlan`);
  }

  await page.goBack();
  await expect(page).toHaveURL(/\/profile$/);
  await expect(page.getByRole('heading', { name: 'Profile', level: 1 })).toBeVisible();
});

test('a page route survives a direct load and refresh', async ({ page }) => {
  await page.goto('/accounts');
  await expect(page.getByRole('heading', { name: 'Accounts', level: 1 })).toBeVisible();
  await expect(page).toHaveTitle('Accounts · RetirePlan');

  await page.reload();
  await expect(page).toHaveURL(/\/accounts$/);
  await expect(page.getByRole('heading', { name: 'Accounts', level: 1 })).toBeVisible();
});

test('an unknown page route renders the application not-found view', async ({ page }) => {
  await page.goto('/does-not-exist');

  await expect(page).toHaveURL(/\/does-not-exist$/);
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  await expect(page).toHaveTitle('Page not found · RetirePlan');
  await expect(page.getByRole('link', { name: 'Go to plan' })).toHaveAttribute('href', '/plan');
});

test('growth fields sharing a label are told apart by their group', async ({ page }) => {
  await gotoApp(page);
  await navItem(page, 'Profile').click();

  // Three fields on this page are labeled "Growth above inflation (%)", so
  // addressing one without its group is a strict-mode violation. That is the
  // ambiguity a screen reader hits too.
  const label = 'Growth above inflation (%)';
  for (const group of ['Spending growth while working', 'Retirement spending', 'Retirement healthcare']) {
    await expect(page.getByRole('group', { name: group }).getByLabel(label)).toBeVisible();
  }
  await expect(page.getByLabel('Salary growth above inflation (%)')).toBeVisible();
});

test('signed out, data stays local while compute remains selectable', async ({ page }) => {
  await gotoApp(page);

  await expect(page.getByText('Guest. Data stays in this browser.')).toBeVisible();
  await expect(page.getByRole('complementary').getByRole('button', { name: 'Sign in' })).toBeVisible();

  await navItem(page, 'Settings').click();
  // The storage badge reflects LOCAL mode when there is no auth user.
  await expect(page.getByText('This browser', { exact: true })).toBeVisible();

  // Compute mode is independent from persistence mode. Anonymous plans may use
  // the transient Rust service without enabling cloud data storage.
  const computeEngine = page.getByRole('combobox').first();
  await expect(computeEngine).toBeVisible();
  await computeEngine.click();
  await expect(page.getByRole('option', { name: 'Cloud (fast, nothing stored)' })).toBeVisible();
  await expect(page.getByRole('option', { name: 'Local (never leaves device)' })).toBeVisible();
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
