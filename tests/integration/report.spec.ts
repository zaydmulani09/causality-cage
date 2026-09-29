// M6 gate: report.html from file:// with the network blocked; zero requests; toggles match the truth table;
// no horizontal scroll at phone width; text contrast in light and dark.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, expect, test, type Page } from '@playwright/test';
import { FLOW, loadCases, REPO, runCase } from '../../packages/bench/src/index.ts';
import { assembleBundle, loadSource, sha } from '../../packages/core/src/index.ts';
import { renderReport } from '../../packages/report/src/index.ts';

let url = '';
let table: { on: string[]; decision: string }[] = [];

test.beforeAll(async () => {
  test.setTimeout(300_000);
  const c = loadCases().find((x) => x.id === 'demo')!;
  const browser = await chromium.launch();
  const r = await runCase(c, browser);
  await browser.close();
  expect(r.match).toBe(true);
  const flowSource = await loadSource(FLOW);
  const b = assembleBundle({
    out: r.out,
    ...r.recorded,
    manifest: { toolVersion: 'test', baseOrigin: 'http://127.0.0.1:5173', flowHash: sha(flowSource), flowFile: FLOW, oracle: c.oracle, apiGlobs: [], allowUnmatched: [], freezeRandom: false, freezeTime: false },
    flowSource,
    oracleSource: await loadSource(c.oracle.file!),
    redact: true,
  });
  table = b.result.truthTable!.rows;
  mkdirSync(join(REPO, '.cage-out'), { recursive: true });
  const file = join(REPO, '.cage-out', 'report-test.html');
  writeFileSync(file, renderReport(b));
  url = pathToFileURL(file).href;
});

async function open(page: Page) {
  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  await page.context().route(/^(?!file:).*/, (route) => route.abort());
  await page.goto(url);
  return requests;
}

test('makes zero network requests', async ({ page }) => {
  const requests = await open(page);
  await page.waitForLoadState('networkidle');
  expect(requests.filter((u) => !u.startsWith('file:'))).toEqual([]);
});

test('toggling a factor follows the embedded truth table', async ({ page }) => {
  await open(page);
  const outcome = page.locator('.graph-wide .outcome');
  const factors = page.locator('.graph-wide .factor');
  const ids = await factors.evaluateAll((els) => els.map((e) => e.getAttribute('data-id')!));
  expect(ids.length).toBe(2);
  const expected = (on: string[]) => table.find((r) => r.on.length === on.length && r.on.every((x) => on.includes(x)))!.decision;
  await expect(outcome).toHaveAttribute('data-decision', expected(ids));
  expect(expected(ids)).toBe('FAIL');
  await factors.nth(0).click();
  await expect(outcome).toHaveAttribute('data-decision', expected([ids[1]!]));
  expect(expected([ids[1]!])).toBe('PASS');
  await expect(page.locator('.graph-wide .outcome-text')).toHaveText('NO FAILURE');
  await factors.nth(0).press('Enter');
  await expect(outcome).toHaveAttribute('data-decision', 'FAIL');
  await factors.nth(1).click();
  await factors.nth(0).click();
  await expect(outcome).toHaveAttribute('data-decision', expected([]));
});

test('no horizontal scroll at phone width', async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 375, height: 800 } });
  await open(page);
  const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(sw).toBeLessThanOrEqual(cw);
  await expect(page.locator('.graph-narrow')).toBeVisible();
  await page.close();
});

for (const scheme of ['light', 'dark'] as const) {
  test(`text contrast (${scheme})`, async ({ browser }) => {
    const page = await browser.newPage({ colorScheme: scheme });
    await open(page);
    const pairs = await page.evaluate(() => {
      const parse = (c: string) => (c.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number);
      const lum = ([r, g, b]: number[]) => {
        const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
        return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!);
      };
      const ratio = (a: string, b: string) => {
        const [x, y] = [lum(parse(a)), lum(parse(b))].sort((p, q) => q - p);
        return (x! + 0.05) / (y! + 0.05);
      };
      const css = getComputedStyle(document.documentElement);
      const v = (n: string) => {
        const probe = document.createElement('i');
        probe.style.color = css.getPropertyValue(n);
        document.body.append(probe);
        const c = getComputedStyle(probe).color;
        probe.remove();
        return c;
      };
      const body = getComputedStyle(document.body);
      return {
        'body text on body': ratio(body.color, body.backgroundColor),
        'fg on card': ratio(v('--fg'), v('--card')),
        'muted on bg': ratio(v('--muted'), v('--bg')),
        'fail on fail-bg': ratio(v('--fail'), v('--fail-bg')),
        'pass on pass-bg': ratio(v('--pass'), v('--pass-bg')),
        'warn on warn-bg': ratio(v('--warn'), v('--warn-bg')),
        'accent-ink on accent': ratio(v('--accent-ink'), v('--accent')),
      };
    });
    for (const [name, r] of Object.entries(pairs)) expect(r, `${name} = ${r.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
    expect(pairs['body text on body']).toBeGreaterThanOrEqual(7);
    await page.close();
  });
}

test('?demo=1 autoplays factor toggles', async ({ page }) => {
  await page.context().route(/^(?!file:).*/, (route) => route.abort());
  await page.goto(url + '?demo=1');
  const outcome = page.locator('.graph-wide .outcome');
  await expect(outcome).toHaveAttribute('data-decision', 'PASS', { timeout: 2500 });
  await expect(outcome).toHaveAttribute('data-decision', 'FAIL', { timeout: 2500 });
});
