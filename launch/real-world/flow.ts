import type { Page } from '@playwright/test';

// Open the home page and let the initial API calls settle.
export default async function flow({ page, baseURL }: { page: Page; baseURL: string }): Promise<void> {
  await page.goto(baseURL + '/');
  await page.waitForLoadState('networkidle');
}
