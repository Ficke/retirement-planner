import { test, expect } from '@playwright/test';

test('should load homepage with all tabs', async ({ page }) => {
  await page.goto('/');
  
  await expect(page.getByRole('heading', { name: 'RetirePlan' })).toBeVisible();
  
  await expect(page.getByRole('tab', { name: 'Inputs' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Accounts' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Assumptions' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Results' })).toBeVisible();
});

test('should be able to switch between tabs', async ({ page }) => {
  await page.goto('/');
  
  await page.getByRole('tab', { name: 'Accounts' }).click();
  await expect(page.getByText('Retirement Accounts')).toBeVisible();
  
  await page.getByRole('tab', { name: 'Assumptions' }).click();
  await expect(page.getByText('Market Assumptions')).toBeVisible();
  
  await page.getByRole('tab', { name: 'Results' }).click();
  await expect(page.getByText('Simulation Results')).toBeVisible();
});

test('should toggle dark mode', async ({ page }) => {
  await page.goto('/');
  
  const themeToggle = page.getByRole('button', { name: 'Toggle theme' });
  await expect(themeToggle).toBeVisible();
  
  await themeToggle.click();
  
  const html = page.locator('html');
  await expect(html).toHaveAttribute('class', /dark/);
});