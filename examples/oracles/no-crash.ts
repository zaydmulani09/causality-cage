import type { Page } from 'playwright';

// Fails on uncaught errors or when the app's error boundary is showing.
export default async function oracle({ page, pageErrors }: { page: Page; pageErrors: string[] }) {
  if (pageErrors.length) return { failed: true, reason: `uncaught: ${pageErrors[0]}` };
  const alert = page.getByRole('alert');
  if (await alert.count()) return { failed: true, reason: (await alert.first().innerText()).trim() };
  return { failed: false };
}
