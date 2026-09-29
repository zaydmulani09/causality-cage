import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

export async function doctor(argv: string[]): Promise<number> {
  if (argv.includes('--help')) {
    console.log('cage doctor\n\nChecks Node >= 20.10, the playwright package, and a launchable Chromium.\n\nExample:\n  cage doctor');
    return 0;
  }
  let ok = true;
  const line = (pass: boolean, msg: string, fix?: string) => {
    console.log(`${pass ? 'ok  ' : 'FAIL'} ${msg}${!pass && fix ? `\n     fix: ${fix}` : ''}`);
    if (!pass) ok = false;
  };

  const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
  line(major > 20 || (major === 20 && minor >= 10), `node ${process.versions.node}`, 'install Node 20.10 or newer');

  let pwVersion = '';
  try {
    pwVersion = (createRequire(import.meta.url)('playwright/package.json') as { version: string }).version;
  } catch {
    // reported below
  }
  line(!!pwVersion, `playwright ${pwVersion || 'not found'}`, 'pnpm install');
  if (!pwVersion) return 1;

  const { chromium } = await import('playwright');
  const exe = chromium.executablePath();
  line(existsSync(exe), `chromium at ${exe}`, 'npx playwright install chromium');
  try {
    const browser = await chromium.launch();
    line(true, `chromium launches (${browser.version()})`);
    await browser.close();
  } catch (e) {
    line(false, `chromium launch failed: ${(e as Error).message.split('\n')[0]}`, 'npx playwright install chromium');
  }
  return ok ? 0 : 1;
}
