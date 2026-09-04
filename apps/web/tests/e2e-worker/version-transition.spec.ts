import { expect, test, type Page } from '@playwright/test';

/**
 * What happens to a tab that is open when a deploy lands.
 *
 * Workers Assets scopes the asset manifest to the Worker version, so the
 * previous build's chunks stop resolving the moment a new version goes live. A
 * tab open across a deploy asks for one on its next lazy route. Retiring a
 * chunk here is a 404 on its URL, which is exactly what the Worker now returns
 * for a name this version does not list.
 *
 * This is the behavior that broke deploy-2026-09-04.1 and that nothing could
 * observe: the unit tests have no asset store, and the default e2e suite runs
 * against the Vite dev server.
 */

/** Fails the Accounts chunk. Returns a handle to stop failing it. */
async function retireAccountsChunk(page: Page, { persist }: { persist: boolean }) {
  let retired = false;
  await page.route('**/assets/accounts-*.js', async (route) => {
    if (persist || !retired) {
      retired = true;
      await route.fulfill({ status: 404, contentType: 'text/plain', body: 'Not found' });
      return;
    }
    await route.continue();
  });
}

async function gotoPlan(page: Page) {
  await page.goto('/plan');
  await expect(page.getByRole('heading', { name: 'Plan', level: 1 })).toBeVisible({ timeout: 30_000 });
}

function navItem(page: Page, name: string) {
  return page.getByRole('complementary').getByRole('link', { name, exact: true });
}

test('a tab whose chunk was retired reloads onto the current build', async ({ page }) => {
  await gotoPlan(page);
  await retireAccountsChunk(page, { persist: false });

  await navItem(page, 'Accounts').click();

  // The reload is the recovery: the chunk is gone, so re-requesting the same
  // URL could never work.
  await expect(page.getByRole('heading', { name: 'Accounts', level: 1 })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Something went wrong')).toHaveCount(0);
  await expect(page.getByText('A new version is available')).toHaveCount(0);
});

test('a chunk that stays gone reloads exactly once, then says why', async ({ page }) => {
  await gotoPlan(page);
  // Counted after the first paint, so this is reloads and not the initial load.
  let reloads = 0;
  page.on('load', () => { reloads += 1; });
  await retireAccountsChunk(page, { persist: true });

  await navItem(page, 'Accounts').click();

  // The copy names the real cause and offers the only action that can work.
  await expect(page.getByText('A new version is available')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Reload' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);

  // Exactly one: recovery tried, and the guard then held. Zero would mean the
  // recovery never ran; more would mean a build that is genuinely broken spins.
  expect(reloads).toBe(1);
});

test('the Worker serves assets by manifest, and the shell keeps its headers', async ({ page }) => {
  const retired = await page.request.get('/assets/accounts-0000000000.js');
  expect(retired.status()).toBe(404);
  expect(retired.headers()['content-type']).toContain('text/plain');
  expect(retired.headers()['cache-control']).toBe('no-store');

  const shell = await page.request.get('/plan');
  expect(shell.status()).toBe(200);
  expect(shell.headers()['content-type']).toContain('text/html');
  // The shell reaches the browser through env.ASSETS.fetch() now, so
  // public/_headers has to still apply to it. If it did not, the page would
  // quietly lose its CSP.
  expect(shell.headers()['content-security-policy']).toContain('default-src');
  expect(shell.headers()['x-frame-options']).toBe('DENY');

  // A name the manifest does list is served by the store without invoking the
  // Worker -- had it reached the Worker, it would have taken the 404 branch.
  const chunk = /\/assets\/[A-Za-z0-9._-]+\.js/.exec(await shell.text())?.[0];
  expect(chunk).toBeTruthy();
  const live = await page.request.get(chunk!);
  expect(live.status()).toBe(200);
  expect(live.headers()['content-type']).toContain('javascript');
  expect(live.headers()['cache-control']).toContain('immutable');
});
