import type { Page } from '@playwright/test';

// Home → Checkout → Place order. Returns early if the app shows its error boundary.
export default async function flow({ page, baseURL }: { page: Page; baseURL: string }): Promise<void> {
  await page.goto(baseURL + '/');
  await page.getByRole('button', { name: 'Checkout' }).click();
  const crashed = page.getByRole('alert');
  const place = page.getByRole('button', { name: 'Place order' });
  await place.or(crashed).first().waitFor();
  if (await crashed.isVisible()) return;
  await place.click();
  await page.getByText('Order placed').or(crashed).first().waitFor();
}
